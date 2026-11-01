import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep the original license texts for the bundled code. Build dependencies may
// also appear here; including their notices avoids stripping required credit.
export async function buildNotices(target) {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1', '--locked', '--filter-platform', target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const chunks = ['TeachersPen third-party notices\nDependencies retain their own licenses. TeachersPen LICENSE.md and NOTICE.md apply to its original code.\n'];
  async function include(name, version, directory, license) {
    chunks.push(`\n${'='.repeat(72)}\n${name} ${version}\nLicense: ${license || 'See original license below'}\n`);
    for (const file of (await readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(file)).sort()) {
      try { chunks.push(`\n--- ${file} ---\n${await readFile(path.join(directory, file), 'utf8')}\n`); } catch { /* Some crates use directories for additional notices. */ }
    }
  }
  const resolved = new Set(metadata.resolve.nodes.map(node => node.id));
  for (const pkg of metadata.packages.filter(pkg => resolved.has(pkg.id) && pkg.name !== 'teacherspen').sort((a, b) => a.name.localeCompare(b.name))) await include(pkg.name, pkg.version, path.dirname(pkg.manifest_path), pkg.license);
  for (const name of ['react', 'react-dom', 'scheduler', 'loose-envify', 'js-tokens', '@tauri-apps/api', 'dialog-polyfill']) {
    const directory = path.join('node_modules', name); const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    await include(name, pkg.version, directory, pkg.license);
  }
  chunks.push(`\n--- Lucide artwork ---\n${await readFile('src/renderer/assets/icons/LICENSE-lucide.txt', 'utf8')}`);
  await writeFile('dist-light/THIRD-PARTY-NOTICES.txt', chunks.join(''));
}
