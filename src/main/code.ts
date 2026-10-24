import type { BannerSettings, LayerAnim, Preset, PresetScope } from '../shared/anim';
import { isEmptyAnim, parseAnim, parsePresets, parseSettings } from '../shared/anim';
import type { BuildPurpose, FrameInfo, LayerInfo, MainMessage, UiMessage } from '../shared/messages';
import { serializeBanner } from './serialize';
import { isLang, setLang, t } from '../shared/i18n';

type BannerFrame = FrameNode | ComponentNode | InstanceNode;

const ANIM_KEY = 'anim';
const SETTINGS_KEY = 'banner';
const PRESETS_KEY = 'presets';

// A new key, so sizes saved for the old narrow single-column window are not reused.
const SIZE_KEY = 'size-v2';
const DEFAULT_SIZE = { width: 1120, height: 720 };

figma.showUI(__html__, { ...DEFAULT_SIZE, themeColors: true });
void figma.clientStorage.getAsync(SIZE_KEY).then((size: unknown) => {
  if (isSize(size)) figma.ui.resize(size.width, size.height);
});

const LANG_KEY = 'lang';
void figma.clientStorage.getAsync(LANG_KEY).then((lang: unknown) => {
  if (!isLang(lang)) return;
  setLang(lang);
  post({ type: 'lang', lang });
});

function isSize(v: unknown): v is { width: number; height: number } {
  return !!v && typeof (v as { width: unknown }).width === 'number' && typeof (v as { height: unknown }).height === 'number';
}

function resize(width: number, height: number): void {
  const w = Math.round(Math.min(2000, Math.max(760, width)));
  const h = Math.round(Math.min(1400, Math.max(520, height)));
  figma.ui.resize(w, h);
  void figma.clientStorage.setAsync(SIZE_KEY, { width: w, height: h });
}

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
  const frames: BannerFrame[] = [];
  for (const node of selection) {
    const f = bannerFrameOf(node);
    if (f && !frames.includes(f)) frames.push(f);
  }
  const frame = frames[0] ?? null;
  if (!frame) {
    post({ type: 'state', frame: null, frames: [], layers: [], settings: null, selectedLayerIds: [] });
    return;
  }
  const inFrame = selection.filter((n) => n !== frame && bannerFrameOf(n) === frame).map((n) => n.id);
  post({
    type: 'state',
    frame: frameInfo(frame),
    frames: frames.map(frameInfo),
    layers: collectLayers(frame),
    settings: parseSettings(frame.getPluginData(SETTINGS_KEY)),
    selectedLayerIds: inFrame,
  });
}

async function build(frameId: string, purpose: BuildPurpose, withBackup: 'jpg' | 'png' | null): Promise<void> {
  const node = await figma.getNodeByIdAsync(frameId);
  if (!isBannerFrame(node)) throw new Error(t('Фрейм не знайдено. Виділіть його ще раз.', 'Frame not found. Select it again.'));
  const { banner, warnings } = await serializeBanner(node);
  const anims: Record<string, LayerAnim> = {};
  for (const layer of collectLayers(node)) if (layer.anim) anims[layer.id] = layer.anim;
  // The backup shows the design as drawn, which is the final state of every animation.
  const backup = purpose === 'export' && withBackup ? await node.exportAsync({ format: withBackup === 'png' ? 'PNG' : 'JPG', constraint: { type: 'SCALE', value: 1 } }) : null;
  post({ type: 'banner', purpose, banner, warnings, anims, backup });
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

async function readPresets(scope: PresetScope): Promise<Preset[]> {
  if (scope === 'file') return parsePresets(figma.root.getPluginData(PRESETS_KEY));
  const stored: unknown = await figma.clientStorage.getAsync(PRESETS_KEY);
  return parsePresets(typeof stored === 'string' ? stored : '');
}

async function writePresets(scope: PresetScope, presets: Preset[]): Promise<void> {
  const json = JSON.stringify(presets);
  if (scope === 'file') figma.root.setPluginData(PRESETS_KEY, json);
  else await figma.clientStorage.setAsync(PRESETS_KEY, json);
}

async function sendPresets(): Promise<void> {
  post({ type: 'presets', file: await readPresets('file'), mine: await readPresets('mine') });
}

async function savePresets(scope: PresetScope, incoming: Preset[]): Promise<void> {
  const list = await readPresets(scope);
  for (const preset of incoming) {
    const i = list.findIndex((p) => p.id === preset.id || p.name === preset.name);
    if (i >= 0) list[i] = { ...preset, id: list[i].id };
    else list.push(preset);
  }
  await writePresets(scope, list);
  await sendPresets();
}

async function deletePreset(scope: PresetScope, id: string): Promise<void> {
  await writePresets(scope, (await readPresets(scope)).filter((p) => p.id !== id));
  await sendPresets();
}

figma.on('selectionchange', sendState);
sendState();
void sendPresets();

figma.ui.onmessage = async (msg: UiMessage) => {
  try {
    switch (msg.type) {
      case 'build':
        await build(msg.frameId, msg.purpose, msg.backup);
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
      case 'save-presets':
        await savePresets(msg.scope, parsePresets(JSON.stringify(msg.presets)));
        break;
      case 'delete-preset':
        await deletePreset(msg.scope, msg.id);
        break;
      case 'resize':
        resize(msg.width, msg.height);
        break;
      case 'set-lang':
        setLang(msg.lang);
        await figma.clientStorage.setAsync(LANG_KEY, msg.lang);
        break;
      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
