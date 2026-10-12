# Deck format, version 1

The source is JSON. The renderer produces plain HTML, CSS, and JavaScript with
no CDN dependencies. The stage is 1600×900 (16:9), scaled to the viewport.

```json
{
  "version": 1,
  "title": "A clear decision",
  "author": "Your name",
  "theme": { "mode": "dark", "accent": "#cbff73" },
  "slides": [{
    "id": "opening",
    "layout": "cover",
    "eyebrow": "Product strategy / October 2026",
    "title": "Build for the next conversation.",
    "body": "One supporting thought, with room to breathe.",
    "notes": "Explain the context here. Sources and rehearsal cues belong here too.",
    "motion": "rise"
  }]
}
```

Deck fields: `version` (must equal 1), `title`, `slides` (non-empty), optional
`author`, `subtitle` (metadata), `theme`, `css`, `script`. Theme supports `mode`
(`dark` or `light`) and a six-digit hex `accent`. With a light background, choose
a dark accent such as `#35621c` for readable small text.

Every slide needs a unique lowercase slug `id`, `title`, and `layout`. Optional
common fields: `eyebrow`, `body`, `notes`, `footer`, `motion`, `html`, `bullets`.
Text fields are plain text and escaped; `html` is intentionally raw HTML.
Body newlines are preserved. Titles and notes may contain Unicode.

| Layout | Content | Suggested use |
| --- | --- | --- |
| `cover` | title, body | Opening or closing |
| `split` | title, body, bullets or html | Argument next to supporting details |
| `statement` | title, body | One memorable assertion |
| `cards` | `cards: [{title, body}]` | 2–4 parallel ideas |
| `metrics` | `metrics: [{value, label}]` | 2–4 meaningful numbers |
| `timeline` | `steps: [{title, body}]` | 3–5 sequential steps |
| `custom` | `html` required | Inline SVG, diagrams, custom compositions |

Cards, metrics, and steps accept 1–6 items; fewer often look better. Layout
validation checks types and required fields, not visual fit. Keep standard
titles around 8–12 words and cover/statement titles around 5–10. If content does
not fit, split it or create a custom composition instead of shrinking all text.

Example custom slide:

```json
{
  "id": "feedback-loop",
  "layout": "custom",
  "title": "Every draft teaches us something.",
  "html": "<svg viewBox='0 0 1000 220' role='img' aria-label='Draft leads to review, which leads to refine'><g fill='none' stroke='currentColor' stroke-width='2'><rect x='10' y='40' width='250' height='120' rx='16'/><path d='M280 100h70l-12-8m12 8-12 8'/><rect x='370' y='40' width='250' height='120' rx='16'/><path d='M640 100h70l-12-8m12 8-12 8'/><rect x='730' y='40' width='250' height='120' rx='16'/></g><g fill='currentColor' font-family='Arial' font-size='30' text-anchor='middle'><text x='135' y='110'>Draft</text><text x='495' y='110'>Review</text><text x='855' y='110'>Refine</text></g></svg>",
  "motion": "fade"
}
```

Deck `css` is appended as a style element. Scope slide-specific rules by stable
ID, e.g. `#feedback-loop .custom-content { color: var(--accent); }`.
Deck `script` runs once after initialization. Use `window.slidecraft.current`,
`window.slidecraft.go('slide-id')`, `.next()`, and `.previous()`.
The `slidechange` window event exposes `{id, index}` in `event.detail`. Run initial
custom logic immediately as the first slide is already active when script runs.

Use embedded data URLs for images if a fully offline single-file export is
needed. External URLs remain external; relative asset paths are not served by
the local studio. Speaker notes are included in exported HTML, so remove private
notes before distributing a deck. Custom HTML/JavaScript is trusted code; the
editor preview uses an opaque-origin sandbox, while a standalone presentation
runs normally in the browser.
