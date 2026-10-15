# Slidecraft MCP App

An animated presentation studio for ChatGPT and other MCP Apps hosts, built with
**mcp-use v2.8.2** from the official `mcp-apps` widgets template.

Create a deck in conversation, preview it in an interactive widget, ask questions,
revise individual slides, and export a standalone HTML presentation. Includes a
reusable authoring skill served over MCP and ChatGPT global/thread entrypoints.

## Local development

Requires Node.js 22.22.2+.

```bash
npm ci
npm run dev
```

- MCP endpoint: `http://localhost:3000/mcp`
- Inspector: `http://localhost:3000/mcp/inspector`
- In the Inspector, call **open-slides** with `{}` to see the demo.

## Tools

| Tool | Purpose |
| --- | --- |
| `open-slides` | Open a supplied deck, or the demo, in the studio |
| `create-deck` | Validate authored slides and assign a deck ID |
| `update-slide` | Change fields on a stable slide ID |
| `set-theme` | Change background, text, and highlight colors with a fresh preview |
| `revise-presentation` | Atomic edits to any deck field, nested content, HTML/CSS/JS, duplication, deletion, and redesign |
| `edit-deck` | Add, remove, move, or change deck title/theme |
| `add-photo` | Optimize and embed an image in a slide |
| `get-live-deck` | Read the latest shared live-session snapshot |
| `inspect-deck` | Read structure, notes, word counts, and density warnings |
| `export-deck` | Generate HTML or editable JSON; download through the widget |
| `get-narration-status` | Read account connection and per-slide recording readiness |
| `begin-narration-connection` | Create the secure external ElevenLabs setup link |
| `disconnect-narration` | Disconnect the provider account; saved audio remains available |
| `list-narration-voices` | Load the connected account's voices and speech models |
| `generate-narration` | Queue explicitly confirmed audio generation |
| `get-narration-job` | Read durable generation progress |
| `cancel-narration-job` | Cancel work not yet submitted |
| `get-narration-playback` | Obtain an owner-authorized, short-lived audio link |
| `list-narrated-decks` | List the user's durable narration deck snapshots |
| `reopen-narrated-deck` | Recover a saved narration deck after a restart |
| `delete-narration` | Delete deck narration or the user's narration account data |

Use `plan-presentation` for a starting brief. The `skills/slidecraft` catalog
teaches agents how to plan, critique, revise, and export without inventing facts.

Try: “Use Slidecraft to create six slides explaining our migration plan for an
engineering audience. We have ten minutes.” Then: “Make the third slide clearer.”

## Widget and persistence

Color edits use `set-theme`, which returns the changed deck and an updated preview. A mounted `change-visible-slide-colors` tool can update the open widget directly where supported. Connected studios reload newer revisions automatically.

The studio provides slide navigation, automatic entrance animations, speaker
notes, direct title/body/notes editing, JSON import, HTML/JSON export, motion
replay, and an Ask agent action where the host supports follow-up messages.
Fullscreen is requested through the host and depends on host support.

Decks travel as complete JSON snapshots. A private syncToken connects them to a live revision stored on the server filesystem for up to 24 hours. View state gives the host the
latest deck and selected slide. **Download JSON to preserve a durable copy**;
host state is not a cloud storage service. Revision checks reject stale updates to the shared live session. Notes are preserved in JSON;
HTML excludes notes unless the user enables them.

Custom HTML/SVG, CSS, and JavaScript render in an isolated iframe using the same renderer as the HTML export. Authored code cannot access the studio document or host bridge; the sandbox allows scripts but not same-origin access. Host CSP may restrict external resources.
Built-in animations respect reduced-motion settings. External assets remain
external unless embedded. Deck authoring requires no separate AI API key:
the connected host agent authors and revises the deck. Optional ElevenLabs
narration requires the per-user provider connection described below.

Downloads use host file APIs where available, with browser download and visible
file-content fallbacks. Actual ChatGPT file uploads, fullscreen, follow-up
messages, and launcher availability depend on the host version and permissions.

## ChatGPT app / plugin

The server advertises a view resource and global/thread entrypoints on
`open-slides`. To install an existing deployment from scratch:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+ → Add custom MCP server**, and name it **Slidecraft**. In interfaces that still use Apps/Connectors settings, use the equivalent custom MCP connection flow; enable developer mode if required by your account/workspace.
2. Enter the deployment's HTTPS MCP URL, including `/mcp`, such as `https://your-server.run.mcp-use.com/mcp`.
3. Choose **OAuth** with **Automatic / Dynamic Client Registration** when narration is enabled. Leave client ID/secret blank for automatic registration. The Auth0 web application's secret belongs on the server, not in this ChatGPT form. With narration disabled, the basic editor uses no authentication.
4. Accept the connection warning, select **Create as a plugin**, and complete Auth0 sign-in when prompted. An existing Auth0 session can sign in without showing another login screen.
5. Install/enable the resulting plugin, start a new chat, and select **Slidecraft** using `@` (or the app picker). Ask: “Use Slidecraft to create a three-slide presentation.”
6. After server authentication or metadata changes, open the connection and select **Refresh**, complete any sign-in, and test in a new conversation.

Connecting a custom app is separate from publishing it in a public directory;
this project does not perform directory submission.

## Verification

```bash
npm run typecheck
npm test
npm run build
# With npm run dev running:
npm run test:mcp
npm run test:widget
npx mcp-use screenshot --mcp http://localhost:3000/mcp --tool open-slides --output preview.png
```

MCP integration checks exercise creation, focused revisions, invalid/stale edits,
structure changes, inspection, export, view metadata, and skill discovery.

## Deploy to Manufact Cloud

```bash
npx -y mcp-use@latest login
# Managed private source repository:
npx -y mcp-use@latest deploy --no-github -y
# Or use your own GitHub origin, with the mcp-use GitHub App installed:
# From the repository root (one directory above mcp/):
npx -y mcp-use@latest deploy --root-dir mcp -y
```

The CLI stores the project link under ignored `.mcp-use/cloud/`. Keep credentials
and `.env` files out of source control. The deployment output supplies the server
and dashboard URLs. The dashboard provides logs, analytics, and evaluation tools.

Run the managed-upload command from `mcp/`; it uploads that project. For your own
GitHub source, push the repository first and install the
[mcp-use GitHub App](https://github.com/apps/mcp-use/installations/new) in the
account/organization that owns it. Select `mcp` as the repository's source root
with `--root-dir mcp`. Use the same deployment mode and working directory on
subsequent deploys so the CLI reuses its saved server link. Keep the initial
deployment's narration disabled until the following setup is complete.

Single-slide colors: call `set-theme` with `slideId` and a partial `colors` palette. The returned preview selects that slide automatically. Per-slide `colors` override the deck palette in both preview and HTML. The mounted color tool defaults to the selected slide; use `scope: "deck"` for presentation-wide changes.

## General editing

Use `revise-presentation` with the latest deck, expectedRevision, and an array of JSON Patch edits. A mounted `edit-visible-presentation` tool uses the latest widget state automatically. Edit text, nested arrays, speaker notes, layouts, colors, typography, spacing, custom HTML/SVG, CSS, JavaScript, or the entire slide list. Transactions validate as a whole and preserve the input on error. Remove optional fields to reset them. Copy plus a new unique id duplicates a slide. See the bundled authoring skill for examples.

Custom content runs inside the isolated preview. External media depend on host CSP; embedded images/SVG work without third-party requests. Tests cover the actual server and browser runtime with a simulated host bridge, not the ChatGPT application's own tool-selection behavior.

Live sync: connected studios check `get-live-deck` approximately every two seconds and adopt newer revisions without imports. Preserve `syncToken` when editing. The token is a private bearer capability: anyone receiving the full JSON can access that live session. Importing JSON forks a new session. Old pre-sync widgets need one reopen. Sync currently targets a single server instance, expires after 24 hours without a saved edit, and is not a durable storage service. A host may pause off-screen widgets; they catch up when resumed.

The studio displays its app version and live connection status. Pane refresh uses a read-only, bearer-protected HTTP endpoint on the server origin, with the MCP tool bridge as a fallback. It retries on focus/display-mode changes and reports unavailable or expired sessions instead of silently appearing synchronized. Restored pane state follows the opened deck’s live-session token.

Photos: use `add-photo` with a direct public HTTPS image URL or base64 PNG/JPEG/WebP/GIF source. It validates and optimizes the image, then embeds WebP data in `slide.image: {src,alt,caption?,fit}`. This avoids external-image CSP and expiring URL failures. Never put Markdown images in plain text or local/sandbox file paths in src. Image downloads are capped at 8 MB, optimized images at 120 KB, and decks at 1.5 MB. Exports contain the embedded photo. Failed images show a visible message; do not claim an image is visible solely because an edit succeeded.

Use **Present** for an audience-only slide view. It requests browser fullscreen, falling back to the host's fullscreen display mode when available. Arrow keys and presenter buttons navigate; Escape or Exit presentation returns to editing. **Speaker view** shows current and next slides, notes, and elapsed time in the same window. It is not yet a separate synchronized monitor/window—keep speaker view off the audience display. Audience mode omits notes from its rendered deck. Exported HTML can be opened directly in a browser when the host blocks fullscreen.

## Visual editor

Select **Visual edit** on a standard slide to move and resize text and images, pick text/background colors, upload photos, and reorder or delete elements. Arrow keys move a selected element by one pixel (Shift moves ten). Save with **Save visual edits**; Cancel discards the draft. Template slides become a freeform layout after saving; the original fields are retained. Review the converted layout before saving. Custom HTML/CSS/JavaScript decks continue to use agent editing.

Visual elements use the same 1600×900 coordinates in the editor, audience view, and HTML export. Agents can edit `slide.elements` through `revise-presentation`, including individual text, positions, dimensions, and colors. Uploaded images are embedded so exports remain portable. If another editor or agent saves a newer revision while a manual draft is open, the stale save is rejected and the draft stays available.

Select an element in Visual edit to align it to the slide’s left/right/top/bottom edges or horizontal/vertical center. Text alignment separately controls left, center, or right alignment inside a text box. Save visual edits preserves alignment in previews and exports.

Image uploads adapt both encoding quality and dimensions to the embedded-image limit. Browsers without WebP encoding fall back to JPEG for opaque photos and smaller PNGs for transparent artwork, preserving transparency. Input limits remain 8 MB and 40 megapixels; saved image URLs remain at most 180,000 characters.

## Smart guides and relative alignment

Dragging an item or selection shows pink guide lines and snaps its edges or center to nearby items and the slide. Hold Alt to bypass snapping, or turn off **Snap to guides**. Shift-click (also Cmd/Ctrl-click) toggles items in the selection. Dragging or nudging a selection preserves its relative positions. Click the blank canvas to clear selection.

With multiple items selected, alignment controls align them within their combined bounds. With at least three, **Distribute horizontally/vertically** creates equal gaps while keeping the outside items fixed; spread overlapping items farther apart first if there is insufficient space. A single selected item retains the slide-edge alignment controls. Guides are editor-only and are not exported. Save visual edits publishes the final positions to the shared deck.

## Configure ElevenLabs narration

Narration is optional and disabled by default. The basic editor works without
an ElevenLabs key. To enable narration for your own deployment, configure Auth0,
PostgreSQL, and private S3-compatible storage. Each user then connects their own
ElevenLabs key through the external account page.

### 1. Deploy once to obtain the public URLs

Install dependencies in `mcp/`, log in to Manufact, and deploy using one of the
[deployment modes above](#deploy-to-manufact-cloud). Leave `NARRATION_ENABLED`
unset or `false` for this first deployment.

Record the server origin (for example `https://your-server.run.mcp-use.com`),
its MCP URL (the origin plus `/mcp`), and the Manufact dashboard URL. All URLs
below must use your own origin. Configure variables in the server's Manufact
environment settings for **production**, using the **Secret** option where
marked below. Do not commit a populated environment file.

### 2. Create the database and audio bucket

**Neon / PostgreSQL:** Create a Neon project/database (or use another managed
PostgreSQL service). Copy its PostgreSQL connection string with the provider's
TLS parameters into the secret `DATABASE_URL`. The database user must be able to
create the `slidecraft_narration` table; Slidecraft initializes it automatically.
See the [operator guide](docs/elevenlabs-setup.md) for the schema and worker behavior.

**Cloudflare R2 / S3:** Create a private R2 bucket, such as `slidecraft-narration`.
Create an R2 API token with **Object Read & Write** access restricted to that
bucket. Copy the generated **Access Key ID** and **Secret Access Key** into
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. These are the S3 credentials
shown when the R2 token is created, not the generic Cloudflare API-token value.
Copy the bucket's S3 API endpoint, normally
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, into `NARRATION_S3_ENDPOINT`,
set `NARRATION_S3_BUCKET` to the bucket name, and set `AWS_REGION=auto`.
Keep public bucket access disabled.

For AWS S3, omit the endpoint, use the actual AWS region, and give the service
PutObject/GetObject/DeleteObject access on the bucket's `narration/` prefix.
An IAM credential chain can replace explicit AWS credential variables.

### 3. Configure Auth0

1. Create an Auth0 tenant and an API named **Slidecraft**. Its **Identifier** must match your canonical MCP URL exactly, including `/mcp`. Use **RS256** signing.
2. Create a **Regular Web Application** named **Slidecraft Settings**. Set its **Allowed Callback URLs** to `https://your-server.run.mcp-use.com/narration/callback`. Save its domain, client ID, and client secret in the variables below.
3. In tenant **Settings → Advanced**, enable **Dynamic Client Registration (DCR)** for automatic MCP client registration.
4. In **Applications → APIs → Slidecraft → Settings → Default Permissions for Third Party Apps**, authorize **User-Delegated Access**. Slidecraft currently defines no custom required API scopes. This flow uses end-user login; machine-to-machine authorization does not replace it.
5. In **Authentication → your connection type → your login connection**, enable **Promote Connection to Domain Level** so dynamically registered clients can use it. Also enable the connection for **Slidecraft Settings**.
6. In the API's **Application Access**, authorize **Slidecraft Settings** for user-delegated access if it is not already authorized.

Auth0 console labels can vary. If a client omits Auth0's `audience` parameter,
a dedicated Slidecraft tenant can set **Default Audience** to the MCP URL.
For a shared tenant, check how that tenant-wide change affects other applications
before changing it. Your MCP client registration and the **Slidecraft Settings**
web application are separate OAuth clients.

### 4. Save deployment variables and secrets

| Variable | Secret? | Value / purpose |
| --- | --- | --- |
| `NARRATION_ENABLED` | No | Keep `false` during setup; set `true` once all entries below are saved |
| `NARRATION_PUBLIC_URL` | No | Server HTTPS origin, without `/mcp` or trailing slash |
| `AUTH0_DOMAIN` | No | Your Auth0 tenant domain, such as `your-tenant.us.auth0.com` |
| `AUTH0_AUDIENCE` | No | The Auth0 API identifier: your complete HTTPS `/mcp` URL |
| `AUTH0_CLIENT_ID` | No | Client ID of **Slidecraft Settings** |
| `AUTH0_CLIENT_SECRET` | **Yes** | Client secret of **Slidecraft Settings** |
| `NARRATION_ENCRYPTION_KEY` | **Yes** | 32 random bytes encoded as base64; generate once and keep stable |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string with required TLS options |
| `NARRATION_S3_BUCKET` | No | Private audio bucket name |
| `NARRATION_S3_ENDPOINT` | No | R2/S3-compatible HTTPS endpoint; omit for AWS S3 |
| `AWS_REGION` | No | `auto` for R2; your bucket's AWS region for S3 |
| `AWS_ACCESS_KEY_ID` | **Yes** | Generated R2/S3 Access Key ID, unless using deployment IAM credentials |
| `AWS_SECRET_ACCESS_KEY` | **Yes** | Generated R2/S3 Secret Access Key, unless using deployment IAM credentials |

Generate the encryption key in your own secure terminal with:

```bash
openssl rand -base64 32
```

Save the output directly as a Manufact secret and keep a secure backup. Reuse it
on every deployment: changing it makes existing encrypted ElevenLabs connections
and media grants unreadable. Do not add a shared `ELEVENLABS_API_KEY` to the
server environment; provider credentials are per user.

Optional `NARRATION_PROVIDER_DIAGNOSTICS=true` enables a one-time startup
connectivity check using a deliberately invalid test key. It logs only safe
response metadata and performs no speech generation. Leave it unset/`false`
normally, and turn it off after troubleshooting.

### 5. Enable narration and redeploy

Set `NARRATION_ENABLED=true` and redeploy the **same linked server** using the
original mode/working directory. For a managed upload, from `mcp/`:

```bash
npx -y mcp-use@latest deploy --no-github -y
```

For a GitHub deployment, push changes and use the original
`deploy --root-dir mcp -y` command from the repository root. Do not use `--new`
when updating an existing deployment. Wait until Manufact shows **running** and
the new deployment serves production traffic. Use the supplied MCP and dashboard
URLs to connect clients and inspect logs.

Use `npm run build` for production builds: its build-only flag prevents background
workers/database connections during view discovery. Do not set
`SLIDECRAFT_BUILD_ONLY` in the runtime environment. Keep at least one instance
running so durable narration jobs can progress.

Install or refresh the ChatGPT connection following
[ChatGPT app / plugin](#chatgpt-app--plugin). With narration enabled, clients can
discover the tools before login, but every tool invocation requires verified OAuth.

### 6. Connect each user's ElevenLabs account

1. Open a deck and expand **Narration → Connect ElevenLabs**.
2. On the external page, sign in with the **same Auth0 account** used for the ChatGPT connection.
3. In [ElevenLabs API-key settings](https://elevenlabs.io/app/settings/api-keys), create a restricted key with **Voices read**, **Models read**, and **Text to Speech** access, plus a suitable credit limit.
4. Copy the **secret API key value**, not the **key ID** shown in the key list. The secret may be shown only when you create the key; create a new key if you cannot retrieve it. Paste it only into Slidecraft's external connection form, never into chat or deck JSON.
5. Submit within 10 minutes and wait for **Connected. Close this tab…**. Then return to Slidecraft, reopen the Narration panel if needed, wait for connection status to update. Voices load automatically; use **Manage connection → Refresh voices** to retry if needed.

The current integration uses the standard `https://api.elevenlabs.io` endpoint;
per-user data-residency endpoints are not currently configurable.

## Generate narration and auto-present

1. Choose a **Voice** and **Model** in the Narration panel.
2. Click **Write Narration** once to ask your agent to write and save separate scripts for all speech slides in the presentation, including slides with existing scripts. Slides marked **Silent slide** keep their silent mode and dwell time. The agent uses **save-narration-script**, a server tool that works even when ChatGPT does not expose widget tools. The studio reloads the saved script automatically; a reply containing a script alone does not save it. Review or edit it; click **Save narration** after manual edits. Writing a script does not generate audio or spend ElevenLabs credits. Emotion and vocal cues are model-aware: Write Narration requires at least one emotion tag for v3/v4, and its save action checks that the tag is present; Multilingual v2 uses natural phrasing and punctuation.
3. For slides without speech, select **Silent slide**, set its **Dwell time (seconds)**, and save.
4. Click **Generate narration…**. Review the voice, model, slides, and character count, then select **Confirm and generate**. This submits paid requests to your ElevenLabs account; matching recordings are reused.
5. Wait until every slide is **ready** or **silent** and the ready counter matches the slide count. Use **Preview audio** to check a recording and your output volume before the presentation.
6. Click **Present**, reveal the bottom controls, and choose **Auto present from beginning** or **Auto present from here**. Narration advances on audio completion; silent slides advance after their dwell time. The final slide remains on screen.
7. If the browser blocks playback, click **Resume audio**. Manual slide navigation and hiding/switching away from the presentation pause narration. Use pause/resume, replay, and volume controls as needed. Controls hide when idle.

After changing scripts, voice, or model/settings, save and generate any affected
recordings before starting auto-present. Presentation uses a snapshot taken when
it opens; exit and reopen Present after further deck edits. **Speaker view** shows
notes, the narration script, and current/next slides; it currently shares the
presentation window, so keep it off the audience display.

Try asking an agent: “Write and save a narration script for every slide in this
deck. Let me review them before generating audio.” Script writing and paid audio
generation are separate actions.

## Narration troubleshooting

| Symptom | What to check |
| --- | --- |
| `api_key_id_used_as_api_key` | Paste the secret API key value, not its ID. If the secret is no longer visible, create a new restricted key and copy the secret when shown. |
| `invalid_api_key` / rejected key | Check that the secret is current, copied in full, and belongs to the intended ElevenLabs account. Enter it only on the external form. |
| `missing_permissions` | Enable Voices read, Models read, and Text to Speech access on that key. The error identifies which request failed. |
| Connection session expired or invalid | Close old setup tabs, open a fresh Connect link, and submit within 10 minutes. Use a current release; v1.8.3 fixed a browser form-origin/referrer-policy bug. |
| HTTP 400 without a useful reason | Read the current error's operation, safe code, and response format. v1.8.6 expands safe diagnostics; do not assume every 400 means the key expired. Operators can temporarily enable the startup connectivity diagnostic and inspect logs. |
| ChatGPT could not connect the account | Inspect Auth0 Monitoring → Logs. Check DCR, user-delegated API access, domain-level login connections, callback URLs, and API audience. A successful code exchange alone does not prove the entire connection completed. |
| Creation tools unavailable in a session | Refresh the custom MCP connection, complete OAuth, select/install Slidecraft, and use a new chat. v1.8.1 permits catalog discovery before login. |
| Review shows **0 characters** / “Write scripts or mark these slides silent” | Add and save scripts, or mark the included slides silent and save. Notes/slide text must be explicitly copied to the script. |
| **Generate narration…** disabled | Ensure account status is connected, voice settings are saved, and no script/settings draft is unsaved. Wait for any busy operation to finish. |
| **Confirm and generate** disabled | Every included speech slide needs a saved script, and at least one included recording must need work. If all audio is already current, generation is unnecessary. |
| Auto-present buttons absent | Every slide in the presentation must be ready or silent. Save/generate changed recordings, then reopen Present. |
| Audio does not start | Use Preview audio, check tab/system mute and volume, and click Resume audio if autoplay was blocked. Keep the presentation visible. |
| Job marked `uncertain` | Check ElevenLabs usage before explicitly retrying; an interrupted request may already have been charged. |

Generated audio stays outside deck JSON and is served through owner-authorized,
short-lived links. JSON retains scripts/settings; HTML export remains silent.
Narration-enabled decks have durable per-user recovery through
`list-narrated-decks` / `reopen-narrated-deck`. Regular live editing still uses the
existing single-instance, 24-hour session storage. See the
[operator and verification guide](docs/elevenlabs-setup.md) for production details.

### Create a new deck without replacing the current one

When the agent finishes creating a presentation, it asks whether to load it now or keep it for later. The creation card offers **Load now**, **Keep for later**, and **Download JSON**. The new deck is not loaded until you choose. A complete JSON copy is saved to your signed-in account on the configured cloud service, even without ElevenLabs or narration. You can retrieve it through the saved-deck tools (currently named `list-narrated-decks` and `reopen-narrated-deck`). On a local server without durable account storage, download the JSON to keep a permanent copy. **Show JSON backup** provides a fallback when a host blocks downloads. Normal edits to your current deck continue to update it directly.

### Finding your way around the studio

The canvas is the main workspace, with the slide list on the left (a horizontal strip on small screens). **Present** stays in the header. **File** contains Import JSON, Save JSON, Export HTML, the notes export option and Replay motion. Below the canvas, choose **Edit slide**, **Narration** or **Speaker notes** to open one contextual panel at a time; **Visual edit** stays next to slide navigation. Narration loads voices automatically, keeps connection changes and detailed recording options collapsed, and preserves unsaved narration drafts while you switch panels.
