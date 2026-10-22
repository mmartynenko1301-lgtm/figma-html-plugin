import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { animationLength } from '../core/animate';
import type { BundleItem } from '../core/bundle';
import { bundleFiles, uniqueBases } from '../core/bundle';
import { generate } from '../core/generate';
import { NETWORKS, validate } from '../core/networks';
import { LEVELS, fitToLimit, optimizeAssets } from '../core/optimize';
import type { BannerSettings, LayerAnim, NetworkId, Preset, PresetScope } from '../shared/anim';
import { isEmptyAnim } from '../shared/anim';
import type { Banner, BannerNode } from '../shared/ir';
import type { BuildPurpose, FrameInfo, LayerInfo, MainMessage, UiMessage } from '../shared/messages';
import { canvasCodec } from './codec';
import { LayerEditor } from './editor';
import { download, previewHtml, slug, zipFiles } from './package';
import { Presets } from './presets';
import { LayerTimeline } from './timeline';

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

type Tab = 'anim' | 'presets' | 'export';

interface ExportResult {
  name: string;
  size: string;
  kb: number;
  maxKb: number | null;
  problems: string[];
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
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem('tab');
      return saved === 'presets' || saved === 'export' ? saved : 'anim';
    } catch {
      return 'anim';
    }
  });
  const [lastExport, setLastExport] = useState<ExportResult[] | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('tab', tab);
    } catch {
      // Storage can be unavailable in the plugin iframe; the tab then resets on reopen.
    }
  }, [tab]);

  // Status messages fade after a while unless they report a problem.
  useEffect(() => {
    if (!status || status.error) return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

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
      setLastExport(
        items.map((item) => ({
          name: item.name,
          size: `${Math.round(item.width)}×${Math.round(item.height)}`,
          kb: item.zip.length / 1024,
          maxKb: net.maxKb,
          problems: item.problems,
        })),
      );
      if (items.some((item) => item.problems.length > 0)) setTab('export');
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
      <main class="empty-state">
        <div class="hero">▶</div>
        <h1>Banner Export</h1>
        <ol>
          <li>Виділіть фрейм банера або будь-який шар у ньому.</li>
          <li>Додайте шарам анімації або застосуйте пресет.</li>
          <li>Виберіть мережу та експортуйте ZIP.</li>
        </ol>
        <p class="muted small">Щоб експортувати кілька розмірів разом, виділіть кілька фреймів.</p>
        <ResizeHandle />
      </main>
    );
  }

  const selected = layers.find((l) => l.id === selectedIds[0]) ?? null;
  const problemCount = lastExport?.reduce((n, item) => n + item.problems.length, 0) ?? 0;

  return (
    <div class="app">
      <div class="top">
        <header>
          <h1 title={frame.name}>{frame.name}</h1>
          <span class="muted">
            {frame.width}×{frame.height}
          </span>
          <button class="chip-net" title="Мережа для експорту" onClick={() => setTab('export')}>
            {network.label}
          </button>
        </header>
        <Preview built={built} anims={anims} settings={settings} replay={replay} busy={busy} />
        <div class="toolbar">
          <button class="icon text" onClick={() => setReplay((n) => n + 1)} disabled={!built} title="Програти анімацію спочатку">
            ▶ Програти
          </button>
          <button class="icon text" onClick={() => void refreshPreview(frame.id)} disabled={!!busy} title="Перечитати макет з Figma">
            ⟳ Оновити
          </button>
          <span class={`duration${length !== 'infinite' && network.maxDuration !== null && length > network.maxDuration ? ' over' : ''}`}>
            {length === 'infinite' ? '∞' : `${length} с`}
            {network.maxDuration !== null ? ` / ${network.maxDuration} с` : ''}
          </span>
        </div>
        <nav class="tabs">
          {(
            [
              ['anim', 'Анімація'],
              ['presets', 'Пресети'],
              ['export', 'Експорт'],
            ] as const
          ).map(([id, label]) => (
            <button class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
              {id === 'export' && problemCount > 0 && <span class="count">{problemCount}</span>}
            </button>
          ))}
        </nav>
      </div>

      <main>
        {tab === 'anim' && (
          <>
            <LayerTimeline
              layers={layers}
              maxDuration={network.maxDuration}
              selectedIds={selectedIds}
              ids={built?.ids ?? null}
              replay={replay}
              onSelect={(id) => send({ type: 'select-layer', nodeId: id })}
              onChange={updateAnim}
            />
            <div class="row between">
              <span class="legend">
                <span class="dot intro" />
                поява <span class="dot custom" />
                кадри <span class="dot loop" />
                цикл <span class="dot hover" />
                hover <span class="dot outro" />
                зникнення
              </span>
              <button class="link" onClick={staggerIntros} disabled={!layers.some((l) => l.anim?.intro)} title="Затримки появи 0, 0.25, 0.5 с… у порядку шарів">
                Появи по черзі
              </button>
            </div>
            {selected ? (
              <LayerEditor
                key={selected.id}
                layer={selected}
                selectedCount={selectedIds.length}
                canPaste={!!clipboard}
                onChange={(anim) => updateAnim(selected.id, anim)}
                onCopy={() => {
                  if (!selected.anim) return;
                  setClipboard(structuredCloneAnim(selected.anim));
                  setStatus({ text: `Анімацію «${selected.name}» скопійовано.` });
                }}
                onPaste={() => clipboard && applyToSelected(clipboard)}
              />
            ) : (
              <p class="hint">Клацніть шар у списку або на полотні, щоб додати йому анімацію.</p>
            )}
          </>
        )}

        {tab === 'presets' && (
          <Presets
            presets={presets}
            current={selected?.anim ?? null}
            selectedCount={selectedIds.length}
            onApply={(anim, name) => {
              applyToSelected(anim);
              setStatus({ text: `Пресет «${name}» застосовано${selectedIds.length > 1 ? ` до ${selectedIds.length} шарів` : ''}.` });
            }}
            send={send}
            onStatus={(text, error) => setStatus({ text, error })}
          />
        )}

        {tab === 'export' && (
          <section>
            <label>
              Мережа
              <select value={settings.network} onChange={(e) => updateSettings({ network: e.currentTarget.value as NetworkId })}>
                {Object.values(NETWORKS).map((n) => (
                  <option value={n.id}>{n.label}</option>
                ))}
              </select>
            </label>
            <div class="facts">
              <span>Вага: {network.maxKb === null ? 'без ліміту' : `до ${network.maxKb} KB`}</span>
              <span>Тривалість: {network.maxDuration === null ? 'без ліміту' : `до ${network.maxDuration} с`}</span>
            </div>
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
            {lastExport && (
              <div class="results">
                <h3>Останній експорт</h3>
                {lastExport.map((item) => (
                  <div class="result">
                    <div class="row between">
                      <strong>{item.name}</strong>
                      <span class="muted small">
                        {item.size} · {item.kb.toFixed(1)} KB{item.maxKb !== null ? ` з ${item.maxKb}` : ''}
                      </span>
                    </div>
                    {item.maxKb !== null && (
                      <div class={`meter${item.kb > item.maxKb ? ' over' : ''}`}>
                        <span style={{ width: `${Math.min(100, (item.kb / item.maxKb) * 100)}%` }} />
                      </div>
                    )}
                    {item.problems.map((p) => (
                      <p class="error small">{p}</p>
                    ))}
                  </div>
                ))}
                {notes.length > 0 && (
                  <ul class="muted small">
                    {notes.map((n) => (
                      <li>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      <footer>
        {status && (
          <p class={`status ${status.error ? 'error' : ''}`} onClick={() => setStatus(null)} title="Сховати">
            {status.text}
          </p>
        )}
        <button class="primary" onClick={() => void exportAll()} disabled={!!busy}>
          {busy && busy.startsWith('Експорт') ? busy : frames.length > 1 ? `Експортувати всі (${frames.length})` : 'Експортувати ZIP'}
        </button>
      </footer>
      <ResizeHandle />
    </div>
  );
}

/** Corner grip that resizes the plugin window; the main thread remembers the size. */
function ResizeHandle() {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  return (
    <div
      class="resize"
      title="Змінити розмір вікна"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        send({ type: 'resize', width: Math.round(s.w + e.screenX - s.x), height: Math.round(s.h + e.screenY - s.y) });
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
    />
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

  // The preview follows the window width, so a resized plugin window shows a bigger banner.
  const [boxWidth, setBoxWidth] = useState(window.innerWidth - 26);
  useEffect(() => {
    const onResize = () => setBoxWidth(window.innerWidth - 26);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!built) return <div class="preview empty muted">{busy ?? 'Немає превʼю'}</div>;
  const { width, height } = built.banner;
  const scale = Math.min(1, boxWidth / width, Math.max(120, window.innerHeight * 0.24) / height);
  return (
    <div class="preview">
      {/* The box takes the scaled size, so a wide banner stays centred and fully visible. */}
      <div style={{ width: `${width * scale}px`, height: `${height * scale}px`, overflow: 'hidden' }}>
        <iframe srcDoc={doc} width={width} height={height} style={{ transform: `scale(${scale})`, width: `${width}px`, height: `${height}px` }} />
      </div>
    </div>
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
