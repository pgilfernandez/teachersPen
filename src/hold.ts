import type { Action } from './shared';

export type StopWatching = () => void;
export interface HoldMonitor {
  watch(shortcut: string, down: () => void, up: () => void, error: (message: string) => void): StopWatching;
}
export function isDrawingShortcut(action: Action) {
  return ['toggle', 'freehand', 'line', 'arrow', 'rectangle', 'white', 'black'].includes(action) || action.startsWith('color');
}
interface HeldKey { stop?: StopWatching; engaged: boolean; dismissed: boolean }

/** Merge overlapping held shortcuts and ignore keyboard auto-repeat. */
export class HoldActivation {
  private held = new Map<Action, HeldKey>();
  private engaged = false;
  constructor(private monitor: HoldMonitor, private activate: (action: Action) => void,
    private release: () => void, private error: (message: string) => void) {}
  press(action: Action, shortcut: string) {
    if (this.held.has(action)) return;
    const entry: HeldKey = { engaged: false, dismissed: false };
    this.held.set(action, entry);
    const finish = () => {
      if (this.held.get(action) !== entry) return;
      this.held.delete(action);
      if (this.engaged && ![...this.held.values()].some(key => !key.dismissed)) {
        this.engaged = false;
        this.release();
      }
    };
    try {
      entry.stop = this.monitor.watch(shortcut, () => {
        if (this.held.get(action) !== entry || entry.engaged || entry.dismissed) return;
        entry.engaged = true;
        this.engaged = true;
        this.activate(action);
      }, finish, message => {
        if (this.held.get(action) !== entry) return;
        this.error(message);
        finish();
      });
      // A monitor may fail synchronously (e.g. a missing executable).
      if (this.held.get(action) !== entry) entry.stop();
    } catch (error) { this.error(String(error)); finish(); }
  }
  dismiss() {
    // Keep observing the physical release so auto-repeat cannot reactivate after Esc.
    for (const key of this.held.values()) { key.engaged = false; key.dismissed = true; }
    this.engaged = false;
  }
  stop() {
    const entries = [...this.held.values()];
    this.held.clear();
    this.engaged = false;
    for (const key of entries) key.stop?.();
  }
}
