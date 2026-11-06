// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Pablo Gil Fernández

// Pure geometry shared by the Shell renderer and its tests.
export function subtract(rectangles, hole) {
    const result = [];
    for (const r of rectangles) {
        const x = Math.max(r.x, hole.x), y = Math.max(r.y, hole.y);
        const right = Math.min(r.x + r.width, hole.x + hole.width);
        const bottom = Math.min(r.y + r.height, hole.y + hole.height);
        if (x >= right || y >= bottom) { result.push(r); continue; }
        for (const part of [
            {x: r.x, y: r.y, width: r.width, height: y - r.y},
            {x: r.x, y: bottom, width: r.width, height: r.y + r.height - bottom},
            {x: r.x, y, width: x - r.x, height: bottom - y},
            {x: right, y, width: r.x + r.width - right, height: bottom - y},
        ]) if (part.width > 0 && part.height > 0) result.push(part);
    }
    return result;
}

export function accelerator(shortcut) {
    const aliases = {Control: '<Control>', CommandOrControl: '<Control>', Shift: '<Shift>', Alt: '<Alt>', Super: '<Super>', Meta: '<Super>'};
    const parts = shortcut.split('+');
    const key = parts.pop();
    if (!key || parts.some(part => !aliases[part])) throw new Error('Unsupported shortcut');
    return parts.map(part => aliases[part]).join('') + (key === 'Space' ? 'space' : key);
}

export function paintStroke(cr, stroke) {
    const first = stroke.points[0], last = stroke.points.at(-1);
    if (!first) return;
    const rgb = stroke.color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
    cr.setSourceRGBA(...rgb, 1 - (stroke.transparency ?? 0) / 100);
    cr.setLineWidth(stroke.width);
    cr.setLineCap(1); cr.setLineJoin(1); cr.newPath();
    if (stroke.tool === 'circle') {
        const rx = Math.abs(last.x - first.x) / 2, ry = Math.abs(last.y - first.y) / 2;
        if (rx > 0 && ry > 0) {
            cr.save();
            cr.translate((first.x + last.x) / 2, (first.y + last.y) / 2);
            cr.scale(rx, ry);
            cr.arc(0, 0, 1, 0, Math.PI * 2);
            cr.restore();
        } else {
            cr.moveTo(first.x, first.y); cr.lineTo(last.x, last.y);
        }
    }
    else if (stroke.tool === 'rectangle') cr.rectangle(first.x, first.y, last.x - first.x, last.y - first.y);
    else if (stroke.tool === 'freehand' && stroke.points.length === 1) {
        cr.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); cr.fill(); return;
    } else {
        cr.moveTo(first.x, first.y);
        for (const point of stroke.tool === 'freehand' ? stroke.points.slice(1) : [last]) cr.lineTo(point.x, point.y);
        if (stroke.tool === 'arrow') {
            const angle = Math.atan2(last.y - first.y, last.x - first.x), length = Math.max(14, stroke.width * 3);
            cr.moveTo(last.x - length * Math.cos(angle - Math.PI / 6), last.y - length * Math.sin(angle - Math.PI / 6));
            cr.lineTo(last.x, last.y);
            cr.lineTo(last.x - length * Math.cos(angle + Math.PI / 6), last.y - length * Math.sin(angle + Math.PI / 6));
        }
    }
    cr.stroke();
}

// A transient brush sample, never added to drawing history.
export function brushPreview(state, point, monitor, controls = [], tracing = false) {
    if (!state?.drawing || state.pie || tracing || !point) return null;
    const inside = r => point.x >= r.x && point.y >= r.y && point.x < r.x + r.width && point.y < r.y + r.height;
    if (!inside(monitor) || controls.some(inside)) return null;
    return {tool: 'freehand', color: state.settings.colors[state.color],
        width: state.settings.width, transparency: state.settings.transparency,
        points: [{x: point.x - monitor.x, y: point.y - monitor.y}]};
}

// Transparent full-screen menus reserve input without cutting visible drawings.
export function drawingRegions(monitor, controls, input = false) {
    let regions = [monitor];
    for (const control of controls) {
        if (input || !control.inputOnly) regions = subtract(regions, control);
    }
    return regions;
}

export function chromeParams(version, input) {
    return Number(version.split('.')[0]) < 50
        ? {trackFullscreen: false, affectsInputRegion: input}
        : {trackFullscreen: false};
}
