import { useRef, useState } from 'preact/hooks';
import type { LayerAnim } from '../shared/anim';
import type { LayerInfo } from '../shared/messages';
import type { BarKind } from './timeline-model';
import { layerBars, moveBar, tickStep, timelineSpan } from './timeline-model';
import { t } from '../shared/i18n';

function barTitle(kind: BarKind): string {
  switch (kind) {
    case 'intro':
      return t('Поява: тягніть, щоб змінити затримку', 'Intro: drag to change the delay');
    case 'custom':
      return t('Ключові кадри: тягніть, щоб змінити старт', 'Keyframes: drag to change the start');
    case 'loop':
      return t('Цикл: тягніть, щоб змінити старт', 'Loop: drag to change the start');
    case 'outro':
      return t('Зникнення: тягніть, щоб змінити момент', 'Outro: drag to change the moment');
  }
}

const LANE_ORDER: BarKind[] = ['intro', 'custom', 'loop', 'outro'];
/** Lane height in px. */
const LANE = 9;

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
  /** Preview time in seconds, shown by the playhead. */
  time: number;
  scrubbing: boolean;
  onScrub: (t: number) => void;
  onStagger: () => void;
  onSelect: (id: string) => void;
  onChange: (id: string, anim: LayerAnim) => void;
}) {
  const { layers, maxDuration, selectedIds, ids, time } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;


  const animOf = (l: LayerInfo) => (drag?.id === l.id ? drag.current : l.anim);
  const span =
    drag?.span ??
    timelineSpan(
      layers.map(animOf).filter((a): a is LayerAnim => !!a),
      maxDuration,
    );
  const step = tickStep(span);
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const pct = (s: number) => `${(s / span) * 100}%`;
  const head = Math.min(time, span);

  /** Pointer on the axis seeks the preview to that moment. */
  const seek = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    const box = track.getBoundingClientRect();
    props.onScrub(Math.round(Math.min(span, Math.max(0, ((e.clientX - box.left) / box.width) * span)) * 100) / 100);
  };

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
      <div class="lt-head">
        <strong>{t('Таймлайн', 'Timeline')}</strong>
        <span class={`lt-time${props.scrubbing ? ' paused' : ''}`}>{head.toFixed(2)} {t('с', 's')}</span>
        <span class="legend">
          <span class="dot intro" />
          {t('Поява', 'Intro')}
          <span class="dot custom" />
          {t('Кадри', 'Keyframes')}
          <span class="dot loop" />
          {t('Цикл', 'Loop')}
          <span class="dot hover" />
          Hover
          <span class="dot outro" />
          {t('Зникнення', 'Outro')}
        </span>
        <button class="ghost small" onClick={props.onStagger} disabled={!layers.some((l) => l.anim?.intro)} title={t('Затримки появи 0, 0.25, 0.5 с… у порядку шарів', 'Intro delays 0, 0.25, 0.5 s… in layer order')}>
          {t('Появи по черзі', 'Stagger intros')}
        </button>
      </div>
      <div class="lt-row lt-axis">
        <span class="lt-name muted small">{drag ? dragLabel(drag) : t('Шари', 'Layers')}</span>
        <div
          class="lt-track"
          title={t('Тягніть, щоб перемотати превʼю', 'Drag to scrub the preview')}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            seek(e);
          }}
          onPointerMove={(e) => (e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) && seek(e)}
        >
          {ticks.map((tick) => (
            <span class="lt-tick" style={{ left: pct(tick) }}>
              {tick === 0 ? t('0 с', '0 s') : tick}
            </span>
          ))}
          <span class="lt-knob" style={{ left: pct(head) }} />
        </div>
      </div>
      {layers.length === 0 && <p class="muted lt-empty">{t('У фреймі немає шарів.', 'The frame has no layers.')}</p>}
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
              style={{ minHeight: `${Math.max(28, lanes.length * LANE + 10)}px` }}
              onClick={() => props.onSelect(layer.id)}
              title={lost ? t('Шар увійшов у растрове зображення батьківського шару, тому його анімація не застосується', 'The layer became part of its parent’s raster image, so its animation will not apply') : layer.name}
            >
              <span class="lt-name" style={{ paddingLeft: `${layer.depth * 10}px` }}>
                <span class="lt-icon">{TYPE_ICONS[layer.type] ?? '•'}</span>
                <span class="lt-label">{layer.name}</span>
                {anim?.hover && <span class="lt-hover" title={t('Є hover-ефект', 'Has a hover effect')} />}
                {lost && <span class="badge warn">{t('растр', 'raster')}</span>}
              </span>
              <div class="lt-track">
                {bars.map((bar) => (
                  <span
                    class={`lt-bar ${bar.kind}`}
                    style={{
                      left: pct(bar.start),
                      width: `max(4px, ${pct(bar.end - bar.start)})`,
                      top: lanes.length === 1 ? `calc(50% - ${(LANE - 2) / 2}px)` : `${5 + lanes.indexOf(bar.kind) * LANE}px`,
                      height: `${LANE - 2}px`,
                    }}
                    title={`${barTitle(bar.kind)} (${round(bar.start)}–${round(bar.end)} ${t('с', 's')})`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => onDown(e, layer.id, bar.kind, anim!)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  />
                ))}
                {maxDuration !== null && maxDuration < span && <span class="lt-limit" style={{ left: pct(maxDuration) }} />}
                <span class="lt-playhead" style={{ left: pct(head) }} />
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
      return t(`Затримка ${a.intro?.delay ?? 0} с`, `Delay ${a.intro?.delay ?? 0} s`);
    case 'custom':
      return t(`Старт ${a.custom?.delay ?? 0} с`, `Start ${a.custom?.delay ?? 0} s`);
    case 'loop':
      return t(`Після появи ${a.loop?.delay ?? 0} с`, `After intro ${a.loop?.delay ?? 0} s`);
    case 'outro':
      return t(`Зникнення ${a.outro?.at ?? 0} с`, `Outro at ${a.outro?.at ?? 0} s`);
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
