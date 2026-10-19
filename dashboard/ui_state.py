"""Shared UI-state store for the Personae panes (desktop pane + Personae Mobile).

Pure merge logic + atomic JSON persistence; ``plugin_api.py`` exposes it as
``GET/PUT /api/plugins/personae/state`` (the legacy ``/api/plugins/messenger/`` mount is a shim
that re-exports the same router). Kept free of FastAPI so the tests can drive it directly.

Model
-----
Every syncable key holds a JSON **object** (all seven shared prefs are maps in the pane:
``plugin.js`` normalises each from ``{}``/``EMPTY_SECTIONS``). Objects are merged **entry-wise on
their top-level names**, last-writer-wins by ``rev``:

* an incoming entry replaces the stored one only when its ``rev`` is HIGHER (equal keeps the server
  value — no churn);
* an entry absent from an incoming object is KEPT, so two devices adding different entries both
  survive; a removal is therefore an explicit tombstone ``{key, entry, rev}``;
* a tombstone deletes the entry when its ``rev`` is higher than the entry's, and is remembered, so
  a lower-or-equal-rev write can never resurrect it (a higher-rev write re-creates it — that is a
  genuine later re-add).

Clients use a Lamport clock: ``rev = max(server rev seen for the key, own last rev) + 1``. A key's
reported ``rev`` is the max over its entries and tombstones.

Granularity is the top level: ``sections-v1``'s ``sections`` array is one entry (LWW as a whole).

Device-local state (expanded rows, search, toasts, scroll, pane width) is refused by name.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("personae.ui_state")

VERSION = 1
MAX_BODY_BYTES = 256 * 1024
MAX_KEYS_PER_PUT = 64
MAX_TOMBSTONES_PER_PUT = 2048
MAX_TOMBSTONES_PER_KEY = 4096
MAX_ENTRY_NAME_CHARS = 512
MAX_STORED_BYTES = 4 * 1024 * 1024
MAX_REV = 2 ** 53

SHARED_KEYS: frozenset[str] = frozenset({
    "session-sort-v1", "session-order-v1", "sections-v1", "session-groups-v1",
    "session-colors-v1", "hidden-v1", "apropos-v1"})
#: Named so the 400 can say WHY (they are per-device by design), not just "unknown".
DEVICE_LOCAL_KEYS: frozenset[str] = frozenset({
    "expanded-v1", "search", "activity-toasts", "toasts", "scroll", "pane-width", "width",
    "sync-meta-v1"})


class StateError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _now_iso(ts: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() if ts is None else ts))


def _check_key(key: Any) -> str:
    if not isinstance(key, str) or not key:
        raise StateError(400, "state keys must be non-empty strings")
    # The local spellings (`messenger-<server name>`) are the wire contract the desktop pane and
    # the phone already use — they are NOT renamed with the plugin id.
    bare = key[len("messenger-"):] if key.startswith("messenger-") else key
    if bare in DEVICE_LOCAL_KEYS:
        raise StateError(400, f"key '{key}' is device-local and is never synced")
    if key not in SHARED_KEYS:
        if bare in SHARED_KEYS:
            raise StateError(400, f"key '{key}': use the unprefixed name '{bare}'")
        raise StateError(400, f"unknown state key '{key}' (allowed: {', '.join(sorted(SHARED_KEYS))})")
    return key


def _check_rev(rev: Any, where: str) -> int:
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 0 or rev > MAX_REV:
        raise StateError(400, f"{where}: rev must be a non-negative integer")
    return rev


def validate_put(payload: Any) -> tuple[dict, list]:
    """Shape-check a PUT body; returns ``(keys, tombstones)`` or raises ``StateError(400)``."""
    if not isinstance(payload, dict):
        raise StateError(400, "body must be a JSON object")
    extra = set(payload) - {"keys", "tombstones", "version"}
    if extra:
        raise StateError(400, f"unexpected field(s): {', '.join(sorted(extra))}")
    keys = payload.get("keys", {})
    tombs = payload.get("tombstones", [])
    keys = {} if keys is None else keys
    tombs = [] if tombs is None else tombs
    if not isinstance(keys, dict):
        raise StateError(400, "'keys' must be an object")
    if not isinstance(tombs, list):
        raise StateError(400, "'tombstones' must be a list")
    if len(keys) > MAX_KEYS_PER_PUT:
        raise StateError(400, f"too many keys in one PUT ({len(keys)} > {MAX_KEYS_PER_PUT})")
    if len(tombs) > MAX_TOMBSTONES_PER_PUT:
        raise StateError(400, f"too many tombstones in one PUT ({len(tombs)} > {MAX_TOMBSTONES_PER_PUT})")
    clean_keys: dict = {}
    for key, item in keys.items():
        _check_key(key)
        if not isinstance(item, dict) or set(item) - {"value", "rev", "updated_at"} or "value" not in item:
            raise StateError(400, f"key '{key}': expected {{\"value\": ..., \"rev\": <int>}}")
        rev = _check_rev(item.get("rev"), f"key '{key}'")
        value = item["value"]
        if not isinstance(value, dict):
            raise StateError(400, f"key '{key}': value must be a JSON object")
        for name in value:
            if len(name) > MAX_ENTRY_NAME_CHARS:
                raise StateError(400, f"key '{key}': entry name too long")
        clean_keys[key] = {"value": value, "rev": rev}
    clean_tombs: list = []
    for i, t in enumerate(tombs):
        if not isinstance(t, dict) or set(t) - {"key", "entry", "rev"}:
            raise StateError(400, f"tombstone #{i}: expected {{\"key\", \"entry\", \"rev\"}}")
        key = _check_key(t.get("key"))
        entry = t.get("entry")
        if not isinstance(entry, str) or not entry or len(entry) > MAX_ENTRY_NAME_CHARS:
            raise StateError(400, f"tombstone #{i}: 'entry' must be a non-empty string")
        clean_tombs.append({"key": key, "entry": entry, "rev": _check_rev(t.get("rev"), f"tombstone #{i}")})
    return clean_keys, clean_tombs


# ---- merge (pure) -------------------------------------------------------------------------------

def _empty() -> dict:
    return {"version": VERSION, "keys": {}}


def _slot(state: dict, key: str) -> dict:
    return state["keys"].setdefault(key, {"entries": {}, "tombstones": {}, "updated_at": None})


def key_rev(slot: dict) -> int:
    revs = [e["rev"] for e in slot.get("entries", {}).values()]
    revs += list(slot.get("tombstones", {}).values())
    return max(revs) if revs else 0


def merge(state: dict, keys: dict, tombstones: list, *, now: Optional[float] = None) -> dict:
    """Apply a validated PUT to ``state`` in place. Returns counters (applied/ignored)."""
    stamp = _now_iso(now)
    applied = ignored = 0
    for t in tombstones:  # removals first, so "remove + same-rev re-add in one PUT" stays removed
        slot = _slot(state, t["key"])
        name, rev = t["entry"], t["rev"]
        cur = slot["entries"].get(name)
        if cur is not None and rev > cur["rev"]:
            del slot["entries"][name]
            slot["updated_at"] = stamp
            applied += 1
        elif cur is not None:
            ignored += 1
        if rev > slot["tombstones"].get(name, -1):
            slot["tombstones"][name] = rev
        if len(slot["tombstones"]) > MAX_TOMBSTONES_PER_KEY:
            keep = sorted(slot["tombstones"].items(), key=lambda kv: kv[1])[-MAX_TOMBSTONES_PER_KEY:]
            slot["tombstones"] = dict(keep)
    for key, item in keys.items():
        slot = _slot(state, key)
        rev = item["rev"]
        for name, value in item["value"].items():
            if rev <= slot["tombstones"].get(name, -1):
                ignored += 1
                continue
            cur = slot["entries"].get(name)
            if cur is None or rev > cur["rev"]:
                if cur is None or cur["value"] != value or cur["rev"] != rev:
                    slot["entries"][name] = {"value": value, "rev": rev, "updated_at": stamp}
                    slot["updated_at"] = stamp
                applied += 1
            else:
                ignored += 1
    return {"applied": applied, "ignored": ignored}


def view(state: dict) -> dict:
    """The public shape: ``{"version":1,"keys":{k:{"value":{...},"rev":n,"updated_at":iso}}}``."""
    out = {}
    for key, slot in sorted(state.get("keys", {}).items()):
        if key not in SHARED_KEYS:
            continue
        out[key] = {"value": {n: e["value"] for n, e in sorted(slot.get("entries", {}).items())},
                    "rev": key_rev(slot), "updated_at": slot.get("updated_at")}
    return {"version": VERSION, "keys": out}


# ---- persistence --------------------------------------------------------------------------------

_PLUGIN_DIR = Path(__file__).resolve().parent.parent


def state_path() -> Path:
    override = os.environ.get("MESSENGER_STATE_DIR", "").strip()
    return (Path(override) if override else _PLUGIN_DIR / "state") / "ui-state.json"


def _valid_state(raw: Any) -> dict:
    if not isinstance(raw, dict) or raw.get("version") != VERSION or not isinstance(raw.get("keys"), dict):
        raise ValueError("unexpected ui-state shape/version")
    for key, slot in raw["keys"].items():
        if not isinstance(slot, dict) or not isinstance(slot.get("entries"), dict) \
                or not isinstance(slot.get("tombstones"), dict):
            raise ValueError(f"malformed slot {key!r}")
        for e in slot["entries"].values():
            if not isinstance(e, dict) or "value" not in e or not isinstance(e.get("rev"), int):
                raise ValueError(f"malformed entry in {key!r}")
    return raw


def _quarantine(path: Path, why: str) -> None:
    bad = path.with_name(f"{path.name}.bad-{time.strftime('%Y%m%dT%H%M%S')}")
    with contextlib.suppress(OSError):
        os.replace(path, bad)
    logger.error("personae: ui-state.json was corrupt (%s); backed up to %s and starting EMPTY",
                 why, bad.name)


def load() -> dict:
    """Missing -> empty (not an error). Corrupt -> backed up to ``.bad-<ts>``, empty, loud log."""
    path = state_path()
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return _empty()
    try:
        return _valid_state(json.loads(text))
    except (ValueError, TypeError) as exc:
        with _locked():
            # re-check under the lock: another writer may already have repaired it
            try:
                return _valid_state(json.loads(path.read_text(encoding="utf-8")))
            except FileNotFoundError:
                return _empty()
            except (ValueError, TypeError):
                _quarantine(path, type(exc).__name__)
        return _empty()


_thread_lock = threading.Lock()


@contextlib.contextmanager
def _locked():
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(path.parent, 0o700)
    fd = os.open(path.with_name(".ui-state.lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        with _thread_lock:
            fcntl.flock(fd, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _write(path: Path, data: dict) -> None:
    blob = json.dumps(data, separators=(",", ":"), sort_keys=True)
    if len(blob.encode("utf-8")) > MAX_STORED_BYTES:
        raise StateError(413, "the shared state would exceed its storage cap")
    fd, tmp = tempfile.mkstemp(prefix=".ui-state.", suffix=".tmp", dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(blob)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def apply_put(payload: Any, *, now: Optional[float] = None) -> dict:
    """Validate, merge under the lock, persist atomically; returns the merged view + counters."""
    keys, tombs = validate_put(payload)
    path = state_path()
    with _locked():
        try:
            text = path.read_text(encoding="utf-8")
            state = _valid_state(json.loads(text))
        except FileNotFoundError:
            state = _empty()
        except (ValueError, TypeError) as exc:
            _quarantine(path, type(exc).__name__)
            state = _empty()
        counters = merge(state, keys, tombs, now=now)
        _write(path, state)
    return {**view(state), **counters}
