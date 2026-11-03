import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoldActivation, isDrawingShortcut, type HoldMonitor } from '../src/hold';

test('background shortcuts do not activate held drawing', () => {
  assert.equal(isDrawingShortcut('white'), false);
  assert.equal(isDrawingShortcut('black'), false);
  assert.equal(isDrawingShortcut('freehand'), true);
});

function setup() {
  const listeners = new Map<string, { down: () => void; up: () => void; error: (message: string) => void }>();
  const events: string[] = [];
  const monitor: HoldMonitor = {
    watch(shortcut, down, up, error) {
      listeners.set(shortcut, { down, up, error });
      return () => { events.push(`stop:${shortcut}`); };
    }
  };
  const hold = new HoldActivation(monitor, action => events.push(action), () => events.push('released'), error => events.push(error));
  return { hold, listeners, events };
}
test('hold waits for native down, ignores repeat and releases only after the last held shortcut', () => {
  const { hold, listeners, events } = setup();
  hold.press('freehand', 'Ctrl+A');
  assert.deepEqual(events, []);
  listeners.get('Ctrl+A')!.down();
  hold.press('freehand', 'Ctrl+A');
  listeners.get('Ctrl+A')!.down();
  hold.press('color0', 'Ctrl+E'); listeners.get('Ctrl+E')!.down();
  listeners.get('Ctrl+A')!.up();
  assert.deepEqual(events, ['freehand', 'color0']);
  listeners.get('Ctrl+E')!.up();
  assert.deepEqual(events, ['freehand', 'color0', 'released']);
});
test('a shortcut released before the helper is ready never activates drawing', () => {
  const { hold, listeners, events } = setup();
  hold.press('toggle', 'Ctrl+Space'); listeners.get('Ctrl+Space')!.up();
  assert.deepEqual(events, []);
  hold.press('toggle', 'Ctrl+Space'); listeners.get('Ctrl+Space')!.down();
  assert.deepEqual(events, ['toggle']);
});
test('switching tools while a second watcher starts does not cancel the new held shortcut', () => {
  const { hold, listeners, events } = setup();
  hold.press('freehand', 'Ctrl+A'); listeners.get('Ctrl+A')!.down();
  hold.press('line', 'Ctrl+Q'); listeners.get('Ctrl+A')!.up();
  assert.deepEqual(events, ['freehand']);
  listeners.get('Ctrl+Q')!.down(); listeners.get('Ctrl+Q')!.up();
  assert.deepEqual(events, ['freehand', 'line', 'released']);
});
test('Esc dismisses pending and active presses until physical release, even with auto-repeat', () => {
  const { hold, listeners, events } = setup();
  hold.press('freehand', 'Ctrl+A'); listeners.get('Ctrl+A')!.down();
  hold.press('color0', 'Ctrl+E');
  hold.dismiss();
  listeners.get('Ctrl+E')!.down();
  hold.press('freehand', 'Ctrl+A'); listeners.get('Ctrl+A')!.down();
  assert.deepEqual(events, ['freehand']);
  listeners.get('Ctrl+A')!.up(); listeners.get('Ctrl+E')!.up();
  hold.press('freehand', 'Ctrl+A'); listeners.get('Ctrl+A')!.down();
  assert.deepEqual(events, ['freehand', 'freehand']);
});
test('monitor failure releases drawing and stopped monitors cannot activate it later', () => {
  const { hold, listeners, events } = setup();
  hold.press('arrow', 'Ctrl+W'); listeners.get('Ctrl+W')!.down();
  listeners.get('Ctrl+W')!.error('native failure');
  assert.deepEqual(events, ['arrow', 'native failure', 'released']);
  hold.press('toggle', 'Ctrl+Space'); hold.stop();
  listeners.get('Ctrl+Space')!.down();
  assert.deepEqual(events, ['arrow', 'native failure', 'released', 'stop:Ctrl+Space']);
});
