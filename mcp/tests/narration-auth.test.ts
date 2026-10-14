import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Hono } from "hono";
test("secure connection page verifies JWT identity, state, CSRF, ticket ownership and one-time consumption", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "slidecraft-auth-"));
  Object.assign(process.env, {
    NARRATION_ENABLED: "true",
    NARRATION_DEV_DIR: dir,
    NARRATION_PUBLIC_URL: "https://slidecraft.example",
    AUTH0_DOMAIN: "identity.example",
    AUTH0_AUDIENCE: "https://slidecraft.example/mcp",
    AUTH0_CLIENT_ID: "test-web-client",
    AUTH0_CLIENT_SECRET: "test-secret",
    NARRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  const { registerNarrationRoutes } =
    await import("../src/narration/routes.js");
  const { narration, requireOwner } =
    await import("../src/narration/config.js");
  const app = new Hono();
  registerNarrationRoutes(app);
  const service = narration!;
  const owner = requireOwner({ user: { id: "alice" } });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test", alg: "RS256", use: "sig" });
  let subject = "alice",
    audience = process.env.AUTH0_AUDIENCE!,
    providerCalls = 0,
    rejectVoiceKey = false,
    rejectModelKey = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://identity.example/oauth/token") {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer("https://identity.example/")
        .setAudience(audience)
        .setSubject(subject)
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ access_token: token });
    }
    if (url === "https://identity.example/.well-known/jwks.json")
      return Response.json({ keys: [jwk] });
    if (url.startsWith("https://api.elevenlabs.io/v2/voices")) {
      providerCalls++;
      if (rejectVoiceKey) return Response.json({ detail: "private-eleven-key upstream detail" }, { status: 401 });
      return Response.json({ voices: [], has_more: false });
    }
    if (url === "https://api.elevenlabs.io/v1/models")
      return rejectModelKey ? Response.json({ detail: "private-eleven-key upstream detail" }, { status: 403 }) : Response.json([]);
    throw new Error("Unexpected fixture request");
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await service.store.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.throws(
    () => requireOwner({ client: { user: { id: "alice" } } }),
    /Sign in/,
  );
  const begin = async () => {
    const ticket = await service.beginConnection(owner);
    const r = await app.request(
      "https://slidecraft.example/narration/connect?ticket=" + ticket,
    );
    assert.equal(r.status, 302);
    const redirect = new URL(r.headers.get("location")!);
    assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      redirect.searchParams.get("audience"),
      process.env.AUTH0_AUDIENCE,
    );
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(r.headers.get("set-cookie")!, /Secure/);
    return { cookie, state: redirect.searchParams.get("state")! };
  };
  const callback = async (flow: { cookie: string; state: string }) =>
    app.request(
      "https://slidecraft.example/narration/callback?code=fixture&state=" +
        flow.state,
      { headers: { Cookie: flow.cookie } },
    );
  let flow = await begin();
  assert.equal((await callback({ ...flow, state: "wrong" })).status, 401);
  flow = await begin();
  subject = "mallory";
  assert.equal((await callback(flow)).status, 401);
  flow = await begin();
  subject = "alice";
  audience = "wrong-audience";
  assert.equal((await callback(flow)).status, 401);
  audience = process.env.AUTH0_AUDIENCE!;
  flow = await begin();
  const cb = await callback(flow);
  assert.equal(cb.status, 302);
  const session = cb.headers
    .getSetCookie()
    .find((c) => c.startsWith("sc_narration_session="))!
    .split(";")[0];
  const page = await app.request(
    "https://slidecraft.example/narration/settings",
    { headers: { Cookie: session } },
  );
  assert.equal(page.status, 200);
  const markup = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(markup)![1];
  assert.match(
    page.headers.get("content-security-policy")!,
    /frame-ancestors 'none'/,
  );
  const post = (origin: string, token: string) =>
    app.request("https://slidecraft.example/narration/settings", {
      method: "POST",
      headers: {
        Cookie: session,
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf: token, key: "private-eleven-key" }),
    });
  assert.equal((await post("https://evil.example", csrf)).status, 400);
  assert.equal((await post("https://slidecraft.example", "wrong")).status, 400);
  assert.equal(providerCalls, 0);
  rejectVoiceKey = true;
  const voiceFailure = await post("https://slidecraft.example", csrf);
  assert.equal(voiceFailure.status, 400);
  const voiceMessage = await voiceFailure.text();
  assert.match(voiceMessage, /Voices read access/);
  assert.match(voiceMessage, /<form/);
  assert.ok(!voiceMessage.includes("private-eleven-key"));
  assert.equal(await service.connected(owner), false);
  rejectVoiceKey = false;
  rejectModelKey = true;
  const modelFailure = await post("https://slidecraft.example", csrf);
  assert.equal(modelFailure.status, 400);
  const modelMessage = await modelFailure.text();
  assert.match(modelMessage, /Models read access/);
  assert.ok(!modelMessage.includes("private-eleven-key"));
  rejectModelKey = false;
  assert.equal((await post("https://slidecraft.example", csrf)).status, 200);
  assert.equal(await service.connected(owner), true);
  assert.equal((await post("https://slidecraft.example", csrf)).status, 400);
  assert.equal(providerCalls, 3);
  assert.ok(
    !(await readFile(dir + "/state.json", "utf8")).includes(
      "private-eleven-key",
    ),
  );
  const { MCPServer } = await import("mcp-use");
  const { oauth } = await import("../src/narration/config.js");
  const { z } = await import("zod");
  const server = new MCPServer({
    name: "auth-fixture",
    version: "1.0.0",
    oauth: oauth!,
  });
  server.tool(
    { name: "list-narration-voices", inputSchema: z.object({}) },
    async (_, ctx) => ({
      content: [{ type: "text", text: "Authenticated" }],
      structuredContent: await service.catalog(requireOwner(ctx.auth)),
    }),
  );
  t.after(() => server.close());
  const request = (token?: string) =>
    server.fetch(
      new Request("https://slidecraft.example/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list-narration-voices", arguments: {} },
        }),
      }),
    );
  assert.equal((await request()).status, 401);
  assert.equal((await request("forged-token")).status, 401);
  const valid = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://identity.example/")
    .setAudience(audience)
    .setSubject("alice")
    .setExpirationTime("5m")
    .sign(privateKey);
  const authenticated = await request(valid);
  assert.equal(authenticated.status, 200);
  const response = await authenticated.text();
  assert.match(response, /structuredContent/);
  assert.ok(!response.includes("private-eleven-key"));
});
