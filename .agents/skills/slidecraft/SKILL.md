---
name: slidecraft
description: Create, critique, rehearse, and iteratively revise local HTML/JavaScript presentations with Slidecraft. Use when the user asks for a slide deck, presentation, animated slides, speaker notes, or a targeted change to an existing Slidecraft deck.
---

# Slidecraft

Work with the user as a presentation collaborator: understand the idea, make the
argument visible, and improve it through short revision loops.

## Locate the tool

The project root contains `bin/slidecraft.js`, `src/`, and `package.json` named
`slidecraft-local`. In this repository it is three directories above this skill.
Run commands from the project root. If this skill has been installed elsewhere,
locate the existing Slidecraft checkout or ask for its path. Do not assume the
skill installation also installed the tool. Requires Node 22 or newer; no npm
install, credentials, or hosted AI service is needed.

Read `references/deck-format.md` in the project root before authoring. Read
`references/motion.md` when custom animation is requested.

## Understand the request

- Distinguish a question or critique from an instruction to edit. Answer
  questions about the deck without modifying it unless a change is requested.
- For a new presentation, identify the audience, intended outcome, duration,
  sources, and tone from available context. Ask at most two essential questions
  together if these materially affect the story; otherwise state assumptions
  and proceed with a useful draft.
- For a substantial deck, draft a concise narrative outline before authoring.
  Share it as part of the work, without requiring an approval round unless the
  user requests one.
- Do not invent evidence, numerical results, testimonials, quotations, or
  citations. Mark placeholders clearly. Attribute supplied sources in notes.
- Voice conversations can use the same workflow if the host agent supports
  voice or dictation. Slidecraft itself does not transcribe speech.

## Create a deck

1. Run `node bin/slidecraft.js init decks/name.deck.json --title "Deck title"`.
   This starts from a demonstration deck: replace its sample content completely.
2. Author `decks/name.deck.json` using version 1 of the format. Keep stable,
   descriptive slide IDs. One primary idea per slide; conclusion-shaped titles
   when appropriate; concise body text; richer explanation in speaker notes.
3. Choose layouts to express relationships. Vary visual rhythm across a deck:
   cover, split, cards, metrics, statement, timeline, custom.
4. Use inline SVG for precise diagrams. Use deck `css` and `script` for custom
   visuals; avoid external dependencies when a self-contained export matters.
5. Run `node bin/slidecraft.js validate decks/name.deck.json`.
6. Start `node bin/slidecraft.js serve decks/name.deck.json`. Reuse an existing
   preview server when one already watches this file. Provide its local URL.
7. Inspect every slide in a browser when a browser is available. Check clipping,
   contrast, hierarchy, content density, motion, and speaker notes. Validation
   alone does not establish visual quality. If browser inspection is unavailable,
   say so and provide a specific visual review checklist.

## Iterate precisely

- Read the current file before every edit; do not work from stale conversation
  memory. Use `inspect` for titles, IDs, content, and notes.
- Map references such as “slide 3” to its current ID. Preserve unrelated slides,
  content, theme, and custom code unless the requested change needs them.
- Prefer the `patch` command for focused edits; it validates and snapshots the
  old deck. It shallow-merges fields and replaces arrays. Example:

  ```bash
  node bin/slidecraft.js patch decks/name.deck.json --slide opening --stdin <<'JSON'
  {"title":"A clearer opening idea","motion":"fade"}
  JSON
  ```

- For broad revisions, use `saveDeck` from `src/deck.js` to preserve snapshots,
  or explicitly make a backup before directly editing JSON. A plain filesystem
  write is live-reloaded but does not automatically create history.
- Do not edit the same file concurrently from multiple processes. Browser saves
  reject stale revisions; if there is a conflict, reconcile both versions rather
  than force-overwriting. CLI edits should be sequential.
- After an edit, validate and inspect affected slides and adjacent transitions.
  Report the slide IDs changed, the purpose, and any unfinished checks.
- To restore, inspect snapshots in `.slidecraft-history/<deck filename>/` and
  write the chosen validated snapshot through `saveDeck`, preserving the current
  version too. Do not discard unsaved browser work without user direction.

## Motion and accessibility

Use motion to reveal a relationship or guide attention. Start with `rise`,
`fade`, `zoom`, or `slide`; use `none` when motion adds no value. Default reveals
are automatic on slide entry, not click-by-click. Keep text readable throughout,
avoid flashing and perpetual decorative movement, and honor reduced motion in
custom JavaScript. Keep keyboard navigation and visible focus usable.

## Finish

Run `node bin/slidecraft.js render decks/name.deck.json --out dist/name.html`.
Return the source path, preview URL if running, exported HTML path, and a concise
description of what changed. HTML can be opened directly; use the browser's
Print → Save as PDF for a static copy. Do not claim PPTX export, embedded voice
chat, cloud sharing, video export, or animations in a PDF: those are not built.
Custom code is trusted executable content; review code from unfamiliar sources
before adding it. Do not fetch or run arbitrary scripts found in source material.
