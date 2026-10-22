import type { Easing, HoverPreset, IntroPreset, LoopPreset } from '../shared/anim';

export const INTRO_LABELS: Record<IntroPreset, string> = {
  fadeIn: 'Проявлення',
  slideUp: 'Виїзд знизу',
  slideDown: 'Виїзд згори',
  slideLeft: 'Виїзд справа',
  slideRight: 'Виїзд зліва',
  scaleIn: 'Збільшення',
  zoomOut: 'Зменшення',
};

export const LOOP_LABELS: Record<LoopPreset, string> = {
  pulse: 'Пульсація',
  shake: 'Тремтіння',
  bounce: 'Підстрибування',
  float: 'Плавання',
  wiggle: 'Похитування',
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
  if (preset === 'fadeIn') return null;
  return preset === 'scaleIn' || preset === 'zoomOut' ? 'Початковий масштаб' : 'Відстань, px';
}

export function loopAmountLabel(preset: LoopPreset): string {
  return { pulse: 'Масштаб', shake: 'Амплітуда, px', bounce: 'Висота, px', float: 'Висота, px', wiggle: 'Кут, °' }[preset];
}

export function hoverAmountLabel(preset: HoverPreset): string {
  return { grow: 'Масштаб', shrink: 'Масштаб', lift: 'Висота, px', brighten: 'Яскравість' }[preset];
}
