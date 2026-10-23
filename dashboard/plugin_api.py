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
        "version": "0.6.0",
        "readOnly": False,
        "resolve": True,
        "state": True,
        "title": True,
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


def _denied_sources() -> set:
    """The same machine-run deny-list every human-facing listing uses.

    Read from core rather than copied, so this pane drifts with the backend instead of
    against it. ``hermes_state_sessions`` is a sibling of this process, not a dependency
    of the SDK — hence the import guard.
    """
    try:
        from hermes_state_sessions import INTERNAL_LISTING_SOURCES

        return {str(s).strip().lower() for s in INTERNAL_LISTING_SOURCES}
    except Exception:
        return {"cron", "kanban", "tool", "oneshot", "webhook"}


def _store(profile: str):
    """Open ``profile``'s session store read-only, or raise for the caller to catch."""
    from hermes_cli.web_server_sessions import (
        _open_session_db_at_path,
        _session_db_path_for_profile,
    )

    path = _session_db_path_for_profile(profile or None)
    if not path.exists():
        return None
    return _open_session_db_at_path(path, read_only=True)


def _writer(profile: str):
    """Open ``profile``'s session store for a WRITE, or raise for the caller to catch.

    The gateway's own REST title route opens the store exactly this way
    (``hermes_cli/web_routers/sessions.py``: ``_with_db(..., read_only=False)``);
    SQLite's WAL keeps the gateway's reader and this writer out of each other's
    way, which is how the dashboard and the gateway already co-exist here.
    """
    from hermes_cli.web_server_sessions import (
        _open_session_db_at_path,
        _session_db_path_for_profile,
    )

    path = _session_db_path_for_profile(profile or None)
    if not path.exists():
        return None
    return _open_session_db_at_path(path, read_only=False)


@router.post("/title")
async def set_title(request: Request) -> JSONResponse:
    """Rename a session by its STORED id — the door core's RPC cannot offer.

    ``session.title`` is a SESSION-SCOPED RPC: the gateway resolves its
    ``session_id`` against the LIVE registry and answers ``4001 session not
    found`` for anything else, and every id a session list shows is a STORED id.
    So the pane had no way to rename a chat it was not currently running
    (2026-10-16: "every time I try to rename a session in my plug-in, it says
    'Session not found'").

    This mirrors the REST route the app itself uses — ``resolve_session_id``
    (title/prefix aliases included) then ``set_session_title`` — and nothing
    else. It does not touch messages, and an unknown id is a 404 with the id in
    the detail, so the pane can say WHICH session it could not find.
    """
    try:
        payload = json.loads((await request.body()).decode("utf-8") or "null")
    except (ValueError, UnicodeDecodeError):
        return JSONResponse({"error": "bad_request", "detail": "body is not valid JSON"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "bad_request", "detail": "body must be an object"}, status_code=400)

    profile = str(payload.get("profile") or "")
    session_id = str(payload.get("session_id") or "").strip()
    title = str(payload.get("title") or "").strip()
    if not session_id:
        return JSONResponse({"error": "bad_request", "detail": "session_id required"}, status_code=400)
    if not title:
        return JSONResponse({"error": "bad_request", "detail": "title required"}, status_code=400)

    db = None
    try:
        db = _writer(profile)
    except Exception as exc:  # unknown profile, unreadable store, ...
        return JSONResponse({"error": "store_unavailable", "detail": f"{type(exc).__name__}: {exc}"}, status_code=500)
    if db is None:
        return JSONResponse({"error": "store_unavailable", "detail": f"no session store for {profile or 'default'}"}, status_code=404)

    try:
        key = db.resolve_session_id(session_id) if hasattr(db, "resolve_session_id") else session_id
        if not key:
            return JSONResponse(
                {"error": "session_not_found", "detail": f"no session {session_id} in {profile or 'default'}"},
                status_code=404,
            )
        db.set_session_title(str(key), title)
        return JSONResponse({"ok": True, "session_key": str(key), "title": db.get_session_title(str(key)) or title},
                            headers={"Cache-Control": "no-store"})
    except ValueError as exc:  # too long, invalid characters, or already in use
        return JSONResponse({"error": "rejected", "detail": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - a broken store must not 500 the pane silently
        return JSONResponse({"error": "write_failed", "detail": f"{type(exc).__name__}: {exc}"}, status_code=500)
    finally:
        try:
            db.close()
        except Exception:
            pass


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
                chain = db._session_lineage_root_to_tip(wanted) or []
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
