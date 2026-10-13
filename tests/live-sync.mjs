
import { __internals } from './plugin.js'
const { createSync } = __internals
const base = 'http://localhost:9119/api/plugins/personae'
const B = process.env.HERMES_PERSONAE_BEARER
const rest = async (path, opts = {}) => {
  const r = await fetch(base + path, { method: opts.method || 'GET', headers: { Authorization: `Bearer ${B}`, 'Content-Type': 'application/json' }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status}: ${text}`)
  return JSON.parse(text)
}
const mem = new Map()
const storage = { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const applied = []
const s1 = createSync({ rest, storage, debounceMs: 30, apply: (k, v) => applied.push([k, v]) })
await s1.start?.()
await sleep(300)
s1.noteLocal('messenger-session-colors-v1', { 'zz-desktop': { 'sess-x': '#4c8dff' } })
await sleep(400); await s1.flush?.(); await sleep(300)
const afterDesk = await rest('/state')
console.log('desktop push -> server session-colors-v1 =', JSON.stringify(afterDesk.keys['session-colors-v1']?.value))
// (run from tests/work after ./run.sh: node ../live-sync.mjs is NOT valid; copy into work/)
// the phone writes (as the app client would: higher rev, its own entry)
const rev = (afterDesk.keys['session-colors-v1']?.rev || 0) + 1
await rest('/state', { method: 'PUT', body: { keys: { 'session-colors-v1': { value: { 'zz-phone': { 'sess-y': '#3fb950' } }, rev } }, tombstones: [] } })
const s2 = createSync({ rest, storage: { get: (k, d) => d, set: () => {} }, debounceMs: 30, apply: (k, v) => applied.push([k, v]) })
await s2.start?.(); await sleep(400)
const got = applied.filter(([k]) => String(k).includes('session-colors')).at(-1)
console.log('desktop (fresh pane) adopted =', JSON.stringify(got && got[1]))
// cleanup: tombstone both harness entries
const now = await rest('/state')
const r2 = (now.keys['session-colors-v1']?.rev || 0) + 1
await rest('/state', { method: 'PUT', body: { keys: {}, tombstones: [ { key: 'session-colors-v1', entry: 'zz-desktop', rev: r2 }, { key: 'session-colors-v1', entry: 'zz-phone', rev: r2 } ] } })
console.log('cleanup -> ', JSON.stringify((await rest('/state')).keys['session-colors-v1']?.value))
s1.dispose?.(); s2.dispose?.()
process.exit(0)
