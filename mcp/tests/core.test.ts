import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkDeck, reviseSlide } from "../views/slide-studio/schema.ts";
import { render } from "../src/render.js";
const demo = checkDeck(
  JSON.parse(
    await readFile(new URL("../src/demo.json", import.meta.url), "utf8"),
  ),
);
test("targeted revision preserves unrelated slides and rejects invalid snapshots", () => {
  const revised = reviseSlide(
    demo,
    "opening",
    { title: "A sharper opening" },
    0,
  );
  assert.equal(revised.revision, 1);
  assert.equal(revised.slides[0].title, "A sharper opening");
  assert.deepEqual(revised.slides.slice(1), demo.slides.slice(1));
  assert.notEqual(demo.slides[0].title, revised.slides[0].title);
  assert.throws(
    () => reviseSlide(revised, "opening", { title: "Stale" }, 0),
    /Revision mismatch/,
  );
  assert.throws(
    () => reviseSlide(demo, "missing", { title: "Invalid" }, 0),
    /Unknown slide/,
  );
  assert.throws(
    () => checkDeck({ ...demo, slides: [demo.slides[0], demo.slides[0]] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      checkDeck({ ...demo, slides: [{ ...demo.slides[0], layout: "cards" }] }),
    /requires cards/,
  );
});
test("HTML export embeds animation runtime and escapes ordinary text", () => {
  const d = structuredClone(demo);
  d.slides[0].title = "<script>alert(1)</script>";
  const html = render(d);
  assert.match(html, /window.slidecraft/);
  assert.match(html, /prefers-reduced-motion/);
  assert.ok(!html.includes("<h1 data-reveal><script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("visual elements validate geometry, identity and image sources and export escaped text", () => {
  const d = structuredClone(demo);
  d.slides[0].elements = [
    {
      id: "text-one",
      type: "text",
      text: "<script>bad()</script>",
      x: 120,
      y: 100,
      width: 600,
      height: 200,
      fontSize: 48,
      bold: true,
      color: "#ff0000",
      fit: "contain",
    },
  ];
  const valid = checkDeck(d);
  const html = render(valid);
  assert.match(html, /data-element-id="text-one"/);
  assert.match(html, /left:120px/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  d.slides[0].elements[0].x = 1500;
  assert.throws(() => checkDeck(d), /fit inside/);
  d.slides[0].elements[0].x = 120;
  d.slides[0].elements.push({ ...d.slides[0].elements[0] });
  assert.throws(() => checkDeck(d), /Duplicate element/);
  d.slides[0].elements.pop();
  d.slides[0].elements[0].type = "image";
  assert.throws(() => checkDeck(d), /needs a source/);
});

test("smart guides snap group edges and centers, clamp movement, and allow bypass", async () => {
  const { snapMove } = await import("../views/slide-studio/alignment.ts");
  const box = { x: 400, y: 300, width: 100, height: 80 };
  const other = { x: 100, y: 100, width: 100, height: 80 };
  const move = snapMove(box, -197, 0, [other], 6);
  assert.equal(box.x + move.dx, 200);
  assert.deepEqual(move.guides, [{ axis: "x", value: 200 }]);
  assert.equal(box.x + snapMove(box, -197, 0, [other], 6, false).dx, 203);
  assert.equal(box.x + snapMove(box, 348, 0, [], 6).dx, 750);
  const clamped = snapMove(box, 2000, -1000, [], 6, false);
  assert.equal(box.x + clamped.dx, 1500);
  assert.equal(box.y + clamped.dy, 0);
});
test("relative alignment and equal gaps preserve unrelated items and dimensions", async () => {
  const { alignItems, distributeItems } =
    await import("../views/slide-studio/alignment.ts");
  const make = (id: string, x: number, width: number) => ({
    id,
    x,
    y: 100,
    width,
    height: 80,
    type: "text" as const,
    color: "#ffffff",
    fontSize: 40,
    bold: false,
    fit: "contain" as const,
  });
  const items = [
    make("a", 100, 100),
    make("b", 400, 200),
    make("c", 1000, 100),
    make("other", 20, 40),
  ];
  const ids = ["a", "b", "c"];
  const aligned = alignItems(items, ids, "center");
  assert.deepEqual(
    aligned.slice(0, 3).map((i) => i.x + i.width / 2),
    [600, 600, 600],
  );
  assert.equal(aligned[3], items[3]);
  assert.deepEqual(
    aligned.map((i) => i.width),
    items.map((i) => i.width),
  );
  const spaced = distributeItems(items, ids, "x");
  assert.equal(spaced[0].x, 100);
  assert.equal(spaced[2].x, 1000);
  assert.equal(
    spaced[1].x - (spaced[0].x + spaced[0].width),
    spaced[2].x - (spaced[1].x + spaced[1].width),
  );
  assert.equal(spaced[3], items[3]);
  assert.deepEqual(
    items.map((i) => i.x),
    [100, 400, 1000, 20],
  );
});
