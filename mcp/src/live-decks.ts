import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDeck, type Deck } from "../views/slide-studio/schema.js";
// Session synchronization, not a durable deck library. No shared in-memory user state.
const folder = join(tmpdir(), "slidecraft-live-v1");
const ttl = 24 * 60 * 60 * 1000;
export function latestDeck(token: string): Deck | null {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Invalid live session token.");
  const file = join(folder, token + ".json");
  try {
    if (Date.now() - statSync(file).mtimeMs > ttl) {
      unlinkSync(file);
      return null;
    }
    return checkDeck(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export function publishDeck(input: Deck, opening = false): Deck {
  const next = checkDeck(input);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (!next.syncToken) {
    const files = readdirSync(folder);
    for (const name of files)
      if (
        /^[a-f0-9]{64}\.json$/.test(name) &&
        Date.now() - statSync(join(folder, name)).mtimeMs > ttl
      )
        unlinkSync(join(folder, name));
    if (readdirSync(folder).length >= 1000)
      throw new Error("Live session capacity reached. Try again later.");
    next.syncToken = randomBytes(32).toString("hex");
  }
  const current = latestDeck(next.syncToken);
  if (current) {
    if (current.id !== next.id)
      throw new Error("This live session belongs to another deck.");
    if (opening) return current;
    if (JSON.stringify(current) === JSON.stringify(next)) return current;
    if (next.revision !== current.revision + 1)
      throw new Error(
        `Live revision conflict: server is at revision ${current.revision}. Read get-live-deck with syncToken and retry from that deck.`,
      );
  }
  const file = join(folder, next.syncToken + ".json");
  writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return next;
}
