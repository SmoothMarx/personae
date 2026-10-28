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
 * Two dot layers, one vocabulary (core's `$sessionDotStateById`):
 *
 * 1. A SESSION row renders core's own `SessionStatusDot`, which resolves the
 *    state itself from the stored id (the app's live-state registry is keyed by
 *    that id, so it answers for any profile).
 * 2. The PROFILE row's dot is an AGGREGATE of that profile's sessions, never
 *    the state of its latest one. `SessionStatusDot` handed a single id can
 *    only report that one session, so answering the newest blocked session
 *    silenced the row while a second session still waited. Pedro, 2026-10-10:
 *    "two sessions show orange because they need interaction … when the latest
 *    session has been resolved, the profile dot goes silent, but there's still
 *    another session awaiting interaction. is it possible for the statusdot to
 *    show that instead?" The aggregate is the LOUDEST state among the profile's
 *    sessions (needs-input > working > unread), it stays lit while ANY session
 *    holds it, and the badge counts the non-idle sessions behind it.
 *
 * The aggregate cannot ride core's own rollup (`profileDotSummaryFor` is a
 * private core export, not in the SDK), so the pane derives it from the two
 * sources a plugin CAN read:
 *   live    `session.active_list` → `{stored id: status}`. `waiting` is the
 *           gateway's pending server→client request — core's amber, exactly.
 *           This covers the sessions live in THIS gateway process.
 *   unread  each profile's OWN rows (`host.listPersistedSessions` — a direct
 *           `state.db` read, no backend dial), whose `unread` flag is
 *           `SessionDB.session_unread`: the one state that survives a restart,
 *           and the only one readable for a profile with no live runtime. NOT
 *           `session.list`: that RPC's row projection drops `unread`. The read
 *           is cached per profile (`dotListCache`): re-read on a moved roster
 *           stamp, otherwise at most once per `DOT_LIST_TTL_MS`, and capped at
 *           the endpoint's own 500-row page.
 * A profile with nothing readable falls back to core's `SessionStatusDot` for
 * its latest session — what this row drew before — so a store that cannot be
 * read degrades to the old dot instead of blanking the row. The pane also feeds
 * REMOTE profiles itself: when a poll sees a profile's `last_active` advance
 * past its watermark it writes `markSessionUnreadFinished(id, profile)` — the
 * SDK's unread store, which exists for exactly this ("a roster poll's activity
 * watermark, say").
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
 * Save:  ~/.hermes/desktop-plugins/personae/plugin.js   (folder name == id)
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
  resolveSiblingWsUrl,
  usePluginI18n,
  queryClient,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// ── BEGIN vendored markdown-text.js (sha256 d68979838c656d2d0e570495e815c088d3e7cd7f59ded38193a9f8f6cdc1a0da) — edit shared/markdown-text.js, then run scripts/vendor-markdown-text.sh ──
/**
 * markdown-text.js — the ONE definition of "what a message says when its markdown is not drawn".
 *
 * Zero imports, plain ESM, no build step: this file runs unchanged under node, under Metro (the
 * phone) and under the desktop app's plugin loader. It is AUTHORED in `shared/` and VENDORED BY
 * COPY — `scripts/vendor-markdown-text.sh` copies it to the phone
 * (`personae-mobile/src/logic/markdown-text.js`) and inlines it into `desktop/plugin.js` between two
 * sentinel lines. The sha256 is asserted in BOTH harnesses, so editing either copy without running
 * the script turns a suite red. That is the whole mechanism, and it exists for one concrete reason:
 * six months from now somebody must not write a second markdown stripper from scratch inside
 * `plugin.js` because importing was impossible.
 *
 * Two consumers, one policy:
 *   * the phone  — `src/logic/markdown.ts` (`plainText()`, and the flattener used for parity);
 *   * the plugin — the roster's one-line previews, the activity toast, the search snippet
 *                  (no rendering: a plugin is ONE file with no build step and no DOM).
 *
 * What lives here is TEXT, not structure: `stripMarkdown` is regex-based on purpose, because the
 * plugin cannot run a parser. The mobile side renders from `unified`/mdast; `flattenInline` and
 * `flattenBlocks` are the mdast→text mirror of the same policy, for the case where the phone
 * already holds the tree.
 */

export const MARKDOWN_TEXT_VERSION = '1';

/** Shared policy: these delimiters are MATH. This batch paints math as typed — never parsed. */
export const MATH_DELIMITERS = ['$', '$$'];

/** An opening fence, as a regex (a line starting with ``` or ~~~). */
export const FENCE = /(^|\n)(```|~~~)/;

/**
 * Fence languages, normalised. `js` and `JS` are the same language; a preview that says `js` and a
 * code header that says `javascript` would be two names for one thing. An UNKNOWN language is
 * displayed exactly as typed (never title-cased, never guessed).
 */
const LANGUAGE_LABELS = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  py3: 'python',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  cs: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  go: 'go',
  json: 'json',
  sql: 'sql',
  html: 'html',
  css: 'css',
  toml: 'toml',
  ini: 'ini',
  dockerfile: 'dockerfile',
  console: 'console',
  text: 'text',
};

/**
 * The label shown for a fence's info string: the normalised lowercase name when it is known, the
 * raw first word when it is not, and `''` for an unlabelled fence. The info string may carry meta
 * after the language (`js title="x"`) — only the first word is the language.
 */
export function languageLabel(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  const first = value.split(/\s+/)[0];
  return LANGUAGE_LABELS[first.toLowerCase()] || first;
}

// ── the cheap gate ──────────────────────────────────────────────────────────────────────────────
// One regex test, and the caller returns the input untouched when it says no. It must therefore
// fire on anything that carries a marker and stay silent on prose that merely contains punctuation.
// An `_` or `*` only counts as emphasis at a WORD BOUNDARY, so `snake_case_name` is not markdown.
const MARKERS = new RegExp(
  [
    '(^|\\n)[ \\t]{0,3}(#{1,6}[ \\t]|>|[-*+][ \\t]|\\d{1,9}[.)][ \\t]|`{3,}|~{3,}|\\|)', // block markers
    '(\\*\\*|__|~~)', // paired markers
    '(^|[\\s([{"\u00ab\u2018\u201c])[*_][^\\s*_]', // emphasis, at a boundary only
    '`[^`]+`', // inline code
    '!?\\[[^\\]]*\\]\\([^)]*\\)', // link or image
  ].join('|'),
  'm',
);

/** True when `text` looks like it carries markdown. Cheap (one regex), and never throws. */
export function looksMarkdown(text) {
  return MARKERS.test(String(text == null ? '' : text));
}

// ── inline markers ──────────────────────────────────────────────────────────────────────────────

/**
 * One line, with its inline markers out: code spans unwrapped, links and images flattened to the
 * text they show, emphasis and strike unwrapped, cell separators become spaces, escapes resolved.
 */
function stripInline(line) {
  let out = String(line);

  // Raw HTML is NOT stripped, and that is a decision rather than an omission: the phone paints an
  // html node as its literal source (§4.2), so a preview that dropped `<b>` would disagree with the
  // bubble it previews.
  out = out.replace(/`([^`]*)`/g, '$1'); // `code`   -> code
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // ![alt](u) -> alt
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // [text](u) -> text
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1'); // [text][id] -> text

  // strong before em, and both at a boundary: `snake_case_name` keeps its underscores
  out = out.replace(/(^|[^\w])(\*\*|__)(?=\S)([\s\S]*?\S)\2(?=[^\w]|$)/g, '$1$3');
  out = out.replace(/(^|[^\w])([*_])(?=\S)([^\s]*?\S)\2(?=[^\w]|$)/g, '$1$3');
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');

  out = out.replace(/(^|[^\\])\|/g, '$1 '); // a table cell separator is a marker
  out = out.replace(/\\\|/g, '|'); // ... and an escaped pipe is content
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1'); // markdown escapes resolve

  return out;
}

/** One line, with its block markers out (heading hashes, quote carets, list bullets, rules). */
function stripLine(line) {
  let out = String(line);

  if (/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(out)) return ''; // a horizontal rule is a line
  // A GFM delimiter row (`|---|---|`) is a marker too: it carries no text, and leaving it would put
  // `--- ---` in the middle of a preview.
  if (out.includes('|') && /^[ \t|:-]+$/.test(out)) return '';

  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, ''); // # heading
  out = out.replace(/^[ \t]*>[ \t]?/, ''); // > quote
  out = out.replace(/^[ \t]*>[ \t]?/, ''); // > > nested quote, one more level
  out = out.replace(/^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/, ''); // - or 1. list marker

  return stripInline(out);
}

/** Every run of whitespace becomes one space; ends trimmed. */
function collapse(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/** Truncate at `limit` characters, or not at all when `limit` is 0/absent. */
function clamp(text, limit) {
  if (!(limit > 0) || text.length <= limit) return text;
  return text.slice(0, limit).trimEnd();
}

// ── the stripper ────────────────────────────────────────────────────────────────────────────────

/**
 * The markdown OUT of a source string, for a surface that shows text and nothing else.
 *
 *   * markers out                              (`**bold**` -> `bold`)
 *   * whitespace collapsed to single spaces    (a preview is ONE line)
 *   * a fenced BODY dropped to its language    (```js … ``` -> `js`, never a wall of backticks)
 *   * links flattened to their text            ([text](url) -> text)
 *   * truncated at `limit`                     (0 = no limit)
 *
 * `looksMarkdown` gates the whole pass: prose with no markers is only whitespace-collapsed, so a
 * message that merely contains a `*` or an `_` cannot be mangled by a stripper that had no work.
 */
export function stripMarkdown(text, limit = 0) {
  const source = String(text == null ? '' : text);
  if (!looksMarkdown(source)) return clamp(collapse(source), limit);

  const out = [];
  let fenceChar = '';
  for (const line of source.split(/\r?\n/)) {
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (fenceChar && marker !== fenceChar) continue; // the other kind of fence, inside one: text
      if (fenceChar) {
        fenceChar = ''; // closing fence
        continue;
      }
      fenceChar = marker;
      const label = languageLabel(fence[2]);
      if (label) out.push(label);
      continue;
    }
    if (fenceChar) continue; // the BODY of a fence is dropped, not flattened
    out.push(stripLine(line));
  }

  return clamp(collapse(out.join(' ')), limit);
}

// ── the mdast mirror (used by the phone, which already holds the tree) ──────────────────────────

/** An mdast inline array as text: the same policy as `stripInline`, applied to nodes. */
export function flattenInline(nodes, opts) {
  const separator = (opts && opts.separator) || ' ';
  const list = Array.isArray(nodes) ? nodes : [];
  let out = '';
  for (const node of list) out += inlineText(node, separator);
  return out;
}

function inlineText(node, separator) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const type = String(node.type || '');
  if (type === 'break') return separator;
  if (type === 'image' || type === 'imageReference') {
    return typeof node.alt === 'string' ? node.alt : '';
  }
  if (type === 'footnoteReference') return '';
  if (typeof node.value === 'string') return node.value; // text, inlineCode, html (literal), unknown
  if (Array.isArray(node.children)) return flattenInline(node.children, { separator });
  return '';
}

/** An mdast root (or any block array) as text, blocks joined by `separator` (default one space). */
export function flattenBlocks(nodes, opts) {
  const separator = (opts && opts.separator) || ' ';
  const list = Array.isArray(nodes) ? nodes : [];
  const parts = [];
  for (const node of list) {
    const text = blockText(node, separator);
    if (text && text.trim()) parts.push(text.trim());
  }
  // The SAME normalisation `stripMarkdown` applies, and for the same reason: a preview is one line.
  // A soft break lives INSIDE a text node's value (mdast keeps it there), so without this the mdast
  // mirror would keep the newline the regex path collapses — measured, not assumed.
  return parts.join(separator).replace(/\s+/g, ' ').trim();
}

function blockText(node, separator) {
  if (node == null) return '';
  const type = String(node.type || '');

  if (type === 'code') return languageLabel(node.lang); // the label, never the body — one policy
  if (type === 'thematicBreak') return '';
  if (type === 'definition' || type === 'footnoteDefinition') return ''; // a link target is not text
  if (type === 'table') {
    const rows = (node.children || [])
      .map((row) =>
        (row.children || [])
          .map((cell) => flattenInline(cell.children, { separator }))
          .join(separator)
          .trim(),
      )
      .filter((row) => row.length > 0);
    return rows.join(separator);
  }
  if (type === 'list') {
    return (node.children || [])
      .map((item) => blockText(item, separator))
      .filter((item) => item.trim().length > 0)
      .join(separator);
  }
  if (type === 'listItem' || type === 'blockquote' || type === 'root') {
    return flattenBlocks(node.children, { separator });
  }
  if (Array.isArray(node.children)) return flattenInline(node.children, { separator });
  if (typeof node.value === 'string') return node.value;
  return '';
}
// ── END vendored markdown-text.js ──

/** The plugin id. The app keys storage by it (`hermes.plugin.<id>.*`) and the
 *  pane's own backend mounts at `/api/plugins/<id>/`, so it is also the folder
 *  name. Renamed from `messenger` in 1.2.0; `migrateLegacyStorage()` carries
 *  saved prefs across — see the constants below for what deliberately KEEPS
 *  the old spelling. */
const ID = 'personae'

/** The app's own roster cadence (`profile_roster_cache.py`: "polls every 5s"). */
const POLL_MS = 5000
/** Liveness windows, verbatim from the Bots rail (`row-helpers.ts`): a worker
 *  heartbeats every ≤60s, so 90s reads "active now" and 150s still counts a
 *  worker alive across one missed beat. */
const ACTIVE_WINDOW_S = 90
const WORKER_ACTIVE_WINDOW_S = 150
/** The "recently active" bucket, also the rail's (`RECENT_ACTIVITY_WINDOW_S`). */
const RECENT_WINDOW_S = 7 * 24 * 60 * 60
/** The `ui_meta` namespace this pane writes. Distinct from the Bots pane's. */
const META_KEY = 'personae'
/** …and the one it read before 1.2.0 renamed the id. Profile rows are user
 *  data, not code: a `hidden` flag an older build wrote is still honoured, so
 *  both namespaces are read (the new one wins) and neither is rewritten. */
const LEGACY_META_KEY = 'messenger'
// The Bots pane's own namespace, deliberately: same document, two panes.
const BOTS_META_KEY = 'hermes-bots'
const ROSTER_KEY = ['personae', 'roster']
const SEARCH_KEY = ['personae', 'search']
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
const PROJECTS_KEY = ['personae', 'projects']
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

/**
 * The personae mark, inlined. A desktop plugin ships as one bundled `plugin.js`
 * with no asset loader, so the 64px icon (assets/personae-icon.png) travels in
 * the bundle as a data URL rather than as a sibling file.
 */
const MARK_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAVeklEQVR4nNVaZ3RUR5a+VfXe6/e61UGt2MoRgQhCCIEIAowRGRONc1iHcTi2x7vjCbvjnZ21x8Zhxh4bj+1xmhkHsMEYWwQHMiIjCSWEjFDOsYM6vVS1PxoYr9cLEuDZs1+f8053n3fq3q9u3Vv33ipkskbC/2fg/2sFrhY/FgF0AefFYEwICf3PcQTjayaXu1YDXQQhhFIqKwowxvM8RwhD4Pf5dUUVTUZV1XQ5yEuSJIm6Tq9e3LWZCYQQvgCP2yPLSkJ8fGpKCsbE4xnyDvlyJuR8smlDXU1F+ckjTz/zu5SUVI/LQwjhOI7juJBxrlD01TsxIURRlKA/gDkCgJYtWfKLJx7PyRkvy8rg4OBHH39SUnJkR/EWjPGBkkNhprC8SRP9gcDPnvjXd9/+MwABoICJyWxGCDHGRir9qpZQSKRncDA2IXHi7FmDTtf4sePeees1ANi9e29u7sS4OEe4zfrX997s6up6/4MN84uut9vDO7u6k5MS582b09jYWDhrhlEylpaV7/zya13XOI4bKYcrJBBaM6qi6Dr7z6efmnf9dXIweLKs/L5772aMHThwKDIyUtO0jzZ+PHPmDJvV9sr6P/3ql08IgtDU1NzV2fHWO+/OnTN77+4vLw744YZPHnr4UUrpRb8friZXsIQIIbIsK4piksI2bvjbpNwJ+w+UGCWjKIkLFxQBgN8XECUR4/Oq7N23Lzs7u76+oaKiiuOIzWZVVVXX9aKi6+12uyDwqqJ2dnWvf+2NV19db7PbFUUZvjIjtgAh2ONyp6SljRk96qa1a5YuWbj+tdfvvedun98bZjYDQGtb26HDRwN+vywr4Xbb2OzRFovlow0fR0TYCwunBwKBqVOnYIQaGhv37T8QZjJPmjQxOSnx2LHjPEeYrjqdrjCzidHhLqSREcAYD3m8c+de/9If1p2urb3l5rVOpzNzVIYkGRjokkE6duLEkcNHcnNz7eH25OSkhsbGPXv3xzkciiLffvstHR3tExPH61Rvbe9OSU6hun702IkTJ8owAq/PWzRv7vXz5r7/wcZPPtlkDDMOk8MICGCMg4FAbu6knds/Ky0tS01JBQaCQZhWMBUhYjKa2zvbDx0+vGr58vLyytFZWSaTMW9Sbt6kXM+QZ+eXX8lB2WCQAsHAy6/8qbu7f/78onHZmbGx0WfrGx0OxwP33xeSsnB+EULo440bwywWXdevJQGEkCprP//Z4waDoFM6dmw2QshkNHX39JyrPzfodG39oviB++8tO1WxcMF8kymsqbmpqroma1RGRWVVeHh4R0cXAjhX36Cq6IZlNzQ2NWaPyTAajX5/gOM4t9sTlOWY6KjW1rab167+dMsWSoe1zQ2XAMZYUZSs7NHZ2VmMQX5+niSKLa1txcXbeYGPjY5OTU0pmDKFEG5U5iidsrfe+yAhLmbmjGkHDx6yWqyLFsx/+92/TC+Y3tLSahaYx+XOz5uSlpKyc8dXSYlJO3Z+s+9Aiabpy5Ytys7KGBoaysnJqaioEAwGuFxUHRaBULwP+gO33nbrUJAioJIo1tae2fr5F3ffdWd8fFzotY7OLkLIqMzMI8eOd7a1NDU0IKCrV61obW17/8OPOrt7o6LsB07UfNUkruo/3nDu7L79e8rKyglGQ17/Qw8+OOAcPHb8ZFKCw+12//75Z15+5bXizz83WayXNsWwCOi6LgiGNTeuuWXtyro2Z0CRdVUr3r790Uce7u7prayqzkhPB2C9fX1jxowWBD4Y8K9ZtUKn+K133h3sd0VHRVot9rtvL/xm+6btPfHOSfe5052r4qrcPrp29eqmxuaK6prPvvgsKTFx6aKi8HDr2XMNd911x4obln6+ZTPG+GoJYIz9Pv/jjz1WVDQnJTmJCKJkkIp3bZ82rUBRZJfLlRAfZzIZGxoa09JSkpMSZDmIMQqzWE6WVowbO/rjTzenZI7LTIrZ+vXBbV2x8oQ7jcj7SZ3w06J5s2IAABISY8aMG/XwIwcef/TBuLi45174fXRUjMDz7R0dANzVLiGMsd/rnTlz5g1LF5stJp7j0xLjd+/Zu2vX3qef+g8AVlV9+quvdmeNzrzpxtXp6Wm6ru/eu48Bdns8vd1tnW1tNcLMXc7JuNvNwucaJqYgxcM4LOv49QOut240yxoIHHZ7XJNyc9wu97rnX84ePebOO27btXvPG2++IxiN9OoJ6Ko8d+7s5JTEz7/YZrfbt23bmZmRPq2gQNepwSCkpqY5HMkfbvho/4GDD/3kJzxv0DWSkex44c0PNtebcdwMMn52uMEEgJgua0EfRTwAMgrsaDv1yrpImKzQxPi40aOzXln/xrSp03Nycrt7exLi4x975OFnn39RVZVLJxeXSSU4jnMP9D/5H795+rf/3tjY9MFHGxcvXJCfn7dr916e5+fMLhwYdPp8XllWmppa9+47KElGs9HwzYm6o4FxYu5a1WBl8hBCiGCMEcaAGSAGus50Vdf33y/lxmFvkPIEGwxiY1Pzhg2fFkydVn266vHHHkII8qbMqKisMpmMl3CDy1iAMQaI1NWdpZRu+nTLqpXLx48b29zcEh0dVX7qVExs9OhRGeHhVoxwZka6QRTPnWtKcdg/rxyC5OWMGCHoRcAQ4ZAgIUwQ1bGu6JrKIeZW4GwfzU3gARgDUDU1NiZKVoKSUZJl5e13379xzQpFUS4mVFdIgFIqGKWTpWX/dO8Da1avGD9ubP25c5WV1XPmzOru7qqtrY2Jjtqx85vS0nKLxWI0GifnTx2flWSLbAjyFhE0EHhGDCjopL3NTJOpaAFTDIjhBDHqd7W5GQACQBzhOI7jOT41Jamnt+eWm9cODA4+/ewL39bXi6J4VVEIIURVNSY6Oj09bc7sWd09PYmJiZkZGQCQP3nyrt17DKJYW1s3c8YMoyT19Q8MDPR3tSvHe8zGMQaVBmjQhVtKwN3GMM80P3Y2UyVAjRGQPodGzmaAAJgoGoDqR48d6+rsdjqdgMmJ0hPr1r1Yc7pGEPjLlgeXX0II4eeefcrr9ba2tQcDwdiYmEOHj6SnpTkcsUsXL6k/26iqqiAYjp0oDbeFT06OvXV9tT/pdkEPUj3I91VD9FgYfxNClOhB4mrGPQ3U16uc3mofLxVmFAGwgf6+5154ye3yLVww12SSamqq1qxeSanGqI6x4bIJxaUIIIQURYmNiyucOb14246urm5HrKO65luvV33tjXeVoD8mJqant3dK/pTevv4ZMwoXzpt+95Nv10bdFm82BhQZAceS52Emk4YduLcaAm4t6EHmJD5zMR83xWoPTzZTAP6d997HmC+YMikzM23cuKXPPPvC9IKChISEysrK4RQ3lynqOY5zu90dHZ1T8ifX1dUN+Ybq688dLDnY1tYiCNzp2tOiwTA0NCTLgYTEGEqVpqDNYjPrVMaEYN7Ae9sNp94xNO+V7GmmnNvCkvK5wVoadGNRaAraNlUEAKChqbmvv8/tcb3w4kvPP/+H+Lj4n//yNwcOlhhNpqvNRhljGCNFVvbsO3DP3XdYbVa32z1v3uzKqsrrryukFOXl5Q0ODqpa8Oa1K81WG+YgWgwEZb9oRAwYYqDzFpp4nYWoYngswxj4Sbyvq8+SgMOiuYC6uYr+dDZMnZwbGRm9euWy3617vquzy+cP/v6F50xW6zBry0tZAGPs8/nz8iYlJSY0t7RG2O0FU/N1XTeZjAzA7fGXV9QCQg6Ho7Kq2uV2d7U2VnVpROAVVaWU6YA0TtQixgxYsjsVqVeV+kh0f/pNTIrSVFXkUXUvah+CafkTGpsav/5m19T8ybpOX/7jqxa7ffiV8aUIIACm6VGRETabtbm5efGihVaLddPmz9ra2hDili1duHz5kn0HDg0ODHb39nndzs1fHT8rFBgQozowRgEYMMZ0GTGNYUEDTmc8NViBUUCYJ5xHI3vr1ayM1Kjo6AXzi+bOnaNqquz3jKi/cikClDFBEiurqlNTkqura06eLC0tq9ApREfHTMyZEBlpLy4utllsPr8vLtYhSqaAZ9CudgBwBGMECBgDBgyAAqKMUUpVJOhYoAAIA0+QwJMjzUFDWKQiywODgwST6dMKAI2s13aptxljoig2NTb+8dU3Hnzg/ubW1uPHj07JyzWbLW6Pi1ItEJBzcyfNmD7N4xooLz81Z2JSltCiAiEYIwTAgDLKGAs9GAXKmE4ppTRIcbdXU4K0tFMHAEdMdEtLKwBkpKdh/vKh87u4zD6g63qYxfzMuuc6Ort++fPHM1euwBg7XZ5vdu1NS0sflZnqGfJs3Vo8aWbR3zZ+ctw3Ss1YKWGVMQyhDIFd/ISmBAEwFUgEDPzLfGt/EA8FdQDIyEyvrKialDuREA5jPKLe1uXrAcaY2Rz2l3fe6O3rW71i2YrlS6Oionp6+o8cPrJyxXKMUcn+3UPmUVuMj0ZnJlOqIaowhBhlAAwAhbQP+SQC4DjB6Rq8MaPun+csDI1PGR2TlbV3734A6O/v1xQFG6XhBNDhEghxEE3Wjvb2js4uRdVq685kpGccO3Fy+Q2LCSesWHXjgWbKW3iqeBlCFCFGKYT0BwCEEAAKqY8Ywlhkcltj07HS6h07tpvCzGtXrayuqQ7Nes3pWqDaiJpzw/IYSqlBEivKjprNYQaDePp07azCaWPHjn/9zbc5ggGgsb4OmKLqVNN0XdMYZaFKCiGEEcIXKABCVFMke9wRZ/Rbm/fazDamqn99/4MzZ87cestNAFBdcxrQtV5C58EYAG+zWQlBuq5quj5h3NiX/vjKE7/4t0hb2IffVPAFrwFwjOnAEMIMEMIIMYBQNAYABogxRgGQrvhTFm1UtBTV/2R6RVZa7OS8iQCgadq3Z88SQRgRgeHGLEoZL4rrX3tDU9X77rnLajFLkpQzYUJW5phRWROWFeaqzmZOEBECwOjC+QwghEJTH3oySimlKmUehcaFc0WprKu3y2Ixa5rGGOvo6GxtbRd+NAJUlKRTFZXXFS0tKyvneR4TXlXVlOSk9IxRKbE2wdsBRMAI8AWt2d8DETAWSmwRIcQmoilS86+Tjt6beHZG3oTW9l6vP4gQqq2rczmdI+2wj6Q3yhghxO/zV1RUpadnAENhJmnGzCk9fc6ocItNbhqiwMH5KWdwPmjCd6kQQTr1eqpF0bDYaw4/5mZBf9Dn9x8+cvDXv/rZ6dpapskYW67lPnARCCFFVaOjo3du25KRkXaytGzfvv0xMQ6jUTKHBcMjY5JYWYV3gIg8UMoQRgCA2IV4EtrWAOmKkrmyVjANUvNTS41FqQAAlOklhw5zhCstPQWI/FgHHBhjORjMmTA+IyPNH/Db7eGJiYmqqjHGCEZGS3hekqG89QjKLtLkAAZ63g2AXSADiDKGgJkdCGgEZj0Np7+qbVUYHxsTNbtwltfnKy07xV+ugPwBxYb5HqVUMBi+PVvf19/f3t6xbfuXR4+VJSUnIoQkyaAxdl1BbsxACXK2c0gHzCGEgFHGzicT7OLEUpUBQ0yPtZvGTRiXnp4cFxdDKT1y9HhzU6MoiiO1wHAJYIyVoDxu7NioyMitn29PSEg2W0yTcnM0TTUYDAaBs0fH31cYo5zdJXq6DIqTIcIQxxgwqjNKQxtzCBxmzgCUD8UmJCZmj8l0OKIwxsXF2/Vh9CCunMB3QQjRVDUyItxitqiahhBKiHcMef3zZs14NF/T+8+xgXaj+xxR3AxhIBwKnWszBhCyCcWInekOMqbJqgYMgsHgwZJDxCDSYR/MjJgApVQyGQ+WlDS3tN55+80DA70Oh4MxhjHWdRodHRVhtw64/TdcN/l3i4wJVub1eEVXs9HVwAcGMNOA4xjhAZGQQ6gaFCTzCJHQCF1d3a1tbQbDyHaAkRFgjHEcN+Tx3HTLXaqmJycnOhwxIUcNBfjxE8YIAu73BLITzevm0eVjsMqwplFjsF9yNXCeNkn3cARU4L0qWpSu3pgNiqphYAih3Xv2uwdHvAOEMLJTSoyx3++3WWzXz5v7l3ffFASeURYKlRzHu9yuiooaz5Bf4nmLxJ1sld/c39mmRJgiEwwGYW2aK89BO/2CSPQxdo3nMOENUVGRXT2999z3QHNL40j34BBGdshHKbVYLAN9nbNnzTRKUlAOEkJCMlVVtVlt06dNaWpu7e0ddPr8E+P5l5bbvz5WvedMiY+PMUQ7IogtMcaIMfHK1B+QA4GBL7/e9fGmT69Ye7gCCwT8/vETcg4f2CUIwt8LFcYQIAaMEIIRppT29w9UVJzGCFvNknuw98y39fUtHT5/AGOCADiOdHZ1Hzl6bGCwjyPkirUfMQGEkdfj3V68dcniBYqqEMJdTBYuJP8A7Pw5vtvtqThV5fX6jaYwSTRgBIFAwO/3q5oaFRmx/vW3P968yWIx6Tq9Yu1hREuIEOJxuR555JElixeEDtMppRhjBMAQXKxaEEIMQNd1q9VSMC2/qrK2t7dfVRWMEMHYFBbGERwIBvsGeo1GUdOGW3n9bxhuFAq1GZNT0u+841an0yUIgiAIPMcBgKZrjLELO9CF2gsjXdcFQZicPzEjM03TdJ0ywFjVNIRJa1u7fSTNn0tguBYIBewhr2fhkuVmc1haWtr0gqlLFi0oKMgnvMCAKYrKEYLQBbcAhDBQRhGgrKz0iAhb7ZmzQ0M+gecZg/aOzoT4hGAwKEnSSJOf72FkPhASpuu6oiigaYIxLH9y3l133nbz2tVms5kyqmk6If/DqgwIIZqmtbS29/T0t7a2t7Q0apr+5JNPWsLDh1+//yBG2EXCmBAiCILZbLZG2AWBO3L06E/ue7BgxnV/fvs9VVEFnqeU6rrOKAulQCEH1XQNYZSeljJu7Oi6b+tyc3KGhrxXo/cVEoALGRmlVNN0xlhYmMlit52tP/vgAw/PmrOgeNsOnuMFXtDOB5fzTaEL2RDz+XwpSYkpyck9vb0jbcJdGwLfQ2i+JUmyhNtKy0tXrrl5zU23V9ecFg0GgRc0Taf0/AoJVcoulzs9NTUoy7qu4yvKHa4xgRBCNEwmk8lk3PLpp4Wzi37xqyc7OjslURQEA2NUVVTKqD8Q6O8b0Cn1+/23rF0THx+vKJc5Rf0HEQiBUkoptdhsqqa8+PyLBTPm/vapdU1NzTzHGwwGjnA9Pb2Y48PtdrPZ7PUFGIOrD6TX4NbiDwyKECE4GJRlnz/K4ZhVWHjdnMLExMTBwSFN1zo6OsrLy0sOHQoEfFeWgf43WT/e3enzFwNVJeDzA2VYMJjCwnRNCwT8jDGjUcR4xCX8D0j5sS9/h2gAAGNM1/Xv/rx67eHHuHr8PYT0Dn1HCIfac9dw/H/w7fVrMOXfw38BFiUGov5uzbgAAAAASUVORK5CYII='
/** D-D: how many of a profile's sessions a click docks beside it. The tab strip
 *  scrolls horizontally past this; the cap only stops one click minting a
 *  hundred tiles. */
const DOCK_LIMIT = 10
/** Shorter needles stay local — below this a session sweep is all cost. */
const SEARCH_MIN_CHARS = 2
/** The pane's search is a two-stage thing: the box updates on every keystroke
 *  (an input that lags reads as broken) while the SWEEP — up to twenty-two
 *  stores, live and archived — only fires once typing pauses. Measured on the
 *  live roster: one sweep is ~0.1s of reads per profile, so a debounce is what
 *  keeps a nine-character keyword from costing nine sweeps. */
const SEARCH_DEBOUNCE_MS = 220
/** Body hits asked of the pane's own backend PER PROFILE. The endpoint's ceiling
 *  is 100; asking for 40 was the whole reason a session could be missing —
 *  BM25 ranks a chatty session's tool rows above the one chat the user meant,
 *  and 40 hits is three sessions' worth of noise. The pane groups these by
 *  session, so the number that matters is how many SESSIONS are reachable. */
const SEARCH_BODY_LIMIT = 100
/** Archived sessions swept for a TITLE match. They are invisible to
 *  `session.list`, so before this the only archived sessions a search could
 *  ever reach were ones the FTS body read happened to hit. */
const SEARCH_ARCHIVE_LIMIT = 60

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

/** What the search BOX shows, keystroke by keystroke. Split from the needle the
 *  sweep uses (below) so the input never lags: writing the box and scheduling
 *  the work are two different jobs, and this pane renders them separately.
 *  Transient like `$listView` — a reload starts with an empty box. */
const $searchInput = atom('')
/** The SETTLED needle: what `searchInSessions` is actually run against, written
 *  only by `scheduleSearch` once typing pauses. An explicit query is the user's
 *  strongest statement about what they want to see, which is why it outranks
 *  the roster's filters and a profile's expanded list (see `visibleRows`). */
const $searchQuery = atom('')
/** How the search went, for the one case that must never be silent: if the
 *  pane's backend is missing or refuses, the sweep is TITLES ONLY and the pane
 *  has to say so. Before this, a dead backend and "no match" drew the same
 *  screen — which is exactly how "search is not working" stays undiagnosable. */
const $searchHealth = atom({ failed: [], unavailable: false })
let searchTimer = null

/** Debounce the sweep, not the box. Below the minimum needle the query is
 *  cleared at once (no timer left armed to fire a stale search later). Pure
 *  except for the two atoms and the one timer — the harness pins both halves. */
function scheduleSearch(value) {
  const next = String(value ?? '')

  $searchInput.set(next)

  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }

  if (next.trim().length < SEARCH_MIN_CHARS) {
    $searchQuery.set('')

    return ''
  }

  searchTimer = setTimeout(() => {
    searchTimer = null
    $searchQuery.set(next)
  }, SEARCH_DEBOUNCE_MS)

  return next
}
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
    applyPref(SECTIONS_KEY, store?.get?.(SECTIONS_KEY, EMPTY_SECTIONS))
    applyPref(COLORS_KEY, store?.get?.(COLORS_KEY, {}))
    applyPref(SESSION_ORDER_KEY, store?.get?.(SESSION_ORDER_KEY, {}))
    applyPref(SESSION_SORT_KEY, store?.get?.(SESSION_SORT_KEY, {}))
    applyPref(SESSION_GROUPS_KEY, store?.get?.(SESSION_GROUPS_KEY, {}))
    applyPref(HIDDEN_KEY, store?.get?.(HIDDEN_KEY, {}))
    applyPref(APROPOS_KEY, store?.get?.(APROPOS_KEY, {}))
    expandedProfiles = normalizeExpanded(store?.get?.(EXPANDED_KEY, {}))
    $expanded.set(expandedProfiles)
  } catch {
    // No storage: prefs hold for this window only, which beats throwing.
  }
}

/** One SHARED pref's stored value → the in-memory copy and its atom, through
 *  the same normalize* the pane always used. loadPrefs and the server sync's
 *  adopt path both come through here, so a value from another machine can
 *  never take a shape a value from this machine's storage could not. Device-
 *  local prefs (toasts, expanded) are deliberately absent: nothing remote may
 *  set them. Returns false for a key it does not own. */
function applyPref(key, raw) {
  if (key === SECTIONS_KEY) {
    $sections.set(normalizeSections(raw ?? EMPTY_SECTIONS))
  } else if (key === COLORS_KEY) {
    sessionColors = normalizeColors(raw ?? {})
    $sessionColors.set(sessionColors)
  } else if (key === SESSION_ORDER_KEY) {
    sessionOrder = normalizeSessionOrder(raw ?? {})
    $sessionOrder.set(sessionOrder)
  } else if (key === SESSION_SORT_KEY) {
    sessionSort = normalizeSessionSort(raw ?? {})
    $sessionSort.set(sessionSort)
  } else if (key === SESSION_GROUPS_KEY) {
    sessionGroups = normalizeSessionGroups(raw ?? {})
    $sessionGroups.set(sessionGroups)
  } else if (key === HIDDEN_KEY) {
    hiddenSessions = normalizeHidden(raw ?? {})
    $hiddenSessions.set(hiddenSessions)
  } else if (key === APROPOS_KEY) {
    aproposLinks = normalizeApropos(raw ?? {})
    $apropos.set(aproposLinks)
  } else {
    return false
  }

  return true
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
/** Make a group and hand the user back to the screen that draws it.
 *
 *  Groups are drawn on the roster, and so is the rename field that opens on a
 *  new one — so creating a group from a drill-down has to CLOSE the drill-down,
 *  or the group is made somewhere the user cannot see. Pedro, 2026-10-17: "if I
 *  try to create a new session group by right-clicking a session that is in the
 *  'view all' it doesn't work." (It did not, for a duller reason: the row menu
 *  was never given the verb — see SessionListView.) */
/** The roster's page is fetched per profile and keyed by the OPEN set, so a
 *  membership write has to invalidate it: otherwise "assigned to a group but it
 *  does not show up" is exactly right until the next poll (Pedro, 2026-10-17). */
function refreshGroupedSessionLists() {
  void queryClient?.invalidateQueries?.({ queryKey: ['personae', 'sessions'] })
}

function createGroupHere(profile, sessionIds, options) {
  const made = createGroupNow(profile, sessionIds, options)

  if (made) {
    // Land where the group is DRAWN: a group box only renders inside an
    // expanded profile row, so coming back from a drill-down with the row shut
    // would make a successful group look like a no-op.
    $expanded.set({ ...$expanded.get(), [String(profile)]: true })
    $listView.set(null)
    refreshGroupedSessionLists()
  }

  return made
}

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
  // Filing changes what the roster must draw, and the row may only exist in the
  // archive (see listProfileSessions) — refresh now instead of at the next poll.
  refreshGroupedSessionLists()
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

/** Local storage stays the source the pane reads, written FIRST and
 *  synchronously as ever; the server sync only ever learns about the change
 *  afterwards, so a dead or missing backend can never cost the user an edit. */
function persist(key, value) {
  try {
    Promise.resolve(ctxRef?.storage?.set?.(key, value)).catch(() => undefined)
  } catch {
    /* storage unavailable — the value lives for this window */
  }

  try {
    prefSync?.noteLocal(key, value)
  } catch {
    /* sync is best-effort; the local write above already happened */
  }
}

// ── cross-device sync ───────────────────────────────────────────────────────
//
// The roster prefs a user arranges by hand (sort, order, sections, groups,
// colours, hidden, apropos) follow them across machines through the pane's own
// backend: `GET/PUT /api/plugins/personae/state`. The contract is in the
// README ("Sync contract"); the short of it is LWW by a per-key Lamport rev,
// object values merged entry-wise server-side, removals as tombstones, and
// seed-then-authoritative on first contact. Everything here is best-effort: a
// failure queues and retries, a 404 (older backend) silently means local-only.

/** Server key names (no `messenger-` prefix — the LOCAL key names below keep
 *  that prefix on purpose: they are the wire contract with the pane's backend
 *  and with Personae Mobile, and renaming them would need a migration on both
 *  ends for no user-visible gain). The ONLY keys ever pushed or
 *  read back; expanded, toasts, search, scroll and widths are device-local by
 *  omission. Kept as literals, not the *_KEY constants: several of those are
 *  declared further down the module and would still be in their TDZ here. */
const SYNC_SERVER_KEYS = [
  'session-sort-v1',
  'session-order-v1',
  'sections-v1',
  'session-groups-v1',
  'session-colors-v1',
  'hidden-v1',
  'apropos-v1'
]
const SYNC_LOCAL_PREFIX = 'messenger-'
/** Device-local bookkeeping ({revs, seeded, serverRevs, names, queue}). Never
 *  pushed — it is not in SYNC_SERVER_KEYS, and nothing routes it there. */
const SYNC_META_KEY = 'messenger-sync-meta-v1'
/** Idle time before a burst of edits goes out as ONE push. */
const SYNC_DEBOUNCE_MS = 1500
const SYNC_BACKOFF_MS = 2000
const SYNC_BACKOFF_CAP_MS = 60000

/** Local storage key → server key, or null for anything device-local. */
function syncServerKey(localKey) {
  const name = String(localKey || '').startsWith(SYNC_LOCAL_PREFIX)
    ? String(localKey).slice(SYNC_LOCAL_PREFIX.length)
    : ''

  return SYNC_SERVER_KEYS.includes(name) ? name : null
}

function syncLocalKey(serverKey) {
  return `${SYNC_LOCAL_PREFIX}${serverKey}`
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** "Nothing worth seeding": a fresh install's `{}` / EMPTY_SECTIONS must not
 *  be pushed as if it were a deliberate arrangement. */
function isEmptyPref(value) {
  if (value === null || value === undefined || value === '') {
    return true
  }

  if (Array.isArray(value)) {
    return value.length === 0
  }

  if (isPlainObject(value)) {
    return Object.values(value).every(isEmptyPref)
  }

  return false
}

/** HTTP status out of a rejected `ctx.rest`. The desktop bridge rejects with a
 *  plain Error whose message is `"<status>: <body>"` (electron/api-expected-
 *  404.ts); a status field is honoured too, for any other transport. 0 means
 *  "no status" — offline, timeout, bridge missing. */
function syncStatus(error) {
  const direct = Number(error?.status ?? error?.statusCode ?? error?.response?.status)

  if (Number.isInteger(direct) && direct >= 100) {
    return direct
  }

  const match = /^\s*(\d{3})\b/.exec(String(error?.message ?? error ?? ''))

  return match ? Number(match[1]) : 0
}

function normalizeSyncMeta(raw) {
  const map = value => (isPlainObject(value) ? { ...value } : {})

  return {
    names: map(raw?.names),
    queue: Array.isArray(raw?.queue) ? raw.queue.filter(name => SYNC_SERVER_KEYS.includes(name)) : [],
    revs: map(raw?.revs),
    seeded: map(raw?.seeded),
    serverRevs: map(raw?.serverRevs)
  }
}

/** The sync writer, every effect injected so the harness can drive it with a
 *  fake backend and fake clock. `apply(localKey, value)` puts an ADOPTED value
 *  into the pane (applyPref in production); `storage` is the same seam the
 *  pane persists through. Nothing it does throws out: every public method is
 *  safe to call from an event handler, and every rest failure is swallowed
 *  into the retry queue.
 *
 *  Revs are Lamport: a push uses max(last rev seen from the server, last rev
 *  this device wrote) + 1, recomputed per attempt, so they only ever rise and
 *  always clear whatever another machine wrote last. */
function createSync({
  apply = () => undefined,
  clearTimeout: cancel = globalThis.clearTimeout,
  debounceMs = SYNC_DEBOUNCE_MS,
  rest,
  setTimeout: later = globalThis.setTimeout,
  storage
} = {}) {
  let meta = normalizeSyncMeta(null)
  let metaLoad = null
  let metaLoaded = false
  let bootstrapped = false
  let unsupported = typeof rest !== 'function'
  let disposed = false
  let inflight = null
  let again = false
  let pullWanted = false
  let timer = null
  let failures = 0
  /** Server key → newest local value (what a push would send). */
  const values = new Map()
  /** Server keys with local edits the server has not acknowledged. */
  const dirty = new Set()

  const read = async (key, fallback) => {
    try {
      const value = await storage?.get?.(key, fallback)

      return value === undefined ? fallback : value
    } catch {
      return fallback
    }
  }

  const write = (key, value) => {
    try {
      Promise.resolve(storage?.set?.(key, value)).catch(() => undefined)
    } catch {
      /* storage gone — the in-memory copy still holds */
    }
  }

  /** Never before the stored meta is in: an early save would clobber the revs
   *  a previous run persisted, and a reused rev is a lost write. */
  const saveMeta = () => {
    if (metaLoaded) {
      write(SYNC_META_KEY, { ...meta, queue: [...dirty] })
    }
  }

  const loadMeta = () => {
    metaLoad ||= (async () => {
      const stored = normalizeSyncMeta(await read(SYNC_META_KEY, null))

      meta = stored

      for (const name of stored.queue) {
        dirty.add(name)
      }

      metaLoaded = true
    })()

    return metaLoad
  }

  const stopTimer = () => {
    if (timer !== null) {
      try {
        cancel?.(timer)
      } catch {
        /* a fake clock without clearTimeout */
      }

      timer = null
    }
  }

  const schedule = ms => {
    if (disposed || unsupported) {
      return
    }

    stopTimer()
    timer = later(() => {
      timer = null
      void flush()
    }, ms)
    // A Node host (the harness) must not be kept alive by a pending push.
    timer?.unref?.()
  }

  const backoff = () => Math.min(SYNC_BACKOFF_MS * 2 ** Math.max(0, failures - 1), SYNC_BACKOFF_CAP_MS)

  const goUnsupported = () => {
    unsupported = true
    stopTimer()
  }

  const namesOf = value => (isPlainObject(value) ? Object.keys(value) : [])

  const adopt = (name, value) => {
    values.set(name, value)
    meta.names[name] = namesOf(value)
    write(syncLocalKey(name), value)

    try {
      apply(syncLocalKey(name), value)
    } catch {
      /* a bad remote value must not break the pane; local storage has it */
    }
  }

  /** Fold a server view into local state. `sent` maps the keys this device
   *  just pushed to the JSON it sent: for those the merged view is adopted
   *  whenever it differs (another device's entries survived the merge), even
   *  though its rev is our own. Any key with unpushed local edits is left
   *  alone — only its seen rev advances, so the next push still outranks. */
  const ingest = async (keys, sent = null) => {
    for (const name of SYNC_SERVER_KEYS) {
      const entry = keys[name]
      const has = isPlainObject(entry) && entry.value !== undefined && entry.value !== null
      const rev = Number(entry?.rev) || 0
      const known = Number(meta.serverRevs[name]) || 0

      if (has) {
        meta.serverRevs[name] = Math.max(known, rev)
      }

      if (!meta.seeded[name]) {
        // Seed-then-authoritative: a value the server already has wins over
        // whatever this device carried in; an empty server takes ours.
        if (has) {
          dirty.delete(name)
          adopt(name, entry.value)
        } else {
          const local = values.has(name) ? values.get(name) : await read(syncLocalKey(name), undefined)

          if (!isEmptyPref(local)) {
            values.set(name, local)
            dirty.add(name)
          }
        }

        meta.seeded[name] = true
        continue
      }

      if (!has || dirty.has(name)) {
        continue
      }

      if (sent?.has(name)) {
        if (JSON.stringify(entry.value) !== sent.get(name)) {
          adopt(name, entry.value)
        }
      } else if (rev > known) {
        adopt(name, entry.value)
      }
    }
  }

  /** GET /state. False when the answer is not this contract's (an older
   *  backend that routes /state to something else) — that is "unsupported". */
  const pull = async () => {
    const view = await rest('/state')

    if (!isPlainObject(view?.keys)) {
      goUnsupported()

      return false
    }

    await ingest(view.keys)

    return true
  }

  const push = async () => {
    const batch = []
    const body = { keys: {}, tombstones: [] }
    const sent = new Map()

    for (const name of [...dirty]) {
      const value = values.has(name) ? values.get(name) : await read(syncLocalKey(name), undefined)

      dirty.delete(name)

      if (value === undefined) {
        continue
      }

      const rev = Math.max(Number(meta.serverRevs[name]) || 0, Number(meta.revs[name]) || 0) + 1

      meta.revs[name] = rev
      body.keys[name] = { rev, value }
      sent.set(name, JSON.stringify(value))
      batch.push(name)

      // Absent entries are KEPT by the server's entry-wise merge, so a removal
      // has to be said out loud — against the last view both sides agreed on.
      if (isPlainObject(value)) {
        for (const entry of meta.names[name] || []) {
          if (!Object.prototype.hasOwnProperty.call(value, entry)) {
            body.tombstones.push({ entry, key: name, rev })
          }
        }
      }
    }

    if (!batch.length) {
      saveMeta()

      return
    }

    // Revs hit storage BEFORE the request: a crash mid-flight never reuses one.
    saveMeta()

    let view

    try {
      view = await rest('/state', { body, method: 'PUT' })
    } catch (error) {
      const status = syncStatus(error)

      if (status === 404) {
        goUnsupported()

        return
      }

      if (status === 400 || status === 413) {
        // The same body would fail the same way forever; drop it, keep local.
        saveMeta()

        return
      }

      for (const name of batch) {
        dirty.add(name)
      }

      saveMeta()
      throw error
    }

    for (const name of batch) {
      meta.names[name] = namesOf(body.keys[name].value)
    }

    if (isPlainObject(view?.keys)) {
      await ingest(view.keys, sent)
    }

    saveMeta()
  }

  const run = async () => {
    try {
      await loadMeta()

      if (!bootstrapped || pullWanted) {
        pullWanted = false

        if (!(await pull())) {
          return
        }

        bootstrapped = true
        saveMeta()
      }

      if (dirty.size) {
        await push()
      }

      failures = 0
    } catch (error) {
      if (syncStatus(error) === 404) {
        goUnsupported()

        return
      }

      failures += 1
      schedule(backoff())
    }
  }

  /** One request chain at a time; an edit that lands mid-flight re-arms the
   *  debounce once the chain settles instead of racing it. */
  function flush() {
    if (disposed || unsupported) {
      return Promise.resolve()
    }

    if (inflight) {
      again = true

      return inflight
    }

    stopTimer()
    inflight = run().finally(() => {
      inflight = null

      if (again) {
        again = false

        if (dirty.size && timer === null) {
          schedule(debounceMs)
        }
      }
    })

    return inflight
  }

  return {
    /** A local persist(). True when the key is shared and a push is armed. */
    noteLocal(localKey, value) {
      const name = syncServerKey(localKey)

      if (!name || disposed || unsupported) {
        return false
      }

      values.set(name, value)
      dirty.add(name)
      saveMeta()

      if (inflight) {
        again = true
      } else {
        // During a backoff an edit must not shortcut the wait.
        schedule(Math.max(debounceMs, failures ? backoff() : 0))
      }

      return true
    },
    /** Network back: retry now, forgetting the backoff. */
    online() {
      if (disposed || unsupported) {
        return
      }

      failures = 0

      if (dirty.size || !bootstrapped) {
        void flush()
      }
    },
    /** Window shown again: pick up what other machines wrote meanwhile. */
    visible() {
      if (disposed || unsupported) {
        return
      }

      pullWanted = true
      void flush()
    },
    start: () => flush(),
    flush,
    dispose() {
      disposed = true
      stopTimer()
    },
    state: () => ({
      bootstrapped,
      dirty: [...dirty],
      failures,
      meta: JSON.parse(JSON.stringify(meta)),
      pending: timer !== null,
      unsupported
    })
  }
}

/** The live writer for this window; replaced on every register(). */
let prefSync = null
let syncListening = false

/** Wire the writer to the host. Called after loadPrefs, and never awaited:
 *  first contact with the server must not hold up the pane's first paint. */
function startSync(ctx) {
  try {
    prefSync?.dispose()
  } catch {
    /* already gone */
  }

  prefSync = null

  if (typeof ctx?.rest !== 'function') {
    return
  }

  try {
    prefSync = createSync({
      apply: applyPref,
      rest: (path, opts) => ctx.rest(path, opts),
      storage: ctx.storage
    })
    void prefSync.start()
  } catch {
    prefSync = null
  }

  if (syncListening) {
    return
  }

  syncListening = true

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => prefSync?.online())
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          prefSync?.visible()
        }
      })
    }
  } catch {
    /* no DOM events — pushes still go out on the debounce */
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
  const legacy = profile?.ui_meta?.[LEGACY_META_KEY]

  if (raw && typeof raw === 'object') return raw

  return legacy && typeof legacy === 'object' ? legacy : {}
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
    // Markdown markers are OUT of the roster's second line (0.12.0): the row shows a message the way
    // a reader reads it, not the way its author typed it. `stripMarkdown` is the vendored shared
    // module inlined above — one policy, the phone's copy of the same file.
    preview: last ? stripMarkdown(String(last.preview || last.title || ''), 0) : '',
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
          message: stripMarkdown(row.preview, 140) || 'Open the session to see it.',
          title: `${row.label} has new activity`
        })
      }
    }
  }

  watermarks = fresh
  watermarksSeeded = true
}

// ── P8b: the profile row's dot is an AGGREGATE of its sessions ───────────────

/** The class core paints each session state with, copied from
 *  `app/chat/session-status-dot.tsx` (`DOT_VARIANTS`). Core's own
 *  `sessionDotClassName` is NOT exported to plugins, so the pane carries its own
 *  copy — and every class here is one core itself uses, so it is already in the
 *  compiled stylesheet (tests/classes.mjs proves it, the way it proves the
 *  pane's other classes: a plugin loads at runtime and cannot invent a
 *  utility). */
const ROLLUP_DOT = {
  'needs-input': 'size-1.5 rounded-full bg-amber-500',
  idle: 'size-1 rounded-full bg-(--ui-text-quaternary)',
  unread: 'size-1.5 rounded-full bg-(--ui-success)'
  // No `working` here, on purpose: the PROFILE aggregate never paints blue. A
  // session that is merely running is not news about the profile, and a row lit
  // blue for its own agent could never read as quiet. The per-SESSION dot still
  // carries it — `dotStateFor` below is untouched (Pedro, 2026-10-11: "drop blue
  // (from profile, keep in session statusdot)").
}
/** Ink for the COUNT badge, by state. An inline `var()` rather than a class: the
 *  badge is micro-type on the pane's own chip, and a variable that did not
 *  resolve degrades to the inherited colour — never to an invisible numeral. */
const ROLLUP_INK = {
  'needs-input': 'var(--color-amber-500)',
  unread: 'var(--ui-success)'
  // No `working` (see ROLLUP_DOT): the badge never counts a running session.
}
/** i18n keys for the dot's label, by state. */
const DOT_TITLE_KEY = {
  'needs-input': 'dotNeedsInput',
  idle: 'dotIdle',
  unread: 'dotUnread'
}
/** Live statuses that mean a TURN IS RUNNING (`_session_live_status`).
 *  `waiting` is deliberately absent: it is the pending server→client request —
 *  a clarify/approval blocking the turn — which is core's amber, not accent. */
const LIVE_WORKING = new Set(['resuming', 'starting', 'streaming', 'working'])
/** How many of a profile's sessions the dot read looks at. 500 is the endpoint's
 *  own ceiling (`Query(le=500)` and the SDK's `Math.min(500, …)`), which is also
 *  the honest bound on this bucket: a row past the page cannot be counted, so a
 *  profile with more than 500 sessions can hide an old unread one. The roster is
 *  ordered by `created`, so what is inside the page is the newest 500. */
const ROLLUP_LIST_LIMIT = 500
/** Per-profile row cache for the dot read: `{profile: {at, rows, stamp}}`.
 *  The roster poll runs every 5s and a profile's rows change only when it moves
 *  — re-reading twenty-odd `state.db` files on every tick would be a fan-out
 *  with nothing to show for it. A profile whose roster STAMP moved re-reads at
 *  once; everything else re-reads at most once per TTL, because `unread` can
 *  also change with NO activity to see (opening a session clears it, and without
 *  the TTL the emerald would sit there until that profile's next turn). Exported
 *  for the harness, which drives several polls in a row. */
const DOT_LIST_TTL_MS = 30000
const dotListCache = new Map()

/** `{profile: {state, count, counts}}` — the roster's aggregate dots, written by
 *  fetchRoster's poll and read by every ProfileRow. Empty until the first poll
 *  lands, which is what makes the fallback dot the initial state. */
const $profileDots = atom({})

/** The dot ONE session shows, from the two sources a plugin can read. The
 *  priority is core's own (`$sessionDotStateById`): a session blocked on a
 *  question outranks one that is merely producing, which outranks one that
 *  finished unread. Pure. */
function dotStateFor(liveStatus, unread) {
  if (liveStatus === 'waiting') {
    return 'needs-input'
  }

  if (LIVE_WORKING.has(String(liveStatus || ''))) {
    return 'working'
  }

  return unread ? 'unread' : 'idle'
}

/** Live rows → `{storedSessionId: status}`. `session.active_list` keys a session
 *  twice — `session_id` is the RUNTIME id, `session_key` the STORED id every row
 *  and dot is keyed by — so only the second is usable here. A row missing either
 *  half is dropped rather than guessed at. Pure. */
function liveStatusMap(rows) {
  const map = {}

  for (const row of rows || []) {
    const key = String(row?.session_key || '')
    const status = String(row?.status || '')

    if (key && status) {
      map[key] = status
    }
  }

  return map
}

/** The whole roster's dots: `{profile: {state, count, counts}}`.
 *  `lists` = profile → its own session rows; `live` = stored id → live status.
 *
 *  Two rules, both the user's (2026-10-11):
 *
 *  1. The profile's dot is the LOUDEST state among its sessions, not the state
 *     of its latest one, so it stays lit while ANY session still holds it and
 *     answering the newest one can no longer silence the row. Loud, here, means
 *     `needs-input` (amber) then `unread` (emerald): a session that is merely
 *     RUNNING paints nothing on the profile. Blue belongs to the per-session
 *     dot, and a row that lights blue for its own running agent could never
 *     read as quiet.
 *  2. `count` — the badge — is how many sessions are AWAITING him: `needs-input`
 *     + `unread`. `working` is excluded on purpose, and that is the reported
 *     bug: answering a blocked session RESUMES its turn, so it goes `waiting` →
 *     `working`, and a count that included `working` could not drop at the very
 *     moment he had just answered it (his "after one got solved, the number '2'
 *     didn't disappear"). `counts` keeps the full per-state split, so the
 *     tooltip can still say a session is running behind the row.
 *
 *  A stored id that appears in MORE THAN ONE profile's list is dropped
 *  everywhere: ids are timestamp+random, so two profiles sharing one means a
 *  copied store, and a shared id cannot say which row it lit. Skipping it paints
 *  no dot rather than a wrong one. Pure; pinned by the harness. */
function rosterRollups(lists, live) {
  const owners = new Map()

  for (const sessions of Object.values(lists || {})) {
    for (const session of sessions || []) {
      const id = String(session?.id || '')

      if (id) {
        owners.set(id, (owners.get(id) || 0) + 1)
      }
    }
  }

  const rollups = {}

  for (const [profile, sessions] of Object.entries(lists || {})) {
    const counts = { 'needs-input': 0, unread: 0, working: 0 }

    for (const session of sessions || []) {
      const id = String(session?.id || '')

      if (!id || owners.get(id) !== 1) {
        continue
      }

      const state = dotStateFor(live?.[id], session?.unread === true)

      if (state !== 'idle') {
        counts[state] += 1
      }
    }

    const state = counts['needs-input'] ? 'needs-input' : counts.unread ? 'unread' : 'idle'

    rollups[profile] = { count: counts['needs-input'] + counts.unread, counts, state }
  }

  return rollups
}

async function fetchRoster() {
  const res = await host.request('profiles.list', { include_sessions: true })
  const rows = Array.isArray(res?.profiles) ? res.profiles : []
  const mapped = rows.map(toRow).filter(row => !row.hidden).sort(compareRows)

  trackActivity(mapped, host.state.profile.get())

  // P8b: the aggregate dots' two readable sources. What is LIVE in this gateway
  // process, and every profile's own rows. The rows come from
  // `host.listPersistedSessions`, NOT `session.list`: the RPC's row projection
  // (`_session_row_summary`) drops the `unread` flag, and that flag is the whole
  // point (it is the persisted half of the dot, `SessionDB.session_unread`). The
  // host door opens each profile's `state.db` directly — no backend dial, no
  // profile switch — which is how it can answer for a profile with no runtime.
  // The per-profile read is CACHED (see dotListCache): a 5s tick must not
  // re-read twenty stores that have not moved.
  try {
    const [live, lists] = await Promise.all([
      liveSessionRows(),
      Promise.all(
        mapped.map(async row => {
          const stamp = `${row.sessionId || ''}|${row.lastActiveS || ''}`
          const cached = dotListCache.get(row.name)

          if (cached && cached.stamp === stamp && Date.now() - cached.at < DOT_LIST_TTL_MS) {
            return [row.name, cached.rows]
          }

          try {
            const page = await host.listPersistedSessions(null, { limit: ROLLUP_LIST_LIMIT, profile: row.name })
            const rows = Array.isArray(page?.sessions) ? page.sessions : []

            dotListCache.set(row.name, { at: Date.now(), rows, stamp })

            return [row.name, rows]
          } catch {
            // An unreadable or absent store contributes the rows it last
            // contributed (usually none) — the same rule the search sweep
            // follows, and never a dot that blinks off because one read failed.
            return [row.name, cached?.rows || []]
          }
        })
      )
    ])

    $profileDots.set(rosterRollups(Object.fromEntries(lists), liveStatusMap(live)))
  } catch {
    // Belt-and-braces: nothing here may take the roster down with it.
  }

  return mapped
}

/** Sessions of one profile, read through the source primary — no backend dial
 *  and no profile switch (`host.listPersistedSessions` opens that profile's
 *  state.db directly). This is what makes "a keyword in a conversation with
 *  profile X" reachable from this pane at all.
 *
 *  Three reads per profile, because each one has a blind spot the others cover:
 *   1. the live page — titles, previews, cwd of the newest 200;
 *   2. the ARCHIVE — `session.list` cannot serve it at all, so a title match in
 *      a chat the user archived was simply unsearchable before this;
 *   3. message bodies — the pane's own backend (FTS over `state.db`).
 *  One broken profile contributes nothing: a search must not fail because one
 *  store is unreadable. What it must NOT do is fail silently — the outcome is
 *  published in `$searchHealth` and the pane says so. */
async function searchInSessions(profiles, needle) {
  const byProfile = {}
  const failed = []
  let unavailable = false

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
        // A profile with an unreadable or absent store contributes nothing.
      }
    })
  )

  // The archive, through the same read the "View Archived" drill-down uses.
  // `null` is "cannot tell" (no backend / refused), which is a different thing
  // from an empty archive — only the latter means "nothing to find here".
  await Promise.all(
    profiles.map(async profile => {
      const rows = await listArchivedSessions(profile)

      if (!Array.isArray(rows)) {
        return
      }

      const hits = rows
        .filter(session => sessionMatches(session, needle))
        .map(session => ({ ...session, archived: true }))

      if (hits.length) {
        byProfile[profile] = [...hits, ...(byProfile[profile] || [])]
      }
    })
  )

  const bodies = await Promise.all(profiles.map(async profile => [profile, await bodySearch(profile, needle)]))

  for (const [profile, found] of bodies) {
    if (found?.unavailable) {
      unavailable = true

      continue
    }

    if (found?.error) {
      failed.push(profile)

      continue
    }

    mergeBodyHits(byProfile, profile, found?.results)
  }

  $searchHealth.set({ failed, unavailable })

  return byProfile
}

/** Message BODIES are the one thing the RPC surface cannot read (every
 *  `session.*` method returns session metadata), so the pane's own Python
 *  backend does the FTS read: `/api/plugins/personae/search`, read-only, one
 *  profile per call. `ctx.rest` is namespaced to this plugin, which is why
 *  that backend exists at all.
 *
 *  Three answers, not two — "no match", "this profile's read refused" and "the
 *  backend is not there at all" are DIFFERENT states, and collapsing them into
 *  one null is what made a dead backend look like an empty result. The caller
 *  publishes them (see `$searchHealth`); the UI is the one that decides how
 *  loud to be about it.
 *
 *  `role=user,assistant` asks the backend for conversational rows only, and the
 *  pane groups/deprioritises tool rows itself if the running backend predates
 *  that filter (an unknown query parameter is ignored, so the call is safe
 *  against both). Tool rows are the reason 40 hits could be 37 rows of escaped
 *  JSON: BM25 loves them and they are never what a person is looking for. */
async function bodySearch(profile, needle) {
  const rest = ctxRef?.rest

  if (typeof rest !== 'function') {
    return { results: [], unavailable: true }
  }

  try {
    const data = await rest(
      `/search?q=${encodeURIComponent(needle)}&profile=${encodeURIComponent(profile)}&limit=${SEARCH_BODY_LIMIT}&role=user,assistant`
    )

    if (!data || typeof data !== 'object' || data.error) {
      return { error: String(data?.error || 'unreadable response'), results: [] }
    }

    return { results: Array.isArray(data.results) ? data.results : [] }
  } catch (error) {
    return { error: String(error?.message || error || 'search failed'), results: [] }
  }
}

/** One backend match → the shape `SessionHit` already renders. The snippet IS
 *  the matched message, so it becomes the row's preview; `body: true` marks
 *  where it came from.
 *
 *  0.12.0: the markers come out HERE, "on the way in, not on the way out" — the
 *  snippet is the row's own text from this point on, so a later consumer cannot
 *  show it with `**` still in it by forgetting a call.
 *
 *  1.4.0: `conversational` rides along, because the role is what decides which
 *  of a session's matches is worth SHOWING. A tool row is machine output (file
 *  dumps, escaped JSON) and it beat the user's own sentence under BM25. */
function bodyHit(row) {
  const snippet = stripMarkdown(String(row?.snippet || '').replace(/>>>|<<</g, ''), 0)

  return {
    body: true,
    conversational: String(row?.role || '').trim().toLowerCase() !== 'tool',
    id: String(row?.session_id || row?.id || ''),
    last_active: row?.timestamp || row?.last_active || null,
    preview: snippet,
    title: String(row?.title || '')
  }
}

/** Fold backend body matches into the sweep's per-profile map, AGGREGATED BY
 *  SESSION.
 *
 *  The raw read is one row per matching MESSAGE, BM25-ranked — so "40 hits" is
 *  routinely three sessions' worth of tool output drawn as forty near-identical
 *  rows, with the chat the user actually meant ranked below the noise. One row
 *  per session instead, carrying how many messages matched and the BEST text
 *  the session has to show: a conversational match always beats a tool one, and
 *  sessions with something conversational in them sort ahead of tool-only ones
 *  (the backend's own relevance order is kept inside each group).
 *
 *  A session the metadata sweep already found keeps ONE row, ENRICHED: its
 *  title is worth more than a snippet, and its place in the list is where the
 *  other reads already put it. */
function mergeBodyHits(byProfile, profile, results) {
  const rows = (Array.isArray(results) ? results : []).map(bodyHit).filter(hit => hit.id)

  if (!rows.length) {
    return byProfile
  }

  const order = []
  const groups = new Map()

  for (const hit of rows) {
    let group = groups.get(hit.id)

    if (!group) {
      group = { hit, matches: 0, toolOnly: true }
      groups.set(hit.id, group)
      order.push(hit.id)
    }

    group.matches += 1

    // Only the FIRST conversational row may claim the snippet: the rows arrive
    // in the backend's relevance order, so a later one cannot be better.
    if (hit.conversational && group.toolOnly) {
      group.hit = hit
      group.toolOnly = false
    }
  }

  const grouped = order.map(id => {
    const group = groups.get(id)

    return { ...group.hit, matches: group.matches, toolOnly: group.toolOnly }
  })
  const known = byProfile[profile] || []
  const enriched = known.map(hit => {
    const match = grouped.find(entry => String(entry.id) === String(hit.id))

    return match
      ? { ...hit, body: true, matches: match.matches, preview: match.preview || hit.preview, toolOnly: match.toolOnly }
      : hit
  })
  const fresh = grouped.filter(entry => !known.some(hit => String(hit.id) === String(entry.id)))
  const ranked = [...fresh.filter(entry => !entry.toolOnly), ...fresh.filter(entry => entry.toolOnly)]

  byProfile[profile] = [...ranked, ...enriched]

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

/** One pass: query → kind → activity → profile.
 *
 *  The order is the fix, not a detail. A search is the user's most explicit
 *  statement about what they want on screen, so a row that ANSWERS the query is
 *  drawn before any view filter gets a vote: with the filters first, the
 *  profile holding the match could be filtered out of the roster entirely (a
 *  kind or activity filter the user set an hour ago), and "my session isn't
 *  there" is exactly what that looks like. The filters resume the moment the
 *  box is empty. */
function visibleRows(rows, { activity, kind, matchesByProfile, nowMs, profiles, query }) {
  const needle = String(query || '').trim().toLowerCase()

  return rows.filter(row => {
    if (needle) {
      if (matchesByProfile?.[row.name]?.length) {
        return true
      }

      return (
        row.label.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        // 0.12.0 leaves THIS line alone, deliberately: it matches the RAW preview. The rows carry a
        // stripped preview now (the display policy), but the matcher's job is search semantics, and
        // stripping before matching would change which rows answer a query — a search change smuggled
        // into a formatting batch is exactly the kind of thing nobody can attribute later.
        row.preview.toLowerCase().includes(needle)
      )
    }

    if (kind === 'withSessions' && row.messages < 1) {
      return false
    }

    if (kind === 'noSessions' && row.messages > 0) {
      return false
    }

    if (!matchesActivity(row, activity, nowMs)) {
      return false
    }

    return !(profiles.length && !profiles.includes(row.name))
  })
}

/** `sessionIdOf(session)`, or the stored id when there is no live id to prefer. */
function anySessionId(session) {
  return String(session?.resolved_id || session?.id || '')
}

/** "Archive all up to this point" (Pedro, 2026-10-16): every session of ONE
 *  profile whose last activity is STRICTLY older than the clicked one's.
 *
 *  Pure, and deliberately NOT "the rows below this one on screen": the drawn
 *  list is capped at ten, sorted by whatever mode the user picked, and possibly
 *  filtered — while this verb is a statement about the profile's whole history.
 *  The caller therefore passes the FULL list (`session.list` at its ceiling),
 *  and the count it reports is the count it will act on.
 *
 *  A session with no readable timestamp is LEFT OUT: it cannot be placed in
 *  time, and archiving by guess is not something the user can undo one row at a
 *  time. The clicked session is never in the result — archiving it is what the
 *  ordinary Archive verb is for. */
function sessionsUpTo(sessions, targetId) {
  const list = Array.isArray(sessions) ? sessions : []
  const wanted = String(targetId ?? '')
  // A row answers to TWO ids — the durable stored one and, while it is live, a
  // runtime one. Both must find the target and both must keep it out of its own
  // cut, or the verb quietly does nothing depending on which id the caller had.
  const isTarget = session => Boolean(wanted) && (anySessionId(session) === wanted || String(session?.id || '') === wanted)
  const target = list.find(isTarget)

  if (!wanted || !target) {
    return []
  }

  const at = secondsToMs(target?.last_active || target?.started_at)

  if (at === null) {
    return []
  }

  return list.filter(session => {
    if (isTarget(session)) {
      return false
    }

    const when = secondsToMs(session?.last_active || session?.started_at)

    return when !== null && when < at
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
 *  profile, which is exactly the bug this pane exists to avoid.
 *
 *  `exceptOpenId` is a session that must NOT be docked — the one the user just
 *  clicked, which is already the surface in FRONT. Docking it too would either
 *  stack it beside itself or hand the focus to whichever tab opened last,
 *  leaving the user looking at a session they never picked. */
function profileIsActive(profile) {
  return String(host.state.profile.get() || '') === String(profile || '')
}

/** What an open has to carry to MOVE the app onto `profile` — or null when it is
 *  already there.
 *
 *  `keepAllProfilesScope: false` is the SDK's own "explicit profile workspace
 *  switch" (`sdk/plugin-open-session-plan.ts`: false ->
 *  `{switchWorkspace: profile, showAllProfiles: false,
 *  requireActiveProfileForHydration: true}`), the same recipe the session-click
 *  path uses. Nothing else moves the chrome: with the flag absent (undefined
 *  counts as TRUE) a plugin open dials the profile's backend and leaves
 *  `$activeGatewayProfile` where it is.
 *
 *  Why a DOCK needs it (Pedro, 2026-10-13: "some session names are showing up as
 *  'new session' instead of their actual name"): core keeps session tabs in
 *  per-profile buckets and files a tile into whichever bucket is visible when it
 *  is CREATED, so tabs opened for a profile the app never moved to are filed
 *  under the profile the user came from — and a tab's title resolves against the
 *  LOADED session list of the visible profile, which holds no row for a session
 *  of another one. A tab with no row to name it stays on its "New session"
 *  placeholder (`app/chat/session-tile.tsx` `NEW_SESSION_TITLE`), which is
 *  exactly the nameless strip this fixes. */
function switchingFlags(profile) {
  return profileIsActive(profile) ? null : { keepAllProfilesScope: false }
}

function dockSessions(profile, sessions, exceptOpenId = null) {
  const name = String(profile || '')
  const except = String(exceptOpenId || '')
  const dock = (sessions || [])
    .filter(session => sessionIdOf(session) && sessionIdOf(session) !== except)
    .slice(0, DOCK_LIMIT)

  if (!name || !dock.length) {
    return Promise.resolve(0)
  }

  const open = (session, flags) =>
    openSession(sessionIdOf(session), name, 'tab', flags ? { ...INTENT_OPEN, ...flags } : INTENT_OPEN)
  const switching = switchingFlags(name)

  if (!switching) {
    dock.forEach(session => open(session))

    return Promise.resolve(dock.length)
  }

  // Cross-profile: the FIRST tab carries the switch, and nothing may be created
  // beside it until that move has landed — the SDK awaits the activation before
  // it navigates (`requireActiveProfileForHydration`), so everything opened after
  // this resolves files into the profile that is now visible.
  const [first, ...rest] = dock

  return open(first, switching).then(() => {
    rest.forEach(session => open(session))

    return dock.length
  })
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

  const name = String(row?.name || '')
  // Main LAST — a tab open focuses its own tile, so the session the user asked
  // for has to be the one opened last. The dock also has to come first for a
  // second reason: when this profile is not the one on screen, the dock's first
  // tab is what MOVES the app there, and the main open must not be created
  // before that has landed (see `switchingFlags`).
  const openMain = () => openSession(sessionIdOf(newest), name, 'main', rest.length ? null : switchingFlags(name))
  // …and the main open can be undone by the very switch it rides on, exactly
  // like a cross-profile session click (see reassertOpen).
  const settle = () => reassertOpen(name, sessionIdOf(newest))

  return (rest.length ? dockSessions(name, rest).then(openMain) : Promise.resolve(openMain())).then(settle)
}

/** Pedro, 2026-10-13: clicking a SESSION under another profile is a PROFILE
 *  MOVE, not merely an open.
 *
 *  Core keeps its session tabs in per-profile buckets and swaps the visible set
 *  when `$activeGatewayProfile` moves (`store/session-states.ts`: "Tiles are
 *  persisted per connection and profile … Switching either scope swaps the
 *  visible set"). So the strip can only show the clicked profile's sessions once
 *  the app's OWN profile has moved there — the swap itself is core's, and this
 *  pane breaks it by opening with `profile` while leaving chrome put
 *  (`sdk/plugin-open-session-plan.ts`: an undefined `keepAllProfilesScope`
 *  counts as TRUE, i.e. dialWithoutSwitching, no workspace switch).
 *
 *  Two steps, in this order:
 *
 *  1. the clicked session opens with `keepAllProfilesScope: false` — the app's
 *     own "explicit profile workspace switch" recipe, which also collapses the
 *     sidebar onto that profile. The SDK AWAITS that activation
 *     (`ensureGatewayProfile`) before it navigates, so a resolved open means the
 *     new bucket is the visible one.
 *  2. only THEN does the profile's list dock. The order IS the fix: a tile is
 *     filed into `visibleTileScope` as it is created, so docking first would file
 *     every tab into the profile the user just left — and it would race the SDK's
 *     generation guard, which throws "superseded by a newer selection" at every
 *     open but the last (`sdk/index.ts`).
 *
 *  Clicking INSIDE the profile the app is already on stays what it always was:
 *  open the session, leave the strip alone. */
/** The session the app says is in front, as a STORED id (runtime ids are
 *  reminted per resume, so they cannot be compared with what we clicked).
 *  `null` on an SDK that does not expose it — and then the caller does nothing
 *  rather than guessing. */
function focusedStoredSession() {
  const atom = host.state?.focusedStoredSessionId
  const read = atom?.get

  return typeof read === 'function' ? String(read.call(atom) || '') : ''
}

/** A cross-profile click needs a SECOND open, and this is why.
 *
 *  `planPluginOpenSession` turns that click into `switchWorkspace: profile` +
 *  `showAllProfiles: false` — a real workspace switch. A switch RE-HOMES the
 *  app: it restores that profile's own persisted tile set and brings up the
 *  conversation core had in front there. So the navigation to the clicked id
 *  races a restore that does not know about it, and the user lands on some
 *  other session of the right profile — Pedro, 2026-10-17: "every time I click a
 *  session from a different profile it opens a random session from that
 *  profile; only the second click lands on the one I wanted".
 *
 *  So: check what is actually in front, and if it is not the target, click
 *  again — the user's own workaround, done for them. Bounded (no poll loop): a
 *  second mismatch means something else is wrong and saying so is cheaper than
 *  fighting it. */
function reassertOpen(profile, storedId, attempts = 0) {
  const wanted = String(storedId)
  const focused = focusedStoredSession()

  if (!focused || focused === wanted || attempts >= 2) {
    return Promise.resolve(focused === wanted)
  }

  return Promise.resolve(openSession(wanted, profile)).then(() =>
    focusedStoredSession() === wanted ? true : reassertOpen(profile, wanted, attempts + 1)
  )
}

function openSessionInProfile(profile, sessions, openId) {
  const name = String(profile || '')
  const id = String(openId || '')

  if (!name || !id) {
    return Promise.resolve()
  }

  if (String(host.state.profile.get() || '') === name) {
    return openSession(id, name)
  }

  // The order is the fix, in three steps:
  //  1. the click's own open carries the switch (core files tabs into whichever
  //     profile is visible when they are CREATED, so the move must land first);
  //  2. the profile's list docks beside it;
  //  3. and only THEN is the clicked session put back in front — because every
  //     tab open FOCUSES ITS OWN TILE, so the dock that follows step 1 would
  //     otherwise leave the user on the last tab. That is the "random session"
  //     the user was seeing, deterministically, on every cross-profile click
  //     (the second click takes the same-profile path above and docks nothing).
  return openSession(id, name, null, { expectHistory: true, keepAllProfilesScope: false })
    .then(() => dockSessions(name, sessions, id))
    .then(() => reassertOpen(name, id)
  )
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

/** The way back. `session.archive { archived: false }` is core's own unarchive —
 *  the same call the archive view uses — so a chat hidden from every live
 *  listing is one menu pick from returning (Pedro, 2026-10-16, after the bulk
 *  "Archive all up to this point" made a one-way door out of it). */
function unarchiveSession(storedId, profile) {
  return host.request('session.archive', { archived: false, profile, session_id: String(storedId) })
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

/** Rename one session. Empty names are refused outright.
 *
 *  ONE DOOR, deliberately — and this is the PERMANENT fix, not a fallback.
 *
 *  Core's `session.title` is SESSION-SCOPED: the gateway resolves its
 *  `session_id` against the LIVE registry (`_sessions.get(id)`) and answers
 *  `4001 session not found` for anything else. Every id a session LIST shows is
 *  a STORED id, and the two are different strings even for a session that is
 *  live (`resolved_id` is the runtime one). So the RPC can never be the primary
 *  path from a list, and an id-shaped "try the RPC first, then fall back" dance
 *  is exactly what lets this bug come back: two id shapes, two failure modes,
 *  and a fallback nobody sees firing.
 *
 *  The pane's backend `POST /title` performs the SAME write core's own REST
 *  rename route performs (`resolve_session_id` → `set_session_title`) on the
 *  profile's store, from either id shape. It is the only path, for live and
 *  stored sessions alike — the one case the RPC additionally covered is a
 *  session with NO db row yet (`pending_title`), and such a session is not in
 *  any list to be renamed from.
 *
 *  A missing/older backend half is named as such instead of blamed on the
 *  session: that confusion is what made "Session not found" so hard to read. */
async function renameSession(session, profile, title) {
  const name = String(title || '').trim()
  const storedId = String(session?.id || '').trim()

  if (!name || !storedId) {
    return false
  }

  const rest = ctxRef?.rest

  if (typeof rest !== 'function') {
    throw new Error('Renaming needs the Personae backend, and it is not mounted in this build.')
  }

  // Two AUTHORITIES, not two guesses. The store is the durable title; the
  // running session object is what core's auto-titler consults — so a rename
  // that writes only the store is silently UNDONE by the first turn of a young
  // chat, which is exactly what "I can't rename it until it has answered me"
  // looks like from the outside (Pedro, 2026-10-17).
  //
  // The id decides the door, and each id shape has exactly one legitimate door:
  //   stored id → the pane's backend (works for a session that is not running)
  //   live id   → `session.title` (the only thing core will accept for a RUNNING
  //               session; it 4001s every stored id, which is why the stored door
  //               is not a fallback for it but the primary for the other shape)
  const liveId = String(session?.resolved_id || session?.openId || '').trim()
  let answer = null
  let said = ''

  try {
    answer = await rest('/title', { body: { profile, session_id: storedId, title: name }, method: 'POST' })
  } catch (error) {
    said = String(error?.message || error || '')
  }

  const stored = Boolean(answer) && !answer.error
  const missing = answer?.error === 'session_not_found' || (!answer && /\b40[34]\b/.test(said))

  // A chat created in this window can exist ONLY as a live session: nothing has
  // written a row yet, so the stored door answers "no such session" and the
  // gateway is the only door there is.
  if (missing) {
    // The store has no such row, so the id we are holding cannot be a STORED id:
    // it is the gateway's own id for a chat that has not been written yet. Try
    // the gateway with it — this is the "until it has answered me" case — and
    // only then admit that neither door knows it.
    const candidate = liveId || storedId

    try {
      await host.request('session.title', { session_id: candidate, title: name })

      return true
    } catch (error) {
      const why = String(error?.message || error || '')

      throw new Error(String(answer?.detail || why || `Could not rename this session (${storedId || 'no id'}).`))
    }
  }

  if (!stored) {
    throw new Error(
      /\b40[34]\b/.test(said)
        ? `Rename failed — the Personae backend half is older than the plugin (restart it): ${said}`
        : `Rename failed: ${said || answer?.detail || 'the backend did not answer.'}`
    )
  }

  // The store took it. If this session is RUNNING, tell it too: its own title is
  // what auto-titling will overwrite on the next turn. Best effort by design —
  // the durable write already succeeded, and a non-running row has no live id.
  if (liveId) {
    try {
      await host.request('session.title', { session_id: liveId, title: name })
    } catch {
      // A live id that the gateway no longer holds is not a rename failure.
    }
  }

  return true
}

/** Whole-session branch of a stored parent; the child opens like core's does. */
async function branchSession(storedId, profile) {
  const res = await host.request('session.branch_stored', {
    idempotency_key: `personae-branch-${Date.now().toString(36)}`,
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
      await renameSession({ id: child.id }, profile, child.title)
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
      idempotency_key: `personae-apropos-group-${group}-${Date.now().toString(36)}`,
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
      idempotency_key: `personae-apropos-${parentId}-${Date.now().toString(36)}`,
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

let memberRowCache = {}

/** Rows for the members the profile's page could not answer, BY ID.
 *
 *  `session.list` serves live rows inside its page and nothing else, so three
 *  members are invisible to it: an ARCHIVED one, one older than the page, and one
 *  whose id a compaction has since reminted. Asking "which of the newest N are
 *  these?" cannot be made to work for those; asking "what is behind these ids?"
 *  can — the pane's own backend resolves each id through its lineage and returns
 *  the live tip. Cached briefly: the roster polls every few seconds and this is a
 *  write-free read of a handful of ids.
 *
 *  An older backend has no `/resolve`; the archive listing is then the only page
 *  it can offer, and it is used as the fallback rather than leaving the box empty. */
async function resolvedMemberRows(profile, ids) {
  const rest = ctxRef?.rest

  if (typeof rest !== 'function' || !ids.length) {
    return []
  }

  const key = `${profile}|${ids.map(String).sort().join(',')}`
  const hit = memberRowCache[key]

  if (hit && Date.now() - hit.at < 15000) {
    return hit.rows
  }

  let rows = []

  try {
    const data = await rest('/resolve', { body: { ids, profile }, method: 'POST' })

    rows = Array.isArray(data?.sessions) ? data.sessions : []
  } catch {
    rows = []
  }

  if (!rows.length) {
    const archived = (await listArchivedSessions(profile, SESSIONS_FILL_CAP)) || []

    rows = archived
      .filter(row => ids.map(String).includes(String(row?.id)))
      .map(row => ({ ...row, archived: true }))
  }

  memberRowCache = { ...memberRowCache, [key]: { at: Date.now(), rows } }

  return rows
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

  // A wanted member the live page cannot serve leaves a box that claims a
  // session it cannot draw, and nothing tells the user why. THREE shapes, not
  // one: `session.list` never returns an ARCHIVED session, it stops at the
  // 500-row cap, and a compaction REmints a session's id — so an id filed
  // before a compaction names a row the page no longer has. A page cannot be
  // filtered into answering any of them; the ids have to be RESOLVED, which is
  // what the pane's backend does (lineage included).
  const have = rowIdSet(loaded.sessions)
  const missing = wanted.map(String).filter(id => !have.has(id))

  if (missing.length) {
    for (const row of await resolvedMemberRows(profile, missing)) {
      // The row reports the live TIP; `_lineage_root_id` is what keeps a
      // membership filed before a compaction matching (rowIdentities reads
      // both), so the box keeps holding what the store says it holds.
      if (!rowIdSet(loaded.sessions).has(String(row?.id))) {
        loaded.sessions = [...loaded.sessions, row]
      }
    }
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

async function listArchivedSessions(profile, limit = 60) {
  const rest = ctxRef?.rest

  if (typeof rest !== 'function') {
    return null
  }

  let data

  try {
    data = await rest(`/archived?profile=${encodeURIComponent(profile)}&limit=${Number(limit) || 60}`)
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

/** One profile's FULL hit list for one needle — what the roster draws the first
 *  five of, and what `${extra} more` opens. Runs the same sweep the roster does
 *  (metadata + archive + bodies) against a single profile, so the drill-down
 *  cannot disagree with the row that opened it. */
async function listSearchHits(profile, needle) {
  const needle_ = String(needle || '').trim()

  if (!needle_) {
    return []
  }

  const byProfile = await searchInSessions([profile], needle_)

  return byProfile[profile] || []
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

/** The human part of a preview, or '' when there is none. Pure.
 *
 *  0.12.0: it keeps its own job (injected boilerplate is not a session name) and
 *  then strips the markdown markers, so the SAME policy decides what a title-less
 *  row reads as and what the roster's preview line shows. The 96-char clip in
 *  `sessionLabel` is unchanged — stripping happens under it, not instead of it. */
function humanPreview(preview) {
  const text = String(preview || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) {
    return ''
  }

  return PREVIEW_BOILERPLATE.some(pattern => pattern.test(text)) ? '' : stripMarkdown(text, 0)
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

/** One menu row: core's own glyph for the verb, then the label.
 *
 *  Pedro, 2026-10-13: "add little icons to the options in the pop-up list when
 *  right-clicking on a session". The shape is core's own, verbatim
 *  (`renderActionItem` in `components/ui/actions-menu.tsx`): a Codicon at
 *  `size="0.875rem"`, then the label in a `<span>`.
 *
 *  The names are core's wherever core has the same verb, checked against
 *  `app/chat/sidebar/session-actions-menu.tsx`: Rename is `edit`, Branch
 *  `repo-forked`, Export `cloud-download`, Archive `archive`, Delete `trash`,
 *  Hide `eye-closed`, Mark as unread `mail`, Open/in-new-tab `browser`,
 *  in-new-window `link-external`. A verb core does not have takes a glyph from
 *  the app's wider menu vocabulary — Appearance is `symbol-color`, exactly what
 *  core's own sub-trigger beside it draws; Group `folder`; New session group
 *  `new-folder`; Copy id `copy`; Select `check`; Session `history`; Apropos
 *  `lightbulb`; Assign to project `project`. `Move to group` is `move`, the one
 *  name picked for the verb alone, since core has no move-a-session row.
 *
 *  Every name is checked against the font the app pins (@vscode/codicons 0.0.45,
 *  see tests/icons.mjs): a glyph the font does not carry renders as NOTHING, and
 *  a blank slot reads as "that option has no icon" rather than as an error.
 *  `git-fork` is the cautionary example — not in the font; `repo-forked` is. */
function menuGlyph(icon, label) {
  return [
    jsx(Codicon, { className: 'shrink-0', name: icon, size: '0.875rem' }, 'icon'),
    jsx('span', { children: label }, 'label')
  ]
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
  onArchiveUpTo,
  onRightClickSelect,
  onSelect,
  onToggleSelect,
  group,
  groups,
  onMoveGroup,
  onNewGroup,
  profile,
  // The profile's VISIBLE session list (the same array the profile menu docks).
  // A click under a profile the app is not on docks this list onto the strip, so
  // the row needs the list, not just its own session.
  profileSessions,
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
  // A search hit from the ARCHIVE: the row is here because the query matched a
  // chat that is not in any live list, so it says where it came from instead of
  // looking like an ordinary recent session.
  const archived = session?.archived === true
  // How many messages of this session matched the needle (body hits only; the
  // backend's raw read is one row per MESSAGE and the pane folds those into one
  // row per session — see mergeBodyHits).
  const matches = Number(session?.matches) > 1 ? Number(session.matches) : 0
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
          //
          // A plain click asks `openSessionInProfile`, NOT `openSession`: under
          // another profile the click has to move the app's profile first and put
          // that profile's list on the strip, or the strip keeps showing the
          // sessions of the profile the user just left (2026-10-13).
          onClick: guardClick(
            selecting
              ? () => onToggleSelect()
              : () => openSessionInProfile(profile, profileSessions, openId)
          ),
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
            archived
              ? jsx(
                  'span',
                  {
                    'data-session-archived': storedId,
                    className:
                      'shrink-0 rounded-sm px-1 text-[0.625rem] uppercase text-(--ui-text-quaternary)',
                    children: 'archived'
                  },
                  'archived-chip'
                )
              : null,
            matches
              ? jsx(
                  'span',
                  {
                    'data-session-matches': String(matches),
                    className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: `${matches} matches`
                  },
                  'matches'
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
            { onSelect: () => onSelect(), children: menuGlyph('check', 'Select') },
            'select-session'
          ),
          // 2. Open
          jsxs(
            ContextMenuSub,
            {
              children: [
                jsx(ContextMenuSubTrigger, { children: menuGlyph('browser', 'Open') }, 'open-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => openSession(openId, profile, 'window'), children: menuGlyph('link-external', 'In new window') },
                        'open-window'
                      ),
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => openSession(openId, profile, 'tab', INTENT_OPEN), children: menuGlyph('browser', 'In new tab') },
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
                jsx(ContextMenuSubTrigger, { children: menuGlyph('history', 'Session') }, 'session-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => markSessionUnreadFinished(storedId, profile), children: menuGlyph('mail', 'Mark as unread') },
                        'unread'
                      ),
                      jsx(ContextMenuItem, { onSelect: () => onRename(session, profile), children: menuGlyph('edit', 'Rename…') }, 'rename'),
                      jsx(ContextMenuItem, { onSelect: () => branchSession(storedId, profile), children: menuGlyph('repo-forked', 'Branch') }, 'branch'),
                      // The stored id is the key every other door takes: the
                      // gateway RPCs, the REST API, and `session_search(session_id=…)`.
                      jsx(ContextMenuItem, { onSelect: () => copySessionId(storedId), children: menuGlyph('copy', 'Copy id') }, 'copy-id'),
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => exportSession(storedId, profile, title), children: menuGlyph('cloud-download', 'Export…') },
                        'export'
                      ),
                      // Hiding is the pane's own view filter, never a core
                      // mutation: the session keeps living in the Sessions tab, so
                      // this is the reversible half of Archive.
                      jsx(
                        ContextMenuItem,
                        {
                          onSelect: () => setSessionHidden(profile, storedId, !hidden),
                          children: menuGlyph(hidden ? 'eye' : 'eye-closed', hidden ? 'Unhide in Personae' : 'Hide from Personae')
                        },
                        'hide-session'
                      ),
                      // An ARCHIVED row gets the way back instead of the verb it
                      // already has: "Archive" on something already archived is a
                      // no-op dressed as an action, and after a bulk cut the user
                      // needs the undo more than a second door in.
                      archived
                        ? jsx(
                            ContextMenuItem,
                            {
                              onSelect: () => unarchiveSession(storedId, profile),
                              children: menuGlyph('unarchive', 'Unarchive')
                            },
                            'unarchive'
                          )
                        : jsx(
                            ContextMenuItem,
                            { onSelect: () => archiveSession(storedId, profile), children: menuGlyph('archive', 'Archive') },
                            'archive'
                          ),
                      // "Archive all up to this point" (Pedro, 2026-10-16): this
                      // session marks a CUT — everything in the profile with an
                      // older last activity goes with it. The count is read from
                      // the profile's full list and confirmed before anything
                      // moves (see the pane's openArchiveUpTo): the rows on
                      // screen are a capped page, and a bulk verb that acts on a
                      // different set than it reported is one nobody can trust.
                      // Not offered on an already-archived row: the cut names a
                      // boundary in a LIVE list, and from inside the archive it
                      // would re-archive rows and report a number as work done.
                      archived
                        ? null
                        : jsx(
                            ContextMenuItem,
                            {
                              onSelect: () => onArchiveUpTo?.(session, profile),
                              children: menuGlyph('archive', 'Archive all up to this point…')
                            },
                            'archive-upto'
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
                          children: menuGlyph('trash', 'Delete session…')
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
                jsx(ContextMenuSubTrigger, { children: menuGlyph('lightbulb', 'Apropos (On that topic, beta)') }, 'apropos-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      // 4.1 the classic single-session refresher: a child that
                      // can consult THIS transcript, with no group and no bloat.
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => aproposSession(storedId, profile, title), children: menuGlyph('comment-discussion', 'From this session') },
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
                        { onSelect: () => onCreateAproposGroup(), children: menuGlyph('new-folder', 'Create group') },
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
                jsx(ContextMenuSubTrigger, { children: menuGlyph('folder', 'Group') }, 'group-trigger'),
                jsx(
                  ContextMenuSubContent,
                  {
                    children: [
                      jsx(
                        ContextMenuItem,
                        { onSelect: () => onNewGroup(), children: menuGlyph('new-folder', 'New session group') },
                        'new-session-group'
                      ),
                      groups && groups.length
                        ? jsxs(
                            ContextMenuSub,
                            {
                              children: [
                                jsx(ContextMenuSubTrigger, { children: menuGlyph('move', 'Move to group') }, 'moveto'),
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
                jsx(ContextMenuSubTrigger, { children: menuGlyph('symbol-color', 'Appearance') }, 'appearance'),
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
                jsx(ContextMenuSubTrigger, { children: menuGlyph('project', 'Assign to project') }, 'project'),
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
  searching,
  isCurrent,
  nowMs,
  drag,
  dropAt,
  onDragStart,
  onArchiveUpTo,
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
  // While a query is live the MATCHES are this row's list, expanded or not.
  // That ordering is the whole fix for "I searched for a keyword and it didn't
  // pop up the session I was expecting" (Pedro, 2026-10-16): the profile's own
  // recent sessions are the answer to a different question, and they used to
  // win outright — so a profile that happened to be OPEN drew its ten latest
  // sessions and swallowed every hit for it.
  // The list the user dragged into shape wins over recency — but only the
  // profile's own sessions: search hits keep the relevance order they came in.
  const listed =
    searching || !expanded
      ? shown
      : withAproposChildren(
          sortProfileSessions(sessions || [], sortMode, sessionOrder?.[row.name]),
          links,
          row.name
        )
  // Hiding is a VIEW, not a mutation (see HIDDEN_KEY): the pane filters its own
  // list, core's session list is untouched, and the row is one click away from
  // coming back. Pedro, 2026-10-10: "hiding only hides it from view in the
  // Messenger tab, not from Sessions."
  const hiddenState = useValue($hiddenSessions)
  const hiddenIds = new Set(hiddenState[String(row.name)] || [])
  const hiddenCount = listed.filter(session => hiddenIds.has(String(session?.id))).length
  const revealed = Boolean(showHidden?.[row.name])
  // …but a MATCH is a match: a hidden session that answers the query is drawn
  // WITH its `hidden` chip and its Unhide verb, because "where did that chat
  // go" is one of the things a search is for. Hiding still governs the
  // profile's own list, which is what the footer's counter is about.
  const visible = searching ? listed : revealed ? listed : listed.filter(session => !hiddenIds.has(String(session?.id)))
  const extra = searching || !expanded ? (hits || []).length - shown.length : 0
  // Only the EXPANDED list is grouped: a search-hit list is about the needle,
  // not about filing — and `sessionGroupBlocks` hands back a single anonymous
  // block when there are no groups, which is the flat list it has always been.
  const groupBlocks =
    expanded && !searching
      ? sessionGroupBlocks(visible, groupState, row.name, releasedState[String(row.name)] || [])
      : [{ collapsed: false, id: null, name: '', sessions: visible }]
  // The colour this profile's rows are filled with — his pick in the editor, and
  // NOTHING unless he picked one (see fillOf: "fill is opt-in").
  const fill = fillOf(row)
  // P8b: this row's dot is the AGGREGATE of the profile's sessions, written by
  // the roster poll (see rosterRollups). Until one lands — the first render, or a
  // store the poll could not read — there is no rollup at all and core's own
  // `SessionStatusDot` draws, which is exactly what this slot did before.
  const dots = useValue($profileDots)
  const rollup = dots?.[row.name] || null
  // The pane paints its OWN dot whenever it has a rollup for this profile — an
  // IDLE rollup included, as the neutral dot. Handing the cell back to core's
  // per-session dot on idle would put blue on the row for a merely running
  // session, which is the one thing the profile dot must not do. Core's dot is
  // only the placeholder for a profile the poll has not reached yet (the first
  // render, or a store it could not read).
  const dot = rollup && rollup.state !== 'idle' ? rollup : null
  const dotLabel = rollup ? t(DOT_TITLE_KEY[rollup.state]) : ''
  // The breakdown only earns its place when it says more than the colour does:
  // one bucket and the label already said it.
  const dotTitle = dot
    ? dot.count > 1
      ? `${dotLabel} — ${t('dotSummary', dot.counts['needs-input'], dot.counts.working, dot.counts.unread)}`
      : dotLabel
    : dotLabel

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
                            //
                            // The aggregate dot when the profile has one (P8b),
                            // core's own per-session dot otherwise. Both are the
                            // same size and sit in the same cell, so a profile
                            // going amber cannot shift the list.
                            jsx(SidebarRowLead, {
                              children: rollup
                                ? jsx('span', {
                                    'aria-label': dotLabel,
                                    'data-profile-dot': rollup.state,
                                    className: ROLLUP_DOT[rollup.state],
                                    role: 'status',
                                    title: dotTitle
                                  })
                                : jsx(SessionStatusDot, { storedSessionId: row.sessionId })
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
                        // The count badge: the messenger convention this pane is
                        // modelled on, and the second half of the user's ask
                        // ("show a number for how many session statusdots are
                        // active"). It counts what AWAITS him — waiting + unread
                        // (see rosterRollups) — never a session that is only
                        // running. Only for more than one: a lone "1" would just
                        // repeat the dot, which is exactly why the number
                        // disappears the moment one of two is read while the
                        // colour stays ("the dot remains green, but the number
                        // disappears"). It sits in the trailing cluster beside
                        // the age, which keeps every name on the one left edge
                        // the lead cell exists to hold.
                        dot && dot.count > 1
                          ? jsx(
                              'span',
                              {
                                'data-profile-dot-count': dot.count,
                                className: 'shrink-0 rounded-sm px-1 text-[0.625rem] font-medium',
                                style: { color: ROLLUP_INK[dot.state] },
                                children: String(dot.count)
                              },
                              'dot-count'
                            )
                          : null,
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
                { onSelect: () => newSession(row.name), children: menuGlyph('add', 'New session') },
                'new-session'
              ),
              // Same dialog Bots offers, writing the same places — see
              // EditProfileDialog.
              jsx(
                ContextMenuItem,
                { onSelect: () => onEditProfile(row), children: menuGlyph('edit', 'Edit profile\u2026') },
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
                  children: menuGlyph('history', 'Open newest session')
                },
                'open-newest'
              ),
              jsx(
                ContextMenuItem,
                { onSelect: () => dockSessions(row.name, sessions), children: menuGlyph('browser', 'Open all in tabs') },
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
                    jsx(ContextMenuSubTrigger, { children: menuGlyph('list-ordered', 'Sort sessions') }, 'sort-trigger'),
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
                      children: menuGlyph('eye', `${revealed ? '✓ ' : ''}Show hidden (${hiddenCount})`)
                    },
                    'show-hidden'
                  )
                : null,
              hiddenCount && revealed
                ? jsx(
                    ContextMenuItem,
                    { onSelect: () => unhideAll(row.name), children: menuGlyph('eye', `Unhide all (${hiddenCount})`) },
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
                      // The SESSION, not its id: renaming needs the live id too (see renameSession).
                      onRenameSubmit: name => onRenameSubmit(row.name, session, name),
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
                      // The bulk-archive cut (see sessionsUpTo): the row supplies
                      // the session it was picked on, the PANE reads the
                      // profile's full list and confirms the count before
                      // anything moves.
                      onArchiveUpTo,
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
                      profileSessions: sessions,
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
        ? jsx(
            'button',
            {
              // A door, not a dead line of text. `${extra} more` used to say
              // there were more matches and offer no way to reach them, so a
              // session ranked sixth was unreachable by any route from the
              // roster. This opens the drill-down on the SAME needle, where the
              // whole per-profile hit list is drawn.
              'data-more-hits': String(extra),
              className:
                'min-w-0 px-2 py-1 pl-4 text-left text-[0.6875rem] text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
              onClick: () => $listView.set(moreHitsTarget(row.name, $searchQuery.get())),
              type: 'button',
              children: `${extra} more`
            },
            'more-hits'
          )
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

/* ── SCREEN: the RFB client ──────────────────────────────────────────────────
 * Personae DRIVES a profile's Bot Desktop — Start, Stop, Install, watch and
 * Take over — instead of printing "go to Bot Mode → Screen" and calling that a
 * feature. Pedro, 2026-10-15: "The Screen tab / hero does nothing useful."
 *
 * The viewer is hand-written on purpose. A runtime-loaded plugin may import
 * exactly `@hermes/plugin-sdk` and `react` (`contrib/runtime-loader.ts` rejects
 * every other specifier), and noVNC is only within reach of core because Bot
 * Mode is BUNDLED, not loaded. So this file speaks RFB itself:
 *
 *   handshake   fixed-size, because Xvnc runs `-SecurityTypes None`
 *               (`tools/bot_desktop/rfb_filter.py`: "12-byte version, 1-byte
 *               security choice, then ClientInit (1 byte)").
 *   encodings   Raw (0) and CopyRect (1) only. CopyRect is the one cheap win —
 *               it is a memcpy inside our own canvas — while ZRLE/Tight would
 *               need their decoders. Advertising nothing else keeps the server
 *               from sending something this viewer cannot read.
 *   pacing      ONE outstanding FramebufferUpdateRequest: the next is sent only
 *               after the previous frame was painted (`ack()`), so a busy screen
 *               cannot queue megabytes behind a slow canvas.
 *
 * On the far side, `hermes_cli/web_routers/display.py` splices this profile's
 * Xvnc socket into `/api/display/ws` and runs the client stream through
 * `RfbClientFilter`, which DROPS input messages from anyone who does not hold
 * the lease. That filter is the gate; a viewer's `viewOnly` is only a hint. Its
 * lengths are fixed (SetPixelFormat 20, FramebufferUpdateRequest 10, KeyEvent 8,
 * PointerEvent 6), so every builder below must be exactly that size or the
 * parser over there desyncs and starts eating real messages.
 *
 * Integers on this wire are BIG-endian; only PIXEL data follows the negotiated
 * pixel format's own endianness. Getting that backwards yields a handshake that
 * hangs or a canvas that looks like static, and both read as "the pane is
 * broken". */

const RFB_VERSION_REPLY_38 = 'RFB 003.008\n'
const RFB_SECURITY_NONE = 1
/** ClientInit, shared desktop: the third and last fixed handshake byte. The
 *  gateway's `RfbClientFilter` counts the handshake as 12 + 1 + 1, so a client
 *  that skips this does not merely hang — it makes the bridge read the first
 *  byte of SetPixelFormat as ClientInit and desync every message after it. */
const RFB_CLIENT_INIT = new Uint8Array([1])
const RFB_ENCODING_RAW = 0
const RFB_ENCODING_COPY_RECT = 1
const RFB_DESKTOP_SIZE = -223
const RFB_CUT_TEXT_MAX = 256 * 1024

/** The pixel format WE ask for: 32bpp little-endian truecolour, 8 bits a
 *  channel. Asking for it explicitly is what makes the decoder a fixed shape. */
function rfbRequestedFormat() {
  return {
    bigEndian: false,
    blueMax: 255,
    blueShift: 0,
    bpp: 32,
    depth: 24,
    greenMax: 255,
    greenShift: 8,
    redMax: 255,
    redShift: 16,
    trueColour: true
  }
}

/** A PIXEL_FORMAT block (16 bytes; RFC 6143 §7.4). */
function rfbFormatBytes(format) {
  const out = new Uint8Array(16)
  const view = new DataView(out.buffer)

  out[0] = format.bpp
  out[1] = format.depth
  out[2] = format.bigEndian ? 1 : 0
  out[3] = format.trueColour ? 1 : 0
  view.setUint16(4, format.redMax)
  view.setUint16(6, format.greenMax)
  view.setUint16(8, format.blueMax)
  out[10] = format.redShift
  out[11] = format.greenShift
  out[12] = format.blueShift

  return out
}

function parseRfbFormat(bytes, at = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, 16)

  return {
    bigEndian: view.getUint8(2) === 1,
    blueMax: view.getUint16(8),
    blueShift: view.getUint8(12),
    bpp: view.getUint8(0),
    depth: view.getUint8(1),
    greenMax: view.getUint16(6),
    greenShift: view.getUint8(11),
    redMax: view.getUint16(4),
    redShift: view.getUint8(10),
    trueColour: view.getUint8(3) === 1
  }
}

/** SetPixelFormat — 20 bytes: type, 3 pad, then the format. */
function rfbSetPixelFormat(format = rfbRequestedFormat()) {
  const out = new Uint8Array(20)

  out.set(rfbFormatBytes(format), 4)

  return out
}

/** SetEncodings — 4 + 4n bytes: type, 1 pad, u16 count, then i32 values. */
function rfbSetEncodings(encodings) {
  const out = new Uint8Array(4 + encodings.length * 4)
  const view = new DataView(out.buffer)

  out[0] = 2
  view.setUint16(2, encodings.length)
  encodings.forEach((encoding, index) => view.setInt32(4 + index * 4, encoding))

  return out
}

/** FramebufferUpdateRequest — 10 bytes. `incremental: false` asks for a full
 *  repaint of `rect` (the first frame); true asks for damage since the last. */
function rfbUpdateRequest(rect, incremental) {
  const out = new Uint8Array(10)
  const view = new DataView(out.buffer)

  out[0] = 3
  out[1] = incremental ? 1 : 0
  view.setUint16(2, rect.x)
  view.setUint16(4, rect.y)
  view.setUint16(6, rect.width)
  view.setUint16(8, rect.height)

  return out
}

/** KeyEvent — 8 bytes. */
function rfbKeyMessage(down, keysym) {
  const out = new Uint8Array(8)

  out[0] = 4
  out[1] = down ? 1 : 0
  new DataView(out.buffer).setUint32(4, keysym >>> 0)

  return out
}

/** PointerEvent — 6 bytes. */
function rfbPointerMessage(mask, x, y) {
  const out = new Uint8Array(6)
  const view = new DataView(out.buffer)

  out[0] = 5
  out[1] = mask & 0xff
  view.setUint16(2, x)
  view.setUint16(4, y)

  return out
}

/** The X11 keysyms this viewer can name without a keymap table. Everything
 *  printable rides its Latin-1 code point, which is exactly what X expects for
 *  ASCII (there is no per-keycode translation to do for 0x20–0xff). */
const KEYSYM_NAMES = {
  Alt: 0xffe9,
  ArrowDown: 0xff54,
  ArrowLeft: 0xff51,
  ArrowRight: 0xff53,
  ArrowUp: 0xff52,
  Backspace: 0xff08,
  CapsLock: 0xffe5,
  ContextMenu: 0xff67,
  Control: 0xffe3,
  Delete: 0xffff,
  End: 0xff57,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Home: 0xff50,
  Insert: 0xff63,
  Meta: 0xffe7,
  NumLock: 0xff7f,
  PageDown: 0xff56,
  PageUp: 0xff55,
  Pause: 0xff13,
  PrintScreen: 0xff61,
  ScrollLock: 0xff14,
  Shift: 0xffe1,
  Tab: 0xff09
}

const KEYSYM_CODES = {
  NumpadAdd: 0xffab,
  NumpadDecimal: 0xffae,
  NumpadDivide: 0xffaf,
  NumpadEnter: 0xff8d,
  NumpadMultiply: 0xffaa,
  NumpadSubtract: 0xffad
}

/** One DOM key → one keysym, or 0 when this viewer cannot name it. `code` is
 *  consulted only where `key` is ambiguous (numpad, F-keys). */
function keysymFor(key, code) {
  if (Object.prototype.hasOwnProperty.call(KEYSYM_NAMES, key)) {
    return KEYSYM_NAMES[key]
  }

  if (Object.prototype.hasOwnProperty.call(KEYSYM_CODES, code)) {
    return KEYSYM_CODES[code]
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return 0xffb0 + Number(code.slice(-1))
  }

  if (/^F([1-9]|1[0-2])$/.test(key)) {
    return 0xffbe + (Number(key.slice(1)) - 1)
  }

  // A printable character: its code point IS the keysym up to Latin-1. Beyond
  // that it would need the Unicode→keysym table; 0 sends nothing, which is
  // honest (the key is dropped) instead of sending a DIFFERENT key.
  if (key.length === 1 && key.codePointAt(0) < 0x100) {
    return key.codePointAt(0)
  }

  return 0
}

/** Modifier keysyms an event carries, in a fixed X order. */
const RFB_MODIFIERS = [
  ['ctrlKey', 0xffe3],
  ['altKey', 0xffe9],
  ['metaKey', 0xffe7],
  ['shiftKey', 0xffe1]
]

/** The keysyms to send for one key event, in wire order. A press sends the
 *  modifiers it needs and then the key; a release sends the key and then drops
 *  the modifiers — noVNC's order, and the one that keeps a stuck modifier from
 *  holding the bot's keyboard hostage after a focus change. */
function keysymsForEvent(event, down) {
  const key = keysymFor(String(event?.key || ''), String(event?.code || ''))

  if (!key) {
    return []
  }

  const modifiers = RFB_MODIFIERS.filter(([flag]) => event?.[flag]).map(([, keysym]) => keysym)

  return down ? [...modifiers, key] : [key, ...modifiers.reverse()]
}

/** DOM button bits → RFB mask bits. They disagree: DOM is 1 left / 2 right /
 *  4 middle, RFB is 1 left / 2 middle / 4 right. */
function pointerMaskFor(buttons) {
  const value = Number(buttons) || 0

  return (value & 1) | ((value & 4) >>> 1) | ((value & 2) << 1)
}

/** A wheel tick as RFB's transient masks: bit 3 up, bit 4 down. Xvnc reads the
 *  press (and the release that follows) as one scroll step. */
function wheelMaskFor(deltaY) {
  if (!deltaY) {
    return 0
  }

  return deltaY < 0 ? 8 : 16
}

/** Raw rectangle → RGBA. Writes straight into the canvas' own pixel array
 *  (`stride` bytes per row) and returns how many wire bytes it consumed.
 *  Pure: bytes in, pixels out — which is how the harness proves the decoder
 *  without a screen. `pixels` is a typed array (the canvas ImageData's data). */
function decodeRawRect(bytes, at, format, pixels, targetAt, rectWidth, rectHeight, stride) {
  const step = Math.max(1, Math.ceil(format.bpp / 8))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
  const redScale = format.redMax ? 255 / format.redMax : 0
  const greenScale = format.greenMax ? 255 / format.greenMax : 0
  const blueScale = format.blueMax ? 255 / format.blueMax : 0
  let cursor = at

  for (let row = 0; row < rectHeight; row += 1) {
    let to = targetAt + row * stride

    for (let column = 0; column < rectWidth; column += 1) {
      let value

      if (step === 4) {
        value = view.getUint32(cursor, !format.bigEndian)
      } else if (step === 2) {
        value = view.getUint16(cursor, !format.bigEndian)
      } else {
        value = view.getUint8(cursor)
      }

      pixels[to] = ((value >>> format.redShift) & format.redMax) * redScale
      pixels[to + 1] = ((value >>> format.greenShift) & format.greenMax) * greenScale
      pixels[to + 2] = ((value >>> format.blueShift) & format.blueMax) * blueScale
      pixels[to + 3] = 255
      cursor += step
      to += 4
    }
  }

  return cursor - at
}

/** CopyRect inside the pixel array we already hold. Goes through a staging copy
 *  because source and destination MAY overlap — scrolling is exactly that — and
 *  a naive in-place copy smears the rows it is about to read. */
function copyRectRegion(pixels, stride, region) {
  const { destX, destY, height, sourceX, sourceY, width } = region
  const staging = new Uint8ClampedArray(width * height * 4)

  for (let row = 0; row < height; row += 1) {
    const from = (sourceY + row) * stride + sourceX * 4

    staging.set(pixels.subarray(from, from + width * 4), row * width * 4)
  }

  for (let row = 0; row < height; row += 1) {
    pixels.set(staging.subarray(row * width * 4, (row + 1) * width * 4), (destY + row) * stride + destX * 4)
  }
}

/** ServerInit: u16 width, u16 height, 16-byte pixel format, u32 name length. */
function parseServerInit(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 24)

  return {
    format: parseRfbFormat(bytes, 4),
    height: view.getUint16(2),
    nameLength: view.getUint32(20),
    width: view.getUint16(0)
  }
}

/** Is this 4-byte head a plausible ServerInit (width + height)? Used for the
 *  one ambiguity in the handshake: after a security type of None some servers
 *  send SecurityResult and some go straight to ServerInit, and a real desktop
 *  never has a zero width or height. Testing the bytes beats a version table. */
function looksLikeServerInit(head) {
  const view = new DataView(head.buffer, head.byteOffset, 4)
  const width = view.getUint16(0)
  const height = view.getUint16(2)

  return width > 0 && height > 0 && width <= 32767 && height <= 32767
}

/** The wire pump. Feed it bytes; it drives the handshake, decodes frames into
 *  the pixel array the caller owns, and asks for exactly one update at a time.
 *
 *  `onSize({width, height})` must return the pixel array to draw into (the
 *  canvas' `ImageData.data`); `onFramebuffer({rects})` is the caller's cue to
 *  paint, after which it calls `ack()` — the backpressure pair. `send(bytes)`
 *  pushes to the socket. */
function createRfbStream({ onFramebuffer, onNote, onSize, send }) {
  const stream = {
    ack,
    feed,
    note: '',
    pixels: null,
    sent: 0,
    size: { height: 0, width: 0 },
    state: 'version'
  }
  const requested = rfbRequestedFormat()
  let buffer = new Uint8Array(0)
  let format = requested
  let width = 0
  let height = 0
  let awaiting = false
  let pendingRects = 0
  let rectsThisFrame = []
  let drewThisFrame = false

  function append(chunk) {
    const next = new Uint8Array(buffer.length + chunk.length)

    next.set(buffer)
    next.set(chunk, buffer.length)
    buffer = next
  }

  function take(count) {
    const slice = buffer.slice(0, count)

    buffer = buffer.slice(count)

    return slice
  }

  function fail(note) {
    stream.state = 'dead'
    stream.note = note
    onNote?.(note)
  }

  function push(bytes) {
    stream.sent += 1
    send(bytes)
  }

  function requestFrame(incremental) {
    if (stream.state !== 'ready' || awaiting) {
      return
    }

    awaiting = true
    push(rfbUpdateRequest({ height, width, x: 0, y: 0 }, incremental))
  }

  /** Called by the caller once the emitted frame is PAINTED. This, not a timer,
   *  is what asks for the next update — the whole backpressure story. */
  function ack() {
    awaiting = false
    requestFrame(true)
  }

  /** One handshake step. Returns false when more bytes are needed. */
  function stepHandshake() {
    if (stream.state === 'version') {
      if (buffer.length < 12) {
        return false
      }

      const greeting = String.fromCharCode(...take(12))

      if (!greeting.startsWith('RFB 003.')) {
        fail('the view sent something that is not RFB')

        return false
      }

      const minor = Number(greeting.slice(8, 11)) || 8

      stream.minor = minor

      if (minor < 7) {
        // A 3.3 screen decides the security type itself and expects ClientInit
        // where a 3.7+ client sends its choice — 13 handshake bytes, against
        // the 14 `RfbClientFilter` counts. There is no honest way to splice it,
        // so say that instead of hanging on a socket that will never answer.
        fail(`this screen speaks RFB 3.${minor}, and the gateway bridge splices 3.8 only`)

        return false
      }

      push(new TextEncoder().encode(RFB_VERSION_REPLY_38))
      stream.state = 'security'

      return true
    }

    if (stream.state === 'security') {
      if (buffer.length < 1) {
        return false
      }

      const count = take(1)[0]

      if (count === 0) {
        if (buffer.length < 4) {
          return false
        }

        const length = new DataView(take(4).buffer).getUint32(0)

        if (buffer.length < length) {
          return false
        }

        fail(`the screen refused the view: ${String.fromCharCode(...take(length)).trim()}`)

        return false
      }

      if (buffer.length < count) {
        return false
      }

      const types = Array.from(take(count))

      if (!types.includes(RFB_SECURITY_NONE)) {
        fail('the screen asks for authentication this pane cannot supply')

        return false
      }

      push(new Uint8Array([RFB_SECURITY_NONE]))
      stream.state = 'securityResult'

      return true
    }

    if (stream.state === 'securityResult') {
      if (buffer.length < 4) {
        return false
      }

      const head = buffer.slice(0, 4)
      const result = new DataView(head.buffer, head.byteOffset, 4).getUint32(0)
      // A server that sends no SecurityResult goes straight to ServerInit, whose
      // first four bytes are width+height — and a real desktop is never 0×0.
      const withoutResult = result !== 0 && looksLikeServerInit(head)

      if (result !== 0 && !withoutResult) {
        fail('the screen refused the view')

        return false
      }

      if (!withoutResult) {
        take(4)
      }

      // ClientInit, ALWAYS, and before we wait for ServerInit: the server will
      // not send one until it has this byte, and the bridge's filter has already
      // budgeted for it (12 + 1 + 1 handshake bytes).
      push(RFB_CLIENT_INIT)
      stream.state = 'init'

      return true
    }

    if (stream.state === 'init') {
      if (buffer.length < 24) {
        return false
      }

      const init = parseServerInit(buffer)

      if (buffer.length < 24 + init.nameLength) {
        return false
      }

      take(24 + init.nameLength)
      width = init.width
      height = init.height
      format = init.format
      stream.size = { height, width }
      stream.pixels = onSize?.({ height, width }) || null
      push(rfbSetPixelFormat(requested))
      push(rfbSetEncodings([RFB_ENCODING_RAW, RFB_ENCODING_COPY_RECT]))
      stream.state = 'ready'
      requestFrame(false)

      return true
    }

    return false
  }

  /** One rectangle of the message already being read. Consumes from `buffer`
   *  only once the WHOLE rect is here: a half-decoded rectangle cannot be
   *  replayed later, and eating its header twice would desync the stream. */
  function stepRect() {
    if (buffer.length < 12) {
      return false
    }

    const head = new DataView(buffer.buffer, buffer.byteOffset, 12)
    const x = head.getUint16(0)
    const y = head.getUint16(2)
    const rectWidth = head.getUint16(4)
    const rectHeight = head.getUint16(6)
    const encoding = head.getInt32(8)

    if (encoding === RFB_ENCODING_RAW) {
      const needed = 12 + rectWidth * rectHeight * Math.max(1, Math.ceil(format.bpp / 8))

      if (buffer.length < needed) {
        return false
      }

      const message = take(needed)

      if (stream.pixels) {
        decodeRawRect(message, 12, format, stream.pixels, y * width * 4 + x * 4, rectWidth, rectHeight, width * 4)
      }

      rectsThisFrame.push({ height: rectHeight, width: rectWidth, x, y })
      drewThisFrame = true

      return true
    }

    if (encoding === RFB_ENCODING_COPY_RECT) {
      if (buffer.length < 16) {
        return false
      }

      const tail = new DataView(buffer.buffer, buffer.byteOffset + 12, 4)

      if (stream.pixels) {
        copyRectRegion(stream.pixels, width * 4, {
          destX: x,
          destY: y,
          height: rectHeight,
          sourceX: tail.getUint16(0),
          sourceY: tail.getUint16(2),
          width: rectWidth
        })
      }

      take(16)
      rectsThisFrame.push({ height: rectHeight, width: rectWidth, x, y })
      drewThisFrame = true

      return true
    }

    if (encoding === RFB_DESKTOP_SIZE) {
      // An unprompted resize: the new width/height ride x/y and the rect itself
      // is empty. Re-allocating the pixel array here is what keeps every later
      // rectangle aligned — the only other honest option is to drop the view.
      take(12)
      width = x || width
      height = y || height
      stream.size = { height, width }
      stream.pixels = onSize?.({ height, width }) || stream.pixels

      return true
    }

    fail(`the screen sent encoding ${encoding}, which this viewer does not speak`)

    return false
  }

  /** One server message. `pendingRects` carries a partially-read
   *  FramebufferUpdate across feeds: a frame arrives in many WebSocket chunks,
   *  and its rect count must not be re-read when the next chunk lands. */
  function stepMessage() {
    if (pendingRects) {
      while (pendingRects > 0) {
        if (!stepRect()) {
          return false
        }

        pendingRects -= 1
      }

      if (drewThisFrame) {
        onFramebuffer?.({ rects: rectsThisFrame, height, width })
      }

      rectsThisFrame = []
      drewThisFrame = false

      return true
    }

    const type = buffer[0]

    if (type === 0) {
      if (buffer.length < 4) {
        return false
      }

      pendingRects = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint16(2)
      take(4)

      if (!pendingRects) {
        return true
      }

      return stepMessage()
    }

    if (type === 1) {
      if (buffer.length < 6) {
        return false
      }

      const count = new DataView(buffer.buffer, buffer.byteOffset, 6).getUint16(4)

      if (buffer.length < 6 + count * 6) {
        return false
      }

      take(6 + count * 6)

      return true
    }

    if (type === 2) {
      take(1)

      return true
    }

    if (type === 3) {
      if (buffer.length < 8) {
        return false
      }

      const length = new DataView(buffer.buffer, buffer.byteOffset, 8).getUint32(4)

      if (length > RFB_CUT_TEXT_MAX) {
        fail('the screen sent a clipboard payload larger than this viewer accepts')

        return false
      }

      if (buffer.length < 8 + length) {
        return false
      }

      take(8 + length)

      return true
    }

    fail(`the screen sent message type ${type}, which this viewer does not speak`)

    return false
  }

  function pump() {
    while (stream.state !== 'dead') {
      if (stream.state !== 'ready') {
        if (!stepHandshake()) {
          return
        }

        continue
      }

      if (!buffer.length) {
        return
      }

      const before = buffer.length

      if (!stepMessage()) {
        return
      }

      if (buffer.length === before) {
        return
      }
    }
  }

  function feed(chunk) {
    if (stream.state === 'dead') {
      return
    }

    append(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
    pump()
  }

  return stream
}

/* ── SCREEN: verbs, lease and the live session ─────────────────────────────── */

/** What this profile's screen offers, from one `display.status` snapshot. Pure,
 *  so the harness can pin every tone without a gateway. */
function screenVerbState(status, unavailable) {
  const supported = Boolean(status?.supported)
  const installed = Boolean(status?.installed)
  const running = Boolean(status?.running)

  return {
    blocker: String(status?.blocker || ''),
    canInstall: supported && !installed,
    canStart: installed && !running,
    canStop: running,
    installable: supported,
    running,
    tone: screenTone(status, unavailable || null)
  }
}

/** What a closed view socket means. `reobserve: true` is the retry that needs a
 *  FRESH ticket — the display ticket is single-use and dies in 30 s, so a
 *  reconnect without one is a guaranteed 4401 loop. */
function screenCloseVerdict(code, reason) {
  if (code === 4000) {
    return { mode: 'watch', note: 'control-taken', reobserve: true }
  }

  if (code === 4001) {
    return { mode: 'stopped', note: 'the screen stopped', reobserve: false }
  }

  if (code === 4401) {
    return { mode: 'connecting', note: 'the view ticket expired', reobserve: true }
  }

  if (code === 4403) {
    return { mode: 'error', note: String(reason || '') || 'the gateway refused the view', reobserve: false }
  }

  if (code === 1003) {
    return { mode: 'error', note: 'the gateway refused a non-binary view', reobserve: false }
  }

  if (code === 1000 || code === 1001) {
    return { mode: 'idle', note: '', reobserve: false }
  }

  return { mode: 'error', note: String(reason || '') || `the view closed (${code})`, reobserve: false }
}

/** Does THIS window hold the lease? The gateway names the holder by hash only
 *  (the raw viewer id is a capability and never travels), so a human lease
 *  whose hash is not ours belongs to somebody else. */
function leaseHeldBy(lease, hash) {
  return Boolean(lease && lease.holder === 'human' && hash && lease.viewer_hash === hash)
}

/** `viewer_hash` the way the lease broadcasts it: the first 12 hex digits of
 *  sha256(viewer_id). The same shape Bot Mode computes, for the same reason. */
async function viewerHashOf(viewerId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(viewerId || '')))

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

/** The RFB socket URL for a profile, ticket and all. `resolveSiblingWsUrl`
 *  rides the same authenticated origin as the chat socket; the gateway's own
 *  `?ticket=` is stripped because the display bridge authenticates on its OWN
 *  single-use ticket (spending one credential twice is how a view 401s). */
async function screenSocketUrl(profile, ticket) {
  const base = await resolveSiblingWsUrl({ profile }, '/api/display/ws', { stripGatewayCredential: true })

  return `${base}${base.includes('?') ? '&' : '?'}display_ticket=${encodeURIComponent(ticket)}`
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
    queryKey: ['personae', 'screen', profile],
    queryFn: () => host.request('display.status', { profile }),
    refetchInterval: 15000,
    retry: false,
    staleTime: 5000
  })
  const tone = screenTone(status.data || null, displayMissing(status.error))
  const live = tone === 'live' || tone === 'other'
  const frame = useQuery({
    queryKey: ['personae', 'screen-frame', profile],
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

/** The Screen viewer this plugin offers: the same profile's Bot Desktop, live
 *  and drivable, in its own workspace tab. Each pane owns its own lease holder,
 *  so two tabs of this pane are two viewers — and taking over in one evicts the
 *  other, which is exactly what `display.lease` reports (Pedro, 2026-10-15:
 *  "make Personae able to START/STOP/TAKE OVER the screen itself"). */
const screenTabs = new Map()

/** Where "back" goes, from the app's own focus atoms. The DURABLE id is the one
 *  `openSession` takes — `activeSessionId` is a runtime id, and a runtime id
 *  handed back to a reopen resolves to nothing. Pure, so the harness pins the
 *  precedence instead of leaving it to reading order. */
function screenBackTarget(state, fallbackProfile) {
  const id = String(state?.focusedStoredSessionId || state?.activeSessionId || '').trim()

  if (!id) {
    return null
  }

  return { id, profile: String(state?.focusedSessionProfile || fallbackProfile || '') }
}

/** Front the session the user was reading when they opened this tab. A tab that
 *  takes the chat area must not be a one-way door (Pedro, 2026-10-16: "I didn't
 *  really have a way to come back to this chat"). */
function screenBackToSession(target) {
  if (!target?.id || typeof host.openSession !== 'function') {
    return false
  }

  host.openSession(target.id, target.profile ? { profile: target.profile } : {})

  return true
}

/** Close this profile's Screen tab from inside the pane — the same teardown the
 *  tab strip's ✕ and ⌘W run (the disposer `openWorkspace` returned). */
function closeScreenPane(profile) {
  const entry = screenTabs.get(profile)

  if (!entry) {
    return false
  }

  entry.close()

  return true
}

function openScreenPane(profile, label) {
  if (typeof host.openWorkspace !== 'function') {
    return
  }

  if (screenTabs.has(profile)) {
    host.revealPane(`plugin-workspace:${ID}:screen:${profile}`)

    return
  }

  // Captured at the CLICK, before the tab fronts: whatever was focused then is
  // the surface the user is giving up, and it is the only honest answer to
  // "back to where?".
  const back = screenBackTarget(
    {
      activeSessionId: host.state?.activeSessionId?.get?.() || null,
      focusedSessionProfile: host.state?.focusedSessionProfile?.get?.() || '',
      focusedStoredSessionId: host.state?.focusedStoredSessionId?.get?.() || null
    },
    profile
  )

  const close = host.openWorkspace(`${ID}:screen:${profile}`, {
    title: `${profile} · ${label}`,
    minWidth: '28rem',
    onClose: () => screenTabs.delete(profile),
    render: () => jsx(ScreenView, { back, onClose: () => closeScreenPane(profile), profile })
  })

  screenTabs.set(profile, { back, close })
}

/* ── SCREEN: the pane ──────────────────────────────────────────────────────── */

/** The install stream, as MODULE state. A package manager runs for minutes and
 *  the events arrive whatever the pane is doing, so the log lives outside React
 *  and the pane simply reads it — losing the log because the tab closed would be
 *  a lie about what happened on the host. */
const $screenInstall = atom({ lines: [], running: false })

function resetScreenInstall() {
  $screenInstall.set({ lines: [], running: false })
}

function noteScreenInstallLog(payload) {
  const state = $screenInstall.get()

  $screenInstall.set({ lines: [...state.lines, { text: String(payload?.line || '') }].slice(-80), running: true })
}

function noteScreenInstallDone(payload) {
  const state = $screenInstall.get()

  $screenInstall.set({
    lines: [...state.lines, { key: Number(payload?.code) ? 'screenInstallFailed' : 'screenInstallDone' }].slice(-80),
    running: false
  })
}

/** Stopping a screen a HUMAN holds is a QUESTION, not a verb: the gateway
 *  refuses the polite stop while any human holds the lease, so the pane has to
 *  ask and then `force` it. Returns the i18n key of the question, or '' when a
 *  plain Stop is enough — and which human holds only changes the WORDING, never
 *  whether the question is asked. (Asking only about somebody ELSE is how the
 *  pane offered Pedro a stop that the server could not honour: HE held the
 *  lease, so the polite stop was refused and no force path was offered.) */
function screenStopQuestion(status, hash) {
  const lease = status?.lease || null

  if (lease?.holder !== 'human') {
    return ''
  }

  return leaseHeldBy(lease, hash) ? 'screenStopForceSelf' : 'screenStopForce'
}

/** One mounted Screen pane's live state. Held in a ref, never in React state:
 *  the RFB pump and its socket must survive every re-render untouched. */
function createScreenSession() {
  return {
    attaching: false,
    closing: false,
    frames: 0,
    hash: '',
    held: new Set(),
    image: null,
    retries: 0,
    socket: null,
    stream: null,
    viewerId: ''
  }
}

function screenSend(session, bytes) {
  try {
    session?.socket?.send?.(bytes)
  } catch {
    // A dying socket drops the keystroke, never the pane: the close handler is
    // what repaints, and there is nobody to catch an exception for here.
    return false
  }

  return true
}

/** A new ImageData for a framebuffer size, and the array the decoder writes
 *  into. Returns null when there is no canvas yet — the caller treats that as
 *  "decode nothing, still keep the stream aligned". */
function allocateCanvas(canvas, session, size) {
  const context = canvas?.getContext?.('2d')

  if (!context || !size?.width || !size?.height) {
    session.image = null

    return null
  }

  canvas.width = size.width
  canvas.height = size.height
  session.image = context.createImageData(size.width, size.height)

  return session.image.data
}

/** Paint the rectangles of one update and ACK it — the ack is what asks for the
 *  next update, so a pane that paints slowly also receives slowly instead of
 *  queueing frames it will never draw. */
function paintScreenFrame(canvas, session, frame) {
  const context = canvas?.getContext?.('2d')

  if (context && session.image && frame?.rects?.length) {
    const left = Math.max(0, Math.min(...frame.rects.map(rect => rect.x)))
    const top = Math.max(0, Math.min(...frame.rects.map(rect => rect.y)))
    const right = Math.min(session.image.width, Math.max(...frame.rects.map(rect => rect.x + rect.width)))
    const bottom = Math.min(session.image.height, Math.max(...frame.rects.map(rect => rect.y + rect.height)))

    if (right > left && bottom > top) {
      context.putImageData(session.image, 0, 0, left, top, right - left, bottom - top)
    }
  }

  session.frames += 1
  session.stream?.ack()
}

/** Push every held key back up before losing the socket or the lease: a keydown
 *  we forwarded and never released holds that key down on the bot's keyboard
 *  until something else presses it. */
function releaseHeldKeys(session) {
  if (!session?.held?.size) {
    return 0
  }

  const count = session.held.size

  session.held.forEach(keysym => screenSend(session, rfbKeyMessage(false, keysym)))
  session.held.clear()

  return count
}

function detachScreen(session, onNote) {
  if (!session) {
    return
  }

  releaseHeldKeys(session)
  session.closing = true
  session.attaching = false

  try {
    session.socket?.close?.(1000, 'pane closed')
  } catch {
    session.socket = null
  }

  session.socket = null
  session.stream = null
  session.image = null
  onNote?.({ controlling: false, mode: 'idle', note: '', watching: false })
}

/** Mint a ticket, open the RFB socket and start the pump. Resolves with the
 *  session either way — a refused view is a NOTE, not a rejected promise the
 *  caller has to remember to catch. */
async function attachScreen(session, api) {
  if (session.attaching || session.socket) {
    return session
  }

  session.attaching = true
  api.patch({ mode: 'connecting', note: '' })

  try {
    const observed = await host.request('display.observe', { profile: api.profile })

    session.viewerId = String(observed?.viewer_id || '')
    session.hash = await viewerHashOf(session.viewerId)

    const socket = new WebSocket(await screenSocketUrl(api.profile, observed?.ticket))

    socket.binaryType = 'arraybuffer'
    session.socket = socket
    session.stream = createRfbStream({
      onFramebuffer: frame => paintScreenFrame(api.canvas(), session, frame),
      onNote: note => {
        // A protocol failure is a settled answer, not a blip: say it, and close
        // the socket WITHOUT letting the close handler repaint over the reason.
        session.attaching = false
        session.failed = true
        api.patch({ mode: 'error', note })

        try {
          session.socket?.close?.(1000, 'view failed')
        } catch {
          session.socket = null
        }
      },
      onSize: size => allocateCanvas(api.canvas(), session, size),
      send: bytes => screenSend(session, bytes)
    })

    socket.onmessage = event => session.stream?.feed(new Uint8Array(event.data))
    socket.onerror = () => session.attaching = false
    socket.onclose = event => {
      const verdict = screenCloseVerdict(event?.code, event?.reason)
      // A close WE caused — the pane unmounting, the profile switching, a view
      // that already reported its own failure — must not repaint the pane with
      // a verdict about a socket the user never saw.
      const deliberate = session.closing || session.failed

      session.attaching = false
      session.closing = false
      session.failed = false
      session.socket = null
      session.stream = null
      releaseHeldKeys(session)

      if (deliberate) {
        return
      }

      api.patch({
        controlling: false,
        mode: verdict.mode,
        note: verdict.note === 'control-taken' ? 'control-taken' : verdict.note,
        watching: false
      })

      // A single-use ticket expires in 30 s, so a reconnect that needs one has
      // to mint a new one; two attempts, then the pane stops retrying and says
      // what happened instead of looping in the dark.
      if (verdict.reobserve && session.retries < 2) {
        session.retries += 1
        setTimeout(() => attachScreen(session, api), 400)
      }
    }

    session.retries = 0
    api.patch({ mode: 'watching', note: '', watching: true })
  } catch (error) {
    session.attaching = false
    session.socket = null
    session.stream = null
    api.patch({ mode: 'error', note: String(error?.message || error || 'the view could not be opened') })
  }

  return session
}

async function screenLease(session, api, action) {
  // Each verb sends EXACTLY its own fields. Params models are `extra="forbid"`
  // and the dispatcher answers 4000 for an unknown key (`contracts/registry.py`
  // `validate_params`), and `reason` belongs to ACQUIRE only — release takes
  // `viewer_id`/`force`. One shared param object is how a working Take over sits
  // beside a Hand back that never leaves the client.
  const params =
    action === 'take'
      ? { profile: api.profile, reason: 'Personae', viewer_id: session.viewerId }
      : { profile: api.profile, viewer_id: session.viewerId }

  const result = await host.request(action === 'take' ? 'display.lease.acquire' : 'display.lease.release', params)

  if (action === 'take') {
    return leaseHeldBy(result?.lease, session.hash)
  }

  releaseHeldKeys(session)

  return false
}

/** The params `display.stop` takes: `force` and the profile, nothing else (the
 *  same `extra="forbid"` wire that turned a shared `reason` into a 4000 on
 *  release). Pure, so the harness pins the key set. */
function screenStopParams(profile, force) {
  return { force: Boolean(force), profile }
}

/** One key event from the canvas. Forwarded ONLY while this window holds the
 *  lease — the bridge drops input from everyone else anyway, so sending it
 *  would only lie to the user about who is typing. */
function forwardKey(session, event, down) {
  const keysyms = keysymsForEvent(event, down)

  if (!keysyms.length) {
    return false
  }

  event.preventDefault()
  keysyms.forEach(keysym => {
    if (down) {
      session.held.add(keysym)
    } else {
      session.held.delete(keysym)
    }

    screenSend(session, rfbKeyMessage(down, keysym))
  })

  return true
}

/** A pointer position in framebuffer coordinates, from a DOM event on a scaled
 *  canvas. The canvas is CSS-scaled to the pane's width, so the ratio is what
 *  maps a click to the pixel the bot sees. */
function screenPointer(session, canvas, event) {
  const rect = canvas?.getBoundingClientRect?.()

  if (!rect?.width || !session.image) {
    return null
  }

  return {
    mask: pointerMaskFor(event.buttons),
    x: Math.max(0, Math.min(session.image.width - 1, Math.round(((event.clientX - rect.left) / rect.width) * session.image.width))),
    y: Math.max(0, Math.min(session.image.height - 1, Math.round(((event.clientY - rect.top) / rect.height) * session.image.height)))
  }
}

/** The Screen tab, in full: what this profile's screen IS, the verbs that change
 *  it, and the live view you can drive. */
function ScreenView({ back, onClose, profile }) {
  const t = usePluginI18n(ID)
  const canvasRef = useRef(null)
  const sessionRef = useRef(null)
  const apiRef = useRef(null)
  const [view, setView] = useState({ controlling: false, mode: 'idle', note: '', watching: false })
  const [busy, setBusy] = useState('')
  const [confirmStop, setConfirmStop] = useState(false)
  const installState = useValue($screenInstall)

  apiRef.current = {
    canvas: () => canvasRef.current,
    patch: changes => setView(previous => ({ ...previous, ...changes })),
    profile
  }

  if (!sessionRef.current) {
    sessionRef.current = createScreenSession()
  }

  const session = sessionRef.current
  const statusKey = ['personae', 'screen', profile]
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => host.request('display.status', { profile }),
    refetchInterval: 15000,
    retry: false,
    staleTime: 5000
  })
  const verbs = screenVerbState(status.data || null, displayMissing(status.error))
  const lease = status.data?.lease || null
  const stopQuestion = screenStopQuestion(status.data, session.hash)
  const report = (error, fallback) => {
    const note = String(error?.message || error || fallback || '')

    apiRef.current.patch({ mode: 'error', note: note || fallback })

    return note
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusKey })

  // The gateway is the authority on who holds the lease: the event only says
  // SOMETHING changed (its payload names a profile home key, not a profile), so
  // it triggers a refetch and `display.status` decides.
  useEffect(() => {
    const offLease = host.onEvent?.('display.lease', refresh)

    return () => offLease?.()
  }, [profile])

  useEffect(() => {
    if (!lease) {
      return
    }

    setView(previous => {
      if (!previous.controlling || leaseHeldBy(lease, session.hash)) {
        return previous
      }

      return {
        ...previous,
        controlling: false,
        mode: previous.mode === 'error' ? previous.mode : 'watch',
        note: lease.holder === 'human' ? 'control-taken' : ''
      }
    })
  }, [lease?.epoch, lease?.holder, lease?.viewer_hash])

  // Running ⇒ the pane watches by itself. That is the whole point of a Screen
  // tab: opening it should not still need a click before anything is visible.
  useEffect(() => {
    if (verbs.running) {
      attachScreen(session, apiRef.current)
    } else {
      detachScreen(session, apiRef.current.patch)
    }
  }, [verbs.running, profile])

  useEffect(() => () => detachScreen(session, () => undefined), [])

  useEffect(() => {
    const offLog = host.onEvent?.('display.install.log', noteScreenInstallLog)
    const offDone = host.onEvent?.('display.install.done', payload => {
      noteScreenInstallDone(payload)
      refresh()
    })

    return () => {
      offLog?.()
      offDone?.()
    }
  }, [profile])

  const run = async (verb, work) => {
    setBusy(verb)

    try {
      await work()
    } catch (error) {
      report(error, t('screenFailed'))
    } finally {
      setBusy('')
    }
  }

  const start = () => run('start', async () => {
    await host.request('display.start', { profile })
    refresh()
  })

  const stop = force => run('stop', async () => {
    setConfirmStop(false)
    await host.request('display.stop', screenStopParams(profile, force))
    refresh()
  })

  const install = () => run('install', async () => {
    resetScreenInstall()
    $screenInstall.set({ lines: [], running: true })
    await host.request('display.install', { profile })
  })

  const takeOver = () => run('take', async () => {
    await attachScreen(session, apiRef.current)
    const held = await screenLease(session, apiRef.current, 'take')

    apiRef.current.patch({ controlling: held, mode: 'watch', note: '' })
    canvasRef.current?.focus?.()
    refresh()
  })

  const handBack = () => run('hand', async () => {
    await screenLease(session, apiRef.current, 'release')
    apiRef.current.patch({ controlling: false, mode: 'watch', note: '' })
    refresh()
  })

  const button = (key, label, onClick, options = {}) => {
    const content = busy === key ? t('screenWorking') : label
    const props = {
      disabled: Boolean(busy) || Boolean(options.disabled),
      onClick,
      size: 'sm',
      variant: options.variant || 'ghost'
    }

    // An icon row is TWO static children, which is `jsxs` — `jsx` with an array
    // makes React warn about static children on every render of the pane.
    if (options.icon) {
      return jsxs(
        Button,
        { ...props, children: [jsx(Codicon, { name: options.icon }, 'icon'), jsx('span', { children: content }, 'label')] },
        key
      )
    }

    return jsx(Button, { ...props, children: content }, key)
  }

  const note =
    view.note === 'control-taken'
      ? t('screenTaken')
      : view.note === 'the screen stopped'
        ? t('screenOff')
        : view.note

  return jsxs('div', {
    className: 'grid min-w-0 grid-cols-1 gap-3 p-4',
    children: [
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center gap-2',
        children: [
          // Leaving is a control in the pane, not only the strip's ✕: this tab
          // takes the chat area, so it carries its own way out and its own way
          // back to the session it displaced.
          back ? button('back', t('screenBack'), () => screenBackToSession(back), { icon: 'arrow-left' }) : null,
          jsx('span', { className: 'text-sm font-semibold', children: profile }, 'name'),
          jsx('span', {
            className: 'min-w-0 flex-1 truncate text-xs text-(--ui-text-tertiary)',
            children: view.controlling ? t('screenDriving') : t(screenCaptionKey(verbs.tone)) + (verbs.running ? ` · ${status.data?.geometry || ''}` : '')
          }, 'caption'),
          button('take', t('screenTakeOver'), takeOver, { disabled: !verbs.running || view.controlling }),
          view.controlling ? button('hand', t('screenHandBack'), handBack) : null,
          onClose ? button('close-screen', t('close'), onClose, { icon: 'close' }) : null
        ]
      }),
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center gap-1.5',
        children: [
          verbs.canStart ? button('start', t('screenStart'), start, { disabled: Boolean(verbs.blocker), variant: 'default' }) : null,
          verbs.canStop ? button('stop', t('screenStop'), () => (stopQuestion ? setConfirmStop(true) : stop(false)), { variant: 'destructive' }) : null,
          verbs.canInstall ? button('install', t('screenInstall'), install, { variant: 'default' }) : null,
          view.mode === 'error' || view.mode === 'stopped'
            ? button('retry', t('screenReconnect'), () => run('retry', async () => attachScreen(session, apiRef.current)))
            : null
        ]
      }),
      confirmStop
        ? jsxs('div', {
            className:
              'flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1.5',
            children: [
              jsx('span', {
                className: 'min-w-0 truncate text-[0.6875rem] text-(--ui-text-tertiary)',
                children: t(stopQuestion || 'screenStopForce')
              }, 'ask'),
              jsxs('div', {
                className: 'flex items-center gap-0.5',
                children: [
                  jsx(Button, { onClick: () => setConfirmStop(false), size: 'sm', variant: 'ghost', children: t('cancel') }, 'cancel'),
                  jsx(Button, { onClick: () => stop(true), size: 'sm', variant: 'destructive', children: t('screenStop') }, 'force')
                ]
              }, 'verbs')
            ]
          }, 'confirm-stop')
        : null,
      verbs.blocker
        ? jsx('div', {
            className: 'rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
            children: verbs.blocker
          }, 'blocker')
        : null,
      jsxs('div', {
        className: 'relative min-w-0 overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-black',
        children: [
          jsx('canvas', {
            'data-personae-screen': view.mode,
            onBlur: () => releaseHeldKeys(session),
            onKeyDown: event => view.controlling && forwardKey(session, event, true),
            onKeyUp: event => view.controlling && forwardKey(session, event, false),
            onPointerDown: event => {
              if (view.controlling) {
                const at = screenPointer(session, canvasRef.current, event)

                if (at) {
                  screenSend(session, rfbPointerMessage(at.mask, at.x, at.y))
                }
              }
            },
            onPointerMove: event => {
              if (view.controlling && event.buttons) {
                const at = screenPointer(session, canvasRef.current, event)

                if (at) {
                  screenSend(session, rfbPointerMessage(at.mask, at.x, at.y))
                }
              }
            },
            onPointerUp: event => {
              if (view.controlling) {
                const at = screenPointer(session, canvasRef.current, event)

                if (at) {
                  screenSend(session, rfbPointerMessage(at.mask, at.x, at.y))
                }
              }
            },
            onWheel: event => {
              const mask = wheelMaskFor(event.deltaY)

              if (!view.controlling || !mask) {
                return
              }

              event.preventDefault()
              const at = screenPointer(session, canvasRef.current, event)

              if (at) {
                screenSend(session, rfbPointerMessage(at.mask | mask, at.x, at.y))
                screenSend(session, rfbPointerMessage(at.mask, at.x, at.y))
              }
            },
            ref: canvasRef,
            style: { display: 'block', height: 'auto', width: '100%' },
            tabIndex: 0
          }, 'canvas'),
          view.watching
            ? null
            : jsx('span', {
                className:
                  'pointer-events-none absolute inset-0 grid place-items-center px-3 text-center text-xs text-white/70',
                children: t(verbs.running ? 'screenConnecting' : 'screenNotRunning')
              }, 'overlay')
        ]
      }, 'stage'),
      installState.running || installState.lines.length
        ? jsxs('div', {
            className: 'grid min-w-0 grid-cols-1 gap-1 rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5',
            children: [
              jsx('span', {
                className: 'text-[0.6875rem] uppercase tracking-wider text-(--ui-text-quaternary)',
                children: t('screenInstallLog')
              }, 'label'),
              jsx('div', {
                className: 'max-h-40 overflow-y-auto font-mono text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)',
                children: installState.lines.map((line, index) =>
                  jsx('div', { children: line.key ? t(line.key) : line.text || ' ' }, `line-${index}`)
                )
              }, 'lines')
            ]
          }, 'install')
        : null,
      jsxs('div', {
        className: 'text-xs text-(--ui-text-quaternary)',
        children: [
          note ? jsx('span', { children: note }, 'note') : null,
          note ? jsx('span', { children: ' · ' }, 'dot') : null,
          jsx('span', {
            children: view.controlling ? t('screenHintDriving') : t('screenHintWatch')
          }, 'hint')
        ]
      }, 'foot')
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
    queryKey: ['personae', 'routines', epoch, names.join('|')],
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

/** The drill-down's own filter: the fields the ROW shows, so typing what you
 *  can read finds the row you can see. */
function listMatch(session, needle) {
  return [sessionLabel(session), session?.preview, session?.id, session?.source].some(value =>
    String(value || '').toLowerCase().includes(needle)
  )
}

/** P7 drill-down (Pedro's D-A): the pane body IS replaced by one profile's
 *  session list — "View all" (every session it has), "View Archived", "View
 *  hidden" (the pane's own store) or "View matches" (one search's hits, opened
 *  from a row's `${extra} more`) — with a back button. Deliberately NOT a
 *  workspace tab: the roster stays one click away. "View all" needs no backend
 *  (`session.list` takes the limit); the other two come from the pane's own
 *  backend reads.
 *
 *  1.4.0: it is also a LIST the user can work on — multiselect with the same
 *  batch bar as the roster (Pedro, 2026-10-16: "In 'View Archived', allow the
 *  user to multiselect"), and a filter of its own, because this is where the
 *  hundreds of old sessions actually live. */
function SessionListView({
  editingSession,
  kind,
  nowMs,
  onArchiveUpTo,
  onBack,
  onCreateAproposGroup,
  onMoveGroup,
  onNewGroup,
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
  // `${extra} more` on a roster row opens THIS list on the same needle: the
  // profile's hit list in full, where the roster only ever drew the first few.
  // The query is PINNED into `$listView` by whoever opened it, so clearing the
  // search box afterwards cannot empty this screen.
  const searchKind = kind === 'search'
  const needle = String(useValue($listView)?.query || '').trim().toLowerCase()
  const hiddenState = useValue($hiddenSessions)
  const hiddenIds = new Set((hiddenState[String(profile)] || []).map(String))
  // Which group each drawn row belongs to. Without this the row cannot say what
  // it is filed under, and "Move to group" has nothing to list — the menu was
  // drawn on this screen before it could act on it.
  const groupState = useValue($sessionGroups)
  const groupSlice = profileSessionGroups(groupState, profile)
  // One filter box for every kind: these pages run to hundreds of rows, and the
  // drill-down is where a user looks for something they can already name.
  const [filter, setFilter] = useState('')
  // P11 select mode, the same shape and the same verbs the roster has. The
  // drill-down is where a list of OLD sessions actually gets cleaned up, so
  // acting on them one right-click at a time was the whole complaint (Pedro,
  // 2026-10-16: "In 'View Archived', allow the user to multiselect").
  const [selecting, setSelecting] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState([])
  const [status, setStatus] = useState('')
  const [armedDelete, setArmedDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const listed = useQuery({
    // The search kind is keyed on the NEEDLE as well: two different keywords
    // are two different lists, and a cache key that ignored it would serve the
    // previous search's rows.
    queryKey: searchKind ? ['personae', 'view', kind, profile, needle] : ['personae', 'view', kind, profile],
    queryFn: () =>
      searchKind
        ? listSearchHits(profile, needle)
        : archived
          ? listArchivedSessions(profile)
          : hiddenKind
            ? listHiddenSessions(profile)
            : listAllSessions(profile),
    refetchInterval: archived || searchKind ? false : POLL_MS,
    retry: false,
    staleTime: 5000
  })
  const fetched = Array.isArray(listed.data) ? listed.data : []
  // `null` from the fetcher is the archive's "no backend" answer — distinct
  // from "[]" (a reachable archive with nothing in it).
  const unavailable = archived && !listed.isPending && listed.data === null
  const drawn = hiddenKind ? fetched.filter(session => hiddenIds.has(String(session?.id || ''))) : fetched
  const typed = filter.trim().toLowerCase()
  const sessions = typed ? drawn.filter(session => listMatch(session, typed)) : drawn
  // The batch resolves against what is ON SCREEN, local filter included: a tick
  // set resolved against a longer list is the one way a bulk verb reaches a row
  // the user cannot see (see menus-and-selection.md).
  const ticks = selectedSessions([{ name: profile, sessions }], selectedKeys)
  const batch = async (send, label) => {
    setBusy(true)

    const { done, failed } = await runOverSessions(ticks, send)

    setBusy(false)
    setArmedDelete(false)
    setStatus(failed ? `${done} ${label} · ${failed} ${t('failed')}` : `${done} ${label}`)
    setSelectedKeys([])
    await queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
    await queryClient.invalidateQueries({ queryKey: ['personae', 'view'] })
  }
  const runDelete = () => {
    if (!armedDelete) {
      setArmedDelete(true)
      setStatus(`${ticks.length} ${t('selected')} — ${t('delete')}?`)

      return undefined
    }

    return batch(deleteSessionEntry, t('deleted'))
  }
  const runApropos = async () => {
    setBusy(true)

    try {
      const made = await aproposSelection(ticks)

      setStatus(`${made} ${t('aproposMade')}`)
    } catch (error) {
      setStatus(t('failed'))
      host.notifyError?.(String(error?.message || error))
    }

    setBusy(false)
  }
  const leaveSelect = () => {
    setSelecting(false)
    setSelectedKeys([])
    setArmedDelete(false)
    setStatus('')
  }

  let body

  if (listed.isPending) {
    body = jsx(LoadingRows, {})
  } else if (unavailable) {
    body = jsx(EmptyState, { description: t('viewArchiveUnavailable'), title: t('viewArchived') })
  } else if (!sessions.length) {
    body = jsx(EmptyState, {
      description: typed
        ? t('viewFilterEmpty')
        : searchKind
          ? t('viewSearchEmpty')
          : archived
            ? t('viewArchivedEmpty')
            : hiddenKind
              ? t('viewHiddenEmpty')
              : t('viewAllEmpty'),
      title: searchKind ? t('viewSearch') : archived ? t('viewArchived') : hiddenKind ? t('viewHidden') : t('viewAll')
    })
  } else {
    body = jsx('div', {
      className: LIST_CLASS,
      children: sessions.map(session =>
        jsx(
          SessionRow,
          {
            // Group facts, from the SAME store the roster reads. `group` is the
            // box the row sits in; `aproposGroup` is what draws the diamond.
            aproposGroup: groupSlice.groups.some(
              entry =>
                entry.apropos === true && entry.id === groupSlice.members[String(session.id)]
            ),
            group: groupSlice.members[String(session.id)] || null,
            groups: groupSlice.groups,
            editing: Boolean(
              editingSession &&
                editingSession.profile === profile &&
                String(editingSession.id) === String(session.id)
            ),
            nowMs,
            // The bulk-archive cut travels with the row in here too: this list
            // is where the old sessions the user wants gone actually live.
            onArchiveUpTo,
            // The Group menu's three verbs. The Apropos one takes the TICK SET
            // when there is one (the right-click rule has already made the row
            // real), exactly like the roster's.
            onCreateAproposGroup: () =>
              onCreateAproposGroup(
                ticks.length
                  ? ticks
                  : [
                      {
                        profile,
                        session_id: String(session.id),
                        title: String(session.title || session.preview || session.id)
                      }
                    ]
              ),
            onMoveGroup: payload => onMoveGroup(profile, payload, selectedKeys),
            onNewGroup: () => onNewGroup(profile, [session.id]),
            onRename: onRenameSession,
            onRenameCancel,
            // The SESSION, not its id: renaming needs the live id too (see renameSession).
            onRenameSubmit: name => onRenameSubmit(profile, session, name),
            // Right-click makes the row the selection (never a mode change: the
            // menu is an explicit act, and entering a mode from it would put a
            // batch bar over a list the user only wanted one verb in).
            onRightClickSelect: key => setSelectedKeys(keys => clickSelect(keys, key)),
            onSelect: (name, storedId) => {
              setSelecting(true)
              setSelectedKeys([sessionKey(name, storedId)])
            },
            onToggleSelect: key => {
              const next = tickState(selectedKeys, key)

              setArmedDelete(false)
              setSelectedKeys(next.keys)
              setStatus('')

              // Unticking the LAST row is how select mode ends (the same rule
              // the roster follows — see tickState).
              if (next.empty) {
                setSelecting(false)
              }
            },
            profile,
            profileSessions: sessions,
            selected: (selectedKeys || []).includes(sessionKey(profile, session.id)),
            selecting,
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
                    children: searchKind
                      ? t('viewSearch')
                      : archived
                        ? t('viewArchived')
                        : hiddenKind
                          ? t('viewHidden')
                          : t('viewAll')
                  }),
                  jsx('span', {
                    className: 'min-w-0 truncate text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: searchKind ? `“${needle}” · ${profile}` : profile
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
              : null,
            sessions.length
              ? jsx(
                  Tip,
                  {
                    label: selecting ? t('selectOff') : t('selectOn'),
                    children: jsx(Button, {
                      'aria-label': t('select'),
                      'aria-pressed': selecting ? 'true' : 'false',
                      className: cn('shrink-0 rounded-md', selecting ? 'text-(--ui-accent)' : 'text-(--ui-text-tertiary)'),
                      onClick: () => (selecting ? leaveSelect() : setSelecting(true)),
                      size: 'icon-xs',
                      variant: 'ghost',
                      children: jsx(Codicon, { name: 'checklist' })
                    })
                  },
                  'view-select'
                )
              : null
          ]
        },
        'view-toolbar'
      ),
      jsxs(
        'div',
        {
          className: 'flex min-w-0 items-center gap-1 px-2.5 pb-1.5',
          children: [
            jsx(SearchField, {
              'aria-label': t('filterSessions'),
              containerClassName: cn('min-w-0 flex-1', filter ? 'opacity-100!' : 'opacity-50 focus-within:opacity-100'),
              inputClassName: 'w-full text-[0.75rem] placeholder:text-(--ui-text-tertiary)',
              onChange: setFilter,
              placeholder: t('filterSessions'),
              value: filter
            })
          ]
        },
        'view-filter'
      ),
      selecting
        ? jsx(
            SelectBar,
            {
              armed: armedDelete,
              busy,
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
                setSelectedKeys(allSessionKeys([{ name: profile, sessions }]))
              },
              status,
              t
            },
            'view-select-bar'
          )
        : null,
      body
    ]
  })
}

/** Where `${extra} more` goes: the drill-down for ONE profile's hits on ONE
 *  needle. Pure — the door is one line of wiring, the decision is testable. */
function moreHitsTarget(profile, query) {
  return { kind: 'search', profile: String(profile), query: String(query || '') }
}

/** The confirmation for a bulk archive cut. A component (not inline JSX) so the
 *  count it prints and the verbs it offers can be rendered and checked without
 *  a live click: this is the one verb in the pane that touches many sessions at
 *  once, and "how many, exactly?" is the question it exists to answer. */
function ArchiveCutBar({ count, onCancel, onRun, profile, busy, t }) {
  return jsxs(
    'div',
    {
      'data-archive-cut': `${profile}:${count}`,
      className:
        'mx-2.5 mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1.5',
      children: [
        jsx('span', {
          className: 'min-w-0 truncate text-[0.6875rem] text-(--ui-text-tertiary)',
          children: t('archiveUpToAsk', count)
        }, 'ask'),
        jsxs('div', {
          className: 'flex shrink-0 items-center gap-0.5',
          children: [
            jsx(Button, { onClick: onCancel, size: 'sm', variant: 'ghost', children: t('cancel') }, 'cancel'),
            // Ghost, never destructive: archiving is reversible and the row's
            // own Archive wears the same dress. The count is the safety, not a
            // colour.
            jsx(Button, { disabled: Boolean(busy), onClick: onRun, size: 'sm', variant: 'ghost', children: t('archive') }, 'run')
          ]
        }, 'actions')
      ]
    },
    'archive-cut'
  )
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

/** ── Files ─────────────────────────────────────────────────────────────────
 *  A read-only folder tree, docked beside Scheduled jobs. The listing comes from
 *  the pane's own backend (`/files`), because the files that matter are on the
 *  BACKEND's disk — the window may be on another machine entirely — and because a
 *  route we own can refuse to leave the home directory. Nothing here writes. */

/** Directories first, then names, case-insensitively: the order a tree is read
 *  in. Pure, so the harness can pin it without a filesystem. */
function sortFileEntries(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
    const left = a?.dir === true
    const right = b?.dir === true

    if (left !== right) {
      return left ? -1 : 1
    }

    return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' })
  })
}

/** `/home/you/Projects/app` → [{name:'you', path:'/home/you'}, …, {name:'app', …}]. */
function fileBreadcrumb(path, home) {
  const root = String(home || '')
  const full = String(path || root)
  const under = Boolean(root) && (full === root || full.startsWith(`${root}/`))
  const parts = under ? [{ name: root === '/' ? '/' : root.split('/').filter(Boolean).pop() || root, path: root }] : []
  const rest = under ? full.slice(root.length) : full
  let walked = under ? root : ''

  for (const bit of rest.split('/').filter(Boolean)) {
    walked = `${String(walked || '').replace(/\/$/, '')}/${bit}`
    parts.push({ name: bit, path: walked })
  }

  return parts
}

function joinFilePath(base, name) {
  return `${String(base || '').replace(/\/$/, '')}/${String(name || '')}`
}

function fileSizeLabel(bytes) {
  const size = Number(bytes) || 0

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** One directory. `path` empty means "the backend's home", so the tab can open
 *  before it knows where anything is. */
async function listDirectory(path) {
  const rest = ctxRef?.rest

  if (typeof rest !== 'function') {
    return { entries: [], error: 'no_backend' }
  }

  try {
    return (await rest(`/files?path=${encodeURIComponent(String(path || ''))}`)) || { entries: [] }
  } catch (error) {
    return { entries: [], error: String(error?.message || error || 'unreachable') }
  }
}

/** The rows of ONE expanded folder. Recursion in the tree is recursion in the
 *  component: every level owns its own query, which is what keeps a deep tree to
 *  the folders the user actually opened. */
function FileDirectory({ depth, expired, onToggle, path, t }) {
  const listed = useQuery({
    queryKey: ['personae', 'files', String(path || '')],
    queryFn: () => listDirectory(path),
    retry: false,
    staleTime: 15000
  })
  const data = listed.data || {}
  const rows = sortFileEntries(data.entries)
  const broken = data.error ? data.error : null

  if (listed.isPending) {
    return jsx('div', {
      'data-files-pending': '',
      className: 'px-3 py-2 text-[0.6875rem] text-(--ui-text-tertiary)',
      style: { paddingLeft: `${12 + depth * 12}px` },
      children: t('filesLoading')
    })
  }

  if (broken || !rows.length) {
    return jsx('div', {
      'data-files-note': broken || 'empty',
      className: 'px-3 py-2 text-[0.6875rem] text-(--ui-text-tertiary)',
      style: { paddingLeft: `${12 + depth * 12}px` },
      children: broken === 'outside_root' ? t('filesOutside') : broken ? t('filesUnavailable') : t('filesEmpty')
    })
  }

  return jsx(FileList, { depth, expired, onToggle, parent: String(data.path || path || ''), rows, t })
}

/** The rows of one folder. Split from the query so the ROOT can use the pane's own
 *  read (it needs `home`/`parent` from the same answer) and every subfolder can
 *  own a query without the two disagreeing about what a row looks like. */
function FileList({ depth, expired: open, onToggle, parent, rows, t }) {
  return jsxs('div', {
    className: 'flex flex-col',
    children: rows.map(entry =>
      jsx(
        FileRow,
        { depth, entry, expired: open, onToggle, parent, t },
        `${parent}/${entry.name}`
      )
    )
  })
}

function FileRow({ depth, entry, expired, onToggle, parent, t }) {
  const full = joinFilePath(parent, entry.name)
  const open = (expired || []).includes(full)
  const dim = String(entry.name || '').startsWith('.')

  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      jsxs('button', {
        'data-files-row': entry.dir ? 'dir' : 'file',
        className: 'flex w-full min-w-0 items-center gap-1.5 py-[3px] pr-2 text-left text-[0.75rem] hover:bg-(--chrome-action-hover)',
        onClick: entry.dir ? () => onToggle(full) : undefined,
        style: { paddingLeft: `${12 + depth * 12}px` },
        title: full,
        type: 'button',
        children: [
          jsx('span', {
            className: 'w-3 shrink-0 text-(--ui-text-tertiary)',
            children: entry.dir ? (open ? '\u25be' : '\u25b8') : ''
          }),
          jsx('span', {
            className: dim ? 'truncate text-(--ui-text-tertiary)' : 'truncate text-(--ui-text-primary)',
            children: entry.name
          }),
          entry.dir
            ? null
            : jsx('span', {
                className: 'ml-auto shrink-0 text-[0.625rem] text-(--ui-text-quaternary)',
                children: fileSizeLabel(entry.size)
              })
        ]
      }),
      open
        ? jsx(FileDirectory, { depth: depth + 1, expired, onToggle, path: full, t }, `dir-${full}`)
        : null
    ]
  })
}

function FilesPane() {
  const t = usePluginI18n(ID)
  // '' asks the backend for its home: the tab's root is a property of the MACHINE
  // the files are on, not of the window drawing them.
  const [root, setRoot] = useState('')
  const [expired, setExpired] = useState([])
  const top = useQuery({
    // The SAME key shape a subfolder uses: the root is just the first directory,
    // and two spellings of one read would keep two caches.
    queryKey: ['personae', 'files', String(root || '')],
    queryFn: () => listDirectory(root),
    retry: false,
    staleTime: 15000
  })
  const data = top.data || {}
  const home = String(data.home || '')
  const at = String(data.path || home || '')
  const crumbs = fileBreadcrumb(at, home)
  const parent = String(data.parent || '')
  const toggle = target =>
    setExpired(open => (open.includes(target) ? open.filter(entry => entry !== target) : [...open, target]))
  const go = target => {
    setExpired([])
    setRoot(target)
  }

  const header = jsxs('div', {
    className: 'flex min-w-0 items-center gap-2 px-3 pt-3 pb-2',
    children: [
      jsx('span', { className: 'grid size-6 shrink-0 place-items-center text-(--ui-text-tertiary)', children: menuGlyph('folder', '') }),
      jsx('span', { className: 'min-w-0 flex-1 truncate text-[0.8125rem] font-medium', children: t('files') }),
      parent
        ? jsx('button', {
            'data-files-up': '',
            className: 'shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)',
            onClick: () => go(parent),
            title: parent,
            type: 'button',
            children: t('filesUp')
          })
        : null,
      jsx('button', {
        'data-files-refresh': '',
        className: 'shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)',
        onClick: () => queryClient.invalidateQueries({ queryKey: ['personae', 'files'] }),
        type: 'button',
        children: t('filesRefresh')
      })
    ]
  })

  const crumbbar = jsx('div', {
    'data-files-path': at,
    className: 'flex flex-wrap items-center gap-1 border-b border-(--ui-stroke-secondary) px-3 pb-2 text-[0.625rem] text-(--ui-text-tertiary)',
    children: crumbs.map((crumb, index) =>
      jsxs(
        'span',
        {
          className: 'flex min-w-0 items-center gap-1',
          children: [
            index ? jsx('span', { children: '/' }) : null,
            jsx('button', {
              className: 'max-w-sm truncate hover:underline',
              onClick: () => go(crumb.path),
              title: crumb.path,
              type: 'button',
              children: crumb.name
            })
          ]
        },
        `crumb-${crumb.path}`
      )
    )
  })

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      header,
      crumbbar,
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-auto py-1',
        children: top.isPending
          ? jsx('div', {
              'data-files-pending': '',
              className: 'px-3 py-2 text-[0.6875rem] text-(--ui-text-tertiary)',
              children: t('filesLoading')
            })
          : data.error
            ? jsx('div', {
                'data-files-note': data.error,
                className: 'px-3 py-2 text-[0.6875rem] text-(--ui-text-tertiary)',
                children: data.error === 'outside_root' ? t('filesOutside') : t('filesUnavailable')
              })
            : jsx(FileList, { depth: 0, expired, onToggle: toggle, parent: at, rows: sortFileEntries(data.entries), t }, `root-${at}`)
      })
    ]
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
  // The search box and the needle it drives are TWO atoms (see scheduleSearch):
  // the box follows every keystroke, the sweep waits for a pause. `query` is
  // therefore the SETTLED needle, which is what `visibleRows`, the query keys
  // and `searching` all key off.
  const queryInput = useValue($searchInput)
  const query = useValue($searchQuery)
  const health = useValue($searchHealth)
  // "Archive all up to this point" — the pending cut, confirmed in the bar
  // above the list (never a modal: this pane asks in place, like the row's own
  // delete strip).
  const [archiveCut, setArchiveCut] = useState(null)
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
    queryKey: ['personae', 'sessions', openNames.join('|')],
    queryFn: () => refreshSessions(openNames),
    enabled: openNames.length > 0,
    refetchInterval: POLL_MS,
    staleTime: 2000,
    retry: false
  })
  const byProfile = sessions.data || {}

  /** Commit an inline session rename, then drop the field. The list picks the
   *  new title up on its next poll (the query key does not change). */
  const submitSessionRename = async (profile, session, name) => {
    try {
      await renameSession(session, profile, name)
    } catch (error) {
      host.notifyError?.(String(error?.message || error))
    }

    setEditingSession(null)
  }
  const nowMs = Date.now()
  const shown = visibleRows(rows, { activity, kind, matchesByProfile: hits, nowMs, profiles, query })
  const blocks = groupRows(shown, model)
  // A search that found NOTHING anywhere is its own answer, and a silent one is
  // what makes a working search look broken: the pane says so instead of
  // drawing an unchanged roster.
  const noHits = searching && shown.length === 0
  // "Archive all up to this point" (Pedro, 2026-10-16). Two steps on purpose:
  // READ the profile's whole history (`session.list`) to work out the cut, then
  // confirm the count before anything moves. The rows on screen are a capped,
  // sorted, possibly filtered page — a bulk verb that computed its set from them
  // would report one number and act on another.
  const openArchiveUpTo = async (session, profile) => {
    let entries = []

    try {
      entries = sessionsUpTo(await listAllSessions(profile), sessionIdOf(session) || session?.id)
    } catch (error) {
      host.notifyError?.(String(error?.message || error))

      return
    }

    if (!entries.length) {
      setSelectStatus(t('nothingOlder'))

      return
    }

    setSelectStatus('')
    setArmedDelete(false)
    setArchiveCut({ entries, profile })
  }
  const runArchiveCut = async () => {
    const cut = archiveCut

    if (!cut) {
      return undefined
    }

    setBatching(true)

    const { done, failed } = await runOverSessions(cut.entries, archiveSessionEntry)

    setBatching(false)
    setArchiveCut(null)
    setSelectStatus(failed ? `${done} ${t('archived')} · ${failed} ${t('failed')}` : `${done} ${t('archived')}`)
    await queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
    await queryClient.invalidateQueries({ queryKey: ['personae', 'view'] })

    return undefined
  }
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
      onArchiveUpTo: openArchiveUpTo,
      // The drill-down draws real SessionRows, and a SessionRow's Group menu
      // calls three handlers. None of them were passed here, so the verbs threw
      // on `undefined` and the menu item did nothing — one screen's menu must be
      // the same menu, not the same labels.
      onCreateAproposGroup: entries => {
        const list = entries?.length ? entries : []

        return aproposCreateGroup(list).then(made => {
          if (made.length) {
            setRenamingGroup({ id: made[0].groupId, name: made[0].name })
            $listView.set(null)
          }

          return made
        })
      },
      onMoveGroup: (name, payload, keys) =>
        moveSessionsToGroup(
          name,
          sessionGroupMoveTargets({ profile: name, selectedKeys: keys, sessionId: payload?.sessionId }),
          payload?.groupId ?? null
        ),
      onNewGroup: (name, sessionIds) => {
        const made = createGroupHere(name, sessionIds)

        if (made) {
          setRenamingGroup(made)
        }
      },
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
    body = jsxs('div', {
      className: 'flex min-h-0 flex-1 flex-col',
      children: [
        jsx('img', {
          alt: '',
          'data-personae-mark': '',
          src: MARK_SRC,
          style: {
            borderRadius: '22%',
            display: 'block',
            height: 56,
            margin: '28px auto 0',
            opacity: 0.9,
            width: 56
          }
        }),
        jsx(EmptyState, {
          description: rows.length ? t('filteredHint') : t('emptyHint'),
          title: rows.length ? t('filtered') : t('empty')
        })
      ]
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
                        onArchiveUpTo: openArchiveUpTo,
                        searching,
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
            onChange: scheduleSearch,
            placeholder: t('searchPlaceholder'),
            value: queryInput
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
      // The search's own receipt, and the one thing that must never be quiet:
      // if the pane's backend is not reachable the sweep is TITLES ONLY, and
      // "no match" plus "could not read the bodies" used to draw the same
      // screen — which is why "search is not working" was undiagnosable.
      searching && (health?.unavailable || health?.failed?.length)
        ? jsx('div', {
            className: 'min-w-0 truncate px-2.5 pb-1 text-[0.6875rem] text-(--ui-text-quaternary)',
            'data-search-health': health?.unavailable ? 'unavailable' : 'failed',
            title: (health?.failed || []).join(', '),
            children: health?.unavailable
              ? t('searchUnavailable')
              : `${t('searchTitlesOnly')}: ${(health?.failed || []).join(', ')}`
          })
        : null,
      noHits
        ? jsx('div', {
            className: 'min-w-0 truncate px-2.5 pb-1 text-[0.6875rem] text-(--ui-text-quaternary)',
            'data-search-empty': needle,
            children: `${t('searchNothing')} “${needle}”`
          })
        : null,
      // The cut is confirmed HERE rather than in a dialog: this pane asks in
      // place everywhere else (a row's delete strip), and the count is the whole
      // point of the confirmation.
      archiveCut
        ? jsx(ArchiveCutBar, {
            busy: batching,
            count: archiveCut.entries.length,
            onCancel: () => setArchiveCut(null),
            onRun: runArchiveCut,
            profile: archiveCut.profile,
            t
          })
        : null,
      body
    ]
  })
}

/** One-time prefs carry-over for the 1.2.0 id rename (`messenger` -> `personae`).
 *
 *  `ctx.storage` is namespaced by the plugin's CURRENT id, so it cannot see the
 *  old namespace — this reads the renderer's own `localStorage` instead, copies
 *  every `hermes.plugin.messenger.*` value into `hermes.plugin.personae.*`, and
 *  leaves the old entries in place: a COPY, never a move, so someone who rolls
 *  back to an older build finds their groups, colours and sort orders exactly
 *  where they left them. A key the new id has already written is never
 *  overwritten, which is what makes this idempotent.
 *
 *  Key names INSIDE the namespace are untouched: they are the wire contract with
 *  the pane's backend and with Personae Mobile (see `SYNC_LOCAL_PREFIX`).
 *
 *  Returns how many values it copied — the harness asserts on it. Storage that
 *  isn't there (the headless harness, an older shell) is a no-op, never a throw.
 */
function migrateLegacyStorage() {
  const store = typeof localStorage === 'undefined' ? null : localStorage

  if (!store || typeof store.length !== 'number') return 0

  const from = 'hermes.plugin.messenger.'
  const to = 'hermes.plugin.personae.'
  let copied = 0

  try {
    // Snapshot the keys first: writing inside the loop would move `length`.
    const stale = []

    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)

      if (key && key.startsWith(from)) stale.push(key)
    }

    for (const key of stale) {
      const next = to + key.slice(from.length)

      if (store.getItem(next) !== null) continue

      const value = store.getItem(key)

      if (value === null) continue

      store.setItem(next, value)
      copied += 1
    }
  } catch {
    // A full quota or a locked-down shell: prefs simply start fresh.
    return copied
  }

  return copied
}

export default {
  id: ID, // must match the folder name
  name: 'Personae',
  register(ctx) {
    ctxRef = ctx
    migrateLegacyStorage()
    loadPrefs()
    startSync(ctx)

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
        files: 'Files',
        filesEmpty: 'This folder is empty',
        filesLoading: 'Loading…',
        filesOutside: 'Outside the folder this tab may show',
        filesRefresh: 'Refresh',
        filesUnavailable: 'Cannot read this folder — the Personae backend may be older than the plugin (restart it)',
        filesUp: 'Up',
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
        dotIdle: 'Nothing unread',
        dotNeedsInput: 'Waiting for your answer',
        dotSummary: (needsInput, working, unread) =>
          [
            needsInput ? `${needsInput} waiting` : '',
            working ? `${working} working` : '',
            unread ? `${unread} unread` : ''
          ]
            .filter(Boolean)
            .join(' · '),
        dotUnread: 'Finished, unread',
        dotWorking: 'Working now',
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
        screenBack: 'Back to session',
        screenConnecting: 'Connecting…',
        screenHidden: 'Hidden — someone else is driving',
        screenLive: 'Live',
        screenMissing: 'No screen installed',
        screenOff: 'Screen stopped',
        screenOther: 'Someone else is on it',
        screenDriving: 'You are driving',
        screenFailed: 'The screen did not answer.',
        screenHandBack: 'Hand back',
        screenHintDriving: 'Click the view to type. Hand back to give the bot its screen.',
        screenHintWatch: 'Watching live. Take over to drive.',
        screenInstall: 'Install',
        screenInstallDone: 'Install finished.',
        screenInstallFailed: 'Install failed.',
        screenInstallLog: 'Install log',
        screenNotRunning: 'The screen is not running — Start it to watch or drive it.',
        screenReconnect: 'Reconnect',
        screenStart: 'Start',
        screenStop: 'Stop',
        screenStopForce: 'Someone else is driving. Stop the screen anyway?',
        screenStopForceSelf: 'You are driving this screen. Stop it anyway?',
        screenTaken: 'Someone else took control.',
        screenTakeOver: 'Take over',
        screenWorking: 'Working…',
        screenTitle: 'Screen',
        status: 'Status',
        search: 'Search profiles',
        searchPlaceholder: 'Search profiles and their sessions',
        searching: 'Searching sessions…',
        apropos: 'Apropos (beta)',
        aproposMade: 'Apropos groups created',
        archive: 'Archive',
        unarchive: 'Unarchive',
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
        viewArchiveUnavailable: 'Archive unavailable — the Personae backend is not mounted in this build.',
        viewArchived: 'View Archived',
        viewArchivedEmpty: 'Nothing archived for this profile.',
        viewHidden: 'View hidden',
        viewHiddenEmpty: 'Nothing hidden in Personae for this profile.',
        unhideAll: 'Unhide all',
        viewBack: 'Back',
        viewSessions: 'sessions',
        viewSearch: 'View matches',
        viewSearchEmpty: 'No sessions matched this keyword.',
        viewFilterEmpty: 'Nothing in this list matches the filter.',
        filterSessions: 'Filter this list',
        searchNothing: 'Nothing matched',
        searchTitlesOnly: 'Titles only (message search refused)',
        searchUnavailable: 'Titles only — message search is unavailable in this build.',
        archiveUpToAsk: count => `Archive the ${count} sessions older than this one?`,
        nothingOlder: 'Nothing older to archive',
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

    // Files — a THIRD pane, docked to the same right edge as Scheduled jobs, so
    // the right zone shows the two as tabs beside each other. Read-only: it makes
    // no writes and has no verb that could.
    const registerFiles = () =>
      ctx.register({
        id: 'files',
        area: 'panes',
        title: 'Files',
        data: {
          defaultCollapsed: true,
          dock: { pane: 'workspace', pos: 'right', enforce: true },
          placement: 'main',
          width: '260px'
        },
        render: () => jsx(FilesPane, {})
      })

    if (typeof host.paneVisibility === 'function') {
      const $visible = host.paneVisibility(`${ID}:pane`)
      let disposeRoutines = null
      let disposeFiles = null

      const syncRoutines = visible => {
        if (visible && !disposeRoutines) {
          disposeRoutines = registerRoutines()
        } else if (!visible && disposeRoutines) {
          disposeRoutines()
          disposeRoutines = null
        }

        if (visible && !disposeFiles) {
          disposeFiles = registerFiles()
        } else if (!visible && disposeFiles) {
          disposeFiles()
          disposeFiles = null
        }
      }

      if (typeof $visible?.listen === 'function') {
        $visible.listen(syncRoutines)
      }

      syncRoutines(typeof $visible?.get === 'function' ? Boolean($visible.get()) : false)
    } else {
      registerRoutines()
      registerFiles()
    }
  }
}

/** Test seam — the pure decision layer, so the headless harness can exercise
 *  filtering and grouping without a DOM to type into. Not part of the plugin
 *  API: the app reads `default` and nothing else. */
export const __internals = {
  fileBreadcrumb,
  fileSizeLabel,
  FilesPane,
  joinFilePath,
  sortFileEntries,
  migrateLegacyStorage,
  applyPref,
  createSync,
  isEmptyPref,
  syncServerKey,
  syncStatus,
  SYNC_DEBOUNCE_MS,
  SYNC_META_KEY,
  SYNC_SERVER_KEYS,
  getPrefSync: () => prefSync,
  createGroupNow,
  dropAction,
  elementAt,
  $expanded,
  $listView,
  allSessionKeys,
  archiveSession,
  unarchiveSession,
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
  $profileDots,
  DOT_TITLE_KEY,
  dotStateFor,
  DOT_LIST_TTL_MS,
  dotListCache,
  liveStatusMap,
  LIVE_WORKING,
  ROLLUP_DOT,
  ROLLUP_INK,
  ROLLUP_LIST_LIMIT,
  rosterRollups,
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
  openSessionInProfile,
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
  createGroupHere,
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
  bodySearch,
  matchesActivity,
  mergeBodyHits,
  searchInSessions,
  sessionMatches,
  listSearchHits,
  listMatch,
  moreHitsTarget,
  ArchiveCutBar,
  sessionsUpTo,
  anySessionId,
  scheduleSearch,
  $searchHealth,
  $searchInput,
  $searchQuery,
  SEARCH_BODY_LIMIT,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_CHARS,
  SessionListView,
  scheduleLabel,
  screenTone,
  screenVerbState,
  screenCloseVerdict,
  screenSocketUrl,
  createRfbStream,
  rfbSetPixelFormat,
  rfbSetEncodings,
  rfbUpdateRequest,
  rfbKeyMessage,
  rfbPointerMessage,
  parseServerInit,
  looksLikeServerInit,
  decodeRawRect,
  copyRectRegion,
  keysymFor,
  keysymsForEvent,
  pointerMaskFor,
  wheelMaskFor,
  leaseHeldBy,
  viewerHashOf,
  createScreenSession,
  releaseHeldKeys,
  attachScreen,
  detachScreen,
  screenLease,
  forwardKey,
  screenPointer,
  paintScreenFrame,
  allocateCanvas,
  screenStopQuestion,
  screenStopParams,
  noteScreenInstallLog,
  noteScreenInstallDone,
  resetScreenInstall,
  $screenInstall,
  openScreenPane,
  closeScreenPane,
  screenBackTarget,
  screenBackToSession,
  ScreenView,
  ScreenHero,
  rfbRequestedFormat,
  parseRfbFormat,
  rfbFormatBytes,
  visibleRows
}
