import assert from "node:assert/strict";

// Run against the actual narration-enabled app, locally or after deployment.
// Only discovery and rejected signed-out calls: no generation or account writes.
const url = process.argv[2] || "http://localhost:3000/mcp";
let id = 0;
const request = (method, params = {}, headers = {}) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
});
async function result(response) {
  assert.equal(response.status, 200);
  const text = await response.text();
  const envelope = JSON.parse(text.startsWith("event:") || text.startsWith("data:")
    ? text.split("\n").find((line) => line.startsWith("data:")).slice(5)
    : text);
  assert.ok(!envelope.error);
  return envelope.result;
}
const init = await result(await request("initialize", {
  protocolVersion: "2025-03-26", capabilities: {},
  clientInfo: { name: "discovery-regression", version: "1" },
}));
assert.equal(init.serverInfo.version, "1.9.2");
const { tools } = await result(await request("tools/list"));
assert.equal(tools.length, 22);
for (const name of ["open-slides", "create-deck", "update-slide", "begin-narration-connection"])
  assert.ok(tools.some((tool) => tool.name === name), `Missing ${name}`);
for (const tool of tools) {
  const schemes = tool.securitySchemes ?? tool._meta?.securitySchemes;
  assert.ok(schemes?.some((scheme) => scheme.type === "oauth2"), `Missing OAuth for ${tool.name}`);
  assert.ok(!schemes.some((scheme) => scheme.type === "noauth"));
  const denied = await request("tools/call", { name: tool.name, arguments: {} });
  assert.equal(denied.status, 401, `Signed-out action allowed: ${tool.name}`);
  assert.match(denied.headers.get("www-authenticate"), /resource_metadata/);
}
assert.equal((await request("tools/list", {}, { Authorization: "Bearer forged-token" })).status, 401);
const challenge = await result(await request("tools/call", {
  name: "open-slides", arguments: {},
}, { "User-Agent": "ChatGPT" }));
assert.equal(challenge.isError, true);
assert.ok(challenge._meta["mcp/www_authenticate"].some((value) => value.includes("resource_metadata")));
console.log(`PASS: ${init.serverInfo.version}, all ${tools.length} tools discoverable, actions protected, ChatGPT login challenge present.`);
