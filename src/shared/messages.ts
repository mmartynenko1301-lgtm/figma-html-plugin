import type { Banner } from './ir';

export interface SelectionInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** Main thread → UI. */
export type MainMessage =
  | { type: 'selection'; frames: SelectionInfo[] }
  | { type: 'banner'; banner: Banner; warnings: string[] }
  | { type: 'error'; message: string };

/** UI → main thread. */
export type UiMessage = { type: 'export'; frameId: string } | { type: 'close' };
