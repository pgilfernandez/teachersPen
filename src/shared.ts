export const tools = ['freehand', 'line', 'arrow', 'rectangle'] as const;
export type Tool = typeof tools[number];
export type Background = 'transparent' | 'white' | 'black';
export const actionLabels = {
  toggle: 'Activar / salir del dibujo',
  freehand: 'Mano alzada', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo',
  color0: 'Color 1', color1: 'Color 2', color2: 'Color 3', color3: 'Color 4', color4: 'Color 5',
  undo: 'Deshacer', redo: 'Rehacer', clear: 'Borrar todo', visible: 'Ocultar / mostrar trazos',
  timer: 'Temporizador', white: 'Pizarra blanca', black: 'Pizarra negra'
} as const;
export type Action = keyof typeof actionLabels;
export const actions = Object.keys(actionLabels) as Action[];
export interface Settings {
  activation: 'toggle' | 'hold';
  width: number;
  colors: string[];
  shortcuts: Record<Action, string>;
  timerSeconds: number;
}
export interface State {
  drawing: boolean;
  tool: Tool;
  color: number;
  visible: boolean;
  background: Background;
  timerEnd: number | null;
  settings: Settings;
  shortcutErrors: string[];
  platform: string;
  wayland: boolean;
  holding: boolean;
  holdAvailable: boolean;
  holdError: string | null;
}
export function defaults(): Settings {
  const keys = ['Space', 'A', 'Q', 'W', 'S', 'E', 'D', 'C', 'R', 'F', 'Z', 'Y', 'X', 'H', 'T', 'V', 'B'];
  return {
    activation: 'toggle',
    width: 6, colors: ['#ef4444', '#087bff', '#78cc00', '#e2cd00', '#bfc0c2'], timerSeconds: 300,
    shortcuts: Object.fromEntries(actions.map((action, i) => [action, `Control+Shift+${keys[i]}`])) as Record<Action, string>
  };
}
export function parseSettings(input: unknown): Settings {
  const base = defaults();
  if (!input || typeof input !== 'object') return base;
  const data = input as Partial<Settings>;
  if (data.activation === 'hold') base.activation = 'hold';
  if (Number.isFinite(data.width)) base.width = Math.max(1, Math.min(40, Math.round(data.width!)));
  if (Number.isFinite(data.timerSeconds)) base.timerSeconds = Math.max(10, Math.min(7200, Math.round(data.timerSeconds!)));
  if (Array.isArray(data.colors) && data.colors.length === 5 && data.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) base.colors = [...data.colors];
  if (data.shortcuts && typeof data.shortcuts === 'object') {
    for (const action of actions) {
      const key = data.shortcuts[action];
      if (typeof key === 'string' && key.length < 100) base.shortcuts[action] = key;
    }
  }
  // Keep at least one keyboard escape route, even with edited preferences on disk.
  if (!base.shortcuts.toggle) base.shortcuts.toggle = defaults().shortcuts.toggle;
  return base;
}
export type Command =
  | { type: 'action'; action: Action }
  | { type: 'tool'; tool: Tool }
  | { type: 'color'; index: number }
  | { type: 'width'; width: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'preferences' }
  | { type: 'active-display' }
  | { type: 'record-shortcut'; active: boolean }
  | { type: 'toolbar-size'; height: number }
  | { type: 'quit' };
export interface PenAPI {
  getState(): Promise<State>;
  command(command: Command): Promise<{ ok: boolean; error?: string }>;
  onState(callback: (state: State) => void): () => void;
  onAction(callback: (action: Action) => void): () => void;
}
declare global { interface Window { pen: PenAPI } }
