import { useRef } from 'preact/hooks';
import type { Easing } from '../shared/anim';
import { EASINGS } from '../shared/anim';
import { EASING_LABELS } from './labels';
import { t } from '../shared/i18n';

export function EasingField(props: { value: Easing; onChange: (e: Easing) => void; label?: string }) {
  return (
    <label>
      {props.label ?? 'Easing'}
      <select value={props.value} onChange={(e) => props.onChange(e.currentTarget.value as Easing)}>
        {EASINGS.map((ez) => (
          <option value={ez}>{EASING_LABELS[ez]}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * A number input whose label can be dragged left or right to change the value,
 * like Figma's own fields: one step per 4 px.
 */
export function NumberField(props: { label: string; value: number; step: number; min?: number; max?: number; onChange: (v: number) => void }) {
  const { step } = props;
  const min = props.min ?? 0;
  const max = props.max ?? Infinity;
  const scrub = useRef<{ x: number; value: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const tidy = (v: number) => Math.round(v * 1000) / 1000;

  return (
    <label>
      <span
        class="scrub"
        title={t('Тягніть ліворуч або праворуч, щоб змінити', 'Drag left or right to change')}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, value: props.value };
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s) return;
          const next = tidy(clamp(s.value + Math.round((e.clientX - s.x) / 4) * step));
          if (next !== props.value) props.onChange(next);
        }}
        onPointerUp={() => (scrub.current = null)}
        onPointerCancel={() => (scrub.current = null)}
      >
        {props.label}
      </span>
      <input
        type="number"
        value={props.value}
        step={step}
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        onInput={(e) => {
          const v = parseFloat(e.currentTarget.value);
          if (Number.isFinite(v) && v >= min && v <= max) props.onChange(v);
        }}
      />
    </label>
  );
}
