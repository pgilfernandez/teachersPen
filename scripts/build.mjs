import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import './build-native.mjs';
import './build-icons.mjs';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
await build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
await build({ entryPoints: ['src/renderer/index.tsx'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', target: 'chrome138', jsx: 'automatic' });
await copyFile('src/renderer/index.html', 'dist/index.html');
await copyFile('src/renderer/styles.css', 'dist/styles.css');
await copyFile('src/renderer/assets/mini-launcher.svg', 'dist/mini-launcher.svg');
