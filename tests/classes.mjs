/**
 * CSS-class existence check for the Messenger pane.
 *
 * WHY: a desktop plugin is loaded at RUNTIME, long after the app was built. The
 * compiled stylesheet only contains the Tailwind utilities the app's own build
 * scanned out of its source. A utility the plugin invents (e.g. `size-[18px]`,
 * valid Tailwind, used nowhere in core) simply does not exist in the CSS — so it
 * silently does nothing and the pane renders unstyled. Layout still "works",
 * which is exactly why nobody notices until something looks wrong.
 *
 * Rule: every class token in a `className` must already occur somewhere in the
 * app's source. Run from ./work, reads ./plugin.js (the same file the app
 * loads). Uses $HERMES_DESKTOP_SRC for the core source tree.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC =
  process.env.HERMES_DESKTOP_SRC || (process.env.HOME || '') + '/.hermes/hermes-agent/apps/desktop/src'
const PLUGIN = './plugin.js'
/** Theme variables and design tokens are not Tailwind utilities. */
const ALLOW = new Set(['cn'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue
      }

      walk(full, out)
    } else if (/\.(tsx|ts|jsx|js|css|html)$/.test(entry.name)) {
      out.push(full)
    }
  }

  return out
}

const coreSource = walk(SRC)
  .map(file => readFileSync(file, 'utf8'))
  .join('\n')

const pluginSource = readFileSync(PLUGIN, 'utf8')

// Every `className: ...` expression, then the string literals inside it.
const classExpressions = [...pluginSource.matchAll(/className:\s*((?:[^()\n]|\([^()\n]*\))*)/g)].map(m => m[1])
const tokens = new Set()

for (const expression of classExpressions) {
  for (const literal of expression.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const value = literal[1] ?? literal[2] ?? ''

    if (value.includes('${')) {
      continue
    }

    for (const token of value.split(/\s+/)) {
      if (token && !ALLOW.has(token)) {
        tokens.add(token)
      }
    }
  }
}

const missing = [...tokens].filter(token => !coreSource.includes(token)).sort()

console.log(`\nclass check: ${tokens.size - missing.length}/${tokens.size} class tokens exist in the app's stylesheet`)

if (missing.length) {
  console.log(`FAIL  classes the app never compiled (they do nothing):\n        ${missing.join('\n        ')}`)
  process.exit(1)
}

console.log('PASS  every class token is one the app already ships')
