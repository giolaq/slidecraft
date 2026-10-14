import { useNarrationPlayback } from "./use-narration-playback.js";
import { useEffect, useRef, useState } from "react";
import { CodePreview } from "./code-preview.js";
import type { Deck, Slide } from "./schema.js";
export function Presenter({
  deck: incomingDeck,
  slide: incomingSlide,
  onSelect,
  onClose,
}: {
  deck: Deck;
  slide: Slide;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  // Freeze the presentation so live edits cannot change a running narration sequence.
  const [deck] = useState(() => structuredClone(incomingDeck));
  const [slideId, setSlideId] = useState(incomingSlide.id);
  const [initialIndex] = useState(() =>
    incomingDeck.slides.findIndex((s) => s.id === incomingSlide.id),
  );
  const slide = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const playback = useNarrationPlayback(deck, initialIndex, (id) => {
    setSlideId(id);
    onSelect(id);
  });
  const dialogRef = useRef<HTMLElement>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    dialogRef.current?.focus();
    return () => clearTimeout(hideControlsTimer.current);
  }, []);
  function revealControls() {
    setControlsVisible(true);
    clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(
      () => setControlsVisible(false),
      1800,
    );
  }
  const [controlsVisible, setControlsVisible] = useState(false);
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
    if (target) playback.manual(index + delta);
  }
  return (
    <section
      className={`sc-present ${speaker ? "sc-speaker" : ""}`}
      ref={dialogRef}
      tabIndex={-1}
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
          onSelect={(id) => {
            const i = deck.slides.findIndex((s) => s.id === id);
            if (i >= 0 && id !== slide.id) playback.manual(i);
          }}
          onReady={playback.ready}
          audience
          onExit={onClose}
        />
      </div>
      {["blocked", "error"].includes(playback.state) && (
        <div className="sc-audio-alert" role="alert">
          {playback.message}{" "}
          <button onClick={playback.resume}>Resume audio</button>
        </div>
      )}
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
          {slide.narration?.script && (
            <>
              <h3>Narration script</h3>
              <p className="sc-note-text">{slide.narration.script}</p>
            </>
          )}
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
      <nav
        className={`sc-present-controls ${controlsVisible ? "sc-controls-visible" : ""}`}
        aria-label="Presenter controls"
        onPointerEnter={revealControls}
        onPointerMove={revealControls}
        onPointerLeave={() => setControlsVisible(false)}
      >
        <button onClick={() => move(-1)} disabled={index === 0}>
          Previous slide
        </button>
        <span>
          {index + 1} / {deck.slides.length}
        </span>
        <button onClick={() => move(1)} disabled={!next}>
          Next slide
        </button>
        {playback.available && (
          <>
            <button onClick={() => playback.start(index)}>
              Auto present from here
            </button>
            <button onClick={() => playback.start(0)}>
              Auto present from beginning
            </button>
            {playback.state === "playing" || playback.state === "loading" ? (
              <button onClick={playback.pause}>Pause narration</button>
            ) : (
              <button onClick={playback.resume}>Resume audio</button>
            )}
            <button onClick={playback.replay}>Replay / retry audio</button>
            <label>
              Volume
              <input
                aria-label="Narration volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                defaultValue="1"
                onChange={(e) => playback.volume(Number(e.target.value))}
              />
            </label>
          </>
        )}
        <span role="status">{playback.message}</span>
        <button onClick={() => setSpeaker(!speaker)}>
          {speaker ? "Audience view" : "Speaker view"}
        </button>
        <button onClick={onClose}>Exit presentation</button>
      </nav>
    </section>
  );
}
