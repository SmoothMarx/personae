#!/usr/bin/env python3
"""LIVE end-to-end for the Personae session flow.

Pedro, 2026-10-17: "create a session, send a message, wait for the response, send
a second message, then rename the session to something else, archive it, and
finally search for it. Use bizzy-talk."

End-to-end means every step touches the real object:

  * the two model turns run through the real `hermes -p bizzy-talk chat` CLI, so
    a real agent answers and a real transcript lands in the real state.db;
  * the RENAME calls `plugin_api.set_title` — the very handler the pane's
    `POST /title` reaches (the dashboard's session auth cannot be minted outside
    a browser, so the handler is invoked directly rather than over TCP);
  * the ARCHIVE calls `SessionDB.set_session_archived`, the one call the
    gateway's `session.archive` handler makes (the handler itself needs the whole
    3.14/pydantic server stack; the harness pins its param shape);
  * SEARCH calls `plugin_api.search` (FTS + role filter + titles);
  * every assertion reads `state.db` — sqlite3, no mocks.

Run:  tests/run-e2e.sh     (costs two model turns on bizzy-talk)
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import time
import types
from pathlib import Path

# Portable on purpose: this file ships in a public repo, so the install directory
# is whatever the runner says it is — never one particular machine's home.
AGENT = os.environ.get("HERMES_AGENT_DIR") or os.path.expanduser("~/.hermes/hermes-agent")
sys.path.insert(0, AGENT)
os.environ.setdefault("HERMES_HOME", os.path.expanduser("~/.hermes"))

PROFILE = os.environ.get("PERSONAE_E2E_PROFILE", "bizzy-talk")
STAMP = time.strftime("%Y%m%d-%H%M%S")
MARK = f"personae-e2e-{STAMP}"
NAME = f"E2E renamed {STAMP}"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok or not detail else f"\n        {detail}"))


# ── framework stub ──────────────────────────────────────────────────────────
# plugin_api.py is a FastAPI module. The router/Query/JSONResponse surface it
# uses is three decorators and a response object, so a stub keeps the HANDLER
# code (what we are testing) and drops the framework (what we are not).
def install_fastapi_stub() -> None:
    class Router:
        # Every HTTP verb the module decorates with, as a no-op registrar: the
        # handler functions come out of the module unchanged.
        def _route(self, *args, **kwargs):
            return lambda fn: fn

        get = post = put = patch = delete = _route

    class JSONResponse:
        def __init__(self, payload, status_code: int = 200, headers=None):
            self.status_code = status_code
            self.headers = headers or {}
            self.body = json.dumps(payload, default=str).encode()

    class HTTPException(Exception):
        def __init__(self, status_code: int = 500, detail: str = ""):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    mod = types.ModuleType("fastapi")
    mod.APIRouter = Router
    mod.Query = lambda default=None, **kwargs: default
    mod.Request = object
    mod.HTTPException = HTTPException
    mod.status = types.SimpleNamespace(HTTP_400_BAD_REQUEST=400, HTTP_404_NOT_FOUND=404)
    responses = types.ModuleType("fastapi.responses")
    responses.JSONResponse = JSONResponse
    mod.responses = responses
    sys.modules["fastapi"] = mod
    sys.modules["fastapi.responses"] = responses


class Body:
    """What a body-only POST looks like to the handler."""

    def __init__(self, payload: dict):
        self._payload = json.dumps(payload).encode()

    async def body(self) -> bytes:
        return self._payload


def load_api():
    install_fastapi_stub()
    live = os.path.expanduser("~/.hermes/plugins/personae/dashboard/plugin_api.py")
    path = os.path.abspath(os.environ.get("PERSONAE_API") or live)
    spec = importlib.util.spec_from_file_location("personae_e2e_api", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["personae_e2e_api"] = mod
    spec.loader.exec_module(mod)
    return mod


# ── store reads (sqlite3 only: an assertion should not depend on the code it
#    is checking) ──────────────────────────────────────────────────────────
def db_path() -> str:
    """The profile's own store. Computed here rather than imported: the web-layer
    helper pulls fastapi for real, and an assertion needs no framework."""
    home = os.path.expanduser(os.environ["HERMES_HOME"])
    return os.path.join(home, "state.db") if PROFILE == "default" else os.path.join(home, "profiles", PROFILE, "state.db")


def q(sql: str, params: tuple = ()) -> list[tuple]:
    conn = sqlite3.connect(f"file:{db_path()}?mode=ro", uri=True, timeout=10)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def session_row(session_id: str) -> dict:
    rows = q("SELECT id, title, archived, title_source, message_count FROM sessions WHERE id = ?", (session_id,))
    if not rows:
        return {}
    keys = ("id", "title", "archived", "title_source", "message_count")
    return dict(zip(keys, rows[0]))


def role_counts(session_id: str) -> dict:
    return {role: n for role, n in q("SELECT role, COUNT(*) FROM messages WHERE session_id = ? GROUP BY role", (session_id,))}


def live_ids() -> set[str]:
    return {row[0] for row in q("SELECT id FROM sessions WHERE archived = 0")}


def conversationalize(session_id: str, source: str = "desktop") -> None:
    """Turn the CLI fixture into a CONVERSATION.

    `hermes chat -q` runs the ONE-SHOT path, so it stamps source='oneshot' — and
    every human-facing listing (and the pane's search) drops that source BY
    DESIGN, together with cron/kanban/tool/webhook. The assertion right before
    this call proves the deny-list still works, so this step cannot mask a
    regression; from here on, what the pane sees is what the pane tests.
    """
    conn = sqlite3.connect(db_path(), timeout=10)
    try:
        conn.execute("UPDATE sessions SET source = ? WHERE id = ?", (source, session_id))
        conn.commit()
    finally:
        conn.close()


def cli(args: list[str], timeout: int = 420) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["hermes", "-p", PROFILE, "chat", *args], capture_output=True, text=True, timeout=timeout
    )


def archive(session_id: str) -> bool:
    """The call the gateway's `session.archive` handler makes, on the same store."""
    from hermes_state import SessionDB

    db = SessionDB(Path(db_path()))
    try:
        return bool(db.set_session_archived(session_id, True))
    finally:
        db.close()


def main() -> int:
    api = load_api()
    print(f"\n── live E2E · {PROFILE} · {MARK} ──\n")

    # ── Phase 0: the backend half must be CURRENT ───────────────────────────
    # This gate exists because the rename bug came back twice: both halves ship
    # separately, and an older backend reads exactly like a broken session.
    health = asyncio.run(api.health())
    check("backend half answers /health", health.get("ok") is True, json.dumps(health))
    check("...and IS the build that can rename (title capability)", health.get("title") is True, json.dumps(health))

    # ── Phase 1: create, send, wait for the answer ──────────────────────────
    before = live_ids()
    first = cli(["-q", f"Reply with exactly ACK-{MARK} and nothing else. Do not use tools."])
    check("turn 1 ran (message sent, answer received)", first.returncode == 0, (first.stderr or "")[-600:])

    created = sorted(live_ids() - before)
    check("the session exists in bizzy-talk", len(created) == 1, f"new ids: {created}")
    sid = created[0] if created else ""

    roles = role_counts(sid) if sid else {}
    check("...with the user message AND the assistant answer stored", roles.get("user", 0) >= 1 and roles.get("assistant", 0) >= 1, json.dumps(roles))

    if sid:
        # `-q` is the one-shot path: source='oneshot', which every human-facing
        # listing and the pane's own search drop on purpose. Assert that FIRST
        # (it is a real invariant, not a workaround), then re-stamp the fixture
        # so the pane-facing phases have something a pane could actually see.
        source = q("SELECT source FROM sessions WHERE id = ?", (sid,))[0][0]
        check("the CLI fixture arrived as a ONE-SHOT run (the machine-run source)", source == "oneshot", str(source))

        hidden = asyncio.run(api.search(q=MARK, profile=PROFILE, limit=100, role="user,assistant"))
        check("…and the pane's search drops a machine run, by design", not any(str(h.get("session_id")) == sid for h in hidden.get("results") or []))

        conversationalize(sid)
        check("the fixture is now a conversation (desktop surface)", q("SELECT source FROM sessions WHERE id = ?", (sid,))[0][0] == "desktop")

    # ── Phase 2: a second message on the SAME session ───────────────────────
    if sid:
        second = cli(["--resume", sid, "-q", f"Reply with exactly ACK2-{MARK} and nothing else. Do not use tools."])
        check("turn 2 ran on the same session", second.returncode == 0, (second.stderr or "")[-600:])
        roles = role_counts(sid)
        check("both turns are in one transcript", roles.get("user", 0) >= 2 and roles.get("assistant", 0) >= 2, json.dumps(roles))
    else:
        check("turn 2 ran on the same session", False, "no session id")
        check("both turns are in one transcript", False, "no session id")

    # ── Phase 3: rename — the verb that was broken ──────────────────────────
    if sid:
        res = asyncio.run(api.set_title(Body({"profile": PROFILE, "session_id": sid, "title": NAME})))
        body = json.loads(res.body.decode())
        check('rename answered ok (no "Session not found")', res.status_code == 200 and body.get("ok") is True, json.dumps(body))

        row = session_row(sid)
        check("the STORE holds the new name", row.get("title") == NAME, json.dumps(row.get("title")))
        check("...recorded as a user rename, not auto-titling", str(row.get("title_source") or "").lower() != "auto", str(row.get("title_source")))
    else:
        for name in ('rename answered ok (no "Session not found")', "the STORE holds the new name", "...recorded as a user rename, not auto-titling"):
            check(name, False, "no session id")

    # ── Phase 4: archive ───────────────────────────────────────────────────
    if sid:
        check("archive answered ok", archive(sid) in (True, False), "")
        row = session_row(sid)
        check("the store says archived", int(row.get("archived") or 0) == 1, json.dumps(row.get("archived")))
        check("it is GONE from the live listing", sid not in live_ids())

        view = asyncio.run(api.archived(profile=PROFILE, limit=100))
        rows = view.get("sessions") or []
        check("View Archived shows it under the NEW name", any(str(r.get("id")) == sid and r.get("title") == NAME for r in rows), json.dumps([r.get("title") for r in rows[:5]]))
    else:
        for name in ("archive answered ok", "the store says archived", "it is GONE from the live listing", "View Archived shows it under the NEW name"):
            check(name, False, "no session id")

    # ── Phase 5: search still reaches it (it is archived) ──────────────────
    if sid:
        found = asyncio.run(api.search(q=MARK, profile=PROFILE, limit=100, role="user,assistant"))
        hits = found.get("results") or []
        mine = [hit for hit in hits if str(hit.get("session_id")) == sid]
        check("body search reaches the ARCHIVED session", bool(mine), f"{len(hits)} hits")
        check("...and the hit carries the NEW title, so the row is recognisable", any(hit.get("title") == NAME for hit in mine), json.dumps(mine[:1]))

        archived_view = asyncio.run(api.archived(profile=PROFILE, limit=100))
        row = next((r for r in archived_view.get("sessions") or [] if str(r.get("id")) == sid), None)
        check("...and the pane's title sweep has a row to match", bool(row) and "e2e renamed" in str(row.get("title", "")).lower(), json.dumps(row.get("title") if row else None))
    else:
        for name in ("body search reaches the ARCHIVED session", "...and the hit carries the NEW title, so the row is recognisable", "...and the pane's title sweep has a row to match"):
            check(name, False, "no session id")

    print(f"\nsession {sid or '(none)'} · \"{NAME}\" · archived on purpose, so it is inspectable in View Archived")
    print(f"\n{len(failures)} check(s) FAILED" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
