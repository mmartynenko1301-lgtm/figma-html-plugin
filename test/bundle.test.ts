import { describe, expect, it } from 'vitest';
import { bundleFiles, uniqueBases } from '../src/core/bundle';

const item = (base: string, backup: boolean) => ({
  base,
  name: `<${base}>`,
  width: 300,
  height: 250,
  zip: new Uint8Array(2048),
  previewHtml: '<!DOCTYPE html>',
  assets: [{ path: 'img/1.png', data: new Uint8Array(1) }],
  backup: backup ? new Uint8Array(1) : null,
  problems: backup ? [] : ['Too heavy'],
});

describe('bundleFiles', () => {
  it('lays out zips, backups, unzipped previews and a review page', () => {
    const files = bundleFiles([item('A_300x250', true), item('B_300x250', false)], 'Campaign');
    expect(files.map((f) => f.path)).toEqual([
      'preview.html',
      'zips/A_300x250.zip',
      'backups/A_300x250.jpg',
      'preview/A_300x250/index.html',
      'preview/A_300x250/img/1.png',
      'zips/B_300x250.zip',
      'preview/B_300x250/index.html',
      'preview/B_300x250/img/1.png',
    ]);
    const page = files[0].data as string;
    expect(page).toContain('<iframe src="preview/A_300x250/index.html" width="300" height="250" title="&lt;A_300x250&gt;">');
    expect(page).toContain('300×250 · 2.0 KB');
    expect(page).toContain('<li>Too heavy</li>');
  });
});

describe('uniqueBases', () => {
  it('suffixes repeats', () => {
    expect(uniqueBases(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a_2', 'a_3']);
  });
});
