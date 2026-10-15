import { test } from "node:test";
import assert from "node:assert/strict";
import { narrationWritingPrompt, validateNarrationEmotion } from "../views/slide-studio/narration-writing.js";

test("writing targets one stable slide and never authorizes synthesis", () => {
  const prompt = narrationWritingPrompt("deck-a", "slide-b", "eleven_multilingual_v2");
  assert.match(prompt, /slide with ID "slide-b" in deck "deck-a"/);
  assert.match(prompt, /get-live-deck/);
  assert.match(prompt, /Do not call generate-narration/);
  assert.match(prompt, /Preserve every other slide/);
  assert.match(prompt, /Do NOT insert square-bracket audio tags/);
});
test("expressive models get audio cues without unsupported SSML", () => {
  for (const model of ["eleven_v3", "eleven_v4", "eleven_v4_turbo"]) {
    const prompt = narrationWritingPrompt("d", "s", model);
    assert.match(prompt, /\[curious\]/);
    assert.match(prompt, /Do not use SSML/);
  }
  assert.match(narrationWritingPrompt("d", "s", "unknown"), /Use plain spoken text/);
});

 test("server writing request carries an explicit deck reference and protects concurrent scripts", () => {
  const token = "a".repeat(64);
  const prompt = narrationWritingPrompt("deck-a", "slide-b", "eleven_v3", "Slide context", token, "Previous script");
  assert.match(prompt, /SERVER tool save-narration-script/);
  assert.ok(prompt.includes(JSON.stringify({id: "deck-a", syncToken: token})));
  assert.match(prompt, /expectedScript="Previous script"/);
  assert.match(prompt, /do not repeat it in your reply/);
});

test("required emotion cues reject tag-free or incompatible scripts", () => {
  assert.throws(() => validateNarrationEmotion("Plain narration.", "eleven_v3"), /at least one/);
  assert.throws(() => validateNarrationEmotion("[1] Plain narration.", "eleven_v4"), /at least one/);
  assert.throws(() => validateNarrationEmotion("[curious] Hello.", "eleven_multilingual_v2"), /require Eleven/);
  validateNarrationEmotion("[curious] What happens next?", "eleven_v3");
  validateNarrationEmotion("[confident] Here is the plan.", "eleven_v4");
  assert.match(narrationWritingPrompt("d", "s", "eleven_v3", "", "a".repeat(64)), /requireEmotionTags=true/);
});

test("presentation writing targets every speech slide, rewrites existing scripts and skips silent slides", async () => {
  const { deckNarrationWritingPrompt } = await import("../views/slide-studio/narration-writing.js");
  const deck = {
    id: "all-slides", version: 1 as const, revision: 2, title: "Whole presentation",
    theme: {mode: "dark" as const, accent: "#ff9900"}, syncToken: "b".repeat(64),
    slides: [
      {id: "first", title: "Opening", layout: "cover" as const},
      {id: "quiet", title: "Pause", layout: "cover" as const, narration: {mode: "silent" as const, script: "", silentDurationMs: 5000}},
      {id: "last", title: "Closing", layout: "cover" as const, narration: {mode: "speech" as const, script: "Previous closing", silentDurationMs: 5000}},
    ],
  };
  const prompt = deckNarrationWritingPrompt(deck, "eleven_v3");
  assert.match(prompt, /ALL 2 speech slides/);
  assert.match(prompt, /Rewrite existing speech scripts too/);
  assert.ok(prompt.includes('"slideId":"first"'));
  assert.ok(prompt.includes('"slideId":"last","expectedScript":"Previous closing"'));
  assert.ok(!prompt.includes('"slideId":"quiet"'));
  assert.match(prompt, /requireEmotionTags=true/);
  assert.match(prompt, /Verify every target has been saved/);
  assert.match(prompt, /Do not call generate-narration/);
  assert.throws(() => deckNarrationWritingPrompt({...deck, slides: [deck.slides[1]]}, "eleven_v3"), /All slides are marked silent/);
});
