import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });

// UI must be a single HTML file, so the bundled script is inlined into the template.
const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
      const template = await readFile('src/ui/ui.html', 'utf8');
      const html = template.replace('<!-- SCRIPT -->', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
      await writeFile('dist/ui.html', html);
    });
  },
};

const common = { bundle: true, target: 'es2019', logLevel: 'info', jsx: 'automatic', jsxImportSource: 'preact' };

const main = await esbuild.context({ ...common, entryPoints: ['src/main/code.ts'], outfile: 'dist/code.js' });
const ui = await esbuild.context({ ...common, entryPoints: ['src/ui/ui.tsx'], outfile: 'dist/ui.js', write: false, plugins: [inlineUi] });

if (watch) {
  await Promise.all([main.watch(), ui.watch()]);
} else {
  await Promise.all([main.rebuild(), ui.rebuild()]);
  await Promise.all([main.dispose(), ui.dispose()]);
}
