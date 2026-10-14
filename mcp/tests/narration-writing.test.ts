import { test } from "node:test";
import assert from "node:assert/strict";
import { narrationWritingPrompt } from "../views/slide-studio/narration-writing.js";

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
