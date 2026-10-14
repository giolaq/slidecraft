import { useCallback, useEffect, useRef, useState } from "react";
import { useCallTool } from "mcp-use/react";
import {
  NarrationPlayer,
  type PlaybackClip,
  type PlaybackState,
} from "./narration-player.js";
import type { Deck } from "./schema.js";
import type { NarrationStatus } from "./narration-panel.js";
export function useNarrationPlayback(
  deck: Deck,
  initialIndex: number,
  select: (id: string) => void,
) {
  const statusTool = useCallTool("get-narration-status"),
    playback = useCallTool("get-narration-playback");
  const [clips, setClips] = useState<PlaybackClip[]>([]),
    [state, setState] = useState<PlaybackState>("manual"),
    [message, setMessage] = useState("");
  const player = useRef<NarrationPlayer | null>(null),
    readyId = useRef(""),
    waiting = useRef<Set<(id: string) => void>>(new Set());
  const selected = useRef(select);
  selected.current = select;
  const tools = useRef({ statusTool, playback });
  tools.current = { statusTool, playback };
  useEffect(() => {
    let alive = true;
    void tools.current.statusTool
      .callTool({ deck, snapshot: true })
      .then((r) => {
        if (alive)
          setClips((r.structuredContent.data as NarrationStatus).slides);
      })
      .catch(() => {
        if (alive)
          setMessage("Narration unavailable. Manual presentation is ready.");
      });
    return () => {
      alive = false;
    };
  }, [deck]);
  const ready = useCallback((id: string) => {
    readyId.current = id;
    for (const fn of waiting.current) fn(id);
  }, []);
  useEffect(() => {
    if (clips.length !== deck.slides.length) return;
    const lifetime = new AbortController();
    const cache = new Map<string, Promise<Blob>>();
    const fetchClip = (assetId: string): Promise<Blob> => {
      let pending = cache.get(assetId);
      if (!pending) {
        pending = (async () => {
          const r = await tools.current.playback.callTool({ assetId });
          if (lifetime.signal.aborted)
            throw new DOMException("Cancelled", "AbortError");
          const url = r._meta?.url;
          if (typeof url !== "string")
            throw new Error("No playback URL returned.");
          const response = await fetch(url, {
            signal: AbortSignal.any([
              lifetime.signal,
              AbortSignal.timeout(20000),
            ]),
          });
          if (!response.ok)
            throw new Error(
              "Audio link expired or unavailable. Retry audio to refresh it.",
            );
          return response.blob();
        })().catch((e) => {
          cache.delete(assetId);
          throw e;
        });
        cache.set(assetId, pending);
      }
      return pending;
    };
    const p = new NarrationPlayer(clips, initialIndex, {
      audio: () => new Audio(),
      async load(assetId, signal) {
        const blob = await fetchClip(assetId);
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        // At most the current and next speech recordings are retained in memory.
        const next = clips.slice(p.index + 1).find((c) => c.assetId)?.assetId;
        for (const key of cache.keys())
          if (key !== assetId && key !== next) cache.delete(key);
        if (next) void fetchClip(next).catch(() => {});
        return URL.createObjectURL(blob);
      },
      release: URL.revokeObjectURL,
      select(id) {
        if (readyId.current !== id) readyId.current = "";
        selected.current(id);
      },
      ready(id, signal) {
        if (readyId.current === id) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            waiting.current.delete(onReady);
            signal.removeEventListener("abort", onAbort);
          };
          const onReady = (current: string) => {
            if (current === id) {
              cleanup();
              resolve();
            }
          };
          const onAbort = () => {
            cleanup();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(
              new Error("Slide preview did not become ready. Retry audio."),
            );
          }, 5000);
          waiting.current.add(onReady);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
      },
      changed(s, m) {
        setState(s);
        setMessage(m);
      },
    });
    player.current = p;
    const hidden = () => {
      if (document.hidden && ["playing", "loading"].includes(p.state))
        p.pause("Presentation hidden. Resume audio when ready.");
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      p.stop();
      lifetime.abort();
      cache.clear();
      player.current = null;
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [clips, deck, initialIndex]);
  return {
    state,
    message,
    ready,
    available:
      clips.length === deck.slides.length &&
      clips.every((c) => c.status === "ready" || c.status === "silent"),
    start: (index?: number) => void player.current?.start(index, true),
    resume: () => void player.current?.start(),
    pause: () => player.current?.pause(),
    replay: () => void player.current?.start(undefined, true),
    manual: (index: number) => {
      if (player.current) player.current.manual(index);
      else selected.current(deck.slides[index].id);
    },
    volume: (v: number) => player.current?.setVolume(v),
  };
}
