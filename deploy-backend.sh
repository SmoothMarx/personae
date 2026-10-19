#!/usr/bin/env bash
# Copy the BACKEND half (dashboard/*.py) into the gateway's plugin dir and print
# the hashes of what landed.
#
# The plugin is TWO files on TWO hosts:
#   desktop/plugin.js  -> the app's home (deploy.sh, scp to the Windows box)
#   dashboard/*.py     -> the gateway's home (this script, local copy)
# They ship independently, and an older backend is indistinguishable from a
# broken session ("Session not found") unless you check /health. So: deploy BOTH
# halves whenever either changes, and check /health afterwards.
#
# Delivery is copy -> RESTART: plugin API routers mount once at import, so an
# edited api.py on disk changes NOTHING until the dashboard process re-imports
# it. That restart is the one step this script must not take for you — agent
# sessions run inside hermes-serve.service, and restarting it kills them.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DEST:-$HOME/.hermes/plugins/personae/dashboard}"

if [ ! -d "$DEST" ]; then
  echo "no plugin dir at $DEST" >&2
  exit 2
fi

for f in "$SRC"/dashboard/*.py; do
  base="$(basename "$f")"
  if cmp -s "$f" "$DEST/$base"; then
    printf '%-20s unchanged  %s\n' "$base" "$(sha256sum "$f" | cut -d' ' -f1)"
    continue
  fi
  cp "$f" "$DEST/$base"
  printf '%-20s updated    %s\n' "$base" "$(sha256sum "$DEST/$base" | cut -d' ' -f1)"
done

# The compiled cache is stale the moment the source moves, and a stale .pyc with
# a matching mtime has burned this before (it makes an "edited" file look
# unedited to the next import).
find "$DEST/__pycache__" -name '*.pyc' -delete 2>/dev/null || true

echo
echo "restart the dashboard so the router re-imports (kills live agent sessions):"
echo "  systemctl --user restart hermes-serve"
echo "then check:  curl -s localhost:9119/api/plugins/personae/health   # expect \"title\": true"
