import {execFileSync} from 'node:child_process';
import {mkdtemp, readdir, readFile, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyComplianceDirectory} from './licensing.mjs';

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const report = {verified: [], nativeLibraries: [], platform: process.platform,
  nativeLibraryReview: 'Inventory only: operating-system libraries and vendor runtimes require their own license/source review before release.'};
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
async function verifyDirectory(directory) {
  const files = await walk(directory);
  if (!files.some(file => path.basename(file) === 'LICENSE.md') || !files.some(file => path.basename(file) === 'NOTICE.md')) throw new Error('Missing original application license/notices');
  const manifests = files.filter(file => path.basename(file) === 'THIRD-PARTY-LICENSES.json');
  if (!manifests.length) throw new Error(`No third-party inventory in package: ${directory}`);
  for (const manifest of manifests) {
    const result = await verifyComplianceDirectory(path.dirname(manifest));
    report.verified.push({package: path.basename(directory), target: result.target, dependencies: result.packages.length});
  }
  for (const file of files.filter(file => /\.(so(\.[0-9]+)*|dylib|dll)$/i.test(file))) {
    report.nativeLibraries.push({file: path.relative(directory, file), sha256: createHash('sha256').update(await readFile(file)).digest('hex')});
  }
}
async function verifyGnome(archive) {
  const entries = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8'}).split(/\r?\n/);
  for (const file of ['LICENSE.md', 'NOTICE.md', 'LICENSE-MIT.txt', 'source/model.ts', 'build-model.mjs', 'BUILDING.md']) {
    if (!entries.includes(file)) throw new Error(`Missing GNOME source/license file: ${file}`);
  }
  for (const file of ['extension.js', 'drawing.js', 'build-model.mjs']) {
    const text = execFileSync('unzip', ['-p', archive, file], {encoding: 'utf8'});
    if (!text.includes('SPDX-License-Identifier: GPL-2.0-or-later')) throw new Error(`Wrong GNOME license: ${file}`);
  }
  const license = execFileSync('unzip', ['-p', archive, 'LICENSE.md'], {encoding: 'utf8'});
  if (!license.includes('GNU GENERAL PUBLIC LICENSE') || license.includes('PolyForm')) throw new Error('Wrong extension license');
  const model = execFileSync('unzip', ['-p', archive, 'model.js'], {encoding: 'utf8'});
  if (!model.includes('SPDX-License-Identifier: MIT')) throw new Error('Missing shared model MIT attribution');
  report.verified.push({package: path.basename(archive), license: 'GPL-2.0-or-later; shared model under MIT'});
}
const temp = await mkdtemp(path.join(tmpdir(), 'teacherspen-package-license-audit-'));
try {
  const directory = option('--directory');
  const app = option('--app');
  const gnome = option('--gnome');
  const bundle = option('--bundle-dir');
  if (!directory && !app && !gnome && !bundle) throw new Error('Specify --directory, --app, --gnome or --bundle-dir');
  if (directory) await verifyDirectory(directory);
  if (app) await verifyDirectory(app);
  if (gnome) await verifyGnome(path.resolve(gnome));
  if (bundle) {
    let checked = 0;
    for (const file of await walk(bundle)) {
      if (!/\.(deb|AppImage|exe)$/i.test(file) || !/^teachers[-_]?pen/i.test(path.basename(file))) continue;
      const destination = path.join(temp, String(checked++));
      await mkdir(destination);
      if (file.endsWith('.deb')) execFileSync('dpkg-deb', ['-x', path.resolve(file), destination]);
      else if (file.endsWith('.AppImage')) {
        const environment = {...process.env};
        delete environment.APPIMAGE_EXTRACT_AND_RUN;
        execFileSync(path.resolve(file), ['--appimage-extract'], {cwd: destination, env: environment, stdio: 'pipe', timeout: 120000, maxBuffer: 16 * 1024 * 1024});
      }
      else {
        const sevenZip = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip/7z.exe') : '7z';
        execFileSync(sevenZip, ['x', path.resolve(file), '-o' + destination, '-y'], {stdio: 'pipe'});
      }
      await verifyDirectory(destination);
    }
    if (!checked) throw new Error('No supported installers found to inspect');
  }
  const output = path.resolve(option('--report') || 'dist/license-package-review.json');
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Verified ${report.verified.length} license inventories; ${report.nativeLibraries.length} native libraries listed. Report: ${output}`);
} finally {
  await rm(temp, {recursive: true, force: true});
}
