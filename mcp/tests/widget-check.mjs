import sharp from "sharp";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const endpoint = process.argv[2] || "http://localhost:3000/mcp";
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
  const s = await r.text();
  const data = JSON.parse(
    s.startsWith("event:")
      ? s
          .split("\n")
          .find((l) => l.startsWith("data:"))
          .slice(5)
      : s,
  );
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result;
}
const result = await rpc("tools/call", { name: "open-slides", arguments: {} });
const resource = await rpc("resources/read", {
  uri: "ui://views/slide-studio.html",
});
const encode = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
const html = `<!doctype html><html><body style="margin:0"><iframe allow="fullscreen" title="Slidecraft test host" style="width:100%;height:1600px;border:0"></iframe><script>
let initial=${encode(result)};const f=document.querySelector('iframe');window.requests=[];window.latestContext=null;
addEventListener('message',async e=>{if(e.source!==f.contentWindow||!e.data?.jsonrpc)return;const m=e.data;if(!m.method){window.widgetResult=m;return;}window.requests.push(m.method);const send=x=>f.contentWindow.postMessage({jsonrpc:'2.0',...x},'*');
if(m.method==='ui/notifications/initialized'){send({method:'ui/notifications/tool-input',params:{arguments:{}}});send({method:'ui/notifications/tool-result',params:initial});return;}
if(m.id===undefined)return;
try{let result={};
if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'Slidecraft test host',version:'1.0'},hostCapabilities:{serverTools:{},message:{text:{}},updateModelContext:{text:{},structuredContent:{}},openLinks:{}},hostContext:{theme:'dark',displayMode:'inline',availableDisplayModes:['inline','fullscreen'],platform:'web',locale:'en-US',timeZone:'UTC'}};
if(m.method==='tools/call' && location.search==='?pane' && m.params.name==='get-live-deck')return;
if(m.method==='tools/call')result=await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m.params)})).json();
if(m.method==='ui/update-model-context')window.latestContext=m.params;
if(m.method==='ui/message')window.followUp=m.params;
if(m.method==='ui/request-display-mode')result={mode:m.params.mode};
send({id:m.id,result});}catch(e){send({id:m.id,error:{code:-32603,message:String(e)}});}});
window.showPreview=(next,markup)=>{initial=next;f.srcdoc=markup;};
f.srcdoc=${encode(resource.contents[0].text)};
</script></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === "/rpc") {
    let s = "";
    for await (const c of req) s += c;
    try {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(await rpc("tools/call", JSON.parse(s))));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    }
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator("iframe");
  await frame.locator(".sc-studio").waitFor();
  const pane = await browser.newPage({
    viewport: { width: 900, height: 1100 },
  });
  await pane.goto(`http://127.0.0.1:${server.address().port}/?pane`);
  const paneFrame = pane.frameLocator("iframe");
  await paneFrame.locator(".sc-studio").waitFor();
  const liveUpdate = await rpc("tools/call", {
    name: "revise-presentation",
    arguments: {
      deck: result.structuredContent.deck,
      expectedRevision: 0,
      edits: [
        {
          op: "add",
          path: "/slides/0/colors",
          value: { background: "#ff0000" },
        },
        {
          op: "add",
          path: "/slides/1/colors",
          value: { background: "#ff0000" },
        },
      ],
    },
  });
  assert.ok(!liveUpdate.isError);
  // No tool-result notification, new card, import, or reload is delivered to this studio.
  await frame
    .getByText("Revision 1 · Saved in view state", { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(
    await frame
      .locator(".sc-slide")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 0, 0)",
  );
  await frame.getByRole("button", { name: "Next →", exact: true }).click();
  assert.equal(
    await frame
      .locator(".sc-slide")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 0, 0)",
  );
  await paneFrame
    .getByText("Revision 1 · Saved in view state", { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(
    await paneFrame
      .locator(".sc-slide")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 0, 0)",
  );
  await paneFrame
    .getByLabel("Live connection status")
    .filter({ hasText: "Live · server revision 1" })
    .waitFor();
  await pane.close();
  const fresh = await rpc("tools/call", { name: "open-slides", arguments: {} });
  await page.evaluate(({ r, html }) => window.showPreview(r, html), {
    r: fresh,
    html: resource.contents[0].text,
  });
  await frame
    .getByText("Revision 0 · Saved in view state", { exact: true })
    .waitFor();
  await frame.getByRole("button", { name: "Next →", exact: true }).click();
  await frame
    .locator(".sc-slide h1")
    .filter({ hasText: "The first draft" })
    .waitFor();
  await frame.getByRole("button", { name: "Edit slide", exact: true }).click();
  await frame
    .getByLabel("Title", { exact: true })
    .fill("Edited from the widget");
  await frame.getByRole("button", { name: "Apply changes" }).click();
  await frame
    .locator(".sc-slide h1")
    .filter({ hasText: "Edited from the widget" })
    .waitFor();
  await frame.getByRole("button", { name: "Save JSON", exact: true }).click();
  await frame.locator(".sc-download").waitFor();
  await frame.getByText("Show file contents", { exact: true }).click();
  const exported = JSON.parse(
    await frame.getByLabel("Exported file contents").inputValue(),
  );
  assert.equal(exported.revision, 1);
  assert.equal(exported.slides[1].title, "Edited from the widget");
  assert.equal(exported.slides[0].id, "opening");
  await frame.getByRole("button", { name: "+ Add slide", exact: true }).click();
  await frame
    .locator(".sc-slide h1")
    .filter({ hasText: "One clear idea." })
    .waitFor();
  await frame.getByRole("button", { name: "Export HTML", exact: true }).click();
  await frame.locator(".sc-download").waitFor();
  await frame.getByText("Show file contents", { exact: true }).click();
  assert.match(
    await frame.getByLabel("Exported file contents").inputValue(),
    /window.slidecraft/,
  );
  const imported = {
    ...exported,
    id: "imported-test",
    title: "Imported story",
    revision: 0,
    syncToken: undefined,
  };
  await frame.locator("input[type=file]").setInputFiles({
    name: "test.deck.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await frame
    .locator(".sc-heading h2")
    .filter({ hasText: "Imported story" })
    .waitFor();
  await frame
    .getByLabel("Think out loud. Shape the next version.")
    .fill("Critique this slide without changing it.");
  await frame.getByRole("button", { name: "Ask agent", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.followUp));
  assert.ok(
    (await page.evaluate(() => window.requests)).includes(
      "ui/update-model-context",
    ),
  );

  // Ask the mounted view tool to change the current imported deck, as an agent does.
  await page.evaluate(() =>
    document.querySelector("iframe").contentWindow.postMessage(
      {
        jsonrpc: "2.0",
        id: 901,
        method: "tools/call",
        params: {
          name: "change-visible-slide-colors",
          arguments: {
            colors: {
              background: "#16324f",
              foreground: "#ffffff",
              accent: "#ff9900",
            },
          },
        },
      },
      "*",
    ),
  );
  await page.waitForFunction(() => window.widgetResult?.id === 901);
  assert.ok(!(await page.evaluate(() => window.widgetResult)).result.isError);
  await frame
    .locator(".sc-slide")
    .evaluate(
      (el) => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
  assert.equal(
    await frame
      .locator(".sc-slide")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(22, 50, 79)",
  );
  assert.equal(
    await frame
      .locator(".sc-slide h1")
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  assert.equal(
    await frame
      .locator(".sc-eyebrow")
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 153, 0)",
  );
  // Changing the selected slide must leave other slides untouched.
  await frame.getByRole("button", { name: "Next →", exact: true }).click();
  assert.notEqual(
    await frame
      .locator(".sc-slide")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(22, 50, 79)",
  );
  // The server-side color tool must return a fresh preview that renders its result.
  const remoteResult = await rpc("tools/call", {
    name: "set-theme",
    arguments: {
      deck: imported,
      expectedRevision: 0,
      slideId: imported.slides[1].id,
      colors: {
        background: "#ffeecc",
        foreground: "#112233",
        accent: "#774400",
      },
    },
  });
  const remoteResource = await rpc("resources/read", {
    uri: "ui://views/theme-preview.html",
  });
  await page.evaluate(({ r, html }) => window.showPreview(r, html), {
    r: remoteResult,
    html: remoteResource.contents[0].text,
  });
  await frame
    .locator(".sc-slide h1")
    .filter({ hasText: imported.slides[1].title })
    .waitFor();
  assert.equal(
    await frame
      .locator(".sc-slide")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 238, 204)",
  );
  await frame.locator(".sc-slide").evaluate(async (el) => {
    await Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished),
    );
  });
  await page.screenshot({ path: "/tmp/slidecraft-single-slide-color.png" });
  await frame.getByRole("button", { name: "Export HTML", exact: true }).click();
  await frame.locator(".sc-download").waitFor();
  await frame.getByText("Show file contents", { exact: true }).click();
  const htmlExport = await frame
    .getByLabel("Exported file contents")
    .inputValue();
  assert.match(htmlExport, /--bg:#ffeecc/);
  const exportPage = await browser.newPage();
  await exportPage.setContent(htmlExport);
  assert.notEqual(
    await exportPage
      .locator(".slide.active")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 238, 204)",
  );
  await exportPage
    .getByRole("button", { name: "Next slide", exact: true })
    .click();
  assert.equal(
    await exportPage
      .locator(".slide.active")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 238, 204)",
  );
  await exportPage.close();
  // Agent edits the mounted deck; authored HTML/CSS/JS must be visible, not just exported.
  await page.evaluate(() => {
    document.querySelector("iframe").style.display = "none";
  });
  const edits = [
    { op: "replace", path: "/slides/1/title", value: "General edit preview" },
    { op: "replace", path: "/slides/1/layout", value: "custom" },
    {
      op: "add",
      path: "/slides/1/html",
      value:
        "<svg id='custom-chart' viewBox='0 0 100 50'><rect width='100' height='50' fill='blue'/></svg>",
    },
    {
      op: "add",
      path: "/css",
      value:
        ".slide h1 {font-size:77px;color:rgb(120, 30, 90)} .slide-content {padding:20px}",
    },
    {
      op: "add",
      path: "/script",
      value:
        "document.body.dataset.customRan='yes';try{parent.document.body.dataset.escaped='yes'}catch{document.body.dataset.isolated='yes'}",
    },
  ];
  await page.evaluate(
    ({ edits, id }) =>
      document.querySelector("iframe").contentWindow.postMessage(
        {
          jsonrpc: "2.0",
          id: 902,
          method: "tools/call",
          params: {
            name: "edit-visible-presentation",
            arguments: { edits, selectedSlideId: id },
          },
        },
        "*",
      ),
    { edits, id: imported.slides[1].id },
  );
  await page.waitForFunction(() => window.widgetResult?.id === 902);
  assert.ok(!(await page.evaluate(() => window.widgetResult)).result.isError);
  const custom = frame.frameLocator(
    'iframe[title="Custom presentation preview"]',
  );
  await custom
    .locator("body[data-custom-ran=yes]")
    .waitFor({ state: "attached" });
  await page.evaluate(() => {
    document.querySelector("iframe").style.display = "block";
  });
  await custom
    .locator(".slide.active h1")
    .filter({ hasText: "General edit preview" })
    .waitFor();
  assert.equal(
    await custom
      .locator(".slide.active h1")
      .evaluate((el) => getComputedStyle(el).fontSize),
    "77px",
  );
  assert.equal(
    await custom
      .locator(".slide.active h1")
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(120, 30, 90)",
  );
  await custom.locator("#custom-chart").waitFor();
  assert.equal(
    await custom.locator("body").getAttribute("data-custom-ran"),
    "yes",
  );
  assert.equal(
    await custom.locator("body").getAttribute("data-isolated"),
    "yes",
  );
  assert.equal(await frame.locator("body").getAttribute("data-escaped"), null);
  await custom.getByRole("button", { name: "Next slide", exact: true }).click();
  await frame
    .locator(".sc-bottom")
    .getByText("Revision 2 · Saved in view state")
    .waitFor();
  await frame.getByRole("button", { name: "← Previous", exact: true }).click();
  await custom
    .locator(".slide.active h1")
    .filter({ hasText: "General edit preview" })
    .waitFor();
  await frame.getByRole("button", { name: "Export HTML", exact: true }).click();
  await frame.getByText("Show file contents", { exact: true }).click();
  const customHtml = await frame
    .getByLabel("Exported file contents")
    .inputValue();
  const customExport = await browser.newPage();
  await customExport.setContent(customHtml);
  await customExport
    .getByRole("button", { name: "Next slide", exact: true })
    .click();
  assert.equal(
    await customExport
      .locator(".slide.active h1")
      .evaluate((el) => getComputedStyle(el).fontSize),
    "77px",
  );
  assert.equal(
    await customExport.locator("body").getAttribute("data-custom-ran"),
    "yes",
  );
  await customExport.close();
  const currentLive = await rpc("tools/call", {
    name: "get-live-deck",
    arguments: { syncToken: remoteResult.structuredContent.deck.syncToken },
  });
  const imageBytes = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "#2299ff" },
  })
    .png()
    .toBuffer();
  const withPhoto = await rpc("tools/call", {
    name: "add-photo",
    arguments: {
      deck: currentLive.structuredContent.deck,
      expectedRevision: currentLive.structuredContent.deck.revision,
      slideId: imported.slides[1].id,
      source: "data:image/png;base64," + imageBytes.toString("base64"),
      alt: "Visible test photo",
      caption: "Photo caption",
    },
  });
  assert.ok(!withPhoto.isError, JSON.stringify(withPhoto));
  await custom.getByAltText("Visible test photo").waitFor();
  assert.ok(
    await custom
      .getByAltText("Visible test photo")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  await page.bringToFront();
  await frame.getByRole("button", { name: "Present", exact: true }).click();
  const presentation = frame.getByRole("dialog", {
    name: "Presentation",
    exact: true,
  });
  await presentation.waitFor();
  assert.ok(
    await frame
      .locator("html")
      .evaluate(() => Boolean(document.fullscreenElement)),
  );
  const controls = presentation.getByRole("navigation", { name: "Presenter controls" });
  await page.mouse.move(500, 400);
  await page.waitForTimeout(2100);
  assert.equal(await controls.evaluate((el) => getComputedStyle(el).opacity), "0");
  await controls.hover();
  await page.waitForTimeout(250);
  assert.equal(await controls.evaluate((el) => getComputedStyle(el).opacity), "1");
  await page.mouse.move(500, 400);
  await page.waitForTimeout(2100);
  assert.equal(await controls.evaluate((el) => getComputedStyle(el).opacity), "0");
  const audience = presentation.frameLocator("iframe");
  await audience.locator(".slide.active .slide-photo img").waitFor();
  assert.equal(await audience.locator("#notes-toggle").isVisible(), false);
  assert.ok(
    !(await audience
      .locator("#deck-data")
      .textContent()
      .then((text) => JSON.parse(text).slides.some((s) => s.notes))),
  );
  await presentation
    .getByRole("button", { name: "Next slide", exact: true })
    .click();
  await presentation.getByText("3 / 7", { exact: true }).waitFor();
  await presentation
    .getByRole("button", { name: "Speaker view", exact: true })
    .click();
  const speaker = frame.getByRole("dialog", {
    name: "Speaker view",
    exact: true,
  });
  await speaker
    .getByRole("heading", { name: "Speaker notes", exact: true })
    .waitFor();
  await speaker
    .getByRole("heading", { name: "Next slide", exact: true })
    .waitFor();
  await speaker
    .getByRole("button", { name: "Exit presentation", exact: true })
    .click();
  await frame.getByRole("button", { name: "Present", exact: true }).waitFor();
  const plain = structuredClone(result.structuredContent.deck);
  delete plain.syncToken;
  const plainPhoto = await rpc("tools/call", {
    name: "add-photo",
    arguments: {
      deck: plain,
      expectedRevision: 0,
      slideId: plain.slides[0].id,
      source: "data:image/png;base64," + imageBytes.toString("base64"),
      alt: "Native photo",
    },
  });
  assert.ok(!plainPhoto.isError);
  const photoResource = await rpc("resources/read", {
    uri: "ui://views/photo-preview.html",
  });
  await page.evaluate(({ r, html }) => window.showPreview(r, html), {
    r: plainPhoto,
    html: photoResource.contents[0].text,
  });
  await frame.getByAltText("Native photo").waitFor();
  assert.ok(
    await frame
      .getByAltText("Native photo")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  const exportedPhoto = await rpc("tools/call", {
    name: "export-deck",
    arguments: { deck: plainPhoto.structuredContent.deck, format: "html" },
  });
  const photoPage = await browser.newPage();
  await photoPage.setContent(exportedPhoto._meta.fileText);
  await photoPage.getByAltText("Native photo").waitFor();
  assert.ok(
    await photoPage
      .getByAltText("Native photo")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  await photoPage.close();
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(200);
  const box = await frame.locator(".sc-studio").boundingBox();
  assert.ok(box.width <= 390);
  assert.deepEqual(errors, []);
  console.log(
    "Widget checks passed: decoded embedded image, audience presentation, speaker notes, slide navigation, separate pane auto-reload with stalled host live-tool bridge, existing studio auto-reload without import or new tool notification, general editing, custom HTML/CSS/JS preview and export, sandbox isolation, selected-slide colors, non-first-slide preview selection, unchanged neighboring slide, rendered HTML colors, navigation, tool-backed edit, add slide, JSON export/import, HTML export, model context, follow-up, mobile fit. Host bridge simulated; MCP tools and view runtime are real.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
