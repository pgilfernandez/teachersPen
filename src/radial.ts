import type { Action, State } from './shared';

export function isRadialActionEnabled(action: Action, state: Pick<State, 'hasDrawings' | 'visible'>): boolean {
  if (action === 'visible') return state.hasDrawings;
  if (action === 'clear') return state.hasDrawings && state.visible;
  return true;
}

export function radialSlotAt(point: { x: number; y: number } | null, center: { x: number; y: number }, radius: number, buttonSize: number, slots: readonly (Action | null)[]): number | null {
  if (!point) return null;
  const index = slots.findIndex((action, i) => {
    if (!action) return false;
    const angle = (i * 45 - 90) * Math.PI / 180;
    return Math.hypot(point.x - center.x - Math.cos(angle) * radius, point.y - center.y - Math.sin(angle) * radius) <= buttonSize / 2;
  });
  return index < 0 ? null : index;
}

export class RadialHover {
  private target: number | null = null;
  private enteredAt = 0;
  private activated = false;
  update(target: number | null, now: number, delay: number): number | null {
    if (target !== this.target) {
      this.target = target; this.enteredAt = now; this.activated = false;
    }
    if (target === null || this.activated || now - this.enteredAt < delay) return null;
    this.activated = true;
    return target;
  }
}
