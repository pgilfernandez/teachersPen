import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync('dist/native', { recursive: true });
const source = path.resolve('native/key-state.c');
const output = path.resolve('dist/native', process.platform === 'win32' ? 'key-state.exe' : 'key-state');
const options = { stdio: 'inherit' };
if (process.platform === 'darwin') {
  // The same small universal helper serves both macOS packages; no runtime compiler needed.
  execFileSync('clang', ['-std=c99', '-O2', '-Wall', '-Wextra', '-mmacosx-version-min=11.0', '-arch', 'x86_64', '-arch', 'arm64', source, '-framework', 'ApplicationServices', '-framework', 'Carbon', '-o', output], options);
} else if (process.platform === 'win32') {
  // Run packaging from the Visual Studio x64 Native Tools command prompt.
  execFileSync('cl', ['/nologo', '/O2', '/W3', '/MT', source, `/Fe:${output}`, `/Fo:${path.resolve('dist/native/key-state.obj')}`, 'user32.lib'], options);
} else if (process.platform === 'linux') {
  execFileSync('cc', ['-std=c99', '-D_DEFAULT_SOURCE', '-O2', '-Wall', '-Wextra', source, '-lX11', '-o', output], options);
} else throw new Error(`Plataforma no compatible: ${process.platform}`);
