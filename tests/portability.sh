#!/usr/bin/env bash
# Every file in this repo has to run on someone ELSE's machine: no private
# hostnames, no one machine's home directory, no tailnet or LAN addresses.
#
#   ./portability.sh        # scan the tracked tree
#
# This is not style. A deployed artefact that only works on the author's box is
# not tested by the author's own use of it — it is tested by the first stranger,
# at the worst moment. Run from tests/run.sh so every harness run enforces it.
set -uo pipefail

cd "$(dirname "$0")/.."

# This file necessarily CONTAINS the patterns it hunts for.
SELF="tests/portability.sh"

# Placeholders are the one thing a public file MAY contain: `you`, `user`,
# `hermes`, `alice`, `example` — a reader must be able to copy the command.
PLACEHOLDER='you|user|hermes|alice|example|someone'

PATTERNS=(
  '(hq-windows|smoothmarx|omarchy)'                                    # private ssh aliases / accounts
  "C:[/\\\\]Users[/\\\\](?!(${PLACEHOLDER})[/\\\\])"                        # a real Windows profile
  "(/home|/Users)/(?!(${PLACEHOLDER})/)[A-Za-z0-9._-]+/"               # a real unix home
  '(^|[^0-9])(10\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+)'
  '(^|[^0-9])100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\.[0-9]+\.[0-9]+'   # tailnet
)

# PCRE is what makes the placeholder exemptions expressible. Fail loudly if this
# grep lacks it: a check that cannot run must never report PASS (and `grep -P` plus
# `grep -E` are conflicting matchers, which grep reports on stderr and exits 2 —
# suppressed, that reads as "no leaks". The self-test caught exactly that.)
printf 'x\n' | grep -qP 'x' || { echo "FAIL  this grep has no -P (PCRE): the portability check cannot run"; exit 2; }

files=$(git ls-files | grep -v "^${SELF}$")
status=0

for pat in "${PATTERNS[@]}"; do
  hits=$(printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 grep -nPI "$pat" 2>/dev/null | grep -vE '^\s*$')
  if [ -n "$hits" ]; then
    echo "FAIL  machine-specific detail ($pat):"
    printf '%s\n' "$hits" | sed 's/^/      /'
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "PASS  no private hostnames, home paths or LAN addresses in $(printf '%s\n' "$files" | wc -l | tr -d ' ') tracked files"
else
  echo
  echo "      Move the value into the environment (HOST=… WIN_DIR=… HERMES_AGENT_DIR=…)"
  echo "      or into an untracked *.env file, and let the default be generic."
fi

exit "$status"
