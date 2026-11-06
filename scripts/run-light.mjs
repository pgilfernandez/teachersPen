import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostEnvironment } from './host-environment.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.resolve(root, 'src-tauri/target/release/bundle/macos/TeachersPen.app');
// Match mainBinaryName in the Tauri configuration.
const binary = path.resolve(root, 'src-tauri/target/release', process.platform === 'win32' ? 'teachers-pen.exe' : 'teachers-pen');
const env = hostEnvironment(process.env);
const child = process.platform === 'darwin' ? spawn('open', ['-n', app, '--args', ...process.argv.slice(2)], { stdio: 'inherit', env }) : spawn(binary, process.argv.slice(2), { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
