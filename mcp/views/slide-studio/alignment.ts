import type { SlideElement } from "./schema.js";
export type Box = { x: number; y: number; width: number; height: number };
export type Guide = { axis: "x" | "y"; value: number };
export function bounds(items: Box[]): Box {
  const x = Math.min(...items.map((i) => i.x)),
    y = Math.min(...items.map((i) => i.y));
  return {
    x,
    y,
    width: Math.max(...items.map((i) => i.x + i.width)) - x,
    height: Math.max(...items.map((i) => i.y + i.height)) - y,
  };
}
export function snapMove(
  box: Box,
  dx: number,
  dy: number,
  others: Box[],
  threshold: number,
  enabled = true,
) {
  const guides: Guide[] = [];
  const snap = (
    axis: "x" | "y",
    delta: number,
    size: "width" | "height",
    limit: number,
  ) => {
    let start = Math.max(0, Math.min(limit - box[size], box[axis] + delta));
    if (!enabled) return start - box[axis];
    const targets = [
      0,
      limit / 2,
      limit,
      ...others.flatMap((i) => [
        i[axis],
        i[axis] + i[size] / 2,
        i[axis] + i[size],
      ]),
    ];
    let best = threshold + 0.0001,
      guide: number | undefined,
      position = start;
    for (const offset of [0, box[size] / 2, box[size]])
      for (const target of targets) {
        const candidate = target - offset,
          distance = Math.abs(candidate - start);
        if (
          candidate >= 0 &&
          candidate <= limit - box[size] &&
          distance < best
        ) {
          best = distance;
          position = candidate;
          guide = target;
        }
      }
    if (guide !== undefined) guides.push({ axis, value: guide });
    return position - box[axis];
  };
  return {
    dx: snap("x", dx, "width", 1600),
    dy: snap("y", dy, "height", 900),
    guides,
  };
}
export type Alignment =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";
export function alignItems(
  elements: SlideElement[],
  ids: string[],
  alignment: Alignment,
): SlideElement[] {
  const items = elements.filter((el) => ids.includes(el.id));
  if (items.length < 2) return elements;
  const box = bounds(items);
  return elements.map((el) =>
    !ids.includes(el.id)
      ? el
      : {
          ...el,
          ...{
            left: { x: box.x },
            center: { x: box.x + (box.width - el.width) / 2 },
            right: { x: box.x + box.width - el.width },
            top: { y: box.y },
            middle: { y: box.y + (box.height - el.height) / 2 },
            bottom: { y: box.y + box.height - el.height },
          }[alignment],
        },
  );
}
export function distributeItems(
  elements: SlideElement[],
  ids: string[],
  axis: "x" | "y",
): SlideElement[] {
  const size = axis === "x" ? "width" : "height";
  const items = elements
    .filter((el) => ids.includes(el.id))
    .sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
  if (items.length < 3) return elements;
  const first = items[0],
    last = items[items.length - 1];
  const gap =
    (last[axis] +
      last[size] -
      first[axis] -
      items.reduce((sum, el) => sum + el[size], 0)) /
    (items.length - 1);
  if (gap < 0)
    throw new Error(
      "Spread the selected items farther apart before distributing them evenly.",
    );
  let pos = first[axis];
  const positions = new Map<string, number>();
  for (const el of items) {
    positions.set(el.id, pos);
    pos += el[size] + gap;
  }
  // Keep the two outside items fixed.
  positions.set(last.id, last[axis]);
  return elements.map((el) =>
    positions.has(el.id) ? { ...el, [axis]: positions.get(el.id)! } : el,
  );
}
