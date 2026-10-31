import type { Point } from './model';

export const MINI_SIZE = 56;
export const MINI_RADIUS = 25;
export interface Area extends Point { width: number; height: number }
export function fitPosition(point: Point, size: { width: number; height: number }, area: Area): Point {
  return {
    x: Math.round(Math.max(area.x, Math.min(point.x, area.x + area.width - size.width))),
    y: Math.round(Math.max(area.y, Math.min(point.y, area.y + area.height - size.height)))
  };
}
export function readPosition(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as Partial<Point>;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 100000 && Math.abs(y) <= 100000 ? { x: Math.round(x), y: Math.round(y) } : null;
}
/** A drag stays a drag even if the pointer returns to its initial position. */
export class MiniDrag {
  private start: { pointer: Point; window: Point; moved: boolean } | null = null;
  get active() { return this.start !== null; }
  begin(pointer: Point, window: Point) { this.start = { pointer, window, moved: false }; }
  move(pointer: Point): Point | null {
    if (!this.start) return null;
    const dx = pointer.x - this.start.pointer.x;
    const dy = pointer.y - this.start.pointer.y;
    if (Math.hypot(dx, dy) >= 5) this.start.moved = true;
    return this.start.moved ? { x: this.start.window.x + dx, y: this.start.window.y + dy } : null;
  }
  end(pointer: Point) {
    if (!this.start) return null;
    const position = this.move(pointer);
    const result = { dragged: this.start.moved, position };
    this.start = null;
    return result;
  }
  cancel() { this.start = null; }
}
