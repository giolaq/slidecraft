import { useEffect, useRef, useState } from "react";
import { useCallTool, useOpenExternal } from "mcp-use/react";
import type { JSONType } from "zod";
import type { Deck, Slide } from "./schema.js";
export type NarrationSlideStatus = {
  slideId: string;
  status: string;
  assetId?: string;
  durationMs?: number;
  error?: string;
};
export type NarrationStatus = {
  jobId?: string;
  enabled: boolean;
  connected: boolean;
  slides: NarrationSlideStatus[];
};
type Catalog = {
  voices: { id: string; name: string }[];
  models: { id: string; name: string; limit: number }[];
};
export function visibleScript(slide: Slide) {
  if (slide.html) return "";
  if (slide.elements)
    return slide.elements
      .filter((e) => e.type === "text")
      .map((e) => e.text ?? "")
      .join("\n");
  return [
    slide.eyebrow,
    slide.title,
    slide.body,
    ...(slide.bullets ?? []),
    ...(slide.cards ?? []).flatMap((x) => [x.title, x.body]),
    ...(slide.steps ?? []).flatMap((x) => [x.title, x.body]),
    ...(slide.metrics ?? []).flatMap((x) => [x.value, x.label]),
    slide.footer,
  ]
    .filter(Boolean)
    .join("\n");
}
export function NarrationPanel({
  deck,
  slide,
  onDeck,
}: {
  deck: Deck;
  slide: Slide;
  onDeck: (deck: Deck) => void;
}) {
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState<NarrationStatus>(),
    [catalog, setCatalog] = useState<Catalog>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [job, setJob] = useState<string>(),
    [preview, setPreview] = useState<string>();
  const [draft, setDraft] = useState(
    slide.narration ?? {
      script: "",
      mode: "speech" as const,
      silentDurationMs: 5000,
    },
  );
  const [settings, setSettings] = useState(
    deck.narration ?? {
      voiceId: "",
      modelId: "eleven_multilingual_v2",
      settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
      },
    },
  );
  const requestId = useRef(crypto.randomUUID());
  const baseline = useRef({ revision: deck.revision, slideId: slide.id });
  const [dirty, setDirty] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const statusTool = useCallTool("get-narration-status"),
    connect = useCallTool("begin-narration-connection"),
    disconnect = useCallTool("disconnect-narration"),
    voices = useCallTool("list-narration-voices"),
    generate = useCallTool("generate-narration"),
    cancel = useCallTool("cancel-narration-job"),
    revise = useCallTool("revise-presentation"),
    playback = useCallTool("get-narration-playback");
  const openExternal = useOpenExternal();
  const latest = useRef(deck);
  latest.current = deck;
  useEffect(() => {
    if (!dirty) {
      setDraft(
        slide.narration ?? {
          script: "",
          mode: "speech",
          silentDurationMs: 5000,
        },
      );
      setSettings(
        deck.narration ?? {
          voiceId: "",
          modelId: "eleven_multilingual_v2",
          settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
        },
      );
      baseline.current = { revision: deck.revision, slideId: slide.id };
    }
  }, [deck, slide, dirty]);
  useEffect(() => {
    if (!open) return;
    let disposed = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const r = await statusTool.callTool({
          deck: latest.current,
          snapshot: false,
        });
        if (!disposed) {
          const next = r.structuredContent.data as NarrationStatus;
          setStatus(next);
          setJob(next.jobId);
        }
      } catch (e) {
        if (!disposed)
          setMessage(
            e instanceof Error ? e.message : "Could not load narration.",
          );
      } finally {
        polling = false;
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [open]);
  useEffect(() => {
    setPreview(undefined);
  }, [slide.id]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Narration action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      baseline.current.revision !== deck.revision ||
      baseline.current.slideId !== slide.id
    )
      throw new Error(
        "The deck changed while you were editing. Copy your draft, then discard it and reopen narration.",
      );
    const edits: { op: "add"; path: string; value: JSONType }[] = [
      {
        op: "add",
        path: `/slides/${deck.slides.findIndex((s) => s.id === slide.id)}/narration`,
        value: draft,
      },
    ];
    if (settings.voiceId)
      edits.push({ op: "add", path: "/narration", value: settings });
    const r = await revise.callTool({
      deck,
      expectedRevision: deck.revision,
      edits,
      selectedSlideId: slide.id,
    });
    onDeck(r.structuredContent.deck);
    setDirty(false);
    setReview(false);
    await statusTool.callTool({
      deck: r.structuredContent.deck,
      snapshot: false,
    });
    setMessage(
      "Narration saved. Existing audio becomes stale only when speech inputs change.",
    );
  }
  const current = status?.slides.find((s) => s.slideId === slide.id);
  const missing = deck.slides.filter(
    (s) =>
      (!regenerate || s.id === slide.id) &&
      s.narration?.mode !== "silent" &&
      !s.narration?.script.trim(),
  );
  const need = regenerate
    ? current
      ? [current]
      : []
    : (status?.slides.filter(
        (s) => s.status !== "ready" && s.status !== "silent",
      ) ?? []);
  return (
    <section className="sc-narration">
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        Narration
      </button>
      {open && (
        <div>
          <h3>ElevenLabs narration</h3>
          <p>
            {status?.enabled === false
              ? "Narration needs server setup. Script editing is available now."
              : status?.connected
                ? "Your ElevenLabs account is connected."
                : "Connect your own ElevenLabs account to generate audio."}
          </p>
          <button
            disabled={busy || status?.enabled === false}
            onClick={() =>
              void run(async () => {
                const r = await connect.callTool({});
                const url = r._meta?.url;
                if (typeof url !== "string")
                  throw new Error("No connection link returned.");
                await openExternal({ url });
              })
            }
          >
            {status?.connected ? "Replace connection" : "Connect ElevenLabs"}
          </button>
          {status?.connected && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await disconnect.callTool({});
                    setCatalog(undefined);
                    setStatus((s) => (s ? { ...s, connected: false } : s));
                  })
                }
              >
                Disconnect
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await voices.callTool({});
                    setCatalog(r.structuredContent.data as Catalog);
                  })
                }
              >
                Load voices
              </button>
            </>
          )}
          <label>
            Voice
            <select
              aria-label="Narration voice"
              value={settings.voiceId}
              onChange={(e) => {
                setSettings({ ...settings, voiceId: e.target.value });
                setDirty(true);
              }}
            >
              <option value="">Choose a voice</option>
              {!catalog && settings.voiceId && (
                <option value={settings.voiceId}>{settings.voiceId}</option>
              )}
              {catalog?.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select
              aria-label="Narration model"
              value={settings.modelId}
              onChange={(e) => {
                setSettings({ ...settings, modelId: e.target.value });
                setDirty(true);
              }}
            >
              {!catalog && (
                <option value={settings.modelId}>{settings.modelId}</option>
              )}
              {catalog?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>Voice settings</summary>
            {(["stability", "similarity_boost", "style"] as const).map(
              (key) => (
                <label key={key}>
                  {key.replaceAll("_", " ")}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.settings[key]}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        settings: {
                          ...settings.settings,
                          [key]: Number(e.target.value),
                        },
                      });
                      setDirty(true);
                    }}
                  />
                </label>
              ),
            )}
            <label>
              <input
                type="checkbox"
                checked={settings.settings.use_speaker_boost}
                onChange={(e) => {
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      use_speaker_boost: e.target.checked,
                    },
                  });
                  setDirty(true);
                }}
              />{" "}
              Speaker boost
            </label>
          </details>
          <label>
            Slide narration
            <select
              value={draft.mode}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  mode: e.target.value as "speech" | "silent",
                });
                setDirty(true);
              }}
            >
              <option value="speech">Speech</option>
              <option value="silent">Silent slide</option>
            </select>
          </label>
          {draft.mode === "silent" ? (
            <label>
              Dwell time (seconds)
              <input
                type="number"
                min="1"
                max="300"
                value={draft.silentDurationMs / 1000}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    silentDurationMs: Number(e.target.value) * 1000,
                  });
                  setDirty(true);
                }}
              />
            </label>
          ) : (
            <>
              <label>
                Narration script
                <textarea
                  aria-label="Narration script"
                  rows={5}
                  maxLength={10000}
                  value={draft.script}
                  onChange={(e) => {
                    setDraft({ ...draft, script: e.target.value });
                    setDirty(true);
                  }}
                />
              </label>
              <p>
                {draft.script.length} characters ·{" "}
                {current?.status ?? "Not generated"}
              </p>
              <button
                onClick={() => {
                  setDraft({ ...draft, script: slide.notes ?? "" });
                  setDirty(true);
                }}
              >
                Copy speaker notes
              </button>
              <button
                disabled={!!slide.html}
                onClick={() => {
                  setDraft({
                    ...draft,
                    script: visibleScript(slide).slice(0, 10000),
                  });
                  setDirty(true);
                }}
              >
                Copy slide text
              </button>
            </>
          )}
          <button disabled={busy || !dirty} onClick={() => void run(save)}>
            Save narration
          </button>
          {dirty && (
            <button onClick={() => setDirty(false)}>
              Discard narration draft
            </button>
          )}
          <button
            disabled={busy || current?.status !== "ready" || dirty}
            onClick={() =>
              void run(async () => {
                const r = await playback.callTool({
                  assetId: current!.assetId!,
                });
                const url = r._meta?.url;
                if (typeof url !== "string")
                  throw new Error("Missing audio URL.");
                const response = await fetch(url);
                if (!response.ok)
                  throw new Error("Audio unavailable. Retry preview.");
                setPreview(URL.createObjectURL(await response.blob()));
              })
            }
          >
            Preview audio
          </button>
          {preview && <audio controls src={preview} />}
          <p>
            {status?.slides.filter(
              (s) => s.status === "ready" || s.status === "silent",
            ).length ?? 0}{" "}
            / {deck.slides.length} slides ready
          </p>
          <ul>
            {status?.slides.map((s) => (
              <li key={s.slideId}>
                {deck.slides.find((sl) => sl.id === s.slideId)?.title}:{" "}
                {s.status === "missing"
                  ? "Not generated / needs regeneration"
                  : s.status}
                {s.error ? ` — ${s.error}` : ""}
              </li>
            ))}
          </ul>
          <button
            disabled={busy || dirty || !status?.connected || !deck.narration}
            onClick={() => {
              setRegenerate(false);
              requestId.current = crypto.randomUUID();
              setReview(true);
            }}
          >
            Generate narration…
          </button>
          <button
            disabled={
              busy ||
              dirty ||
              !status?.connected ||
              !deck.narration ||
              !slide.narration?.script.trim() ||
              slide.narration?.mode === "silent"
            }
            onClick={() => {
              setRegenerate(true);
              requestId.current = crypto.randomUUID();
              setReview(true);
            }}
          >
            Regenerate this slide…
          </button>
          {job && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await cancel.callTool({ jobId: job });
                  setMessage(
                    "Pending slides cancelled. A submitted request may still be charged.",
                  );
                })
              }
            >
              Cancel remaining
            </button>
          )}
          {review && (
            <div role="region" aria-label="Review narration generation">
              <h4>Review before generating</h4>
              <p>
                Voice:{" "}
                {catalog?.voices.find((v) => v.id === deck.narration?.voiceId)
                  ?.name ?? deck.narration?.voiceId}
                . Model: {deck.narration?.modelId}.
              </p>
              <p>
                {need.length} slides need work. Up to{" "}
                {deck.slides
                  .filter((s) => need.some((n) => n.slideId === s.id))
                  .reduce(
                    (n, s) => n + (s.narration?.script.trim().length ?? 0),
                    0,
                  )}{" "}
                characters will be submitted to your ElevenLabs account.
                {regenerate
                  ? "This explicitly generates a new recording."
                  : "Matching recordings are reused."}{" "}
                Provider pricing and credits apply.
              </p>
              {missing.length > 0 && (
                <p>
                  Write scripts or mark these slides silent:{" "}
                  {missing.map((s) => s.title).join(", ")}.
                </p>
              )}
              <button
                disabled={busy || missing.length > 0 || !need.length}
                onClick={() =>
                  void run(async () => {
                    const r = await generate.callTool({
                      deck,
                      slideIds: need.map((s) => s.slideId),
                      confirmGeneration: true,
                      retryUncertain: false,
                      force: regenerate,
                      requestId: requestId.current,
                    });
                    setJob((r.structuredContent.data as { id: string }).id);
                    setReview(false);
                  })
                }
              >
                Confirm and generate
              </button>
              {need.some((s) => s.status === "uncertain") && (
                <button
                  disabled={busy || missing.length > 0}
                  onClick={() =>
                    void run(async () => {
                      const r = await generate.callTool({
                        deck,
                        slideIds: need.map((s) => s.slideId),
                        confirmGeneration: true,
                        retryUncertain: true,
                        force: regenerate,
                        requestId: crypto.randomUUID(),
                      });
                      setJob((r.structuredContent.data as { id: string }).id);
                      setReview(false);
                    })
                  }
                >
                  I checked usage — retry uncertain slides
                </button>
              )}
              <button onClick={() => setReview(false)}>Close review</button>
            </div>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </section>
  );
}
