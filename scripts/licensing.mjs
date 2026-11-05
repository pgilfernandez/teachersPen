import {execFileSync} from 'node:child_process';
import {readFile, readdir, access, lstat} from 'node:fs/promises';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '..');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const policy = await json(path.join(root, 'licenses/policy.json'));
const fallback = await json(path.join(root, 'licenses/third-party/index.json'));

export function licenseAllowed(expression, ecosystem, name) {
  if (typeof expression !== 'string' || !expression.trim() || !/^[A-Za-z0-9.+()\s/-]+$/.test(expression)) return false;
  const tokens = expression.replace(/\//g, ' OR ').match(/\(|\)|[A-Za-z0-9.+-]+/g) || [];
  let at = 0;
  const allowed = atom => policy.permissive.includes(atom) || (atom === 'BSD' && ecosystem === 'npm' && name === 'dialog-polyfill') ||
    (atom === 'MPL-2.0' && (ecosystem === 'cargo' ? policy.reviewedMplCargo.includes(name) :
      policy.reviewedMplNpm.some(base => name === base || name.startsWith(base + '-'))));
  function primary() {
    if (tokens[at] === '(') {
      at++; const result = or();
      if (tokens[at++] !== ')') throw new Error('Unbalanced license expression');
      return result;
    }
    let atom = tokens[at++];
    if (!atom || ['AND', 'OR', ')', 'WITH'].includes(atom)) throw new Error('Missing license');
    if (tokens[at] === 'WITH') { at++; atom += ' WITH ' + tokens[at++]; }
    return allowed(atom);
  }
  function and() { let result = primary(); while (tokens[at] === 'AND') { at++; const right = primary(); result = result && right; } return result; }
  function or() { let result = and(); while (tokens[at] === 'OR') { at++; const right = and(); result = result || right; } return result; }
  try { const result = or(); return at === tokens.length && result; } catch { return false; }
}

export function buildTarget() {
  return process.env.TEACHERSPEN_BUILD_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET ||
    execFileSync('rustc', ['-vV'], {encoding: 'utf8'}).match(/^host: (.+)$/m)[1];
}

export function cargoMetadata(target) {
  if (target === 'universal-apple-darwin') {
    const graphs = ['x86_64-apple-darwin', 'aarch64-apple-darwin'].map(cargoMetadata);
    return {...graphs[0],
      packages: [...new Map(graphs.flatMap(graph => graph.packages).map(pkg => [pkg.id, pkg])).values()],
      resolve: {...graphs[0].resolve, nodes: [...new Map(graphs.flatMap(graph => graph.resolve.nodes).map(node => [node.id, node])).values()]}
    };
  }
  const args = ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1', '--locked'];
  if (target) args.push('--filter-platform', target);
  return JSON.parse(execFileSync('cargo', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
}

export function cargoPackages(metadata) {
  const resolved = new Set(metadata.resolve.nodes.map(node => node.id));
  return metadata.packages.filter(pkg => resolved.has(pkg.id) && pkg.name !== 'teacherspen');
}

export function sourceLocation(pkg) {
  if (pkg.source?.startsWith('registry+')) return {
    sourceUrl: `https://crates.io/crates/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`,
    archiveUrl: `https://static.crates.io/crates/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.name)}-${encodeURIComponent(pkg.version)}.crate`
  };
  if (pkg.source?.startsWith('git+')) {
    const [repo, commit] = pkg.source.slice(4).split('#');
    const base = repo.split('?')[0].replace(/\.git$/, '');
    return {sourceUrl: `${base}/tree/${commit}`, archiveUrl: `${base}/archive/${commit}.tar.gz`};
  }
  throw new Error(`Unpinned dependency source: ${pkg.name} ${pkg.version}`);
}

export async function licenseTexts(pkg) {
  const directory = path.dirname(pkg.manifest_path);
  const found = [];
  async function collect(entry, depth = 0) {
    const stat = await lstat(entry);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      if (depth >= 4) throw new Error(`License directory too deep: ${entry}`);
      for (const file of await readdir(entry)) await collect(path.join(entry, file), depth + 1);
    } else if (stat.isFile()) {
      const data = await readFile(entry);
      if (data.includes(0)) throw new Error(`Non-text license: ${entry}`);
      if (data.length) found.push({file: path.relative(directory, entry), text: data.toString('utf8')});
    }
  }
  for (const file of (await readdir(directory)).sort()) {
    if (/^(licen[cs]es?|copying|notice|copyright)([.\-_]|$)/i.test(file)) await collect(path.join(directory, file));
  }
  if (pkg.license_file) {
    const file = path.resolve(directory, pkg.license_file);
    if (!found.some(text => path.resolve(directory, text.file) === file)) await collect(file);
  }
  if (!found.length) {
    const entry = fallback[`${pkg.name}@${pkg.version}`];
    if (!entry || entry.license !== pkg.license) throw new Error(`Missing reviewed license text: ${pkg.name}@${pkg.version}`);
    if (entry.standardText) {
      const attribution = new Set();
      async function headers(folder, depth = 0) {
        if (depth > 2) return;
        for (const file of await readdir(folder, {withFileTypes: true})) {
          const full = path.join(folder, file.name);
          if (file.isDirectory() && ['src', 'extern', 'Windows'].includes(file.name)) await headers(full, depth + 1);
          else if (file.isFile() && /\.(rs|c|h|m|md|txt)$/i.test(file.name)) {
            const lines = (await readFile(full, 'utf8')).split('\n');
            for (const line of lines) if (/copyright/i.test(line)) attribution.add(line.trim());
          }
        }
      }
      await headers(directory);
      found.push({file: 'UPSTREAM-ATTRIBUTION', text: 'Upstream declares ' + pkg.license + ' in Cargo.toml but publishes no standalone license text.\n' +
        'Original manifest authors: ' + (pkg.authors || []).join('; ') + '\n' + [...attribution].join('\n')});
    }
    for (const item of entry.files) found.push({file: item.file, url: item.url, text: await readFile(path.join(root, 'licenses/third-party', item.file), 'utf8')});
  }
  if (!found.length) throw new Error(`Empty license text: ${pkg.name}`);
  return found;
}

export async function npmPackages() {
  const lock = await json(path.join(root, 'package-lock.json'));
  return Object.entries(lock.packages).filter(([directory]) => directory).map(([directory, pkg]) => ({
    name: directory.split('node_modules/').at(-1), version: pkg.version, license: pkg.license,
    directory, sourceUrl: pkg.resolved, integrity: pkg.integrity
  }));
}

export async function validateLicenses(metadata) {
  const errors = [];
  for (const pkg of cargoPackages(metadata)) {
    if (!licenseAllowed(pkg.license, 'cargo', pkg.name)) errors.push(`Cargo ${pkg.name}@${pkg.version}: ${pkg.license || 'no license'}`);
    try { await licenseTexts(pkg); } catch (error) { errors.push(error.message); }
  }
  for (const pkg of await npmPackages()) {
    if (!licenseAllowed(pkg.license, 'npm', pkg.name)) errors.push(`npm ${pkg.name}@${pkg.version}: ${pkg.license || 'no license'}`);
  }
  const nativeApp = metadata.packages.find(pkg => pkg.name === 'teacherspen');
  if (nativeApp?.license !== policy.projectLicense) errors.push('Native desktop project license changed; review required');
  const app = await json(path.join(root, 'package.json'));
  if (app.license !== policy.projectLicense) errors.push('Desktop project license changed; review required');
  for (const file of ['extensions/gnome/extension.js', 'extensions/gnome/drawing.js', 'extensions/gnome/build-model.mjs']) {
    if (!(await readFile(path.join(root, file), 'utf8')).includes('SPDX-License-Identifier: GPL-2.0-or-later')) errors.push(`Missing GNOME GPL license: ${file}`);
  }
  if (!(await readFile(path.join(root, 'src/model.ts'), 'utf8')).includes('SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 OR MIT')) errors.push('Shared model must retain its MIT alternative');
  await access(path.join(root, 'extensions/gnome/LICENSE.md'));
  if (await readFile(path.join(root, 'extensions/gnome/LICENSE.md'), 'utf8') !== await readFile(path.join(root, 'licenses/GPL-2.0-or-later.txt'), 'utf8')) errors.push('GNOME package must retain the complete GPL license text');
  if (errors.length) throw new Error('License review failed:\n' + errors.map(error => '- ' + error).join('\n'));
}

export async function verifyComplianceDirectory(directory) {
  const manifest = await json(path.join(directory, 'THIRD-PARTY-LICENSES.json'));
  if (!manifest.target || !Array.isArray(manifest.packages) || !manifest.packages.length) throw new Error('Empty packaged license inventory');
  const notices = await readFile(path.join(directory, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  const archive = path.join(directory, 'THIRD-PARTY-SOURCES.tar.gz');
  const entries = execFileSync('tar', ['-tzf', archive], {encoding: 'utf8'}).split(/\r?\n/);
  const archiveFiles = new Set(entries.map(file => file.replace(/^\.\//, '')));
  for (const file of archiveFiles) if (file.startsWith('/') || file.split('/').includes('..')) throw new Error('Unsafe path in source archive');
  for (const pkg of manifest.packages) {
    if (!licenseAllowed(pkg.license, pkg.ecosystem, pkg.name)) throw new Error(`Unreviewed packaged license: ${pkg.name}`);
    if (!notices.includes(`${pkg.name} ${pkg.version}`) || !notices.includes(pkg.sourceUrl)) throw new Error(`Missing packaged notice/source URL: ${pkg.name}`);
    if (pkg.license.includes('MPL-2.0') && pkg.ecosystem === 'cargo') {
      if (!pkg.sourceDirectory || !pkg.sourceFiles?.includes('Cargo.toml')) throw new Error(`Missing MPL source manifest: ${pkg.name}`);
      for (const file of pkg.sourceFiles) {
        if (!archiveFiles.has(pkg.sourceDirectory + '/' + file)) throw new Error(`Missing MPL source file: ${pkg.name}/${file}`);
      }
    }
  }
  return manifest;
}
