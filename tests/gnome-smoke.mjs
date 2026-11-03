// Run inside an isolated GNOME Shell session (npm run test:gnome).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const proxy = new Gio.DBusProxy({g_connection: Gio.DBus.session, g_name: 'org.teacherspen.Gnome1', g_object_path: '/org/teacherspen/Gnome1', g_interface_name: 'org.teacherspen.Gnome1'});
proxy.init(null);
function call(op, args = {}) {
    const result = proxy.call_sync('Dispatch', new GLib.Variant('(ss)', [op, JSON.stringify(args)]), Gio.DBusCallFlags.NONE, 3000, null);
    return JSON.parse(result.deep_unpack()[0]);
}
function check(value, message) { if (!value) throw new Error(message); }
const shell = new Gio.DBusProxy({g_connection: Gio.DBus.session, g_name: 'org.gnome.Shell', g_object_path: '/org/gnome/Shell', g_interface_name: 'org.gnome.Shell'});
shell.init(null);
function evaluate(script) {
    const [ok, result] = shell.call_sync('Eval', new GLib.Variant('(s)', [script]), Gio.DBusCallFlags.NONE, 3000, null).deep_unpack();
    check(ok, `Shell evaluator failed: ${result}`); return result ? JSON.parse(result) : null;
}
evaluate('global._teachersPenMain.overview.hide(); true');
const pause = () => {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => { loop.quit(); return GLib.SOURCE_REMOVE; });
    loop.run();
};
pause();
check(call('connect').version === 2, 'protocol version');
const screens = call('screens');
check(screens.length > 0 && screens[0].workArea.width > 0, 'logical monitors');
call('create', {label: 'overlay-0'});
const state = {drawing: true, visible: true, tool: 'freehand', color: 0, background: 'transparent', settings: {width: 6, transparency: 0, colors: ['#ff0000']}};
call('broadcast', {state, controls: [{x: 100, y: 100, width: 200, height: 50}]});
const errors = call('shortcuts', {toggle: 'Control+Shift+Space', freehand: 'Control+Shift+A'});
check(errors.length === 0, `register shortcuts: ${JSON.stringify(errors)}`);
for (const action of ['clear', 'undo', 'redo']) call('action', {label: 'overlay-0', action});
check(evaluate('global._teachersPenTest._areas[0].inputs.length') === 4, 'input region leaves a hole for controls');
check(evaluate('global._teachersPenTest._escape') > 0, 'Escape is registered while drawing');
for (const tool of ['freehand', 'line', 'arrow', 'rectangle', 'circle']) {
    state.tool = tool;
    call('broadcast', {state, controls: [{x: 100, y: 100, width: 200, height: 50}]});
    evaluate(`(() => {
        const extension = global._teachersPenTest, area = extension._areas[0];
        extension._press(area, {get_button: () => 1, get_coords: () => [20, 200]});
        extension._motion(area, {get_coords: () => [80, 260]});
        extension._finish();
        return true;
    })()`);
    pause();
}
check(evaluate('global._teachersPenTest._areas[0].history.strokes.length') === 5, 'all five tools create strokes');
call('action', {label: 'overlay-0', action: 'undo'});
check(evaluate('global._teachersPenTest._areas[0].history.strokes.length') === 4, 'undo a stroke');
call('action', {label: 'overlay-0', action: 'redo'});
check(evaluate('global._teachersPenTest._areas[0].history.strokes.length') === 5, 'redo a stroke');
call('ping', []);
// Keep the session alive for a paint frame so Cairo errors reach Shell's log.
pause();
state.drawing = false; call('broadcast', {state, controls: []});
check(evaluate('global._teachersPenTest._areas[0].inputs.length') === 0, 'mouse input is released after drawing');
call('disconnect');
check(evaluate('global._teachersPenTest._areas.length') === 0, 'disconnect removes all actors');
// A disconnected caller cannot control the desktop.
let denied = false;
try { call('create', {label: 'overlay-0'}); } catch { denied = true; }
check(denied, 'reject requests without a session');
print('GNOME 46: protocol, monitors, rendering, shortcuts, history and disconnect passed');
