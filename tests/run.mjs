/**
 * Headless harness for the Personae pane (P1c + P4 + P5). Copied into ./work
 * by run.sh so that Node resolves `@hermes/plugin-sdk` and `react*` the way the
 * desktop app does. Renders the pane through react-dom/server and asserts on
 * the TREE — plus the pure decision layer through the plugin's `__internals`
 * seam, since a static render has no DOM to type a search into.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { jsx } from 'react/jsx-runtime'

import plugin, { __internals, stripMarkdown } from './plugin.js'
import { harness, host } from '@hermes/plugin-sdk'

/** 0.12.0: the sha256 of `shared/markdown-text.js`, which is ALSO the sha256 of the block inlined
 *  into `desktop/plugin.js` between the two sentinels, and of the phone's vendored copy
 *  (`personae-mobile/src/logic/markdown-text.js`). One authored file, two byte-identical copies, and
 *  this one constant is what fails the build on drift. Regenerate it by running
 *  `scripts/vendor-markdown-text.sh`, which prints it. */
const MARKDOWN_TEXT_SHA256 = 'd68979838c656d2d0e570495e815c088d3e7cd7f59ded38193a9f8f6cdc1a0da'

const h = harness()
const results = []
const check = (name, ok, detail = '') => {
  results.push({ detail, name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`)
}

/** Where a menu label starts in the markup, with or without a `<span>` around
 *  it. An option's label is a bare text node only while the row has no icon;
 *  once it carries one it is `>Rename…</span>` (the shape core's own
 *  `renderActionItem` uses). Anchoring a check on `>Rename…<` therefore breaks
 *  the day the row gains a glyph — the wrapper was never the subject. */
const labelAt = (html, label) => {
  const wrapped = html.indexOf(`>${label}</span>`)
  const bare = html.indexOf(`>${label}<`)

  if (wrapped < 0) return bare
  if (bare < 0) return wrapped

  return Math.min(wrapped, bare)
}
const menuLabel = (html, label) => labelAt(html, label) >= 0

/** The glyph an option carries: the nearest `data-codicon` BEFORE its label.
 *  Every row here draws exactly one, and nothing draws one after a label, so
 *  the closest preceding glyph is the row's own. */
const glyphFor = (html, label) => {
  const at = labelAt(html, label)

  if (at < 0) return null

  const hits = [...html.slice(0, at).matchAll(/data-codicon="([^"]+)"/g)]

  return hits.length ? hits[hits.length - 1][1] : null
}

/** `label` sits inside a submenu TRIGGER rather than in an item: the trigger's
 *  own slot, its glyph, then the label, all inside one short window. */
const isSubmenuTrigger = (html, label) => {
  const slot = 'data-slot="context-menu-sub-trigger"'

  for (let at = html.indexOf(slot); at >= 0; at = html.indexOf(slot, at + 1)) {
    if (labelAt(html.slice(at, at + 260), label) >= 0) return true
  }

  return false
}

// ── fixtures ────────────────────────────────────────────────────────────────

const nowSec = Math.floor(Date.now() / 1000)
const AVATAR_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

const ROSTER = {
  profiles: [
    {
      name: 'zulu',
      display_name: 'Zulu',
      is_default: false,
      has_avatar: true,
      ui_meta: {},
      last_session: {
        id: 'sess-zulu-1',
        preview: 'refactored the flux capacitor',
        message_count: 42,
        last_active: nowSec - 300
      },
      worker_session: { last_active: nowSec - 10 }
    },
    {
      name: 'default',
      display_name: 'Crabby',
      is_default: true,
      has_avatar: false,
      ui_meta: {},
      last_session: { id: 'sess-default-1', preview: 'roster work', message_count: 7, last_active: nowSec - 3 * 3600 }
    },
    {
      name: 'ghost',
      display_name: 'Ghost',
      is_default: false,
      has_avatar: false,
      ui_meta: { messenger: { hidden: true } },
      last_session: null
    }
  ]
}

h.responses['profiles.list'] = () => ROSTER
h.responses['profiles.get_asset'] = () => ({ data: AVATAR_DATA_URL })

/** `session.list {profile}` resolves that profile's own state.db server-side
 *  (`_profile_db(params)`), so the harness answers from the same per-profile map
 *  `host.listPersistedSessions` reads. */
h.responses['session.list'] = ({ profile }) => {
  const entry = h.sessions.byProfile?.[profile]

  if (entry instanceof Error) {
    throw entry
  }

  return entry || { sessions: [] }
}

h.sessions.byProfile = {
  zulu: {
    sessions: [
      {
        id: 'sess-zulu-9',
        title: 'Flux capacitor retro',
        preview: 'we rewound it',
        source: 'telegram',
        last_active: nowSec - 90
      },
      {
        id: 'sess-zulu-8',
        title: 'unrelated',
        preview: 'nothing to see',
        source: 'desktop',
        last_active: nowSec - 9000
      }
    ]
  },
  default: new Error('no store'),
  ghost: { sessions: [] }
}

// ── 1. registration ─────────────────────────────────────────────────────────

const contributions = []
const ctx = {
  i18n: { register: bundle => Object.assign(h.i18n, bundle.en) },
  register: c => contributions.push(c),
  storage: {
    get: (key, fallback) => (key in h.storage ? h.storage[key] : fallback),
    set: (key, value) => {
      h.storage[key] = value
    }
  },
  /** The plugin's own backend (`/api/plugins/personae`), which is the only
   *  door to message bodies the SDK leaves open. `h.rest.byProfile` answers. */
  rest: async (path, options = {}) => {
    h.rest.calls.push(path)

    // A WRITE (method + body) is recorded separately: `calls` is asserted as bare
    // paths all over this suite, and a POST is a different animal from a read.
    if (options && options.method) {
      h.rest.writes = [...(h.rest.writes || []), { body: options.body, method: options.method, path }]
    }

    const profile = options?.body?.profile ?? new URLSearchParams(String(path).split('?')[1] || '').get('profile')
    const entry = h.rest.byProfile?.[profile]

    if (entry instanceof Error) {
      throw entry
    }

    return entry || { results: [] }
  }
}

plugin.register(ctx)

check('plugin id is the folder name', plugin.id === 'personae', `got ${plugin.id}`)
check(
  'three contributions: the roster pane, Scheduled jobs and Files',
  contributions.length === 3 && contributions.every(c => c.area === 'panes'),
  contributions.map(c => c.id).join(', '),
  contributions.map(c => c.id).join(', ')
)

const pane = contributions[0] || {}

check('contribution area is "panes"', pane.area === 'panes', `got ${pane.area}`)
check('tab label is "Personae"', pane.title === 'Personae', `got ${pane.title}`)
check(
  'placement is left / 280px',
  pane.data?.placement === 'left' && pane.data?.width === '280px',
  JSON.stringify(pane.data)
)
check(
  'storage was read for the group + toast prefs',
  h.i18n.paneTitle === 'Personae' && typeof ctx.storage.get === 'function',
  'loadPrefs() runs at register() and must not throw without a stored value'
)

// ── 2. loading state ────────────────────────────────────────────────────────

const render = () => renderToStaticMarkup(pane.render())

let markup = render()

// 3 skeleton rows, each: avatar box (real row geometry) + 2 text lines.
check('loading paints skeletons', (markup.match(/data-slot="skeleton"/g) || []).length === 9)
check(
  'skeleton avatar uses the real row geometry (52px)',
  markup.includes('height:52px;width:52px'),
  markup.match(/style="[^"]*"/g)?.slice(0, 3).join(' ')
)
check('loading paints no rows', !markup.includes('data-profile='))

// ── 3. the queries the pane opens ───────────────────────────────────────────

const rosterQuery = h.queries.find(q => (q.queryKey || []).join('|') === 'personae|roster') || {}
const searchQuery = h.queries.find(q => (q.queryKey || [])[0] === 'personae' && q.queryKey[1] === 'search') || {}

check('roster query key is namespaced', Boolean(rosterQuery.queryKey), JSON.stringify(rosterQuery.queryKey))
check('roster polls every 5s', rosterQuery.refetchInterval === 5000, `got ${rosterQuery.refetchInterval}`)
check('exactly one search query (never one hook per profile)', h.queries.filter(q => (q.queryKey || [])[1] === 'search').length === 1)
check('search is disabled until the needle is long enough', searchQuery.enabled === false, `got ${searchQuery.enabled}`)

const rows = await rosterQuery.queryFn()

check('hidden profiles are dropped', rows.length === 2, `got ${rows.map(r => r.name).join(',')}`)
check('default profile sorts first', rows[0]?.name === 'default', `got ${rows[0]?.name}`)
check('remaining profiles sort alphabetically', rows[1]?.name === 'zulu', `got ${rows[1]?.name}`)
check(
  'seconds → ms conversion',
  rows[0]?.lastActiveMs === (nowSec - 3 * 3600) * 1000,
  `got ${rows[0]?.lastActiveMs}`
)
check('fresh worker heartbeat marks "working"', rows[1]?.working === true)
check('quiet profile is not "working"', rows[0]?.working === false)
check('active window is the rail\'s 90s', rows[1]?.active === true && rows[0]?.active === false)
check('the row carries the session id core keys live state by', rows[1]?.sessionId === 'sess-zulu-1', `got ${rows[1]?.sessionId}`)

const listCall = h.requests.find(r => r.method === 'profiles.list') || {}

check('roster asks for sessions', listCall.params?.include_sessions === true, JSON.stringify(listCall.params))

// ── 4. watermark → unread (the status-light feed) ───────────────────────────

check('the first poll only seeds (nothing marked unread)', h.unread.length === 0, JSON.stringify(h.unread))

h.responses['profiles.list'] = () => ({
  profiles: ROSTER.profiles.map(profile =>
    profile.name === 'zulu'
      ? { ...profile, last_session: { ...profile.last_session, last_active: nowSec - 10 } }
      : profile
  )
})

await rosterQuery.queryFn()

check(
  'an advanced last_active marks that session unread, keyed by profile',
  h.unread.length === 1 && h.unread[0].id === 'sess-zulu-1' && h.unread[0].profile === 'zulu',
  JSON.stringify(h.unread)
)

h.responses['profiles.list'] = () => ({
  profiles: ROSTER.profiles.map(profile =>
    profile.is_default ? { ...profile, last_session: { ...profile.last_session, last_active: nowSec - 5 } } : profile
  )
})

await rosterQuery.queryFn()

check('the profile you are ON is never marked unread', h.unread.length === 1, JSON.stringify(h.unread))
check('toasts stay silent while the bell is off', h.toasts.length === 0, JSON.stringify(h.toasts))

// ── 5. data state ───────────────────────────────────────────────────────────

h.responses['profiles.list'] = () => ROSTER
h.queryResults['personae|roster'] = { data: rows, error: null, isError: false, isPending: false }
h.queryResults['personae|avatar|zulu'] = { data: { data: AVATAR_DATA_URL }, error: null, isError: false, isPending: false }

markup = render()

const rowNames = [...markup.matchAll(/data-profile="([^"]+)"/g)].map(m => m[1])

// The default order is a real sort now — "Last activity" (P9, §14) — not the
// order the roster happened to arrive in. The fixture's zulu moved last, so it
// leads; the name tiebreak keeps ties stable between polls.
check('one row per visible profile, newest activity first', rowNames.join(',') === 'zulu,default', rowNames.join(','))
check(
  "current profile row uses the rail's active-row background",
  /data-profile="default"[\s\S]{0,400}ui-row-active-background/.test(markup)
)
check('the roster size is reported', markup.includes('2/2 profiles'), markup.match(/\d+\/\d+ profiles/g)?.join(',') || 'none')
check('avatar image is used when the profile has one', markup.includes(AVATAR_DATA_URL))
check('avatar image count is 1, not per row', (markup.match(/<img/g) || []).length === 1)
check('profile without an avatar falls back to an initial chip', markup.includes('>C<'), markup.slice(0, 400))
check(
  'default profile chip uses the neutral tone (profileColor contract: null for default)',
  !/data-profile="default"[\s\S]{0,900}?hsl\(120/.test(markup)
)
check('last-session preview is rendered', markup.includes('refactored the flux capacitor'))
check('age label uses the sidebar convention (5m)', markup.includes('>5m<'), markup.match(/>\d+[smhd]</g)?.join(',') || 'none')

// ── 6. the status dot's PLACE (bot-row.tsx parity) ──────────────────────────

// A row's own box: from its `data-profile=` to the next one (or the end). Without
// the end bound the slice of the FIRST row swallows every later row, which made
// row-scoped assertions pass or fail on sort order rather than on the row.
const rowSlice = name => {
  const rest = markup.slice(markup.indexOf(`data-profile="${name}"`))
  const end = rest.indexOf('data-profile="', 1)

  return end < 0 ? rest : rest.slice(0, end)
}
const zuluRow = rowSlice('zulu')
const defaultRow = rowSlice('default')
const DETAILS = 'text-xs text-(--ui-text-tertiary)'

check(
  'row box keeps the rail gutters but is a step taller (gap-2.5 px-2 py-2.5)',
  /\bclass="[^"]*\bgap-2\.5\b[^"]*\bpx-2\b[^"]*\bpy-2\.5\b[^"]*"/.test(zuluRow) &&
    /class="[^"]*\bgap-2\.5\b[^"]*\bpx-2\b[^"]*\bpy-2\.5\b[^"]*"/.test(defaultRow),
  zuluRow.slice(0, 200)
)
check(
  'avatar is bigger than the BotFace box (52px, 22% radius, display:block)',
  /style="[^"]*border-radius:22%[^"]*height:52px[^"]*width:52px[^"]*"/.test(markup) &&
    /<img[^>]*display:block/.test(markup),
  markup.match(/<img[^>]*>/g)?.join(' ')
)
check(
  'name is set bigger than the rail (15px, "make it bigger")',
  zuluRow.includes('font-size:15px') && zuluRow.includes('font-medium'),
  zuluRow.slice(0, 240)
)
check('the row carries the rail hover class', zuluRow.includes('hover:bg-(--chrome-action-hover)'))
check('the row is a real button (RowButton), not a div', /<button[^>]*type="button"/.test(zuluRow))
// 2026-10-09 chrome pass: the stage tip is gone and the roster size moved out
// of its own footer line up beside the pane title.
check('the stage tip no longer renders', !markup.includes('Search covers profile names'), markup.slice(-160))
check(
  'the roster size sits beside the title, before the bell',
  markup.indexOf('2/2 profiles') > -1 && markup.indexOf('2/2 profiles') < markup.indexOf('Activity toasts'),
  markup.slice(0, 300)
)

// One dot per row, inside the lead cell, on the NAME line. Since P8b the pane
// paints its OWN aggregate dot as soon as the poll has data (three polls have
// run by now), so the cell here is the pane's — core's `SessionStatusDot`, bound
// to the profile's stored session id, is only the pre-poll placeholder (§6b
// proves that fallback on a cleared store). Idle in this fixture: §6c is what
// exercises the lit states.
check(
  'the dot sits in the lead cell before the name (line 1)',
  zuluRow.indexOf('data-slot="sidebar-row-lead"') > -1 &&
    zuluRow.indexOf('data-profile-dot=') < zuluRow.indexOf('Zulu'),
  zuluRow.slice(0, 400)
)
check(
  "the pane's own dot is per row, and idle while nothing awaits him",
  zuluRow.includes('data-profile-dot="idle"') && defaultRow.includes('data-profile-dot="idle"'),
  (markup.match(/data-profile-dot="[^"]*"/g) || []).join(' ')
)
const detailsSlice = zuluRow.slice(zuluRow.indexOf(DETAILS))

check('no dot on the details line (that was P1b, now reverted)', !detailsSlice.includes('session-status-dot'))
check('the age stays on the name line', zuluRow.indexOf('>5m<') < zuluRow.indexOf(DETAILS), zuluRow.slice(0, 300))
check(
  'the preview line takes no flex-1 (it only existed to park the dot)',
  !/class="[^"]*flex-1[^"]*"[^>]*>refactored the flux capacitor/.test(zuluRow)
)

// ── 6b. the profile dot is an AGGREGATE of its sessions (P8b) ───────────────
// The row's dot used to be core's dot for the profile's LATEST session alone, so
// answering that one silenced the row while a second session still waited. Pedro,
// 2026-10-10: "when the latest session has been resolved, the profile dot goes
// silent, but there's still another session awaiting interaction. is it possible
// for the statusdot to show that instead?" These pin the aggregate: the loudest
// state wins, it stays lit while ANY session holds it, and the badge counts what
// awaits him behind it (§6c narrows the count to waiting + unread).

const roll = __internals.rosterRollups(
  {
    alpha: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3', unread: true }],
    bravo: [{ id: 'b1', unread: true }]
  },
  { a1: 'waiting', a2: 'working' }
)

check(
  "the aggregate takes the LOUDEST state, not the latest session's",
  roll.alpha.state === 'needs-input',
  JSON.stringify(roll.alpha)
)
check(
  'the count is what AWAITS him — waiting + unread — not every live session',
  roll.alpha.count === 2,
  JSON.stringify(roll.alpha)
)
check(
  'the per-bucket split still carries working, for the tooltip',
  JSON.stringify(roll.alpha.counts) === '{"needs-input":1,"unread":1,"working":1}',
  JSON.stringify(roll.alpha.counts)
)
check(
  'one unread session is enough to light the row (emerald)',
  roll.bravo.state === 'unread' && roll.bravo.count === 1,
  JSON.stringify(roll.bravo)
)

// The user's own scenario: two sessions waiting, then the newest is answered.
const halfAnswered = __internals.rosterRollups(
  { alpha: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3', unread: true }] },
  { a2: 'waiting' }
)

check(
  'answering the newest blocked session leaves the row lit for the other one',
  halfAnswered.alpha.state === 'needs-input' && halfAnswered.alpha.count === 2,
  JSON.stringify(halfAnswered.alpha)
)
check(
  'nothing waiting, working or unread is idle — the fallback dot draws',
  (() => {
    const quiet = __internals.rosterRollups({ alpha: [{ id: 'a1' }, { id: 'a2' }] }, { a1: 'idle' })

    return quiet.alpha.state === 'idle' && quiet.alpha.count === 0
  })()
)
check(
  'a stored id two profiles both claim is dropped, never painted twice',
  (() => {
    const shared = __internals.rosterRollups(
      { alpha: [{ id: 'dup' }], bravo: [{ id: 'dup', unread: true }] },
      { dup: 'waiting' }
    )

    return shared.alpha.state === 'idle' && shared.bravo.state === 'idle'
  })()
)
check(
  'live rows map by the STORED id (session_key), never the runtime id',
  JSON.stringify(
    __internals.liveStatusMap([
      { session_id: 'rt-1', session_key: 'st-1', status: 'waiting' },
      { session_id: 'rt-2' }
    ])
  ) === '{"st-1":"waiting"}',
  JSON.stringify(
    __internals.liveStatusMap([
      { session_id: 'rt-1', session_key: 'st-1', status: 'waiting' },
      { session_id: 'rt-2' }
    ])
  )
)
check(
  "the live statuses that mean a running turn are the gateway's own",
  __internals.LIVE_WORKING.has('working') &&
    __internals.LIVE_WORKING.has('streaming') &&
    !__internals.LIVE_WORKING.has('waiting')
)

// The wiring: the roster poll reads BOTH sources and writes the dots. The rows
// come from `host.listPersistedSessions` — the direct `state.db` read that still
// carries `unread` — so the harness answers through `h.sessions.byProfile`.
const savedByProfile = h.sessions.byProfile

// The per-profile row read is cached across polls (see dotListCache), so each
// scenario here starts from a cold cache — otherwise the second poll would
// answer from the first one's rows and prove nothing.
__internals.dotListCache.clear()

h.sessions.byProfile = {
  default: { sessions: [] },
  zulu: { sessions: [{ id: 'sess-zulu-9' }, { id: 'sess-zulu-8' }] }
}
h.responses['session.active_list'] = () => ({
  sessions: [
    { session_id: 'rt-9', session_key: 'sess-zulu-9', status: 'waiting' },
    { session_id: 'rt-8', session_key: 'sess-zulu-8', status: 'waiting' }
  ]
})

await rosterQuery.queryFn()

check(
  'the roster poll writes the aggregate dot per profile',
  __internals.$profileDots.get().zulu?.state === 'needs-input' && __internals.$profileDots.get().zulu?.count === 2,
  JSON.stringify(__internals.$profileDots.get())
)

// The load guard: a profile that has not moved must not be re-read on the next
// tick. Two extra polls of an unchanged roster may not add a single row read.
const zuluReads = () => h.sessions.calls.filter(call => call.options?.profile === 'zulu').length
const readsBefore = zuluReads()

await rosterQuery.queryFn()

check(
  'an unchanged profile is not re-read on the next tick (the dot read is cached)',
  zuluReads() === readsBefore,
  `${readsBefore} reads → ${zuluReads()}`
)

markup = render()

check(
  "the profile row paints the AGGREGATE dot, not core's single-session one",
  rowSlice('zulu').includes('data-profile-dot="needs-input"') &&
    rowSlice('zulu').indexOf('data-profile-dot="needs-input"') < rowSlice('zulu').indexOf('Zulu'),
  rowSlice('zulu').slice(0, 400)
)
check(
  'the badge counts how many sessions are behind the dot',
  rowSlice('zulu').includes('data-profile-dot-count="2"'),
  rowSlice('zulu').slice(0, 400)
)

// One of the two is answered: the row must STAY lit, with the count down to one.
h.responses['session.active_list'] = () => ({
  sessions: [{ session_id: 'rt-9', session_key: 'sess-zulu-9', status: 'waiting' }]
})

await rosterQuery.queryFn()
markup = render()

check(
  '…and it stays lit once one is answered (the whole point)',
  rowSlice('zulu').includes('data-profile-dot="needs-input"') && __internals.$profileDots.get().zulu?.count === 1,
  JSON.stringify(__internals.$profileDots.get())
)
check(
  'a lone session behind the dot shows no badge — "1" only repeats the dot',
  !rowSlice('zulu').includes('data-profile-dot-count'),
  rowSlice('zulu').slice(0, 400)
)

// The restart case: no live runtime left, so the only surviving signal is the
// persisted `unread` flag on the profile's own rows.
__internals.dotListCache.clear()
h.responses['session.active_list'] = () => ({ sessions: [] })
h.sessions.byProfile = { default: { sessions: [] }, zulu: { sessions: [{ id: 'sess-zulu-9', unread: true }] } }

await rosterQuery.queryFn()
markup = render()

check(
  'a profile whose unread flag survived (no live runtime) still lights emerald',
  rowSlice('zulu').includes('data-profile-dot="unread"') && __internals.$profileDots.get().zulu?.count === 1,
  JSON.stringify(__internals.$profileDots.get())
)

h.sessions.byProfile = savedByProfile
delete h.responses['session.active_list']
__internals.$profileDots.set({})

markup = render()

check(
  "with no aggregate to paint, the row falls back to core's own dot",
  rowSlice('zulu').includes('data-slot="session-status-dot"') && !rowSlice('zulu').includes('data-profile-dot'),
  rowSlice('zulu').slice(0, 400)
)
check(
  "…and the fallback is still bound to the profile's stored session id",
  rowSlice('zulu').includes('data-stored-session-id="sess-zulu-1"')
)

// ── 6c. blue is a SESSION colour, never a profile one (P8b follow-up) ──────
// Pedro, 2026-10-11, verbatim: "go, drop blue (from profile, keep in session
// statusdot)" — and the rule he gave with it: "It should show unread status,
// with priority first. so if there is a green and an orange, the orange is shown
// first (and the number 2), until it is read, then it should go green (the
// number disappears). and once that one is read, it should not show a color at
// all, as all have been read. If there are two green, it should show green and
// the number 2. when the first one is read, the dot remains green, but the
// number disappears."
//
// So the badge counts what AWAITS him — waiting + unread — and a session that is
// merely RUNNING is counted by neither and paints nothing. That is the reported
// bug: answering a blocked session RESUMES its turn, so it goes waiting →
// working, and the old rollup counted the resumed one too, which is why "after
// one got solved, the number '2' didn't disappear".
check(
  'the per-SESSION dot keeps blue — only the profile aggregate drops it',
  __internals.dotStateFor('working', false) === 'working',
  __internals.dotStateFor('working', false)
)

// The render half needs the poll, so it drives the same wiring §6b does.
const snooze = async (rows, liveRows) => {
  __internals.dotListCache.clear()
  h.sessions.byProfile = { default: { sessions: [] }, zulu: { sessions: rows } }
  h.responses['session.active_list'] = () => ({ sessions: liveRows })

  await rosterQuery.queryFn()

  return render()
}

// A running session paints NOTHING on the profile — no blue, no count — and in
// particular the row must not fall back to core's per-session dot, which would
// put the blue straight back on it.
markup = await snooze([{ id: 'sess-zulu-9' }, { id: 'sess-zulu-8' }], [
  { session_id: 'rt-8', session_key: 'sess-zulu-8', status: 'working' }
])

check(
  'a session that is only RUNNING paints no blue on the profile row',
  rowSlice('zulu').includes('data-profile-dot="idle"') &&
    !rowSlice('zulu').includes('data-slot="session-status-dot"'),
  rowSlice('zulu').slice(0, 400)
)
check(
  '…and it adds nothing to the count',
  __internals.$profileDots.get().zulu?.count === 0 &&
    !rowSlice('zulu').includes('data-profile-dot-count'),
  JSON.stringify(__internals.$profileDots.get().zulu)
)

// One waiting + one running: amber, and NO badge — the running session is not a
// second thing awaiting him.
markup = await snooze([{ id: 'sess-zulu-9' }, { id: 'sess-zulu-8' }], [
  { session_id: 'rt-9', session_key: 'sess-zulu-9', status: 'waiting' },
  { session_id: 'rt-8', session_key: 'sess-zulu-8', status: 'working' }
])

check(
  'waiting + running is ONE thing awaiting him, so there is no badge',
  rowSlice('zulu').includes('data-profile-dot="needs-input"') &&
    !rowSlice('zulu').includes('data-profile-dot-count'),
  rowSlice('zulu').slice(0, 400)
)

// His exact green sequence.
markup = await snooze([{ id: 'sess-zulu-9', unread: true }, { id: 'sess-zulu-8', unread: true }], [])

check(
  'two unread sessions: emerald and the number 2',
  rowSlice('zulu').includes('data-profile-dot="unread"') &&
    rowSlice('zulu').includes('data-profile-dot-count="2"'),
  rowSlice('zulu').slice(0, 400)
)

markup = await snooze([{ id: 'sess-zulu-9', unread: true }], [])

check(
  'read one of two: the dot stays emerald, the number disappears',
  rowSlice('zulu').includes('data-profile-dot="unread"') &&
    !rowSlice('zulu').includes('data-profile-dot-count'),
  rowSlice('zulu').slice(0, 400)
)

markup = await snooze([{ id: 'sess-zulu-9' }, { id: 'sess-zulu-8' }], [])

check(
  'all read: no colour at all',
  rowSlice('zulu').includes('data-profile-dot="idle"') &&
    !rowSlice('zulu').includes('data-profile-dot-count'),
  rowSlice('zulu').slice(0, 400)
)

// Hand the fixtures back the way §7 expects to find them.
h.sessions.byProfile = savedByProfile
delete h.responses['session.active_list']
__internals.dotListCache.clear()
__internals.$profileDots.set({})

markup = render()

// ── 7. toolbar (bell · + · folder+ · search · filter) ───────────────────────

check('a bell is in the toolbar', markup.includes('data-codicon="bell-slash"'), markup.match(/data-codicon="[^"]*"/g)?.join(' '))
check('the bell reflects the persisted pref (off by default)', !markup.includes('data-codicon="bell"'))
check('a "+" starts a session with a profile', markup.includes('data-codicon="add"'))
check('a folder+ creates a group', markup.includes('data-codicon="new-folder"'))
check('the filter menu is present', markup.includes('data-codicon="list-filter"'))
check('the search field is present', markup.includes('data-slot="search-field"'))
check('the search field is labelled', /data-slot="search-field"[^>]*placeholder="Search profiles and their sessions"/.test(markup))
check(
  'the "+" menu lists every visible profile',
  (markup.match(/data-codicon="hubot"/g) || []).length === 2,
  `hubot glyphs: ${(markup.match(/data-codicon="hubot"/g) || []).length}`
)
check(
  'the "+" items are the profile names, inside the menu',
  /data-slot="dropdown-content"[\s\S]{0,500}Crabby[\s\S]{0,200}Zulu/.test(markup),
  markup.match(/data-slot="dropdown-content"[\s\S]{0,500}/)?.[0]?.slice(0, 300)
)

// ── 8. groups (P5) ─────────────────────────────────────────────────────────

const SECTIONS = {
  sections: [{ id: 'sec-1', name: 'Clients' }],
  members: { zulu: 'sec-1' },
  collapsed: []
}

h.queryResults['personae|roster'] = {
  data: rows,
  error: null,
  isError: false,
  isPending: false
}

// The pane reads groups from its atom, which register() seeded from storage.
h.storage['messenger-sections-v1'] = SECTIONS
plugin.register(ctx)

markup = render()

check('a group heading renders', markup.includes('data-group="sec-1"') && markup.includes('Clients'), markup.slice(0, 300))
check('the heading counts its members', /data-group="sec-1"[\s\S]{0,300}?>\s*1\s*</.test(markup), markup.match(/data-group="sec-1"[\s\S]{0,300}/)?.[0])
check('the filed profile renders under its group', /data-group="sec-1"[\s\S]*?data-profile="zulu"/.test(markup))
check('everything else lands in Unassigned, drawn last', /data-group="section:unassigned"[\s\S]*?data-profile="default"/.test(markup))
check(
  'Unassigned comes after the named groups',
  markup.indexOf('data-group="sec-1"') < markup.indexOf('data-group="section:unassigned"')
)

// Collapsed: the heading stays, its members leave.
h.storage['messenger-sections-v1'] = { ...SECTIONS, collapsed: ['sec-1'] }
plugin.register(ctx)

markup = render()

check(
  'a collapsed group hides its members but keeps its heading',
  markup.includes('data-group="sec-1"') && !/data-group="sec-1"[\s\S]*?data-profile="zulu"/.test(markup),
  markup.match(/data-group="sec-1"[\s\S]{0,400}/)?.[0]
)
check(
  'the caret reflects the folded state',
  /data-open="false"/.test(markup.match(/data-group="sec-1"[\s\S]{0,200}/)?.[0] || '')
)
check('a collapsed group still shows the rest of the roster', markup.includes('data-profile="default"'))

// With no groups at all the pane is one anonymous list, exactly as before.
h.storage['messenger-sections-v1'] = { sections: [], members: {}, collapsed: [] }
plugin.register(ctx)

markup = render()

check('no groups → no headings at all', !markup.includes('data-group='), markup.match(/data-group="[^"]*"/g)?.join(' '))
check('no groups → both rows still render', markup.includes('data-profile="zulu"') && markup.includes('data-profile="default"'))

// ── 9. the decision layer (__internals) ────────────────────────────────────

const { groupRows, matchesActivity, normalizeSections, sessionMatches, visibleRows } = __internals
const FIX = [
  { active: true, label: 'Zulu', lastActiveMs: nowSec * 1000 - 1000, messages: 42, name: 'zulu', preview: 'flux' },
  { active: false, label: 'Crabby', lastActiveMs: nowSec * 1000 - 3 * 3600 * 1000, messages: 7, name: 'default', preview: 'roster' },
  { active: false, label: 'Old', lastActiveMs: nowSec * 1000 - 9 * 24 * 3600 * 1000, messages: 0, name: 'old', preview: '' }
]

check(
  'no filters → everything',
  visibleRows(FIX, { activity: 'all', kind: 'all', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: '' }).length === 3
)
check(
  'kind=withSessions drops the profile with no sessions',
  visibleRows(FIX, { activity: 'all', kind: 'withSessions', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: '' })
    .map(r => r.name)
    .join(',') === 'zulu,default'
)
check(
  'kind=noSessions keeps only that one',
  visibleRows(FIX, { activity: 'all', kind: 'noSessions', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: '' })
    .map(r => r.name)
    .join(',') === 'old'
)
check(
  'activity=active uses the 90s liveness flag',
  visibleRows(FIX, { activity: 'active', kind: 'all', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: '' })
    .map(r => r.name)
    .join(',') === 'zulu'
)
check(
  'activity=recent is the 7-day bucket',
  visibleRows(FIX, { activity: 'recent', kind: 'all', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: '' })
    .map(r => r.name)
    .join(',') === 'zulu,default'
)
check(
  'activity=older is its complement',
  visibleRows(FIX, { activity: 'older', kind: 'all', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: '' })
    .map(r => r.name)
    .join(',') === 'old'
)
check(
  'the profile filter narrows to the picked profile',
  visibleRows(FIX, { activity: 'all', kind: 'all', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: ['default'], query: '' })
    .map(r => r.name)
    .join(',') === 'default'
)
check(
  'a query matches the profile name',
  visibleRows(FIX, { activity: 'all', kind: 'all', matchesByProfile: {}, nowMs: nowSec * 1000, profiles: [], query: 'zul' })
    .map(r => r.name)
    .join(',') === 'zulu'
)
check(
  'a query also keeps a profile whose SESSIONS matched',
  visibleRows(FIX, {
    activity: 'all',
    kind: 'all',
    matchesByProfile: { default: [{ id: 'x' }] },
    nowMs: nowSec * 1000,
    profiles: [],
    query: 'unrelated-needle'
  })
    .map(r => r.name)
    .join(',') === 'default'
)
check('matchesActivity is total over the four buckets', ['all', 'active', 'recent', 'older'].every(f => typeof matchesActivity(FIX[0], f) === 'boolean'))

const MODEL = { collapsed: ['sec-1'], members: { zulu: 'sec-1' }, sections: [{ id: 'sec-1', name: 'Clients' }] }
const blocks = groupRows(FIX, MODEL)

check(
  'groupRows puts the filed row first and the rest in Unassigned',
  blocks.map(b => `${b.name ?? 'all'}:${b.rows.map(r => r.name).join('+')}`).join(' | ') === 'Clients:zulu | Unassigned:default+old',
  JSON.stringify(blocks.map(b => b.name))
)
check('groupRows reports the collapsed state', blocks[0].collapsed === true)
check(
  'a group with no members IS drawn (an empty group still has to be visible)',
  groupRows(FIX, { collapsed: [], members: {}, sections: [{ id: 'sec-2', name: 'Empty' }] }).some(
    b => b.name === 'Empty' && b.empty === true && b.rows.length === 0
  )
)
check(
  'normalizeSections drops orphans and malformed rows',
  JSON.stringify(normalizeSections({
    collapsed: ['sec-9', 'section:unassigned'],
    members: { a: 'sec-1', b: 'sec-9' },
    sections: [{ id: 'sec-1', name: 'Clients' }, { id: '', name: 'x' }, { id: 'sec-1', name: 'dup' }]
  })) === JSON.stringify({
    collapsed: ['section:unassigned'],
    members: { a: 'sec-1' },
    order: {},
    sections: [{ id: 'sec-1', name: 'Clients' }],
    sort: {}
  }),
  JSON.stringify(
    normalizeSections({
      collapsed: ['sec-9', 'section:unassigned'],
      members: { a: 'sec-1', b: 'sec-9' },
      sections: [{ id: 'sec-1', name: 'Clients' }, { id: '', name: 'x' }, { id: 'sec-1', name: 'dup' }]
    })
  )
)
check('normalizeSections survives garbage', normalizeSections('nope').sections.length === 0 && normalizeSections(null).members && true)
check(
  'sessionMatches reads the app\'s own fields',
  sessionMatches({ git_branch: 'feat/desktop', title: 'Flux' }, 'flux') &&
    sessionMatches({ preview: 'a needle here' }, 'needle') &&
    !sessionMatches({ title: 'nope' }, 'needle')
)

// ── 10. the session sweep behind the search ────────────────────────────────

// The sweep's OWN reads are what this section is about. The dot poll (P8b) also
// reads `listPersistedSessions` — at its own 500 limit — so without clearing the
// log first, `every(limit === 200)` below is answering about the polling, not
// about the sweep.
h.sessions.calls = []

const swept = await __internals.searchInSessions(['zulu', 'default', 'ghost'], 'flux')

check('the sweep reads sessions of every profile', h.sessions.calls?.length >= 3, `calls: ${JSON.stringify(h.sessions.calls)}`)
check(
  'the sweep matches inside session titles/previews',
  swept.zulu?.length === 1 && swept.zulu[0].id === 'sess-zulu-9',
  JSON.stringify(Object.keys(swept))
)
check('a broken profile contributes nothing instead of failing the search', !Object.keys(swept).includes('default'))
check(
  'the sweep asks for a bounded page of every profile',
  h.sessions.calls?.every(call => call.options.limit === 200) && h.sessions.calls.length >= 3,
  JSON.stringify(h.sessions.calls)
)

// ── 11. error + empty states ───────────────────────────────────────────────

h.queryResults['personae|roster'] = { data: undefined, error: new Error('boom'), isError: true, isPending: false }

markup = render()

check('error state names the failure', markup.includes('Could not load profiles') && markup.includes('boom'))

h.queryResults['personae|roster'] = { data: [], error: null, isError: false, isPending: false }

markup = render()

check('empty state is reachable', markup.includes('No profiles'))
check('empty state carries the personae mark', markup.includes('data-personae-mark') && markup.includes('data:image/png;base64,'))

h.queryResults['personae|roster'] = { data: rows, error: null, isError: false, isPending: false }

// ── 12. read-only guarantee ────────────────────────────────────────────────

const WRITE_METHODS =
  /^(profiles\.(add|remove|update|set|delete|create)|session\.(send|delete|kill)|.*\b(create|delete|update|set|remove|kill|send)\b.*)$/
const writes = h.requests.filter(r => WRITE_METHODS.test(r.method))

check('the pane issues no mutating RPCs', writes.length === 0, writes.map(w => w.method).join(','))
check(
  'the pane reads (profiles.list + profiles.get_asset + the two aggregate-dot reads) and nothing else',
  // P8b added `session.active_list` (which sessions are live in this gateway
  // process) on the roster poll; `session.list` is the read the expanded rows'
  // own refresh has always used. Both are READS — the mutating check above is
  // what guards the pane, and it still sees nothing. Each profile's session rows
  // for the dot come from `host.listPersistedSessions`, which is not an RPC.
  h.requests.every(r =>
    ['profiles.list', 'profiles.get_asset', 'session.active_list', 'session.list'].includes(r.method)
  ),
  [...new Set(h.requests.map(r => r.method))].join(',')
)
check('the "+" door is the sidebar\'s own, not a hand-rolled RPC', h.newChats.length === 0 || h.newChats.every(name => typeof name === 'string'))

// ── 13. groups: an EMPTY group is visible (2026-10-09) ─────────────────────

const emptyBlock = __internals.groupRows([], {
  collapsed: [],
  members: {},
  sections: [{ id: 'sec-new', name: 'Fresh' }]
})

check(
  'a section with no members still yields a block',
  emptyBlock.length === 1 && emptyBlock[0].id === 'sec-new',
  JSON.stringify(emptyBlock)
)
check('an empty block is flagged and rowless', emptyBlock[0].empty === true && emptyBlock[0].rows.length === 0)
check(
  'a filled block is not flagged empty',
  __internals.groupRows([{ name: 'zulu' }], {
    collapsed: [],
    members: { zulu: 'sec-new' },
    sections: [{ id: 'sec-new', name: 'Fresh' }]
  })[0].empty === false
)

h.storage['messenger-sections-v1'] = { collapsed: [], members: {}, sections: [{ id: 'sec-new', name: 'Fresh' }] }
plugin.register(ctx) // loadPrefs() re-reads storage: the group a user just made

markup = render()

check('a freshly created group renders its heading', markup.includes('data-group="sec-new"'), markup.slice(0, 300))
check('an empty group says how to fill it', markup.includes('Empty — right-click a profile'), markup.slice(0, 400))

// ── 14. message-body search + the menu scope the crash came from ───────────

const rowMenu = /data-slot="context-menu-content"[\s\S]*?data-slot="context-menu-item"/

check(
  'the row context menu holds context-menu items (the radix scope that crashed)',
  rowMenu.test(markup),
  markup.includes('data-slot="context-menu-content"') ? 'content without a context-menu item' : 'no context menu rendered'
)

h.rest.calls.length = 0
h.rest.byProfile = {
  zulu: {
    results: [
      { session_id: 'sess-zulu-9', snippet: 'we rewound the >>>flux<<< capacitor', timestamp: nowSec - 30 },
      { session_id: 'sess-zulu-7', snippet: 'flux again', timestamp: nowSec - 600 }
    ]
  }
}

const sweptBody = await __internals.searchInSessions(['zulu', 'ghost'], 'flux')

check(
  "the body search hits this plugin's own backend, per profile",
  h.rest.calls.includes('/search?q=flux&profile=zulu&limit=100&role=user,assistant') &&
    h.rest.calls.includes('/search?q=flux&profile=ghost&limit=100&role=user,assistant'),
  JSON.stringify(h.rest.calls)
)
check(
  'the sweep asks for the endpoint’s ceiling, not 40 — a chatty session must not eat the page',
  __internals.SEARCH_BODY_LIMIT === 100,
  String(__internals.SEARCH_BODY_LIMIT)
)
check(
  'and the ARCHIVE is swept per profile, so a title match in an archived chat is reachable',
  h.rest.calls.includes('/archived?profile=zulu&limit=60') && h.rest.calls.includes('/archived?profile=ghost&limit=60'),
  JSON.stringify(h.rest.calls)
)
check(
  'a body match carries its snippet',
  sweptBody.zulu[0].body === true && sweptBody.zulu[0].id === 'sess-zulu-7' && sweptBody.zulu[0].preview === 'flux again',
  JSON.stringify(sweptBody.zulu?.map(hit => hit.id))
)
check(
  'a session matching BOTH ways keeps ONE row, enriched — the title survives, the snippet is the body hit',
  (() => {
    const rows = sweptBody.zulu.filter(hit => String(hit.id) === 'sess-zulu-9')

    return rows.length === 1 && rows[0].body === true && rows[0].title === 'Flux capacitor retro' && rows[0].matches === 1
  })(),
  JSON.stringify(sweptBody.zulu?.filter(hit => String(hit.id) === 'sess-zulu-9'))
)
check('the FTS markers are stripped out of the snippet', sweptBody.zulu.every(hit => !/>>>|<<</.test(hit.preview)))
check('a profile with no body hits is left alone', !Object.keys(sweptBody).includes('ghost'))
check(
  'a search that went fine publishes no health problem',
  __internals.$searchHealth.get().unavailable === false && __internals.$searchHealth.get().failed.length === 0,
  JSON.stringify(__internals.$searchHealth.get())
)

h.rest.byProfile = { zulu: new Error('backend down') }

const sweptDown = await __internals.searchInSessions(['zulu'], 'flux')

check(
  'a dead backend leaves the metadata sweep intact',
  sweptDown.zulu?.some(hit => hit.id === 'sess-zulu-9') === true,
  JSON.stringify(sweptDown)
)
check(
  'AND the refusal is published — a dead backend may not draw the same screen as "no match"',
  __internals.$searchHealth.get().failed.includes('zulu'),
  JSON.stringify(__internals.$searchHealth.get())
)

{
  const realRest = ctx.rest

  delete ctx.rest

  await __internals.searchInSessions(['zulu'], 'flux')

  check(
    'a build with no body-search backend says TITLES ONLY, not silence',
    __internals.$searchHealth.get().unavailable === true
  )

  ctx.rest = realRest
  await __internals.searchInSessions(['zulu'], 'flux')
}

check('bodyHit drops rows with no session id', __internals.bodyHit({ snippet: 'x' }).id === '')
check(
  'bodyHit reads the ROLE, so a tool row cannot outrank a sentence',
  __internals.bodyHit({ role: 'tool', session_id: 's' }).conversational === false &&
    __internals.bodyHit({ role: 'user', session_id: 's' }).conversational === true
)

// ── 15. the profile menu's reordering + "New session" ──────────────────────

// Rendering the tree twice re-reads live module state (groups, expansion), so
// re-register first and re-render once for a clean sheet.
h.storage['messenger-sections-v1'] = {
  collapsed: [],
  members: {},
  sections: [{ id: 'sec-new', name: 'Fresh' }]
}
plugin.register(ctx)

markup = render()

check('the profile menu offers "New session"', (markup.match(/>New session</g) || []).length === 2, `count ${(markup.match(/>New session</g) || []).length}`)

// 2026-10-09, Pedro: "when right-clicking a profile, group options should not be
// listed in the menu". A profile owns sessions; a GROUP owns group ops.
check(
  'the profile menu lists no group options',
  !/>Move to\.\.\.</.test(markup) &&
    !markup.includes('>New group from this profile…<') &&
    !markup.includes('>Rename group…<') &&
    !/data-slot="context-menu-item">(Delete group|Fresh|Unassigned)</.test(markup),
  `moveHeader@${markup.indexOf('>Move to...<')}`
)
// Anchored on the label, not on the item slot's bare `>`: an option with a glyph
// wraps its text in a <span> (core's own `renderActionItem` shape), so
// `data-slot="context-menu-item">Open all in tabs` stopped matching the day the
// row earned an icon — the wrapper was never the subject.
check(
  'and offers the session verbs instead',
  (markup.match(/>Open newest session</g) || []).length === 2 &&
    (markup.match(/>Open all in tabs</g) || []).length === 2,
  `newest=${(markup.match(/>Open newest session</g) || []).length} tabs=${(markup.match(/>Open all in tabs</g) || []).length}`
)
check(
  'group ops live on the group heading, where the noun matches the verb',
  (markup.match(/>Delete group</g) || []).length >= 1 && markup.includes('>Rename…<'),
  `deleteGroup=${(markup.match(/>Delete group</g) || []).length} (one kebab per group heading)`
)
check('newSession starts a session on that profile (the toolbar\'s own call)', (() => {
  h.newChats.length = 0
  __internals.newSession('zulu')

  return h.newChats.length === 1 && h.newChats[0] === 'zulu'
})(), JSON.stringify(h.newChats))

// ── 16. a profile expands into its recent sessions ─────────────────────────

check('a profile is collapsed until it is clicked', __internals.toggleExpanded('zulu') === true)
check('clicking again collapses it', __internals.toggleExpanded('zulu') === false)

__internals.toggleExpanded('zulu')
h.queryResults['personae|sessions|zulu'] = {
  data: {
    zulu: [
      {
        id: 'sess-zulu-9',
        last_active: nowSec - 90,
        preview: 'we rewound it',
        source: 'telegram',
        title: 'Flux capacitor retro'
      },
      {
        id: 'sess-zulu-8',
        last_active: nowSec - 9000,
        preview: 'nothing to see',
        source: 'desktop',
        title: 'unrelated'
      }
    ]
  },
  error: null,
  isError: false,
  isPending: false
}

const expandedQuery = () => h.queries.filter(q => (q.queryKey || [])[1] === 'sessions').pop() || {}

markup = render()

check(
  'the expansion query is keyed by the OPEN SET',
  (expandedQuery().queryKey || []).join('|') === 'personae|sessions|zulu',
  JSON.stringify(expandedQuery().queryKey)
)
check('the expansion query polls like the roster', expandedQuery().refetchInterval === 5000, `got ${expandedQuery().refetchInterval}`)

check(
  'the expanded profile draws its sessions under it',
  /data-profile="zulu"[\s\S]*?data-session="sess-zulu-9"[\s\S]*?data-session="sess-zulu-8"/.test(markup),
  markup.slice(markup.indexOf('data-profile="zulu"'), markup.indexOf('data-profile="zulu"') + 400)
)
// Channel labels: every channel is welcome; the row says which one it is. The
// app's own surfaces stay unlabelled so a desktop session carries no noise.
check(
  'the list track is minmax(0,1fr) — a nowrap cell can never set the pane width',
  markup.includes('grid min-w-0 grid-cols-1 gap-0.5 px-1.5') &&
    !markup.includes('class="grid min-w-0"')
)
check(
  'the pane clips x: no band can scroll the caret or the grip out of view',
  markup.includes('flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-sm')
)
{
  const bands = [
    'flex min-w-0 items-center justify-between gap-2 px-2.5 pt-2.5 pb-1.5',
    'flex min-w-0 items-center gap-1 px-2.5 pb-1.5'
  ]
  // The select bar only paints in select mode, so it is asserted on the source.
  const source = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

  bands.push('flex min-w-0 flex-wrap items-center justify-between gap-2 px-2.5 pt-1 pb-1.5')
  const scope = markup + source
  const missing = bands.filter(band => !scope.includes(band))

  check(
    'every band in the pane can shrink, so the list grid track never widens past it',
    !missing.length,
    `missing: ${JSON.stringify(missing)}`
  )
}
{
  // The caret is the app's own DisclosureCaret (a hand-rolled triangle would not
  // carry this stub marker) and it leads the row's button, so the box that clips
  // can never eat it.
  // `data-profile` carries the profile's NAME (lowercase); the grip's label
  // carries its display label. Anchor on the former.
  if (process.env.DUMP_MARKUP) {
    writeFileSync(process.env.DUMP_MARKUP, markup)
  }

  const from = markup.indexOf('data-profile="zulu"')
  const slice = markup.slice(from, markup.indexOf('data-drop-profile', from + 20))
  const caret = slice.indexOf('data-slot="caret"')
  const picture = slice.indexOf('min-w-0 overflow-hidden')

  check(
    'a profile row leads with the app caret, ahead of the picture it can crop',
    caret > -1 && picture > -1 && caret < picture,
    `caret@${caret} picture@${picture}`
  )
  check(
    'the picture is the cell that yields — the caret never is, and the row shows no grip',
    !slice.includes('cursor-grab') && !slice.includes('class="shrink-0" data-slot="caret"'),
    slice.slice(0, 220)
  )
}
check(
  'a Telegram session is labelled with its channel',
  /data-session="sess-zulu-9"[\s\S]{0,400}?>Telegram</.test(markup),
  markup.slice(markup.indexOf('data-session="sess-zulu-9"'), markup.indexOf('data-session="sess-zulu-9"') + 320)
)
check(
  'an app-owned session carries no channel chip',
  !/data-session="sess-zulu-8"[\s\S]{0,400}?>Desktop</.test(markup)
)
// `default` is NOT expanded, so nothing between its row and the next profile
// row can be a session line.
const defaultSlice = markup.slice(
  markup.indexOf('data-profile="default"'),
  markup.indexOf('data-profile="zulu"')
)

check('a collapsed profile draws none', !defaultSlice.includes('data-session='), defaultSlice.slice(0, 200))

// Pedro's ordering, 2026-10-10: Select · Open · Session · Apropos (On that
// topic) · Group · Appearance · Assign to project — one noun per submenu, so the
// top level reads as a table of contents.
const sessionMenu = markup.slice(markup.indexOf('data-session="sess-zulu-9"'))
const TOP_LEVEL = [
  'Select',
  'Open',
  'Session',
  'Apropos (On that topic, beta)',
  'Group',
  'Appearance',
  'Assign to project'
]
const menuOrder = TOP_LEVEL.map(label => labelAt(sessionMenu, label))

check(
  'the session menu lists its seven verbs in Pedro\'s order',
  menuOrder.every((at, index) => at >= 0 && (index === 0 || at > menuOrder[index - 1])),
  JSON.stringify(menuOrder)
)
check(
  'Open carries both intents, window first',
  (() => {
    const i = labelAt(sessionMenu, 'In new window')
    return i >= 0 && i < labelAt(sessionMenu, 'In new tab')
  })()
)
check(
  'Session carries the transcript verbs',
  ['Mark as unread', 'Rename…', 'Branch', 'Copy id', 'Export…', 'Hide from Personae', 'Archive'].every(label =>
    menuLabel(sessionMenu, label)
  )
)
check(
  'Delete is destructive, last, and behind a separator',
  (() => {
    const archiveAt = labelAt(sessionMenu, 'Archive')
    const del = labelAt(sessionMenu, 'Delete session…')
    const sep = sessionMenu.indexOf('data-slot="context-menu-separator"', archiveAt)

    return archiveAt >= 0 && del > archiveAt && sep > 0 && sep < del && sessionMenu.includes('data-variant="destructive"')
  })(),
  sessionMenu.slice(labelAt(sessionMenu, 'Archive'), labelAt(sessionMenu, 'Archive') + 300)
)
check(
  'Apropos (On that topic) offers both weights',
  menuLabel(sessionMenu, 'From this session') && menuLabel(sessionMenu, 'Create group')
)
check(
  'Group offers creation and filing',
  menuLabel(sessionMenu, 'New session group') &&
    // The filing submenu only exists once the profile HAS groups, so its label
    // is asserted where groups exist (see the parity section below) — at this
    // point in the fixture zulu has none, which is itself the correct render.
    !menuLabel(sessionMenu, 'Move to group')
)
check('Appearance is a submenu', isSubmenuTrigger(sessionMenu, 'Appearance'))
check('Assign to project is a submenu', isSubmenuTrigger(sessionMenu, 'Assign to project'))
check(
  'the session items are context-menu items inside the submenu scope too',
  sessionMenu.includes('data-slot="context-menu-sub-content"') && sessionMenu.includes('data-slot="color-swatches"')
)

// ── the pop-up's glyphs ─────────────────────────────────────────────────────
// Pedro, 2026-10-13: "add little icons to the options in the pop-up list when
// right-clicking on a session". None of these is decoration: a verb core also
// has wears core's own glyph (`app/chat/sidebar/session-actions-menu.tsx`) —
// Rename a pencil, Branch a fork, Export a download, Archive a box, Delete a
// bin — so it looks the same wherever the user meets it; the rest come from the
// app's wider menu vocabulary. Whether the font can DRAW a name is a separate
// gate (tests/icons.mjs): a name it does not carry paints nothing at all, which
// reads as "that option has no icon" rather than as an error. The table covers
// the rows this fixture renders; "Move to group" only exists once the profile
// has groups, so it is asserted where it renders.
const SESSION_GLYPHS = {
  Appearance: 'symbol-color',
  Archive: 'archive',
  'Apropos (On that topic, beta)': 'lightbulb',
  'Assign to project': 'project',
  Branch: 'repo-forked',
  'Copy id': 'copy',
  'Create group': 'new-folder',
  'Delete session…': 'trash',
  'Export…': 'cloud-download',
  'From this session': 'comment-discussion',
  Group: 'folder',
  'Hide from Personae': 'eye-closed',
  'In new tab': 'browser',
  'In new window': 'link-external',
  'Mark as unread': 'mail',
  'New session group': 'new-folder',
  Open: 'browser',
  'Rename…': 'edit',
  Select: 'check',
  Session: 'history'
}

check(
  "every option in the session pop-up carries core's own glyph for its verb",
  Object.entries(SESSION_GLYPHS).every(([label, icon]) => glyphFor(sessionMenu, label) === icon),
  Object.entries(SESSION_GLYPHS)
    .filter(([label, icon]) => glyphFor(sessionMenu, label) !== icon)
    .map(([label, icon]) => `${label}: got ${glyphFor(sessionMenu, label)}, want ${icon}`)
    .join('\n        ')
)
check(
  'the transcript submenu draws one glyph per row, trigger included',
  (() => {
    const slot = 'data-slot="context-menu-sub-trigger"'
    // Both ends on a TRIGGER SLOT, never on a label: the glyph is drawn before
    // its label, so a slice ending at "Apropos…" would sweep the Apropos
    // trigger's own lightbulb into the transcript submenu's list.
    const from = sessionMenu.lastIndexOf(slot, labelAt(sessionMenu, 'Session'))
    const to = sessionMenu.lastIndexOf(slot, labelAt(sessionMenu, 'Apropos (On that topic, beta)'))
    const drawn = [...sessionMenu.slice(from, to).matchAll(/data-codicon="([^"]+)"/g)].map(m => m[1])

    // 1.4.0 adds "Archive all up to this point…" — a SECOND archive glyph, on
    // purpose: it is the same family of verb (reversible, no data loss) at a
    // different SCOPE, and the one-glyph-per-row rule is about every row having
    // a glyph, not about every glyph being unique.
    return drawn.join(' ') === 'history mail edit repo-forked copy cloud-download eye-closed archive archive trash'
  })(),
  (() => {
    const slot = 'data-slot="context-menu-sub-trigger"'
    const from = sessionMenu.lastIndexOf(slot, labelAt(sessionMenu, 'Session'))
    const to = sessionMenu.lastIndexOf(slot, labelAt(sessionMenu, 'Apropos (On that topic, beta)'))

    return [...sessionMenu.slice(from, to).matchAll(/data-codicon="([^"]+)"/g)].map(m => m[1]).join(' ')
  })()
)
check(
  'the bulk archive cut is the row AFTER Archive and is NOT destructive',
  (() => {
    const item = /data-slot="context-menu-item"[^>]*>(?:(?!data-slot="context-menu-item")[\s\S])*?Archive all up to this point/.exec(sessionMenu)

    return Boolean(item) && !/data-variant="destructive"/.test(item[0])
  })(),
  'a bulk verb that cannot lose data must not wear the delete dress'
)

const projectsQuery = h.queries.filter(q => (q.queryKey || [])[1] === 'projects').pop() || {}

check(
  'Assign to project asks projects.list for THIS profile',
  (projectsQuery.queryKey || []).join('|') === 'personae|projects|zulu',
  JSON.stringify(projectsQuery.queryKey)
)

h.responses['projects.list'] = () => ({
  projects: [{ id: 'p1', name: 'demo', primary_path: '/home/hermes/Projects/demo' }]
})

const projects = await projectsQuery.queryFn()

check('the project list comes from the projects registry', projects[0]?.name === 'demo', JSON.stringify(projects))
check('the query is profile-scoped', h.requests.filter(r => r.method === 'projects.list').pop()?.params?.profile === 'zulu', JSON.stringify(h.requests.filter(r => r.method === 'projects.list').pop()?.params))

// ── 17. every session verb lands on a real gateway RPC ─────────────────────

const lastRequest = () => h.requests[h.requests.length - 1]

// The verbs only need the gateway to answer; the assertions are on the CALL.
h.responses['session.archive'] = () => ({ archived: true })
h.responses['session.title'] = () => ({ title: 'ok' })
h.responses['session.workspace.move'] = () => ({ cwd: '/home/hermes/Projects/demo' })

await __internals.archiveSession('sess-zulu-9', 'zulu')

check(
  'Archive calls session.archive (archived: true) with the profile',
  lastRequest().method === 'session.archive' &&
    lastRequest().params.archived === true &&
    lastRequest().params.session_id === 'sess-zulu-9' &&
    lastRequest().params.profile === 'zulu',
  JSON.stringify(lastRequest())
)

h.responses['session.branch_stored'] = () => ({ stored_session_id: 'sess-branched-1' })
h.opens.length = 0

await __internals.branchSession('sess-zulu-9', 'zulu')

check(
  'Branch calls session.branch_stored on the stored parent',
  lastRequest().method === 'session.branch_stored' &&
    lastRequest().params.parent_session_id === 'sess-zulu-9' &&
    lastRequest().params.profile === 'zulu' &&
    Boolean(lastRequest().params.idempotency_key),
  JSON.stringify(lastRequest())
)
check(
  'the branch child opens in a tab, like core does',
  h.opens.length === 1 && h.opens[0].id === 'sess-branched-1' && h.opens[0].options.intent === 'tab',
  JSON.stringify(h.opens)
)

// Rename has TWO doors, and which one is used is the whole fix (2026-10-16:
// "every time I try to rename a session in my plug-in, it says 'Session not
// found'"). `session.title` is a SESSION-SCOPED RPC — the gateway resolves its
// session_id against the LIVE registry, so a STORED id can only ever answer
// 4001. A live row (one carrying `resolved_id`) goes through core; every other
// row goes through the pane's backend, which is the same write core's REST
// title route performs.
{
  const before = h.requests.length
  const restBefore = (h.rest.writes || []).length

  check(
    'Rename refuses an empty name (no RPC, no backend write, no silent no-op)',
    (await __internals.renameSession({ id: 'sess-zulu-9' }, 'zulu', '   ')) === false &&
      h.requests.length === before &&
      (h.rest.writes || []).length === restBefore
  )
}

{
  // TWO AUTHORITIES. The store is the durable title; the RUNNING session object is
  // what core's auto-titler consults. A live row therefore needs both writes, or
  // the first turn of a young chat overwrites the name the user just typed —
  // Pedro, 2026-10-17: "I can't successfully rename a session until it's given me
  // some sort of response." The stored id still goes only to the backend.
  const before = h.requests.length

  h.rest.byProfile = { zulu: { ok: true, session_key: 'sess-zulu-9', title: 'Better name' } }
  h.rest.writes = []
  h.requests.length = 0

  const renamed = await __internals.renameSession({ id: 'sess-zulu-9', resolved_id: 'runtime-9' }, 'zulu', 'Better name')
  const told = h.requests.find(entry => entry.method === 'session.title')

  check(
    'a LIVE row renames through the backend AND tells the running session',
    renamed === true &&
      h.rest.writes?.[0]?.body?.session_id === 'sess-zulu-9' &&
      told?.params?.session_id === 'runtime-9' &&
      told?.params?.title === 'Better name',
    JSON.stringify({ requests: h.requests.map(r => r.method), writes: h.rest.writes })
  )
  check(
    '…and the STORED id is never the one the RPC is given (it 4001s every one)',
    told && told.params.session_id !== 'sess-zulu-9' && !JSON.stringify(h.rest.writes).includes('runtime-9')
  )
  h.requests.length = before === 0 ? 0 : h.requests.length
}

{
  // The stored-id door. This is the case the user actually hits: the sessions in
  // a list are almost never live in the gateway process.
  const before = h.requests.length
  const restCallsBefore = h.rest.calls.length

  h.rest.byProfile = { zulu: { ok: true, session_key: 'sess-zulu-9', title: 'Archived-era name' } }
  h.rest.writes = []

  const renamed = await __internals.renameSession({ id: 'sess-zulu-9' }, 'zulu', 'Archived-era name')

  check('a STORED-only row renames through the pane backend', renamed === true)
  check(
    '…which is a POST /title carrying the profile, the stored id and the name',
    h.rest.writes?.[0]?.method === 'POST' &&
      h.rest.writes[0].path === '/title' &&
      h.rest.writes[0].body?.profile === 'zulu' &&
      h.rest.writes[0].body?.session_id === 'sess-zulu-9' &&
      h.rest.writes[0].body?.title === 'Archived-era name',
    JSON.stringify(h.rest.writes)
  )
  check(
    '…and it does NOT fire the doomed session.title first (the gateway logs every rejected one)',
    h.requests.length === before && h.rest.calls.length > restCallsBefore,
    `requests +${h.requests.length - before}`
  )
}

{
  // Neither door knows the session: the store has no row and the gateway refuses
  // the id too. The backend's sentence is the honest one — it names the session.
  const realTitle = h.responses['session.title']

  h.responses['session.title'] = () => {
    throw new Error('4001 session not found')
  }
  h.rest.byProfile = { zulu: { detail: 'no session sess-gone in zulu', error: 'session_not_found' } }

  let said = ''

  try {
    await __internals.renameSession({ id: 'sess-gone' }, 'zulu', 'anything')
  } catch (error) {
    said = String(error.message || error)
  }

  h.responses['session.title'] = realTitle

  check(
    'a backend 404 becomes the backend’s own sentence, so the toast names the session',
    said.includes('no session sess-gone in zulu'),
    said
  )
}

{
  // A chat that exists ONLY as a live session: nothing has written a row yet, so
  // the stored door answers "no such session" and the gateway is the only door
  // there is. This is the "until it has answered me" case.
  h.rest.byProfile = { zulu: { detail: 'no session draft-1 in zulu', error: 'session_not_found' } }
  h.rest.writes = []
  h.requests.length = 0
  h.responses['session.title'] = () => ({ title: 'ok' })

  const renamed = await __internals.renameSession({ id: 'draft-1', resolved_id: 'runtime-draft-1' }, 'zulu', 'First chat')

  check(
    'a chat with no stored row renames through the gateway alone',
    renamed === true &&
      h.requests.some(
        entry => entry.method === 'session.title' && entry.params?.session_id === 'runtime-draft-1' && entry.params?.title === 'First chat'
      ),
    JSON.stringify({ requests: h.requests.map(e => e.method), writes: h.rest.writes })
  )
  check(
    '…and it does not then claim a stored row it never wrote',
    (h.rest.writes || []).filter(entry => entry.path === '/title').length === 1
  )
}

{
  const realRest = ctx.rest

  delete ctx.rest

  let said = ''

  try {
    await __internals.renameSession({ id: 'sess-zulu-9' }, 'zulu', 'anything')
  } catch (error) {
    said = String(error.message || error)
  }

  ctx.rest = realRest
  h.rest.byProfile = {}



  check(
    'with no backend at all the failure SAYS so instead of blaming the session',
    /needs the Personae backend/i.test(said),
    said
  )
}

await __internals.moveSessionToProject('sess-zulu-9', '/home/hermes/Projects/demo', 'zulu')

check(
  'Assign to project calls session.workspace.move with the folder as cwd',
  lastRequest().method === 'session.workspace.move' &&
    lastRequest().params.cwd === '/home/hermes/Projects/demo' &&
    lastRequest().params.session_key === 'sess-zulu-9' &&
    lastRequest().params.profile === 'zulu',
  JSON.stringify(lastRequest())
)

h.opens.length = 0

await __internals.openSession('sess-zulu-9', 'zulu', 'window')

check(
  'Open in new window passes the window intent and the profile',
  h.opens[0]?.options?.intent === 'window' && h.opens[0]?.options?.profile === 'zulu',
  JSON.stringify(h.opens)
)

h.opens.length = 0

await __internals.openSession('sess-zulu-9', 'zulu')

check('a plain click opens with history, no intent', h.opens[0]?.options?.expectHistory === true && !('intent' in (h.opens[0]?.options || {})), JSON.stringify(h.opens))

// The export payload is built here; the file itself is the DOM's job.
const payload = __internals.exportPayload('sess-zulu-9', 'Flux capacitor retro', {
  count: 2,
  messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }]
})

check(
  'the export payload carries the transcript and its count',
  payload.session_id === 'sess-zulu-9' &&
    payload.title === 'Flux capacitor retro' &&
    payload.message_count === 2 &&
    payload.messages.length === 2 &&
    typeof payload.exported_at === 'string',
  JSON.stringify(payload).slice(0, 200)
)
check(
  'the export payload survives a history with no messages',
  __internals.exportPayload('s', 't', {}).message_count === 0 &&
    __internals.exportPayload('s', 't', {}).messages.length === 0
)

// ── 18. session colours: core's own store, plus the pane's mirror ──────────

h.colors.length = 0
h.storage['messenger-session-colors-v1'] = undefined

__internals.setSessionColor('zulu', 'sess-zulu-9', '#8b5cf6')

check(
  'a swatch writes CORE\'s per-session override (the app\'s own picker value)',
  h.colors.length === 1 && h.colors[0].id === 'sess-zulu-9' && h.colors[0].color === '#8b5cf6',
  JSON.stringify(h.colors)
)
check(
  'the pane mirrors it (core\'s store has no getter)',
  __internals.sessionColor('zulu', 'sess-zulu-9') === '#8b5cf6' && h.storage['messenger-session-colors-v1'].zulu['sess-zulu-9'] === '#8b5cf6',
  JSON.stringify(h.storage['messenger-session-colors-v1'])
)

markup = render()

check(
  'the session NAME carries the colour (style, not a class)',
  /data-session="sess-zulu-9"[\s\S]{0,300}?style="color:#8b5cf6"/.test(markup),
  markup.match(/data-session="sess-zulu-9"[\s\S]{0,300}?/) || 'no row'
)
check('a colourless session keeps the theme colour', !/data-session="sess-zulu-8"[\s\S]{0,300}?style="color:/.test(markup))

__internals.setSessionColor('zulu', 'sess-zulu-9', null)

check(
  'clearing writes null to core and drops the pane\'s entry',
  h.colors.length === 2 && h.colors[1].color === null && __internals.sessionColor('zulu', 'sess-zulu-9') === null,
  JSON.stringify(h.colors)
)

const normalized = __internals.normalizeColors({
  junk: 'not a map',
  zulu: { 'sess-1': '#fff', bad: 42, '': '#000' },
  empty: {}
})

check(
  'normalizeColors keeps only real profile→id→string entries',
  Object.keys(normalized).length === 1 && Object.keys(normalized.zulu).length === 1 && normalized.zulu['sess-1'] === '#fff',
  JSON.stringify(normalized)
)
check('normalizeColors survives garbage', Object.keys(__internals.normalizeColors(null)).length === 0 && Object.keys(__internals.normalizeColors('x')).length === 0)

// The projects folder is the cwd; a project without one is un-movable.
check('projectCwd prefers the primary folder', __internals.projectCwd({ primary_path: '/a' }) === '/a')
check(
  'projectCwd falls back to the first folder',
  __internals.projectCwd({ folders: [{ path: '/b' }, { path: '/c' }] }) === '/b'
)
check('projectCwd refuses a project with no folder', __internals.projectCwd({ name: 'x' }) === null && __internals.projectCwd(null) === null)


// ── 17. job-run sources never reach the pane as conversations ──────────────
// The backend's listing deny-list (INTERNAL_LISTING_SOURCES) covers kanban /
// tool / oneshot but NOT cron, so a profile whose newest rows are scheduler
// runs (stamos: 8/8, scholes: 6/8, homie: 5/8 today) would otherwise draw a
// column of job runs as if they were chats.

h.sessions.byProfile.jobby = {
  sessions: [
    { id: 'cron_1', last_active: nowSec - 60, preview: 'nudge', source: 'cron', title: 'stamos-midweek-check · Sep 30 12:32' },
    { id: 'sess-real', last_active: nowSec - 120, preview: 'hi', source: 'desktop', title: 'real chat' },
    { id: 'cron_2', last_active: nowSec - 180, preview: 'doc', source: 'cron_output', title: 'script-only run' },
    { id: 'casey', last_active: nowSec - 200, preview: 'x', source: 'CRON', title: 'mixed case' },
    { id: 'legacy', last_active: nowSec - 240, preview: 'y', title: 'no source at all' }
  ]
}

const jobbyRows = await __internals.listProfileSessions('jobby')

check(
  'a cron run is never drawn as a session row',
  jobbyRows.every(row => String(row.source).toLowerCase() !== 'cron'),
  JSON.stringify(jobbyRows.map(row => row.source))
)
check(
  'the script-only job\'s run doc is dropped too',
  jobbyRows.every(row => String(row.source).toLowerCase() !== 'cron_output')
)
check('a real chat survives the filter', jobbyRows.length === 2 && jobbyRows[0].id === 'sess-real', JSON.stringify(jobbyRows.map(r => r.id)))
check('the source match is case-insensitive', jobbyRows.every(row => row.id !== 'casey'))
check('a row with no source is kept (it is not a run)', jobbyRows.some(row => row.id === 'legacy'))

const refreshed = await __internals.refreshSessions(['jobby', 'zulu'])

check(
  'the pane query fn applies the filter to every profile it loads',
  refreshed.jobby.length === 2 && refreshed.zulu.length === 2,
  JSON.stringify({ jobby: refreshed.jobby.map(r => r.id), zulu: refreshed.zulu.map(r => r.id) })
)

// ── P7: per-profile list views (Pedro's item 1 + D-A) ───────────────────────

__internals.$listView.set(null)
__internals.$expanded.set({ zulu: true })
markup = render()

check(
  'an expanded profile ends with View all and View Archived',
  markup.includes('>View all<') && markup.includes('>View Archived<'),
  markup.slice(Math.max(0, markup.indexOf('View all') - 160), markup.indexOf('View all') + 40)
)
// Only the EXPANDED list carries the footer: a collapsed row's search hits are
// not the profile's history.
const p7CollapsedSlice = markup.slice(markup.indexOf('data-profile="default"'), markup.indexOf('data-profile="zulu"'))
check('a collapsed profile carries no such footer', !p7CollapsedSlice.includes('>View all<'))

// "View all" is a plain RPC read — limit is a parameter, so no backend is needed.
h.requests.length = 0
const p7AllRows = await __internals.listAllSessions('zulu')
const viewAllCall = h.requests.find(r => r.method === 'session.list')
check(
  'View all asks session.list for a big page on THIS profile',
  viewAllCall?.params?.limit === 500 && viewAllCall?.params?.profile === 'zulu',
  JSON.stringify(viewAllCall?.params)
)
check('and hands back the sessions the RPC returned', p7AllRows.length === 2, JSON.stringify(p7AllRows.map(r => r.id)))

// "View Archived" goes through the pane's own backend, path-scoped per profile.
h.rest.calls.length = 0
h.rest.byProfile = {
  zulu: {
    count: 1,
    sessions: [
      { archived: true, id: 'arc-1', last_active: nowSec - 90000, message_count: 3, preview: 'old thread', source: 'whatsapp', title: 'Archived thread' }
    ]
  }
}
const p7ArchRows = await __internals.listArchivedSessions('zulu')
check(
  'View Archived reads the pane backend for this profile',
  h.rest.calls.includes('/archived?profile=zulu&limit=60'),
  JSON.stringify(h.rest.calls)
)
check('and maps the archived rows through', p7ArchRows?.length === 1 && p7ArchRows[0].id === 'arc-1', JSON.stringify(p7ArchRows))

h.rest.byProfile = {
  zulu: {
    sessions: [
      { id: 'arc-cron', source: 'cron', title: 'job run' },
      { id: 'arc-2', source: 'telegram', title: 'real thread' }
    ]
  }
}
const p7ArchiveRows = await __internals.listArchivedSessions('zulu')
check(
  'an archived machine run is still not a conversation',
  p7ArchiveRows.length === 1 && p7ArchiveRows[0].id === 'arc-2',
  JSON.stringify(p7ArchiveRows.map(r => r.id))
)

// A backend that ERRORS and a build that has NO backend must both read as
// "cannot tell" — never as an empty archive over a reachable one.
h.rest.byProfile = { zulu: new Error('backend down') }
check('a failing archive backend reads as unavailable, not as empty', (await __internals.listArchivedSessions('zulu')) === null)
const p7RealRest = ctx.rest
delete ctx.rest
check('a build with no archive backend reads as unavailable too', (await __internals.listArchivedSessions('zulu')) === null)
ctx.rest = p7RealRest

// The body swap: the roster is GONE, the list is in its place, with a way back.
h.queryResults['personae|view|all|zulu'] = {
  data: [{ id: 'sess-zulu-9', last_active: nowSec - 60, source: 'telegram', title: 'flux work' }],
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
__internals.$listView.set({ kind: 'all', profile: 'zulu' })
markup = render()
check('View all replaces the profile list in the pane', markup.includes('data-list-view="all"'), markup.slice(0, 200))
check('the roster is not drawn behind it', !markup.includes('data-profile='))
check('the replaced body carries a back button', /aria-label="Back"/.test(markup))
check('and the sessions the view is for', /data-session="sess-zulu-9"/.test(markup))
check('the header names the profile it belongs to', /View all[\s\S]{0,160}?zulu/.test(markup))

h.queryResults['personae|view|archived|zulu'] = {
  data: [{ archived: true, id: 'arc-1', last_active: nowSec - 90000, source: 'whatsapp', title: 'Archived thread' }],
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
__internals.$listView.set({ kind: 'archived', profile: 'zulu' })
markup = render()
check(
  'View Archived is its own body',
  markup.includes('data-list-view="archived"') && /data-session="arc-1"/.test(markup)
)

h.queryResults['personae|view|archived|zulu'] = {
  data: null,
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
markup = render()
check('an unreachable archive SAYS so', markup.includes('Archive unavailable'), markup.slice(0, 240))

__internals.$listView.set(null)
markup = render()
check('clearing the view brings the roster back', markup.includes('data-profile="zulu"'))

// ── the right-edge Scheduled jobs pane ──────────────────────────────────────

const routinesPane = contributions.find(c => c.id === 'routines') || {}

check(
  'the Scheduled jobs pane docks the workspace right edge, collapsed',
  routinesPane.data?.placement === 'main' &&
    routinesPane.data?.dock?.pane === 'workspace' &&
    routinesPane.data?.dock?.pos === 'right' &&
    routinesPane.data?.defaultCollapsed === true &&
    routinesPane.data?.width === '250px',
  JSON.stringify(routinesPane.data)
)

// One list per profile, because every profile keeps its OWN cron store.
h.requests.length = 0
h.responses['cron.manage'] = ({ profile }) => ({
  count: profile === 'zulu' ? 2 : 0,
  gateway_running: true,
  jobs:
    profile === 'zulu'
      ? [
          {
            enabled: true,
            job_id: 'job-1',
            name: 'Daily Briefing',
            next_run_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
            schedule: 'every 1440m',
            state: 'scheduled'
          },
          { enabled: false, job_id: 'job-2', name: 'Paused thing', schedule: '0 7 * * *', state: 'paused' }
        ]
      : []
})
const routinesByProfile = await __internals.fetchRoutines(['zulu', 'default'])
const cronCall = h.requests.find(r => r.method === 'cron.manage')

check(
  'it asks cron.manage per profile, disabled jobs included',
  cronCall?.params?.action === 'list' &&
    cronCall?.params?.include_disabled === true &&
    cronCall?.params?.profile === 'zulu',
  JSON.stringify(cronCall?.params)
)
check(
  'it groups the jobs under the profile that owns them',
  routinesByProfile.zulu.jobs.length === 2 && routinesByProfile.default.jobs.length === 0
)
check('and carries the scheduler flag through', routinesByProfile.zulu.running === true)

h.responses['cron.manage'] = () => {
  throw new Error('profile down')
}
const routinesDown = await __internals.fetchRoutines(['ghost'])

check(
  'a profile whose cron backend is down reports no jobs, not an error',
  routinesDown.ghost.jobs.length === 0 && routinesDown.ghost.running === null
)

// The pane's own render.
h.responses['cron.manage'] = ({ profile }) => ({
  count: profile === 'zulu' ? 2 : 0,
  gateway_running: profile === 'zulu',
  jobs:
    profile === 'zulu'
      ? [
          {
            enabled: true,
            job_id: 'job-1',
            name: 'Daily Briefing',
            next_run_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
            schedule: 'every 1440m',
            state: 'scheduled'
          },
          { enabled: false, job_id: 'job-2', name: 'Paused thing', schedule: '0 7 * * *', state: 'paused' }
        ]
      : []
})

// The first render registers the query; the second draws its answer.
renderToStaticMarkup(routinesPane.render())
const routinesQuery = h.queries.filter(q => (q.queryKey || [])[1] === 'routines').pop() || {}
h.queryResults[(routinesQuery.queryKey || []).join('|')] = {
  data: await __internals.fetchRoutines(['zulu', 'default', 'ghost']),
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
markup = renderToStaticMarkup(routinesPane.render())

check('the pane names the profile whose jobs it shows', markup.includes('>zulu<'), markup.slice(0, 400))
// Pedro, 2026-10-09: "in the scheduled jobs pane, you can remove the profile
// list. The shown scheduled jobs should be according to the selected profile on
// the left pane." So no picker in here — and the tile obeys the selection the
// LEFT pane made rather than a choice of its own.
check(
  'the pane carries no profile picker of its own',
  (markup.match(/rounded-full border px-2/g) || []).length === 0 && !markup.includes('>ghost<'),
  markup.slice(0, 300)
)

__internals.$routineProfile.set('default')
const followed = renderToStaticMarkup(routinesPane.render())

__internals.$routineProfile.set(null)

check(
  'the tile follows the profile the left pane has selected',
  followed.includes('>default<') && !followed.includes('Daily Briefing'),
  followed.slice(0, 400)
)

// The cards, as Bot Mode draws them: dot, title, switch, delete, the schedule
// as a calendar pill, the next run in words.
check('a job is listed by name', /Daily Briefing/.test(markup))
check('the schedule pill speaks human, not raw cron', markup.includes('>daily<') && !markup.includes('every 1440m'))
check('an active job carries a checked switch', markup.includes('data-state="checked"'))
check('a paused job is marked as such', markup.includes('>paused<') && markup.includes('data-state="unchecked"'))
check('the next run reads as time ahead, not a timestamp', /in \d+ hr/.test(markup))
check('each job is addressable and deletable', /data-job="job-1"/.test(markup) && markup.includes('data-codicon="trash"'))
check(
  'the pane asks for the profile-on-show screen',
  h.queries.some(q => (q.queryKey || []).join('|') === 'personae|screen|zulu'),
  JSON.stringify(h.queries.map(q => (q.queryKey || []).join('|')).filter(k => k.startsWith('personae|screen')))
)

// The live screen preview itself: a running screen paints the frame and says
// it is live.
h.queryResults['personae|screen|zulu'] = {
  data: { installed: true, lease: { holder: 'agent' }, profile_key: 'zulu', running: true, supported: true },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
h.queryResults['personae|screen-frame|zulu'] = {
  data: { data_url: 'data:image/jpeg;base64,FRAME' },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
markup = renderToStaticMarkup(routinesPane.render())
check('a running screen paints its live frame', markup.includes('data:image/jpeg;base64,FRAME'))
check(
  'the hero polls the thumbnail for the profile on show',
  h.queries.some(q => (q.queryKey || []).join('|') === 'personae|screen-frame|zulu'),
  JSON.stringify(h.queries.map(q => (q.queryKey || []).join('|')).filter(k => k.startsWith('personae|screen')))
)

// A human on the screen: the frame is withheld, and the pane says why instead
// of showing a stale picture as live.
h.queryResults['personae|screen-frame|zulu'] = {
  data: { data_url: null, suppressed: 'human_has_control' },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
markup = renderToStaticMarkup(routinesPane.render())
check('a withheld frame says why, and is not shown', !markup.includes('FRAME') && markup.includes('Hidden'), markup.slice(0, 300))

// A stopped screen is not a black box with no explanation.
h.queryResults['personae|screen|zulu'] = {
  data: { installed: true, lease: { holder: 'agent' }, profile_key: 'zulu', running: false, supported: true },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
markup = renderToStaticMarkup(routinesPane.render())
check('a stopped screen says it is stopped', markup.includes('Screen stopped'))

// An older Hermes without display.*: the whole hero goes away rather than
// sitting in "connecting" forever.
h.queryResults['personae|screen|zulu'] = {
  data: undefined,
  error: { code: -32601, message: 'method not found' },
  isError: true,
  isFetching: false,
  isPending: false
}
markup = renderToStaticMarkup(routinesPane.render())
check(
  'a build with no Screen surface shows no hero at all',
  !markup.includes('Screen stopped') && !markup.includes('>Live<') && !markup.includes('Screen')
)

/* ── 22. THE SCREEN PANE DRIVES THE SCREEN ──────────────────────────────────
 * Pedro, 2026-10-15: the Screen tab was a JPEG and the sentence "go to Bot
 * Mode". These checks pin the replacement: the verbs, the handshake, the frame
 * decoder, the input gate and the lease — the things that have to be right
 * before a live view is worth a single click. */

const bytes = (...parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0

  parts.forEach(part => {
    out.set(part, at)
    at += part.length
  })

  return out
}
const u16 = value => {
  const out = new Uint8Array(2)

  new DataView(out.buffer).setUint16(0, value)

  return out
}
const u32 = value => {
  const out = new Uint8Array(4)

  new DataView(out.buffer).setUint32(0, value)

  return out
}
const i32 = value => {
  const out = new Uint8Array(4)

  new DataView(out.buffer).setInt32(0, value)

  return out
}
/** The pixel format the pane ASKS for, as a ServerInit block — so the fixture
 *  and the viewer cannot drift apart without a check failing. */
const rfbFormatBlock = () => __internals.rfbFormatBytes(__internals.rfbRequestedFormat())
const rfbInit = (width, height, name = '') => {
  const label = new TextEncoder().encode(name)
  const out = bytes(u16(width), u16(height), rfbFormatBlock(), u32(label.length), label)

  return out
}
/** 32bpp little-endian pixels are B, G, R, X on the wire — the shift order the
 *  pane negotiates (blue 0 / green 8 / red 16). */
const rfbPixel = (red, green, blue) => new Uint8Array([blue, green, red, 0])
const rfbRawUpdate = rects =>
  bytes(
    new Uint8Array([0, 0]),
    u16(rects.length),
    ...rects.flatMap(rect => [u16(rect.x), u16(rect.y), u16(rect.width), u16(rect.height), i32(0), rect.pixels])
  )
const rfbCopyUpdate = (destX, destY, sourceX, sourceY, width, height) =>
  bytes(new Uint8Array([0, 0]), u16(1), u16(destX), u16(destY), u16(width), u16(height), i32(1), u16(sourceX), u16(sourceY))
const rfbHandshake = (minor = 8) => bytes(new TextEncoder().encode(`RFB 003.00${minor}\n`), new Uint8Array([1, 1]), u32(0), rfbInit(2, 2, 'xvnc'))

const makeStream = () => {
  const box = { frames: [], notes: [], pixels: null, sent: [], size: null }

  box.stream = __internals.createRfbStream({
    onFramebuffer: frame => box.frames.push(frame),
    onNote: note => box.notes.push(note),
    onSize: size => {
      box.size = size
      box.pixels = new Uint8ClampedArray(size.width * size.height * 4)

      return box.pixels
    },
    send: part => box.sent.push(part)
  })

  return box
}
const readyStream = () => {
  const box = makeStream()

  box.stream.feed(rfbHandshake())

  return box
}

// ── the handshake: fixed-size, because Xvnc runs -SecurityTypes None ────────

const shaken = makeStream()

shaken.stream.feed(rfbHandshake())
check('the viewer answers the server version', new TextDecoder().decode(shaken.sent[0]) === 'RFB 003.008\n')
check('…then picks None from the security list', shaken.sent[1].length === 1 && shaken.sent[1][0] === 1)
check(
  '…then sends ClientInit, the third handshake byte the bridge counts on',
  shaken.sent[2].length === 1 && shaken.sent[2][0] === 1,
  `sent so far: ${shaken.sent.map(part => part.length).join(',')}`
)
check(
  '…asks for a 32bpp little-endian truecolour format it can decode',
  shaken.sent[3].length === 20 && shaken.sent[3][4] === 32 && shaken.sent[3][6] === 0 && shaken.sent[3][7] === 1
)
check(
  '…advertises Raw and CopyRect ONLY',
  shaken.sent[4].length === 12 &&
    new DataView(shaken.sent[4].buffer).getUint16(2) === 2 &&
    new DataView(shaken.sent[4].buffer).getInt32(4) === 0 &&
    new DataView(shaken.sent[4].buffer).getInt32(8) === 1
)
check('…and asks for one full frame', shaken.sent[5].length === 10 && shaken.sent[5][0] === 3 && shaken.sent[5][1] === 0)
check('ServerInit sizes the framebuffer', shaken.size.width === 2 && shaken.size.height === 2 && shaken.pixels.length === 16)
check('the server name is consumed with it, not left to desync the stream', shaken.stream.state === 'ready')

// A 3.3 server: no security list, and 13 handshake bytes against the 14 the
// gateway's bridge counts. It cannot be spliced — say so rather than hang.
const old = makeStream()

old.stream.feed(bytes(new TextEncoder().encode('RFB 003.003\n'), u32(1), rfbInit(1, 1)))
check(
  'a 3.3 screen is refused with the reason, not left hanging',
  old.stream.state === 'dead' && /3\.3/.test(old.notes.join(' ')) && old.sent.length === 0
)

// A screen that wants a password is a settled NO, said out loud.
const secured = makeStream()

secured.stream.feed(bytes(new TextEncoder().encode('RFB 003.008\n'), new Uint8Array([1, 2])))
check(
  'a password-protected screen is refused with a reason, not silence',
  secured.stream.state === 'dead' && /authentication/.test(secured.notes.join(' '))
)

const garbage = makeStream()

garbage.stream.feed(new TextEncoder().encode('HTTP/1.1 404 Not Found\n'))
check('a non-RFB greeting is named as such', garbage.stream.state === 'dead' && /not RFB/.test(garbage.notes.join(' ')))

// ── frames: decoded, painted, and paced one request at a time ──────────────

const framed = readyStream()

framed.stream.feed(
  rfbRawUpdate([{ height: 2, pixels: bytes(rfbPixel(255, 0, 0), rfbPixel(0, 255, 0), rfbPixel(0, 0, 255), rfbPixel(255, 255, 255)), width: 2, x: 0, y: 0 }])
)
check(
  'a raw rectangle lands as RGBA in the canvas buffer',
  framed.pixels[0] === 255 && framed.pixels[1] === 0 && framed.pixels[2] === 0 && framed.pixels[3] === 255 &&
    framed.pixels[4] === 0 && framed.pixels[5] === 255 &&
    framed.pixels[8] === 0 && framed.pixels[10] === 255 &&
    framed.pixels[12] === 255 && framed.pixels[13] === 255 && framed.pixels[14] === 255
)
check('the frame is announced to the pane', framed.frames.length === 1 && framed.frames[0].rects.length === 1)
check('NOTHING is requested while a frame is unpainted', framed.sent.length === 6, `sent=${framed.sent.length}`)

framed.stream.ack()
check(
  '…and the next request exists only after the paint, and is incremental',
  framed.sent.length === 7 && framed.sent[6][1] === 1,
  `sent=${framed.sent.length}`
)

// The same bytes arriving one at a time — a WebSocket does not respect message
// boundaries, so a viewer that only parses whole chunks renders nothing.
const trickled = readyStream()
const trickleBytes = rfbRawUpdate([{ height: 1, pixels: bytes(rfbPixel(9, 8, 7), rfbPixel(6, 5, 4)), width: 2, x: 0, y: 0 }])

for (let index = 0; index < trickleBytes.length; index += 1) {
  trickled.stream.feed(trickleBytes.slice(index, index + 1))
}

check('a frame split across many chunks still lands', trickled.frames.length === 1 && trickled.pixels[0] === 9 && trickled.pixels[4] === 6)

// CopyRect: the one encoding that is a memcpy in our own canvas — and the one
// that smears if the overlap is copied top-down.
const scrolled = readyStream()

scrolled.stream.feed(
  rfbRawUpdate([{ height: 2, pixels: bytes(rfbPixel(1, 1, 1), rfbPixel(2, 2, 2), rfbPixel(3, 3, 3), rfbPixel(4, 4, 4)), width: 2, x: 0, y: 0 }])
)
scrolled.stream.ack()
scrolled.stream.feed(rfbCopyUpdate(0, 0, 0, 1, 2, 1))
check(
  'a CopyRect moves pixels instead of re-sending them',
  scrolled.pixels[0] === 3 && scrolled.pixels[4] === 4 && scrolled.pixels[8] === 3,
  `${scrolled.pixels.slice(0, 12).join(',')}`
)

// Everything we do not decode still has to be consumed, or the next real
// rectangle is read out of the middle of a clipboard payload.
const mixed = readyStream()

mixed.stream.feed(new Uint8Array([2])) // Bell
mixed.stream.feed(bytes(new Uint8Array([1, 0]), u16(0), u16(2), new Uint8Array(12))) // SetColourMapEntries
mixed.stream.feed(bytes(new Uint8Array([3, 0, 0, 0]), u32(4), new TextEncoder().encode('text'))) // ServerCutText
mixed.stream.feed(rfbRawUpdate([{ height: 1, pixels: bytes(rfbPixel(7, 7, 7), rfbPixel(7, 7, 7)), width: 2, x: 0, y: 0 }]))
check('Bell, colour map and clipboard are skipped without losing alignment', mixed.frames.length === 1 && mixed.pixels[0] === 7)

const stranger = readyStream()

stranger.stream.feed(bytes(new Uint8Array([9, 0, 0, 0])))
check(
  'a message this viewer does not speak stops the view and says so',
  stranger.stream.state === 'dead' && /message type 9/.test(stranger.notes.join(' '))
)

// ── the decoder itself, outside the stream ─────────────────────────────────

const wide = new Uint8ClampedArray(8)

__internals.decodeRawRect(bytes(rfbPixel(255, 128, 0), rfbPixel(0, 0, 255)), 0, __internals.rfbRequestedFormat(), wide, 0, 2, 1, 8)
check('the 32bpp decoder scales nothing it should not', wide[0] === 255 && wide[1] === 128 && wide[2] === 0 && wide[3] === 255 && wide[4] === 0 && wide[5] === 0 && wide[6] === 255 && wide[7] === 255)

// 16bpp 5-6-5, the format a legacy Xvnc hands out if it ignores our request.
const short = new Uint8ClampedArray(4)
const fiveSixFive = { bigEndian: false, blueMax: 31, blueShift: 0, bpp: 16, depth: 16, greenMax: 63, greenShift: 5, redMax: 31, redShift: 11, trueColour: true }
const packed = 0xf800 // pure red in 5-6-5

__internals.decodeRawRect(new Uint8Array([packed & 0xff, packed >> 8]), 0, fiveSixFive, short, 0, 1, 1, 4)
check('a 16bpp 5-6-5 pixel is scaled to full range', short[0] === 255 && short[1] === 0 && short[2] === 0 && short[3] === 255)

// An overlapping CopyRect, which is exactly what scrolling produces.
const overlap = new Uint8ClampedArray(16)

overlap.set([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255])
__internals.copyRectRegion(overlap, 16, { destX: 2, destY: 0, height: 1, sourceX: 0, sourceY: 0, width: 2 })
check('an overlapping CopyRect does not smear its own source rows', overlap[0] === 1 && overlap[8] === 1 && overlap[12] === 2)

// ── input: keysyms, masks, and who is allowed to send them ─────────────────

check(
  'printable keys ride their own code point, named keys their keysym',
  __internals.keysymFor('a', 'KeyA') === 97 &&
    __internals.keysymFor('A', 'KeyA') === 65 &&
    __internals.keysymFor('Enter', 'Enter') === 0xff0d &&
    __internals.keysymFor('ArrowLeft', 'ArrowLeft') === 0xff51 &&
    __internals.keysymFor('F5', 'F5') === 0xffc2 &&
    __internals.keysymFor('3', 'Numpad3') === 0xffb3
)
check('a key this viewer cannot name sends NOTHING rather than a wrong key', __internals.keysymFor('Unidentified', 'Unidentified') === 0)
check(
  'a press carries its modifiers first, a release drops them last',
  JSON.stringify(__internals.keysymsForEvent({ code: 'KeyC', ctrlKey: true, key: 'c' }, true)) === '[65507,99]' &&
    JSON.stringify(__internals.keysymsForEvent({ code: 'KeyC', ctrlKey: true, key: 'c' }, false)) === '[99,65507]'
)
check(
  'DOM button bits become RFB mask bits',
  __internals.pointerMaskFor(1) === 1 && __internals.pointerMaskFor(2) === 4 && __internals.pointerMaskFor(4) === 2 && __internals.pointerMaskFor(3) === 5
)
check('a wheel tick is a transient RFB mask', __internals.wheelMaskFor(-1) === 8 && __internals.wheelMaskFor(1) === 16 && __internals.wheelMaskFor(0) === 0)
check(
  'KeyEvent and PointerEvent are exactly the sizes the bridge parses',
  __internals.rfbKeyMessage(true, 0xff0d).length === 8 &&
    __internals.rfbPointerMessage(5, 3, 7).length === 6 &&
    __internals.rfbUpdateRequest({ height: 900, width: 1440, x: 0, y: 0 }, true).length === 10
)

// ── the lease: who is driving ──────────────────────────────────────────────

const ourHash = await __internals.viewerHashOf('VIEWER-1')

check('the viewer hash is 12 hex digits, derived from the id', /^[0-9a-f]{12}$/.test(ourHash) && ourHash === (await __internals.viewerHashOf('VIEWER-1')))
check(
  'the lease is ours only when its hash is ours',
  __internals.leaseHeldBy({ holder: 'human', viewer_hash: ourHash }, ourHash) === true &&
    __internals.leaseHeldBy({ holder: 'human', viewer_hash: 'someoneelse' }, ourHash) === false &&
    __internals.leaseHeldBy({ holder: 'agent' }, ourHash) === false &&
    __internals.leaseHeldBy(null, ourHash) === false
)
check(
  'a closed view is classified by the code the bridge sends',
  __internals.screenCloseVerdict(4000, 'control-taken').mode === 'watch' &&
    __internals.screenCloseVerdict(4000).reobserve === true &&
    __internals.screenCloseVerdict(4001).mode === 'stopped' &&
    __internals.screenCloseVerdict(4401).reobserve === true &&
    __internals.screenCloseVerdict(4403).mode === 'error' &&
    __internals.screenCloseVerdict(1000).mode === 'idle' &&
    /9999/.test(__internals.screenCloseVerdict(9999).note)
)

// ── the verbs, from one status snapshot ────────────────────────────────────

const stopped = __internals.screenVerbState({ installed: true, lease: { holder: 'agent' }, running: false, supported: true })
const uninstalled = __internals.screenVerbState({ installed: false, lease: { holder: 'agent' }, running: false, supported: true })
const driving = __internals.screenVerbState({ installed: true, lease: { holder: 'agent' }, running: true, supported: true })
const someone = __internals.screenVerbState({ installed: true, lease: { holder: 'human', viewer_hash: 'other' }, running: true, supported: true })

check('a stopped screen offers Start, not Stop', stopped.canStart && !stopped.canStop && !stopped.canInstall)
check('a screen with no packages offers Install, not Start', uninstalled.canInstall && !uninstalled.canStart)
check('a running screen offers Stop', driving.canStop && driving.running && driving.tone === 'live')
check("someone else's hands are a tone of their own", someone.tone === 'other' && someone.canStop)
check(
  'an unsupported host offers nothing at all',
  !__internals.screenVerbState({ installed: false, running: false, supported: false }).canInstall &&
    __internals.screenVerbState(null, true).tone === 'unavailable'
)
check(
  'a host that cannot afford the screen carries its reason',
  __internals.screenVerbState({ blocker: 'not enough memory', installed: true, running: false, supported: true }).blocker === 'not enough memory'
)
check(
  'ANY human lease makes Stop a question — whose hands only change the wording',
  __internals.screenStopQuestion({ lease: { holder: 'human', viewer_hash: 'other' } }, ourHash) === 'screenStopForce' &&
    __internals.screenStopQuestion({ lease: { holder: 'human', viewer_hash: ourHash } }, ourHash) === 'screenStopForceSelf' &&
    __internals.screenStopQuestion({ lease: { holder: 'agent' } }, ourHash) === '' &&
    __internals.screenStopQuestion(null, ourHash) === '',
  JSON.stringify([
    __internals.screenStopQuestion({ lease: { holder: 'human', viewer_hash: ourHash } }, ourHash),
    __internals.screenStopQuestion({ lease: { holder: 'agent' } }, ourHash)
  ])
)
check(
  'each verb sends exactly the keys the wire declares (4013/4000 on anything else)',
  JSON.stringify(Object.keys(__internals.screenStopParams('zulu', true)).sort()) === '["force","profile"]'
)

// ── the pane itself ────────────────────────────────────────────────────────

const screenStatus = (data, error = null) => {
  h.queryResults['personae|screen|zulu'] = { data, error, isError: Boolean(error), isFetching: false, isPending: false }
}
const screenMarkup = () => renderToStaticMarkup(jsx(__internals.ScreenView, { profile: 'zulu' }))

screenStatus({ blocker: 'not enough free memory to start a screen', installed: true, lease: { holder: 'agent' }, profile_key: 'zulu', running: false, supported: true })
let screenHtml = screenMarkup()

check(
  'the pane offers Start for a stopped screen, and a Take over it cannot honour is DISABLED',
  screenHtml.includes('>Start<') && /disabled=""[^>]*>Take over</.test(screenHtml),
  screenHtml.slice(0, 400)
)
check('…and explains a host that cannot start one instead of offering a dead button', screenHtml.includes('not enough free memory'))
check('…and says the view is empty because the screen is not running', screenHtml.includes('The screen is not running'))
check('the empty stage still carries the canvas the stream paints into', screenHtml.includes('data-personae-screen'))

screenStatus({ installed: false, lease: { holder: 'agent' }, profile_key: 'zulu', running: false, supported: true })
screenHtml = screenMarkup()
check('a profile with no packages at all is offered the install', screenHtml.includes('>Install<') && !screenHtml.includes('>Start<'))

screenStatus({ geometry: '1440x900', installed: true, lease: { holder: 'agent' }, profile_key: 'zulu', running: true, supported: true })
screenHtml = screenMarkup()
check('a running screen offers Stop AND Take over', screenHtml.includes('>Stop<') && screenHtml.includes('>Take over<'))
check('…and reports the geometry it is drawing', screenHtml.includes('1440x900'))

screenStatus(undefined, { code: -32601, message: 'method not found' })
screenHtml = screenMarkup()
check(
  'a Hermes with no display.* says so instead of hanging in "connecting"',
  !screenHtml.includes('>Start<') && !screenHtml.includes('>Install<') && screenHtml.includes('data-personae-screen')
)

// The install log: module state, so a tab that closed mid-install still shows
// what the host actually did.
__internals.resetScreenInstall()
screenStatus({ installed: false, lease: { holder: 'agent' }, profile_key: 'zulu', running: false, supported: true })
check('no install has happened, so there is no log on screen', !screenMarkup().includes(h.i18n.screenInstallLog))

__internals.noteScreenInstallLog({ line: 'Reading package lists…' })
screenHtml = screenMarkup()
check('an install line reaches the pane while it streams', screenHtml.includes(h.i18n.screenInstallLog) && screenHtml.includes('Reading package lists…'))

__internals.noteScreenInstallDone({ code: 0 })
check('the finish line is translated, not raw English', screenMarkup().includes(h.i18n.screenInstallDone))

__internals.noteScreenInstallDone({ code: 1 })
check('a failed install says failed', screenMarkup().includes(h.i18n.screenInstallFailed))

check(
  'the log is bounded — a chatty package manager cannot grow the pane forever',
  (() => {
    __internals.resetScreenInstall()

    for (let index = 0; index < 120; index += 1) {
      __internals.noteScreenInstallLog({ line: `line ${index}` })
    }

    const state = __internals.$screenInstall.get()

    return state.lines.length === 80 && state.lines[79].text === 'line 119'
  })()
)
__internals.resetScreenInstall()

// The tab the hero opens: it renders the pane, and a second click focuses the
// tab that already exists instead of stacking another one.
const openedBefore = h.workspaces.length

__internals.openScreenPane('zulu', 'Screen')
check('the hero opens a Screen tab for that profile', h.workspaces.length === openedBefore + 1 && h.workspaces.at(-1).id === 'personae:screen:zulu')
check('…and the tab really contains the pane', renderToStaticMarkup(h.workspaces.at(-1).options.render()).includes('data-personae-screen'))
check('…titled with the profile', h.workspaces.at(-1).options.title.includes('zulu'))

const revealedBefore = h.revealed.length

__internals.openScreenPane('zulu', 'Screen')
check('a second open reveals the existing tab rather than stacking one', h.workspaces.length === openedBefore + 1 && h.revealed.length === revealedBefore + 1)

// ── leaving the tab: a surface that takes the chat area needs a way out ────
// Pedro, 2026-10-16: "I didn't really have a way to come back to this chat
// without clicking on the session list."

check(
  'the DURABLE id wins for "back" — a runtime id would resolve to nothing',
  JSON.stringify(__internals.screenBackTarget({ activeSessionId: 'runtime-1', focusedSessionProfile: 'zulu', focusedStoredSessionId: 'stored-1' }, 'default')) === '{"id":"stored-1","profile":"zulu"}' &&
    JSON.stringify(__internals.screenBackTarget({ activeSessionId: 'runtime-1' }, 'default')) === '{"id":"runtime-1","profile":"default"}' &&
    __internals.screenBackTarget({}, 'default') === null &&
    __internals.screenBackTarget(null, 'default') === null
)

h.opens.length = 0
check(
  'back navigates to that exact session, on that session OWNER profile',
  __internals.screenBackToSession({ id: 'stored-1', profile: 'zulu' }) === true &&
    JSON.stringify(h.opens.at(-1)) === '{"id":"stored-1","options":{"profile":"zulu"}}',
  JSON.stringify(h.opens)
)
check('with nothing to go back to, nothing navigates', __internals.screenBackToSession(null) === false && h.opens.length === 1)

host.state.focusedStoredSessionId.set('stored-chat-1')
host.state.focusedSessionProfile.set('yankee')
__internals.openScreenPane('yankee', 'Screen')

const leaveHtml = renderToStaticMarkup(h.workspaces.at(-1).options.render())

check(
  'the pane carries its own way back to the session it displaced',
  leaveHtml.includes(`>${h.i18n.screenBack}</span>`) && leaveHtml.includes('data-codicon="arrow-left"'),
  leaveHtml.slice(0, 300)
)
check(
  '…and its own way out, through the tab teardown the strip ✕ runs',
  leaveHtml.includes(`>${h.i18n.close}</span>`) && leaveHtml.includes('data-codicon="close"')
)
check(
  'closing from the pane runs that teardown exactly once',
  __internals.closeScreenPane('yankee') === true && __internals.closeScreenPane('yankee') === false
)

// Nothing focused when the hero was clicked (a fresh draft): no dangling
// "back" pointing at nothing, but the way OUT is always there.
host.state.focusedStoredSessionId.set(null)
host.state.activeSessionId.set(null)
__internals.openScreenPane('xray', 'Screen')

const bareHtml = renderToStaticMarkup(h.workspaces.at(-1).options.render())

check(
  'a fresh draft leaves nothing to go back to, and the way out stays',
  !bareHtml.includes(h.i18n.screenBack) && bareHtml.includes(`>${h.i18n.close}</span>`)
)
__internals.closeScreenPane('xray')

// ── the session: ticket, socket, lease, keys ───────────────────────────────

const sockets = []

class FakeSocket {
  constructor(url) {
    this.closed = null
    this.sent = []
    this.url = url
    sockets.push(this)
  }

  send(part) {
    this.sent.push(part)
  }

  close(code, reason) {
    this.closed = { code, reason }
    this.onclose?.({ code, reason })
  }
}

const realWebSocket = globalThis.WebSocket

globalThis.WebSocket = FakeSocket

let tickets = 0

h.responses['display.observe'] = () => ({ path: '/api/display/ws', ticket: `TICKET-${++tickets}`, viewer_id: 'VIEWER-1' })
h.responses['display.lease.acquire'] = () => ({ lease: { epoch: 1, holder: 'human', since: 0, viewer_hash: ourHash } })
h.responses['display.lease.release'] = () => ({ lease: { epoch: 2, holder: 'agent', since: 0, viewer_hash: null } })

const session = __internals.createScreenSession()
const patched = {}
const api = { canvas: () => null, patch: changes => Object.assign(patched, changes), profile: 'zulu' }

await __internals.attachScreen(session, api)

check('attaching mints a viewer identity and keeps it', session.viewerId === 'VIEWER-1' && session.hash === ourHash)
check('…dials the display bridge, not the chat socket', sockets.length === 1 && sockets[0].url.startsWith('ws://harness.local/api/display/ws'))
check(
  '…with the ONE-SHOT display ticket the bridge authenticates on, and no gateway credential at all',
  /[?&]display_ticket=TICKET-1$/.test(sockets[0].url) && !/[?&]ticket=/.test(sockets[0].url),
  sockets[0].url
)
check(
  '…and the sibling resolver was asked to strip the gateway credential',
  h.siblingUrls.at(-1).path === '/api/display/ws' && h.siblingUrls.at(-1).options.stripGatewayCredential === true && h.siblingUrls.at(-1).route.profile === 'zulu'
)
check('watching is a state the pane knows', patched.mode === 'watching' && patched.watching === true)
check('attaching twice does not open a second view', (await __internals.attachScreen(session, api)) === session && sockets.length === 1)

check('taking over acquires the lease for THIS viewer', (await __internals.screenLease(session, api, 'take')) === true)
check(
  '…and the RPC names the profile and the viewer id',
  h.requests.at(-1).method === 'display.lease.acquire' && h.requests.at(-1).params.profile === 'zulu' && h.requests.at(-1).params.viewer_id === 'VIEWER-1'
)
check('handing back releases the same viewer', (await __internals.screenLease(session, api, 'release')) === false && h.requests.at(-1).method === 'display.lease.release')
check(
  'acquire sends `reason`, release does NOT — the wire rejects an unknown key with 4000',
  JSON.stringify(Object.keys(h.requests.filter(entry => entry.method === 'display.lease.acquire').at(-1).params).sort()) === '["profile","reason","viewer_id"]' &&
    JSON.stringify(Object.keys(h.requests.filter(entry => entry.method === 'display.lease.release').at(-1).params).sort()) === '["profile","viewer_id"]',
  JSON.stringify(h.requests.filter(entry => entry.method.startsWith('display.lease')).map(entry => [entry.method, Object.keys(entry.params)]))
)

const before = sockets[0].sent.length

__internals.forwardKey(session, { code: 'KeyA', key: 'a', preventDefault() {} }, true)
check('a keystroke reaches the screen as a KeyEvent', sockets[0].sent.length === before + 1 && sockets[0].sent.at(-1).length === 8 && sockets[0].sent.at(-1)[1] === 1)
check('…and is remembered as held', session.held.size === 1)
check('losing the lease or the focus releases the keys it held', __internals.releaseHeldKeys(session) === 1 && sockets[0].sent.at(-1)[1] === 0 && session.held.size === 0)

__internals.detachScreen(session, api.patch)
check('detaching closes the socket it owns', session.socket === null && sockets[0].closed.code === 1000)

// A view whose ticket expired mints a NEW one: reconnecting with a spent ticket
// is a guaranteed 4401 loop, which is the bug this retry exists to avoid.
patched.mode = 'watching'
const retrySession = __internals.createScreenSession()
const retryNotes = []
const retryApi = {
  canvas: () => null,
  patch: changes => {
    Object.assign(patched, changes)

    if (changes.note) {
      retryNotes.push(changes.note)
    }
  },
  profile: 'zulu'
}
const socketsBefore = sockets.length

await __internals.attachScreen(retrySession, retryApi)
retrySession.socket.onclose({ code: 4401, reason: 'display ticket missing, expired or used' })
check('an expired ticket is named as the cause before anything is retried', retryNotes.includes('the view ticket expired'), JSON.stringify(retryNotes))
await new Promise(resolve => setTimeout(resolve, 700))
check('…and asks for a FRESH one instead of giving up', sockets.length === socketsBefore + 2 && sockets.at(-1).url.includes('display_ticket=TICKET-3'))
check('…and the retry lands back in watch mode', patched.mode === 'watching')
__internals.detachScreen(retrySession, retryApi.patch)

// A stop the pane caused must not be reported as a verdict about the view.
const quietSession = __internals.createScreenSession()

await __internals.attachScreen(quietSession, api)
Object.assign(patched, { mode: 'watching', note: '' })
__internals.detachScreen(quietSession, api.patch)
check('closing the pane yourself never paints a failure over it', patched.mode === 'idle' && patched.note === '')

globalThis.WebSocket = realWebSocket

// Leave the screen query in a state the NEXT section can render: the fake
// socket and the display responses above are this section's, not theirs.
globalThis.WebSocket = realWebSocket
h.queryResults['personae|screen|zulu'] = {
  data: { installed: true, lease: { holder: 'agent' }, profile_key: 'zulu', running: false, supported: true },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}

// The pure contracts behind the cards.
check('schedules are named the way Bot Mode names them', __internals.scheduleLabel('every 1440m') === 'daily' && __internals.scheduleLabel('every 120m') === 'every 2 hours' && __internals.scheduleLabel('every 30m') === 'every 30m' && __internals.scheduleLabel('once in 2h') === '2h' && __internals.scheduleLabel('0 6 * * *') === '0 6 * * *')
check('relative time runs both ways', /^in \d+ hr\.?$/.test(__internals.relTime(Date.now() + 3 * 3600e3, Date.now())) && /ago\.?$/.test(__internals.relTime(Date.now() - 2 * 3600e3, Date.now())))

const detailJob = {
  deliver: 'bot-chat:zulu',
  enabled: true,
  job_id: 'job-1',
  last_run_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
  last_status: 'ok',
  model: 'deepseek-flash',
  name: 'Daily Briefing',
  next_run_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  repeat: 3,
  schedule: 'every 1440m',
  state: 'scheduled',
  workdir: '/home/x'
}
const rowsOf = job => __internals.routineRows(job, Date.now(), key => key)
const rowMap = Object.fromEntries(rowsOf(detailJob))

check(
  'the inspector carries every fact the payload sent',
  rowMap.status === 'routinesActive' &&
    rowMap.schedule === 'daily' &&
    rowMap.rawSchedule === 'every 1440m' &&
    rowMap.repeat === '3' &&
    rowMap.deliver === 'bot-chat:zulu' &&
    rowMap.model === 'deepseek-flash' &&
    rowMap.workdir === '/home/x',
  JSON.stringify(rowMap)
)
check('and the next run in words', /^in \d+ hr\.?$/.test(rowMap.nextRun), rowMap.nextRun)
check('a never-run job drops its last-run row instead of printing undefined', !__internals.routineRows({ job_id: 'x' }, Date.now(), key => key).some(([label]) => label === 'lastRun'))
check('a delivery failure is never a success', Object.fromEntries(__internals.routineRows({ ...detailJob, last_status: 'delivery_failed' }, Date.now(), key => key)).lastResult === 'resultDeliveryFailed')
check(
  'an overdue slot is named overdue, never promised as a next run',
  /ago\.?$/.test(
    Object.fromEntries(
      __internals.routineRows(
        { ...detailJob, next_run_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
        Date.now(),
        key => key
      )
    ).overdueSince
  )
)

// The pane's one write path, and the refetch it triggers.
const epochBefore = __internals.$routinesEpoch.get()
h.requests.length = 0
await __internals.routineAction('zulu', 'job-1', 'pause')
const pauseCall = h.requests.find(r => r.method === 'cron.manage')
check(
  'pause goes to the scheduler scoped to the job profile',
  pauseCall?.params?.action === 'pause' && pauseCall?.params?.name === 'job-1' && pauseCall?.params?.profile === 'zulu',
  JSON.stringify(pauseCall?.params)
)
check('and asks for fresh jobs', __internals.$routinesEpoch.get() === epochBefore + 1)

// A scheduler that is not running must not look like a healthy schedule.
// The key is read fresh: the epoch above moved the pane's query on, so the
// render that registers the new one has to happen before it can be answered.
renderToStaticMarkup(routinesPane.render())
const offlineKey = h.queries.filter(q => (q.queryKey || [])[1] === 'routines').pop().queryKey
h.queryResults[offlineKey.join('|')] = {
  data: {
    zulu: {
      jobs: [{ enabled: true, job_id: 'job-1', name: 'Daily', schedule: '* * * * *', state: 'scheduled' }],
      running: false
    }
  },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
markup = renderToStaticMarkup(routinesPane.render())

check(
  'an offline scheduler says so',
  markup.includes('Scheduler offline'),
  JSON.stringify({
    current: h.queries.filter(q => (q.queryKey || [])[1] === 'routines').pop()?.queryKey,
    tail: markup.slice(-300)
  })
)

delete h.responses['cron.manage']

// ── P8: opening a profile (item 8 + D-D) ────────────────────────────────────

const fakeRow = { name: 'zulu' }
const many = n => Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, resolved_id: `r-${i}` }))

h.opens.length = 0
await __internals.openProfileSessions(fakeRow, many(3))

check(
  'clicking a profile opens its newest session in the main pane',
  h.opens.length === 3 &&
    h.opens[2].id === 'r-0' &&
    h.opens[2].options.intent === 'main' &&
    h.opens[2].options.profile === 'zulu',
  JSON.stringify(h.opens)
)
check(
  'and docks the rest of its sessions beside it as tabs',
  h.opens.slice(0, 2).every(entry => entry.options.intent === 'tab')
)
check(
  'the main open comes last, so the click lands where it promised',
  h.opens[h.opens.length - 1].options.intent === 'main'
)

h.opens.length = 0
await __internals.openProfileSessions(fakeRow, many(14))

check(
  'one click cannot mint more than the dock cap',
  h.opens.length === 10 && h.opens.filter(entry => entry.options.intent === 'tab').length === 9,
  String(h.opens.length)
)

h.opens.length = 0
await __internals.openProfileSessions(fakeRow, [])

check('a profile with no sessions opens nothing', h.opens.length === 0)

// The menu's own verb: dock the lot, take the main pane over for nothing.
// (Its first argument is the PROFILE name, not a roster row — the menu knows
// which row it was opened from, the dock only ever needed the name.)
h.opens.length = 0
const dockedCount = await __internals.dockSessions('zulu', many(14))

check(
  '"Open all in tabs" docks the cap and no more',
  dockedCount === 10 && h.opens.every(entry => entry.options.intent === 'tab'),
  String(dockedCount)
)
check(
  'a session opens under its resolved runtime id when it has one',
  h.opens[0].id === 'r-0',
  h.opens[0]?.id
)

// Pedro, 2026-10-13 (item 2): "some session names are showing up as 'new session'
// instead of their actual name". The strip draws the title of each tab's STORED
// ROW, and a tile is filed into whichever per-profile bucket is visible when it
// is CREATED — so a dock for a profile the app was never moved to files its tabs
// under the profile the user came from, where no row exists to name them and
// every one of them sits on core's "New session" placeholder.
host.state.profile.set('default') // the app is on `default`; the dock is `zulu`
h.opens.length = 0
await __internals.dockSessions('zulu', many(3))

check(
  'a cross-profile dock moves the app with its first tab, and only that one',
  h.opens.length === 3 &&
    h.opens[0].options.keepAllProfilesScope === false &&
    h.opens.slice(1).every(entry => entry.options.keepAllProfilesScope === true),
  JSON.stringify(h.opens.map(entry => entry.options.keepAllProfilesScope))
)
check(
  'and every tab after the switch still files under the profile it belongs to',
  h.opens.every(entry => entry.options.profile === 'zulu' && entry.options.intent === 'tab'),
  JSON.stringify(h.opens)
)

host.state.profile.set('zulu')
h.opens.length = 0
await __internals.dockSessions('zulu', many(3))

check(
  'a dock inside the profile the app is already on moves nothing',
  h.opens.length === 3 && h.opens.every(entry => entry.options.keepAllProfilesScope === true),
  JSON.stringify(h.opens.map(entry => entry.options.keepAllProfilesScope))
)

host.state.profile.set('default')
h.opens.length = 0
await __internals.openProfileSessions(fakeRow, many(1))

check(
  'with no sessions to dock, the profile open carries the switch itself',
  h.opens.length === 1 &&
    h.opens[0].options.intent === 'main' &&
    h.opens[0].options.keepAllProfilesScope === false,
  JSON.stringify(h.opens)
)

host.state.profile.set('default')
h.opens.length = 0
await __internals.openProfileSessions({ name: 'default' }, many(1))

check(
  'and an open inside the current profile switches nothing',
  h.opens.length === 1 && !('keepAllProfilesScope' in h.opens[0].options),
  JSON.stringify(h.opens)
)

// ── D-D follow-up: a session click under ANOTHER profile (2026-10-13) ───────
// Core files session tabs into per-profile buckets and swaps the visible set
// when `$activeGatewayProfile` moves, so the strip can only hold the clicked
// profile's sessions once the app's OWN profile has moved there. The click is
// therefore a profile MOVE: open with `keepAllProfilesScope: false` — the SDK's
// explicit workspace-switch recipe — and only THEN dock the list.
//
// The order is the fix, so it is asserted rather than assumed: a tile is filed
// into whichever bucket is visible when it is CREATED, and the SDK's generation
// guard rejects a second dialing open ("superseded by a newer selection"). The
// first open below is therefore held open on purpose — nothing may dock before
// it settles.

const realOpen = host.openSession
const calls = []
let heldOpen = null
let releaseHeld = null

host.openSession = (id, options) => {
  calls.push(id)

  if (!heldOpen) {
    heldOpen = { id, options }

    return new Promise(resolve => {
      releaseHeld = () => {
        // The SDK activates the profile as part of the same open
        // (`requireActiveProfileForHydration`), so by the time it resolves the
        // app IS on `zulu` — which is why the dock that follows needs no switch
        // of its own.
        if (options.keepAllProfilesScope === false) host.state.profile.set(options.profile)

        return realOpen(id, options).then(resolve)
      }
    })
  }

  return realOpen(id, options)
}

host.state.profile.set('default') // the app is on `default`; the row is `zulu`
h.opens.length = 0
const switched = __internals.openSessionInProfile('zulu', many(14), 'r-3')

await Promise.resolve()

check(
  'a click into another profile switches the app profile with the open',
  heldOpen?.id === 'r-3' &&
    heldOpen?.options?.profile === 'zulu' &&
    heldOpen?.options?.keepAllProfilesScope === false,
  JSON.stringify(heldOpen)
)
check(
  'and docks nothing until that switch has landed',
  calls.length === 1 && h.opens.length === 0,
  JSON.stringify(calls)
)

releaseHeld()
await switched
host.openSession = realOpen

const switchMove = h.opens[0]
// The click now opens TWICE — once to carry the switch, once to land after the
// dock — so the tabs are "the opens with tab intent", not "everything after the
// first open".
const dockedTabs = h.opens.filter(entry => entry.options.intent === 'tab')

check(
  'the clicked session takes the main pane, with no tab intent',
  switchMove?.id === 'r-3' && switchMove?.options?.intent === undefined && switchMove?.options?.profile === 'zulu',
  JSON.stringify(switchMove)
)
check(
  'then the list docks beside it, minus the session already in front',
  dockedTabs.length === 10 &&
    dockedTabs.every(entry => entry.options.intent === 'tab' && entry.options.profile === 'zulu') &&
    !dockedTabs.some(entry => entry.id === 'r-3'),
  JSON.stringify(dockedTabs.map(entry => entry.id))
)
check(
  'and the dock adds no second switch — the move already happened',
  dockedTabs.every(entry => entry.options.keepAllProfilesScope === true),
  JSON.stringify(dockedTabs.map(entry => entry.options.keepAllProfilesScope))
)
check(
  'and the docked set is the list in order, capped at the dock limit',
  JSON.stringify(dockedTabs.map(entry => entry.id)) ===
    JSON.stringify(['r-0', 'r-1', 'r-2', 'r-4', 'r-5', 'r-6', 'r-7', 'r-8', 'r-9', 'r-10'])
)

// A click INSIDE the profile the app is already on stays what it always was:
// open the session, leave the strip alone — no switch, no re-dock.
host.state.profile.set('zulu')
h.opens.length = 0
await __internals.openSessionInProfile('zulu', many(14), 'r-5')

check(
  'a click inside the current profile just opens the session',
  h.opens.length === 1 &&
    h.opens[0].id === 'r-5' &&
    h.opens[0].options.intent === undefined &&
    h.opens[0].options.keepAllProfilesScope === undefined,
  JSON.stringify(h.opens)
)

// A row with nothing openable is a no-op, not a half-move.
h.opens.length = 0
await __internals.openSessionInProfile('zulu', many(3), '')

check('a click with no session id moves nothing', h.opens.length === 0)

host.state.profile.set('default')

// ── the pane's FIRST render: the inspector with no job (2026-10-09) ─────────
// `jsx(RoutineDetail, { job: detail })` CALLS the component while the parent
// builds its tree, so that body runs with `detail === null` before any card is
// clicked. The real `nextRunOverdueMs` reads `job.state` with no optional chain,
// so the path threw "Cannot read properties of null (reading 'state')" and took
// the entire Scheduled jobs pane down in the app — while 211 harness assertions
// stayed green, because the stub carried an optional chain the real SDK does not.

check(
  'the inspector renders nothing with no job selected',
  __internals.RoutineDetail({ job: null, nowMs: 0, onClose: () => {}, open: false }) === null
)
check(
  'and its rows helper reports no facts for a null job',
  JSON.stringify(__internals.routineRows(null, 0, key => key)) === '[]'
)
check(
  'the SDK stub stays exactly as null-hostile as the real nextRunOverdueMs',
  (() => {
    try {
      __internals.nextRunOverdueMs(null)

      return false
    } catch {
      return true
    }
  })(),
  'the stub softened the null case again: the app would crash while tests pass'
)
check(
  'the routine pane renders on a fresh mount with nothing selected',
  (() => {
    try {
      return renderToStaticMarkup(routinesPane.render()).length > 0
    } catch (error) {
      return `threw: ${error.message}`
    }
  })() === true
)
// ── P9: sort modes ─────────────────────────────────────────────────────────
// The fix Pedro asked for: 20 rows in whatever order the roster arrived is not
// a list, it is a dump. Every mode but `manual` is a TOTAL order (ties break on
// the profile name) so two profiles on the same last_active cannot swap places
// on each 5s poll and read as activity that is not happening.
const SORT_FIXTURE = [
  { lastActiveMs: 100, name: 'bravo', sessions: [{ id: 'b1' }] },
  { lastActiveMs: 300, name: 'alpha', sessions: [{ id: 'a1' }, { id: 'a2' }] },
  { messages: 3, name: 'delta' },
  { lastActiveMs: 200, name: 'charlie', sessions: [] }
]
const order = list => list.map(row => row.name).join(',')

check(
  'the default sort is last activity, newest first',
  order(__internals.sortRows(SORT_FIXTURE, 'activity')) === 'alpha,charlie,bravo,delta',
  order(__internals.sortRows(SORT_FIXTURE, 'activity'))
)
check(
  'a profile that never moved sinks below one that did',
  order(__internals.sortRows(SORT_FIXTURE, 'activity')).endsWith('bravo,delta')
)
check(
  'sort by name is alphabetical',
  order(__internals.sortRows(SORT_FIXTURE, 'name')) === 'alpha,bravo,charlie,delta'
)
check(
  'sort by sessions counts the roster list, falling back to the message count',
  order(__internals.sortRows(SORT_FIXTURE, 'sessions')) === 'delta,alpha,bravo,charlie',
  order(__internals.sortRows(SORT_FIXTURE, 'sessions'))
)
check(
  'manual sort follows the saved order and sinks the unknown',
  order(__internals.sortRows(SORT_FIXTURE, 'manual', ['delta', 'alpha'])) === 'delta,alpha,bravo,charlie',
  order(__internals.sortRows(SORT_FIXTURE, 'manual', ['delta', 'alpha']))
)
check(
  'an unknown mode falls back to last activity instead of doing nothing',
  order(__internals.sortRows(SORT_FIXTURE, 'nonsense')) === 'alpha,charlie,bravo,delta'
)
check(
  'sortRows never reorders the caller\'s array',
  order(SORT_FIXTURE) === 'bravo,alpha,delta,charlie',
  order(SORT_FIXTURE)
)
check(
  'ties break on the profile name, so a poll cannot swap equal rows',
  order(__internals.sortRows([{ lastActiveMs: 5, name: 'zed' }, { lastActiveMs: 5, name: 'abe' }], 'activity')) ===
    'abe,zed'
)

const groupHeading = renderToStaticMarkup(
  jsx(__internals.SectionHeading, {
    block: { collapsed: false, id: 'sec-1', name: 'Clients', rows: [{ name: 'zulu' }], scope: 'sec-1' },
    index: 0,
    onAddProfiles: () => {},
    onDelete: () => {},
    onMove: () => {},
    onRename: () => {},
    onSort: () => {},
    scopeCount: 2,
    sort: 'name'
  })
)

check(
  'the group menu carries every sort mode',
  ['Last activity', 'Name', 'Sessions', 'Manual'].every(label => groupHeading.includes(label)),
  groupHeading.length
)
check(
  'the group menu carries the group verbs',
  ['Move up', 'Move down', 'Add profiles…', 'Rename…', 'Delete group'].every(label =>
    groupHeading.includes(label)
  )
)
check(
  'the heading keeps the disclosure caret and its state',
  groupHeading.includes('data-slot="caret"') && groupHeading.includes('data-open="true"')
)
check(
  'exactly one mode is ticked in EACH of the heading\'s menus, and it is the scope\'s own',
  (() => {
    const split = groupHeading.indexOf('data-slot="context-menu-content"')
    const count = slice => (slice.match(/data-codicon="check"/g) || []).length

    return count(groupHeading.slice(0, split)) === 1 && count(groupHeading.slice(split)) === 1
  })(),
  `checks=${(groupHeading.match(/data-codicon="check"/g) || []).length}`
)
check(
  'the heading\'s two menus list the same verbs, in the same order',
  (() => {
    const split = groupHeading.indexOf('data-slot="context-menu-content"')
    const labels = slice => (slice.match(/data-slot="(?:dropdown-item|context-menu-item)"[^>]*>/g) || []).length

    return labels(groupHeading.slice(0, split)) === labels(groupHeading.slice(split))
  })()
)

const collapsedHeading = renderToStaticMarkup(
  jsx(__internals.SectionHeading, {
    block: { collapsed: true, id: 'sec-1', name: 'Clients', rows: [], scope: 'sec-1' },
    index: 1,
    onAddProfiles: () => {},
    onDelete: () => {},
    onMove: () => {},
    onRename: () => {},
    onSort: () => {},
    scopeCount: 2,
    sort: 'activity'
  })
)

check(
  'a collapsed heading reports itself closed to the a11y tree',
  collapsedHeading.includes('data-open="false"')
)

// the writes the kebab makes, through the same storage the pane reads
h.storage['messenger-sections-v1'] = {
  collapsed: [],
  members: {},
  order: {},
  sections: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  sort: {}
}
plugin.register(ctx)

__internals.setOrder('a', ['zulu', 'default'])

check(
  'a manual re-order is saved and switches that scope to Manual',
  h.storage['messenger-sections-v1'].order.a.join(',') === 'zulu,default' &&
    h.storage['messenger-sections-v1'].sort.a === 'manual',
  JSON.stringify(h.storage['messenger-sections-v1'])
)
check(
  'a drop that re-sorts itself would look like a failed drag: the mode really flipped',
  h.storage['messenger-sections-v1'].sort.a === 'manual'
)

__internals.setSort('a', 'nonsense')
check('setSort refuses a mode it does not ship', h.storage['messenger-sections-v1'].sort.a === 'manual')

__internals.setSort('a', 'name')
check('setSort saves the pick', h.storage['messenger-sections-v1'].sort.a === 'name')

__internals.moveSection('b', -1)
check('Move up reorders the groups', h.storage['messenger-sections-v1'].sections.map(s => s.id).join(',') === 'b,a')
__internals.moveSection('b', -1)
check('Move up at the edge is a no-op', h.storage['messenger-sections-v1'].sections.map(s => s.id).join(',') === 'b,a')
__internals.moveSection('b', 1)
check('Move down puts it back', h.storage['messenger-sections-v1'].sections.map(s => s.id).join(',') === 'a,b')

const scoped = __internals.groupRows(
  [{ lastActiveMs: 9, name: 'zulu' }, { lastActiveMs: 8, name: 'default' }],
  {
    collapsed: [],
    members: { default: 'g', zulu: 'g' },
    order: {},
    sections: [{ id: 'g', name: 'G' }],
    sort: { g: 'name' }
  }
)

check(
  'a group sorts by its OWN scope mode, not the pane default',
  order(scoped[0].rows) === 'default,zulu',
  order(scoped[0].rows)
)

// ── P11: multi-select ──────────────────────────────────────────────────────
const BATCH_ROSTER = [
  {
    name: 'zulu',
    sessions: [
      { id: 'z1', resolved_id: 'live-z1', title: 'Flux migration' },
      { id: 'z2', title: 'Retro' }
    ]
  },
  { name: 'default', sessions: [{ id: 'd1' }] },
  { name: 'ghost' }
]

check(
  'a tick toggles on and off',
  __internals.toggleSelected([], 'zulu|z1').join(',') === 'zulu|z1' &&
    __internals.toggleSelected(['zulu|z1'], 'zulu|z1').length === 0
)
check('toggling does not mutate the list it was handed', (() => {
  const keys = ['a|1']

  __internals.toggleSelected(keys, 'a|2')

  return keys.join(',') === 'a|1'
})())

const resolved = __internals.selectedSessions(BATCH_ROSTER, ['zulu|z1', 'default|d1'])

check(
  'the batch set carries each session\'s OWN profile',
  resolved.map(entry => `${entry.profile}:${entry.session_id}`).join(' ') === 'zulu:z1 default:d1',
  JSON.stringify(resolved)
)
check(
  'a live session is closed by its resolved runtime id, never the stored one',
  resolved[0].openId === 'live-z1' && resolved[0].title === 'Flux migration',
  resolved[0].openId
)
check(
  'a tick whose session vanished resolves to nothing',
  __internals.selectedSessions(BATCH_ROSTER, ['zulu|gone']).length === 0
)
check(
  'a profile with no sessions contributes no keys',
  __internals.allSessionKeys(BATCH_ROSTER).join(',') === 'zulu|z1,zulu|z2,default|d1',
  __internals.allSessionKeys(BATCH_ROSTER).join(',')
)
check(
  'Select all is the whole roster, not the visible slice',
  __internals.allSessionKeys(BATCH_ROSTER).length === 3
)

const closedCalls = []

h.responses['session.close'] = payload => {
  closedCalls.push(payload)

  return { closed: true }
}

const closeResult = await (async () => {
  const entry = __internals.selectedSessions(BATCH_ROSTER, ['zulu|z1'])

  return __internals.runOverSessions(entry, __internals.closeSession)
})()

check(
  'closing the batch sends the live id WITH its profile',
  closedCalls.length === 1 &&
    closedCalls[0].profile === 'zulu' &&
    closedCalls[0].session_id === 'live-z1',
  JSON.stringify(closedCalls)
)
check('a clean batch reports what it did', closeResult.done === 1 && closeResult.failed === 0, JSON.stringify(closeResult))

const refused = await __internals.runOverSessions(
  [{ profile: 'zulu', session_id: 'z1' }, { profile: 'default', session_id: 'd1' }],
  entry => (entry.profile === 'zulu' ? Promise.reject(new Error('gone')) : Promise.resolve())
)

check(
  'a call that rejects is COUNTED as failed, never folded into a cheerful total',
  refused.done === 1 && refused.failed === 1,
  JSON.stringify(refused)
)

const bar = renderToStaticMarkup(
  jsx(__internals.SelectBar, {
    busy: false,
    count: 0,
    onArchive: () => {},
    onClear: () => {},
    onClose: () => {},
    onDone: () => {},
    onSelectAll: () => {},
    status: '',
    t: key => key
  })
)

// `t` here is identity, so the labels ARE the dictionary keys — which is the
// point: the bar asks for exactly these, and the pane's own dictionary supplies
// the words.
check(
  'the batch bar offers every verb',
  ['selectAll', 'clear', 'apropos', 'close', 'archive', 'delete', 'done'].every(label => bar.includes(label)),
  bar
)
check('the batch bar counts what is ticked', bar.includes('0 selected'), bar)
check(
  'the verbs that act on a selection are disabled with none ticked',
  (bar.match(/disabled/g) || []).length === 5,
  (bar.match(/disabled/g) || []).length
)

const doneBar = renderToStaticMarkup(
  jsx(__internals.SelectBar, {
    busy: false,
    count: 2,
    onArchive: () => {},
    onClear: () => {},
    onClose: () => {},
    onDone: () => {},
    onSelectAll: () => {},
    status: '2 closed · 1 failed',
    t: key => key
  })
)

check('the bar shows the last batch\'s receipt instead of a drifting toast', doneBar.includes('2 closed · 1 failed'), doneBar)
check('a live selection enables the verbs', !/disabled/.test(doneBar))

// ── session groups: filing one profile's own sessions by topic/project ─────
// (Pedro, 2026-10-09.) The state layer is pure and the pane reads it through an
// atom, so all of this runs with no DOM at all.

const SG_FIXTURE = [
  { id: 'a1', title: 'alpha one' },
  { id: 'a2', title: 'alpha two' },
  { id: 'a3', title: 'beta one' },
  { id: 'a4', title: 'unfiled' }
]

const sgLoaded = __internals.normalizeSessionGroups({
  zulu: {
    collapsed: ['sg-2', 'gone'],
    groups: [{ id: 'sg-2', name: 'Beta' }, { id: 'sg-1', name: 'Alpha' }, { id: '', name: 'junk' }],
    members: { a1: 'sg-1', a2: 'sg-1', a3: 'sg-2', orphan: 'sg-9' },
    order: ['sg-2', 'sg-1', 'nothing']
  }
})

check(
  'a hand-edited store cannot invent a group, a membership or a collapse',
  sgLoaded.zulu.groups.length === 2 &&
    sgLoaded.zulu.collapsed.join(',') === 'sg-2' &&
    !('orphan' in sgLoaded.zulu.members) &&
    sgLoaded.zulu.order.join(',') === 'sg-2,sg-1',
  JSON.stringify(sgLoaded)
)

const sgBlocks = __internals.sessionGroupBlocks(SG_FIXTURE, sgLoaded, 'zulu')

check(
  'the list groups by heading, in the user\'s order, unfiled last',
  sgBlocks.map(block => String(block.id)).join(',') === 'sg-2,sg-1,null' &&
    sgBlocks[0].sessions.length === 1 &&
    sgBlocks[1].sessions.length === 2 &&
    sgBlocks[2].sessions.length === 1,
  JSON.stringify(sgBlocks.map(block => [block.id, block.sessions.length]))
)

check(
  'a collapsed heading says so — its sessions are held back, not dropped',
  sgBlocks[0].collapsed === true && sgBlocks[0].sessions.length === 1,
  JSON.stringify(sgBlocks.map(block => [block.id, block.collapsed]))
)

const sgFlat = __internals.sessionGroupBlocks(SG_FIXTURE, {}, 'zulu')

check(
  'a profile nobody filed anything into is still one flat list',
  sgFlat.length === 1 && sgFlat[0].id === null && sgFlat[0].sessions.length === SG_FIXTURE.length,
  JSON.stringify(sgFlat.map(block => [block.id, block.sessions.length]))
)

const readGroups = profile => __internals.profileSessionGroups(__internals.$sessionGroups.get(), profile)

const madeId = __internals.createSessionGroup('zulu', '  Project X  ', ['a3'])

check(
  'a new group is named, trimmed, and holds the session that made it',
  Boolean(madeId) &&
    readGroups('zulu').groups[0].name === 'Project X' &&
    readGroups('zulu').members.a3 === madeId,
  JSON.stringify(readGroups('zulu'))
)

check('a blank name writes nothing', __internals.createSessionGroup('zulu', '   ', ['a1']) === '')

__internals.moveSessionsToGroup('zulu', ['a1', 'a2'], madeId)

check(
  'filing two sessions in at once lands them, and un-collapses the destination',
  readGroups('zulu').members.a1 === madeId &&
    readGroups('zulu').members.a2 === madeId &&
    !readGroups('zulu').collapsed.includes(madeId),
  JSON.stringify(readGroups('zulu'))
)

__internals.renameSessionGroup('zulu', madeId, 'Project Y')

check(
  'renaming a heading leaves its members alone',
  readGroups('zulu').groups[0].name === 'Project Y' && readGroups('zulu').members.a1 === madeId
)

// A group id nobody has means ungrouped — never a silent no-op that leaves the
// session buried in a group the user thought they were moving it out of.
__internals.moveSessionsToGroup('zulu', ['a2'], 'sg-does-not-exist')

check(
  'moving to a group that is not there is a move OUT, never a lost session',
  !('a2' in readGroups('zulu').members) && readGroups('zulu').members.a1 === madeId,
  JSON.stringify(readGroups('zulu').members)
)

__internals.deleteSessionGroup('zulu', madeId)
const afterDelete = readGroups('zulu')

check(
  'deleting a heading never deletes a session — they fall back to ungrouped',
  afterDelete.groups.length === 0 && Object.keys(afterDelete.members).length === 0,
  JSON.stringify(afterDelete)
)

const sgHeading = renderToStaticMarkup(
  jsx(__internals.SessionGroupHeading, {
    block: { collapsed: false, id: 'sg-1', name: 'Alpha', sessions: [{ id: 'a1' }, { id: 'a2' }] },
    onDelete: () => {},
    onRename: () => {},
    onToggle: () => {},
    profile: 'zulu'
  })
)

check(
  'the session heading is a drop target, counts its sessions and carries the group verbs',
  sgHeading.includes('data-drop-session-group="sg-1"') &&
    ['Rename…', 'Delete group'].every(label => sgHeading.includes(label)),
  sgHeading
)

const filing = __internals.dropAction(
  { group: '', id: 'a1', kind: 'session', profile: 'zulu' },
  { sessionGroup: 'sg-1' }
)
const refiling = __internals.dropAction(
  { group: 'sg-1', id: 'a1', kind: 'session', profile: 'zulu' },
  { sessionGroup: 'sg-1' }
)

check(
  'a session dropped on a heading is filed there — dropping it back where it already is does nothing',
  filing?.kind === 'sessionFile' && filing.group === 'sg-1' && filing.ids.join() === 'a1' && refiling === null,
  JSON.stringify([filing, refiling])
)

check(
  'a session dropped on another session still re-orders that profile',
  __internals.dropAction(
    { group: '', id: 'a1', kind: 'session', profile: 'zulu' },
    { profile: 'zulu', session: 'a2' }
  )?.kind === 'sessionOrder'
)

check('a profile collapses to 10 recent sessions, not 20', __internals.SESSIONS_PER_PROFILE === 10)

// ── the group BOX, and its color (Pedro, 2026-10-10) ─────────────────────────
// "add a thin outer line around the group, that includes the header, to serve as
// a separator, allow the user to color code the group, by right-clicking the
// group header and choosing a color. That changes the background fill of the
// items." The outline is the container; the fill belongs to the items.

const BLUE = '#3b82f6'

check(
  'a group color survives storage, and one outside the palette cannot enter it',
  (() => {
    const clean = __internals.normalizeSessionGroups({
      zulu: { groups: [{ id: 'g1', name: 'One', color: BLUE }] }
    })
    const dirty = __internals.normalizeSessionGroups({
      zulu: { groups: [{ id: 'g2', name: 'Two', color: 'red;background:url(x)' }] }
    })

    return clean.zulu.groups[0].color === BLUE && dirty.zulu.groups[0].color === null
  })()
)

__internals.createSessionGroup('zulu', 'Topic A', ['sess-zulu-9'])
__internals.createSessionGroup('zulu', 'Topic B', [])
const zuluGroups = readGroups('zulu').groups
const topicA = zuluGroups.find(group => group.name === 'Topic A').id
const topicB = zuluGroups.find(group => group.name === 'Topic B').id

let sgMarkup = render()
const boxCount = (sgMarkup.match(/data-session-group-box=/g) || []).length

check(
  'one box per named group, and none around the anonymous block',
  boxCount === zuluGroups.length && boxCount >= 2,
  `boxes=${boxCount} groups=${zuluGroups.length}`
)
check(
  'the box opens BEFORE the header, so the header is inside it',
  sgMarkup.indexOf(`data-session-group-box="${topicA}"`) <
    sgMarkup.indexOf(`data-drop-session-group="${topicA}"`) &&
    sgMarkup.indexOf(`data-session-group-box="${topicA}"`) >= 0
)
check(
  'an empty group keeps its box and its header',
  sgMarkup.includes(`data-session-group-box="${topicB}"`) &&
    sgMarkup.includes(`data-drop-session-group="${topicB}"`)
)

check(
  'an uncolored group is an outline with nothing painted on it',
  sgMarkup.includes('border-(--ui-stroke-secondary)') &&
    !new RegExp(`data-session-group-box="${topicA}"[^>]*style=`).test(sgMarkup) &&
    new RegExp(`data-group-color="${topicA}"><div data-slot="color-swatches" data-value=""`).test(sgMarkup),
  sgMarkup.slice(sgMarkup.indexOf(`data-group-color="${topicA}"`), sgMarkup.indexOf(`data-group-color="${topicA}"`) + 120)
)
check(
  'the items wrapper never carries a fill of its own — the BOX is painted',
  !/data-session-group-fill="[^"]*"[^>]*style=/.test(sgMarkup)
)
check(
  'the header carries the app\'s own swatch grid, not a bespoke picker',
  /data-group-color="[^"]+"><div data-slot="color-swatches"/.test(sgMarkup) &&
    sgMarkup.includes('data-slot="color-clear"')
)

// Color it through the real setter, then re-render.
__internals.setSessionGroupColor('zulu', topicA, BLUE)
sgMarkup = render()

const fillStart = sgMarkup.indexOf(`data-session-group-fill="${topicA}"`)
const topicBBox = sgMarkup.indexOf(`data-session-group-box="${topicB}"`)
const fillSlice = sgMarkup.slice(fillStart, topicBBox === -1 ? undefined : topicBBox)

const boxStart = sgMarkup.indexOf(`data-session-group-box="${topicA}"`)
const boxSlice = sgMarkup.slice(boxStart, topicBBox === -1 ? undefined : topicBBox)

check(
  'picking a color outlines the group in it and paints it',
  new RegExp(
    `data-session-group-box="${topicA}"[^>]*style="background:color-mix\\(in srgb, ${BLUE} 22%, transparent\\);border-color:${BLUE}"`
  ).test(sgMarkup),
  sgMarkup.slice(boxStart, boxStart + 200)
)
check(
  'the fill covers the HEADER, not just the items — the box is painted, and the box contains the header',
  boxSlice.includes(`data-drop-session-group="${topicA}"`) &&
    boxSlice.includes('data-session="sess-zulu-9"')
)
check(
  'and the paint stops at that group — the next group is untouched',
  boxSlice.includes('data-session="sess-zulu-9"') && !boxSlice.includes('data-session="sess-zulu-8"'),
  boxSlice.slice(0, 300)
)
check(
  'the picker now shows the group\'s colour as the selected swatch',
  new RegExp(`data-group-color="${topicA}"><div data-slot="color-swatches" data-value="${BLUE}"`).test(sgMarkup)
)
check(
  'an uncolored group stays unfilled — the color is per group',
  !sgMarkup.includes(`data-session-group-fill="${topicB}"`)
)

__internals.renameSessionGroup('zulu', topicA, 'Topic A renamed')

check(
  'renaming a group keeps its color',
  readGroups('zulu').groups.find(group => group.id === topicA).color === BLUE
)

__internals.setSessionGroupColor('zulu', topicA, 'javascript:alert(1)')
check(
  'a colour outside the palette CLEARS instead of reaching the stylesheet',
  readGroups('zulu').groups.find(group => group.id === topicA).color === null
)

__internals.setSessionGroupColor('zulu', topicA, BLUE)
__internals.setSessionGroupColor('zulu', topicA, null)
check(
  'and "No color" clears it too — the outline stays, the paint goes',
  readGroups('zulu').groups.find(group => group.id === topicA).color === null &&
    !new RegExp(`data-session-group-box="${topicA}"[^>]*style=`).test(render()) &&
    render().includes(`data-session-group-box="${topicA}"`)
)

// ── the move verb: the ROW's id has to reach the hander ─────────────────────
// The menu used to pass the GROUP id alone. It landed in the session slot,
// `groupId` arrived undefined, and moveSessionsToGroup filed a session id that
// does not exist — the menu looked live and did nothing.
check(
  'a Move-to-group click carries BOTH ids, the session first',
  (() => {
    const toGroup = __internals.sessionMoveTarget('sess-1', 'sg-9')
    const out = __internals.sessionMoveTarget('sess-1', null)

    return toGroup.sessionId === 'sess-1' && toGroup.groupId === 'sg-9' && out.groupId === null
  })()
)
check(
  'the shipped menu builds that payload from the ROW, never from the group alone',
  (() => {
    // `src` is read further down the file, so read it here rather than trip TDZ.
    const shipped = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

    return (
      shipped.includes('onMoveGroup(sessionMoveTarget(storedId, entry.id))') &&
      shipped.includes('onMoveGroup(sessionMoveTarget(storedId, null))') &&
      !shipped.includes('onMoveGroup(entry.id)')
    )
  })()
)
check(
  'an unticked session moves alone, even while other sessions are ticked',
  __internals
    .sessionGroupMoveTargets({ profile: 'zulu', selectedKeys: ['zulu|a1', 'zulu|a2'], sessionId: 'a9' })
    .join(',') === 'a9'
)
check(
  'a ticked session moves the whole ticked batch — of THAT profile only',
  __internals
    .sessionGroupMoveTargets({
      profile: 'zulu',
      selectedKeys: ['zulu|a1', 'default|a2', 'zulu|a3'],
      sessionId: 'a1'
    })
    .join(',') === 'a1,a3'
)
check(
  'and the click actually files the session — the whole chain, as the UI builds it',
  (() => {
    const target = __internals.sessionMoveTarget('sess-zulu-8', topicB)
    const moving = __internals.sessionGroupMoveTargets({
      profile: 'zulu',
      selectedKeys: [],
      sessionId: target.sessionId
    })

    __internals.moveSessionsToGroup('zulu', moving, target.groupId)

    return readGroups('zulu').members['sess-zulu-8'] === topicB
  })(),
  JSON.stringify(readGroups('zulu').members)
)

// A bounding group, so the slice below cannot cheat by running to the end of the
// markup: `sess-zulu-8` must be inside topicB's box, not merely after it.
const boundBox = __internals.createSessionGroup('zulu', 'Topic Z', [])

check(
  'and the moved session renders INSIDE that group, not merely below it',
  (() => {
    const mk = render()
    const start = mk.indexOf(`data-session-group-box="${topicB}"`)
    const end = mk.indexOf(`data-session-group-box="${boundBox}"`)

    return start > 0 && end > start && mk.slice(start, end).includes('data-session="sess-zulu-8"')
  })()
)

// ── the DOM half: elementAt against a fake document ─────────────────────────
// The static render has no DOM, so the hit-resolution half of a drag was the
// one thing never exercised. A fake `elementFromPoint` + `closest` pins the
// contract: which attributes each row type must carry for a drop to resolve.
const NO_RECT = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }
const dropEl = attrs => ({
  getAttribute: key => (key in attrs ? attrs[key] : null),
  getBoundingClientRect: () => NO_RECT,
  querySelectorAll: () => [],
  closest(sel) {
    const map = {
      '[data-drop-group]': 'data-drop-group',
      '[data-drop-profile]': 'data-drop-profile',
      '[data-drop-scope]': 'data-drop-scope',
      '[data-drop-session]': 'data-drop-session',
      '[data-drop-session-group]': 'data-drop-session-group',
      '[data-profile-row]': 'data-profile-row',
      '[data-session-row]': 'data-session-row'
    }
    const key = map[sel]

    // The ancestors carry the SAME attributes as the node they contain — a real
    // row holds its drop id and its row marker together, and a hit on the row
    // button must still resolve to the row it is inside.
    return key && key in attrs ? dropEl(attrs) : null
  }
})
const under = attrs => {
  globalThis.document = { elementFromPoint: () => dropEl(attrs) }
}
const fired = (drag, attrs) => {
  under(attrs)

  return __internals.dropAction(drag, __internals.elementAt(5, 5))
}

under({ 'data-drop-group': 'g1' })
check('elementAt reads a group heading under the pointer', __internals.elementAt(5, 5).group === 'g1')

check('a group dropped on another group re-orders the sections', fired({ id: 'g2', kind: 'group' }, { 'data-drop-group': 'g1' })?.kind === 'section')

check(
  'a profile dropped on a profile in the same scope re-orders that scope',
  fired({ kind: 'profile', name: 'keke', section: 'all' }, { 'data-drop-profile': 'zulu', 'data-drop-scope': 'all' })?.kind === 'order'
)

check('a profile dropped on a group heading is filed into it', fired({ kind: 'profile', name: 'keke', section: 'all' }, { 'data-drop-group': 'g1' })?.kind === 'file')

const sessDrop = fired({ group: '', id: 'a1', kind: 'session', profile: 'zulu' }, { 'data-drop-profile': 'zulu', 'data-drop-session': 'a2', 'data-session-row': '' })

check(
  'a session dropped on another session re-orders that profile',
  sessDrop?.kind === 'sessionOrder' && sessDrop.id === 'a1' && sessDrop.onto === 'a2',
  JSON.stringify(sessDrop)
)

check(
  'dropping a row back on its own row is a no-op',
  fired({ kind: 'profile', name: 'zulu', section: 'all' }, { 'data-drop-profile': 'zulu', 'data-drop-scope': 'all' }) === null &&
    fired({ group: '', id: 'a1', kind: 'session', profile: 'zulu' }, { 'data-drop-profile': 'zulu', 'data-drop-session': 'a1', 'data-session-row': '' }) === null
)

delete globalThis.document

// ── the grip column: the pointer is BESIDE the row button ────────────────────
// A grip is grabbed, so during a session drag the pointer sits on the grip —
// outside the button, inside the row. A target read from the button alone
// answered null and the drop was swallowed (Pedro, 2026-10-10: "I can move
// profiles, but not sessions"), while the enclosing PROFILE lit up under the
// pointer. These fixtures are rows with no button under the pointer at all.
const rowEl = (id, top, height, profile = 'zulu') => ({
  getAttribute: key => (key === 'data-drop-session' ? id : key === 'data-drop-profile' ? profile : null),
  getBoundingClientRect: () => ({ bottom: top + height, height, left: 0, right: 0, top, width: 0 })
})
const gripHit = (rows, y, profile = 'zulu') => {
  const container = {
    getAttribute: key => (key === 'data-drop-profile' ? profile : null),
    closest: () => null,
    querySelectorAll: () => rows
  }
  const node = { closest: sel => (sel === '[data-drop-profile]' ? container : null), getAttribute: () => null }

  globalThis.document = { elementFromPoint: () => node }

  return __internals.elementAt(5, y)
}
const rowsAB = [rowEl('a1', 0, 40), rowEl('a2', 40, 40)]

const onGrip = gripHit(rowsAB, 70)

check(
  'a session dropped on the GRIP column resolves to the nearest row, not to nothing',
  onGrip.session === 'a2' && onGrip.sessionSide === 'after',
  JSON.stringify(onGrip)
)
check(
  'the same drop on the upper half of a row targets that row and lands BEFORE it',
  gripHit(rowsAB, 55).session === 'a2' && gripHit(rowsAB, 55).sessionSide === 'before'
)

const gripAction = (() => {
  gripHit(rowsAB, 70)

  return __internals.dropAction(
    { group: '', id: 'a1', kind: 'session', profile: 'zulu' },
    __internals.elementAt(5, 70)
  )
})()

check(
  'the grip drop reaches the session-order commit, carrying its side',
  gripAction?.kind === 'sessionOrder' && gripAction.onto === 'a2' && gripAction.side === 'after',
  JSON.stringify(gripAction)
)

// ── placeNames: the bar the user sees IS where the row lands ─────────────────
const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
const P = __internals.placeNames

check('placeNames lands BEFORE the target when the bar says before', P(['a', 'b', 'c'], 'c', 'a', 'before').join('') === 'cab')
check('placeNames lands AFTER the target when the bar says after', P(['a', 'b', 'c'], 'a', 'c', 'after').join('') === 'bca')
check('placeNames with no side keeps the legacy slot rule (down lands after)', P(['a', 'b', 'c'], 'a', 'c', '').join('') === 'bca')
check('placeNames with no side: dragging up lands before', P(['a', 'b', 'c'], 'c', 'a', '').join('') === 'cab')
check('placeNames ignores an unknown target, so a stale drop cannot lose a row', P(['a', 'b'], 'a', 'zz', 'after').join('') === 'ab')
check('placeNames on a row dropped on itself is a no-op', P(['a', 'b'], 'a', 'a', 'before').join('') === 'ab')

check(
  'the commit and the preview go through the same function (no drift possible)',
  /placeNames\(current, action\.(id|name), action\.onto, action\.side\)/.test(src)
)
const roster = render()

check('a row carries its drop id on the ROW, not only on the button', /<div data-drop-session="[^"]+" data-session-row=""/.test(roster))
check('the pane marks the box a drag auto-scrolls', roster.includes('data-pane-scroll'))
check('the insertion bar is a box-shadow, so a drop cannot shift the list', src.includes('inset 0 ${'))
check('the carried row reads as lifted', src.includes("dragging && 'opacity-60'"))

// ── the commit reads the SAME list the render reads ──────────────────────────
// Every part was right and the whole was broken: the target resolved, the side
// was correct, placeNames worked — and the commit was handed an empty list,
// because a roster row (`profiles.list`) has `last_session`, not `sessions`.
// Parts-in-isolation tests were exactly what let that through.
const displayed = [{ id: 'c' }, { id: 'b' }, { id: 'a' }]

check(
  'a session drop re-orders the DISPLAYED list, with the saved order applied first',
  __internals.nextSessionIds(displayed, ['a', 'b', 'c'], 'c', 'a', 'after').join('') === 'acb'
)
check(
  'and with no saved order yet it still moves the row',
  __internals.nextSessionIds(displayed, [], 'b', 'a', 'after').join('') === 'cab'
)
check(
  'a name not in the list cannot lose a row (stale drop)',
  __internals.nextSessionIds(displayed, [], 'zz', 'a', 'after').join('') === 'cba'
)
check(
  'the session commit reads the sessions query and never a roster row',
  /nextSessionIds\(\s*\n?\s*byProfile\[action\.profile\]/.test(src) &&
    !src.includes('applySessionOrder(row?.sessions')
)
check('the drag logger renders nothing', !render().includes('dnd trace'))

// The last link: a saved order must actually change the rendered order. This is
// the line the render calls (`applySessionOrder(sessions, sessionOrder[profile])`),
// so it is the one place where a correct commit could still fail to appear.
const A = __internals.applySessionOrder

check(
  'a saved order is what the list renders',
  A([{ id: 'a' }, { id: 'b' }], ['b', 'a']).map(s => s.id).join('') === 'ba'
)
check(
  'a session the order has never seen is not parked under the known ones',
  A([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map(s => s.id).join('') === 'abc',
  A([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map(s => s.id).join('')
)
// The reported bug, end to end. A saved order long enough to fill the inline page
// used to be able to swallow a session the pane had never positioned: the row was
// the FIRST in "View all" and in no row of the main view. Pedro, 2026-10-10:
// "the session called 'Plan Hermes Desktop plugin with merged sessions' is not
// showing up in the main view (underneath the profile), but it is the first
// result when I click 'View all'".
check(
  'a new session survives the inline cap under a manual order',
  (() => {
    const known = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}` }))
    const order = known.map(session => session.id)
    const shown = __internals
      .sessionGroupBlocks(
        __internals.sortProfileSessions([...known, { id: 'brand-new' }], 'manual', order),
        {},
        'zulu',
        []
      )
      .flatMap(block => block.sessions.map(session => session.id))

    return shown.includes('brand-new')
  })(),
  'a saved order must not be able to cut a session out of the page'
)
check(
  'an empty order leaves the list alone (the fingerprint of the no-op bug)',
  A([{ id: 'a' }, { id: 'b' }], []).map(s => s.id).join('') === 'ab'
)

// ── 20. Apropos (On that Topic) ─────────────────────────────────────────────
//
// The feature is a POINTER, not a digest: one hidden seed row on a child that
// links back to the parent and carries no parent text at all. What is pinned
// here is survival, not size — the id must ride in three shapes (prose, pin,
// call) because a real fork lineage lost the prose mention to a summarizer, and
// the header must stay short enough that no part of it is worth eliding.

const D = __internals.buildAproposDigest
const APROPOS_SOURCE = {
  profile: 'zulu',
  storedId: 'sess-zulu-9',
  title: 'Flux capacitor retro'
}
const digest = D(APROPOS_SOURCE)

check(
  'the header names its source session and the on-demand read',
  digest.startsWith('Apropos of "Flux capacitor retro" (session sess-zulu-9)') &&
    digest.includes('Read: session_search(session_id="sess-zulu-9", profile="zulu")'),
  digest
)
check(
  'the parent id rides in three shapes — prose, pin, tool call (the redundancy a real fork needed)',
  (digest.match(/sess-zulu-9/g) || []).length === 3,
  `${(digest.match(/sess-zulu-9/g) || []).length} mentions`
)
check(
  'the pin line is machine-shaped and names its own preservation rule',
  digest.includes('[APROPOS-PIN parent=sess-zulu-9 profile=zulu]') && /keep verbatim/i.test(digest),
  digest
)
check(
  'nothing of the parent is copied — not one turn, not the opening ask',
  !digest.includes('Opening ask') && !digest.includes('Recent turns') &&
    !digest.includes('first message one') && !digest.includes('reply one'),
  digest
)
check(
  'the header is a pointer, not a digest: far under the size of the prose it replaced',
  digest.length < 400,
  `length ${digest.length}`
)
check('the digest is deterministic — same input, same bytes', digest === D(APROPOS_SOURCE))
check(
  'a long title is clipped, never pasted wholesale',
  D({ ...APROPOS_SOURCE, title: 't '.repeat(200) }).length < 400
)
check(
  'the first line never reads as synthetic scaffolding to the summarizer',
  // core skips rows starting with these when it quotes user messages verbatim
  // (agent/context_compressor.py:969-972); a header wearing one would fall out of
  // that channel silently.
  [
    '[System:', '[CONTEXT', '[PRIOR CONTEXT', '[IMPORTANT: Background', '[Your active task list',
    '[Planning state preserved', '[ASYNC DELEGATION', '[OUT-OF-BAND', 'Cronjob Response:'
  ].every(prefix => !digest.startsWith(prefix))
)
check(
  'a header with only an id still names the source (no transcript involved)',
  D({ profile: 'zulu', storedId: 'sess-zulu-9' }).includes('session_search(session_id="sess-zulu-9", profile="zulu")')
)
check(
  'a title we generated reaches a fixed point instead of compounding per generation',
  __internals.aproposSourceName('Apropos: Apropos: Apropos walk test') === 'Apropos: Apropos walk test' &&
    __internals.aproposSourceName('Apropos group: Voice pipeline') === 'Voice pipeline' &&
    __internals.aproposSourceName('Apropos walk test') === 'Apropos walk test',
  __internals.aproposSourceName('Apropos: Apropos: Apropos walk test')
)
check(
  'a content-parts row reads as text',
  __internals.messageText({ role: 'assistant', content: [{ type: 'text', text: 'part one' }, 'part two'] }) === 'part one part two'
)
check(
  'a content-parts row reads as text',
  __internals.messageText({ role: 'assistant', content: [{ type: 'text', text: 'part one' }, 'part two'] }) === 'part one part two'
)

// The link store: one direction, and junk never becomes a chip.
const LINKS = __internals.normalizeApropos({
  zulu: {
    'child-1': { parent: 'parent-1', parentTitle: 'Parent One' },
    'child-2': { parent: 'parent-1', parentTitle: 'Parent One' },
    'child-3': { parent: 'parent-2', parentTitle: 'Parent Two' },
    'child-orphan': { parent: '' },
    'child-self': { parent: 'child-self' }
  }
})

check(
  'malformed links fall out (no parent, self-link)',
  Object.keys(LINKS.zulu).join(',') === 'child-1,child-2,child-3',
  Object.keys(LINKS.zulu).join(',')
)
check('a child resolves to its parent', __internals.aproposEntry(LINKS, 'zulu', 'child-1')?.parent === 'parent-1')
check('and a parent to its own children only', __internals.aproposChildren(LINKS, 'zulu', 'parent-1').join(',') === 'child-1,child-2')
check('another profile never matches a link', __internals.aproposEntry(LINKS, 'default', 'child-1') === null)

// The RPC: the create payload IS the feature — parent link, ONE hidden row.
h.responses['session.history'] = () => ({
  count: 6,
  messages: [
    { role: 'user', content: 'first message one' },
    { role: 'assistant', content: 'reply one' },
    { role: 'user', content: 'second message two' },
    { role: 'assistant', content: 'reply two' },
    { role: 'user', content: 'third message three' },
    { role: 'assistant', content: 'reply three' }
  ]
})
h.responses['session.create'] = () => ({ message_count: 0, session_id: 'live-apropos-1', stored_session_id: 'sess-apropos-1' })
h.opens.length = 0

const historyReads = h.requests.filter(r => r.method === 'session.history').length
const aproposRes = await __internals.aproposSession('sess-zulu-9', 'zulu', 'Flux capacitor retro')
const createCall = h.requests.filter(r => r.method === 'session.create').pop()

check(
  'Apropos reads no parent transcript — the header is the whole seed',
  h.requests.filter(r => r.method === 'session.history').length === historyReads
)

// NO parent link: core reads `parent_session_id` as a BRANCH (it copies the
// parent's whole transcript, stamps `_branched_from` and auto-titles the child
// "<parent> #2"), which is not what Apropos is and which made the parent's own
// row look renamed or duplicated. Pedro, 2026-10-10: "do not change anything
// about the parent session… It should remain visible, with the original name."
check(
  'Apropos calls session.create with NO parent link — a refresher, never a branch',
  createCall.method === 'session.create' &&
    !('parent_session_id' in createCall.params) &&
    createCall.params.profile === 'zulu' &&
    !('copy_parent_history' in createCall.params) &&
    String(createCall.params.title || '').startsWith('Apropos: '),
  JSON.stringify(createCall.params).slice(0, 300)
)
check(
  'the seed is ONE hidden user row (model-facing scaffolding, never painted)',
  Array.isArray(createCall.params.messages) &&
    createCall.params.messages.length === 1 &&
    createCall.params.messages[0].display_kind === 'hidden' &&
    createCall.params.messages[0].role === 'user',
  JSON.stringify(createCall.params.messages)
)
const seed = String(createCall.params.messages?.[0]?.content || '')

check(
  'the seed is the POINTER row — the parent id in three shapes, no parent content',
  seed.includes('Apropos of "Flux capacitor retro" (session sess-zulu-9)') &&
    seed.includes('[APROPOS-PIN parent=sess-zulu-9 profile=zulu]') &&
    seed.includes('session_search(session_id="sess-zulu-9"') &&
    !seed.includes('reply one') && !seed.includes('Opening ask') && !seed.includes('Recent turns'),
  seed.slice(0, 220)
)
check(
  'the child is titled after the parent and carries an idempotency key',
  createCall.params.title === 'Apropos: Flux capacitor retro' && Boolean(createCall.params.idempotency_key),
  `${createCall.params.title} / ${createCall.params.idempotency_key}`
)
check(
  'the child opens in a tab, like branch does',
  h.opens.length === 1 && h.opens[0].id === 'sess-apropos-1' && h.opens[0].options.intent === 'tab',
  JSON.stringify(h.opens)
)
check('the child is created (res returned)', aproposRes?.stored_session_id === 'sess-apropos-1')
check(
  'the child→parent link is remembered for the chips',
  __internals.aproposEntry(__internals.$apropos.get(), 'zulu', 'sess-apropos-1')?.parent === 'sess-zulu-9' &&
    __internals.aproposChildren(__internals.$apropos.get(), 'zulu', 'sess-zulu-9').includes('sess-apropos-1')
)
check(
  'and persisted under the pane\'s own key',
  h.storage[__internals.APROPOS_KEY]?.zulu?.['sess-apropos-1']?.parent === 'sess-zulu-9',
  JSON.stringify(h.storage[__internals.APROPOS_KEY])
)

// A history store that THROWS must make no difference any more: the header is
// built from the pane's own link data alone, so this stub is here to prove the
// verb never touches it. The second call also pins the title fixed point —
// re-prefixing a title we generated produced "Apropos: Apropos: Apropos …"
// until 2026-10-10, with clip() then eating the real topic off the end.
h.responses['session.history'] = () => {
  throw new Error('no store')
}
h.responses['session.create'] = () => ({ session_id: 'live-apropos-2', stored_session_id: 'sess-apropos-2' })

await __internals.aproposSession('sess-child-7', 'zulu', 'Apropos: Apropos: Flux capacitor retro')

const compoundCall = h.requests.filter(r => r.method === 'session.create').pop()
const compoundSeed = String(compoundCall.params.messages?.[0]?.content || '')

check(
  'a parent already wearing a generated title reaches a fixed point, never compounds',
  compoundCall.params.title === 'Apropos: Apropos: Flux capacitor retro',
  compoundCall.params.title
)
check(
  'the header names the source from pane data alone — a throwing history store changes nothing',
  compoundSeed.includes('(session sess-child-7)') && compoundSeed.includes('[APROPOS-PIN parent=sess-child-7 profile=zulu]'),
  compoundSeed.slice(0, 200)
)

// The markup: the menu offers it, and the chips paint on both sides of a link.
const aproposMarkup = render()

check(
  'the session menu offers Apropos (On that topic, beta)',
  menuLabel(aproposMarkup, 'Apropos (On that topic, beta)'),
  aproposMarkup.slice(aproposMarkup.indexOf('Apropos'), aproposMarkup.indexOf('Apropos') + 80)
)

// The feature is BETA and says so where the user reaches for it (Pedro,
// 2026-10-10: "flag the apropos feature as beta"). The label IS the marker, so
// it is what a silent revert would drop.
check(
  'the Apropos entry is flagged beta in the session menu',
  menuLabel(aproposMarkup, 'Apropos (On that topic, beta)') && labelAt(aproposMarkup, 'Apropos (On that topic)') < 0
)

const childRow = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    nowMs: nowSec * 1000,
    profile: 'zulu',
    session: { id: 'sess-apropos-1', title: 'Apropos: Flux capacitor retro' }
  })
)

check(
  'a child row points back at its parent',
  childRow.includes('data-apropos-parent="sess-zulu-9"') && childRow.includes('↩ Flux capacitor retro'),
  childRow.slice(childRow.indexOf('data-apropos-parent'), childRow.indexOf('data-apropos-parent') + 200)
)

const parentRow = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    nowMs: nowSec * 1000,
    profile: 'zulu',
    session: { id: 'sess-zulu-9', title: 'Flux capacitor retro' }
  })
)

check(
  'a parent row counts its children',
  parentRow.includes('data-apropos-children="1"') && parentRow.includes('→ 1'),
  parentRow.slice(parentRow.indexOf('data-apropos-children'), parentRow.indexOf('data-apropos-children') + 120)
)

const plainRow = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    nowMs: nowSec * 1000,
    profile: 'zulu',
    session: { id: 'sess-plain', title: 'nothing to do with it' }
  })
)

check('an unrelated row carries neither chip', !plainRow.includes('data-apropos'))

// ── 21. Apropos on a GROUP, and Copy id ─────────────────────────────────────
// "consult these conversations": one child seeded from N member sessions. The
// member cap IS the feature (an index of links, no transcripts), so it is pinned
// here — a group header that quietly grows into N full transcripts would defeat
// the point of Apropos.

const GD = __internals.buildAproposGroupDigest
const GROUP_SOURCE = {
  label: 'Voice pipeline',
  members: [
    { storedId: 'g-1', title: 'Clone A' },
    { storedId: 'g-2', title: 'Clone B' }
  ],
  profile: 'zulu'
}
const groupDigest = GD(GROUP_SOURCE)

check(
  'a group header names the group, the profile and the member count',
  groupDigest.startsWith('Apropos group "Voice pipeline" (profile zulu, 2 sessions)'),
  groupDigest.slice(0, 170)
)
check(
  'the group pin line stands for the whole set',
  groupDigest.includes('[APROPOS-PIN group="Voice pipeline" profile=zulu members=2]'),
  groupDigest
)
check(
  'every member gets a header AND its own on-demand read line',
  groupDigest.includes('--- 1. "Clone A" (session g-1)') &&
    groupDigest.includes('--- 2. "Clone B" (session g-2)') &&
    groupDigest.includes('Read: session_search(session_id="g-1", profile="zulu")') &&
    groupDigest.includes('Read: session_search(session_id="g-2", profile="zulu")'),
  groupDigest
)
check('a group header is deterministic — same input, same bytes', groupDigest === GD(GROUP_SOURCE))
check(
  'a member contributes its id and link only — never a transcript',
  !groupDigest.includes('Opening ask') && !groupDigest.includes('first ask one') &&
    !/^\s+(user|assistant):/m.test(groupDigest),
  groupDigest
)

const wideDigest = GD({
  label: 'wide',
  members: Array.from({ length: 9 }, (_, index) => ({ storedId: `m-${index}`, title: `Member ${index}` })),
  profile: 'zulu'
})

check(
  'a wide group carries the capped member set and counts the rest',
  !wideDigest.includes('(session m-6)') && wideDigest.includes('3 more sessions in this group'),
  wideDigest.slice(-260)
)
check(
  'every capped member keeps its link, and the header stays small without arithmetic',
  Array.from({ length: __internals.APROPOS_GROUP_MAX }, (_, i) => `(session m-${i})`).every(link => wideDigest.includes(link)) &&
    wideDigest.length <= 1000,
  `length ${wideDigest.length}`
)

// The link store: a group link is a second KIND in the same map — a group
// entry with no group id must fall out exactly like a session entry with no
// parent, and the shipped Stage-1 field must still read.
const GLINKS = __internals.normalizeApropos({
  zulu: {
    'g-child-1': { at: 5, groupId: 'sg-1', kind: 'group', label: 'Topic A' },
    'g-child-bad': { kind: 'group', label: 'no group id' },
    'g-child-old': { parent: 'p-1', parentTitle: 'Legacy label' },
    'g-child-selfgroup': { groupId: '', kind: 'group' }
  }
})

check(
  'a group link survives normalization with its label',
  GLINKS.zulu?.['g-child-1']?.groupId === 'sg-1' && GLINKS.zulu?.['g-child-1']?.label === 'Topic A'
)
check('a group link with no group id never becomes a chip', !GLINKS.zulu?.['g-child-bad'] && !GLINKS.zulu?.['g-child-selfgroup'])
check(
  'a Stage-1 entry (parentTitle, no kind) still reads as a session link with its label',
  GLINKS.zulu?.['g-child-old']?.kind === 'session' &&
    GLINKS.zulu?.['g-child-old']?.label === 'Legacy label' &&
    GLINKS.zulu?.['g-child-old']?.parent === 'p-1'
)
check(
  'a group child is never counted as a session child of a session id',
  __internals.aproposChildren(GLINKS, 'zulu', 'sg-1').length === 0
)
check(
  'a group heading counts the children started from IT, and nothing else',
  __internals.aproposGroupCount(GLINKS, 'zulu', 'sg-1') === 1 &&
    __internals.aproposGroupCount(GLINKS, 'zulu', 'sg-9') === 0 &&
    __internals.aproposGroupCount(GLINKS, 'default', 'sg-1') === 0
)

// The verb end-to-end, against the stub host.
h.responses['session.history'] = params => ({
  count: 2,
  messages: [
    { role: 'user', content: `ask for ${params.session_id}` },
    { role: 'assistant', content: `reply for ${params.session_id}` }
  ]
})
h.responses['session.create'] = () => ({ session_id: 'live-group', stored_session_id: 'sess-group-child' })

const groupRes = await __internals.aproposGroupSession('zulu', 'sg-1', 'Topic A', [
  { id: 'sess-zulu-9', title: 'Flux capacitor retro' },
  { id: 'sess-zulu-8', title: 'Second one' }
])
const groupCreate = h.requests.filter(r => r.method === 'session.create').pop()
const groupSeed = String(groupCreate?.params?.messages?.[0]?.content || '')

check(
  'Apropos on a group seeds ONE hidden row, with no fake parent session',
  groupRes?.stored_session_id === 'sess-group-child' &&
    groupCreate?.params?.messages?.length === 1 &&
    groupCreate.params.messages[0].display_kind === 'hidden' &&
    groupCreate.params.messages[0].role === 'user' &&
    !('parent_session_id' in groupCreate.params) &&
    groupCreate.params.title === 'Apropos group: Topic A' &&
    groupCreate.params.profile === 'zulu',
  JSON.stringify(groupCreate?.params).slice(0, 260)
)
check(
  'the seed lists every member of the group, each with its own link',
  groupSeed.includes('(session sess-zulu-9)') &&
    groupSeed.includes('(session sess-zulu-8)') &&
    groupSeed.includes('session_search(session_id="sess-zulu-8", profile="zulu")') &&
    groupSeed.includes('2 sessions'),
  groupSeed.slice(0, 300)
)
check(
  'the group child opens in a tab and is remembered against the group',
  h.opens.at(-1)?.id === 'sess-group-child' &&
    h.opens.at(-1)?.options?.intent === 'tab' &&
    __internals.aproposGroupCount(__internals.$apropos.get(), 'zulu', 'sg-1') === 1 &&
    h.storage[__internals.APROPOS_KEY]?.zulu?.['sess-group-child']?.groupId === 'sg-1',
  JSON.stringify(h.storage[__internals.APROPOS_KEY]?.zulu?.['sess-group-child'])
)
check(
  'a group child is not a session child of any session',
  __internals.aproposChildren(__internals.$apropos.get(), 'zulu', 'sg-1').length === 0
)

// One member whose history cannot be read must not take the group down with it.
h.responses['session.history'] = () => {
  throw new Error('no store')
}
h.responses['session.create'] = () => ({ stored_session_id: 'sess-group-child-2' })

await __internals.aproposGroupSession('zulu', 'sg-2', 'Unreadable', [{ id: 'sess-gone', title: 'Gone' }])

const degradedGroupSeed = String(
  h.requests.filter(r => r.method === 'session.create').pop()?.params?.messages?.[0]?.content || ''
)

check(
  'an unreadable member still gets its link-only refresher (no silent no-op)',
  degradedGroupSeed.includes('session_search(session_id="sess-gone", profile="zulu")') &&
    degradedGroupSeed.includes('(session sess-gone)'),
  degradedGroupSeed.slice(0, 200)
)

// The markup: the heading offers the verb and counts its children.
const groupHeadingMarkup = renderToStaticMarkup(
  jsx(__internals.SessionGroupHeading, {
    block: { collapsed: false, id: 'sg-1', name: 'Topic A', sessions: [{ id: 'a1' }, { id: 'a2' }] },
    onDelete: () => {},
    onRename: () => {},
    onToggle: () => {},
    profile: 'zulu'
  })
)

check('the group heading offers Apropos (beta) for the whole group', groupHeadingMarkup.includes('Apropos this group (beta)'))
check(
  'the group heading counts the Apropos children it started',
  groupHeadingMarkup.includes('data-apropos-group-children="1"') && groupHeadingMarkup.includes('→ 1'),
  groupHeadingMarkup.slice(Math.max(0, groupHeadingMarkup.indexOf('data-apropos-group-children') - 60), groupHeadingMarkup.indexOf('data-apropos-group-children') + 120)
)

const childGroupRow = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    nowMs: nowSec * 1000,
    profile: 'zulu',
    session: { id: 'sess-group-child', title: 'Apropos group: Topic A' }
  })
)

check(
  'a group child row points back at its GROUP, not at a session',
  childGroupRow.includes('↩ Topic A'),
  childGroupRow.slice(Math.max(0, childGroupRow.indexOf('data-apropos-parent') - 40), childGroupRow.indexOf('data-apropos-parent') + 120)
)

// Copy id: the stored id, through whatever clipboard door the renderer has.
const copied = []
const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async value => copied.push(value) } }
})

check(
  'Copy id puts the stored session id on the clipboard',
  (await __internals.copySessionId('sess-zulu-7')) === true && copied.join() === 'sess-zulu-7',
  JSON.stringify(copied)
)
check(
  'and says so, quoting the id it copied',
  h.toasts.at(-1)?.kind === 'success' && h.toasts.at(-1)?.message === 'sess-zulu-7',
  JSON.stringify(h.toasts.at(-1))
)

if (navDescriptor) {
  Object.defineProperty(globalThis, 'navigator', navDescriptor)
} else {
  delete globalThis.navigator
}

check(
  'with no clipboard at all it reports failure instead of throwing',
  (await __internals.copyText('x')) === false && (await __internals.copySessionId('')) === false
)

const copyRow = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    nowMs: nowSec * 1000,
    profile: 'zulu',
    session: { id: 'sess-copy', title: 'copy me' }
  })
)

check('the session menu offers Copy id', menuLabel(copyRow, 'Copy id'))

const failed = results.filter(r => !r.ok)

// ── geometry dump: a COLORED group holding a LONG title ──────────────────────
// Measured in headless Chromium against the app's own stylesheet, never assumed:
// the box adds three nesting levels (box → items wrapper → row) and a `truncate`
// cell inside a flex column can set the PANE's minimum width exactly like the
// grid track once did (references/pane-layout.md).
// ── session sorting, deletion, and Apropos over a selection ────────────────
// Pedro, 2026-10-10, in order: "allow sorting of sessions, manually, by last
// activity and others. That can be an option when right-clicking on a profile";
// "don't hide or make the parent session go away from the list, they should both
// be shown"; "allow deletion of sessions"; "when a user selects multiple
// sessions and clicks apropos, create an apropos group using the selected
// sessions".

const SORTSET = [
  { id: 's1', last_active: 300, message_count: 2, title: 'Zulu' },
  { id: 's2', last_active: 100, message_count: 9, title: 'alpha' },
  { id: 's3', last_active: 200, message_count: 5, title: 'Mike' }
]
const setIds = list => list.map(session => session.id).join(',')

check(
  'activity keeps the gateway order — it is the only source of recency here',
  setIds(__internals.sortProfileSessions(SORTSET, 'activity')) === 's1,s2,s3',
  setIds(__internals.sortProfileSessions(SORTSET, 'activity'))
)
check(
  'name sorts a profile by title',
  setIds(__internals.sortProfileSessions(SORTSET, 'name')) === 's2,s3,s1',
  setIds(__internals.sortProfileSessions(SORTSET, 'name'))
)
check(
  'messages puts the busiest session first',
  setIds(__internals.sortProfileSessions(SORTSET, 'messages')) === 's2,s3,s1',
  setIds(__internals.sortProfileSessions(SORTSET, 'messages'))
)
check(
  'a sort never mutates the list it was handed',
  (() => {
    const input = [...SORTSET]

    __internals.sortProfileSessions(input, 'name')

    return input.map(session => session.id).join(',') === 's1,s2,s3'
  })()
)
check(
  'manual follows the dragged order, with unseen sessions ahead of it',
  setIds(__internals.sortProfileSessions(SORTSET, 'manual', ['s3', 's1'])) === 's2,s3,s1',
  setIds(__internals.sortProfileSessions(SORTSET, 'manual', ['s3', 's1']))
)
check('every mode the menu offers is a mode the store takes', __internals.SESSION_SORT_MODES.join(',') === 'activity,manual,name,messages')
check(
  'a hand-edited store cannot invent a sort mode',
  JSON.stringify(__internals.normalizeSessionSort({ a: 'nope', b: 'name' })) === '{"b":"name"}',
  JSON.stringify(__internals.normalizeSessionSort({ a: 'nope', b: 'name' }))
)
check(
  'a profile with no mode stored is sorted by activity',
  __internals.sessionSortMode('nobody') === 'activity'
)
check(
  'a profile is sorted by whatever mode the store holds',
  (() => {
    __internals.setSessionSort('sorted-x', 'name')

    return (
      __internals.$sessionSort.get()['sorted-x'] === 'name' &&
      __internals.sessionSortMode('sorted-x') === 'name'
    )
  })()
)
check(
  'dragging a session IS choosing the manual order',
  (() => {
    __internals.setSessionOrder('sorted-y', ['s2', 's1'])

    return __internals.$sessionSort.get()['sorted-y'] === 'manual'
  })()
)

// Both sides of an Apropos link in one list.
const PAIRS = {
  zulu: {
    c1: { at: 1700000000000, kind: 'session', label: 'Parent One', parent: 'p1' },
    c2: { groupId: 'sg-1', kind: 'group', label: 'Topic A' }
  }
}
const pairIds = list => list.map(session => session.id).join(',')

check(
  'a parent and its Apropos child are BOTH listed, the child under the parent',
  pairIds(__internals.withAproposChildren([{ id: 'p1', title: 'Parent One' }, { id: 'p2' }], PAIRS, 'zulu')) ===
    'p1,c1,p2',
  pairIds(__internals.withAproposChildren([{ id: 'p1', title: 'Parent One' }, { id: 'p2' }], PAIRS, 'zulu'))
)
check(
  'a child the list already carries is never drawn twice',
  pairIds(__internals.withAproposChildren([{ id: 'p1' }, { id: 'c1' }], PAIRS, 'zulu')) === 'p1,c1'
)
check(
  'a group child is not attached under a session',
  !__internals.withAproposChildren([{ id: 'p1' }], PAIRS, 'zulu').some(session => session.id === 'c2')
)
check(
  "another profile's children stay out of this profile's list",
  pairIds(__internals.withAproposChildren([{ id: 'p1' }], PAIRS, 'other')) === 'p1'
)
check(
  'an injected child names its own session and keeps its link',
  (() => {
    const child = __internals.withAproposChildren([{ id: 'p1' }], PAIRS, 'zulu')[1]

    return child.title === 'Apropos: Parent One' && child.resolved_id === 'c1' && child.last_active === 1700000000
  })()
)

// Delete: close first, then the stored row — and never swallow a refusal.
const delCalls = []

h.responses['session.close'] = params => {
  delCalls.push(`close ${params.session_id}`)

  return { closed: true }
}
h.responses['session.delete'] = params => {
  delCalls.push(`delete ${params.session_id}`)

  return { deleted: params.session_id }
}

check(
  'delete closes every id the session could be live under, then drops the stored one',
  (await __internals.deleteSessionEntry({ openId: 'live-z1', profile: 'zulu', session_id: 'z1' })) === true &&
    delCalls.join(' · ') === 'close live-z1 · close z1 · delete z1',
  delCalls.join(' · ')
)
check(
  'the close sweep names the LIVE runtime id a row never knew',
  (() => {
    const ids = __internals.sessionCloseCandidates({
      live: [{ session_id: 'rt-77', session_key: 'z9' }],
      openId: 'open-1',
      storedId: 'z9'
    })

    return ids.includes('rt-77') && ids.indexOf('open-1') === 0
  })()
)

// The refusal that used to make "delete an active session" impossible: the
// gateway answers 4023, so the pane sweeps the live registry and retries once.
const sweep = []
let deleteAttempts = 0

h.responses['session.active_list'] = () => ({ sessions: [{ session_id: 'rt-77', session_key: 'z9' }] })
h.responses['session.close'] = params => {
  sweep.push(params.session_id)

  return { closed: true }
}
h.responses['session.delete'] = params => {
  deleteAttempts += 1

  if (deleteAttempts === 1) {
    throw new Error('4023 cannot delete an active session')
  }

  return { deleted: params.session_id }
}

check(
  'a delete the gateway refuses as "active" is closed again and retried once',
  (await __internals.deleteSessionEntry({ openId: 'rt-77', profile: 'zulu', session_id: 'z9' })) === true &&
    deleteAttempts === 2 &&
    sweep.includes('rt-77'),
  `attempts=${deleteAttempts} closes=${sweep.join(',')}`
)

h.responses['session.delete'] = params => {
  delCalls.push(`delete ${params.session_id}`)

  return { deleted: params.session_id }
}
h.responses['session.close'] = params => {
  delCalls.push(`close ${params.session_id}`)

  return { closed: true }
}
delete h.responses['session.active_list']
check(
  'delete refuses nothing on its own: no profile or no id is a no-op',
  (await __internals.deleteSessionEntry({ session_id: 'x' })) === false &&
    (await __internals.deleteSessionEntry({ profile: 'zulu' })) === false
)

h.responses['session.delete'] = () => {
  throw new Error('refused')
}

let deleteThrew = false

try {
  await __internals.deleteSessionEntry({ profile: 'zulu', session_id: 'z1' })
} catch {
  deleteThrew = true
}

check('a refused delete is reported, never swallowed', deleteThrew)

const created = []

h.responses['session.create'] = params => {
  created.push(params)

  return { session_id: 'live-new', stored_session_id: `child-${created.length}` }
}
h.responses['session.history'] = () => ({ count: 1, messages: [{ content: 'ask', role: 'user' }] })

const madeGroups = await __internals.aproposSelection([
  { profile: 'zulu', session_id: 'z1', title: 'One' },
  { profile: 'zulu', session_id: 'z2', title: 'Two' }
])
const selSeed = String(created[0]?.messages?.[0]?.content || '')

check(
  'Apropos over a multi-selection makes ONE group child',
  madeGroups === 1 && created.length === 1,
  JSON.stringify({ created: created.length, madeGroups })
)
check(
  'the selection group carries no parent session and one hidden digest row',
  !('parent_session_id' in created[0]) &&
    created[0].messages.length === 1 &&
    created[0].messages[0].display_kind === 'hidden' &&
    created[0].profile === 'zulu',
  JSON.stringify(created[0]).slice(0, 220)
)
check(
  'every selected session is in the seed, with its own link',
  selSeed.includes('(session z1)') && selSeed.includes('(session z2)') && selSeed.includes('2 sessions'),
  selSeed.slice(0, 240)
)
check(
  'the selection becomes a REAL apropos group holding its members and its child',
  (() => {
    const slice = __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'zulu')
    const group = slice.groups.find(entry => entry.apropos === true)

    if (!group) {
      return false
    }

    const held = Object.entries(slice.members)
      .filter(([, id]) => id === group.id)
      .map(([storedId]) => storedId)
    const link = Object.entries(__internals.$apropos.get().zulu || {}).find(
      ([, entry]) => entry.kind === 'group' && entry.groupId === group.id
    )

    return (
      group.name.startsWith('Apropos: ') &&
      ['z1', 'z2'].every(id => held.includes(id)) &&
      Boolean(link) &&
      held.includes(link[0])
    )
  })()
)

created.length = 0

const madeOne = await __internals.aproposSelection([{ profile: 'zulu', session_id: 'z9', title: 'Only' }])

check(
  'one ticked session takes the plain single-session Apropos path',
  madeOne === 1 &&
    created[0] &&
    !('parent_session_id' in created[0]) &&
    String(created[0].title || '').startsWith('Apropos: '),
  JSON.stringify(created[0] || {}).slice(0, 160)
)

created.length = 0

const madeAcross = await __internals.aproposSelection([
  { profile: 'zulu', session_id: 'z1' },
  { profile: 'zulu', session_id: 'z2' },
  { profile: 'default', session_id: 'd1' }
])

check(
  'a selection that spans profiles makes one group per profile',
  madeAcross === 2 && created.length === 2 && new Set(created.map(params => params.profile)).size === 2,
  JSON.stringify(created.map(params => params.profile))
)
check(
  'a tick with no profile or no id is dropped, never guessed at',
  (await __internals.aproposSelection([{ profile: '', session_id: 'x' }, { profile: 'zulu' }])) === 0
)

// The menu itself: sorting is offered on the profile, deletion on the session.
check(
  'the profile menu offers Sort sessions, with every mode',
  (() => {
    const menu = renderToStaticMarkup(
      jsx(__internals.ProfileRow, {
        isCurrent: false,
        nowMs: nowSec * 1000,
        row: { label: 'Zulu', lastActiveMs: nowSec * 1000, messages: 2, name: 'zulu', preview: 'hi' },
        scope: null,
        sessions: [],
        t: key => key
      })
    )

    return (
      menu.includes('Sort sessions') &&
      Object.values(__internals.SESSION_SORT_LABELS).every(label => menu.includes(label))
    )
  })()
)
check(
  'the session menu offers Delete session',
  renderToStaticMarkup(
    jsx(__internals.SessionRow, {
      nowMs: nowSec * 1000,
      profile: 'zulu',
      session: { id: 'sess-zulu-9', title: 'Flux migration' }
    })
  ).includes('Delete session…')
)

// ── item-first drag: hold the thing, not a handle ──────────────────────────
// Pedro, 2026-10-10: "can you make DnD activate by holding the actual item
// (session, profile, group), instead of needing a grip icon?"
//
// The item is also a button, so the gesture is: press, and only a MOVE arms it.
// Below the threshold the click lands as always; past it the drag owns the
// gesture and the click that follows the release is swallowed.

check('stillness is never a drag', !__internals.dragArmed(0, 0) && !__internals.dragArmed(2, 2))
check('a nudge is never a drag', !__internals.dragArmed(4, 0))
check('past the threshold it is a drag, in any direction', __internals.dragArmed(5, 0) && __internals.dragArmed(-3, -2))

check(
  'a drag that just ended swallows the click it released',
  (() => {
    let ran = false
    const event = { preventDefault: () => {}, stopPropagation: () => {} }

    __internals.itemDrag.moved = true

    const out = __internals.guardClick(() => {
      ran = true
    })(event)

    __internals.itemDrag.moved = false

    return out === undefined && ran === false
  })()
)
check(
  'and a plain click is passed straight through',
  (() => {
    let ran = false

    __internals.itemDrag.moved = false
    __internals.guardClick(() => {
      ran = true
    })({})

    return ran
  })()
)

// The live gesture, with a stand-in window (Node has none): press, nudge, arm.
const dragWindow = (() => {
  const listeners = {}

  return {
    addEventListener: (type, fn) => {
      listeners[type] = [...(listeners[type] || []), fn]
    },
    fire: (type, event) => [...(listeners[type] || [])].forEach(fn => fn(event)),
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter(entry => entry !== fn)
    }
  }
})()

globalThis.window = dragWindow

const armedWith = []
const press = (extra = {}) =>
  __internals.itemDragStart(
    { button: 0, clientX: 100, clientY: 100, pointerType: 'mouse', target: null, ...extra },
    { id: 's1', kind: 'session' },
    (event, next) => armedWith.push(next)
  )

__internals.itemDrag.busy = false
__internals.itemDrag.moved = false
press()

check('a press on an item arms nothing by itself', armedWith.length === 0)
dragWindow.fire('pointermove', { clientX: 102, clientY: 100 })
check('a nudge below the threshold is still a click', armedWith.length === 0)
dragWindow.fire('pointermove', { clientX: 109, clientY: 100 })
check(
  'past the threshold the drag takes over, exactly once',
  armedWith.length === 1 && armedWith[0].id === 's1',
  JSON.stringify(armedWith)
)
dragWindow.fire('pointermove', { clientX: 200, clientY: 100 })
check('and the same gesture never re-arms', armedWith.length === 1)
dragWindow.fire('pointerup', {})
check(
  'the release keeps the guard up until its click has been spent',
  __internals.itemDrag.moved === true &&
    __internals.guardClick(() => 'ran')({}) === undefined
)

await new Promise(resolve => setTimeout(resolve, 1))

check('after that click, the next one goes through', __internals.itemDrag.moved === false)

press({ button: 2 })
dragWindow.fire('pointermove', { clientX: 300, clientY: 100 })
check('a right-click never starts a drag', armedWith.length === 1)

press({ target: { closest: () => ({}) } })
dragWindow.fire('pointermove', { clientX: 400, clientY: 100 })
check('a press that landed on the grip belongs to the grip', armedWith.length === 1)

__internals.itemDrag.busy = true
press()
dragWindow.fire('pointermove', { clientX: 500, clientY: 100 })
check('no second gesture while one is already in flight', armedWith.length === 1)
__internals.itemDrag.busy = false

dragWindow.fire('pointerup', {})
delete globalThis.window

// The affordance itself: every draggable thing carries the hook, and nothing
// that cannot be dragged pretends it can.
const itemMarkup = markup => markup.includes('data-item-drag');

check(
  'a session row carries the hold-to-drag hook',
  renderToStaticMarkup(
    jsx(__internals.SessionRow, {
      nowMs: nowSec * 1000,
      onDragStart: () => {},
      profile: 'zulu',
      session: { id: 'sess-zulu-9', title: 'Flux migration' }
    })
  ).includes('data-item-drag="session"')
)
check(
  'a drill-down row (no drag wiring) does not',
  !itemMarkup(
    renderToStaticMarkup(
      jsx(__internals.SessionRow, {
        nowMs: nowSec * 1000,
        profile: 'zulu',
        session: { id: 'sess-zulu-9', title: 'Flux migration' }
      })
    )
  )
)
check(
  'and a selecting row ticks instead — no drag in select mode',
  !itemMarkup(
    renderToStaticMarkup(
      jsx(__internals.SessionRow, {
        nowMs: nowSec * 1000,
        onDragStart: () => {},
        profile: 'zulu',
        selecting: true,
        session: { id: 'sess-zulu-9', title: 'Flux migration' }
      })
    )
  )
)
check(
  'a profile row carries it too',
  renderToStaticMarkup(
    jsx(__internals.ProfileRow, {
      isCurrent: false,
      nowMs: nowSec * 1000,
      onDragStart: () => {},
      row: { label: 'Zulu', lastActiveMs: nowSec * 1000, messages: 2, name: 'zulu', preview: 'hi' },
      scope: null,
      sessions: [],
      t: key => key
    })
  ).includes('data-item-drag="profile"')
)
check(
  'so does a session-group heading, and a profile section heading',
  renderToStaticMarkup(
    jsx(__internals.SessionGroupHeading, {
      block: { collapsed: false, id: 'sg-1', name: 'Topic A', sessions: [{ id: 'a1' }] },
      onDelete: () => {},
      onDragStart: () => {},
      onRename: () => {},
      onToggle: () => {},
      profile: 'zulu'
    })
  ).includes('data-item-drag="sessionGroup"') &&
    renderToStaticMarkup(
      jsx(__internals.SectionHeading, {
        block: { collapsed: false, id: 'sec-1', name: 'Work', rows: [] },
        index: 0,
        onAddProfiles: () => {},
        onDelete: () => {},
        onDragStart: () => {},
        onMove: () => {},
        onRename: () => {},
        onSort: () => {},
        scopeCount: 0,
        sort: 'activity'
      })
    ).includes('data-item-drag="group"')
)
check(
  'a heading with no drag wiring carries no hook',
  !itemMarkup(
    renderToStaticMarkup(
      jsx(__internals.SessionGroupHeading, {
        block: { collapsed: false, id: 'sg-1', name: 'Topic A', sessions: [{ id: 'a1' }] },
        onDelete: () => {},
        onRename: () => {},
        onToggle: () => {},
        profile: 'zulu'
      })
    )
  )
)
check(
  'the item IS the handle: a drag-wired row marks itself and carries no grip',
  (() => {
    const row = renderToStaticMarkup(
      jsx(__internals.SessionRow, {
        nowMs: nowSec * 1000,
        onDragStart: () => {},
        profile: 'zulu',
        session: { id: 'sess-zulu-9', title: 'Flux migration' }
      })
    )

    return row.includes('data-item-drag="session"') && !row.includes('data-drag-grip')
  })()
)

// ── 2026-10-10: hiding, deleting a live session, moving groups, Apropos groups ──
// Pedro's six asks, in the order he wrote them. Each one pins the SHAPE (a
// marker, a store value, a call order) rather than the pixels.

const FIXTURE_SESSIONS = [
  { id: 'HIDDEN-ROW-X', last_active: nowSec, title: 'HIDDEN-ROW-X' },
  { id: 'VISIBLE-ROW-Y', last_active: nowSec - 30, title: 'VISIBLE-ROW-Y' },
  { id: 'apropos-child', last_active: nowSec - 60, title: 'Apropos: Topic' }
]

const renderZulu = extra =>
  renderToStaticMarkup(
    jsx(__internals.ProfileRow, {
      expanded: true,
      isCurrent: false,
      nowMs: nowSec * 1000,
      onDeleteGroup: () => {},
      onDragStart: () => {},
      onMoveGroup: () => {},
      onMoveGroupOrder: () => {},
      onNewGroup: () => {},
      onNewGroupCancel: () => {},
      onNewGroupSubmit: () => {},
      onOpen: () => {},
      onRename: () => {},
      onRenameCancel: () => {},
      onRenameGroup: () => {},
      onRenameGroupCancel: () => {},
      onRenameGroupSubmit: () => {},
      onRenameSubmit: () => {},
      onSelect: () => {},
      onToggle: () => {},
      onToggleGroup: () => {},
      onToggleSelect: () => {},
      onView: () => {},
      row: { label: 'Zulu', lastActiveMs: nowSec * 1000, messages: 3, name: 'zulu', preview: '' },
      scope: null,
      selectedKeys: [],
      selecting: false,
      sessionOrder: {},
      sessions: FIXTURE_SESSIONS,
      t: key => key,
      ...extra
    })
  )

h.responses['session.close'] = params => ({ closed: params.session_id })
delete h.responses['session.active_list']
__internals.unhideAll('zulu')

const beforeHide = renderZulu()
const requestsBeforeHide = h.requests.length

__internals.setSessionHidden('zulu', 'HIDDEN-ROW-X', true)

const afterHide = renderZulu()

check(
  'hiding a session takes it out of the pane list and leaves the rest',
  beforeHide.includes('VISIBLE-ROW-Y') &&
    afterHide.includes('VISIBLE-ROW-Y') &&
    !afterHide.includes('HIDDEN-ROW-X'),
  afterHide.slice(afterHide.indexOf('data-profile="zulu"'), 200)
)
check(
  'hiding is pane-local: it writes NO core state and calls NO gateway method',
  h.requests.length === requestsBeforeHide,
  `${h.requests.length - requestsBeforeHide} request(s) went out`
)
check(
  'showing hidden brings the row back, marked and offering the way out',
  (() => {
    const shownMarkup = renderZulu({ showHidden: { zulu: true } })

    return (
      shownMarkup.includes('HIDDEN-ROW-X') &&
      shownMarkup.includes('data-session-hidden="HIDDEN-ROW-X"') &&
      shownMarkup.includes('Unhide in Personae') &&
      glyphFor(shownMarkup, 'Unhide in Personae') === 'eye'
    )
  })()
)
check(
  'the profile menu offers the reveal toggle only when something is hidden',
  renderZulu().includes('Show hidden (1)') && !renderZulu({ sessions: [] }).includes('Show hidden (')
)

// Pedro, 2026-10-13 (item 1): "also glyph the profile menu". Same wrapper, same
// font, same rule as the session table above — a verb core already has wears
// core's own glyph ("Edit profile…" the pencil), a tab verb a browser, and the
// reveal toggle the eye whose opposite ("Hide from Personae") is already
// `eye-closed`. The slice starts at the profile ROW and stops at the first
// session row under it, so a lookup cannot wander into a session's own menu.
const profileMenuOf = html => {
  const start = html.indexOf('data-profile-row')
  const from = html.indexOf('data-slot="context-menu-content"', start)
  const to = html.indexOf('data-session=', from)

  return from < 0 ? '' : html.slice(from, to < 0 ? undefined : to)
}
const PROFILE_GLYPHS = {
  'Edit profile…': 'edit',
  'New session': 'add',
  'Open all in tabs': 'browser',
  'Open newest session': 'history',
  'Show hidden (1)': 'eye',
  'Sort sessions': 'list-ordered'
}

check(
  'every option in the profile pop-up carries a glyph too',
  Object.entries(PROFILE_GLYPHS).every(
    ([label, icon]) => glyphFor(profileMenuOf(renderZulu()), label) === icon
  ),
  Object.entries(PROFILE_GLYPHS)
    .filter(([label, icon]) => glyphFor(profileMenuOf(renderZulu()), label) !== icon)
    .map(([label, icon]) => `${label}: got ${glyphFor(profileMenuOf(renderZulu()), label)}, want ${icon}`)
    .join('\n        ')
)
check(
  'Sort sessions is still a submenu trigger, glyph and all',
  isSubmenuTrigger(profileMenuOf(renderZulu()), 'Sort sessions')
)
check(
  'and the way back out of hidden carries one too',
  glyphFor(profileMenuOf(renderZulu({ showHidden: { zulu: true } })), 'Unhide all (1)') === 'eye',
  profileMenuOf(renderZulu({ showHidden: { zulu: true } }))
)
check('and one call brings them all back', __internals.unhideAll('zulu') === undefined && __internals.hiddenFor('zulu').length === 0)

// The menu verbs he asked for by name.
const menuMarkup = renderZulu()

check(
  'the delete verb is core-destructive and carries a trash icon',
  (() => {
    const at = menuMarkup.indexOf('data-variant="destructive"')

    return at >= 0 && menuMarkup.slice(at, at + 220).includes('data-codicon="trash"')
  })(),
  menuMarkup.slice(menuMarkup.indexOf('data-variant="destructive"'), 240)
)
check('the session menu offers Hide from Personae', menuMarkup.includes('Hide from Personae'))

// Moving a group: the drag has a target over the whole box, and the menu has
// the verb that cannot be a silent no-op.
__internals.createSessionGroup('delta', 'First', ['d1'])
__internals.createSessionGroup('delta', 'Second', ['d2'])

const deltaGroups = __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'delta')
const [first, second] = deltaGroups.order

check(
  'a group dropped on another group\'s BOX re-orders them',
  (() => {
    const action = __internals.dropAction(
      { group: first, kind: 'sessionGroup', profile: 'delta' },
      { groupBox: second, sessionGroup: '' }
    )

    return action?.kind === 'sessionGroupOrder' && action.onto === second && action.id === first
  })()
)
check(
  'Move down swaps exactly two slots, and the ends refuse instead of wrapping',
  __internals.moveSessionGroup('delta', second, -1) === true &&
    JSON.stringify(__internals.profileSessionGroups(__internals.$sessionGroups.get(), 'delta').order) ===
      JSON.stringify([second, first]) &&
    __internals.moveSessionGroup('delta', second, -1) === false
)

// An Apropos group is a normal group plus a mark: the diamond, and its child
// living inside the box with the ↩ chip.
const aproposGroupId = __internals.createSessionGroup('zulu', 'Apropos: Topic', [], { apropos: true })

__internals.moveSessionsToGroup('zulu', ['apropos-child'], aproposGroupId)
__internals.rememberAproposGroup('zulu', 'apropos-child', aproposGroupId, 'Apropos: Topic')

const aproposGroupMarkup = renderZulu()
const boxAt = aproposGroupMarkup.indexOf(`data-session-group-box="${aproposGroupId}"`)
const boxEnd = aproposGroupMarkup.indexOf('data-session-group-box=', boxAt + 10)
const box = aproposGroupMarkup.slice(boxAt, boxEnd === -1 ? aproposGroupMarkup.length : boxEnd)

check(
  'an Apropos group draws the diamond beside its name and is a normal group otherwise',
  box.includes(`data-apropos-group="${aproposGroupId}"`) &&
    box.includes('◆') &&
    box.includes(`data-drop-session-group="${aproposGroupId}"`) &&
    box.includes(`data-drop-group-box="${aproposGroupId}"`),
  box.slice(0, 240)
)
check(
  'the generated child shows up INSIDE the box, with the curved hook on its name',
  box.includes('data-drop-session="apropos-child"') &&
    box.includes('data-row-mark="child"') &&
    /data-row-mark="child"[^>]*>↳</.test(box),
  box.slice(box.indexOf('apropos-child'), box.indexOf('apropos-child') + 300)
)
// The diamond follows MEMBERSHIP, which is the box: filing a session into an
// Apropos group is how it becomes a source, whether it arrived by the verb or by
// a drag. Pedro, 2026-10-10: "If a user drags an existing session into the [group],
// put the diamond icon next to it."
check(
  'a session filed into an Apropos group earns the diamond',
  (() => {
    __internals.moveSessionsToGroup('zulu', ['VISIBLE-ROW-Y'], aproposGroupId)

    const next = renderZulu()
    const at = next.indexOf('data-drop-session="VISIBLE-ROW-Y"')

    return at >= 0 && /data-row-mark="source"[^>]*>◆</.test(next.slice(at, at + 800))
  })()
)
check(
  '…and loses it the moment it is taken back out',
  (() => {
    __internals.moveSessionsToGroup('zulu', ['VISIBLE-ROW-Y'], null)

    const next = renderZulu()
    const at = next.indexOf('data-drop-session="VISIBLE-ROW-Y"')

    return at >= 0 && !next.slice(at, at + 800).includes('data-row-mark')
  })()
)
check(
  'the child is NOT also marked as a source: the hook IS its source mark',
  (() => {
    const next = renderZulu()
    const at = next.indexOf('data-drop-session="apropos-child"')

    return at >= 0 && /data-row-mark="child"/.test(next.slice(at, at + 800))
  })()
)
check(
  'and the heading is offered Apropos over the group it belongs to',
  aproposGroupMarkup.includes('Apropos this group (beta)')
)

// The naming field: a form, not a bare input that dies on blur. It renders a
// commit button, and its blur path COMMITS instead of cancelling.
const fieldMarkup = renderToStaticMarkup(
  jsx(__internals.NameField, {
    initial: '',
    label: 'Session group name',
    onCancel: () => {},
    onSubmit: () => {},
    submitLabel: 'Create'
  })
)

check(
  'the naming field is a form with an explicit commit button',
  fieldMarkup.includes('data-slot="input"') && fieldMarkup.includes('>Create<'),
  fieldMarkup.slice(0, 200)
)

// ── 2026-10-10 (round 6): a row the pane invented has to be deletable, a
//    profile has to be able to leave a group, and converting a group is not
//    the same verb as starting a child ───────────────────────────────────────

// "Apropos this group" CONVERTS. Only the explicit "New child session" — and
// the session menu's own Apropos — starts one. Pedro, 2026-10-10: "when choosing
// 'apropos this group', it should not create a child session automatically."
check(
  'the header verb converts a plain group and starts a child on an Apropos one',
  __internals.aproposVerbKind(false) === 'convert' && __internals.aproposVerbKind(true) === 'child'
)
const R6_SRC = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

check(
  '…and the pane branches on that instead of always generating',
  R6_SRC.includes("if (aproposVerbKind(block.apropos) === 'convert')") &&
    R6_SRC.includes('markSessionGroupApropos(row.name, block.id)') &&
    !R6_SRC.includes('onApropos: () => aproposGroupSession(')
)
check(
  'a refused delete keeps the strip open and prints the gateway’s reason',
  R6_SRC.includes('const [deleteError, setDeleteError] = useState(') &&
    R6_SRC.includes('setDeleteError(failed)') &&
    R6_SRC.includes('text-[0.6875rem] text-destructive')
)

// PROFILE DnD, both ways. The destination is the SCOPE under the pointer — a
// group heading, any row inside that group, or the unassigned block.
const profileDrop = (drag, target) =>
  __internals.dropAction(drag, {
    group: '',
    groupBox: '',
    profile: '',
    profileSide: '',
    scope: '',
    session: '',
    sessionGroup: '',
    sessionSide: '',
    ...target
  })
const FILED = { kind: 'profile', name: 'zulu', scope: 'section:workers', section: 'section:workers' }
const LOOSE = { kind: 'profile', name: 'zulu', scope: 'section:unassigned', section: 'section:unassigned' }

check(
  'a profile dropped on the unassigned block LEAVES its group',
  profileDrop(FILED, { group: 'section:unassigned', profile: 'kilo' })?.kind === 'file' &&
    profileDrop(FILED, { group: 'section:unassigned', profile: 'kilo' })?.section ===
      'section:unassigned'
)
check(
  '…and one dropped on a ROW of the unassigned block leaves it too',
  profileDrop(FILED, { profile: 'kilo', scope: 'section:unassigned' })?.section ===
    'section:unassigned'
)
check(
  'a profile dropped on a ROW INSIDE a group joins it',
  profileDrop(LOOSE, { profile: 'kilo', scope: 'section:workers' })?.section === 'section:workers'
)
check(
  '…and the heading still works',
  profileDrop(LOOSE, { group: 'section:workers', profile: '' })?.section === 'section:workers'
)
check(
  'a profile dropped on a row of its OWN group re-orders instead of re-filing',
  (() => {
    const action = profileDrop(FILED, { profile: 'kilo', scope: 'section:workers' })

    return action?.kind === 'order' && action.scope === 'section:workers'
  })()
)
check(
  '…and dropping it on its own group’s heading does nothing at all',
  profileDrop(FILED, { group: 'section:workers', profile: '' }) === null
)
check(
  'the anonymous no-groups list is not a destination',
  (() => {
    const action = profileDrop(FILED, { profile: 'kilo', scope: 'all' })

    return !action || action.kind === 'order'
  })()
)

// A DELETED CHILD THAT CANNOT DIE. `withAproposChildren` synthesizes a row for
// every link whose child core does not list, so a stale link is a row that comes
// back after every delete. Pedro, 2026-10-10: "I cannot seem to delete some child
// sessions". Core answers 4007 for a session that is already gone.
const phantom = 'phantom-child-1'

__internals.rememberApropos('zulu', phantom, 'zulu-parent', 'Parent')
__internals.moveSessionsToGroup('zulu', [phantom], 'g-1')
h.responses['session.active_list'] = () => ({ sessions: [] })
h.responses['session.close'] = () => ({ closed: true })
h.responses['session.delete'] = () => {
  throw new Error('4007 session not found')
}

const phantomDeleted = await __internals.deleteSessionEntry({ profile: 'zulu', session_id: phantom })

check(
  'deleting a session core no longer has drops the pane’s record instead of failing',
  phantomDeleted === true && !__internals.$apropos.get().zulu?.[phantom]
)
check(
  '…and takes the group membership with it',
  __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'zulu').members[phantom] ===
    undefined
)
check(
  '…so the row stops being synthesized (the page already lacked it)',
  !__internals
    .withAproposChildren([{ id: 'zulu-parent' }], __internals.$apropos.get(), 'zulu')
    .some(session => session.id === phantom)
)

// And a delete that SUCCEEDS cleans up the same records, so a live child does
// not come straight back as a synthetic row either.
h.responses['session.delete'] = () => ({ deleted: 'real-child-1' })

__internals.rememberApropos('zulu', 'real-child-1', 'zulu-parent', 'Parent')

const realDeleted = await __internals.deleteSessionEntry({ profile: 'zulu', session_id: 'real-child-1' })

check(
  'a successful delete forgets the link too',
  realDeleted === true && !__internals.$apropos.get().zulu?.['real-child-1']
)
check(
  '…while a genuine failure still propagates',
  await (async () => {
    h.responses['session.delete'] = () => {
      throw new Error('5036 delete failed: disk on fire')
    }

    try {
      await __internals.deleteSessionEntry({ profile: 'zulu', session_id: 'boom-1' })

      return false
    } catch (error) {
      return /disk on fire/.test(String(error?.message || error))
    }
  })()
)

// The rest of a deleted session's pane-side records go with it too: a REAL group
// membership (the shop-floor case — the child was filed into a group) and a hide
// entry, because a hidden id that can never render again only lies about the
// "Show hidden (n)" count.
const ghostGroup = __internals.createSessionGroup('ghostly', 'Ghost group', ['ghost-1'], {})

__internals.setSessionHidden('ghostly', 'ghost-1', true)
__internals.rememberApropos('ghostly', 'ghost-1', 'ghostly-parent', 'Parent')
h.responses['session.delete'] = () => {
  throw new Error('4007 session not found')
}

const ghostDeleted = await __internals.deleteSessionEntry({
  profile: 'ghostly',
  session_id: 'ghost-1'
})

check(
  'a session that cannot die is forgotten everywhere at once',
  ghostDeleted === true &&
    !__internals.$apropos.get().ghostly?.['ghost-1'] &&
    __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'ghostly').members['ghost-1'] ===
      undefined &&
    !(__internals.$hiddenSessions.get().ghostly || []).includes('ghost-1') &&
    __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'ghostly').groups.some(
      group => group.id === ghostGroup
    )
)

// ── 2026-10-10 (round 5): the diamond reaches the members, the last untick
//    leaves select mode, and a deleted group never deletes a session ─────────

// "Apropos this group" used to produce a child and nothing else: the group was
// still a PLAIN group, and the ◆ on a row is derived from the group's flag, so
// its members stayed unmarked and out of the digest. Pedro, 2026-10-10: "When I
// click Apropos this group, the existing sessions don't get the diamond icon
// along with their functionality."
const diamondGroup = __internals.createSessionGroup('diamond', 'D', ['d1', 'd2'], {})

check(
  '…and clicking the header verb is what makes a plain group an Apropos one',
  __internals.markSessionGroupApropos('diamond', diamondGroup) === true &&
    __internals.sessionGroupBlocks(
      [{ id: 'd1', title: 'One' }, { id: 'd2', title: 'Two' }],
      __internals.$sessionGroups.get(),
      'diamond'
    ).find(block => block.id === diamondGroup)?.apropos === true &&
    __internals.markSessionGroupApropos('diamond', diamondGroup) === false
)

const diamondRow = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    aproposGroup: true,
    group: diamondGroup,
    nowMs: nowSec * 1000,
    onDragStart: () => {},
    profile: 'diamond',
    session: { id: 'd1', title: 'One' }
  })
)

check(
  '…which puts the source diamond on every member row',
  diamondRow.includes('data-row-mark="source"') && diamondRow.includes('◆'),
  diamondRow.slice(0, 240)
)

// And a session DRAGGED into such a group is a source the same way — the mark
// is membership, read from the box (see sessionGroupBlocks).
check(
  '…and a session filed into it becomes a source on the next draw',
  (() => {
    __internals.moveSessionsToGroup('diamond', ['d3'], diamondGroup)

    const blocks = __internals.sessionGroupBlocks(
      [{ id: 'd1', title: 'One' }, { id: 'd3', title: 'Three' }],
      __internals.$sessionGroups.get(),
      'diamond'
    )

    return blocks.find(block => block.id === diamondGroup)?.sessions.length === 2
  })()
)

// One verb, two names: on a plain group it MAKES the Apropos group, on one that
// already is it starts another child. Pedro, 2026-10-10: "The header options
// should have 'new child session'."
check(
  'the header verb reads "New child session" once the group is an Apropos group',
  __internals
    .sessionGroupMenuEntries({
      apropos: true,
      canApropos: true,
      groupCount: 2,
      index: 0,
      onApropos: () => {},
      onDelete: () => {},
      onMove: () => {},
      onRename: () => {}
    })
    .find(entry => entry.key === 'apropos')?.label === 'New child session (beta)'
)
check(
  '…and still reads "Apropos this group" on a plain one',
  __internals
    .sessionGroupMenuEntries({
      apropos: false,
      canApropos: true,
      groupCount: 2,
      index: 0,
      onApropos: () => {},
      onDelete: () => {},
      onMove: () => {},
      onRename: () => {}
    })
    .find(entry => entry.key === 'apropos')?.label === 'Apropos this group (beta)'
)
check(
  '…and a third child is seeded from the SOURCES, not from the child already inside',
  (() => {
    const links = {
      diamond: { childA: { at: 1, groupId: diamondGroup, kind: 'group', label: 'D' } }
    }
    const sources = __internals.aproposSources({
      groupId: diamondGroup,
      links,
      profile: 'diamond',
      sessions: [{ id: 'childA' }, { id: 'd1' }, { id: 'd3' }]
    })

    return sources.length === 2 && sources.every(session => session.id !== 'childA')
  })()
)

// Unticking the last row is how the user leaves select mode — there is nothing
// left for the bar to act on. Pedro, 2026-10-10: "if the user unselects the last
// item and none are selected, stop the multiselect action."
check(
  'unticking the LAST tick empties the set, which leaves select mode',
  (() => {
    const one = __internals.tickState(['zulu|a1'], 'zulu|a1')

    return one.empty === true && one.keys.length === 0
  })()
)
check(
  '…while unticking one of two keeps the mode, and a first tick never empties it',
  (() => {
    const two = __internals.tickState(['zulu|a1', 'zulu|a2'], 'zulu|a1')
    const first = __internals.tickState([], 'zulu|a1')

    return two.empty === false && two.keys.length === 1 && first.empty === false
  })()
)

// Deleting a group is never deleting sessions: the members are UNFILED, and the
// pane keeps them visible in the single list they fall back into. Pedro,
// 2026-10-10: "When deleting a group, apropos or not, sessions inside should not
// be deleted, just removed from the group."
const freedGroup = __internals.createSessionGroup('freed', 'F', ['f1', 'f2', 'f3'], {})

__internals.deleteSessionGroup('freed', freedGroup)

check(
  'deleting a group unfiles its sessions and never deletes them',
  __internals.$sessionGroups.get().freed?.groups.length === 0 &&
    Object.keys(__internals.$sessionGroups.get().freed?.members || {}).length === 0 &&
    ['f1', 'f2', 'f3'].every(id => __internals.releasedFor('freed').includes(id))
)

const pinPool = Array.from({ length: 14 }, (_, index) => ({ id: `p${index}`, title: `P${index}` }))
const pinRest = __internals
  .sessionGroupBlocks(pinPool, {}, 'pinprofile', ['p12'])
  .find(block => block.id === null)
  .sessions.map(session => session.id)

check(
  'a session released from a group stays in the single list past the inline cap',
  pinRest.length === __internals.SESSIONS_PER_PROFILE + 1 &&
    pinRest.includes('p12') &&
    !pinRest.includes('p11'),
  JSON.stringify(pinRest)
)
check(
  '…and the page keeps room for it (wantedSessionIds counts the release)',
  __internals.wantedSessionIds('freed').includes('f1')
)

// ── 2026-10-10 (round 4): leaving a group, no grips anywhere the user grabs,
//    and a page wide enough to hold what was filed ──────────────────────────

// Leaving a group. The anonymous block carries no box attribute — there is no
// group there to read — so the ROW under the pointer is what says "not in a
// group", and a grouped session dropped on the plain list is UNFILED. Pedro,
// 2026-10-10: "moving a session out of a group should remove them from the group
// and into the single sessions list."
const dropTile = (drag, target) =>
  __internals.dropAction(drag, {
    group: '',
    groupBox: '',
    profile: 'zulu',
    profileSide: '',
    scope: '',
    session: '',
    sessionGroup: '',
    sessionSide: '',
    ...target
  })

check(
  'a session dropped on the plain list LEAVES its group',
  (() => {
    const action = dropTile(
      { group: 'g-1', id: 'a3', kind: 'session', profile: 'zulu' },
      { session: 'a7', sessionSide: 'before' }
    )

    return action?.kind === 'sessionFile' && action.group === null && action.ids[0] === 'a3'
  })(),
  JSON.stringify(
    dropTile({ group: 'g-1', id: 'a3', kind: 'session', profile: 'zulu' }, { session: 'a7', sessionSide: 'before' })
  )
)
check(
  '…and an ungrouped session dropped on the plain list still just re-orders',
  (() => {
    const action = dropTile(
      { group: '', id: 'a3', kind: 'session', profile: 'zulu' },
      { session: 'a7', sessionSide: 'before' }
    )

    return action?.kind === 'sessionOrder' && action.onto === 'a7'
  })()
)

// No grip anywhere a user grabs: sessions, profiles and profile-group headings.
// The item is the handle in all three (arm-on-movement), so the grip is gone AND
// the marker that proves the wiring is there.
const gripAudit = (() => {
  const row = renderToStaticMarkup(
    jsx(__internals.SessionRow, {
      nowMs: nowSec * 1000,
      onDragStart: () => {},
      profile: 'zulu',
      session: { id: 'sess-zulu-9', title: 'Flux migration' }
    })
  )
  const heading = renderToStaticMarkup(
    jsx(__internals.SectionHeading, {
      block: { collapsed: false, id: 'sec-grip', name: 'Clients', rows: [] },
      index: 0,
      onAddProfiles: () => {},
      onDelete: () => {},
      onDragStart: () => {},
      onMove: () => {},
      onRename: () => {},
      onSort: () => {},
      scopeCount: 1,
      sort: 'activity'
    })
  )

  return { heading, row }
})()

check(
  'a session row has no grip, and still says it is a drag handle',
  gripAudit.row.includes('data-item-drag="session"') && !gripAudit.row.includes('data-drag-grip')
)
check(
  'a profile-group heading has no grip either, and still says it is a drag handle',
  gripAudit.heading.includes('data-item-drag="group"') && !gripAudit.heading.includes('data-drag-grip'),
  gripAudit.heading.slice(0, 200)
)

// The page must be able to hold what the pane knows about. `session.list` is
// most-recent-first and the inline view asks for SESSIONS_PER_PROFILE, so a filed
// session older than that page vanished from its own group. Pedro, 2026-10-10:
// "it had two sessions inside, but only one was showing. Only after I deleted the
// first one, did the second one show up."
const fillIds = (list = []) => new Set(list.map(id => String(id)))

check(
  'nothing filed or linked: the page stays exactly as small as it has always been',
  __internals.nextSessionLimit({ count: 10, ids: fillIds(['a', 'b']), limit: 10, wanted: ['a'] }) === 0
)
check(
  'a filed session missing from a FULL page widens it',
  __internals.nextSessionLimit({ count: 10, ids: fillIds(['x']), limit: 10, wanted: ['filed-1'] }) === 60
)
check(
  '…and a SHORT page means the listing ended, so it stops asking',
  __internals.nextSessionLimit({ count: 4, ids: fillIds(['x']), limit: 60, wanted: ['filed-1'] }) === 0
)
check(
  '…and it never asks past the cap',
  __internals.nextSessionLimit({ count: 500, ids: fillIds([]), limit: 500, wanted: ['filed-1'] }) === 0
)
check(
  'nothing wanted means no page at all is asked for',
  __internals.nextSessionLimit({ count: 10, ids: fillIds([]), limit: 10, wanted: [] }) === 0
)

const wantedGroup = __internals.createSessionGroup('wanted', 'W', ['w1'], {})

__internals.rememberAproposGroup('wanted', 'w-group-child', wantedGroup, 'W')
__internals.rememberApropos('wanted', 'w-session-child', 'w-parent', 'Parent title')

const wanted = __internals.wantedSessionIds('wanted')

check(
  'the pane knows it must see filed members AND both ends of every link',
  ['w1', 'w-group-child', 'w-session-child', 'w-parent'].every(id => wanted.includes(id)),
  JSON.stringify(wanted)
)

// A group box draws every member the page holds; the PLAIN list keeps the inline
// cap, because that is the list "View all" is the end of.
const capGroup = __internals.createSessionGroup('cap', 'Cap', ['w1', 'w2'], {})
const capPool = Array.from({ length: 24 }, (_, index) => ({ id: `w${index}`, title: `T${index}` }))
const capBlocks = __internals.sessionGroupBlocks(capPool, __internals.$sessionGroups.get(), 'cap')

check(
  'the group box draws every member it has, while the plain list keeps the inline cap',
  capBlocks.find(block => block.id === capGroup)?.sessions.length === 2 &&
    capBlocks.find(block => block.id === null)?.sessions.length === __internals.SESSIONS_PER_PROFILE,
  JSON.stringify(capBlocks.map(block => [block.id, block.sessions.length]))
)

// ── 2026-10-10 (round 3): the heading's own left edge, a session dropped INTO a
//    group, and renaming a group together with its children ──────────────────

// 1. No grip in a group heading (the header itself is the handle), the caret at
// the group's far left, and the members indented from it. Before this the caret
// and the members' status dots shared one column, so a group read as a flat run
// of rows with a line drawn around it.
const headingOnly = (() => {
  const markup = renderZulu()
  const at = markup.indexOf(`data-session-group-box="${aproposGroupId}"`)
  const end = markup.indexOf('data-session-group-box=', at + 10)
  const slice = markup.slice(at, end === -1 ? markup.length : end)
  const first = slice.indexOf('data-drop-session=')

  return {
    fill: slice.slice(slice.indexOf('data-session-group-fill'), first),
    head: slice.slice(0, first)
  }
})()

check(
  'a group heading carries no grip — the header itself is the handle',
  headingOnly.head.length > 0 &&
    !headingOnly.head.includes('data-drag-grip') &&
    headingOnly.head.includes('data-item-drag="sessionGroup"'),
  headingOnly.head.slice(0, 200)
)
check(
  "the caret owns the group's far left edge, and the items are indented from it",
  headingOnly.head.includes('pl-1') && headingOnly.fill.includes('pl-3'),
  `head=${headingOnly.head.slice(0, 120)} fill=${headingOnly.fill.slice(0, 120)}`
)

// 2. A session dropped on a group lands IN it. The target has to be the BOX:
// filing read only the heading strip, and a heading is ~20px of a rectangle the
// user sees as a whole. Pedro, 2026-10-10: "When dragging a session into a group
// or an Apropos Group, nothing happens."
const dropOn = (drag, target) =>
  __internals.dropAction(drag, {
    group: '',
    groupBox: '',
    profile: 'zulu',
    profileSide: '',
    scope: '',
    session: '',
    sessionGroup: '',
    sessionSide: '',
    ...target
  })

check(
  'a session dropped on a group BOX lands in that group',
  (() => {
    const action = dropOn(
      { group: '', id: 'a3', kind: 'session', profile: 'zulu' },
      { groupBox: 'g-1' }
    )

    return (
      action?.kind === 'sessionFile' &&
      action.group === 'g-1' &&
      action.ids[0] === 'a3' &&
      action.profile === 'zulu'
    )
  })(),
  JSON.stringify(dropOn({ group: '', id: 'a3', kind: 'session', profile: 'zulu' }, { groupBox: 'g-1' }))
)
check(
  '…and the heading strip still files, so both halves of the box agree',
  (() => {
    const action = dropOn({ group: '', id: 'a3', kind: 'session', profile: 'zulu' }, { sessionGroup: 'g-3' })

    return action?.kind === 'sessionFile' && action.group === 'g-3'
  })()
)
check(
  '…onto a member of ANOTHER group means "join that group", not "sort"',
  (() => {
    const action = dropOn(
      { group: 'g-1', id: 'a3', kind: 'session', profile: 'zulu' },
      { groupBox: 'g-2', session: 'a9', sessionSide: 'before' }
    )

    return action?.kind === 'sessionFile' && action.group === 'g-2'
  })()
)
check(
  '…but a row of its OWN group still re-orders, side and all',
  (() => {
    const action = dropOn(
      { group: 'g-1', id: 'a3', kind: 'session', profile: 'zulu' },
      { groupBox: 'g-1', session: 'a4', sessionSide: 'before' }
    )

    return action?.kind === 'sessionOrder' && action.onto === 'a4' && action.side === 'before'
  })()
)

// 3. Renaming a group renames the children it started, prefix and all. Only a
// title this pane generated is ours to rewrite: a child the user renamed by hand
// keeps its own words.
// A profile of its own: this writes groups and links into the store, and the
// zulu fixtures later in this file count groups.
const retitleGroup = __internals.createSessionGroup('retitle', 'Apropos #7', [], { apropos: true })

__internals.rememberAproposGroup('retitle', 'child-ours', retitleGroup, 'Apropos #7')
__internals.rememberAproposGroup('retitle', 'child-mine', retitleGroup, 'Apropos #7')

const retitlePlan = __internals.aproposRetitlePlan({
  groupId: retitleGroup,
  links: __internals.$apropos.get(),
  name: 'HGHGF',
  profile: 'retitle',
  sessions: [
    { id: 'child-mine', title: 'my own words' },
    { id: 'child-ours', title: __internals.aproposChildTitle('Apropos #7') }
  ]
})

check(
  'renaming an Apropos group retitles the child it started',
  retitlePlan.length === 1 &&
    retitlePlan[0].id === 'child-ours' &&
    retitlePlan[0].title === 'Apropos group: HGHGF',
  JSON.stringify(retitlePlan)
)
check(
  '…and never overwrites a title the user typed',
  !retitlePlan.some(entry => entry.id === 'child-mine')
)
check(
  'a name that already reads as Apropos is used verbatim as the child title',
  __internals.aproposChildTitle('Apropos #7') === 'Apropos #7' &&
    __internals.aproposChildTitle('HGHGF') === 'Apropos group: HGHGF'
)

// ── 2026-10-10 (round 2): the dead batch bar, right-click selection, groups made
//    on the spot, Apropos groups, menu parity, View hidden ───────────────────

// 1. THE BATCH BAR. `profiles.list` carries NO `sessions` array (only
// `last_session` / `worker_session`), so a batch resolved against the roster
// found nothing: the count sat at "0 selected" and all five verbs were
// `disabled`. Pedro, 2026-10-10: "the buttons on top (Select All, Clear, Close,
// Archive, Delete) don't work… The numbering (0 selected) also does not work."
const ROSTER_ROWS = [{ label: 'Zulu', name: 'zulu' }]
const RENDERED_LISTS = { zulu: [{ id: 'z1', title: 'One' }, { id: 'z2', title: 'Two' }] }

check(
  'a batch read off the ROSTER alone finds nothing — the trap that killed the bar',
  __internals.selectedSessions(ROSTER_ROWS, ['zulu|z1']).length === 0
)
check(
  'resolved against the rows AS DRAWN it finds the ticks',
  (() => {
    const ticks = __internals.selectedSessions(__internals.rowsWithSessions(ROSTER_ROWS, RENDERED_LISTS), [
      'zulu|z1',
      'zulu|z2'
    ])

    return ticks.length === 2 && ticks[0].session_id === 'z1' && ticks[0].profile === 'zulu'
  })()
)
check(
  'Select all covers the rendered lists, not the session-less roster',
  __internals.allSessionKeys(__internals.rowsWithSessions(ROSTER_ROWS, RENDERED_LISTS)).join(',') === 'zulu|z1,zulu|z2'
)

const SRC = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

check(
  'and the PANE feeds the batch the merged rows (source assertion)',
  SRC.includes('const tickRows = rowsWithSessions(rows, byProfile)') &&
    SRC.includes('const ticks = selectedSessions(tickRows, selectedKeys)') &&
    SRC.includes('allSessionKeys(tickRows)')
)

// 2. RIGHT-CLICK SELECTS. Pedro, 2026-10-10: "if the user right-clicks on an
// item, assume that is the selected one when opening the right-click menu".
check(
  'right-clicking a row makes it the selection',
  JSON.stringify(__internals.clickSelect(['zulu|a'], 'zulu|b')) === JSON.stringify(['zulu|b'])
)
check(
  '…but a row already inside a multi-selection leaves the set alone',
  __internals.clickSelect(['zulu|a', 'zulu|b'], 'zulu|b').length === 2
)
check(
  '…and the row wires it on pointerdown, not on the trigger Radix owns',
  SRC.includes('if (event?.button === 2)') &&
    SRC.includes('onRightClickSelect?.(sessionKey(profile, storedId))')
)

// 3. GROUPS MADE ON THE SPOT. Pedro, 2026-10-10: "immediately create the group,
// with Group #1 or Apropos #1 … Don't give them a text box to fill in before the
// group is created."
__internals.createSessionGroup('hotel', 'Old one', ['h1'])

check(
  'the default name counts past the groups of its own shape',
  __internals.nextGroupName('hotel', false) === 'Group #1' && __internals.nextGroupName('hotel', true) === 'Apropos #1'
)
check(
  'a group EXISTS the moment it is asked for — nothing to type first',
  (() => {
    const made = __internals.createGroupNow('hotel', ['h2'])

    return (
      Boolean(made?.id) &&
      made.name === 'Group #1' &&
      __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'hotel').members['h2'] === made.id
    )
  })()
)
check('and the next one is numbered, not named twice', __internals.createGroupNow('hotel', []).name === 'Group #2')
check(
  'the numbering never mints a duplicate after a delete',
  (() => {
    const slice = __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'hotel')
    const second = slice.groups.find(group => group.name === 'Group #2')

    __internals.deleteSessionGroup('hotel', second.id)

    return __internals.nextGroupName('hotel', false) === 'Group #2'
  })()
)
check(
  'the pane arms a RENAME on the group it just made (no pre-naming field left)',
  SRC.includes('onNewGroup: sessionIds => {') &&
    SRC.includes('setRenamingGroup(made)') &&
    !SRC.includes('sg-naming')
)

// 4. "Create group" always makes a GROUP — even for one session.
h.responses['session.create'] = params => ({ stored_session_id: `child-${params.profile}-1` })

const oneGroup = await __internals.aproposCreateGroup([{ profile: 'zulu', session_id: 'solo', title: 'Solo' }])

check(
  '"Create group" makes an Apropos group for a SINGLE session, child inside',
  (() => {
    const slice = __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'zulu')
    const group = slice.groups.find(entry => entry.id === oneGroup[0].groupId)

    return (
      oneGroup.length === 1 &&
      oneGroup[0].name === 'Apropos #1' &&
      group?.apropos === true &&
      slice.members['solo'] === group.id &&
      slice.members['child-zulu-1'] === group.id
    )
  })(),
  JSON.stringify(oneGroup)
)
check(
  'and it is remembered as a GROUP link, so the child chips back to it',
  Object.values(__internals.$apropos.get().zulu || {}).some(
    entry => entry.kind === 'group' && entry.groupId === oneGroup[0].groupId
  )
)

// 5. MENU PARITY: the kebab and the right-click menu are one menu.
const parityHeading = renderToStaticMarkup(
  jsx(__internals.SessionGroupHeading, {
    block: { apropos: true, collapsed: false, id: 'sg-parity', name: 'Parity', sessions: [{ id: 'p1' }] },
    dragging: false,
    dropTarget: false,
    groupCount: 2,
    index: 0,
    onApropos: () => {},
    onDelete: () => {},
    onDragStart: () => {},
    onMove: () => {},
    onRename: () => {},
    onToggle: () => {},
    profile: 'zulu'
  })
)
const kebab = parityHeading.slice(
  parityHeading.indexOf('data-slot="dropdown-content"'),
  parityHeading.indexOf('data-slot="context-menu-content"')
)
const headerMenu = parityHeading.slice(parityHeading.indexOf('data-slot="context-menu-content"'))
// This heading IS an Apropos group, so the child verb wears its Apropos-group
// name (see sessionGroupMenuEntries) — the plain-group label is covered in the
// round-5 block.
const GROUP_VERBS = ['Rename…', 'Move up', 'Move down', 'New child session (beta)', 'Delete group']

check(
  'the three-dot menu carries every group verb, colour included',
  GROUP_VERBS.every(label => kebab.includes(`>${label}<`)) && kebab.includes('data-group-color')
)
check(
  'the right-click menu carries the SAME verbs, colour included',
  GROUP_VERBS.every(label => headerMenu.includes(`>${label}<`)) && headerMenu.includes('data-group-color')
)
check(
  'and they agree about which verb is destructive',
  kebab.includes('data-variant="destructive"') && headerMenu.includes('data-variant="destructive"')
)
check(
  'both menus offer the child verb — "New child session" on an Apropos group',
  kebab.includes('>New child session (beta)<') && headerMenu.includes('>New child session (beta)<')
)
check(
  'and a profile that HAS groups shows the filing submenu, with them in it',
  (() => {
    const withGroups = renderZulu()

    // Filing is the one verb that only exists once there are groups to file
    // into, so its glyph is asserted HERE rather than in the session-menu table
    // above, where the row is simply absent.
    return (
      menuLabel(withGroups, 'New session group') &&
      menuLabel(withGroups, 'Move to group') &&
      glyphFor(withGroups, 'Move to group') === 'move'
    )
  })(),
  `Move to group: ${glyphFor(renderZulu(), 'Move to group')}`
)

// 6. VIEW HIDDEN. Pedro, 2026-10-10: "next to View All and View Archives,
// include a View hidden option for the hidden sessions from messenger, and allow
// the user to unhide them."
// Hiding a row the fixture actually RENDERS, so the footer's count is real.
__internals.setSessionHidden('zulu', 'VISIBLE-ROW-Y', true)
__internals.setSessionHidden('zulu', 'h-1', true)

check(
  'the profile footer offers View hidden, counting what this profile hides',
  // The render stub returns the i18n KEY, so the label reads `viewHidden`. Only
  // VISIBLE-ROW-Y is both hidden AND in this fixture's list, hence the 1.
  renderZulu().includes('>viewHidden (1)<')
)

h.queryResults['personae|view|hidden|zulu'] = {
  data: [
    { id: 'h-1', last_active: nowSec - 60, title: 'Hid one' },
    { id: 'shown-2', last_active: nowSec - 120, title: 'Not hidden' }
  ],
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
__internals.$listView.set({ kind: 'hidden', profile: 'zulu' })

const hiddenView = render()

check(
  'View hidden is its own body, and lists ONLY what the store hides',
  hiddenView.includes('data-list-view="hidden"') &&
    hiddenView.includes('data-session="h-1"') &&
    !hiddenView.includes('data-session="shown-2"'),
  hiddenView.slice(0, 200)
)
check('and it offers the bulk way back', hiddenView.includes('>Unhide all<'))
check(
  'unhiding takes the row out of the list on the spot',
  (() => {
    __internals.unhideAll('zulu')

    return !render().includes('data-session="h-1"')
  })()
)

__internals.$listView.set(null)

if (process.env.PROBE) {
  const I = __internals
  const probeSessions = [
    { id: 'p1', title: 'one', last_active: nowSec },
    { id: 'p2', title: 'two', last_active: nowSec - 10 },
    { id: 'p3', title: 'three', last_active: nowSec - 20 }
  ]
  const shape = () =>
    JSON.stringify(
      I.sessionGroupBlocks(probeSessions, I.$sessionGroups.get(), 'zulu').map(b => ({
        id: b.id,
        name: b.name,
        s: b.sessions.map(x => x.id)
      }))
    )

  console.log('PROBE before:', shape())
  console.log('PROBE idA:', I.createSessionGroup('zulu', 'Alpha', ['p1']), shape())
  console.log('PROBE idB:', I.createSessionGroup('zulu', 'Beta', ['p2']), shape())
  console.log('PROBE idC:', I.createSessionGroup('zulu', 'Gamma', ['p3']), shape())
  console.log('PROBE order:', JSON.stringify(I.$sessionGroups.get().zulu.order))
  console.log('PROBE members:', JSON.stringify(I.$sessionGroups.get().zulu.members))
  I.reorderSessionGroups('zulu', I.$sessionGroups.get().zulu.order[2], I.$sessionGroups.get().zulu.order[0])
  console.log('PROBE after reorder:', shape())

  const markup = renderToStaticMarkup(
    jsx(I.ProfileRow, {
      expanded: true,
      isCurrent: false,
      nowMs: nowSec * 1000,
      onDragStart: () => {},
      onMoveGroup: () => {},
      onNewGroup: () => {},
      onNewGroupCancel: () => {},
      onNewGroupSubmit: () => {},
      onDeleteGroup: () => {},
      onRenameGroup: () => {},
      onRenameGroupCancel: () => {},
      onRenameGroupSubmit: () => {},
      onToggleGroup: () => {},
      onOpen: () => {},
      onRename: () => {},
      onRenameCancel: () => {},
      onRenameSubmit: () => {},
      onSelect: () => {},
      onToggle: () => {},
      onToggleSelect: () => {},
      onView: () => {},
      row: { label: 'Zulu', lastActiveMs: nowSec * 1000, messages: 3, name: 'zulu', preview: 'hi' },
      scope: null,
      selectedKeys: [],
      selecting: false,
      sessionOrder: {},
      sessions: probeSessions,
      t: key => key
    })
  )

  console.log('PROBE boxes:', (markup.match(/data-session-group-box/g) || []).length)
  console.log('PROBE headings:', (markup.match(/data-drop-session-group/g) || []).length)
  console.log('PROBE names:', JSON.stringify(markup.match(/Alpha|Beta|Gamma/g)))
  console.log('PROBE shell-around-second:', markup.slice(markup.indexOf('Beta') - 400, markup.indexOf('Beta') + 400))
}

if (process.env.DUMP_GROUPS) {
  h.sessions.byProfile.zulu.sessions[0].title =
    'Refactor the flux capacitor telemetry pipeline before the deadline lands'
  __internals.moveSessionsToGroup('zulu', ['sess-zulu-9', 'sess-zulu-8'], topicA)
  __internals.setSessionGroupColor('zulu', topicA, BLUE)
  writeFileSync(process.env.DUMP_GROUPS, render())
}

// ── round 7: what a row is CALLED, the chain delete, the profile editor ──────
{
  const SRC7 = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

  // (1) The live crash: SessionRow rendered `onRightClickSelect(...)` while its
  //     own props list never declared it — a ReferenceError that took the tab
  //     down. Declared, threaded and used: all three, or the next edit re-breaks
  //     it silently.
  const srStart = SRC7.indexOf('function SessionRow({')
  const srProps = SRC7.slice(srStart, SRC7.indexOf('}) {', srStart))
  check('SessionRow declares the prop its body renders on', srProps.includes('onRightClickSelect'))
  check('…and the pane feeds it (right-click selects)',
    /onRightClickSelect: key => setSelectedKeys\(keys => clickSelect\(keys, key\)\)/.test(SRC7))
  const prStart = SRC7.indexOf('function ProfileRow({')
  const prProps = SRC7.slice(prStart, SRC7.indexOf('}) {', prStart))
  check('ProfileRow declares it too, so it can forward it', prProps.includes('onRightClickSelect'))
  check('…and the SessionRow call site passes it on', /onRightClickSelect,\n\s+onSelect,/.test(SRC7))

  // (2) What a row is CALLED. The symptom was a row rendering injected
  //     continuation text, so every fallback shape is pinned.
  const L = __internals.sessionLabel
  check('a title-less session is named by its preview',
    L({ preview: 'Fix the ferry booking', title: null }) === 'Fix the ferry booking')
  check('a compaction preamble is not a name',
    L({ preview: '[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns…', title: null }) === 'Untitled session')
  check('…nor is a still-in-progress banner',
    L({ preview: '[STILL IN PROGRESS — this is the active request…]', title: null }) === 'Untitled session')
  check('…nor an Apropos or reaction envelope',
    L({ preview: '[The user reacted with 👍 to: hi]', title: null }) === 'Untitled session')
  check('a raw id is never the name',
    L({ id: '20261010_110435_a8fbf6', preview: '', title: null }) === 'Untitled session')
  check('a real title still wins over the preview',
    L({ preview: 'noise', title: 'Plan Hermes Desktop plugin' }) === 'Plan Hermes Desktop plugin')
  check('…and the row, the sort and the batch all read it',
    SRC7.split('sessionLabel(').length - 1 >= 3)

  // (3) ONE profile document, TWO panes — the sync constraint.
  check('the row name reads the document Bots writes',
    __internals.botLabel({ name: 'gordon', ui_meta: { 'hermes-bots': { title: 'Gordon' } } }) === 'Gordon')
  check('…falls back to the core display name',
    __internals.botLabel({ display_name: 'Researcher', name: 'r' }) === 'Researcher')
  check('…and the primary profile reads as Hermes',
    __internals.botLabel({ name: 'default' }) === 'Hermes')
  check('the editor writes the SAME ui_meta namespace', SRC7.includes('ui_meta: { [BOTS_META_KEY]: next }'))
  check('the picture goes to the asset store, never into ui_meta',
    /set_asset[\s\S]{0,140}asset: 'avatar'/.test(SRC7))
  check('…and removing a picture is offered, not only uploading', /clear: true/.test(SRC7))
  check('no avatar is cached forever any more', !SRC7.includes('staleTime: Infinity'))
  check(
    'the profile menu offers the editor, with the pencil',
    SRC7.includes("menuGlyph('edit', 'Edit profile\\u2026')")
  )
  check('…and the dialog is mounted in the pane', SRC7.includes("'edit-profile-dialog'"))

  // (4) Deleting a session deletes the LINE it belongs to (core orphans the rest).
  check('the row delete goes through the chain', /const done = await deleteSessionChain\(/.test(SRC7))
  check('…which prefers the gateway lineage when the row carries one', SRC7.includes('row?.lineage_ids'))
  const before = new Set(['old-tip'])
  const rows = [
    { id: 'uncovered-ancestor', started_at: 100 },
    { id: 'created-during-the-sweep', started_at: 9999999999 },
    { id: 'old-tip', started_at: 100 }
  ]
  const swept = __internals.sweepCandidates(rows, before, 5000000)
  check('the sweep takes the ancestor the delete uncovered', swept.some(r => r.id === 'uncovered-ancestor'))
  check('…and never a session created while it ran', !swept.some(r => r.id === 'created-during-the-sweep'))
  check('…nor the row it already deleted', !swept.some(r => r.id === 'old-tip'))

  // (5) A profile that failed to LOAD must not read as a profile with nothing in it.
  check('a failed load is recorded, not swallowed', /\$loadFailures\.set\(failed\)/.test(SRC7))
  check('…and the row says so', SRC7.includes("couldn't load sessions"))
}

// ── 7. Personae: the rename, and the profile colour fill ────────────────────
//
// Pedro, 2026-10-10: "Let's rename this plug-in to 'Personae'" and "when the
// user chooses a color for that profile, the color fills the profile row, as
// well as all the session rows for that profile. It is overridden only by group
// or apropos colors ... it should also be overridden by session colors ... yes,
// fill is opt-in ... agree on 4" (an uncoloured group heading inherits the
// profile tint).

{
  const SRC8 = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

  // (1) 1.2.0 renamed the machine id too (`messenger` -> `personae`), so the tab
  //     label and the id finally agree. What is NOT renamed is anything that
  //     PERSISTS state: the prefs key names and the `messenger-` wire prefix keep
  //     their spelling — they are the contract with the pane's backend and with
  //     Personae Mobile — and `migrateLegacyStorage()` carries saved storage
  //     across to the new id, so nothing is orphaned.
  check('the plugin introduces itself as Personae', plugin.name === 'Personae', `got ${plugin.name}`)
  check('…and its tab label with it', pane.title === 'Personae', `got ${pane.title}`)
  check(
    'the machine id now matches the name',
    plugin.id === 'personae' && SRC8.includes("const ID = 'personae'"),
    `id=${plugin.id}`
  )
  check(
    '…while every key that PERSISTS state keeps the old spelling (nothing orphaned)',
    SRC8.includes("const LEGACY_META_KEY = 'messenger'") &&
      SRC8.includes("const COLORS_KEY = 'messenger-session-colors-v1'") &&
      SRC8.includes("const SECTIONS_KEY = 'messenger-sections-v1'") &&
      SRC8.includes("const HIDDEN_KEY = 'messenger-hidden-v1'") &&
      SRC8.includes("const SYNC_LOCAL_PREFIX = 'messenger-'"),
    `id=${plugin.id}`
  )
  check('the empty hidden view names Personae', h.i18n.viewHiddenEmpty.includes('Personae'), h.i18n.viewHiddenEmpty)
  check(
    '…and the row menu hides from Personae, not from Messenger',
    SRC8.includes("'Unhide in Personae' : 'Hide from Personae'")
  )

  // (2) fillOf — opt-in, and read out of the document the Bots editor writes, so
  //     a pick in either pane is the other's pick (the sync constraint).
  const fillOf = __internals.fillOf

  check(
    'a colour picked in Bots is this profile\'s fill',
    fillOf({ ui_meta: { 'hermes-bots': { color: '#10b981' } } }) === '#10b981'
  )
  check('a row that already carries the slice is read too', fillOf({ botsMeta: { color: ' #10b981 ' } }) === '#10b981')
  check(
    'no pick → no fill (fill is opt-in)',
    fillOf({ name: 'zulu', ui_meta: {} }) === null && fillOf({}) === null && fillOf(undefined) === null
  )
  check('a blank colour is not a pick', fillOf({ ui_meta: { 'hermes-bots': { color: '   ' } } }) === null)

  // (3) The TIERS, on the pure shell: group colour > profile fill > neutral.
  const PROFILE_FILL = 'color-mix(in srgb, #10b981 22%, transparent)'
  const shell = (block, fill) =>
    renderToStaticMarkup(
      __internals.sessionGroupShell(
        { collapsed: false, name: 'G', sessions: [], ...block },
        [jsx('div', { 'data-group-header': '', children: 'G' }), []],
        false,
        fill
      )
    )

  check(
    'a picked profile colour fills the flat list under the profile row',
    new RegExp(`data-profile-fill=""[^>]*style="background:${PROFILE_FILL.replace(/[.()]/g, '\\$&')};?"`).test(
      shell({ id: null, color: null }, '#10b981')
    )
  )
  check('an uncoloured profile is left unpainted (no confetti)', !shell({ id: null, color: null }, null).includes('color-mix'))
  check(
    "a group's own colour outranks the profile's",
    shell({ id: 'g1', color: '#e5484d' }, '#10b981').includes('#e5484d') &&
      !shell({ id: 'g1', color: '#e5484d' }, '#10b981').includes('#10b981')
  )
  check('a group with no colour of its own inherits the profile tint', shell({ id: 'g1', color: null }, '#10b981').includes(PROFILE_FILL))
  check(
    '…and the group outline still follows the GROUP, never the inherited tint',
    !shell({ id: 'g1', color: null }, '#10b981').includes('border-color')
  )
  check('a group with neither colour stays unpainted', !shell({ id: 'g1', color: null }, null).includes('color-mix'))

  // (4) A session's own colour is the LAST word, and it REPLACES the fill under
  //     it instead of blending (the base is the opaque card neutral).
  const box = __internals.sessionColorBox
  const bare = jsx('div', { 'data-session': 's1', children: 'row' })
  const red = renderToStaticMarkup(box('#e5484d', bare, 'k'))

  check('an uncoloured row is passed through, not wrapped', box(null, bare, 'k') === bare)
  check(
    'a hand-coloured session is boxed, not painted on the row',
    /data-session-fill="#e5484d"[^>]*style="background:color-mix\(in srgb, #e5484d 22%, var\(--theme-neutral-card\)\);?/.test(red) &&
      /data-session-fill="#e5484d"[^>]*box-shadow:inset 0 0 0 1px #e5484d/.test(red)
  )
  check('…the wrapper sits AROUND the row', /data-session-fill="#e5484d"[^>]*>[\s\S]*data-session="s1"/.test(red))
  check(
    '…and it replaces any fill under it rather than blending with it',
    red.includes('color-mix(in srgb, #e5484d 22%, var(--theme-neutral-card))') && !/\b22%, transparent\)/.test(red)
  )

  // (5) End to end on a REAL ProfileRow: the colour reaches the row, the chip
  //     and the list; the session colour then beats all of it.
  const renderProfile = row =>
    renderToStaticMarkup(
      jsx(__internals.ProfileRow, {
        expanded: true,
        isCurrent: false,
        nowMs: nowSec * 1000,
        onDeleteGroup: () => {},
        onDragStart: () => {},
        onMoveGroup: () => {},
        onMoveGroupOrder: () => {},
        onNewGroup: () => {},
        onNewGroupCancel: () => {},
        onNewGroupSubmit: () => {},
        onOpen: () => {},
        onRename: () => {},
        onRenameCancel: () => {},
        onRenameGroup: () => {},
        onRenameGroupCancel: () => {},
        onRenameGroupSubmit: () => {},
        onRenameSubmit: () => {},
        onSelect: () => {},
        onToggle: () => {},
        onToggleGroup: () => {},
        onToggleSelect: () => {},
        onView: () => {},
        row,
        scope: null,
        selectedKeys: [],
        selecting: false,
        sessionOrder: {},
        sessions: [{ id: 'fill-1', last_active: nowSec - 30, preview: 'a session', title: 'A session' }],
        t: key => key
      })
    )
  const baseRow = { label: 'Filler', lastActiveMs: nowSec * 1000, messages: 3, name: 'filler', preview: '' }
  const pickedRow = renderProfile({ ...baseRow, ui_meta: { 'hermes-bots': { color: '#10b981' } } })
  const plainRow = renderProfile(baseRow)

  check(
    'the profile row itself carries the picked tint',
    new RegExp(`data-profile-row=""[^>]*style="background:${PROFILE_FILL.replace(/[.()]/g, '\\$&')};?"`).test(pickedRow)
  )
  check(
    '…its session list is painted by the same colour',
    pickedRow.includes(`data-profile-fill="" style="background:${PROFILE_FILL}"`) ||
      /data-profile-fill=""[^>]*style="background:color-mix\(in srgb, #10b981 22%, transparent\)/.test(pickedRow),
    pickedRow.slice(pickedRow.indexOf('data-profile-fill'), 220)
  )
  check(
    '…and the rows render INSIDE that box (the box wraps, it never replaces them)',
    /data-profile-fill=""[^>]*>[\s\S]*data-session="fill-1"/.test(pickedRow),
    pickedRow.slice(pickedRow.indexOf('data-profile-fill'), 260)
  )
  check('…and its avatar chip agrees with the pick (not the name hash)', (pickedRow.match(/#10b981/g) || []).length >= 3)
  check(
    'a profile with no pick is painted nowhere',
    !plainRow.includes('data-profile-fill') && !plainRow.includes('data-session-fill'),
    plainRow.slice(plainRow.indexOf('data-profile-row'), 300)
  )

  __internals.setSessionColor('filler', 'fill-1', '#e5484d')

  const overridden = renderProfile({ ...baseRow, ui_meta: { 'hermes-bots': { color: '#10b981' } } })

  check('a session colour is drawn on the row, above the profile fill', overridden.includes('data-session-fill="#e5484d"'))
  check(
    '…and the row keeps the name colour it already had',
    /data-session="fill-1"[\s\S]{0,400}?style="color:#e5484d"/.test(overridden)
  )

  __internals.setSessionColor('filler', 'fill-1', null)

  // (6) The wiring a pure test cannot see: the row map actually wraps, the row
  //     actually subscribes (a colour set elsewhere must redraw the list), and
  //     the fill actually travels into the shell.
  const prStart = SRC8.indexOf('function ProfileRow({')

  check('every row in the list is wrapped by its own colour box', /sessionColorBox\(\s*sessionColor\(row\.name, session\.id\)/.test(SRC8))
  check('the profile row subscribes to the session colours', SRC8.slice(prStart, prStart + 9000).includes('useValue($sessionColors)'))
  check('the fill is read from the row', SRC8.includes('const fill = fillOf(row)'))
  check('…and handed to the shell that paints the boxes', /sessionGroupShell\(\s*block,\s*parts,[\s\S]{0,200}?,\s*\n\s*fill\n\s*\)/.test(SRC8))
  check('the shell knows the profile fill', SRC8.includes('function sessionGroupShell(block, parts, dragging, profileFill)'))
}

// ─── §8 Personae: the explicit "No fill" option ─────────────────────────────
// Pedro, 2026-10-10: "allow for a no fill option as well." A picked colour
// paints the profile row AND its session rows, so the picker it is picked from
// needs a way back to nothing — and the swatch grid transcribed from Bots had
// lost the clear row Bots itself gets from `avatar-picker.tsx`.
{
  const SRC9 = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
  const BLUE = '#3b82f6'

  check('the profile picker offers a clear row', /clearLabel: 'No fill'/.test(SRC9))
  check(
    "…and it is the app's own swatch grid, the one the other two pickers use",
    /jsx\(ColorSwatches, \{\s*\n\s*clearLabel: 'No fill'/.test(SRC9)
  )
  check('…so the bespoke swatch map is gone', !SRC9.includes("'data-swatch':"))
  check('…and the clear path feeds the colour state as null, never a blank string',
    /onChange: value => setColor\(value \|\| null\)/.test(SRC9))

  // A pick survives a save; a clear drops the key ENTIRELY — that is what makes
  // it "no fill" once the gateway replaces the whole `hermes-bots` slice.
  const kept = __internals.botMetaPatch(
    { color: BLUE, shape: 'circle' },
    { color: BLUE, title: ' Bot ' }
  )

  check('a picked colour rides the save', __internals.fillOf({ botsMeta: kept }) === BLUE)
  check('…the title is trimmed and the bot marked custom', kept.title === 'Bot' && kept.custom === true)
  check('…and the rest of the document survives the round trip', kept.shape === 'circle')

  const cleared = __internals.botMetaPatch({ color: BLUE }, { color: null, title: '' })

  check('a cleared colour reads as "no fill"', __internals.fillOf({ botsMeta: cleared }) === null)
  check(
    '…not merely as an undefined JSON would drop on the way out',
    !('color' in JSON.parse(JSON.stringify(cleared))),
    JSON.stringify(cleared)
  )
  check(
    'the picture never rides the ui_meta document',
    !('image' in
      JSON.parse(
        JSON.stringify(
          __internals.botMetaPatch({ color: BLUE, image: 'data:image/png;base64,AAAA' }, { color: BLUE, title: '' })
        )
      ))
  )

  // The dialog itself: the clear row is on screen beside the colours, and the
  // grid shows what is stored.
  const dialogOf = (meta = {}) =>
    renderToStaticMarkup(
      jsx(__internals.EditProfileDialog, {
        onClose: () => {},
        open: true,
        queryClient: { invalidateQueries: () => {} },
        row: { botsMeta: meta, name: 'filler' }
      })
    )

  const dialogNone = dialogOf({})
  const dialogPicked = dialogOf({ color: BLUE })

  check(
    'the editor draws the shared grid with its clear row',
    dialogNone.includes('data-slot="color-swatches"') && dialogNone.includes('data-slot="color-clear"')
  )
  check('…labelled "No fill"', dialogNone.includes('No fill'))
  check('…and with no pick the grid shows nothing selected', /data-value=""/.test(dialogNone))
  check('…while a picked colour shows as the selected swatch', dialogPicked.includes(`data-value="${BLUE}"`))
}

// ─── §9 Personae: opening a session this pane CREATED ──────────────────────
// Pedro, 2026-10-10: "it only shows the spinner, but i never get a chatbox to
// enter my prompt" — an Apropos child (20261010_193700_d29494) opened as a tab
// that never resumed. A `tab` open lands OFF the routed main view, so the SDK's
// route-resume effect never fires for it; a tile with no `runtimeId` renders
// `CenteredThreadSpinner`, and the composer only mounts inside `TileChat`.
// Missing was the app's own recipe for a plugin-created session
// (`hermes-bots/canonical-chat.ts` `openStoredBotChat`).
{
  const h = harness()
  const created = __internals.CREATED_OPEN

  check('the created-session open asks the app to WAIT for hydration', created.awaitHydration === true)
  check('…and to resume the tile rather than trust a cache', created.forceResume === true)
  check('…with one internal retry of that same wait', created.retryHydrationTimeoutOnce === true)
  check('…and chrome kept on the launch profile while a child backend dials', created.keepAllProfilesScope === true)

  check(
    'an Apropos child waits for the RUNTIME — its hidden seed cannot paint',
    __internals.CHILDLESS_OPEN.expectHistory === false && __internals.CHILDLESS_OPEN.awaitHydration === true
  )
  check(
    'a branch child, whose transcript DOES paint, waits for history instead',
    __internals.BRANCH_OPEN.expectHistory === true
  )
  check('…without either of them gaining flags the app does not know', Object.keys(created).length === 4)

  h.opens.length = 0
  await __internals.openSession('child-apropos', 'zulu', 'tab', __internals.CHILDLESS_OPEN)
  await __internals.openSession('child-branch', 'zulu', 'tab', __internals.BRANCH_OPEN)
  await __internals.openSession('known-tab', 'zulu', 'tab')
  await __internals.openSession('known-main', 'zulu')

  const opened = id => (h.opens.find(entry => entry.id === id) || {}).options || {}

  check(
    'the Apropos open carries the flags AND its tab intent',
    opened('child-apropos').intent === 'tab' &&
      opened('child-apropos').expectHistory === false &&
      opened('child-apropos').awaitHydration === true &&
      opened('child-apropos').profile === 'zulu'
  )
  check(
    'the branch open carries the same flags with history expected',
    opened('child-branch').intent === 'tab' &&
      opened('child-branch').expectHistory === true &&
      opened('child-branch').awaitHydration === true
  )
  check(
    'a session the app already knows keeps its old, un-flagged shape',
    opened('known-tab').intent === 'tab' &&
      !('awaitHydration' in opened('known-tab')) &&
      opened('known-main').expectHistory === true &&
      !('intent' in opened('known-main'))
  )

  const SRC10 = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

  check(
    'a session opened into a tab from the pane carries the same wait',
    __internals.INTENT_OPEN.awaitHydration === true &&
      __internals.INTENT_OPEN.expectHistory === true &&
      // The session menu's own "In new tab" passes it straight; the dock builds
      // every tab from it through one helper, which can only ever ADD the
      // cross-profile switch — never drop the wait.
      (SRC10.match(/, 'tab', INTENT_OPEN\)/g) || []).length === 1 &&
      SRC10.includes("'tab', flags ? { ...INTENT_OPEN, ...flags } : INTENT_OPEN")
  )
  check(
    '…while a window open stays un-flagged — it may never get a tile here',
    SRC10.includes("openSession(openId, profile, 'window')")
  )
  check(
    '…which is what both create-then-open call sites actually pass',
    (SRC10.match(/openSession\(childId, [a-zA-Z]+, 'tab', CHILDLESS_OPEN\)/g) || []).length === 2 &&
      SRC10.includes("openSession(res.stored_session_id, profile, 'tab', BRANCH_OPEN)")
  )
}

// ── 20. the expanded set outlives the plugin instance ──────────────────────
// The pane kept this in memory alone — the one view store it never handed to
// `ctxRef.storage` — so the host re-evaluating the bundle collapsed the whole
// roster. Pedro, 2026-10-10: "after a while they all collapse again".

// Earlier sections expand profiles of their own, so arrive at a known state
// instead of assuming one: a no-op toggle would flip the wrong way.
if (__internals.$expanded.get().zulu) {
  __internals.toggleExpanded('zulu')
}
h.storage['messenger-expanded-v1'] = undefined
__internals.toggleExpanded('zulu')
check(
  'expanding a profile writes it to storage',
  h.storage['messenger-expanded-v1']?.zulu === true &&
    Object.keys(h.storage['messenger-expanded-v1']).length === 1
)
__internals.toggleExpanded('zulu')
check(
  'collapsing drops the entry instead of storing false',
  Object.keys(h.storage['messenger-expanded-v1'] || {}).length === 0
)
check(
  'a blob full of falses normalizes to nothing',
  Object.keys(__internals.normalizeExpanded({ a: false, b: 0, c: '', d: null })).length === 0
)
check(
  'any truthy value counts as expanded',
  __internals.normalizeExpanded({ zulu: 'yes' }).zulu === true
)

// A fresh instance must come back expanded — the whole point of persisting it.
h.storage['messenger-expanded-v1'] = { sec: 'yes-please', nope: false }
plugin.register(ctx)
check(
  "a fresh activation restores the user's expanded profiles",
  __internals.$expanded.get().sec === true && !('nope' in __internals.$expanded.get())
)

// ── 21. a compaction renames the row — and every id stored against it ───────
// Core mints a FRESH tip id on every compaction and projects two fields so an id
// captured earlier still resolves: `_lineage_root_id` and `_lineage_ids`
// (`hermes_state_sessions.py` sets both; `hermes_state_search.py`: "so an old
// compression root id resolves to the live continuation"). The pane captures the
// child's id the second it creates it — so after that child's first compaction
// its link, its group filing, and its "keep this in the page" reservation all
// name a segment `session.list` no longer returns. Pedro, 2026-10-10: "The icon
// arrow hook is not showing up on the Apropos session".
const chainCreated = []
h.responses['session.create'] = params => {
  chainCreated.push(params)

  return { session_id: 'live-chain', stored_session_id: 'chain-root-1' }
}
h.responses['session.history'] = () => ({ count: 1, messages: [{ content: 'ask', role: 'user' }] })

// The group child, built through the real verb so the store is shaped by the
// shipped write path (members keyed by the id `session.create` returned).
await __internals.aproposSelection([
  { profile: 'lz', session_id: 'lz-one', title: 'One' },
  { profile: 'lz', session_id: 'lz-two', title: 'Two' }
])

const CHILD_ROOT = 'chain-root-1'
const CHILD_TIP = 'chain-tip-1'
const lzSlice = __internals.profileSessionGroups(__internals.$sessionGroups.get(), 'lz')
const lzGroup = lzSlice.groups.find(entry => entry.apropos === true)

check(
  'the multi-selection child is filed under the id it was created with',
  lzSlice.members[CHILD_ROOT] === lzGroup?.id
)

// The page returns that conversation as its TIP: the id the store knows is not
// in the listing at all, exactly as a real compaction leaves it.
const TIP_ROW = {
  _lineage_ids: [CHILD_ROOT, 'chain-mid-1', CHILD_TIP],
  _lineage_root_id: CHILD_ROOT,
  id: CHILD_TIP,
  last_active: nowSec - 60,
  message_count: 21,
  preview: '',
  title: 'Apropos: One'
}
const lzBlocks = __internals.sessionGroupBlocks(
  [TIP_ROW, { id: 'lz-one' }, { id: 'lz-two' }],
  __internals.$sessionGroups.get(),
  'lz',
  []
)

const lzBox = (lzBlocks.find(block => block.id === lzGroup?.id)?.sessions || []).map(row => row.id)

check(
  'a filed child stays inside its group box after it compacts',
  lzBox.includes(CHILD_TIP) && lzBox.length === 3,
  JSON.stringify(lzBlocks.map(block => ({ id: block.id, ids: (block.sessions || []).map(row => row.id) })))
)
check(
  '…and is not drawn a second time in the plain list',
  !(lzBlocks.find(block => block.id === null)?.sessions || []).some(row => row.id === CHILD_TIP)
)

const tipMarkup = renderToStaticMarkup(
  jsx(__internals.SessionRow, {
    aproposGroup: true,
    group: lzGroup?.id,
    nowMs: nowSec * 1000,
    profile: 'lz',
    session: TIP_ROW
  })
)

check(
  'the hook ↳ survives the child compacting under a new id',
  tipMarkup.includes('↳') && tipMarkup.includes('data-row-mark="child"'),
  tipMarkup.slice(0, 420)
)
check(
  '…and the group child still hides the chip the hook already says',
  tipMarkup.includes('↳') && !tipMarkup.includes('↩ '),
  tipMarkup.slice(0, 420)
)

// The OTHER flavour: a single-session Apropos child is not filed into a group,
// so it is the synthetic-row path (withAproposChildren) that has to find it.
__internals.rememberApropos('lz', 's-root', 'lz-parent', 'Parent work')
const S_TIP = {
  _lineage_ids: ['s-root', 's-tip'],
  _lineage_root_id: 's-root',
  id: 's-tip',
  title: 'Apropos: Parent work'
}
const sessionChildMarkup = renderToStaticMarkup(
  jsx(__internals.SessionRow, { nowMs: nowSec * 1000, profile: 'lz', session: S_TIP })
)

const chipAt = sessionChildMarkup.indexOf('data-apropos-parent')

check(
  'the ↩ chip resolves once the child compacts (the link stores the root)',
  sessionChildMarkup.includes('data-apropos-parent="lz-parent"') && sessionChildMarkup.includes('↩ Parent work'),
  chipAt < 0 ? 'no chip rendered' : sessionChildMarkup.slice(chipAt, chipAt + 170)
)
// The synthetic path only fires for a row whose stored children are MISSING from
// the page — which means the parent has to be in the page for it to fire at all.
const S_PARENT = { id: 'lz-parent', title: 'Parent work' }
const sRows = __internals.withAproposChildren([S_PARENT, S_TIP], __internals.$apropos.get(), 'lz')

check(
  'no synthetic duplicate row is invented for the id the page no longer carries',
  !sRows.some(row => row.id === 's-root') &&
    sRows.filter(row => row.id === 's-tip' || row.id === 's-root').length === 1,
  sRows.map(row => row.id).join(',')
)

const rowIdSet = __internals.rowIdSet || (() => new Set())

check(
  'the widen test sees a row under any id in its lineage',
  __internals.nextSessionLimit({ count: 10, ids: rowIdSet([TIP_ROW]), limit: 10, wanted: [CHILD_ROOT] }) === 0
)

// End to end: the page must not widen forever chasing an id a compaction retired.
const fillerRows = n => Array.from({ length: n }, (_, i) => ({ id: `lz-filler-${i}`, title: `filler ${i}` }))

h.responses['session.list'] = params => ({
  sessions: [
    TIP_ROW,
    S_TIP,
    S_PARENT,
    { id: 'lz-one' },
    { id: 'lz-two' },
    ...fillerRows(Math.max(0, Number(params?.limit || 0) - 5))
  ]
})

const lzCallsBefore = h.requests.filter(row => row.method === 'session.list' && row.params?.profile === 'lz').length

await __internals.listProfileSessions('lz')

const lzCalls = h.requests
  .filter(row => row.method === 'session.list' && row.params?.profile === 'lz')
  .slice(lzCallsBefore)

check(
  'a page that carries the child is asked for ONCE — never widened to the cap',
  lzCalls.length === 1 && lzCalls[0].params.limit === __internals.SESSIONS_PER_PROFILE,
  lzCalls.map(call => call.params.limit).join(' → ')
)

// ── cross-device sync (PUT/GET /state) ──────────────────────────────────────
//
// The writer is driven through `createSync` with a fake backend and a fake
// clock, so debounce, backoff and rev arithmetic are exact, not timing-lucky.

const syncSettle = async () => {
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

const syncClock = () => {
  let now = 0
  let seq = 0
  const timers = new Map()

  return {
    clearTimeout: id => timers.delete(id),
    pending: () => [...timers.values()].map(timer => timer.at - now),
    setTimeout: (fn, ms) => {
      seq += 1
      timers.set(seq, { at: now + ms, fn })

      return seq
    },
    async advance(ms) {
      const end = now + ms

      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]

        if (!due) {
          break
        }

        now = due[1].at
        timers.delete(due[0])
        due[1].fn()
        await syncSettle()
      }

      now = end
      await syncSettle()
    }
  }
}

const syncIsObj = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** A small model of plugin_api.py's merge: entry-wise for objects (per-entry
 *  revs, remembered tombstones), whole-value LWW otherwise. */
const syncServer = (seed = {}) => {
  const store = {}
  const calls = []
  const srv = { calls, fail: null, store }

  for (const [name, { rev, value }] of Object.entries(seed)) {
    store[name] = syncIsObj(value)
      ? { entries: Object.fromEntries(Object.keys(value).map(k => [k, rev])), rev, tombs: {}, value: { ...value } }
      : { rev, value }
  }

  const view = () => ({
    version: 1,
    keys: Object.fromEntries(
      Object.entries(store).map(([name, row]) => [name, { rev: row.rev, updated_at: '2026-10-11T00:00:00Z', value: row.value }])
    )
  })

  srv.rest = async (path, opts = {}) => {
    const method = opts.method || 'GET'

    calls.push({ body: opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body)), method, path })

    const failure = srv.fail?.(method, path)

    if (failure) {
      throw failure
    }

    if (method === 'PUT') {
      for (const [name, { rev, value }] of Object.entries(opts.body.keys || {})) {
        const row = store[name]

        if (syncIsObj(value)) {
          const next = row && syncIsObj(row.value) ? row : { entries: {}, rev: 0, tombs: {}, value: {} }

          for (const [entry, entryValue] of Object.entries(value)) {
            if (rev > (next.entries[entry] ?? -1) && rev > (next.tombs[entry] ?? -1)) {
              next.value[entry] = entryValue
              next.entries[entry] = rev
            }
          }

          next.rev = Math.max(next.rev, rev)
          store[name] = next
        } else if (!row || rev > row.rev) {
          store[name] = { rev, value }
        }
      }

      for (const { entry, key, rev } of opts.body.tombstones || []) {
        const row = store[key]

        if (row?.entries && rev > (row.entries[entry] ?? -1)) {
          delete row.value[entry]
          delete row.entries[entry]
          row.tombs[entry] = rev
          row.rev = Math.max(row.rev, rev)
        }
      }
    }

    return view()
  }

  return srv
}

const syncStorage = (initial = {}) => {
  const data = { ...initial }

  return { data, get: (key, fallback) => (key in data ? data[key] : fallback), set: (key, value) => (data[key] = value) }
}

const makeSync = ({ server = syncServer(), storage = syncStorage(), applied = [] } = {}) => {
  const clock = syncClock()
  const sync = __internals.createSync({
    apply: (key, value) => applied.push({ key, value }),
    clearTimeout: clock.clearTimeout,
    rest: server.rest,
    setTimeout: clock.setTimeout,
    storage
  })

  return { applied, clock, server, storage, sync }
}

const puts = server => server.calls.filter(call => call.method === 'PUT')

// (a) debounce + coalesce + server key name + rev
{
  const { clock, server, sync } = makeSync()

  await sync.start()
  await syncSettle()
  sync.noteLocal('messenger-session-sort-v1', { zulu: 'name' })
  await clock.advance(500)
  sync.noteLocal('messenger-session-sort-v1', { zulu: 'manual' })
  await clock.advance(1499)

  check('sync: nothing is pushed before the debounce goes idle', puts(server).length === 0)

  await clock.advance(1)

  const sent = puts(server)

  check(
    'sync: rapid edits coalesce into ONE push under the un-prefixed server key, rev 1',
    sent.length === 1 &&
      sent[0].path === '/state' &&
      Object.keys(sent[0].body.keys).join(',') === 'session-sort-v1' &&
      sent[0].body.keys['session-sort-v1'].value.zulu === 'manual' &&
      sent[0].body.keys['session-sort-v1'].rev === 1,
    JSON.stringify(sent.map(call => call.body))
  )
  check(
    'sync: the PUT body is a plain object (the bridge JSON-encodes it; a string would double-encode)',
    typeof sent[0]?.body === 'object' && Array.isArray(sent[0]?.body?.tombstones)
  )
  check('sync: an acknowledged push leaves nothing queued', sync.state().dirty.length === 0 && !sync.state().pending)
}

// (b) device-local keys never leave the machine
{
  const { clock, server, storage, sync } = makeSync()

  await sync.start()

  const armed = [
    sync.noteLocal('messenger-expanded-v1', { zulu: true }),
    sync.noteLocal('messenger-activity-toasts', true),
    sync.noteLocal(__internals.SYNC_META_KEY, { revs: {} }),
    sync.noteLocal('personae-search', 'flux')
  ]

  await clock.advance(10000)

  check(
    'sync: expanded, toasts, search and the sync meta are never pushed',
    armed.every(flag => flag === false) && puts(server).length === 0,
    JSON.stringify({ armed, puts: puts(server) })
  )

  sync.noteLocal('messenger-hidden-v1', { zulu: ['s1'] })
  await clock.advance(1500)

  const keysSent = puts(server).flatMap(call => Object.keys(call.body.keys))

  check(
    'sync: only the seven shared keys exist on the wire',
    keysSent.join(',') === 'hidden-v1' &&
      keysSent.every(name => __internals.SYNC_SERVER_KEYS.includes(name)) &&
      __internals.SYNC_SERVER_KEYS.length === 7 &&
      !__internals.SYNC_SERVER_KEYS.some(name => /expanded|toast|meta/.test(name)),
    keysSent.join(',')
  )
  check(
    'sync: revs live in a device-local meta key, never in a shared one',
    storage.data[__internals.SYNC_META_KEY]?.revs?.['hidden-v1'] === 1
  )
}

// (c) rest throwing / rejecting: no throw, queued, retried with backoff
{
  const server = syncServer()
  const { clock, sync } = makeSync({ server })

  await sync.start()
  server.fail = method => (method === 'PUT' ? new Error('net::ERR_INTERNET_DISCONNECTED') : null)

  let threw = false

  try {
    sync.noteLocal('messenger-session-order-v1', { zulu: ['a', 'b'] })
    await clock.advance(1500)
  } catch {
    threw = true
  }

  check(
    'sync: a failing PUT does not throw and keeps the key queued',
    !threw && sync.state().dirty.includes('session-order-v1') && sync.state().failures === 1,
    JSON.stringify(sync.state())
  )
  check('sync: the first retry waits 2s', clock.pending().join(',') === '2000', clock.pending().join(','))

  await clock.advance(2000)

  check('sync: the second retry backs off to 4s', clock.pending().join(',') === '4000', clock.pending().join(','))

  server.fail = null
  await clock.advance(4000)

  const sent = puts(server)
  const last = sent[sent.length - 1]

  check(
    'sync: once the server is back the queued value lands and the queue drains',
    sent.length === 3 &&
      last.body.keys['session-order-v1'].value.zulu.join(',') === 'a,b' &&
      server.store['session-order-v1']?.value?.zulu?.join(',') === 'a,b' &&
      sync.state().dirty.length === 0 &&
      sync.state().failures === 0,
    JSON.stringify({ revs: sent.map(call => call.body.keys['session-order-v1']?.rev), state: sync.state() })
  )
  check(
    'sync: every retry carries a fresh, higher rev',
    sent.map(call => call.body.keys['session-order-v1'].rev).join(',') === '1,2,3',
    sent.map(call => call.body.keys['session-order-v1'].rev).join(',')
  )

  // The backoff is capped at 60s however long the outage.
  server.fail = () => new Error('offline')
  sync.noteLocal('messenger-session-order-v1', { zulu: ['b'] })

  for (let i = 0; i < 8; i++) {
    await clock.advance(Math.max(...clock.pending(), 0))
  }

  check('sync: backoff is capped at 60s', clock.pending().join(',') === '60000', clock.pending().join(','))

  server.fail = null
  sync.online()
  await syncSettle()

  check(
    "sync: the window's 'online' event retries at once",
    sync.state().dirty.length === 0 && server.store['session-order-v1'].value.zulu.join(',') === 'b'
  )

  // A server that will not answer the first GET: the pane's edits still queue.
  const down = syncServer()

  down.fail = () => Object.assign(new Error('timeout'), { status: undefined })

  const offline = makeSync({ server: down })

  await offline.sync.start()
  offline.sync.noteLocal('messenger-sections-v1', { sections: [{ id: 'a', name: 'A' }] })
  await offline.clock.advance(1500)

  check(
    'sync: unreachable at startup = edits queued, no throw, retry armed',
    offline.sync.state().dirty.includes('sections-v1') && !offline.sync.state().bootstrapped && offline.clock.pending().length === 1
  )

  // End to end through the pane: a rejecting backend never costs the local write.
  const savedStorage = { ...h.storage }
  const throwingCtx = {
    ...ctx,
    rest: async () => {
      throw new Error('ECONNREFUSED')
    }
  }
  let paneThrew = false

  try {
    plugin.register(throwingCtx)
    await syncSettle()
    __internals.setSessionSort('sync-x', 'name')
  } catch {
    paneThrew = true
  }

  check(
    'sync: with the backend down, the pane still writes local storage immediately',
    !paneThrew &&
      h.storage['messenger-session-sort-v1']?.['sync-x'] === 'name' &&
      __internals.getPrefSync()?.state().dirty.includes('session-sort-v1'),
    JSON.stringify(__internals.getPrefSync()?.state())
  )

  __internals.getPrefSync()?.dispose()
  Object.keys(h.storage).forEach(key => delete h.storage[key])
  Object.assign(h.storage, savedStorage)
}

// (d) 404: an older backend without /state — silent, local-only, no spam
{
  const server = syncServer()

  server.fail = () => new Error('404: {"detail":"Not Found"}')

  const { clock, sync } = makeSync({ server })

  let threw = false

  try {
    await sync.start()
  } catch {
    threw = true
  }

  const armed = sync.noteLocal('messenger-session-sort-v1', { zulu: 'name' })

  await clock.advance(120000)

  check(
    'sync: 404 on /state = unsupported for the session, one request, no retries',
    !threw && sync.state().unsupported && !armed && server.calls.length === 1 && clock.pending().length === 0,
    JSON.stringify({ calls: server.calls.length, state: sync.state() })
  )

  const odd = syncServer()

  odd.rest = async () => ({ results: [] })

  const oddSync = makeSync({ server: odd })

  await oddSync.sync.start()

  check('sync: a /state answer without `keys` (not this contract) is treated as unsupported', oddSync.sync.state().unsupported)
  check(
    'sync: the status is read from the bridge\'s "<status>: <body>" message or a status field',
    __internals.syncStatus(new Error('404: nope')) === 404 && __internals.syncStatus({ status: 413 }) === 413 && __internals.syncStatus(new Error('offline')) === 0
  )
}

// (e) seeding: an empty server takes ours; a populated server wins
{
  const server = syncServer({ 'sections-v1': { rev: 7, value: { sections: [{ id: 'remote', name: 'Remote' }] } } })
  const storage = syncStorage({
    'messenger-sections-v1': { sections: [{ id: 'stale', name: 'Stale' }] },
    'messenger-session-sort-v1': { zulu: 'name' },
    'messenger-session-order-v1': {}
  })
  const { applied, clock, sync } = makeSync({ server, storage })

  await sync.start()
  await clock.advance(0)

  const sent = puts(server)
  const keysSent = sent.flatMap(call => Object.keys(call.body.keys))

  check(
    'sync: seeding pushes a non-empty local value the server lacks',
    keysSent.includes('session-sort-v1') && server.store['session-sort-v1']?.value?.zulu === 'name',
    JSON.stringify(keysSent)
  )
  check('sync: seeding never pushes an empty local value', !keysSent.includes('session-order-v1'))
  check(
    'sync: a server value is ADOPTED over the local one, and never pushed over',
    !keysSent.includes('sections-v1') &&
      server.store['sections-v1'].value.sections[0].id === 'remote' &&
      storage.data['messenger-sections-v1'].sections[0].id === 'remote' &&
      applied.some(row => row.key === 'messenger-sections-v1' && row.value.sections[0].id === 'remote'),
    JSON.stringify({ applied, keysSent })
  )
  check(
    'sync: every shared key is marked seeded after first contact',
    __internals.SYNC_SERVER_KEYS.every(name => sync.state().meta.seeded[name] === true)
  )

  // A second run (same storage) must not re-seed: it reads the meta back.
  const again = makeSync({ server, storage })

  await again.sync.start()

  check('sync: a seeded device does not re-seed on the next start', puts(server).length === sent.length)

  // Through the pane: adoption lands in the atoms the rows read.
  const savedStorage = { ...h.storage }
  const remote = syncServer({
    'session-sort-v1': { rev: 3, value: { zulu: 'name' } },
    'session-colors-v1': { rev: 2, value: { zulu: { 'sess-zulu-9': '#ef4444' } } }
  })

  delete h.storage[__internals.SYNC_META_KEY]
  __internals.SYNC_SERVER_KEYS.forEach(name => delete h.storage[`messenger-${name}`])
  h.storage['messenger-session-sort-v1'] = { zulu: 'manual' }
  plugin.register({ ...ctx, rest: remote.rest })
  await syncSettle()

  check(
    'sync: the pane adopts server values into its atoms and local storage',
    __internals.$sessionSort.get().zulu === 'name' &&
      h.storage['messenger-session-sort-v1'].zulu === 'name' &&
      __internals.sessionColor('zulu', 'sess-zulu-9') === '#ef4444' &&
      puts(remote).length === 0,
    JSON.stringify({ calls: remote.calls.map(c => c.method), sort: __internals.$sessionSort.get() })
  )

  __internals.toggleExpanded('zulu')
  __internals.setSessionSort('zulu', 'activity')
  await new Promise(resolve => setTimeout(resolve, __internals.SYNC_DEBOUNCE_MS + 150))
  await syncSettle()

  const paneKeys = puts(remote).flatMap(call => Object.keys(call.body.keys))

  check(
    'sync: through the pane, a sort change is pushed and the expand toggle is not',
    paneKeys.join(',') === 'session-sort-v1' && remote.store['session-sort-v1'].value.zulu === 'activity' && remote.store['session-sort-v1'].rev === 4,
    JSON.stringify({ paneKeys, store: remote.store['session-sort-v1'] })
  )

  __internals.getPrefSync()?.dispose()
  Object.keys(h.storage).forEach(key => delete h.storage[key])
  Object.assign(h.storage, savedStorage)
  plugin.register(ctx)
  await syncSettle()

  check(
    "sync: the harness's own backend has no /state contract, so the live pane is local-only again",
    __internals.getPrefSync()?.state().unsupported === true
  )
}

// (f) removing an object entry is sent as a tombstone; (g) revs climb past the server's
{
  const server = syncServer({
    'session-colors-v1': { rev: 3, value: { ghost: { s2: '#22c55e' }, zulu: { s1: '#ef4444' } } }
  })
  const { clock, sync } = makeSync({ server })

  await sync.start()
  sync.noteLocal('messenger-session-colors-v1', { zulu: { s1: '#ef4444' } })
  await clock.advance(1500)

  const first = puts(server)[0]?.body

  check(
    'sync: a removed top-level entry goes out as a tombstone with the new rev',
    first?.keys['session-colors-v1']?.rev === 4 &&
      first.tombstones.length === 1 &&
      first.tombstones[0].key === 'session-colors-v1' &&
      first.tombstones[0].entry === 'ghost' &&
      first.tombstones[0].rev === 4 &&
      !('ghost' in server.store['session-colors-v1'].value),
    JSON.stringify(first)
  )

  sync.noteLocal('messenger-session-colors-v1', { zulu: { s1: '#3b82f6' } })
  await clock.advance(1500)

  check(
    'sync: an entry already tombstoned is not tombstoned again',
    puts(server)[1]?.body?.tombstones?.length === 0 && puts(server)[1].body.keys['session-colors-v1'].rev === 5
  )

  // Another machine writes rev 10 meanwhile; this one picks it up on show.
  server.store['session-colors-v1'] = {
    entries: { kilo: 10, zulu: 10 },
    rev: 10,
    tombs: {},
    value: { kilo: { s9: '#a855f7' }, zulu: { s1: '#3b82f6' } }
  }
  sync.visible()
  await syncSettle()

  check(
    'sync: a higher server rev is adopted when the key has no local edits',
    sync.state().meta.serverRevs['session-colors-v1'] === 10 && sync.state().meta.names['session-colors-v1'].includes('kilo')
  )

  sync.noteLocal('messenger-session-colors-v1', { zulu: { s1: '#3b82f6' } })
  await clock.advance(1500)

  const revs = puts(server).map(call => call.body.keys['session-colors-v1'].rev)
  const last = puts(server)[2]?.body

  check(
    'sync: revs strictly increase and exceed the highest rev seen from the server',
    revs.join(',') === '4,5,11' && last.tombstones.map(t => `${t.entry}@${t.rev}`).join(',') === 'kilo@11',
    JSON.stringify({ revs, last })
  )

  // Local edits are never clobbered by a server view while they are unpushed.
  server.fail = method => (method === 'PUT' ? new Error('offline') : null)
  sync.noteLocal('messenger-session-colors-v1', { mine: { s0: '#000000' } })
  server.store['session-colors-v1'].rev = 50
  server.store['session-colors-v1'].value = { theirs: { s5: '#ffffff' } }
  server.store['session-colors-v1'].entries = { theirs: 50 }
  sync.visible()
  await syncSettle()

  check(
    'sync: a pull never overwrites a key that has unpushed local edits',
    server.calls.slice(-2).map(call => call.method).join(',') === 'GET,PUT' &&
      sync.state().dirty.includes('session-colors-v1') &&
      !sync.state().meta.names['session-colors-v1'].includes('theirs'),
    JSON.stringify(sync.state())
  )

  server.fail = null
  await clock.advance(2000)

  check(
    'sync: …and its pushes outrank what it saw: 51 (failed), then 52, and the merge keeps theirs',
    puts(server).slice(-2).map(call => call.body.keys['session-colors-v1'].rev).join(',') === '51,52' &&
      Object.keys(server.store['session-colors-v1'].value).sort().join(',') === 'mine,theirs' &&
      sync.state().meta.names['session-colors-v1'].sort().join(',') === 'mine,theirs' &&
      sync.state().dirty.length === 0,
    JSON.stringify(puts(server).slice(-1)[0].body)
  )
}

// ── the 1.2.0 id rename: saved prefs follow the plugin across it ────────────
// Last, on purpose: register() re-reads storage, so it must not disturb the
// state the checks above were asserting on.
{
  const legacy = globalThis.localStorage
  const cells = {
    'hermes.plugin.messenger.sections-v1': JSON.stringify([{ id: 'sec-old' }]),
    'hermes.plugin.messenger-session-colors-v1': 'x'  // outside the namespace: untouched
  }

  globalThis.localStorage = {
    get length() {
      return Object.keys(cells).length
    },
    key: i => Object.keys(cells)[i] ?? null,
    getItem: k => (k in cells ? cells[k] : null),
    setItem: (k, v) => {
      cells[k] = String(v)
    },
    removeItem: k => {
      delete cells[k]
    }
  }

  plugin.register(ctx)
  const afterRenamed = { ...cells }

  plugin.register(ctx)
  const afterTwice = Object.keys(cells).length

  check(
    'the id rename carries saved prefs across on register()',
    afterRenamed['hermes.plugin.personae.sections-v1'] === JSON.stringify([{ id: 'sec-old' }]) &&
      afterRenamed['hermes.plugin.messenger.sections-v1'] !== undefined,
    JSON.stringify(afterRenamed)
  )
  check(
    '…a copy, never a move, and running it twice changes nothing',
    afterRenamed['hermes.plugin.messenger-session-colors-v1'] === 'x' &&
      Object.keys(cells).length === afterTwice &&
      afterTwice === Object.keys(afterRenamed).length,
    `${afterTwice} keys: ${Object.keys(cells).join(', ')}`
  )

  if (legacy === undefined) delete globalThis.localStorage
  else globalThis.localStorage = legacy
}

// ── 0.12.0 — the vendored markdown-text module, and the previews it cleans ───────────────────────
// One authored file (`shared/markdown-text.js`), two byte-identical copies: the phone's
// `src/logic/markdown-text.js` and the block inlined into `desktop/plugin.js` between the sentinels.
// Drift is a build failure on BOTH sides — edit either copy without running
// `scripts/vendor-markdown-text.sh` and this suite goes red, which is the whole mechanism.
{
  const src = readFileSync('./plugin.js', 'utf8')
  const beginAt = src.indexOf('// ── BEGIN vendored markdown-text.js')
  const beginEol = src.indexOf('\n', beginAt) + 1
  const endAt = src.indexOf('// ── END vendored markdown-text.js')
  const block = src.slice(beginEol, endAt)
  const hash = value => createHash('sha256').update(value, 'utf8').digest('hex')

  check(
    '0.12.0 D1: the block inlined between the sentinels IS shared/markdown-text.js',
    beginAt > 0 && endAt > beginAt && hash(block) === MARKDOWN_TEXT_SHA256,
    `inlined sha256 ${hash(block)}`
  )
  check(
    '0.12.0 D1: and the sentinel comment carries that same hash',
    /sha256 ([0-9a-f]{64})/.exec(src.slice(beginAt, beginEol))?.[1] === MARKDOWN_TEXT_SHA256,
    src.slice(beginAt, beginEol)
  )

  const mobileDir = process.env.PERSONAE_MOBILE_DIR || `${process.env.HOME}/Projects/personae-mobile`
  try {
    const mobile = readFileSync(`${mobileDir}/src/logic/markdown-text.js`, 'utf8')
    check(
      '0.12.0 D1: the phone holds the same bytes as this plugin',
      hash(mobile) === MARKDOWN_TEXT_SHA256,
      `${mobileDir}/src/logic/markdown-text.js`
    )
  } catch (error) {
    check('0.12.0 D1: the phone holds the same bytes as this plugin', false, String(error))
  }

  // The previews themselves: a roster line shows a message the way a reader reads it.
  check(
    '0.12.0 D3: a **bold** preview renders as bold',
    typeof stripMarkdown === 'function' && stripMarkdown('a **bold** word and `code` and *em*', 0) === 'a bold word and code and em',
    typeof stripMarkdown === 'function' ? stripMarkdown('a **bold** word and `code` and *em*', 0) : 'no stripMarkdown on the inlined copy'
  )
  check(
    '0.12.0 D4: a fenced preview leaks no backticks',
    typeof stripMarkdown === 'function' && !stripMarkdown('before\n```js\nconst x = 1\n```\nafter', 0).includes('`'),
    typeof stripMarkdown === 'function' ? stripMarkdown('before\n```js\nconst x = 1\n```\nafter', 0) : 'no stripMarkdown on the inlined copy'
  )
  check(
    '0.12.0 D5: the roster row, the toast, the snippet and the title all go through it',
    /preview: last \? stripMarkdown\(/.test(src) &&
      /message: stripMarkdown\(row\.preview, 140\)/.test(src) &&
      /const snippet = stripMarkdown\(/.test(src) &&
      /return PREVIEW_BOILERPLATE\.some\(pattern => pattern\.test\(text\)\) \? '' : stripMarkdown\(text, 0\)/.test(src),
    'one of the four preview call sites is missing its stripMarkdown call'
  )
}

// ── 1.4.0 — a search that FINDS the session, and the bulk archive cut ──────
//
// Pedro, 2026-10-16: "Search is not working, I tried searching for a keyword and
// it didn't pop up the session I was expecting it to." Six defects sat behind
// that one sentence, and every one of them is pinned below:
//   D1 an EXPANDED profile drew its own recent sessions and swallowed its hits;
//   D2 only five hits were ever drawn, and "N more" was dead text;
//   D3 body hits arrived BM25-ranked with tool rows on top;
//   D4 the archive was never swept, so an archived chat's title was unfindable;
//   D5 a dead backend and "no match" drew the same screen;
//   D6 the drill-downs had no search, no multiselect and no batch bar.
// Plus the two asks: multiselect in "View Archived", and "Archive all up to this
// point" (archive by default; a DELETE twin was explicitly NOT wanted).

const i18nT = (key, ...args) => {
  const value = h.i18n[key]

  return typeof value === 'function' ? value(...args) : value ?? key
}

// ── D3: one row per session, and a sentence beats a tool dump ──────────────

{
  const grouped = __internals.mergeBodyHits({}, 'zulu', [
    { role: 'tool', session_id: 's1', snippet: 'tool noise one' },
    { role: 'assistant', session_id: 's1', snippet: 'the sentence the user meant' },
    { role: 'tool', session_id: 's1', snippet: 'tool noise two' },
    { role: 'tool', session_id: 's2', snippet: 'all tool here' },
    { role: 'user', session_id: 's3', snippet: 'another sentence' }
  ]).zulu
  const at = id => grouped.findIndex(hit => hit.id === id)

  check(
    'ONE row per session, not one per message — and it carries the match count',
    grouped.filter(hit => hit.id === 's1').length === 1 && grouped.find(hit => hit.id === 's1').matches === 3,
    JSON.stringify(grouped)
  )
  check(
    'the conversational match wins the snippet over the tool rows around it',
    grouped.find(hit => hit.id === 's1').preview === 'the sentence the user meant' &&
      grouped.find(hit => hit.id === 's1').toolOnly === false,
    JSON.stringify(grouped.find(hit => hit.id === 's1'))
  )
  check(
    'a conversational session sorts ahead of a tool-only one',
    at('s2') > at('s1') && at('s2') > at('s3'),
    grouped.map(hit => hit.id).join()
  )
  check('a tool-only session says so, so the row can be honest about its text', grouped.find(hit => hit.id === 's2').toolOnly === true)
}

// ── D-filters: an explicit query outranks the view filters ────────────────

{
  const rowsIn = [
    { label: 'Zulu', messages: 4, name: 'zulu', preview: '' },
    { label: 'Quiet', lastActiveMs: Date.now() - 10000, messages: 0, name: 'quiet', preview: '' }
  ]
  const filters = { activity: 'all', kind: 'noSessions', matchesByProfile: { zulu: [{ id: 'x' }] }, nowMs: Date.now(), profiles: [] }

  check(
    'a row that ANSWERS the query survives the view kind filter',
    __internals.visibleRows(rowsIn, { ...filters, query: 'flux' }).map(row => row.name).join() === 'zulu'
  )
  check(
    '…and with an empty box the very same filter applies again',
    __internals.visibleRows(rowsIn, { ...filters, query: '' }).map(row => row.name).join() === 'quiet'
  )
}

// ── the bulk cut: strictly older, same profile, never the clicked row ─────

{
  const list = [
    { id: 'newer', last_active: nowSec - 10 },
    { id: 'cut', last_active: nowSec - 100 },
    { id: 'older-a', last_active: nowSec - 200 },
    { id: 'older-b', last_active: nowSec - 5000 },
    { id: 'no-time' },
    { id: 'live-id', last_active: nowSec - 400, resolved_id: 'runtime-id' }
  ]
  const cut = __internals.sessionsUpTo(list, 'cut')

  check('the cut takes STRICTLY older sessions', cut.map(s => s.id).join() === 'older-a,older-b,live-id', cut.map(s => s.id).join())
  check('the clicked session is never in its own cut', !cut.some(s => s.id === 'cut'))
  check('a session that cannot be placed in time is left alone', !cut.some(s => s.id === 'no-time'))
  check('an unknown target cuts nothing', __internals.sessionsUpTo(list, 'nope').length === 0)
  check('a target with no readable timestamp cuts nothing', __internals.sessionsUpTo(list, 'no-time').length === 0)
  check(
    'the target resolves by EITHER id a row answers to — stored or live',
    __internals.sessionsUpTo(list, 'runtime-id').map(s => s.id).join() === 'older-b' &&
      __internals.sessionsUpTo(list, 'live-id').map(s => s.id).join() === 'older-b',
    `${__internals.sessionsUpTo(list, 'runtime-id').map(s => s.id).join()} / ${__internals.sessionsUpTo(list, 'live-id').map(s => s.id).join()}`
  )
}

// ── D5: the debounce, and the two needles ─────────────────────────────────

{
  __internals.$searchInput.set('')
  __internals.$searchQuery.set('')

  __internals.scheduleSearch('p')

  check('the box follows every keystroke', __internals.$searchInput.get() === 'p')
  check('but a needle below the minimum never arms a sweep', __internals.$searchQuery.get() === '')

  __internals.scheduleSearch('personae')

  check('the SWEEP waits for a pause — the box is written, the needle is not', __internals.$searchQuery.get() === '')

  await new Promise(resolve => setTimeout(resolve, __internals.SEARCH_DEBOUNCE_MS + 80))

  check('…and lands on its own once typing stops', __internals.$searchQuery.get() === 'personae')

  __internals.scheduleSearch('')

  check('clearing the box clears the needle', __internals.$searchQuery.get() === '')
}

// ── D1/D2: an EXPANDED profile draws its matches, and the extra are a door ─

const HITS_014 = [
  { body: true, id: 'hit-1', last_active: nowSec - 20, matches: 3, preview: 'the personae search', title: '' },
  { id: 'hit-2', last_active: nowSec - 60, preview: 'personae again', title: '' },
  { id: 'hit-3', last_active: nowSec - 100, preview: 'personae', title: '' },
  { id: 'hit-4', last_active: nowSec - 140, preview: 'personae', title: '' },
  { id: 'hit-5', last_active: nowSec - 180, preview: 'personae', title: '' },
  { id: 'hit-6', last_active: nowSec - 220, preview: 'personae', title: '' },
  { id: 'hit-7', last_active: nowSec - 260, preview: 'personae', title: '' }
]

h.storage['messenger-expanded-v1'] = { zulu: true }
h.storage['messenger-sections-v1'] = { collapsed: [], members: {}, sections: [] }
plugin.register(ctx)
h.queryResults['personae|roster'] = { data: rows, error: null, isError: false, isFetching: false, isPending: false }
h.queryResults['personae|sessions|zulu'] = {
  data: { zulu: [{ id: 'own-1', last_active: nowSec - 30, source: 'desktop', title: 'Own recent session' }] },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
h.queryResults['personae|search|personae|default|zulu'] = {
  data: { zulu: HITS_014 },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
__internals.$searchQuery.set('personae')
__internals.$searchHealth.set({ failed: [], unavailable: false })

markup = render()

check(
  'an EXPANDED profile draws its MATCHES — the bug was that its own list swallowed them',
  /data-session="hit-1"/.test(markup) && /data-session="hit-5"/.test(markup),
  markup.slice(markup.indexOf('data-profile="zulu"'), markup.indexOf('data-profile="zulu"') + 400)
)
check(
  '…and the profile’s own recent sessions do not push them out',
  !markup.includes('data-session="own-1"'),
  'the own-session list and the hit list both drew'
)
check('a body hit says how many messages matched', markup.includes('data-session-matches="3"'))
check(
  'the hits past the per-row cap are a DOOR, not dead text',
  markup.includes('data-more-hits="2"') && !/data-more-hits="2"[^>]*disabled/.test(markup),
  markup.match(/data-more-hits="[^"]*"/g)?.join(' ')
)
check(
  'and the door targets the search drill-down for THAT profile and needle',
  JSON.stringify(__internals.moreHitsTarget('zulu', 'personae')) ===
    JSON.stringify({ kind: 'search', profile: 'zulu', query: 'personae' })
)

// ── D6: the drill-down is a list you can work on ──────────────────────────

h.queryResults['personae|view|search|zulu|personae'] = {
  data: HITS_014,
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
__internals.$searchQuery.set('')
__internals.$listView.set({ kind: 'search', profile: 'zulu', query: 'personae' })

markup = render()

check(
  'View matches lists every hit, not the first five',
  markup.includes('data-list-view="search"') && /data-session="hit-7"/.test(markup),
  markup.slice(0, 260)
)
check('it names the needle and the profile it belongs to', /View matches[\s\S]{0,120}?personae/.test(markup))
check('it carries its own filter box', /aria-label="Filter this list"/.test(markup))
check('and its own select toggle', /aria-label="Select sessions"/.test(markup))
check('the roster is not drawn behind it', !markup.includes('data-profile='))
check(
  'the query is PINNED, so clearing the search box cannot empty this screen',
  __internals.$searchQuery.get() === '' && /data-session="hit-1"/.test(markup)
)

h.queryResults['personae|view|archived|zulu'] = {
  data: [
    { archived: true, id: 'arc-1', last_active: nowSec - 90000, source: 'whatsapp', title: 'Archived thread' },
    { archived: true, id: 'arc-2', last_active: nowSec - 190000, source: 'desktop', title: 'Older thread' }
  ],
  error: null,
  isError: false,
  isFetching: false,
  isPending: false
}
__internals.$listView.set({ kind: 'archived', profile: 'zulu' })

markup = render()

check(
  'View Archived can MULTISELECT (Pedro, 2026-10-16)',
  /aria-label="Select sessions"/.test(markup) && markup.includes('data-list-view="archived"')
)
check('View Archived can filter its own list', /aria-label="Filter this list"/.test(markup))
check(
  'an archived row is LABELLED archived in this list',
  markup.includes('data-session-archived="arc-1"'),
  markup.slice(markup.indexOf('data-session="arc-1"') - 80, markup.indexOf('data-session="arc-1"') + 80)
)
{
  // The way back out of the archive. The bulk cut is a one-press verb, so the
  // undo has to exist INSIDE the pane, on the row it applies to.
  const arcMenu = markup.slice(markup.indexOf('data-session="arc-1"'))

  check(
    'an ARCHIVED row offers Unarchive instead of a no-op Archive',
    labelAt(arcMenu, 'Unarchive') >= 0 && labelAt(arcMenu, 'Archive') < 0,
    arcMenu.slice(0, 200)
  )
  check("…with the app's own unarchive glyph", glyphFor(arcMenu, 'Unarchive') === 'unarchive')
  check(
    'and the bulk cut is NOT offered from inside the archive — it would re-archive rows and report a count',
    // The label carries a trailing ellipsis; asserting on a truncated string
    // would pass for the wrong reason (nothing can match it).
    labelAt(arcMenu, 'Archive all up to this point…') < 0
  )
  check(
    'a LIVE row keeps Archive AND the cut, and never says Unarchive',
    labelAt(sessionMenu, 'Unarchive') < 0 &&
      labelAt(sessionMenu, 'Archive') >= 0 &&
      labelAt(sessionMenu, 'Archive all up to this point…') >= 0,
    sessionMenu.slice(0, 120)
  )

  h.requests.length = 0

  const back = await __internals.unarchiveSession('arc-1', 'zulu')
  const call = h.requests.filter(entry => entry.method === 'session.archive').pop()

  check(
    'Unarchive is core’s own archive RPC in reverse — archived:false, same session, same profile',
    call?.params?.archived === false && call?.params?.session_id === 'arc-1' && call?.params?.profile === 'zulu',
    JSON.stringify(call?.params)
  )

  await __internals.archiveSession('arc-1', 'zulu')

  const inCall = h.requests.filter(entry => entry.method === 'session.archive').pop()

  check(
    '…and the pair differ in exactly the one field that matters',
    inCall?.params?.archived === true && inCall?.params?.session_id === call?.params?.session_id,
    JSON.stringify(inCall?.params)
  )
  check('both verbs answer from the gateway, not from pane state', back === undefined || typeof back === 'object' || back === null)
}

{
  // The batch bar only paints in select mode (a click), so the VERBS are pinned
  // on the source — the drill-down must reuse the roster's own four batch verbs
  // rather than inventing a second set for the same list.
  const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
  const view = src.slice(src.indexOf('function SessionListView({'), src.indexOf('/** Read a picked file as a data URL'))

  check(
    'the drill-down batch is the SAME bar with the same verbs',
    /jsx\(\s*SelectBar/.test(view) &&
      view.includes('onArchive: () => batch(archiveSessionEntry') &&
      view.includes('onClose: () => batch(closeSession') &&
      view.includes('onDelete: runDelete'),
    'the drill-down draws its own verbs instead of the roster’s'
  )
  check(
    'its ticks resolve against the rows AS DRAWN (local filter included)',
    view.includes('selectedSessions([{ name: profile, sessions }], selectedKeys)'),
    'the batch is resolved against a longer list than the one on screen'
  )
}

{
  // Pedro, 2026-10-17: "if I try to create a new session group by right-clicking
  // a session that is in the 'view all' it doesn't work." The drill-down draws
  // real SessionRows, and a row's Group menu calls three handlers — the pane
  // passed none of them, so every verb in that submenu threw on `undefined`.
  const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
  const view = src.slice(src.indexOf('function SessionListView({'), src.indexOf('/** Read a picked file as a data URL'))
  const at = src.indexOf('if (view) {')
  const call = src.slice(at, src.indexOf('let body', at))

  check(
    'the drill-down receives the group verbs its rows call',
    ['onNewGroup:', 'onMoveGroup:', 'onCreateAproposGroup:'].every(key => call.includes(key)),
    'the pane returns a SessionListView without the verbs its own rows invoke'
  )
  check(
    'and hands them to every row, with the group facts the menu reads',
    [
      'onNewGroup: () => onNewGroup(profile, [session.id])',
      'onMoveGroup: payload => onMoveGroup(profile, payload, selectedKeys)',
      'groups: groupSlice.groups',
      'group: groupSlice.members[String(session.id)]'
    ].every(key => view.includes(key)),
    'a row in the drill-down cannot file itself'
  )

  // Behaviour, not wiring: a group made from here FILES the row and hands the
  // pane back to the roster — which is where the group, and the rename field
  // that opens on it, are drawn.
  __internals.$sessionGroups.set({})
  __internals.$listView.set({ kind: 'all', profile: 'zulu' })

  const made = __internals.createGroupHere('zulu', ['sess-zulu-list-1'])

  check(
    'a group created from a drill-down files the session and returns to the roster',
    Boolean(made && made.id) &&
      __internals.$sessionGroups.get().zulu?.members?.['sess-zulu-list-1'] === made.id &&
      __internals.$listView.get() === null,
    JSON.stringify({ made, store: __internals.$sessionGroups.get(), view: __internals.$listView.get() })
  )

  __internals.$sessionGroups.set({})
}

// ── D5: silence is not an answer ──────────────────────────────────────────

__internals.$listView.set(null)
__internals.$searchQuery.set('zzz')
h.queryResults['personae|search|zzz|default|zulu'] = { data: {}, error: null, isError: false, isFetching: false, isPending: false }

markup = render()

check('a search that matches nothing SAYS so', markup.includes('data-search-empty="zzz"'), markup.slice(0, 240))

__internals.$searchHealth.set({ failed: [], unavailable: true })

markup = render()

check(
  'a missing search backend says TITLES ONLY instead of looking empty',
  markup.includes('data-search-health="unavailable"'),
  markup.slice(0, 240)
)

__internals.$searchHealth.set({ failed: ['zulu'], unavailable: false })

markup = render()

check(
  'a backend that refused for ONE profile names it',
  markup.includes('data-search-health="failed"') && markup.includes('zulu'),
  markup.slice(0, 240)
)

__internals.$searchHealth.set({ failed: [], unavailable: false })

// ── the confirmation: the count IS the safety ─────────────────────────────

markup = renderToStaticMarkup(
  jsx(__internals.ArchiveCutBar, { busy: false, count: 4, onCancel: () => {}, onRun: () => {}, profile: 'zulu', t: i18nT })
)

check('the bulk archive asks first, with the COUNT in the question', markup.includes('Archive the 4 sessions older than this one?'))
check('the bar is scoped to the profile it will act on', markup.includes('data-archive-cut="zulu:4"'))
check('and its verbs are Cancel + Archive', labelAt(markup, 'Cancel') >= 0 && labelAt(markup, 'Archive') >= 0)
check(
  'archiving is NOT dressed as a delete — the default is the reversible verb',
  !markup.includes('data-variant="destructive"') && !/Delete/.test(markup)
)
{
  const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

  check(
    '"Delete all up to this point" does not exist — Pedro excluded it',
    !/Delete all up to this point/i.test(src) && !/deleteUpTo|deleteAllUpTo/i.test(src)
  )
}

// ── and the drill-down lists the same hits the roster previewed ───────────

h.rest.byProfile = { zulu: { results: [{ session_id: 'bh-1', snippet: 'a hit' }, { session_id: 'bh-2', snippet: 'another' }] } }

const fullHits = await __internals.listSearchHits('zulu', 'personae')

check(
  'listSearchHits returns the profile’s own list for one needle',
  fullHits.some(hit => hit.id === 'bh-1') && fullHits.some(hit => hit.id === 'bh-2'),
  JSON.stringify(fullHits.map(hit => hit.id))
)
check('and an empty needle lists nothing rather than everything', (await __internals.listSearchHits('zulu', '  ')).length === 0)
check(
  'the drill-down filter matches what the ROW shows',
  __internals.listMatch({ title: 'Flux capacitor retro' }, 'flux') &&
    __internals.listMatch({ id: 'abc' }, 'abc') &&
    !__internals.listMatch({ title: 'nope' }, 'flux')
)

// Hand the pane back the way the rest of the suite expects to find it.
__internals.$listView.set(null)
__internals.$searchQuery.set('')
__internals.$searchInput.set('')
__internals.$expanded.set({})
h.rest.byProfile = {}

// ── 2026-10-17: the second click, done for you ──────────────────────────────
// "every time I click on a session from a different profile, it always opens a
// random session from that profile. Only when I click it a second time do I
// land on the desired session." A cross-profile open carries a real workspace
// switch (`switchWorkspace` + `showAllProfiles: false`), and a switch RESTORES
// that profile's own tile set — so the navigation races a restore that knows
// nothing about the clicked id. The fix checks what is actually in front and
// clicks again, bounded.
{
  const sessions = many(3) // s-0..s-2 / r-0..r-2
  const plainOpens = () => h.opens.filter(entry => entry.options.intent === undefined)

  host.state.profile.set('default')

  // 1. The reported bug: the switch lands on a DIFFERENT session of the profile.
  h.opens.length = 0
  h.openLandsOn = 'r-0'

  await __internals.openSessionInProfile('zulu', sessions, 'r-1')

  check(
    'a cross-profile click opens the clicked session TWICE: once to move, once to land',
    h.opens[0].id === 'r-1' && h.opens[0].options.keepAllProfilesScope === false,
    JSON.stringify(h.opens.map(entry => `${entry.id}:${entry.options.intent || 'switch'}`))
  )
  check(
    '…and the landing open is LAST, after the dock — a tab open focuses its own tile',
    h.opens[h.opens.length - 1].id === 'r-1' &&
      h.opens[h.opens.length - 1].options.intent === undefined &&
      h.opens[h.opens.length - 1].options.keepAllProfilesScope === undefined,
    JSON.stringify(h.opens.map(entry => `${entry.id}:${entry.options.intent || 'switch'}`))
  )
  check(
    '…and the app ends up focused on the clicked session',
    host.state.focusedStoredSessionId.get() === 'r-1',
    String(host.state.focusedStoredSessionId.get())
  )

  // 2. Nothing to dock (the clicked session is the only one): one open, one land.
  host.state.profile.set('default')
  h.opens.length = 0
  h.openLandsOn = 'r-1'

  await __internals.openSessionInProfile('zulu', [sessions[1]], 'r-1')

  check(
    'with nothing to dock, a cross-profile click is a single open',
    plainOpens().length === 1 && h.opens.length === 1,
    JSON.stringify(plainOpens().map(entry => entry.id))
  )

  // 3. Same profile: one plain open, no switch flags, no re-assert.
  host.state.profile.set('zulu')
  h.opens.length = 0

  await __internals.openSessionInProfile('zulu', sessions, 'r-2')

  check(
    'a click INSIDE the active profile stays a single open',
    h.opens.length === 1 && h.opens[0].id === 'r-2' && h.opens[0].options.keepAllProfilesScope === undefined,
    JSON.stringify(h.opens)
  )

  // 4. "Open all in tabs" rides the same switch, so its main open gets the same
  //    guarantee — and the re-assert must not add an open when nothing drifted.
  host.state.profile.set('default')
  h.opens.length = 0

  await __internals.openProfileSessions({ name: 'zulu' }, many(2))

  check(
    'opening a whole profile still finishes on its main session, with no extra open',
    h.opens.length === 2 && h.opens[1].options.intent === 'main' && host.state.focusedStoredSessionId.get() === 'r-0',
    JSON.stringify(h.opens.map(entry => `${entry.id}:${entry.options.intent || 'switch'}`))
  )

  host.state.profile.set('default')
  host.state.focusedStoredSessionId.set(null)
}

// ── 2026-10-17: a filed session has to APPEAR, from either drill-down ───────
// "when I assign them to a group, they don't show up" + "when I finish renaming
// the group, it should populate with the selected session that started it".
// The box draws members out of the profile's session page — so a member the page
// cannot serve (an ARCHIVED row: session.list never returns those) or a page the
// roster has not refetched yet made a group that claimed a session it did not
// draw.
{
  const realList = h.responses['session.list']
  const profile = 'filer'
  const live = [
    { id: 'f-live', resolved_id: 'r-f-live', title: 'Live one', preview: 'p', last_activity_at: 5000, source: 'desktop' },
    { id: 'f-old', resolved_id: 'r-f-old', title: 'Older live one', preview: 'q', last_activity_at: 4000, source: 'desktop' }
  ]
  const archivedRow = {
    archived: true,
    id: 'f-arch',
    last_activity_at: 1000,
    preview: 'z',
    source: 'desktop',
    title: 'Archived one'
  }

  const blocksFor = async () => {
    const rows = await __internals.listProfileSessions(profile)

    return __internals.sessionGroupBlocks(rows, __internals.$sessionGroups.get(), profile, [])
  }
  const inGroup = (blocks, id) => blocks.flatMap(entry => entry.sessions).some(row => String(row.id) === id)

  // 1. "View all": the row IS in the live page.
  h.responses['session.list'] = () => ({ sessions: live })
  h.rest.byProfile = { [profile]: { sessions: [] } }
  __internals.$listView.set({ kind: 'all', profile })
  __internals.$expanded.set({})

  const made = __internals.createGroupHere(profile, ['f-old'])

  check(
    'a group made from "View all" files the session it was made on',
    Boolean(made?.id) && __internals.$sessionGroups.get()[profile]?.members?.['f-old'] === made.id,
    JSON.stringify({ made, store: __internals.$sessionGroups.get()[profile] })
  )
  check(
    '…and the pane lands on the screen that draws it (row expanded, drill-down closed)',
    __internals.$listView.get() === null && __internals.$expanded.get()[profile] === true,
    JSON.stringify({ expanded: __internals.$expanded.get(), view: __internals.$listView.get() })
  )

  let blocks = await blocksFor()

  check('…so the box already holds it', inGroup(blocks, 'f-old'), JSON.stringify(blocks.map(b => [b.id, b.sessions.map(s => s.id)])))

  // 2. Finishing the rename must not lose the member.
  __internals.renameSessionGroup(profile, made.id, 'Trip planning')
  blocks = await blocksFor()

  check(
    'finishing the rename keeps the starting session in the box',
    inGroup(blocks, 'f-old') &&
      blocks.some(entry => entry.id === made.id && entry.name === 'Trip planning'),
    JSON.stringify(blocks.map(b => [b.name, b.sessions.map(s => s.id)]))
  )

  // 3. "View archived": the row is NOT in session.list at all — the archive is
  //    the only place it exists.
  h.responses['session.list'] = () => ({ sessions: live })
  h.rest.byProfile = { [profile]: { sessions: [archivedRow] } }
  __internals.$listView.set({ kind: 'archived', profile })

  const arch = __internals.createGroupHere(profile, ['f-arch'])

  blocks = await blocksFor()

  check(
    'a group made from "View archived" draws its archived member',
    Boolean(arch?.id) && inGroup(blocks, 'f-arch'),
    JSON.stringify(blocks.map(b => [b.id, b.sessions.map(s => s.id)]))
  )
  check(
    '…and the merged row still SAYS it is archived',
    blocks.some(entry => entry.sessions.some(row => row.id === 'f-arch' && row.archived === true)),
    JSON.stringify(blocks.flatMap(b => b.sessions).map(s => [s.id, s.archived]))
  )

  // 4. Assignment is the same promise as creation.
  __internals.moveSessionsToGroup(profile, ['f-arch'], arch.id)
  blocks = await blocksFor()

  check(
    'assigning an archived session to a group shows it there',
    inGroup(blocks, 'f-arch'),
    JSON.stringify(blocks.map(b => [b.id, b.sessions.map(s => s.id)]))
  )

  h.responses['session.list'] = realList
  h.rest.byProfile = {}
  __internals.$listView.set(null)
  __internals.$expanded.set({})
  __internals.$sessionGroups.set({})
}

// ── 2026-10-17: a member the page cannot serve is RESOLVED, not filtered ────
// `session.list` serves live rows inside its page and nothing else. Filing an
// ARCHIVED session, one older than the page, or one whose id a compaction has
// reminted leaves a group that holds a session and draws nothing — which is what
// "I can't add it, and if it is added I don't see it" looks like from outside.
{
  const realList = h.responses['session.list']
  const profile = 'resolver'
  const live = Array.from({ length: 12 }, (_, i) => ({
    id: `rv-${i}`,
    last_activity_at: 9000 - i,
    preview: `row ${i}`,
    resolved_id: `rr-${i}`,
    source: 'desktop',
    title: `Recent ${i}`
  }))

  h.responses['session.list'] = ({ limit }) => ({ sessions: live.slice(0, limit || 10) })
  __internals.$sessionGroups.set({})
  __internals.$expanded.set({})

  const group = __internals.createSessionGroup(profile, 'job hunt', [])

  // The id the pane filed: the session has since COMPACTED, so the page knows the
  // tip only. This is the case a page filter can never solve.
  __internals.moveSessionsToGroup(profile, ['old-id'], group)

  h.rest.calls.length = 0
  h.rest.writes = []
  h.rest.byProfile = {
    [profile]: {
      sessions: [
        {
          _lineage_root_id: 'old-id',
          archived: false,
          id: 'tip-1',
          last_active: 8000,
          message_count: 12,
          preview: 'p',
          source: 'desktop',
          title: 'Job hunt thread'
        }
      ]
    }
  }

  const page = await __internals.listProfileSessions(profile)
  const drawn = __internals.sessionGroupBlocks(page, __internals.$sessionGroups.get(), profile, [])

  check(
    'a member the page cannot serve is asked for BY ID',
    h.rest.writes.some(
      entry => entry.path === '/resolve' && entry.method === 'POST' && (entry.body?.ids || []).includes('old-id')
    ),
    JSON.stringify(h.rest.writes)
  )
  check(
    '…and the profile it belongs to rides with the question',
    h.rest.writes.some(entry => entry.path === '/resolve' && entry.body?.profile === profile),
    JSON.stringify(h.rest.writes)
  )
  check(
    'a compacted member is drawn through its lineage (root id, live tip)',
    drawn.some(block => block.id === group && block.sessions.some(row => String(row.id) === 'tip-1')),
    JSON.stringify(drawn.map(b => [b.id, b.sessions.map(s => s.id)]))
  )
  check(
    '…and the page itself never had to contain it',
    !page.some(row => String(row.id) === 'old-id'),
    JSON.stringify(page.map(row => row.id))
  )

  h.responses['session.list'] = realList
  h.rest.byProfile = {}
  __internals.$sessionGroups.set({})
}

// ── Files: a folder tree beside Scheduled jobs (2026-10-17) ─────────────────
{
  const filesPane = contributions.find(entry => entry.id === 'files') || {}

  check(
    '"Files" docks where Scheduled jobs does, collapsed, so the two are tabs',
    filesPane.data?.placement === 'main' &&
      filesPane.data?.dock?.pane === 'workspace' &&
      filesPane.data?.dock?.pos === 'right' &&
      filesPane.data?.defaultCollapsed === true,
    JSON.stringify(filesPane.data)
  )
  check('its tab says Files', filesPane.title === 'Files', filesPane.title)

  check(
    'a tree lists folders before files, case-insensitively',
    JSON.stringify(
      __internals
        .sortFileEntries([{ name: 'b.txt' }, { name: 'Zeta', dir: true }, { name: 'alpha', dir: true }, { name: 'A.txt' }])
        .map(entry => entry.name)
    ) === JSON.stringify(['alpha', 'Zeta', 'A.txt', 'b.txt']),
    JSON.stringify(__internals.sortFileEntries([{ name: 'b.txt' }, { name: 'Zeta', dir: true }]))
  )
  check(
    'the breadcrumb starts at the backend home and walks down, never inventing a level',
    JSON.stringify(__internals.fileBreadcrumb('/home/you/Projects/app', '/home/you').map(c => c.name)) ===
      JSON.stringify(['you', 'Projects', 'app']),
    JSON.stringify(__internals.fileBreadcrumb('/home/you/Projects/app', '/home/you'))
  )
  check(
    'a file size is human, not a byte count',
    __internals.fileSizeLabel(999) === '999 B' &&
      __internals.fileSizeLabel(2048) === '2 KB' &&
      __internals.fileSizeLabel(5 * 1024 * 1024) === '5.0 MB',
    [999, 2048, 5 * 1024 * 1024].map(__internals.fileSizeLabel).join(' / ')
  )

  h.queryResults['personae|files|'] = {
    data: {
      count: 3,
      entries: [
        { dir: true, name: 'Projects', size: 4096 },
        { dir: false, name: 'notes.md', size: 1024 },
        { dir: false, name: 'a.txt', size: 12 }
      ],
      home: '/home/you',
      parent: '',
      path: '/home/you'
    },
    isPending: false
  }

  const html = renderToStaticMarkup(filesPane.render())

  check(
    'the tree draws the folder it was given, folders first, with sizes on files',
    html.includes('data-files-row="dir"') &&
      html.includes('Projects') &&
      html.indexOf('Projects') < html.indexOf('notes.md') &&
      html.includes('1 KB'),
    html.slice(0, 400)
  )
  check(
    'and the path bar names the folder being listed',
    html.includes('data-files-path="/home/you"'),
    html.slice(0, 300)
  )

  // A refusal has to be VISIBLE: an empty tree would read as an empty folder.
  h.queryResults['personae|files|'] = {
    data: { entries: [], error: 'outside_root', home: '/home/you', path: '/etc' },
    isPending: false
  }

  const refused = renderToStaticMarkup(filesPane.render())

  check(
    'a folder outside the allowed root SAYS so instead of looking empty',
    refused.includes('data-files-note="outside_root"'),
    refused.slice(0, 300)
  )

  delete h.queryResults['personae|files|']
}

// ── Files: preview + the right-click verbs (2026-10-17) ─────────────────────
{
  const pane = contributions.find(entry => entry.id === 'files') || {}

  h.rest.calls.length = 0
  h.rest.writes = []
  h.rest.byProfile = {}

  // 1. The click verb: a preview that reads the file, and nothing else.
  h.queryResults['personae|file|/home/you/notes.md'] = {
    data: { binary: false, error: null, lines: 2, path: '/home/you/notes.md', size: 2048, text: 'first line\nsecond line', truncated: false },
    isPending: false
  }

  const shown = renderToStaticMarkup(
    jsx(__internals.filePreview, {
      name: 'notes.md',
      onBack: () => {},
      path: '/home/you/notes.md',
      t: key => key
    })
  )

  check(
    'clicking a file PREVIEWS it: the text, its path, and a way back',
    shown.includes('data-files-preview=""') &&
      shown.includes('first line') &&
      shown.includes('second line') &&
      shown.includes('data-files-preview-path="/home/you/notes.md"') &&
      shown.includes('data-files-back=""'),
    shown.slice(0, 300)
  )

  // 2. A binary file is stated, never decoded into mojibake.
  h.queryResults['personae|file|/home/you/logo.png'] = {
    data: { binary: true, error: null, path: '/home/you/logo.png', size: 4096, text: '' },
    isPending: false
  }

  const png = renderToStaticMarkup(
    jsx(__internals.filePreview, { name: 'logo.png', onBack: () => {}, path: '/home/you/logo.png', t: key => key })
  )

  check('a binary file says so instead of decoding itself', png.includes('data-files-note="binary"'), png.slice(0, 240))

  // 3. The read is a GET on the path, and the open verbs are POSTs on /open.
  const read = await __internals.readFilePreview('/home/you/notes.md')

  check(
    'the preview read is one GET of that path',
    h.rest.calls.includes('/file?path=%2Fhome%2Fyou%2Fnotes.md') && read !== undefined,
    JSON.stringify(h.rest.calls.slice(-3))
  )

  h.rest.byProfile = {}
  const opened = await __internals.openOnBackend('/home/you/notes.md', 'editor')

  check(
    'opening in an editor POSTs the path and the target',
    h.rest.writes?.some(
      entry => entry.path === '/open' && entry.method === 'POST' && entry.body?.path === '/home/you/notes.md' && entry.body?.target === 'editor'
    ) && opened !== undefined,
    JSON.stringify(h.rest.writes)
  )

  // 4. The four menu verbs live on the ROW, and the click is Preview.
  const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
  const at = src.indexOf('function FileRow(')
  // …to the NEXT declaration: FileDirectory is defined ABOVE FileRow, so slicing
  // to it by name yields an empty (and silently passing) window.
  const row = src.slice(at, src.indexOf('\nfunction ', at + 10))
  const menu = row.slice(row.indexOf('return jsx(ContextMenu'))

  check(
    'right-click offers Preview, Open in editor, Show in file manager, Copy path',
    ['filesPreview', 'filesOpenEditor', 'filesShowFolder', 'filesCopyPath'].every(key => menu.includes(key)),
    menu.slice(0, 400)
  )
  check(
    'and a plain click is the preview — the row carries no other click verb',
    row.includes("onClick: entry.dir ? () => onToggle(full) : () => acts.preview()"),
    row.slice(0, 400)
  )
  check(
    'a directory does not offer a preview it cannot produce',
    /entry\.dir\s*\n?\s*\?\s*null/.test(menu),
    menu.slice(0, 300)
  )

  delete h.queryResults['personae|file|/home/you/notes.md']
  delete h.queryResults['personae|file|/home/you/logo.png']
  h.rest.byProfile = {}
}

const failedNow = results.filter(r => !r.ok)

console.log(`\n${results.length - failedNow.length}/${results.length} passed`)

process.exit(failedNow.length ? 1 : 0)
