// Actual built widget + actual browser audio; deterministic provider/identity fixture.
// This does not claim to exercise ChatGPT's production sandbox or real ElevenLabs billing.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { FileStore } from "../src/narration/store.ts";
import { FileAssets } from "../src/narration/assets.ts";
import { Vault } from "../src/narration/crypto.ts";
import { NarrationService } from "../src/narration/service.ts";
const endpoint = process.argv[2] ?? "http://localhost:3017/mcp";
let serial = 0;
async function rpc(method, params = {}) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++serial, method, params }),
  });
  const raw = await r.text();
  const data = JSON.parse(
    raw.startsWith("event:")
      ? raw
          .split("\n")
          .find((l) => l.startsWith("data:"))
          .slice(5)
      : raw,
  );
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}
function wav(seconds) {
  const rate = 8000,
    count = seconds * rate,
    b = Buffer.alloc(44 + count * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(count * 2, 40);
  return b;
}
const dir = await mkdtemp(join(tmpdir(), "slidecraft-browser-narration-"));
let generationCalls = 0;
const service = new NarrationService(
  new FileStore(dir + "/state.json"),
  new FileAssets(dir + "/audio"),
  {
    catalog: async () => ({
      voices: [{ id: "test-voice", name: "Test narrator" }],
      models: [
        { id: "eleven_multilingual_v2", name: "Multilingual v2", limit: 10000 },
      ],
    }),
    generate: async () => {
      generationCalls++;
      return { bytes: wav(1), durationMs: 1000 };
    },
  },
  new Vault(randomBytes(32)),
);
await service.connect(
  "test-user",
  await service.beginConnection("test-user"),
  "fixture-key",
);
const initial = await rpc("tools/call", {
  name: "create-deck",
  arguments: {
    title: "Narration acceptance",
    slides: [
      {
        id: "one",
        title: "First slide",
        layout: "cover",
        motion: "none",
        notes: "Speaker notes stay separate.",
      },
      {
        id: "two",
        title: "Silent slide",
        layout: "cover",
        motion: "none",
        narration: { mode: "silent", script: "", silentDurationMs: 1000 },
      },
      {
        id: "three",
        title: "Final slide",
        layout: "cover",
        motion: "none",
        narration: {
          mode: "speech",
          script: "Final narration.",
          silentDurationMs: 5000,
        },
      },
    ],
  },
});
const resource = await rpc("resources/read", {
  uri: "ui://views/slide-studio.html",
});
const encode = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
const html = `<!doctype html><html><body><iframe allow="fullscreen; autoplay" style="width:100%;height:1500px;border:0"></iframe><script>window.agentRequests=[];window.widgetResult=null;const f=document.querySelector('iframe');addEventListener('message',async e=>{if(e.source!==f.contentWindow||!e.data?.jsonrpc)return;const m=e.data;if(!m.method){window.widgetResult=m;return;}const send=x=>f.contentWindow.postMessage({jsonrpc:'2.0',...x},'*');if(m.method==='ui/notifications/initialized'){send({method:'ui/notifications/tool-input',params:{arguments:{}}});send({method:'ui/notifications/tool-result',params:${encode(initial)}});return;}if(m.id===undefined)return;try{let result={};if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'Narration test host',version:'1'},hostCapabilities:{message:{},serverTools:{},openLinks:{},updateModelContext:{text:{},structuredContent:{}}},hostContext:{theme:'dark',displayMode:'inline',availableDisplayModes:['inline','fullscreen'],platform:'web'}};if(m.method==='tools/call')result=await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m.params)})).json();if(m.method==='ui/message'){window.agentRequests.push(m.params);result={};}if(m.method==='ui/request-display-mode')result={mode:m.params.mode};send({id:m.id,result});}catch(e){send({id:m.id,error:{code:-32603,message:String(e)}});}});f.srcdoc=${encode(resource.contents[0].text)};</script></body></html>`;
let origin;
const envelope = (data) => ({
  content: [{ type: "text", text: "Fixture result" }],
  structuredContent: { data },
});
const server = createServer(async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url.startsWith("/audio?")) {
      res.setHeader("Content-Type", "audio/wav");
      res.end(
        await service.audio(new URL(req.url, origin).searchParams.get("grant")),
      );
      return;
    }
    if (req.url === "/rpc") {
      let body = "";
      for await (const c of req) body += c;
      const { name, arguments: a } = JSON.parse(body);
      let result;
      if (name === "get-narration-status")
        result = envelope({
          enabled: true,
          connected: true,
          slides: await service.manifest("test-user", a.deck, false),
        });
      else if (name === "list-narration-voices")
        result = envelope(await service.catalog("test-user"));
      else if (name === "generate-narration") {
        assert.equal(a.confirmGeneration, true);
        const j = await service.generate(
          "test-user",
          a.deck,
          a.slideIds,
          a.retryUncertain,
          a.force,
          a.requestId,
        );
        while (await service.tick()) {}
        result = envelope(j);
      } else if (name === "get-narration-playback")
        result = {
          ...envelope({ assetId: a.assetId }),
          _meta: {
            url:
              origin +
              "/audio?grant=" +
              encodeURIComponent(
                await service.playbackToken("test-user", a.assetId),
              ),
          },
        };
      else result = await rpc("tools/call", { name, arguments: a });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e) }));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1400, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  const f = page.frameLocator("iframe");
  await f.locator(".sc-studio").waitFor();
  await f.getByRole("button", { name: "Narration", exact: true }).click();
  await f.getByRole("button", { name: "Load voices", exact: true }).click();
  await f
    .getByLabel("Narration voice", { exact: true })
    .selectOption("test-voice");
  assert.equal(await f.getByRole("button", { name: "Copy speaker notes" }).count(), 0);
  assert.equal(await f.getByRole("button", { name: "Copy slide text" }).count(), 0);
  await f.getByRole("button", { name: "Write Narration", exact: true }).click();
  await f.getByText("Asked your agent", { exact: false }).waitFor();
  const requests = await page.evaluate(() => window.agentRequests);
  assert.equal(requests.length, 1);
  const request = JSON.stringify(requests[0]);
  assert.match(request, /eleven_multilingual_v2/);
  assert.match(request, /ALL 2 speech slides/);
  assert.match(request, /Leave slides marked silent unchanged/);
  assert.match(request, /Final slide/);
  assert.match(request, /Do NOT insert square-bracket audio tags/);
  assert.equal(generationCalls, 0);
  assert.match(request, /save-visible-narration/);
  assert.match(request, /Speaker notes stay separate/);
  assert.match(request, /SERVER tool save-narration-script/);
  // Real server-side save, as a host without mounted widget tools does.
  const serverSaved = await rpc("tools/call", {name: "save-narration-script", arguments: {
    deck: {id: initial.structuredContent.deck.id, syncToken: initial.structuredContent.deck.syncToken},
    slideId: "one", script: "A narration saved through the server tool.", expectedScript: ""
  }});
  assert.ok(!serverSaved.isError);
  await page.waitForFunction(() => document.querySelector("iframe").contentDocument?.querySelector('textarea[aria-label="Narration script"]')?.value === "A narration saved through the server tool.");
  const conflict = await rpc("tools/call", {name: "save-narration-script", arguments: {
    deck: {id: initial.structuredContent.deck.id, syncToken: initial.structuredContent.deck.syncToken},
    slideId: "one", script: "Must not overwrite a newer script.", expectedScript: ""
  }});
  assert.ok(conflict.isError);
  assert.equal(generationCalls, 0);
  // Invoke the actual mounted action as a host agent does; no synthetic tool-result notification.
  const before = await rpc("tools/call", {name: "get-live-deck", arguments: {syncToken: initial.structuredContent.deck.syncToken}});
  await page.evaluate(() => document.querySelector("iframe").contentWindow.postMessage({
    jsonrpc: "2.0", id: 991, method: "tools/call", params: {
      name: "save-visible-narration", arguments: {slideId: "one", script: "An agent-written explanation for this slide."}
    }
  }, "*"));
  await page.waitForFunction(() => window.widgetResult?.id === 991);
  assert.ok(!(await page.evaluate(() => window.widgetResult)).result.isError);
  await f.getByText("Narration written and saved.", { exact: false }).waitFor();
  assert.equal(await f.getByLabel("Narration script", { exact: true }).inputValue(), "An agent-written explanation for this slide.");
  const after = await rpc("tools/call", {name: "get-live-deck", arguments: {syncToken: initial.structuredContent.deck.syncToken}});
  assert.equal(after.structuredContent.deck.slides[0].notes, "Speaker notes stay separate.");
  assert.deepEqual(after.structuredContent.deck.slides.slice(1), before.structuredContent.deck.slides.slice(1));
  assert.equal(generationCalls, 0);
  await f
    .getByLabel("Narration script", { exact: true })
    .fill("This is my independent narration script.");
  await page.evaluate(() => document.querySelector("iframe").contentWindow.postMessage({
    jsonrpc: "2.0", id: 992, method: "tools/call", params: {
      name: "save-visible-narration", arguments: {slideId: "one", script: "Must not overwrite the user's draft."}
    }
  }, "*"));
  await page.waitForFunction(() => window.widgetResult?.id === 992);
  assert.ok((await page.evaluate(() => window.widgetResult)).result.isError);
  assert.equal(await f.getByLabel("Narration script", { exact: true }).inputValue(), "This is my independent narration script.");
  await f.getByRole("button", { name: "Save narration", exact: true }).click();
  await f.getByText("Narration saved.", { exact: false }).waitFor();
  assert.equal(generationCalls, 0);
  await f
    .getByRole("button", { name: "Generate narration…", exact: true })
    .click();
  await f
    .getByRole("region", { name: "Review narration generation" })
    .waitFor();
  assert.equal(generationCalls, 0);
  await f
    .getByRole("button", { name: "Confirm and generate", exact: true })
    .click();
  await f
    .getByText("3 / 3 slides ready", { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(generationCalls, 2);
  await f.getByRole("button", { name: "Preview audio", exact: true }).click();
  await f.locator("audio").waitFor();
  assert.match(await f.locator("audio").getAttribute("src"), /^blob:/);
  await f.getByRole("button", { name: "Present", exact: true }).click();
  const nav = f.getByRole("navigation", { name: "Presenter controls" });
  await nav.hover();
  await nav
    .getByRole("button", { name: "Auto present from beginning" })
    .click();
  await nav
    .getByText("End of presentation", { exact: true })
    .waitFor({ timeout: 20000 });
  assert.match(await nav.innerText(), /3 \/ 3/);
  await nav.hover();
  await nav
    .getByRole("button", { name: "Auto present from beginning" })
    .click();
  await nav
    .getByRole("button", { name: "Pause narration", exact: true })
    .click();
  await new Promise((r) => setTimeout(r, 1200));
  assert.match(await nav.innerText(), /1 \/ 3/);
  await nav.hover();
  await nav.getByRole("button", { name: "Next slide", exact: true }).click();
  await new Promise((r) => setTimeout(r, 1200));
  assert.match(await nav.innerText(), /2 \/ 3/);
  await nav.hover();
  await nav.getByRole("button", { name: "Resume audio", exact: true }).click();
  await nav
    .getByText("End of presentation", { exact: true })
    .waitFor({ timeout: 15000 });
  await nav.hover();
  await nav
    .getByRole("button", { name: "Exit presentation", exact: true })
    .click();
  await f.locator(".sc-present").waitFor({ state: "detached" });
  const liveForTags = await rpc("tools/call", {name: "get-live-deck", arguments: {syncToken: initial.structuredContent.deck.syncToken}});
  const taggedModel = await rpc("tools/call", {name: "revise-presentation", arguments: {
    deck: liveForTags.structuredContent.deck, expectedRevision: liveForTags.structuredContent.deck.revision,
    edits: [{op: "replace", path: "/narration/modelId", value: "eleven_v3"}]
  }});
  assert.ok(!taggedModel.isError);
  const tagArgs = {deck: {id: initial.structuredContent.deck.id, syncToken: initial.structuredContent.deck.syncToken},
    slideId: "one", expectedScript: "This is my independent narration script.", requireEmotionTags: true};
  const rejectedPlain = await rpc("tools/call", {name: "save-narration-script", arguments: {...tagArgs, script: "A plain script without emotion tags."}});
  assert.ok(rejectedPlain.isError);
  const savedTags = await rpc("tools/call", {name: "save-narration-script", arguments: {...tagArgs, script: "[curious] What makes this idea work? [confident] Let us find out."}});
  assert.ok(!savedTags.isError);
  assert.match(savedTags.structuredContent.deck.slides[0].narration.script, /\[curious\]/);
  assert.deepEqual(savedTags.structuredContent.deck.slides.slice(1), taggedModel.structuredContent.deck.slides.slice(1));
  assert.deepEqual(errors, []);
  console.log(
    "PASS narration widget: script/voice edits, explicit generation review, durable fixture jobs, real browser audio ended, silent slides, pause/resume, manual navigation, final stop and cleanup.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
}
