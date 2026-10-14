import { isDeepStrictEqual } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import { checkDeck, type Deck } from "../../views/slide-studio/schema.js";
import { type Store } from "./store.js";
import { type Assets } from "./assets.js";
import { type Provider, ProviderError } from "./provider.js";
import { Vault, digest } from "./crypto.js";
import {
  assertOwner,
  deckKey,
  inputHash,
  type State,
  type Job,
  type JobItem,
} from "./model.js";
export class ConnectionLinkError extends Error {}
export class NarrationService {
  constructor(
    public store: Store,
    public assets: Assets,
    public provider: Provider,
    public vault: Vault,
  ) {}
  async connected(owner: string) {
    return this.store.transaction((s) => !!s.connections[owner]);
  }
  async beginConnection(owner: string) {
    const token = randomBytes(32).toString("base64url");
    await this.store.transaction((s) => {
      for (const [key, t] of Object.entries(s.tickets))
        if (t.expires < Date.now()) delete s.tickets[key];
      s.tickets[digest(token)] = {
        owner,
        expires: Date.now() + 10 * 60 * 1000,
      };
    });
    return token;
  }
  async connect(owner: string, ticket: string, key: string) {
    // Validate ticket before the outbound request and consume atomically afterwards.
    await this.store.transaction((s) => {
      const t = s.tickets[digest(ticket)];
      if (!t || t.owner !== owner || t.expires < Date.now())
        throw new ConnectionLinkError("Connection link expired or already used. Open a new link from Slidecraft.");
    });
    await this.provider.catalog(key);
    await this.store.transaction((s) => {
      const t = s.tickets[digest(ticket)];
      if (!t || t.owner !== owner || t.expires < Date.now())
        throw new ConnectionLinkError("Connection link expired or already used. Open a new link from Slidecraft.");
      delete s.tickets[digest(ticket)];
      s.connections[owner] = {
        encryptedKey: this.vault.seal(key),
        version: randomUUID(),
      };
      this.cancelOwner(s, owner);
    });
  }
  private cancelOwner(s: State, owner: string) {
    for (const j of Object.values(s.jobs))
      if (j.owner === owner) {
        j.cancelled = true;
        for (const i of j.items)
          if (i.status === "queued") i.status = "cancelled";
      }
  }
  async disconnect(owner: string) {
    await this.store.transaction((s) => {
      delete s.connections[owner];
      this.cancelOwner(s, owner);
    });
  }
  async catalog(owner: string) {
    const c = await this.store.transaction((s) => s.connections[owner]);
    if (!c) throw new Error("Connect your ElevenLabs account first.");
    return this.provider.catalog(this.vault.open<string>(c.encryptedKey));
  }
  async save(owner: string, deck: Deck) {
    checkDeck(deck);
    return this.store.transaction((s) => {
      const key = deckKey(owner, deck),
        existing = s.decks[key];
      if (existing && existing.deck.revision > deck.revision)
        throw new Error(
          "Saved deck has a newer revision. Reopen it before editing.",
        );
      if (
        existing &&
        existing.deck.revision === deck.revision &&
        !isDeepStrictEqual(existing.deck, JSON.parse(JSON.stringify(deck)))
      )
        throw new Error("Revision conflict in saved narration deck.");
      s.decks[key] = { owner, deck };
      return key;
    });
  }
  async saved(owner: string) {
    return this.store.transaction((s) =>
      Object.entries(s.decks)
        .filter(([, d]) => d.owner === owner)
        .map(([key, d]) => ({
          key,
          title: d.deck.title,
          revision: d.deck.revision,
        })),
    );
  }
  async reopen(owner: string, key: string) {
    return this.store.transaction((s) => assertOwner(s.decks[key], owner).deck);
  }
  async generate(
    owner: string,
    deck: Deck,
    selected?: string[],
    retryUncertain = false,
    force = false,
    requestId?: string,
  ) {
    if (!deck.narration)
      throw new Error("Choose narration voice and model first.");
    const requestHash = digest(
      JSON.stringify({
        key: deckKey(owner, deck),
        force,
        slides: deck.slides
          .filter(
            (sl) =>
              (!selected || selected.includes(sl.id)) &&
              sl.narration?.mode !== "silent",
          )
          .map((sl) => [sl.id, inputHash(deck, sl)]),
      }),
    );
    const previous = requestId
      ? await this.store.transaction((s) =>
          Object.values(s.jobs).find(
            (j) => j.owner === owner && j.requestId === requestId,
          ),
        )
      : undefined;
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new Error(
          "Generation request ID was reused for different inputs.",
        );
      return previous;
    }
    const catalog = await this.catalog(owner),
      model = catalog.models.find((m) => m.id === deck.narration!.modelId);
    if (!catalog.voices.some((v) => v.id === deck.narration!.voiceId) || !model)
      throw new Error("Choose an available voice and speech model.");
    const slides = deck.slides.filter(
      (sl) => !selected || selected.includes(sl.id),
    );
    if (
      !slides.length ||
      selected?.some((id) => !deck.slides.some((sl) => sl.id === id))
    )
      throw new Error("Unknown slide selection.");
    for (const sl of slides)
      if (
        sl.narration?.mode !== "silent" &&
        (!sl.narration?.script.trim() ||
          sl.narration.script.trim().length > Math.min(10000, model.limit))
      )
        throw new Error(
          `Slide ${sl.id} needs a script within the model character limit (${Math.min(10000, model.limit)}), or mark it silent.`,
        );
    const key = await this.save(owner, deck);
    return this.store.transaction((s) => {
      const replay = requestId
        ? Object.values(s.jobs).find(
            (j) => j.owner === owner && j.requestId === requestId,
          )
        : undefined;
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new Error(
            "Generation request ID was reused for different inputs.",
          );
        return replay;
      }
      const connection = s.connections[owner];
      if (!connection) throw new Error("Reconnect ElevenLabs.");
      const active = Object.values(s.jobs).find(
        (j) =>
          j.owner === owner &&
          j.deckKey === key &&
          j.requestHash === requestHash &&
          j.items.some(
            (i) => i.status === "queued" || i.status === "generating",
          ),
      );
      if (s.decks[key]?.deck.revision !== deck.revision)
        throw new Error(
          "Deck changed before generation. Review the latest revision.",
        );
      if (active) return active; // Double clicks and concurrent panes share the same job.
      const items: JobItem[] = slides
        .filter((sl) => sl.narration?.mode !== "silent")
        .map((sl) => {
          const hash = inputHash(deck, sl);
          const asset = force
            ? undefined
            : Object.values(s.assets).find(
                (a) =>
                  a.owner === owner &&
                  a.connectionVersion === connection.version &&
                  a.hash === hash,
              );
          const uncertain = Object.values(s.jobs).some(
            (j) =>
              j.owner === owner &&
              j.connectionVersion === connection.version &&
              j.items.some((i) => i.hash === hash && i.status === "uncertain"),
          );
          if (uncertain && !asset && !retryUncertain)
            throw new Error(
              "A previous request has an unknown billing outcome. Review ElevenLabs usage, then explicitly retry uncertain slides.",
            );
          return {
            slideId: sl.id,
            hash,
            script: sl.narration!.script.trim(),
            status: asset ? "ready" : "queued",
            assetId: asset?.id,
            attempts: 0,
          };
        });
      const job: Job = {
        id: randomUUID(),
        owner,
        deckKey: key,
        connectionVersion: connection.version,
        settings: deck.narration!,
        items,
        created: Date.now(),
        cancelled: false,
        force,
        requestId,
        requestHash,
      };
      s.jobs[job.id] = job;
      return job;
    });
  }
  async activeJob(owner: string, deck: Deck) {
    return this.store.transaction(
      (s) =>
        Object.values(s.jobs).find(
          (j) =>
            j.owner === owner &&
            j.deckKey === deckKey(owner, deck) &&
            j.items.some(
              (i) => i.status === "queued" || i.status === "generating",
            ),
        )?.id,
    );
  }
  async job(owner: string, id: string) {
    return this.store.transaction((s) => assertOwner(s.jobs[id], owner));
  }
  async cancel(owner: string, id: string) {
    return this.store.transaction((s) => {
      const j = assertOwner(s.jobs[id], owner);
      j.cancelled = true;
      for (const i of j.items)
        if (i.status === "queued") i.status = "cancelled";
      return j;
    });
  }
  async manifest(owner: string, deck: Deck, persist = true) {
    if (persist) await this.save(owner, deck);
    return this.store.transaction((s) =>
      deck.slides.map((sl) => {
        if (sl.narration?.mode === "silent")
          return {
            slideId: sl.id,
            status: "silent",
            durationMs: sl.narration.silentDurationMs,
          };
        if (!sl.narration?.script.trim() || !deck.narration)
          return { slideId: sl.id, status: "missing" };
        const hash = inputHash(deck, sl);
        // Previously generated clips remain usable after disconnect/replacement, owner scoped.
        const a = Object.values(s.assets)
          .filter((a) => a.owner === owner && a.hash === hash)
          .sort((a, b) => b.created - a.created)[0];
        const j = Object.values(s.jobs)
          .filter(
            (j) => j.owner === owner && j.deckKey === deckKey(owner, deck),
          )
          .sort((a, b) => b.created - a.created)
          .flatMap((j) => j.items)
          .find((i) => i.slideId === sl.id && i.hash === hash);
        if (
          a &&
          !["queued", "generating", "failed", "uncertain"].includes(
            j?.status ?? "",
          )
        )
          return {
            slideId: sl.id,
            status: "ready",
            assetId: a.id,
            durationMs: a.durationMs,
          };
        return {
          slideId: sl.id,
          status: j?.status === "ready" ? "missing" : (j?.status ?? "missing"),
          error: j?.error,
          assetId: a?.id,
          durationMs: a?.durationMs,
        };
      }),
    );
  }
  async playbackToken(owner: string, assetId: string) {
    await this.store.transaction((s) => assertOwner(s.assets[assetId], owner));
    return this.vault.seal({
      owner,
      assetId,
      expires: Date.now() + 15 * 60 * 1000,
    });
  }
  async audio(token: string) {
    const t = this.vault.open<{
      owner: string;
      assetId: string;
      expires: number;
    }>(token);
    if (t.expires < Date.now()) throw new Error("Playback link expired.");
    const a = await this.store.transaction((s) =>
      assertOwner(s.assets[t.assetId], t.owner),
    );
    return this.assets.get(a.key);
  }
  async deleteNarration(owner: string, key?: string) {
    // Cancel first; in-flight results check ownership and cancellation before attachment.
    await this.store.transaction((s) => {
      if (key) assertOwner(s.decks[key], owner);
      for (const [id, j] of Object.entries(s.jobs))
        if (j.owner === owner && (!key || j.deckKey === key)) {
          j.cancelled = true;
          for (const i of j.items)
            if (i.status === "queued") i.status = "cancelled";
          delete s.jobs[id];
        }
      for (const [id, d] of Object.entries(s.decks))
        if (d.owner === owner && (!key || id === key)) delete s.decks[id];
      const referenced = new Set(
        Object.values(s.decks)
          .filter((d) => d.owner === owner)
          .flatMap((d) =>
            d.deck.slides
              .filter(
                (sl) =>
                  sl.narration?.mode !== "silent" &&
                  sl.narration?.script.trim() &&
                  d.deck.narration,
              )
              .map((sl) => inputHash(d.deck, sl)),
          ),
      );
      const assets = Object.values(s.assets).filter(
        (a) => a.owner === owner && !referenced.has(a.hash),
      );
      for (const a of assets) delete s.assets[a.id];
      if (!key) {
        delete s.connections[owner];
        for (const [id, pending] of Object.entries(s.pendingUploads ?? {}))
          if (pending.owner === owner) {
            (s.garbage ??= []).push(id);
            delete s.pendingUploads![id];
          }
        for (const [id, t] of Object.entries(s.tickets))
          if (t.owner === owner) delete s.tickets[id];
      }
      s.garbage = [...(s.garbage ?? []), ...assets.map((a) => a.key)];
      return assets;
    });
    await this.drainGarbage();
  }
  async drainGarbage() {
    const keys = await this.store.transaction((s) =>
      (s.garbage ?? []).slice(0, 100),
    );
    for (const key of keys) {
      await this.assets.delete(key);
      await this.store.transaction((s) => {
        s.garbage = (s.garbage ?? []).filter((k) => k !== key);
      });
    }
  }
  async cleanup() {
    await this.store.transaction((s) => {
      const referenced = new Set(
        Object.values(s.decks).flatMap((d) =>
          d.deck.slides
            .filter(
              (sl) =>
                sl.narration?.mode !== "silent" &&
                sl.narration?.script.trim() &&
                d.deck.narration,
            )
            .map((sl) => JSON.stringify([d.owner, inputHash(d.deck, sl)])),
        ),
      );
      const newest = new Map<string, string>();
      for (const a of Object.values(s.assets).sort(
        (a, b) => b.created - a.created,
      )) {
        const key = JSON.stringify([a.owner, a.hash]);
        if (!newest.has(key)) newest.set(key, a.id);
      }
      for (const [id, pending] of Object.entries(s.pendingUploads ?? {}))
        if (pending.expires < Date.now()) {
          (s.garbage ??= []).push(id);
          delete s.pendingUploads![id];
        }
      const cutoff = Date.now() - 7 * 86400000;
      for (const [id, a] of Object.entries(s.assets))
        if (
          a.created < cutoff &&
          (!referenced.has(JSON.stringify([a.owner, a.hash])) ||
            newest.get(JSON.stringify([a.owner, a.hash])) !== a.id)
        ) {
          (s.garbage ??= []).push(a.key);
          delete s.assets[id];
        }
      for (const [id, j] of Object.entries(s.jobs))
        if (
          j.created < Date.now() - 30 * 86400000 &&
          j.items.every((i) =>
            ["ready", "cancelled", "failed"].includes(i.status),
          )
        )
          delete s.jobs[id];
      for (const [id, t] of Object.entries(s.tickets))
        if (t.expires < Date.now()) delete s.tickets[id];
    });
    await this.drainGarbage();
  }
  async tick() {
    const task = await this.store.transaction((s) => {
      const now = Date.now();
      for (const j of Object.values(s.jobs))
        for (const i of j.items)
          if (i.status === "generating" && (i.lease ?? 0) < now) {
            i.status = "uncertain";
            i.error =
              "Worker interrupted. Check ElevenLabs usage before retrying.";
          }
      const busy = new Set(
        Object.values(s.jobs)
          .filter((j) => j.items.some((i) => i.status === "generating"))
          .map((j) => j.owner),
      );
      for (const j of Object.values(s.jobs)) {
        if (j.cancelled || busy.has(j.owner)) continue;
        const c = s.connections[j.owner];
        if (!c || c.version !== j.connectionVersion) {
          j.cancelled = true;
          for (const i of j.items)
            if (i.status === "queued") i.status = "cancelled";
          continue;
        }
        const i = j.items.find(
          (i) => i.status === "queued" && (i.retryAt ?? 0) <= now,
        );
        if (!i) continue;
        const cached = j.force
          ? undefined
          : Object.values(s.assets).find(
              (a) =>
                a.owner === j.owner &&
                a.connectionVersion === j.connectionVersion &&
                a.hash === i.hash,
            );
        if (cached) {
          i.status = "ready";
          i.assetId = cached.id;
          continue;
        }
        i.status = "generating";
        i.attempts++;
        i.lease = now + 5 * 60 * 1000;
        return { job: j, item: i, encryptedKey: c.encryptedKey };
      }
      return null;
    });
    if (!task) return false;
    const { job, item } = task;
    let assetId: string | undefined;
    try {
      const audio = await this.provider.generate(
        this.vault.open<string>(task.encryptedKey),
        item.script,
        job.settings,
      );
      assetId = randomUUID();
      await this.store.transaction((s) => {
        (s.pendingUploads ??= {})[assetId!] = {
          owner: job.owner,
          expires: Date.now() + 3600000,
        };
      });
      await this.assets.put(assetId, audio.bytes);
      const id = assetId;
      const attached = await this.store.transaction((s) => {
        const j = s.jobs[job.id],
          i = j?.items.find((i) => i.slideId === item.slideId);
        if (!j || !i || i.status !== "generating" || i.lease !== item.lease)
          return false;
        if (
          j.cancelled ||
          s.connections[j.owner]?.version !== j.connectionVersion
        ) {
          i.status = "cancelled";
          return false;
        }
        delete s.pendingUploads?.[id];
        // Results are separate immutable assets. No stale worker ever rewrites a deck.
        s.assets[id] = {
          id,
          owner: j.owner,
          connectionVersion: j.connectionVersion,
          hash: item.hash,
          key: id,
          durationMs: audio.durationMs,
          created: Date.now(),
        };
        i.status = "ready";
        i.assetId = id;
        return true;
      });
      if (!attached) {
        await this.store.transaction((s) => {
          (s.garbage ??= []).push(id);
          delete s.pendingUploads?.[id];
        });
        await this.drainGarbage();
      }
    } catch (e) {
      if (assetId) await this.assets.delete(assetId).catch(() => {});
      await this.store.transaction((s) => {
        const j = s.jobs[job.id],
          i = j?.items.find((i) => i.slideId === item.slideId);
        if (!i || i.status !== "generating" || i.lease !== item.lease) return;
        const error =
          e instanceof ProviderError
            ? e
            : new ProviderError(
                "Generation or storage failed after submission. Check usage before retrying.",
                false,
                true,
              );
        i.error = error.message;
        i.status = j.cancelled
          ? "cancelled"
          : error.uncertain
            ? "uncertain"
            : error.retryable && i.attempts < 3
              ? "queued"
              : "failed";
        i.retryAt = Date.now() + Math.min(60000, 5000 * 2 ** i.attempts);
      });
    }
    return true;
  }
}
