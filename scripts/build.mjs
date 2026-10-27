import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = path.join(root, 'dist');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/background.js'],
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  legalComments: 'eof',
});
await Promise.all([
  cp(path.join(root, 'manifest.json'), path.join(outdir, 'manifest.json')),
  cp(path.join(root, 'data'), path.join(outdir, 'data'), { recursive: true }),
]);
console.log('Built unpacked Chrome extension in dist/');
