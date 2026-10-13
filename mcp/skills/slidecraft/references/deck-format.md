# Deck format

A deck has `version: 1`, `id`, numeric `revision`, `title`, `theme: {mode, accent}`, and 1–30 `slides`. `create-deck` assigns id/revision. Every slide needs a unique lowercase slug `id`, `title`, and `layout`.

Layouts: `cover`, `statement`, `split` (often with `bullets`), `cards` (requires `cards: [{title,body}]`), `metrics` (requires `metrics: [{value,label}]`), `timeline` (requires `steps: [{title,body}]`), `custom` (requires `html`). Optional fields are `eyebrow`, `body`, `notes`, `footer`, and `motion` (`rise`, `fade`, `zoom`, `slide`, `none`). Text is plain text; `html` is markup. Prefer inline SVG for diagrams. Standard stage: 1600×900, 16:9.

Theme mode is `dark` or `light`. Accent and optional `background`, `foreground`, `muted`, and `panel` colors are six-digit hex values. These colors apply to both the widget and HTML export. Use `set-theme` for partial color changes that preserve the rest of the palette. Use a dark accent on light backgrounds. Aim for 5–12 words in titles and less than 100 visible words per slide. Most slides need much less.

Optional deck `css` and `script` customize both the isolated host preview and HTML export. Export JavaScript can call `window.slidecraft.go('slide-id')`, `.next()`, `.previous()`, and read `.current`; listen to the `slidechange` event for `{id,index}`. Check `matchMedia('(prefers-reduced-motion: reduce)').matches`. Scripts run after the initial slide is shown, so run initial custom logic explicitly. Avoid endless animation and keep meaningful static final states.

Updates return a complete new deck with incremented revision. Pass that complete deck into the next tool call. Live snapshots are kept on the server filesystem for up to 24 hours; they are not durable across server replacement. Import accepts the original local Slidecraft JSON format and fills missing id/revision fields.

Each slide optionally has `colors: { background, foreground, accent, muted, panel }`, with six-digit hex values. These override the presentation theme for that slide in the widget and HTML export.

Live sync: connected studios check `get-live-deck` approximately every two seconds and adopt newer revisions without imports. Preserve `syncToken` when editing. The token is a private bearer capability: anyone receiving the full JSON can access that live session. Importing JSON forks a new session. Old pre-sync widgets need one reopen. Sync currently targets a single server instance, expires after 24 hours without a saved edit, and is not a durable storage service. A host may pause off-screen widgets; they catch up when resumed.
