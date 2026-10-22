import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { animationLength } from '../core/animate';
import type { BundleItem } from '../core/bundle';
import { bundleFiles, uniqueBases } from '../core/bundle';
import { generate } from '../core/generate';
import { NETWORKS, validate } from '../core/networks';
import { LEVELS, fitToLimit, optimizeAssets } from '../core/optimize';
import type { BannerSettings, Easing, HoverAnim, IntroAnim, LayerAnim, LoopAnim, NetworkId, OutroAnim, Preset, PresetScope } from '../shared/anim';
import {
  EASINGS,
  HOVER_PRESETS,
  INTRO_PRESETS,
  LOOP_PRESETS,
  OUTRO_PRESETS,
  defaultHover,
  defaultIntro,
  defaultLoop,
  defaultOutro,
  emptyAnim,
  isEmptyAnim,
  isSplitPreset,
} from '../shared/anim';
import type { Banner, BannerNode } from '../shared/ir';
import type { BuildPurpose, FrameInfo, LayerInfo, MainMessage, UiMessage } from '../shared/messages';
import {
  EASING_LABELS,
  HOVER_LABELS,
  INTRO_LABELS,
  LOOP_LABELS,
  OUTRO_LABELS,
  hoverAmountLabel,
  introAmountLabel,
  loopAmountLabel,
  outroAmountLabel,
} from './labels';
import { canvasCodec } from './codec';
import { CustomEditor } from './keyframes';
import { download, previewHtml, slug, zipFiles } from './package';
import { Presets } from './presets';
import { Timeline } from './timeline';

function send(message: UiMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

interface BuildResult {
  banner: Banner;
  warnings: string[];
  anims: Record<string, LayerAnim>;
  backup: Uint8Array | null;
}

interface Built extends BuildResult {
  /** Layer ids present in the banner; layers merged into a raster image are missing. */
  ids: Set<string>;
}

type Pending = { resolve: (r: BuildResult) => void; reject: (e: Error) => void };

function App() {
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [settings, setSettings] = useState<BannerSettings | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [replay, setReplay] = useState(0);
  const [clipboard, setClipboard] = useState<LayerAnim | null>(null);
  const [presets, setPresets] = useState<Record<PresetScope, Preset[]>>({ file: [], mine: [] });

  const frameRef = useRef<FrameInfo | null>(null);
  frameRef.current = frame;
  const pending = useRef(new Map<string, Pending>());

  /** Asks the main thread to read a frame from Figma; one request per frame and purpose at a time. */
  function requestBuild(frameId: string, purpose: BuildPurpose, backup = false): Promise<BuildResult> {
    return new Promise((resolve, reject) => {
      pending.current.set(`${frameId}|${purpose}`, { resolve, reject });
      send({ type: 'build', frameId, purpose, backup });
    });
  }

  async function refreshPreview(frameId: string) {
    setBusy('Готую превʼю…');
    try {
      const r = await requestBuild(frameId, 'preview');
      // Ignore a late answer for a frame the user has already left.
      if (frameRef.current?.id === frameId) setBuilt({ ...r, ids: collectIds(r.banner.root) });
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const msg = event.data.pluginMessage as MainMessage | undefined;
      if (!msg) return;
      if (msg.type === 'state') {
        const changedFrame = msg.frame?.id !== frameRef.current?.id;
        frameRef.current = msg.frame;
        setFrame(msg.frame);
        setFrames(msg.frames);
        setLayers(msg.layers);
        setSettings(msg.settings);
        setSelectedIds(msg.selectedLayerIds);
        if (changedFrame) {
          setBuilt(null);
          setNotes([]);
          setStatus(null);
          if (msg.frame) void refreshPreview(msg.frame.id);
        }
      } else if (msg.type === 'banner') {
        const key = `${msg.banner.root.id}|${msg.purpose}`;
        const waiter = pending.current.get(key);
        pending.current.delete(key);
        waiter?.resolve({ banner: msg.banner, warnings: msg.warnings, anims: msg.anims, backup: msg.backup });
      } else if (msg.type === 'presets') {
        setPresets({ file: msg.file, mine: msg.mine });
      } else if (msg.type === 'error') {
        // Errors are not tied to a request, so every waiting request fails with it.
        for (const waiter of pending.current.values()) waiter.reject(new Error(msg.message));
        pending.current.clear();
        setStatus({ text: msg.message, error: true });
      }
    };
  }, []);

  const anims = useMemo(() => {
    const map: Record<string, LayerAnim> = {};
    for (const layer of layers) if (layer.anim) map[layer.id] = layer.anim;
    return map;
  }, [layers]);

  const network = NETWORKS[settings?.network ?? 'google-ads'];
  const length = animationLength(Object.values(anims), network.maxDuration);

  function updateAnim(id: string, anim: LayerAnim | null) {
    const stored = isEmptyAnim(anim) ? null : anim;
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, anim: stored } : l)));
    send({ type: 'set-anim', nodeId: id, anim: stored });
  }

  function updateSettings(patch: Partial<BannerSettings>) {
    if (!settings || !frame) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    send({ type: 'set-settings', frameId: frame.id, settings: next });
  }

  /** Gives every intro a growing delay in layer order, top of the list first. */
  function staggerIntros() {
    let delay = 0;
    for (const layer of layers) {
      if (!layer.anim?.intro) continue;
      updateAnim(layer.id, { ...layer.anim, intro: { ...layer.anim.intro, delay: round(delay) } });
      delay += 0.25;
    }
  }

  function applyToSelected(anim: LayerAnim) {
    for (const id of selectedIds) updateAnim(id, structuredCloneAnim(anim));
  }

  /** Exports every selected banner frame with the current frame's network, link and backup settings. */
  async function exportAll() {
    if (!settings || frames.length === 0) return;
    const net = NETWORKS[settings.network];
    const items: BundleItem[] = [];
    const notesOut: string[] = [];
    const codec = canvasCodec();
    const maxBytes = net.maxKb === null ? null : net.maxKb * 1024;
    try {
      const bases = uniqueBases(frames.map((f) => `${slug(f.name)}_${f.width}x${f.height}`));
      for (const [i, f] of frames.entries()) {
        setBusy(frames.length > 1 ? `Експортую ${i + 1} з ${frames.length}: ${f.name}` : 'Експортую…');
        const r = await requestBuild(f.id, 'export', settings.backup);
        // The edited frame uses the panel's state; other frames use what is stored on their layers.
        const frameAnims = f.id === frame?.id ? anims : r.anims;
        const options = { clickTag: settings.clickTag, anims: frameAnims, maxDuration: net.maxDuration, platform: net.platform };
        // Without auto-optimisation only the lossless first level runs.
        const fitted = await fitToLimit(maxBytes, settings.optimize ? LEVELS.length : 1, async (level) => {
          const assets = await optimizeAssets(r.banner.assets, LEVELS[level], codec);
          const gen = generate({ ...r.banner, assets }, options);
          const zip = await zipFiles(gen.files);
          return { bytes: zip.length, result: { gen, zip } };
        });
        const { gen, zip } = fitted.result;
        const problems = validate(net, { width: r.banner.width, height: r.banner.height, zipBytes: zip.length, fileCount: gen.files.length });
        items.push({
          base: bases[i],
          name: f.name,
          width: r.banner.width,
          height: r.banner.height,
          zip,
          previewHtml: gen.html,
          assets: gen.files.filter((file) => file.path.startsWith('img/')),
          backup: r.backup,
          problems,
        });
        const prefix = frames.length > 1 ? `${f.name}: ` : '';
        if (fitted.level > 0) {
          notesOut.push(`${prefix}Картинки стиснуто (${LEVELS[fitted.level].label}), щоб вміститися в ${net.maxKb} KB.`);
        }
        notesOut.push(...[...problems, ...gen.warnings, ...r.warnings].map((n) => prefix + n));
      }

      if (items.length === 1 && !items[0].backup) {
        download(items[0].zip, `${items[0].base}.zip`, 'application/zip');
      } else {
        const title = items.length === 1 ? items[0].base : `banners_${items.length}`;
        download(await zipFiles(bundleFiles(items, title)), `${title}_export.zip`, 'application/zip');
      }
      const totalKb = items.reduce((sum, item) => sum + item.zip.length, 0) / 1024;
      setNotes(notesOut);
      setStatus({
        text: `Готово: банерів ${items.length}, ${totalKb.toFixed(1)} KB.`,
        error: items.some((item) => item.problems.length > 0),
      });
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  if (!frame || !settings) {
    return (
      <main>
        <h1>Banner Export</h1>
        <p class="muted">Виділіть фрейм банера або будь-який шар у ньому. Для пакетного експорту виділіть кілька фреймів.</p>
      </main>
    );
  }

  const selected = layers.find((l) => l.id === selectedIds[0]) ?? null;

  return (
    <main>
      <header>
        <h1>{frame.name}</h1>
        <span class="muted">
          {frame.width}×{frame.height}
        </span>
      </header>

      <Preview built={built} anims={anims} settings={settings} replay={replay} busy={busy} />
      <div class="row">
        <button class="secondary" onClick={() => setReplay((n) => n + 1)} disabled={!built}>
          ↻ Програти
        </button>
        <button class="secondary" onClick={() => void refreshPreview(frame.id)} disabled={!!busy}>
          Оновити з макета
        </button>
      </div>
      <p class="muted small">
        Тривалість анімації: {length === 'infinite' ? 'нескінченно' : `${length} с`}
        {network.maxDuration !== null ? ` (ліміт ${network.maxDuration} с)` : ''}
      </p>

      <Timeline layers={layers} maxDuration={network.maxDuration} selectedIds={selectedIds} replay={replay} onChange={updateAnim} />

      <section>
        <h2>Шари</h2>
        <LayerList layers={layers} selectedIds={selectedIds} ids={built?.ids ?? null} />
        <button class="link" onClick={staggerIntros} disabled={!layers.some((l) => l.anim?.intro)}>
          Розкласти появу по черзі (крок 0.25 с)
        </button>
      </section>

      {selected ? (
        <LayerEditor
          key={selected.id}
          layer={selected}
          selectedCount={selectedIds.length}
          canPaste={!!clipboard}
          onChange={(anim) => updateAnim(selected.id, anim)}
          onCopy={() => setClipboard(selected.anim ? structuredCloneAnim(selected.anim) : null)}
          onPaste={() => clipboard && applyToSelected(clipboard)}
        />
      ) : (
        <p class="muted">Виберіть шар у списку або на полотні, щоб додати анімацію.</p>
      )}

      <Presets
        presets={presets}
        current={selected?.anim ?? null}
        selectedCount={selectedIds.length}
        onApply={applyToSelected}
        send={send}
        onStatus={(text, error) => setStatus({ text, error })}
      />

      <section>
        <h2>Експорт</h2>
        <label>
          Мережа
          <select value={settings.network} onChange={(e) => updateSettings({ network: e.currentTarget.value as NetworkId })}>
            {Object.values(NETWORKS).map((n) => (
              <option value={n.id}>{n.label}</option>
            ))}
          </select>
        </label>
        <p class="muted small">{network.note}</p>
        <label>
          Посилання (clickTag)
          <input type="url" value={settings.clickTag} onChange={(e) => updateSettings({ clickTag: e.currentTarget.value.trim() })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.backup} onChange={(e) => updateSettings({ backup: e.currentTarget.checked })} />
          Додати backup JPG
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.optimize} onChange={(e) => updateSettings({ optimize: e.currentTarget.checked })} />
          Стискати картинки, якщо ZIP не вміщується в ліміт
        </label>
        {frames.length > 1 && (
          <p class="muted small">
            Виділено фреймів: {frames.length}. Мережа, посилання і backup беруться з поточного фрейму, анімації — з кожного фрейму свої.
          </p>
        )}
        <button onClick={() => void exportAll()} disabled={!!busy}>
          {busy && busy.startsWith('Експорт') ? busy : frames.length > 1 ? `Експортувати всі (${frames.length})` : 'Експортувати ZIP'}
        </button>
        {status && <p class={status.error ? 'error' : 'muted'}>{status.text}</p>}
        {notes.length > 0 && (
          <ul class="muted small">
            {notes.map((n) => (
              <li>{n}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Preview(props: { built: Built | null; anims: Record<string, LayerAnim>; settings: BannerSettings; replay: number; busy: string | null }) {
  const { built, anims, settings, replay, busy } = props;
  const blobs = useRef<{ banner: Banner | null; urls: Map<string, string> }>({ banner: null, urls: new Map() });
  const [doc, setDoc] = useState('');

  useEffect(() => {
    if (!built) return;
    if (blobs.current.banner !== built.banner) {
      for (const url of blobs.current.urls.values()) URL.revokeObjectURL(url);
      blobs.current = { banner: built.banner, urls: new Map() };
    }
    // Debounced so typing in a field does not restart the preview on every keystroke.
    const timer = setTimeout(() => {
      const net = NETWORKS[settings.network];
      const { html, files } = generate(built.banner, { clickTag: settings.clickTag, anims, maxDuration: net.maxDuration, platform: net.platform });
      // A comment that changes with each replay forces the iframe to reload.
      setDoc(previewHtml(html, files, blobs.current.urls) + `<!-- ${replay} -->`);
    }, 250);
    return () => clearTimeout(timer);
  }, [built, anims, settings, replay]);

  if (!built) return <div class="preview empty muted">{busy ?? 'Немає превʼю'}</div>;
  const { width, height } = built.banner;
  const scale = Math.min(1, 352 / width, 320 / height);
  return (
    <div class="preview">
      {/* The box takes the scaled size, so a wide banner stays centred and fully visible. */}
      <div style={{ width: `${width * scale}px`, height: `${height * scale}px`, overflow: 'hidden' }}>
        <iframe srcDoc={doc} width={width} height={height} style={{ transform: `scale(${scale})`, width: `${width}px`, height: `${height}px` }} />
      </div>
    </div>
  );
}

function LayerList(props: { layers: LayerInfo[]; selectedIds: string[]; ids: Set<string> | null }) {
  const { layers, selectedIds, ids } = props;
  if (layers.length === 0) return <p class="muted">У фреймі немає шарів.</p>;
  return (
    <ul class="layers">
      {layers.map((layer) => {
        const lost = !!layer.anim && !!ids && !ids.has(layer.id);
        return (
          <li
            class={selectedIds.includes(layer.id) ? 'selected' : ''}
            style={{ paddingLeft: `${8 + layer.depth * 14}px` }}
            onClick={() => send({ type: 'select-layer', nodeId: layer.id })}
            title={lost ? 'Шар увійшов у растрове зображення батьківського шару, тому його анімація не застосується' : layer.name}
          >
            <span class="name">{layer.name}</span>
            {layer.anim?.intro && <span class="badge">поява</span>}
            {layer.anim?.loop && <span class="badge">цикл</span>}
            {layer.anim?.hover && <span class="badge">hover</span>}
            {layer.anim?.outro && <span class="badge">зникнення</span>}
            {layer.anim?.custom && <span class="badge">кадри</span>}
            {lost && <span class="badge warn">растр</span>}
          </li>
        );
      })}
    </ul>
  );
}

function LayerEditor(props: {
  layer: LayerInfo;
  selectedCount: number;
  canPaste: boolean;
  onChange: (anim: LayerAnim) => void;
  onCopy: () => void;
  onPaste: () => void;
}) {
  const { layer, onChange } = props;
  const anim = layer.anim ?? emptyAnim();
  const set = (patch: Partial<LayerAnim>) => onChange({ ...anim, ...patch });
  const isText = layer.type === 'TEXT';

  return (
    <section class="editor">
      <div class="row between">
        <h2>Анімація: {layer.name}</h2>
        <div class="row tight">
          <button class="link" onClick={props.onCopy} disabled={!layer.anim}>
            Копіювати
          </button>
          <button class="link" onClick={props.onPaste} disabled={!props.canPaste}>
            {props.selectedCount > 1 ? `Вставити (${props.selectedCount})` : 'Вставити'}
          </button>
          <button class="link" onClick={() => onChange(emptyAnim())} disabled={!layer.anim}>
            Скинути
          </button>
        </div>
      </div>

      <fieldset>
        <legend>Поява</legend>
        <select
          value={anim.intro?.preset ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value as IntroAnim['preset'] | '';
            set({ intro: v ? { ...defaultIntro(v), delay: anim.intro?.delay ?? 0 } : null });
          }}
        >
          <option value="">Немає</option>
          {INTRO_PRESETS.filter((p) => isText || !isSplitPreset(p)).map((p) => (
            <option value={p}>{INTRO_LABELS[p]}</option>
          ))}
        </select>
        {anim.intro && (
          <div class="grid">
            <NumberField label="Затримка, с" value={anim.intro.delay} step={0.1} onChange={(v) => set({ intro: { ...anim.intro!, delay: v } })} />
            <NumberField label="Тривалість, с" value={anim.intro.duration} step={0.1} min={0.05} onChange={(v) => set({ intro: { ...anim.intro!, duration: v } })} />
            <EasingField value={anim.intro.easing} onChange={(easing) => set({ intro: { ...anim.intro!, easing } })} />
            {introAmountLabel(anim.intro.preset) && (
              <NumberField
                label={introAmountLabel(anim.intro.preset)!}
                value={anim.intro.amount}
                step={anim.intro.preset === 'scaleIn' || anim.intro.preset === 'zoomOut' ? 0.05 : 2}
                onChange={(v) => set({ intro: { ...anim.intro!, amount: v } })}
              />
            )}
            {isSplitPreset(anim.intro.preset) && (
              <NumberField
                label={anim.intro.preset === 'wordsUp' ? 'Крок між словами, с' : 'Крок між літерами, с'}
                value={anim.intro.stagger}
                step={0.01}
                onChange={(v) => set({ intro: { ...anim.intro!, stagger: v } })}
              />
            )}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Цикл</legend>
        <select
          value={anim.loop?.preset ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value as LoopAnim['preset'] | '';
            set({ loop: v ? defaultLoop(v) : null });
          }}
        >
          <option value="">Немає</option>
          {LOOP_PRESETS.map((p) => (
            <option value={p}>{LOOP_LABELS[p]}</option>
          ))}
        </select>
        {anim.loop && (
          <div class="grid">
            <NumberField label={anim.intro ? 'Старт після появи, с' : 'Старт, с'} value={anim.loop.delay} step={0.1} onChange={(v) => set({ loop: { ...anim.loop!, delay: v } })} />
            <NumberField label="Рух, с" value={anim.loop.duration} step={0.1} min={0.05} onChange={(v) => set({ loop: { ...anim.loop!, duration: v } })} />
            <NumberField label="Пауза між циклами, с" value={anim.loop.pause} step={0.1} onChange={(v) => set({ loop: { ...anim.loop!, pause: v } })} />
            <NumberField
              label={loopAmountLabel(anim.loop.preset)}
              value={anim.loop.amount}
              step={anim.loop.preset === 'pulse' || anim.loop.preset === 'shine' ? 0.01 : 1}
              onChange={(v) => set({ loop: { ...anim.loop!, amount: v } })}
            />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Hover</legend>
        <select
          value={anim.hover?.preset ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value as HoverAnim['preset'] | '';
            set({ hover: v ? defaultHover(v) : null });
          }}
        >
          <option value="">Немає</option>
          {HOVER_PRESETS.map((p) => (
            <option value={p}>{HOVER_LABELS[p]}</option>
          ))}
        </select>
        {anim.hover && (
          <div class="grid">
            <label>
              Коли
              <select value={anim.hover.trigger} onChange={(e) => set({ hover: { ...anim.hover!, trigger: e.currentTarget.value as HoverAnim['trigger'] } })}>
                <option value="banner">Наведення на банер</option>
                <option value="layer">Наведення на шар</option>
              </select>
            </label>
            <NumberField label="Тривалість, с" value={anim.hover.duration} step={0.05} min={0} onChange={(v) => set({ hover: { ...anim.hover!, duration: v } })} />
            <NumberField
              label={hoverAmountLabel(anim.hover.preset)}
              value={anim.hover.amount}
              step={anim.hover.preset === 'lift' ? 1 : 0.01}
              onChange={(v) => set({ hover: { ...anim.hover!, amount: v } })}
            />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Зникнення</legend>
        <select
          value={anim.outro?.preset ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value as OutroAnim['preset'] | '';
            set({ outro: v ? { ...defaultOutro(v), at: anim.outro?.at ?? defaultOutro(v).at } : null });
          }}
        >
          <option value="">Немає</option>
          {OUTRO_PRESETS.map((p) => (
            <option value={p}>{OUTRO_LABELS[p]}</option>
          ))}
        </select>
        {anim.outro && (
          <div class="grid">
            <NumberField label="Коли, с від старту" value={anim.outro.at} step={0.1} onChange={(v) => set({ outro: { ...anim.outro!, at: v } })} />
            <NumberField label="Тривалість, с" value={anim.outro.duration} step={0.1} min={0.05} onChange={(v) => set({ outro: { ...anim.outro!, duration: v } })} />
            <EasingField value={anim.outro.easing} onChange={(easing) => set({ outro: { ...anim.outro!, easing } })} />
            {outroAmountLabel(anim.outro.preset) && (
              <NumberField
                label={outroAmountLabel(anim.outro.preset)!}
                value={anim.outro.amount}
                step={anim.outro.preset === 'zoomAway' ? 0.05 : 2}
                onChange={(v) => set({ outro: { ...anim.outro!, amount: v } })}
              />
            )}
          </div>
        )}
      </fieldset>

      <CustomEditor value={anim.custom} onChange={(custom) => set({ custom })} />
    </section>
  );
}

function EasingField(props: { value: Easing; onChange: (e: Easing) => void }) {
  return (
    <label>
      Easing
      <select value={props.value} onChange={(e) => props.onChange(e.currentTarget.value as Easing)}>
        {EASINGS.map((ez) => (
          <option value={ez}>{EASING_LABELS[ez]}</option>
        ))}
      </select>
    </label>
  );
}

function NumberField(props: { label: string; value: number; step: number; min?: number; onChange: (v: number) => void }) {
  return (
    <label>
      {props.label}
      <input
        type="number"
        value={props.value}
        step={props.step}
        min={props.min ?? 0}
        onInput={(e) => {
          const v = parseFloat(e.currentTarget.value);
          if (Number.isFinite(v) && v >= (props.min ?? 0)) props.onChange(v);
        }}
      />
    </label>
  );
}

function collectIds(node: BannerNode, out = new Set<string>()): Set<string> {
  out.add(node.id);
  if (node.kind === 'box') for (const child of node.children) collectIds(child, out);
  return out;
}

function structuredCloneAnim(anim: LayerAnim): LayerAnim {
  return JSON.parse(JSON.stringify(anim)) as LayerAnim;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

render(<App />, document.getElementById('app')!);
