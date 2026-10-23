import { useRef, useState } from 'preact/hooks';
import type { LayerAnim } from '../shared/anim';
import type { LayerInfo } from '../shared/messages';
import type { BarKind } from './timeline-model';
import { layerBars, moveBar, tickStep, timelineSpan } from './timeline-model';

const BAR_TITLES: Record<BarKind, string> = {
  intro: 'Поява: тягніть, щоб змінити затримку',
  custom: 'Ключові кадри: тягніть, щоб змінити старт',
  loop: 'Цикл: тягніть, щоб змінити старт',
  outro: 'Зникнення: тягніть, щоб змінити момент',
};

const LANE_ORDER: BarKind[] = ['intro', 'custom', 'loop', 'outro'];
/** Lane height in px. */
const LANE = 7;

const TYPE_ICONS: Partial<Record<NodeType, string>> = {
  TEXT: 'T',
  FRAME: '#',
  GROUP: '▣',
  RECTANGLE: '□',
  ELLIPSE: '○',
  VECTOR: '✎',
  BOOLEAN_OPERATION: '◑',
  INSTANCE: '◇',
  COMPONENT: '❖',
  LINE: '╱',
  STAR: '☆',
  POLYGON: '△',
};

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
  moved: boolean;
}

/**
 * The frame's layers with their animations on a shared time axis. Clicking a row
 * selects the layer; dragging a bar moves that animation in time and saves on release.
 */
export function LayerTimeline(props: {
  layers: LayerInfo[];
  maxDuration: number | null;
  selectedIds: string[];
  /** Layer ids present in the built banner; animated layers missing from it were merged into a raster image. */
  ids: Set<string> | null;
  replay: number;
  onSelect: (id: string) => void;
  onChange: (id: string, anim: LayerAnim) => void;
}) {
  const { layers, maxDuration, selectedIds, ids } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  if (layers.length === 0) return <p class="muted">У фреймі немає шарів.</p>;

  const animOf = (l: LayerInfo) => (drag?.id === l.id ? drag.current : l.anim);
  const span =
    drag?.span ??
    timelineSpan(
      layers.map(animOf).filter((a): a is LayerAnim => !!a),
      maxDuration,
    );
  const step = tickStep(span);
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const pct = (t: number) => `${(t / span) * 100}%`;

  const onDown = (e: PointerEvent, id: string, kind: BarKind, anim: LayerAnim) => {
    const track = (e.currentTarget as HTMLElement).parentElement!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, kind, x: e.clientX, width: track.clientWidth, span, original: anim, current: anim, moved: false });
    e.stopPropagation();
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    setDrag({ ...d, moved: d.moved || Math.abs(dx) > 2, current: moveBar(d.original, d.kind, (dx / d.width) * d.span) });
  };
  const onUp = () => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    if (d.moved && d.current !== d.original) props.onChange(d.id, d.current);
    else props.onSelect(d.id);
  };

  return (
    <div class="lt">
      <div class="lt-row lt-axis">
        <span class="lt-name muted small">{drag ? dragLabel(drag) : 'Шар'}</span>
        <div class="lt-track">
          {ticks.map((t) => (
            <span class="lt-tick" style={{ left: pct(t) }}>
              {t === 0 ? '0 с' : t}
            </span>
          ))}
        </div>
      </div>
      <div class="lt-body">
        {layers.map((layer) => {
          const anim = animOf(layer);
          const bars = anim ? layerBars(anim, maxDuration, span) : [];
          // Each kind gets its own lane so overlapping bars stay separately draggable.
          const lanes = LANE_ORDER.filter((k) => bars.some((bar) => bar.kind === k));
          const lost = !!anim && !!ids && !ids.has(layer.id);
          const selected = selectedIds.includes(layer.id);
          return (
            <div
              class={`lt-row${selected ? ' selected' : ''}`}
              style={{ minHeight: `${Math.max(22, lanes.length * LANE + 8)}px` }}
              onClick={() => props.onSelect(layer.id)}
              title={lost ? 'Шар увійшов у растрове зображення батьківського шару, тому його анімація не застосується' : layer.name}
            >
              <span class="lt-name" style={{ paddingLeft: `${layer.depth * 10}px` }}>
                <span class="lt-icon">{TYPE_ICONS[layer.type] ?? '•'}</span>
                <span class="lt-label">{layer.name}</span>
                {anim?.hover && <span class="lt-hover" title="Є hover-ефект" />}
                {lost && <span class="badge warn">растр</span>}
              </span>
              <div class="lt-track">
                {bars.map((bar) => (
                  <span
                    class={`lt-bar ${bar.kind}`}
                    style={{
                      left: pct(bar.start),
                      width: `max(4px, ${pct(bar.end - bar.start)})`,
                      top: `${4 + lanes.indexOf(bar.kind) * LANE}px`,
                      height: `${LANE - 2}px`,
                    }}
                    title={`${BAR_TITLES[bar.kind]} (${round(bar.start)}–${round(bar.end)} с)`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => onDown(e, layer.id, bar.kind, anim!)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  />
                ))}
                {maxDuration !== null && maxDuration < span && <span class="lt-limit" style={{ left: pct(maxDuration) }} />}
                {/* Keyed by replay so the playhead restarts with the preview. */}
                {bars.length > 0 && <span key={props.replay} class="lt-playhead" style={{ animationDuration: `${span}s` }} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function dragLabel(d: Drag): string {
  const a = d.current;
  switch (d.kind) {
    case 'intro':
      return `Затримка ${a.intro?.delay ?? 0} с`;
    case 'custom':
      return `Старт ${a.custom?.delay ?? 0} с`;
    case 'loop':
      return `Після появи ${a.loop?.delay ?? 0} с`;
    case 'outro':
      return `Зникнення ${a.outro?.at ?? 0} с`;
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
