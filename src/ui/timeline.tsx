import { useRef, useState } from "preact/hooks";
import type { LayerAnim } from "../shared/anim";
import type { LayerInfo } from "../shared/messages";
import type { BarKind } from "./timeline-model";
import { layerBars, moveBar, timelineSpan } from "./timeline-model";

const BAR_TITLES: Record<BarKind, string> = {
  intro: "Поява: тягніть, щоб змінити затримку",
  custom: "Власна анімація: тягніть, щоб змінити старт",
  loop: "Цикл: тягніть, щоб змінити старт",
  outro: "Зникнення: тягніть, щоб змінити момент",
};

const LANE_ORDER: BarKind[] = ["intro", "custom", "loop", "outro"];
/** Lane height in px. */
const LANE = 9;

interface Drag {
  id: string;
  kind: BarKind;
  x: number;
  /** Track width in px, to turn pixels into seconds. */
  width: number;
  /** Axis length when the drag started, kept so the bar tracks the pointer. */
  span: number;
  original: LayerAnim;
  current: LayerAnim;
}

/**
 * Bars for every animated layer on a shared time axis. Dragging a bar moves that
 * animation in time; the change is saved when the drag ends.
 */
export function Timeline(props: {
  layers: LayerInfo[];
  maxDuration: number | null;
  selectedIds: string[];
  replay: number;
  onChange: (id: string, anim: LayerAnim) => void;
}) {
  const { maxDuration, selectedIds } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const rows = props.layers
    .filter(
      (l) =>
        l.anim &&
        (l.anim.intro || l.anim.loop || l.anim.outro || l.anim.custom),
    )
    .map((l) => ({
      layer: l,
      anim: drag?.id === l.id ? drag.current : l.anim!,
    }));
  if (rows.length === 0) return null;

  const span =
    drag?.span ??
    timelineSpan(
      rows.map((r) => r.anim),
      maxDuration,
    );
  const ticks = Array.from({ length: Math.floor(span) + 1 }, (_, i) => i);
  const pct = (t: number) => `${(t / span) * 100}%`;

  const limit =
    maxDuration !== null && maxDuration < span ? (
      <span
        class="tl-limit"
        style={{ left: pct(maxDuration) }}
        title={`Ліміт мережі: ${maxDuration} с`}
      />
    ) : null;

  const onDown = (
    e: PointerEvent,
    id: string,
    kind: BarKind,
    anim: LayerAnim,
  ) => {
    const track = (e.currentTarget as HTMLElement).parentElement!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      id,
      kind,
      x: e.clientX,
      width: track.clientWidth,
      span,
      original: anim,
      current: anim,
    });
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dt = ((e.clientX - d.x) / d.width) * d.span;
    setDrag({ ...d, current: moveBar(d.original, d.kind, dt) });
  };
  const onUp = () => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    if (d.current !== d.original) props.onChange(d.id, d.current);
  };

  return (
    <div class="timeline">
      <div class="tl-row tl-axis">
        <span class="tl-name" />
        <div class="tl-track">
          {ticks.map((t) => (
            <span class="tl-tick" style={{ left: pct(t) }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      {rows.map(({ layer, anim }) => {
        const bars = layerBars(anim, maxDuration, span);
        // Each kind gets its own lane so overlapping bars stay separately draggable.
        const lanes = LANE_ORDER.filter((k) =>
          bars.some((bar) => bar.kind === k),
        );
        return (
          <div
            class={`tl-row${selectedIds.includes(layer.id) ? " selected" : ""}`}
            style={{ height: `${lanes.length * LANE + 4}px` }}
          >
            <span class="tl-name" title={layer.name}>
              {layer.name}
            </span>
            <div class="tl-track">
              {bars.map((bar) => (
                <span
                  class={`tl-bar ${bar.kind}`}
                  style={{
                    left: pct(bar.start),
                    width: `max(3px, ${pct(bar.end - bar.start)})`,
                    top: `${2 + lanes.indexOf(bar.kind) * LANE}px`,
                    height: `${LANE - 2}px`,
                  }}
                  title={`${BAR_TITLES[bar.kind]} (${round(bar.start)}–${round(bar.end)} с)`}
                  onPointerDown={(e) => onDown(e, layer.id, bar.kind, anim)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                />
              ))}
              {limit}
              {/* Keyed by replay so the playhead restarts with the preview. */}
              <span
                key={props.replay}
                class="tl-playhead"
                style={{ animationDuration: `${span}s` }}
              />
            </div>
          </div>
        );
      })}
      {drag && <p class="muted small">{dragLabel(drag)}</p>}
    </div>
  );
}

function dragLabel(d: Drag): string {
  const a = d.current;
  switch (d.kind) {
    case "intro":
      return `Затримка появи: ${a.intro?.delay ?? 0} с`;
    case "custom":
      return `Старт власної анімації: ${a.custom?.delay ?? 0} с`;
    case "loop":
      return `Старт циклу після появи: ${a.loop?.delay ?? 0} с`;
    case "outro":
      return `Зникнення о ${a.outro?.at ?? 0} с`;
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
