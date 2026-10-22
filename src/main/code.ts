import type { MainMessage, SelectionInfo, UiMessage } from '../shared/messages';
import { serializeBanner } from './serialize';

type BannerFrame = FrameNode | ComponentNode | InstanceNode;

figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

function post(message: MainMessage): void {
  figma.ui.postMessage(message);
}

function selectedFrames(): BannerFrame[] {
  return figma.currentPage.selection.filter(
    (n): n is BannerFrame => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE',
  );
}

function sendSelection(): void {
  const frames: SelectionInfo[] = selectedFrames().map((f) => ({
    id: f.id,
    name: f.name,
    width: Math.round(f.width),
    height: Math.round(f.height),
  }));
  post({ type: 'selection', frames });
}

figma.on('selectionchange', sendSelection);
sendSelection();

figma.ui.onmessage = async (msg: UiMessage) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type === 'export') {
    try {
      const node = await figma.getNodeByIdAsync(msg.frameId);
      if (!node || (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE')) {
        throw new Error('Фрейм не знайдено. Виділіть його ще раз.');
      }
      const { banner, warnings } = await serializeBanner(node);
      post({ type: 'banner', banner, warnings });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
