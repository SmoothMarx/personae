#!/usr/bin/env bash
# vendor-markdown-text.sh — ONE authored file, TWO byte-identical copies, ONE hash that fails a build.
#
#   bash scripts/vendor-markdown-text.sh
#
# Why this exists, in one sentence: a desktop plugin is a single plain-JavaScript ESM file with no
# build step that can import neither a sibling file nor an npm package, and mobile's copy must live
# inside the mobile project (Metro bundles in-root) — so "share the code" cannot mean "one import".
# It means one AUTHORED file (`shared/markdown-text.js`), copied byte-for-byte to both surfaces, with
# the sha256 asserted in each surface's harness. That is what stops the next person from writing a
# second markdown stripper from scratch inside `plugin.js`.
#
# It does exactly three things, in this order:
#   1. copies the canonical file to <mobile>/src/logic/markdown-text.js (PERSONAE_MOBILE_DIR, default
#      ~/Projects/personae-mobile);
#   2. rewrites the block in desktop/plugin.js BETWEEN the two sentinel lines, and stamps the hash
#      into the BEGIN line;
#   3. prints all three hashes and exits non-zero if they disagree.
#
# It writes a file ONLY when its bytes are wrong, so re-running it on a clean tree changes nothing —
# a "sync" that always rewrites is a sync that will be run once and never trusted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON="$ROOT/shared/markdown-text.js"
PLUGIN="$ROOT/desktop/plugin.js"
MOBILE_DIR="${PERSONAE_MOBILE_DIR:-$HOME/Projects/personae-mobile}"
MOBILE="$MOBILE_DIR/src/logic/markdown-text.js"

[ -f "$CANON" ] || { echo "vendor-markdown-text: missing $CANON" >&2; exit 1; }
[ -f "$PLUGIN" ] || { echo "vendor-markdown-text: missing $PLUGIN" >&2; exit 1; }
[ -d "$(dirname "$MOBILE")" ] || { echo "vendor-markdown-text: mobile tree not found at $MOBILE_DIR" >&2; exit 1; }

python3 - "$CANON" "$PLUGIN" "$MOBILE" <<'PY'
import hashlib
import pathlib
import sys

canon_path, plugin_path, mobile_path = (pathlib.Path(p) for p in sys.argv[1:4])
canon = canon_path.read_bytes()
canon_sha = hashlib.sha256(canon).hexdigest()
if not canon.endswith(b"\n"):
    sys.exit("vendor-markdown-text: the canonical file must end with a newline")

BEGIN_MARK = "// \u2500\u2500 BEGIN vendored markdown-text.js".encode("utf-8")
END_LINE = "// \u2500\u2500 END vendored markdown-text.js \u2500\u2500".encode("utf-8")


def begin_line(sha: str) -> bytes:
    return (
        BEGIN_MARK
        + (
            " (sha256 " + sha + ") \u2014 edit shared/markdown-text.js, then run"
            " scripts/vendor-markdown-text.sh \u2500\u2500"
        ).encode("utf-8")
        + b"\n"
    )


def region_of(blob: bytes) -> bytes:
    begin_at = blob.find(BEGIN_MARK)
    end_at = blob.find(END_LINE)
    if begin_at < 0 or end_at < 0 or end_at < begin_at:
        sys.exit(
            "vendor-markdown-text: the sentinel pair is missing from desktop/plugin.js \u2014 add\n"
            "    // \u2500\u2500 BEGIN vendored markdown-text.js (sha256 <hash>) \u2026 \u2500\u2500\n"
            "    // \u2500\u2500 END vendored markdown-text.js \u2500\u2500\n"
            "before re-running this script."
        )
    # The region's bytes are meant to BE the canonical file: it starts right after the BEGIN line's
    # newline and ends where the END line begins (the canonical file's own trailing newline is the
    # separator), so `sha256(region) == sha256(canonical)` by construction rather than by luck.
    return blob[blob.index(b"\n", begin_at) + 1 : end_at]


# ── 2. the plugin's inlined block ────────────────────────────────────────────────────────────────
plugin = plugin_path.read_bytes()
begin_at = plugin.find(BEGIN_MARK)
region = region_of(plugin)

wrote_plugin = False
if hashlib.sha256(region).hexdigest() != canon_sha or not plugin.startswith(begin_line(canon_sha), begin_at):
    plugin = plugin[:begin_at] + begin_line(canon_sha) + canon + plugin[plugin.find(END_LINE) :]
    plugin_path.write_bytes(plugin)
    wrote_plugin = True

# ── 1. the mobile copy ──────────────────────────────────────────────────────────────────────────
mobile_bytes = mobile_path.read_bytes() if mobile_path.exists() else None
wrote_mobile = mobile_bytes != canon
if wrote_mobile:
    mobile_path.write_bytes(canon)

# ── 3. the three hashes, and the verdict ────────────────────────────────────────────────────────
inlined = region_of(plugin)
inlined_sha = hashlib.sha256(inlined).hexdigest()
mobile_sha = hashlib.sha256(mobile_path.read_bytes()).hexdigest()

print("canonical  %s  %s" % (canon_sha, canon_path))
print("mobile     %s  %s  (%s)" % (mobile_sha, mobile_path, "wrote" if wrote_mobile else "unchanged"))
print("inlined    %s  %s  (%s)" % (inlined_sha, plugin_path, "wrote" if wrote_plugin else "unchanged"))

hashes = {canon_sha, mobile_sha, inlined_sha}
if len(hashes) != 1:
    print("vendor-markdown-text: THE THREE HASHES DISAGREE \u2014 that is drift, and it is a failure", file=sys.stderr)
    sys.exit(1)
print("vendor-markdown-text: one file, two copies, three equal hashes")
PY
