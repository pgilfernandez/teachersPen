import type { Stroke } from '../model';

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.points.length) return;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
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
  ctx.stroke();
  if (stroke.tool === 'arrow') {
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const length = Math.max(14, stroke.width * 3);
    ctx.beginPath();
    ctx.moveTo(last.x - length * Math.cos(angle - Math.PI / 6), last.y - length * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(last.x, last.y);
    ctx.lineTo(last.x - length * Math.cos(angle + Math.PI / 6), last.y - length * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
}
