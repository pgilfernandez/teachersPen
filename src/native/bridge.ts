import { listen } from '@tauri-apps/api/event';
import { host } from './host';
import type { Action, Command, PenAPI, State } from '../shared';

export function installBridge() {
  const states = new Set<(state: State) => void>();
  const actions = new Set<(action: Action) => void>();
  const replies = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let serial = 0;
  const ready = Promise.all([
    listen<State>('pen:state', event => states.forEach(fn => fn(event.payload))),
    listen<Action>('pen:action', event => actions.forEach(fn => fn(event.payload))),
    listen<{ id: number; result: unknown }>('pen:reply', event => {
      const pending = replies.get(event.payload.id); if (!pending) return;
      clearTimeout(pending.timer); replies.delete(event.payload.id); pending.resolve(event.payload.result);
    })
  ]);
  async function request<T>(command: Command | { type: 'get-state' }): Promise<T> {
    await ready;
    const id = ++serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { replies.delete(id); reject(new Error('TeachersPen did not respond')); }, 15000);
      replies.set(id, { resolve, reject, timer });
      host('request', { id, command }).catch(error => { clearTimeout(timer); replies.delete(id); reject(error); });
    });
  }
  const api: PenAPI = {
    getState: () => request<State>({ type: 'get-state' }), command: value => request(value),
    onState: fn => { states.add(fn); return () => { states.delete(fn); }; },
    onAction: fn => { actions.add(fn); return () => { actions.delete(fn); }; }
  };
  window.pen = api;
  // GTK can allocate a larger client area than the visible toolbar. Report the
  // actual DOM rectangle, including the CSS-to-GTK scale, rather than its window.
  if (navigator.userAgent.includes('Linux')) {
    let frame = 0;
    let previous = '';
    let observed: Element | null = null;
    const resize = new ResizeObserver(schedule);
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const toolbar = document.querySelector<HTMLElement>('.toolbar-shell');
        if (!toolbar) return;
        if (observed !== toolbar) {
          resize.disconnect(); resize.observe(toolbar); observed = toolbar;
        }
        const rect = toolbar.getBoundingClientRect();
        const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          viewportWidth: innerWidth, viewportHeight: innerHeight };
        const measurement = JSON.stringify(bounds);
        if (measurement === previous) return;
        previous = measurement;
        void host('toolbar-region', bounds).catch(() => { previous = ''; });
      });
    }
    new MutationObserver(schedule).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style']
    });
    window.addEventListener('resize', schedule);
    schedule();
  }
  // Start native window dragging from the toolbar and timer handles.
  document.addEventListener('mousedown', event => {
    if (event.button === 0 && (event.target as Element).closest('.drag-handle, .timer-grip')) void host('drag');
  });
}
