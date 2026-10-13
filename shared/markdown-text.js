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
