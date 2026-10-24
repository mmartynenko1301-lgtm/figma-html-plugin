import type { OutputFile } from '../core/generate';

// Draws frames of a generated banner at any moment of its animation, for GIF and WebP.
// The banner markup and CSS go into an SVG <foreignObject>, which the browser draws onto
// a canvas. Every animation is paused with its delay shifted back by the frame time, so
// the browser's own animation engine places each layer exactly as the HTML5 banner would.

export interface FrameRenderer {
  width: number;
  height: number;
  /** Draws the banner at `t` seconds into the canvas, which is sized width × height × scale. */
  draw(t: number, canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;
}

interface Animated {
  id: number;
  /** Original animation-delay list of the element, in seconds. */
  delays: number[];
  /** Same for its ::after pseudo-element, used by the shine loop. */
  afterDelays: number[] | null;
}

export async function createRenderer(html: string, files: OutputFile[], width: number, height: number, scale = 1): Promise<FrameRenderer> {
  const doc = inlineImages(html, files);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden`;
  const loaded = new Promise<void>((resolve) => (frame.onload = () => resolve()));
  frame.srcdoc = doc;
  document.body.appendChild(frame);
  await loaded;
  const fdoc = frame.contentDocument!;
  const banner = fdoc.getElementById('banner')!;
  banner.classList.add('play');

  // Collect each animated element's delays, then tag it so per-frame CSS can address it.
  const animated: Animated[] = [];
  const win = frame.contentWindow!;
  banner.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const own = win.getComputedStyle(el);
    const after = win.getComputedStyle(el, '::after');
    const hasOwn = own.animationName !== 'none' && own.animationName !== '';
    const hasAfter = after.animationName !== 'none' && after.animationName !== '' && after.content !== 'none';
    if (!hasOwn && !hasAfter) return;
    const id = animated.length;
    el.setAttribute('data-fid', String(id));
    animated.push({ id, delays: hasOwn ? seconds(own.animationDelay) : [], afterDelays: hasAfter ? seconds(after.animationDelay) : null });
  });

  const fontCss = await inlineFonts(fdoc);
  const styles = Array.from(fdoc.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n')
    // The export must animate even when the designer's system asks for reduced motion.
    .replace(/@media \(prefers-reduced-motion:reduce\)\{[^{}]*\{[^{}]*\}\}/g, '');
  const markup = new XMLSerializer().serializeToString(banner);
  frame.remove();

  const base = `${fontCss}\n${styles}\n#banner *,#banner *::after{animation-play-state:paused!important}`;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  return {
    width,
    height,
    async draw(t, canvas) {
      const ms = (d: number) => `${Math.round((d - t) * 1000)}ms`;
      const shift = animated
        .map((a) => {
          const own = a.delays.length ? `[data-fid="${a.id}"]{animation-delay:${a.delays.map(ms).join(',')}!important}` : '';
          const after = a.afterDelays ? `[data-fid="${a.id}"]::after{animation-delay:${a.afterDelays.map(ms).join(',')}!important}` : '';
          return own + after;
        })
        .join('');
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}">` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden">` +
        `<style>${escapeXml(base + shift)}</style>${markup}</div></foreignObject></svg>`;
      // A data URL, not a blob URL: Chromium marks the canvas tainted for blob SVGs with foreignObject.
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
    },
    dispose() {
      frame.remove();
    },
  };
}

function seconds(list: string): number[] {
  return list.split(',').map((s) => {
    const v = parseFloat(s);
    return s.trim().endsWith('ms') ? v / 1000 : v;
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Images inside an SVG image only load from data URLs. */
function inlineImages(html: string, files: OutputFile[]): string {
  let doc = html;
  for (const file of files) {
    if (typeof file.data === 'string' || !file.path.startsWith('img/')) continue;
    const ext = file.path.slice(file.path.lastIndexOf('.') + 1);
    const type = { svg: 'image/svg+xml', jpg: 'image/jpeg', gif: 'image/gif' }[ext] ?? 'image/png';
    doc = doc.split(`src="${file.path}"`).join(`src="data:${type};base64,${base64(file.data)}"`);
  }
  return doc;
}

/** Google Fonts as @font-face rules with the font files embedded, since an SVG image cannot fetch them. */
async function inlineFonts(doc: Document): Promise<string> {
  const link = doc.querySelector<HTMLLinkElement>('link[href^="https://fonts.googleapis.com"]');
  if (!link) return '';
  try {
    const css = await (await fetch(link.href)).text();
    const urls = Array.from(new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"]+/g) ?? []));
    const data = await Promise.all(urls.map(async (u) => `data:font/woff2;base64,${base64(new Uint8Array(await (await fetch(u)).arrayBuffer()))}`));
    let out = css;
    urls.forEach((u, i) => (out = out.split(u).join(data[i])));
    return out;
  } catch {
    // Offline: the frames fall back to system fonts.
    return '';
  }
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
