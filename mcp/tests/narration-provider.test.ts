import test from "node:test";
import assert from "node:assert/strict";
import { ElevenLabs, ProviderError } from "../src/narration/provider.js";

test("voice catalog follows cursors with the default page size and validates fallback credentials", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let legacy = false;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "fixture-key");
    requests.push(url.pathname);
    if (url.pathname === "/v1/models") return Response.json([
      { model_id: "speech", name: "Speech", can_do_text_to_speech: true },
      { model_id: "other", name: "Other", can_do_text_to_speech: false },
    ]);
    if (url.pathname === "/v1/voices") return Response.json({ detail: { status: "invalid_api_key" } }, { status: 401 });
    assert.equal(url.pathname, "/v2/voices");
    assert.equal(url.searchParams.has("page_size"), false);
    if (legacy) return Response.json({ detail: "Unsupported search" }, { status: 400 });
    if (!url.searchParams.has("next_page_token")) return Response.json({
      voices: [{ voice_id: "first", name: "First" }], has_more: true, next_page_token: "+/cursor=",
    });
    assert.equal(url.searchParams.get("next_page_token"), "+/cursor=");
    return Response.json({ voices: [{ voice_id: "second", name: "Second" }], has_more: false });
  };
  const provider = new ElevenLabs();
  const catalog = await provider.catalog("fixture-key");
  assert.deepEqual(catalog.voices.map((voice) => voice.id), ["first", "second"]);
  assert.deepEqual(catalog.models.map((model) => model.id), ["speech"]);
  requests.length = 0;
  legacy = true;
  await assert.rejects(provider.catalog("fixture-key"), (error) =>
    error instanceof ProviderError && error.httpStatus === 401 && error.code === "invalid_api_key");
  assert.deepEqual(requests, ["/v2/voices", "/v1/voices"]);
  globalThis.fetch = async () => Response.json({
    detail: { code: "request_version_rejected", message: "fixture-key private details" },
  }, { status: 400 });
  await assert.rejects(provider.catalog("fixture-key"), (error) =>
    error instanceof ProviderError && error.code === "request_version_rejected" && !error.message.includes("fixture-key"));
  globalThis.fetch = async () => new Response("Bad request: fixture-key private details", {
    status: 400, headers: { "Content-Type": "text/plain" },
  });
  await assert.rejects(provider.catalog("fixture-key"), (error) =>
    error instanceof ProviderError && error.message.includes("non-JSON response") && !error.message.includes("fixture-key"));
});
