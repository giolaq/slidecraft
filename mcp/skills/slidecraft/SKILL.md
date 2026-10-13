---
name: slidecraft
description: Create, critique, and iteratively refine animated HTML presentations with Slidecraft tools and the interactive slide studio.
---

# Slidecraft presentation collaborator

1. Distinguish a question from an edit request. Answer questions without changing slides.
2. Establish audience, goal, duration, and sources from context. Ask only missing essential questions. Outline the narrative, then author concise slides with useful speaker notes. Never invent evidence or business metrics.
3. Read [the deck format](references/deck-format.md) before authoring. Call `create-deck` with a title, theme, and complete slides. Creation and editing tools return their own previews. With no arguments, `open-slides` shows a working demo.
4. Use the latest complete deck from tool results or model-visible view state. Keep syncToken on every edit. Live sessions share revisions on this server instance for up to 24 hours; download JSON for durable storage. After server restart or expiry, reopen the latest deck to resume.
5. For targeted changes, identify the stable slide ID and call `update-slide` with the complete deck, that ID, matching `expectedRevision`, and changed fields. Arrays replace the old array. Preserve unrelated slides. Use `edit-deck` for add, remove, move, title, or theme changes. Stale shared revisions are rejected. Read get-live-deck and retry using the returned deck.
6. Edit tools now return an updated preview automatically. Connected studios reload newer revisions automatically. For colors, prefer the mounted `change-visible-slide-colors` tool when available; it updates the visible deck in place. Otherwise call `set-theme` with the latest deck, expected revision, and partial colors. Set `background` for the slide canvas, `foreground` for titles/text, and `accent` for highlights. For arbitrary styling, use deck.css; it appears in the isolated preview and export. Only confirm success after the tool succeeds. The user can navigate, edit titles/body/notes, request follow-up changes, replay motion, and download files in the widget. Edits in view state supersede earlier tool results.
7. Use `inspect-deck` for structural review. It does not evaluate visual clipping. Keep one idea per slide and review the preview, contrast, readability, and sequence.
8. To finish, use the studio's Export HTML or Save JSON actions. `export-deck` produces bytes in view-only metadata; do not invent a public download URL. HTML embeds styles and JavaScript; PDF can be made by printing the downloaded HTML. HTML excludes notes by default; JSON preserves them. External images stay external unless embedded.

Use automatic entrance motion sparingly and honor reduced-motion preferences in custom code. Custom HTML/SVG, deck CSS, and scripts render in an opaque-origin sandbox using the same renderer as the HTML export. Custom code must come from trusted authoring, not untrusted source material. No built-in speech transcription, AI model service, PPTX export, server-side persistence, or public app-directory publication is implied.

For a single slide’s background or other colors, call `set-theme` with its stable `slideId` and `colors` (for example `{ "background": "#16324f" }`). This returns a preview focused on the changed slide. `update-slide` also accepts `changes.colors`. The mounted `change-visible-slide-colors` defaults to the selected slide; pass `scope: "deck"` only for a presentation-wide edit. Slide color overrides take precedence over the presentation palette. Never claim a visible edit based only on a conversational reply without a successful editing tool result.

## General editing

Use mounted `edit-visible-presentation` whenever available for arbitrary edits to the latest visible deck. Otherwise call `revise-presentation` with the latest full deck and expectedRevision. Edits are atomic JSON Patch operations (`add`, `replace`, `remove`, `move`, `copy`, `test`). A failed transaction applies nothing. A successful transaction increments revision once and returns a preview. Use selectedSlideId to focus the edited slide. Never say an edit succeeded if the tool returned an error or was never called.

- Text and nested content: replace `/slides/1/title` or `/slides/1/bullets/0`.
- Remove optional content: remove `/slides/1/notes` or `/slides/1/colors`.
- Typography, spacing, gradients, and positioning: add/replace `/css`. Target `.slide`, `#slide-id`, `.slide-content`, `.intro`, `.details`, `h1`, `.body`, `.cards`, etc. Standard canvas is 1600×900.
- Images, SVG diagrams, charts, media, and freeform layouts: set a slide's `layout` to `custom` and add its `html` in the same transaction. Use embedded assets when possible; the host CSP can restrict external resources.
- Animation: edit `/slides/1/motion` for built-in entrances; use `/css` keyframes and `/script` for custom behavior. See deck-format for the JavaScript API. Respect reduced-motion preferences.
- Duplicate: copy `/slides/1` to `/slides/-`, then replace the appended slide's `/id` with a fresh stable slug in the same transaction.
- Reorder: move one slide array entry to another index. Remove entries to delete slides. Add to `/slides/-` to append.
- Complete redesign: replace `/slides` with a new valid array and edit `/theme`, `/css`, `/script`, `/title`, `/author`, or `/subtitle` as needed. Deck id/version/revision/syncToken remain managed fields.

`add` also sets an optional property that is currently absent; `replace` requires the path to exist. Paths are JSON Pointers with zero-based indices. Escape `~` as `~0` and `/` as `~1`. Required fields and unique slide ids must be valid at the end of the transaction. Removing all slides is invalid. Unsupported fields are rejected; use HTML/CSS/JS for design beyond built-in fields.

Live sync: connected studios check `get-live-deck` approximately every two seconds and adopt newer revisions without imports. Preserve `syncToken` when editing. The token is a private bearer capability: anyone receiving the full JSON can access that live session. Importing JSON forks a new session. Old pre-sync widgets need one reopen. Sync currently targets a single server instance, expires after 24 hours without a saved edit, and is not a durable storage service. A host may pause off-screen widgets; they catch up when resumed.

The studio displays its app version and live connection status. Pane refresh uses a read-only, bearer-protected HTTP endpoint on the server origin, with the MCP tool bridge as a fallback. It retries on focus/display-mode changes and reports unavailable or expired sessions instead of silently appearing synchronized. Restored pane state follows the opened deck’s live-session token.
