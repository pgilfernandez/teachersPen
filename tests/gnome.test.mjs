// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Pablo Gil Fernández

import test from 'node:test';
import assert from 'node:assert/strict';
import {subtract, accelerator, brushPreview, drawingRegions, chromeParams} from '../extensions/gnome/drawing.js';

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

test('GNOME brush preview follows the pointer with the selected color, width and transparency', () => {
    const monitor = {x: -1920, y: 100, width: 1920, height: 1080};
    const state = {drawing: true, pie: null, color: 1, settings: {colors: ['#ff0000', '#087bff'], width: 18, transparency: 25}};
    const point = {x: -1800, y: 240};
    assert.deepEqual(brushPreview(state, point, monitor), {
        tool: 'freehand', color: '#087bff', width: 18, transparency: 25, points: [{x: 120, y: 140}],
    });
    assert.equal(brushPreview(state, point, monitor, [{x: -1810, y: 230, width: 20, height: 20}]), null);
    assert.equal(brushPreview(state, point, monitor, [], true), null);
    assert.equal(brushPreview({...state, drawing: false}, point, monitor), null);
    assert.equal(brushPreview({...state, pie: {menu: 0}}, point, monitor), null);
    assert.equal(brushPreview(state, {x: 0, y: 240}, monitor), null);
    assert.equal(brushPreview(state, null, monitor), null);
});

test('opening a full-screen transparent radial keeps drawings visible while reserving input', () => {
    const monitor = {x: -1920, y: 100, width: 1920, height: 1080};
    const toolbar = {x: -1800, y: 120, width: 300, height: 50};
    const pie = {...monitor, inputOnly: true};
    assert.deepEqual(drawingRegions(monitor, [toolbar, pie]), drawingRegions(monitor, [toolbar]));
    assert.deepEqual(drawingRegions(monitor, [toolbar, pie], true), []);
    assert.deepEqual(drawingRegions(monitor, [toolbar], true), drawingRegions(monitor, [toolbar]));
});

test('chrome parameters retain GNOME 46 input handling and omit the removed option on 50', () => {
    assert.deepEqual(chromeParams('46.0', true), {trackFullscreen: false, affectsInputRegion: true});
    assert.deepEqual(chromeParams('46.0', false), {trackFullscreen: false, affectsInputRegion: false});
    assert.deepEqual(chromeParams('50.1', true), {trackFullscreen: false});
    assert.deepEqual(chromeParams('50.1', false), {trackFullscreen: false});
});
