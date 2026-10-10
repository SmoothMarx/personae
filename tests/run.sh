#!/usr/bin/env bash
# Headless harness for the Messenger pane — renders it with react-dom/server
# and asserts on the tree. Run it after every edit to plugin.js.
#
#   ./run.sh          # test the current plugin.js
#
# Exits non-zero on the first failing suite tally. Uses the desktop repo's
# react/react-dom so the harness exercises the same React the app ships.
set -euo pipefail

cd "$(dirname "$0")"

REPO="${HERMES_DESKTOP_REPO:-$HOME/.hermes/hermes-agent}"
WORK=work

rm -rf "$WORK"
mkdir -p "$WORK/node_modules/@hermes"

cp ../plugin.js "$WORK/plugin.js"
cp run.mjs "$WORK/run.mjs"
cp classes.mjs "$WORK/classes.mjs"
printf '{ "type": "module" }\n' >"$WORK/package.json"

# tests/sdk stands in for @hermes/plugin-sdk; react + react-dom come from the repo.
ln -sfn ../../../sdk "$WORK/node_modules/@hermes/plugin-sdk"
ln -sfn "$REPO/node_modules/react" "$WORK/node_modules/react"
ln -sfn "$REPO/node_modules/react-dom" "$WORK/node_modules/react-dom"

# Node resolves the sdk through its REAL path (tests/sdk), so its own imports
# need react to be reachable from here too.
mkdir -p node_modules
ln -sfn "$REPO/node_modules/react" node_modules/react
ln -sfn "$REPO/node_modules/react-dom" node_modules/react-dom

for dep in react react-dom; do
  [ -e "$WORK/node_modules/$dep" ] || {
    echo "missing $REPO/node_modules/$dep" >&2
    exit 2
  }
done

cd "$WORK"

node run.mjs
render=$?

HERMES_DESKTOP_SRC="${HERMES_DESKTOP_SRC:-$REPO/apps/desktop/src}" node classes.mjs
classes=$?

exit $(( render || classes ))
