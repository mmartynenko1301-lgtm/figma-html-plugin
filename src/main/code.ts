import type { BannerSettings, LayerAnim } from '../shared/anim';
import { isEmptyAnim, parseAnim, parseSettings } from '../shared/anim';
import type { FrameInfo, LayerInfo, MainMessage, UiMessage } from '../shared/messages';
import { serializeBanner } from './serialize';

type BannerFrame = FrameNode | ComponentNode | InstanceNode;

const ANIM_KEY = 'anim';
const SETTINGS_KEY = 'banner';

figma.showUI(__html__, { width: 380, height: 680, themeColors: true });

function post(message: MainMessage): void {
  figma.ui.postMessage(message);
}

function isBannerFrame(node: BaseNode | null): node is BannerFrame {
  return !!node && (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE');
}

/** The top-level frame on the page (or in a section) that contains `node`. */
function bannerFrameOf(node: SceneNode): BannerFrame | null {
  let current: BaseNode = node;
  let frame: BannerFrame | null = isBannerFrame(node) ? node : null;
  while (current.parent && current.parent.type !== 'PAGE') {
    current = current.parent;
    if (current.type === 'SECTION') break;
    if (isBannerFrame(current)) frame = current;
  }
  return frame;
}

/** Layers that can carry an animation: everything inside the frame except instance internals. */
function collectLayers(frame: BannerFrame): LayerInfo[] {
  const layers: LayerInfo[] = [];
  const walk = (node: SceneNode, depth: number) => {
    if (!node.visible) return;
    layers.push({ id: node.id, name: node.name, type: node.type, depth, anim: parseAnim(node.getPluginData(ANIM_KEY)) });
    if ('children' in node && node.type !== 'INSTANCE' && node.type !== 'BOOLEAN_OPERATION') {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  for (const child of frame.children) walk(child, 0);
  return layers;
}

function frameInfo(frame: BannerFrame): FrameInfo {
  return { id: frame.id, name: frame.name, width: Math.round(frame.width), height: Math.round(frame.height) };
}

function sendState(): void {
  const selection = figma.currentPage.selection;
  const frame = selection.length ? bannerFrameOf(selection[0]) : null;
  if (!frame) {
    post({ type: 'state', frame: null, layers: [], settings: null, selectedLayerId: null });
    return;
  }
  const selected = selection[0] !== frame ? selection[0].id : null;
  post({
    type: 'state',
    frame: frameInfo(frame),
    layers: collectLayers(frame),
    settings: parseSettings(frame.getPluginData(SETTINGS_KEY)),
    selectedLayerId: selected,
  });
}

async function build(frameId: string, purpose: 'preview' | 'export'): Promise<void> {
  const node = await figma.getNodeByIdAsync(frameId);
  if (!isBannerFrame(node)) throw new Error('Фрейм не знайдено. Виділіть його ще раз.');
  const { banner, warnings } = await serializeBanner(node);
  const settings = parseSettings(node.getPluginData(SETTINGS_KEY));
  // The backup shows the design as drawn, which is the final state of every animation.
  const backup = purpose === 'export' && settings.backup ? await node.exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: 1 } }) : null;
  post({ type: 'banner', purpose, banner, warnings, backup });
}

async function setAnim(nodeId: string, anim: LayerAnim | null): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || !('setPluginData' in node)) return;
  node.setPluginData(ANIM_KEY, isEmptyAnim(anim) ? '' : JSON.stringify(anim));
}

async function setSettings(frameId: string, settings: BannerSettings): Promise<void> {
  const node = await figma.getNodeByIdAsync(frameId);
  if (isBannerFrame(node)) node.setPluginData(SETTINGS_KEY, JSON.stringify(settings));
}

async function selectLayer(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
    figma.currentPage.selection = [node as SceneNode];
  }
}

figma.on('selectionchange', sendState);
sendState();

figma.ui.onmessage = async (msg: UiMessage) => {
  try {
    switch (msg.type) {
      case 'build':
        await build(msg.frameId, msg.purpose);
        break;
      case 'set-anim':
        await setAnim(msg.nodeId, msg.anim);
        break;
      case 'set-settings':
        await setSettings(msg.frameId, msg.settings);
        break;
      case 'select-layer':
        await selectLayer(msg.nodeId);
        break;
      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
