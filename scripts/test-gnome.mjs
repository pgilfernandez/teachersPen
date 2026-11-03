import './build-gnome.mjs';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import path from 'node:path';
const root = await mkdtemp(path.join(tmpdir(), 'teacherspen-gnome-'));
const uuid = 'teacherspen@pgilfernandez.github.io';
const target = path.join(root, 'data/gnome-shell/extensions', uuid);
await mkdir(target, {recursive: true});
await cp(`dist/gnome/${uuid}`, target, {recursive: true});
// Only the isolated test copy exposes its instance to Shell's debug evaluator.
const extensionFile = path.join(target, 'extension.js');
await writeFile(extensionFile, (await readFile(extensionFile, 'utf8')).replace('enable() {', 'enable() { global.context.unsafe_mode = true; global._teachersPenTest = this; global._teachersPenMain = Main; global._teachersPenGio = Gio; global._teachersPenClutter = Clutter; global._teachersPenTime = () => GLib.get_monotonic_time();'));
const env = {...process.env, XDG_DATA_HOME: path.join(root, 'data'), XDG_DATA_DIRS: '/usr/local/share:/usr/share', GSETTINGS_BACKEND: 'memory', TEACHERSPEN_TEST_ROOT: root, TEACHERSPEN_TEST_DISPLAY: process.env.DISPLAY, TEACHERSPEN_TEST_XAUTHORITY: process.env.XAUTHORITY ?? ''};
for (const key of Object.keys(env)) if (key.startsWith('GIO_') || key.startsWith('GTK_') || key.startsWith('GDK_') || key === 'GSETTINGS_SCHEMA_DIR') delete env[key];
const script = `
gnome-shell --headless --virtual-monitor 800x600 --wayland --wayland-display teacherspen-test > "$TEACHERSPEN_TEST_ROOT/shell.log" 2>&1 &
shell_pid=$!
trap 'kill "$shell_pid" 2>/dev/null || true' EXIT
ready=0
for attempt in $(seq 1 30); do
    if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Extensions.EnableExtension teacherspen@pgilfernandez.github.io 2>/dev/null | grep -q true; then ready=1; break; fi
    sleep 1
done
if [ "$ready" != 1 ]; then exit 1; fi
sleep 1
export WAYLAND_DISPLAY=teacherspen-test
gjs -m tests/gnome-smoke.mjs
gjs -m tests/gnome-hold-smoke.mjs
if [ -n "${process.env.TEACHERSPEN_TEST_APP ? 'yes' : ''}" ]; then gjs -m tests/gnome-app-smoke.mjs; fi
`;
const child = spawn('dbus-run-session', ['--', 'bash', '-e', '-c', script], {env, stdio: ['ignore', 'inherit', 'pipe']});
let diagnostics = '';
child.stderr.on('data', chunk => { diagnostics += chunk; });
const code = await new Promise(resolve => child.on('exit', resolve));
const log = await readFile(path.join(root, 'shell.log'), 'utf8');
const errors = log.split('\n').filter(line => /teacherspen|drawing\.js|extension\.js|model\.js/i.test(line) && /error|critical|exception/i.test(line));
if (code !== 0 || errors.length) {
    await writeFile(path.join(root, 'diagnostics.log'), diagnostics);
    console.error(diagnostics.split('\n').filter(line => /Gjs-|JS ERROR|Timed out|Error:/.test(line)).join('\n'));
    console.error(errors.length ? errors.join('\n') : log.split('\n').slice(-12).join('\n'));
    console.error(`GNOME test logs: ${root}`);
    process.exitCode = 1;
} else await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
