import { isLanguage, defaultTimerText, isDefaultTimerText, type Language } from './i18n';
export const tools = ['freehand', 'line', 'arrow', 'rectangle', 'circle'] as const;
export type Tool = typeof tools[number];
export type Background = 'transparent' | 'white' | 'black';
export type ToolbarMode = 'visible' | 'minimal' | 'hidden';
export const actionLabels = {
  toggle: 'Activar / salir del dibujo',
  freehand: 'Mano alzada', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo', circle: 'Elipse',
  color0: 'Color 1', color1: 'Color 2', color2: 'Color 3', color3: 'Color 4', color4: 'Color 5', color5: 'Color 6', color6: 'Color 7', color7: 'Color 8',
  undo: 'Deshacer', redo: 'Rehacer', clear: 'Borrar todo', visible: 'Ocultar / mostrar trazos',
  timer: 'Temporizador', white: 'Pizarra blanca', black: 'Pizarra negra',
  preferences: 'Preferencias', showToolbar: 'Mostrar barra completa',
  nextColor: 'Siguiente color', pie: 'Menú radial 1', pie2: 'Menú radial 2'
} as const;
export type Action = keyof typeof actionLabels;
export const actions = Object.keys(actionLabels) as Action[];
export type LinuxBackend = 'auto' | 'gnome' | 'x11';
export interface BackendStatus { active: 'gnome' | 'x11'; requested: LinuxBackend; extensionAvailable: boolean; holdAvailable?: boolean; error: string }
export interface Settings {
  linuxBackend: LinuxBackend;
  pie: { animationMs: number; trigger: 'click' | 'hover'; radius: number; buttonSize: number; hoverMs: number; slots: (Action | null)[]; slots2: (Action | null)[] };
  language: Language;
  followSystemLanguage: boolean;
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
  aboutRequest: number;
  pie: { menu: 0 | 1; x: number; y: number; serial: number; screenPoint?: { x: number; y: number } } | null;
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
  linuxBackend?: BackendStatus;
  holding: boolean;
  holdAvailable: boolean;
  holdError: string | null;
  toolbarExpanded: boolean;
  toolbarReveal: { direction: 'left' | 'right' | 'up' | 'down'; start: number; end: number } | null;
  toolbarAvailableHeight: number;
}
// Adjacent centers are separated by 2r sin(22.5 degrees). Keep an 8 px
// gap between the edges of buttons in the eight fixed radial positions.
export function getPieRadius(settings: Pick<Settings['pie'], 'radius' | 'buttonSize'>): number {
  const minimum = Math.ceil((settings.buttonSize + 8) / (2 * Math.sin(Math.PI / 8)));
  return Math.max(settings.radius, minimum);
}

export function defaults(): Settings {
  const keys: Partial<Record<Action, string>> = {
    toggle: 'Space', freehand: 'A', line: 'D', arrow: 'F', rectangle: 'G', circle: 'H',
    color0: '1', color1: '2', color2: '3', color3: '4', color4: '5', color5: '6', color6: '7', color7: '8',
    undo: 'Z', redo: 'Y', clear: 'X', visible: 'C', timer: 'T', white: 'V', black: 'B',
    nextColor: 'Q', pie: 'S', pie2: 'W'
  };
  return {
    linuxBackend: 'auto',
    pie: { animationMs: 160, trigger: 'click', radius: 100, buttonSize: 48, hoverMs: 80, slots: ['freehand', 'line', 'arrow', 'black', 'visible', 'white', 'rectangle', 'circle'], slots2: ['color0', 'color1', 'color2', 'color3', 'color4', 'color5', 'color6', 'color7'] },
    language: 'en', followSystemLanguage: true, activation: 'toggle',
    toolbarMode: 'visible',
    toolbarOrientation: 'horizontal', drawingHints: true,
    width: 6, transparency: 0, colors: ['#ef4444', '#087bff', '#78cc00', '#e3cd00', '#be38f3', '#000000', '#c0c0c0', '#ffffff'], timerSeconds: 300,
    timerText: defaultTimerText('en'), timerColor: '#ffffff', timerDirection: 'down',
    shortcuts: Object.fromEntries(actions.map(action => [action, action === 'rectangle' ? 'Control+G' : action === 'redo' ? 'Control+Alt+Shift+Z' : keys[action] ? `Control+Shift+${keys[action]}` : ''])) as Record<Action, string>
  };
}
export function parseSettings(input: unknown): Settings {
  const base = defaults();
  if (!input || typeof input !== 'object') return base;
  const data = input as Partial<Settings>;
  if (data.linuxBackend === 'gnome' || data.linuxBackend === 'x11') base.linuxBackend = data.linuxBackend;
  if (data.pie && typeof data.pie === 'object') {
    const p = data.pie;
    for (const [key, min, max] of [['animationMs', 0, 1000], ['radius', 0, 220], ['buttonSize', 24, 96], ['hoverMs', 0, 1500]] as const)
      if (Number.isFinite(p[key])) base.pie[key] = Math.max(min, Math.min(max, Math.round(p[key])));
    base.pie.radius = getPieRadius(base.pie);
    if (p.trigger === 'hover') base.pie.trigger = 'hover';
    for (const key of ['slots', 'slots2'] as const) {
      const slots = p[key];
      if (Array.isArray(slots)) base.pie[key] = Array.from({ length: 8 }, (_, i) => actions.includes(slots[i] as Action) && slots[i] !== 'pie' && slots[i] !== 'pie2' ? slots[i] : null);
    }
  }
  if (isLanguage(data.language)) base.language = data.language;
  // Older settings store an explicit language, which must remain manual.
  base.followSystemLanguage = typeof data.followSystemLanguage === 'boolean'
    ? data.followSystemLanguage : !isLanguage(data.language);
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
  if (Array.isArray(data.colors) && (data.colors.length === 5 || data.colors.length === 8) && data.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) base.colors = [...data.colors, ...base.colors.slice(data.colors.length)];
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
  | { type: 'language'; language: Language | 'system' }
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
  | { type: 'about-link'; target: 'donate' | 'paypal' | 'github' | 'issues' }
  | { type: 'active-display' }
  | { type: 'history-state'; canUndo: boolean; canRedo: boolean; hasDrawings: boolean }
  | { type: 'record-shortcut'; active: boolean }
  | { type: 'toolbar-size'; width: number; height: number; orientation: Settings['toolbarOrientation'] }
  | { type: 'linux-backend'; backend: LinuxBackend }
  | { type: 'quit' };
export interface PenAPI {
  getViewportBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  getPreviewPointer(): Promise<{ x: number; y: number } | null>;
  getState(): Promise<State>;
  command(command: Command): Promise<{ ok: boolean; error?: string }>;
  onState(callback: (state: State) => void): () => void;
  onAction(callback: (action: Action) => void): () => void;
}
declare global { interface Window { pen: PenAPI } }
