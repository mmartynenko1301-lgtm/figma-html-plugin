import type { OutputFile } from './generate';
import { escapeHtml } from './generate';

export interface BundleItem {
  /** File-name base, e.g. "Spring_sale_300x250". Unique within the bundle. */
  base: string;
  name: string;
  width: number;
  height: number;
  /** Upload-ready ZIP for the network. */
  zip: Uint8Array;
  /** A complete preview document and its assets, unzipped. */
  previewHtml: string;
  assets: OutputFile[];
  backup: Uint8Array | null;
  problems: string[];
}

/**
 * Lays out an export of one or more banners:
 *   preview.html             — every banner side by side, for review and approval
 *   zips/<base>.zip          — upload-ready ZIPs
 *   backups/<base>.jpg       — static backups, when enabled
 *   preview/<base>/…         — unzipped banners the preview page loads
 */
export function bundleFiles(items: BundleItem[], title: string): OutputFile[] {
  const files: OutputFile[] = [{ path: 'preview.html', data: previewPage(items, title) }];
  for (const item of items) {
    files.push({ path: `zips/${item.base}.zip`, data: item.zip });
    if (item.backup) files.push({ path: `backups/${item.base}.jpg`, data: item.backup });
    files.push({ path: `preview/${item.base}/index.html`, data: item.previewHtml });
    for (const asset of item.assets) files.push({ path: `preview/${item.base}/${asset.path}`, data: asset.data });
  }
  return files;
}

/** Makes file-name bases unique by appending _2, _3, … to repeats. */
export function uniqueBases(bases: string[]): string[] {
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

function previewPage(items: BundleItem[], title: string): string {
  const cards = items
    .map((item) => {
      const kb = (item.zip.length / 1024).toFixed(1);
      const src = `preview/${encodeURIComponent(item.base)}/index.html`;
      const problems = item.problems.length
        ? `<ul class="problems">${item.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : '';
      return [
        '<figure>',
        `<iframe src="${src}" width="${Math.round(item.width)}" height="${Math.round(item.height)}" title="${escapeHtml(item.name)}"></iframe>`,
        '<figcaption>',
        `<strong>${escapeHtml(item.name)}</strong>`,
        `<span>${Math.round(item.width)}×${Math.round(item.height)} · ${kb} KB</span>`,
        '<button type="button" onclick="var f=this.closest(\'figure\').querySelector(\'iframe\');f.src=f.src">↻ Програти</button>',
        '</figcaption>',
        problems,
        '</figure>',
      ].join('');
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;padding:24px;font:14px/1.4 system-ui,sans-serif;background:#f4f4f5;color:#18181b}
h1{font-size:18px;margin:0 0 20px}
main{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
figure{margin:0;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:12px;max-width:100%}
iframe{border:0;display:block;max-width:100%}
figcaption{display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap}
figcaption span{color:#71717a}
button{font:inherit;border:1px solid #d4d4d8;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
.problems{color:#b91c1c;margin:8px 0 0;padding-left:18px;max-width:360px}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<main>
${cards}
</main>
</body>
</html>
`;
}
