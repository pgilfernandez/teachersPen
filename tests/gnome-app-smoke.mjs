// Optional end-to-end check against a built AppRun/binary, in the nested session.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const shell = new Gio.DBusProxy({g_connection: Gio.DBus.session, g_name: 'org.gnome.Shell', g_object_path: '/org/gnome/Shell', g_interface_name: 'org.gnome.Shell'});
shell.init(null);
function evaluate(script) {
    const [ok, result] = shell.call_sync('Eval', new GLib.Variant('(s)', [script]), Gio.DBusCallFlags.NONE, 5000, null).deep_unpack();
    if (!ok) throw new Error(result); return result ? JSON.parse(result) : null;
}
const pause = () => {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { loop.quit(); return GLib.SOURCE_REMOVE; });
    loop.run();
};
function wait(script) {
    for (let attempt = 0; attempt < 400; attempt++) { if (evaluate(script)) return; pause(); }
    throw new Error(`Timed out waiting for ${script}`);
}
try {
    evaluate(`(() => {
        const Gio = global._teachersPenGio;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.set_environ(global.create_app_launch_context(0, -1).get_environment());
        launcher.setenv('GTK_USE_PORTAL', '0', true);
        launcher.setenv('NO_AT_BRIDGE', '1', true);
        launcher.setenv('DISPLAY', ${JSON.stringify(GLib.getenv('TEACHERSPEN_TEST_DISPLAY'))}, true);
        launcher.setenv('XAUTHORITY', ${JSON.stringify(GLib.getenv('TEACHERSPEN_TEST_XAUTHORITY'))}, true);
        launcher.setenv('XDG_CONFIG_HOME', ${JSON.stringify(GLib.getenv('TEACHERSPEN_TEST_ROOT') + '/config')}, true);
        launcher.set_stdout_file_path(${JSON.stringify(GLib.getenv('TEACHERSPEN_TEST_ROOT') + '/app.log')});
        launcher.set_stderr_file_path(${JSON.stringify(GLib.getenv('TEACHERSPEN_TEST_ROOT') + '/app-error.log')});
        global._teachersPenProcess = launcher.spawnv([${JSON.stringify(GLib.getenv('TEACHERSPEN_TEST_APP'))}]);
        return true;
    })()`);
    wait('global._teachersPenTest._areas.length > 0 && global._teachersPenTest._state !== null');
    if (evaluate('global._teachersPenTest._state.linuxBackend.active') !== 'gnome') throw new Error('Native app did not select GNOME');
    evaluate("global._teachersPenTest._emit({type: 'shortcut', action: 'toggle'}); true");
    wait('global._teachersPenTest._state.drawing === true');
    wait('global._teachersPenTest._areas[0].hint.visible');
    if (!evaluate('global._teachersPenTest._areas[0].hint.text === global._teachersPenTest._state.drawingHint')) throw new Error('Native hint does not match the localized controller text');
    evaluate("global._teachersPenTest._emit({type: 'shortcut', action: 'toggle'}); true");
    wait('global._teachersPenTest._state.drawing === false');
    evaluate("global._teachersPenTest._emit({type:'command', source:'preferences', command:{type:'activation', activation:'hold'}}); true");
    wait("global._teachersPenTest._state.settings.activation === 'hold'");
    if (!evaluate('global._teachersPenTest._state.holdAvailable')) throw new Error('Hold not available in the native app');
    const key = (symbol, down) => evaluate(`global._teachersPenKeys.notify_keyval(global._teachersPenTime(), global._teachersPenClutter.KEY_${symbol}, global._teachersPenClutter.KeyState.${down ? 'PRESSED' : 'RELEASED'}); true`);
    key('Control_L', true); key('Shift_L', true); key('space', true);
    wait('global._teachersPenTest._state.drawing && global._teachersPenTest._state.holding');
    key('space', false);
    wait('!global._teachersPenTest._state.drawing && !global._teachersPenTest._state.holding');
    // Deliver a tap before the hidden controller has time to complete its requests.
    key('space', true); key('space', false);
    for (let i = 0; i < 10; i++) pause();
    wait('!global._teachersPenTest._state.drawing && global._teachersPenTest._holdGrab === null');
    key('Shift_L', false); key('Control_L', false);
    print('Native app: hold press/release and a fast tap return input without a stale activation');
    evaluate("global._teachersPenTest._emit({type:'command', source:'preferences', command:{type:'linux-backend', backend:'x11'}}); true");
    wait("global._teachersPenTest._state.settings.linuxBackend === 'x11'");
    if (evaluate('global._teachersPenTest._state.linuxBackend.active') !== 'gnome') throw new Error('Backend switched before restart');
    print('Native app: automatic GNOME selection, shortcut round trip and saved backend selection passed');
} finally {
    evaluate('global._teachersPenProcess?.force_exit(); true');
}
wait('global._teachersPenTest._areas.length === 0');
print('Native app: process exit released all Shell drawing actors');
