import type { EncodeOptions, ImageCodec } from '../core/optimize';
import type { Asset } from '../shared/ir';

/** Canvas-based image codec for the plugin UI; decoded images are cached per asset. */
export function canvasCodec(): ImageCodec {
  const bitmaps = new Map<Uint8Array, Promise<ImageBitmap | null>>();
  const opaque = new Map<Uint8Array, Promise<boolean>>();

  const decode = (asset: Asset) => {
    let p = bitmaps.get(asset.bytes);
    if (!p) {
      const type = asset.ext === 'jpg' ? 'image/jpeg' : 'image/png';
      p = createImageBitmap(new Blob([asset.bytes as Uint8Array<ArrayBuffer>], { type })).catch(() => null);
      bitmaps.set(asset.bytes, p);
    }
    return p;
  };

  return {
    isOpaque(asset) {
      let p = opaque.get(asset.bytes);
      if (!p) {
        p = decode(asset).then((bmp) => {
          if (!bmp) return false;
          const ctx = canvas(bmp.width, bmp.height).getContext('2d')!;
          ctx.drawImage(bmp, 0, 0);
          const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
          return true;
        });
        opaque.set(asset.bytes, p);
      }
      return p;
    },

    async encode(asset, options: EncodeOptions) {
      const bmp = await decode(asset);
      if (!bmp) return null;
      const w = Math.max(1, Math.round(bmp.width * options.scale));
      const h = Math.max(1, Math.round(bmp.height * options.scale));
      const c = canvas(w, h);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, w, h);
      const type = options.format === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, options.quality));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  };
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
