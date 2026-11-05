import { spawn } from 'node:child_process';
import path from 'node:path';
const app = path.resolve('src-tauri/target/release/bundle/macos/TeachersPen.app');
// Match mainBinaryName in the Tauri configuration.
const binary = path.resolve('src-tauri/target/release', process.platform === 'win32' ? 'teachers-pen.exe' : 'teachers-pen');
const env = { ...process.env };
if (process.platform === 'linux' && env.SNAP) {
  // VS Code's Snap exports GTK/GIO modules built against its own glibc.
  // A host-native app must load modules from the host instead.
  for (const key of ['GTK_PATH', 'GTK_EXE_PREFIX', 'GIO_MODULE_DIR', 'GDK_PIXBUF_MODULE_FILE', 'GDK_PIXBUF_MODULEDIR', 'GTK_IM_MODULE_FILE']) {
    if (env[key]?.includes('/snap/')) delete env[key];
  }
}
const child = process.platform === 'darwin' ? spawn('open', ['-n', app, '--args', ...process.argv.slice(2)], { stdio: 'inherit', env }) : spawn(binary, process.argv.slice(2), { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
