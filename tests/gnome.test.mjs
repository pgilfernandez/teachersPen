import test from 'node:test';
import assert from 'node:assert/strict';
import {subtract, accelerator} from '../extensions/gnome/drawing.js';

test('GNOME input regions leave holes for controls, including negative monitor coordinates', () => {
    const monitor = {x: -1920, y: -100, width: 1920, height: 1080};
    const holes = [{x: -1900, y: -80, width: 300, height: 50}, {x: -1700, y: -60, width: 200, height: 300}];
    let parts = [monitor];
    for (const hole of holes) parts = subtract(parts, hole);
    for (let y = -100; y < 980; y += 10) for (let x = -1920; x < 0; x += 10) {
        const contains = r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        assert.equal(parts.filter(contains).length, holes.some(contains) ? 0 : 1);
    }
    assert.deepEqual(subtract([monitor], monitor), []);
    assert.deepEqual(subtract([monitor], {x: 50, y: 50, width: 10, height: 10}), [monitor]);
});

test('GNOME accelerator conversion preserves the configured key and rejects unknown modifiers', () => {
    assert.equal(accelerator('Control+Shift+Space'), '<Control><Shift>space');
    assert.equal(accelerator('CommandOrControl+Alt+A'), '<Control><Alt>A');
    assert.throws(() => accelerator('Unknown+A'));
    assert.throws(() => accelerator('Control+'));
});
