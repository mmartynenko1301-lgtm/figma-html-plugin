import { t } from '../shared/i18n';
// The single-threaded build: the plugin iframe cannot use SharedArrayBuffer threads.
import avifFactory from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';

// Browsers decode AVIF but cannot encode it, so the encoder is libavif compiled to
// WebAssembly. Its 3.5 MB binary is fetched once, on first use, instead of shipping
// inside the plugin.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@jsquash/avif@2.1.1/codec/enc/avif_enc.wasm';

type AvifModule = { encode(data: Uint8Array, width: number, height: number, options: typeof defaultOptions): Uint8Array | null };
let module: Promise<AvifModule> | null = null;

function load(): Promise<AvifModule> {
  module ??= (async () => {
    const response = await fetch(WASM_URL);
    if (!response.ok) throw new Error(String(response.status));
    const wasmBinary = await response.arrayBuffer();
    return (await avifFactory({ noInitialRun: true, wasmBinary })) as unknown as AvifModule;
  })().catch((err) => {
    module = null;
    throw new Error(t(`Не вдалося завантажити кодувальник AVIF (${err instanceof Error ? err.message : err}). Потрібен інтернет.`, `Could not load the AVIF encoder (${err instanceof Error ? err.message : err}). An internet connection is needed.`));
  });
  return module;
}

export async function encodeAvif(image: ImageData, quality = 60): Promise<Uint8Array> {
  const avif = await load();
  const out = avif.encode(new Uint8Array(image.data.buffer), image.width, image.height, { ...defaultOptions, quality });
  if (!out) throw new Error('AVIF');
  return new Uint8Array(out);
}
