# Slidecraft

A local presentation tool, companion agent skill, and MCP app for ChatGPT. Describe a deck to your
agent, inspect it in your browser, and refine individual slides through
conversation or direct editing. Output is HTML/CSS/JavaScript with animation.

## Choose how to use Slidecraft

| Version | Start here | Requirements |
| --- | --- | --- |
| Local browser tool and agent skill | Follow the local quick start below | Node.js 22+ and a modern browser; no dependencies or API keys |
| ChatGPT / MCP app | [MCP installation and configuration](mcp/README.md#deploy-to-manufact-cloud) | Node.js 22.22.2+, npm dependencies, and an HTTPS deployment |
| Narrated auto-presentation in the MCP app | [Complete narration setup](mcp/README.md#configure-elevenlabs-narration) | Auth0, PostgreSQL (for example Neon), private S3 storage (for example Cloudflare R2), and each user's ElevenLabs secret API key |

The local tool and MCP app are separate projects. The narration setup below
applies to the MCP app in `mcp/`, not the local server on port 4310.

## Local quick start

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
static copy. PPTX, video export, and built-in voice chat are not
part of the local tool. Use the MCP app for cloud hosting and ElevenLabs narration.
Notes are embedded in the local tool's HTML exports.

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

To configure your own hosted MCP app:

1. Deploy `mcp/` to Manufact Cloud with narration disabled, and record its HTTPS origin and `/mcp` URL.
2. Create a Neon PostgreSQL database and private Cloudflare R2 bucket (or equivalent PostgreSQL/S3 services).
3. Create the Auth0 API and web application, configure client registration and login connections, and add all deployment variables and secrets.
4. Enable narration and redeploy the same server.
5. Add the server in [ChatGPT Plugins](https://chatgpt.com/plugins) as a custom MCP server using OAuth with automatic registration. Install/select Slidecraft in a new chat and complete sign-in.

The [MCP README](mcp/README.md#configure-elevenlabs-narration) contains the complete
variable table, callback URLs, Auth0 permissions, Neon/R2 setup, and deployment
commands. The [operator guide](mcp/docs/elevenlabs-setup.md) covers storage,
workers, security, and verification. Each deployment uses its own configuration;
do not copy someone else's credentials or encryption key.

### Generate narration and present

1. Open a deck, expand **Narration**, and click **Connect ElevenLabs**. Sign in with the same Auth0 account and enter your ElevenLabs **secret API key value** on the external page.
2. Give the key **Voices read**, **Models read**, and **Text to Speech** access. The key ID shown in the key list is not the secret. If the secret is no longer visible, create a new key and copy the secret when it is shown.
3. Wait for **Connected**, return to Slidecraft, click **Load voices**, and choose a voice and model.
4. Click **Write Narration** once to write and save scripts for all speech slides in the presentation, including rewrites of existing scripts. Silent slides remain silent. Review the scripts, and click **Save narration** after any manual edits. Writing does not spend ElevenLabs credits. Alternatively, choose **Silent slide**, set a dwell time, and save.
5. Click **Generate narration… → Confirm and generate**. This uses your ElevenLabs credits. Wait until every slide is ready, then test **Preview audio**.
6. Click **Present → Auto present from beginning**. The voice narrates each slide and advances when its audio ends. If playback is blocked, click **Resume audio**. Manual navigation or switching tabs pauses narration.

**0 characters** in the review means scripts are empty. **Generate narration…**
requires a connected account and saved voice/script settings; unsaved drafts
disable it. **Confirm and generate** additionally requires scripts or silent mode
for every included slide and at least one recording needing work. Auto-present
appears only when every slide is ready or silent. After changing a script or
voice, generate the affected recordings again.

For common errors, including `api_key_id_used_as_api_key`, expired setup links,
missing tools, and disabled generation, see [troubleshooting](mcp/README.md#narration-troubleshooting).

When you ask Slidecraft to create another presentation, it finishes the deck and asks whether to **Load now** or **Keep for later**. The current presentation is not replaced automatically. The creation card includes **Download JSON** and **Show JSON backup**; on the configured cloud service, the complete deck is also saved to your signed-in account.
