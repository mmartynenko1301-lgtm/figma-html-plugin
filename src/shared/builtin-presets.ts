import type { Preset } from './anim';
import { defaultCustom, defaultHover, defaultIntro, defaultKeyframe, defaultLoop, emptyAnim } from './anim';

/** Starter presets for typical banner layers; always available and not editable. */
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'builtin-headline-words',
    name: 'Заголовок: по словах',
    anim: { ...emptyAnim(), intro: { ...defaultIntro('wordsUp'), delay: 0.2 } },
  },
  {
    id: 'builtin-subtitle-slide',
    name: 'Підзаголовок: виїзд знизу',
    anim: { ...emptyAnim(), intro: { ...defaultIntro('slideUp'), delay: 0.6 } },
  },
  {
    id: 'builtin-cta-pulse',
    name: 'Кнопка: поява + пульс + hover',
    anim: {
      ...emptyAnim(),
      intro: { ...defaultIntro('scaleIn'), delay: 1, easing: 'easeOutBack' },
      loop: defaultLoop('pulse'),
      hover: defaultHover('grow'),
    },
  },
  {
    id: 'builtin-cta-shine',
    name: 'Кнопка: відблиск + hover',
    anim: { ...emptyAnim(), intro: { ...defaultIntro('fadeIn'), delay: 1 }, loop: defaultLoop('shine'), hover: defaultHover('brighten') },
  },
  {
    id: 'builtin-logo-fade',
    name: 'Логотип: проявлення',
    anim: { ...emptyAnim(), intro: { ...defaultIntro('fadeIn'), delay: 1.4, duration: 0.8 } },
  },
  {
    id: 'builtin-bg-zoom',
    name: 'Фон: повільне наближення',
    anim: {
      ...emptyAnim(),
      custom: { ...defaultCustom(), duration: 6, easing: 'easeOut', keyframes: [{ ...defaultKeyframe(0), scale: 1.12 }, defaultKeyframe(100)] },
    },
  },
];
