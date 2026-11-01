import { spawn } from 'node:child_process';
import path from 'node:path';
const app = path.resolve('src-tauri/target/release/bundle/macos/TeachersPen.app');
// The Tauri CLI renames Cargo's output to productName (kebab-case on Linux).
const binary = path.resolve('src-tauri/target/release', process.platform === 'win32' ? 'TeachersPen.exe' : 'teachers-pen');
const child = process.platform === 'darwin' ? spawn('open', ['-n', app, '--args', ...process.argv.slice(2)], { stdio: 'inherit' }) : spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
