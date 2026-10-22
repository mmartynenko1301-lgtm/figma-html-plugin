import JSZip from 'jszip';
import { generate } from '../core/generate';
import type { Banner } from '../shared/ir';
import type { MainMessage, SelectionInfo, UiMessage } from '../shared/messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frameSelect = $<HTMLSelectElement>('frame');
const clickTagInput = $<HTMLInputElement>('clicktag');
const exportButton = $<HTMLButtonElement>('export');
const status = $('status');
const preview = $('preview');
const warningsList = $('warnings');

let frames: SelectionInfo[] = [];

function send(message: UiMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.className = isError ? 'error' : 'muted';
}

exportButton.addEventListener('click', () => {
  if (!frameSelect.value) return;
  exportButton.disabled = true;
  setStatus('Експортую…');
  send({ type: 'export', frameId: frameSelect.value });
});

window.onmessage = async (event: MessageEvent) => {
  const msg = event.data.pluginMessage as MainMessage | undefined;
  if (!msg) return;
  if (msg.type === 'selection') {
    frames = msg.frames;
    frameSelect.innerHTML = '';
    for (const f of frames) {
      const option = document.createElement('option');
      option.value = f.id;
      option.textContent = `${f.name} — ${f.width}×${f.height}`;
      frameSelect.append(option);
    }
    exportButton.disabled = frames.length === 0;
    if (frames.length === 0) setStatus('Виділіть фрейм банера.');
  } else if (msg.type === 'banner') {
    await finishExport(msg.banner, msg.warnings);
  } else if (msg.type === 'error') {
    exportButton.disabled = frames.length === 0;
    setStatus(msg.message, true);
  }
};

async function finishExport(banner: Banner, warnings: string[]): Promise<void> {
  try {
    const { html, files } = generate(banner, { clickTag: clickTagInput.value.trim() });
    const zip = new JSZip();
    for (const file of files) zip.file(file.path, file.data);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });

    const name = `${slug(banner.name)}_${Math.round(banner.width)}x${Math.round(banner.height)}.zip`;
    download(blob, name);
    showPreview(banner, html, files);
    showWarnings(warnings);
    setStatus(`Готово: ${name}, ${(blob.size / 1024).toFixed(1)} KB, файлів: ${files.length}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    exportButton.disabled = frames.length === 0;
  }
}

function showPreview(banner: Banner, html: string, files: { path: string; data: string | Uint8Array }[]): void {
  // Asset paths are swapped for blob URLs so the preview runs without a server.
  let doc = html;
  for (const file of files) {
    if (typeof file.data === 'string') continue;
    const type = file.path.endsWith('.svg') ? 'image/svg+xml' : file.path.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const url = URL.createObjectURL(new Blob([file.data as Uint8Array<ArrayBuffer>], { type }));
    doc = doc.split(`src="${file.path}"`).join(`src="${url}"`);
  }
  const iframe = document.createElement('iframe');
  iframe.width = String(banner.width);
  iframe.height = String(banner.height);
  const scale = Math.min(1, 334 / banner.width);
  iframe.style.transform = `scale(${scale})`;
  preview.style.height = `${Math.ceil(banner.height * scale)}px`;
  iframe.srcdoc = doc;
  preview.replaceChildren(iframe);
  preview.hidden = false;
}

function showWarnings(warnings: string[]): void {
  warningsList.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }),
  );
}

function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function slug(s: string): string {
  return s.trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'banner';
}
