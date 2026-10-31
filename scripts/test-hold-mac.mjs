import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
if (process.platform !== 'darwin') throw new Error('Esta prueba de entrada nativa se ejecuta en macOS.');
mkdirSync('.artifacts', { recursive: true });
const probe = path.resolve('.artifacts/macos-input');
execFileSync('clang', ['-O2', '-mmacosx-version-min=11.0', 'tests/macos-input.c', '-framework', 'ApplicationServices', '-framework', 'Carbon', '-o', probe], { stdio: 'inherit' });
const check = spawnSync(probe, ['--check'], { stdio: 'inherit' });
if (check.status === 77) {
  console.log('Prueba nativa omitida: no hay permiso previo de simulación. Las pruebas unitarias no requieren ese permiso.');
} else if (check.status !== 0) process.exitCode = 1;
else {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/run.mjs', '--smoke-test', `--test-native-hold=${probe}`], { stdio: 'inherit' });
}
