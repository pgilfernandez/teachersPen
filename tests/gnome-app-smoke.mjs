// Optional end-to-end check against a built AppRun/binary, in the nested session.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
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
function screenshot(name) {
    const filename = GLib.getenv('TEACHERSPEN_TEST_ROOT') + '/' + name + '.png';
    const result = Gio.DBus.session.call_sync('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'Screenshot', new GLib.Variant('(bbs)', [false, false, filename]),
        null, Gio.DBusCallFlags.NONE, 5000, null).deep_unpack();
    if (!result[0]) throw new Error('Failed to capture compositor output');
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filename);
    const pixels = pixbuf.get_pixels();
    return (x,y) => {
        const offset = y * pixbuf.rowstride + x * pixbuf.n_channels;
        return Array.from(pixels.slice(offset, offset + 3));
    };
}
try {
    evaluate(`(() => {
        const Gio = global._teachersPenGio;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.set_environ(global.create_app_launch_context(0, -1).get_environment());
        launcher.setenv('GTK_USE_PORTAL', '0', true);
        launcher.setenv('NO_AT_BRIDGE', '1', true);
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
    for (const background of ['white', 'black', 'transparent']) {
        if (background !== 'transparent') {
            evaluate(`global._teachersPenTest._emit({type:'shortcut', action:'${background}'}); true`);
        } else {
            evaluate("global._teachersPenTest._emit({type:'shortcut', action:'black'}); true");
        }
        wait(`global._teachersPenTest._state.background === '${background}'`);
        evaluate("global._teachersPenTest._areas[0].history.strokes.push({tool:'line',color:'#ff0000',width:20,points:[{x:0,y:300},{x:800,y:300}]}); global._teachersPenTest._areas[0].actor.queue_repaint(); true");
        wait("global._teachersPenTest._controlClones.has('teacherspen-toolbar')");
        const toolbar = evaluate("global._teachersPenTest._controls.find(c => c.windowRole === 'teacherspen-toolbar')");
        const cornerX = Math.floor(toolbar.x) + 1, cornerY = Math.floor(toolbar.y) + 1;
        evaluate(`global._teachersPenTest._areas[0].history.strokes.push({tool:'line',color:'#00ff00',width:6,points:[{x:${cornerX - 10},y:${cornerY}},{x:${cornerX + 35},y:${cornerY}}]}); global._teachersPenTest._areas[0].actor.queue_repaint(); true`);
        const count = evaluate('global._teachersPenTest._areas[0].history.strokes.length');
        pause(); pause();
        const before = screenshot(background + '-before');
        const corner = before(cornerX, cornerY);
        if (corner[1] < 200 || corner[0] > 40 || corner[2] > 40) throw new Error(`Toolbar corner covers the trace on ${background}: ${corner}`);
        evaluate("global._teachersPenTest._emit({type:'shortcut', action:'pie'}); true");
        wait("global._teachersPenTest._controlClones.has('teacherspen-pie')");
        if (!evaluate(`(() => {
            const extension = global._teachersPenTest, clone = extension._controlClones.get('teacherspen-pie');
            const siblings = clone.actor.get_parent().get_children();
            return clone.actor.get_source() === clone.source && !clone.actor.reactive && clone.source.opacity === 0
                && extension._areas.every(area => siblings.indexOf(clone.actor) > siblings.indexOf(area.actor))
                && extension._areas[0].history.strokes.length === ${count};
        })()`)) throw new Error('Radial content is not above the unchanged drawing');
        // Let the WebView's appearance animation finish, then inspect actual
        // compositor pixels, including a trace beside the right-hand button.
        for (let frame = 0; frame < 5; frame++) pause();
        const after = screenshot(background + '-radial');
        const trace = after(468, 300);
        if (trace[0] < 240 || trace[1] > 20 || trace[2] > 20) throw new Error(`Radial damaged the trace on ${background}: ${trace}`);
        if (JSON.stringify(before(400, 250)) !== JSON.stringify(after(400, 250))) throw new Error('Transparent menu exposed the desktop or covered the drawing');
        if (JSON.stringify(before(400, 300)) === JSON.stringify(after(400, 300))) throw new Error('Radial center button is hidden behind the trace');
        evaluate('global._teachersPenMouse.notify_absolute_motion(global._teachersPenTime(), 400, 300); true');
        pause();
        evaluate('global._teachersPenMouse.notify_button(global._teachersPenTime(), 1, global._teachersPenClutter.ButtonState.PRESSED); true');
        pause();
        evaluate('global._teachersPenMouse.notify_button(global._teachersPenTime(), 1, global._teachersPenClutter.ButtonState.RELEASED); true');
        wait("!global._teachersPenTest._state.pie && !global._teachersPenTest._controlClones.has('teacherspen-pie')");
    }
    print('Native app: live transparent radial above board and strokes on white, black and transparent backgrounds; cleanup on close');
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
