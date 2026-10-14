import { createHash } from "node:crypto";
import type { Deck, Slide } from "../../views/slide-studio/schema.js";
export const FORMAT = "mp3_44100_128";
export function inputHash(deck: Deck, slide: Slide) {
  if (!deck.narration || !slide.narration?.script.trim())
    throw new Error("Choose a voice and write a narration script.");
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        text: slide.narration.script.trim(),
        voice: deck.narration.voiceId,
        model: deck.narration.modelId,
        settings: {
          stability: deck.narration.settings.stability,
          similarity_boost: deck.narration.settings.similarity_boost,
          style: deck.narration.settings.style,
          use_speaker_boost: deck.narration.settings.use_speaker_boost,
        },
        format: FORMAT,
      }),
    )
    .digest("hex");
}
export interface Asset {
  id: string;
  owner: string;
  connectionVersion: string;
  hash: string;
  key: string;
  durationMs: number;
  created: number;
}
export interface JobItem {
  slideId: string;
  hash: string;
  script: string;
  status:
    "queued" | "generating" | "ready" | "failed" | "uncertain" | "cancelled";
  assetId?: string;
  error?: string;
  attempts: number;
  lease?: number;
  retryAt?: number;
}
export interface Job {
  id: string;
  owner: string;
  deckKey: string;
  connectionVersion: string;
  settings: NonNullable<Deck["narration"]>;
  items: JobItem[];
  created: number;
  cancelled: boolean;
  force?: boolean;
  requestId?: string;
  requestHash?: string;
}
export interface Connection {
  encryptedKey: string;
  version: string;
}
export interface State {
  connections: Record<string, Connection>;
  decks: Record<string, { owner: string; deck: Deck }>;
  assets: Record<string, Asset>;
  jobs: Record<string, Job>;
  garbage?: string[];
  pendingUploads?: Record<string, { owner: string; expires: number }>;
  tickets: Record<string, { owner: string; expires: number }>;
}
export const emptyState = (): State => ({
  connections: {},
  decks: {},
  assets: {},
  jobs: {},
  tickets: {},
});
export function deckKey(owner: string, deck: Deck) {
  return createHash("sha256")
    .update(JSON.stringify([owner, deck.id, deck.syncToken]))
    .digest("hex");
}
export function assertOwner<T extends { owner: string }>(
  record: T | undefined,
  owner: string,
): T {
  if (!record || record.owner !== owner) throw new Error("Not found.");
  return record;
}
