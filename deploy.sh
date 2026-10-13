#!/usr/bin/env bash
# Copy desktop/plugin.js into the desktop app's OWN plugins folder and print both hashes.
#
# The app loads desktop plugins from ITS OWN home --
#   <app home>/desktop-plugins/<name>/plugin.js      (%LOCALAPPDATA%\hermes\... on Windows)
# -- not from the gateway box. When the app runs on another machine, edit the
# source here and push it there:
#
#   HOST=user@box WIN_DIR='C:/Users/you/AppData/Local/hermes/desktop-plugins/personae' ./deploy.sh
#
# HOST is anything ssh can reach (an ssh alias works). WIN_DIR is that folder as
# the REMOTE machine sees it; it already exists if the app installed this plugin
# from Git. The app hot-reloads in seconds -- if it doesn't, run "Reload desktop
# plugins" from the command palette.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:?set HOST, e.g. HOST=user@box}"
WIN_DIR="${WIN_DIR:?set WIN_DIR, e.g. WIN_DIR='C:/Users/you/AppData/Local/hermes/desktop-plugins/personae'}"

SSH="ssh -o BatchMode=yes -o ConnectTimeout=8 $HOST"

scp -o BatchMode=yes -o ConnectTimeout=8 "$SRC/desktop/plugin.js" "$HOST:$WIN_DIR/plugin.js"

echo "--- local ---"
sha256sum "$SRC/desktop/plugin.js"

echo "--- remote ---"
if $SSH "command -v sha256sum >/dev/null 2>&1"; then
  $SSH "sha256sum '$WIN_DIR/plugin.js'"
else
  # Windows: certutil pads its output with blank lines and a status line. The
  # path MUST be double-quoted: cmd does not strip single quotes, so `'C:/...'`
  # reaches certutil with the quotes in it and reports "the system cannot find
  # the path specified" — while the scp above has already landed. A deploy whose
  # verification always fails is worse than none, because the hash never gets
  # compared. (Forward slashes are fine; cmd accepts them.)
  $SSH "certutil -hashfile \"$WIN_DIR/plugin.js\" SHA256"
fi
