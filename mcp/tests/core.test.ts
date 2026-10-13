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
