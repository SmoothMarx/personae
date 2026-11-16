"""Read-only message-body search for the Personae desktop pane.

Why this file exists
--------------------
The pane reaches the host through exactly two doors, and neither can read a
message body:

* **gateway JSON-RPC** — session *metadata* only. There is no search method, and
  the app's own search helper (``apps/desktop/src/lib/session-search.ts``)
  matches the titles and previews the client already holds.
* **``ctx.rest``** — namespaced to ``/api/plugins/<id>/``, i.e. this file.

Message text lives in each profile's ``state.db`` behind FTS. The core route
``GET /api/sessions/search`` reads it, but it is not part of the SDK surface, so
the pane publishes that single read on its own namespace instead.

Contract
--------
Read-only and narrow by design: the store is opened with ``read_only=True``,
only ``search_messages`` is called, and the response carries session id, role,
snippet, timestamp, source and model — no tool output, no context blobs. An
empty ``q`` returns nothing rather than the whole table, and a broken store
returns an error object instead of a 500.

Shared UI state (0.2.0 — Personae Mobile 0.6.0)
-----------------------------------------------
``GET/PUT /state`` is the one WRITE this backend has: the pane's *shared* layout
prefs (sort, manual order, sections, per-profile groups, colours, hidden,
Apropos) so the desktop pane and the phone show the same roster. Entry-wise
last-writer-wins by ``rev`` with tombstones; device-local keys are refused by
name; bodies over 256 KB are 413. Storage: ``state/ui-state.json`` (0600,
atomic, flock). The logic lives in ``ui_state.py`` (see its docstring).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

router = APIRouter()


def _ui_state():
    """``ui_state.py`` beside this file (this module is loaded by path, so no package import)."""
    name = "personae_ui_state"
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent / "ui_state.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod

#: Columns the pane renders. Deliberately excludes tool payloads and context.
_FIELDS = ("session_id", "role", "snippet", "timestamp", "source", "model")


@router.get("/health")
async def health() -> Dict[str, Any]:
    """Liveness + CAPABILITY probe.

    ``title`` and ``search_roles`` are feature flags, not decoration: the desktop
    half ships separately from this file and an older backend is otherwise
    indistinguishable from a broken session ("Session not found"). A client (and
    the live end-to-end test) can read this to tell "this build cannot rename"
    from "this session does not exist".
    """
    return {
        "ok": True,
        "plugin": "personae",
        "version": "2.2.0",
        "readOnly": False,
        "resolve": True,
        "state": True,
        "title": False,  # renames ride the session.title RPC now (no store writes here)
        "search_roles": True,
        "search_titles": True,
    }


@router.get("/state")
async def get_state() -> JSONResponse:
    """The merged shared UI state. A missing store is an empty one, never an error."""
    st = _ui_state()
    return JSONResponse(st.view(st.load()), headers={"Cache-Control": "no-store"})


@router.put("/state")
async def put_state(request: Request) -> JSONResponse:
    """Merge shared keys (entry-wise LWW by rev, tombstones) and return the merged view."""
    st = _ui_state()
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > st.MAX_BODY_BYTES:
        return JSONResponse({"error": "too_large", "detail": f"body exceeds {st.MAX_BODY_BYTES} bytes"},
                            status_code=413)
    raw = await request.body()
    if len(raw) > st.MAX_BODY_BYTES:
        return JSONResponse({"error": "too_large", "detail": f"body exceeds {st.MAX_BODY_BYTES} bytes"},
                            status_code=413)
    try:
        payload = json.loads(raw.decode("utf-8") or "null")
    except (ValueError, UnicodeDecodeError):
        return JSONResponse({"error": "bad_request", "detail": "body is not valid JSON"}, status_code=400)
    try:
        merged = st.apply_put(payload)
    except st.StateError as exc:
        return JSONResponse({"error": "too_large" if exc.status == 413 else "bad_request",
                             "detail": exc.detail}, status_code=exc.status)
    return JSONResponse(merged, headers={"Cache-Control": "no-store"})


# Sources that are machine runs, not conversations: a cron tick, a kanban worker,
# a one-shot, a webhook, a tool integration. Declared HERE rather than imported
# from core — the catalog review was explicit that a listed plugin must not reach
# into `hermes_state_sessions` (Pedro, 2026-11-16: "private core imports for
# reads"). The cost is drift; the mitigation is that a new machine source is also
# a source this pane would draw as a chat, so it gets noticed.
MACHINE_SOURCES = frozenset({"cron", "kanban", "tool", "oneshot", "webhook"})


def _denied_sources() -> set:
    return set(MACHINE_SOURCES)


def _state_db_path(profile: str):
    """The session store for one profile, from the documented home layout.

    `get_hermes_home()` is public and profile-aware; the default home keeps its
    `state.db` at the root and every other profile has its own. Resolving the
    path here instead of calling a web-router helper is what keeps this route off
    Hermes internals (see the catalog review, 2026-11-13).
    """
    from pathlib import Path

    from hermes_constants import get_hermes_home

    home = Path(get_hermes_home())
    name = str(profile or "").strip()

    if not name or name == "default":
        return home / "state.db"

    return home / "profiles" / name / "state.db"


def _store(profile: str):
    """Open ``profile``'s session store READ-ONLY via the public SessionDB."""
    from hermes_state import SessionDB

    path = _state_db_path(profile)
    if not path.exists():
        return None

    db = SessionDB(path)
    # This half only reads; the class stays public, the write path is gone (see
    # the module docstring: renames ride the gateway's own RPC now).
    return db


@router.post("/resolve")
async def resolve(request: Request) -> JSONResponse:
    """Rows for specific stored session ids, whatever state they are in.

    A group's box draws its members out of ``session.list``, which only ever serves LIVE
    rows inside its page — so a member that is archived, older than that page, or whose id
    was reminted by a compaction is a member the pane cannot draw: the group claims a
    session and shows nothing. This answers the question the pane actually has: "what is
    behind THESE ids?" — each resolved through its lineage, so an id filed before a
    compaction still finds the live tip (and the tip is what the row reports).
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - a malformed body is an empty request, not a 500
        body = {}

    profile = str(body.get("profile") or "")
    ids = [str(value) for value in (body.get("ids") or []) if str(value or "").strip()][:50]

    if not ids:
        return JSONResponse({"profile": profile, "sessions": []})

    try:
        db = _store(profile)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"{type(exc).__name__}: {exc}", "profile": profile, "sessions": []})

    if db is None:
        return JSONResponse({"profile": profile, "sessions": []})

    denied = _denied_sources()
    out: List[Dict[str, Any]] = []

    try:
        for wanted in ids:
            try:
                chain = db.get_compression_tip(wanted) or []
            except Exception:  # noqa: BLE001 - an id with no lineage is still an id
                chain = []

            tip = chain[-1] if chain else wanted
            row: Optional[Dict[str, Any]] = None

            for candidate in (tip, wanted):
                try:
                    row = db.get_session(candidate)
                except Exception:  # noqa: BLE001
                    row = None

                if row:
                    break

            if not row:
                continue

            if (row.get("source") or "").strip().lower() in denied:
                continue

            out.append(
                {
                    "_lineage_root_id": chain[0] if chain else row.get("id"),
                    "archived": bool(row.get("archived")),
                    "id": row.get("id"),
                    "last_active": row.get("last_activity_at") or row.get("last_active"),
                    "message_count": row.get("message_count"),
                    "preview": row.get("preview") or "",
                    "source": row.get("source") or "",
                    "title": row.get("title") or row.get("display_name") or "",
                }
            )
    finally:
        try:
            db.close()
        except Exception:  # noqa: BLE001
            pass

    return JSONResponse({"count": len(out), "profile": profile, "sessions": out})


@router.get("/archived")
async def archived(
    profile: str = "",
    limit: int = Query(60, ge=1, le=200),
) -> Dict[str, Any]:
    """Archived sessions for one profile — the one listing the RPC cannot serve.

    ``session.list`` whitelists ``title`` / ``limit`` / ``include_hidden``, so it can only
    ever return live rows; the archive is one read away in the same store, and the pane
    publishes that read on its own namespace. Read-only, narrow columns, same deny-list as
    every other human-facing listing (machine runs are not conversations).
    """
    db = None
    try:
        db = _store(profile)
    except Exception as exc:  # unknown profile, unreadable store, ...
        return {"error": f"{type(exc).__name__}: {exc}", "profile": profile, "sessions": []}
    if db is None:
        return {"profile": profile, "count": 0, "sessions": []}

    try:
        # Over-fetch, then trim after the deny-list so a machine-run-heavy archive still
        # fills the page.
        rows: List[Dict[str, Any]] = db.list_sessions_rich(
            source=None,
            limit=max(limit * 2, 200),
            order_by_last_active=True,
            compact_rows=True,
            include_archived=True,
            archived_only=True,
        )
    except Exception as exc:  # noqa: BLE001 - a broken store must not 500 the pane
        return {"error": f"{type(exc).__name__}: {exc}", "profile": profile, "sessions": []}
    finally:
        try:
            db.close()
        except Exception:
            pass

    denied = _denied_sources()
    out: List[Dict[str, Any]] = []
    for row in rows or []:
        if (row.get("source") or "").strip().lower() in denied:
            continue
        out.append(
            {
                "id": row.get("id"),
                "title": row.get("title") or row.get("display_name") or "",
                "source": row.get("source") or "",
                "last_active": row.get("last_active") or row.get("last_activity_at"),
                "started_at": row.get("started_at"),
                "message_count": row.get("message_count"),
                "preview": row.get("preview") or "",
                "archived": True,
            }
        )
        if len(out) >= limit:
            break

    return {"profile": profile, "count": len(out), "sessions": out}


@router.get("/search")
async def search(
    q: str = "",
    profile: str = "",
    limit: int = Query(40, ge=1, le=100),
    role: str = "",
) -> Dict[str, Any]:
    """Full-text message search inside one profile's own session store.

    ``role`` (0.4.0, optional) is a comma-separated role filter — the pane asks
    for ``user,assistant``, because tool rows are machine output (file dumps,
    escaped JSON) and BM25 ranks them ABOVE the sentence a person actually
    wrote. It is optional by construction: an older client that omits it gets
    exactly the previous behaviour, and a client that sends it against an older
    backend is ignored (FastAPI drops unknown query parameters), so the two
    halves can be deployed in either order.
    """
    needle = (q or "").strip()
    if not needle:
        return {"profile": profile, "query": "", "results": []}

    denied = _denied_sources()
    roles = [part.strip().lower() for part in str(role or "").split(",") if part.strip()]
    db = None
    try:
        db = _store(profile)
    except Exception as exc:  # unknown profile, unreadable store, ...
        return {
            "error": f"{type(exc).__name__}: {exc}",
            "profile": profile,
            "results": [],
        }
    if db is None:
        return {"profile": profile, "query": needle, "results": []}

    try:
        rows: List[Dict[str, Any]] = db.search_messages(
            needle, limit=limit, fields=_FIELDS, role_filter=roles or None
        )
        # A hit the metadata sweep does not already know has no NAME in the pane:
        # `search_messages` returns snippets, not titles, so the row read as
        # "...personae-0130 state=$(systemctl --user is-active" — a line nobody can
        # recognise, which is half of what "the session didn't pop up" means. One
        # indexed read per distinct session fixes the row's name; the snippet stays
        # the snippet (it is why the row is here).
        titles: Dict[str, str] = {}

        for sid in {str(row.get("session_id") or "") for row in rows or []}:
            if not sid or sid in titles:
                continue

            try:
                titles[sid] = str(db.get_session_title(sid) or "")
            except Exception:  # noqa: BLE001 - a missing title is not a failed search
                titles[sid] = ""
    except Exception as exc:  # noqa: BLE001 - a broken store must not 500 the pane
        return {"error": f"{type(exc).__name__}: {exc}", "profile": profile, "results": []}
    finally:
        try:
            db.close()
        except Exception:
            pass

    return {
        "profile": profile,
        "query": needle,
        "roles": roles,
        "results": [
            {
                "session_id": row.get("session_id"),
                "role": row.get("role"),
                "snippet": row.get("snippet") or "",
                "timestamp": row.get("timestamp"),
                "source": row.get("source"),
                "model": row.get("model"),
                "title": titles.get(str(row.get("session_id") or ""), ""),
            }
            for row in rows or []
            # The same deny-list every human-facing listing uses: a machine run
            # (cron / kanban / webhook) is not a conversation, and a search that
            # draws one as a chat row is lying about what it found.
            if (row.get("source") or "").strip().lower() not in denied
        ],
    }
