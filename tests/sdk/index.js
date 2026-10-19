/**
 * Stub of `@hermes/plugin-sdk` for the headless harness.
 *
 * Every named export the plugin imports MUST exist here by that exact name —
 * an unstubbed import is `undefined` at call time and throws somewhere
 * unrelated. Components render as plain host elements carrying data-* markers,
 * so the test can assert on the TREE (which glyph/tone/state) rather than on
 * pixels. Reactive host state and `useQuery` are global-backed: the test sets
 * `globalThis.__PERSONAE_HARNESS__` and reads back what the code asked for.
 */

import { createContext, useContext } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** Everything the test observes lives here. */
const harness = () => {
  const g = globalThis

  g.__PERSONAE_HARNESS__ ||= {
    events: {},
    i18n: {},
    newChats: [],
    opens: [],
    profile: null,
    queries: [],
    queryResults: {},
    requests: [],
    responses: {},
    revealed: [],
    siblingUrls: [],
    workspaces: [],
    colors: [],
    errors: [],
    rest: { calls: [] },
    sessions: {},
    storage: {},
    toasts: [],
    unread: []
  }

  return g.__PERSONAE_HARNESS__
}

/** Deliver a gateway event to whatever the plugin subscribed (and to nothing
 *  else) — the Screen pane's lease/install handling is driven by these. */
export function emit(type, payload) {
  const handlers = harness().events[type] || []

  handlers.forEach(handler => handler(payload))

  return handlers.length
}

// ── host ────────────────────────────────────────────────────────────────────

/** `__value` is a getter: the plugin and the test both write through `set()`,
 *  and `useValue` must read what was last written. */
export function atom(value) {
  const box = { value }

  return {
    get: () => box.value,
    set: next => {
      box.value = next
    },
    get __value() {
      return box.value
    }
  }
}

export const host = {
  state: {
    activeSessionId: atom(null),
    cwd: atom('/tmp'),
    /** The durable id + owner of the focused chat, which is what a "back to
     *  where I was" control navigates with (activeSessionId is a runtime id). */
    focusedSessionProfile: atom('default'),
    focusedStoredSessionId: atom(null),
    gateway: atom('127.0.0.1:9119'),
    model: atom('deepseek-flash'),
    profile: atom('default'),
    viewport: atom('desktop')
  },
  async request(method, params) {
    const h = harness()

    h.requests.push({ method, params })

    const responder = h.responses[method]

    if (typeof responder === 'function') {
      return responder(params)
    }

    if (responder === undefined) {
      throw new Error(`stub has no response for ${method}`)
    }

    return responder
  },
  /** The sidebar's own per-profile "+" door. */
  newChat(profile) {
    harness().newChats.push(profile)
  },
  /** Open a session in the workspace. The app FOCUSES what it opened, so the
   *  stub must too — `focusedStoredSessionId` is the atom the cross-profile fix
   *  reads. `h.openLandsOn` forces where the NEXT open lands, which is how a
   *  test reproduces "the switch restored a different session". */
  async openSession(id, options) {
    const h = harness()

    h.opens.push({ id, options })

    const landing = h.openLandsOn
    h.openLandsOn = null
    host.state.focusedStoredSessionId.set(landing ?? id)
  },
  /** Sessions of another profile, read through the source primary. */
  async listPersistedSessions(route, options) {
    const h = harness()

    h.sessions.calls = [...(h.sessions.calls || []), { options, route }]

    const entry = h.sessions.byProfile?.[options.profile]

    if (entry instanceof Error) {
      throw entry
    }

    return entry || { sessions: [] }
  },
  notify(payload) {
    harness().toasts.push(payload)
  },
  /** Subscribe to a gateway event; returns the disposer core returns. */
  onEvent(type, handler) {
    const h = harness()

    h.events[type] = [...(h.events[type] || []), handler]

    return () => {
      h.events[type] = (h.events[type] || []).filter(entry => entry !== handler)
    }
  },
  /** The Screen pane's own tab. `render` is kept unrendered: the test calls it
   *  to prove the pane opens SOMETHING, and asserts on the returned markup.
   *  The returned disposer mirrors core's: it tears down ONCE and fires
   *  `onClose`, which is what the strip's ✕ and ⌘W run — a stub that skipped
   *  the callback would hide a pane that never lets go of its tab. */
  openWorkspace(id, options = {}) {
    const h = harness()
    const entry = { closed: false, id, options }

    h.workspaces = [...h.workspaces, entry]

    return () => {
      if (entry.closed) {
        return
      }

      entry.closed = true
      options.onClose?.()
    }
  },
  revealPane(id) {
    const h = harness()

    h.revealed = [...h.revealed, id]
  },
  notifyError(payload) {
    const h = harness()

    h.errors = [...(h.errors || []), payload]
  },
  /** Core's own per-session colour override store. */
  sessions: {
    setColor(storedSessionId, color) {
      const h = harness()

      h.colors = [...(h.colors || []), { color, id: storedSessionId }]
    }
  }
}

/** The unread store behind `SessionStatusDot`'s emerald dot. */
export function markSessionUnreadFinished(storedSessionId, profileHint) {
  harness().unread.push({ id: storedSessionId, profile: profileHint })
}

// ── reactive helpers ────────────────────────────────────────────────────────

/** Reads the atom's plain value — no React subscription in the harness. */
export function useValue(readable) {
  return readable?.__value ?? null
}

/** Keyed lookup so a test can answer the roster query and the per-profile
 *  avatar query independently. Unknown key → the real "pending, no data"
 *  shape (that is also what a disabled query looks like to a component). */
export function useQuery(options) {
  const h = harness()

  h.queries.push(options)

  const key = (options.queryKey || []).join('|')

  return h.queryResults[key] || { data: undefined, error: null, isError: false, isFetching: false, isPending: true }
}

export function usePluginI18n() {
  return (key, ...args) => {
    const value = harness().i18n[key]

    return typeof value === 'function' ? value(...args) : value ?? key
  }
}

// ── UI kit (host elements with assertion markers) ───────────────────────────

export function Badge({ children, className }) {
  return jsx('span', { className: `badge ${className || ''}`.trim(), 'data-slot': 'badge', children })
}

export function Button({ children, className, onClick, size, variant, ...props }) {
  return jsx('button', { className, onClick, type: 'button', ...props, children })
}

export function Codicon({ className, name }) {
  return jsx('span', { className, 'data-codicon': name, 'data-slot': 'codicon' })
}

export function ContextMenu({ children }) {
  return children
}

/**
 * Radix's two menu families are DIFFERENT context scopes, and the failure is
 * not cosmetic: `createContextScope`'s provider writes its context into the
 * CALLER's scope array, so a `DropdownMenuItem` rendered inside a
 * `ContextMenu` looks up a `Menu` context nobody provided under its scope and
 * throws `` `MenuItem` must be used within `Menu` `` at RENDER time — the
 * pane's right-click crash of 2026-10-09. The stub enforces the same rule, so
 * mixing the families fails HERE instead of in Pedro's window.
 */
const MenuScope = createContext('none')

export function ContextMenuContent({ children }) {
  return jsx(MenuScope.Provider, {
    value: 'context',
    children: jsx('div', { 'data-slot': 'context-menu-content', children })
  })
}

export function ContextMenuItem({ children, disabled, variant }) {
  if (useContext(MenuScope) !== 'context') {
    throw new Error('`MenuItem` must be used within `Menu`')
  }

  // `variant` and `disabled` are forwarded the way core's own item forwards
  // them (`data-variant={variant}` in components/ui/context-menu.tsx), so the
  // harness can prove a destructive verb IS destructive instead of trusting it.
  return jsx('div', {
    'data-disabled': disabled ? '' : undefined,
    'data-slot': 'context-menu-item',
    'data-variant': variant,
    children
  })
}

export function ContextMenuTrigger({ children }) {
  return children
}

export function ContextMenuSeparator() {
  return jsx('div', { 'data-slot': 'context-menu-separator' })
}

/** A submenu. Its CONTENT is a portal boundary, so it re-provides the context
 *  scope — items nested under it must pass the same family guard as top-level
 *  ones (that guard is what caught the mixed-menu crash). */
export function ContextMenuSub({ children }) {
  return children
}

export function ContextMenuSubContent({ children }) {
  return jsx(MenuScope.Provider, {
    value: 'context',
    children: jsx('div', { 'data-slot': 'context-menu-sub-content', children })
  })
}

export function ContextMenuSubTrigger({ children }) {
  return jsx('div', { 'data-slot': 'context-menu-sub-trigger', children })
}

/** The app's swatch grid. The harness cannot click, so the colour WRITE path is
 *  driven through `__internals.setSessionColor`; this stub only has to look
 *  like the real one for render assertions. */
export function ColorSwatches({ clearLabel, swatches, value }) {
  return jsxs('div', {
    'data-slot': 'color-swatches',
    'data-value': value || '',
    children: [
      ...swatches.map(swatch => jsx('button', { 'data-swatch': swatch }, swatch)),
      jsx('button', { 'data-slot': 'color-clear', children: clearLabel }, 'clear')
    ]
  })
}

/** Stands in for the real palette (same shape: fixed hexes, six per row). */
export const PROFILE_SWATCHES = [
  '#e5484d',
  '#e5873a',
  '#e5c33a',
  '#54a85a',
  '#3abfbf',
  '#3b82f6',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#78716c',
  '#3f3f46'
]

export function DisclosureCaret({ open }) {
  return jsx('span', { 'data-open': open ? 'true' : 'false', 'data-slot': 'caret' })
}

export function DropdownMenu({ children }) {
  return children
}

export function DropdownMenuContent({ children }) {
  return jsx(MenuScope.Provider, {
    value: 'dropdown',
    children: jsx('div', { 'data-slot': 'dropdown-content', children })
  })
}

export function DropdownMenuItem({ children, disabled, onSelect, variant }) {
  if (useContext(MenuScope) !== 'dropdown') {
    throw new Error('`MenuItem` must be used within `Menu`')
  }

  // `variant` is forwarded the way core's own item forwards it
  // (`data-variant={variant}` in components/ui/dropdown-menu.tsx), so the
  // harness can prove the group menus agree about which verb is destructive.
  return jsx('div', {
    'data-disabled': disabled ? '' : undefined,
    'data-slot': 'dropdown-item',
    'data-variant': variant,
    children
  })
}

export function DropdownMenuSeparator() {
  return jsx('div', { 'data-slot': 'dropdown-separator' })
}

export function DropdownMenuTrigger({ children }) {
  return children
}

export function EmptyState({ title, description }) {
  return jsx('div', { 'data-slot': 'empty-state', children: [title, description].filter(Boolean).join(' | ') })
}

export function ErrorState({ title, description, children }) {
  return jsx('div', {
    'data-slot': 'error-state',
    children: [title, description].filter(Boolean).join(' | '),
    ...(children ? { 'data-has-children': 'true' } : {})
  })
}

export function Input({ className, ...props }) {
  return jsx('input', { className, 'data-slot': 'input', ...props })
}

export function RowButton({ className, children, ...props }) {
  return jsx('button', { className, type: 'button', ...props, children })
}

export function SearchField({ containerClassName, inputClassName, value, onChange, ...props }) {
  return jsx('input', {
    'data-slot': 'search-field',
    ...props,
    className: inputClassName,
    onChange: event => onChange?.(event.target.value),
    value: value ?? ''
  })
}

export function SessionStatusDot({ storedSessionId }) {
  return jsx('span', {
    'data-slot': 'session-status-dot',
    'data-stored-session-id': storedSessionId ?? 'null'
  })
}

export function SidebarRowLead({ className, children, ...props }) {
  return jsx('span', { className, 'data-slot': 'sidebar-row-lead', ...props, children })
}

export function Skeleton({ className, ...props }) {
  return jsx('div', { 'data-slot': 'skeleton', className, ...props })
}

export function StatusDot({ tone, className }) {
  return jsx('span', { 'data-slot': 'status-dot', 'data-tone': tone, className })
}

export function Tip({ children }) {
  return children
}

export const NEXT_RUN_OVERDUE_GRACE_MS = 15 * 60 * 1000

/** Mirror of `core:src/app/cron/job-state.ts` — a parked slot past the grace is
 *  the only trace of a dead scheduler, so the same rule has to hold here. */
/** Mirrors `src/app/cron/job-state.ts::nextRunOverdueMs` INCLUDING its null
 *  behaviour: the real one passes `job` to `jobState`, which reads `job.state`
 *  with no optional chain — so a null job THROWS there. The optional chain this
 *  used to carry let the pane's first-render null-job crash pass every harness
 *  test while the app died with "Cannot read properties of null (reading
 *  'state')" (2026-10-09). A test double may not be kinder than the real thing.
 *  Do not soften this back. */
export function nextRunOverdueMs(job, nowMs = Date.now()) {
  const raw = typeof job.state === 'string' ? job.state.trim() : ''
  const state = raw || (job.enabled === false ? 'disabled' : 'scheduled')

  if (state === 'paused' || state === 'completed' || state === 'disabled' || !job.next_run_at) {
    return null
  }

  const at = Date.parse(job.next_run_at)

  if (Number.isNaN(at)) {
    return null
  }

  const overdue = nowMs - at

  return overdue > NEXT_RUN_OVERDUE_GRACE_MS ? overdue : null
}

/** Radix Switch, reduced to what a static render can carry: the state, and the
 *  toggle callback the real primitive would fire. */
export function Switch({ checked, className, disabled, onCheckedChange }) {
  return jsx('button', {
    className,
    'data-slot': 'switch',
    'data-state': checked ? 'checked' : 'unchecked',
    disabled,
    onClick: () => onCheckedChange?.(!checked),
    type: 'button'
  })
}

export function Dialog({ children, open }) {
  return open ? jsx('div', { 'data-slot': 'dialog', children }) : null
}

export function DialogContent({ children, className }) {
  return jsx('div', { className, 'data-slot': 'dialog-content', children })
}

export function DialogDescription({ children, className }) {
  return jsx('div', { className, 'data-slot': 'dialog-description', children })
}

export function DialogFooter({ children }) {
  return jsx('div', { 'data-slot': 'dialog-footer', children })
}

export function DialogHeader({ children }) {
  return jsx('div', { 'data-slot': 'dialog-header', children })
}

export function DialogTitle({ children, className }) {
  return jsx('div', { className, 'data-slot': 'dialog-title', children })
}

export function cn(...args) {
  return args.flat(Infinity).filter(Boolean).join(' ')
}

// ── pure helpers (mirror the real contracts) ────────────────────────────────

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function coarseElapsed(deltaMs) {
  const ms = Math.max(0, deltaMs)

  if (ms >= DAY) {
    return { unit: 'day', value: Math.floor(ms / DAY) }
  }

  if (ms >= HOUR) {
    return { unit: 'hour', value: Math.floor(ms / HOUR) }
  }

  if (ms >= MINUTE) {
    return { unit: 'minute', value: Math.floor(ms / MINUTE) }
  }

  return { unit: 'second', value: Math.floor(ms / 1000) }
}

/** Null for default/empty — that is the real contract the pane relies on. */
export function profileColor(name) {
  const key = String(name ?? '').trim()

  if (!key || key === 'default') {
    return null
  }

  return `hsl(120 45% 45%)`
}

export function profileColorSoft(color, percent = 16) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/** The app's ONE QueryClient, shared with core screens — the SDK exports it so
 *  a plugin can invalidate a key it does not own (the roster, after a batch). */
export const queryClient = {
  invalidateQueries(options) {
    const h = harness()

    h.invalidated = [...(h.invalidated || []), options]

    return Promise.resolve()
  }
}

// ── sibling streams (the Bot Screen's raw RFB) ──────────────────────────────

/** The real resolver mints an authenticated `ws(s)://<gateway>/<path>` on the
 *  route's own connection, and `stripGatewayCredential` drops the gateway's
 *  one-shot ticket so the display bridge can spend its OWN. Here the origin is
 *  fixed and the call is recorded: what the test asserts on is the ticket the
 *  plugin appends, and that the path is `/api/display/ws`. */
export async function resolveSiblingWsUrl(route, path, options = {}) {
  const h = harness()

  h.siblingUrls = [...h.siblingUrls, { options, path, route }]

  return `ws://harness.local${path.startsWith('/') ? path : `/${path}`}`
}

export { harness }
