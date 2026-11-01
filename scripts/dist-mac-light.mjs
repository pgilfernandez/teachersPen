import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('Build macOS packages on macOS.');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const cli = path.join(path.dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js');
execFileSync(process.execPath, [cli, 'build', '--bundles', 'app', ...args], { stdio: 'inherit' });
const targetAt = args.findIndex(arg => arg === '--target' || arg === '-t');
const target = targetAt >= 0 ? args[targetAt + 1] : args.find(arg => arg.startsWith('--target='))?.slice(9);
const architecture = target?.startsWith('aarch64') ? 'arm64' : target?.startsWith('x86_64') ? 'x64' : target?.startsWith('universal') ? 'universal' : process.arch;
const directory = path.resolve('src-tauri/target', ...(target ? [target] : []), args.includes('--debug') ? 'debug' : 'release', 'bundle');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const output = path.join(directory, 'dmg', `TeachersPen-${metadata.version}-macOS-${architecture}.dmg`);
const staging = await mkdtemp(path.join(os.tmpdir(), 'teacherspen-dmg-'));
try {
  await mkdir(path.dirname(output), { recursive: true });
  execFileSync('ditto', [path.join(directory, 'macos/TeachersPen.app'), path.join(staging, 'TeachersPen.app')], { stdio: 'inherit' });
  await symlink('/Applications', path.join(staging, 'Applications'));
  // Creating a disk image needs no Finder session, AppleScript or GUI layout.
  execFileSync('hdiutil', ['create', '-volname', 'TeachersPen', '-srcfolder', staging, '-fs', 'HFS+', '-format', 'UDZO', '-ov', output], { stdio: 'inherit' });
  console.log(`Created ${output}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
