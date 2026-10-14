import {
  bounds,
  snapMove,
  alignItems,
  distributeItems,
  type Guide,
  type Alignment,
} from "./alignment.js";
import { readImage } from "./image-import.js";
import { useEffect, useRef, useState } from "react";
import type { Deck, Slide, SlideElement } from "./schema.js";

const id = () => "element-" + crypto.randomUUID().slice(0, 8);
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
function fromSlide(slide: Slide, color: string): SlideElement[] {
  if (slide.elements) return structuredClone(slide.elements);
  const text = (
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize = 36,
    bold = false,
  ): SlideElement => ({
    id: id(),
    type: "text",
    text: value,
    x,
    y,
    width,
    height,
    fontSize,
    bold,
    color,
    fit: "contain",
  });
  const elements = [text(slide.title, 80, 100, 1440, 180, 76, true)];
  if (slide.eyebrow) elements.push(text(slide.eyebrow, 80, 40, 1440, 45, 24));
  if (slide.body)
    elements.push(text(slide.body, 80, 300, slide.image ? 700 : 1440, 180));
  const details = [
    ...(slide.bullets || []),
    ...(slide.cards || slide.steps || []).map((c) => c.title + "\n" + c.body),
    ...(slide.metrics || []).map((c) => c.value + "\n" + c.label),
  ];
  details.forEach((value, i) => {
    const cols = Math.min(details.length, 3),
      rows = Math.ceil(details.length / cols);
    const width = (slide.image ? 700 : 1440) / cols;
    elements.push(
      text(
        value,
        80 + (i % cols) * width,
        500 + Math.floor(i / cols) * (300 / rows),
        width - 20,
        300 / rows - 10,
        26,
      ),
    );
  });
  if (slide.image)
    elements.push({
      id: id(),
      type: "image",
      src: slide.image.src,
      text: slide.image.alt,
      x: 840,
      y: 300,
      width: 680,
      height: 470,
      fontSize: 40,
      bold: false,
      color,
      fit: slide.image.fit,
    });
  if (slide.footer) elements.push(text(slide.footer, 80, 830, 1440, 40, 20));
  return elements;
}
export function VisualEditor({
  deck,
  slide,
  onSave,
  onClose,
}: {
  deck: Deck;
  slide: Slide;
  onSave: (
    elements: SlideElement[],
    colors: NonNullable<Slide["colors"]>,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [elements, setElements] = useState(() =>
    fromSlide(
      slide,
      slide.colors?.foreground ||
        deck.theme.foreground ||
        (deck.theme.mode === "light" ? "#18201b" : "#f4f4eb"),
    ),
  );
  const [colors, setColors] = useState({
    ...slide.colors,
    background:
      slide.colors?.background ||
      deck.theme.background ||
      (deck.theme.mode === "light" ? "#f2f1e9" : "#151816"),
  });
  const [selected, setSelected] = useState<string | undefined>(elements[0]?.id);
  const [selection, setSelection] = useState<string[]>(
    elements[0] ? [elements[0].id] : [],
  );
  const [guides, setGuides] = useState<Guide[]>([]);
  const [snapping, setSnapping] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null),
    upload = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(0.5);
  const drag = useRef<{
    id: string;
    px: number;
    py: number;
    element: SlideElement;
    resize: boolean;
    items: SlideElement[];
    others: SlideElement[];
  } | null>(null);
  const current = elements.find((el) => el.id === selected);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / 1600),
    );
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  function patch(changes: Partial<SlideElement>) {
    setElements((all) =>
      all.map((el) => {
        if (el.id !== selected) return el;
        const next = { ...el, ...changes };
        next.width = Math.max(20, Math.min(1600, next.width));
        next.height = Math.max(20, Math.min(900, next.height));
        next.x = clamp(next.x, 1600 - next.width);
        next.y = clamp(next.y, 900 - next.height);
        return next;
      }),
    );
  }
  function distribute(axis: "x" | "y") {
    try {
      setElements(distributeItems(elements, selection, axis));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function add(element: SlideElement) {
    setElements((all) => [...all, element]);
    setSelected(element.id);
    setSelection([element.id]);
  }
  return (
    <section className="sc-visual" aria-label="Visual slide editor">
      <div className="sc-visual-toolbar">
        <button
          disabled={busy || elements.length >= 80}
          onClick={() =>
            add({
              id: id(),
              type: "text",
              text: "New text",
              x: 120,
              y: 120,
              width: 600,
              height: 160,
              color:
                colors.foreground ||
                deck.theme.foreground ||
                (deck.theme.mode === "light" ? "#18201b" : "#ffffff"),
              fontSize: 48,
              bold: false,
              fit: "contain",
            })
          }
        >
          Add text
        </button>
        <button
          disabled={busy || elements.length >= 80}
          onClick={() => upload.current?.click()}
        >
          Add image
        </button>
        <label>
          Background{" "}
          <input
            disabled={busy}
            aria-label="Slide background"
            type="color"
            value={colors.background}
            onChange={(e) =>
              setColors({ ...colors, background: e.target.value })
            }
          />
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(elements, colors);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save visual edits"}
        </button>
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <input
          ref={upload}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Upload slide image"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              add({
                id: id(),
                type: "image",
                src: await readImage(file),
                text: file.name,
                x: 400,
                y: 180,
                width: 800,
                height: 500,
                color: "#ffffff",
                fontSize: 40,
                bold: false,
                fit: "contain",
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {!slide.elements && (
        <p>
          Preview the editable layout below before saving. Cancel keeps the
          original layout.
        </p>
      )}
      <p>
        Drag to snap to item edges and centers. Shift-click to select multiple
        items. Hold Alt while dragging to bypass snapping.
      </p>
      <label>
        <input
          type="checkbox"
          checked={snapping}
          onChange={(e) => setSnapping(e.target.checked)}
        />{" "}
        Snap to guides
      </label>
      <p role="status" aria-label="Selection count">
        {selection.length} selected
      </p>
      {error && <p role="alert">{error}</p>}
      <div ref={viewport} className="sc-visual-viewport">
        <div
          className="sc-visual-canvas"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelection([]);
              setSelected(undefined);
              setGuides([]);
            }
          }}
          style={{
            transform: `scale(${scale})`,
            background: colors.background,
          }}
        >
          {elements.map((el) => (
            <div
              key={el.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${el.type}: ${(el.text || "Image").slice(0, 80)}`}
              aria-pressed={selection.includes(el.id)}
              className={`sc-visual-element ${selection.includes(el.id) ? "selected" : ""}`}
              style={{
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
                color: el.color,
                fontSize: el.fontSize,
                textAlign: el.textAlign || "left",
                fontWeight: el.bold ? 700 : 400,
              }}
              onFocus={() => {
                setSelected(el.id);
                if (!selection.includes(el.id)) setSelection([el.id]);
              }}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const step = e.shiftKey ? 10 : 1;
                  const items = elements.filter((item) =>
                    selection.includes(item.id),
                  );
                  const move = snapMove(
                    bounds(items.length ? items : [el]),
                    e.key === "ArrowRight"
                      ? step
                      : e.key === "ArrowLeft"
                        ? -step
                        : 0,
                    e.key === "ArrowDown"
                      ? step
                      : e.key === "ArrowUp"
                        ? -step
                        : 0,
                    [],
                    0,
                    false,
                  );
                  setElements((all) =>
                    all.map((item) =>
                      selection.includes(item.id)
                        ? { ...item, x: item.x + move.dx, y: item.y + move.dy }
                        : item,
                    ),
                  );
                }
              }}
              onPointerDown={(e) => {
                if (busy) return;
                e.preventDefault();
                const ids =
                  e.shiftKey || e.metaKey || e.ctrlKey
                    ? selection.includes(el.id)
                      ? selection.filter((id) => id !== el.id)
                      : [...selection, el.id]
                    : selection.includes(el.id)
                      ? selection
                      : [el.id];
                e.currentTarget.focus();
                setSelection(ids);
                setSelected(ids.includes(el.id) ? el.id : ids[ids.length - 1]);
                if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  id: el.id,
                  px: e.clientX,
                  py: e.clientY,
                  element: el,
                  resize:
                    ids.length === 1 &&
                    (e.target as HTMLElement).dataset.resize === "true",
                  items: elements.filter((item) => ids.includes(item.id)),
                  others: elements.filter((item) => !ids.includes(item.id)),
                };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== el.id) return;
                const dx = (e.clientX - d.px) / scale,
                  dy = (e.clientY - d.py) / scale;
                if (d.resize) {
                  setElements((all) =>
                    all.map((item) =>
                      item.id === d.id
                        ? {
                            ...item,
                            width: Math.max(
                              20,
                              Math.min(
                                1600 - d.element.x,
                                d.element.width + dx,
                              ),
                            ),
                            height: Math.max(
                              20,
                              Math.min(
                                900 - d.element.y,
                                d.element.height + dy,
                              ),
                            ),
                          }
                        : item,
                    ),
                  );
                  return;
                }
                const move = snapMove(
                  bounds(d.items),
                  dx,
                  dy,
                  d.others,
                  6 / scale,
                  snapping && !e.altKey,
                );
                setGuides(move.guides);
                setElements((all) =>
                  all.map((item) => {
                    const original = d.items.find(
                      (entry) => entry.id === item.id,
                    );
                    return original
                      ? {
                          ...item,
                          x: original.x + move.dx,
                          y: original.y + move.dy,
                        }
                      : item;
                  }),
                );
              }}
              onPointerUp={() => {
                drag.current = null;
                setGuides([]);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
                setGuides([]);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setGuides([]);
              }}
            >
              {el.type === "image" ? (
                <img
                  draggable={false}
                  src={el.src}
                  alt={el.text || ""}
                  style={{ objectFit: el.fit }}
                />
              ) : (
                el.text
              )}
              {selection.length === 1 && selected === el.id && (
                <span data-resize="true" className="sc-resize-handle" />
              )}
            </div>
          ))}
          {guides.map((guide) => (
            <div
              key={guide.axis}
              data-guide-axis={guide.axis}
              data-guide-value={guide.value}
              aria-hidden="true"
              className={`sc-snap-guide sc-snap-${guide.axis}`}
              style={
                guide.axis === "x"
                  ? { left: guide.value }
                  : { top: guide.value }
              }
            />
          ))}
        </div>
      </div>
      {selection.length > 1 && (
        <fieldset disabled={busy} className="sc-element-properties">
          <legend>Align selected items relative to each other</legend>
          {(
            [
              ["left", "Align left"],
              ["center", "Center horizontally"],
              ["right", "Align right"],
              ["top", "Align top"],
              ["middle", "Center vertically"],
              ["bottom", "Align bottom"],
            ] as [Alignment, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() =>
                setElements((all) => alignItems(all, selection, value))
              }
            >
              {label}
            </button>
          ))}
          <button
            disabled={selection.length < 3}
            onClick={() => distribute("x")}
          >
            Distribute horizontally
          </button>
          <button
            disabled={selection.length < 3}
            onClick={() => distribute("y")}
          >
            Distribute vertically
          </button>
          <button
            onClick={() => {
              setElements((all) =>
                all.filter((el) => !selection.includes(el.id)),
              );
              setSelection([]);
              setSelected(undefined);
            }}
          >
            Delete selected items
          </button>
        </fieldset>
      )}
      {current && selection.length === 1 && (
        <fieldset disabled={busy} className="sc-element-properties">
          <legend>Selected {current.type}</legend>
          <div
            role="group"
            aria-label="Align item to slide"
            className="sc-alignment"
          >
            <span>Align item to slide</span>
            <button onClick={() => patch({ x: 0 })}>Align left</button>
            <button onClick={() => patch({ x: (1600 - current.width) / 2 })}>
              Center horizontally
            </button>
            <button onClick={() => patch({ x: 1600 - current.width })}>
              Align right
            </button>
            <button onClick={() => patch({ y: 0 })}>Align top</button>
            <button onClick={() => patch({ y: (900 - current.height) / 2 })}>
              Center vertically
            </button>
            <button onClick={() => patch({ y: 900 - current.height })}>
              Align bottom
            </button>
          </div>
          <label>
            {current.type === "text" ? "Text" : "Image description"}
            <textarea
              aria-label="Element text"
              value={current.text || ""}
              maxLength={8000}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </label>
          {current.type === "text" && (
            <>
              <label>
                Text alignment
                <select
                  aria-label="Text alignment"
                  value={current.textAlign || "left"}
                  onChange={(e) =>
                    patch({
                      textAlign: e.target.value as "left" | "center" | "right",
                    })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label>
                Text color{" "}
                <input
                  type="color"
                  aria-label="Text color"
                  value={current.color}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </label>
              <label>
                Font size{" "}
                <input
                  type="number"
                  min={8}
                  max={200}
                  value={current.fontSize}
                  onChange={(e) =>
                    patch({
                      fontSize: Math.max(
                        8,
                        Math.min(200, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={current.bold}
                  onChange={(e) => patch({ bold: e.target.checked })}
                />{" "}
                Bold
              </label>
            </>
          )}
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                aria-label={`Element ${key}`}
                type="number"
                value={Math.round(current[key])}
                min={key === "x" || key === "y" ? 0 : 20}
                max={key === "x" || key === "width" ? 1600 : 900}
                onChange={(e) => patch({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          {current.type === "image" && (
            <label>
              Image fit{" "}
              <select
                value={current.fit}
                onChange={(e) =>
                  patch({ fit: e.target.value as "contain" | "cover" })
                }
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
              </select>
            </label>
          )}
          <button
            onClick={() =>
              setElements((all) => [
                ...all.filter((el) => el.id !== selected),
                current,
              ])
            }
          >
            Bring to front
          </button>
          <button
            onClick={() =>
              setElements((all) => [
                current,
                ...all.filter((el) => el.id !== selected),
              ])
            }
          >
            Send to back
          </button>
          <button
            onClick={() => {
              setElements((all) => all.filter((el) => el.id !== selected));
              setSelected(undefined);
              setSelection([]);
            }}
          >
            Delete element
          </button>
        </fieldset>
      )}
    </section>
  );
}
