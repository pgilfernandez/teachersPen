import { isLanguage, defaultTimerText, isDefaultTimerText, type Language } from './i18n';
export const tools = ['freehand', 'line', 'arrow', 'rectangle', 'circle'] as const;
export type Tool = typeof tools[number];
export type Background = 'transparent' | 'white' | 'black';
export type ToolbarMode = 'visible' | 'minimal' | 'hidden';
export const actionLabels = {
  toggle: 'Activar / salir del dibujo',
  freehand: 'Mano alzada', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo', circle: 'Círculo',
  color0: 'Color 1', color1: 'Color 2', color2: 'Color 3', color3: 'Color 4', color4: 'Color 5',
  undo: 'Deshacer', redo: 'Rehacer', clear: 'Borrar todo', visible: 'Ocultar / mostrar trazos',
  timer: 'Temporizador', white: 'Pizarra blanca', black: 'Pizarra negra',
  nextColor: 'Siguiente color', pie: 'Menú radial'
} as const;
export type Action = keyof typeof actionLabels;
export const actions = Object.keys(actionLabels) as Action[];
export interface Settings {
  pie: { animationMs: number; trigger: 'click' | 'hover'; radius: number; hoverMs: number; slots: (Action | null)[] };
  language: Language;
  activation: 'toggle' | 'hold';
  toolbarMode: ToolbarMode;
  toolbarOrientation: 'horizontal' | 'vertical';
  drawingHints: boolean;
  width: number;
  transparency: number;
  colors: string[];
  shortcuts: Record<Action, string>;
  timerSeconds: number;
  timerText: string;
  timerColor: string;
  timerDirection: 'down' | 'up';
}
export interface State {
  pie: { x: number; y: number; serial: number } | null;
  hasDrawings: boolean;
  canUndo: boolean;
  canRedo: boolean;
  drawing: boolean;
  tool: Tool;
  color: number;
  visible: boolean;
  background: Background;
  timerEnd: number | null;
  timer: { visible: boolean; running: boolean; elapsedMs: number; startedAt: number | null };
  settings: Settings;
  shortcutErrors: string[];
  platform: string;
  wayland: boolean;
  holding: boolean;
  holdAvailable: boolean;
  holdError: string | null;
  toolbarExpanded: boolean;
  toolbarReveal: { direction: 'left' | 'right' | 'up' | 'down'; start: number; end: number } | null;
  toolbarAvailableHeight: number;
}
export function defaults(): Settings {
  const keys = ['Space', 'A', 'W', 'E', 'S', 'D', '1', '2', '3', '4', '5', 'Z', 'Y', 'X', 'C', 'T', 'V', 'B', 'Q', 'P'];
  return {
    pie: { animationMs: 160, trigger: 'click', radius: 100, hoverMs: 80, slots: ['freehand', 'line', 'arrow', 'rectangle', 'circle', 'nextColor', 'undo', 'clear'] },
    language: 'en', activation: 'toggle',
    toolbarMode: 'visible',
    toolbarOrientation: 'horizontal', drawingHints: true,
    width: 6, transparency: 0, colors: ['#ef4444', '#087bff', '#78cc00', '#e2cd00', '#bfc0c2'], timerSeconds: 300,
    timerText: defaultTimerText('en'), timerColor: '#ffffff', timerDirection: 'down',
    shortcuts: Object.fromEntries(actions.map((action, i) => [action, `Control+Shift+${keys[i]}`])) as Record<Action, string>
  };
}
export function parseSettings(input: unknown): Settings {
  const base = defaults();
  if (!input || typeof input !== 'object') return base;
  const data = input as Partial<Settings>;
  if (data.pie && typeof data.pie === 'object') {
    const p = data.pie;
    for (const [key, min, max] of [['animationMs', 0, 1000], ['radius', 80, 220], ['hoverMs', 0, 1500]] as const)
      if (Number.isFinite(p[key])) base.pie[key] = Math.max(min, Math.min(max, Math.round(p[key])));
    if (p.trigger === 'hover') base.pie.trigger = 'hover';
    if (Array.isArray(p.slots)) base.pie.slots = Array.from({ length: 8 }, (_, i) => actions.includes(p.slots[i] as Action) && p.slots[i] !== 'pie' ? p.slots[i] : null);
  }
  if (isLanguage(data.language)) base.language = data.language;
  base.timerText = defaultTimerText(base.language);
  if (data.activation === 'hold') base.activation = 'hold';
  if (data.toolbarMode === 'minimal' || data.toolbarMode === 'hidden') base.toolbarMode = data.toolbarMode;
  if (typeof data.drawingHints === 'boolean') base.drawingHints = data.drawingHints;
  if (data.toolbarOrientation === 'vertical') base.toolbarOrientation = 'vertical';
  if (Number.isFinite(data.width)) base.width = Math.max(1, Math.min(40, Math.round(data.width!)));
  if (Number.isFinite(data.transparency)) base.transparency = Math.max(0, Math.min(100, Math.round(data.transparency!)));
  if (Number.isFinite(data.timerSeconds)) base.timerSeconds = Math.max(10, Math.min(7200, Math.round(data.timerSeconds!)));
  if (typeof data.timerText === 'string') base.timerText = isDefaultTimerText(data.timerText) ? defaultTimerText(base.language) : data.timerText.slice(0, 120);
  if (typeof data.timerColor === 'string' && /^#[0-9a-f]{6}$/i.test(data.timerColor)) base.timerColor = data.timerColor;
  if (data.timerDirection === 'up') base.timerDirection = 'up';
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
  | { type: 'cancel-drawing' }
  | { type: 'pie-close' }
  | { type: 'pie-select'; action: Action }
  | { type: 'pie-settings'; settings: Settings['pie'] }
  | { type: 'action'; action: Action }
  | { type: 'tool'; tool: Tool }
  | { type: 'color'; index: number }
  | { type: 'width'; width: number }
  | { type: 'transparency'; transparency: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'restore-defaults' }
  | { type: 'preset-color'; index: number; color: string }
  | { type: 'shortcut'; action: Action; accelerator: string }
  | { type: 'language'; language: Language }
  | { type: 'activation'; activation: Settings['activation'] }
  | { type: 'toolbar-mode'; mode: ToolbarMode }
  | { type: 'drawing-hints'; enabled: boolean }
  | { type: 'show-tools' }
  | { type: 'collapse-tools' }
  | { type: 'toggle-toolbar-orientation' }
  | { type: 'timer-resize'; phase: 'start' | 'move' | 'end' | 'cancel'; x: number; y: number }
  | { type: 'timer-control'; action: 'reset' | 'direction' | 'start' }
  | { type: 'timer-settings'; settings: Partial<Pick<Settings, 'timerText' | 'timerSeconds' | 'timerColor'>> }
  | { type: 'mini-hit'; interactive: boolean }
  | { type: 'mini-pointer'; phase: 'start' | 'move' | 'end' | 'cancel'; x: number; y: number }
  | { type: 'preferences' }
  | { type: 'about-link'; target: 'donate' | 'paypal' | 'github' }
  | { type: 'active-display' }
  | { type: 'history-state'; canUndo: boolean; canRedo: boolean; hasDrawings: boolean }
  | { type: 'record-shortcut'; active: boolean }
  | { type: 'toolbar-size'; width: number; height: number; orientation: Settings['toolbarOrientation'] }
  | { type: 'quit' };
export interface PenAPI {
  getState(): Promise<State>;
  command(command: Command): Promise<{ ok: boolean; error?: string }>;
  onState(callback: (state: State) => void): () => void;
  onAction(callback: (action: Action) => void): () => void;
}
declare global { interface Window { pen: PenAPI } }
