import type { Easing, HoverPreset, IntroPreset, LoopPreset, OutroPreset } from '../shared/anim';
import { t } from '../shared/i18n';

type Texts = readonly [uk: string, en: string];

function tr(texts: Texts): string {
  return t(texts[0], texts[1]);
}

/** A label map whose values follow the current interface language. */
function localized<K extends string>(texts: Record<K, Texts>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(texts) as K[]) {
    Object.defineProperty(out, key, { enumerable: true, get: () => tr(texts[key]) });
  }
  return out;
}

export const INTRO_LABELS = localized<IntroPreset>({
  fadeIn: ['Проявлення', 'Fade in'],
  slideUp: ['Виїзд знизу', 'Slide up'],
  slideDown: ['Виїзд згори', 'Slide down'],
  slideLeft: ['Виїзд справа', 'Slide in from right'],
  slideRight: ['Виїзд зліва', 'Slide in from left'],
  scaleIn: ['Збільшення', 'Scale up'],
  zoomOut: ['Зменшення', 'Scale down'],
  revealRight: ['Відкриття зліва направо', 'Wipe left to right'],
  revealUp: ['Відкриття знизу вгору', 'Wipe bottom to top'],
  wordsUp: ['Текст по словах', 'Text word by word'],
  lettersFade: ['Текст по літерах', 'Text letter by letter'],
});

export const LOOP_LABELS = localized<LoopPreset>({
  pulse: ['Пульсація', 'Pulse'],
  shake: ['Тремтіння', 'Shake'],
  bounce: ['Підстрибування', 'Bounce'],
  float: ['Плавання', 'Float'],
  wiggle: ['Похитування', 'Wiggle'],
  shine: ['Відблиск', 'Shine'],
});

export const OUTRO_LABELS = localized<OutroPreset>({
  fadeOut: ['Зникнення', 'Fade out'],
  slideOutUp: ['Виїзд угору', 'Slide out up'],
  slideOutDown: ['Виїзд униз', 'Slide out down'],
  slideOutLeft: ['Виїзд ліворуч', 'Slide out left'],
  slideOutRight: ['Виїзд праворуч', 'Slide out right'],
  zoomAway: ['Зменшення до зникнення', 'Shrink away'],
});

export const HOVER_LABELS = localized<HoverPreset>({
  grow: ['Збільшення', 'Grow'],
  shrink: ['Зменшення', 'Shrink'],
  lift: ['Підйом', 'Lift'],
  brighten: ['Яскравість', 'Brighten'],
});

export const EASING_LABELS = localized<Easing>({
  easeOut: ['Плавне гальмування', 'Ease out'],
  easeOutCubic: ['Гальмування (cubic)', 'Ease out (cubic)'],
  easeOutBack: ['З віддачею', 'Back out'],
  easeInOut: ['Плавно на старті й фініші', 'Ease in-out'],
  easeIn: ['Розгін', 'Ease in'],
  linear: ['Лінійно', 'Linear'],
});

const DISTANCE: Texts = ['Відстань, px', 'Distance, px'];
const SCALE: Texts = ['Масштаб', 'Scale'];
const HEIGHT: Texts = ['Висота, px', 'Height, px'];

export function introAmountLabel(preset: IntroPreset): string | null {
  if (preset === 'fadeIn' || preset === 'lettersFade' || preset.startsWith('reveal')) return null;
  return tr(preset === 'scaleIn' || preset === 'zoomOut' ? ['Початковий масштаб', 'Start scale'] : DISTANCE);
}

export function loopAmountLabel(preset: LoopPreset): string {
  const texts: Record<LoopPreset, Texts> = {
    pulse: SCALE,
    shake: ['Амплітуда, px', 'Amplitude, px'],
    bounce: HEIGHT,
    float: HEIGHT,
    wiggle: ['Кут, °', 'Angle, °'],
    shine: ['Яскравість відблиску', 'Shine strength'],
  };
  return tr(texts[preset]);
}

export function hoverAmountLabel(preset: HoverPreset): string {
  const texts: Record<HoverPreset, Texts> = { grow: SCALE, shrink: SCALE, lift: HEIGHT, brighten: ['Яскравість', 'Brightness'] };
  return tr(texts[preset]);
}

export function outroAmountLabel(preset: OutroPreset): string | null {
  if (preset === 'fadeOut') return null;
  return tr(preset === 'zoomAway' ? ['Кінцевий масштаб', 'End scale'] : DISTANCE);
}
