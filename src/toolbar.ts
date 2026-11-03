import type { Point } from './model';

export const MINI_SIZE = 48;
export const MINI_RADIUS = 21;
export interface Area extends Point { width: number; height: number }
/** Place the visible launcher circle against the start of the visible bar. */
export function toolbarClosing(bar: Area, area: Area, vertical: boolean): Point {
  // The visible bar is 40 px thick with an 8 px outer margin; the circle
  // has a 3 px transparent inset. Ignore extra native window allocation.
  return fitPosition(vertical ? {
    x: bar.x + 8 + 40 / 2 - MINI_SIZE / 2,
    y: bar.y + 8 - MINI_SIZE + 3
  } : {
    x: bar.x + 8 - MINI_SIZE + 3,
    y: bar.y + 8 + 40 / 2 - MINI_SIZE / 2
  }, { width: MINI_SIZE, height: MINI_SIZE }, area);
}
export function toolbarOpening(launcher: Point, size: { width: number; height: number }, area: Area, vertical: boolean) {
  const center = { x: launcher.x + MINI_SIZE / 2, y: launcher.y + MINI_SIZE / 2 };
  const before = vertical ? center.y - area.y : center.x - area.x;
  const after = vertical ? area.y + area.height - center.y : area.x + area.width - center.x;
  const length = (vertical ? size.height : size.width) - 16;
  const forward = after >= length - MINI_RADIUS || after >= before;
  const position = fitPosition(vertical ? {
    x: center.x - size.width / 2,
    y: forward ? center.y - MINI_RADIUS - 8 : center.y + MINI_RADIUS + 8 - size.height
  } : {
    x: forward ? center.x - MINI_RADIUS - 8 : center.x + MINI_RADIUS + 8 - size.width,
    y: center.y - size.height / 2
  }, size, area);
  const origin = vertical ? center.y - position.y - 8 : center.x - position.x - 8;
  return {
    position,
    direction: (vertical ? (forward ? 'down' : 'up') : (forward ? 'right' : 'left')) as 'down' | 'up' | 'right' | 'left',
    start: Math.max(0, Math.min(100, (origin - MINI_RADIUS) / Math.max(1, length) * 100)),
    end: Math.max(0, Math.min(100, (length - origin - MINI_RADIUS) / Math.max(1, length) * 100))
  };
}
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
