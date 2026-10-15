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
  const controls = presentation.getByRole("navigation", {
    name: "Presenter controls",
  });
  await page.mouse.move(500, 400);
  await page.waitForTimeout(2100);
  assert.equal(
    await controls.evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
  await controls.hover();
  await page.waitForTimeout(250);
  assert.equal(
    await controls.evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  await page.mouse.move(500, 400);
  await page.waitForTimeout(2100);
  assert.equal(
    await controls.evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
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
  await page.bringToFront();
  await frame.getByRole("button", { name: "Visual edit", exact: true }).click();
  const visual = frame.getByRole("region", { name: "Visual slide editor" });
  for (const [name, x, y] of [
    ["Guide A", 100, 600],
    ["Guide B", 400, 660],
    ["Guide C", 900, 720],
  ]) {
    await visual.getByRole("button", { name: "Add text", exact: true }).click();
    await visual.getByLabel("Element text", { exact: true }).fill(name);
    for (const [field, value] of [
      ["width", 100],
      ["height", 80],
      ["x", x],
      ["y", y],
    ])
      await visual
        .getByLabel(`Element ${field}`, { exact: true })
        .fill(String(value));
  }
  const guideB = visual.getByRole("button", {
    name: "Select text: Guide B",
    exact: true,
  });
  await guideB.scrollIntoViewIfNeeded();
  let dragBox = await guideB.boundingBox();
  const visualScale = dragBox.width / 100;
  await page.mouse.move(dragBox.x + 10, dragBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 10 - 197 * visualScale, dragBox.y + 10, {
    steps: 5,
  });
  await visual
    .locator('[data-guide-axis="x"][data-guide-value="200"]')
    .waitFor();
  assert.equal(await guideB.evaluate((el) => parseFloat(el.style.left)), 200);
  await page.mouse.up();
  assert.equal(await visual.locator(".sc-snap-guide").count(), 0);
  dragBox = await guideB.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(dragBox.x + 10, dragBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 10 + 3 * visualScale, dragBox.y + 10);
  assert.equal(await visual.locator(".sc-snap-guide").count(), 0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  assert.ok(
    Math.abs((await guideB.evaluate((el) => parseFloat(el.style.left))) - 203) <
      1,
  );
  await visual
    .getByRole("button", { name: "Select text: Guide A", exact: true })
    .click();
  await guideB.click({ modifiers: ["Shift"] });
  await visual.getByRole("button", { name: "Align top", exact: true }).click();
  assert.equal(await guideB.evaluate((el) => parseFloat(el.style.top)), 600);
  await visual
    .getByRole("button", { name: "Select text: Guide C", exact: true })
    .click({ modifiers: ["Shift"] });
  await visual
    .getByRole("button", { name: "Distribute horizontally", exact: true })
    .click();
  assert.equal(await guideB.evaluate((el) => parseFloat(el.style.left)), 500);
  const guideA = visual.getByRole("button", {
    name: "Select text: Guide A",
    exact: true,
  });
  const guideC = visual.getByRole("button", {
    name: "Select text: Guide C",
    exact: true,
  });
  await guideA.scrollIntoViewIfNeeded();
  const groupBox = await guideA.boundingBox();
  await page.mouse.move(groupBox.x + 10, groupBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(groupBox.x + 40, groupBox.y + 20, { steps: 5 });
  await page.mouse.up();
  const guideAX = await guideA.evaluate((el) => parseFloat(el.style.left));
  const guideBX = await guideB.evaluate((el) => parseFloat(el.style.left));
  const guideCX = await guideC.evaluate((el) => parseFloat(el.style.left));
  assert.ok(guideAX > 100);
  assert.ok(Math.abs(guideBX - guideAX - 400) < 0.01);
  assert.ok(Math.abs(guideCX - guideBX - 400) < 0.01);

  await visual.getByRole("button", { name: "Add text", exact: true }).click();
  await visual
    .getByLabel("Element text", { exact: true })
    .fill("Visually authored text");
  await visual.getByLabel("Text color", { exact: true }).fill("#ff3300");
  await visual.getByLabel("Slide background", { exact: true }).fill("#112233");
  const movable = visual.getByRole("button", {
    name: "Select text: Visually authored text",
    exact: true,
  });
  const bounds = await movable.boundingBox();
  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 65, bounds.y + 45, { steps: 5 });
  await page.mouse.up();
  assert.ok(
    Number(await visual.getByLabel("Element x", { exact: true }).inputValue()) >
      120,
  );
  await visual.getByLabel("Element width", { exact: true }).fill("650");
  for (const [button, field, expected] of [
    ["Align left", "x", 0],
    ["Align right", "x", 950],
    ["Center horizontally", "x", 475],
    ["Align top", "y", 0],
    ["Align bottom", "y", 740],
    ["Center vertically", "y", 370],
  ]) {
    await visual.getByRole("button", { name: button, exact: true }).click();
    assert.equal(
      Number(
        await visual
          .getByLabel(`Element ${field}`, { exact: true })
          .inputValue(),
      ),
      expected,
    );
  }
  await visual
    .getByLabel("Text alignment", { exact: true })
    .selectOption("center");
  assert.equal(
    await movable.evaluate((el) => getComputedStyle(el).textAlign),
    "center",
  );
  // Emulate Safari silently returning PNG for unsupported WebP encoding.
  await frame.locator("html").evaluate(() => {
    window.originalCanvasEncoder = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      return window.originalCanvasEncoder.call(
        this,
        type === "image/webp" ? "image/png" : type,
        quality,
      );
    };
  });
  const noise = Buffer.alloc(700 * 700 * 4);
  let seed = 123456;
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    noise[i] = i % 4 === 3 ? 255 : seed & 255;
  }
  const opaqueNoise = await sharp(noise, {
    raw: { width: 700, height: 700, channels: 4 },
  })
    .png()
    .toBuffer();
  await visual.getByLabel("Upload slide image").setInputFiles({
    name: "opaque-photo.png",
    mimeType: "image/png",
    buffer: opaqueNoise,
  });
  await visual
    .getByRole("button", {
      name: "Select image: opaque-photo.png",
      exact: true,
    })
    .waitFor();
  for (let i = 3; i < noise.length; i += 4)
    noise[i] = 80 + (noise[i - 1] % 160);
  const transparentNoise = await sharp(noise, {
    raw: { width: 700, height: 700, channels: 4 },
  })
    .png()
    .toBuffer();
  await visual.getByLabel("Upload slide image").setInputFiles({
    name: "visual-photo.png",
    mimeType: "image/png",
    buffer: transparentNoise,
  });
  await visual
    .getByRole("button", { name: "Save visual edits", exact: true })
    .waitFor();
  await visual
    .getByRole("button", {
      name: "Select image: visual-photo.png",
      exact: true,
    })
    .waitFor();
  await visual
    .getByRole("button", { name: "Save visual edits", exact: true })
    .click();
  await visual.waitFor({ state: "hidden" });
  await frame.locator("html").evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = window.originalCanvasEncoder;
  });
  const visualPreview = frame.locator(".sc-canvas").frameLocator("iframe");
  await visualPreview
    .getByText("Visually authored text", { exact: true })
    .waitFor();
  assert.equal(
    await visualPreview
      .getByText("Visually authored text", { exact: true })
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 51, 0)",
  );
  assert.ok(
    await visualPreview
      .getByAltText("visual-photo.png", { exact: true })
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  const visualLive = await rpc("tools/call", {
    name: "get-live-deck",
    arguments: { syncToken: plainPhoto.structuredContent.deck.syncToken },
  });
  const visualDeck = visualLive.structuredContent.deck;
  const transparentUpload = visualDeck.slides[0].elements.find(
    (el) => el.text === "visual-photo.png",
  );
  const opaqueUpload = visualDeck.slides[0].elements.find(
    (el) => el.text === "opaque-photo.png",
  );
  assert.ok(transparentUpload.src.startsWith("data:image/png;base64,"));
  assert.ok(opaqueUpload.src.startsWith("data:image/jpeg;base64,"));
  for (const upload of [transparentUpload, opaqueUpload])
    assert.ok(upload.src.length <= 180000);
  const transparentMeta = await sharp(
    Buffer.from(transparentUpload.src.split(",")[1], "base64"),
  ).metadata();
  assert.ok(transparentMeta.hasAlpha);
  assert.ok(transparentMeta.width < 450);

  assert.ok(Math.abs(visualDeck.slides[0].elements.find((el) => el.text === "Guide B").x - guideBX) < 0.01);
  const authored = visualDeck.slides[0].elements.find(
    (el) => el.text === "Visually authored text",
  );
  assert.equal(authored.width, 650);
  assert.equal(authored.x, 475);
  assert.equal(authored.y, 370);
  assert.equal(authored.textAlign, "center");
  const visualExport = await rpc("tools/call", {
    name: "export-deck",
    arguments: { deck: visualDeck, format: "html" },
  });
  const visualPage = await browser.newPage();
  await visualPage.setContent(visualExport._meta.fileText);
  await visualPage
    .getByText("Visually authored text", { exact: true })
    .waitFor();
  assert.ok(
    Math.abs(
      (await visualPage
        .locator(`[data-element-id="${authored.id}"]`)
        .evaluate((el) => parseFloat(el.style.left))) - authored.x,
    ) < 0.01,
  );
  assert.equal(
    await visualPage
      .getByText("Visually authored text", { exact: true })
      .evaluate((el) => getComputedStyle(el).textAlign),
    "center",
  );
  await visualPage.close();
  await page.bringToFront();
  await frame.getByRole("button", { name: "Visual edit", exact: true }).click();
  await visual.getByRole("button", { name: "Add text", exact: true }).click();
  await visual
    .getByLabel("Element text", { exact: true })
    .fill("Keep this unsaved draft");
  const concurrent = await rpc("tools/call", {
    name: "update-slide",
    arguments: {
      deck: visualDeck,
      expectedRevision: visualDeck.revision,
      slideId: visualDeck.slides[0].id,
      changes: { notes: "Concurrent agent edit" },
    },
  });
  assert.ok(!concurrent.isError);
  await page.waitForTimeout(2500);
  assert.equal(
    await visual.getByLabel("Element text", { exact: true }).inputValue(),
    "Keep this unsaved draft",
  );
  await visual
    .getByRole("button", { name: "Save visual edits", exact: true })
    .click();
  await visual.getByRole("alert").waitFor();
  assert.equal(
    await visual.getByLabel("Element text", { exact: true }).inputValue(),
    "Keep this unsaved draft",
  );
  await visual.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(200);
  const box = await frame.locator(".sc-studio").boundingBox();
  assert.ok(box.width <= 390);
  // A new presentation must wait for a load decision and keep a JSON backup.
  const existingBeforeCreate = await rpc("tools/call", {name: "get-live-deck", arguments: {syncToken: result.structuredContent.deck.syncToken}});
  const newDeck = await rpc("tools/call", {name: "create-deck", arguments: {title: "A separate presentation", slides: [{id: "new-opening", title: "New presentation opening", layout: "cover"}]}});
  assert.equal(newDeck.structuredContent.requiresLoadConfirmation, true);
  const creationView = await rpc("resources/read", {uri: "ui://views/created-slides.html"});
  await page.evaluate(({next, markup}) => window.showPreview(next, markup), {next: newDeck, markup: creationView.contents[0].text});
  const readyCard = frame.getByRole("region", {name: "New presentation ready"});
  await readyCard.waitFor();
  assert.equal(await frame.locator(".sc-studio").count(), 0);
  const jsonBackup = await readyCard.getByLabel("New presentation JSON").inputValue();
  assert.deepEqual(JSON.parse(jsonBackup), newDeck.structuredContent.deck);
  await readyCard.getByRole("button", {name: "Keep for later", exact: true}).click();
  await readyCard.getByText("Kept for later.", {exact: false}).waitFor();
  assert.equal(await frame.locator(".sc-studio").count(), 0);
  const existingAfterCreate = await rpc("tools/call", {name: "get-live-deck", arguments: {syncToken: result.structuredContent.deck.syncToken}});
  assert.deepEqual(existingAfterCreate.structuredContent.deck, existingBeforeCreate.structuredContent.deck);
  await readyCard.getByRole("button", {name: "Load now", exact: true}).click();
  await frame.locator(".sc-studio").waitFor();
  await frame.locator(".sc-slide").getByText("New presentation opening", {exact: true}).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Widget checks passed: visual dragging, color pickers, image upload, persisted geometry, export parity, concurrent draft conflict protection, decoded embedded image, audience presentation, speaker notes, slide navigation, separate pane auto-reload with stalled host live-tool bridge, existing studio auto-reload without import or new tool notification, general editing, custom HTML/CSS/JS preview and export, sandbox isolation, selected-slide colors, non-first-slide preview selection, unchanged neighboring slide, rendered HTML colors, navigation, tool-backed edit, add slide, JSON export/import, HTML export, model context, follow-up, mobile fit, creation load confirmation, keep-for-later JSON backup and unchanged original deck. Host bridge simulated; MCP tools and view runtime are real.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
