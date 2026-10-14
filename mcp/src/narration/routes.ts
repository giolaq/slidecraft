import { bodyLimit } from "hono/body-limit";
import { randomBytes, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Hono } from "hono";
import { config, narration } from "./config.js";
import { ProviderError } from "./provider.js";
import { ConnectionLinkError } from "./service.js";
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function registerNarrationRoutes(app: Hono) {
  app.use("/narration/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (!config || !narration)
      return c.text("Narration is not configured.", 503);
    await next();
  });
  if (!config || !narration) return;
  const settings = config,
    service = narration;
  const jwks = createRemoteJWKSet(
    new URL(".well-known/jwks.json", settings.issuer),
  );
  const cookie = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/narration",
    maxAge: 600,
  };
  type Session = {
    owner: string;
    ticket: string;
    csrf: string;
    expires: number;
  };
  const page = (body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slidecraft · ElevenLabs</title><style>body{font:18px system-ui;max-width:620px;margin:60px auto;padding:24px;background:#111827;color:white}input{box-sizing:border-box;width:100%;padding:12px;margin:16px 0}button{padding:12px;margin-right:12px}a{color:#cbff73}</style></head><body><h1>Connect your ElevenLabs account</h1>${body}</body></html>`;
  const connectionForm = (session: Session) =>
    `<p>Create a restricted API key in your <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">ElevenLabs settings</a> with Voices read access, Models read access and Text to Speech access. Set a credit limit. The encrypted key stays on the server; never paste it into ChatGPT.</p><form method="post"><input type="hidden" name="csrf" value="${esc(session.csrf)}"><label>ElevenLabs API key<input name="key" type="password" required autocomplete="off" maxlength="512"></label><button>Save connection</button></form>`;
  app.get("/narration/connect", async (c) => {
    const ticket = c.req.query("ticket") ?? "";
    if (!/^[\w-]{43}$/.test(ticket)) return c.text("Invalid link.", 400);
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("base64url");
    setCookie(
      c,
      "sc_narration_login",
      service.vault.seal({
        ticket,
        verifier,
        state,
        expires: Date.now() + 600000,
      }),
      cookie,
    );
    const url = new URL("authorize", settings.issuer);
    url.search = new URLSearchParams({
      client_id: settings.clientId,
      response_type: "code",
      redirect_uri: settings.origin + "/narration/callback",
      audience: settings.audience,
      scope: "openid",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return c.redirect(url.toString());
  });
  app.get("/narration/callback", async (c) => {
    try {
      const flow = service.vault.open<{
        ticket: string;
        verifier: string;
        state: string;
        expires: number;
      }>(getCookie(c, "sc_narration_login") ?? "");
      deleteCookie(c, "sc_narration_login", { path: "/narration" });
      if (
        flow.expires < Date.now() ||
        flow.state !== c.req.query("state") ||
        !c.req.query("code")
      )
        throw new Error();
      const response = await fetch(new URL("oauth/token", settings.issuer), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          code: c.req.query("code"),
          redirect_uri: settings.origin + "/narration/callback",
          code_verifier: flow.verifier,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const token = (await response.json()) as { access_token: string };
      const { payload } = await jwtVerify(token.access_token, jwks, {
        issuer: settings.issuer,
        audience: settings.audience,
        algorithms: ["RS256"],
      });
      if (!payload.sub) throw new Error();
      const owner = settings.issuer + "|" + payload.sub;
      await service.store.transaction((s) => {
        const t =
          s.tickets[createHash("sha256").update(flow.ticket).digest("hex")];
        if (!t || t.owner !== owner || t.expires < Date.now())
          throw new Error();
      });
      setCookie(
        c,
        "sc_narration_session",
        service.vault.seal({
          owner,
          ticket: flow.ticket,
          csrf: randomBytes(32).toString("base64url"),
          expires: Date.now() + 600000,
        }),
        cookie,
      );
      return c.redirect("/narration/settings");
    } catch {
      return c.html(
        page(
          "<p>Sign-in failed, the link expired, or you signed in as a different user. Open a new connection link from Slidecraft.</p>",
        ),
        401,
      );
    }
  });
  app.get("/narration/settings", (c) => {
    try {
      const session = service.vault.open<Session>(
        getCookie(c, "sc_narration_session") ?? "",
      );
      if (session.expires < Date.now()) throw new Error();
      return c.html(
        page(
          connectionForm(session),
        ),
      );
    } catch {
      return c.text(
        "Connection session expired. Open a new link from Slidecraft.",
        401,
      );
    }
  });
  app.post(
    "/narration/settings",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.text("Form is too large.", 413),
    }),
    async (c) => {
      let validatedSession: Session | undefined;
      try {
        if (
          c.req.header("origin") !== settings.origin ||
          Number(c.req.header("content-length") ?? 0) > 4096
        )
          throw new Error();
        const session = service.vault.open<Session>(
          getCookie(c, "sc_narration_session") ?? "",
        );
        const body = await c.req.parseBody();
        if (
          session.expires < Date.now() ||
          body.csrf !== session.csrf ||
          typeof body.key !== "string" ||
          !body.key.trim() ||
          body.key.length > 512
        )
          throw new Error();
        validatedSession = session;
        await service.connect(session.owner, session.ticket, body.key.trim());
        deleteCookie(c, "sc_narration_session", { path: "/narration" });
        return c.html(
          page(
            "<p>Connected. Close this tab and refresh the narration panel in Slidecraft.</p>",
          ),
        );
      } catch (error) {
        if (error instanceof ProviderError && validatedSession) {
          // Only our fixed provider messages are exposed, never upstream bodies
          // or the submitted key. Failed validation does not consume the ticket.
          console.error("Narration connection failed: provider validation.");
          return c.html(page(`<p role="alert">${esc(error.message)}</p>` + connectionForm(validatedSession)), 400);
        }
        const message = error instanceof ConnectionLinkError
          ? error.message
          : validatedSession
            ? "Could not save the connection. Please try again from Slidecraft."
            : "Connection session expired or invalid. Open a fresh connection link from Slidecraft and submit within 10 minutes.";
        console.error(validatedSession ? "Narration connection failed: storage or ticket." : "Narration connection failed: session validation.");
        return c.html(
          page(
            `<p role="alert">${esc(message)}</p>`,
          ),
          400,
        );
      }
    },
  );
  // Asset-specific, encrypted, short-lived bearer grant. Never contains a provider key.
  app.get("/narration/audio", async (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    try {
      const bytes = await service.audio(c.req.query("grant") ?? "");
      c.header("Content-Type", "audio/mpeg");
      return c.body(bytes as Uint8Array<ArrayBuffer>);
    } catch {
      return c.text("Audio unavailable or playback link expired.", 401);
    }
  });
}
