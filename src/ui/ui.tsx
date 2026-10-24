import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { animationLength } from '../core/animate';
import type { BundleItem } from '../core/bundle';
import { bundleFiles, uniqueBases } from '../core/bundle';
import type { OutputFile } from '../core/generate';
import { generate } from '../core/generate';
import { NETWORKS, effectiveDuration, validate } from '../core/networks';
import { LEVELS, fitToLimit, optimizeAssets } from '../core/optimize';
import type { AnimatedSettings, BackupFormat, BannerSettings, LayerAnim, NetworkId, Preset, PresetScope } from '../shared/anim';
import { ANIMATED_FPS, isEmptyAnim } from '../shared/anim';
import type { Banner, BannerNode } from '../shared/ir';
import type { BuildPurpose, FrameInfo, LayerInfo, MainMessage, UiMessage } from '../shared/messages';
import type { AnimatedFile, AnimatedResult } from './animated';
import { buildAnimated } from './animated';
import { encodeAvif } from './avif';
import { canvasCodec } from './codec';
import { LayerEditor } from './editor';
import { download, previewHtml, slug, zipFiles } from './package';
import { Presets } from './presets';
import { LayerTimeline } from './timeline';
import { timelineSpan } from './timeline-model';
import type { Lang } from '../shared/i18n';
import { getLang, setLang, t } from '../shared/i18n';

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
  animated: { ext: string; kb: number; label: string; fits: boolean }[];
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
  const [lang, setLangState] = useState<Lang>(getLang());
  const [zoom, setZoom] = useState<Zoom>('fit');
  const estimateCache = useRef<{ key: string; result: AnimatedResult } | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
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
  function requestBuild(frameId: string, purpose: BuildPurpose, backup: 'jpg' | 'png' | null = null): Promise<BuildResult> {
    return new Promise((resolve, reject) => {
      pending.current.set(`${frameId}|${purpose}`, { resolve, reject });
      send({ type: 'build', frameId, purpose, backup });
    });
  }

  async function refreshPreview(frameId: string) {
    setBusy(previewBusy());
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
      } else if (msg.type === 'lang') {
        setLang(msg.lang);
        setLangState(msg.lang);
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
  const maxDuration = effectiveDuration(network, settings?.duration ?? null);
  const length = animationLength(Object.values(anims), maxDuration);
  spanRef.current = timelineSpan(Object.values(anims), maxDuration);

  // GIF/WebP of the current frame, built in the background while the Export tab is open,
  // so the size is known before exporting; the export reuses it when nothing changed.
  useEffect(() => {
    if (!built || !settings || tab !== 'export' || !(settings.animated.gif || settings.animated.webp)) return;
    const net = NETWORKS[settings.network];
    const max = effectiveDuration(net, settings.duration);
    const gen = generate(built.banner, { clickTag: settings.clickTag, anims, maxDuration: max, platform: net.platform });
    const duration = animationDuration(anims, max);
    const key = animatedKey(gen, settings.animated, duration);
    if (estimateCache.current?.key === key) {
      setEstimate({ key, progress: 1, result: estimateCache.current.result });
      return;
    }
    const signal = { cancelled: false };
    const timer = setTimeout(async () => {
      setEstimate({ key, progress: 0, result: null });
      try {
        const page = { html: gen.html, files: gen.files, width: built.banner.width, height: built.banner.height };
        const result = await buildAnimated(page, settings.animated, duration, (progress) => !signal.cancelled && setEstimate({ key, progress, result: null }), signal);
        if (!result || signal.cancelled) return;
        estimateCache.current = { key, result };
        setEstimate({ key, progress: 1, result });
      } catch (err) {
        if (!signal.cancelled) setEstimate({ key, progress: 1, result: null, error: errorText(err) });
      }
    }, 800);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
  }, [built, anims, settings, tab]);

  function changeLang(next: Lang) {
    setLang(next);
    setLangState(next);
    send({ type: 'set-lang', lang: next });
  }

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
    const animatedOut: AnimatedFile[][] = [];
    const notesOut: string[] = [];
    const codec = canvasCodec();
    const maxBytes = net.maxKb === null ? null : net.maxKb * 1024;
    try {
      const bases = uniqueBases(frames.map((f) => `${slug(f.name)}_${f.width}x${f.height}`));
      for (const [i, f] of frames.entries()) {
        setBusy(frames.length > 1 ? t(`Експортую ${i + 1} з ${frames.length}: ${f.name}`, `Exporting ${i + 1} of ${frames.length}: ${f.name}`) : t('Експортую…', 'Exporting…'));
        const r = await requestBuild(f.id, 'export', settings.backup ? (settings.backupFormat === 'jpg' ? 'jpg' : 'png') : null);
        // The edited frame uses the panel's state; other frames use what is stored on their layers.
        const frameAnims = f.id === frame?.id ? anims : r.anims;
        const frameMax = effectiveDuration(net, settings.duration);
        const options = { clickTag: settings.clickTag, anims: frameAnims, maxDuration: frameMax, platform: net.platform };
        // Without auto-optimisation only the lossless first level runs.
        const fitted = await fitToLimit(maxBytes, settings.optimize ? LEVELS.length : 1, async (level) => {
          const assets = await optimizeAssets(r.banner.assets, LEVELS[level], codec);
          const gen = generate({ ...r.banner, assets }, options);
          const zip = await zipFiles(gen.files);
          return { bytes: zip.length, result: { gen, zip } };
        });
        const { gen, zip } = fitted.result;
        const page = { width: r.banner.width, height: r.banner.height, ...generate(r.banner, options) };
        let animated: AnimatedResult | null = null;
        if (settings.animated.gif || settings.animated.webp) {
          const key = animatedKey(page, settings.animated, animationDuration(frameAnims, frameMax));
          const cached = estimateCache.current;
          animated =
            cached && cached.key === key
              ? cached.result
              : await buildAnimated(page, settings.animated, animationDuration(frameAnims, frameMax), (share) =>
                  setBusy(t(`GIF/WebP ${frames.length > 1 ? `${i + 1}/${frames.length} ` : ''}${Math.round(share * 100)}%`, `GIF/WebP ${frames.length > 1 ? `${i + 1}/${frames.length} ` : ''}${Math.round(share * 100)}%`)),
                );
        }
        const backup = r.backup && settings.backup ? await convertBackup(r.backup, settings.backupFormat) : null;
        const problems = validate(net, {
          width: r.banner.width,
          height: r.banner.height,
          zipBytes: zip.length,
          fileCount: gen.files.length,
          duration: animationLength(Object.values(frameAnims), frameMax),
        });
        items.push({
          base: bases[i],
          name: f.name,
          width: r.banner.width,
          height: r.banner.height,
          zip,
          previewHtml: gen.html,
          assets: gen.files.filter((file) => file.path.startsWith('img/')),
          backup,
          animated: animated?.files.map((a) => ({ ext: a.ext, bytes: a.bytes })) ?? [],
          problems,
        });
        animatedOut.push(animated?.files ?? []);
        const prefix = frames.length > 1 ? `${f.name}: ` : '';
        if (fitted.level > 0) {
          notesOut.push(
            prefix + t(`Картинки стиснуто (${LEVELS[fitted.level].label}), щоб вміститися в ${net.maxKb} KB.`, `Images compressed (${LEVELS[fitted.level].label}) to fit ${net.maxKb} KB.`),
          );
        }
        notesOut.push(...[...problems, ...gen.warnings, ...r.warnings].map((n) => prefix + n));
      }

      if (items.length === 1 && !items[0].backup && items[0].animated.length === 0) {
        download(items[0].zip, `${items[0].base}.zip`, 'application/zip');
      } else {
        const title = items.length === 1 ? items[0].base : `banners_${items.length}`;
        download(await zipFiles(bundleFiles(items, title)), `${title}_export.zip`, 'application/zip');
      }
      const totalKb = items.reduce((sum, item) => sum + item.zip.length, 0) / 1024;
      setNotes(notesOut);
      setLastExport(
        items.map((item, i) => ({
          name: item.name,
          animated: animatedOut[i].map((a) => ({ ext: a.ext, kb: a.bytes.length / 1024, label: a.label, fits: a.fits })),
          size: `${Math.round(item.width)}×${Math.round(item.height)}`,
          kb: item.zip.length / 1024,
          maxKb: net.maxKb,
          problems: item.problems,
        })),
      );
      if (items.some((item) => item.problems.length > 0)) setTab('export');
      setStatus({
        text: t(`Готово: банерів ${items.length}, ${totalKb.toFixed(1)} KB.`, `Done: ${items.length} banners, ${totalKb.toFixed(1)} KB.`),
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
            <li>{t('Виділіть фрейм банера або будь-який шар у ньому.', 'Select a banner frame or any layer in it.')}</li>
            <li>{t('Додайте шарам анімації або застосуйте пресет.', 'Add animations to layers or apply a preset.')}</li>
            <li>{t('Виберіть мережу та експортуйте ZIP.', 'Pick a network and export the ZIP.')}</li>
          </ol>
          <p class="muted small">{t('Щоб експортувати кілька розмірів разом, виділіть кілька фреймів.', 'To export several sizes together, select several frames.')}</p>
          <LangSwitch lang={lang} onChange={changeLang} />
        </div>
        <ResizeHandle />
      </div>
    );
  }

  const selected = layers.find((l) => l.id === selectedIds[0]) ?? null;
  const problemCount = lastExport?.reduce((n, item) => n + item.problems.length, 0) ?? 0;
  const overTime = network.maxDuration !== null && (length === 'infinite' || length > network.maxDuration);
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
                {frames.length > 1 && frameIndex >= 0 ? t(` · ${frameIndex + 1} з ${frames.length} фреймів`, ` · ${frameIndex + 1} of ${frames.length} frames`) : ''}
              </span>
            </div>
          </div>
          <div class="stage-actions">
            <button class="btn primary" onClick={play} disabled={!built} title={t('Програти анімацію спочатку', 'Play the animation from the start')}>
              <Icon name="play" /> {t('Програти', 'Play')}
            </button>
            <button class="btn" onClick={() => void refreshPreview(frame.id)} disabled={!!busy} title={t('Перечитати макет з Figma', 'Re-read the layout from Figma')}>
              <Icon name="refresh" /> {t('Оновити', 'Refresh')}
            </button>
            <select class="zoom" value={zoom} onChange={(e) => setZoom(e.currentTarget.value as Zoom)} title={t('Масштаб превʼю', 'Preview zoom')}>
              <option value="fit">Fit</option>
              <option value="0.5">50%</option>
              <option value="1">100%</option>
              <option value="2">200%</option>
            </select>
            <LangSwitch lang={lang} onChange={changeLang} />
          </div>
        </div>
        <div class="viewport">
          <Preview built={built} anims={anims} settings={settings} replay={replay} busy={busy} zoom={zoom} seek={seek} onPlay={startClock} />
          <div class="badges">
            <span class={`badge${overTime ? ' bad' : ''}`} title={t('Тривалість анімації і ліміт мережі', 'Animation length and network limit')}>
              {length === 'infinite' ? '∞' : `${length} ${t('с', 's')}`}
              {maxDuration !== null ? ` / ${maxDuration} ${t('с', 's')}` : ''}
            </span>
            {exported && (
              <span class={`badge${exported.maxKb !== null && exported.kb > exported.maxKb ? ' bad' : ''}`} title={t('Вага ZIP після останнього експорту', 'ZIP size after the last export')}>
                <span class={`dot ${exported.maxKb !== null && exported.kb > exported.maxKb ? 'outro' : 'loop'}`} />
                {exported.kb.toFixed(0)} KB{exported.maxKb !== null ? ` / ${exported.maxKb} KB` : ''}
              </span>
            )}
            <button class="badge" title={t('Мережа для експорту', 'Network to export for')} onClick={() => setTab('export')}>
              {network.label}
            </button>
          </div>
        </div>
        <Splitter height={timelineHeight} onChange={setTimelineHeight} />
        <div class="timeline">
          <LayerTimeline
            layers={layers}
            maxDuration={maxDuration}
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
              ['anim', t('Анімація', 'Animation')],
              ['presets', t('Пресети', 'Presets')],
              ['export', t('Експорт', 'Export')],
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
                  setStatus({ text: t(`Анімацію «${selected.name}» скопійовано.`, `Animation of “${selected.name}” copied.`) });
                }}
                onPaste={() => clipboard && applyToSelected(clipboard)}
              />
            ) : (
              <p class="hint">{t('Клацніть шар на таймлайні або на полотні, щоб додати йому анімацію.', 'Click a layer in the timeline or on the canvas to animate it.')}</p>
            ))}

          {tab === 'presets' && (
            <Presets
              presets={presets}
              current={selected?.anim ?? null}
              selectedCount={selectedIds.length}
              onApply={(anim, name) => {
                applyToSelected(anim);
                setStatus({
                  text: t(
                    `Пресет «${name}» застосовано${selectedIds.length > 1 ? ` до ${selectedIds.length} шарів` : ''}.`,
                    `Preset “${name}” applied${selectedIds.length > 1 ? ` to ${selectedIds.length} layers` : ''}.`,
                  ),
                });
              }}
              send={send}
              onStatus={(text, error) => setStatus({ text, error })}
            />
          )}

          {tab === 'export' && (
            <section class="export">
              <h3>{t('Мережа', 'Network')}</h3>
              <label class="field">
                <span>{t('Мережа', 'Network')}</span>
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
              <DurationField network={network} value={settings.duration} onChange={(duration) => updateSettings({ duration })} />
              <label class="check">
                <input type="checkbox" checked={settings.backup} onChange={(e) => updateSettings({ backup: e.currentTarget.checked })} />
                {t('Додати статичний backup', 'Add a static backup')}
              </label>
              {settings.backup && (
                <label class="field">
                  <span>{t('Формат backup', 'Backup format')}</span>
                  <select value={settings.backupFormat} onChange={(e) => updateSettings({ backupFormat: e.currentTarget.value as BackupFormat })}>
                    <option value="jpg">JPG</option>
                    <option value="webp">WebP</option>
                    <option value="avif">AVIF</option>
                  </select>
                </label>
              )}
              <label class="check">
                <input type="checkbox" checked={settings.optimize} onChange={(e) => updateSettings({ optimize: e.currentTarget.checked })} />
                {t('Стискати картинки під ліміт', 'Compress images to fit the limit')}
              </label>

              <hr />
              <h3>{t('Ліміти', 'Limits')}</h3>
              <dl class="facts">
                <dt>{t('Вага ZIP', 'ZIP size')}</dt>
                <dd>{network.maxKb === null ? t('без ліміту', 'no limit') : `≤ ${network.maxKb} KB`}</dd>
                <dt>{t('Тривалість', 'Duration')}</dt>
                <dd>{network.maxDuration === null ? t('без ліміту', 'no limit') : `≤ ${network.maxDuration} ${t('с', 's')}`}</dd>
              </dl>
              {network.note && <p class="muted small">{network.note}</p>}
              <hr />
              <AnimatedPanel settings={settings.animated} estimate={estimate} onChange={(patch) => updateSettings({ animated: { ...settings.animated, ...patch } })} />
              {frames.length > 1 && (
                <p class="muted small">
                  {t(
                    `Виділено фреймів: ${frames.length}. Мережа, посилання і backup беруться з поточного фрейму, анімації — з кожного фрейму свої.`,
                    `${frames.length} frames selected. Network, link and backup come from the current frame; each frame keeps its own animations.`,
                  )}
                </p>
              )}

              {lastExport && (
                <>
                  <hr />
                  <h3>{t('Останній експорт', 'Last export')}</h3>
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
                        {item.kb.toFixed(1)} KB{item.maxKb !== null ? t(` з ${item.maxKb} KB`, ` of ${item.maxKb} KB`) : ''}
                      </span>
                      {item.animated.map((a) => (
                        <span class={`small ${a.fits ? 'muted' : 'error'}`}>
                          {a.ext.toUpperCase()}: {a.kb.toFixed(1)} KB · {a.label}
                        </span>
                      ))}
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
            <p class={`status ${status.error ? 'error' : ''}`} onClick={() => setStatus(null)} title={t('Сховати', 'Hide')}>
              {status.text}
            </p>
          ) : (
            <span class="status idle">
              <span class="dot loop" />
              {frames.length > 1 ? t(`Фреймів: ${frames.length}`, `Frames: ${frames.length}`) : t('Збережено у файлі', 'Saved in the file')}
            </span>
          )}
          <button class="btn primary" onClick={() => void exportAll()} disabled={!!busy}>
            <Icon name="download" />
            {busy && busy !== previewBusy() ? busy : frames.length > 1 ? t(`Експортувати всі (${frames.length})`, `Export all (${frames.length})`) : t('Експортувати', 'Export')}
          </button>
        </footer>
      </aside>
      <ResizeHandle />
    </div>
  );
}

type Zoom = 'fit' | '0.5' | '1' | '2';

interface Estimate {
  key: string;
  progress: number;
  result: AnimatedResult | null;
  error?: string;
}

/** GIF / WebP options with the expected file sizes for the current frame. */
function AnimatedPanel(props: { settings: AnimatedSettings; estimate: Estimate | null; onChange: (patch: Partial<AnimatedSettings>) => void }) {
  const { settings, estimate } = props;
  const on = settings.gif || settings.webp;
  return (
    <>
      <h3>{t('Анімована картинка', 'Animated image')}</h3>
      <div class="row">
        <label class="check">
          <input type="checkbox" checked={settings.gif} onChange={(e) => props.onChange({ gif: e.currentTarget.checked })} />
          GIF
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.webp} onChange={(e) => props.onChange({ webp: e.currentTarget.checked })} />
          WebP
        </label>
      </div>
      {on && (
        <>
          <label class="field">
            <span>FPS</span>
            <select value={String(settings.fps)} onChange={(e) => props.onChange({ fps: Number(e.currentTarget.value) })}>
              {ANIMATED_FPS.map((f) => (
                <option value={String(f)}>{f}</option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>{t('Стиснути до', 'Fit into')}</span>
            <input
              type="number"
              min={10}
              step={10}
              placeholder={t('без стиснення', 'no compression')}
              value={settings.maxKb ?? ''}
              onInput={(e) => {
                const v = parseFloat(e.currentTarget.value);
                props.onChange({ maxKb: Number.isFinite(v) && v > 0 ? Math.round(v) : null });
              }}
            />
          </label>
          <p class="muted small">
            {t(
              'KB на кожен файл. Плагін зменшує кольори або якість, а за потреби FPS, поки файл не вміститься.',
              'KB per file. The plugin lowers colours or quality, then FPS if needed, until the file fits.',
            )}
          </p>
          <div class="estimate">
            {!estimate || (estimate.progress < 1 && !estimate.result) ? (
              <>
                <span class="muted small">
                  {t('Рахую вагу…', 'Measuring size…')} {estimate ? `${Math.round(estimate.progress * 100)}%` : ''}
                </span>
                <div class="meter">
                  <span style={{ width: `${Math.round((estimate?.progress ?? 0) * 100)}%` }} />
                </div>
              </>
            ) : estimate.error ? (
              <span class="error small">{estimate.error}</span>
            ) : (
              estimate.result?.files.map((f) => {
                const kb = f.bytes.length / 1024;
                return (
                  <div class="row between">
                    <strong>
                      {f.ext.toUpperCase()} {kb.toFixed(0)} KB
                    </strong>
                    <span class={`small ${f.fits ? 'muted' : 'error'}`}>{f.fits ? f.label : t('не вміщується', 'does not fit')}</span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}

const DURATION_CHOICES = [10, 15, 20, 30];

/** Total banner length: the network's limit, a common length, or any number of seconds. */
function DurationField(props: { network: (typeof NETWORKS)[NetworkId]; value: number | null; onChange: (v: number | null) => void }) {
  const { network, value } = props;
  const [custom, setCustom] = useState(value !== null && !DURATION_CHOICES.includes(value));
  const choice = value === null ? 'network' : custom ? 'custom' : String(value);
  const s = t('с', 's');
  const over = value !== null && network.maxDuration !== null && value > network.maxDuration;
  return (
    <>
      <label class="field">
        <span>{t('Тривалість', 'Duration')}</span>
        <select
          value={choice}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setCustom(v === 'custom');
            if (v === 'network') props.onChange(null);
            else if (v === 'custom') props.onChange(value ?? network.maxDuration ?? 30);
            else props.onChange(Number(v));
          }}
        >
          <option value="network">
            {network.maxDuration === null ? t('Без обмеження', 'Unlimited') : t(`Ліміт мережі (${network.maxDuration} ${s})`, `Network limit (${network.maxDuration} ${s})`)}
          </option>
          {DURATION_CHOICES.map((d) => (
            <option value={String(d)}>
              {d} {s}
            </option>
          ))}
          <option value="custom">{t('Своя…', 'Custom…')}</option>
        </select>
      </label>
      {choice === 'custom' && (
        <label class="field">
          <span>{t('Секунд', 'Seconds')}</span>
          <input
            type="number"
            min={1}
            max={600}
            step={1}
            value={value ?? ''}
            onChange={(e) => {
              const v = parseFloat(e.currentTarget.value);
              if (Number.isFinite(v) && v > 0) props.onChange(Math.min(600, Math.round(v * 10) / 10));
            }}
          />
        </label>
      )}
      <p class={`small ${over ? 'error' : 'muted'}`}>
        {over
          ? t(`Довше за ліміт ${network.label} (${network.maxDuration} ${s}): мережа може відхилити банер.`, `Longer than the ${network.label} limit (${network.maxDuration} ${s}): the network may reject the banner.`)
          : t('Цикли й повтори ключових кадрів обрізаються під цю тривалість.', 'Loops and keyframe repeats are cut to fit this length.')}
      </p>
    </>
  );
}

const previewBusy = () => t('Готую превʼю…', 'Preparing preview…');

/** UA / EN switch; the choice is remembered by the main thread. */
function LangSwitch(props: { lang: Lang; onChange: (lang: Lang) => void }) {
  return (
    <div class="segmented lang" title={t('Мова інтерфейсу', 'Interface language')}>
      {(['uk', 'en'] as const).map((l) => (
        <button class={props.lang === l ? 'on' : ''} onClick={() => props.onChange(l)}>
          {l === 'uk' ? 'UA' : 'EN'}
        </button>
      ))}
    </div>
  );
}

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
      title={t('Тягніть, щоб змінити висоту таймлайну', 'Drag to change the timeline height')}
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
      title={t('Змінити розмір вікна', 'Resize the window')}
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
      const { html, files } = generate(built.banner, { clickTag: settings.clickTag, anims, maxDuration: effectiveDuration(net, settings.duration), platform: net.platform });
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

  if (!built) return <div class="preview empty muted">{busy ?? t('Немає превʼю', 'No preview')}</div>;
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

/** Seconds of animation an animated GIF/WebP should hold. */
function animationDuration(anims: Record<string, LayerAnim>, maxDuration: number | null): number {
  const length = animationLength(Object.values(anims), maxDuration);
  // Endless loops (no network limit) get a typical banner length.
  const seconds = length === 'infinite' ? (maxDuration ?? 15) : length;
  return Math.min(60, Math.max(0.5, seconds));
}

function animatedKey(page: { html: string; files: OutputFile[] }, settings: AnimatedSettings, duration: number): string {
  // File sizes stand in for image contents, which the markup alone does not show.
  const files = page.files.map((f) => `${f.path}:${f.data.length}`);
  return JSON.stringify([page.html, files, settings, duration]);
}

/** The static backup in the chosen format; JPG comes from Figma as is, others from its PNG. */
async function convertBackup(bytes: Uint8Array, format: BackupFormat): Promise<{ ext: string; bytes: Uint8Array }> {
  if (format === 'jpg') return { ext: 'jpg', bytes };
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);
  if (format === 'avif') return { ext: 'avif', bytes: await encodeAvif(g.getImageData(0, 0, canvas.width, canvas.height)) };
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob) throw new Error('WebP');
  return { ext: 'webp', bytes: new Uint8Array(await blob.arrayBuffer()) };
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
