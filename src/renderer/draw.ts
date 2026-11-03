import type { Stroke } from '../model';

export function strokeCursor(color: string, width: number, transparency: number, revision = 0): string {
  // A fixed, even canvas keeps the hotspot exactly centered, including odd widths.
  // A new URL makes WebKit reinstall a cursor lost after native focus changes,
  // even when its color, size and transparency remain identical.
  const svg = `<svg data-revision="${revision}" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${width / 2}" fill="${color}" opacity="${1 - transparency / 100}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 24 24, crosshair`;
}

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.points.length) return;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  ctx.globalAlpha = 1 - (stroke.transparency ?? 0) / 100;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (stroke.tool === 'circle') {
    ctx.arc(first.x, first.y, Math.hypot(last.x - first.x, last.y - first.y), 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (stroke.tool === 'rectangle') {
    ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    return;
  }
  if (stroke.tool === 'freehand' && stroke.points.length === 1) {
    ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); return;
  }
  ctx.moveTo(first.x, first.y);
  if (stroke.tool === 'freehand') {
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
  } else ctx.lineTo(last.x, last.y);
  if (stroke.tool === 'arrow') {
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const length = Math.max(14, stroke.width * 3);
    ctx.moveTo(last.x - length * Math.cos(angle - Math.PI / 6), last.y - length * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(last.x, last.y);
    ctx.lineTo(last.x - length * Math.cos(angle + Math.PI / 6), last.y - length * Math.sin(angle + Math.PI / 6));
  }
  ctx.stroke();
}
