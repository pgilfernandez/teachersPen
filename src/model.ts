import type { Tool } from './shared';
export interface Point { x: number; y: number }
export interface Stroke { tool: Tool; color: string; width: number; transparency?: number; points: Point[] }
export class DrawingHistory {
  strokes: Stroke[] = [];
  private future: Stroke[][] = [];
  private past: Stroke[][] = [];
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  private commit(next: Stroke[]) {
    this.past.push(this.strokes);
    if (this.past.length > 100) this.past.shift();
    this.strokes = next;
    this.future = [];
  }
  add(stroke: Stroke) { if (stroke.points.length) this.commit([...this.strokes, stroke]); }
  clear() { if (this.strokes.length) this.commit([]); }
  undo() {
    const previous = this.past.pop();
    if (previous) { this.future.push(this.strokes); this.strokes = previous; }
  }
  redo() {
    const next = this.future.pop();
    if (next) { this.past.push(this.strokes); this.strokes = next; }
  }
}
