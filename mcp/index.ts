import { validateNarrationEmotion } from "./views/slide-studio/narration-writing.js";
import {
  oauth,
  config as narrationConfig,
  enabled as narrationEnabled,
  requireNarration,
  requireOwner,
} from "./src/narration/config.js";
import { registerNarrationRoutes } from "./src/narration/routes.js";
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

const narrationCsp = narrationConfig
  ? {
      connectDomains: [narrationConfig.origin],
      resourceDomains: [narrationConfig.origin, "blob:"],
    }
  : {};
const serverOptions = {
  name: "slidecraft",
  title: "Slidecraft",
  version: "1.9.5",
  description:
    "Create, discuss, refine, and present animated HTML slide decks with an interactive studio.",
  instructions:
    "Use open-slides to open Slidecraft. Use create-deck for new decks, update-slide for focused revisions, edit-deck for structure, inspect-deck for critique context, and export-deck for HTML. Read the slidecraft skill when available. Pass the latest complete deck, including id, revision, and syncToken. Live sessions share revisions for up to 24 hours on this server instance. When narration is configured, narration-enabled decks are additionally saved per authenticated user and can be reopened with list-narrated-decks and reopen-narrated-deck. Read get-live-deck before editing an older conversation snapshot or after a conflict. Never drop or change syncToken when revising a deck. Preserve unrelated slides and distinguish discussion from edits. When the studio is open, prefer the mounted change-visible-slide-colors tool to update the existing preview using its latest state. For a single slide, pass slideId to set-theme, or use update-slide with changes.colors. The mounted tool defaults to the selected slide; use scope=deck only for the whole presentation. Otherwise use set-theme for color changes: background sets the slide canvas, foreground sets title/text color, accent sets highlights. Use color fields for simple color changes; use deck.css for arbitrary typography, spacing, positioning, and styling. Edit tools automatically return a fresh preview. Only claim a change after a successful tool result; connected studios automatically reload the shared revision; do not ask the user to import JSON for an edit. For photos use add-photo to embed an optimized image; do not put markdown image syntax in plain-text fields or use local/sandbox file paths as image URLs. An arbitrary external HTML image may be blocked by host CSP. Use revise-presentation for any edit: nested text, layouts, colors, notes, HTML/SVG/images, CSS, JavaScript, array items, deletion, duplication, reordering, or full presentation replacement. Use edit-visible-presentation when mounted to operate on current UI state. Slides with elements use a freeform visual canvas: edit /slides/INDEX/elements/INDEX/text, color, x, y, width, height, fontSize, bold, src or fit using revise-presentation. On these slides title/body are metadata; editing them does not change visible elements. Elements use a 1600 by 900 canvas and array order is stacking order. Preserve elements when editing. Custom CSS/JavaScript render in an isolated preview as well as HTML export.",
  websiteUrl: "https://github.com/giolaq/slidecraft",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["20x20"] }],
};
const server = oauth
  // Hosts need the catalog before linking an account. No tool declares noauth,
  // so mixed discovery still requires verified OAuth for every tool invocation.
  ? new MCPServer({ ...serverOptions, oauth, mixedAuth: true })
  : new MCPServer(serverOptions);
registerNarrationRoutes(server.app);
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
async function result(
  deck: Deck,
  message: string,
  selectedSlideId?: string,
  opening = false,
  auth?: unknown,
) {
  deck = publishDeck(deck, opening);
  if (
    narrationEnabled &&
    auth &&
    (deck.narration || deck.slides.some((s) => s.narration))
  )
    await requireNarration().save(requireOwner(auth), deck);
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
      csp: narrationCsp,
      name: "slide-studio",
      description:
        "Animated slides, outline, content editing, speaker notes, export, and an agent revision prompt.",
      prefersBorder: false,
      entrypoints: [{ type: "global" }, { type: "thread" }],
    },
  },
  async ({ deck }, ctx) => {
    try {
      const d = checkDeck(deck ?? demo);
      return await result(
        d,
        "Opened the current live deck. Download JSON to keep a copy.",
        undefined,
        true,
        ctx.auth,
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const createDeck = server.tool(
  {
    name: "create-deck",
    view: { csp: narrationCsp, name: "created-slides", prefersBorder: false },
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
  async (args, ctx) => {
    try {
      return await result(
        checkDeck({
          ...args,
          version: 1,
          id: crypto.randomUUID(),
          revision: 0,
          theme: args.theme ?? { mode: "dark", accent: "#cbff73" },
        }),
        "Created a new deck and returned its preview.",
        undefined,
        false,
        ctx.auth,
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const updateSlide = server.tool(
  {
    name: "update-slide",
    view: { csp: narrationCsp, name: "revised-slides", prefersBorder: false },
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
  async ({ deck, slideId, expectedRevision, changes }, ctx) => {
    try {
      return await result(
        reviseSlide(deck, slideId, changes, expectedRevision),
        `Updated ${slideId}.`,
        slideId,
        false,
        ctx.auth,
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const editDeck = server.tool(
  {
    name: "edit-deck",
    view: { csp: narrationCsp, name: "edited-slides", prefersBorder: false },
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
  async ({ deck, expectedRevision, operation: op }, ctx) => {
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
      return await result(
        checkDeck(next),
        `Applied ${op.type} to the deck.`,
        undefined,
        false,
        ctx.auth,
      );
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
    view: { csp: narrationCsp, name: "theme-preview", prefersBorder: false },
  },
  async ({ deck, expectedRevision, colors, slideId }, ctx) => {
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
      return await result(
        checkDeck(next),
        `Applied colors ${JSON.stringify(colors)} to ${slideId ? `slide ${slideId}` : "the presentation"}.`,
        slideId,
        false,
        ctx.auth,
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
    view: {
      csp: narrationCsp,
      name: "presentation-preview",
      prefersBorder: false,
    },
  },
  async ({ deck, expectedRevision, edits, selectedSlideId }, ctx) => {
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
      return await result(
        next,
        `Applied ${edits.length} edit operations.`,
        focus,
        false,
        ctx.auth,
      );
    } catch (e) {
      return fail(e);
    }
  },
);

export const saveNarrationScript = server.tool(
  {
    name: "save-narration-script",
    title: "Save narration into the slide studio",
    description: "After Write Narration, save the written script into the selected slide's Narration script field. This server tool works even when widget tools are unavailable. Use the deck reference and expectedScript supplied by the writing request. Resolves the latest live deck, preserves every other field and slide, and rejects concurrent script changes. Never generates audio or spends credits. Do not merely print the script in chat: call this tool to save it.",
    inputSchema: z.object({
      deck: z.object({ id: z.string(), syncToken: z.string().regex(/^[a-f0-9]{64}$/) }),
      slideId: z.string(),
      script: z.string().trim().min(1).max(10000),
      expectedScript: z.string().max(10000),
      requireEmotionTags: z.boolean().default(false),
    }),
    outputSchema: deckResultSchema,
    annotations: hints,
  },
  async ({ deck: reference, slideId, script, expectedScript, requireEmotionTags }, ctx) => {
    try {
      const current = latestDeck(reference.syncToken);
      if (!current || current.id !== reference.id)
        throw new Error("The live presentation is unavailable. Reopen the deck and use a fresh Write Narration request.");
      const index = current.slides.findIndex(s => s.id === slideId);
      if (index < 0) throw new Error("The requested slide no longer exists.");
      if (requireEmotionTags) validateNarrationEmotion(script, current.narration?.modelId ?? "eleven_multilingual_v2");
      const existing = current.slides[index].narration;
      if ((existing?.script ?? "") !== expectedScript)
        throw new Error("This slide's script changed while narration was being written. Read the latest deck and ask before replacing those changes.");
      const next = applyEdits(current, current.revision, [{
        op: "add", path: `/slides/${index}/narration`, value: {
          ...existing, mode: "speech", script, silentDurationMs: existing?.silentDurationMs ?? 5000,
        },
      }]);
      return await result(next, "Narration script saved. The open studio will display it automatically.", slideId, false, ctx.auth);
    } catch (error) {
      return fail(error);
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
    view: { csp: narrationCsp, name: "photo-preview", prefersBorder: false },
  },
  async (
    { deck, expectedRevision, slideId, source, alt, caption, fit },
    ctx,
  ) => {
    try {
      if (deck.revision !== expectedRevision)
        throw new Error("Revision mismatch. Read the latest live deck.");
      if (!deck.slides.some((s) => s.id === slideId))
        throw new Error("Unknown slide ID.");
      const src = await importPhoto(source);
      return await result(
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
        false,
        ctx.auth,
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
      if (format === "html") {
        delete d.narration;
        d.slides.forEach((s) => delete s.narration);
      }
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
// Narration tools require verified OAuth identity. A syncToken never grants billing access.
const narrationInput = z.object({
  deck: deckSchema,
  snapshot: z.boolean().default(false),
});
const narrationOutput = z.object({ data: z.unknown() });
const narrationResult = (data: unknown, message = "Narration updated.") => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: { data },
});
function currentNarrationDeck(deck: Deck) {
  const latest = deck.syncToken ? latestDeck(deck.syncToken) : null;
  if (latest && latest.revision !== deck.revision)
    throw new Error(
      "Revision conflict. Read the latest deck before narration actions.",
    );
  return checkDeck(latest ?? deck);
}
export const narrationStatus = server.tool(
  {
    name: "get-narration-status",
    description:
      "Read connection and per-slide narration readiness. Never generates paid audio.",
    inputSchema: narrationInput,
    outputSchema: narrationOutput,
    annotations: { readOnlyHint: true },
  },
  async ({ deck, snapshot }, ctx) => {
    try {
      if (!narrationEnabled)
        return narrationResult(
          { enabled: false, connected: false, slides: [] },
          "Narration requires server configuration.",
        );
      const owner = requireOwner(ctx.auth),
        service = requireNarration();
      return narrationResult({
        enabled: true,
        connected: await service.connected(owner),
        jobId: await service.activeJob(owner, deck),
        slides: await service.manifest(
          owner,
          snapshot ? deck : currentNarrationDeck(deck),
          false,
        ),
      });
    } catch (e) {
      return fail(e);
    }
  },
);
export const beginNarrationConnection = server.tool(
  {
    name: "begin-narration-connection",
    description:
      "Open a secure external page to connect the signed-in user's ElevenLabs API key. Never request keys in chat or tool arguments.",
    inputSchema: z.object({}),
    outputSchema: narrationOutput,
  },
  async (_, ctx) => {
    try {
      const ticket = await requireNarration().beginConnection(
        requireOwner(ctx.auth),
      );
      return {
        ...narrationResult(
          { opened: true },
          "Open the private connection link in the widget.",
        ),
        _meta: {
          url: narrationConfig!.origin + "/narration/connect?ticket=" + ticket,
        },
      };
    } catch (e) {
      return fail(e);
    }
  },
);
export const disconnectNarration = server.tool(
  {
    name: "disconnect-narration",
    description:
      "Disconnect your ElevenLabs account and cancel pending generation. Saved recordings remain available.",
    inputSchema: z.object({}),
    outputSchema: narrationOutput,
  },
  async (_, ctx) => {
    try {
      await requireNarration().disconnect(requireOwner(ctx.auth));
      return narrationResult({ connected: false });
    } catch (e) {
      return fail(e);
    }
  },
);
export const listNarrationVoices = server.tool(
  {
    name: "list-narration-voices",
    description:
      "List voices and text-to-speech models available to your connected ElevenLabs account.",
    inputSchema: z.object({}),
    outputSchema: narrationOutput,
    annotations: { readOnlyHint: true },
  },
  async (_, ctx) => {
    try {
      return narrationResult(
        await requireNarration().catalog(requireOwner(ctx.auth)),
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const generateNarration = server.tool(
  {
    name: "generate-narration",
    description:
      "Generate paid narration ONLY after explicit user intent. Requires an editable script for every speech slide and configured voice. Existing matching clips are reused. Use a stable requestId UUID for retries of the same generation intent. retryUncertain confirms the user reviewed a previous unknown billing outcome and must use a fresh requestId.",
    inputSchema: z.object({
      deck: deckSchema,
      slideIds: z.array(z.string()).optional(),
      confirmGeneration: z.literal(true),
      retryUncertain: z.boolean().default(false),
      force: z.boolean().default(false),
      requestId: z.string().uuid().optional(),
    }),
    outputSchema: narrationOutput,
    annotations: { openWorldHint: true },
  },
  async ({ deck, slideIds, retryUncertain, force, requestId }, ctx) => {
    try {
      return narrationResult(
        await requireNarration().generate(
          requireOwner(ctx.auth),
          currentNarrationDeck(deck),
          slideIds,
          retryUncertain,
          force,
          requestId,
        ),
        "Narration job saved. Poll status before claiming audio is ready.",
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const getNarrationJob = server.tool(
  {
    name: "get-narration-job",
    description: "Read your durable narration job progress.",
    inputSchema: z.object({ jobId: z.string() }),
    outputSchema: narrationOutput,
    annotations: { readOnlyHint: true },
  },
  async ({ jobId }, ctx) => {
    try {
      return narrationResult(
        await requireNarration().job(requireOwner(ctx.auth), jobId),
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const cancelNarrationJob = server.tool(
  {
    name: "cancel-narration-job",
    description:
      "Cancel remaining narration. An already submitted slide may still incur ElevenLabs charges.",
    inputSchema: z.object({ jobId: z.string() }),
    outputSchema: narrationOutput,
  },
  async ({ jobId }, ctx) => {
    try {
      return narrationResult(
        await requireNarration().cancel(requireOwner(ctx.auth), jobId),
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const narrationPlayback = server.tool(
  {
    name: "get-narration-playback",
    description:
      "Authorize playback of your generated audio asset. Short-lived URLs are returned in view-only metadata; never export them.",
    inputSchema: z.object({ assetId: z.string().uuid() }),
    outputSchema: narrationOutput,
    annotations: { readOnlyHint: true },
  },
  async ({ assetId }, ctx) => {
    try {
      const grant = await requireNarration().playbackToken(
        requireOwner(ctx.auth),
        assetId,
      );
      return {
        ...narrationResult({ assetId }),
        _meta: {
          url:
            narrationConfig!.origin +
            "/narration/audio?grant=" +
            encodeURIComponent(grant),
        },
      };
    } catch (e) {
      return fail(e);
    }
  },
);
export const savedNarrationDecks = server.tool(
  {
    name: "list-narrated-decks",
    description:
      "List your durable saved narration decks, including after a server restart.",
    inputSchema: z.object({}),
    outputSchema: narrationOutput,
    annotations: { readOnlyHint: true },
  },
  async (_, ctx) => {
    try {
      return narrationResult(
        await requireNarration().saved(requireOwner(ctx.auth)),
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const reopenNarrationDeck = server.tool(
  {
    name: "reopen-narrated-deck",
    description:
      "Reopen one of your durable narrated decks by the key from list-narrated-decks.",
    inputSchema: z.object({ key: z.string() }),
    outputSchema: deckResultSchema,
    view: { csp: narrationCsp, name: "reopened-slides", prefersBorder: false },
  },
  async ({ key }, ctx) => {
    try {
      return await result(
        await requireNarration().reopen(requireOwner(ctx.auth), key),
        "Reopened your saved presentation.",
        undefined,
        true,
        ctx.auth,
      );
    } catch (e) {
      return fail(e);
    }
  },
);
export const deleteNarration = server.tool(
  {
    name: "delete-narration",
    description:
      "Delete saved narration for your deck key, or ALL your narration account data when key is omitted. This removes connection, scripts and unreferenced recordings for account deletion. Explicit confirmation required.",
    inputSchema: z.object({
      key: z.string().optional(),
      confirmDeletion: z.literal(true),
    }),
    outputSchema: narrationOutput,
    annotations: { destructiveHint: true },
  },
  async ({ key }, ctx) => {
    try {
      await requireNarration().deleteNarration(requireOwner(ctx.auth), key);
      return narrationResult({ deleted: true });
    } catch (e) {
      return fail(e);
    }
  },
);
export default server;
