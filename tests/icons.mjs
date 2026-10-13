/**
 * Codicon-existence check for the Personae pane.
 *
 * WHY: the same failure mode classes.mjs guards, one layer down. A Codicon
 * renders as `<i class="codicon codicon-<name>">` and the glyph comes out of a
 * font file, so a name the font does not carry paints NOTHING — no error, no
 * warning, just an empty slot beside the label, which the user reads as "this
 * option has no icon" instead of as a bug. Core has already been bitten by this
 * exact thing: `git-fork` is not in the font and `repo-forked` is (see
 * app/chat/sidebar/session-actions-menu.tsx, and the comment on the Branch verb
 * in plugin.js).
 *
 * Rule: every codicon name this pane asks for must be in codicon-names.txt, a
 * snapshot of the font's own stylesheet at the version the app pins
 * (@vscode/codicons 0.0.45 — apps/desktop/package.json). Refresh it with:
 *
 *   curl -s https://unpkg.com/@vscode/codicons@0.0.45/dist/codicon.css \
 *     | grep -o '\.codicon-[a-z0-9-]*:before' \
 *     | sed 's/^\.codicon-//; s/:before$//' | sort -u > tests/codicon-names.txt
 *
 * Run from ./work (run.sh copies the plugin, this file, and the name list in),
 * reads ./plugin.js — the same file the app loads. Uses no app source.
 */

import { readFileSync } from 'node:fs'

const PLUGIN = './plugin.js'
const font = new Set(readFileSync('./codicon-names.txt', 'utf8').split(/\s+/).filter(Boolean))
const source = readFileSync(PLUGIN, 'utf8')

/** Every `jsx(Codicon, { … })` props object, read to its MATCHING brace: the
 *  name can be a literal or the two branches of a ternary, and a naive
 *  everything-up-to-the-next-`}` scan would cut a nested object in half. */
function codiconProps() {
  const bodies = []

  for (let at = source.indexOf('jsx(Codicon'); at >= 0; at = source.indexOf('jsx(Codicon', at + 1)) {
    const open = source.indexOf('{', at)
    let depth = 0

    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') {
        depth += 1
      } else if (source[i] === '}') {
        depth -= 1

        if (depth === 0) {
          bodies.push(source.slice(open, i))
          break
        }
      }
    }
  }

  return bodies
}

const names = new Set()

for (const body of codiconProps()) {
  const prop = body.match(/name:\s*([^,}]*)/)

  for (const literal of prop ? prop[1].matchAll(/'([^']+)'/g) : []) {
    names.add(literal[1])
  }
}

// The three indirections, named one by one rather than by a loose "any string
// near the word icon" rule, which would sweep up class names and labels too:
// entry tables (`icon: 'trash'` in the group menus), the roster tone map (the
// only glyph name this pane reaches through a lookup), and the session pop-up's
// own helper, which takes the name as its first argument.
for (const match of source.matchAll(/\bicon:\s*'([^']+)'/g)) {
  names.add(match[1])
}

const tone = source.match(/const TONE_ICON = \{([\s\S]*?)\}/)

for (const match of tone ? tone[1].matchAll(/'([^']+)'/g) : []) {
  names.add(match[1])
}

for (const match of source.matchAll(/menuGlyph\(\s*'([^']+)'/g)) {
  names.add(match[1])
}

const asked = [...names].sort()
const missing = asked.filter(name => !font.has(name))

console.log(`\ncodicon check: ${asked.length - missing.length}/${asked.length} glyph names exist in the font the app ships`)

if (missing.length) {
  console.log(
    `FAIL  names @vscode/codicons 0.0.45 cannot draw (they paint nothing at all):\n        ${missing.join('\n        ')}`
  )
  process.exit(1)
}

console.log('PASS  every glyph this pane asks for is in the font')
