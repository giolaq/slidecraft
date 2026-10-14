import packageInfo from "../../package.json" with { type: "json" };
import { NarrationPanel } from "./narration-panel.js";
import { VisualEditor } from "./visual-editor.js";
import { Presenter } from "./presenter.js";
import { editsSchema } from "./edits.js";
import { CodePreview } from "./code-preview.js";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ModelContext,
  useCallTool,
  useDisplayMode,
  useFiles,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
  useViewState,
  useViewTool,
  type ViewConfig,
} from "mcp-use/react";
import DOMPurify from "dompurify";
import { checkDeck, themeSchema, type Deck, type Slide } from "./schema.js";
import { z } from "zod";
import "./view.css";

export const viewConfig = {
  autoResize: true,
  displayModes: ["inline", "fullscreen"],
  preferredDisplayMode: "inline",
} satisfies ViewConfig;

function StandardSlideCanvas({
  deck,
  slide,
  replay,
}: {
  deck: Deck;
  slide: Slide;
  replay: number;
}) {
  const outer = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(0.5);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScale(el.clientWidth / 1600));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = stage.current;
    if (
      !el ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      slide.motion === "none"
    )
      return;
    const from = (
      {
        rise: "translateY(32px)",
        fade: "none",
        slide: "translateX(45px)",
        zoom: "scale(.94)",
      } as Record<string, string>
    )[slide.motion ?? "rise"];
    const animations = [...el.querySelectorAll("[data-reveal]")].map(
      (node, i) =>
        node.animate(
          [
            { opacity: 0, transform: from },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 650,
            delay: Math.min(i * 85, 680),
            easing: "cubic-bezier(.2,.8,.2,1)",
            fill: "both",
          },
        ),
    );
    return () => animations.forEach((a) => a.cancel());
  }, [slide, replay]);
  const palette = { ...deck.theme, ...slide.colors };
  const index = deck.slides.findIndex((s) => s.id === slide.id);
  return (
    <div className="sc-stage-wrap" ref={outer}>
      <section
        ref={stage}
        className={`sc-slide layout-${slide.layout}`}
        data-theme={deck.theme.mode}
        style={
          {
            transform: `scale(${scale})`,
            "--accent": palette.accent,
            "--bg": palette.background,
            "--fg": palette.foreground,
            "--muted": palette.muted,
            "--panel": palette.panel,
          } as CSSProperties
        }
        aria-label={`Slide ${index + 1}: ${slide.title}`}
      >
        <header>
          <span>{deck.title}</span>
          <span>{slide.eyebrow ?? "SLIDECRAFT"}</span>
        </header>
        <div className="sc-slide-content">
          <div className="sc-intro">
            <p className="sc-eyebrow" data-reveal>
              {slide.eyebrow}
            </p>
            <h1 data-reveal>{slide.title}</h1>
            {slide.body && (
              <p className="sc-body" data-reveal>
                {slide.body}
              </p>
            )}
          </div>
          <div className="sc-details">
            {slide.image && (
              <figure className="sc-photo">
                {failedImage === slide.image.src ? (
                  <p role="alert">
                    Photo unavailable: {slide.image.alt}. Re-import it using
                    add-photo.
                  </p>
                ) : (
                  <img
                    src={slide.image.src}
                    alt={slide.image.alt}
                    style={{ objectFit: slide.image.fit }}
                    onError={() => setFailedImage(slide.image!.src)}
                  />
                )}
                {slide.image.caption && (
                  <figcaption>{slide.image.caption}</figcaption>
                )}
              </figure>
            )}
            {slide.bullets && (
              <ul className="sc-bullets">
                {slide.bullets.map((s, i) => (
                  <li key={i} data-reveal>
                    {s}
                  </li>
                ))}
              </ul>
            )}
            {slide.cards && (
              <div className="sc-cards">
                {slide.cards.map((c, i) => (
                  <article key={i} data-reveal>
                    <span className="sc-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3>{c.title}</h3>
                    <p>{c.body}</p>
                  </article>
                ))}
              </div>
            )}
            {slide.metrics && (
              <div className="sc-metrics">
                {slide.metrics.map((m, i) => (
                  <article key={i} data-reveal>
                    <strong>{m.value}</strong>
                    <p>{m.label}</p>
                  </article>
                ))}
              </div>
            )}
            {slide.steps && (
              <ol className="sc-timeline">
                {slide.steps.map((s, i) => (
                  <li key={i} data-reveal>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </li>
                ))}
              </ol>
            )}
            {slide.html && (
              <div
                className="sc-custom"
                data-reveal
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(slide.html, {
                    USE_PROFILES: { html: true, svg: true },
                    FORBID_TAGS: [
                      "style",
                      "iframe",
                      "form",
                      "input",
                      "button",
                      "foreignObject",
                    ],
                    FORBID_ATTR: ["style", "href", "xlink:href", "src"],
                  }),
                }}
              />
            )}
          </div>
        </div>
        <footer>
          <span>{slide.footer ?? deck.author ?? "Made with Slidecraft"}</span>
          <span>
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(deck.slides.length).padStart(2, "0")}
          </span>
        </footer>
      </section>
    </div>
  );
}

function SlideCanvas(props: {
  deck: Deck;
  slide: Slide;
  replay: number;
  onSelect: (id: string) => void;
}) {
  if (
    props.deck.css ||
    props.deck.script ||
    props.deck.slides.some((s) => s.layout === "custom" || s.html || s.elements)
  )
    return <CodePreview {...props} />;
  return <StandardSlideCanvas {...props} />;
}

export function Studio({
  initial,
  initialSelectedSlideId,
}: {
  initial: Deck;
  initialSelectedSlideId?: string;
}) {
  const [state, setState] = useViewState({
    deck: initial,
    selectedSlideId: initialSelectedSlideId ?? initial.slides[0].id,
  });
  const [visualEditing, setVisualEditing] = useState<{
    deck: Deck;
    slide: Slide;
  } | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Connecting…");
  const signature = JSON.stringify(initial),
    previous = useRef(signature),
    mounted = useRef(false);
  const [replay, setReplay] = useState(0),
    [editing, setEditing] = useState(false),
    [showNotes, setShowNotes] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", notes: "" }),
    [prompt, setPrompt] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<{
      name: string;
      text: string;
      mime: string;
    } | null>(null),
    [includeNotes, setIncludeNotes] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const update = useCallTool("update-slide"),
    edit = useCallTool("edit-deck"),
    exporter = useCallTool("export-deck"),
    themeUpdate = useCallTool("set-theme"),
    revise = useCallTool("revise-presentation"),
    live = useCallTool("get-live-deck"),
    opener = useCallTool("open-slides");
  const files = useFiles(),
    openExternal = useOpenExternal(),
    followUp = useSendFollowUp();
  const { hostCapabilities } = useHostContext();
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  useEffect(() => {
    if (
      previous.current !== signature ||
      (!mounted.current &&
        (state.deck.id !== initial.id ||
          (initial.syncToken && state.deck.syncToken !== initial.syncToken) ||
          state.deck.revision < initial.revision ||
          (state.deck.revision === initial.revision &&
            JSON.stringify(state.deck) !== signature)))
    ) {
      previous.current = signature;
      setState((s) => ({
        deck: initial,
        selectedSlideId:
          initialSelectedSlideId ??
          (initial.id === s.deck.id &&
          initial.slides.some((slide) => slide.id === s.selectedSlideId)
            ? s.selectedSlideId
            : initial.slides[0].id),
      }));
      setEditing(false);
      setDownload(null);
    }
    mounted.current = true;
  }, [signature, initial, initialSelectedSlideId, setState]);
  const deck = state.deck;
  const liveCall = useRef(live.callTool);
  liveCall.current = live.callTool;
  useEffect(() => {
    if (!deck.syncToken) {
      setSyncStatus("Not connected — reopen this deck in Slidecraft.");
      return;
    }
    let cancelled = false,
      inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const token = deck.syncToken;
    const controller = new AbortController();
    async function refresh() {
      if (cancelled || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      try {
        let latest: Deck | null;
        try {
          const response = await fetch(
            new URL(/* @vite-ignore */ "/api/live-deck", import.meta.url),
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(5000),
              ]),
            },
          );
          if (!response.ok) throw new Error("Direct refresh unavailable");
          const data = await response.json();
          latest = data.deck === null ? null : checkDeck(data.deck);
        } catch {
          if (cancelled) return;
          let deadline: ReturnType<typeof setTimeout>;
          try {
            const response = await Promise.race([
              liveCall.current({ syncToken: token }),
              new Promise<never>((_, reject) => {
                deadline = setTimeout(
                  () => reject(new Error("Refresh timed out")),
                  5000,
                );
              }),
            ]);
            latest = response.structuredContent.deck;
          } finally {
            clearTimeout(deadline!);
          }
        }
        if (cancelled) return;
        if (!latest) {
          setSyncStatus(
            "Session expired — reopen the latest deck to reconnect.",
          );
          return;
        }
        if (latest.syncToken !== token) throw new Error("Session mismatch");
        setState((current) =>
          current.deck.syncToken !== token ||
          current.deck.revision >= latest!.revision
            ? current
            : {
                deck: latest!,
                selectedSlideId: latest!.slides.some(
                  (s) => s.id === current.selectedSlideId,
                )
                  ? current.selectedSlideId
                  : latest!.slides[0].id,
              },
        );
        setSyncStatus(`Live · server revision ${latest.revision}`);
      } catch {
        if (!cancelled)
          setSyncStatus("Reconnecting… updates have not been confirmed.");
      } finally {
        inFlight = false;
        if (!cancelled) timer = setTimeout(refresh, 2000);
      }
    }
    void refresh();
    const wake = () => {
      void refresh();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [deck.syncToken, setState, displayMode]);
  useEffect(() => {
    setEditing(false);
    setDownload(null);
  }, [deck.revision]);
  const slide =
    deck.slides.find((s) => s.id === state.selectedSlideId) ?? deck.slides[0];
  const position = deck.slides.indexOf(slide);
  function select(id: string) {
    if (visualEditing) {
      setNotice("Save or cancel visual edits before changing slides.");
      return;
    }
    setState((s) => ({ ...s, selectedSlideId: id }));
    setEditing(false);
    setNotice("");
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function adopt(next: Deck, selectedSlideId?: string) {
    setState((s) => ({
      deck: next,
      selectedSlideId:
        selectedSlideId ??
        (next.slides.some((x) => x.id === s.selectedSlideId)
          ? s.selectedSlideId
          : next.slides[0].id),
    }));
    setDownload(null);
  }
  useViewTool(
    {
      name: "change-visible-slide-colors",
      description:
        "Change the selected slide colors in the currently displayed widget by default. Supply slideId to target another slide, or scope=deck for the whole presentation. Uses the latest visible deck automatically. Prefer this for color changes when the studio is open. background is slide background, foreground is text, accent is highlights; use six-digit hex colors.",
      inputSchema: z.object({
        colors: themeSchema.partial(),
        scope: z.enum(["slide", "deck"]).default("slide"),
        slideId: z.string().optional(),
      }),
    },
    async ({ colors, scope, slideId }) => {
      try {
        const response = await themeUpdate.callTool({
          deck,
          expectedRevision: deck.revision,
          colors,
          ...(scope === "deck" ? {} : { slideId: slideId ?? slide.id }),
        });
        adopt(
          response.structuredContent.deck,
          response.structuredContent.selectedSlideId,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: response.structuredContent.message,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );
  useViewTool(
    {
      name: "edit-visible-presentation",
      description:
        "Edit any part of the currently visible presentation using atomic JSON Patch operations. Uses the latest deck state automatically. Use paths /slides/INDEX/FIELD, /theme, /css, /script, etc. Supports add/replace/remove/move/copy/test. Select the changed slide with selectedSlideId. Slides have stable unique ids. Duplicate via copy followed by id replacement. CSS/JS preview in an isolated frame.",
      inputSchema: z.object({
        edits: editsSchema,
        selectedSlideId: z.string().optional(),
      }),
    },
    async ({ edits, selectedSlideId }) => {
      try {
        const r = await revise.callTool({
          deck,
          expectedRevision: deck.revision,
          edits,
          selectedSlideId,
        });
        adopt(r.structuredContent.deck, r.structuredContent.selectedSlideId);
        return {
          content: [
            { type: "text" as const, text: r.structuredContent.message },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: e instanceof Error ? e.message : String(e),
            },
          ],
        };
      }
    },
  );
  async function save() {
    await run(async () => {
      const r = await update.callTool({
        deck,
        slideId: slide.id,
        expectedRevision: deck.revision,
        changes: draft,
      });
      adopt(r.structuredContent.deck);
      setEditing(false);
      setNotice("Slide updated.");
    });
  }
  async function exportFile(format: "html" | "json") {
    await run(async () => {
      const r = await exporter.callTool({ deck, format, includeNotes });
      const text = r._meta?.fileText;
      if (typeof text !== "string")
        throw new Error("Export returned no file contents.");
      setDownload({
        name: r.structuredContent.filename,
        text,
        mime: r.structuredContent.mimeType,
      });
      setNotice("Export ready. Choose Download file below.");
    });
  }
  useEffect(() => {
    if (!presenting) return;
    let entered = Boolean(document.fullscreenElement);
    const changed = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [presenting]);
  async function startPresenting() {
    setPresenting(true);
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      if (availableDisplayModes.includes("fullscreen")) {
        try {
          await requestDisplayMode({ mode: "fullscreen" });
        } catch {
          setNotice(
            "Present mode is open. Browser fullscreen is unavailable in this host; export HTML to present in a separate browser tab.",
          );
        }
      }
    }
  }
  function stopPresenting() {
    setPresenting(false);
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
  }
  async function downloadFile() {
    if (!download) return;
    await run(async () => {
      if (files.isSupported && hostCapabilities?.openLinks) {
        const ref = await files.upload(
          new File([download.text], download.name, { type: download.mime }),
        );
        const { downloadUrl } = await files.getDownloadUrl(ref);
        await openExternal({ url: downloadUrl });
      } else {
        const url = URL.createObjectURL(
          new Blob([download.text], { type: download.mime }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = download.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      setNotice(
        "Download requested. If your host blocks downloads, use Show file contents and save them locally.",
      );
    });
  }
  return (
    <main
      className="sc-studio"
      data-mode={displayMode}
      onKeyDown={(e) => {
        if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName))
          return;
        if (e.key === "ArrowRight" && position < deck.slides.length - 1) {
          e.preventDefault();
          select(deck.slides[position + 1].id);
        }
        if (e.key === "ArrowLeft" && position > 0) {
          e.preventDefault();
          select(deck.slides[position - 1].id);
        }
      }}
    >
      {presenting && (
        <Presenter
          deck={deck}
          slide={slide}
          onSelect={select}
          onClose={stopPresenting}
        />
      )}
      <ModelContext
        content={`Slidecraft active deck ${deck.id}, revision ${deck.revision}. Selected slide ${slide.id} (${position + 1}/${deck.slides.length}): ${slide.title}. The complete latest deck is in view state. Questions do not authorize edits. Connected studios reload shared live revisions automatically. Preserve syncToken in edits. JSON export preserves a durable copy.`}
      />
      <header className="sc-toolbar">
        <div className="sc-brand">
          <span>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 19 19 5M5 5h14v14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </span>
          slidecraft
        </div>
        <span className="sc-badge">STUDIO</span>
        <div className="sc-spacer" />
        <button
          disabled={Boolean(visualEditing)}
          onClick={() => void startPresenting()}
        >
          Present
        </button>
        <button
          disabled={busy || Boolean(visualEditing)}
          onClick={() => importInput.current?.click()}
        >
          Import JSON
        </button>
        <button
          disabled={busy || Boolean(visualEditing)}
          onClick={() => void exportFile("json")}
        >
          Save JSON
        </button>
        <button
          className="sc-primary"
          disabled={busy || Boolean(visualEditing)}
          onClick={() => void exportFile("html")}
        >
          Export HTML
        </button>
        {availableDisplayModes.includes("fullscreen") && (
          <button
            onClick={() =>
              void run(async () => {
                await requestDisplayMode({
                  mode: displayMode === "fullscreen" ? "inline" : "fullscreen",
                });
              })
            }
          >
            {displayMode === "fullscreen" ? "Collapse" : "Expand"}
          </button>
        )}
      </header>
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void run(async () => {
              if (file.size > 1500000)
                throw new Error("JSON file must be smaller than 1.5 MB.");
              const parsed = JSON.parse(await file.text());
              const d = checkDeck({
                ...parsed,
                id: parsed.id ?? crypto.randomUUID(),
                revision: parsed.revision ?? 0,
                theme: parsed.theme ?? { mode: "dark", accent: "#cbff73" },
              });
              delete d.syncToken;
              const opened = await opener.callTool({ deck: d });
              adopt(opened.structuredContent.deck);
              setEditing(false);
              setNotice("Deck imported into this conversation.");
            });
        }}
      />
      <div className="sc-workspace">
        <aside className="sc-outline">
          <p className="sc-label">
            YOUR STORY / {String(deck.slides.length).padStart(2, "0")}
          </p>
          {deck.slides.map((s, i) => (
            <button
              key={s.id}
              className={s.id === slide.id ? "selected" : ""}
              aria-current={s.id === slide.id}
              onClick={() => select(s.id)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </button>
          ))}
          <button
            disabled={busy || Boolean(visualEditing)}
            onClick={() =>
              void run(async () => {
                const r = await edit.callTool({
                  deck,
                  expectedRevision: deck.revision,
                  operation: {
                    type: "add",
                    position: position + 1,
                    slide: {
                      id: "slide-" + crypto.randomUUID().slice(0, 8),
                      layout: "statement",
                      title: "One clear idea.",
                      body: "What should the audience remember?",
                      motion: "rise",
                    },
                  },
                });
                adopt(r.structuredContent.deck);
                select(r.structuredContent.deck.slides[position + 1].id);
              })
            }
          >
            + Add slide
          </button>
        </aside>
        <section className="sc-canvas">
          <div className="sc-heading">
            <div>
              <h2>{deck.title}</h2>
              <p>Make the next version better.</p>
            </div>
            <button onClick={() => setReplay((x) => x + 1)}>
              Replay motion
            </button>
          </div>
          {visualEditing ? (
            <VisualEditor
              key={`${visualEditing.deck.id}:${visualEditing.slide.id}`}
              deck={visualEditing.deck}
              slide={visualEditing.slide}
              onClose={() => setVisualEditing(null)}
              onSave={async (elements, colors) => {
                const r = await update.callTool({
                  deck: visualEditing.deck,
                  slideId: visualEditing.slide.id,
                  expectedRevision: visualEditing.deck.revision,
                  changes: { elements, colors },
                });
                adopt(r.structuredContent.deck);
                setVisualEditing(null);
                setNotice("Visual edits saved and synced.");
              }}
            />
          ) : (
            <SlideCanvas
              deck={deck}
              slide={slide}
              replay={replay}
              onSelect={select}
            />
          )}
          {!visualEditing && (
            <button
              disabled={busy || Boolean(slide.html || deck.css || deck.script)}
              title={
                slide.html || deck.css || deck.script
                  ? "Custom HTML/CSS/JavaScript slides use agent editing."
                  : "Move, resize, and style slide elements"
              }
              onClick={() =>
                setVisualEditing({
                  deck: structuredClone(deck),
                  slide: structuredClone(slide),
                })
              }
            >
              Visual edit
            </button>
          )}
          {!visualEditing && (
            <nav className="sc-navigation" aria-label="Slides">
              <button
                disabled={position === 0}
                onClick={() => select(deck.slides[position - 1].id)}
              >
                ← Previous
              </button>
              <span aria-live="polite">
                {position + 1} / {deck.slides.length}
              </span>
              <button
                disabled={position === deck.slides.length - 1}
                onClick={() => select(deck.slides[position + 1].id)}
              >
                Next →
              </button>
              <div className="sc-spacer" />
              <button onClick={() => setShowNotes((x) => !x)}>
                {showNotes ? "Hide notes" : "Speaker notes"}
              </button>
              <button
                onClick={() => {
                  setDraft({
                    title: slide.title,
                    body: slide.body ?? "",
                    notes: slide.notes ?? "",
                  });
                  setEditing((x) => !x);
                }}
              >
                Edit slide
              </button>
            </nav>
          )}
          {!visualEditing && !presenting && (
            <NarrationPanel deck={deck} slide={slide} onDeck={adopt} />
          )}
          {showNotes && (
            <section className="sc-notes">
              <h3>Speaker notes</h3>
              <p>{slide.notes || "No notes for this slide yet."}</p>
            </section>
          )}
          {editing && !visualEditing && (
            <form
              className="sc-edit"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                {slide.elements ? "Slide title (metadata)" : "Title"}
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                  maxLength={500}
                  required
                />
              </label>
              <label>
                {slide.elements
                  ? "Supporting text (metadata)"
                  : "Supporting text"}
                <textarea
                  value={draft.body}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, body: e.target.value }))
                  }
                  maxLength={8000}
                />
              </label>
              <label>
                Speaker notes
                <textarea
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  maxLength={8000}
                />
              </label>
              <div>
                <button
                  type="submit"
                  className="sc-primary"
                  disabled={busy || Boolean(visualEditing)}
                >
                  Apply changes
                </button>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <form
            className="sc-prompt"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await followUp({
                  prompt: `In Slidecraft, use the latest deck from view state (deck ${deck.id}, revision ${deck.revision}), selected slide ${slide.id}. My request: ${prompt}`,
                });
                setPrompt("");
                setNotice("Request sent to your agent.");
              });
            }}
          >
            <label htmlFor="revision-prompt">
              Think out loud. Shape the next version.
            </label>
            <div>
              <input
                id="revision-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Make this slide clearer, or ask a question…"
                maxLength={3000}
              />
              <button
                type="submit"
                className="sc-primary"
                disabled={busy || !prompt.trim() || !hostCapabilities?.message}
              >
                Ask agent
              </button>
            </div>
            {!hostCapabilities?.message && (
              <small>
                Use your host's chat to ask questions or request revisions.
              </small>
            )}
          </form>
          <div className="sc-bottom">
            <span>Revision {deck.revision} · Saved in view state</span>
            <span role="status" aria-label="Live connection status">
              {syncStatus} · v{packageInfo.version}
            </span>
            <label>
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
              />{" "}
              Include notes in HTML
            </label>
          </div>
          {(deck.css || deck.script) && (
            <p className="sc-subtle">
              Custom HTML, CSS, and JavaScript use an isolated preview with the
              same renderer as the HTML export.
            </p>
          )}
          <p className="sc-notice" role="status">
            {busy ? "Working…" : notice}
          </p>
          {download && (
            <section className="sc-download">
              <strong>{download.name}</strong>
              <button
                disabled={busy || Boolean(visualEditing)}
                onClick={() => void downloadFile()}
              >
                Download file
              </button>
              <details>
                <summary>Show file contents</summary>
                <textarea
                  readOnly
                  aria-label="Exported file contents"
                  value={download.text}
                />
              </details>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
export default function SlideStudio() {
  const view = useToolContext<"open-slides">();
  if (view.status === "pending")
    return (
      <div className="sc-loading" role="status">
        Opening your presentation…
      </div>
    );
  if (view.status === "error")
    return (
      <div className="sc-loading" role="alert">
        Could not open deck: {view.error.message}
      </div>
    );
  return (
    <Studio
      initial={view.toolOutput.deck}
      initialSelectedSlideId={view.toolOutput.selectedSlideId}
    />
  );
}
