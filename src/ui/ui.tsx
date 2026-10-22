import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { animationLength } from '../core/animate';
import { generate } from '../core/generate';
import { NETWORKS, validate } from '../core/networks';
import type { BannerSettings, Easing, HoverAnim, IntroAnim, LayerAnim, LoopAnim, NetworkId } from '../shared/anim';
import {
  EASINGS,
  HOVER_PRESETS,
  INTRO_PRESETS,
  LOOP_PRESETS,
  defaultHover,
  defaultIntro,
  defaultLoop,
  emptyAnim,
  isEmptyAnim,
} from '../shared/anim';
import type { Banner, BannerNode } from '../shared/ir';
import type { FrameInfo, LayerInfo, MainMessage, UiMessage } from '../shared/messages';
import {
  EASING_LABELS,
  HOVER_LABELS,
  INTRO_LABELS,
  LOOP_LABELS,
  hoverAmountLabel,
  introAmountLabel,
  loopAmountLabel,
} from './labels';
import { download, previewHtml, slug, zipFiles } from './package';

function send(message: UiMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

interface Built {
  frameId: string;
  banner: Banner;
  warnings: string[];
  /** Layer ids present in the banner; layers merged into a raster image are missing. */
  ids: Set<string>;
}

function App() {
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [settings, setSettings] = useState<BannerSettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<'preview' | 'export' | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [replay, setReplay] = useState(0);

  const frameRef = useRef<FrameInfo | null>(null);
  frameRef.current = frame;
  const latest = useRef({ layers, settings });
  latest.current = { layers, settings };

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const msg = event.data.pluginMessage as MainMessage | undefined;
      if (!msg) return;
      if (msg.type === 'state') {
        const changedFrame = msg.frame?.id !== frameRef.current?.id;
        setFrame(msg.frame);
        setLayers(msg.layers);
        setSettings(msg.settings);
        setSelectedId(msg.selectedLayerId);
        if (changedFrame) {
          setBuilt(null);
          setNotes([]);
          setStatus(null);
          if (msg.frame) {
            setBusy('preview');
            send({ type: 'build', frameId: msg.frame.id, purpose: 'preview' });
          }
        }
      } else if (msg.type === 'banner') {
        const next: Built = { frameId: msg.banner.root.id, banner: msg.banner, warnings: msg.warnings, ids: collectIds(msg.banner.root) };
        setBuilt(next);
        if (msg.purpose === 'export') void finishExport(next, msg.backup);
        else setBusy(null);
      } else if (msg.type === 'error') {
        setBusy(null);
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

  function startExport() {
    if (!frame) return;
    setBusy('export');
    setStatus({ text: 'Експортую…' });
    send({ type: 'build', frameId: frame.id, purpose: 'export' });
  }

  async function finishExport(b: Built, backup: Uint8Array | null) {
    try {
      const { layers: currentLayers, settings: s } = latest.current;
      const net = NETWORKS[s?.network ?? 'google-ads'];
      const animMap: Record<string, LayerAnim> = {};
      for (const layer of currentLayers) if (layer.anim) animMap[layer.id] = layer.anim;
      const { files, warnings } = generate(b.banner, { clickTag: s?.clickTag ?? '', anims: animMap, maxDuration: net.maxDuration });
      const zip = await zipFiles(files);
      const base = `${slug(b.banner.name)}_${Math.round(b.banner.width)}x${Math.round(b.banner.height)}`;
      const problems = validate(net, { width: b.banner.width, height: b.banner.height, zipBytes: zip.length, fileCount: files.length });

      if (backup) {
        // One download: the upload-ready banner ZIP next to its backup image.
        const bundle = await zipFiles([
          { path: `${base}.zip`, data: zip },
          { path: `${base}_backup.jpg`, data: backup },
        ]);
        download(bundle, `${base}_export.zip`, 'application/zip');
      } else {
        download(zip, `${base}.zip`, 'application/zip');
      }
      setNotes([...problems, ...warnings, ...b.warnings]);
      setStatus({
        text: `Готово: ${base}.zip, ${(zip.length / 1024).toFixed(1)} KB, файлів: ${files.length}.`,
        error: problems.length > 0,
      });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  if (!frame || !settings) {
    return (
      <main>
        <h1>Banner Export</h1>
        <p class="muted">Виділіть фрейм банера або будь-який шар у ньому.</p>
      </main>
    );
  }

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  return (
    <main>
      <header>
        <h1>{frame.name}</h1>
        <span class="muted">
          {frame.width}×{frame.height}
        </span>
      </header>

      <Preview built={built} anims={anims} settings={settings} replay={replay} busy={busy === 'preview'} />
      <div class="row">
        <button class="secondary" onClick={() => setReplay((n) => n + 1)} disabled={!built}>
          ↻ Програти
        </button>
        <button
          class="secondary"
          onClick={() => {
            setBusy('preview');
            send({ type: 'build', frameId: frame.id, purpose: 'preview' });
          }}
          disabled={!!busy}
        >
          Оновити з макета
        </button>
      </div>
      <p class="muted small">
        Тривалість анімації: {length === 'infinite' ? 'нескінченно' : `${length} с`}
        {network.maxDuration !== null ? ` (ліміт ${network.maxDuration} с)` : ''}
      </p>

      <section>
        <h2>Шари</h2>
        <LayerList layers={layers} selectedId={selectedId} ids={built?.ids ?? null} />
        <button class="link" onClick={staggerIntros} disabled={!layers.some((l) => l.anim?.intro)}>
          Розкласти появу по черзі (крок 0.25 с)
        </button>
      </section>

      {selected ? (
        <LayerEditor key={selected.id} layer={selected} onChange={(anim) => updateAnim(selected.id, anim)} />
      ) : (
        <p class="muted">Виберіть шар у списку або на полотні, щоб додати анімацію.</p>
      )}

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
        <button onClick={startExport} disabled={!!busy}>
          {busy === 'export' ? 'Експортую…' : 'Експортувати ZIP'}
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

function Preview(props: { built: Built | null; anims: Record<string, LayerAnim>; settings: BannerSettings; replay: number; busy: boolean }) {
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
      const { html, files } = generate(built.banner, {
        clickTag: settings.clickTag,
        anims,
        maxDuration: NETWORKS[settings.network].maxDuration,
      });
      // A comment that changes with each replay forces the iframe to reload.
      setDoc(previewHtml(html, files, blobs.current.urls) + `<!-- ${replay} -->`);
    }, 250);
    return () => clearTimeout(timer);
  }, [built, anims, settings, replay]);

  if (!built) return <div class="preview empty muted">{busy ? 'Готую превʼю…' : 'Немає превʼю'}</div>;
  const { width, height } = built.banner;
  const scale = Math.min(1, 352 / width, 320 / height);
  return (
    <div class="preview">
      {/* The box takes the scaled size, so a wide banner stays centred and fully visible. */}
      <div style={{ width: `${width * scale}px`, height: `${height * scale}px`, overflow: 'hidden' }}>
        <iframe
          srcDoc={doc}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})`, width: `${width}px`, height: `${height}px` }}
        />
      </div>
    </div>
  );
}

function LayerList(props: { layers: LayerInfo[]; selectedId: string | null; ids: Set<string> | null }) {
  const { layers, selectedId, ids } = props;
  if (layers.length === 0) return <p class="muted">У фреймі немає шарів.</p>;
  return (
    <ul class="layers">
      {layers.map((layer) => {
        const lost = !!layer.anim && !!ids && !ids.has(layer.id);
        return (
          <li
            class={layer.id === selectedId ? 'selected' : ''}
            style={{ paddingLeft: `${8 + layer.depth * 14}px` }}
            onClick={() => send({ type: 'select-layer', nodeId: layer.id })}
            title={lost ? 'Шар увійшов у растрове зображення батьківського шару, тому його анімація не застосується' : layer.name}
          >
            <span class="name">{layer.name}</span>
            {layer.anim?.intro && <span class="badge">поява</span>}
            {layer.anim?.loop && <span class="badge">цикл</span>}
            {layer.anim?.hover && <span class="badge">hover</span>}
            {lost && <span class="badge warn">растр</span>}
          </li>
        );
      })}
    </ul>
  );
}

function LayerEditor(props: { layer: LayerInfo; onChange: (anim: LayerAnim) => void }) {
  const { layer, onChange } = props;
  const anim = layer.anim ?? emptyAnim();
  const set = (patch: Partial<LayerAnim>) => onChange({ ...anim, ...patch });

  return (
    <section class="editor">
      <h2>Анімація: {layer.name}</h2>

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
          {INTRO_PRESETS.map((p) => (
            <option value={p}>{INTRO_LABELS[p]}</option>
          ))}
        </select>
        {anim.intro && (
          <div class="grid">
            <NumberField label="Затримка, с" value={anim.intro.delay} step={0.1} onChange={(v) => set({ intro: { ...anim.intro!, delay: v } })} />
            <NumberField label="Тривалість, с" value={anim.intro.duration} step={0.1} min={0.05} onChange={(v) => set({ intro: { ...anim.intro!, duration: v } })} />
            <label>
              Easing
              <select value={anim.intro.easing} onChange={(e) => set({ intro: { ...anim.intro!, easing: e.currentTarget.value as Easing } })}>
                {EASINGS.map((ez) => (
                  <option value={ez}>{EASING_LABELS[ez]}</option>
                ))}
              </select>
            </label>
            {introAmountLabel(anim.intro.preset) && (
              <NumberField
                label={introAmountLabel(anim.intro.preset)!}
                value={anim.intro.amount}
                step={anim.intro.preset === 'scaleIn' || anim.intro.preset === 'zoomOut' ? 0.05 : 2}
                onChange={(v) => set({ intro: { ...anim.intro!, amount: v } })}
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
              step={anim.loop.preset === 'pulse' ? 0.01 : 1}
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
    </section>
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

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

render(<App />, document.getElementById('app')!);
