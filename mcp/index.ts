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
  version: "1.3.0",
  description:
    "Create, discuss, refine, and present animated HTML slide decks with an interactive studio.",
  instructions:
    "Use open-slides to open Slidecraft. Use create-deck for new decks, update-slide for focused revisions, edit-deck for structure, inspect-deck for critique context, and export-deck for HTML. Read the slidecraft skill when available. Tools are stateless: pass the latest complete deck, including id and revision, from the conversation or view state. Never claim a deck is stored on the server. Preserve unrelated slides and distinguish discussion from edits. When the studio is open, prefer the mounted change-visible-slide-colors tool to update the existing preview using its latest state. For a single slide, pass slideId to set-theme, or use update-slide with changes.colors. The mounted tool defaults to the selected slide; use scope=deck only for the whole presentation. Otherwise use set-theme for color changes: background sets the slide canvas, foreground sets title/text color, accent sets highlights. Use color fields for simple color changes; use deck.css for arbitrary typography, spacing, positioning, and styling. Edit tools automatically return a fresh preview. Only claim a change after a successful tool result; the new preview is authoritative and older cards are historical snapshots. Use revise-presentation for any edit: nested text, layouts, colors, notes, HTML/SVG/images, CSS, JavaScript, array items, deletion, duplication, reordering, or full presentation replacement. Use edit-visible-presentation when mounted to operate on current UI state. Custom CSS/JavaScript render in an isolated preview as well as HTML export.",
  websiteUrl: "https://github.com/giolaq/slidecraft",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["20x20"] }],
});
const hints = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const fail = (e: unknown) => ({
  isError: true as const,
  content: [
    { type: "text" as const, text: e instanceof Error ? e.message : String(e) },
  ],
});
function result(deck: Deck, message: string, selectedSlideId?: string) {
  message += ` Revision ${deck.revision}. Preview theme: ${JSON.stringify(deck.theme)}. See the updated preview returned by this tool; earlier cards do not change.`;
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
        `${d.title}: ${d.slides.length} slides, revision ${d.revision}. Download JSON to keep a copy.`,
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
      "Return a revised deck by adding, removing, or moving a slide, or changing title/theme. No shared server copy is mutated.",
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
