import { useEffect, useMemo, useRef } from "react";
import { render } from "./renderer.js";
import type { Deck, Slide } from "./schema.js";

// Opaque-origin sandbox: authored code cannot read the studio or its host bridge.
export function CodePreview({
  deck,
  slide,
  replay,
  onSelect,
}: {
  deck: Deck;
  slide: Slide;
  replay: number;
  onSelect: (id: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const source = useMemo(() => render(deck), [deck]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "slidecraft:slide"
      )
        return;
      if (deck.slides.some((s) => s.id === event.data.id))
        onSelect(event.data.id);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [deck, onSelect]);
  function navigate() {
    frame.current?.contentWindow?.postMessage(
      { type: "slidecraft:go", id: slide.id },
      "*",
    );
  }
  useEffect(navigate, [slide.id, replay]);
  return (
    <iframe
      ref={frame}
      title="Custom presentation preview"
      sandbox="allow-scripts"
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
