import { useEffect, useMemo, useRef } from "react";
import { render } from "./renderer.js";
import type { Deck, Slide } from "./schema.js";

// Opaque-origin sandbox: authored code cannot read the studio or its host bridge.
export function CodePreview({
  deck,
  slide,
  replay,
  onSelect,
  audience = false,
  onExit,
  onReady,
}: {
  deck: Deck;
  slide: Slide;
  replay: number;
  onSelect: (id: string) => void;
  audience?: boolean;
  onExit?: () => void;
  onReady?: (id: string) => void;
}) {
  const navigationRequest = useRef("");
  const frame = useRef<HTMLIFrameElement>(null);
  const source = useMemo(() => {
    if (!audience) return render(deck);
    return render({
      ...deck,
      narration: undefined,
      slides: deck.slides.map(({ notes, narration, ...s }) => s),
    }).replace(
      "</head>",
      '<style>.controls,#notes,#progress{display:none!important}</style><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")parent.postMessage({type:"slidecraft:exit"},"*")})</script></head>',
    );
  }, [deck, audience]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !["slidecraft:slide", "slidecraft:exit", "slidecraft:ready"].includes(
          event.data?.type,
        )
      )
        return;
      if (event.data.type === "slidecraft:ready") {
        if (
          event.data.requestId === navigationRequest.current &&
          event.data.id === slide.id
        )
          onReady?.(slide.id);
        return;
      }
      if (event.data.type === "slidecraft:exit") {
        onExit?.();
        return;
      }
      if (deck.slides.some((s) => s.id === event.data.id))
        onSelect(event.data.id);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [deck, slide.id, onSelect, onExit, onReady]);
  function navigate() {
    navigationRequest.current = crypto.randomUUID();
    frame.current?.contentWindow?.postMessage(
      {
        type: "slidecraft:go",
        id: slide.id,
        requestId: navigationRequest.current,
      },
      "*",
    );
  }
  useEffect(navigate, [slide.id, replay]);
  return (
    <iframe
      ref={frame}
      title="Custom presentation preview"
      sandbox="allow-scripts"
      allow="fullscreen"
      srcDoc={source}
      onLoad={navigate}
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        border: 0,
        borderRadius: 12,
        display: "block",
      }}
    />
  );
}
