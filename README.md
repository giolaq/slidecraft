# Slidecraft

A local presentation tool and companion agent skill. Describe a deck to your
agent, inspect it in your browser, and refine individual slides through
conversation or direct editing. Output is HTML/CSS/JavaScript with animation.

**Requires Node.js 22+ and a modern browser. No dependencies or API keys.**

```bash
cd slidecraft
npm start
```

Open **http://127.0.0.1:4310**. The seven-slide demo includes animated layouts
and speaker notes. In another terminal, create your own deck:

```bash
node bin/slidecraft.js init decks/my-talk.deck.json --title "My talk"
node bin/slidecraft.js serve decks/my-talk.deck.json --port 4311
```

`init` copies demonstration content as a starting point; replace it with your
story. All commands can run with `node bin/slidecraft.js --help`.

## Work with an agent

The reusable skill is in [`.agents/skills/slidecraft/SKILL.md`](.agents/skills/slidecraft/SKILL.md).
Agents that discover project `.agents/skills` can load it from this checkout.
For other agents, point them at that file explicitly or copy it to the skill
directory supported by your agent, keeping the tool checkout available.

Example requests:

- “Use the Slidecraft skill. Create an eight-slide presentation for engineers
  explaining our migration plan. We have ten minutes. Start with the decision.”
- “Does the argument on slide 3 actually support the recommendation?”
- “Turn the architecture slide into an animated SVG diagram.”
- “Shorten the opening, preserve the technical slides, and add rehearsal notes.”

The skill distinguishes discussion from editing, guides narrative and visual
design, and targets stable slide IDs. Voice works through a host agent's voice
or dictation feature; this version has no built-in transcription or AI chat.

## Edit, present, export

The browser editor supports title/body/notes edits, motion selection, adding,
duplicating, moving, and deleting slides. **Edit JSON** exposes the full deck,
including layouts, diagrams, custom CSS, and JavaScript. Changes preview before
you save. **Save changes** writes to disk. Agent edits to the watched file reload
automatically; unsaved browser changes cause a conflict notice instead.

Click **Present** for a separate presentation tab. Use arrows, Space, Page Up /
Page Down, Home, and End to navigate; N toggles notes, F toggles fullscreen.
Entrance animations play automatically. Reduced-motion settings are respected.

Click **Export HTML**, or run:

```bash
node bin/slidecraft.js validate decks/my-talk.deck.json
node bin/slidecraft.js render decks/my-talk.deck.json --out dist/my-talk.html
```

Open the exported file directly. Built-in styles and scripts are embedded;
external media you add remain external. Browser Print → Save as PDF creates a
static copy. PPTX, video export, built-in voice chat, and cloud hosting are not
part of this version. Notes are embedded in HTML exports.

## Focused edits and history

```bash
node bin/slidecraft.js inspect decks/my-talk.deck.json
node bin/slidecraft.js patch decks/my-talk.deck.json --slide opening --stdin <<'JSON'
{"title":"Make the idea clearer.","motion":"fade"}
JSON
```

Patch shallow-merges one slide's fields and replaces arrays. It validates before
writing. Browser and CLI saves preserve previous source files under
`.slidecraft-history/<deck filename>/`. To recover a version, inspect the dated
JSON snapshots, copy the chosen contents into **Edit JSON**, apply, and save.
That save also preserves the current file. Direct file edits made outside the
tool do not create snapshots; use Git or `saveDeck` for larger changes.

Run only one writer at a time. Browser saves reject stale disk revisions, but
the filesystem is not a multi-user database. The local server binds to loopback,
checks Host and editor tokens, and does not expose arbitrary filesystem paths.
Custom deck code is executable: review unfamiliar HTML/JS before opening it.
The editor isolates previews in a sandbox; exported decks run as ordinary pages.

## Project map

- `bin/slidecraft.js` — CLI and agent-facing entry point
- `src/deck.js` — validation, revisions, atomic writes, snapshots
- `src/render.js`, `src/presentation.*` — self-contained presentation renderer
- `src/server.js`, `src/studio.html` — local editor and live preview
- `examples/demo.deck.json` — working sample deck
- `references/deck-format.md`, `references/motion.md` — authoring references
- `.agents/skills/slidecraft/SKILL.md` — portable agent workflow

Run `npm test` for validation, escaping, persistence, and HTTP integration tests.
Run `npm run test:browser` for Chromium playback/editor/export checks (Chromium
must be installed; set `CHROMIUM_PATH` if it is not `/usr/bin/chromium`).

## MCP app for ChatGPT and other agents

The [mcp](mcp/README.md) project contains the deployed MCP server, interactive studio, and presentation-authoring skill. It supports general atomic deck edits, per-slide styling, and an isolated HTML/CSS/JavaScript preview matching the export. Run `cd mcp && npm ci && npm run dev` to develop it.
