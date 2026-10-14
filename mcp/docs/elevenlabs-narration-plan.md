# ElevenLabs narration and Auto present

Status: design only. No runtime changes, credentials, paid speech requests, or deployment in this branch.

Branch: `plan/elevenlabs-narration`. Based on the deployed Slidecraft v1.7.0 snapshot, GitHub commit `9444b55074dd63f8268eb7595f79e6f823bf6c02` (PR #3). That PR was still open when this plan was written; keep this work separate and rebase after its merge if necessary.

## Confirmed product decisions

- Each slide has a **separate editable narration script**, independent of visible text and speaker notes.
- **Each user connects their own ElevenLabs account**; generation consumes that account's credits.
- A **Generate narration** button prepares narration before the presentation.
- Once preparation completes, **Present → Auto present** plays each slide's narration and advances automatically when its audio ends.

## User experience

1. Open a **Narration** panel alongside the visual editor. Every slide has a script editor, character count, narration status, and Preview audio button.
2. **Connect ElevenLabs** opens a dedicated secure account-settings page. Show connected/disconnected status in the widget, never the credential. Users can replace or disconnect their connection.
3. Choose a voice available in that user's account and a supported model. Use one voice per deck initially. Recommend Multilingual v2 as the initial baseline for prepared narration, but fetch capabilities and validate account access rather than hard-coding that it is the latest or universally available model.
4. Scripts start empty. Optional **Copy speaker notes** and **Copy slide text** actions fill the editor explicitly; do not silently read speaker notes. Agents can draft scripts on request through ordinary slide editing. For visual slides, text extraction reads visible text elements, not stale title/body metadata. Custom HTML requires an explicit script rather than guessing a reading order from arbitrary markup.
5. **Generate narration** opens a review of scripts, voice, slides requiring work, and estimated character usage. The final Generate button starts the batch. Empty scripts block readiness unless the user explicitly marks that slide **Silent** and sets a dwell duration (default 5 seconds). No paid request for silent slides. Do not invent an exact monetary price when the account/model rate is unavailable.
6. Show per-slide `Not generated`, `Queued`, `Generating`, `Ready`, `Needs regeneration`, or `Failed`, with overall progress such as “4 of 7 ready.” Allow Cancel remaining, Retry failed, and Regenerate this slide. Keep successful audio when another slide fails. Preview and revisiting the deck do not trigger new generation.
7. **Auto present** becomes available when every slide has current, playable audio or an explicit silent duration. Start from the current slide, with an explicit Start from beginning alternative. Pause/resume, volume, replay current slide, previous/next, and Exit remain available through the existing auto-hiding presenter controls.
8. When the final audio ends, remain on the final slide in an Ended state. Do not loop or exit fullscreen automatically. Return to manual mode or replay on request.

Existing decks without narration continue to work normally. This feature does not replace manual presenting.

## Provider connection and authenticated ownership

ElevenLabs' documented third-party connection path uses the user's API key. Plan v1 around a secure per-user key connection, not an invented “Sign in with ElevenLabs” OAuth flow. Their CLI login and workspace outbound OAuth connections are not evidence that Slidecraft can register a delegated TTS OAuth application. Revisit native delegated authorization only after verifying a supported registration flow.

Slidecraft currently has bearer-capability live sessions, not verified user accounts. Add verified Slidecraft user identity for narration before enabling paid generation. Use an OIDC provider through an installed, supported mcp-use OAuth adapter; provider selection and configuration are a prerequisite to implementation. Use verified server auth context to scope connections, jobs, decks, and assets. A client-supplied user ID, conversation ID, or syncToken must never select whose ElevenLabs account to charge.

Connection flow:

- An authenticated tool returns a short-lived, single-use setup link bound to that user's verified identity. The external settings page authenticates the same user and validates the link/state before accepting a credential.
- The user enters an ElevenLabs API key only in that settings form, over HTTPS. It goes directly to an authenticated backend endpoint, never through chat, MCP tool arguments, model context, URL parameters, localStorage, deck JSON, or source control.
- Validate with a non-generating provider call; report scope/access problems without revealing the key. Store the credential encrypted server-side using managed key material, scoped to the user. Avoid logging request bodies and provider authorization headers.
- Request only the provider permissions needed for voice/model discovery and TTS. Explain generation uses the connected account's credits. Support key replacement and deletion; disconnect blocks new generation and pending work. Previously saved audio remains available to its owner until they delete it.
- Enforce deck ownership for paid actions. Importing another person's deck creates the importer's own deck; it does not import provider connections or grant access to the original audio. A shared live token alone cannot spend another person's credits.

The provider API is called only by the server. No microphone permission or voice cloning is needed for this feature.

## Audio and metadata storage

Do not embed MP3 base64 in the current 1.5 MB deck JSON or poll it through live sync. Store audio in private, durable object storage and keep small asset references in the deck.

Proposed production foundation: managed PostgreSQL for authenticated ownership, encrypted connection references, generation jobs, and narration manifests; S3-compatible private object storage for MP3s. Choose actual providers from the user's available accounts before implementation. This plan does not provision infrastructure. Local development can use file-backed adapters; production must not fall back to `/tmp` silently.

Current `src/live-decks.ts` expires session files after 24 hours and loses them on restart/deploy. Extend persistence for narration-enabled decks so scripts, manifests, and ownership can be reopened after session expiry. Reopening a saved deck creates/resumes a live sync session from the durable record; syncToken is not a durable owner identifier.

Suggested data shape (names provisional; schema-backed and validated when implemented):

- Deck narration settings: `voiceId`, `modelId`, supported generation settings, output format.
- Slide narration input: `script`, `mode: speech | silent`, optional `silentDurationMs`.
- Slide narration result: opaque `assetId`, `inputHash`, `durationMs`, MIME type, generated timestamp, asset revision. Job progress remains in job records rather than repeatedly rewriting the whole deck.
- Persisted connection: verified owner ID, encrypted credential reference, connection version, status.
- Persisted job: owner/deck ID, immutable input snapshot, requested slide IDs, item states, cancellation flag, timestamps, lease/attempt metadata, resulting asset IDs.

Authorize asset reads. Preferred transport is an authenticated request for a short-lived, asset-specific playback URL followed by normal media loading; do not store that expiring URL in deck JSON. If the host blocks direct media loading, test authenticated fetch to a Blob URL with appropriate CSP and memory cleanup. Specify media/connect domains through mcp-use view configuration and verify actual host enforcement. Do not expose ElevenLabs keys through either path. Audio cannot be fetched merely by guessing an asset ID.

Make asset cleanup explicit: delete superseded unreferenced clips after a retention interval; never remove audio referenced by a saved deck or active presentation manifest. Provide Delete narration for a slide/deck. Account deletion removes credentials and owned narration assets according to the app's retention policy.

## Generation pipeline

Use the documented voice-list and TTS HTTP APIs. Start with per-slide MP3 generation (`mp3_44100_128`) through the server provider adapter. There is no need for a realtime conversation agent or streaming speech socket: the requested experience prepares audio first.

1. Authenticate, authorize the deck, validate saved scripts and supported voice/model settings, and freeze an input snapshot. Apply explicit per-slide/deck text limits within the chosen model's documented capabilities.
2. Compute a canonical input hash over script, voice, model, effective generation settings, output format, and script-normalization version. Scope reuse to the same owner and connection/account context.
3. Reuse ready audio for matching inputs. Visual-only changes do not invalidate speech. Script or voice/model-setting edits do. Reordering slides reuses clips. Because scripts are independent, visible text edits can show “Review narration” without silently rewriting scripts or charging for regeneration.
4. Persist the job and enqueue missing/stale items. Return a job ID immediately. Use a persisted worker queue with leases so generation can continue after the widget closes; do not rely on an unawaited promise in a request handler. Start with one in-flight request per account and tune against provider limits.
5. Persist each completed audio asset and validate nonempty, decodable audio before marking it ready. Obtain duration from the audio, not an estimate from text length.
6. Attach a result only if that slide still exists and its current input hash matches. Merge only the matching narration result into the latest deck using a transactional revision update; never overwrite a newer whole-deck snapshot. Preserve cancelled/deleted/stale outcomes correctly.
7. Prevent duplicate clicks with a persisted job fingerprint and unique in-flight work constraint. Use bounded backoff for provider throttling and transient failures. Do not claim exactly-once provider billing: an ambiguous network timeout after provider acceptance may already have incurred a charge. Surface uncertain attempts for explicit retry rather than blindly repeating paid requests.
8. Cancel stops pending work; an already accepted provider call may still complete and consume credits. Preserve completed assets and explain this in the cancellation UI. Handle revoked credentials, unavailable voices, quota exhaustion, decode failures, and storage errors per slide.

All audio is generated from the explicitly reviewed narration scripts. Do not read arbitrary HTML scripts, page content, or hidden notes into provider requests.

## Auto-present playback controller

Keep one audio controller in the presenter, outside the authored-slide iframe and speaker-preview iframe. Switching to speaker view must not create a second audio source. Use a frozen deck/manifest snapshot for a presentation run so live edits cannot change the spoken content midway; notify that a newer revision is available for the next run.

State machine: `manual → loading → playing ↔ paused → loading(next slide) → ended`, with `blocked` and `error` states. Scope events to a presentation-run ID, slide ID, and asset revision to reject stale `ended`, readiness, and fetch events.

- Start with a user click on Auto present. Prepare the first track before enabling Start where possible. Handle every `audio.play()` promise; show Resume audio if autoplay is denied, without advancing or claiming playback began. Never assume a successful fullscreen request authorizes audio.
- Reuse one HTMLAudioElement. Load the current track, select the slide through the existing navigation API, and wait for its preview-ready acknowledgement before starting narration. Add a narrow, validated readiness message to `CodePreview` / the presentation runtime; do not wait on arbitrary custom animations forever.
- Advance on the actual current track's `ended` event, never a duration timer. Then select the next slide and start its ready track. Preload the next track with a small bounded cache. At the last slide stop in Ended.
- Only explicitly silent slides use a dwell timer. Pause/resume preserves the remaining silent dwell time. Stopping or navigating clears it.
- Pause stops audio and advancement. Resume continues from the same point. Replay current resets the current track. Manual previous/next or a slide change originating inside the preview pauses Auto present, selects the destination, and requires Resume there. Distinguish controller-driven slide-change acknowledgements from manual navigation to avoid self-pausing.
- Escape, closing the presenter, unmounting, or replacing the presentation run stops audio, detaches listeners, cancels in-flight fetches, clears timers, and revokes Blob URLs. Browser visibility suspension pauses playback; resuming is explicit to avoid surprising audio from a hidden ChatGPT pane.
- Network failure, expired playback URL, or decoding failure pauses on the current slide with Retry/Return to manual; never skip silently. Refresh a playback URL without paying for regeneration.
- Separate ChatGPT cards/panes do not synchronize playback state or start audio because another pane started it. Each Auto present run is local to the user's clicked view.

Manual browser fullscreen and the existing speaker view remain available. Real ChatGPT/Safari acceptance testing is required; a simulated MCP host cannot prove actual autoplay or media-policy behavior.

## Proposed tools and code changes

Tool names below are proposals, not claims that these APIs exist already:

- `get-narration-connection` / `begin-narration-connection`: status and setup link only; no secrets in arguments/results.
- `list-narration-voices`: paginated voices available to the authenticated user's connection.
- `generate-narration`: authenticated owner, deck ID, expected revision, selected/all slide IDs, explicit generation intent; returns a job ID and safe summary.
- `get-narration-job`, `cancel-narration-job`, `retry-narration-slides`: scoped job lifecycle.
- `get-narration-playback`: authorized manifest/readiness and ephemeral playback authorization; URLs stay out of persistent/model-visible deck data where possible.
- Existing slide-edit tools accept narration scripts via the schema. Updating a script never automatically generates paid audio.

All tools keep mcp-use v2 raw result envelopes, typed schemas, and view bindings where needed. Extend the Slidecraft skill to distinguish script editing, paid generation, and playback.

File map relative to `mcp/` in the GitHub repository:

| Area | Planned work |
| --- | --- |
| `views/slide-studio/schema.ts` | Optional narration input/result/settings; older decks remain valid |
| `src/narration/provider.ts` | ElevenLabs adapter, model/voice validation, normalized errors |
| `src/narration/store.ts`, `jobs.ts`, `worker.ts` | Durable owner-scoped assets/jobs, deduplication and conditional attach |
| `src/auth/`, secure settings routes | Verified identity and encrypted per-user account connection |
| `index.ts` | Narration tools and protected connection/audio endpoints |
| `views/slide-studio/narration-panel.tsx`, `view.tsx` | Script editing, connection status, generation review/progress/preview |
| `views/slide-studio/use-narration-playback.ts`, `presenter.tsx` | Single playback state machine and Auto present controls |
| `code-preview.tsx`, `presentation-assets.js` | Validated preview-ready and navigation-origin messaging |
| `skills/slidecraft/SKILL.md` | Agent instructions for scripts, generation consent, and status |
| `tests/` | Provider mocks, ownership/conflict tests, browser audio state-machine tests |

## Delivery sequence and acceptance

1. **Auth/media feasibility spike:** verify per-user identity in the actual ChatGPT MCP connection, secure ElevenLabs key setup, and playback of a short fixture in the actual Safari/ChatGPT pane. Select persistent storage providers. No paid generation needed to prove the media controller. If host media policy blocks playback, establish a dedicated authenticated presenter page as the fallback before promising in-pane Auto present.
2. **Scripts and connection UI:** independent per-slide scripts and explicit copy actions; authenticated per-user connections; voice discovery; no auto-generation on edits. Tests prove one user's credentials/assets/jobs are inaccessible to another and secrets cannot appear in deck exports or model context.
3. **Durable generation:** job progress, deduplication, per-slide preview/retry/cancel, revision-aware attachment, and persistence through restart. Use provider mocks for normal tests; make a small explicitly authorized real ElevenLabs smoke test when credentials are configured.
4. **Auto present:** actual audio completion advances exactly once, pause/resume/replay/manual navigation work, no duplicate sound in speaker view, and final slide stops. Test short real fixture clips as well as controlled media events, autoplay rejection, stale events, hidden panes, loading delays, and silent slides.
5. **Integration release:** test a multi-slide deck with the user's connected account, individual regeneration, concurrent script edits, quota failures, reordering, deletion, reconnecting after expiry, and existing presentation/editor regressions. Deploy only after the implementation is requested and configured; this branch is planning only.

Completion scenario: a user connects their own account, writes three independent scripts, generates all three once, previews them, clicks Auto present, hears one track per slide, and sees exactly one advance at each audio ending. Returning later or redeploying does not require paying to regenerate unchanged audio.

## Deferred features and decisions

- Automatic AI script writing can be done by the connected agent; no new model service is required in v1.
- Multiple voices within a slide, voice cloning, word highlighting, video export, background music, and detailed animation/word synchronization are later work.
- Existing HTML export stays silent by default. Offline narrated export needs a deliberate bundle (HTML + audio) or explicit larger self-contained download; do not put expired playback links or provider credentials into exported HTML. Add a separate export milestone after the core flow works.
- JSON export may preserve script/settings and opaque manifest metadata; imports must revalidate asset access and cannot grant ownership by copying IDs.
- Choose OIDC, PostgreSQL, object storage, and secret-key management services before implementation. Verify any future official delegated ElevenLabs OAuth offering separately; the documented key-based connection is the current plan.

## References checked on 2026-10-14

- [ElevenLabs third-party account connections](https://elevenlabs.io/docs/help-center/account/general/how-can-i-use-eleven-labs-with-third-party-services): documented per-user API-key connection path.
- [API authentication](https://elevenlabs.io/docs/api-reference/authentication): server-side keys, request header, and restrictions.
- [List voices](https://elevenlabs.io/docs/api-reference/voices/search): current paginated voice discovery endpoint.
- [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): per-voice text-to-audio generation and output settings.
- [Models](https://elevenlabs.io/docs/overview/models): model capabilities and limits; confirm against the connected account when implementing.
- [HTMLMediaElement.play](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play): asynchronous playback success/failure and autoplay-policy rejection.

## Implementation status (v1.8 branch)

Implemented editable scripts/silent slides, voice/model/settings UI, secure per-user
Auth0 + restricted ElevenLabs API-key connection, PostgreSQL/private-S3 adapters,
persisted job leases/deduplication/cancellation/retries, private audio grants,
durable deck recovery, deletion/retention, and narrated presentation controls.
The presenter freezes its snapshot, waits for preview readiness, advances on real
audio completion, handles blocked playback and pauses on manual navigation/visibility.
See `elevenlabs-setup.md` for configuration, operation and verification boundaries.

This PR has not configured or deployed production identity/storage services and
has not spent real ElevenLabs credits. Local verification uses signed identity and
provider fixtures, actual PostgreSQL locking, and real Chromium audio with the built
widget. Actual ChatGPT/Safari policy acceptance remains a staging release check.
