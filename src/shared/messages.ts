import type { BannerSettings, LayerAnim } from './anim';
import type { Banner } from './ir';

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
      /** Banner frame that contains the current selection, if any. */
      frame: FrameInfo | null;
      layers: LayerInfo[];
      settings: BannerSettings | null;
      /** Layer selected on the canvas inside that frame. */
      selectedLayerId: string | null;
    }
  | { type: 'banner'; purpose: 'preview' | 'export'; banner: Banner; warnings: string[]; backup: Uint8Array | null }
  | { type: 'error'; message: string };

/** UI → main thread. */
export type UiMessage =
  | { type: 'build'; frameId: string; purpose: 'preview' | 'export' }
  | { type: 'set-anim'; nodeId: string; anim: LayerAnim | null }
  | { type: 'set-settings'; frameId: string; settings: BannerSettings }
  | { type: 'select-layer'; nodeId: string }
  | { type: 'close' };
