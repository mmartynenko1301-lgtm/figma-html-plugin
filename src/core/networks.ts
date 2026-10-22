import type { NetworkId } from '../shared/anim';

/** How the banner is packaged and how clicks reach the network. */
export type Platform = 'standard' | 'adform' | 'admixer';

export interface NetworkProfile {
  id: NetworkId;
  label: string;
  platform: Platform;
  /** ZIP size limit in KB, or null when the network sets none. */
  maxKb: number | null;
  maxFiles: number | null;
  /** Longest allowed animation in seconds; loops are cut to fit. Null = no limit. */
  maxDuration: number | null;
  /** Allowed banner sizes as "WxH", or null for any size. */
  sizes: string[] | null;
  note: string;
}

// Google Ads: https://support.google.com/google-ads/answer/1722096
const GOOGLE_ADS_SIZES = [
  '200x200', '240x400', '250x250', '250x360', '300x250', '336x280', '580x400',
  '120x600', '160x600', '300x600', '300x1050',
  '468x60', '728x90', '930x180', '970x90', '970x250', '980x120',
  '300x50', '320x50', '320x100',
];

export const NETWORKS: Record<NetworkId, NetworkProfile> = {
  'google-ads': {
    id: 'google-ads',
    label: 'Google Ads',
    platform: 'standard',
    maxKb: 600,
    maxFiles: 40,
    maxDuration: 30,
    sizes: GOOGLE_ADS_SIZES,
    note: 'Посилання задається в кабінеті Google Ads; clickTag у файлі лишається як запасний.',
  },
  'google-dv': {
    id: 'google-dv',
    label: 'Google Ad Manager / CM360 / DV360',
    platform: 'standard',
    maxKb: 150,
    maxFiles: null,
    maxDuration: 30,
    sizes: null,
    note: 'Мережа підставляє clickTag сама. Ліміт 150 KB — типовий для початкового завантаження; уточніть у медіаплані.',
  },
  // https://support.adform.com/documentation/coty-manuals-old/building-banners-for-use-in-adform/manually-creating-manifestjson/
  adform: {
    id: 'adform',
    label: 'Adform',
    platform: 'adform',
    maxKb: null,
    maxFiles: null,
    maxDuration: 30,
    sizes: null,
    note: 'У ZIP додається manifest.json, клік іде через clickTAG з Adform.DHTML.js. Ліміт ваги задає майданчик; Adform рахує вагу розпакованих файлів.',
  },
  // https://helpcenter.admixer.com/overview/standard-api-2-0-html5
  admixer: {
    id: 'admixer',
    label: 'Admixer',
    platform: 'admixer',
    maxKb: 300,
    maxFiles: null,
    maxDuration: 30,
    sizes: null,
    note: 'Головний файл — body.html, клік іде через globalHTML5Api.click(), посилання задається в кабінеті Admixer. Ліміт 300 KB взято з довідки Admixer, уточніть для вашої кампанії.',
  },
  iab: {
    id: 'iab',
    label: 'IAB (загальний)',
    platform: 'standard',
    maxKb: 150,
    maxFiles: null,
    maxDuration: 30,
    sizes: null,
    note: 'Типові вимоги IAB; конкретний майданчик може мати свої.',
  },
  none: {
    id: 'none',
    label: 'Без обмежень',
    platform: 'standard',
    maxKb: null,
    maxFiles: null,
    maxDuration: null,
    sizes: null,
    note: 'Для сайту, превʼю або тестів. Циклічні анімації тривають нескінченно.',
  },
};

export interface ValidationInput {
  width: number;
  height: number;
  zipBytes: number;
  fileCount: number;
}

/** Problems that would make the network reject the banner, in Ukrainian for the UI. */
export function validate(network: NetworkProfile, input: ValidationInput): string[] {
  const problems: string[] = [];
  const kb = input.zipBytes / 1024;
  if (network.maxKb !== null && kb > network.maxKb) {
    problems.push(`ZIP важить ${kb.toFixed(1)} KB, а ${network.label} дозволяє до ${network.maxKb} KB.`);
  }
  if (network.maxFiles !== null && input.fileCount > network.maxFiles) {
    problems.push(`У ZIP ${input.fileCount} файлів, а ${network.label} дозволяє до ${network.maxFiles}.`);
  }
  const size = `${Math.round(input.width)}x${Math.round(input.height)}`;
  if (network.sizes && !network.sizes.includes(size)) {
    problems.push(`Розмір ${size.replace('x', '×')} не входить до дозволених розмірів ${network.label}.`);
  }
  return problems;
}
