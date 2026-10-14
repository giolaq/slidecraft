import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FileStore } from "../src/narration/store.js";
import { FileAssets } from "../src/narration/assets.js";
import { NarrationService } from "../src/narration/service.js";
import { Vault, digest } from "../src/narration/crypto.js";
import { ProviderError, type Provider } from "../src/narration/provider.js";
import { checkDeck } from "../views/slide-studio/schema.js";
import { inputHash } from "../src/narration/model.js";
import {
  NarrationPlayer,
  type AudioPort,
  type PlaybackState,
} from "../views/slide-studio/narration-player.js";
const deck = () =>
  checkDeck({
    version: 1,
    id: "test",
    revision: 0,
    syncToken: "a".repeat(64),
    title: "Narration",
    theme: { mode: "dark", accent: "#ffffff" },
    narration: { voiceId: "voice", modelId: "model", settings: {} },
    slides: [
      {
        id: "one",
        title: "One",
        layout: "cover",
        narration: { script: "Hello there." },
      },
      {
        id: "two",
        title: "Two",
        layout: "cover",
        narration: { mode: "silent", script: "", silentDurationMs: 1000 },
      },
    ],
  });
async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const dir = await mkdtemp(join(tmpdir(), "slidecraft-narration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const provider: Provider = {
    catalog: async () => ({
      voices: [{ id: "voice", name: "Test voice" }],
      models: [{ id: "model", name: "Test model", limit: 10000 }],
    }),
    generate: async () => {
      calls++;
      return { bytes: Buffer.from("test audio"), durationMs: 1200 };
    },
  };
  const vault = new Vault(randomBytes(32)),
    store = new FileStore(dir + "/state.json"),
    assets = new FileAssets(dir + "/audio");
  const service = new NarrationService(store, assets, provider, vault);
  const connect = async (owner = "alice") => {
    const ticket = await service.beginConnection(owner);
    await service.connect(owner, ticket, "private-provider-key");
  };
  await connect();
  return {
    dir,
    service,
    provider,
    vault,
    store,
    assets,
    connect,
    calls: () => calls,
  };
}
test("key encryption, single-use account-bound setup, cross-user job/audio isolation", async (t) => {
  const f = await fixture(t),
    ticket = await f.service.beginConnection("alice");
  await assert.rejects(
    f.service.connect("mallory", ticket, "key"),
    /Connection link expired or already used/,
  );
  await f.service.connect("alice", ticket, "secret");
  await assert.rejects(
    f.service.connect("alice", ticket, "secret"),
    /Connection link expired or already used/,
  );
  assert.ok(
    !(await readFile(f.dir + "/state.json", "utf8")).includes("secret"),
  );
  const job = await f.service.generate("alice", deck());
  await f.service.tick();
  await assert.rejects(f.service.job("mallory", job.id), /Not found/);
  const asset = (await f.service.manifest("alice", deck()))[0].assetId!;
  await assert.rejects(f.service.playbackToken("mallory", asset), /Not found/);
  const grant = await f.service.playbackToken("alice", asset);
  assert.equal(
    Buffer.from(await f.service.audio(grant)).toString(),
    "test audio",
  );
  await assert.rejects(
    f.service.audio(
      f.vault.seal({ owner: "alice", assetId: asset, expires: 0 }),
    ),
    /expired/,
  );
  await assert.rejects(f.service.audio(grant.slice(0, -3) + "xxx"));
});
test("durable queue deduplicates, restarts, caches identical speech and preserves clips after disconnect", async (t) => {
  const f = await fixture(t),
    d = deck();
  const [a, b] = await Promise.all([
    f.service.generate("alice", d),
    f.service.generate("alice", d),
  ]);
  assert.equal(a.id, b.id);
  const restarted = new NarrationService(
    new FileStore(f.dir + "/state.json"),
    f.assets,
    f.provider,
    f.vault,
  );
  await restarted.tick();
  assert.equal(f.calls(), 1);
  assert.equal((await restarted.manifest("alice", d))[0].status, "ready");
  const visual = structuredClone(d);
  visual.revision++;
  visual.slides[0].title = "New title";
  assert.equal(inputHash(d, d.slides[0]), inputHash(visual, visual.slides[0]));
  await restarted.generate("alice", visual);
  await restarted.tick();
  assert.equal(f.calls(), 1);
  await restarted.disconnect("alice");
  assert.equal((await restarted.manifest("alice", visual))[0].status, "ready");
  await assert.rejects(restarted.generate("alice", visual), /Connect/);
  const changed = structuredClone(visual);
  changed.revision++;
  changed.slides[0].narration!.script = "Different";
  assert.equal(
    (await restarted.manifest("alice", changed))[0].status,
    "missing",
  );
  assert.equal((await restarted.saved("alice")).length, 1);
  assert.equal((await restarted.saved("bob")).length, 0);
});
test("old worker results never overwrite edited scripts or revision", async (t) => {
  const f = await fixture(t);
  let resolve!: (value: { bytes: Uint8Array; durationMs: number }) => void;
  f.provider.generate = () =>
    new Promise((r) => {
      resolve = r;
    });
  const d = deck();
  await f.service.generate("alice", d);
  const work = f.service.tick();
  while (!resolve) await new Promise((r) => setTimeout(r, 1));
  const next = structuredClone(d);
  next.revision++;
  next.slides[0].narration!.script = "Changed while generating";
  await f.service.save("alice", next);
  resolve({ bytes: Buffer.from("audio"), durationMs: 50 });
  await work;
  assert.equal((await f.service.manifest("alice", next))[0].status, "missing");
  const saved = await f.service.saved("alice");
  assert.equal((await f.service.reopen("alice", saved[0].key)).revision, 1);
});
test("interrupted paid requests require explicit retry; rate limits have bounded automatic retries", async (t) => {
  const f = await fixture(t);
  f.provider.generate = async () => {
    throw new ProviderError("Unknown billing outcome", false, true);
  };
  const j = await f.service.generate("alice", deck());
  await f.service.tick();
  assert.equal(
    (await f.service.job("alice", j.id)).items[0].status,
    "uncertain",
  );
  await assert.rejects(f.service.generate("alice", deck()), /unknown billing/);
  const retry = await f.service.generate("alice", deck(), undefined, true);
  f.provider.generate = async () => {
    throw new ProviderError("Rate limited", true);
  };
  for (let n = 0; n < 3; n++) {
    await f.service.tick();
    await f.store.transaction((s) => {
      s.jobs[retry.id].items[0].retryAt = 0;
    });
  }
  assert.equal(
    (await f.service.job("alice", retry.id)).items[0].status,
    "failed",
  );
});
test("expired worker lease becomes uncertain, cancellation blocks queued work, account deletion revokes audio", async (t) => {
  const f = await fixture(t);
  const j = await f.service.generate("alice", deck());
  await f.store.transaction((s) => {
    const i = s.jobs[j.id].items[0];
    i.status = "generating";
    i.lease = 0;
  });
  await f.service.tick();
  assert.equal(
    (await f.service.job("alice", j.id)).items[0].status,
    "uncertain",
  );
  assert.equal(f.calls(), 0);
  const retry = await f.service.generate("alice", deck(), undefined, true);
  await f.service.cancel("alice", retry.id);
  await f.service.tick();
  assert.equal(f.calls(), 0);
  await f.service.generate("alice", deck(), undefined, true);
  await f.service.tick();
  const id = (await f.service.manifest("alice", deck()))[0].assetId!;
  const token = await f.service.playbackToken("alice", id);
  await f.service.deleteNarration("alice");
  await assert.rejects(f.service.audio(token), /Not found/);
  assert.equal(await f.service.connected("alice"), false);
  assert.deepEqual(await f.service.saved("alice"), []);
});
function playerFixture() {
  let state: PlaybackState = "manual",
    message = "",
    selected = "one",
    released = 0;
  const audios: AudioPort[] = [];
  const p = new NarrationPlayer(
    [
      { slideId: "one", status: "ready", assetId: "a" },
      { slideId: "two", status: "ready", assetId: "b" },
    ],
    0,
    {
      audio: () => {
        const a: AudioPort = {
          src: "",
          volume: 1,
          currentTime: 0,
          onended: null,
          onerror: null,
          play: async () => {},
          pause: () => {},
        };
        audios.push(a);
        return a;
      },
      load: async (id) => "blob:" + id,
      release: () => {
        released++;
      },
      select: (id) => {
        selected = id;
      },
      ready: async () => {},
      changed: (s, m) => {
        state = s;
        message = m;
      },
    },
  );
  return {
    p,
    audios,
    state: () => state,
    message: () => message,
    selected: () => selected,
    released: () => released,
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
test("playback advances on ended exactly once; stale events, manual navigation, replay, pause and final slide", async () => {
  const f = playerFixture();
  await f.p.start();
  assert.equal(f.state(), "playing");
  const oldEnded = f.audios[0].onended!;
  oldEnded(new Event("ended"));
  oldEnded(new Event("ended"));
  await settle();
  assert.equal(f.selected(), "two");
  assert.equal(f.audios.length, 2);
  f.p.pause();
  assert.equal(f.state(), "paused");
  await f.p.start();
  assert.equal(f.audios.length, 2);
  f.p.manual(0);
  oldEnded(new Event("ended"));
  assert.equal(f.selected(), "one");
  assert.equal(f.state(), "paused");
  await f.p.start(1, true);
  f.audios.at(-1)!.onended!(new Event("ended"));
  assert.equal(f.state(), "ended");
  assert.equal(f.selected(), "two");
  f.p.stop();
  assert.equal(f.state(), "manual");
});
test("autoplay rejection is visible and resumable; stale loading cannot start after exit", async () => {
  const f = playerFixture();
  await f.p.start();
  f.audios[0].play = async () => {
    throw new DOMException("User gesture required", "NotAllowedError");
  };
  f.p.pause();
  await f.p.start();
  assert.equal(f.state(), "blocked");
  assert.match(f.message(), /Resume/);
  f.audios[0].play = async () => {};
  await f.p.start();
  assert.equal(f.state(), "playing");
  f.p.stop();
  let resolve!: (url: string) => void;
  let played = 0,
    released = 0;
  const p = new NarrationPlayer(
    [{ slideId: "one", status: "ready", assetId: "a" }],
    0,
    {
      audio: () => ({
        src: "",
        volume: 1,
        currentTime: 0,
        onended: null,
        onerror: null,
        play: async () => {
          played++;
        },
        pause: () => {},
      }),
      load: () =>
        new Promise((r) => {
          resolve = r;
        }),
      release: () => {
        released++;
      },
      select: () => {},
      ready: async () => {},
      changed: () => {},
    },
  );
  const start = p.start();
  await settle();
  p.stop();
  resolve("blob:late");
  await start;
  assert.equal(played, 0);
  assert.equal(released, 1);
});
test("silent slides pause their remaining dwell time", async () => {
  let state: PlaybackState = "manual";
  const p = new NarrationPlayer(
    [{ slideId: "one", status: "silent", durationMs: 80 }],
    0,
    {
      audio: () => {
        throw new Error("No audio for silent slides");
      },
      load: async () => "",
      release: () => {},
      select: () => {},
      ready: async () => {},
      changed: (s) => {
        state = s;
      },
    },
  );
  await p.start();
  await new Promise((r) => setTimeout(r, 30));
  p.pause();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(state, "paused");
  await p.start();
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(state, "ended");
  p.stop();
});
test(
  "PostgreSQL serializes concurrent workers and persists across connections",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { PostgresStore } = await import("../src/narration/store.js");
    const url = process.env.TEST_DATABASE_URL!;
    const f = await fixture(t),
      a = new PostgresStore(url);
    await a.transaction((s) => {
      Object.assign(s, {
        connections: {},
        decks: {},
        assets: {},
        jobs: {},
        tickets: {},
      });
    });
    const b = new PostgresStore(url);
    t.after(async () => {
      await a.close();
      await b.close();
    });
    const first = new NarrationService(a, f.assets, f.provider, f.vault),
      second = new NarrationService(b, f.assets, f.provider, f.vault);
    await first.connect("alice", await first.beginConnection("alice"), "key");
    const [j, k] = await Promise.all([
      first.generate("alice", deck()),
      second.generate("alice", deck()),
    ]);
    assert.equal(j.id, k.id);
    await Promise.all([first.tick(), second.tick()]);
    assert.equal(f.calls(), 1);
    assert.equal((await second.manifest("alice", deck()))[0].status, "ready");
    const saved = await second.saved("alice");
    const restored = await second.reopen("alice", saved[0].key);
    assert.equal(
      inputHash(restored, restored.slides[0]),
      inputHash(deck(), deck().slides[0]),
    );
    await b.transaction((s) => {
      for (const asset of Object.values(s.assets)) asset.created = 0;
    });
    await second.cleanup();
    assert.equal((await second.manifest("alice", restored))[0].status, "ready");
  },
);
test("explicit regeneration creates a new recording; cleanup preserves saved references and retries failed deletes", async (t) => {
  const f = await fixture(t),
    d = deck();
  await f.service.generate("alice", d);
  await f.service.tick();
  const old = (await f.service.manifest("alice", d))[0].assetId!;
  await f.service.generate("alice", d, undefined, false, true);
  assert.equal((await f.service.manifest("alice", d))[0].status, "queued");
  await f.service.tick();
  const fresh = (await f.service.manifest("alice", d))[0].assetId!;
  assert.notEqual(old, fresh);
  assert.equal(f.calls(), 2);
  await f.store.transaction((s) => {
    s.assets[old].created = 0;
  });
  await f.service.cleanup();
  await assert.rejects(f.service.playbackToken("alice", old), /Not found/);
  assert.ok(await f.service.playbackToken("alice", fresh));
  const original = f.assets.delete.bind(f.assets);
  f.assets.delete = async () => {
    throw new Error("Temporary storage failure");
  };
  await assert.rejects(f.service.deleteNarration("alice"), /storage/);
  assert.ok((await f.store.transaction((s) => s.garbage))?.includes(fresh));
  f.assets.delete = original;
  await f.service.drainGarbage();
  assert.deepEqual(await f.store.transaction((s) => s.garbage), []);
});
test("persistent request ID prevents duplicate forced synthesis after completion", async (t) => {
  const f = await fixture(t),
    d = deck(),
    request = "fc92fba8-f544-4d7b-af8b-f22c33a59ba7";
  const first = await f.service.generate(
    "alice",
    d,
    undefined,
    false,
    true,
    request,
  );
  await f.service.tick();
  const repeated = await f.service.generate(
    "alice",
    d,
    undefined,
    false,
    true,
    request,
  );
  assert.equal(repeated.id, first.id);
  await f.service.tick();
  assert.equal(f.calls(), 1);
  const changed = structuredClone(d);
  changed.revision++;
  changed.slides[0].narration!.script = "Different input";
  await assert.rejects(
    f.service.generate("alice", changed, undefined, false, true, request),
    /different inputs/,
  );
});
