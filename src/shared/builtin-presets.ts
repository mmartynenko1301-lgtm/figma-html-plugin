import type { Preset } from './anim';
import { t } from './i18n';
import { defaultCustom, defaultHover, defaultIntro, defaultKeyframe, defaultLoop, emptyAnim } from './anim';

/** Starter presets for typical banner layers; always available and not editable. */
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'builtin-headline-words',
    get name() {
      return t('Заголовок: по словах', 'Headline: by words');
    },
    anim: { ...emptyAnim(), intro: { ...defaultIntro('wordsUp'), delay: 0.2 } },
  },
  {
    id: 'builtin-subtitle-slide',
    get name() {
      return t('Підзаголовок: виїзд знизу', 'Subtitle: slide up');
    },
    anim: { ...emptyAnim(), intro: { ...defaultIntro('slideUp'), delay: 0.6 } },
  },
  {
    id: 'builtin-cta-pulse',
    get name() {
      return t('Кнопка: поява + пульс + hover', 'Button: pop + pulse + hover');
    },
    anim: {
      ...emptyAnim(),
      intro: { ...defaultIntro('scaleIn'), delay: 1, easing: 'easeOutBack' },
      loop: defaultLoop('pulse'),
      hover: defaultHover('grow'),
    },
  },
  {
    id: 'builtin-cta-shine',
    get name() {
      return t('Кнопка: відблиск + hover', 'Button: shine + hover');
    },
    anim: { ...emptyAnim(), intro: { ...defaultIntro('fadeIn'), delay: 1 }, loop: defaultLoop('shine'), hover: defaultHover('brighten') },
  },
  {
    id: 'builtin-logo-fade',
    get name() {
      return t('Логотип: проявлення', 'Logo: fade in');
    },
    anim: { ...emptyAnim(), intro: { ...defaultIntro('fadeIn'), delay: 1.4, duration: 0.8 } },
  },
  {
    id: 'builtin-bg-zoom',
    get name() {
      return t('Фон: повільне наближення', 'Background: slow zoom');
    },
    anim: {
      ...emptyAnim(),
      custom: { ...defaultCustom(), duration: 6, easing: 'easeOut', keyframes: [{ ...defaultKeyframe(0), scale: 1.12 }, defaultKeyframe(100)] },
    },
  },
];
