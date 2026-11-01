import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import './build-native.mjs';
import './build-icons.mjs';

const metadata = JSON.parse(await readFile('package.json', 'utf8'));
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Source archives may not contain .git. */ }
const define = { __APP_VERSION__: JSON.stringify(metadata.version), __APP_COMMIT__: JSON.stringify(commit) };
await mkdir('dist', { recursive: true });
await build({ define, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
await build({ define, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
await build({ define, entryPoints: ['src/renderer/index.tsx'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', target: 'chrome138', jsx: 'automatic', loader: { '.svg': 'text' } });
await copyFile('src/renderer/index.html', 'dist/index.html');
await copyFile('src/renderer/styles.css', 'dist/styles.css');
await copyFile('src/renderer/assets/mini-launcher.svg', 'dist/mini-launcher.svg');
