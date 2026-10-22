// Animation settings stored on Figma nodes (pluginData "anim") and on the banner
// frame (pluginData "banner"). Every stored object carries `v` so later versions
// can migrate old files.

export const INTRO_PRESETS = [
  'fadeIn',
  'slideUp',
  'slideDown',
  'slideLeft',
  'slideRight',
  'scaleIn',
  'zoomOut',
  'revealRight',
  'revealUp',
  'wordsUp',
  'lettersFade',
] as const;
/** Intro presets that animate a text layer word by word or letter by letter. */
export const SPLIT_PRESETS = ['wordsUp', 'lettersFade'] as const;
export const LOOP_PRESETS = ['pulse', 'shake', 'bounce', 'float', 'wiggle', 'shine'] as const;
export const OUTRO_PRESETS = ['fadeOut', 'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight', 'zoomAway'] as const;
export const HOVER_PRESETS = ['grow', 'lift', 'brighten', 'shrink'] as const;
export const EASINGS = ['easeOut', 'easeOutCubic', 'easeOutBack', 'easeInOut', 'easeIn', 'linear'] as const;

export type IntroPreset = (typeof INTRO_PRESETS)[number];
export type LoopPreset = (typeof LOOP_PRESETS)[number];
export type HoverPreset = (typeof HOVER_PRESETS)[number];
export type OutroPreset = (typeof OUTRO_PRESETS)[number];
export type Easing = (typeof EASINGS)[number];

export interface IntroAnim {
  preset: IntroPreset;
  delay: number; // s from banner start
  duration: number; // s
  easing: Easing;
  /** Slide distance in px, or start scale for scaleIn / zoomOut. */
  amount: number;
  /** Seconds between words or letters for split-text presets. */
  stagger: number;
}

export interface LoopAnim {
  preset: LoopPreset;
  /** Seconds after the intro ends (or after banner start without an intro). */
  delay: number;
  duration: number; // s of motion per cycle
  pause: number; // s of rest between cycles
  /** Scale for pulse, px for shake / bounce / float, degrees for wiggle, highlight opacity for shine. */
  amount: number;
}

export interface HoverAnim {
  preset: HoverPreset;
  duration: number; // s
  /** Scale for grow / shrink, px for lift, brightness for brighten. */
  amount: number;
  trigger: 'banner' | 'layer';
}

export interface OutroAnim {
  preset: OutroPreset;
  /** Seconds from banner start. */
  at: number;
  duration: number;
  easing: Easing;
  /** Slide distance in px, or end scale for zoomAway. */
  amount: number;
}

/** One step of a custom animation; values are offsets from the layer as drawn. */
export interface Keyframe {
  /** Percent of the cycle, 0..100. */
  at: number;
  x: number; // px
  y: number; // px
  scale: number;
  rotate: number; // degrees
  opacity: number; // 0..1
}

export interface CustomAnim {
  /** Seconds from banner start. */
  delay: number;
  /** Seconds per cycle. */
  duration: number;
  easing: Easing;
  /** Number of cycles; 0 repeats until the network time limit. */
  repeat: number;
  keyframes: Keyframe[];
}

export interface LayerAnim {
  v: 1;
  intro: IntroAnim | null;
  loop: LoopAnim | null;
  hover: HoverAnim | null;
  outro: OutroAnim | null;
  custom: CustomAnim | null;
}

export type NetworkId = 'google-ads' | 'google-dv' | 'adform' | 'admixer' | 'iab' | 'none';

export interface BannerSettings {
  v: 1;
  clickTag: string;
  network: NetworkId;
  backup: boolean;
  /** Shrink images on export until the ZIP fits the network's size limit. */
  optimize: boolean;
}

export const DEFAULT_SETTINGS: BannerSettings = { v: 1, clickTag: 'https://example.com', network: 'google-ads', backup: true, optimize: true };

export function defaultIntro(preset: IntroPreset): IntroAnim {
  const amount = preset === 'scaleIn' ? 0.6 : preset === 'zoomOut' ? 1.4 : preset === 'wordsUp' ? 16 : 24;
  const stagger = preset === 'lettersFade' ? 0.03 : 0.08;
  return { preset, delay: 0, duration: 0.6, easing: 'easeOutCubic', amount, stagger };
}

export function isSplitPreset(preset: IntroPreset): boolean {
  return (SPLIT_PRESETS as readonly string[]).includes(preset);
}

export function defaultLoop(preset: LoopPreset): LoopAnim {
  const amount = { pulse: 1.08, shake: 4, bounce: 8, float: 6, wiggle: 6, shine: 0.5 }[preset];
  const duration = preset === 'float' ? 2.4 : preset === 'pulse' ? 1 : preset === 'shine' ? 0.8 : 0.6;
  const pause = preset === 'float' ? 0 : preset === 'shine' ? 2 : 1.5;
  return { preset, delay: 0.5, duration, pause, amount };
}

export function defaultHover(preset: HoverPreset): HoverAnim {
  const amount = { grow: 1.06, shrink: 0.95, lift: 3, brighten: 1.15 }[preset];
  return { preset, duration: 0.2, amount, trigger: 'banner' };
}

export function defaultOutro(preset: OutroPreset): OutroAnim {
  return { preset, at: 5, duration: 0.5, easing: 'easeIn', amount: preset === 'zoomAway' ? 0.6 : 24 };
}

export function defaultKeyframe(at: number): Keyframe {
  return { at, x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
}

export function defaultCustom(): CustomAnim {
  return {
    delay: 0,
    duration: 1,
    easing: 'easeInOut',
    repeat: 1,
    keyframes: [{ ...defaultKeyframe(0), y: 20, opacity: 0 }, { ...defaultKeyframe(60), y: -4 }, defaultKeyframe(100)],
  };
}

export function emptyAnim(): LayerAnim {
  return { v: 1, intro: null, loop: null, hover: null, outro: null, custom: null };
}

export function isEmptyAnim(anim: LayerAnim | null | undefined): boolean {
  return !anim || (!anim.intro && !anim.loop && !anim.hover && !anim.outro && !anim.custom);
}

/** Reads stored JSON defensively: unknown presets or broken data are dropped, not thrown. */
export function parseAnim(json: string): LayerAnim | null {
  const raw = parseJson(json);
  if (!raw || raw.v !== 1) return null;
  const anim: LayerAnim = {
    v: 1,
    intro: isPreset(raw.intro, INTRO_PRESETS)
      ? { ...defaultIntro(raw.intro.preset), ...pickNumbers(raw.intro, ['delay', 'duration', 'amount', 'stagger']), easing: pickEasing(raw.intro) }
      : null,
    loop: isPreset(raw.loop, LOOP_PRESETS) ? { ...defaultLoop(raw.loop.preset), ...pickNumbers(raw.loop, ['delay', 'duration', 'pause', 'amount']) } : null,
    hover: isPreset(raw.hover, HOVER_PRESETS)
      ? { ...defaultHover(raw.hover.preset), ...pickNumbers(raw.hover, ['duration', 'amount']), trigger: raw.hover.trigger === 'layer' ? 'layer' : 'banner' }
      : null,
    // Outro and custom were added after v1 shipped; older data simply has none.
    outro: isPreset(raw.outro, OUTRO_PRESETS)
      ? { ...defaultOutro(raw.outro.preset), ...pickNumbers(raw.outro, ['at', 'duration', 'amount']), easing: pickEasing(raw.outro, 'easeIn') }
      : null,
    custom: parseCustom(raw.custom),
  };
  return isEmptyAnim(anim) ? null : anim;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCustom(raw: any): CustomAnim | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.keyframes)) return null;
  const keyframes: Keyframe[] = [];
  for (const k of raw.keyframes) {
    if (!k || typeof k !== 'object') continue;
    const num = (key: keyof Keyframe, min: number, max: number) => {
      const v = k[key];
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaultKeyframe(0)[key];
    };
    keyframes.push({
      at: num('at', 0, 100),
      x: num('x', -10000, 10000),
      y: num('y', -10000, 10000),
      scale: num('scale', 0, 100),
      rotate: num('rotate', -3600, 3600),
      opacity: num('opacity', 0, 1),
    });
  }
  if (keyframes.length === 0) return null;
  const base = defaultCustom();
  return {
    ...base,
    ...pickNumbers(raw, ['delay', 'duration', 'repeat']),
    easing: pickEasing(raw, base.easing),
    keyframes: keyframes.sort((a, b) => a.at - b.at),
  };
}

export function parseSettings(json: string): BannerSettings {
  const raw = parseJson(json);
  if (!raw || raw.v !== 1) return { ...DEFAULT_SETTINGS };
  const networks: NetworkId[] = ['google-ads', 'google-dv', 'adform', 'admixer', 'iab', 'none'];
  return {
    v: 1,
    clickTag: typeof raw.clickTag === 'string' ? raw.clickTag : DEFAULT_SETTINGS.clickTag,
    network: networks.includes(raw.network) ? raw.network : DEFAULT_SETTINGS.network,
    backup: typeof raw.backup === 'boolean' ? raw.backup : DEFAULT_SETTINGS.backup,
    optimize: typeof raw.optimize === 'boolean' ? raw.optimize : DEFAULT_SETTINGS.optimize,
  };
}

/** A named animation the team can apply to any layer. */
export interface Preset {
  id: string;
  name: string;
  anim: LayerAnim;
}

/** Where a preset lives: in the Figma file (shared with everyone in it) or on this computer. */
export type PresetScope = 'file' | 'mine';

/** Reads a stored or imported preset list; broken entries are dropped. */
export function parsePresets(json: string): Preset[] {
  const raw = parseJson(json);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.presets) ? raw.presets : [];
  const out: Preset[] = [];
  for (const item of list) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) continue;
    const anim = parseAnim(JSON.stringify(item.anim));
    if (!anim) continue;
    const id = typeof item.id === 'string' && item.id ? item.id : `p${Date.now().toString(36)}${out.length}`;
    out.push({ id, name: item.name.trim().slice(0, 60), anim });
  }
  return out;
}

/**
 * End of the intro in seconds (0 without one). Split-text intros end later by
 * stagger × (pieces − 1); `pieces` is known only when the text is rendered.
 */
export function introEnd(anim: LayerAnim, pieces = 1): number {
  if (!anim.intro) return 0;
  const spread = isSplitPreset(anim.intro.preset) ? anim.intro.stagger * Math.max(0, pieces - 1) : 0;
  return anim.intro.delay + spread + anim.intro.duration;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(json: string): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPreset<T extends readonly string[]>(value: any, presets: T): value is { preset: T[number] } & Record<string, unknown> {
  return !!value && typeof value === 'object' && presets.includes(value.preset);
}

function pickNumbers(raw: Record<string, unknown>, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

function pickEasing(raw: Record<string, unknown>, fallback: Easing = 'easeOutCubic'): Easing {
  return (EASINGS as readonly string[]).includes(raw.easing as string) ? (raw.easing as Easing) : fallback;
}
