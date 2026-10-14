# ElevenLabs narration deployment

Version 1.8 adds separate editable scripts, per-user connections, durable generation jobs, private recordings, and narrated auto presentation. Existing editing works with narration disabled. This branch does not enable or deploy narration on the existing production server.

## Configure before enabling

Set these as deployment environment variables/secrets, never in committed files:

| Variable | Purpose |
| --- | --- |
| `NARRATION_ENABLED=true` | Enables the feature and requires all configuration below |
| `NARRATION_PUBLIC_URL` | Canonical HTTPS server origin, without `/mcp` |
| `AUTH0_DOMAIN` | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | Auth0 API identifier, normally the canonical HTTPS `/mcp` URL |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Auth0 regular web application for the external connection page |
| `NARRATION_ENCRYPTION_KEY` | 32 cryptographically random bytes encoded as base64; keep stable and backed up |
| `DATABASE_URL` | Managed PostgreSQL connection string with provider-required TLS |
| `NARRATION_S3_BUCKET` | Private bucket for narration MP3s |
| `NARRATION_S3_ENDPOINT` | Optional S3-compatible endpoint (omit for AWS S3) |
| `AWS_REGION` | Storage region, default `us-east-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Bucket-scoped storage credentials, or use the SDK's deployment IAM credential chain |

Generate the encryption key in a secure local terminal: `openssl rand -base64 32`. Save it directly into the platform's secret settings. Rotating it without migrating encrypted records makes existing provider connections, login cookies and media grants unreadable.

Auth0 setup:

1. Create an API with the identifier in `AUTH0_AUDIENCE`, using RS256 signing.
2. Configure the regular web application's callback URL as `NARRATION_PUBLIC_URL/narration/callback`. This application uses authorization code + PKCE and its server-side client secret.
3. Configure Auth0's MCP client registration policy for your clients (mcp-use's Auth0 adapter advertises `/oidc/register`). If your tenant prohibits dynamic registration, register/configure the client according to its supported OAuth flow before connecting it. The web application above is distinct from the MCP client's registration.
4. Reconnect the ChatGPT custom app with OAuth after enabling narration. The enabled server authenticates its MCP endpoint; an old anonymous connection will need to sign in.
5. From Slidecraft, click **Connect ElevenLabs**, sign in as the same user, and enter a restricted ElevenLabs API key on the external page. Grant text-to-speech, voice listing and model listing; set a credit limit. No provider API key belongs in ChatGPT, environment variables shared by users, or deck data.

The external form uses a short-lived encrypted HttpOnly/Secure/SameSite cookie, verified JWT issuer/audience, account-bound one-time ticket and CSRF protection. Reverse-proxy/access logs must redact query strings on `/narration/connect` and `/narration/audio`; those URLs carry short-lived capabilities. Never log POST bodies on account settings or OAuth token exchange.

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
```

The MCP regression script expects narration disabled. The narrated browser test uses the real built widget, real browser audio, real persistence/service logic, and a simulated host bridge/provider/identity. Auth tests separately verify signed JWTs, the real mcp-use bearer gate, account binding, PKCE/state, CSRF and ticket replay. Provider credentials and charges are never required for these tests.

Before production release, configure a staging deployment and verify the real Auth0 tenant, private bucket and ElevenLabs restricted key. Generate a short script, confirm its charge/recording, restart the service, and reopen the saved deck. Then test a fresh ChatGPT widget in both chat and fullscreen pane, including Safari: audio permission, media CSP, visibility pause, refresh/reconnection, speaker view, expiry/retry, cancellation and account disconnect.

The widget fetches owner-authorized short-lived audio URLs from the server origin, converts them to ephemeral Blob URLs, and retains at most current/next speech blobs. View CSP declares the server origin for connections and media and `blob:` for media. A host may apply a stricter policy; actual ChatGPT/Safari acceptance requires testing in those clients. If a host blocks audio or fullscreen, manual presentation remains available. No fallback dedicated presenter site is claimed until a host limitation is demonstrated and that flow is implemented.

No production deployment, real ElevenLabs billing, or real ChatGPT/Safari acceptance is implied by passing local fixtures. HTML exports remain silent; JSON carries scripts/settings, never audio bytes or credentials.
