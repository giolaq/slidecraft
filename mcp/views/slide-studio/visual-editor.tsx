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
async function readImage(file: File): Promise<string> {
  if (
    !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG, WebP or GIF under 8 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("Choose an image under 40 megapixels.");
    for (const width of [1400, 1000, 700, 450]) {
      const canvas = document.createElement("canvas"),
        ratio = Math.min(1, width / bitmap.width, width / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL("image/webp", 0.75);
      if (src.length <= 180000) return src;
    }
    throw new Error(
      "Image is too large after compression. Choose a smaller image.",
    );
  } finally {
    bitmap.close();
  }
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
  function add(element: SlideElement) {
    setElements((all) => [...all, element]);
    setSelected(element.id);
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
        Drag an element to move it. Drag its corner to resize. Select text to
        edit it below.
      </p>
      {error && <p role="alert">{error}</p>}
      <div ref={viewport} className="sc-visual-viewport">
        <div
          className="sc-visual-canvas"
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
              aria-pressed={selected === el.id}
              className={`sc-visual-element ${selected === el.id ? "selected" : ""}`}
              style={{
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
                color: el.color,
                fontSize: el.fontSize,
                fontWeight: el.bold ? 700 : 400,
              }}
              onFocus={() => setSelected(el.id)}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const step = e.shiftKey ? 10 : 1;
                  patch({
                    x:
                      el.x +
                      (e.key === "ArrowRight"
                        ? step
                        : e.key === "ArrowLeft"
                          ? -step
                          : 0),
                    y:
                      el.y +
                      (e.key === "ArrowDown"
                        ? step
                        : e.key === "ArrowUp"
                          ? -step
                          : 0),
                  });
                }
              }}
              onPointerDown={(e) => {
                if (busy) return;
                e.preventDefault();
                setSelected(el.id);
                e.currentTarget.focus();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  id: el.id,
                  px: e.clientX,
                  py: e.clientY,
                  element: el,
                  resize: (e.target as HTMLElement).dataset.resize === "true",
                };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== el.id) return;
                const dx = (e.clientX - d.px) / scale,
                  dy = (e.clientY - d.py) / scale;
                const changes = d.resize
                  ? {
                      width: Math.max(
                        20,
                        Math.min(1600 - d.element.x, d.element.width + dx),
                      ),
                      height: Math.max(
                        20,
                        Math.min(900 - d.element.y, d.element.height + dy),
                      ),
                    }
                  : {
                      x: clamp(d.element.x + dx, 1600 - el.width),
                      y: clamp(d.element.y + dy, 900 - el.height),
                    };
                setElements((all) =>
                  all.map((item) =>
                    item.id === d.id ? { ...item, ...changes } : item,
                  ),
                );
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
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
              {selected === el.id && (
                <span data-resize="true" className="sc-resize-handle" />
              )}
            </div>
          ))}
        </div>
      </div>
      {current && (
        <fieldset disabled={busy} className="sc-element-properties">
          <legend>Selected {current.type}</legend>
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
            }}
          >
            Delete element
          </button>
        </fieldset>
      )}
    </section>
  );
}
