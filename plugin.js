/**
 * Personae — P1c + P4 + P5: Bots-parity row, toolbar, groups.
 *
 * The left-strip tab beside Sessions | Bots (P0/P1) paints one row per profile
 * — avatar, name, last-session preview, age — plus the Bots pane's chrome:
 * bell, "+" (new session with a profile), folder+ (new group), search and
 * filters. Clicking a profile to expand it into its sessions is P2.
 *
 * ── ROW GEOMETRY ────────────────────────────────────────────────────────────
 * Transcribed from the Bots rail (`hermes-bots/bot-row.tsx`) so one profile
 * reads the same size in both panes of the strip:
 *   row      RowButton + px-2 py-2.5, gap-2.5, items-center, rounded-md
 *   avatar   52px at 22% radius, display:block   (BotFace's 34px, scaled ×1.53)
 * Rows are deliberately taller than the Bots rail's — +25% on session rows via
 * inline padding — and the faces larger (Pedro, 2026-10-09: "make it bigger than
 * bot mode", sizes eyeballed): every other dimension still matches, so the two
 * panes read as the same list at two densities.
 *   line 1   SidebarRowLead(SessionStatusDot) + name ……… age
 *   line 2   preview
 * The dot is the FIRST thing on line 1, inside the fixed lead cell every
 * session row reserves — that cell is what keeps all names on one left edge.
 * It is NOT the trailing edge (the timer pins to that) and NOT line 2.
 *
 * ── STATUS LIGHTS ───────────────────────────────────────────────────────────
 * `SessionStatusDot` reads CORE's live state, and core only knows the sessions
 * of the profile the app is ON. So the pane feeds the other profiles itself:
 * when a poll sees a profile's `last_active` advance past its watermark it
 * writes `markSessionUnreadFinished(id, profile)` — the SDK's unread store,
 * which exists for exactly this ("a roster poll's activity watermark, say").
 * That lights the emerald dot for remote profiles too. Literal *working now*
 * (accent) stays the active profile's alone, the only one core can see.
 *
 * Every class below must already exist in the app's compiled stylesheet — a
 * plugin loads at RUNTIME, so a utility the app never used is simply absent
 * from the CSS and does nothing. tests/classes.mjs enforces that.
 *
 * Payload source: `tui_gateway/methods_profiles.py` (`profiles.list` with
 * `include_sessions`), whose rows carry `last_session` / `worker_session` /
 * `canonical_session` / `ui_meta` / `has_avatar`.
 *
 * ── APROPOS IS BETA ─────────────────────────────────────────────────────────
 * The topic refresher is labelled beta on every surface that offers it: the
 * session menu's "Apropos (On that topic, beta)", the group heading's "Apropos
 * this group (beta)", and the selection bar's "Apropos (beta)". The label is
 * the whole marker — the machinery is finished, but its edges are still being
 * pinned down (a child that never ran a turn, a lineage that renames itself on
 * compaction). Pedro, 2026-10-10: "flag the apropos feature as beta".
 *
 * Save:  ~/.hermes/desktop-plugins/messenger/plugin.js   (folder name == id)
 * Load:  the app's OWN home — run ./deploy.sh here, then let it hot-reload
 *        (fallback: ⌘K → Reload desktop plugins).
 *
 * Plain ESM, loaded uncompiled. Only @hermes/plugin-sdk, react and
 * react/jsx-runtime resolve; UI is jsx() calls, NOT JSX syntax.
 */

import {
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ColorSwatches,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DisclosureCaret,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  PROFILE_SWATCHES,
  RowButton,
  SearchField,
  SessionStatusDot,
  SidebarRowLead,
  Skeleton,
  Switch,
  Tip,
  atom,
  cn,
  coarseElapsed,
  host,
  markSessionUnreadFinished,
  nextRunOverdueMs,
  profileColor,
  profileColorSoft,
  usePluginI18n,
  queryClient,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'messenger'

/** The app's own roster cadence (`profile_roster_cache.py`: "polls every 5s"). */
const POLL_MS = 5000
/** Liveness windows, verbatim from the Bots rail (`row-helpers.ts`): a worker
 *  heartbeats every ≤60s, so 90s reads "active now" and 150s still counts a
 *  worker alive across one missed beat. */
const ACTIVE_WINDOW_S = 90
const WORKER_ACTIVE_WINDOW_S = 150
/** The "recently active" bucket, also the rail's (`RECENT_ACTIVITY_WINDOW_S`). */
const RECENT_WINDOW_S = 7 * 24 * 60 * 60
/** The `ui_meta` namespace this pane owns. Distinct from the Bots pane's. */
const META_KEY = 'messenger'
// The Bots pane's own namespace, deliberately: same document, two panes.
const BOTS_META_KEY = 'hermes-bots'
const ROSTER_KEY = ['messenger', 'roster']
const SEARCH_KEY = ['messenger', 'search']
/** Sections live HERE, not in `ui_meta.sectionId` — the Bots pane owns that
 *  field and two writers would race for it. Same idea, own drawer. */
const SECTIONS_KEY = 'messenger-sections-v1'
const TOASTS_KEY = 'messenger-activity-toasts'
/** Session NAME colors: `{profile: {sessionId: '#rrggbb'}}` — the pane's own
 *  copy of the override it writes to CORE. A swatch writes the app's real store
 *  (`host.sessions.setColor`, exactly what the native picker writes, so the
 *  Sessions list and this pane agree), but that store has no SDK getter, so the
 *  pane keeps this mirror to paint its own rows with. */
const COLORS_KEY = 'messenger-session-colors-v1'
const SESSION_ORDER_KEY = 'messenger-session-order-v1'
/** The project list behind "Assign to project" (per-profile `projects.db`). */
const PROJECTS_KEY = ['messenger', 'projects']
/** How many of a profile's sessions the roster lists before "View all". Pedro
 *  halved this from 20 on 2026-10-09: a collapsed roster has to stay scannable.
 *  It is a display cap, never a filter: anything the pane has a REASON to draw
 *  (a group's member, a row it just released, a session nobody has positioned)
 *  is pinned past the line instead of being cut by it. */
const SESSIONS_PER_PROFILE = 10
/** Job-run sources, never conversations a human resumes. The backend's own
 *  listing deny-list (`INTERNAL_LISTING_SOURCES`) covers cron/webhook too since
 *  2026-10-09, so this is now belt-and-braces: it still holds if the pane is
 *  ever pointed at a build that predates that fix, and `cron_output` is a pane-
 *  side-only token. A scheduler run must never be drawn as if it were a chat. */
const NON_CONVERSATION_SOURCES = new Set(['cron', 'cron_output', 'webhook'])
/** Sources the app itself talks through — the ambient default, no chip. Every
 *  OTHER source is a channel and gets labelled (see `channelLabel`). */
const LOCAL_SURFACES = new Set(['', 'api', 'api_server', 'cli', 'desktop', 'local', 'webui'])
/** Channel display names. Nothing is filtered by channel — Telegram, WhatsApp,
 *  Discord and friends are all welcome; the label only says WHERE a session
 *  came from. An unmapped token is title-cased rather than dropped, so a new
 *  bridge names itself. */
const CHANNEL_LABELS = {
  beeper: 'Beeper',
  discord: 'Discord',
  email: 'Email',
  imessage: 'iMessage',
  matrix: 'Matrix',
  signal: 'Signal',
  slack: 'Slack',
  sms: 'SMS',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp'
}
/** '' for the app's own surfaces, else the channel's display name. */
function channelLabel(source) {
  const key = String(source || '')
    .trim()
    .toLowerCase()

  if (LOCAL_SURFACES.has(key)) {
    return ''
  }

  return CHANNEL_LABELS[key] || key.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, char => char.toUpperCase())
}
/** Face size: the Bots rail's 34px (`bot-row.tsx` `BotFace size={34}`) scaled
 *  ×1.53 — deliberately BIGGER than bot mode (Pedro's call, size eyeballed).
 *  One number drives the row, the skeleton and the fallback chip. */
const AVATAR_SIZE = 52
const AVATAR_RADIUS = '22%'
/** The rail's list gutter, from `roster-pane-content.tsx`. */
// `grid-cols-1` is load-bearing, not decoration: an implicit grid track is
// `auto`, whose MINIMUM is its items' min-content — and a `truncate` cell is
// `white-space: nowrap`, so its min-content is its FULL text. A long session
// title therefore set this pane's minimum width and gave the whole pane a
// horizontal scrollbar, which carried the caret and the drag grip out of view
// (Pedro, 2026-10-10). `minmax(0, 1fr)` (what grid-cols-1 compiles to) drops
// that floor to zero, so the cell ellipsises and the chrome stays put.
const LIST_CLASS = 'grid min-w-0 grid-cols-1 gap-0.5 px-1.5'
const UNASSIGNED = 'section:unassigned'
/** Sessions listed under a row when a search matches inside them. */
const SESSIONS_PER_ROW = 5
/** D-D: how many of a profile's sessions a click docks beside it. The tab strip
 *  scrolls horizontally past this; the cap only stops one click minting a
 *  hundred tiles. */
const DOCK_LIMIT = 10
/** Shorter needles stay local — below this a session sweep is all cost. */
const SEARCH_MIN_CHARS = 2

/** Plugin ctx, captured at register() — `storage` is what outlives the window. */
let ctxRef = null

/** User pref: toast on new profile activity. Default OFF, like the Bots rail —
 *  a busy fleet turns toasts into a firehose, and the unread dot already
 *  carries the signal. The dot is NEVER gated on this. */
const $activityToasts = atom(false)

/** Sections: `{ sections: [{id,name}], members: {profile: sectionId},
 *  collapsed: [id] }`. Membership is a map here, so deleting a section cannot
 *  orphan anybody and nothing ever writes a profile. */
const EMPTY_SECTIONS = { collapsed: [], members: {}, order: {}, sections: [], sort: {} }

/** The four ways a scope can be ordered. `activity` is the default because that
 *  is what a roster is FOR — what moved last is what the user wants next.
 *  `manual` follows the order array the drag grip writes. */
const SORT_MODES = ['activity', 'name', 'sessions', 'manual']

const SORT_LABELS = {
  activity: 'Last activity',
  name: 'Name',
  sessions: 'Sessions',
  manual: 'Manual'
}
const $sections = atom(EMPTY_SECTIONS)

/** Session-name colors. A plain mirror is authoritative for non-React reads
 *  (`sessionColor`), the atom is what components subscribe to. */
let sessionColors = {}
const $sessionColors = atom({})

/** Profile → session-id list, written by dragging a session's own grip. It is
 *  a LOCAL preference: it changes nothing in core, it just remembers the order
 *  the user dragged the list into (Pedro's item 4, "re-sorting sessions"). */
let sessionOrder = {}
const $sessionOrder = atom({})

/** Profile → session SORT MODE. Pedro, 2026-10-10: "allow sorting of sessions,
 *  manually, by last activity and others. That can be an option when
 *  right-clicking on a profile". A session belongs to a profile, so the profile
 *  is where its order is chosen — the same noun/verb rule the menus follow.
 *  `manual` is not a separate list: it means "follow the dragged order". */
const SESSION_SORT_KEY = 'messenger-session-sort-v1'
const SESSION_SORT_MODES = ['activity', 'manual', 'name', 'messages']
const SESSION_SORT_LABELS = {
  activity: 'Last activity',
  manual: 'Manual (drag)',
  name: 'Name',
  messages: 'Most messages'
}
let sessionSort = {}
const $sessionSort = atom({})

/** Profiles the user expanded into their sessions (name → true).
 *
 *  PERSISTED. This used to live in memory alone — the one view store the pane
 *  never handed to `ctxRef.storage` — so the user's expand/collapse work died
 *  with the module instance and the whole roster collapsed back. Pedro,
 *  2026-10-10: "If I expand all profiles to expose their sessions, after a while
 *  they all collapse again. Allow them to remain in the user's chosen state
 *  indefinitely." A view the user shaped by hand is theirs; it outlives the
 *  instance that drew it. */
const EXPANDED_KEY = 'messenger-expanded-v1'
let expandedProfiles = {}
const $expanded = atom({})

/** Only OPEN profiles are stored: closed is the default, so a blob holding
 *  `false` for every profile the user ever tried would be noise that grows with
 *  the roster. Anything truthy opens the row (`{zulu: 'yes'}` is a yes). */
function normalizeExpanded(value) {
  const out = {}

  if (value && typeof value === 'object') {
    for (const [name, open] of Object.entries(value)) {
      if (open) {
        out[String(name)] = true
      }
    }
  }

  return out
}

/** P7 list view: `null` is the roster; `{kind: 'all'|'archived', profile}` means
 *  the pane body is REPLACED by that profile's session list with a back button
 *  (Pedro's D-A). Deliberately transient, not persisted: a relaunch starts at
 *  the roster instead of stranding the user inside a drill-down. */
const $listView = atom(null)
/** The pane's refetch lever: the routines query is keyed on the epoch, so a
 *  pause / resume / delete / create asks for fresh data without a query client
 *  the plugin SDK does not hand out. */
const $routinesEpoch = atom(0)
// NOTE: this atom is now written by the LEFT pane (clicking a profile selects
// it), which is what the tiles follow. See setRoutineProfile's callers.

/** Which profile's jobs (and screen) the right-hand tile shows. null = the
 *  first profile that actually has a schedule. Transient by design: a relaunch
 *  re-derives it instead of pinning a profile the user may have forgotten. */
const $routineProfile = atom(null)

/** TEMPORARY: shows what a drop resolved to, in the pane, so a real-window
 *  gesture can be diagnosed without devtools. Flip to false to silence it. */
// OFF — a flip to `true` re-enables the on-screen drag logger for a debugging
// round. It must never ship on: the logger is a line of text ABOVE the list in a
// flex column, so every click changed its length, changed its line count, and
// reflowed the whole list under the pointer. Pedro, 2026-10-10: "the problem is
// the logger 'drag session'. that changes with each click and moves the list".
// Changing text belongs at the BOTTOM of a list, or nowhere.
const DND_TRACE = false

function bumpRoutines() {
  $routinesEpoch.set($routinesEpoch.get() + 1)
}

function setRoutineProfile(name) {
  $routineProfile.set(name)
}

/** Profile → the `last_active` (seconds) already accounted for. Seeded on the
 *  first poll, so a fresh mount never marks ancient history unread. */
let watermarks = new Map()
let watermarksSeeded = false
/** Profile → preview already toasted, so one preview toasts once. */
const lastToastedPreview = new Map()

// ── persisted state ─────────────────────────────────────────────────────────

function loadPrefs() {
  try {
    const store = ctxRef?.storage

    $activityToasts.set(Boolean(store?.get?.(TOASTS_KEY, false)))
    $sections.set(normalizeSections(store?.get?.(SECTIONS_KEY, EMPTY_SECTIONS)))
    sessionColors = normalizeColors(store?.get?.(COLORS_KEY, {}))
    $sessionColors.set(sessionColors)
    sessionOrder = normalizeSessionOrder(store?.get?.(SESSION_ORDER_KEY, {}))
    $sessionOrder.set(sessionOrder)
    sessionSort = normalizeSessionSort(store?.get?.(SESSION_SORT_KEY, {}))
    $sessionSort.set(sessionSort)
    sessionGroups = normalizeSessionGroups(store?.get?.(SESSION_GROUPS_KEY, {}))
    $sessionGroups.set(sessionGroups)
    hiddenSessions = normalizeHidden(store?.get?.(HIDDEN_KEY, {}))
    $hiddenSessions.set(hiddenSessions)
    aproposLinks = normalizeApropos(store?.get?.(APROPOS_KEY, {}))
    $apropos.set(aproposLinks)
    expandedProfiles = normalizeExpanded(store?.get?.(EXPANDED_KEY, {}))
    $expanded.set(expandedProfiles)
  } catch {
    // No storage: prefs hold for this window only, which beats throwing.
  }
}

/** Profile → session ids. Malformed entries fall out, so a hand-edited store
 *  cannot make a profile's whole session list vanish. */
function normalizeSessionOrder(raw) {
  const out = {}

  if (raw && typeof raw === 'object') {
    for (const [profile, list] of Object.entries(raw)) {
      const ids = (Array.isArray(list) ? list : []).map(String).filter(Boolean)

      if (profile && ids.length) {
        out[String(profile)] = ids
      }
    }
  }

  return out
}

/** Profile → sort mode. An unknown mode falls out, so a hand-edited (or older)
 *  store lands on the default instead of on a mode that sorts by nothing. */
function normalizeSessionSort(raw) {
  const out = {}

  if (raw && typeof raw === 'object') {
    for (const [profile, mode] of Object.entries(raw)) {
      if (profile && SESSION_SORT_MODES.includes(mode)) {
        out[String(profile)] = mode
      }
    }
  }

  return out
}

/** A saved session order, applied: the ids the order has never seen come FIRST,
 *  in the recency order the roster handed over; the ids it knows then follow in
 *  their saved sequence.
 *
 *  Fresh-first is not a style choice, it is what keeps a new session VISIBLE.
 *  The inline list stops at `SESSIONS_PER_PROFILE`, so an unpositioned session
 *  parked at the end of a saved order longer than the page is cut off the page
 *  entirely — the profile drew ten old rows and the conversation the user had
 *  open was nowhere in the list, while "View all" (which applies no order at
 *  all) showed it first. Pedro, 2026-10-10: "the session called 'Plan Hermes
 *  Desktop plugin with merged sessions' is not showing up in the main view
 *  (underneath the profile), but it is the first result when I click 'View all'".
 *  Every id the order names still wins; a new arrival just cannot be swallowed
 *  by the tail. */
function applySessionOrder(sessions, order) {
  const list = Array.isArray(sessions) ? sessions : []
  const rank = new Map((Array.isArray(order) ? order : []).map((id, index) => [String(id), index]))

  if (!rank.size) {
    return list
  }

  const known = list.filter(session => rank.has(String(session?.id)))
  const fresh = list.filter(session => !rank.has(String(session?.id)))

  return [
    ...fresh,
    ...known.sort((left, right) => rank.get(String(left.id)) - rank.get(String(right.id)))
  ]
}

/**
 * The session order a drop writes: the list the pane is DISPLAYING — the
 * profile's sessions from `session.list` (`byProfile[profile]`), with any saved
 * order already applied — re-sorted to the slot the insertion bar showed.
 *
 * Reading the roster row instead is the bug this exists to kill. The roster's
 * `profiles.list` payload carries `last_session` / `worker_session` and NO
 * `sessions` array (`tui_gateway/methods_profiles.py`), so `applySessionOrder`
 * was handed `undefined`, returned `[]`, and the write became an empty order —
 * the move did nothing at all while the preview drew perfectly. Pedro,
 * 2026-10-10: "it shows the preview, but it doesn't apply the move".
 */
function nextSessionIds(displayed, order, dragged, onto, side) {
  return placeNames(
    applySessionOrder(displayed, order).map(session => String(session?.id || '')),
    dragged,
    onto,
    side
  )
}

/** Commit a session drag, and remember it. */
function setSessionOrder(profile, ids) {
  sessionOrder = { ...sessionOrder, [String(profile)]: (ids || []).map(String) }
  $sessionOrder.set(sessionOrder)
  persist(SESSION_ORDER_KEY, sessionOrder)
  // A drag IS a choice of order (Pedro's DnD answer 2: "just add a \"manual
  // sorting\" to the list of options"). Without this the dragged order would sit
  // under a list still sorted by recency, and the row would snap back on the
  // next 5s poll.
  setSessionSort(profile, 'manual')
}

/** Remember a profile's session sort mode. */
function setSessionSort(profile, mode) {
  const scope = String(profile || '')

  if (!scope || !SESSION_SORT_MODES.includes(mode)) {
    return
  }

  sessionSort = { ...sessionSort, [scope]: mode }
  $sessionSort.set(sessionSort)
  persist(SESSION_SORT_KEY, sessionSort)
}

/** The mode a profile is ACTUALLY sorted by. Absent mode + a dragged order reads
 *  as `manual`: that is what the saved order means, and it is what the build
 *  before modes did with it — a user who dragged rows yesterday must not open
 *  the pane today to find them re-sorted by recency. */
function sessionSortMode(profile) {
  const stored = sessionSort?.[String(profile)]

  if (SESSION_SORT_MODES.includes(stored)) {
    return stored
  }

  const order = sessionOrder?.[String(profile)]

  return Array.isArray(order) && order.length ? 'manual' : 'activity'
}

/** Order one profile's sessions. Pure. `activity` keeps the order the gateway
 *  handed over — it already sorts by last active, and the compact row carries no
 *  timestamp for it, so re-sorting here would be guesswork. Every other mode is
 *  a TOTAL order (id as the tiebreak): a sort that reshuffles equal rows on each
 *  poll reads as activity that never happened. */
function sortProfileSessions(sessions, mode, order) {
  const list = Array.isArray(sessions) ? [...sessions] : []
  const title = session => sessionLabel(session) || String(session?.id || '')
  const byTitle = (a, b) => title(a).localeCompare(title(b)) || String(a?.id || '').localeCompare(String(b?.id || ''))

  if (mode === 'manual') {
    return applySessionOrder(list, order)
  }

  if (mode === 'name') {
    return list.sort(byTitle)
  }

  if (mode === 'messages') {
    const count = session => Number(session?.message_count ?? session?.messages ?? 0) || 0

    return list.sort((a, b) => count(b) - count(a) || byTitle(a, b))
  }

  return list
}

/** Both sides of an Apropos link in ONE list. Pedro, 2026-10-10: "don't hide or
 *  make the parent session go away from the list, they should both be shown".
 *
 *  Core decides the visibility — a seeded child is only listable while its row
 *  carries `model_config._branched_from` (`_LISTABLE_CHILD_SQL`,
 *  hermes_state_common.py), and a compacted chain collapses to its root — so the
 *  pane does not ask core twice. It knows every child IT created, so the parent
 *  keeps the position the list gave it and each child is attached directly under
 *  it. A child core already lists is skipped, never drawn twice. */
function withAproposChildren(sessions, links, profile) {
  const list = Array.isArray(sessions) ? sessions : []
  const slice = links?.[String(profile || '')] || {}
  // Every id any row in the page answers to — NOT the raw ids. The child is
  // listed as its current lineage TIP, so a store keyed by the id it was created
  // under would synthesize a SECOND row for a chat that is right there.
  const present = rowIdSet(list)
  const out = []

  for (const session of list) {
    out.push(session)
    const ids = rowIdentities(session)
    const parent = String(session?.id || '')

    if (!parent) {
      continue
    }

    for (const [childId, entry] of Object.entries(slice)) {
      if (!entry?.parent || present.has(childId) || !ids.has(String(entry.parent))) {
        continue
      }

      present.add(childId)
      out.push({
        id: childId,
        message_count: 0,
        preview: '',
        resolved_id: childId,
        title: `Apropos: ${String(entry?.label || parent)}`,
        ...(entry?.at ? { last_active: Math.floor(Number(entry.at) / 1000) } : {})
      })
    }
  }

  return out
}

// ── session groups (inside one profile) ─────────────────────────────────────
//
// Pedro, 2026-10-09: "allow manual session grouping from within a profile, so
// the user can group different sessions that are about the same topic/project."
// So: sessions stay one list per profile, but the user can file them under a
// named heading. Shape — { [profile]: { collapsed:[id], groups:[{id,name}],
// members:{ [storedId]: id }, order:[id] } }. Ungrouped is the ABSENCE of a
// membership, never a sentinel id, which is why deleting a group drops its
// sessions back into the flat list instead of taking them with it.

const SESSION_GROUPS_KEY = 'messenger-session-groups-v1'
/** Sessions the user hid FROM THIS PANE. Pedro, 2026-10-10: "Allow hiding, but
 *  hiding only hides it from view in the Messenger tab, not from Sessions."
 *  So this is a pane-local view filter and nothing else: no RPC, no archive, no
 *  write to core state. The Sessions tab (and every other picker) keeps showing
 *  the session, and the filter is reversible from the row menu. Shape —
 *  { [profile]: [storedId, ...] }. */
const HIDDEN_KEY = 'messenger-hidden-v1'

let hiddenSessions = {}
const $hiddenSessions = atom({})

function normalizeHidden(raw) {
  const out = {}

  if (raw && typeof raw === 'object') {
    for (const [profile, list] of Object.entries(raw)) {
      const ids = (Array.isArray(list) ? list : []).map(String).filter(Boolean)

      if (profile && ids.length) {
        out[String(profile)] = [...new Set(ids)]
      }
    }
  }

  return out
}

function hiddenFor(profile) {
  return hiddenSessions[String(profile)] || []
}

/** Bring every hidden session of one profile back. Hiding is one click, so
 *  unhiding everything has to be cheaper than unhiding them one by one. */
function unhideAll(profile) {
  const key = String(profile)
  const state = { ...hiddenSessions }

  delete state[key]
  hiddenSessions = state
  $hiddenSessions.set(state)
  persist(HIDDEN_KEY, state)
}

function setSessionHidden(profile, storedId, hidden) {
  const key = String(profile)
  const id = String(storedId)
  const current = hiddenFor(key)
  const next = hidden ? [...new Set([...current, id])] : current.filter(entry => entry !== id)
  const state = { ...hiddenSessions }

  if (next.length) {
    state[key] = next
  } else {
    delete state[key]
  }

  hiddenSessions = state
  $hiddenSessions.set(state)
  persist(HIDDEN_KEY, state)
}

let sessionGroups = {}
const $sessionGroups = atom({})

/** Profile → session groups. Malformed groups fall out, and a membership
 *  pointing at a group that no longer exists reads as ungrouped rather than
 *  resurrecting a dead heading. */
function normalizeSessionGroups(raw) {
  const out = {}

  if (!raw || typeof raw !== 'object') {
    return out
  }

  for (const [profile, value] of Object.entries(raw)) {
    if (!profile || !value || typeof value !== 'object') {
      continue
    }

    const groups = []
    const seen = new Set()

    for (const entry of Array.isArray(value.groups) ? value.groups : []) {
      const id = String(entry?.id || '').trim()
      const name = String(entry?.name || '').trim()

      if (!id || !name || seen.has(id)) {
        continue
      }

      seen.add(id)
      // A group's color is user data that ends up inside a CSS color function
      // (`profileColorSoft` → `color-mix(in srgb, <color> 22%, transparent)`), so
      // it is validated against the app's own palette on the way IN AND OUT of
      // storage: anything outside it is dropped, never handed to the stylesheet.
      const color = PROFILE_SWATCHES.includes(String(entry?.color || '')) ? String(entry.color) : null

      groups.push({ apropos: entry?.apropos === true, id, name, color })
    }

    const members = {}

    if (value.members && typeof value.members === 'object') {
      for (const [session, groupId] of Object.entries(value.members)) {
        if (seen.has(String(groupId))) {
          members[String(session)] = String(groupId)
        }
      }
    }

    const order = (Array.isArray(value.order) ? value.order : [])
      .map(String)
      .filter(id => seen.has(id))
      .filter((id, index, list) => list.indexOf(id) === index)

    for (const group of groups) {
      if (!order.includes(group.id)) {
        order.push(group.id)
      }
    }

    const collapsed = (Array.isArray(value.collapsed) ? value.collapsed : [])
      .map(String)
      .filter(id => seen.has(id))

    out[String(profile)] = { collapsed, groups, members, order }
  }

  return out
}

/** One profile's slice, always a full shape — every reader gets arrays. */
function profileSessionGroups(state, profile) {
  const value = state?.[String(profile)]

  return {
    collapsed: value?.collapsed || [],
    groups: value?.groups || [],
    members: value?.members || {},
    order: value?.order || []
  }
}

/** Sessions the pane just took OUT of a group: dragged out, unfiled from the
 *  menu, or freed by deleting the group. "Removed from the group" is only half
 *  an answer — the other half is that the session is now in the SINGLE list,
 *  where the user is looking. The page widens to keep them (see
 *  wantedSessionIds) and the flat list draws them past its inline cap (see
 *  sessionGroupBlocks), so an old session released from a group cannot fall
 *  below the fold and read as deleted. Window-lifetime only, nothing persisted:
 *  a reload is a fresh list. Pedro, 2026-10-10: "When deleting a group, apropos
 *  or not, sessions inside should not be deleted, just removed from the group."
 */
const RELEASED_MAX = 50
let releasedSessions = {}
const $released = atom({})

function releasedFor(profile) {
  return releasedSessions[String(profile)] || []
}

function noteReleased(profile, ids) {
  const key = String(profile || '')
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean)

  if (!key || !list.length) {
    return
  }

  const state = { ...releasedSessions }
  const next = [...new Set([...releasedFor(key), ...list])].slice(-RELEASED_MAX)

  if (next.length) {
    state[key] = next
  } else {
    delete state[key]
  }

  releasedSessions = state
  $released.set(state)
}

/** The expanded list, grouped: each group in its own order holding its sessions
 *  in the order they were handed over (recency, or the user's own session
 *  drag), then everything unfiled in one anonymous block. With no groups at all
 *  this is one anonymous block — exactly the flat list it has always been, so
 *  a profile nobody has filed anything into renders identically to before. */
function sessionGroupBlocks(sessions, state, profile, released) {
  const slice = profileSessionGroups(state, profile)
  const list = Array.isArray(sessions) ? sessions : []
  const blocks = []

  for (const id of slice.order) {
    const group = slice.groups.find(entry => entry.id === id)

    if (!group) {
      continue
    }

    blocks.push({
      // The mark travels with the block: the heading draws the diamond from it.
      apropos: group.apropos === true,
      collapsed: slice.collapsed.includes(group.id),
      color: group.color || null,
      id: group.id,
      name: group.name,
      sessions: list.filter(session => memberGroupFor(slice.members, session) === group.id)
    })
  }

  // The INLINE cap applies to the plain list only, and to the plain list only:
  // the page is fetched wider than the view (see nextSessionLimit) so that a
  // group's OLDER members still resolve, and a group box therefore draws every
  // member it has. Uncapped, the flat list would grow past the "View all" line
  // it has always been built around.
  // …plus anything the pane just RELEASED from a group: a session the user
  // took out of a group has to be visible in the single list it went back to,
  // even when its last activity is older than the cap. Page order is kept, so
  // the freed rows sit where they belong rather than jumping to the top.
  const pinned = new Set((Array.isArray(released) ? released : []).map(String))
  // Membership AND the released pin answer to a row's whole lineage: the id a
  // session had when it was filed (or released) need not be the id it has now.
  const plain = list.filter(session => !memberGroupFor(slice.members, session))
  const rest = plain.filter(
    (session, index) => index < SESSIONS_PER_PROFILE || Boolean(storedKeyFor(pinned, session))
  )

  if (rest.length || !blocks.length) {
    blocks.push({ collapsed: false, id: null, name: '', sessions: rest })
  }

  return blocks
}

/** A group renders as ONE outlined box — heading and items inside the same thin
 *  line, which is what makes it read as a unit instead of a run of rows. The
 *  anonymous block (no group) stays exactly the flat list it has always been.
 *  Pedro, 2026-10-10: "add a thin outer line around the group, that includes the
 *  header, to serve as a separator ... color code the group ... that changes the
 *  background fill of the items".
 *
 *  The outline is 1px of `--ui-stroke-secondary` (the app's own hairline) and
 *  takes the group's color when it has one; the fill is the box itself, so the
 *  header and the items share it. The inner wrapper survives only for the row
 *  rhythm (gap-0.5) — it deliberately carries no background, so the rows keep
 *  their own hover background composited over the group's tint. */
function sessionGroupShell(block, parts, dragging, profileFill) {
  // The tier order signed off 2026-10-10: a group's OWN colour wins, a group
  // with none inherits the profile's fill ("agree on 4"), and a profile with no
  // pick stays on the theme neutral. The tint is ALWAYS 22% over whatever is
  // behind — nothing here paints a parent, so the tiers never blend.
  const fill = block.color || profileFill || null

  if (!block.id) {
    // The anonymous block IS the profile's flat list, so this is where a picked
    // profile colour fills its session rows (and only there — a group box keeps
    // its own colour, which is the override the user asked for). Same rule as a
    // group: the paint goes on the BOX, because an inline background on a ROW
    // would beat its `hover:bg-*` and kill the hover. No outline: this is not a
    // group and the user asked for a fill, not a second border.
    //
    // `parts` is [heading, rows] with the falsey slots FILTERED OUT at the call
    // site, and this block has no heading — so it arrives as [rows]. Hence the
    // last slot, which is the rows in every shape and never the heading.
    const members = parts.length ? parts[parts.length - 1] : null

    return fill
      ? [
          jsx(
            'div',
            {
              'data-profile-fill': '',
              className: 'my-0.5 flex min-w-0 flex-col gap-0.5 rounded-md',
              style: { background: profileColorSoft(fill, 22) },
              children: members ?? null
            },
            'profile-fill'
          )
        ]
      : parts
  }

  const items = parts[1]

  return [
    jsxs(
      'div',
      {
        'data-session-group-box': block.id,
        // The group as a DROP TARGET for other groups (see elementAt):
        // `sessionGroupShell` is the only place that knows the box, so the
        // attribute lives here and the heading keeps its own.
        'data-drop-group-box': block.id,
        className: cn(
          'my-0.5 flex min-w-0 flex-col rounded-md border border-(--ui-stroke-secondary) p-0.5',
          dragging && 'opacity-60'
        ),
        // The FILL is the whole box: header included, which is what Pedro asked
        // for on 2026-10-10 ("fill the header as well"). Painting the box also
        // keeps the rows' own `hover:bg-*` working — an inline background on the
        // ROWS would beat that class, and a class on the box cannot.
        style: fill
          ? {
              background: profileColorSoft(fill, 22),
              // The outline follows the GROUP's own colour only: an inherited
              // profile tint fills the box without turning a group's hairline
              // into a third colour.
              borderColor: block.color || undefined
            }
          : undefined,
        children: [
          parts[0],
          items && items.length
            ? jsx(
                'div',
                {
                  'data-session-group-fill': block.id,
                  // Indented from the heading: the caret owns the far left of a
                  // group, so the items start to the RIGHT of it and the column
                  // tells the user where the group's rows stop and the flat
                  // list resumes. Pedro, 2026-10-10: "make the group sessions
                  // slightly offset to the right, so it's easier to discern
                  // where the group ends".
                  className: 'flex min-w-0 flex-col gap-0.5 rounded-sm pl-3',
                  children: items
                },
                'fill'
              )
            : null
        ]
      },
      `box-${block.id}`
    )
  ]
}

function writeSessionGroups(next) {
  sessionGroups = next
  $sessionGroups.set(next)
  persist(SESSION_GROUPS_KEY, next)
}

/** Replace ONE profile's slice, leaving every other profile alone. */
function patchProfileGroups(profile, changes) {
  const key = String(profile)
  const merged = { ...profileSessionGroups(sessionGroups, key), ...changes }

  writeSessionGroups({ ...sessionGroups, [key]: normalizeSessionGroups({ [key]: merged })[key] })
}

/** `Group #1`, `Apropos #2`, … — numbered past the highest name of its own
 *  shape, so deleting #2 and making another does not mint a second "Group #2".
 *  Pedro, 2026-10-10: "when the user selects 'New Group' or new Apropos Group,
 *  immediately create the group, with Group #1 or Apropos #1. The user will then
 *  rename it accordingly. Don't give them a text box to fill in before the group
 *  is created." */
function numberedName(names, prefix) {
  const used = (names || [])
    .map(name => String(name || ''))
    .filter(name => name.startsWith(prefix))
    .map(name => Number(name.slice(prefix.length)))
    .filter(value => Number.isFinite(value))

  return `${prefix}${used.length ? Math.max(...used) + 1 : 1}`
}

function nextGroupName(profile, apropos) {
  return numberedName(
    profileSessionGroups(sessionGroups, profile).groups.map(group => group.name),
    apropos ? 'Apropos #' : 'Group #'
  )
}

/** The same rule for a profile SECTION (the toolbar's folder+). Its button says
 *  "New group" already, so an immediate `Group #1` is what the user sees. */
function nextSectionName() {
  return numberedName(($sections.get().sections || []).map(section => section.name), 'Group #')
}

/** Make the group FIRST, name it second: the field that follows is a RENAME —
 *  it opens on a group that already exists, so a lost keystroke can no longer
 *  lose the group. Returns `{id, name}`. */
function createGroupNow(profile, sessionIds, options) {
  const apropos = options?.apropos === true
  const name = options?.name || nextGroupName(profile, apropos)
  const id = createSessionGroup(profile, name, sessionIds, { apropos })

  return id ? { id, name } : null
}

/** Make a group and file these sessions into it. Returns its id ('' if the name
 *  was blank — callers use that to keep the naming field open). */
function createSessionGroup(profile, name, sessionIds, options) {
  const clean = String(name || '').trim()

  if (!clean) {
    return ''
  }

  const key = String(profile)
  const current = profileSessionGroups(sessionGroups, key)
  const id = `sg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const members = { ...current.members }

  for (const sessionId of sessionIds || []) {
    members[String(sessionId)] = id
  }

  // `apropos` is a MARK, not a second kind of group: an Apropos group IS a
  // normal session group (same box, same color, same drag, same filing) that
  // also carries a generated child, and the mark is what draws the diamond and
  // what the heading's Apropos verb is offered on. Pedro, 2026-10-10.
  patchProfileGroups(key, {
    groups: [...current.groups, { apropos: options?.apropos === true, id, name: clean }],
    members,
    order: [...current.order, id]
  })

  return id
}

function renameSessionGroup(profile, id, name) {
  const clean = String(name || '').trim()

  if (!clean) {
    return
  }

  const current = profileSessionGroups(sessionGroups, profile)

  patchProfileGroups(profile, {
    groups: current.groups.map(group => (group.id === id ? { ...group, name: clean } : group))
  })
}

/** Color-code a group. The palette is the app's own, and a value outside it
 *  CLEARS the color instead of reaching the stylesheet: this string is
 *  interpolated into `color-mix()`, and a plugin may not become a CSS-injection
 *  hole for its own store. Pedro, 2026-10-10: right-click the header, pick a
 *  color, and it fills that group's items. */
function setSessionGroupColor(profile, id, color) {
  const current = profileSessionGroups(sessionGroups, profile)
  const clean = PROFILE_SWATCHES.includes(String(color || '')) ? String(color) : null

  patchProfileGroups(profile, {
    groups: current.groups.map(group => (group.id === id ? { ...group, color: clean } : group))
  })
}

/** Flag a group as an Apropos group. ONE flag, and everything the user sees
 *  follows from it: the ◆ on the heading, the ◆ on every member row (a member
 *  IS a source — see SessionRow's mark) and the "New child session" label.
 *  That is why a group becomes one the moment a child is started from it:
 *  without this, "Apropos this group" produced a child while the group's own
 *  sessions stayed plain rows with no diamond and no part in the digest.
 *  Pedro, 2026-10-10: "When I click Apropos this group, the existing sessions
 *  don't get the diamond icon along with their functionality." */
function markSessionGroupApropos(profile, id) {
  const current = profileSessionGroups(sessionGroups, profile)
  const group = current.groups.find(entry => entry.id === id)

  if (!group || group.apropos === true) {
    return false
  }

  patchProfileGroups(profile, {
    groups: current.groups.map(entry => (entry.id === id ? { ...entry, apropos: true } : entry))
  })

  return true
}

/** Delete a heading, never a session: its members fall back to ungrouped. */
function deleteSessionGroup(profile, id) {
  const current = profileSessionGroups(sessionGroups, profile)
  const members = { ...current.members }
  const freed = []

  for (const [sessionId, groupId] of Object.entries(members)) {
    if (groupId === id) {
      delete members[sessionId]
      freed.push(sessionId)
    }
  }

  patchProfileGroups(profile, {
    collapsed: current.collapsed.filter(entry => entry !== id),
    groups: current.groups.filter(group => group.id !== id),
    members,
    order: current.order.filter(entry => entry !== id)
  })
  // Never a delete — and never a disappearance either: the sessions fall back
  // into the single list and the pane keeps them in view (see noteReleased).
  noteReleased(profile, freed)
}

/** File sessions in, or out with a null group. An unknown group id means out —
 *  and filing something in un-collapses the destination, so the session the
 *  user just moved is where the user can see it. */
/** The payload of a session's "Move to group" click. The ROW supplies its own
 *  session id, so the handler never has to guess which session was clicked.
 *  It used to pass the group id ALONE, which landed in the session slot while
 *  `groupId` arrived undefined — the menu looked live and filed nothing at all.
 *  Pedro, 2026-10-10: "moving sessions to groups isn't working". */
function sessionMoveTarget(storedId, groupId) {
  return { groupId: groupId == null ? null : String(groupId), sessionId: String(storedId) }
}

/** Which sessions a "Move to group" click moves: the clicked one, or the whole
 *  ticked batch when the clicked session is part of one — filing ten sessions
 *  one at a time is the chore select mode exists to delete. */
function sessionGroupMoveTargets({ profile, selectedKeys, sessionId }) {
  const key = sessionKey(profile, sessionId)

  if (!(selectedKeys || []).includes(key)) {
    return [String(sessionId)]
  }

  return selectedKeys
    .map(String)
    .map(entry => entry.split('|'))
    .filter(parts => parts[0] === String(profile))
    .map(parts => parts[1])
}

function moveSessionsToGroup(profile, sessionIds, groupId) {
  const current = profileSessionGroups(sessionGroups, profile)
  const members = { ...current.members }
  const known = groupId && current.groups.some(group => group.id === groupId) ? String(groupId) : null
  const freed = []

  for (const sessionId of sessionIds || []) {
    const key = String(sessionId)

    if (known) {
      members[key] = known
    } else {
      if (members[key]) {
        freed.push(key)
      }

      delete members[key]
    }
  }

  patchProfileGroups(profile, {
    collapsed: current.collapsed.filter(id => id !== known),
    members
  })
  // Only a REAL release, and only from a group: filing one in is not news, and
  // a session that was already ungrouped has not gone anywhere.
  noteReleased(profile, freed)
}

function toggleSessionGroupCollapsed(profile, id) {
  const current = profileSessionGroups(sessionGroups, profile)

  patchProfileGroups(profile, {
    collapsed: current.collapsed.includes(id)
      ? current.collapsed.filter(entry => entry !== id)
      : [...current.collapsed, id]
  })
}

/** Move a group one slot up or down. The dragging path and this one write the
 *  SAME `order` array, so the menu and the gesture cannot disagree — and the
 *  menu is the verb that cannot be a silent no-op when there is nothing to drop
 *  onto. Pedro, 2026-10-10: "I can't move/re-locate session groups." */
function moveSessionGroup(profile, id, delta) {
  const current = profileSessionGroups(sessionGroups, profile)
  const index = current.order.indexOf(String(id))
  const target = index + Number(delta || 0)

  if (index < 0 || target < 0 || target >= current.order.length) {
    return false
  }

  const order = [...current.order]
  const [moved] = order.splice(index, 1)

  order.splice(target, 0, moved)
  patchProfileGroups(profile, { order })

  return true
}

/** Drag one heading onto another: the order array IS the group order. */
function reorderSessionGroups(profile, id, onto) {
  const current = profileSessionGroups(sessionGroups, profile)

  patchProfileGroups(profile, { order: reorderNames(current.order, id, onto) })
}

function persist(key, value) {
  try {
    Promise.resolve(ctxRef?.storage?.set?.(key, value)).catch(() => undefined)
  } catch {
    /* storage unavailable — the value lives for this window */
  }
}

/** Order one scope's rows. Pure, so the harness can pin the rules without a
 *  DOM. `manual` follows the stored order array and parks unknown names at the
 *  end; every other mode is a TOTAL order with the profile name as the
 *  tiebreak, because a sort that reshuffles equal rows on each poll would read
 *  as activity that never happened. */
function sortRows(rows, mode, order) {
  const byName = (a, b) => a.name.localeCompare(b.name)
  const list = [...(rows || [])]

  if (mode === 'manual' && Array.isArray(order) && order.length) {
    const rank = new Map(order.map((name, index) => [String(name), index]))

    return list.sort((a, b) => {
      const left = rank.has(a.name) ? rank.get(a.name) : Number.MAX_SAFE_INTEGER
      const right = rank.has(b.name) ? rank.get(b.name) : Number.MAX_SAFE_INTEGER

      return left === right ? byName(a, b) : left - right
    })
  }

  if (mode === 'name') {
    return list.sort(byName)
  }

  if (mode === 'sessions') {
    return list.sort((a, b) => sessionCount(b) - sessionCount(a) || byName(a, b))
  }

  // Default: last activity, newest first. A profile that never moved sinks.
  return list.sort((a, b) => (b.lastActiveMs || 0) - (a.lastActiveMs || 0) || byName(a, b))
}

/** How many sessions a profile row carries. `sessions` is the roster's own list
 *  (capped), `messages` the fallback the gateway always fills. */
function sessionCount(row) {
  return Array.isArray(row?.sessions) ? row.sessions.length : Number(row?.messages || 0)
}

function normalizeSections(raw) {
  const value = raw && typeof raw === 'object' ? raw : EMPTY_SECTIONS
  const seen = new Set()
  const sections = []

  for (const entry of Array.isArray(value.sections) ? value.sections : []) {
    const id = String(entry?.id || '').trim()
    const name = String(entry?.name || '').trim()

    if (!id || !name || seen.has(id)) {
      continue
    }

    seen.add(id)
    sections.push({ id, name })
  }

  const members = {}

  if (value.members && typeof value.members === 'object') {
    for (const [profile, sectionId] of Object.entries(value.members)) {
      // A member of a section that no longer exists is an orphan: it falls
      // back to Unassigned rather than resurrecting a deleted group.
      if (seen.has(String(sectionId))) {
        members[String(profile)] = String(sectionId)
      }
    }
  }

  const collapsed = (Array.isArray(value.collapsed) ? value.collapsed : [])
    .map(String)
    .filter(id => id === UNASSIGNED || seen.has(id))

  // Manual orders: `{scope: [profile…]}`. Names that are not on the roster are
  // dropped, so a deleted profile cannot hold a slot forever, and an unknown
  // scope is dropped with them.
  const order = {}

  if (value.order && typeof value.order === 'object') {
    for (const [scope, list] of Object.entries(value.order)) {
      const key = String(scope)

      if (key !== UNASSIGNED && key !== 'all' && !seen.has(key)) {
        continue
      }

      const names = (Array.isArray(list) ? list : []).map(String).filter(Boolean)

      if (names.length) {
        order[key] = names
      }
    }
  }

  // Sort modes, per scope. An unknown mode is DROPPED rather than trusted: a
  // stale value must fall back to the default, never to a mode that does nothing.
  const sort = {}

  if (value.sort && typeof value.sort === 'object') {
    for (const [scope, mode] of Object.entries(value.sort)) {
      const key = String(scope)

      if ((key === UNASSIGNED || key === 'all' || seen.has(key)) && SORT_MODES.includes(mode)) {
        sort[key] = mode
      }
    }
  }

  return { collapsed, members, order, sections, sort }
}

function setSort(scopeId, mode) {
  if (!SORT_MODES.includes(mode)) {
    return
  }

  const current = $sections.get()

  setSections({ ...current, sort: { ...current.sort, [scopeId]: mode } })
}

/** The grip's commit: write the order the user just made, and switch the scope to
 *  Manual if it was sorted by something else — a drop that silently re-sorted
 *  itself would look like the drag failed. Undo is the scope's own
 *  "Reset to last activity" item. */
function setOrder(scopeId, names) {
  const current = $sections.get()

  setSections({
    ...current,
    order: { ...current.order, [scopeId]: (names || []).map(String) },
    sort: { ...current.sort, [scopeId]: 'manual' }
  })
}

/**
 * Move one name to the slot an insertion bar is pointing at: immediately
 * `before` or `after` the target. The live preview and the commit both come
 * through here, so what the bar shows is what the drop does — they cannot
 * disagree, which is the whole point of drawing the bar at all.
 *
 * No `side` (a kebab's Move up/down, or any caller with no pointer) keeps the
 * pointer's own rule: DOWN lands after the target, UP lands before it, so the
 * row under the cursor never slides out from under the pointer between the drop
 * and the re-render.
 */
function placeNames(names, dragged, target, side) {
  const list = (names || []).map(String)
  const from = list.indexOf(String(dragged))
  const to = list.indexOf(String(target))

  if (from < 0 || to < 0 || from === to) {
    return list
  }

  const next = [...list]
  const [moved] = next.splice(from, 1)
  const anchor = next.indexOf(String(target))
  const at = side ? (side === 'before' ? anchor : anchor + 1) : Math.min(to, next.length)

  next.splice(Math.max(0, at), 0, moved)

  return next
}

/** The legacy rule as a call: land in the target's slot. */
function reorderNames(names, dragged, target) {
  return placeNames(names, dragged, target, '')
}

/** A group dropped onto another group: the `sections` array IS the order, so
 *  this is the same splice the Move up/down items make, from the pointer. */
function reorderSections(id, onto) {
  const current = $sections.get()
  const ids = current.sections.map(section => section.id)
  const next = reorderNames(ids, id, onto)

  if (next.join(',') === ids.join(',')) {
    return
  }

  setSections({
    ...current,
    sections: next.map(key => current.sections.find(section => section.id === key)).filter(Boolean)
  })
}

/** What a drop MEANS, as a value. Pure on purpose: the pointer plumbing is the
 *  only part of dragging that needs a DOM, and all it does is hand this
 *  function two small objects — so the decisions stay testable. */
function dropAction(drag, target) {
  if (!drag || !target) {
    return null
  }

  if (drag.kind === 'group') {
    return target.group && target.group !== drag.id
      ? { id: drag.id, kind: 'section', onto: target.group }
      : null
  }

  if (drag.kind === 'profile') {
    // The DESTINATION is the scope the pointer is over, and there are three ways
    // to be over one: a group's heading, any row inside that group (a row knows
    // the scope it lives in), and the unassigned block — which is the way OUT of
    // a group. Reading only the heading meant dropping a profile onto a member
    // row did nothing but re-order it, so a profile could be dragged neither into
    // a group nor out of one. Pedro, 2026-10-10: "I'm having issues dragging
    // profiles in and out of groups".
    const dest = String(target.group || target.scope || '')
    const here = String(drag.section || '')
    // 'all' is the anonymous block the list falls back to when NO groups exist:
    // it is not a destination, it is the absence of the whole feature. An
    // unreadable scope falls back to the dragged row's own, so a re-order inside
    // one list still re-orders.
    const real = Boolean(dest) && dest !== 'all'

    if (real && dest !== here) {
      return { kind: 'file', name: drag.name, section: dest }
    }

    return target.profile && target.profile !== drag.name
      ? {
          kind: 'order',
          name: drag.name,
          onto: target.profile,
          scope: real ? dest : String(target.scope || drag.scope || ''),
          side: target.profileSide || ''
        }
      : null
  }

  if (drag.kind === 'sessionGroup') {
    // Either half of the target group counts: its heading strip or its box.
    const onto = target.sessionGroup || target.groupBox

    return onto && onto !== drag.group
      ? { id: drag.group, kind: 'sessionGroupOrder', onto, profile: drag.profile }
      : null
  }

  if (drag.kind === 'session') {
    // The group the pointer is over — its heading strip OR its box, because the
    // thing the user sees is the BOX and its body is nearly all of it. Filing
    // read only `sessionGroup` (the 20px heading), so a session dropped on the
    // group "did nothing". Pedro, 2026-10-10: "When dragging a session into a
    // group or an Apropos Group, nothing happens. If it goes inside a group, it
    // should go inside the group".
    //
    // A drop onto a session row of the SAME block is still a re-order: you
    // cannot re-order inside a group otherwise, since every one of its rows
    // reports the same box. Across blocks, the group wins — dropping onto a
    // member of another group means "join that group", not "sort".
    const onto = target.sessionGroup || target.groupBox
    const here = drag.group || ''

    if (onto && onto !== here) {
      return { group: onto, ids: [drag.id], kind: 'sessionFile', profile: drag.profile }
    }

    // Off the group entirely: a grouped session dropped on the plain list LEAVES
    // its group. The anonymous block is the absence of a group — there is no box
    // attribute to read — so the ROW it lands on is what says "not in a group".
    // Pedro, 2026-10-10: "moving a session out of a group should remove them from
    // the group and into the single sessions list."
    if (!onto && here && target.session && target.profile === drag.profile) {
      return { group: null, ids: [drag.id], kind: 'sessionFile', profile: drag.profile }
    }

    return target.session && target.session !== drag.id && target.profile === drag.profile
      ? {
          id: drag.id,
          kind: 'sessionOrder',
          onto: target.session,
          profile: drag.profile,
          side: target.sessionSide || ''
        }
      : null
  }

  return null
}

/** The single DOM read in this feature: which drop target is under the pointer.
 *  Guarded, because the harness renders the pane with no document at all. */
function elementAt(x, y) {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return null
  }

  const node = document.elementFromPoint(x, y)
  const read = (selector, attribute) => {
    const hit = node?.closest?.(selector)

    return hit ? String(hit.getAttribute(attribute) || '') : ''
  }
  const profileHit = node?.closest?.('[data-drop-profile]') || null
  /** The row the pointer is over — or, when it is over a grip, a gutter or a
   *  status dot BETWEEN rows, the row it is nearest to inside the same list.
   *  Without that fallback the only target a session drag could find was the
   *  PROFILE container, so `dropAction` answered null and the gesture ended in
   *  nothing: the row could be picked up and never put down, while the profile
   *  row lit up under the pointer. Pedro, 2026-10-10: "I can move profiles, but
   *  not sessions." A grabbed grip is exactly where the pointer is. */
  const rowFor = selector => {
    const direct = node?.closest?.(selector)

    if (direct || !profileHit || typeof profileHit.querySelectorAll !== 'function') {
      return direct || null
    }

    return (
      [...profileHit.querySelectorAll(selector)]
        .map(element => ({ element, rect: element.getBoundingClientRect() }))
        .filter(entry => entry.rect.height > 0)
        .sort(
          (left, right) =>
            Math.abs(left.rect.top + left.rect.height / 2 - y) -
            Math.abs(right.rect.top + right.rect.height / 2 - y)
        )[0]?.element || null
    )
  }
  /** Which half of the row the pointer is in. The bar drawn on that edge IS
   *  where the row lands (placeNames takes the same value). */
  const sideOf = element => {
    const rect = element?.getBoundingClientRect?.()

    return rect && rect.height > 0 ? (y < rect.top + rect.height / 2 ? 'before' : 'after') : ''
  }
  const sessionRow = rowFor('[data-session-row]')

  return {
    group: read('[data-drop-group]', 'data-drop-group'),
    profile: profileHit ? String(profileHit.getAttribute('data-drop-profile') || '') : '',
    scope: read('[data-drop-scope]', 'data-drop-scope'),
    session: sessionRow ? String(sessionRow.getAttribute('data-drop-session') || '') : '',
    // The group's whole BOX, not just its heading strip. A heading is a
    // 20px line; the group the user sees is the box around it, so a group could
    // be grabbed and then have nowhere to land — the drop resolved to no group,
    // `dropAction` answered null and the gesture ended in nothing. Only the
    // sessionGroup branch reads this attribute, so filing and re-ordering
    // SESSIONS keep the resolution they had.
    // Pedro, 2026-10-10: "I can't move/re-locate session groups."
    groupBox: read('[data-drop-group-box]', 'data-drop-group-box'),
    sessionGroup: read('[data-drop-session-group]', 'data-drop-session-group'),
    sessionSide: sideOf(sessionRow),
    profileSide: sideOf(rowFor('[data-profile-row]'))
  }
}

/** Move a group up or down. The order of `sections` IS the group order. */
function moveSection(id, delta) {
  const current = $sections.get()
  const index = current.sections.findIndex(section => section.id === id)
  const target = index + delta

  if (index < 0 || target < 0 || target >= current.sections.length) {
    return
  }

  const sections = [...current.sections]
  const [moved] = sections.splice(index, 1)

  sections.splice(target, 0, moved)
  setSections({ ...current, sections })
}

function setSections(next) {
  $sections.set(next)
  persist(SECTIONS_KEY, next)
}

function createSection(name) {
  const clean = String(name || '').trim()

  if (!clean) {
    return null
  }

  const id = `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const current = $sections.get()

  setSections({ ...current, sections: [...current.sections, { id, name: clean }] })

  return id
}

function renameSection(id, name) {
  const clean = String(name || '').trim()

  if (!clean) {
    return
  }

  const current = $sections.get()

  setSections({
    ...current,
    sections: current.sections.map(section => (section.id === id ? { ...section, name: clean } : section))
  })
}

function deleteSection(id) {
  const current = $sections.get()
  const members = { ...current.members }

  for (const [profile, sectionId] of Object.entries(members)) {
    if (sectionId === id) {
      delete members[profile]
    }
  }

  setSections({
    collapsed: current.collapsed.filter(key => key !== id),
    members,
    sections: current.sections.filter(section => section.id !== id)
  })
}

function moveToSection(profiles, sectionId) {
  const current = $sections.get()
  const members = { ...current.members }

  for (const profile of profiles) {
    if (sectionId === UNASSIGNED) {
      delete members[profile]
    } else {
      members[profile] = sectionId
    }
  }

  setSections({ ...current, members })
}

function toggleCollapsed(id) {
  const current = $sections.get()

  setSections({
    ...current,
    collapsed: current.collapsed.includes(id)
      ? current.collapsed.filter(key => key !== id)
      : [...current.collapsed, id]
  })
}

function toggleToasts() {
  const next = !$activityToasts.get()

  $activityToasts.set(next)
  persist(TOASTS_KEY, next)
}

// ── data layer ──────────────────────────────────────────────────────────────

/** `last_active` arrives in unix SECONDS (see hermes-bots/types.ts). */
function secondsToMs(value) {
  const n = Number(value)

  return Number.isFinite(n) && n > 0 ? n * 1000 : null
}

function metaOf(profile) {
  const raw = profile?.ui_meta?.[META_KEY]

  return raw && typeof raw === 'object' ? raw : {}
}

/** The 'hermes-bots' slice of a profile's ui_meta — the SAME document the Bots
 *  pane writes. The pane EDITS it too now (see EditProfileDialog), which is what
 *  makes a name/colour change in either pane show up in the other. */
function botsMetaOf(profile) {
  const raw = profile?.ui_meta?.[BOTS_META_KEY]

  return raw && typeof raw === 'object' ? raw : {}
}

/** The colour the user PICKED for a profile — the same `hermes-bots.color` the
 *  Bots editor writes, so a pick in either pane is the other's pick.
 *
 *  Opt-in by construction, and that is the whole reason this is a helper: a
 *  profile with no pick must stay on the theme's neutral. `profileColor(name)`
 *  invents a hue from the name for EVERY named profile, so filling from that
 *  would turn the rail into per-profile confetti. Pedro, 2026-10-10: "yes, fill
 *  is opt-in". Accepts a roster profile or one of the pane's own rows. Pure. */
function fillOf(source) {
  const raw = source?.botsMeta?.color ?? botsMetaOf(source).color

  return String(raw || '').trim() || null
}

/** A profile's visible name, resolved in the SAME order the Bots pane resolves
 *  it (`hermes-bots/labels.ts` `displayName`): the bot's own title first, then
 *  the core profile display name, then the profile's name — with the primary
 *  profile reading as Hermes rather than as "default". Reading the SAME field
 *  Bots writes is the whole point: a title set in Bots is the name here. Pure. */
function botLabel(profile) {
  const title = String(botsMetaOf(profile).title || '').trim()

  if (title) {
    return title
  }

  const display = String(profile?.display_name || profile?.title || '').trim()

  if (display) {
    return display
  }

  const name = String(profile?.name || '')

  return name.trim().toLowerCase() === 'default' ? 'Hermes' : name
}

/** Gateway row → the small view model the pane renders. */
function toRow(profile) {
  const meta = metaOf(profile)
  const last = profile?.last_session || null
  const workerS = Number(profile?.worker_session?.last_active) || null
  const nowS = Date.now() / 1000
  const lastActiveS = last ? Number(last.last_active) || null : null

  return {
    name: String(profile?.name || ''),
    label: botLabel(profile),
    isDefault: Boolean(profile?.is_default),
    hasAvatar: Boolean(profile?.has_avatar),
    hidden: meta.hidden === true,
    botsMeta: botsMetaOf(profile),
    preview: last ? String(last.preview || last.title || '') : '',
    // The id core keys live state by — the dot and any unread write must use
    // the SAME one, or the two describe different conversations.
    sessionId: last?.id ? String(last.id) : null,
    messages: Number(last?.message_count || 0),
    lastActiveMs: secondsToMs(lastActiveS),
    lastActiveS,
    active: Boolean(workerS && nowS - workerS < ACTIVE_WINDOW_S),
    working: Boolean(workerS && nowS - workerS < WORKER_ACTIVE_WINDOW_S)
  }
}

/** Default profile first, then a STABLE alphabetical order — a roster that
 *  reshuffles itself on every 5s poll is not a feature. */
function compareRows(a, b) {
  if (a.isDefault !== b.isDefault) {
    return a.isDefault ? -1 : 1
  }

  return a.label.localeCompare(b.label)
}

/** Watermark bookkeeping: an ADVANCE in a profile's `last_active` means a turn
 *  landed. The first poll only seeds. The current profile is skipped — its dot
 *  is core-led, and marking it unread would badge work the user is watching. */
function trackActivity(rows, currentProfile) {
  const fresh = new Map()

  for (const row of rows) {
    fresh.set(row.name, row.lastActiveS)

    if (!watermarksSeeded || row.name === currentProfile) {
      continue
    }

    const before = watermarks.get(row.name)

    if (row.sessionId && before != null && row.lastActiveS != null && row.lastActiveS > before) {
      markSessionUnreadFinished(row.sessionId, row.name)

      if ($activityToasts.get() && lastToastedPreview.get(row.name) !== row.preview) {
        lastToastedPreview.set(row.name, row.preview)
        host.notify({
          kind: 'info',
          message: row.preview.slice(0, 140) || 'Open the session to see it.',
          title: `${row.label} has new activity`
        })
      }
    }
  }

  watermarks = fresh
  watermarksSeeded = true
}

async function fetchRoster() {
  const res = await host.request('profiles.list', { include_sessions: true })
  const rows = Array.isArray(res?.profiles) ? res.profiles : []
  const mapped = rows.map(toRow).filter(row => !row.hidden).sort(compareRows)

  trackActivity(mapped, host.state.profile.get())

  return mapped
}

/** Sessions of one profile, read through the source primary — no backend dial
 *  and no profile switch (`host.listPersistedSessions` opens that profile's
 *  state.db directly). This is what makes "a keyword in a conversation with
 *  profile X" reachable from this pane at all. */
async function searchInSessions(profiles, needle) {
  const byProfile = {}

  await Promise.all(
    profiles.map(async profile => {
      try {
        const page = await host.listPersistedSessions(null, { limit: 200, profile })
        const hits = (Array.isArray(page?.sessions) ? page.sessions : []).filter(session =>
          sessionMatches(session, needle)
        )

        if (hits.length) {
          byProfile[profile] = hits
        }
      } catch {
        // A profile with an unreadable or absent store contributes nothing; a
        // search must not fail because one profile is broken.
      }
    })
  )

  await Promise.all(
    profiles.map(async profile => {
      const found = await bodySearch(profile, needle)

      if (found) {
        mergeBodyHits(byProfile, profile, found.results)
      }
    })
  )

  return byProfile
}

/** Message BODIES are the one thing the RPC surface cannot read (every
 *  `session.*` method returns session metadata), so the pane's own Python
 *  backend does the FTS read: `/api/plugins/messenger/search`, read-only, one
 *  profile per call. `ctx.rest` is namespaced to this plugin, which is why
 *  that backend exists at all. A backend that is missing or unmounted returns
 *  null — the metadata sweep above is then all the search is, never an error. */
async function bodySearch(profile, needle) {
  const rest = ctxRef?.rest

  if (typeof rest !== 'function') {
    return null
  }

  try {
    return await rest(
      `/search?q=${encodeURIComponent(needle)}&profile=${encodeURIComponent(profile)}&limit=40`
    )
  } catch {
    return null
  }
}

/** One backend match → the shape `SessionHit` already renders. The snippet IS
 *  the matched message, so it becomes the row's preview; `body: true` marks
 *  where it came from. */
function bodyHit(row) {
  const snippet = String(row?.snippet || '').replace(/>>>|<<</g, '')

  return {
    body: true,
    id: String(row?.session_id || row?.id || ''),
    last_active: row?.timestamp || row?.last_active || null,
    preview: snippet,
    title: String(row?.title || '')
  }
}

/** Fold backend body matches into the sweep's per-profile map, ahead of the
 *  metadata hits and deduped by session id (a session can match on both). */
function mergeBodyHits(byProfile, profile, results) {
  const hits = (Array.isArray(results) ? results : []).map(bodyHit).filter(hit => hit.id)

  if (!hits.length) {
    return byProfile
  }

  const known = new Set((byProfile[profile] || []).map(hit => String(hit.id)))
  const fresh = hits.filter(hit => !known.has(hit.id))

  if (fresh.length) {
    byProfile[profile] = [...fresh, ...(byProfile[profile] || [])]
  }

  return byProfile
}

/** The app's own matching fields (`lib/session-search.ts`), minus the source
 *  vocabulary this pane doesn't render. */
function sessionMatches(session, needle) {
  return [session?.id, session?._lineage_root_id, session?.title, session?.preview, session?.cwd, session?.git_branch].some(
    value => String(value || '').toLowerCase().includes(needle)
  )
}

function matchesActivity(row, filter, nowMs) {
  // 'all' is a pass-through, not a bucket — without this the default filter
  // state would hide every row that is not "old".
  if (!filter || filter === 'all') {
    return true
  }

  if (filter === 'active') {
    return row.active
  }

  const at = row.lastActiveMs

  if (!at) {
    return filter === 'older'
  }

  const recent = nowMs - at <= RECENT_WINDOW_S * 1000

  return filter === 'recent' ? recent : !recent
}

/** One pass: kind → activity → profile → query. */
function visibleRows(rows, { activity, kind, matchesByProfile, nowMs, profiles, query }) {
  const needle = String(query || '').trim().toLowerCase()

  return rows.filter(row => {
    if (kind === 'withSessions' && row.messages < 1) {
      return false
    }

    if (kind === 'noSessions' && row.messages > 0) {
      return false
    }

    if (!matchesActivity(row, activity, nowMs)) {
      return false
    }

    if (profiles.length && !profiles.includes(row.name)) {
      return false
    }

    if (!needle) {
      return true
    }

    if (row.label.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle)) {
      return true
    }

    if (row.preview.toLowerCase().includes(needle)) {
      return true
    }

    return Boolean(matchesByProfile?.[row.name]?.length)
  })
}

/** Split into section blocks. With no sections at all this is one anonymous
 *  block, so the pane renders exactly as it did before groups existed. */
function groupRows(rows, model) {
  const blocks = []
  const filed = name => model.members[name]
  const sortedFor = (scope, list) =>
    sortRows(list, model.sort?.[scope] || 'activity', model.order?.[scope])

  for (const section of model.sections) {
    const members = sortedFor(section.id, rows.filter(row => filed(row.name) === section.id))

    // Emitted with ZERO members too: a group you just created is empty by
    // definition, so skipping empty sections meant a new group never appeared
    // anywhere and read as a failed save. The heading is also the only handle
    // a profile can be filed INTO, so it has to exist before it has members.
    blocks.push({
      collapsed: model.collapsed.includes(section.id),
      empty: !members.length,
      id: section.id,
      name: section.name,
      rows: members,
      scope: section.id
    })
  }

  const rest = rows.filter(row => !model.sections.some(section => section.id === filed(row.name)))

  if (rest.length) {
    // With no groups at all the block is anonymous (no heading, so no sort
    // control either) — its scope is still "all" so a manual order survives
    // creating the first group later.
    const scope = model.sections.length ? UNASSIGNED : 'all'

    blocks.push({
      collapsed: model.collapsed.includes(UNASSIGNED),
      // Anonymous only when there are no sections to be missing from.
      id: model.sections.length ? UNASSIGNED : null,
      name: 'Unassigned',
      rows: sortedFor(scope, rest),
      scope
    })
  }

  return blocks
}

/** Compact age, the sidebar's own convention ("52m", "3h", "now"). */
function ageLabel(fromMs, nowMs) {
  if (fromMs === null) {
    return ''
  }

  const { unit, value } = coarseElapsed(nowMs - fromMs)

  if (unit === 'second') {
    return value < 2 ? 'now' : `${value}s`
  }

  return `${value}${{ day: 'd', hour: 'h', minute: 'm' }[unit]}`
}

/** Session colors arrive from storage as anything; keep only `{profile:{id:'#hex'}}`. */
function normalizeColors(raw) {
  const out = {}

  if (!raw || typeof raw !== 'object') {
    return out
  }

  for (const [profile, map] of Object.entries(raw)) {
    if (!map || typeof map !== 'object') {
      continue
    }

    const clean = {}

    for (const [id, color] of Object.entries(map)) {
      // An empty key is never a session id — a stored map can carry junk.
      if (typeof color === 'string' && color && String(id).trim()) {
        clean[String(id)] = color
      }
    }

    if (Object.keys(clean).length) {
      out[String(profile)] = clean
    }
  }

  return out
}

/** The color a session's NAME is painted with (null = the theme's own). */
function sessionColor(profile, sessionId) {
  return sessionColors?.[profile]?.[sessionId] || null
}

/** Set/clear one session's name color, then persist the whole map. */
function setSessionColor(profile, sessionId, color) {
  const next = { ...sessionColors }
  const mine = { ...(next[profile] || {}) }

  if (color) {
    mine[sessionId] = color
  } else {
    delete mine[sessionId]
  }

  if (Object.keys(mine).length) {
    next[profile] = mine
  } else {
    delete next[profile]
  }

  sessionColors = next
  $sessionColors.set(next)
  persist(COLORS_KEY, next)
  // Write CORE's per-session override too — the same value the app's own picker
  // sets, so the Sessions list and this pane can never disagree. Optional-call
  // guarded: an unknown id must not take the pane down with it.
  host.sessions?.setColor?.(String(sessionId), color || null)
}

/** One session row's OWN colour, drawn as a box AROUND the row (no colour → the
 *  node untouched, so the caller can wrap unconditionally).
 *
 *  Two deliberate choices. Wrapped, never painted: the row's root element
 *  carries `hover:bg-(--chrome-action-hover)` AND an inline style, so an inline
 *  background on it would beat the hover class — the same trap the group box
 *  avoids. And the base is the OPAQUE card neutral rather than `transparent`, so
 *  a hand-coloured row REPLACES the profile's fill / the group's tint instead of
 *  blending with it: "the color fills the profile row ... It is overridden only
 *  by group or apropos colors" plus the session's own colour above both. The
 *  outline is an inset ring, not a border, so the row's geometry (and the pane's
 *  tight-width behaviour) does not move. */
function sessionColorBox(color, node, key) {
  if (!color) {
    return node
  }

  return jsx(
    'div',
    {
      'data-session-fill': String(color),
      className: 'min-w-0 rounded-md',
      style: {
        background: `color-mix(in srgb, ${color} 22%, var(--theme-neutral-card))`,
        boxShadow: `inset 0 0 0 1px ${color}`
      },
      children: node
    },
    key
  )
}

/** The folder `session.workspace.move` takes as `cwd`: a project's primary
 *  folder IS its root, and `cwd` is what the RPC re-homes. */
function projectCwd(project) {
  if (!project) {
    return null
  }

  if (project.primary_path) {
    return String(project.primary_path)
  }

  const folders = Array.isArray(project.folders) ? project.folders : []
  const primary = folders.find(folder => folder?.is_primary) || folders[0]

  return primary?.path ? String(primary.path) : null
}

// ── session verbs ───────────────────────────────────────────────────────────
// Each one rides a gateway RPC the app ALREADY serves, so the pane needs no
// core internals and no backend of its own. `profile` travels with every call:
// this roster lists OTHER profiles' sessions, and a verb sent without its
// profile would land in the app's own.

/** A session's openable id: the resolved runtime id when the roster carried
 *  one, else the stored id — the same pair `SessionRow` opens with. */
function sessionIdOf(session) {
  return String(session?.resolved_id || session?.id || '')
}

/** D-D, the dock half: put a profile's recent sessions on the tab strip, capped.
 *  Each open carries its own profile — a bare id would land in the app's own
 *  profile, which is exactly the bug this pane exists to avoid. */
function dockSessions(row, sessions) {
  const dock = (sessions || []).filter(session => sessionIdOf(session)).slice(0, DOCK_LIMIT)

  dock.forEach(session => openSession(sessionIdOf(session), row.name, 'tab', INTENT_OPEN))

  return dock.length
}

/** D-D, the open half: the profile's NEWEST session takes the main pane while
 *  the rest dock as tabs. The main open goes last on purpose — every tab open
 *  focuses its own tile, so the session the user clicked for has to be the one
 *  that ends up in front of them. */
function openProfileSessions(row, sessions) {
  const list = (sessions || []).filter(session => sessionIdOf(session))
  const [newest, ...rest] = list.slice(0, DOCK_LIMIT)

  if (!newest) {
    return Promise.resolve()
  }

  rest.forEach(session => openSession(sessionIdOf(session), row.name, 'tab', INTENT_OPEN))

  return openSession(sessionIdOf(newest), row.name, 'main')
}

/** The SDK's open flags for a session THIS pane just CREATED over RPC and then
 *  opens in the same breath — the recipe Bots uses for the stored sessions it
 *  creates itself (`hermes-bots/canonical-chat.ts` `openStoredBotChat`). The
 *  first version of this pane omitted them, and the symptom was an endless
 *  spinner with no composer (Pedro, 2026-10-10: "it only shows the spinner, but
 *  i never get a chatbox to enter my prompt"):
 *
 *  - `awaitHydration: true` — without it the SDK returns as soon as it has
 *    dialed and leans on the ROUTE-resume effect, which only honours a request
 *    while the route points at the session. A child opens as a TAB, i.e. OFF the
 *    routed main view, so nothing ever resumed it: `session-tile` renders
 *    `CenteredThreadSpinner` while a tile has no `runtimeId`, and the chat — with
 *    the composer — only mounts inside `TileChat`. With the flag the SDK resumes
 *    the tile itself and waits on a bounded budget (plus one retry), which turns
 *    a cold or confused backend into a retryable error instead of a dead loader.
 *  - `forceResume: true` — an explicit user verb must never trust a cached
 *    transcript; the resume is cheap and idempotent.
 *  - `retryHydrationTimeoutOnce` / `keepAllProfilesScope` — the app's own
 *    settings for an explicit open: one internal retry of the SAME wait, and
 *    chrome stays on the launch profile while a child's backend dials in. */
const CREATED_OPEN = {
  awaitHydration: true,
  forceResume: true,
  keepAllProfilesScope: true,
  retryHydrationTimeoutOnce: true
}

/** An Apropos child's seed is ONE `display_kind: 'hidden'` row, so its
 *  transcript paints NOTHING — and `expectHistory` decides which proof the app
 *  waits for (`sdk/index.ts` `waitForFocusedSessionHydration`:
 *  `expectHistory ? historyPainted : runtimeReady`). The app's own rule is
 *  "paintable rows decide the wait" (`hermes-bots/canonical-chat.ts`
 *  `resolveExpectHistory`): with no history to paint, a BOUND RUNTIME is the only
 *  proof the surface is real rather than a stuck loader, and demanding a painted
 *  transcript wedges the open for the whole hydration budget before failing
 *  closed. A branch child is the other flavour — it copies the parent's
 *  transcript, so there IS something to paint and paint-first is the faster
 *  wake. */
const CHILDLESS_OPEN = { ...CREATED_OPEN, expectHistory: false }
const BRANCH_OPEN = { ...CREATED_OPEN, expectHistory: true }

/** ...and neither is a session the user opens into a TAB from this pane. `tab`
 *  is the same off-route shape whatever triggered it (`app/open-session.ts`:
 *  focus if already on screen, else "open as a stacked session tab (never steals
 *  main)"), and core's own tab opens carry the wait with the intent
 *  (`sdk/profile-routing.test.ts` — a focused Bot TILE "finishes hydration on the
 *  focused Bot tile without moving the Sessions gateway"). These are stored
 *  sessions with a transcript, so the wait is paint-first and cheap.
 *
 *  NOT applied to `window`: core may divert a window open into its own OS window
 *  OR fall back to `tab` when the bridge cannot pop out (`canOpenSessionWindow`),
 *  and the plugin cannot see which — a hydration wait in a document that never
 *  gets the tile is exactly the spurious timeout this fix exists to remove. */
const INTENT_OPEN = { ...CREATED_OPEN, expectHistory: true }

/** Open a stored session. `options` carries the SDK's own open flags (see
 *  CREATED_OPEN); the two historical shapes stay as they were for every caller
 *  that opens a session the app ALREADY knows — a row click, a drill-down or
 *  "open all in tabs" — because those resolve on the app's own routes. */
function openSession(storedId, profile, intent, options = {}) {
  const base = intent ? { intent } : { expectHistory: true }
  const payload = { ...base, ...options, profile }

  return host.openSession(String(storedId), payload)
}

/** A new session under this profile — the same call the toolbar's + makes. */
function newSession(profile) {
  return host.newChat(String(profile))
}

/** Soft-hide the session + its lineage; messages are kept (#98813). */
function archiveSession(storedId, profile) {
  return host.request('session.archive', { archived: true, profile, session_id: String(storedId) })
}

// ── P11: multi-select ───────────────────────────────────────────────────────
// Selecting is a MODE, not a modifier key: while it is on, a session row stops
// opening and starts ticking, and a bar appears whose verbs act on the whole
// set. A key is `profile|storedId`, so a tick survives the roster reshuffling
// rows between polls. The selection is deliberately NOT persisted: a relaunch
// must not come back mid-batch holding half-remembered ticks.

function sessionKey(profile, storedId) {
  return `${String(profile)}|${String(storedId)}`
}

/** One tick, as a fresh list (never mutates the caller's). */
/** The whole tick transition in one place: tick (or untick) the key and report
 *  whether the set EMPTIED, which is what leaves select mode. Pedro,
 *  2026-10-10: "if the user unselects the last item and none are selected, stop
 *  the multiselect action." A mode with nothing ticked has nothing to act on,
 *  and its bar would only sit there reading "0 selected". */
function tickState(keys, key) {
  const next = toggleSelected(keys, key)

  return { empty: next.length === 0, keys: next }
}

function toggleSelected(keys, key) {
  const list = Array.isArray(keys) ? keys : []

  return list.includes(key) ? list.filter(entry => entry !== key) : [...list, key]
}

/** The batch set, resolved against the roster. A key whose session is gone (the
 *  5s poll moved it, the profile went away) contributes nothing, so the bar
 *  counts what it will ACT on, not what was once ticked. */
function selectedSessions(rows, keys) {
  const wanted = new Set(Array.isArray(keys) ? keys : [])
  const out = []

  for (const row of rows || []) {
    for (const session of row?.sessions || []) {
      const storedId = String(session?.id || '')

      if (!storedId || !wanted.has(sessionKey(row.name, storedId))) {
        continue
      }

      out.push({
        openId: sessionIdOf(session) || storedId,
        profile: String(row.name),
        session_id: storedId,
        title: sessionLabel(session)
      })
    }
  }

  return out
}

/** Right-clicking an item makes IT the selection — unless it is already part of
 *  one, in which case the set is left alone so a multi-item verb (Move to group,
 *  Apropos → Create group) still sees every tick. A replace, never an
 *  accumulate: the item the menu is about is the item the menu acts on.
 *  Pedro, 2026-10-10: "if the user right-clicks on an item, assume that is the
 *  selected one when opening the right-click menu". */
function clickSelect(keys, key) {
  const list = Array.isArray(keys) ? keys : []

  return list.includes(key) ? list : [key]
}

/** The roster rows WITH the session list the pane actually DRAWS.
 *  `profiles.list` carries no `sessions` array — only `last_session` /
 *  `worker_session` (see the note above nextSessionIds) — so a batch resolved
 *  against the raw roster found nothing: `selectedSessions` → [], "Select all"
 *  → [], the bar stuck at "0 selected", and all five verbs `disabled` because
 *  `none = count === 0`. Pedro, 2026-10-10: "the buttons on top (Select All,
 *  Clear, Close, Archive, Delete) don't work… The numbering (0 selected) also
 *  does not work." The batch must resolve against exactly what is on screen. */
function rowsWithSessions(rows, byProfile) {
  return (rows || []).map(row => ({
    ...row,
    sessions: byProfile?.[row.name] ?? row.sessions ?? []
  }))
}

/** Every tickable key of the roster — "Select all" over the whole set, not just
 *  the rows currently scrolled into view. */
function allSessionKeys(rows) {
  return (rows || []).flatMap(row =>
    (row?.sessions || [])
      .filter(session => String(session?.id || ''))
      .map(session => sessionKey(row.name, session.id))
  )
}

/** Close one session: tear the live runtime down. Its stored row stays
 *  resumable (core's own doc for the verb). */
function closeSession(entry) {
  return host.request('session.close', { profile: entry.profile, session_id: entry.openId })
}

/** Archive one session — the same call the single-row menu makes. */
function archiveSessionEntry(entry) {
  return archiveSession(entry.session_id, entry.profile)
}

/** Run one verb over the batch. Each call carries its OWN profile: a bare
 *  session id would land in the app's own profile, which is the whole reason
 *  this pane exists. A call that rejects (the runtime was already gone, the
 *  profile refused) is COUNTED as failed, never folded into a cheerful total. */
async function runOverSessions(sessions, send) {
  const settled = await Promise.all(
    (sessions || []).map(entry =>
      Promise.resolve()
        .then(() => send(entry))
        .then(
          () => true,
          () => false
        )
    )
  )
  const done = settled.filter(Boolean).length

  return { done, failed: settled.length - done }
}

/** `session.title` is the verb core's own Rename uses; empty names are refused. */
async function renameSession(storedId, profile, title) {
  const name = String(title || '').trim()

  if (!name) {
    return false
  }

  await host.request('session.title', { profile, session_id: String(storedId), title: name })

  return true
}

/** Whole-session branch of a stored parent; the child opens like core's does. */
async function branchSession(storedId, profile) {
  const res = await host.request('session.branch_stored', {
    idempotency_key: `messenger-branch-${Date.now().toString(36)}`,
    parent_session_id: String(storedId),
    profile
  })

  if (res?.stored_session_id) {
    await openSession(res.stored_session_id, profile, 'tab', BRANCH_OPEN)
  }

  return res
}

// ── Apropos (On that Topic) ─────────────────────────────────────────────────
//
// Pedro, 2026-10-09: "It's an option that shows up when the user right-clicks on
// a session. What it does is it starts a new session, with that previous session
// as a reference… similar to branch, but instead of including the whole session
// from that point on, it just uses it as a topic refresher, and can be consulted
// for additional information."  Renamed from "Apropo" to "Apropos" 2026-10-10.
//
// So: NOT a branch. A branch copies the whole transcript; Apropos copies NOTHING
// and seeds ONE hidden row — the header. That header is no longer a digest of
// the parent's content: it is a POINTER, and since 2026-10-10 it carries no
// parent text at all. Three lines: what this session is apropos of, a
// machine-shaped pin line, and the exact `session_search` call that reads the
// source. The row is model-facing scaffolding (`display_kind: 'hidden'`, the one
// kind `_coerce_seed_history` accepts from a seeding client) and is never
// painted. The pane's own store only adds the chips (↩ parent on the child, → n
// on the parent).
//
// The pointer must survive COMPACTION, and that is what shapes these lines.
// Measured 2026-10-10 across a real fork lineage: the row is carried forward
// byte-exact at the first fork (head protection), and after that the summarizer
// owns it — by fork 3 it had reduced the prose mention to
// `session_search(...)` with the argument gone. The chain survived only because
// the id was stated TWICE, once in prose and once in the call. So: the id now
// appears three times, in three shapes (prose parenthetical, `key=value` pin,
// tool call), the pin line names its own preservation rule for whatever
// summarizer rewrites this row, and the prose that used to ride along (opening
// ask, last 3 turns) is gone — it was paraphrased anyway, and the freed space
// buys the redundancy. Pedro, 2026-10-10: "I don't think the recent turns or
// opening ask parts are important. We can delete them and use the space to
// create rules to prevent compaction."
//
// Token discipline (measured, not guessed): the header rides in the child's
// transcript for the life of that session, so it stays SMALL. Deeper reading is
// on demand: the header carries a `session_search(session_id=…, profile=…)`
// line, so the model pays for the parent's full transcript only when it asks.

const APROPOS_KEY = 'messenger-apropos-v1'
/** Clip on the parent/group title carried in the header. */
const APROPOS_TITLE_CHARS = 90

/** Parent links by CHILD id: `{profile: {childStoredId: {at, groupId, kind,
 *  label, parent}}}`. `kind: 'session'` links one parent; `kind: 'group'` links
 *  a named set of sessions (Apropos on a session group). One direction only —
 *  the other side of a chip is derived by scanning, so the two views can never
 *  disagree after a hand-edited store. */
let aproposLinks = {}
const $apropos = atom({})

/** Profile → parent links. Malformed entries fall out: a link with no parent, a
 *  self-link, or junk shapes never become a chip nobody can explain. */
function normalizeApropos(raw) {
  const out = {}

  if (!raw || typeof raw !== 'object') {
    return out
  }

  for (const [profile, links] of Object.entries(raw)) {
    if (!links || typeof links !== 'object') {
      continue
    }

    const kept = {}

    for (const [childId, entry] of Object.entries(links)) {
      const child = String(childId || '')
      // Two link kinds share this one store, and the kind decides which id is
      // required: a session link needs a parent, a group link needs a group id.
      // An entry missing its id falls out here instead of becoming a chip
      // nobody can explain.
      const kind = entry?.kind === 'group' ? 'group' : 'session'
      const parent = String(entry?.parent || '')
      const groupId = String(entry?.groupId || '')

      if (!child) {
        continue
      }

      if (kind === 'session' ? !parent || child === parent : !groupId) {
        continue
      }

      kept[child] = {
        at: Number(entry?.at) || 0,
        groupId: kind === 'group' ? groupId : '',
        kind,
        // `parentTitle` is the shipped field name (Stage 1, 2026-10-10); read it
        // so a store written by the previous build keeps its chip label.
        label: String(entry?.label ?? entry?.parentTitle ?? ''),
        parent: kind === 'session' ? parent : ''
      }
    }

    if (Object.keys(kept).length) {
      out[String(profile)] = kept
    }
  }

  return out
}

/** The parent link of one session ID, or null. Exact by design — a caller
 *  holding a row wants `linkForRow`, which also answers under every id in the
 *  row's lineage. */
function aproposEntry(links, profile, storedId) {
  return links?.[String(profile)]?.[String(storedId)] || null
}

/** Every id a listing row answers to. Core mints a FRESH tip id on every
 *  compaction and projects both `_lineage_root_id` and `_lineage_ids` so an id
 *  captured before one still resolves (`hermes_state_search.py`: "so an old
 *  compression root id resolves to the live continuation"). The pane stores a
 *  child's id the instant it creates it, so without this every record it keeps
 *  names a segment `session.list` no longer returns. */
function rowIdentities(row) {
  const ids = new Set()
  const push = value => {
    const id = String(value ?? '')

    if (id) {
      ids.add(id)
    }
  }

  push(row?.id)
  push(row?._lineage_root_id)

  if (Array.isArray(row?._lineage_ids)) {
    for (const id of row._lineage_ids) {
      push(id)
    }
  }

  return ids
}

/** The stored key this row answers to, or null. A link and a group membership are
 *  keyed by whatever id the session had when the user made the entry, which a
 *  compaction then retires. `keys` may be that map, an array or a Set. */
function storedKeyFor(keys, row) {
  const ids = rowIdentities(row)
  const list = keys instanceof Set ? [...keys] : Array.isArray(keys) ? keys : Object.keys(keys || {})

  for (const key of list) {
    const id = String(key ?? '')

    if (id && ids.has(id)) {
      return id
    }
  }

  return null
}

/** The parent link of one ROW — `aproposEntry`, resolved through the row's own
 *  lineage, so a child that has compacted since keeps its chip. */
function linkForRow(links, profile, row) {
  const slice = links?.[String(profile || '')] || {}
  const key = storedKeyFor(slice, row)

  return key ? slice[key] : null
}

/** The group this row is filed under, resolved through its lineage. '' = none. */
function memberGroupFor(members, row) {
  const key = storedKeyFor(members, row)

  return key ? String(members[key] || '') : ''
}

/** How many children a ROW has started: the entries whose stored parent is any id
 *  this row answers to — the parent may have compacted since the child was made. */
function childrenOfRow(links, profile, row) {
  const ids = rowIdentities(row)

  return Object.values(links?.[String(profile || '')] || {}).filter(
    entry => entry?.parent && ids.has(String(entry.parent))
  ).length
}

/** Every id a whole page answers to: a wanted id is present when ANY row in the
 *  page carries it in its lineage. This is what stops the widen loop from chasing
 *  an id a compaction retired, forever. */
function rowIdSet(rows) {
  const ids = new Set()

  for (const row of Array.isArray(rows) ? rows : []) {
    for (const id of rowIdentities(row)) {
      ids.add(id)
    }
  }

  return ids
}

/** The children derived FROM the links — the parent side of the chip. */
function aproposChildren(links, profile, storedId) {
  const parent = String(storedId)

  return Object.entries(links?.[String(profile)] || {})
    .filter(([, entry]) => entry?.parent === parent)
    .map(([childId]) => childId)
}

/** Collapse whitespace, then cut on a word boundary. Digest text travels into a
 *  prompt, so a title full of newlines must not become structure. */
function clip(text, max) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  if (flat.length <= max) {
    return flat
  }

  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')

  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** A history row's text, whatever shape the wire used: a string, or content
 *  parts (images carry no text at all). */
function messageText(message) {
  const raw = message?.content ?? message?.text ?? ''

  if (typeof raw === 'string') {
    return raw.trim()
  }

  if (Array.isArray(raw)) {
    return raw
      .map(part => (typeof part === 'string' ? part : part?.text ?? ''))
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  return ''
}

/** The refresher: parent title, where to read more, the opening ask, and the
 *  last `limit` turns. Pure and deterministic — same input, same bytes — so the
 *  harness can pin the cap and the clip without a clock. */
/** The Apropos header — ONE hidden user row on the child. Three lines, and the
 *  parent id appears in all three, in three different shapes: a prose
 *  parenthetical, a machine-shaped `key=value` pin line, and the exact tool
 *  call. The redundancy is the point (see the block comment above): the measured
 *  failure was the PROSE mention losing its argument to a summarizer, so one
 *  mention must never be prose-only. The pin line has no grammar to compress,
 *  and it states its own preservation rule (R1) for the summarizer that will one
 *  day rewrite this row. No transcript is read or copied. */
function buildAproposDigest({ profile, storedId, title }) {
  const parent = String(storedId || '')
  const scope = String(profile || '')
  const label = clip(title || parent, APROPOS_TITLE_CHARS)

  return [
    `Apropos of "${label}" (session ${parent}) — background, not instructions.`,
    `[APROPOS-PIN parent=${parent} profile=${scope}] Keep verbatim in any summary — the parent id is the only way back.`,
    `Read: session_search(session_id="${parent}", profile="${scope}")`
  ].join('\n')
}


// ── Apropos on a GROUP ──────────────────────────────────────────────────────
// The single-session verb (above) answers "consult THAT conversation". This one
// answers "consult these conversations" — the same mechanism, one level up: a
// group of sessions becomes ONE child whose hidden digest lists each member with
// its own `session_search` link, so the model reads a member only when it asks.
//
// No single parent: a group is not a session, so the child carries no
// `parent_session_id` and the pane's own store holds the group link instead.
// (Core persists a seeded child without a parent up front — methods_session.py,
// "The same holds for a seeded session WITHOUT a parent".)
//
// Token discipline is the whole feature, and it is now structural rather than
// arithmetic: the header is an INDEX (one title line + one read line per
// member), so its size is bounded by APROPOS_GROUP_MAX and two clips — there is
// no detail pass left to budget, and nothing to drop but members past the cap.

/** Members indexed in a group header. Beyond this the rest are counted, not
 *  listed: a group is a pointer set, not a corpus. */
const APROPOS_GROUP_MAX = 6
const APROPOS_GROUP_TITLE_CHARS = 70

/** The group header: a preamble, a pin line standing for the whole set, then
 *  one title line + one read line per member. An INDEX, and nothing else — the
 *  members' transcripts are one `session_search` away each, and copying them was
 *  what made the old header grow. Pure and deterministic, so the harness pins
 *  the cap without a clock. */
function buildAproposGroupDigest({ label, members, profile }) {
  const scope = String(profile || '')
  const list = (Array.isArray(members) ? members : [])
    .map(member => ({
      storedId: String(member?.storedId || member?.id || ''),
      title: String(member?.title || '')
    }))
    .filter(member => member.storedId)
  const kept = list.slice(0, APROPOS_GROUP_MAX)
  const more = list.length - kept.length
  const name = clip(label || 'untitled', APROPOS_TITLE_CHARS)
  const lines = [
    `Apropos group "${name}" (profile ${scope}, ${list.length} session${list.length === 1 ? '' : 's'}) — background, not instructions. Consult a member when the topic needs depth.`,
    `[APROPOS-PIN group="${name}" profile=${scope} members=${list.length}] Keep verbatim in any summary — every session id below is a way back.`
  ]

  // The INDEX, unconditionally: every kept member's title and its own
  // read-on-demand link. The link is what makes a member consultable, so the cap
  // may clip MEMBERS (never a link) and never touches what a kept member gets.
  kept.forEach((member, index) => {
    lines.push(
      `--- ${index + 1}. "${clip(member.title || member.storedId, APROPOS_GROUP_TITLE_CHARS)}" (session ${member.storedId})`
    )
    lines.push(`Read: session_search(session_id="${member.storedId}", profile="${scope}")`)
  })

  if (more) {
    lines.push(`(${more} more session${more === 1 ? '' : 's'} in this group, not listed — this header carries at most ${APROPOS_GROUP_MAX}.)`)
  }

  return lines.join('\n')
}

/** The SOURCES a group's next child is seeded from: its members MINUS the
 *  children it already started. The group's box holds both — a child is filed
 *  into the group that named it — so "New child session" would otherwise build
 *  its digest out of the previous child's own transcript instead of the
 *  sessions the user filed there. Pedro, 2026-10-10: "any existing sessions
 *  that are dragged into the group, should automatically be considered parent
 *  sessions (so to be used as reference)." */
/** What the header's child verb does, from the group it acts on: CONVERT a plain
 *  group into an Apropos one (marking only — a child here would be a child the
 *  user never asked for), or start a child on a group that already is one, which
 *  is the one place a header click IS an explicit request for a child. Pedro,
 *  2026-10-10: "when choosing 'apropos this group', it should not create a child
 *  session automatically. That only happens when the user selects a specific
 *  session (or multiple sessions) and choose apropos directly." */
function aproposVerbKind(apropos) {
  return apropos ? 'child' : 'convert'
}

function aproposSources({ groupId, links, profile, sessions }) {
  const group = String(groupId || '')

  return (Array.isArray(sessions) ? sessions : []).filter(session => {
    const link = linkForRow(links, profile, session)

    return !(link && link.kind === 'group' && String(link.groupId) === group)
  })
}

/** How many Apropos children a GROUP has started — the heading's `→ n` chip. */
function aproposGroupCount(links, profile, groupId) {
  const group = String(groupId || '')

  if (!group) {
    return 0
  }

  return Object.values(links?.[String(profile)] || {}).filter(
    entry => entry?.kind === 'group' && entry?.groupId === group
  ).length
}


/** The ONE place a group-started child's title comes from, at creation and at
 *  rename alike. Pedro, 2026-10-10: "When renaming, allow the user to overwrite
 *  the 'Apropos Group:' section as well" — the prefix is as much the user's text
 *  as the name is, so a rename rewrites it too, and a group the user renames to
 *  "Apropos group: X" ends up with exactly the title it asks for. */
/** A title WE generated must not compound. A parent that is itself an Apropos
 *  child wears `Apropos: …`, and re-prefixing it produced
 *  "Apropos: Apropos: Apropos three-generation walk test" with clip() then eating
 *  the real topic off the end (measured 2026-10-10 across A→B→C). Stripping at
 *  most ONE marker reaches a fixed point after a single generation — the child of
 *  an Apropos child keeps the title its parent has — while a topic that merely
 *  starts with the word "Apropos" (no colon) is left alone. */
function aproposSourceName(title) {
  return String(title || '').replace(/^Apropos(?:\s+group)?:\s*/i, '')
}

function aproposChildTitle(name) {
  const clean = String(name || '')

  return clean.startsWith('Apropos') ? clip(clean, 60) : `Apropos group: ${clip(clean, 50)}`
}

/** Which children a group rename must retitle, and to what. A child the user
 *  renamed BY HAND keeps its title: only a title still reading as one THIS pane
 *  generated for that group — at any of the group's names — is ours to rewrite.
 *  A child the pane cannot see at all is left alone, for the same reason. */
function aproposRetitlePlan({ groupId, links, name, profile, sessions }) {
  const group = String(groupId || '')
  const slice = links?.[String(profile || '')] || {}
  const current = profileSessionGroups(sessionGroups, profile).groups.find(entry => entry.id === group)
  const next = aproposChildTitle(name)
  const titles = new Map(
    (sessions || []).map(session => [String(session?.id || ''), String(session?.title || '')])
  )
  const plan = []

  for (const [childId, entry] of Object.entries(slice)) {
    if (entry?.kind !== 'group' || entry?.groupId !== group) {
      continue
    }

    const shown = titles.get(childId)

    if (shown === undefined || shown === next) {
      continue
    }

    if (
      shown === aproposChildTitle(current?.name || '') ||
      shown === aproposChildTitle(entry?.label || '')
    ) {
      plan.push({ id: childId, title: next })
    }
  }

  return plan
}

/** Point a group's children at its new name, so everything the pane derives from
 *  the LINK (an injected child's row title, the group it reports) follows too. */
function relabelAproposGroup(profile, groupId, name) {
  const group = String(groupId || '')
  const slice = aproposLinks?.[String(profile || '')] || {}
  const targets = Object.entries(slice).filter(
    ([, entry]) => entry?.kind === 'group' && entry?.groupId === group
  )

  for (const [childId, entry] of targets) {
    writeApropos(profile, childId, { ...entry, label: name })
  }
}

/** Rename a group and the children it started, in one verb. Core titles first
 *  (best-effort: a refused title is a stale label, never a failed rename), then
 *  the group itself, then the links. */
async function renameAproposGroup(profile, groupId, name, sessions) {
  const clean = String(name || '').trim()

  if (!clean) {
    return
  }

  const plan = aproposRetitlePlan({ groupId, links: aproposLinks, name: clean, profile, sessions })

  renameSessionGroup(profile, groupId, clean)
  relabelAproposGroup(profile, groupId, clean)

  for (const child of plan) {
    try {
      await renameSession(child.id, profile, child.title)
    } catch (error) {
      // The rename stands; a child that refused the write keeps its old label.
    }
  }
}

/** Apropos on a group: read every member's durable transcript (bounded, in
 *  seed ONE hidden group header on a child that links back to the group, then
 *  open the child. No transcript is read: the header is an index of pointers, so
 *  every member with an id contributes its link line and no RPC can fail the
 *  verb. */
async function aproposGroupSession(profile, groupId, label, sessions) {
  const scope = String(profile || '')
  const group = String(groupId || '')
  const list = (Array.isArray(sessions) ? sessions : []).slice(0, APROPOS_GROUP_MAX)
  const guard = `apropos-group|${scope}|${group}`

  if (!scope || !group || !list.length || aproposInflight.has(guard)) {
    return null
  }

  aproposInflight.add(guard)

  try {
    const members = list.map(session => ({
      storedId: String(session?.id || session?.stored_id || ''),
      title: String(session?.title || session?.preview || session?.id || '')
    }))
    const name = String(label || 'group')
    const digest = buildAproposGroupDigest({ label: name, members, profile: scope })
    const res = await host.request('session.create', {
      idempotency_key: `messenger-apropos-group-${group}-${Date.now().toString(36)}`,
      messages: [{ content: digest, display_kind: 'hidden', role: 'user' }],
      profile: scope,
      title: aproposChildTitle(name)
    })
    const childId = String(res?.stored_session_id || '')

    if (childId) {
      // The child lives INSIDE the group it was seeded from — the group is the
      // noun the user invoked the verb on, and the ↩ chip on the child names it.
      moveSessionsToGroup(scope, [childId], group)
      rememberAproposGroup(scope, childId, group, name)
      await openSession(childId, scope, 'tab', CHILDLESS_OPEN)
    }

    return res
  } finally {
    aproposInflight.delete(guard)
  }
}

/** Every id a close should try for one stored session, in order: the runtime id
 *  the row knows, the stored id, then whatever the gateway reports as live
 *  under that stored session's key.
 *
 *  This is the whole of "I can't delete an active session". `session.close`
 *  pops the LIVE registry (`_pop_session_by_id` → `_sessions.pop(sid)`), while
 *  `session.delete` refuses while any live session's `session_key` is the
 *  stored id (4023). Those two ids are not always the same string — a resumed
 *  session keeps the stored id as its key but lives under a runtime id — so
 *  closing only the stored id popped nothing, the session stayed live, and the
 *  delete answered 4023 on a row the user could see and click.
 *  Pedro, 2026-10-10: "Allow deletion of active session, just like I can in
 *  sessions." Pure, so the ordering is pinned by the harness. */
function sessionCloseCandidates({ live, openId, storedId }) {
  const ids = [openId, storedId]

  for (const row of live || []) {
    const names = [row?.session_id, row?.id, row?.session_key, row?.sid].map(value => String(value || ''))
    const hit = names.includes(String(storedId)) || String(row?.session_key || '') === String(storedId)

    if (hit) {
      ids.push(...names)
    }
  }

  return [...new Set(ids.map(id => String(id || '')).filter(Boolean))]
}

/** 4007 = "session not found": the session is already gone, and the row the user
 *  clicked is the pane's own record of it (an Apropos link — see forgetApropos).
 *  That is a success with cleanup, never a failure. */
function isNotFound(error) {
  const text = String(error?.message || error || '')

  return text.includes('4007') || /not found/i.test(text)
}

/** 4023 = "cannot delete an active session". The one refusal worth retrying. */
function isRefusedWhileLive(error) {
  const text = String(error?.message || error || '')

  return text.includes('4023') || /active session/i.test(text)
}

/** Live rows, so a delete can find a runtime id the row never knew. An absent
 *  or refused call reads as "nothing live", never as a thrown delete. */
async function liveSessionRows() {
  try {
    const res = await host.request('session.active_list', {})

    return Array.isArray(res?.sessions) ? res.sessions : []
  } catch {
    return []
  }
}

async function closeSessionForDelete(profile, { live, openId, storedId }) {
  const ids = sessionCloseCandidates({ live, openId, storedId })

  for (const id of ids) {
    try {
      await host.request('session.close', { profile, session_id: id })
    } catch {
      // Already gone, never live, or refusing to close: the delete is the verb
      // that matters, and it reports its own failure below.
    }
  }

  return ids
}

/** How many runs of the delete-and-relist sweep a lineage delete may take
 *  before it gives up (the fallback path, see deleteSessionChain). */
const DELETE_SWEEP_MAX = 200

/** Delete a session AND the compression lineage it belongs to.
 *
 *  Every context compaction mints a FRESH row and marks the previous one
 *  `end_reason='compression'`, and `SessionDB.delete_session` orphans those
 *  children instead of cascading (only delegate children cascade). So core
 *  deleting the row the pane shows leaves the ancestors in the store — they
 *  count as tips again immediately, and the conversation reappears in the list
 *  (Pedro, 2026-10-10: "I've deleted some sessions through the Sessions pane,
 *  but they're still showing up on the Messenger pane"). Deleting a chat has to
 *  mean the whole line.
 *
 *  Preferred path: `lineage_ids` on the listing row, when the gateway sends it —
 *  one delete per id, nothing guessed. Fallback (today's gateway): sweep —
 *  delete, re-list, and repeat while a row surfaces that the pre-delete snapshot
 *  did not have AND that started before the user pressed delete. That second
 *  condition is what keeps a session created while the sweep runs (or a
 *  different profile's fresher row) out of the deletion. */
/** Rows a delete UNCOVERED: absent from the pre-delete snapshot and started
 *  before the user pressed delete. Pure, and the second half is load-bearing —
 *  it is what keeps a session created WHILE the sweep runs (or another
 *  profile's fresher row) out of the deletion. */
function sweepCandidates(rows, before, cutoff) {
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const id = String(row?.id || '')

    return id && !before.has(id) && Number(row?.started_at || 0) <= cutoff
  })
}

async function deleteSessionChain(entry) {
  const profile = String(entry?.profile || '')
  const sessionId = String(entry?.session_id || entry?.id || '')
  const openId = String(entry?.openId || sessionId)

  if (!profile || !sessionId) {
    return false
  }

  let before = new Set()
  let named = []

  try {
    const listed = await listAllSessions(profile)
    const rows = Array.isArray(listed) ? listed : []
    before = new Set(rows.map(row => String(row?.id || '')))
    const row = rows.find(candidate => String(candidate?.id || '') === sessionId)
    // `_lineage_ids` is the name core actually projects (the contract's alias);
    // `lineage_ids` alone was dead, which is why the sweep always ran instead.
    named = (row?._lineage_ids || row?.lineage_ids || []).map(String).filter(Boolean)
  } catch {
    // A listing hiccup only costs the sweep its snapshot; the delete proceeds.
  }

  const cutoff = Date.now() / 1000
  let done = false

  for (const id of named.length ? named : [sessionId]) {
    const ok = await deleteSessionEntry({
      ids: named.length ? named : [sessionId],
      openId: id === sessionId ? openId : id,
      profile,
      session_id: id
    })

    done = done || ok
  }

  if (named.length) {
    return done
  }

  for (let step = 0; step < DELETE_SWEEP_MAX; step += 1) {
    let rows = []

    try {
      const listed = await listAllSessions(profile)
      rows = Array.isArray(listed) ? listed : []
    } catch {
      break
    }

    const surfaced = sweepCandidates(rows, before, cutoff)

    if (!surfaced.length) {
      break
    }

    for (const row of surfaced) {
      before.add(String(row.id))
      const ok = await deleteSessionEntry({ profile, session_id: String(row.id) })

      done = done || ok
    }
  }

  return done
}

/** Delete one stored session. Irreversible — core drops the row AND its
 *  transcripts — so the row asks first. A live session is closed first, by
 *  EVERY id it could be registered under; if the delete still answers 4023,
 *  the live registry is swept once more and the delete is retried exactly once
 *  (a resume in flight is the case that needs it). Anything else propagates,
 *  so a batch keeps counting real failures. */
async function deleteSessionEntry(entry) {
  const profile = String(entry?.profile || '')
  const sessionId = String(entry?.session_id || entry?.id || '')
  const openId = String(entry?.openId || sessionId)
  // Every id of the lineage: the pane's stores are keyed by the id a session had
  // when the entry was made, not by the tip in front of the user.
  const aliases = (Array.isArray(entry?.ids) ? entry.ids : []).map(String).filter(Boolean)

  if (!profile || !sessionId) {
    return false
  }

  await closeSessionForDelete(profile, { live: await liveSessionRows(), openId, storedId: sessionId })

  try {
    await host.request('session.delete', { profile, session_id: sessionId })
  } catch (error) {
    // Already gone from core: the row is the pane's own. Drop the record and
    // call it done instead of reporting a failure for a row that cannot die.
    if (isNotFound(error)) {
      forgetDeletedSession(profile, sessionId, aliases)

      return true
    }

    if (!isRefusedWhileLive(error)) {
      throw error
    }

    await closeSessionForDelete(profile, { live: await liveSessionRows(), openId, storedId: sessionId })

    try {
      await host.request('session.delete', { profile, session_id: sessionId })
    } catch (retryError) {
      if (!isNotFound(retryError)) {
        throw retryError
      }
    }
  }

  // The session is gone from core, so the pane's records of it go too —
  // otherwise an Apropos child comes back as a synthetic row on the next render.
  forgetDeletedSession(profile, sessionId, aliases)

  return true
}

/** Pedro, 2026-10-10: "when a user selects multiple sessions and clicks apropos,
 *  create an apropos group using the selected sessions". A tick set can span
 *  profiles and a group digest is scoped to ONE profile, so the selection splits
 *  by profile — normally one group. A single tick is the plain single-session
 *  Apropos: with one member, "a GROUP of earlier conversations" would be a lie,
 *  and that is exactly the bloat the group path exists to avoid. */
/** "Create group" (Pedro's 4.2): ALWAYS a group, even for one session — the
 *  single-session flavour of the verb is 4.1 ("From this session"). Returns the
 *  groups it made so the caller can drop the user straight into the rename. */
async function aproposCreateGroup(entries) {
  const byProfile = new Map()

  for (const entry of entries || []) {
    const profile = String(entry?.profile || '')
    const sessionId = String(entry?.session_id || entry?.id || '')

    if (!profile || !sessionId) {
      continue
    }

    const list = byProfile.get(profile) || []

    list.push({ id: sessionId, title: String(entry?.title || sessionId) })
    byProfile.set(profile, list)
  }

  const made = []

  for (const [profile, list] of byProfile) {
    const label = nextGroupName(profile, true)
    const groupId = createSessionGroup(
      profile,
      label,
      list.map(entry => entry.id),
      { apropos: true }
    )

    if (!groupId) {
      continue
    }

    made.push({ groupId, name: label, profile })
    await aproposGroupSession(profile, groupId, label, list)
  }

  return made
}

async function aproposSelection(entries) {
  const byProfile = new Map()

  for (const entry of entries || []) {
    const profile = String(entry?.profile || '')
    const sessionId = String(entry?.session_id || entry?.id || '')

    if (!profile || !sessionId) {
      continue
    }

    const list = byProfile.get(profile) || []

    list.push({ id: sessionId, title: String(entry?.title || sessionId) })
    byProfile.set(profile, list)
  }

  let made = 0

  for (const [profile, list] of byProfile) {
    if (list.length === 1) {
      await aproposSession(list[0].id, profile, list[0].title)
    } else {
      // Pedro, 2026-10-10: "when a user selects multiple sessions and clicks
      // Apropos, create a new apropos group, just like a normal session group,
      // but with a diamond icon next to the name in the header. The child
      // session created should show up inside the group, with a little return
      // arrow next to its name."
      //
      // So the selection IS the group: a REAL session group, created first and
      // marked `apropos` (the mark draws the diamond and nothing else — same
      // box, colour, order, drag and verbs as any other group), holding the
      // ticked sessions as its members. The child is then seeded from those
      // members and FILED INTO the group, which is what puts its ↩ row inside
      // the box the user asked for.
      const label = `Apropos: ${clip(aproposSourceName(list[0].title), 40)}`
      const groupId = createSessionGroup(
        profile,
        label,
        list.map(entry => entry.id),
        { apropos: true }
      )

      if (!groupId) {
        continue
      }

      await aproposGroupSession(profile, groupId, label, list)
    }

    made += 1
  }

  return made
}

/** Copy text through whatever door the renderer has: the async clipboard first,
 *  a hidden textarea second. Returns false instead of throwing where neither
 *  exists (a headless window, a locked-down renderer). */
async function copyText(text) {
  const value = String(text ?? '')

  if (!value) {
    return false
  }

  try {
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)

      return true
    }
  } catch {
    /* fall through to the DOM path */
  }

  try {
    const area = document.createElement('textarea')

    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()

    const ok = document.execCommand('copy')

    document.body.removeChild(area)

    return Boolean(ok)
  } catch {
    return false
  }
}

/** Drop a child's Apropos link record. This is what makes a deleted child
 *  STAY deleted: `withAproposChildren` synthesizes a row for every link whose
 *  child the page does not carry, so a stale record is a row the user cannot
 *  get rid of — the delete either fails (core: 4007, no such session) or
 *  succeeds and the row is drawn again from the link on the next render.
 *  Pedro, 2026-10-10: "I cannot seem to delete some child sessions". */
function forgetApropos(profile, childId) {
  const scope = String(profile || '')
  const child = String(childId || '')

  if (!scope || !child || !aproposLinks?.[scope]?.[child]) {
    return false
  }

  const slice = { ...aproposLinks[scope] }

  delete slice[child]
  aproposLinks = normalizeApropos({ ...aproposLinks, [scope]: slice })
  $apropos.set(aproposLinks)
  persist(APROPOS_KEY, aproposLinks)

  return true
}

/** Take a session out of whatever group holds it, WITHOUT counting it as a
 *  release: a deleted session must not be pinned into the single list (see
 *  noteReleased). */
function unfileSession(profile, id) {
  const current = profileSessionGroups(sessionGroups, profile)
  const key = String(id || '')

  if (!key || !current.members[key]) {
    return false
  }

  const members = { ...current.members }

  delete members[key]
  patchProfileGroups(profile, { members })

  return true
}

/** A session is gone from core: every pane-side record of it goes with it.
 *  Order matters — the section map, the session group's members, the hide list
 *  and the link store are ALL read by the renderer, and any one left behind
 *  keeps saying something: a row (the link), a phantom member (the group), a
 *  wrong count (the hide). */
function forgetDeletedSession(profile, id, aliases) {
  // EVERY id the row answered to. A session deleted as its TIP is still stored
  // under the id its child link and its group filing were made with, so clearing
  // only the id in front of the user leaves a record that draws the chat again —
  // the "I cannot seem to delete some child sessions" bug.
  const keys = [
    ...new Set([String(id || ''), ...(Array.isArray(aliases) ? aliases : []).map(String)])
  ].filter(Boolean)

  for (const key of keys) {
    unfileSession(profile, key)
    // Out of its session group too. A deleted session left in a group's members
    // is invisible (the box only draws members it can see) but it still widens
    // every page fetch through wantedSessionIds, forever.
    moveSessionsToGroup(profile, [key], null)
    // A hidden id that can never render again only lies about "Show hidden (n)".
    setSessionHidden(profile, key, false)
    forgetApropos(profile, key)
  }
}

/** Right-click a session → Copy id: the stored session id, the string the
 *  gateway, the REST API and `session_search` all take. */
async function copySessionId(storedId) {
  const id = String(storedId || '')
  const ok = await copyText(id)

  host.notify({
    kind: ok ? 'success' : 'error',
    message: ok ? id : `Could not copy ${id}`,
    title: ok ? 'Session id copied' : 'Copy failed'
  })

  return ok
}

/** One write path for both link kinds, so normalizeApropos is the only place
 *  that decides what a link may look like. */
function writeApropos(profile, childId, entry) {
  const scope = String(profile)
  const child = String(childId)

  if (!scope || !child) {
    return
  }

  aproposLinks = normalizeApropos({
    ...aproposLinks,
    [scope]: { ...(aproposLinks[scope] || {}), [child]: entry }
  })
  $apropos.set(aproposLinks)
  persist(APROPOS_KEY, aproposLinks)
}

/** Remember the child→parent link for the chips. */
function rememberApropos(profile, childId, parentId, parentTitle) {
  writeApropos(profile, childId, {
    at: Date.now(),
    kind: 'session',
    label: String(parentTitle || ''),
    parent: String(parentId)
  })
}

/** Remember the child→group link: the heading's `→ n` chip. */
function rememberAproposGroup(profile, childId, groupId, label) {
  writeApropos(profile, childId, {
    at: Date.now(),
    groupId: String(groupId),
    kind: 'group',
    label: String(label || '')
  })
}

/** Guard against a double-fire (a menu item selected twice) creating two
 *  children for one keystroke of intent. */
const aproposInflight = new Set()

/** Right-click → Apropos: read the parent's durable transcript, seed ONE hidden
 *  digest row on a child that links back to it, then open the child. The digest
 *  is best-effort: a parent that never persisted still gets a link-only
 *  refresher rather than no feature at all. No transcript is read — the header
 *  is the whole seed. */
async function aproposSession(storedId, profile, title) {
  const parentId = String(storedId || '')
  const guard = `apropos|${String(profile)}|${parentId}`

  if (!parentId || aproposInflight.has(guard)) {
    return null
  }

  aproposInflight.add(guard)

  try {
    const parentTitle = String(title || parentId)
    const digest = buildAproposDigest({ profile, storedId: parentId, title: parentTitle })
    // NO `parent_session_id`. Core reads that as a BRANCH: it copies the parent's
    // whole transcript into the child, stamps `model_config._branched_from`, and
    // gives the child an auto title derived from the parent ("<parent> #2").
    // That is not what Apropos is — the child copies NOTHING and re-reads the
    // source itself — and it left the parent's own row looking like it had been
    // renamed or duplicated. Pedro, 2026-10-10: "When creating Apropos sessions,
    // do not change anything about the parent session, inside or outside the
    // group. It should remain visible, with the original name."
    const res = await host.request('session.create', {
      idempotency_key: `messenger-apropos-${parentId}-${Date.now().toString(36)}`,
      messages: [{ content: digest, display_kind: 'hidden', role: 'user' }],
      profile,
      title: `Apropos: ${clip(aproposSourceName(parentTitle), 60)}`
    })
    const childId = String(res?.stored_session_id || '')

    if (childId) {
      rememberApropos(profile, childId, parentId, parentTitle)
      await openSession(childId, profile, 'tab', CHILDLESS_OPEN)
    }

    return res
  } finally {
    aproposInflight.delete(guard)
  }
}

/** Re-home the session's workspace; the sidebar's grouping follows `cwd`. */
function moveSessionToProject(storedId, cwd, profile) {
  return host.request('session.workspace.move', { cwd, profile, session_key: String(storedId) })
}

/** The export payload, shaped like core's own session export. */
function exportPayload(storedId, title, history) {
  const messages = Array.isArray(history?.messages) ? history.messages : []

  return {
    exported_at: new Date().toISOString(),
    message_count: Number(history?.count ?? messages.length) || 0,
    messages,
    session_id: String(storedId),
    title: String(title || '')
  }
}

/** Save JSON through the renderer's own DOM — no backend, no restart. */
function downloadJson(filename, payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')

  anchor.download = filename
  anchor.href = url
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** `session.history` is the durable display transcript; hand it over as a file. */
async function exportSession(storedId, profile, title) {
  const history = await host.request('session.history', { profile, session_id: String(storedId) })
  const slug = String(title || storedId).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'session'

  downloadJson(`${slug}-${String(storedId).slice(0, 8)}.json`, exportPayload(storedId, title, history))

  return true
}

/** How deep a page the pane may widen to when a filed or linked session is
 *  missing from the inline page. 500 is the same page "View all" asks for. */
const SESSIONS_FILL_CAP = 500

/** Every session id the pane has a REASON to show, whatever its age: the members
 *  of its groups, and both ends of every Apropos link (the parent that must stay
 *  visible, the child it draws). */
function wantedSessionIds(profile) {
  const ids = new Set(Object.keys(profileSessionGroups(sessionGroups, profile).members || {}))
  const links = aproposLinks?.[String(profile)] || {}

  // A session the pane just released from a group must stay inside the page,
  // or the flat list could not draw it even though it is one row old news.
  for (const id of releasedFor(profile)) {
    ids.add(String(id))
  }

  for (const [childId, entry] of Object.entries(links)) {
    ids.add(String(childId))

    if (entry?.parent) {
      ids.add(String(entry.parent))
    }
  }

  return [...ids]
}

/** The next page size, or 0 when this page will do: every wanted id is already
 *  in it, or the listing ended (a page shorter than the limit it asked for), or
 *  the cap is reached. Pure, so the widening is testable without a gateway.
 *
 *  Why this exists: `session.list` is most-recent-first and the pane asked for
 *  `SESSIONS_PER_PROFILE`, so a session filed into a group could fall out of the
 *  page and VANISH from the box that claims it — the heading counted one while
 *  the box held two, and deleting anything newer brought it back. Pedro,
 *  2026-10-10: "it had two sessions inside, but only one was showing. Only after
 *  I deleted the first one, did the second one show up." */
function nextSessionLimit({ count, ids, limit, wanted }) {
  if (!wanted?.length || limit >= SESSIONS_FILL_CAP) {
    return 0
  }

  if (wanted.every(id => ids.has(String(id)))) {
    return 0
  }

  if (count < limit) {
    return 0
  }

  return Math.min(SESSIONS_FILL_CAP, Math.max(limit + 1, limit * 6))
}

/** `session.list` = most recent first, sub-agent/kanban sources already denied.
 *  The page is as small as it has always been unless something this profile
 *  filed or linked is missing from it, in which case it widens — a few requests
 *  at most, and none at all for a profile with no groups and no links. */
async function listProfileSessions(profile) {
  const wanted = wantedSessionIds(profile)
  const page = async limit => {
    const res = await host.request('session.list', { limit, profile })
    const raw = Array.isArray(res?.sessions) ? res.sessions : []

    return {
      count: raw.length,
      sessions: raw.filter(
        session => !NON_CONVERSATION_SOURCES.has(String(session?.source || '').trim().toLowerCase())
      )
    }
  }

  let limit = SESSIONS_PER_PROFILE
  let loaded = await page(limit)

  // 10 → 60 → 360 → 500, and only while something known is still missing.
  for (let step = 0; step < 4; step += 1) {
    const next = nextSessionLimit({
      count: loaded.count,
      ids: rowIdSet(loaded.sessions),
      limit,
      wanted
    })

    if (!next) {
      break
    }

    limit = next
    loaded = await page(limit)
  }

  return loaded.sessions
}

/** P7 "View all": every session this profile has, past the 20-row preview cap.
 *  `session.list` takes the limit as a parameter, so this needs no backend
 *  change; 500 is a page, not a promise — the header shows the real count. */
async function listAllSessions(profile) {
  const res = await host.request('session.list', { limit: 500, profile })

  return (Array.isArray(res?.sessions) ? res.sessions : []).filter(
    session => !NON_CONVERSATION_SOURCES.has(String(session?.source || '').trim().toLowerCase())
  )
}

/** P7 "View Archived": the one listing `session.list` cannot serve — its param
 *  whitelist is `title`/`limit`/`include_hidden`, so the archive comes from the
 *  pane's own backend (`/archived`, read-only, profile-scoped). A build without
 *  that route resolves to `null` and the view SAYS so, rather than drawing an
 *  empty archive over a reachable one. */
/** "View hidden": the pane's OWN list. There is nothing to ask the gateway
 *  for — hiding is a view (see HIDDEN_KEY), so the store IS the filter and the
 *  rows come from the same `session.list` the drill-down already reads. */
async function listHiddenSessions(profile) {
  const hidden = new Set(hiddenFor(profile).map(String))
  const all = await listAllSessions(profile)

  if (!Array.isArray(all)) {
    return []
  }

  return all.filter(session => hidden.has(String(session?.id || '')))
}

async function listArchivedSessions(profile) {
  const rest = ctxRef?.rest

  if (typeof rest !== 'function') {
    return null
  }

  let data

  try {
    data = await rest(`/archived?profile=${encodeURIComponent(profile)}&limit=60`)
  } catch {
    // A REACHABLE archive that errored is not an empty archive: both this and
    // the throwing case must read as "cannot tell", or the view claims there is
    // nothing archived while the archive is right there.
    return null
  }

  if (!data || data.error) {
    return null
  }

  return (Array.isArray(data.sessions) ? data.sessions : []).filter(
    session => !NON_CONVERSATION_SOURCES.has(String(session?.source || '').trim().toLowerCase())
  )
}

/** Load every expanded profile's sessions in one pass (the pane's query fn). */
/** Profiles whose last `session.list` threw. Module-level so the pane can NAME
 *  them: a profile that failed to load and a profile with nothing in it drew the
 *  same empty row, so a backend hiccup was indistinguishable from every session
 *  having vanished. */
const $loadFailures = atom([])

async function refreshSessions(names) {
  const failed = []
  const pairs = await Promise.all(
    names.map(async name => {
      try {
        return [name, await listProfileSessions(name)]
      } catch {
        // A profile whose backend is down draws no sessions rather than an
        // error — but silently drawing nothing reads as data loss, so the pane
        // names it in the row instead (see $loadFailures).
        failed.push(name)

        return [name, []]
      }
    })
  )

  $loadFailures.set(failed)

  return Object.fromEntries(pairs)
}

/** Flip a profile open/closed. The sessions themselves are the pane query's
 *  job (keyed by the open set), so this is a pure state flip. */
function toggleExpanded(profile) {
  const next = { ...expandedProfiles, [profile]: !expandedProfiles[profile] }

  expandedProfiles = next
  $expanded.set(next)
  persist(EXPANDED_KEY, normalizeExpanded(next))

  return Boolean(next[profile])
}

// ── components ──────────────────────────────────────────────────────────────

/** Profile picture: the profile's asset when it has one, else a deterministic
 *  colour chip carrying its initial (the app's own `profileColor` hue). */
function Avatar({ row, size = AVATAR_SIZE }) {
  // A colour the user picked in the editor beats the name-hash chip: the chip
  // has to agree with the editor's own preview, and with the row fill below it.
  const picked = fillOf(row)
  const color = picked || (row.isDefault ? null : profileColor(row.name))
  const asset = useQuery({
    queryKey: [ID, 'avatar', row.name],
    queryFn: () => host.request('profiles.get_asset', { asset: 'avatar', name: row.name }),
    // Only ask for profiles that HAVE one — `has_avatar` exists precisely so
    // rosters skip a probe per paint (methods_profiles.py).
    enabled: row.hasAvatar,
    // Short, NOT Infinity: the avatar is owned by the profile's asset store,
    // which the Bots pane writes too — a cached-forever icon is what made a
    // picture changed in Bots never reach this pane (Pedro, 2026-10-10: "the
    // changes are synced... it reflects on the other"). Cheap enough: only
    // profiles that HAVE an avatar query at all.
    staleTime: 15000,
    retry: false
  })
  const src = row.hasAvatar ? asset.data?.data : null
  // Inline, not a utility: the app's BotFace sets this radius as a style, so
  // there is no `rounded-[22%]` in the compiled stylesheet to reuse.
  const box = { borderRadius: AVATAR_RADIUS, height: size, width: size }

  if (src) {
    // `display:block` from BotFace — an inline <img> sits on the text baseline
    // and drifts the whole row a few pixels.
    return jsx('img', {
      alt: '',
      className: 'shrink-0 object-cover',
      src,
      style: { ...box, display: 'block' }
    })
  }

  return jsx('span', {
    'aria-hidden': 'true',
    className: 'flex shrink-0 items-center justify-center text-xs font-medium uppercase',
    style: {
      ...box,
      background: color ? profileColorSoft(color, 22) : 'var(--chrome-action-hover)',
      color: color || 'var(--ui-text-quaternary)'
    },
    children: (row.label || row.name || '?').slice(0, 1)
  })
}

/**
 * The groups a row can be filed into, offered as one flat menu (a submenu of
 * section names is more chrome than four groups deserve).
 *
 * `Item` is passed IN because the two menu families are not interchangeable:
 * radix's `createContextScope` provider writes its context into the CALLER's
 * scope array, so a `DropdownMenuItem` rendered inside a `ContextMenu` looks
 * up a `Menu` context that was never provided under its own scope and throws
 * `'MenuItem' must be used within 'Menu'` — the pane's right-click crash.
 * The row menu passes `ContextMenuItem`; a dropdown must pass
 * `DropdownMenuItem`. Never mix the families.
 */
function moveItems(row, model, Item) {
  const items = model.sections.map(section =>
    jsx(
      Item,
      { onSelect: () => moveToSection([row.name], section.id), children: section.name },
      `move-${section.id}`
    )
  )

  items.push(
    jsx(
      Item,
      { onSelect: () => moveToSection([row.name], UNASSIGNED), children: 'Unassigned' },
      'move-none'
    )
  )

  return items
}

/** The color picker inside the session menu's Appearance submenu. Its own
 *  component so only an OPEN submenu reads the color map, not every row. */
function ColorPicker({ profile, sessionId }) {
  const colors = useValue($sessionColors)

  return jsx(ColorSwatches, {
    clearLabel: 'Clear color',
    onChange: color => setSessionColor(profile, sessionId, color),
    swatches: PROFILE_SWATCHES,
    value: colors?.[profile]?.[sessionId] || null
  })
}

/** The group color picker inside the group header's menu. The same grid the
 *  session picker uses — a group color and a session color are one language.
 *  Its own component so only an OPEN menu reads the group store. */
function GroupColorPicker({ groupId, profile }) {
  const groups = useValue($sessionGroups)
  const group = profileSessionGroups(groups, profile).groups.find(entry => entry.id === groupId)

  return jsx(ColorSwatches, {
    clearLabel: 'No color',
    onChange: color => setSessionGroupColor(profile, groupId, color),
    swatches: PROFILE_SWATCHES,
    value: group?.color || null
  })
}

/** The project list inside "Assign to project": the per-profile `projects.db`,
 *  which is the same registry the sidebar's project tree reads. Own component
 *  for the same reason as the picker — and the only place here that asks. */
function ProjectPicker({ profile, sessionId }) {
  const projects = useQuery({
    queryKey: [...PROJECTS_KEY, profile],
    queryFn: async () => {
      const res = await host.request('projects.list', { profile })

      return Array.isArray(res?.projects) ? res.projects : []
    },
    retry: false,
    staleTime: 60000
  })
  const rows = projects.data || []

  if (!rows.length) {
    return jsx('div', {
      className: 'px-2 py-1 text-xs text-(--ui-text-quaternary)',
      children: projects.isPending ? 'Loading projects…' : 'No projects'
    })
  }

  return jsxs('div', {
    className: 'grid min-w-0 grid-cols-1',
    children: rows.map(project =>
      jsx(
        ContextMenuItem,
        {
          onSelect: () => {
            const cwd = projectCwd(project)

            return cwd ? moveSessionToProject(sessionId, cwd, profile) : undefined
          },
          children: project.name || project.slug || project.id
        },
        `project-${project.id}`
      )
    )
  })
}

/** One session row — a search match or a line under an expanded profile — with
 *  the full session menu. Every verb rides a gateway RPC (see session verbs). */
/** Boilerplate a gateway preview can start with: an injected continuation
 *  block, an Apropos seed, a reaction envelope, a scheduled-run banner. None of
 *  it is a session's name, and a row labelled with one cannot be found again. */
const PREVIEW_BOILERPLATE = [
  /^\[CONTEXT COMPACTION/i,
  /^\[STILL IN PROGRESS/i,
  /^\[Apropos/i,
  /^\[The user reacted/i,
  /^\[IMPORTANT:/i,
  /^\[OUT-OF-BAND USER MESSAGE/i
]

/** The human part of a preview, or '' when there is none. Pure. */
function humanPreview(preview) {
  const text = String(preview || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) {
    return ''
  }

  return PREVIEW_BOILERPLATE.some(pattern => pattern.test(text)) ? '' : text
}

/** A session's visible name: its title, else the human first line of its
 *  preview, else 'Untitled session' — NEVER a raw id and never an injected
 *  block. Every compaction mints a fresh row whose title the generator writes a
 *  moment later, so a title-less tip is normal for a while; it must still read
 *  as a session the user recognizes (Pedro, 2026-10-10: "the actual session is
 *  not in any of the rows"). Pure, so the harness pins the three shapes. */
function sessionLabel(session) {
  const title = String(session?.title || '').trim()

  if (title) {
    return title
  }

  const preview = humanPreview(session?.preview)

  return preview ? preview.slice(0, 96) : 'Untitled session'
}

function SessionRow({
  dropSide,
  dropTarget,
  dragging,
  editing,
  nowMs,
  onRename,
  onRenameCancel,
  onDragStart,
  onRenameSubmit,
  onCreateAproposGroup,
  onRightClickSelect,
  onSelect,
  onToggleSelect,
  group,
  groups,
  onMoveGroup,
  onNewGroup,
  profile,
  selected,
  selecting,
  session,
  // Is this row inside an Apropos group? The mark on its name depends on it.
  aproposGroup
}) {
  const colors = useValue($sessionColors)
  const storedId = String(session?.id || '')
  const openId = String(session?.resolved_id || storedId)
  const title = sessionLabel(session)
  const color = colors?.[profile]?.[storedId] || null
  // Apropos chips: the child points at its parent, the parent counts its
  // children. Read here (a hook) so only a rendered row subscribes.
  const links = useValue($apropos)
  // Pane-local hiding, read in the row so a hidden row draws its own chip and
  // offers the way back without the profile list re-rendering for it.
  const hiddenState = useValue($hiddenSessions)
  const hidden = (hiddenState[String(profile)] || []).includes(storedId)
  const parentLink = linkForRow(links, profile, session)
  const childCount = childrenOfRow(links, profile, session)
  // Two marks, ONE slot, before the name — where the eye lands:
  //   ◆  this row is a source an Apropos child consults. It is inside an Apropos
  //      group, so dropping an existing session into that box earns it the mark
  //      too (the box is the membership).
  //   ↳  this row IS that child: the curved hook says "derived, not original".
  // Pedro, 2026-10-10: "put a diamond icon next to all sessions that are being
  // referenced… When creating an Apropos child inside an apropos group, put the
  // curved hook arrow before the name."
  const groupedChild = Boolean(
    parentLink &&
      parentLink.kind === 'group' &&
      group &&
      String(parentLink.groupId) === String(group)
  )
  const mark = groupedChild ? '↳' : aproposGroup ? '◆' : ''
  // Which channel this conversation arrived on ('' = the app's own surfaces).
  const channel = channelLabel(session?.source)
  const age = ageLabel(secondsToMs(session?.last_active || session?.started_at), nowMs)
  // The delete confirm is LOCAL to the row: it is one row's question, asked
  // where the user just clicked. The pane has no modal (and the SDK hands out no
  // dialog), so an inline strip is the whole confirmation.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // A refusal is the one thing the row must show: "it will not delete" is not
  // actionable, the gateway's own sentence is.
  const [deleteError, setDeleteError] = useState('')

  // Inline rename, the same field the group heading uses (NameField commits on
  // Enter, cancels on blur/Escape). After the hooks, so the order is stable.
  if (editing) {
    return jsx(NameField, {
      initial: title,
      label: 'Session name',
      onCancel: onRenameCancel,
      onSubmit: onRenameSubmit
    })
  }

  // Deleting cannot be undone (core drops the row AND its transcripts), so it
  // asks in the row itself. Two buttons, no dialog: the same reason the pane
  // renames in place.
  if (confirmDelete) {
    const runDelete = async () => {
      setDeleting(true)
      setDeleteError('')

      let failed = ''

      try {
        // `openId` matters: a live session may be registered under its runtime
        // id while the stored id is what `session.delete` refuses on. The row
        // knows both (Pedro, 2026-10-10: "Allow deletion of active session").
        const done = await deleteSessionChain({ openId, profile, session_id: storedId })

        if (!done) {
          failed = 'Delete failed'
        }
      } catch (error) {
        failed = String(error?.message || error || 'Delete failed')
        host.notifyError?.(failed)
      }

      setDeleting(false)

      // A refusal keeps the strip open, with the reason in it. Closing it on
      // failure is what made "I cannot seem to delete" impossible to diagnose:
      // the row looked untouched and the cause was gone with the strip.
      if (failed) {
        setDeleteError(failed)

        return
      }

      setConfirmDelete(false)
    }

    return jsxs('div', {
      className:
        'flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1.5',
      children: [
        jsx('span', {
          className: 'min-w-0 truncate text-[0.6875rem] text-(--ui-text-tertiary)',
          children: 'Delete this session and its transcripts?'
        }, 'ask'),
        jsxs('div', {
          className: 'flex items-center gap-0.5',
          children: [
            jsx(
              Button,
              { onClick: () => setConfirmDelete(false), size: 'sm', variant: 'ghost', children: 'Cancel' },
              'cancel'
            ),
            jsx(
              Button,
              { disabled: deleting, onClick: runDelete, size: 'sm', variant: 'destructive', children: 'Delete' },
              'delete'
            )
          ]
        }, 'actions'),
        deleteError
          ? jsx('span', {
              className: 'min-w-0 flex-1 truncate text-[0.6875rem] text-destructive',
              title: deleteError,
              children: deleteError
            }, 'why')
          : null
      ]
    })
  }

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, {
        asChild: true,
        // The grip sits BESIDE the row button, never inside it. The button is a
        // clipping flex row (its title cell truncates), and a trailing child of a
        // clipped row is the first thing to vanish — which is exactly why the
        // group heading's grip was on screen and this row's never was. Same shape
        // as SectionHeading: the wrapper owns [button, grip].
        children: jsxs('div', {
          // The row — not just the button inside it — owns the drop id. While a
          // grip is held the pointer is over the GRIP, which sits beside the
          // button, so a target read from `closest('[data-drop-session]')` alone
          // found nothing here and the drop fell through as null. (elementAt also
          // falls back to the nearest row, for the gutters between rows.)
          'data-drop-session': storedId,
          'data-session-row': '',
          'data-item-drag': selecting || !onDragStart ? undefined : 'session',
          className: 'flex min-w-0 items-center',
          // Pedro's item-first drag: hold the row and move. In select mode the
          // press is a TICK, so the gesture is off entirely there.
          onPointerDown: event => {
            // A right-click is a context-menu request, so it also SELECTS:
            // pointerdown (button 2) rather than onContextMenu, because Radix's
            // trigger owns that prop on this element and would overwrite ours.
            if (event?.button === 2) {
              onRightClickSelect?.(sessionKey(profile, storedId))
            }

            itemDragStart(
              event,
              { group, id: storedId, kind: 'session', profile },
              selecting ? null : onDragStart
            )
          },
          children: [
            jsxs(RowButton, {
          'aria-label': title,
          'data-drop-profile': profile,
          'data-drop-session': storedId,
          'data-selected': selected ? 'true' : undefined,
          'data-session': storedId,
          className: cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-md pl-4 pr-2 text-left text-xs text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)',
            // The row being carried reads as lifted, so the grip the user is
            // holding is visibly attached to something.
            dragging && 'opacity-60'
          ),
          // +25% row height: py-1 is 4px, so 7px. `style`, not a class — 7px has
          // no compiled utility in the app stylesheet, and the class whitelist
          // (tests/classes.mjs) rejects inventing one.
          //
          // The insertion bar is a box-shadow, never a border: a border would
          // change this row's height by 2px the moment the pointer arrived, and
          // every row below would shift — the "whole list moves" the user was
          // describing. `--ui-accent` is the token this pane already uses.
          style: {
            boxShadow: dropTarget
              ? `inset 0 ${dropSide === 'before' ? '' : '-'}2px 0 0 var(--ui-accent)`
              : undefined,
            paddingBottom: 7,
            paddingTop: 7
          },
          // In select mode the row's whole job flips: it ticks instead of
          // opening. (The menu still opens a session — a right-click is an
          // explicit act, never a mis-tick.)
          onClick: guardClick(selecting ? () => onToggleSelect() : () => openSession(openId, profile)),
          children: [
            selecting
              ? jsx(
                  Codicon,
                  {
                    className: 'shrink-0 text-(--ui-text-quaternary)',
                    name: selected ? 'check' : 'circle-outline'
                  },
                  'tick'
                )
              : null,
            jsx(SessionStatusDot, { storedSessionId: storedId }),
            // A message-body match: the text beside it is the MESSAGE the needle
            // was found in, not the session title, so the glyph says why it is
            // here.
            session?.body
              ? jsx(Codicon, { className: 'shrink-0 text-(--ui-text-quaternary)', name: 'comment-discussion' })
              : null,
            // The Apropos mark, BEFORE the name and OUTSIDE the truncating
            // cell: a mark that scrolls away with a long title is not a mark.
            mark
              ? jsx(
                  'span',
                  {
                    'data-row-mark': groupedChild ? 'child' : 'source',
                    className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: mark
                  },
                  'mark'
                )
              : null,
            // The name carries the picked color. `style`, not a class: a
            // user-chosen hex has no compiled utility to reuse.
            jsx('span', {
              className: 'min-w-0 flex-1 truncate',
              style: color ? { color } : undefined,
              children: title
            }),
            // The channel chip: a Telegram / WhatsApp / Discord session says so,
            // in the same muted micro-type the profile row's "default" badge
            // uses. No chip for the app's own surfaces (see channelLabel).
            channel
              ? jsx(
                  'span',
                  {
                    className:
                      'shrink-0 rounded-sm px-1 text-[0.625rem] uppercase text-(--ui-text-quaternary)',
                    children: channel
                  },
                  'channel'
                )
              : null,
            // The Apropos chip: `↩ parent` on a child, `→ n` on a parent. The
            // same muted micro-type as the channel chip, and the same reason it
            // is a span and not a button — the row's own button owns the click.
            // Inside its own Apropos group the hook already says where this row
            // came from, so the chip would only repeat it.
            parentLink && !groupedChild
              ? jsx(
                  'span',
                  {
                    'data-apropos-parent': parentLink.parent,
                    className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: `↩ ${clip(parentLink.label || parentLink.parent, 24)}`
                  },
                  'apropos-parent'
                )
              : null,
            childCount
              ? jsx(
                  'span',
                  {
                    'data-apropos-children': String(childCount),
                    className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: `→ ${childCount}`
                  },
                  'apropos-children'
                )
              : null,
            hidden
              ? jsx(
                  'span',
                  {
                    'data-session-hidden': storedId,
                    className:
                      'shrink-0 rounded-sm px-1 text-[0.625rem] uppercase text-(--ui-text-quaternary)',
                    children: 'hidden'
                  },
                  'hidden-chip'
                )
              : null,
            age
              ? jsx('span', { className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)', children: age })
              : null,
            // Re-ordering sessions is a drag-job too: the row IS the handle (the
            // pointerdown above arms it past a threshold), so the click still
            // opens the session and a list you re-sort by accident is worse than
            // a list that never moves. Pedro, 2026-10-10: "remove the grip icons
            // from the sessions and the profiles" — the grip was a second left
            // edge in every row and the item-first drag had made it redundant.
          ]
            }),
            // No grip where there is no drag wiring (the drill-down list).
          ]
        })
      }),
      jsx(ContextMenuContent, {
        children: [
          // Pedro's ordering, 2026-10-10: ONE NOUN PER SUBMENU, one verb inline,
          // and the two pickers last. Top level reads as a table of contents:
          // Select · Open · Session · Apropos · Group · Appearance · Project.
          jsx(
            ContextMenuItem,
            { onSelect: () => onSelect(), children: 'Select' },
            'select-session'
          ),
          // 2. Open
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: 'Open' }, 'open-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => openSession(openId, profile, 'window'), children: 'In new window' },
                        'open-window'
                      ),
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => openSession(openId, profile, 'tab', INTENT_OPEN), children: 'In new tab' },
                        'open-tab'
                      )
                    ]
                  },
                  'open-body'
                )
              ]
            },
            'open-sub'
          ),
          // 3. Session — everything that acts on THIS transcript.
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: 'Session' }, 'session-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => markSessionUnreadFinished(storedId, profile), children: 'Mark as unread' },
                        'unread'
                      ),
                      jsx(ContextMenuItem, { onSelect: () => onRename(session, profile), children: 'Rename…' }, 'rename'),
                      jsx(ContextMenuItem, { onSelect: () => branchSession(storedId, profile), children: 'Branch' }, 'branch'),
                      // The stored id is the key every other door takes: the
                      // gateway RPCs, the REST API, and `session_search(session_id=…)`.
                      jsx(ContextMenuItem, { onSelect: () => copySessionId(storedId), children: 'Copy id' }, 'copy-id'),
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => exportSession(storedId, profile, title), children: 'Export…' },
                        'export'
                      ),
                      // Hiding is the pane's own view filter, never a core
                      // mutation: the session keeps living in the Sessions tab, so
                      // this is the reversible half of Archive.
                      jsx(
                        ContextMenuItem,
                        {
                          onSelect: () => setSessionHidden(profile, storedId, !hidden),
                          children: hidden ? 'Unhide in Personae' : 'Hide from Personae'
                        },
                        'hide-session'
                      ),
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => archiveSession(storedId, profile), children: 'Archive' },
                        'archive'
                      ),
                      // Last, behind a separator, and destructive: it is the one
                      // verb here that cannot be undone, and a slip on a
                      // neighbouring item must not reach it. Core's own
                      // destructive menu language — `variant` reddens the label
                      // AND tints the icon, exactly like the Sessions tab's trash
                      // button (Pedro, 2026-10-10).
                      jsx(ContextMenuSeparator, {}, 'sep-delete'),
                      jsx(
                        ContextMenuItem,
                        {
                          onSelect: () => setConfirmDelete(true),
                          variant: 'destructive',
                          children: [
                            jsx(Codicon, { name: 'trash' }, 'icon'),
                            jsx('span', { children: 'Delete session…' }, 'label')
                          ]
                        },
                        'delete-session'
                      )
                    ]
                  },
                  'session-body'
                )
              ]
            },
            'session-sub'
          ),
          // 4. Apropos (On that topic) — the topic refresher, at both weights.
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: 'Apropos (On that topic, beta)' }, 'apropos-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      // 4.1 the classic single-session refresher: a child that
                      // can consult THIS transcript, with no group and no bloat.
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => aproposSession(storedId, profile, title), children: 'From this session' },
                        'apropos-session'
                      ),
                      // 4.2 the group flavour: ALWAYS a group, even for one
                      // session (Pedro, 2026-10-10: "if a single session is
                      // selected, a new apropos group is created with the selected
                      // session, inside. if multiple are selected, all are put
                      // inside the apropos group"). It acts on the TICK SET,
                      // which the right-click rule has already made real.
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => onCreateAproposGroup(), children: 'Create group' },
                        'apropos-group'
                      )
                    ]
                  },
                  'apropos-body'
                )
              ]
            },
            'apropos-sub'
          ),
          // 5. Group — filing, and only filing.
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: 'Group' }, 'group-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => onNewGroup(), children: 'New session group' },
                        'new-session-group'
                      ),
                      groups && groups.length
                        ? jsxs(
                            ContextMenuSub,
                            {
                              children: [
                                jsx(ContextMenuSubTrigger, { children: 'Move to group' }, 'moveto'),
                                jsx(
                                  ContextMenuSubContent,
                                  {
                                    children: [
                                      ...groups.map(entry =>
                                        jsx(
                                          ContextMenuItem,
                                          {
                                            onSelect: () => onMoveGroup(sessionMoveTarget(storedId, entry.id)),
                                            children: entry.name
                                          },
                                          `moveto-${entry.id}`
                                        )
                                      ),
                                      group
                                        ? jsx(
                                            ContextMenuItem,
                                            {
                                              onSelect: () => onMoveGroup(sessionMoveTarget(storedId, null)),
                                              children: 'Ungrouped'
                                            },
                                            'moveto-none'
                                          )
                                        : null
                                    ]
                                  },
                                  'moveto-body'
                                )
                              ]
                            },
                            'moveto-sub'
                          )
                        : null
                    ]
                  },
                  'group-body'
                )
              ]
            },
            'group-sub'
          ),
          // 6. Appearance — as it was.
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: 'Appearance' }, 'appearance'),
                jsx(
                  ContextMenuSubContent,
                  { children: jsx(ColorPicker, { profile, sessionId: storedId }) },
                  'appearance-body'
                )
              ]
            },
            'appearance-sub'
          ),
          // 7. Assign to project — as it was.
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: 'Assign to project' }, 'project'),
                jsx(
                  ContextMenuSubContent,
                  { children: jsx(ProjectPicker, { profile, sessionId: storedId }) },
                  'project-body'
                )
              ]
            },
            'project-sub'
          )
        ]
      })
    ]
  })
}

/** One session-group heading inside a profile's expanded list: caret + name +
 *  count, a grip for re-ordering, and a kebab carrying the only two verbs that
 *  act on the group as a noun. It sits beside the session rows rather than
 *  above them the way a profile group does — same arrangement, one level down. */
/** The group's verbs, defined ONCE, rendered into BOTH menus.
 *  The kebab and the header's right-click menu are the same menu reached two
 *  ways; a verb on only one of them is a verb the user cannot find. Pedro,
 *  2026-10-10: "For groups options in the right-click menu and the three dot
 *  menu should be identical, so color options, delete group, etc. should show up
 *  on both menus".
 *
 *  The SDK ships no `DropdownMenuSub` family, so the colour is a ROW of swatches
 *  in the menu body on both sides rather than a submenu on one of them — same
 *  options, same order, whichever way the menu was opened. */
function sessionGroupMenuEntries({
  apropos,
  canApropos,
  groupCount,
  index,
  onApropos,
  onDelete,
  onMove,
  onRename
}) {
  return [
    { key: 'rename', label: 'Rename…', onSelect: onRename },
    // The verb a drag cannot promise: with one group, or with the pointer
    // nowhere near another heading, there is nothing to drop onto — and a drag
    // that finds no target is a gesture that did nothing. Same pair the
    // profile-section headings have.
    { key: 'up', label: 'Move up', disabled: index <= 0, onSelect: () => onMove(-1) },
    {
      key: 'down',
      label: 'Move down',
      disabled: index < 0 || index >= groupCount - 1,
      onSelect: () => onMove(1)
    },
    // The group-level sibling of the session row's Apropos: one child seeded
    // with a digest of every member. On an Apropos group this is "start ANOTHER
    // child" (Pedro, 2026-10-10: "Right-clicking the header allows the user to
    // create a new child session.").
    {
      key: 'apropos',
      // One verb, two names, because it is two different acts to the user: on a
      // plain group this is what MAKES it an Apropos group (the diamond appears
      // on it and on its members, which join the digest); on one that already
      // is, the same call starts another child. Pedro, 2026-10-10: "The header
      // options should have 'new child session'."
      label: apropos ? 'New child session (beta)' : 'Apropos this group (beta)',
      disabled: !canApropos,
      onSelect: onApropos,
      separatorBefore: true
    },
    // Deleting a heading is never deleting sessions: its members fall back into
    // the flat list (see deleteSessionGroup). Destructive, like the session
    // delete, and hidden from neither menu.
    {
      key: 'delete',
      label: 'Delete group',
      onSelect: onDelete,
      separatorBefore: true,
      variant: 'destructive',
      icon: 'trash'
    }
  ]
}

/** Render those entries in ONE menu family. `Item` is passed as a family NAME
 *  and not a component because the two families are not interchangeable:
 *  radix's context provider writes into the CALLER's scope, so a
 *  `DropdownMenuItem` inside a `ContextMenu` throws `'MenuItem' must be used
 *  within 'Menu'` (see moveItems). */
function groupMenuNodes(family, entries) {
  const Item = family === 'context' ? ContextMenuItem : DropdownMenuItem
  const Separator = family === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
  const nodes = []

  for (const entry of entries) {
    if (entry.separatorBefore) {
      nodes.push(jsx(Separator, {}, `${entry.key}-sep`))
    }

    nodes.push(
      jsx(
        Item,
        {
          disabled: entry.disabled,
          onSelect: entry.onSelect,
          variant: entry.variant,
          children:
            entry.children ||
            (entry.icon
              ? [jsx(Codicon, { name: entry.icon }, 'icon'), jsx('span', { children: entry.label }, 'label')]
              : entry.label)
        },
        entry.key
      )
    )
  }

  return nodes
}

/** The group's colour, as a row inside its menu. Both menus carry it, and the
 *  same store is written either way (setSessionGroupColor validates the swatch
 *  before it can reach `color-mix()`). */
function GroupColorRow({ groupId, profile }) {
  return jsxs('div', {
    className: 'px-1 pt-1 pb-1.5',
    children: [
      jsx(
        'div',
        {
          className:
            'px-1 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)',
          children: 'Group color'
        },
        'label'
      ),
      jsx(
        'div',
        { 'data-group-color': groupId, children: jsx(GroupColorPicker, { groupId, profile }, 'picker') },
        'pick'
      )
    ]
  })
}

function SessionGroupHeading({
  block,
  dragging,
  dropTarget,
  groupCount,
  index,
  onApropos,
  onDelete,
  onDragStart,
  onMove,
  onRename,
  onToggle,
  profile
}) {
  // How many Apropos children this group has started. A hook, so only a
  // rendered heading subscribes (see aproposGroupCount).
  const links = useValue($apropos)
  const aproposCount = aproposGroupCount(links, profile, block.id)
  // The header IS the boxes' handle: left-click collapses it (the button),
  // right-click colors the group. Same wrapper-owns-the-trigger shape as
  // SessionRow, so the grip stays a sibling of the button, not a child of it.
  const entries = sessionGroupMenuEntries({
    apropos: block.apropos === true,
    canApropos: block.sessions.length > 0,
    groupCount,
    index,
    onApropos: () => onApropos(block),
    onDelete,
    onMove,
    onRename
  })
  // The header IS the boxes' handle: left-click collapses it (the button),
  // right-click colours the group. Same wrapper-owns-the-trigger shape as
  // SessionRow, so the grip stays a sibling of the button, not a child of it.
  const header = jsxs('div', {
    'data-drop-session-group': block.id,
    'data-item-drag': onDragStart ? 'sessionGroup' : undefined,
    className: cn(
      'flex min-w-0 items-center rounded-md pl-1 pr-1',
      dropTarget && 'bg-(--ui-row-active-background)',
      dragging && 'opacity-60'
    ),
    onPointerDown: event =>
      itemDragStart(event, { group: block.id, kind: 'sessionGroup', profile }, onDragStart),
    children: [
      jsxs(RowButton, {
        'aria-expanded': block.collapsed ? 'false' : 'true',
        className:
          'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
        onClick: guardClick(() => onToggle(block.id)),
        children: [
          jsx(DisclosureCaret, { open: !block.collapsed }, 'caret'),
          // An Apropos group is a NORMAL session group that also carries a
          // generated child, and the diamond is the whole difference on screen.
          // Pedro, 2026-10-10: "create a new apropos group, just like a normal
          // session group, but with a diamond icon next to the name in the
          // header." A character, not a Codicon: no icon font to gamble on, and
          // it needs no compiled class.
          block.apropos
            ? jsx(
                'span',
                {
                  'aria-label': 'Apropos group',
                  'data-apropos-group': block.id,
                  className: 'shrink-0',
                  children: '◆'
                },
                'diamond'
              )
            : null,
          jsx('span', { className: 'min-w-0 flex-1 truncate', children: block.name }, 'name'),
          // Same muted micro-type as the session row's chips: `→ n` children
          // started from this group.
          aproposCount
            ? jsx(
                'span',
                {
                  'data-apropos-group-children': String(aproposCount),
                  className: 'shrink-0 text-[0.625rem]',
                  children: `→ ${aproposCount}`
                },
                'apropos-group-children'
              )
            : null,
          jsx('span', { className: 'shrink-0 tabular-nums', children: String(block.sessions.length) }, 'count')
        ]
      }),
      // No grip on a group heading. The header itself is the handle (the
      // pointerdown above arms the drag), and a grip in the heading was both
      // clutter and a second, competing left edge next to the caret. Pedro,
      // 2026-10-10: "remove the grip icons from the group headers".
      jsxs(DropdownMenu, {
        children: [
          jsx(DropdownMenuTrigger, {
            asChild: true,
            children: jsx(Button, {
              'aria-label': `${block.name} group`,
              className: 'rounded-md text-(--ui-text-tertiary) hover:text-foreground',
              size: 'icon-xs',
              variant: 'ghost',
              children: jsx(Codicon, { name: 'kebab-vertical' })
            })
          }),
          jsx(DropdownMenuContent, {
            align: 'end',
            children: [
              ...groupMenuNodes('dropdown', entries),
              jsx(GroupColorRow, { groupId: block.id, profile }, 'colour')
            ]
          }, 'sg-menu')
        ]
      }, 'sg-kebab')
    ]
  })

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children: header }, 'trigger'),
      // The same menu, the context-menu way: identical entries, identical
      // colour row (see sessionGroupMenuEntries).
      jsx(
        ContextMenuContent,
        {
          children: [
            ...groupMenuNodes('context', entries),
            jsx(GroupColorRow, { groupId: block.id, profile }, 'colour')
          ]
        },
        'sg-menu'
      )
    ]
  })
}

/** One roster row, shaped like a Bots row. */
function ProfileRow({
  editingSession,
  expanded,
  row,
  sessionOrder,
  hits,
  isCurrent,
  nowMs,
  drag,
  dropAt,
  onDragStart,
  renamingGroup,
  onCreateAproposGroup,
  onDeleteGroup,
  onMoveGroup,
  onNewGroup,
  onRenameGroup,
  onRenameGroupCancel,
  onRenameGroupSubmit,
  onToggleGroup,
  onRenameCancel,
  onRenameSession,
  onRenameSubmit,
  loadFailed,
  onEditProfile,
  onOpen,
  onRightClickSelect,
  onSelect,
  onToggle,
  onMoveGroupOrder,
  onToggleSelect,
  onView,
  scope,
  selectedKeys,
  selecting,
  sessions,
  showHidden,
  t,
  onToggleHidden
}) {
  // Session groups are per profile, and this hook is what redraws the list when
  // one is created, renamed, filed into or emptied.
  const groupState = useValue($sessionGroups)
  const groupSlice = profileSessionGroups(groupState, row.name)
  // Sessions just taken out of a group: this row is the list they land in, so
  // it redraws the moment one is released (see noteReleased).
  const releasedState = useValue($released)
  // The sort mode and the Apropos links are subscribed here for the same reason
  // the group state is: this row IS the profile's session list, and a menu pick
  // (or a child created in another window) must redraw it without waiting for
  // the 5s poll.
  useValue($sessionSort)
  // A hand-coloured session row is the one thing that outranks this profile's
  // fill, so the row's own list has to redraw when a colour changes (the row
  // reads it through `sessionColor`, not through a prop).
  useValue($sessionColors)
  const links = useValue($apropos)
  const sortMode = sessionSortMode(row.name)
  const age = ageLabel(row.lastActiveMs, nowMs)
  const subtitle = row.preview || (row.messages ? '' : 'no sessions yet')
  const shown = (hits || []).slice(0, SESSIONS_PER_ROW)
  // Expanded shows the profile's own recent sessions; collapsed shows what the
  // search found. The session list wins when both apply — opening a row is an
  // explicit act, and the search hits are one keystroke away again.
  // The list the user dragged into shape wins over recency — but only the
  // profile's own sessions: search hits keep the relevance order they came in.
  const listed = expanded
    ? withAproposChildren(
        sortProfileSessions(sessions || [], sortMode, sessionOrder?.[row.name]),
        links,
        row.name
      )
    : shown
  // Hiding is a VIEW, not a mutation (see HIDDEN_KEY): the pane filters its own
  // list, core's session list is untouched, and the row is one click away from
  // coming back. Pedro, 2026-10-10: "hiding only hides it from view in the
  // Messenger tab, not from Sessions."
  const hiddenState = useValue($hiddenSessions)
  const hiddenIds = new Set(hiddenState[String(row.name)] || [])
  const hiddenCount = listed.filter(session => hiddenIds.has(String(session?.id))).length
  const revealed = Boolean(showHidden?.[row.name])
  const visible = revealed ? listed : listed.filter(session => !hiddenIds.has(String(session?.id)))
  const extra = expanded ? 0 : (hits || []).length - shown.length
  // Only the EXPANDED list is grouped: a search-hit list is about the needle,
  // not about filing — and `sessionGroupBlocks` hands back a single anonymous
  // block when there are no groups, which is the flat list it has always been.
  const groupBlocks = expanded
    ? sessionGroupBlocks(visible, groupState, row.name, releasedState[String(row.name)] || [])
    : [{ collapsed: false, id: null, name: '', sessions: visible }]
  // The colour this profile's rows are filled with — his pick in the editor, and
  // NOTHING unless he picked one (see fillOf: "fill is opt-in").
  const fill = fillOf(row)

  return jsxs('div', {
    'data-drop-profile': row.name,
    'data-drop-scope': scope,
    'data-profile': row.name,
    children: [
      jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, {
            asChild: true,
            // Same shape as the group heading, and now the session row: the grip
            // is the wrapper's second child, NOT a child of the row button. As the
            // button's trailing child it was clipped away by the button's own
            // `overflow-hidden` and never reached the screen.
            children: jsxs('div', {
              'data-item-drag': 'profile',
              'data-profile-row': '',
              // The fill starts on the profile's OWN row and runs on through the
              // flat list under it (see sessionGroupShell) — one colour per
              // profile, readable at a glance. The row buttons keep their hover
              // and active washes on top: the tint is on the box, never on a row.
              className: cn('flex min-w-0 items-center rounded-md'),
              style: fill ? { background: profileColorSoft(fill, 22) } : undefined,
              // Same item-first gesture as the session row: hold the profile and
              // move to re-file or re-order it. A press that does not move is
              // still the disclosure click.
              onPointerDown: event =>
                itemDragStart(
                  event,
                  { kind: 'profile', name: row.name, section: scope },
                  onDragStart
                ),
              children: [
                jsxs(RowButton, {
              'aria-expanded': expanded ? 'true' : 'false',
              'aria-label': subtitle || row.label,
              className: cn(
                'flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-md px-2 py-2.5 text-left transition-colors',
                'hover:bg-(--chrome-action-hover)',
                // `--ui-row-active-background` is what the Bots rail paints its
                // active row with — the current profile IS the active row. The
                // same wash marks the row a drag would land on.
                isCurrent && 'bg-(--ui-row-active-background)',
                dropAt?.profile === row.name && 'bg-(--ui-row-active-background)',
                drag?.kind === 'profile' && drag.name === row.name && 'opacity-60'
              ),
              // Same insertion bar as a session row: the wash says WHERE, the bar
              // says on which SIDE of it the block will land.
              style: {
                boxShadow:
                  drag?.kind === 'profile' && dropAt?.profile === row.name
                    ? `inset 0 ${dropAt?.profileSide === 'before' ? '' : '-'}2px 0 0 var(--ui-accent)`
                    : undefined
              },
              // A LEFT click IS the disclosure: expand into the recent sessions,
              // collapse again on the next click. Opening is the row menu's job
              // (`Open newest session`), so a click can never mint tabs the user
              // did not ask for — and clicking an expanded row folds it, which is
              // what the caret has always looked like it would do.
              onClick: guardClick(() => onToggle(row.name)),
              children: [
                // The disclosure caret is the button's FIRST cell, never its
                // last. A clipping box eats its TAIL, which is exactly why this
                // caret used to vanish at narrow widths — it sat after `age`, at
                // the end of the name line, inside the button's overflow-hidden.
                // Leading, it survives any pane width, and a click on the arrow
                // is still a click on the button, which is the collapse the
                // arrow promises. The group headings were always built this way.
                jsx(DisclosureCaret, { open: expanded }, 'caret'),
                // `min-w-0` + the default flex-shrink let the picture be cropped
                // when the row cannot fit its chrome; it gives BEFORE the caret
                // and the grip do.
                jsx('div', { className: 'min-w-0 overflow-hidden', children: jsx(Avatar, { row }) }),
                jsxs('div', {
                  className: 'min-w-0 flex-1',
                  children: [
                    jsxs('div', {
                      className: 'flex items-baseline justify-between gap-2',
                      children: [
                        jsxs('div', {
                          className: 'flex min-w-0 items-center gap-1.5',
                          children: [
                            // The lead cell, exactly where the Bots rail puts
                            // it: first thing on the name line, which is what
                            // holds every name on one left edge.
                            jsx(SidebarRowLead, {
                              children: jsx(SessionStatusDot, { storedSessionId: row.sessionId })
                            }),
                            jsx('span', {
                              className: 'min-w-0 truncate font-medium',
                              // Bigger than the rail's 13px (0.8125rem): 15px,
                              // matching the enlarged avatar. `style`, not a
                              // class — 15px has no compiled utility here.
                              style: { fontSize: '15px' },
                              children: row.label
                            }),
                            row.isDefault
                              ? jsx('span', {
                                  // Shrinkable and truncatable: the badge is a
                                  // hint, never the reason the row stops fitting.
                                  className:
                                    'min-w-0 shrink truncate rounded-sm px-1 text-[0.625rem] uppercase text-(--ui-text-quaternary)',
                                  children: 'default'
                                })
                              : null
                          ]
                        }),
                        age
                          ? jsx('span', {
                              className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                              children: age
                            })
                          : null
                      ]
                    }),
                    jsx('div', {
                      className: 'flex min-w-0 items-center gap-1.5 text-xs text-(--ui-text-tertiary)',
                      children: [
                        jsx('span', { className: 'min-w-0 truncate', children: subtitle }, 'subtitle'),
                        // Same slot the session count uses: a row that failed to
                        // load must not look like a row with nothing in it.
                        loadFailed
                          ? jsx(
                              'span',
                              {
                                className: 'shrink-0',
                                style: { color: 'var(--destructive, #e5484d)' },
                                children: "· couldn't load sessions"
                              },
                              'load-failed'
                            )
                          : null
                      ]
                    })
                  ]
                }),
              ]
                }),
              ]
            })
          }),
          jsx(ContextMenuContent, {
            children: [
              jsx(
                ContextMenuItem,
                { onSelect: () => newSession(row.name), children: 'New session' },
                'new-session'
              ),
              // Same dialog Bots offers, writing the same places — see
              // EditProfileDialog.
              jsx(
                ContextMenuItem,
                { onSelect: () => onEditProfile(row), children: 'Edit profile\u2026' },
                'edit-profile'
              ),
              // Pedro, 2026-10-09: "group options should not be listed in the
              // menu" — a profile's menu is about its PROFILES' sessions, so it
              // holds session verbs only. Renaming, deleting and moving a group is
              // the group heading's kebab, where the noun matches the verb.
              jsx(
                ContextMenuItem,
                {
                  onSelect: () => openProfileSessions(row, sessions),
                  children: 'Open newest session'
                },
                'open-newest'
              ),
              jsx(
                ContextMenuItem,
                { onSelect: () => dockSessions(row, sessions), children: 'Open all in tabs' },
                'open-all'
              ),
              jsx(ContextMenuSeparator, {}, 'sep-sort'),
              // Pedro, 2026-10-10: "allow sorting of sessions, manually, by last
              // activity and others. That can be an option when right-clicking
              // on a profile". A submenu, because the menu is a list of actions
              // and this is one action with four settings.
              jsxs(
                ContextMenuSub,
                {
                  children: [
                    jsx(ContextMenuSubTrigger, { children: 'Sort sessions' }, 'sort-trigger'),
                    jsx(
                      ContextMenuSubContent,
                      {
                        children: SESSION_SORT_MODES.map(mode =>
                          jsx(
                            ContextMenuItem,
                            {
                              onSelect: () => setSessionSort(row.name, mode),
                              children: `${mode === sortMode ? '✓ ' : ''}${SESSION_SORT_LABELS[mode]}`
                            },
                            `sort-${mode}`
                          )
                        )
                      },
                      'sort-content'
                    )
                  ]
                },
                'sort-sessions'
              ),
              hiddenCount
                ? jsx(
                    ContextMenuItem,
                    {
                      onSelect: () => onToggleHidden(row.name),
                      children: `${revealed ? '✓ ' : ''}Show hidden (${hiddenCount})`
                    },
                    'show-hidden'
                  )
                : null,
              hiddenCount && revealed
                ? jsx(
                    ContextMenuItem,
                    { onSelect: () => unhideAll(row.name), children: `Unhide all (${hiddenCount})` },
                    'unhide-all'
                  )
                : null
            ]
          })
        ]
      }),
      ...groupBlocks.flatMap(block => {
        const parts = [
          block.id
            ? renamingGroup?.id === block.id
              ? jsx(
                  NameField,
                  {
                    initial: block.name,
                    label: 'Session group name',
                    onCancel: onRenameGroupCancel,
                    onSubmit: name => onRenameGroupSubmit(block.id, name)
                  },
                  `sg-rename-${block.id}`
                )
              : jsx(
 SessionGroupHeading,
 {
   block,
   dragging:
     drag?.kind === 'sessionGroup' && String(drag.group) === String(block.id),
   dropTarget: dropAt?.sessionGroup === block.id,
   groupCount: groupBlocks.length,
   index: groupBlocks.findIndex(candidate => candidate.id === block.id),
   onDelete: () => onDeleteGroup(block.id),
   onDragStart,
   onMove: delta => onMoveGroupOrder(block.id, delta),
                    // "Apropos this group" makes it an Apropos group and STOPS
                    // there — the flag is what puts ◆ on its members (see
                    // markSessionGroupApropos), and nothing is generated. On a
                    // group that already is one the same slot reads "New child
                    // session" and seeds one from the group's SOURCES (its
                    // members minus the children it already holds).
                    onApropos: () => {
                      if (aproposVerbKind(block.apropos) === 'convert') {
                        markSessionGroupApropos(row.name, block.id)

                        return null
                      }

                      return aproposGroupSession(
                        row.name,
                        block.id,
                        block.name,
                        aproposSources({
                          groupId: block.id,
                          links: $apropos.get(),
                          profile: row.name,
                          sessions: block.sessions
                        })
                      )
                    },
                                        onRename: () => onRenameGroup({ id: block.id, name: block.name }),
                    onToggle: onToggleGroup,
                    profile: row.name
                  },
                  `sg-${block.id}`
                )
            : null,
          block.collapsed
            ? null
            : block.sessions.map(session =>
                // The user's own colour for THIS session outranks the
                // profile fill and the group tint (Pedro, 2026-10-10: the
                // fill "is overridden ... also by session colors"). Wrapped,
                // not painted on the row, for the hover reason above.
                sessionColorBox(
                  sessionColor(row.name, session.id),
                  jsx(
                    SessionRow,
                    {
                      editing: Boolean(
                        editingSession &&
                          editingSession.profile === row.name &&
                          String(editingSession.id) === String(session.id)
                      ),
                      aproposGroup: block.apropos === true,
                      group: block.id,
                      groups: groupSlice.groups,
                      nowMs,
                      onRename: onRenameSession,
                      onRenameCancel,
                      onRenameSubmit: name => onRenameSubmit(row.name, session.id, name),
                      dragging: drag?.kind === 'session' && String(drag.id) === String(session.id),
                      dropSide: dropAt?.sessionSide,
                      dropTarget: String(dropAt?.session || '') === String(session.id),
                      onDragStart,
                      // Right-click selects THIS row (the selection its menu then
                      // acts on). The handler lives in the pane, so it has to be
                      // threaded down to the row that owns the pointerdown.
                      onRightClickSelect,
                      // Pass-through: SessionRow builds the payload (sessionMoveTarget)
                      // and this handler IS the payload consumer — naming its args
                      // (sessionId, groupId) was the arity bug that made moving a
                      // session into a group a silent no-op.
                      onMoveGroup,
                      onCreateAproposGroup: () =>
                        onCreateAproposGroup({
                          profile: row.name,
                          session_id: String(session.id),
                          title: String(session.title || session.preview || session.id)
                        }),
                      onNewGroup: () => onNewGroup([session.id]),
                      onSelect: () => onSelect(row.name, session.id),
                      onToggleSelect: () => onToggleSelect(sessionKey(row.name, session.id)),
                      profile: row.name,
                      selected: (selectedKeys || []).includes(sessionKey(row.name, session.id)),
                      selecting,
                      session
                    },
                    // The key rides on BOTH the wrapper and the row: with no
                    // session colour the wrapper is skipped entirely (`return
                    // node`), and an unkeyed element in the list is what makes
                    // React warn about keys.
                    `sess-${row.name}-${session.id}`
                  ),
                  `sess-${row.name}-${session.id}`
                )
              )
        ].filter(Boolean)

        return sessionGroupShell(
          block,
          parts,
          drag?.kind === 'sessionGroup' && String(drag.group) === String(block.id),
          fill
        )
      }),
      // P7 (Pedro's item 1): the expanded list is capped at
      // SESSIONS_PER_PROFILE, so its last line is where the rest of the profile
      // lives — "View all" (every session) with "View Archived" beside it. Only
      // the EXPANDED list carries it: these buttons describe the profile's whole
      // history, and a search-hit list is a different thing entirely.
      expanded
        ? jsxs(
            'div',
            {
              className: 'flex min-w-0 flex-wrap items-center gap-1 pb-1.5 pl-4',
              children: [
                jsx(
                  'button',
                  {
                    className:
                      'rounded-sm px-1.5 py-1 text-[0.6875rem] text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
                    onClick: () => onView(row.name, 'all'),
                    type: 'button',
                    children: t('viewAll')
                  },
                  'view-all'
                ),
                jsx(
                  'button',
                  {
                    className:
                      'rounded-sm px-1.5 py-1 text-[0.6875rem] text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
                    onClick: () => onView(row.name, 'archived'),
                    type: 'button',
                    children: t('viewArchived')
                  },
                  'view-archived'
                ),
                // Pedro, 2026-10-10: "next to View All and View Archives,
                // include a View hidden option for the hidden sessions from
                // messenger, and allow the user to unhide them."
                hiddenCount
                  ? jsx(
                      'button',
                      {
                        className:
                          'rounded-sm px-1.5 py-1 text-[0.6875rem] text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
                        onClick: () => onView(row.name, 'hidden'),
                        type: 'button',
                        children: `${t('viewHidden')} (${hiddenCount})`
                      },
                      'view-hidden'
                    )
                  : null
              ]
            },
            'view-footer'
          )
        : null,
      extra > 0
        ? jsx('div', {
            className: 'px-2 py-1 pl-4 text-[0.6875rem] text-(--ui-text-quaternary)',
            children: `${extra} more`
          })
        : null
    ]
  })
}

/** A group heading: caret + name + count in the row button, kebab beside it
 *  (a button inside a button is not a thing the DOM allows). */
/** The drag handle — the answer to Pedro's "isn't there a way to get rid of the
 *  click in that situation?". Dragging lives on this grip alone, so a drag can
 *  never be mistaken for the click that opens a row, and the row keeps a plain
 *  click. `stopPropagation` on the pointerdown keeps the row's own handlers out
 *  of the gesture entirely. */
// ── item-first drag ─────────────────────────────────────────────────────────
// Pedro, 2026-10-10: "can you make DnD activate by holding the actual item
// (session, profile, group), instead of needing a grip icon?"
//
// The item IS also a button — a session row opens a session, a profile row
// folds, a heading collapses — so a drag must not steal the click. Hence:
// press the item, and the gesture arms only once the pointer has MOVED a few
// pixels. Below the threshold nothing happens at all and the click lands as
// always; past it the drag takes over and the click that follows the release is
// swallowed. The grip stays where it was: same gesture, zero threshold.

/** Movement (px, Manhattan) that turns a press on an item into a drag. Small
 *  enough to feel immediate, large enough that a click never becomes one. */
const ITEM_DRAG_THRESHOLD = 5

/** The pure half of the gesture — has the pointer moved far enough to be a drag? */
function dragArmed(dx, dy) {
  return Math.abs(Number(dx) || 0) + Math.abs(Number(dy) || 0) >= ITEM_DRAG_THRESHOLD
}

/** Module-level, not React state: a drag that just ended must be able to swallow
 *  the click that follows it, and that click arrives before any re-render could
 *  have carried the flag there. `busy` is set while a drag is in flight, so a
 *  second press cannot re-arm the gesture on top of one already running. */
const itemDrag = { busy: false, moved: false }

/** Wrap an item's own click so the release of a drag is not also a click. */
function guardClick(run) {
  return event => {
    if (itemDrag.moved) {
      event?.preventDefault?.()
      event?.stopPropagation?.()

      return undefined
    }

    return run?.(event)
  }
}

/** Press an item → arm the drag once the pointer moves. Nothing to return: the
 *  listeners live on `window` and take themselves off on release (the pointer
 *  leaves the item immediately — that is where the user is heading). */
function itemDragStart(event, next, startDrag) {
  if (!event || typeof window === 'undefined' || !startDrag || itemDrag.busy) {
    return
  }

  // A drag is the LEFT button only — the same rule the grip learned the hard
  // way: a right-click on a grip used to reorder a row while its menu opened.
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return
  }

  // The grip is the same gesture with no threshold, and its own handler already
  // ran (and stopped propagation): never arm twice for one press.
  if (event.target?.closest?.('[data-drag-grip]')) {
    return
  }

  const x0 = Number(event.clientX) || 0
  const y0 = Number(event.clientY) || 0
  let armed = false
  const move = moveEvent => {
    if (armed || !dragArmed(moveEvent.clientX - x0, moveEvent.clientY - y0)) {
      return
    }

    armed = true
    itemDrag.moved = true
    window.removeEventListener('pointermove', move, true)
    startDrag(moveEvent, next)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', stop, true)
    window.removeEventListener('pointercancel', stop, true)
    // The click that ends THIS gesture fires in the same task; a timer runs
    // after it. So the flag is still up when the click arrives, and a later
    // click — a real one — is never swallowed.
    setTimeout(() => {
      itemDrag.moved = false
    }, 0)
  }

  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', stop, true)
  window.addEventListener('pointercancel', stop, true)
}

function DragGrip({ label, onStart }) {
  return jsx('span', {
    'aria-label': label,
    // Marks the grip for the item-first gesture, which must not ALSO arm on a
    // press the grip already owns (itemDragStart bails on this marker).
    'data-drag-grip': '',
    className: 'shrink-0 cursor-grab text-(--ui-text-quaternary)',
    // A drag is the LEFT button only. Any other button used to start a gesture
    // whose pointerup then committed a drop — a right-click on a grip reordered
    // a row while its context menu opened. `touchAction` is inline because the
    // app stylesheet has no compiled `touch-none` utility (tests/classes.mjs).
    style: { touchAction: 'none' },
    onClick: event => event.stopPropagation(),
    onPointerDown: event => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onStart(event)
    },
    role: 'button',
    // `size` matches the app's own handle (tree-group.tsx): the icon is a font
    // glyph, and an explicit size is what keeps it off whatever the surrounding
    // line-height happens to be.
    children: jsx(Codicon, { name: 'gripper', size: '0.8125rem' })
  })
}

/** The section (profile-group) verbs, defined ONCE and rendered into BOTH of its
 *  menus. Pedro, 2026-10-10: "For groups options in the right-click menu and the
 *  three dot menu should be identical". The section heading had only a kebab, so
 *  right-clicking a group did nothing at all — now both ways in open the same
 *  list, in the same order. */
function sectionMenuEntries({ active, index, onAdd, onDelete, onMove, onRename, onSort, scopeCount }) {
  const entries = SORT_MODES.map(mode => ({
    children: [
      // The SDK exports the menu family with no checkbox item, so the active
      // mode is marked by a glyph in the slot the label would otherwise start
      // at — same width either way, so the labels stay on one left edge.
      jsx(
        'span',
        { className: 'w-3 shrink-0 text-(--ui-text-tertiary)', children: mode === active ? jsx(Codicon, { name: 'check' }) : null },
        'mark'
      ),
      jsx('span', { className: 'min-w-0 flex-1 truncate', children: SORT_LABELS[mode] }, 'label')
    ],
    key: `sort-${mode}`,
    onSelect: () => onSort(mode)
  }))

  entries.push(
    { disabled: index === 0, key: 'up', label: 'Move up', onSelect: () => onMove(-1), separatorBefore: true },
    { disabled: index >= scopeCount - 1, key: 'down', label: 'Move down', onSelect: () => onMove(1) },
    { key: 'add', label: 'Add profiles…', onSelect: onAdd, separatorBefore: true },
    { key: 'rename', label: 'Rename…', onSelect: onRename },
    // Deleting a group never deletes anything inside it (see deleteSection) —
    // its profiles fall back to Unassigned — but it is the verb that takes a
    // heading away, so it wears the same destructive dress the session delete
    // does and sits last on both menus.
    {
      key: 'delete',
      label: 'Delete group',
      onSelect: onDelete,
      separatorBefore: true,
      variant: 'destructive',
      icon: 'trash'
    }
  )

  return entries
}

/** The group kebab owns every GROUP verb: this scope's sort mode, the group's
 *  own position, who is in it, its name, its life. Pedro, 2026-10-09: the profile
 *  menu must not list group options — so they live here, where the noun matches
 *  the verb, instead of there, where they buried the session actions. */
function SectionHeading({
  block,
  dropTarget,
  index,
  onAddProfiles,
  onDelete,
  onDragStart,
  onMove,
  onRename,
  onSort,
  scopeCount,
  sort
}) {
  const active = SORT_MODES.includes(sort) ? sort : 'activity'
  const entries = sectionMenuEntries({
    active,
    index,
    onAdd: () => onAddProfiles(block),
    onDelete: () => onDelete(block),
    onMove,
    onRename: () => onRename(block),
    onSort,
    scopeCount
  })
  // The header IS the handle: left-click folds it (the button), right-click opens
  // the same menu the kebab does. The grip stays a SIBLING of the button, not a
  // child of it (a clipping row eats its tail — see drag-and-drop §2).
  const header = jsxs('div', {
    'data-drop-group': block.id,
    'data-item-drag': onDragStart ? 'group' : undefined,
    className: cn('flex min-w-0 items-center', dropTarget && 'bg-(--ui-row-active-background)'),
    onPointerDown: event => itemDragStart(event, { id: block.id, kind: 'group' }, onDragStart),
    children: [
      jsxs(RowButton, {
        'aria-expanded': block.collapsed ? 'false' : 'true',
        'data-group': block.id,
        className:
          'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
        onClick: guardClick(() => toggleCollapsed(block.id)),
        children: [
          jsx(DisclosureCaret, { open: !block.collapsed }),
          jsx('span', { className: 'min-w-0 flex-1 truncate', children: block.name }),
          jsx('span', { className: 'shrink-0 tabular-nums', children: String(block.rows.length) })
        ]
      }),
      // No grip: the header is the handle, exactly like the session-group
      // heading and the session row (Pedro, 2026-10-10: grips off sessions and
      // profiles). It stays a SIBLING slot of the button only for the kebab.
      jsxs(DropdownMenu, {
        children: [
          jsx(DropdownMenuTrigger, {
            asChild: true,
            children: jsx(Button, {
              'aria-label': `${block.name} group`,
              className: 'rounded-md text-(--ui-text-tertiary) hover:text-foreground',
              size: 'icon-xs',
              variant: 'ghost',
              children: jsx(Codicon, { name: 'kebab-vertical' })
            })
          }),
          jsx(DropdownMenuContent, { align: 'end', children: groupMenuNodes('dropdown', entries) }, 'sg-menu')
        ]
      })
    ]
  })

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children: header }, 'trigger'),
      // The same entries, the context-menu way: identical options, identical
      // order, whichever way the menu was opened.
      jsx(ContextMenuContent, { children: groupMenuNodes('context', entries) }, 'section-menu')
    ]
  })
}

/** "Add profiles…", the half of the old "Move to…" list that is a GROUP verb.
 *  Pedro, 2026-10-09: the profile menu must not list group options — but filing a
 *  profile into a group still has to be possible without a drag, so the picker
 *  lives on the group that receives them. Clicking a row toggles membership;
 *  nothing is committed until the member map is written. */
function AddProfilesDialog({ onClose, onToggle, open, profiles, section }) {
  return jsxs(Dialog, {
    onOpenChange: value => {
      if (!value) {
        onClose()
      }
    },
    open,
    children: [
      jsx(DialogContent, {
        className: 'max-w-sm',
        children: jsxs('div', {
          className: 'grid gap-3',
          children: [
            jsxs(DialogHeader, {
              children: [
                jsx(DialogTitle, {
                  className: 'truncate text-sm',
                  children: section ? `Add profiles to "${section.name}"` : 'Add profiles'
                }),
                jsx(DialogDescription, {
                  className: 'text-xs',
                  children: 'Click a profile to file it in — click again to file it out.'
                })
              ]
            }),
            jsx('div', {
              className: 'grid max-h-72 gap-0.5 overflow-y-auto',
              children: (profiles || []).map(profile =>
                jsxs(
                  RowButton,
                  {
                    className:
                      'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-(--chrome-action-hover)',
                    onClick: () => onToggle(profile.name),
                    children: [
                      jsx(
                        'span',
                        {
                          className: 'w-3 shrink-0 text-(--ui-text-tertiary)',
                          children: profile.inside ? jsx(Codicon, { name: 'check' }) : null
                        },
                        'mark'
                      ),
                      jsx(
                        'span',
                        { className: 'min-w-0 flex-1 truncate text-xs', children: profile.label || profile.name },
                        'label'
                      )
                    ]
                  },
                  `add-${profile.name}`
                )
              )
            })
          ]
        })
      })
    ]
  })
}

/** Inline name field: a group is named in place, not through a dialog.
 *  Enter commits; blur and Escape cancel (a stray click must not silently
 *  create a group out of half-typed text). */
/** One inline name for every naming job in the pane (a new session group, a
 *  rename, a new profile group). A tiny FORM, and it never throws the typed
 *  text away:
 *
 *  - blur COMMITS a non-empty name and only cancels an empty one. It used to
 *    cancel unconditionally, so anything that moved focus for a moment — a
 *    stray click, the 5s roster re-render, a menu closing — silently discarded
 *    both the name and the group that was about to be created with it. That is
 *    the shape of "if I try to create a second session group, it doesn't work".
 *  - the explicit button lets the name land on a click that is its own gesture,
 *    so the flow does not depend on a focus state surviving a menu close.
 *  Enter commits, Escape cancels, both as before. Pedro, 2026-10-10. */
function NameField({ initial, label, onCancel, onSubmit, submitLabel }) {
  const [text, setText] = useState(String(initial || ''))
  const commit = () => {
    if (String(text || '').trim()) {
      onSubmit(String(text).trim())
    } else {
      onCancel()
    }
  }

  return jsxs('div', {
    className: 'mx-1.5 my-0.5 flex min-w-0 items-center gap-1',
    children: [
      jsx(
        Input,
        {
          'aria-label': label,
          autoFocus: true,
          className: 'min-w-0 flex-1 text-xs',
          onChange: event => setText(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') {
              commit()
            } else if (event.key === 'Escape') {
              onCancel()
            }
          },
          placeholder: label,
          value: text
        },
        'input'
      ),
      jsx(
        Button,
        {
          disabled: !String(text || '').trim(),
          onClick: commit,
          size: 'sm',
          variant: 'secondary',
          children: submitLabel || 'OK'
        },
        'commit'
      )
    ]
  })
}

/** Placeholder rows at the REAL row geometry, so nothing jumps on load. */
function LoadingRows() {
  return jsx('div', {
    className: LIST_CLASS,
    children: [0, 1, 2].map(i =>
      jsxs(
        'div',
        {
          className: 'flex items-center gap-2.5 px-2 py-2.5',
          children: [
            jsx(Skeleton, {
              className: 'shrink-0',
              style: { borderRadius: AVATAR_RADIUS, height: AVATAR_SIZE, width: AVATAR_SIZE }
            }),
            jsxs('div', {
              className: 'flex min-w-0 flex-1 flex-col gap-1.5',
              children: [jsx(Skeleton, { className: 'h-3 w-1/2' }), jsx(Skeleton, { className: 'h-3 w-3/4' })]
            })
          ]
        },
        `skeleton-${i}`
      )
    )
  })
}

/**
 * bell · + (new session) · folder+ (new group) — the Bots toolbar's order.
 * Every child of a literal array carries a key: an unkeyed array remounts its
 * children on the next render, and this pane re-renders every 5s.
 */
/** The batch bar. It replaces nothing: it appears under the toolbar while
 *  select mode is on, and every verb in it acts on the whole tick set. `status`
 *  is the last batch's own receipt ("3 closed · 1 failed") and stays where the
 *  action happened instead of drifting off as a toast. */
function SelectBar({ armed, busy, count, onApropos, onArchive, onClear, onClose, onDelete, onDone, onSelectAll, status, t }) {
  const none = count === 0 || busy

  return jsxs('div', {
    className: 'flex min-w-0 flex-wrap items-center justify-between gap-2 px-2.5 pt-1 pb-1.5',
    children: [
      jsx(
        'span',
        {
          className: 'min-w-0 truncate text-[0.6875rem] text-(--ui-text-quaternary)',
          children: status || `${count} ${t('selected')}`
        },
        'count'
      ),
      jsxs(
        'div',
        {
          // Wraps rather than widens: five labelled verbs have a min-content
          // width of their own, and it must never become the pane's.
          className: 'flex flex-wrap items-center justify-end gap-0.5',
          children: [
            jsx(Button, { onClick: onSelectAll, size: 'sm', variant: 'ghost', children: t('selectAll') }, 'all'),
            jsx(Button, { disabled: none, onClick: onClear, size: 'sm', variant: 'ghost', children: t('clear') }, 'clear'),
            // Apropos over the whole tick set: the batch becomes ONE topic
            // refresher (or one per profile if the ticks span several).
            jsx(Button, { disabled: none, onClick: onApropos, size: 'sm', variant: 'ghost', children: t('apropos') }, 'apropos'),
            jsx(Button, { disabled: none, onClick: onClose, size: 'sm', variant: 'ghost', children: t('close') }, 'close'),
            jsx(Button, { disabled: none, onClick: onArchive, size: 'sm', variant: 'ghost', children: t('archive') }, 'archive'),
            // Delete is irreversible, so it ARMS on the first press and fires on
            // the second; the label says how many transcripts the second press
            // takes with it.
            jsx(
              Button,
              {
                disabled: none,
                onClick: onDelete,
                size: 'sm',
                variant: 'ghost',
                children: armed ? `${t('delete')} ${count}?` : t('delete')
              },
              'delete'
            ),
            jsx(Button, { onClick: onDone, size: 'sm', variant: 'ghost', children: t('done') }, 'done')
          ]
        },
        'verbs'
      )
    ]
  })
}

function Toolbar({ onBell, onNewGroup, onSelect, rows, selecting, shownCount, t, toasts }) {
  return jsxs('div', {
    className: 'flex min-w-0 items-center justify-between gap-2 px-2.5 pt-2.5 pb-1.5',
    children: [
      jsxs(
        'div',
        {
          className: 'flex min-w-0 items-baseline gap-1.5',
          children: [
            jsx(
              'span',
              {
                className:
                  'min-w-0 truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)',
                children: t('paneTitle')
              },
              'title'
            ),
            // The roster size sits beside the name, with the bell / + — it used
            // to be a footer line of its own under the filter row.
            jsx(
              'span',
              {
                className: 'min-w-0 shrink truncate text-[0.6875rem] text-(--ui-text-quaternary)',
                children: `${shownCount}/${rows.length} ${t('profilesLabel')}`
              },
              'count'
            )
          ]
        },
        'heading'
      ),
      jsxs(
        'div',
        {
          // shrink-0: these four glyph buttons are the row's whole affordance —
          // the title beside them is what gives.
          className: 'flex shrink-0 items-center gap-0.5',
          children: [
            rows.length
              ? jsx(
                  Tip,
                  {
                    label: selecting ? t('selectOff') : t('selectOn'),
                    children: jsx(Button, {
                      'aria-label': t('select'),
                      'aria-pressed': selecting ? 'true' : 'false',
                      className: 'rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                      onClick: onSelect,
                      size: 'icon-xs',
                      variant: 'ghost',
                      children: jsx(Codicon, { name: 'checklist' })
                    })
                  },
                  'select-toggle'
                )
              : null,
            jsx(
              Tip,
              {
                label: toasts ? t('toastsOn') : t('toastsOff'),
                children: jsx(Button, {
                  'aria-label': t('toasts'),
                  className: 'rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                  onClick: onBell,
                  size: 'icon-xs',
                  variant: 'ghost',
                  children: jsx(Codicon, { name: toasts ? 'bell' : 'bell-slash' })
                })
              },
              'bell'
            ),
            rows.length
              ? jsxs(
                  DropdownMenu,
                  {
                    children: [
                      jsx(Tip, {
                        label: t('newSession'),
                        children: jsx(DropdownMenuTrigger, {
                          asChild: true,
                          children: jsx(Button, {
                            'aria-label': t('newSession'),
                            className: 'rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                            size: 'icon-xs',
                            variant: 'ghost',
                            children: jsx(Codicon, { name: 'add' })
                          })
                        })
                      }),
                      jsx(DropdownMenuContent, {
                        align: 'end',
                        children: rows.map(row =>
                          jsxs(
                            DropdownMenuItem,
                            {
                              // The sidebar's own per-profile "+" door: starts a
                              // draft on that profile and spins its backend up in
                              // the background.
                              onSelect: () => host.newChat(row.name),
                              children: [
                                jsx(Codicon, { className: 'mr-1.5', name: 'hubot' }, 'glyph'),
                                row.label
                              ]
                            },
                            `new-${row.name}`
                          )
                        )
                      })
                    ]
                  },
                  'new-session'
                )
              : null,
            jsx(
              Tip,
              {
                label: t('newGroup'),
                children: jsx(Button, {
                  'aria-label': t('newGroup'),
                  className: 'rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                  onClick: onNewGroup,
                  size: 'icon-xs',
                  variant: 'ghost',
                  children: jsx(Codicon, { name: 'new-folder' })
                })
              },
              'new-group'
            )
          ]
        },
        'actions'
      )
    ]
  })
}

function FilterMenu({ activity, kind, onActivity, onKind, onProfiles, profiles, rows, t }) {
  const count = (kind === 'all' ? 0 : 1) + (activity === 'all' ? 0 : 1) + (profiles.length ? 1 : 0)

  return jsxs(DropdownMenu, {
    children: [
      jsx(Tip, {
        label: count ? t('filtersActive', count) : t('filters'),
        children: jsx(DropdownMenuTrigger, {
          asChild: true,
          children: jsx(Button, {
            'aria-label': t('filters'),
            className: cn(
              'size-7 shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground',
              count && 'text-(--ui-accent)'
            ),
            size: 'icon-xs',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'list-filter' })
          })
        })
      }),
      jsx(DropdownMenuContent, {
        align: 'end',
        children: [
          ...[
            ['all', t('anySessions')],
            ['withSessions', t('withSessions')],
            ['noSessions', t('noSessions')]
          ].map(([value, label]) =>
            jsxs(
              DropdownMenuItem,
              {
                onSelect: () => onKind(value),
                children: [
                  jsx('span', { className: 'min-w-0 flex-1', children: label }),
                  kind === value ? jsx(Codicon, { name: 'check' }) : null
                ]
              },
              `kind:${value}`
            )
          ),
          jsx(DropdownMenuSeparator, {}, 'sep-kind'),
          ...[
            ['all', t('anyActivity')],
            ['active', t('activeNow')],
            ['recent', t('recentlyActive')],
            ['older', t('older')]
          ].map(([value, label]) =>
            jsxs(
              DropdownMenuItem,
              {
                onSelect: () => onActivity(value),
                children: [
                  jsx('span', { className: 'min-w-0 flex-1', children: label }),
                  activity === value ? jsx(Codicon, { name: 'check' }) : null
                ]
              },
              `activity:${value}`
            )
          ),
          jsx(DropdownMenuSeparator, {}, 'sep-activity'),
          jsxs(
            DropdownMenuItem,
            {
              onSelect: () => onProfiles([]),
              children: [
                jsx(Codicon, { className: 'mr-1.5', name: 'globe' }),
                jsx('span', { className: 'min-w-0 flex-1', children: t('allProfiles') }),
                profiles.length ? null : jsx(Codicon, { name: 'check' })
              ]
            },
            'all-profiles'
          ),
          // The profile axis — narrow the pane, and the session sweep with it.
          ...rows.map(row =>
            jsxs(
              DropdownMenuItem,
              {
                onSelect: () =>
                  onProfiles(
                    profiles.includes(row.name)
                      ? profiles.filter(name => name !== row.name)
                      : [...profiles, row.name]
                  ),
                children: [
                  jsx('span', { className: 'min-w-0 flex-1 truncate', children: row.label }),
                  profiles.includes(row.name) ? jsx(Codicon, { name: 'check' }) : null
                ]
              },
              `profile:${row.name}`
            )
          )
        ]
      })
    ]
  })
}

/** Human schedule, in Bot Mode's own vocabulary (`hermes-bots/cron.tsx::scheduleLabel`):
 *  a pane that prints "0 6 * * *" where Bot Mode says "Daily" reads as a different job. */
function scheduleLabel(schedule) {
  const raw = String(schedule || '').trim()
  const once = /^once in (.+)$/.exec(raw)

  if (once) {
    return once[1]
  }

  const bare = /^(\d+)([mhd])$/.exec(raw)

  if (bare) {
    return `once in ${bare[1]}${bare[2]}`
  }

  const every = /^every (\d+)m$/.exec(raw)

  if (every) {
    const minutes = Number(every[1])

    if (minutes % 1440 === 0) {
      const days = minutes / 1440

      return days === 1 ? 'daily' : `every ${days} days`
    }

    if (minutes % 60 === 0) {
      const hours = minutes / 60

      return hours === 1 ? 'hourly' : `every ${hours} hours`
    }

    return `every ${minutes}m`
  }

  return raw
}

/** Relative time in BOTH directions and in the coarse unit Bots prints
 *  ("in 3 hr", "2 hr ago"). Core's `relativeTime` is not on the plugin SDK. */
const REL_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

function relTime(targetMs, nowMs) {
  const diff = targetMs - nowMs
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1

  if (abs < 60000) {
    return REL_TIME.format(sign * Math.round(abs / 1000), 'second')
  }

  if (abs < 3600000) {
    return REL_TIME.format(sign * Math.round(abs / 60000), 'minute')
  }

  if (abs < 86400000) {
    return REL_TIME.format(sign * Math.round(abs / 3600000), 'hour')
  }

  return REL_TIME.format(sign * Math.round(abs / 86400000), 'day')
}

/** A cron timestamp as an age ("2 hr ago"); null when the job never carried one. */
function stampAge(value, nowMs) {
  const ms = value ? Date.parse(String(value)) : NaN

  return Number.isFinite(ms) ? relTime(ms, nowMs) : null
}

/** Bots' portal tone (`screen-portal.tsx::portalTone`), minus the lease half
 *  this window can never hold: a plugin pane never attaches a screen viewer,
 *  so a human holding the lease reads as "someone has control", never "you". */
function screenTone(status, unavailable) {
  if (unavailable) {
    return 'unavailable'
  }

  if (!status) {
    return 'unknown'
  }

  if (!status.supported) {
    return 'unsupported'
  }

  if (!status.installed) {
    return 'missing'
  }

  if (!status.running) {
    return 'off'
  }

  return status.lease?.holder === 'human' ? 'other' : 'live'
}

/** A `display.*` method-not-found is a settled answer (this Hermes has no
 *  Screen at all), not an offline bot: the hero disappears instead of sitting
 *  in "connecting" forever. Same test as the SDK's `isDisplayUnavailable`. */
function displayMissing(error) {
  if (error?.code === -32601) {
    return true
  }

  return /method not found|method-not-found/i.test(String(error?.message || ''))
}

/** The live thumbnail: one JPEG every few seconds while the screen runs, kept
 *  up through a failed refresh but dimmed past the third miss, so a dead
 *  gateway cannot keep looking live. Frames stop arriving while a human holds
 *  the lease — a deliberate answer (`suppressed`), not a stale one. */
function ScreenHero({ profile }) {
  const t = usePluginI18n(ID)
  const status = useQuery({
    queryKey: ['messenger', 'screen', profile],
    queryFn: () => host.request('display.status', { profile }),
    refetchInterval: 15000,
    retry: false,
    staleTime: 5000
  })
  const tone = screenTone(status.data || null, displayMissing(status.error))
  const live = tone === 'live' || tone === 'other'
  const frame = useQuery({
    queryKey: ['messenger', 'screen-frame', profile],
    queryFn: () => host.request('display.thumbnail', { profile }),
    enabled: live,
    refetchInterval: 4000,
    retry: false,
    staleTime: 1500
  })

  // No screen to offer, or none this Hermes can address: the hero is absent
  // rather than an empty black box (Bot Mode makes the same call).
  if (tone === 'unsupported' || tone === 'unavailable') {
    return null
  }

  const suppressed = frame.data?.suppressed === 'human_has_control'
  const dataUrl = live && !suppressed ? frame.data?.data_url || null : null
  const stale = Boolean(dataUrl) && timestampStale(frame)
  // Withheld beats every tone caption: the screen IS running, but the frame is
  // deliberately not ours to show, and "Live" over a blank box would lie.
  const caption = suppressed ? t('screenHidden') : t(screenCaptionKey(tone))

  return jsx(
    'button',
    {
      'aria-label': `${t('screenTitle')}: ${t(screenCaptionKey(tone))}`,
      className:
        'group relative block w-full overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-black text-left transition-colors hover:border-(--ui-stroke-primary, var(--ui-stroke-secondary))',
      onClick: () => openScreenPane(profile, t('screenTitle')),
      style: { aspectRatio: '16 / 10' },
      type: 'button',
      children: dataUrl
        ? jsx('img', {
            alt: '',
            className: stale
              ? 'absolute inset-0 size-full object-cover opacity-40 grayscale'
              : 'absolute inset-0 size-full object-cover',
            src: dataUrl
          })
        : jsxs('span', {
            className:
              'absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_70%)]',
            children: [
              jsx(Codicon, { className: 'text-[2.25rem] text-white/30', name: TONE_ICON[tone] }, 'glyph'),
              jsx('span', {
                className: 'absolute bottom-1.5 left-2 text-[0.6875rem] text-white/70',
                children: caption
              }, 'caption')
            ]
          })
    }
  )
}

const TONE_ICON = {
  live: 'device-desktop',
  human: 'record-keys',
  other: 'eye',
  off: 'debug-stop',
  missing: 'cloud-download',
  unsupported: 'circle-slash',
  unavailable: 'circle-slash',
  unknown: 'loading'
}

const SCREEN_CAPTION = {
  live: 'screenLive',
  other: 'screenOther',
  off: 'screenOff',
  missing: 'screenMissing',
  unknown: 'screenConnecting',
  human: 'screenOther',
  unsupported: 'screenMissing',
  unavailable: 'screenOff'
}

function screenCaptionKey(tone) {
  return SCREEN_CAPTION[tone] || 'screenConnecting'
}

/** Is the frame on screen older than the poll? A failed refresh keeps the last
 *  good JPEG up, and the hero dims it rather than pretending it is current. */
function timestampStale(frame) {
  return Boolean(frame.error && !frame.isPending)
}

/** The Screen viewer this plugin can offer: a live, larger view of the same
 *  thumbnail, in its own workspace tab. Takeover, install and start stay in
 *  Bot Mode's Screen pane — every pane must own its own lease holder. */
const screenTabs = new Map()

function openScreenPane(profile, label) {
  if (typeof host.openWorkspace !== 'function') {
    return
  }

  if (screenTabs.has(profile)) {
    host.revealPane(`plugin-workspace:${ID}:screen:${profile}`)

    return
  }

  const close = host.openWorkspace(`${ID}:screen:${profile}`, {
    title: `${profile} · ${label}`,
    minWidth: '28rem',
    onClose: () => screenTabs.delete(profile),
    render: () => jsx(ScreenView, { profile })
  })

  screenTabs.set(profile, close)
}

function ScreenView({ profile }) {
  const t = usePluginI18n(ID)
  const status = useQuery({
    queryKey: ['messenger', 'screen', profile],
    queryFn: () => host.request('display.status', { profile }),
    refetchInterval: 15000,
    retry: false,
    staleTime: 5000
  })
  const tone = screenTone(status.data || null, displayMissing(status.error))
  const live = tone === 'live' || tone === 'other'
  const frame = useQuery({
    queryKey: ['messenger', 'screen-frame', profile],
    queryFn: () => host.request('display.thumbnail', { profile }),
    enabled: live,
    refetchInterval: 3000,
    retry: false,
    staleTime: 1500
  })
  const dataUrl = live ? frame.data?.data_url || null : null

  return jsxs('div', {
    className: 'grid min-w-0 grid-cols-1 gap-3 p-4',
    children: [
      jsxs('div', {
        className: 'flex min-w-0 items-baseline gap-2',
        children: [
          jsx('span', { className: 'text-sm font-semibold', children: profile }),
          jsx('span', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children: t(screenCaptionKey(tone))
          })
        ]
      }),
      jsx('div', {
        className:
          'relative w-full overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-black',
        style: { aspectRatio: '16 / 10' },
        children: dataUrl
          ? jsx('img', { alt: '', className: 'absolute inset-0 size-full object-cover', src: dataUrl })
          : jsx('span', {
              className: 'absolute inset-0 grid place-items-center text-xs text-white/70',
              children: t(screenCaptionKey(tone))
            })
      }),
      jsx('div', {
        className: 'text-xs text-(--ui-text-quaternary)',
        children: t('screenTakeover')
      })
    ]
  })
}

/** The facts `cron.manage list` already sends, as label/value rows — and only
 *  the ones it actually sent, so the inspector can never render "undefined"
 *  (the same contract Bot Mode's `routineDetailRows` holds itself to). */
function routineRows(job, nowMs, t) {
  // The pane's tree is built by CALLING components, not by mounting them, so
  // `RoutineDetail({job: null})` runs this on the very first render — before any
  // card can be clicked. The real `nextRunOverdueMs` hands `job` to `jobState`,
  // which reads `job.state` with no optional chain: a null job is a CRASH there,
  // not an empty inspector. Guard at the boundary.
  if (!job) {
    return []
  }

  const paused = job.enabled === false || job.state === 'paused'
  const label = scheduleLabel(job.schedule)
  const raw = String(job.schedule || '').trim()
  const overdue = nextRunOverdueMs(job) !== null
  const next = job?.next_run_at ? Date.parse(String(job.next_run_at)) : NaN

  return [
    [t('status'), paused ? t('routinesPaused') : t('routinesActive')],
    [t('schedule'), label],
    [t('rawSchedule'), raw && raw !== label ? raw : null],
    [t('repeat'), job?.repeat ? String(job.repeat) : null],
    [
      overdue ? t('overdueSince') : t('nextRun'),
      paused || !Number.isFinite(next) ? null : relTime(next, nowMs)
    ],
    [t('lastRun'), stampAge(job?.last_run_at, nowMs)],
    [t('lastResult'), lastResult(job?.last_status, t)],
    [t('deliver'), job?.deliver],
    [t('model'), job?.model],
    [t('workdir'), job?.workdir]
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([name, value]) => [name, value.trim()])
}

/** The scheduler's closed set of run outcomes. `delivery_failed` means the run
 *  worked but never reached its target — it must never read as a success. */
function lastResult(status, t) {
  const raw = String(status || '').trim()

  if (!raw) {
    return null
  }

  const known = {
    blocked_config: t('resultBlocked'),
    delivery_failed: t('resultDeliveryFailed'),
    error: t('resultFailed'),
    ok: t('resultOk')
  }

  return known[raw] || raw
}

/** Why a job is not doing what the user expects — the scheduler's own reason,
 *  else the last fire/delivery failure. Bot Mode grew this because "paused"
 *  alone left the user guessing. */
function routineIssue(job) {
  const reasons = [job?.last_fire_error, job?.last_delivery_error, job?.paused_reason]

  return reasons.find(value => typeof value === 'string' && value.trim())?.trim() || null
}

/** The pane's only write: pause, resume or remove one job on its own profile.
 *  Split out of the card so the contract is testable without a renderer — the
 *  card adds the optimistic overlay, nothing else. */
async function routineAction(profile, jobId, action) {
  await host.request('cron.manage', { action, name: jobId, profile })
  bumpRoutines()
}

/** One scheduled job, as Bot Mode's card: status dot + title, pause/resume
 *  switch, delete, the schedule as a calendar pill, and the next run on the
 *  right (or why it is not coming). Opening a row asks the scheduler for
 *  nothing — the inspector renders the list payload the pane already holds. */
function RoutineCard({ job, nowMs, onOpen, profile }) {
  const t = usePluginI18n(ID)
  const [busy, setBusy] = useState(false)
  // Optimistic overlay: null follows the server. Set on toggle so the switch
  // answers before the refetch lands, cleared when the server agrees.
  const [pendingActive, setPendingActive] = useState(null)
  const serverActive = job.enabled !== false && job.state !== 'paused'
  const active = pendingActive === null ? serverActive : pendingActive

  if (pendingActive !== null && pendingActive === serverActive) {
    setPendingActive(null)
  }

  const act = async action => {
    if (busy) {
      return
    }

    setBusy(true)

    if (action === 'pause' || action === 'resume') {
      setPendingActive(action === 'resume')
    }

    try {
      await routineAction(profile, job.job_id, action)
    } catch (error) {
      setPendingActive(null)
      host.notifyError(error, t('routinesUpdateFailed'))
    } finally {
      setBusy(false)
    }
  }

  const overdue = nextRunOverdueMs(job) !== null
  const next = job.next_run_at ? Date.parse(String(job.next_run_at)) : NaN

  return jsxs('div', {
    className:
      'group grid min-w-0 grid-cols-1 gap-1.5 rounded-lg border border-(--ui-stroke-secondary) p-2.5 transition-colors hover:border-(--ui-stroke-primary, var(--ui-stroke-secondary))',
    'data-job': String(job.job_id || job.name || ''),
    children: [
      jsxs('div', {
        className: 'flex min-w-0 items-center gap-2',
        children: [
          jsx(
            RowButton,
            {
              className: 'flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground',
              onClick: () => onOpen(job),
              children: [
                jsx('span', {
                  'aria-hidden': true,
                  className: cn(
                    'size-1.5 shrink-0 rounded-full',
                    active ? 'bg-(--ui-success)' : 'bg-(--ui-text-quaternary)'
                  )
                }, 'dot'),
                jsx('span', {
                  className: cn(
                    'min-w-0 flex-1 truncate text-xs font-medium',
                    !active && 'text-(--ui-text-tertiary)'
                  ),
                  children: String(job.name || job.job_id || '')
                }, 'title')
              ]
            },
            'open'
          ),
          jsx(Switch, {
            checked: active,
            disabled: busy,
            onCheckedChange: value => act(value ? 'resume' : 'pause')
          }, 'switch'),
          jsx(
            Tip,
            {
              label: t('deleteJob'),
              children: jsx(Button, {
                'aria-label': t('deleteJob'),
                className: 'opacity-0 transition-opacity group-hover:opacity-100',
                disabled: busy,
                onClick: () => act('remove'),
                size: 'icon-xs',
                variant: 'ghost',
                children: jsx(Codicon, { name: 'trash' })
              })
            },
            'trash'
          )
        ]
      }),
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-3.5',
        children: [
          jsxs('span', {
            className:
              'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.65rem] text-(--ui-text-tertiary)',
            children: [
              jsx(Codicon, { className: 'text-[0.7rem]', name: 'calendar' }, 'icon'),
              jsx('span', { children: scheduleLabel(job.schedule) }, 'label')
            ]
          }, 'pill'),
          jsx('span', {
            className: 'ml-auto shrink-0 whitespace-nowrap text-[0.65rem] text-(--ui-text-quaternary)',
            children: active && Number.isFinite(next)
              ? `${overdue ? t('overdueSince') : t('nextRun')} ${relTime(next, nowMs)}`
              : t('routinesPaused')
          }, 'next')
        ]
      })
    ]
  })
}

/** The read-only inspector: every field the list payload carried, plus why the
 *  job is misbehaving. No second RPC and no second mutation path beside the
 *  card's own switch and delete. */
function RoutineDetail({ job, nowMs, onClose, open }) {
  const t = usePluginI18n(ID)

  // No job, no inspector. Must sit AFTER the hook so hook order stays stable,
  // and must exist at all because the caller builds this element eagerly with
  // `job: null` whenever nothing is selected — which is the first render.
  if (!job) {
    return null
  }

  const issue = routineIssue(job)

  return jsxs(Dialog, {
    onOpenChange: value => {
      if (!value) {
        onClose()
      }
    },
    open,
    children: [
      jsx(DialogContent, {
        className: 'max-w-md',
        children: jsxs('div', {
          className: 'grid gap-3',
          children: [
            jsxs(DialogHeader, {
              children: [
                jsx(DialogTitle, { className: 'truncate text-sm', children: String(job?.name || job?.job_id || '') }),
                jsx(DialogDescription, {
                  className: 'text-xs',
                  children: String(job?.job_id || '')
                })
              ]
            }),
            issue
              ? jsx('div', {
                  className:
                    'rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5 text-[0.6875rem] leading-4 text-(--ui-accent)',
                  children: issue
                })
              : null,
            jsx('div', {
              className: 'grid gap-1.5',
              children: routineRows(job, nowMs, t).map(([label, value]) =>
                jsxs('div', {
                  className: 'flex min-w-0 items-baseline gap-3',
                  children: [
                    jsx('span', {
                      className: 'w-20 shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                      children: label
                    }),
                    jsx('span', {
                      className: 'min-w-0 flex-1 break-words text-xs text-(--ui-text-secondary)',
                      children: value
                    })
                  ]
                }, `row-${label}`)
              )
            })
          ]
        })
      })
    ]
  })
}

/** The "+" in the pane header: name, a Hermes-native schedule string and the
 *  instruction to run. Bot Mode's structured picker composes the same string
 *  into the same `cron.manage add`. */
function CreateJobDialog({ onClose, open, profile }) {
  const t = usePluginI18n(ID)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy || !name.trim() || !schedule.trim()) {
      return
    }

    setBusy(true)

    try {
      await host.request('cron.manage', {
        action: 'add',
        name: name.trim(),
        profile,
        prompt: prompt.trim(),
        schedule: schedule.trim()
      })
      bumpRoutines()
      setName('')
      setSchedule('')
      setPrompt('')
      onClose()
    } catch (error) {
      host.notifyError(error, t('routinesCreateFailed'))
    } finally {
      setBusy(false)
    }
  }

  const field = (label, value, setValue, placeholder, key) =>
    jsxs('label', {
      className: 'grid gap-1',
      children: [
        jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: label }),
        jsx(Input, {
          'aria-label': label,
          onChange: event => setValue(event.target.value),
          placeholder,
          value
        })
      ]
    }, key)

  return jsx(Dialog, {
    onOpenChange: value => {
      if (!value) {
        onClose()
      }
    },
    open,
    children: jsx(DialogContent, {
      className: 'max-w-md',
      children: jsxs('div', {
        className: 'grid gap-3',
        children: [
          jsxs(DialogHeader, {
            children: [
              jsx(DialogTitle, { className: 'text-sm', children: t('newJob') }),
              jsx(DialogDescription, { className: 'text-xs', children: profile })
            ]
          }),
          field(t('jobName'), name, setName, t('jobNameHint'), 'name'),
          field(t('jobSchedule'), schedule, setSchedule, 'daily / 15m / 0 6 * * *', 'schedule'),
          field(t('jobPrompt'), prompt, setPrompt, t('jobPromptHint'), 'prompt'),
          jsxs(DialogFooter, {
            children: [
              jsx(Button, { onClick: onClose, size: 'sm', variant: 'secondary', children: t('cancel') }, 'cancel'),
              jsx(Button, {
                disabled: busy || !name.trim() || !schedule.trim(),
                onClick: submit,
                size: 'sm',
                children: t('create')
              }, 'create')
            ]
          })
        ]
      })
    })
  })
}

/** One `cron.manage list` per roster profile: each profile keeps its OWN cron
 *  store (the `profile` param scopes HERMES_HOME per call), so the pane reads
 *  them the same way it reads sessions. A profile whose backend is down reports
 *  no jobs rather than failing the pane. */
async function fetchRoutines(names) {
  const pairs = await Promise.all(
    names.map(async name => {
      try {
        const data = await host.request('cron.manage', {
          action: 'list',
          include_disabled: true,
          profile: name
        })

        return [name, { jobs: Array.isArray(data?.jobs) ? data.jobs : [], running: data?.gateway_running }]
      } catch {
        return [name, { jobs: [], running: null }]
      }
    })
  )

  return Object.fromEntries(pairs)
}

/** The right-edge tile, in Bot Mode's shape: the live screen of the profile on
 *  show, that profile's header, then one rich card per job. There is no profile
 *  picker in here (Pedro, 2026-10-09): the tile follows what the LEFT pane has
 *  selected, so which profile you are looking at is decided in exactly one of
 *  the two panes instead of two. Mutations go to the scheduler through
 *  `cron.manage`; nothing here invents a second write path. */
function RoutinesPane() {
  const t = usePluginI18n(ID)
  const epoch = useValue($routinesEpoch)
  const pinned = useValue($routineProfile)
  const roster = useQuery({ queryKey: ROSTER_KEY, queryFn: fetchRoster, refetchInterval: POLL_MS, staleTime: 2000 })
  const rows = roster.data || []
  const names = rows.map(row => row.name)
  const routines = useQuery({
    queryKey: ['messenger', 'routines', epoch, names.join('|')],
    queryFn: () => fetchRoutines(names),
    enabled: names.length > 0,
    refetchInterval: 20000,
    staleTime: 8000,
    retry: false
  })
  const byProfile = routines.data || {}
  const entries = Object.values(byProfile)
  // Every profile's answer carries the same gateway flag; one `false` is enough.
  const offline = entries.some(entry => entry?.running === false)
  const total = entries.reduce((sum, entry) => sum + (entry?.jobs?.length || 0), 0)
  // Default to the first profile that actually has jobs: a pane that opens on
  // an empty default while another profile has a schedule is lying by omission.
  const owner =
    (names.includes(pinned) && pinned) ||
    names.find(name => (byProfile[name]?.jobs || []).length) ||
    names[0] ||
    'default'
  const jobs = byProfile[owner]?.jobs || []
  const nowMs = Date.now()
  const [detailId, setDetailId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const detail = detailId ? jobs.find(job => job.job_id === detailId) || null : null

  const header = jsxs('div', {
    className: 'flex min-w-0 items-center gap-2 px-3 pt-3 pb-2',
    children: [
      jsx('span', {
        className: 'grid size-6 shrink-0 place-items-center rounded text-[0.625rem] font-semibold uppercase',
        style: { background: profileColorSoft(owner), color: profileColor(owner) },
        children: owner.slice(0, 2)
      }, 'face'),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsx('div', { className: 'truncate text-xs font-semibold', children: owner }, 'name'),
          jsx('div', {
            className: 'text-[0.65rem] uppercase tracking-wider text-(--ui-text-quaternary)',
            children: t('routines')
          }, 'label')
        ]
      }),
      jsx(
        Tip,
        {
          label: t('newJob'),
          children: jsx(Button, {
            'aria-label': t('newJob'),
            onClick: () => setCreateOpen(true),
            size: 'icon-xs',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'add' })
          })
        },
        'add'
      )
    ]
  })

  return jsxs('div', {
    className: 'flex h-full min-w-0 flex-col',
    children: [
      jsx('div', { className: 'px-3 pt-3', children: jsx(ScreenHero, { profile: owner }) }, 'hero'),
      header,
      jsx('div', { className: 'mx-3 border-t border-(--ui-stroke-secondary)' }, 'rule'),
      offline
        ? jsx('div', {
            className: 'mx-3 mt-2 rounded-md px-2 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
            children: t('routinesOffline')
          }, 'offline')
        : null,
      roster.isPending || routines.isPending
        ? jsx('div', { className: 'pt-2', children: jsx(LoadingRows, {}) }, 'loading')
        : !total
          ? jsx(EmptyState, { description: t('routinesEmpty'), title: t('routines') }, 'empty')
          : !jobs.length
            ? jsx(EmptyState, { description: t('routinesHere'), title: owner }, 'none')
            : jsx('div', {
                className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
                children: jsx('div', {
                  className: 'grid gap-1.5 px-2.5 py-2',
                  children: jobs.map(job =>
                    jsx(
                      RoutineCard,
                      {
                        job,
                        nowMs,
                        onOpen: opened => setDetailId(opened.job_id),
                        profile: owner
                      },
                      `job-${owner}-${job.job_id || job.name}`
                    )
                  )
                })
              }, 'list'),
      jsx(RoutineDetail, {
        job: detail,
        nowMs,
        onClose: () => setDetailId(null),
        open: Boolean(detail)
      }, 'detail'),
      jsx(CreateJobDialog, {
        onClose: () => setCreateOpen(false),
        open: createOpen,
        profile: owner
      }, 'create')
    ]
  })
}

/** P7 drill-down (Pedro's D-A): the pane body IS replaced by one profile's
 *  session list — "View all" (every session it has) or "View Archived" — with a
 *  back button. Deliberately NOT a workspace tab: the roster stays one click
 *  away. "View all" needs no backend (`session.list` takes the limit); the
 *  archive comes from the pane's own `/archived` read. */
function SessionListView({
  editingSession,
  kind,
  nowMs,
  onBack,
  onRenameCancel,
  onRenameSession,
  onRenameSubmit,
  profile,
  t
}) {
  const archived = kind === 'archived'
  // "View hidden" is the pane's own list (Pedro, 2026-10-10: "next to View All
  // and View Archives, include a View hidden option for the hidden sessions from
  // messenger, and allow the user to unhide them"). It reads the SAME
  // session.list, narrowed by the store — and the narrowing is a hook, so
  // unhiding a row takes it out of this list on the spot.
  const hiddenKind = kind === 'hidden'
  const hiddenState = useValue($hiddenSessions)
  const hiddenIds = new Set((hiddenState[String(profile)] || []).map(String))
  const listed = useQuery({
    queryKey: ['messenger', 'view', kind, profile],
    queryFn: () =>
      archived
        ? listArchivedSessions(profile)
        : hiddenKind
          ? listHiddenSessions(profile)
          : listAllSessions(profile),
    refetchInterval: archived ? false : POLL_MS,
    retry: false,
    staleTime: 5000
  })
  const fetched = Array.isArray(listed.data) ? listed.data : []
  const sessions = hiddenKind ? fetched.filter(session => hiddenIds.has(String(session?.id || ''))) : fetched
  // `null` from the fetcher is the archive's "no backend" answer — distinct
  // from "[]" (a reachable archive with nothing in it).
  const unavailable = archived && !listed.isPending && listed.data === null

  let body

  if (listed.isPending) {
    body = jsx(LoadingRows, {})
  } else if (unavailable) {
    body = jsx(EmptyState, { description: t('viewArchiveUnavailable'), title: t('viewArchived') })
  } else if (!sessions.length) {
    body = jsx(EmptyState, {
      description: archived
        ? t('viewArchivedEmpty')
        : hiddenKind
          ? t('viewHiddenEmpty')
          : t('viewAllEmpty'),
      title: archived ? t('viewArchived') : hiddenKind ? t('viewHidden') : t('viewAll')
    })
  } else {
    body = jsx('div', {
      className: LIST_CLASS,
      children: sessions.map(session =>
        jsx(
          SessionRow,
          {
            editing: Boolean(
              editingSession &&
                editingSession.profile === profile &&
                String(editingSession.id) === String(session.id)
            ),
            nowMs,
            onRename: onRenameSession,
            onRenameCancel,
            onRenameSubmit: name => onRenameSubmit(profile, session.id, name),
            profile,
            session
          },
          `view-${profile}-${session.id}`
        )
      )
    })
  }

  return jsxs('div', {
    className: 'grid min-w-0 grid-cols-1',
    'data-list-view': kind,
    children: [
      jsxs(
        'div',
        {
          className: 'flex min-w-0 items-center gap-1 px-2.5 pt-2.5 pb-1.5',
          children: [
            jsx(Button, {
              'aria-label': t('viewBack'),
              className: 'shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground',
              onClick: onBack,
              size: 'icon-xs',
              variant: 'ghost',
              children: jsx(Codicon, { name: 'chevron-left' })
            }),
            jsxs(
              'div',
              {
                className: 'flex min-w-0 items-baseline gap-1.5',
                children: [
                  jsx('span', {
                    className:
                      'shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)',
                    children: archived ? t('viewArchived') : hiddenKind ? t('viewHidden') : t('viewAll')
                  }),
                  jsx('span', {
                    className: 'min-w-0 truncate text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: profile
                  })
                ]
              },
              'view-heading'
            ),
            sessions.length
              ? jsx('span', {
                  className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                  children: `${sessions.length} ${t('viewSessions')}`
                })
              : null,
            // One press puts every one of them back in the Messenger list. The
            // rows themselves also carry Unhide in their own menu (SessionRow
            // reads the same store), so the bulk verb is the shortcut, not the
            // only door.
            hiddenKind && sessions.length
              ? jsx(
                  Button,
                  {
                    className: 'ml-auto shrink-0',
                    onClick: () => unhideAll(profile),
                    size: 'sm',
                    variant: 'ghost',
                    children: t('unhideAll')
                  },
                  'unhide-all-view'
                )
              : null
          ]
        },
        'view-toolbar'
      ),
      body
    ]
  })
}

/** Read a picked file as a data URL — the only shape `profiles.set_asset`
 *  takes (it sniffs the format from the bytes and caps at 2MB). */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

/** The `ui_meta['hermes-bots']` document ONE profile save sends, built from the
 *  row's CURRENT document so nothing else it holds is lost.
 *
 *  `color: null` is the "No fill" case, and the mechanism matters: the key is
 *  DROPPED rather than blanked, because the gateway REPLACES the whole
 *  `hermes-bots` slice with what we send (see `_configure_ui_meta`) and a
 *  `undefined` never crosses the JSON-RPC wire — so the stored document ends up
 *  with no colour at all and `fillOf` (plus the avatar chip) fall back to the
 *  theme and the name hash. Writing `''` instead would leave a blank key in a
 *  document that rides every `profiles.list`.
 *
 *  The picture never enters here for the same reason it must not: this document
 *  is shipped on every roster paint and the gateway strips data URLs out of it,
 *  so a smuggled image silently disappears (the asset store is its home).
 *  Pure. */
function botMetaPatch(meta, { color, title } = {}) {
  const next = {
    ...(meta && typeof meta === 'object' ? meta : {}),
    color: color || undefined,
    custom: true,
    title: String(title == null ? '' : title).trim()
  }

  delete next.image

  return next
}

/** Edit ONE profile — the edit the Bots pane offers, written to the SAME two
 *  places it writes: `ui_meta['hermes-bots']` for the name and colour, and the
 *  profile's own `assets/avatar.*` for the picture. One document, two panes,
 *  which is what makes a change in either show up in the other (Pedro,
 *  2026-10-10: "the changes are synced, so if the user changes a profile
 *  picture in either Messenger or Bots, it reflects on the other").
 *
 *  The image stays OUT of ui_meta on purpose: that document rides every
 *  `profiles.list` and the gateway strips data URLs out of it, so a picture
 *  smuggled in there silently disappears — Bots keeps them in the asset store,
 *  and so does this. */
function EditProfileDialog({ onClose, open, queryClient, row }) {
  const name = String(row?.name || '')
  const meta = row?.botsMeta || {}
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(null)
  const [image, setImage] = useState(null)
  const [picked, setPicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const fileRef = useRef(null)
  // Seed local state from the row on every OPEN edge, DURING RENDER — the shape
  // Bots' own dialog uses (`seedKey`). An effect leaves the first paint holding
  // the previous row's state, and a harness that renders once therefore saw
  // nothing seeded at all: the grid drew an unselected colour for a profile
  // that HAS one. The `open` half of the key is what stops a cancelled edit
  // from leaking into the next time the same profile is opened.
  const seed = `${name}:${open ? 'open' : 'closed'}`
  const [seeded, setSeeded] = useState('')

  if (seed !== seeded) {
    setSeeded(seed)

    if (open && row) {
      setTitle(String(meta.title || ''))
      setColor(meta.color || null)
      setImage(null)
      setPicked(false)
      setBusy(false)
      setNote('')
    }
  }

  if (!row) {
    return null
  }

  const save = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setNote('')

    try {
      const next = botMetaPatch(meta, { color, title })

      await host.request('profiles.configure', { name, ui_meta: { [BOTS_META_KEY]: next } })

      // Only when the picture actually changed: a no-op push re-uploads the
      // whole data URL, and a no-op clear can race another machine's upload.
      if (picked) {
        await host.request(
          'profiles.set_asset',
          image ? { asset: 'avatar', data: image, name } : { asset: 'avatar', clear: true, name }
        )
      }

      queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
      queryClient.invalidateQueries({ queryKey: [ID, 'avatar', name] })
      onClose()
    } catch (error) {
      setNote(String(error?.message || error || 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async event => {
    const file = event?.target?.files?.[0]

    if (!file) {
      return
    }

    try {
      setImage(await readAsDataUrl(file))
      setPicked(true)
      setNote('')
    } catch (error) {
      setNote(String(error?.message || error || 'Could not read that file'))
    }
  }

  return jsx(Dialog, {
    onOpenChange: value => !value && !busy && onClose(),
    open,
    children: jsx(DialogContent, {
      className: 'max-w-sm',
      children: jsxs('div', {
        className: 'grid gap-3',
        children: [
          jsxs(DialogHeader, {
            children: [
              jsx(DialogTitle, { className: 'truncate text-sm', children: 'Edit profile' }),
              jsx(DialogDescription, { className: 'text-xs', children: name })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center',
            children: [
              jsx('div', {
                style: {
                  background: image ? undefined : color || profileColor(name),
                  marginRight: 8,
                  backgroundImage: image ? `url(${image})` : undefined,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                  borderRadius: AVATAR_RADIUS,
                  height: 40,
                  width: 40
                }
              }),
              jsx(Input, {
                onChange: event => setTitle(event?.target?.value ?? ''),
                placeholder: 'Profile name',
                value: title
              })
            ]
          }),
          // The app's OWN grid, clear row included — the same `ColorSwatches`
          // the session and group pickers use, so all three speak one language.
          // The clear row IS the "no fill" option (Pedro, 2026-10-10: "allow
          // for a no fill option as well"): a picked colour paints the profile
          // row and its sessions, so the picker has to offer the way back to
          // nothing. Bots' editor gets its clear row from
          // `hermes-bots/avatar-picker.tsx`; the hand-rolled swatch map
          // transcribed from that dialog had lost it, which left a picked
          // colour with no way to be un-picked.
          jsx(ColorSwatches, {
            clearLabel: 'No fill',
            onChange: value => setColor(value || null),
            swatches: PROFILE_SWATCHES,
            value: color
          }),
          jsxs('div', {
            className: 'flex items-center',
            children: [
              jsx('input', {
                accept: 'image/png,image/jpeg,image/webp',
                onChange: pickFile,
                ref: fileRef,
                style: { display: 'none' },
                type: 'file'
              }),
              jsx(Button, {
                disabled: busy,
                onClick: () => fileRef.current?.click?.(),
                size: 'sm',
                type: 'button',
                variant: 'outline',
                children: 'Choose picture'
              }),
              picked
                ? jsx(Button, {
                    disabled: busy,
                    onClick: () => {
                      setImage(null)
                      setPicked(true)
                    },
                    size: 'sm',
                    type: 'button',
                    variant: 'ghost',
                    children: 'Remove picture'
                  })
                : null
            ]
          }),
          note
            ? jsx('p', {
                className: 'text-xs',
                style: { color: 'var(--destructive, #e5484d)' },
                children: note
              })
            : null,
          jsxs(DialogFooter, {
            children: [
              jsx(Button, {
                disabled: busy,
                onClick: onClose,
                size: 'sm',
                type: 'button',
                variant: 'ghost',
                children: 'Cancel'
              }),
              jsx(Button, {
                disabled: busy,
                onClick: save,
                size: 'sm',
                type: 'button',
                children: busy ? 'Saving\u2026' : 'Save'
              })
            ]
          })
        ]
      })
    })
  })
}

function MessengerPane() {
  const t = usePluginI18n(ID)
  const currentProfile = useValue(host.state.profile)
  const model = useValue($sections)
  // The atom was written by every session drag and subscribed by nobody, so a
  // re-ordered list only appeared on the next poll. Subscribing is the fix.
  const sessionOrderState = useValue($sessionOrder)
  const view = useValue($listView)
  const toasts = useValue($activityToasts)
  // Which profiles' last load threw — drawn as a note on their own row.
  const failedProfiles = new Set((useValue($loadFailures) || []).map(String))
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [activity, setActivity] = useState('all')
  const [profiles, setProfiles] = useState([])
  const [editing, setEditing] = useState(null)
  // The row whose Edit profile dialog is open (the ROW, not its name: the
  // dialog needs the document it is editing).
  const [editingProfileRow, setEditingProfileRow] = useState(null)
  // The group whose "Add profiles…" picker is open, or null.
  const [adding, setAdding] = useState(null)
  // P11 select mode — transient by design (see the note above sessionKey).
  const [selecting, setSelecting] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState([])
  const [selectStatus, setSelectStatus] = useState('')
  const [batching, setBatching] = useState(false)
  // Delete fires on the second press (see SelectBar). Reset on every batch and
  // whenever the tick set moves, so "armed" never survives into another choice.
  const [armedDelete, setArmedDelete] = useState(false)
  // P10 drag state: which grip is held, and what is under the pointer. Both are
  // transient — a drag that never lands leaves nothing behind.
  const [drag, setDrag] = useState(null)
  const [dropAt, setDropAt] = useState(null)
  const [trace, setTrace] = useState('')
  // Session rename is its own slot: the group field and a session field can be
  // on screen at once, and only one of them is ever armed.
  const [editingSession, setEditingSession] = useState(null)
  // ONE slot: a group is created first and only ever RENAMED afterwards (see
  // createGroupNow), so there is no "new group being named" state to keep in
  // step with anything. Pedro, 2026-10-10: "Don't give them a text box to fill
  // in before the group is created."
  // Which profiles are revealing their hidden sessions. A view preference, so
  // it lives in this window only (the hiding itself is persisted).
  const [showHidden, setShowHidden] = useState({})
  const [renamingGroup, setRenamingGroup] = useState(null)
  // The section whose "Add profiles…" picker is open, or null — the pane's OWN
  // slot; `editing` below is the section being renamed.

  const roster = useQuery({ queryKey: ROSTER_KEY, queryFn: fetchRoster, refetchInterval: POLL_MS, staleTime: 2000 })
  const rows = roster.data || []
  const needle = query.trim().toLowerCase()
  const searching = needle.length >= SEARCH_MIN_CHARS
  const names = rows.map(row => row.name).join('|')

  // ONE query for the whole pane (a hook per profile would be a hook in a
  // loop). Keyed by the roster and the needle, so it re-arms when either
  // moves and otherwise hits cache.
  const deep = useQuery({
    queryKey: [...SEARCH_KEY, needle, names],
    queryFn: () => searchInSessions(rows.map(row => row.name), needle),
    enabled: searching && rows.length > 0,
    staleTime: 30000,
    retry: false
  })
  const hits = searching ? deep.data || {} : {}

  // Expanded profiles: ONE query keyed by the OPEN SET, so opening a row only
  // fetches that profile and the poll keeps the titles and ages fresh.
  const expanded = useValue($expanded)
  const openNames = Object.keys(expanded)
    .filter(name => expanded[name])
    .sort()
  const sessions = useQuery({
    queryKey: ['messenger', 'sessions', openNames.join('|')],
    queryFn: () => refreshSessions(openNames),
    enabled: openNames.length > 0,
    refetchInterval: POLL_MS,
    staleTime: 2000,
    retry: false
  })
  const byProfile = sessions.data || {}

  /** Commit an inline session rename, then drop the field. The list picks the
   *  new title up on its next poll (the query key does not change). */
  const submitSessionRename = async (profile, sessionId, name) => {
    try {
      await renameSession(sessionId, profile, name)
    } catch (error) {
      host.notifyError?.(String(error?.message || error))
    }

    setEditingSession(null)
  }
  const nowMs = Date.now()
  const shown = visibleRows(rows, { activity, kind, matchesByProfile: hits, nowMs, profiles, query })
  const blocks = groupRows(shown, model)
  // Resolved against the WHOLE roster, not the visible slice: filtering a row
  // out of view must not quietly drop it from the batch.
  // Resolved against the rows AS DRAWN (see rowsWithSessions): one list per
  // profile, keyed by what the pane fetched, never the roster's session-less
  // row — that bug left the whole batch bar dead.
  const tickRows = rowsWithSessions(rows, byProfile)
  const ticks = selectedSessions(tickRows, selectedKeys)
  const batch = async (send, label) => {
    setBatching(true)

    const { done, failed } = await runOverSessions(ticks, send)

    setBatching(false)
    setArmedDelete(false)
    setSelectStatus(failed ? `${done} ${label} · ${failed} ${t('failed')}` : `${done} ${label}`)
    setSelectedKeys([])
    await queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
  }
  const runDelete = () => {
    if (!armedDelete) {
      setArmedDelete(true)
      setSelectStatus(`${ticks.length} ${t('selected')} — ${t('delete')}?`)

      return undefined
    }

    return batch(deleteSessionEntry, t('deleted'))
  }
  /** Apropos over the tick set: one group child per profile the ticks came from
   *  (a digest is scoped to one profile). The created child is opened by
   *  aproposGroupSession itself, so this only reports the receipt. */
  const runApropos = async () => {
    setBatching(true)

    try {
      const made = await aproposSelection(ticks)

      setSelectStatus(`${made} ${t('aproposMade')}`)
    } catch (error) {
      setSelectStatus(t('failed'))
      host.notifyError?.(String(error?.message || error))
    }

    setBatching(false)
    setArmedDelete(false)
    setSelectedKeys([])
    await queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
  }
  const leaveSelect = () => {
    setSelecting(false)
    setSelectedKeys([])
    setArmedDelete(false)
    setSelectStatus('')
  }
  /** A grip was grabbed. `preventDefault` on the pointerdown already stopped the
   *  browser's own text-selection drag; this only records WHAT is moving. */
  const startDrag = (event, next) => {
    event?.preventDefault?.()
    setDrag(next)
    setTrace(DND_TRACE ? `grip down: ${JSON.stringify(next)}` : '')
  }

  // ── P10: dragging ─────────────────────────────────────────────────────────
  // window-level listeners, attached only while a drag is live: a grip's own
  // pointer stream ends the moment the pointer leaves the grip — which is
  // exactly where the user is heading (another row, another group).
  useEffect(() => {
    if (!drag || typeof window === 'undefined') {
      return undefined
    }

    const move = event => {
      const pane = document
        .elementFromPoint?.(event.clientX, event.clientY)
        ?.closest?.('[data-pane-scroll]')

      if (pane) {
        const rect = pane.getBoundingClientRect()
        const edge = 28

        if (event.clientY < rect.top + edge) {
          pane.scrollTop -= 14
        } else if (event.clientY > rect.bottom - edge) {
          pane.scrollTop += 14
        }
      }

      setDropAt(elementAt(event.clientX, event.clientY))
    }
    /** Abandon a gesture without committing. Without this a pointercancel (OS
     *  drag, touch pan, window switch) left `drag` set, so the NEXT stray
     *  pointerup committed a drop the user never made. */
    const abort = () => {
      setDropAt(null)
      setDrag(null)
    }
    const up = event => {
      const target = elementAt(event.clientX, event.clientY)
      const action = dropAction(drag, target)

      setDropAt(null)
      setDrag(null)
      setTrace(
        DND_TRACE
          ? `drag ${drag.kind} → target ${JSON.stringify(target)} → action ${JSON.stringify(action)}`
          : ''
      )
      commitDrop(drag, target)
    }
    const onKey = event => {
      if (event.key === 'Escape') {
        abort()
      }
    }

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.cursor = 'grabbing'
      // An item-first drag starts ON the row's own text, so the browser would
      // otherwise paint a text selection across the list while the pointer
      // moves. Restored in the cleanup below.
      document.body.style.userSelect = 'none'
    }

    itemDrag.busy = true

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', abort)
    window.addEventListener('blur', abort)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', abort)
      window.removeEventListener('blur', abort)
      window.removeEventListener('keydown', onKey)

      if (typeof document !== 'undefined' && document.body) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      itemDrag.busy = false
    }
  }, [drag])

  /** Apply whatever the drop meant. Every branch is a call the menu items can
   *  already make, so dragging is a second way to reach the same writes — never
   *  a parallel path with its own rules. */
  const commitDrop = (dragged, target) => {
    const action = dropAction(dragged, target)

    if (!action) {
      return
    }

    if (action.kind === 'section') {
      reorderSections(action.id, action.onto)

      return
    }

    if (action.kind === 'file') {
      moveToSection([action.name], action.section)

      return
    }

    if (action.kind === 'sessionFile') {
      moveSessionsToGroup(action.profile, action.ids, action.group)

      return
    }

    if (action.kind === 'sessionGroupOrder') {
      reorderSessionGroups(action.profile, action.id, action.onto)

      return
    }

    if (action.kind === 'order') {
      const block = blocks.find(candidate => candidate.scope === action.scope)
      const current =
        model.order?.[action.scope] || (block?.rows || []).map(entry => entry.name)

      setOrder(action.scope, placeNames(current, action.name, action.onto, action.side))

      return
    }

    if (action.kind === 'sessionOrder') {
      // `byProfile` IS the list on screen (`sessions: byProfile[row.name]`), so
      // the order written here is the order the user was looking at.
      setSessionOrder(
        action.profile,
        nextSessionIds(
          byProfile[action.profile] || [],
          sessionOrder[action.profile],
          action.id,
          action.onto,
          action.side
        )
      )
    }
  }
  const filters = { activity, kind, profiles }

  // P7 drill-down. Every hook above has already run unconditionally, so this
  // early return is safe: the pane body becomes one profile's session list
  // until the back button clears the view.
  if (view) {
    return jsx(SessionListView, {
      editingSession,
      kind: view.kind,
      nowMs,
      onBack: () => $listView.set(null),
      onRenameCancel: () => setEditingSession(null),
      onRenameSession: (session, name) => setEditingSession({ id: session.id, profile: name }),
      onRenameSubmit: submitSessionRename,
      profile: view.profile,
      t
    })
  }

  let body

  if (roster.isPending) {
    body = jsx(LoadingRows, {})
  } else if (roster.isError) {
    body = jsx(ErrorState, {
      className: 'px-2 py-4',
      description: String(roster.error?.message || roster.error || ''),
      title: t('loadFailed')
    })
  } else if (!shown.length && !model.sections.length) {
    body = jsx(EmptyState, {
      description: rows.length ? t('filteredHint') : t('emptyHint'),
      title: rows.length ? t('filtered') : t('empty')
    })
  } else {
    body = jsx('div', {
      className: LIST_CLASS,
      children: blocks.map((block, index) =>
        jsxs(
          'div',
          {
            className: 'grid min-w-0 grid-cols-1',
            children: [
              block.id
                ? jsx(SectionHeading, {
                    block,
                    index,
                    onAddProfiles: target => setAdding(target),
                    dropTarget: dropAt?.group === block.id,
                    onDelete: target => deleteSection(target.id),
                    onDragStart: startDrag,
                    onMove: delta => moveSection(block.id, delta),
                    onRename: target => {
                      setCreating(false)
                      setEditing({ id: target.id, name: target.name })
                    },
                    onSort: mode => setSort(block.scope, mode),
                    scopeCount: blocks.filter(candidate => candidate.id).length,
                    sort: model.sort?.[block.scope] || 'activity'
                  })
                : null,
              editing && editing.id === block.id
                ? jsx(NameField, {
                    initial: editing.name,
                    label: t('groupName'),
                    onCancel: () => setEditing(null),
                    onSubmit: name => {
                      renameSection(editing.id, name)
                      setEditing(null)
                    }
                  })
                : null,
              block.collapsed
                ? null
                : block.rows.map(row =>
                    jsx(
                      ProfileRow,
                      {
                        editingSession,
                        expanded: Boolean(expanded[row.name]),
                        hits: hits[row.name],
                        isCurrent: row.name === currentProfile,
                        nowMs,
                        onView: (name, kind) => {
                          $listView.set({ kind, profile: name })
                          setRoutineProfile(name)
                        },
                        drag,
                        dropAt,
                        onDragStart: startDrag,
                        scope: block.scope,
                        onSelect: (name, storedId) => {
                          setSelecting(true)
                          setSelectedKeys([sessionKey(name, storedId)])
                        },
                        onRightClickSelect: key => setSelectedKeys(keys => clickSelect(keys, key)),
                        loadFailed: failedProfiles.has(row.name),
                        onEditProfile: setEditingProfileRow,
                        // Unticking the LAST row is how the user leaves select
                        // mode, which is what tickState reports (see it).
                        onToggleSelect: key => {
                          const next = tickState(selectedKeys, key)

                          setArmedDelete(false)
                          setSelectedKeys(next.keys)
                          setSelectStatus('')

                          if (next.empty) {
                            setSelecting(false)
                          }
                        },
                        selectedKeys,
                        selecting,
                        t,
                        onRenameCancel: () => setEditingSession(null),
                        onRenameSession: (session, profile) => {
                          setEditing(false)
                          setEditingSession({
                            id: String(session.id),
                            profile,
                            title: String(session.title || '')
                          })
                        },
                        onRenameSubmit: submitSessionRename,
                        showHidden,
                        onToggleHidden: name =>
                          setShowHidden(previous => ({ ...previous, [name]: !previous[name] })),
                        renamingGroup,
                        onDeleteGroup: id => deleteSessionGroup(row.name, id),
                        onMoveGroup: payload =>
                          moveSessionsToGroup(
                            row.name,
                            sessionGroupMoveTargets({
                              profile: row.name,
                              selectedKeys,
                              sessionId: payload?.sessionId
                            }),
                            payload?.groupId ?? null
                          ),
                        // Make the group FIRST, name it second (createGroupNow):
                        // "Group #1" appears the instant the verb is picked, and
                        // the field that opens on it is a RENAME — so a lost
                        // keystroke can no longer lose the group. Pedro,
                        // 2026-10-10: "immediately create the group, with Group #1
                        // or Apropos #1. The user will then rename it accordingly.
                        // Don't give them a text box to fill in before the group
                        // is created."
                        onNewGroup: sessionIds => {
                          const made = createGroupNow(row.name, sessionIds)

                          if (made) {
                            setRenamingGroup(made)
                          }
                        },
                        // "Apropos (On that topic) → Create group": always a real
                        // Apropos group, built from the TICK SET — which the
                        // right-click rule has already made real (clickSelect).
                        onCreateAproposGroup: entry => {
                          const entries = ticks.length ? ticks : [entry]

                          return aproposCreateGroup(entries).then(made => {
                            if (made.length) {
                              // The rename opens on the group that was just made,
                              // so the default name is never a dead end.
                              setRenamingGroup({ id: made[0].groupId, name: made[0].name })
                            }

                            return made
                          })
                        },
                        onRenameGroup: group => setRenamingGroup({ id: group.id, name: group.name }),
                        onRenameGroupCancel: () => setRenamingGroup(null),
                        // Renaming a group also retitles the children it
                        // started, so "Apropos group: …" never outlives the
                        // name it was made from (see renameAproposGroup).
                        onRenameGroupSubmit: (id, name) => {
                          renameAproposGroup(row.name, id, name, byProfile[row.name])
                          setRenamingGroup(null)
                        },
                        onToggleGroup: id => toggleSessionGroupCollapsed(row.name, id),
                        onMoveGroupOrder: (id, delta) => moveSessionGroup(row.name, id, delta),
                        // Selecting a profile IS clicking it: the right-hand
                        // tile follows the left pane (Pedro, 2026-10-09), so one
                        // click decides both halves of the window.
                        onToggle: name => {
                          toggleExpanded(name)
                          setRoutineProfile(name)
                        },
                        row,
                        sessionOrder: sessionOrderState,
                        sessions: byProfile[row.name]
                      },
                      row.name
                    )
                  ),
              !block.collapsed && !block.rows.length
                ? jsx('div', {
                    className: 'px-2 py-1 pl-4 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: t('groupEmpty')
                  })
                : null
            ]
          },
          block.id || 'all'
        )
      )
    })
  }

  // Layout contract for this pane: NOTHING here may scroll sideways. The list is
  // a grid, whose implicit `auto` track takes its minimum from the widest child's
  // MIN-CONTENT — so a single unshrinkable band (or one long unbreakable token)
  // widens the track past the pane, and `overflow: auto` then scrolls the row's
  // right edge — where the caret and the drag grip live — out of view. Pedro,
  // 2026-10-10: "The arrow and the grip icon should always be visible regardless
  // of the pane width." So: clip x, let every band shrink, and keep the chrome
  // that must never leave (leading caret, trailing grip) shrink-0.
  return jsxs('div', {
    // `data-pane-scroll` marks the box a drag auto-scrolls (see the move
    // handler): a ten-row list is taller than the pane, so without it the rows
    // past the fold cannot be reached while a grip is held.
    'data-pane-scroll': '',
    className: 'flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-sm',
    children: [
      jsx(Toolbar, {
        onBell: toggleToasts,
        // The section's own immediate-creation path, same rule as the session
        // groups: make "Group #1" now, then open its rename field on it.
        onNewGroup: () => {
          const id = createSection(nextSectionName())

          if (id) {
            const section = ($sections.get().sections || []).find(entry => entry.id === id)

            setEditing({ id, name: section?.name || '' })
          }
        },
        rows,
        onSelect: () => (selecting ? leaveSelect() : setSelecting(true)),
        selecting,
        shownCount: shown.length,
        t,
        toasts
      }),
      DND_TRACE
        ? jsx('div', {
            // Temporary instrument: `break-all` + inline overflow-wrap because a
            // JSON payload has no break opportunities and would otherwise widen
            // the list's grid track — the pane's own width, moved by the thing
            // measuring it.
            className: 'min-w-0 break-all px-2 py-1 text-[0.6875rem] text-(--ui-text-quaternary)',
            style: { overflowWrap: 'anywhere' },
            children: trace || 'dnd trace armed (v2) — grab a grip'
          })
        : null,
      selecting
        ? jsx(
            SelectBar,
            {
              armed: armedDelete,
              busy: batching,
              count: ticks.length,
              onApropos: runApropos,
              onArchive: () => batch(archiveSessionEntry, t('archived')),
              onClear: () => {
                setArmedDelete(false)
                setSelectedKeys([])
              },
              onClose: () => batch(closeSession, t('closed')),
              onDelete: runDelete,
              onDone: leaveSelect,
              onSelectAll: () => {
                setArmedDelete(false)
                setSelectedKeys(allSessionKeys(tickRows))
              },
              status: selectStatus,
              t
            },
            'select-bar'
          )
        : null,
      jsx(
        AddProfilesDialog,
        {
          onClose: () => setAdding(null),
          onToggle: name => {
            if (!adding) {
              return
            }

            // Already in this group? Then this click files it OUT — membership is
            // a map, so "out" is simply the absence of the key.
            moveToSection([name], model.members[name] === adding.id ? UNASSIGNED : adding.id)
          },
          open: Boolean(adding),
          profiles: rows.map(row => ({
            inside: Boolean(adding) && model.members[row.name] === adding.id,
            label: row.label,
            name: row.name
          })),
          section: adding
        },
        'add-profiles'
      ),
      jsx(
        EditProfileDialog,
        {
          onClose: () => setEditingProfileRow(null),
          open: Boolean(editingProfileRow),
          queryClient,
          row: editingProfileRow
        },
        'edit-profile-dialog'
      ),
      jsxs('div', {
        className: 'flex min-w-0 items-center gap-1 px-2.5 pb-1.5',
        children: [
          jsx(SearchField, {
            'aria-label': t('search'),
            containerClassName: cn('min-w-0 flex-1', query ? 'opacity-100!' : 'opacity-50 focus-within:opacity-100'),
            inputClassName: 'w-full text-[0.75rem] placeholder:text-(--ui-text-tertiary)',
            onChange: setQuery,
            placeholder: t('searchPlaceholder'),
            value: query
          }),
          jsx(FilterMenu, { ...filters, onActivity: setActivity, onKind: setKind, onProfiles: setProfiles, rows, t })
        ]
      }),
      searching && deep.isFetching
        ? jsx('div', {
            className: 'px-2.5 pb-1 text-[0.6875rem] text-(--ui-text-quaternary)',
            children: t('searching')
          })
        : null,
      body
    ]
  })
}

export default {
  id: ID, // must match the folder name
  name: 'Personae',
  register(ctx) {
    ctxRef = ctx
    loadPrefs()

    ctx.i18n.register({
      en: {
        activeNow: 'Active now',
        allProfiles: 'All profiles',
        anyActivity: 'Any activity',
        anySessions: 'Any profile',
        bodyMatch: 'Message text match',
        cancelGroup: 'Cancel new group',
        empty: 'No profiles',
        emptyHint: 'Nothing came back from profiles.list.',
        filtered: 'Nothing matches',
        filteredHint: 'Loosen the search or the filters.',
        filters: 'Filter profiles',
        filtersActive: count => `Filters (${count} active)`,
        groupEmpty: 'Empty — right-click a profile → Move to section…',
        groupName: 'Group name',
        loadFailed: 'Could not load profiles',
        newGroup: 'New group',
        newSession: 'New session with…',
        noSessions: 'Without sessions',
        older: 'Older',
        paneTitle: 'Personae',
        profilesLabel: 'profiles',
        recentlyActive: 'Recently active',
        cancel: 'Cancel',
        create: 'Create',
        deliver: 'Deliver',
        deleteJob: 'Delete job',
        jobName: 'Name',
        jobNameHint: 'Morning briefing',
        jobPrompt: 'Instruction',
        jobPromptHint: 'What should the job do when it fires?',
        jobSchedule: 'Schedule',
        lastResult: 'Last result',
        lastRun: 'Last run',
        model: 'Model',
        nextRun: 'next',
        overdueSince: 'overdue',
        rawSchedule: 'Raw schedule',
        repeat: 'Repeat',
        resultBlocked: 'Blocked by config',
        resultDeliveryFailed: 'Delivery failed',
        resultFailed: 'Failed',
        resultOk: 'Succeeded',
        routines: 'Scheduled jobs',
        routinesActive: 'active',
        routinesCreateFailed: 'The job was not created.',
        routinesEmpty: 'Nothing scheduled for any profile.',
        routinesHere: 'Nothing scheduled for this profile.',
        routinesOff: 'off',
        routinesOffline: 'Scheduler offline — jobs will not fire.',
        routinesPaused: 'paused',
        routinesUpdateFailed: 'The job was not updated.',
        schedule: 'Schedule',
        screenConnecting: 'Connecting…',
        screenHidden: 'Hidden — someone else is driving',
        screenLive: 'Live',
        screenMissing: 'No screen installed',
        screenOff: 'Screen stopped',
        screenOther: 'Someone else is on it',
        screenTakeover: 'Takeover, install and start live in Bot Mode → Screen.',
        screenTitle: 'Screen',
        status: 'Status',
        search: 'Search profiles',
        searchPlaceholder: 'Search profiles and their sessions',
        searching: 'Searching sessions…',
        apropos: 'Apropos (beta)',
        aproposMade: 'Apropos groups created',
        archive: 'Archive',
        archived: 'archived',
        delete: 'Delete',
        deleted: 'deleted',
        clear: 'Clear',
        close: 'Close',
        closed: 'closed',
        done: 'Done',
        failed: 'failed',
        select: 'Select sessions',
        selectAll: 'Select all',
        selectOff: 'Select sessions — click to stop',
        selectOn: 'Select sessions',
        selected: 'selected',
        toasts: 'Activity toasts',
        toastsOff: 'Activity toasts off — click to enable',
        toastsOn: 'Activity toasts on — click to silence',
        viewAll: 'View all',
        viewAllEmpty: 'No sessions for this profile.',
        viewArchiveUnavailable: 'Archive unavailable — the messenger backend is not mounted in this build.',
        viewArchived: 'View Archived',
        viewArchivedEmpty: 'Nothing archived for this profile.',
        viewHidden: 'View hidden',
        viewHiddenEmpty: 'Nothing hidden in Personae for this profile.',
        unhideAll: 'Unhide all',
        viewBack: 'Back',
        viewSessions: 'sessions',
        withSessions: 'With sessions'
      }
    })

    // `placement: 'left'` is the semantic role — the pane stacks (tabs) with
    // the existing panes of that role, which is the "tab beside Sessions |
    // Bots" behaviour. No `dock` gesture: a dock would move it to a specific
    // edge instead of joining the strip.
    // `hideOnly` is the sessions/Bots chrome (hermes-bots/plugin.tsx sets the
    // same flag): the tab carries NO ✕ — too easy to hit by accident — and the
    // zone menu / ⌘K show-or-hide it instead; deactivating the plug-in in
    // Capabilities → Plug-ins is how it goes away for good. NOT `uncloseable`:
    // that flag ALSO disables the ZONE's minimize (tree-group.tsx:428) and this
    // pane shares its zone with Sessions | Bots, so collapsing the left zone
    // would stop working.
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Personae',
      data: { hideOnly: true, placement: 'left', width: '280px' },
      render: () => jsx(MessengerPane, {})
    })

    // The right edge's Scheduled jobs tile — the same one Bots puts beside the
    // chat: `placement: 'main'` with a `right` dock (NOT the collapsible right
    // sidebar, which is what placement 'right' means), and `defaultCollapsed`
    // so it arrives as a thin vertical tab and takes no width off the chat
    // until the user opens it.
    //
    // Registered ONLY while the Messenger pane is on screen: a Scheduled jobs
    // tile must not squat beside the chat from an unrelated view, which is why
    // Bots gates its own this way. Feature-detected — a desktop without
    // `host.paneVisibility` keeps the always-registered behavior.
    const registerRoutines = () =>
      ctx.register({
        id: 'routines',
        area: 'panes',
        title: 'Scheduled jobs',
        data: {
          defaultCollapsed: true,
          dock: { pane: 'workspace', pos: 'right', enforce: true },
          placement: 'main',
          width: '250px'
        },
        render: () => jsx(RoutinesPane, {})
      })

    if (typeof host.paneVisibility === 'function') {
      const $visible = host.paneVisibility(`${ID}:pane`)
      let disposeRoutines = null

      const syncRoutines = visible => {
        if (visible && !disposeRoutines) {
          disposeRoutines = registerRoutines()
        } else if (!visible && disposeRoutines) {
          disposeRoutines()
          disposeRoutines = null
        }
      }

      if (typeof $visible?.listen === 'function') {
        $visible.listen(syncRoutines)
      }

      syncRoutines(typeof $visible?.get === 'function' ? Boolean($visible.get()) : false)
    } else {
      registerRoutines()
    }
  }
}

/** Test seam — the pure decision layer, so the headless harness can exercise
 *  filtering and grouping without a DOM to type into. Not part of the plugin
 *  API: the app reads `default` and nothing else. */
export const __internals = {
  createGroupNow,
  dropAction,
  elementAt,
  $expanded,
  $listView,
  allSessionKeys,
  archiveSession,
  archiveSessionEntry,
  aproposChildren,
  aproposCreateGroup,
  childrenOfRow,
  linkForRow,
  memberGroupFor,
  rowIdentities,
  rowIdSet,
  storedKeyFor,
  aproposEntry,
  aproposSession,
  aproposSourceName,
  APROPOS_KEY,
  $apropos,
  buildAproposDigest,
  buildAproposGroupDigest,
  APROPOS_GROUP_MAX,
  ProfileRow,
  dragArmed,
  guardClick,
  ITEM_DRAG_THRESHOLD,
  itemDrag,
  itemDragStart,
  aproposSelection,
  setSessionOrder,
  setSessionSort,
  deleteSessionEntry,
  normalizeSessionSort,
  sessionSortMode,
  SESSION_SORT_KEY,
  SESSION_SORT_LABELS,
  SESSION_SORT_MODES,
  $sessionSort,
  sortProfileSessions,
  withAproposChildren,
  aproposGroupCount,
  aproposChildTitle,
  aproposRetitlePlan,
  renameAproposGroup,
  aproposGroupSession,
  rememberAproposGroup,
  copySessionId,
  copyText,
  clip,
  messageText,
  normalizeApropos,
  rememberApropos,
  branchSession,
  closeSession,
  runOverSessions,
  selectedSessions,
  sessionKey,
  SelectBar,
  toggleSelected,
  tickState,
  forgetApropos,
  forgetDeletedSession,
  unfileSession,
  isNotFound,
  aproposVerbKind,
  markSessionGroupApropos,
  noteReleased,
  releasedFor,
  aproposSources,
  $released,
  exportPayload,
  $routineProfile,
  $routinesEpoch,
  bumpRoutines,
  fetchRoutines,
  groupRows,
  moveSection,
  nextRunOverdueMs,
  normalizeSections,
  applySessionOrder,
  nextSessionIds,
  placeNames,
  setOrder,
  setSort,
  sortRows,
  RoutineDetail,
  SESSIONS_PER_PROFILE,
  SESSIONS_FILL_CAP,
  wantedSessionIds,
  nextSessionLimit,
  $loadFailures,
  botLabel,
  botsMetaOf,
  fillOf,
  sessionColorBox,
  deleteSessionChain,
  EditProfileDialog,
  botMetaPatch,
  CREATED_OPEN,
  CHILDLESS_OPEN,
  BRANCH_OPEN,
  INTENT_OPEN,
  EXPANDED_KEY,
  normalizeExpanded,
  humanPreview,
  listAllSessions,
  sessionLabel,
  sweepCandidates,
  listArchivedSessions,
  listProfileSessions,
  dockSessions,
  moveSessionToProject,
  newSession,
  normalizeColors,
  openProfileSessions,
  openSession,
  projectCwd,
  refreshSessions,
  relTime,
  renameSession,
  RoutineCard,
  routineAction,
  routineRows,
  SectionHeading,
  SessionGroupHeading,
  SessionRow,
  createSessionGroup,
  deleteSessionGroup,
  GroupColorRow,
  groupMenuNodes,
  hiddenFor,
  listHiddenSessions,
  moveSessionGroup,
  NameField,
  nextGroupName,
  nextSectionName,
  numberedName,
  sessionGroupMenuEntries,
  clickSelect,
  rememberAproposGroup,
  rowsWithSessions,
  normalizeHidden,
  sessionCloseCandidates,
  setSessionHidden,
  unhideAll,
  moveSessionsToGroup,
  normalizeSessionGroups,
  profileSessionGroups,
  renameSessionGroup,
  reorderSessionGroups,
  sessionGroupBlocks,
  sessionGroupMoveTargets,
  sessionGroupShell,
  sessionMoveTarget,
  setSessionGroupColor,
  toggleSessionGroupCollapsed,
  $hiddenSessions,
  $sessionGroups,
  sessionColor,
  setSessionColor,
  toggleExpanded,
  bodyHit,
  matchesActivity,
  mergeBodyHits,
  searchInSessions,
  sessionMatches,
  scheduleLabel,
  screenTone,
  visibleRows
}
