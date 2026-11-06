// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Pablo Gil Fernández

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {DrawingHistory} from './model.js';
import {drawingRegions, accelerator, paintStroke, brushPreview, chromeParams} from './drawing.js';

const IFACE = 'org.teacherspen.Gnome1';
const PATH = '/org/teacherspen/Gnome1';
const XML = `<node><interface name="${IFACE}">
<method name="Dispatch"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<signal name="Event"><arg type="s"/></signal>
</interface></node>`;

export default class TeachersPen extends Extension {
    _addChrome(actor, input) {
        // The X11 input-region option was removed in Shell 50. On Wayland,
        // actor.reactive controls picking; keep the legacy option for Shell 46.
        const params = chromeParams(Config.PACKAGE_VERSION, input);
        Main.layoutManager.addChrome(actor, params);
    }

    enable() {
        this._owner = null;
        this._controlClones = new Map();
        this._held = new Map(); this._holdGrab = null;
        this._areas = []; this._escape = 0; this._bindings = new Map(); this._state = null; this._controls = [];
        this._exported = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._exported.export(Gio.DBus.session, PATH);
        this._name = Gio.bus_own_name_on_connection(Gio.DBus.session, IFACE, Gio.BusNameOwnerFlags.NONE, null, null);
        this._accelerator = global.display.connect('accelerator-activated', (_display, id) => {
            const action = this._bindings.get(id);
            if (id === this._escape) { this._stopDrawing(); return; }
            if (action && !Main.overview.visible && !Main.sessionMode.isLocked)
                this._activateShortcut(id, action);
        });
        this._keyCapture = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() === Clutter.EventType.MOTION) this._movePreview(...event.get_coords());
            return this._captureKey(event);
        });
        this._monitors = Main.layoutManager.connect('monitors-changed', () => {
            // Monitor IDs and logical coordinates must be renegotiated by the app.
            this._reset(); this._emit({type: 'disconnected', error: 'Screen layout changed. Restart TeachersPen.'});
        });
        this._lock = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked) { this._reset(); this._emit({type: 'disconnected', error: 'Session locked. Restart TeachersPen after unlocking.'}); }
        });
        this._overview = Main.overview.connect('showing', () => { this._clearControlClones(); this._stopDrawing(); for (const area of this._areas) area.actor.hide(); });
        this._overviewHidden = Main.overview.connect('hidden', () => { for (const area of this._areas) area.actor.show(); this._updateControlClones(); });
        this._windowMapped = global.window_manager.connect('map', () => this._updateControlClones());
        this._watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (this._owner && GLib.get_monotonic_time() - this._lastPing > 6000000) {
                this._reset(); this._emit({type: 'disconnected', error: 'TeachersPen connection timed out. Restart TeachersPen.'});
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    DispatchAsync([op, raw], invocation) {
        try {
            if (raw.length > 262144) throw new Error('Request too large');
            const sender = invocation.get_sender();
            if (op === 'connect') {
                if (this._owner && this._owner !== sender) throw new Error('TeachersPen is already connected');
                if (Main.sessionMode.isLocked) throw new Error('Session is locked');
                if (!this._owner) {
                    this._owner = sender;
                    this._watch = Gio.bus_watch_name_on_connection(Gio.DBus.session, sender, Gio.BusNameWatcherFlags.NONE,
                        null, () => this._detach());
                }
            } else if (sender !== this._owner) throw new Error('No active TeachersPen connection');
            const result = this._dispatch(op, JSON.parse(raw));
            invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(result ?? null)]));
        } catch (error) {
            invocation.return_dbus_error(`${IFACE}.Error`, String(error.message ?? error));
        }
    }

    _dispatch(op, args) {
        switch (op) {
        case 'connect': this._lastPing = GLib.get_monotonic_time(); return {version: 2, holdAvailable: true, controlCompositing: true, extensionVersion: this.metadata.version};
        case 'screens': return Main.layoutManager.monitors.map((m, id) => {
            const area = Main.layoutManager.getWorkAreaForMonitor(id);
            return {id, bounds: {x: m.x, y: m.y, width: m.width, height: m.height},
                workArea: {x: area.x, y: area.y, width: area.width, height: area.height}, scaleFactor: 1};
        });
        case 'cursor': {
            const [x, y] = global.get_pointer();
            const display = Main.layoutManager.monitors.findIndex(m => x >= m.x && y >= m.y && x < m.x + m.width && y < m.y + m.height);
            return {x, y, display: Math.max(0, display)};
        }
        case 'create': this._create(Number(args.label.slice(8))); return null;
        case 'window': {
            const area = this._area(args.label);
            if (args.action === 'get-bounds') return area.monitor;
            // Input/focus is managed by Shell when the full state is published.
            if (args.action === 'hide') { area.actor.hide(); this._stopDrawing(); }
            if (args.action === 'show') area.actor.show();
            return null;
        }
        case 'broadcast':
            // A release may beat a queued WebView update. Never reacquire input
            // from a stale held state after the physical key has been released.
            if (args.state.holding && !this._held.size) {
                args.state.holding = false; args.state.drawing = false;
            }
            if (this._state?.holding && !args.state.drawing) this._cancelHolds();
            this._state = args.state;
            if (!this._state.drawing) this._finish();
            this._controls = args.controls;
            this._update(); return null;
        case 'action': {
            const area = this._area(args.label);
            this._finish();
            if (['undo', 'redo', 'clear'].includes(args.action)) area.history[args.action]();
            area.actor.queue_repaint(); this._history(area); return null;
        }
        case 'shortcuts': return this._shortcuts(args);
        case 'ping':
            // GTK may report a mapped window before Mutter exposes its actor.
            // Retry even when its geometry has not changed since broadcast.
            this._updateControlClones();
            if (this._holdGrab && Main.modalCount > 1) this._cancelHolds();
            this._lastPing = GLib.get_monotonic_time();
            if (JSON.stringify(args) !== JSON.stringify(this._controls)) { this._controls = args; this._update(); }
            return true;
        case 'disconnect': this._detach(); return null;
        default: throw new Error(`Unknown operation ${op}`);
        }
    }

    _area(label) {
        const area = this._areas.find(a => a.id === Number(label.slice(8)));
        if (!area) throw new Error('Unknown monitor');
        return area;
    }

    _emit(event) {
        if (this._owner) this._exported.emit_signal('Event', new GLib.Variant('(s)', [JSON.stringify(event)]));
    }

    _command(area, command) { this._emit({type: 'command', source: `overlay-${area.id}`, command}); }
    _history(area) {
        this._command(area, {type: 'history-state', hasDrawings: area.history.strokes.length > 0,
            canUndo: area.history.canUndo, canRedo: area.history.canRedo});
    }

    _create(id) {
        if (this._areas.some(a => a.id === id)) return;
        const m = Main.layoutManager.monitors[id];
        if (!m) throw new Error('Unknown monitor');
        const actor = new St.DrawingArea({x: m.x, y: m.y, width: m.width, height: m.height, reactive: false});
        const area = {id, actor, monitor: {x: m.x, y: m.y, width: m.width, height: m.height}, history: new DrawingHistory(), inputs: []};
        actor.connect('repaint', () => this._paint(area));
        this._addChrome(actor, false);
        area.hint = new St.Label({reactive: false, visible: false,
            style: 'background-color: rgba(23, 37, 54, 0.91); color: white; padding: 8px 16px; border-radius: 18px; font-size: 12px;'});
        area.hint.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._addChrome(area.hint, false);
        this._areas.push(area);
    }

    _movePreview(x, y) {
        if (!this._state?.drawing) return;
        const previous = this._pointer;
        this._pointer = {x, y};
        for (const area of this._areas) {
            const contains = p => p && p.x >= area.monitor.x && p.y >= area.monitor.y
                && p.x < area.monitor.x + area.monitor.width && p.y < area.monitor.y + area.monitor.height;
            if (contains(previous) || contains(this._pointer)) area.actor.queue_repaint();
        }
    }

    _paint(area) {
        const cr = area.actor.get_context();
        try {
            const state = this._state;
            if (!state) return;
            const regions = drawingRegions(area.monitor, this._controls);
            for (const r of regions) cr.rectangle(r.x - area.monitor.x, r.y - area.monitor.y, r.width, r.height);
            cr.clip();
            if (state.visible && state.background !== 'transparent') {
                const value = state.background === 'white' ? 1 : 0;
                cr.setSourceRGBA(value, value, value, 1); cr.paint();
            }
            if (state.visible) {
                for (const stroke of area.history.strokes) paintStroke(cr, stroke);
                if (this._stroke?.area === area) paintStroke(cr, this._stroke.stroke);
            }
            const preview = brushPreview(state, this._pointer, area.monitor, this._controls,
                !!this._stroke || Main.overview.visible || Main.sessionMode.isLocked);
            if (preview) paintStroke(cr, preview);
        } finally { cr.$dispose(); }
    }

    _updateHint(area, drawing) {
        const text = this._state?.drawingHint;
        const visible = !!(drawing && this._state.settings.drawingHints && !this._state.pie && text);
        area.hint.visible = visible;
        if (!visible) return;
        area.hint.set_text(text);
        const work = Main.layoutManager.getWorkAreaForMonitor(area.id);
        area.hint.set_width(-1);
        const width = Math.min(area.hint.get_preferred_width(-1)[1], Math.max(1, work.width - 16));
        area.hint.set_width(width);
        const height = area.hint.get_preferred_height(width)[1];
        area.hint.set_position(work.x + (work.width - width) / 2,
            Math.max(work.y, work.y + work.height - 26 - height));
    }

    _clearControlClone(role) {
        const clone = this._controlClones.get(role);
        if (!clone) return;
        this._controlClones.delete(role);
        const {actor, source, signals, opacity} = clone;
        for (const id of signals) source.disconnect(id);
        source.opacity = opacity;
        actor.destroy();
    }

    _clearControlClones() {
        for (const role of this._controlClones.keys()) this._clearControlClone(role);
    }

    _updateControlClones() {
        const wanted = new Map();
        if (this._state && !Main.overview.visible && !Main.sessionMode.isLocked) {
            const windows = global.get_window_actors();
            for (const control of this._controls) {
                const role = control.windowRole;
                if (!['teacherspen-toolbar', 'teacherspen-mini', 'teacherspen-timer-window',
                    'teacherspen-preferences', 'teacherspen-pie'].includes(role)) continue;
                if (role === 'teacherspen-pie' && !this._state.pie) continue;
                const source = windows.find(actor => actor.meta_window.get_pid() === control.pid
                    && actor.meta_window.get_role() === role && actor.visible);
                if (source) wanted.set(role, source);
            }
        }
        for (const [role, clone] of this._controlClones) {
            if (wanted.get(role) !== clone.source) this._clearControlClone(role);
        }
        for (const [role, source] of wanted) {
            if (this._controlClones.has(role)) continue;
            // Keep the real window mapped for focus/input. Composite its live
            // alpha content above the complete board and strokes, with no holes.
            const actor = new Clutter.Clone({source, reactive: false});
            actor.add_constraint(new Clutter.BindConstraint({source, coordinate: Clutter.BindCoordinate.ALL}));
            this._addChrome(actor, false);
            const opacity = source.opacity;
            const signals = [
                // A clone uses its own root opacity. Suppress the lower original
                // so translucent corners and shadows are composited only once.
                source.connect('notify::opacity', () => { if (source.opacity !== 0) source.opacity = 0; }),
                source.connect('destroy', () => this._clearControlClone(role)),
                source.connect('notify::visible', () => { if (!source.visible) this._clearControlClone(role); }),
            ];
            this._controlClones.set(role, {actor, source, signals, opacity});
            source.opacity = 0;
        }
        // Existing controls must remain above newly created monitor surfaces;
        // radial menus are last in the native controls list and paint on top.
        for (const role of wanted.keys()) {
            const actor = this._controlClones.get(role).actor;
            actor.get_parent().set_child_above_sibling(actor, null);
        }
    }

    _update() {
        this._updateControlClones();
        const drawing = this._state?.drawing && !Main.overview.visible && !Main.sessionMode.isLocked;
        const [x, y] = global.get_pointer();
        this._pointer = {x, y};
        if (drawing && !this._escape) {
            this._escape = global.display.grab_accelerator('Escape', Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
            if (this._escape) Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._escape), Shell.ActionMode.NORMAL);
        } else if (!drawing && this._escape) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._escape), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._escape); this._escape = 0;
        }
        // Separate reactive rectangles leave real holes for Tauri controls. The
        // drawing surface itself never intercepts input outside drawing mode.
        for (const area of this._areas) {
            this._updateHint(area, drawing);
            const signature = JSON.stringify([drawing, this._controls]);
            if (area.inputSignature === signature) { area.actor.queue_repaint(); continue; }
            area.inputSignature = signature;
            this._finish();
            for (const actor of area.inputs) actor.destroy();
            area.inputs = [];
            const active = this._state?.drawing && !Main.overview.visible && !Main.sessionMode.isLocked;
            if (active) {
                const regions = drawingRegions(area.monitor, this._controls, true);
                for (const rect of regions) {
                    const actor = new St.Widget({...rect, reactive: true});
                    actor.connect('button-press-event', (_a, event) => this._press(area, event));
                    actor.connect('motion-event', (_a, event) => this._motion(area, event));
                    actor.connect('button-release-event', (_a, event) => {
                        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                        this._motion(area, event); this._finish(); return Clutter.EVENT_STOP;
                    });
                    this._addChrome(actor, true);
                    area.inputs.push(actor);
                }
            }
            area.actor.queue_repaint();
        }
    }

    _press(area, event) {
        if (!this._state?.drawing) return Clutter.EVENT_PROPAGATE;
        if (event.get_button() === 3) {
            // Match the WebView backend: discard an unfinished stroke and return
            // input immediately, even while the activation shortcut is held.
            this._stroke = null;
            this._stopDrawing();
            return Clutter.EVENT_STOP;
        }
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        this._finish();
        const [x, y] = event.get_coords();
        const state = this._state;
        this._stroke = {area, stroke: {tool: state.tool, color: state.settings.colors[state.color],
            width: state.settings.width, transparency: state.settings.transparency,
            points: [{x: x - area.monitor.x, y: y - area.monitor.y}]}};
        this._command(area, {type: 'active-display'});
        area.actor.queue_repaint(); return Clutter.EVENT_STOP;
    }

    _motion(area, event) {
        if (!this._stroke || this._stroke.area !== area) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const point = {x: x - area.monitor.x, y: y - area.monitor.y};
        const stroke = this._stroke.stroke;
        if (stroke.tool === 'freehand' || stroke.points.length === 1) stroke.points.push(point);
        else stroke.points[1] = point;
        area.actor.queue_repaint(); return Clutter.EVENT_STOP;
    }

    _finish() {
        if (!this._stroke) return;
        const {area, stroke} = this._stroke; this._stroke = null;
        area.history.add(stroke); area.actor.queue_repaint(); this._history(area);
    }

    _stopDrawing() {
        this._cancelHolds();
        this._finish();
        if (this._state?.drawing) {
            this._state.drawing = false;
            this._emit({type: 'stop'});
        }
        this._update();
    }

    _activateShortcut(id, action) {
        const drawingAction = ['toggle', 'freehand', 'line', 'arrow', 'rectangle', 'circle', 'nextColor'].includes(action) || action.startsWith('color');
        if (this._state?.settings.activation !== 'hold' || !drawingAction) {
            this._emit({type: 'shortcut', action}); return;
        }
        if (this._held.has(id)) return;
        const binding = this._holdBindings.get(id);
        if (binding) {
            // Event masks use the keymap's physical modifier bits (e.g. Mod4),
            // while a configured Super modifier is virtual. Resolve again at
            // activation to handle Super and keyboard-layout changes correctly.
            const codes = new Set();
            const mask = global.get_pointer()[2];
            for (let code = 8; code < 768; code++) {
                if (global.display.get_keybinding_action(code, mask) === id) codes.add(code);
            }
            binding.codes = codes;
        }
        if (!binding?.codes.size) {
            this._emit({type: 'hold-error', error: 'Cannot monitor this shortcut. Choose a different shortcut.'}); return;
        }
        if (!this._holdGrab) {
            // GNOME 46 has no accelerator-deactivated signal. A temporary Shell
            // grab delivers real release events even over native Wayland clients.
            // Grab the stage so its drawing actors continue receiving pointer events.
            const grab = Main.pushModal(global.stage, {actionMode: Shell.ActionMode.NORMAL});
            this._holdGrab = grab;
            if (typeof grab.get_seat_state === 'function' && grab.get_seat_state() !== Clutter.GrabState.ALL) {
                this._dropHoldGrab();
                this._emit({type: 'hold-error', error: 'Cannot capture shortcut release. Try again.'}); return;
            }
        }
        this._held.set(id, binding);
        this._emit({type: 'hold', action, token: `gnome-${id}`, pressed: true});
    }

    _captureKey(event) {
        if (!this._holdGrab) return Clutter.EVENT_PROPAGATE;
        if (Main.modalCount > 1) { this._cancelHolds(); return Clutter.EVENT_PROPAGATE; }
        const type = event.type();
        if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.KEY_RELEASE) return Clutter.EVENT_PROPAGATE;
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this._stopDrawing(); return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.KEY_RELEASE) {
            const symbol = event.get_key_symbol();
            let modifier = 0;
            if ([Clutter.KEY_Control_L, Clutter.KEY_Control_R].includes(symbol)) modifier = Clutter.ModifierType.CONTROL_MASK;
            else if ([Clutter.KEY_Shift_L, Clutter.KEY_Shift_R].includes(symbol)) modifier = Clutter.ModifierType.SHIFT_MASK;
            else if ([Clutter.KEY_Alt_L, Clutter.KEY_Alt_R].includes(symbol)) modifier = Clutter.ModifierType.MOD1_MASK;
            else if ([Clutter.KEY_Super_L, Clutter.KEY_Super_R, Clutter.KEY_Meta_L, Clutter.KEY_Meta_R].includes(symbol)) modifier = Clutter.ModifierType.SUPER_MASK;
            for (const [id, binding] of [...this._held]) {
                if (binding.codes.has(event.get_key_code()) || (binding.mask & modifier)) this._releaseHold(id);
            }
        }
        // The grab keeps these events in Shell. Let Mutter process releases
        // so native clients receive correct modifier state when focus returns.
        return Clutter.EVENT_PROPAGATE;
    }

    _releaseHold(id) {
        if (!this._held.delete(id)) return;
        if (!this._held.size) {
            this._finish();
            if (this._state) { this._state.holding = false; this._state.drawing = false; }
            this._dropHoldGrab();
            this._update();
        }
        this._emit({type: 'hold', token: `gnome-${id}`, pressed: false});
    }

    _dropHoldGrab() {
        if (!this._holdGrab) return;
        const grab = this._holdGrab; this._holdGrab = null;
        Main.popModal(grab);
    }

    _cancelHolds() {
        for (const id of [...this._held.keys()]) this._releaseHold(id);
        this._dropHoldGrab();
    }

    _shortcuts(bindings) {
        this._clearBindings();
        this._holdBindings = new Map();
        const errors = [];
        for (const [action, shortcut] of Object.entries(bindings)) {
            try {
                const id = global.display.grab_accelerator(accelerator(shortcut), Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
                if (!id) throw new Error('Shortcut is already in use');
                Main.wm.allowKeybinding(Meta.external_binding_name_for_action(id), Shell.ActionMode.NORMAL);
                this._bindings.set(id, action);
                const masks = {Control: Clutter.ModifierType.CONTROL_MASK, CommandOrControl: Clutter.ModifierType.CONTROL_MASK,
                    Shift: Clutter.ModifierType.SHIFT_MASK, Alt: Clutter.ModifierType.MOD1_MASK,
                    Super: Clutter.ModifierType.SUPER_MASK, Meta: Clutter.ModifierType.SUPER_MASK};
                const mask = shortcut.split('+').slice(0, -1).reduce((value, modifier) => value | masks[modifier], 0);
                const codes = new Set();
                this._holdBindings.set(id, {codes, mask});
            } catch (error) { errors.push({action, shortcut, error: String(error.message ?? error)}); }
        }
        return errors;
    }

    _clearBindings() {
        this._cancelHolds();
        for (const id of this._bindings.keys()) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(id), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(id);
        }
        this._bindings.clear();
    }

    _reset() {
        this._clearControlClones();
        this._stroke = null; this._pointer = null; this._state = null; this._controls = [];
        this._clearBindings();
        if (this._escape) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._escape), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._escape); this._escape = 0;
        }
        for (const area of this._areas) {
            for (const actor of area.inputs) actor.destroy();
            area.hint.destroy();
            area.actor.destroy();
        }
        this._areas = [];
    }

    _detach() {
        this._reset();
        if (this._watch) { Gio.bus_unwatch_name(this._watch); this._watch = 0; }
        this._owner = null;
    }

    disable() {
        this._emit({type: 'disconnected', error: 'GNOME extension disabled. Restart TeachersPen or select X11/XWayland.'});
        this._detach();
        global.window_manager.disconnect(this._windowMapped);
        global.display.disconnect(this._accelerator);
        global.stage.disconnect(this._keyCapture);
        Main.layoutManager.disconnect(this._monitors);
        Main.sessionMode.disconnect(this._lock);
        Main.overview.disconnect(this._overview);
        Main.overview.disconnect(this._overviewHidden);
        GLib.source_remove(this._watchdog);
        Gio.bus_unown_name(this._name);
        this._exported.unexport(); this._exported = null;
    }
}
