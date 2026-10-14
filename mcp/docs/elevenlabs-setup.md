# ElevenLabs narration deployment

Version 1.8 adds separate editable scripts, per-user connections, durable generation jobs, private recordings, and narrated auto presentation. Existing editing works with narration disabled. A fresh deployment keeps narration disabled until its identity, database, storage, and encryption settings are configured.

Start with the [complete README setup](../README.md#configure-elevenlabs-narration)
for Manufact deployment, Neon, R2, Auth0, ChatGPT installation, and the
[generation/presentation workflow](../README.md#generate-narration-and-auto-present).
This guide covers the operator details and verification behind that setup.

## Configure before enabling

Set these as deployment environment variables/secrets, never in committed files:

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `NARRATION_ENABLED` | No | `false` while configuring; `true` enables narration and requires the settings below |
| `NARRATION_PUBLIC_URL` | No | Canonical HTTPS server origin, without `/mcp` |
| `AUTH0_DOMAIN` | No | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | No | Auth0 API identifier, normally the canonical HTTPS `/mcp` URL |
| `AUTH0_CLIENT_ID` | No | Auth0 regular web application's client ID |
| `AUTH0_CLIENT_SECRET` | **Yes** | Auth0 regular web application's client secret |
| `NARRATION_ENCRYPTION_KEY` | **Yes** | 32 cryptographically random bytes encoded as base64; keep stable and backed up |
| `DATABASE_URL` | **Yes** | Managed PostgreSQL connection string with provider-required TLS |
| `NARRATION_S3_BUCKET` | No | Private bucket for narration MP3s |
| `NARRATION_S3_ENDPOINT` | No | Optional S3-compatible endpoint (omit for AWS S3) |
| `AWS_REGION` | No | `auto` for R2; actual AWS region for S3, default `us-east-1` |
| `AWS_ACCESS_KEY_ID` | **Yes** | Generated R2/S3 Access Key ID, unless using deployment IAM credentials |
| `AWS_SECRET_ACCESS_KEY` | **Yes** | Generated R2/S3 Secret Access Key, unless using deployment IAM credentials |

Generate the encryption key in a secure local terminal: `openssl rand -base64 32`. Save it directly into the platform's secret settings. Rotating it without migrating encrypted records makes existing provider connections, login cookies and media grants unreadable.

Auth0 setup:

1. Create an API with the identifier in `AUTH0_AUDIENCE`, using RS256 signing.
2. Configure the regular web application's callback URL as `NARRATION_PUBLIC_URL/narration/callback`. This application uses authorization code + PKCE and its server-side client secret.
3. For automatic MCP client registration, enable DCR, grant the API's default third-party user-delegated access, and promote the chosen login connection to domain level. Enable that connection for the web application as well. See the [Auth0 checklist](../README.md#3-configure-auth0) for dashboard steps. If your tenant prohibits dynamic registration, register/configure the MCP client according to its supported OAuth flow before connecting it. The web application above is distinct from the MCP client's registration.
4. Reconnect the ChatGPT custom app with OAuth after enabling narration. Version 1.8.1 allows unauthenticated initialization and catalog discovery so clients can list tools before login. Every tool invocation still requires verified OAuth. An old anonymous connection will need its authentication settings refreshed and must sign in.
5. From Slidecraft, click **Connect ElevenLabs**, sign in as the same user, and enter a restricted ElevenLabs **secret API key value** on the external page, not its key ID. Grant Text to Speech access, Voices read and Models read; set a credit limit. Submit within 10 minutes and verify the page says **Connected**. No provider API key belongs in ChatGPT, environment variables shared by users, or deck data.

`api_key_id_used_as_api_key` identifies the key-ID-versus-secret mistake. Create
a new restricted key if its secret is no longer visible, and copy the secret
when it is shown. Other errors identify the operation and safe provider code
or response format. Do not assume every HTTP 400 means an expired key. The
current provider uses ElevenLabs' standard API endpoint; per-user data-residency
endpoints are not configurable.

Optional `NARRATION_PROVIDER_DIAGNOSTICS=true` runs a one-time startup check
using a deliberately invalid test key. It records response metadata without
raw bodies or real credentials and never generates speech. Leave it unset or
`false` normally. To run it, set it, redeploy/restart, inspect the deployment's
runtime logs, then set it back to `false`.

The external form uses a short-lived encrypted HttpOnly/Secure/SameSite cookie, verified JWT issuer/audience, account-bound one-time ticket and CSRF protection. The settings page uses `Referrer-Policy: same-origin` so browser form POSTs preserve their Origin; other narration routes use `no-referrer`. Do not change the form policy back to `no-referrer` or weaken the Origin/CSRF checks to work around setup errors. Reverse-proxy/access logs must redact query strings on `/narration/connect` and `/narration/audio`; those URLs carry short-lived capabilities. Never log POST bodies on account settings or OAuth token exchange.

Storage and workers:

- The app creates `slidecraft_narration` on first use; grant its database user permission to create this table, or create it via a migration first (`id integer PRIMARY KEY, state jsonb NOT NULL`). A PostgreSQL advisory transaction lock serializes state changes across instances. This first version uses a JSONB state row suited to modest deployments; migrate to indexed per-record tables before large workloads.
- Give the service PutObject/GetObject/DeleteObject on the private bucket's `narration/` prefix. Block public access, enable encryption at rest, and back up the database and encryption key. Do not configure object expiration that removes referenced recordings.
- Keep at least one service instance running on Manufact. Each instance polls the persisted queue every two seconds and claims account-scoped jobs with leases. A closed widget does not cancel work. There are no widget-owned generation promises. Scale-to-zero pauses processing until an instance runs again.
- The worker submits one request at a time per account. Expired leases, network timeouts and ambiguous provider/server failures are marked `uncertain`; the user must review provider usage before retrying. Rate limits have three bounded attempts. Cancelling does not undo a charge already submitted.
- Matching clips are reused by account version and canonical speech-input hash. Playback remains available to the owner after disconnect. Worker completion never replaces the editable deck. Status resolves audio against the current script/settings; old work cannot overwrite newer edits.
- Every hour, cleanup removes unreferenced/superseded assets older than seven days and ordinary completed jobs older than 30 days. Saved references are protected; uncertain jobs remain as billing-safety records. Explicit account deletion removes jobs, connections, scripts, tickets and audio references immediately. Durable deletion tombstones retry failed object deletion.
- Regular live sync remains the existing per-instance, 24-hour session mechanism. Narration decks additionally have durable per-user snapshots; use the recovery tools after a restart. This feature does not turn all anonymous decks into a multi-instance cloud library.

For development only, `NARRATION_DEV_DIR=/absolute/private/path` replaces PostgreSQL/S3 with persistent files. It is rejected under `NODE_ENV=production` and must have only one process. Do not put it under a public or committed directory. Auth0 configuration and HTTPS are still required for the real connection flow. Tests use isolated synthetic identities/provider responses without real credentials.

## Test and release

```bash
npm ci
npm run typecheck
npm test
# Optional: exercise actual PostgreSQL locking against an isolated test database
TEST_DATABASE_URL=postgres://... npm test
npm run build
PORT=3017 npm start
# In another terminal
node tests/mcp-check.mjs http://localhost:3017/mcp
node tests/widget-check.mjs http://localhost:3017/mcp
node --import tsx tests/narration-widget-check.mjs http://localhost:3017/mcp
# Against a separate narration-enabled server:
node tests/mcp-auth-discovery-check.mjs https://your-server.run.mcp-use.com/mcp
```

The anonymous MCP/editor regression scripts expect narration disabled. The
auth-discovery check expects narration enabled and verifies public discovery,
protected actions, invalid-token rejection, and ChatGPT's login challenge. It
does not generate audio. The narrated browser test uses the real built widget,
real browser audio, real persistence/service logic, and a simulated host
bridge/provider/identity. Auth tests verify signed JWTs, the real mcp-use bearer
gate, account binding, PKCE/state, CSRF, ticket replay, and browser form submission.
The browser subtest needs Chromium and is skipped if its binary is unavailable;
set `CHROMIUM_PATH` when it is not `/usr/bin/chromium`. PostgreSQL integration is
optional via `TEST_DATABASE_URL`. Provider credentials and charges are never
required for these tests.

Before production release, configure a staging deployment and verify the real Auth0 tenant, private bucket and ElevenLabs restricted key. Generate a short script, confirm its charge/recording, restart the service, and reopen the saved deck. Then test a fresh ChatGPT widget in both chat and fullscreen pane, including Safari: audio permission, media CSP, visibility pause, refresh/reconnection, speaker view, expiry/retry, cancellation and account disconnect.

The widget fetches owner-authorized short-lived audio URLs from the server origin, converts them to ephemeral Blob URLs, and retains at most current/next speech blobs. View CSP declares the server origin for connections and media and `blob:` for media. A host may apply a stricter policy; actual ChatGPT/Safari acceptance requires testing in those clients. If a host blocks audio or fullscreen, manual presentation remains available. No fallback dedicated presenter site is claimed until a host limitation is demonstrated and that flow is implemented.

No production deployment, real ElevenLabs billing, or real ChatGPT/Safari acceptance is implied by passing local fixtures. HTML exports remain silent; JSON carries scripts/settings, never audio bytes or credentials.
