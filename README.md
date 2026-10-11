# Personae

**Every face your agent wears, in one list.**

Personae is a plugin for the **Hermes Desktop** app. It adds a native tab beside **Sessions | Bots** — a 280px rail that merges the two things you always wanted side by side:

- your **bot roster** — who your agents are, and
- each profile's **live sessions** — what they've been doing.

One rail. Click a face to open its conversations. No more hopping between "which agent is this?" and "what did it just do?".

```
 ┌─ Sessions | Bots | Personae ─────────┐
 │  ◉  Ada            working now  4m   │   ← the rail: one row per face
 │     ↳ rewrote the ingest script      │
 │  ○  Scout                 yesterday  │
 │     ↳ Trip: Oslo, day 2              │
 │  ○  Dobbs                     2d     │
 └──────────────────────────────────────┘
```

> **Why "Personae"?** A *persona* is the mask an actor wears — one actor, many faces. Your profiles are exactly that: one agent, many personae. The machine id is still `messenger`, from its first life as a messenger pane. An id is a key: renaming it would orphan everyone's saved groups, colours and links, so it stayed. The folder name doesn't matter — the app keys plugins by their manifest id.

## What you get

**The rail.** One row per profile — face, name, a preview of the last session, and its age. Rows are deliberately a touch taller than the Bots rail and the faces larger (Pedro, who asked for it: *"make it bigger than bot mode"*), so a glance tells you who is busy.

**Expand a face** → its sessions, newest first: status dot, title, preview, age. Parents stay where they are — nothing gets hidden or yanked around.

**Groups (sections).** File profiles into named groups; groups are the same object in both panes. An empty group tells you how to fill it instead of looking broken.

**Colour that fills.** Give a profile a colour and it tints the profile row *and* all of its session rows. Overrides, in order: session colour → group colour → profile colour. No colour is the default, and **no fill** is always an option — the dot still carries the identity if you'd rather keep the list quiet.

**Search and filters.** Search profiles *and* their sessions (server-side, so it reaches sessions that aren't loaded); filter by activity, kind, or a profile set.

**Right-click, like it should be.** Open, rename, colour, file into a group, sort (manual / last activity / …), copy id, delete. The group heading has its own menu, and both menus offer the same verbs.

**Multi-select.** Tick several sessions and act once: archive, delete, or **Apropos** them into a single topic group.

**Status lights, even for the faces core can't see.** The app only knows the live state of the profile it's currently on — Personae feeds the other rows itself, so a remote profile that just finished a turn lights up too.

The dot answers one question — *is anything here waiting for me?* — in priority order:

| Dot | Means |
| --- | --- |
| **amber** | a session is blocked on you: a question, a clarification |
| **emerald** | unread activity |
| **neutral** | nothing awaits you |

The **number** beside it counts what awaits you — `waiting + unread` — and appears only at **2 or more**: one pending thing is already said by the colour. Read one of two and the colour stays, the number disappears; read both and the colour goes with it. A session that is merely **running** is never counted here, and never colours the profile: blue belongs to the *session* dot, where "this conversation is working right now" is a true statement about that conversation.

*Emerald leans on the read/unread watermark the app writes when you open a session. On a profile that has never been read through, it can stay quiet — the dot is honest about what it knows.*

**Delete, without the guilt trip.** Deleting a session deletes it. Deleting a session *group* never deletes sessions — its members fall back into the flat list. A chain (a parent and its Apropos children) is deleted together: children are orphaned by default, or taken with it if you say so.

## Requirements

- **Hermes Desktop app.** Plugins are loaded by the app, not by the CLI/gateway.
- Optionally the built-in **Bots** tab: profile identity (name, avatar, colour) is read from and written to the same store, so changing a face in either pane changes it in the other.

## Install

1. **Settings → Plugins → Install from Git**
2. Identifier: `SmoothMarx/personae` (a full `https://github.com/…` URL works too).
3. Confirm. The app installs `plugin.js` into its own `<hermes home>/desktop-plugins/<folder>/plugin.js`.
4. The **Personae** tab appears beside **Sessions | Bots**. If not: ⌘K → **Reload desktop plugins**.

No build step, no dependencies: the app executes `plugin.js` as-is, and it loads uncompiled.

## Apropos (beta)

*Apropos* means "on that topic". It is how you start a **fresh session that already knows the background** without copying anything into it.

Right-click a session → **Apropos (On that topic, beta)**:

| Verb | What you get |
| --- | --- |
| **From this session** | one child that can consult *this* transcript |
| **Create group** | an Apropos group whose members all join one digest |

Right-click a **group heading** → **Apropos this group (beta)** (or **New child session (beta)** once it *is* an Apropos group) to start another child from the same membership. Select several sessions and press **Apropos (beta)** in the selection bar to make one from the whole tick set.

The mechanics are deliberately cheap: **the child copies nothing.** It gets a single hidden header naming the source(s) and re-reads the transcript when it needs depth, so an Apropos child is a focused question, not a bloated fork. A parent and its child are both listed; the child wears a **↳** inside its group, and a **↩** chips back from the parent.

It is labelled **beta** on every surface that offers it, and that label is the whole marker. The machinery is finished; the edges are still being pinned down — a child that never ran a turn, and lineages that rename themselves when a session compacts. Use it, enjoy it, and don't build your morning on it yet.

## Development

Everything is one plain ESM file. No bundler, no transpiler, no dependencies.

```
plugin.js          the plugin: pane, rail, groups, colours, Apropos, delete chains
tests/run.mjs      headless harness - renders the pane with react-dom/server and asserts on the tree
tests/classes.mjs  every Tailwind class used must ALREADY exist in the app's compiled stylesheet
tests/sdk/         a stand-in for @hermes/plugin-sdk, so the harness runs without the app
tests/run.sh       runs both
deploy.sh          copies plugin.js into the app's desktop-plugins folder, prints both hashes
```

```bash
./tests/run.sh          # 635 render checks + 135 class tokens, no app required
```

The harness needs **node ≥ 20.6** and a checkout of the desktop repo for the same React the app ships:

```bash
HERMES_DESKTOP_REPO=~/hermes-agent ./tests/run.sh
```

Two rules worth keeping if you fork this:

- **Every class token must already exist in the app's stylesheet.** A plugin loads at *runtime*; a utility the app never used is simply absent from the CSS and does nothing. `tests/classes.mjs` fails the build instead of letting you ship a silent no-op.
- **Test the markup, not your intentions.** The harness asserts on rendered output — labels included — so a rename shows up as a failing check rather than as a surprise in the UI.

Deploying to a running app (hot-reloads in seconds):

```bash
HOST=user@box WIN_DIR='C:/Users/you/AppData/Local/hermes/desktop-plugins/personae' ./deploy.sh
```

## License

**GPL-3.0-or-later** — see [LICENSE](LICENSE). © 2026 SmoothMarx.
