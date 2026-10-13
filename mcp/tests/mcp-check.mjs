import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const url = process.argv[2] || "http://localhost:3000/mcp";
let id = 0;
async function rpc(method, params = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await r.text();
  assert.equal(r.status, 200, text.slice(0, 300));
  const data =
    text.startsWith("event:") || text.startsWith("data:")
      ? JSON.parse(
          text
            .split("\n")
            .find((l) => l.startsWith("data:"))
            .slice(5),
        )
      : JSON.parse(text);
  assert.ok(!data.error, JSON.stringify(data.error));
  return data.result;
}
const call = (name, args = {}) => rpc("tools/call", { name, arguments: args });
const tools = await rpc("tools/list");
assert.equal(tools.tools.length, 9);
const open = tools.tools.find((t) => t.name === "open-slides");
assert.equal(open._meta["openai/ui"].entrypoints.length, 2);
const initial = await call("open-slides");
assert.ok(!initial.isError);
const deck = structuredClone(initial.structuredContent.deck);
delete deck.syncToken;
const changed = await call("update-slide", {
  deck,
  slideId: deck.slides[0].id,
  expectedRevision: 0,
  changes: { title: "A focused revision" },
});
assert.ok(!changed.isError);
assert.equal(changed.structuredContent.deck.revision, 1);
assert.deepEqual(
  changed.structuredContent.deck.slides.slice(1),
  deck.slides.slice(1),
);
const stale = await call("update-slide", {
  deck: changed.structuredContent.deck,
  slideId: deck.slides[0].id,
  expectedRevision: 0,
  changes: { title: "Stale" },
});
assert.equal(stale.isError, true);
const missing = await call("update-slide", {
  deck,
  slideId: "missing",
  expectedRevision: 0,
  changes: { title: "Missing" },
});
assert.equal(missing.isError, true);
const invalid = await call("create-deck", {
  title: "Bad deck",
  slides: [{ id: "bad", title: "Bad", layout: "cards" }],
});
assert.equal(invalid.isError, true);
const created = await call("create-deck", {
  title: "New story",
  slides: [deck.slides[0]],
});
assert.ok(!created.isError);
assert.notEqual(created.structuredContent.deck.id, deck.id);
const moved = await call("edit-deck", {
  deck,
  expectedRevision: 0,
  operation: { type: "move", slideId: "opening", position: 2 },
});
assert.equal(moved.structuredContent.deck.slides[2].id, "opening");
const themed = await call("set-theme", {
  deck,
  expectedRevision: 0,
  colors: { background: "#16324f", foreground: "#ffffff", accent: "#ff9900" },
});
assert.ok(!themed.isError);
assert.equal(themed.structuredContent.deck.theme.background, "#16324f");
assert.deepEqual(themed.structuredContent.deck.slides, deck.slides);
assert.ok(tools.tools.find((t) => t.name === "set-theme")._meta.ui.resourceUri);
assert.ok(tools.tools.find((t) => t.name === "edit-deck")._meta.ui.resourceUri);
const themeResource = await rpc("resources/read", {
  uri: tools.tools.find((t) => t.name === "set-theme")._meta.ui.resourceUri,
});
assert.ok(themeResource.contents[0].text.includes("script"));
const single = await call("set-theme", {
  deck,
  expectedRevision: 0,
  slideId: deck.slides[1].id,
  colors: { background: "#ee1144" },
});
assert.ok(!single.isError);
assert.equal(single.structuredContent.selectedSlideId, deck.slides[1].id);
assert.equal(
  single.structuredContent.deck.slides[1].colors.background,
  "#ee1144",
);
assert.deepEqual(single.structuredContent.deck.theme, deck.theme);
assert.deepEqual(
  single.structuredContent.deck.slides.filter((_, i) => i !== 1),
  deck.slides.filter((_, i) => i !== 1),
);
const invalidSlide = await call("set-theme", {
  deck,
  expectedRevision: 0,
  slideId: "missing",
  colors: { background: "#ee1144" },
});
assert.ok(invalidSlide.isError);
const singleRevised = await call("update-slide", {
  deck,
  expectedRevision: 0,
  slideId: deck.slides[1].id,
  changes: { colors: { background: "#ee1144" } },
});
assert.equal(
  singleRevised.structuredContent.selectedSlideId,
  deck.slides[1].id,
);
assert.equal(
  singleRevised.structuredContent.deck.slides[1].colors.background,
  "#ee1144",
);
// General edits cover every field, nested arrays, duplication, removal, and replacement.
const edited = await call("revise-presentation", {
  deck,
  expectedRevision: 0,
  selectedSlideId: "copy-slide",
  edits: [
    { op: "replace", path: "/title", value: "New presentation" },
    { op: "add", path: "/author", value: "Slidecraft test" },
    {
      op: "replace",
      path: "/slides/1/bullets/0",
      value: "Revised nested bullet",
    },
    { op: "remove", path: "/slides/0/notes" },
    { op: "copy", from: "/slides/1", path: "/slides/-" },
    { op: "replace", path: "/slides/7/id", value: "copy-slide" },
    { op: "move", from: "/slides/7", path: "/slides/0" },
    { op: "add", path: "/css", value: ".slide h1 {font-size: 88px}" },
    {
      op: "add",
      path: "/script",
      value: "document.body.dataset.custom = 'yes'",
    },
  ],
});
assert.ok(!edited.isError, JSON.stringify(edited));
assert.equal(edited.structuredContent.deck.slides[0].id, "copy-slide");
assert.equal(
  edited.structuredContent.deck.slides[0].bullets[0],
  "Revised nested bullet",
);
assert.equal(edited.structuredContent.deck.slides[1].notes, undefined);
assert.equal(edited.structuredContent.deck.revision, 1);
assert.deepEqual(edited.structuredContent.deck.slides[3], deck.slides[2]);
for (const edits of [
  [
    { op: "replace", path: "/title", value: "partial" },
    { op: "remove", path: "/slides/0/id" },
  ],
  [{ op: "replace", path: "/revision", value: 99 }],
  [{ op: "add", path: "/__proto__/polluted", value: true }],
  [{ op: "test", path: "/title", value: "wrong" }],
  [{ op: "replace", path: "/title", value: deck.title }],
]) {
  const rejected = await call("revise-presentation", {
    deck,
    expectedRevision: 0,
    edits,
  });
  assert.ok(rejected.isError, JSON.stringify(rejected));
}
assert.equal({}.polluted, undefined);
const replacement = await call("revise-presentation", {
  deck,
  expectedRevision: 0,
  edits: [
    {
      op: "replace",
      path: "/slides",
      value: [
        {
          id: "new-design",
          title: "Entirely redesigned",
          layout: "custom",
          html: "<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'/></svg>",
          motion: "zoom",
        },
      ],
    },
  ],
});
assert.ok(!replacement.isError);
assert.equal(replacement.structuredContent.deck.slides.length, 1);
const staleGeneral = await call("revise-presentation", {
  deck: edited.structuredContent.deck,
  expectedRevision: 0,
  edits: [{ op: "replace", path: "/title", value: "Stale" }],
});
assert.ok(staleGeneral.isError);
const liveInitial = (await call("open-slides")).structuredContent.deck;
assert.notEqual(
  liveInitial.syncToken,
  initial.structuredContent.deck.syncToken,
);
const liveChanged = await call("set-theme", {
  deck: liveInitial,
  expectedRevision: 0,
  colors: { background: "#ff0000" },
});
assert.ok(!liveChanged.isError);
const liveRead = await call("get-live-deck", {
  syncToken: liveInitial.syncToken,
});
assert.equal(liveRead.structuredContent.deck.theme.background, "#ff0000");
assert.equal(liveRead.structuredContent.deck.revision, 1);
const conflict = await call("set-theme", {
  deck: liveInitial,
  expectedRevision: 0,
  colors: { background: "#0000ff" },
});
assert.ok(conflict.isError);
const reopened = await call("open-slides", { deck: liveInitial });
assert.equal(reopened.structuredContent.deck.revision, 1);
assert.equal(
  (await call("get-live-deck", { syncToken: "0".repeat(64) })).structuredContent
    .deck,
  null,
);
const liveUrl = new URL("/api/live-deck", url);
const unauthorized = await fetch(liveUrl, { method: "POST" });
assert.equal(unauthorized.status, 401);
const direct = await fetch(liveUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${liveInitial.syncToken}` },
});
assert.equal(direct.status, 200);
assert.equal(direct.headers.get("cache-control"), "no-store");
assert.equal((await direct.json()).deck.revision, 1);
const inspected = await call("inspect-deck", { deck });
assert.equal(inspected.structuredContent.slides.length, 7);
const exported = await call("export-deck", { deck, format: "html" });
assert.ok(exported._meta.fileText.includes("window.slidecraft"));
assert.ok(!exported._meta.fileText.includes(deck.slides[0].notes));
const json = await call("export-deck", { deck, format: "json" });
assert.deepEqual(JSON.parse(json._meta.fileText), deck);
const resource = await rpc("resources/read", {
  uri: open._meta.ui.resourceUri,
});
assert.match(resource.contents[0].text, /script/);
const skills = await rpc("skills/list");
assert.ok(JSON.stringify(skills).includes("slidecraft"));
await writeFile("/tmp/slidecraft-mcp-initial.json", JSON.stringify(initial));
await writeFile("/tmp/slidecraft-mcp-resource.json", JSON.stringify(resource));
console.log(
  `MCP checks passed at ${url}: 9 tools, entrypoints, create, revise, move, inspect, errors, exports, view resource, skill discovery.`,
);
