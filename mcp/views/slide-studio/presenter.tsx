import { useEffect, useState } from "react";
import { CodePreview } from "./code-preview.js";
import type { Deck, Slide } from "./schema.js";
export function Presenter({
  deck,
  slide,
  onSelect,
  onClose,
}: {
  deck: Deck;
  slide: Slide;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [speaker, setSpeaker] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const index = deck.slides.findIndex((s) => s.id === slide.id);
  const next = deck.slides[index + 1];
  useEffect(() => {
    const id = setInterval(() => setSeconds((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  function move(delta: number) {
    const target = deck.slides[index + delta];
    if (target) onSelect(target.id);
  }
  return (
    <section
      className={`sc-present ${speaker ? "sc-speaker" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={speaker ? "Speaker view" : "Presentation"}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        if (
          ["ArrowRight", "PageDown"].includes(e.key) ||
          (e.key === " " && !(e.target instanceof HTMLButtonElement))
        ) {
          e.preventDefault();
          move(1);
        }
        if (["ArrowLeft", "PageUp"].includes(e.key)) {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      <div className="sc-present-stage">
        <CodePreview
          deck={deck}
          slide={slide}
          replay={0}
          onSelect={onSelect}
          audience
          onExit={onClose}
        />
      </div>
      {speaker && (
        <aside className="sc-speaker-notes">
          <h2>Speaker view</h2>
          <p>Keep this view on your own screen when presenting.</p>
          <p aria-label="Elapsed time">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </p>
          <h3>Speaker notes</h3>
          <p className="sc-note-text">
            {slide.notes || "No speaker notes for this slide."}
          </p>
          <h3>Next slide</h3>
          {next ? (
            <>
              <p>{next.title}</p>
              <CodePreview
                deck={deck}
                slide={next}
                replay={0}
                onSelect={() => {}}
                audience
              />
            </>
          ) : (
            <p>End of presentation</p>
          )}
        </aside>
      )}
      <nav className="sc-present-controls" aria-label="Presenter controls">
        <button onClick={() => move(-1)} disabled={index === 0}>
          Previous slide
        </button>
        <span>
          {index + 1} / {deck.slides.length}
        </span>
        <button onClick={() => move(1)} disabled={!next}>
          Next slide
        </button>
        <button onClick={() => setSpeaker(!speaker)}>
          {speaker ? "Audience view" : "Speaker view"}
        </button>
        <button autoFocus onClick={onClose}>
          Exit presentation
        </button>
      </nav>
    </section>
  );
}
