# 🎭 Personae — Agent Messenger

**Personae** is my take on what "Bots" should be. A simple messenger app, with all your profiles, along with their corresponding sessions. Nothing else.
Right now, it is a plugin for the **Hermes Desktop** app. 


---

## ✨ What it does

| Capability | What it gives you |
| --- | --- |
| 🗂️ **Messenger-style** | One row per profile: face, name, a preview of the last session, its age |
| 🔽 **Expand a face** | Its sessions — status dot, title, preview, age — newest first |
| 🟡 **Status lights** | Amber: waiting on you. Emerald: unread. Neutral: nothing. Numbered at 2+ |
| 🎨 **Colour that fills** | A profile's colour tints every session under it. Session → group → profile |
| 🔍 **Search & filter** | Profiles *and* sessions, server-side; filter by activity, kind, or a profile set |
| 🖱️ **Right-click menus** | Profile, session, group heading — the same verbs in each |
| ✅ **Multi-select** | Tick a set, then archive, delete, or Apropos them in one go |
| 🗂️ **Groups** | Named sections shared by both panes; an empty one explains how to fill it |
| 🌱 **Apropos** *(beta)* | A fresh session that already knows the background of the ones you picked |
| 🗑️ **Honest deletes** | Deleting a group never deletes sessions; a chain goes only when you say so |
| 🧩 **Bots-compatible** | Name, avatar and colour are the Bots tab's own store — change one, both change |

---

## 🚀 Quick Start

### Install from Git *(recommended)*
1. **Settings → Plugins → Install from Git**
2. Identifier: `SmoothMarx/personae` — a full `https://github.com/…` URL works too
3. Confirm. The app installs `plugin.js` into its own `<hermes home>/desktop-plugins/personae/`
4. The **Personae** tab appears beside **Sessions | Bots**

If the tab doesn't show: open the command palette (⌘K / Ctrl+K) and run **Reload desktop plugins**.

### Manual
Copy `plugin.js` into `<hermes home>/desktop-plugins/personae/`, then reload the plugins.

### Requirements
- **Hermes Desktop.** Plugins are loaded by the app — not by the CLI or the gateway.
- Optional: the built-in **Bots** tab, whose profile store Personae shares.

There is nothing to build: the app executes `plugin.js` as it stands.

---

## 🧠 The story

One agent, a dozen faces. Ada drafts. Scout books. Dobbs remembers the birthdays. You
open the app to ask one of them something, and you're back to the same two questions —
*which profile was that?* and *what did it just do?* — with the answers living in two
different tabs.

Personae answers both at once. It's a messenger for your agents: each profile is a
person, each session is what that person has been doing. Faces down the left, their
conversations underneath, and a light that says who is waiting on you before you click
anything.

You keep the roster. You drop the tab-hopping.

## 🤔 Why "Personae"?

A *persona* is the mask an actor wears — one actor, many faces. Your profiles are
exactly that: one agent, many personae.

The machine id is still `messenger`, from its first life as a messenger pane, and it
stays that way on purpose: an id is a key. Renaming it would orphan every saved group,
colour and link. The folder name doesn't matter — the app keys plugins by their
manifest id.

---

## 🎭 The rail

**One row per profile:** face, name, a preview of the last session, and its age. The
rows sit a touch taller than the Bots rail and the faces are larger, on purpose — one
of the first notes this plugin ever got was *"make it bigger than bot mode."*

**Expand a face** → its sessions, newest first: status dot, title, preview, age.
Parents stay where they are: a parent session and its Apropos child are both listed,
and nothing gets hidden or yanked around. Sort a profile's sessions by hand or by last
activity from its right-click menu.

---

## 🟡 Status lights

The app only knows the live state of the profile it's currently on — Personae feeds the
other rows itself, so a remote profile that just finished a turn lights up too.

The dot answers one question — *is anything here waiting for me?* — in priority order:

| Dot | Means |
| --- | --- |
| **amber** | a session is blocked on you: a question, a clarification |
| **emerald** | unread activity |
| **neutral** | nothing awaits you |

The **number** beside it counts what awaits you — `waiting + unread` — and appears only
at **2 or more**: one pending thing is already said by the colour. Read one of two and
the colour stays, the number disappears; read both and the colour goes with it. A
session that is merely **running** is never counted here, and never colours the profile:
blue belongs to the *session* dot, where "this conversation is working right now" is a
true statement about that conversation.

*Emerald leans on the read/unread watermark the app writes when you open a session. On
a profile that has never been read through, it can stay quiet — the dot is honest about
what it knows.*

---

## 🎨 Colour

Give a profile a colour and it tints the profile row **and** every session under it.
Overrides, in order:

| Layer | Beats |
| --- | --- |
| Session colour | everything |
| Group colour | the profile's colour |
| Profile colour | the neutral default |

No colour is the default — and **no fill** is always an option: the status dot still
carries the identity if you'd rather keep the list quiet.

---

## 🗂️ Groups

Groups are named sections, and they're the same object in both panes: file a profile
into a group here and it's filed in Bots too.

An empty group tells you how to fill it instead of looking broken. Deleting a group
never deletes sessions — its members fall back into the flat list.

---

## 🖱️ The menus

Right-click a profile, a session, or a group heading. The verbs are shared; each menu
offers the ones that make sense on the thing you clicked.

| Verb | What it does |
| --- | --- |
| **Open** | Open the session in the app |
| **Rename…** | Set the display name (a profile's name is written to the Bots store) |
| **Colour** | Pick from the palette, or clear it |
| **File into a group** | Move it into a section |
| **Sort** | Manual, or by last activity |
| **Copy id** | The exact profile or session id |
| **Apropos (On that topic, beta)** | A new child session that knows this background |
| **Delete** | Delete the session or the group — see below |

---

## ✅ Multi-select

Tick several sessions and act once: **archive**, **delete**, or **Apropos** them into a
single topic group. The selection bar shows what's ticked; the verbs do the rest.

---

## 🌱 Apropos (beta)

*Apropos* means "on that topic". It's how you start a **fresh session that already
knows the background** without copying anything into it.

Right-click a session → **Apropos (On that topic, beta)**:

| Verb | What you get |
| --- | --- |
| **From this session** | one child that can consult *this* transcript |
| **Create group** | an Apropos group whose members all join one digest |

Right-click a **group heading** → **Apropos this group (beta)** — or **New child
session (beta)** once it *is* an Apropos group — to start another child from the same
membership. Select several sessions and press **Apropos (beta)** in the selection bar
to make one from the whole tick set.

The mechanics are deliberately cheap: **the child copies nothing.** It gets a single
hidden header naming the source(s), and re-reads the transcript when it needs depth — so
an Apropos child is a focused question, not a bloated fork. A parent and its child are
both listed; the child wears a **↳** inside its group, and a **↩** chips back from the
parent.

It is labelled **beta** on every surface that offers it, and that label is the whole
marker: the machinery is finished, the edges are still being pinned down. Use it, enjoy
it, and don't build your morning on it yet.

---

## 🗑️ Delete, without the guilt trip

Deleting a session deletes it. Deleting a session *group* never deletes sessions — its
members fall back into the flat list.

A chain travels together: delete a parent and its Apropos children are **orphaned** by
default, or taken with it if you ask for that instead.

---

## 🛡️ Safety

- **Nothing in the app's core is modified.** Personae is a plugin: it reads the app's
  stores and writes only the ones you already own through the Bots tab. Remove it and
  the app is exactly what it was.
- **Your data stays put.** Groups, colours and Apropos links live in the app's own
  database; uninstalling the plugin doesn't move or delete them.
- **Nothing destructive happens as a side effect.** Grouping, colouring and sorting
  never delete. The only destructive verb is Delete, and you have to click it.
- **No server, no telemetry.** It talks to the app it lives in.
- **Loads uncompiled.** The app executes `plugin.js` as it stands, so every line that
  runs is a line you can read.

---

## 📦 Project layout

```
personae/
├── plugin.js         # the plugin: the pane, the rail, groups, colours, Apropos, delete chains
├── tests/
│   ├── run.mjs       # headless harness — renders the pane with react-dom/server, asserts on the tree
│   ├── classes.mjs   # every utility class must already exist in the app's compiled stylesheet
│   ├── run.sh        # runs both
│   └── sdk/          # a stand-in for @hermes/plugin-sdk, so the harness runs without the app
├── deploy.sh         # copies plugin.js into the app's plugin folder, prints both hashes
├── package.json      # name, license, scripts — no dependencies
├── LICENSE           # GPL-3.0
└── README.md         # this file
```

---

## 🔧 Development

```bash
./tests/run.sh          # 635 render checks + 135 class tokens, no app required
```

The harness needs **node ≥ 20.6** and a checkout of the desktop repo, for the same React
the app ships. It looks for it in `~/.hermes/hermes-agent` by default:

```bash
HERMES_DESKTOP_REPO=/path/to/hermes-agent ./tests/run.sh
```

Deploying to a running app (hot-reloads in seconds):

```bash
HOST=user@box WIN_DIR='C:/Users/you/AppData/Local/hermes/desktop-plugins/personae' ./deploy.sh
```

Two rules worth keeping if you fork this:

- **Every class token must already exist in the app's stylesheet.** A plugin loads at
  *runtime*; a utility the app never used isn't in the CSS and does nothing.
  `tests/classes.mjs` fails the build instead of letting you ship a silent no-op.
- **Test the markup, not your intentions.** The harness asserts on rendered output —
  labels included — so a rename shows up as a failing check rather than as a surprise in
  the UI.

---

## 🙏 Acknowledgements

Personae is a thin layer standing on the shoulders of:

### Hermes Desktop
The app it lives in — its plugin SDK and its stores. The Sessions and Bots panes gave
the rail its whole vocabulary.

### The Bots tab
Profile identity — name, avatar, colour — is Bots' store. Personae reads and writes the
same one, so the two panes can never disagree about who someone is.

---

*© 2026 SmoothMarx · GPL-3.0-or-later — free to use, modify, and share. See [LICENSE](LICENSE).*
