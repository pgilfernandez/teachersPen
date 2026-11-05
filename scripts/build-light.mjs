import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import './build-native.mjs';
import './build-icons.mjs';
import { buildNotices } from './build-notices.mjs';
import { buildTarget } from './licensing.mjs';

const out = 'dist-light';
await mkdir(out, { recursive: true });
await mkdir('src-tauri/binaries', { recursive: true });
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const define = { "process.env.NODE_ENV": JSON.stringify("production"), __APP_VERSION__: JSON.stringify(metadata.version), __APP_COMMIT__: JSON.stringify(commit) };
const frontend = await build({ metafile: true, define, minify: true, entryPoints: ['src/native/entry.ts'], outfile: `${out}/renderer.js`, bundle: true, platform: 'browser', target: ['safari14', 'chrome90'], jsx: 'automatic', loader: { '.svg': 'text' } });
const html = (await readFile('src/renderer/index.html', 'utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '');
await writeFile(`${out}/index.html`, html);
await copyFile('src/renderer/styles.css', `${out}/styles.css`);
await copyFile('src/renderer/assets/mini-launcher.svg', `${out}/mini-launcher.svg`);
await copyFile('node_modules/dialog-polyfill/dist/dialog-polyfill.css', `${out}/dialog-polyfill.css`);
await cp('dist/icons', `${out}/icons`, { recursive: true });
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const targets = process.platform === 'darwin' ? ['x86_64-apple-darwin', 'aarch64-apple-darwin'] : [host];
const ext = process.platform === 'win32' ? '.exe' : '';
for (const target of targets) await copyFile(`dist/native/key-state${ext}`, `src-tauri/binaries/key-state-${target}${ext}`);

await buildNotices(buildTarget(), Object.keys(frontend.metafile.inputs));
