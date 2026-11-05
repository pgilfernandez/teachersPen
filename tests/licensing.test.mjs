import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {licenseAllowed, licenseTexts} from '../scripts/licensing.mjs';

test('license policy requires every AND term but permits a legitimate OR alternative', () => {
  assert.equal(licenseAllowed('MIT OR Apache-2.0 OR LGPL-2.1-or-later', 'cargo', 'r-efi'), true);
  assert.equal(licenseAllowed('(MIT OR Apache-2.0) AND Unicode-3.0', 'cargo', 'unicode-ident'), true);
  assert.equal(licenseAllowed('MIT AND GPL-3.0-only', 'cargo', 'new-library'), false);
  assert.equal(licenseAllowed('GPL-2.0-or-later', 'cargo', 'new-library'), false);
  assert.equal(licenseAllowed('LGPL-2.1-or-later', 'cargo', 'new-library'), false);
  assert.equal(licenseAllowed('MIT!!!', 'cargo', 'new-library'), false);
  assert.equal(licenseAllowed('MIT AND', 'cargo', 'new-library'), false);
  assert.equal(licenseAllowed(null, 'cargo', 'new-library'), false);
});
test('MPL requires a reviewed component while SPDX legacy alternatives remain supported', () => {
  assert.equal(licenseAllowed('MPL-2.0', 'cargo', 'selectors'), true);
  assert.equal(licenseAllowed('MPL-2.0', 'cargo', 'new-library'), false);
  assert.equal(licenseAllowed('MPL-2.0', 'npm', '@resvg/resvg-js-darwin-arm64'), true);
  assert.equal(licenseAllowed('MIT/Apache-2.0', 'cargo', 'old-library'), true);
  assert.equal(licenseAllowed('Apache-2.0 WITH LLVM-exception', 'cargo', 'library'), true);
  assert.equal(licenseAllowed('Apache-2.0 WITH UNKNOWN-exception', 'cargo', 'library'), false);
});
test('license collection follows license directories and explicit files and rejects silent omissions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'teacherspen-license-test-'));
  try {
    await mkdir(path.join(dir, 'LICENSES'));
    await writeFile(path.join(dir, 'LICENSES', 'MIT.txt'), 'Original upstream attribution and license');
    const pkg = {name: 'fixture', version: '1.0.0', license: 'MIT', manifest_path: path.join(dir, 'Cargo.toml')};
    assert.equal((await licenseTexts(pkg))[0].text, 'Original upstream attribution and license');
    await rm(path.join(dir, 'LICENSES'), {recursive: true});
    await writeFile(path.join(dir, 'terms.txt'), 'Explicit license file');
    assert.equal((await licenseTexts({...pkg, license_file: 'terms.txt'}))[0].text, 'Explicit license file');
    await assert.rejects(licenseTexts(pkg), /Missing reviewed license text/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('package verification rejects an incomplete MPL source archive', async () => {
  const {execFileSync} = await import('node:child_process');
  const {verifyComplianceDirectory} = await import('../scripts/licensing.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'teacherspen-source-test-'));
  try {
    const source = path.join(dir, 'sources');
    await mkdir(path.join(source, 'selectors-0.22.0'), {recursive: true});
    await writeFile(path.join(source, 'selectors-0.22.0/Cargo.toml'), `name = "selectors"
version = "0.22.0"
`);
    const pkg = {ecosystem: 'cargo', name: 'selectors', version: '0.22.0', license: 'MPL-2.0',
      sourceUrl: 'https://crates.io/crates/selectors/0.22.0', sourceDirectory: 'selectors-0.22.0',
      sourceFiles: ['Cargo.toml', 'lib.rs']};
    await writeFile(path.join(dir, 'THIRD-PARTY-LICENSES.json'), JSON.stringify({target: 'test', packages: [pkg]}));
    await writeFile(path.join(dir, 'THIRD-PARTY-NOTICES.txt'), `selectors 0.22.0
` + pkg.sourceUrl);
    const archive = path.join(dir, 'THIRD-PARTY-SOURCES.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, '.']);
    await assert.rejects(verifyComplianceDirectory(dir), /Missing MPL source file/);
    await writeFile(path.join(source, 'selectors-0.22.0/lib.rs'), '// Original source');
    execFileSync('tar', ['-czf', archive, '-C', source, '.']);
    assert.equal((await verifyComplianceDirectory(dir)).packages.length, 1);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
