import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RadialHover, radialSlotAt, isRadialActionEnabled } from '../src/radial';
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
    assert.equal(isRadialActionEnabled('visible', { hasDrawings: false, visible }), false);
    assert.equal(isRadialActionEnabled('clear', { hasDrawings: false, visible }), false);
    assert.equal(isRadialActionEnabled('visible', { hasDrawings: true, visible }), true);
    assert.equal(isRadialActionEnabled('clear', { hasDrawings: true, visible }), visible);
  }
  assert.equal(isRadialActionEnabled('freehand', { hasDrawings: false, visible: false }), true);
});
