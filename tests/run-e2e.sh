#!/usr/bin/env bash
# Live end-to-end for the Personae session flow — real CLI turns, the real
# rename/search handlers, the real bizzy-talk store.
#
#   ./run-e2e.sh        # costs two model turns; leaves one ARCHIVED session
#
# The pane's OWN path is covered by ./run.sh (840 render + decision checks).
# This answers a different question: does the whole chain still work against the
# live stack — and does the backend half actually have what the pane needs
# (the /health gate at the top fails loudly if not).
set -euo pipefail
cd "$(dirname "$0")"

AGENT="${HERMES_AGENT_DIR:-$HOME/.hermes/hermes-agent}"
PY="${HERMES_PY:-$AGENT/venv/bin/python}"
SITE="$(ls -d "$AGENT"/venv/lib/python*/site-packages 2>/dev/null | head -1)"

[ -x "$PY" ] || { echo "no venv python at $PY" >&2; exit 2; }
[ -n "$SITE" ] || { echo "no venv site-packages under $AGENT/venv/lib" >&2; exit 2; }

# `-S` + an explicit PYTHONPATH on purpose: this install puts a
# `__editable__*.pth` in the venv's site-packages that drags in a
# PM-managed python3.14 environment, whose compiled wheels cannot load under the
# venv's 3.11 (pydantic_core dies with a bare ModuleNotFoundError). Skipping
# `site` keeps us on the venv's own 3.11 wheels, which is what the gateway runs.
PYTHONPATH="$SITE" exec "$PY" -S "$(pwd)/e2e_live.py"
