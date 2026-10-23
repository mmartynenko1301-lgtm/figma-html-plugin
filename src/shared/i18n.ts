// Interface language. Each text is written in place as t('українською', 'in English'),
// so both versions stay side by side and a new string cannot miss its translation.
// The main thread and the UI each hold their own copy of the current language.

export type Lang = 'uk' | 'en';

let current: Lang = 'uk';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function isLang(v: unknown): v is Lang {
  return v === 'uk' || v === 'en';
}

export function t(uk: string, en: string): string {
  return current === 'en' ? en : uk;
}
