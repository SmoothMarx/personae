#!/usr/bin/env bash
# Headless harness for the Messenger pane — renders it with react-dom/server
# and asserts on the tree. Three suites: run.mjs (render), classes.mjs (every
# Tailwind class exists in the app's own stylesheet), icons.mjs (every codicon
# name exists in the font the app pins). Run it after every edit to plugin.js.
#
#   ./run.sh          # test the current plugin.js
#
# Exits non-zero on the first failing suite tally. Uses the desktop repo's
# react/react-dom so the harness exercises the same React the app ships.
set -euo pipefail

cd "$(dirname "$0")"

# Portability first: an artefact that only runs on this machine is tested by the
# first stranger who tries it. Cheap check, and it fails the run, not the user.
if [ -x ./portability.sh ]; then
  ./portability.sh || { echo; echo "portability check failed — fix the leak above"; exit 1; }
  echo
fi

REPO="${HERMES_DESKTOP_REPO:-$HOME/.hermes/hermes-agent}"
WORK=work

rm -rf "$WORK"
mkdir -p "$WORK/node_modules/@hermes"

cp ../desktop/plugin.js "$WORK/plugin.js"
cp run.mjs "$WORK/run.mjs"
cp classes.mjs "$WORK/classes.mjs"
cp icons.mjs "$WORK/icons.mjs"
cp codicon-names.txt "$WORK/codicon-names.txt"
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

node icons.mjs
icons=$?

exit $(( render || classes || icons ))
