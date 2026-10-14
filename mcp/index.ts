import { importPhoto } from "./src/import-photo.js";
import { latestDeck, publishDeck } from "./src/live-decks.js";
import { applyEdits, editsSchema } from "./views/slide-studio/edits.js";
import { MCPServer } from "mcp-use";
import { z } from "zod";
import {
  checkDeck,
  deckSchema,
  deckResultSchema,
  patchSchema,
  reviseSlide,
  slideSchema,
  slideColorsSchema,
  themeSchema,
  type Deck,
} from "./views/slide-studio/schema.js";
import demo from "./src/demo.json" with { type: "json" };
import { render } from "./src/render.js";

const server = new MCPServer({
  name: "slidecraft",
  title: "Slidecraft",
  version: "1.7.0",
  description:
    "Create, discuss, refine, and present animated HTML slide decks with an interactive studio.",
  instructions:
    "Use open-slides to open Slidecraft. Use create-deck for new decks, update-slide for focused revisions, edit-deck for structure, inspect-deck for critique context, and export-deck for HTML. Read the slidecraft skill when available. Pass the latest complete deck, including id, revision, and syncToken. Live sessions share revisions for up to 24 hours on this server instance; this is not durable storage. Read get-live-deck before editing an older conversation snapshot or after a conflict. Never drop or change syncToken when revising a deck. Preserve unrelated slides and distinguish discussion from edits. When the studio is open, prefer the mounted change-visible-slide-colors tool to update the existing preview using its latest state. For a single slide, pass slideId to set-theme, or use update-slide with changes.colors. The mounted tool defaults to the selected slide; use scope=deck only for the whole presentation. Otherwise use set-theme for color changes: background sets the slide canvas, foreground sets title/text color, accent sets highlights. Use color fields for simple color changes; use deck.css for arbitrary typography, spacing, positioning, and styling. Edit tools automatically return a fresh preview. Only claim a change after a successful tool result; connected studios automatically reload the shared revision; do not ask the user to import JSON for an edit. For photos use add-photo to embed an optimized image; do not put markdown image syntax in plain-text fields or use local/sandbox file paths as image URLs. An arbitrary external HTML image may be blocked by host CSP. Use revise-presentation for any edit: nested text, layouts, colors, notes, HTML/SVG/images, CSS, JavaScript, array items, deletion, duplication, reordering, or full presentation replacement. Use edit-visible-presentation when mounted to operate on current UI state. Slides with elements use a freeform visual canvas: edit /slides/INDEX/elements/INDEX/text, color, x, y, width, height, fontSize, bold, src or fit using revise-presentation. On these slides title/body are metadata; editing them does not change visible elements. Elements use a 1600 by 900 canvas and array order is stacking order. Preserve elements when editing. Custom CSS/JavaScript render in an isolated preview as well as HTML export.",
  websiteUrl: "https://github.com/giolaq/slidecraft",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["20x20"] }],
});
// Read-only bearer-capability endpoint for panes whose host tool bridge is unavailable.
server.app.use("/api/live-deck", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  c.header("Cache-Control", "no-store");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});
server.app.post("/api/live-deck", (c) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token))
    return c.json({ error: "A live session token is required." }, 401);
  try {
    return c.json({ deck: latestDeck(token) });
  } catch {
    return c.json({ error: "Live sync is temporarily unavailable." }, 503);
  }
});

const hints = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};
const fail = (e: unknown) => ({
  isError: true as const,
  content: [
    { type: "text" as const, text: e instanceof Error ? e.message : String(e) },
  ],
});
function result(
  deck: Deck,
  message: string,
  selectedSlideId?: string,
  opening = false,
) {
  deck = publishDeck(deck, opening);
  message += ` Revision ${deck.revision}. Preview theme: ${JSON.stringify(deck.theme)}. Connected studios automatically load this revision.`;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      deck,
      message,
      ...(selectedSlideId ? { selectedSlideId } : {}),
    },
  };
}
export const openSlides = server.tool(
  {
    name: "open-slides",
    title: "Slidecraft studio",
    description:
      "Open the interactive slide studio. Omit deck for a working demo, or pass the complete latest deck.",
    inputSchema: z.object({ deck: deckSchema.optional() }),
    outputSchema: deckResultSchema,
    annotations: hints,
    icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["20x20"] }],
    view: {
      name: "slide-studio",
      description:
        "Animated slides, outline, content editing, speaker notes, export, and an agent revision prompt.",
      prefersBorder: false,
      entrypoints: [{ type: "global" }, { type: "thread" }],
    },
  },
  ({ deck }) => {
    try {
      const d = checkDeck(deck ?? demo);
      return result(
        d,
        "Opened the current live deck. Download JSON to keep a copy.",
        undefined,
        true,
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const createDeck = server.tool(
  {
    name: "create-deck",
    view: { name: "created-slides", prefersBorder: false },
    title: "Create presentation",
    description:
      "Validate a new presentation from authored slides. Returns the complete deck and displays its preview.",
    inputSchema: z.object({
      title: z.string().min(1).max(500),
      author: z.string().max(500).optional(),
      slides: z.array(slideSchema).min(1).max(30),
      theme: themeSchema.optional(),
      css: z.string().max(24000).optional(),
      script: z.string().max(24000).optional(),
    }),
    outputSchema: deckResultSchema,
    annotations: hints,
  },
  (args) => {
    try {
      return result(
        checkDeck({
          ...args,
          version: 1,
          id: crypto.randomUUID(),
          revision: 0,
          theme: args.theme ?? { mode: "dark", accent: "#cbff73" },
        }),
        "Created a new deck and returned its preview.",
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const updateSlide = server.tool(
  {
    name: "update-slide",
    view: { name: "revised-slides", prefersBorder: false },
    title: "Revise one slide",
    description:
      "Shallow-merge fields into one slide by stable ID, preserving unrelated slides. Arrays replace previous values. Pass the complete latest deck and revision.",
    inputSchema: z.object({
      deck: deckSchema,
      slideId: z.string(),
      expectedRevision: z.number().int().nonnegative(),
      changes: patchSchema,
    }),
    outputSchema: deckResultSchema,
    annotations: hints,
  },
  ({ deck, slideId, expectedRevision, changes }) => {
    try {
      return result(
        reviseSlide(deck, slideId, changes, expectedRevision),
        `Updated ${slideId}.`,
        slideId,
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const editDeck = server.tool(
  {
    name: "edit-deck",
    view: { name: "edited-slides", prefersBorder: false },
    title: "Edit presentation structure",
    description:
      "Return a revised deck by adding, removing, or moving a slide, or changing title/theme. Connected studios automatically reload the revised shared deck.",
    inputSchema: z.object({
      deck: deckSchema,
      expectedRevision: z.number().int().nonnegative(),
      operation: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("add"),
          slide: slideSchema,
          position: z.number().int().min(0),
        }),
        z.object({ type: z.literal("remove"), slideId: z.string() }),
        z.object({
          type: z.literal("move"),
          slideId: z.string(),
          position: z.number().int().min(0),
        }),
        z.object({ type: z.literal("theme"), theme: themeSchema }),
        z.object({
          type: z.literal("title"),
          title: z.string().min(1).max(500),
        }),
      ]),
    }),
    outputSchema: deckResultSchema,
    annotations: hints,
  },
  ({ deck, expectedRevision, operation: op }) => {
    try {
      const next = structuredClone(checkDeck(deck));
      if (next.revision !== expectedRevision)
        throw new Error("Revision mismatch. Use the latest deck.");
      if (op.type === "add") {
        if (op.position > next.slides.length)
          throw new Error("Position is beyond the deck.");
        next.slides.splice(op.position, 0, op.slide);
      }
      if (op.type === "remove" || op.type === "move") {
        const i = next.slides.findIndex((s) => s.id === op.slideId);
        if (i < 0) throw new Error("Unknown slide ID.");
        if (op.type === "move" && op.position >= next.slides.length)
          throw new Error("Position is beyond the deck.");
        const [s] = next.slides.splice(i, 1);
        if (op.type === "move") next.slides.splice(op.position, 0, s);
      }
      if (op.type === "theme") next.theme = op.theme;
      if (op.type === "title") next.title = op.title;
      next.revision++;
      return result(checkDeck(next), `Applied ${op.type} to the deck.`);
    } catch (e) {
      return fail(e);
    }
  },
);
export const setTheme = server.tool(
  {
    name: "set-theme",
    title: "Change slide colors",
    description:
      "Change colors of one slide (supply slideId) or the presentation (omit slideId), and immediately show the affected slide. background is the slide canvas color; foreground is title/text; accent is highlights; muted is supporting text; panel is cards. Use six-digit hex colors. Supply only fields to change; unrelated slides and fields are preserved. A slide override takes precedence over the presentation palette. mode is presentation-wide only. Pass the latest complete deck from view state.",
    inputSchema: z.object({
      deck: deckSchema,
      expectedRevision: z.number().int().nonnegative(),
      colors: themeSchema.partial(),
      slideId: z
        .string()
        .optional()
        .describe(
          "Stable slide ID when changing ONE slide. Omit only for presentation-wide changes.",
        ),
    }),
    outputSchema: deckResultSchema,
    annotations: hints,
    view: { name: "theme-preview", prefersBorder: false },
  },
  ({ deck, expectedRevision, colors, slideId }) => {
    try {
      const next = structuredClone(checkDeck(deck));
      if (next.revision !== expectedRevision)
        throw new Error(
          "Revision mismatch. Use the latest deck from view state.",
        );
      if (!Object.keys(colors).length)
        throw new Error("Specify at least one theme color or mode.");
      if (slideId) {
        const target = next.slides.find((s) => s.id === slideId);
        if (!target) throw new Error(`Unknown slide: ${slideId}`);
        const overrides = slideColorsSchema.parse(colors);
        target.colors = { ...target.colors, ...overrides };
      } else {
        next.theme = { ...next.theme, ...colors };
      }
      next.revision++;
      return result(
        checkDeck(next),
        `Applied colors ${JSON.stringify(colors)} to ${slideId ? `slide ${slideId}` : "the presentation"}.`,
        slideId,
      );
    } catch (e) {
      return fail(e);
    }
  },
);

export const revisePresentation = server.tool(
  {
    name: "revise-presentation",
    title: "Edit any part of a presentation",
    description:
      "Apply an atomic JSON Patch transaction to any editable part of the latest deck. Supports add, replace, remove, move, copy, test. Examples: replace /slides/1/title; add /slides/1/colors; replace /slides/1/bullets/0; remove /slides/1/notes; add /css for arbitrary styling; add /script for custom animation/interactivity; replace /slides with all new slides. Use custom slide html for SVG, images, charts, and freeform layouts. CSS targets exported .slide, .slide-content, h1, etc. CSS and JS are previewed in an isolated frame. To duplicate, copy a slide then replace its id in the SAME transaction. Array indices are zero-based; add /slides/- appends. Required fields must remain valid; id/version/revision are managed. Preserve unrelated content. Never claim success after an error. Returns a fresh preview focused on selectedSlideId when supplied.",
    inputSchema: z.object({
      deck: deckSchema,
      expectedRevision: z.number().int().nonnegative(),
      edits: editsSchema,
      selectedSlideId: z.string().optional(),
    }),
    outputSchema: deckResultSchema,
    annotations: hints,
    view: { name: "presentation-preview", prefersBorder: false },
  },
  ({ deck, expectedRevision, edits, selectedSlideId }) => {
    try {
      const next = applyEdits(deck, expectedRevision, edits);
      if (selectedSlideId && !next.slides.some((s) => s.id === selectedSlideId))
        throw new Error(
          "The selected slide does not exist in the revised presentation.",
        );
      const affectedIndex = edits
        .map((edit) => /^\/slides\/(\d+)(?:\/|$)/.exec(edit.path))
        .find(Boolean)?.[1];
      const focus =
        selectedSlideId ??
        (affectedIndex !== undefined
          ? next.slides[Number(affectedIndex)]?.id
          : undefined);
      return result(next, `Applied ${edits.length} edit operations.`, focus);
    } catch (e) {
      return fail(e);
    }
  },
);

export const addPhoto = server.tool(
  {
    name: "add-photo",
    title: "Add a visible photo to a slide",
    description:
      "Download and embed an optimized photo so it displays in the studio and exported HTML without an external image request. Supply a direct public HTTPS JPEG/PNG/WebP/GIF URL or base64 image data. Web page URLs and private-network URLs are rejected. Replaces the target slide image; preserves other slide content. Do not claim a photo was added unless this tool succeeds. Use image.alt to describe the actual photo. Use update-slide to change image caption/fit or revise-presentation to remove /slides/INDEX/image.",
    inputSchema: z.object({
      deck: deckSchema,
      expectedRevision: z.number().int().nonnegative(),
      slideId: z.string(),
      source: z.string().max(11_000_000),
      alt: z.string().min(1).max(500),
      caption: z.string().max(500).optional(),
      fit: z.enum(["contain", "cover"]).default("contain"),
    }),
    outputSchema: deckResultSchema,
    annotations: { ...hints, openWorldHint: true },
    view: { name: "photo-preview", prefersBorder: false },
  },
  async ({ deck, expectedRevision, slideId, source, alt, caption, fit }) => {
    try {
      if (deck.revision !== expectedRevision)
        throw new Error("Revision mismatch. Read the latest live deck.");
      if (!deck.slides.some((s) => s.id === slideId))
        throw new Error("Unknown slide ID.");
      const src = await importPhoto(source);
      return result(
        reviseSlide(
          deck,
          slideId,
          deck.slides.find((s) => s.id === slideId)?.elements
            ? {
                elements: [
                  ...deck.slides.find((s) => s.id === slideId)!.elements!,
                  {
                    id: "photo-" + crypto.randomUUID().slice(0, 8),
                    type: "image" as const,
                    src,
                    text: alt,
                    x: 800,
                    y: 250,
                    width: 700,
                    height: 500,
                    color: "#ffffff",
                    fontSize: 40,
                    bold: false,
                    fit,
                  },
                ],
              }
            : { image: { src, alt, caption, fit } },
          expectedRevision,
        ),
        "Embedded the optimized photo in the slide.",
        slideId,
      );
    } catch (e) {
      return fail(e);
    }
  },
);

export const getLiveDeck = server.tool(
  {
    name: "get-live-deck",
    title: "Read latest live deck",
    description:
      "Read the latest shared revision using the syncToken from a deck. Use after a revision conflict. Connected studios poll this automatically; no JSON import is required. Tokens are private bearer capabilities: do not invent or reveal them outside deck data.",
    inputSchema: z.object({ syncToken: z.string().regex(/^[a-f0-9]{64}$/) }),
    outputSchema: z.object({ deck: deckSchema.nullable() }),
    annotations: { ...hints, readOnlyHint: true },
  },
  ({ syncToken }) => {
    try {
      const deck = latestDeck(syncToken);
      return {
        content: [
          {
            type: "text" as const,
            text: deck
              ? `Latest revision ${deck.revision}.`
              : "Live session expired or server restarted. Reopen the latest deck to resume.",
          },
        ],
        structuredContent: { deck },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

export const inspectDeck = server.tool(
  {
    name: "inspect-deck",
    title: "Inspect presentation",
    description:
      "Read titles, layouts, notes, word counts, and density warnings without changing the deck.",
    inputSchema: z.object({ deck: deckSchema }),
    outputSchema: z.object({
      title: z.string(),
      revision: z.number(),
      slides: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          layout: z.string(),
          notes: z.string(),
          wordCount: z.number(),
        }),
      ),
      warnings: z.array(z.string()),
    }),
    annotations: hints,
  },
  ({ deck }) => {
    try {
      const d = checkDeck(deck);
      const slides = d.slides.map((s) => ({
        id: s.id,
        title: s.title,
        layout: s.layout,
        notes: s.notes ?? "",
        wordCount: [
          s.title,
          s.body,
          ...(s.bullets ?? []),
          ...(s.cards ?? []).flatMap((c) => [c.title, c.body]),
          ...(s.steps ?? []).flatMap((c) => [c.title, c.body]),
          ...(s.metrics ?? []).flatMap((c) => [c.value, c.label]),
        ]
          .filter(Boolean)
          .join(" ")
          .split(/\s+/).length,
      }));
      const warnings = slides
        .filter((s) => s.wordCount > 100)
        .map((s) => `${s.id}: ${s.wordCount} words; consider splitting it.`);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ slides, warnings }) },
        ],
        structuredContent: {
          title: d.title,
          revision: d.revision,
          slides,
          warnings,
        },
      };
    } catch (e) {
      return fail(e);
    }
  },
);
export const exportDeck = server.tool(
  {
    name: "export-deck",
    title: "Export presentation",
    description:
      "Generate standalone animated HTML or editable JSON. File bytes are in view-only metadata; use the studio export buttons to download. Notes are included in JSON and optional in HTML.",
    inputSchema: z.object({
      deck: deckSchema,
      format: z.enum(["html", "json"]).default("html"),
      includeNotes: z.boolean().default(false),
    }),
    outputSchema: z.object({
      filename: z.string(),
      mimeType: z.string(),
      bytes: z.number(),
    }),
    annotations: hints,
  },
  ({ deck, format, includeNotes }) => {
    try {
      const d = structuredClone(checkDeck(deck));
      if (format === "html" && !includeNotes)
        d.slides.forEach((s) => delete s.notes);
      const fileText =
        format === "html" ? render(d) : JSON.stringify(d, null, 2);
      const filename =
        (d.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "presentation") +
        (format === "html" ? ".html" : ".deck.json");
      return {
        content: [
          {
            type: "text" as const,
            text: `Prepared ${filename}. Download using the Slidecraft studio. No server-side file is retained.`,
          },
        ],
        structuredContent: {
          filename,
          mimeType: format === "html" ? "text/html" : "application/json",
          bytes: Buffer.byteLength(fileText),
        },
        _meta: { fileText },
      };
    } catch (e) {
      return fail(e);
    }
  },
);
server.prompt(
  {
    name: "plan-presentation",
    description: "Start a focused presentation brief.",
    schema: z.object({
      topic: z.string(),
      audience: z.string().optional(),
      minutes: z.string().optional(),
    }),
  },
  ({ topic, audience, minutes }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Use Slidecraft for a presentation about ${topic}. Audience: ${audience ?? "ask me"}. Duration: ${minutes ?? "ask me"} minutes. Clarify the desired decision, draft a narrative, create slides with notes, and preview using open-slides. Do not invent evidence.`,
        },
      },
    ],
  }),
);
export default server;
