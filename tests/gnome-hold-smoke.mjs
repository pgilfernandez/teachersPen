// Native virtual input in a headless compositor: the same event path as physical keyboards.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const proxy = new Gio.DBusProxy({g_connection: Gio.DBus.session, g_name: 'org.teacherspen.Gnome1', g_object_path: '/org/teacherspen/Gnome1', g_interface_name: 'org.teacherspen.Gnome1'});
proxy.init(null);
function call(op, args = {}) {
    return JSON.parse(proxy.call_sync('Dispatch', new GLib.Variant('(ss)', [op, JSON.stringify(args)]), Gio.DBusCallFlags.NONE, 3000, null).deep_unpack()[0]);
}
const shell = new Gio.DBusProxy({g_connection: Gio.DBus.session, g_name: 'org.gnome.Shell', g_object_path: '/org/gnome/Shell', g_interface_name: 'org.gnome.Shell'});
shell.init(null);
function evaluate(script) {
    const [ok, result] = shell.call_sync('Eval', new GLib.Variant('(s)', [script]), Gio.DBusCallFlags.NONE, 3000, null).deep_unpack();
    if (!ok) throw new Error(result); return result ? JSON.parse(result) : null;
}
function check(value, message) { if (!value) throw new Error(message); }
function pause() {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { loop.quit(); return GLib.SOURCE_REMOVE; }); loop.run();
    call('ping', []);
}
function wait(script) {
    for (let i = 0; i < 100; i++) { if (evaluate(script)) return; pause(); }
    throw new Error(`Timed out waiting for ${script}`);
}
function key(name, down) {
    const codes = {Control_L: 29, Shift_L: 42, space: 57, Alt_L: 56, A: 30, exclam: 2, Escape: 1, b: 48, c: 46, Super_L: 125, F12: 88};
    evaluate(`global._teachersPenKeys.notify_key(global._teachersPenTime(), ${codes[name]}, global._teachersPenClutter.KeyState.${down ? 'PRESSED' : 'RELEASED'}); true`);
    pause();
}
const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
launcher.setenv('GDK_BACKEND', 'wayland', true);
launcher.setenv('WAYLAND_DISPLAY', 'teacherspen-test', true);
launcher.setenv('GTK_USE_PORTAL', '0', true);
launcher.setenv('NO_AT_BRIDGE', '1', true);
launcher.set_stderr_file_path(`${GLib.getenv('TEACHERSPEN_TEST_ROOT')}/input-window.log`);
const nativeWindow = launcher.spawnv(['gjs', '-m', 'tests/gnome-input-window.mjs']);
check(call('connect').holdAvailable, 'extension advertises hold');
call('create', {label: 'overlay-0'});
const state = {drawing: false, holding: false, visible: true, tool: 'freehand', color: 0, background: 'transparent', settings: {activation: 'hold', width: 6, transparency: 0, colors: ['#ff0000']}};
call('broadcast', {state, controls: []});
check(call('shortcuts', {toggle: 'Control+Shift+Space', freehand: 'Control+Shift+A', color0: 'Control+Shift+1', line: 'Super+Shift+F12'}).length === 0, 'register held shortcuts');
evaluate('global._teachersPenKeys = global._teachersPenClutter.get_default_backend().get_default_seat().create_virtual_device(global._teachersPenClutter.InputDeviceType.KEYBOARD_DEVICE); true');
try {
    wait("global.get_window_actors().some(actor => actor.meta_window.get_title() === 'TeachersPen hold test')");
    evaluate("global.get_window_actors().find(actor => actor.meta_window.get_title() === 'TeachersPen hold test').meta_window.activate(global.get_current_time()); true");
    wait("global.display.focus_window?.get_title() === 'TeachersPen hold test'");
    key('c', true); key('c', false);
    key('Control_L', true); key('Shift_L', true); key('space', true);
    wait('global._teachersPenTest._held.size === 1');
    check(evaluate('global._teachersPenTest._holdGrab !== null'), 'keyboard is captured for hold');
    state.drawing = true; state.holding = true; call('broadcast', {state, controls: []});
    check(evaluate('global._teachersPenTest._areas[0].inputs.length') > 0, 'hold accepts drawing input');
    key('b', true); key('b', false);
    // Release the primary before any modifier; extra modifiers must not confuse it.
    key('Alt_L', true); key('space', false);
    wait('global._teachersPenTest._held.size === 0');
    check(evaluate('global._teachersPenTest._holdGrab === null && !global._teachersPenTest._state.drawing'), 'primary release immediately returns input');
    // A delayed frontend broadcast cannot reactivate a released hold.
    call('broadcast', {state, controls: []});
    check(evaluate('global._teachersPenTest._areas[0].inputs.length') === 0, 'ignore stale held state');
    key('Alt_L', false);
    // Two held shortcuts overlap. Releasing one must keep the other engaged.
    key('space', true); key('A', true);
    wait('global._teachersPenTest._held.size === 2');
    key('space', false);
    check(evaluate('global._teachersPenTest._held.size') === 1, 'overlapping key remains held');
    key('Shift_L', false);
    wait('global._teachersPenTest._holdGrab === null');
    key('A', false);
    // Shifted digits are matched by physical keycode, not their punctuation keysym.
    key('Shift_L', true); key('exclam', true);
    wait('global._teachersPenTest._held.size === 1');
    key('exclam', false);
    wait('global._teachersPenTest._held.size === 0');
    // Escape dismisses the current hold without waiting for its physical release.
    key('space', true); wait('global._teachersPenTest._held.size === 1');
    key('Escape', true); wait('global._teachersPenTest._holdGrab === null');
    key('Escape', false);
    for (let i = 0; i < 10; i++) pause();
    check(evaluate('global._teachersPenTest._held.size === 0 && global._teachersPenTest._holdGrab === null'), 'autorepeat cannot reactivate an escaped hold');
    key('space', false);
    key('Shift_L', false); key('Control_L', false);
    // Super uses a virtual modifier in configuration and a physical Mod4 mask
    // in keyboard events; both must resolve to the same held binding.
    key('Super_L', true); key('Shift_L', true); key('F12', true);
    wait('global._teachersPenTest._held.size === 1');
    key('F12', false); wait('global._teachersPenTest._holdGrab === null');
    key('Shift_L', false); key('Super_L', false);
    key('b', true); key('b', false);
    const [read, contents] = GLib.file_get_contents(`${GLib.getenv('TEACHERSPEN_TEST_ROOT')}/typed.txt`);
    check(read && new TextDecoder().decode(contents) === 'cb', 'native Wayland client receives typing after hold');
    check(evaluate('global._teachersPenMain.modalCount') === 0, 'no keyboard/pointer grab leaked');
    print('GNOME hold: real press/release, modifier release, overlap, shifted digits, Escape and stale updates passed');
} finally {
    // Always return the virtual keyboard and desktop input, even after a test failure.
    evaluate('global._teachersPenTest._cancelHolds(); true');
    call('disconnect');
    nativeWindow.force_exit();
}
