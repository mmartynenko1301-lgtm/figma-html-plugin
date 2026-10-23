import type { CustomAnim, Keyframe } from '../shared/anim';
import { defaultKeyframe } from '../shared/anim';
import { EasingField, NumberField } from './fields';
import { t } from '../shared/i18n';

const COLUMNS: { key: keyof Keyframe; label: [string, string]; title: [string, string]; step: number; min?: number; max?: number }[] = [
  { key: 'at', label: ['%', '%'], title: ['Момент циклу, %', 'Point in the cycle, %'], step: 5, min: 0, max: 100 },
  { key: 'x', label: ['X', 'X'], title: ['Зсув по X, px', 'X offset, px'], step: 2 },
  { key: 'y', label: ['Y', 'Y'], title: ['Зсув по Y, px', 'Y offset, px'], step: 2 },
  { key: 'scale', label: ['Масшт.', 'Scale'], title: ['Масштаб', 'Scale'], step: 0.05, min: 0 },
  { key: 'rotate', label: ['Кут', 'Rot.'], title: ['Поворот, °', 'Rotation, °'], step: 5 },
  { key: 'opacity', label: ['Непрозор.', 'Opacity'], title: ['Непрозорість, 0–1', 'Opacity, 0–1'], step: 0.1, min: 0, max: 1 },
];

/** Timing and the table of keyframes for a layer's own keyframe animation. */
export function KeyframesBody(props: { value: CustomAnim; onChange: (custom: CustomAnim) => void }) {
  const custom = props.value;
  const set = (patch: Partial<CustomAnim>) => props.onChange({ ...custom, ...patch });
  const setFrame = (i: number, patch: Partial<Keyframe>) => set({ keyframes: custom.keyframes.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const sortFrames = () => set({ keyframes: [...custom.keyframes].sort((a, b) => a.at - b.at) });

  return (
    <>
      <div class="grid">
        <NumberField label={t('Старт, с', 'Start, s')} value={custom.delay} step={0.1} onChange={(v) => set({ delay: v })} />
        <NumberField label={t('Цикл, с', 'Cycle, s')} value={custom.duration} step={0.1} min={0.05} onChange={(v) => set({ duration: v })} />
        <EasingField label={t('Easing між кадрами', 'Easing between frames')} value={custom.easing} onChange={(easing) => set({ easing })} />
        <NumberField label={t('Повторів (0 = до ліміту)', 'Repeats (0 = up to limit)')} value={custom.repeat} step={1} onChange={(v) => set({ repeat: Math.round(v) })} />
      </div>
      <table class="keyframes">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th title={t(...c.title)}>{t(...c.label)}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {custom.keyframes.map((k, i) => (
            <tr>
              {COLUMNS.map((c) => (
                <td>
                  <input
                    type="number"
                    value={k[c.key]}
                    step={c.step}
                    min={c.min}
                    max={c.max}
                    onInput={(e) => {
                      const v = parseFloat(e.currentTarget.value);
                      if (!Number.isFinite(v)) return;
                      setFrame(i, { [c.key]: Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, v)) });
                    }}
                    onBlur={c.key === 'at' ? sortFrames : undefined}
                  />
                </td>
              ))}
              <td>
                <button class="icon" title={t('Видалити кадр', 'Delete frame')} disabled={custom.keyframes.length <= 1} onClick={() => set({ keyframes: custom.keyframes.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="row between">
        <button class="link" onClick={() => set({ keyframes: withNewFrame(custom.keyframes) })}>
          + {t('Додати кадр', 'Add frame')}
        </button>
        <span class="muted small">{t('Значення — зсув від макета', 'Values are offsets from the layout')}</span>
      </div>
    </>
  );
}

/** Adds a keyframe at 100% if missing, otherwise in the middle of the widest gap, copying its left neighbour. */
export function withNewFrame(frames: Keyframe[]): Keyframe[] {
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return [defaultKeyframe(0)];
  const last = sorted[sorted.length - 1];
  if (last.at < 100) return [...sorted, { ...last, at: 100 }];
  if (sorted[0].at > 0) return [{ ...sorted[0], at: 0 }, ...sorted];
  let best = 0;
  for (let i = 1; i < sorted.length - 1; i++) if (sorted[i + 1].at - sorted[i].at > sorted[best + 1].at - sorted[best].at) best = i;
  const at = Math.round((sorted[best].at + sorted[best + 1].at) / 2);
  if (at === sorted[best].at) return sorted;
  return [...sorted.slice(0, best + 1), { ...sorted[best], at }, ...sorted.slice(best + 1)];
}
