# Slidecraft MCP App

An animated presentation studio for ChatGPT and other MCP Apps hosts, built with
**mcp-use v2.8.2** from the official `mcp-apps` widgets template.

Create a deck in conversation, preview it in an interactive widget, ask questions,
revise individual slides, and export a standalone HTML presentation. Includes a
reusable authoring skill served over MCP and ChatGPT global/thread entrypoints.

## Local development

Requires Node.js 22.22.2+.

```bash
npm ci
npm run dev
```

- MCP endpoint: `http://localhost:3000/mcp`
- Inspector: `http://localhost:3000/mcp/inspector`
- In the Inspector, call **open-slides** with `{}` to see the demo.

## Tools

| Tool | Purpose |
| --- | --- |
| `open-slides` | Open a supplied deck, or the demo, in the studio |
| `create-deck` | Validate authored slides and assign a deck ID |
| `update-slide` | Change fields on a stable slide ID |
| `set-theme` | Change background, text, and highlight colors with a fresh preview |
| `revise-presentation` | Atomic edits to any deck field, nested content, HTML/CSS/JS, duplication, deletion, and redesign |
| `edit-deck` | Add, remove, move, or change deck title/theme |
| `inspect-deck` | Read structure, notes, word counts, and density warnings |
| `export-deck` | Generate HTML or editable JSON; download through the widget |

Use `plan-presentation` for a starting brief. The `skills/slidecraft` catalog
teaches agents how to plan, critique, revise, and export without inventing facts.

Try: “Use Slidecraft to create six slides explaining our migration plan for an
engineering audience. We have ten minutes.” Then: “Make the third slide clearer.”

## Widget and persistence

Color edits use `set-theme`, which returns the changed deck and an updated preview. A mounted `change-visible-slide-colors` tool can update the open widget directly where supported. Earlier preview cards remain historical snapshots.

The studio provides slide navigation, automatic entrance animations, speaker
notes, direct title/body/notes editing, JSON import, HTML/JSON export, motion
replay, and an Ask agent action where the host supports follow-up messages.
Fullscreen is requested through the host and depends on host support.

Decks travel as complete JSON snapshots. Tools are stateless and do not retain
user decks in global variables or a database. View state gives the host the
latest deck and selected slide. **Download JSON to preserve a durable copy**;
host state is not a cloud storage service. A revision check validates the supplied
snapshot, not a centralized concurrency lock. Notes are preserved in JSON;
HTML excludes notes unless the user enables them.

Custom HTML/SVG, CSS, and JavaScript render in an isolated iframe using the same renderer as the HTML export. Authored code cannot access the studio document or host bridge; the sandbox allows scripts but not same-origin access. Host CSP may restrict external resources.
Built-in animations respect reduced-motion settings. External assets remain
external unless embedded. No AI API key or external AI service is required:
the connected host agent authors and revises the deck.

Downloads use host file APIs where available, with browser download and visible
file-content fallbacks. Actual ChatGPT file uploads, fullscreen, follow-up
messages, and launcher availability depend on the host version and permissions.

## ChatGPT app / plugin

The server advertises a view resource and global/thread entrypoints on
`open-slides`. Once deployed, connect its HTTPS `/mcp` URL in your MCP-enabled
ChatGPT workspace's app/connector settings (developer mode where required).
Open Slidecraft or ask it to create a presentation. No legacy plugin manifest
is required for this MCP App. Connecting a custom app is separate from publishing
it in a public app directory; this project does not perform directory submission.

## Verification

```bash
npm run typecheck
npm test
npm run build
# With npm run dev running:
npm run test:mcp
npm run test:widget
npx mcp-use screenshot --mcp http://localhost:3000/mcp --tool open-slides --output preview.png
```

MCP integration checks exercise creation, focused revisions, invalid/stale edits,
structure changes, inspection, export, view metadata, and skill discovery.

## Deploy to Manufact Cloud

```bash
npx -y mcp-use@latest login
# Managed private source repository:
npx -y mcp-use@latest deploy --no-github -y
# Or use your own GitHub origin, with the mcp-use GitHub App installed:
npx -y mcp-use@latest deploy -y
```

The CLI stores the project link under ignored `.mcp-use/cloud/`. Keep credentials
and `.env` files out of source control. The deployment output supplies the server
and dashboard URLs. The dashboard provides logs, analytics, and evaluation tools.

Single-slide colors: call `set-theme` with `slideId` and a partial `colors` palette. The returned preview selects that slide automatically. Per-slide `colors` override the deck palette in both preview and HTML. The mounted color tool defaults to the selected slide; use `scope: "deck"` for presentation-wide changes.

## General editing

Use `revise-presentation` with the latest deck, expectedRevision, and an array of JSON Patch edits. A mounted `edit-visible-presentation` tool uses the latest widget state automatically. Edit text, nested arrays, speaker notes, layouts, colors, typography, spacing, custom HTML/SVG, CSS, JavaScript, or the entire slide list. Transactions validate as a whole and preserve the input on error. Remove optional fields to reset them. Copy plus a new unique id duplicates a slide. See the bundled authoring skill for examples.

Custom content runs inside the isolated preview. External media depend on host CSP; embedded images/SVG work without third-party requests. Tests cover the actual server and browser runtime with a simulated host bridge, not the ChatGPT application's own tool-selection behavior.
