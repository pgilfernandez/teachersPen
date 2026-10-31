import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MiniDrag, fitPosition, readPosition } from '../src/toolbar';
import { defaults, parseSettings } from '../src/shared';

test('a click tolerates a small pointer movement and dragging never becomes a click', () => {
  const drag = new MiniDrag();
  drag.begin({ x: 100, y: 100 }, { x: 30, y: 40 });
  assert.equal(drag.move({ x: 102, y: 101 }), null);
  assert.equal(drag.end({ x: 102, y: 101 })?.dragged, false);
  drag.begin({ x: 100, y: 100 }, { x: 30, y: 40 });
  assert.deepEqual(drag.move({ x: 120, y: 130 }), { x: 50, y: 70 });
  assert.equal(drag.end({ x: 100, y: 100 })?.dragged, true);
  assert.equal(drag.active, false);
});
test('positions survive negative monitor coordinates and are brought onto a connected screen', () => {
  assert.deepEqual(readPosition({ x: -1200, y: 100 }), { x: -1200, y: 100 });
  assert.equal(readPosition({ x: NaN, y: 20 }), null);
  assert.deepEqual(fitPosition({ x: -2000, y: 900 }, { width: 56, height: 56 }, { x: -1440, y: 25, width: 1440, height: 875 }), { x: -1440, y: 844 });
  assert.equal(defaults().toolbarMode, 'visible');
  assert.equal(parseSettings({ toolbarMode: 'minimal' }).toolbarMode, 'minimal');
  assert.equal(parseSettings({ toolbarMode: 'hidden' }).toolbarMode, 'hidden');
  assert.equal(parseSettings({ toolbarMode: 'invalid' }).toolbarMode, 'visible');
});
