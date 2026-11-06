import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RadialHover, radialSlotAt, isRadialActionEnabled, pointInViewport } from '../src/radial';
import { defaults, getPieRadius } from '../src/shared';

test('unfocused radial hit testing uses final circular positions and excludes center and empty slots', () => {
  const settings = defaults().pie;
  const center = { x: 300, y: 300 };
  const radius = getPieRadius(settings);
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 - 90) * Math.PI / 180;
    const point = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    assert.equal(radialSlotAt(point, center, radius, settings.buttonSize, settings.slots), i);
    assert.equal(radialSlotAt(point, center, radius, settings.buttonSize, settings.slots.map(() => null)), null);
  }
  assert.equal(radialSlotAt(center, center, radius, settings.buttonSize, settings.slots), null);
  assert.equal(radialSlotAt(null, center, radius, settings.buttonSize, settings.slots), null);
});
test('hover requires continuous residence, resets between targets and activates only once', () => {
  const hover = new RadialHover();
  assert.equal(hover.update(0, 100, 80), null);
  assert.equal(hover.update(0, 170, 80), null);
  assert.equal(hover.update(1, 175, 80), null);
  assert.equal(hover.update(1, 254, 80), null);
  assert.equal(hover.update(null, 255, 80), null);
  assert.equal(hover.update(1, 300, 80), null);
  assert.equal(hover.update(1, 380, 80), 1);
  assert.equal(hover.update(1, 500, 80), null);
});
test('zero-delay hover still excludes the close button and outside positions', () => {
  const hover = new RadialHover();
  assert.equal(hover.update(null, 0, 0), null);
  assert.equal(hover.update(2, 10, 0), 2);
});

test('radial visibility and clear buttons match toolbar availability', () => {
  for (const visible of [false, true]) {
    assert.equal(isRadialActionEnabled('visible', { canUndo: false, canRedo: false, hasDrawings: false, visible }), false);
    assert.equal(isRadialActionEnabled('clear', { canUndo: false, canRedo: false, hasDrawings: false, visible }), false);
    assert.equal(isRadialActionEnabled('visible', { canUndo: false, canRedo: false, hasDrawings: true, visible }), true);
    assert.equal(isRadialActionEnabled('clear', { canUndo: false, canRedo: false, hasDrawings: true, visible }), visible);
  }
  assert.equal(isRadialActionEnabled('freehand', { canUndo: false, canRedo: false, hasDrawings: false, visible: false }), true);
});

test('radial undo and redo follow history availability independently of drawing visibility', () => {
  for (const canUndo of [false, true]) {
    for (const canRedo of [false, true]) {
      for (const visible of [false, true]) {
        for (const hasDrawings of [false, true]) {
          const state = { canUndo, canRedo, visible, hasDrawings };
          assert.equal(isRadialActionEnabled('undo', state), canUndo);
          assert.equal(isRadialActionEnabled('redo', state), canRedo);
        }
      }
    }
  }
});

test('radial pointer position uses the mapped viewport origin rather than the monitor origin', () => {
  assert.deepEqual(pointInViewport({ x: 500, y: 400 }, { x: 0, y: 32, width: 1920, height: 1048 }, { width: 1920, height: 1048 }), { x: 500, y: 368 });
  assert.deepEqual(pointInViewport({ x: -1500, y: 400 }, { x: -1920, y: 100, width: 1920, height: 1080 }, { width: 960, height: 540 }), { x: 210, y: 150 });
  assert.deepEqual(pointInViewport({ x: 2440, y: -100 }, { x: 1920, y: -400, width: 2560, height: 1440 }, { width: 1280, height: 720 }), { x: 260, y: 150 });
});
