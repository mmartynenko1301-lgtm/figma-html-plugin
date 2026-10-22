import type { CustomAnim, Easing, Keyframe } from '../shared/anim';
import { EASINGS, defaultCustom, defaultKeyframe } from '../shared/anim';
import { EASING_LABELS } from './labels';

const COLUMNS: { key: keyof Keyframe; label: string; step: number; min?: number; max?: number }[] = [
  { key: 'at', label: '%', step: 5, min: 0, max: 100 },
  { key: 'x', label: 'X', step: 2 },
  { key: 'y', label: 'Y', step: 2 },
  { key: 'scale', label: 'Масштаб', step: 0.05, min: 0 },
  { key: 'rotate', label: 'Поворот', step: 5 },
  { key: 'opacity', label: 'Прозорість', step: 0.1, min: 0, max: 1 },
];

/** Editor for a layer's own keyframe animation: timing plus a table of keyframes. */
export function CustomEditor(props: { value: CustomAnim | null; onChange: (custom: CustomAnim | null) => void }) {
  const custom = props.value;
  const set = (patch: Partial<CustomAnim>) => props.onChange({ ...custom!, ...patch });
  const setFrame = (i: number, patch: Partial<Keyframe>) => set({ keyframes: custom!.keyframes.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const sortFrames = () => set({ keyframes: [...custom!.keyframes].sort((a, b) => a.at - b.at) });

  return (
    <fieldset>
      <legend>Власні ключові кадри</legend>
      <label class="check">
        <input type="checkbox" checked={!!custom} onChange={(e) => props.onChange(e.currentTarget.checked ? defaultCustom() : null)} />
        Увімкнути
      </label>
      {custom && (
        <>
          <div class="grid">
            <Num label="Старт, с" value={custom.delay} step={0.1} min={0} onChange={(v) => set({ delay: v })} />
            <Num label="Тривалість циклу, с" value={custom.duration} step={0.1} min={0.05} onChange={(v) => set({ duration: v })} />
            <label>
              Easing між кадрами
              <select value={custom.easing} onChange={(e) => set({ easing: e.currentTarget.value as Easing })}>
                {EASINGS.map((ez) => (
                  <option value={ez}>{EASING_LABELS[ez]}</option>
                ))}
              </select>
            </label>
            <Num label="Повторів (0 = до ліміту)" value={custom.repeat} step={1} min={0} onChange={(v) => set({ repeat: Math.round(v) })} />
          </div>
          <table class="keyframes">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th>{c.label}</th>
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
                    <button class="link" title="Видалити кадр" disabled={custom.keyframes.length <= 1} onClick={() => set({ keyframes: custom.keyframes.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button class="link" onClick={() => set({ keyframes: withNewFrame(custom.keyframes) })}>
            + Додати кадр
          </button>
          <p class="muted small">X, Y, масштаб і поворот рахуються від положення шару в макеті. Кадр 100% із нулями повертає шар на місце.</p>
        </>
      )}
    </fieldset>
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

function Num(props: { label: string; value: number; step: number; min: number; onChange: (v: number) => void }) {
  return (
    <label>
      {props.label}
      <input
        type="number"
        value={props.value}
        step={props.step}
        min={props.min}
        onInput={(e) => {
          const v = parseFloat(e.currentTarget.value);
          if (Number.isFinite(v) && v >= props.min) props.onChange(v);
        }}
      />
    </label>
  );
}
