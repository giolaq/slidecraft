import { z } from "zod";
const short = z.string().max(500),
  prose = z.string().max(8000);
const item = z.object({ title: short.min(1), body: prose.min(1) }).strict();
export const themeSchema = z
  .object({
    mode: z.enum(["dark", "light"]),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    background: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    foreground: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    muted: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    panel: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  })
  .strict();
export const slideColorsSchema = themeSchema.omit({ mode: true }).partial();
export const slideSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(80),
    layout: z.enum([
      "cover",
      "split",
      "statement",
      "cards",
      "metrics",
      "timeline",
      "custom",
    ]),
    colors: slideColorsSchema.optional(),
    title: short.min(1),
    eyebrow: short.optional(),
    body: prose.optional(),
    notes: prose.optional(),
    footer: short.optional(),
    motion: z.enum(["rise", "fade", "zoom", "slide", "none"]).optional(),
    bullets: z.array(short).max(8).optional(),
    cards: z.array(item).min(1).max(6).optional(),
    steps: z.array(item).min(1).max(6).optional(),
    metrics: z
      .array(z.object({ value: short.min(1), label: prose.min(1) }).strict())
      .min(1)
      .max(6)
      .optional(),
    html: z.string().max(24000).optional(),
  })
  .strict();
export const deckSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
    syncToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    title: short.min(1),
    subtitle: short.optional(),
    author: short.optional(),
    theme: themeSchema,
    slides: z.array(slideSchema).min(1).max(30),
    css: z.string().max(24000).optional(),
    script: z.string().max(24000).optional(),
  })
  .strict();
export const patchSchema = slideSchema.omit({ id: true }).partial();
export type Deck = z.infer<typeof deckSchema>;
export type Slide = z.infer<typeof slideSchema>;
export const deckResultSchema = z.object({
  deck: deckSchema,
  message: z.string(),
  selectedSlideId: z.string().optional(),
});
export function checkDeck(input: unknown): Deck {
  const deck = deckSchema.parse(input);
  if (JSON.stringify(deck).length > 180000)
    throw new Error(
      "Deck exceeds 180 KB. Split it into smaller presentations.",
    );
  const ids = new Set<string>();
  for (const s of deck.slides) {
    if (ids.has(s.id)) throw new Error(`Duplicate slide ID: ${s.id}`);
    ids.add(s.id);
    if (!s.title.trim()) throw new Error(`Slide ${s.id} needs a title.`);
    const field = (
      {
        cards: "cards",
        metrics: "metrics",
        timeline: "steps",
        custom: "html",
      } as Record<string, string>
    )[s.layout];
    if (field && !s[field as keyof Slide])
      throw new Error(
        `Slide ${s.id} requires ${field} for the ${s.layout} layout.`,
      );
  }
  return deck;
}
export function reviseSlide(
  deck: Deck,
  slideId: string,
  changes: z.infer<typeof patchSchema>,
  expectedRevision: number,
): Deck {
  checkDeck(deck);
  if (deck.revision !== expectedRevision)
    throw new Error(
      "Revision mismatch. Use the latest deck from the app context.",
    );
  if (!Object.keys(changes).length)
    throw new Error("Provide at least one field to change.");
  const i = deck.slides.findIndex((s) => s.id === slideId);
  if (i < 0) throw new Error(`Unknown slide: ${slideId}`);
  const next = structuredClone(deck);
  next.slides[i] = { ...next.slides[i], ...changes };
  next.revision++;
  return checkDeck(next);
}
