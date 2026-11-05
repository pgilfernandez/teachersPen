import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, cp, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cargoMetadata, cargoPackages, licenseTexts, npmPackages, validateLicenses, sourceLocation} from './licensing.mjs';

async function sourceFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file, base));
    else if (entry.isFile()) files.push(path.relative(base, file).split(path.sep).join('/'));
    else throw new Error(`Unsupported entry in MPL source package: ${file}`);
  }
  return files.sort();
}

export async function buildNotices(target, inputs = []) {
  const metadata = cargoMetadata(target);
  await validateLicenses(metadata);
  const chunks = [
    'TeachersPen third-party notices\n\nPolyForm Noncommercial applies only to the original desktop code, except where an explicit SPDX alternative is provided.\n',
    'Third-party code retains its own terms, including rights to commercial use where granted.\n',
    'Exact unmodified MPL source packages and their build files are included in THIRD-PARTY-SOURCES.tar.gz next to this notice.\n',
    'Source locations, versions and licenses are also listed in THIRD-PARTY-LICENSES.json.\n',
    '\n--- MIT alternative for src/model.ts ---\n', await readFile('licenses/MIT.txt', 'utf8')
  ];
  const records = [];
  const sources = await mkdtemp(path.join(tmpdir(), 'teacherspen-license-sources-'));
  const append = (record, texts) => {
    records.push(record);
    chunks.push(`\n${'='.repeat(72)}\n${record.name} ${record.version}\nLicense: ${record.license}\nSource: ${record.sourceUrl}\n`);
    if (record.archiveUrl) chunks.push(`Exact source archive: ${record.archiveUrl}\n`);
    for (const text of texts) chunks.push(`\n--- ${text.file} ---\n${text.url ? 'License text source: ' + text.url + '\n' : ''}${text.text}\n`);
  };
  try {
    for (const pkg of cargoPackages(metadata).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
      const record = {ecosystem: 'cargo', name: pkg.name, version: pkg.version, license: pkg.license, ...sourceLocation(pkg)};
      append(record, await licenseTexts(pkg));
      if (pkg.license.includes('MPL-2.0')) {
        record.sourceDirectory = `${pkg.name}-${pkg.version}`;
        record.sourceFiles = await sourceFiles(path.dirname(pkg.manifest_path));
        await cp(path.dirname(pkg.manifest_path), path.join(sources, record.sourceDirectory), {recursive: true});
      }
    }
    const npm = await npmPackages();
    // Derive the actual frontend dependencies from esbuild instead of a hand-maintained list.
    const directories = new Set(inputs.filter(file => file.includes('node_modules/')).map(file => {
      const end = file.lastIndexOf('node_modules/') + 'node_modules/'.length;
      const rest = file.slice(end).split('/');
      return file.slice(0, end) + rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join('/');
    }));
    if (!directories.size) throw new Error('Frontend dependency inventory is empty');
    for (const directory of [...directories].sort()) {
      const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      const locked = npm.find(item => item.directory === directory);
      if (!locked || locked.version !== pkg.version) throw new Error(`Frontend dependency differs from lockfile: ${directory}`);
      if (pkg.license?.includes('MPL-2.0')) throw new Error(`MPL npm runtime dependency requires an explicit source distribution plan: ${pkg.name}`);
      append({ecosystem: 'npm', name: pkg.name, version: pkg.version, license: pkg.license, sourceUrl: locked.sourceUrl, integrity: locked.integrity},
        await licenseTexts({name: pkg.name, version: pkg.version, license: pkg.license, manifest_path: path.resolve(directory, 'package.json')}));
    }
    const iconLicense = await readFile('src/renderer/assets/icons/LICENSE-lucide.txt', 'utf8');
    chunks.push('\n--- Lucide / Feather artwork ---\n' + iconLicense);
    await cp('licenses/MPL-2.0.txt', path.join(sources, 'LICENSE-MPL-2.0.txt'));
    const manifest = {target, packages: records};
    await writeFile(path.join(sources, 'SOURCE-INDEX.json'), JSON.stringify(manifest, null, 2) + '\n');
    await mkdir('dist-light', {recursive: true});
    execFileSync('tar', ['-czf', path.resolve('dist-light/THIRD-PARTY-SOURCES.tar.gz'), '-C', sources, '.']);
    await writeFile('dist-light/THIRD-PARTY-NOTICES.txt', chunks.join(''));
    await writeFile('dist-light/THIRD-PARTY-LICENSES.json', JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Bundled notices for ${records.length} dependencies and exact MPL sources (${target}).`);
  } finally {
    await rm(sources, {recursive: true, force: true});
  }
}
