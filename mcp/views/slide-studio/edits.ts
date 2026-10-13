import { z } from "zod";
import { checkDeck, type Deck } from "./schema.js";
import jsonPatch from "fast-json-patch";
const path = z
  .string()
  .max(1000)
  .describe("JSON Pointer, e.g. /slides/1/title. Escape ~ as ~0 and / as ~1.");
export const editsSchema = z
  .array(
    z.discriminatedUnion("op", [
      z.object({ op: z.literal("add"), path, value: z.json() }),
      z.object({ op: z.literal("replace"), path, value: z.json() }),
      z.object({ op: z.literal("remove"), path }),
      z.object({ op: z.literal("move"), path, from: path }),
      z.object({ op: z.literal("copy"), path, from: path }),
      z.object({ op: z.literal("test"), path, value: z.json() }),
    ]),
  )
  .min(1)
  .max(200);
export function applyEdits(
  deck: Deck,
  expectedRevision: number,
  edits: z.infer<typeof editsSchema>,
): Deck {
  const original = checkDeck(deck);
  if (original.revision !== expectedRevision)
    throw new Error("Revision mismatch. Use the latest deck from view state.");
  const operations = editsSchema.parse(edits);
  // Apply the complete transaction to a clone; never partially mutate the input.
  const candidate = jsonPatch.applyPatch(
    structuredClone(original),
    operations,
    true,
    true,
    true,
  ).newDocument;
  if (
    candidate?.syncToken !== original.syncToken ||
    candidate?.id !== original.id ||
    candidate?.version !== original.version ||
    candidate?.revision !== original.revision
  )
    throw new Error(
      "Deck id, version, and revision are managed fields and cannot be edited.",
    );
  const next = checkDeck(candidate);
  if (JSON.stringify(next) === JSON.stringify(original))
    throw new Error(
      "No changes applied. The requested edits leave the presentation unchanged.",
    );
  next.revision++;
  return next;
}
