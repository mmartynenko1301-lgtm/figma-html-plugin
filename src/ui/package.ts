import JSZip from 'jszip';
import type { OutputFile } from '../core/generate';

export async function zipFiles(files: OutputFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.data);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

export function download(data: Uint8Array, filename: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

/** Swaps asset paths in the generated HTML for blob URLs so the preview runs without a server. */
export function previewHtml(html: string, files: OutputFile[], cache: Map<string, string>): string {
  let doc = html;
  for (const file of files) {
    if (typeof file.data === 'string') continue;
    let url = cache.get(file.path);
    if (!url) {
      const ext = file.path.slice(file.path.lastIndexOf('.') + 1);
      const type = { svg: 'image/svg+xml', jpg: 'image/jpeg', gif: 'image/gif' }[ext] ?? 'image/png';
      url = URL.createObjectURL(new Blob([file.data as Uint8Array<ArrayBuffer>], { type }));
      cache.set(file.path, url);
    }
    doc = doc.split(`src="${file.path}"`).join(`src="${url}"`);
  }
  return doc;
}

export function slug(s: string): string {
  return s.trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'banner';
}
