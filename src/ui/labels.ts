import type { Easing, HoverPreset, IntroPreset, LoopPreset, OutroPreset } from '../shared/anim';

export const INTRO_LABELS: Record<IntroPreset, string> = {
  fadeIn: 'Проявлення',
  slideUp: 'Виїзд знизу',
  slideDown: 'Виїзд згори',
  slideLeft: 'Виїзд справа',
  slideRight: 'Виїзд зліва',
  scaleIn: 'Збільшення',
  zoomOut: 'Зменшення',
  revealRight: 'Відкриття зліва направо',
  revealUp: 'Відкриття знизу вгору',
  wordsUp: 'Текст по словах',
  lettersFade: 'Текст по літерах',
};

export const LOOP_LABELS: Record<LoopPreset, string> = {
  pulse: 'Пульсація',
  shake: 'Тремтіння',
  bounce: 'Підстрибування',
  float: 'Плавання',
  wiggle: 'Похитування',
  shine: 'Відблиск',
};

export const OUTRO_LABELS: Record<OutroPreset, string> = {
  fadeOut: 'Зникнення',
  slideOutUp: 'Виїзд угору',
  slideOutDown: 'Виїзд униз',
  slideOutLeft: 'Виїзд ліворуч',
  slideOutRight: 'Виїзд праворуч',
  zoomAway: 'Зменшення до зникнення',
};

export const HOVER_LABELS: Record<HoverPreset, string> = {
  grow: 'Збільшення',
  shrink: 'Зменшення',
  lift: 'Підйом',
  brighten: 'Яскравість',
};

export const EASING_LABELS: Record<Easing, string> = {
  easeOut: 'Плавне гальмування',
  easeOutCubic: 'Гальмування (cubic)',
  easeOutBack: 'З віддачею',
  easeInOut: 'Плавно на старті й фініші',
  easeIn: 'Розгін',
  linear: 'Лінійно',
};

export function introAmountLabel(preset: IntroPreset): string | null {
  if (preset === 'fadeIn' || preset === 'lettersFade' || preset.startsWith('reveal')) return null;
  return preset === 'scaleIn' || preset === 'zoomOut' ? 'Початковий масштаб' : 'Відстань, px';
}

export function loopAmountLabel(preset: LoopPreset): string {
  return { pulse: 'Масштаб', shake: 'Амплітуда, px', bounce: 'Висота, px', float: 'Висота, px', wiggle: 'Кут, °', shine: 'Яскравість відблиску' }[preset];
}

export function hoverAmountLabel(preset: HoverPreset): string {
  return { grow: 'Масштаб', shrink: 'Масштаб', lift: 'Висота, px', brighten: 'Яскравість' }[preset];
}

export function outroAmountLabel(preset: OutroPreset): string | null {
  if (preset === 'fadeOut') return null;
  return preset === 'zoomAway' ? 'Кінцевий масштаб' : 'Відстань, px';
}
