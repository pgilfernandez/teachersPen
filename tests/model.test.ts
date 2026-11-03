import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingHistory, type Stroke } from '../src/model';
import { actions, defaults, parseSettings } from '../src/shared';

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
  assert.equal(new Set(Object.values(defaults().shortcuts)).size, actions.length);
  assert.equal(settings.activation, 'toggle', 'Las preferencias antiguas conservan la activación original');
  assert.equal(parseSettings({ activation: 'hold' }).activation, 'hold');
  assert.equal(parseSettings({ activation: 'unknown' }).activation, 'toggle');
});

test('backend preference migrates old settings and retains a deliberate choice', () => {
    assert.equal(parseSettings({}).linuxBackend, 'auto');
    assert.equal(parseSettings({linuxBackend: 'invalid'}).linuxBackend, 'auto');
    for (const linuxBackend of ['auto', 'gnome', 'x11']) assert.equal(parseSettings({linuxBackend}).linuxBackend, linuxBackend);
});
