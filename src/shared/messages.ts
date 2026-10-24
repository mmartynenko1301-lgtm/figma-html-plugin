import type { BannerSettings, LayerAnim, Preset, PresetScope } from './anim';
import type { Banner } from './ir';
import type { Lang } from './i18n';

export interface FrameInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface LayerInfo {
  id: string;
  name: string;
  type: NodeType;
  depth: number;
  anim: LayerAnim | null;
}

/** Main thread → UI. */
export type MainMessage =
  | {
      type: 'state';
      /** Banner frame that contains the first selected node, if any; the one being edited. */
      frame: FrameInfo | null;
      /** Every banner frame touched by the selection, for batch export. */
      frames: FrameInfo[];
      layers: LayerInfo[];
      settings: BannerSettings | null;
      /** Layers selected on the canvas inside that frame; the first one is edited. */
      selectedLayerIds: string[];
    }
  | {
      type: 'banner';
      purpose: BuildPurpose;
      banner: Banner;
      warnings: string[];
      /** Animations stored on the frame's layers, by layer id. */
      anims: Record<string, LayerAnim>;
      backup: Uint8Array | null;
    }
  | { type: 'presets'; file: Preset[]; mine: Preset[] }
  /** Interface language saved for this user. */
  | { type: 'lang'; lang: Lang }
  | { type: 'error'; message: string };

export type BuildPurpose = 'preview' | 'export';

/** UI → main thread. */
export type UiMessage =
  /** `backup` asks for a static image of the frame: JPG, or PNG for the UI to convert. */
  | { type: 'build'; frameId: string; purpose: BuildPurpose; backup: 'jpg' | 'png' | null }
  | { type: 'set-anim'; nodeId: string; anim: LayerAnim | null }
  | { type: 'set-settings'; frameId: string; settings: BannerSettings }
  | { type: 'select-layer'; nodeId: string }
  /** Adds presets to a scope; a preset with an existing id or name replaces it. */
  | { type: 'save-presets'; scope: PresetScope; presets: Preset[] }
  | { type: 'delete-preset'; scope: PresetScope; id: string }
  /** Resizes the plugin window; the size is remembered for next time. */
  | { type: 'resize'; width: number; height: number }
  | { type: 'set-lang'; lang: Lang }
  | { type: 'close' };
