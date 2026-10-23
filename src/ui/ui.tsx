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
import { timelineSpan } from './timeline-model';

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
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [seek, setSeek] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('timeline-height'));
      return saved >= 120 ? saved : 240;
    } catch {
      return 240;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('timeline-height', String(timelineHeight));
    } catch {
      // Without storage the height resets on reopen.
    }
  }, [timelineHeight]);

  const spanRef = useRef(10);
  useEffect(() => {
    if (seek !== null) cancelAnimationFrame(clock.current);
  }, [seek]);

  // Preview clock for the playhead: runs from the moment the preview starts playing.
  const clock = useRef(0);
  function startClock() {
    cancelAnimationFrame(clock.current);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      setTime(t);
      // Past the timeline's right edge the playhead has nowhere to go.
      if (t < spanRef.current) clock.current = requestAnimationFrame(tick);
    };
    tick();
  }

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
  spanRef.current = timelineSpan(Object.values(anims), network.maxDuration);

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
      <div class="empty-state">
        <div class="empty-card">
          <div class="hero">
            <Icon name="play" size={20} />
          </div>
          <h1>Banner Export</h1>
          <ol>
            <li>Виділіть фрейм банера або будь-який шар у ньому.</li>
            <li>Додайте шарам анімації або застосуйте пресет.</li>
            <li>Виберіть мережу та експортуйте ZIP.</li>
          </ol>
          <p class="muted small">Щоб експортувати кілька розмірів разом, виділіть кілька фреймів.</p>
        </div>
        <ResizeHandle />
      </div>
    );
  }

  const selected = layers.find((l) => l.id === selectedIds[0]) ?? null;
  const problemCount = lastExport?.reduce((n, item) => n + item.problems.length, 0) ?? 0;
  const overTime = length !== 'infinite' && network.maxDuration !== null && length > network.maxDuration;
  const exported = lastExport?.find((item) => item.name === frame.name) ?? null;
  const frameIndex = frames.findIndex((f) => f.id === frame.id);

  const play = () => {
    setSeek(null);
    setReplay((n) => n + 1);
  };

  return (
    <div class="app" style={{ '--tl-h': `${timelineHeight}px` }}>
      <div class="stage">
        <div class="stage-bar">
          <div class="frame-title">
            <span class="frame-glyph">
              <Icon name="frame" />
            </span>
            <div class="frame-text">
              <h1 title={frame.name}>{frame.name}</h1>
              <span class="muted small">
                {frame.width} × {frame.height}
                {frames.length > 1 && frameIndex >= 0 ? ` · ${frameIndex + 1} з ${frames.length} фреймів` : ''}
              </span>
            </div>
          </div>
          <div class="stage-actions">
            <button class="btn primary" onClick={play} disabled={!built} title="Програти анімацію спочатку">
              <Icon name="play" /> Програти
            </button>
            <button class="btn" onClick={() => void refreshPreview(frame.id)} disabled={!!busy} title="Перечитати макет з Figma">
              <Icon name="refresh" /> Оновити
            </button>
            <select class="zoom" value={zoom} onChange={(e) => setZoom(e.currentTarget.value as Zoom)} title="Масштаб превʼю">
              <option value="fit">Fit</option>
              <option value="0.5">50%</option>
              <option value="1">100%</option>
              <option value="2">200%</option>
            </select>
          </div>
        </div>
        <div class="viewport">
          <Preview built={built} anims={anims} settings={settings} replay={replay} busy={busy} zoom={zoom} seek={seek} onPlay={startClock} />
          <div class="badges">
            <span class={`badge${overTime ? ' bad' : ''}`} title="Тривалість анімації і ліміт мережі">
              {length === 'infinite' ? '∞' : `${length} с`}
              {network.maxDuration !== null ? ` / ${network.maxDuration} с` : ''}
            </span>
            {exported && (
              <span class={`badge${exported.maxKb !== null && exported.kb > exported.maxKb ? ' bad' : ''}`} title="Вага ZIP після останнього експорту">
                <span class={`dot ${exported.maxKb !== null && exported.kb > exported.maxKb ? 'outro' : 'loop'}`} />
                {exported.kb.toFixed(0)} KB{exported.maxKb !== null ? ` / ${exported.maxKb} KB` : ''}
              </span>
            )}
            <button class="badge" title="Мережа для експорту" onClick={() => setTab('export')}>
              {network.label}
            </button>
          </div>
        </div>
        <Splitter height={timelineHeight} onChange={setTimelineHeight} />
        <div class="timeline">
          <LayerTimeline
            layers={layers}
            maxDuration={network.maxDuration}
            selectedIds={selectedIds}
            ids={built?.ids ?? null}
            time={seek ?? time}
            scrubbing={seek !== null}
            onScrub={setSeek}
            onStagger={staggerIntros}
            onSelect={(id) => send({ type: 'select-layer', nodeId: id })}
            onChange={updateAnim}
          />
        </div>
      </div>

      <aside class="panel">
        <nav class="segmented tabs">
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

        <main>
          {tab === 'anim' &&
            (selected ? (
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
              <p class="hint">Клацніть шар на таймлайні або на полотні, щоб додати йому анімацію.</p>
            ))}

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
            <section class="export">
              <h3>Мережа</h3>
              <label class="field">
                <span>Мережа</span>
                <select value={settings.network} onChange={(e) => updateSettings({ network: e.currentTarget.value as NetworkId })}>
                  {Object.values(NETWORKS).map((n) => (
                    <option value={n.id}>{n.label}</option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>clickTag</span>
                <input type="url" value={settings.clickTag} onChange={(e) => updateSettings({ clickTag: e.currentTarget.value.trim() })} />
              </label>
              <label class="check">
                <input type="checkbox" checked={settings.backup} onChange={(e) => updateSettings({ backup: e.currentTarget.checked })} />
                Додати backup JPG
              </label>
              <label class="check">
                <input type="checkbox" checked={settings.optimize} onChange={(e) => updateSettings({ optimize: e.currentTarget.checked })} />
                Стискати картинки під ліміт
              </label>

              <hr />
              <h3>Ліміти</h3>
              <dl class="facts">
                <dt>Вага ZIP</dt>
                <dd>{network.maxKb === null ? 'без ліміту' : `≤ ${network.maxKb} KB`}</dd>
                <dt>Тривалість</dt>
                <dd>{network.maxDuration === null ? 'без ліміту' : `≤ ${network.maxDuration} с`}</dd>
              </dl>
              {network.note && <p class="muted small">{network.note}</p>}
              {frames.length > 1 && (
                <p class="muted small">
                  Виділено фреймів: {frames.length}. Мережа, посилання і backup беруться з поточного фрейму, анімації — з кожного фрейму свої.
                </p>
              )}

              {lastExport && (
                <>
                  <hr />
                  <h3>Останній експорт</h3>
                  {lastExport.map((item) => (
                    <div class="result">
                      <div class="row between">
                        <strong title={item.name}>{item.name}</strong>
                        <span class="muted small">{item.size}</span>
                      </div>
                      {item.maxKb !== null && (
                        <div class={`meter${item.kb > item.maxKb ? ' over' : ''}`}>
                          <span style={{ width: `${Math.min(100, (item.kb / item.maxKb) * 100)}%` }} />
                        </div>
                      )}
                      <span class={`small ${item.maxKb !== null && item.kb > item.maxKb ? 'error' : 'ok'}`}>
                        {item.kb.toFixed(1)} KB{item.maxKb !== null ? ` з ${item.maxKb} KB` : ''}
                      </span>
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
                </>
              )}
            </section>
          )}
        </main>

        <footer>
          {status ? (
            <p class={`status ${status.error ? 'error' : ''}`} onClick={() => setStatus(null)} title="Сховати">
              {status.text}
            </p>
          ) : (
            <span class="status idle">
              <span class="dot loop" />
              {frames.length > 1 ? `Фреймів: ${frames.length}` : 'Збережено у файлі'}
            </span>
          )}
          <button class="btn primary" onClick={() => void exportAll()} disabled={!!busy}>
            <Icon name="download" />
            {busy && busy.startsWith('Експорт') ? busy : frames.length > 1 ? `Експортувати всі (${frames.length})` : 'Експортувати'}
          </button>
        </footer>
      </aside>
      <ResizeHandle />
    </div>
  );
}

type Zoom = 'fit' | '0.5' | '1' | '2';

const ICONS = {
  play: <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5" />,
  frame: <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
};

export function Icon(props: { name: keyof typeof ICONS; size?: number }) {
  const size = props.size ?? 14;
  return (
    <svg class="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {ICONS[props.name]}
    </svg>
  );
}

/** Drag bar between the viewport and the timeline. */
function Splitter(props: { height: number; onChange: (h: number) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      class="splitter"
      title="Тягніть, щоб змінити висоту таймлайну"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: props.height };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        props.onChange(Math.round(Math.min(window.innerHeight - 220, Math.max(120, s.h - (e.clientY - s.y)))));
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
    />
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

/** Pauses every animation of the preview document at `t` seconds from the start. */
function seekPreview(frame: HTMLIFrameElement | null, t: number) {
  const doc = frame?.contentDocument;
  if (!doc || typeof doc.getAnimations !== 'function') return;
  doc.getElementById('banner')?.classList.add('play');
  for (const animation of doc.getAnimations()) {
    animation.pause();
    animation.currentTime = t * 1000;
  }
}

function Preview(props: {
  built: Built | null;
  anims: Record<string, LayerAnim>;
  settings: BannerSettings;
  replay: number;
  busy: string | null;
  zoom: Zoom;
  /** Seconds to hold the preview at, or null to let it play. */
  seek: number | null;
  /** Called when the preview starts playing from the beginning. */
  onPlay: () => void;
}) {
  const { built, anims, settings, replay, busy, zoom, seek } = props;
  const blobs = useRef<{ banner: Banner | null; urls: Map<string, string> }>({ banner: null, urls: new Map() });
  const [doc, setDoc] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const seekRef = useRef(seek);
  seekRef.current = seek;

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

  useEffect(() => {
    if (seek !== null) seekPreview(frameRef.current, seek);
  }, [seek]);

  // The banner is scaled to the viewport, which changes with the window and the timeline height.
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 600, height: 400 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!built]);

  if (!built) return <div class="preview empty muted">{busy ?? 'Немає превʼю'}</div>;
  const { width, height } = built.banner;
  // Room is left for the badges along the bottom edge.
  const scale = zoom === 'fit' ? Math.min(2, (box.width - 48) / width, (box.height - 80) / height) : Number(zoom);
  return (
    <div class={`preview${zoom === 'fit' ? '' : ' zoomed'}`} ref={boxRef}>
      {/* The box takes the scaled size, so the banner stays centred and fully visible. */}
      <div class="banner-box" style={{ width: `${width * scale}px`, height: `${height * scale}px` }}>
        <iframe
          ref={frameRef}
          srcDoc={doc}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})`, width: `${width}px`, height: `${height}px` }}
          onLoad={() => {
            if (seekRef.current !== null) {
              // Animations start once fonts load, so the seek waits for that too.
              const frame = frameRef.current;
              void (frame?.contentDocument?.fonts?.ready ?? Promise.resolve()).then(() => seekRef.current !== null && seekPreview(frame, seekRef.current));
            } else props.onPlay();
          }}
        />
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
