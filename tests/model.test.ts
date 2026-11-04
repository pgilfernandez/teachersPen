import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSystemLanguage } from '../src/i18n';
import { DrawingHistory, type Stroke } from '../src/model';
import { actions, defaults, getPieRadius, parseSettings } from '../src/shared';

const stroke: Stroke = { tool: 'freehand', color: '#ff0000', width: 6, points: [{ x: 4, y: 7 }, { x: 8, y: 12 }] };

test('undo and redo availability follows edits, clearing and branching', () => {
  const history = new DrawingHistory();
  const available = () => [history.canUndo, history.canRedo];
  assert.deepEqual(available(), [false, false]);
  history.clear(); history.undo(); history.redo();
  assert.deepEqual(available(), [false, false]);
  history.add(stroke);
  assert.deepEqual(available(), [true, false]);
  history.undo();
  assert.deepEqual(available(), [false, true]);
  history.redo();
  assert.deepEqual(available(), [true, false]);
  history.clear(); history.undo();
  assert.deepEqual(available(), [true, true]);
  history.add(stroke);
  assert.deepEqual(available(), [true, false]);
  history.undo(); history.undo();
  assert.deepEqual(available(), [false, true]);
});
test('clear can be undone and a new stroke invalidates redo', () => {
  const history = new DrawingHistory();
  history.add(stroke); history.clear();
  assert.equal(history.strokes.length, 0);
  history.undo(); assert.deepEqual(history.strokes, [stroke]);
  history.undo(); assert.equal(history.strokes.length, 0);
  history.redo(); assert.deepEqual(history.strokes, [stroke]);
  history.undo(); history.add({ ...stroke, color: '#0000ff' }); history.redo();
  assert.equal(history.strokes.length, 1);
  assert.equal(history.strokes[0].color, '#0000ff');
});
test('preferences from disk are bounded, validated and retain the exit shortcut', () => {
  const settings = parseSettings({ width: 200, timerSeconds: -1, colors: ['red'], shortcuts: { toggle: '', arrow: 'Alt+A', undo: null } });
  assert.equal(settings.width, 40);
  assert.equal(settings.timerSeconds, 10);
  assert.deepEqual(settings.colors, defaults().colors);
  assert.equal(settings.shortcuts.toggle, defaults().shortcuts.toggle);
  assert.equal(settings.shortcuts.arrow, 'Alt+A');
  assert.equal(settings.shortcuts.undo, defaults().shortcuts.undo);
  const assigned = Object.values(defaults().shortcuts).filter(Boolean);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.equal(settings.activation, 'toggle', 'Las preferencias antiguas conservan la activación original');
  assert.equal(parseSettings({ activation: 'hold' }).activation, 'hold');
  assert.equal(parseSettings({ activation: 'unknown' }).activation, 'toggle');
});
test('radial preferences migrate old settings and constrain untrusted slots', () => {
  const old = parseSettings({ width: 4, shortcuts: { arrow: 'Alt+A' } });
  assert.equal(old.shortcuts.arrow, 'Alt+A');
  assert.equal(old.shortcuts.pie, 'Control+Shift+S');
  assert.equal(old.pie.slots.length, 8);
  const parsed = parseSettings({ pie: { animationMs: -10, radius: 999, hoverMs: 9999, trigger: 'invalid', slots: ['undo', 'pie', 'bogus', null, 'color1', 'line', 'clear', 'redo', 'timer'] } });
  assert.deepEqual(parsed.pie, { animationMs: 0, radius: 220, buttonSize: 48, hoverMs: 1500, trigger: 'click', slots: ['undo', null, null, null, 'color1', 'line', 'clear', 'redo'], slots2: defaults().pie.slots2 });
  assert.equal(parseSettings({ pie: { slots: [] } }).pie.slots.every(slot => slot === null), true);
});

test('eight colors preserve the old palette and use the configured default shortcuts', () => {
  const palette = ['#123456', '#234567', '#345678', '#456789', '#56789a'];
  const migrated = parseSettings({ colors: palette, shortcuts: { color0: 'Alt+1', pie: 'Alt+P' }, pie: { slots: ['undo'], hoverMs: 120 } });
  assert.equal(migrated.colors.length, 8);
  assert.deepEqual(migrated.colors.slice(0, 5), palette);
  assert.deepEqual(migrated.colors.slice(5), defaults().colors.slice(5));
  assert.equal(migrated.shortcuts.color0, 'Alt+1');
  assert.equal(migrated.shortcuts.pie, 'Alt+P');
  for (const action of ['color5', 'color6', 'color7'] as const) assert.equal(migrated.shortcuts[action], 'Control+Shift+' + (Number(action.slice(-1)) + 1));
  assert.equal(migrated.shortcuts.pie2, 'Control+Shift+W');
  assert.deepEqual(migrated.pie.slots, ['undo', null, null, null, null, null, null, null]);
  assert.deepEqual(migrated.pie.slots2, defaults().pie.slots2);
  assert.equal(migrated.pie.hoverMs, 120);
  assert.deepEqual(parseSettings(migrated), migrated);
});
test('both radial menus validate slots independently and support all eight colors', () => {
  const parsed = parseSettings({ pie: { slots: ['pie2', 'color7'], slots2: ['color5', 'color6', 'color7', 'pie', 'pie2', 'invalid', null, 'redo', 'undo'] } });
  assert.deepEqual(parsed.pie.slots, [null, 'color7', null, null, null, null, null, null]);
  assert.deepEqual(parsed.pie.slots2, ['color5', 'color6', 'color7', null, null, null, null, 'redo']);
  const changed = parseSettings({ ...parsed, pie: { ...parsed.pie, slots2: ['undo'] } });
  assert.deepEqual(changed.pie.slots, parsed.pie.slots);
  assert.equal(changed.pie.slots2[0], 'undo');
});

test('default shortcuts match the supplied configuration and preserve explicit unassignments', () => {
  const settings = defaults();
  assert.equal(settings.shortcuts.line, 'Control+Shift+D');
  assert.equal(settings.shortcuts.arrow, 'Control+Shift+F');
  assert.equal(settings.shortcuts.rectangle, 'Control+G');
  assert.equal(settings.shortcuts.circle, 'Control+Shift+H');
  assert.equal(settings.shortcuts.redo, 'Control+Alt+Shift+Z');
  assert.deepEqual(settings.pie.slots, ['freehand', 'line', 'arrow', 'black', 'visible', 'white', 'rectangle', 'circle']);
  assert.equal(parseSettings({ shortcuts: { color5: '' } }).shortcuts.color5, '');
});

test('radial button size migrates old settings and constrains saved values', () => {
  assert.equal(parseSettings({ pie: { radius: 100 } }).pie.buttonSize, 48);
  assert.equal(parseSettings({ pie: { buttonSize: 10 } }).pie.buttonSize, 24);
  assert.equal(parseSettings({ pie: { buttonSize: 200 } }).pie.buttonSize, 96);
  assert.equal(parseSettings({ pie: { buttonSize: 63.7 } }).pie.buttonSize, 64);
});

test('radial geometry stores a safe radius and keeps eight buttons apart', () => {
  for (const size of [24, 48, 72, 96]) {
    const settings = parseSettings({ pie: { buttonSize: size, radius: 0 } }).pie;
    const radius = getPieRadius(settings);
    assert.equal(settings.radius, radius);
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const distance = Math.hypot(
          radius * (Math.cos(i * Math.PI / 4) - Math.cos(j * Math.PI / 4)),
          radius * (Math.sin(i * Math.PI / 4) - Math.sin(j * Math.PI / 4)));
        assert.ok(distance >= size + 8 - 1e-9);
      }
    }
    assert.equal(getPieRadius({ ...settings, radius: 220 }), 220);
  }
  assert.equal(getPieRadius({ buttonSize: 24, radius: 50 }), 50);
  assert.equal(getPieRadius({ buttonSize: 96, radius: 80 }), 136);
  assert.equal(getPieRadius(defaults().pie), 100);
});

test('system language resolves supported regional locales and preserves manual choices', () => {
  assert.equal(resolveSystemLanguage(['es-ES']), 'es');
  assert.equal(resolveSystemLanguage(['fr_CA.UTF-8']), 'fr');
  assert.equal(resolveSystemLanguage(['pt-BR', 'de-DE']), 'de');
  assert.equal(resolveSystemLanguage(['ja-JP']), 'en');
  assert.equal(resolveSystemLanguage([]), 'en');
  assert.equal(defaults().followSystemLanguage, true);
  assert.equal(parseSettings({ language: 'es' }).followSystemLanguage, false);
  assert.equal(parseSettings({ language: 'es', followSystemLanguage: true }).followSystemLanguage, true);
  assert.equal(parseSettings({ language: 'fr', followSystemLanguage: false }).language, 'fr');
});

test('radius is raised in saved settings and can only go below that minimum with smaller buttons', () => {
  const large = parseSettings({ pie: { buttonSize: 96, radius: 40 } });
  assert.equal(large.pie.radius, 136);
  const invalid = parseSettings({ ...large, pie: { ...large.pie, radius: 50 } });
  assert.equal(invalid.pie.radius, 136);
  const smaller = parseSettings({ ...large, pie: { ...large.pie, buttonSize: 24 } });
  assert.equal(smaller.pie.radius, 136);
  assert.equal(parseSettings({ ...smaller, pie: { ...smaller.pie, radius: 50 } }).pie.radius, 50);
});

test('backend preference migrates old settings and retains a deliberate choice', () => {
    assert.equal(parseSettings({}).linuxBackend, 'auto');
    assert.equal(parseSettings({linuxBackend: 'invalid'}).linuxBackend, 'auto');
    for (const linuxBackend of ['auto', 'gnome', 'x11']) assert.equal(parseSettings({linuxBackend}).linuxBackend, linuxBackend);
});
