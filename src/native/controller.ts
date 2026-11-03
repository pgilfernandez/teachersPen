import { listen } from '@tauri-apps/api/event';
import { host } from './host';
import { actions, actionLabels, defaults, parseSettings, tools, type Action, type Command, type Settings, type State, type ToolbarMode } from '../shared';
import { translate, isLanguage, defaultTimerText, isDefaultTimerText } from '../i18n';
import { HoldActivation, ShortcutPress, isDrawingShortcut, type HoldMonitor } from '../hold';
import { MiniDrag, MINI_SIZE, MINI_RADIUS, fitPosition, readPosition, toolbarClosing, toolbarOpening, type Area } from '../toolbar';
import type { Point } from '../model';

type Display = { id: number; bounds: Area; workArea: Area; scaleFactor: number };
type Reply = { ok: boolean; error?: string };
export async function startController() {
  const environment = await host<{ platform: string; wayland: boolean }>('environment');
  const state: State = {
    pie: null, hasDrawings: false, canUndo: false, canRedo: false,
    drawing: false, tool: 'freehand', color: 1, visible: true, background: 'transparent', timerEnd: null,
    timer: { visible: false, running: false, elapsedMs: 0, startedAt: null }, settings: defaults(),
    shortcutErrors: [], platform: environment.platform, wayland: environment.wayland,
    holding: false, holdAvailable: true, holdError: null,
    toolbarExpanded: true, toolbarReveal: null, toolbarAvailableHeight: 0
  };
  const t = (s: string, values?: Record<string, string | number>) => translate(state.settings.language, s, values);
  const geometry = new Map<string, Area>();
  const overlayLabels = new Set<string>();
  let displays = await host<Display[]>('screens');
  let activeDisplay = 0;
  let toolbarSized = false;
  let recording = false;
  let initialized = false;
  let miniShown = false;
  let anchor: { point: Point; area: Area } | null = null;
  let anchorTimeout: ReturnType<typeof setTimeout>;
  let timerTimeout: ReturnType<typeof setTimeout>;
  let timerSave: ReturnType<typeof setTimeout>;
  let timerResize: { pointer: Point; bounds: Area } | null = null;
  const miniDrag = new MiniDrag();
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn); queue = next.catch(error => console.error('TeachersPen:', error)); return next;
  }
  const histories = new Map<string, { canUndo: boolean; canRedo: boolean; hasDrawings: boolean }>();
  const broadcast = () => {
    const history = histories.get(`overlay-${activeDisplay}`);
    state.hasDrawings = displays.some(display => histories.get(`overlay-${display.id}`)?.hasDrawings);
    state.canUndo = history?.canUndo ?? false;
    state.canRedo = history?.canRedo ?? false;
    return host('broadcast', state);
  };
  const write = (name: string, value: unknown) => host('write', { name, value });
  const read = async (name: string): Promise<any> => { try { return await host('read', { name }); } catch (e) { console.error(name, e); return null; } };
  const win = (label: string, action: string, values: object = {}) => host('window', { label, action, ...values });
  const cursor = () => host<Point & { display: number }>('cursor');
  function nearest(point: Point) {
    return displays.reduce((best, d) => {
      const distance = (a: Area) => Math.hypot(Math.max(a.x - point.x, 0, point.x - a.x - a.width), Math.max(a.y - point.y, 0, point.y - a.y - a.height));
      return distance(d.bounds) < distance(best.bounds) ? d : best;
    }, displays[0]);
  }
  const areaFor = (b: Area | Point) => nearest({ x: b.x + ('width' in b ? b.width / 2 : 0), y: b.y + ('height' in b ? b.height / 2 : 0) }).workArea;
  async function create(label: string, role: string, bounds: Area, title = 'TeachersPen') {
    if (geometry.has(label)) return;
    geometry.set(label, bounds);
    try { await host('create', { label, role, bounds, title }); } catch (e) { geometry.delete(label); throw e; }
  }
  async function bounds(label: string) {
    const b = await win(label, 'get-bounds') as Area; geometry.set(label, b); return b;
  }
  async function move(label: string, b: Area) { geometry.set(label, b); await win(label, 'bounds', { bounds: b }); }
  async function save(next: Settings) { await write('settings.json', next); state.settings = next; }
  const watches = new Map<string, { down: () => void; up: () => void; error: (s: string) => void; timeout: ReturnType<typeof setTimeout> }>();
  let watchSerial = 0;
  const monitor: HoldMonitor = { watch(shortcut, down, up, error) {
    const token = String(++watchSerial);
    const timeout = setTimeout(() => { const entry = watches.get(token); if (!entry) return; watches.delete(token); void host('stop-watch', { token }); entry.error('No se puede comprobar el atajo. Se ha desactivado el dibujo por seguridad.'); }, 2000);
    watches.set(token, { down, up, error, timeout });
    void host('watch', { token, shortcut }).catch(e => { const entry = watches.get(token); if (entry) { clearTimeout(entry.timeout); watches.delete(token); error(String(e)); } });
    return () => { clearTimeout(timeout); watches.delete(token); void host('stop-watch', { token }); };
  } };
  const piePress = new ShortcutPress(monitor, message => { void host('trace', { message: `pie shortcut monitor: ${message}` }); });
  const hold = new HoldActivation(monitor, action => { void enqueue(async () => {
    await host('trace', { message: `hold activate ${action}` });
    state.holding = true; state.holdError = null;
    if (action !== 'toggle') await perform(action, true); else activeDisplay = (await cursor()).display;
    await setDrawing(true);
  }); }, () => { void enqueue(async () => { await host('trace', { message: 'hold release' }); await setDrawing(false); }); }, message => { state.holdError = message; void host('trace', { message: `hold error ${message}` }); void broadcast(); });
  async function setDrawing(value: boolean) {
    if (!value) { hold.dismiss(); state.holding = false; }
    state.drawing = value;
    if (value) state.visible = true;
    try {
      for (const label of overlayLabels) await win(label, 'ignore', { enabled: !value, holding: state.holding });
      if (value) await win(`overlay-${activeDisplay}`, 'focus', { holding: state.holding });
    } catch (error) {
      state.drawing = false; state.holding = false; hold.dismiss();
      for (const label of overlayLabels) await win(label, 'ignore', { enabled: true }).catch(console.error);
      throw error;
    }
    await broadcast();
  }
  async function sendAction(action: Action) {
    for (const label of action === 'clear' ? overlayLabels : [`overlay-${activeDisplay}`]) await host('action', { label, action });
  }
  function stopTimer() {
    clearTimeout(timerTimeout);
    if (state.timer.startedAt !== null) state.timer.elapsedMs += Date.now() - state.timer.startedAt;
    state.timer.startedAt = null; state.timer.running = false; state.timerEnd = null;
  }
  function resetTimer() { stopTimer(); state.timer.elapsedMs = 0; }
  function startTimer() {
    if (state.timer.running) { stopTimer(); return; }
    const duration = state.settings.timerSeconds * 1000;
    if (state.settings.timerDirection === 'down' && state.timer.elapsedMs >= duration) state.timer.elapsedMs = 0;
    state.timer.startedAt = Date.now(); state.timer.running = true;
    if (state.settings.timerDirection === 'down') {
      state.timerEnd = Date.now() + duration - state.timer.elapsedMs;
      timerTimeout = setTimeout(() => { void enqueue(async () => { stopTimer(); state.timer.elapsedMs = duration; await broadcast(); }); }, Math.max(0, duration - state.timer.elapsedMs));
    }
  }
  async function showTimer() {
    if (!geometry.has('timer-window')) {
      const saved = await read('timer-window.json');
      const initialArea = (displays.find(d => d.id === activeDisplay) || displays[0]).workArea;
      const point = readPosition(saved) || { x: initialArea.x + initialArea.width - 352, y: initialArea.y + 155 };
      const area = areaFor(point);
      const width = Math.round(Math.max(280, Math.min(Number.isFinite(saved?.width) ? saved.width : 320, 960, area.width, area.height * 320 / 180)));
      const size = { width, height: Math.round(width * 180 / 320) };
      await create('timer-window', 'timer-window', { ...fitPosition(point, size, area), ...size }, `${t('Temporizador')} · TeachersPen`);
    }
    await win('timer-window', 'show');
  }
  async function closePie() {
    state.pie = null;
    if (geometry.has('pie')) await win('pie', 'hide');
  }
  async function showPie(menu: 0 | 1) {
    if (state.pie?.menu === menu) { await closePie(); return; }
    const point = await cursor(); activeDisplay = point.display;
    const display = displays.find(d => d.id === activeDisplay) || nearest(point);
    await create('pie', 'pie', display.bounds);
    await move('pie', display.bounds);
    state.pie = { menu, x: point.x - display.bounds.x, y: point.y - display.bounds.y, serial: Date.now() };
    await broadcast(); await win('pie', 'show'); await win('pie', 'focus');
  }
  async function perform(action: Action, fromShortcut = false) {
    if (action !== 'pie' && action !== 'pie2' && state.pie) await closePie();
    if (fromShortcut) activeDisplay = (await cursor()).display;
    if (tools.includes(action as any)) { state.tool = action as State['tool']; await setDrawing(true); }
    else if (action.startsWith('color')) { state.color = Number(action.slice(-1)); if (fromShortcut) await setDrawing(true); }
    else switch (action) {
      case 'pie': await showPie(0); break;
      case 'pie2': await showPie(1); break;
      case 'nextColor': state.color = (state.color + 1) % state.settings.colors.length; if (fromShortcut) await setDrawing(true); break;
      case 'toggle': await setDrawing(!state.drawing); break;
      case 'undo': case 'redo': await sendAction(action); break;
      case 'clear': if (state.visible && state.hasDrawings) await sendAction(action); break;
      case 'visible': if (!state.hasDrawings) break; state.visible = !state.visible; if (!state.visible) await setDrawing(false); break;
      case 'white': case 'black':
        state.background = state.background === action ? 'transparent' : action;
        if (state.background !== 'transparent') {
          if (!state.visible) await sendAction('clear');
          state.visible = true;
        }
        break;
      case 'timer':
        state.timer.visible = !state.timer.visible;
        if (state.timer.visible) await showTimer();
        else { stopTimer(); timerResize = null; if (geometry.has('timer-window')) await win('timer-window', 'hide'); }
        break;
    }
    await broadcast();
  }
  async function register(settings: Settings): Promise<string[]> {
    piePress.stop(); hold.stop(); if (state.holding) await setDrawing(false);
    const accepted: Partial<Record<Action, string>> = {}; const errors: string[] = []; const seen = new Set<string>();
    for (const action of actions) {
      const shortcut = settings.shortcuts[action]; if (!shortcut) continue;
      const label = translate(settings.language, actionLabels[action]);
      const normalized = shortcut.toLowerCase();
      if (seen.has(normalized)) { errors.push(translate(settings.language, '{action}: atajo duplicado ({shortcut})', { action: label, shortcut })); continue; }
      seen.add(normalized);
      if (settings.activation === 'hold' && isDrawingShortcut(action)) {
        const error = await host<string | null>('validate', { shortcut });
        if (error) { errors.push(`${label}: ${translate(settings.language, error)}`); continue; }
      }
      accepted[action] = shortcut.replace(/CommandOrControl/g, state.platform === 'darwin' ? 'Command' : 'Control');
    }
    const nativeErrors = await host<{ action: Action; shortcut: string; error: string }[]>('shortcuts', accepted);
    for (const e of nativeErrors) errors.push(`${translate(settings.language, '{action}: no se puede registrar {shortcut}', { action: translate(settings.language, actionLabels[e.action]), shortcut: e.shortcut })}: ${e.error}`);
    return errors;
  }
  async function commitBindings(next: Settings) {
    const previous = state.settings;
    try {
      const errors = await register(next); if (errors.length) throw new Error(errors.join('\n'));
      await save(next); state.shortcutErrors = []; state.holdError = null;
    } catch (e) { state.shortcutErrors = await register(previous); throw e; }
    finally { if (recording) await host('shortcuts', {}); }
  }
  async function labels() {
    await host('tray', { show: t('Mostrar barra completa'), preferences: t('Preferencias…'), quit: t('Salir de TeachersPen') });
    if (geometry.has('preferences')) await win('preferences', 'title', { title: `${t('Preferencias')} · TeachersPen` });
    if (geometry.has('timer-window')) await win('timer-window', 'title', { title: `${t('Temporizador')} · TeachersPen` });
  }
  async function presentation() {
    await host('dock', { hidden: state.settings.toolbarMode === 'hidden' });
    const full = state.settings.toolbarMode === 'visible' || state.toolbarExpanded;
    miniShown = !full && state.settings.toolbarMode === 'minimal';
    await win('toolbar', full ? 'show' : 'hide'); await win('mini', miniShown ? 'show' : 'hide');
    if (!miniShown) miniDrag.cancel();
    await labels();
  }
  function clearReveal() { clearTimeout(anchorTimeout); anchor = null; state.toolbarReveal = null; }
  async function toolbarLayout() {
    const b = await bounds('toolbar'); const area = areaFor(b); state.toolbarAvailableHeight = area.height;
    const vertical = state.settings.toolbarOrientation === 'vertical';
    await move('toolbar', { ...b, width: Math.min(vertical ? 56 : 1000, area.width), height: vertical ? area.height : Math.min(56, area.height) });
  }
  async function showTools() {
    if (state.settings.toolbarMode === 'minimal' && !state.toolbarExpanded) {
      const point = await bounds('mini'); const area = areaFor(point); const b = await bounds('toolbar');
      const opening = toolbarOpening(point, b, area, state.settings.toolbarOrientation === 'vertical');
      clearTimeout(anchorTimeout); anchor = { point, area }; anchorTimeout = setTimeout(() => { anchor = null; }, 300);
      state.toolbarAvailableHeight = area.height; state.toolbarReveal = { direction: opening.direction, start: opening.start, end: opening.end };
      await move('toolbar', { ...b, ...opening.position });
    }
    state.toolbarExpanded = true; await presentation(); await broadcast();
  }
  async function mode(toolbarMode: ToolbarMode) {
    if (!['visible', 'minimal', 'hidden'].includes(toolbarMode)) throw new Error(t('Modo de barra no válido'));
    await save({ ...state.settings, toolbarMode }); clearReveal(); state.toolbarExpanded = toolbarMode === 'visible';
    miniDrag.cancel(); await presentation();
  }
  async function collapse() {
    if (state.toolbarExpanded && state.settings.toolbarMode !== 'hidden') {
      const bar = await bounds('toolbar');
      const position = toolbarClosing(bar, areaFor(bar), state.settings.toolbarOrientation === 'vertical');
      await move('mini', { ...await bounds('mini'), ...position });
      await write('window-state.json', position);
    }
    clearReveal();
    if (state.settings.toolbarMode === 'visible') await mode('minimal');
    else { state.toolbarExpanded = false; miniDrag.cancel(); await presentation(); }
  }
  async function moveMini(point: Point) {
    const b = geometry.get('mini')!; await move('mini', { ...b, ...fitPosition(point, { width: MINI_SIZE, height: MINI_SIZE }, areaFor(point)) });
  }
  async function preferences() {
    await setDrawing(false); const area = areaFor(await cursor()); const width = Math.min(430, area.width); const height = Math.min(700, area.height - 40);
    await create('preferences', 'preferences', { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height }, `${t('Preferencias')} · TeachersPen`);
    await win('preferences', 'show'); await win('preferences', 'focus');
  }
  async function resizeTimer(pointer: Point) {
    if (!timerResize) return;
    const { bounds: b, pointer: start } = timerResize; const area = areaFor(b);
    const width = Math.round(Math.max(280, Math.min(b.width + pointer.x - start.x + pointer.y - start.y, 960, area.width, area.height * 320 / 180)));
    const size = { width, height: Math.round(width * 180 / 320) };
    await move('timer-window', { ...fitPosition(b, size, area), ...size });
  }
  async function command(source: string, c: Command): Promise<Reply> {
    if (!c || typeof c !== 'object') throw new Error(t('Comando no autorizado'));
    switch (c.type) {
      case 'cancel-drawing':
        if (!overlayLabels.has(source)) throw new Error(t('Ventana no autorizada'));
        await setDrawing(false); break;
      case 'pie-close': await closePie(); break;
      case 'pie-select':
        if (source !== 'pie' || !state.pie || (c.action === 'pie' || c.action === 'pie2') || !state.settings.pie[state.pie.menu === 0 ? 'slots' : 'slots2'].includes(c.action)) throw new Error(t('Comando no autorizado'));
        await closePie(); await perform(c.action, true); break;
      case 'pie-settings':
        if (source !== 'preferences') throw new Error(t('Ventana no autorizada'));
        await save(parseSettings({ ...state.settings, pie: c.settings })); break;
      case 'active-display': if (overlayLabels.has(source)) activeDisplay = Number(source.slice(8)); break;
      case 'history-state':
        if (!overlayLabels.has(source) || typeof c.canUndo !== 'boolean' || typeof c.canRedo !== 'boolean' || typeof c.hasDrawings !== 'boolean') throw new Error(t('Ventana no autorizada'));
        histories.set(source, { canUndo: c.canUndo, canRedo: c.canRedo, hasDrawings: c.hasDrawings }); break;
      case 'action': if (actions.includes(c.action)) await perform(c.action); break;
      case 'tool': if (tools.includes(c.tool)) { const exit = state.drawing && state.tool === c.tool; state.tool = c.tool; await setDrawing(!exit); } break;
      case 'color': if (Number.isInteger(c.index) && c.index >= 0 && c.index < state.settings.colors.length) state.color = c.index; break;
      case 'width': await save({ ...state.settings, width: parseSettings({ width: c.width }).width }); break;
      case 'transparency': await save({ ...state.settings, transparency: parseSettings({ transparency: c.transparency }).transparency }); break;
      case 'preset-color':
        if (!Number.isInteger(c.index) || c.index < 0 || c.index >= state.settings.colors.length || !/^#[0-9a-f]{6}$/i.test(c.color)) throw new Error(t('No se han podido guardar.'));
        await save({ ...state.settings, colors: state.settings.colors.map((color, index) => index === c.index ? c.color : color) }); break;
      case 'shortcut':
        if (!actions.includes(c.action) || typeof c.accelerator !== 'string' || c.accelerator.length >= 100 || (c.action === 'toggle' && !c.accelerator)) throw new Error(t('No se han podido guardar.'));
        await commitBindings(parseSettings({ ...state.settings, shortcuts: { ...state.settings.shortcuts, [c.action]: c.accelerator } })); break;
      case 'record-shortcut':
        if (source !== 'preferences') throw new Error(t('Solo se pueden editar atajos desde Preferencias'));
        recording = c.active;
        if (recording) { hold.stop(); await setDrawing(false); await host('shortcuts', {}); }
        else state.shortcutErrors = await register(state.settings);
        break;
      case 'activation':
        if (!['toggle', 'hold'].includes(c.activation)) throw new Error(t('Modo de activación no válido'));
        await commitBindings({ ...state.settings, activation: c.activation }); await setDrawing(false); break;
      case 'language': {
        if (!isLanguage(c.language)) throw new Error(t('Idioma no válido'));
        const next = { ...state.settings, language: c.language };
        if (isDefaultTimerText(next.timerText)) next.timerText = defaultTimerText(next.language);
        await save(next); state.shortcutErrors = await register(next); await labels(); break;
      }
      case 'settings': case 'restore-defaults': {
        const next = c.type === 'restore-defaults' ? parseSettings({ ...defaults(), language: state.settings.language }) : parseSettings({ ...c.settings, language: state.settings.language, toolbarMode: state.settings.toolbarMode });
        const orientationChanged = next.toolbarOrientation !== state.settings.toolbarOrientation;
        const reset = next.timerSeconds !== state.settings.timerSeconds || next.timerDirection !== state.settings.timerDirection;
        await commitBindings(next); if (reset) resetTimer();
        if (c.type === 'restore-defaults') { clearReveal(); state.toolbarExpanded = next.toolbarMode === 'visible'; await presentation(); }
        if (orientationChanged) await toolbarLayout(); break;
      }
      case 'toolbar-mode': await mode(c.mode); break;
      case 'drawing-hints': if (typeof c.enabled !== 'boolean') throw new Error(t('Comando desconocido')); await save({ ...state.settings, drawingHints: c.enabled }); break;
      case 'show-tools': await showTools(); break;
      case 'collapse-tools': await collapse(); break;
      case 'toggle-toolbar-orientation': clearReveal(); await save({ ...state.settings, toolbarOrientation: state.settings.toolbarOrientation === 'horizontal' ? 'vertical' : 'horizontal' }); await toolbarLayout(); break;
      case 'toolbar-size': {
        if (source !== 'toolbar' || c.orientation !== state.settings.toolbarOrientation || !Number.isFinite(c.width) || !Number.isFinite(c.height)) break;
        const b = await bounds('toolbar'); const area = areaFor(b); const vertical = c.orientation === 'vertical';
        const width = Math.max(vertical ? 56 : 200, Math.min(1600, Math.ceil(c.width)));
        const height = Math.max(48, Math.min(vertical ? area.height : 180, Math.ceil(c.height)));
        let point = { x: toolbarSized ? b.x : Math.round(b.x + (b.width - width) / 2), y: b.y };
        if (anchor && state.toolbarReveal) { const opening = toolbarOpening(anchor.point, { width, height }, anchor.area, vertical); point = opening.position; state.toolbarReveal = { direction: opening.direction, start: opening.start, end: opening.end }; }
        if (b.x !== point.x || b.y !== point.y || Math.abs(b.width - width) >= 1 || Math.abs(b.height - height) >= 1) {
          await move('toolbar', { ...point, width, height });
        }
        toolbarSized = true; break;
      }
      case 'timer-control':
        if (c.action === 'reset') resetTimer(); else if (c.action === 'start') startTimer();
        else if (c.action === 'direction') { await save({ ...state.settings, timerDirection: state.settings.timerDirection === 'down' ? 'up' : 'down' }); resetTimer(); }
        break;
      case 'timer-settings': {
        const next = parseSettings({ ...state.settings, ...Object.fromEntries(['timerText', 'timerSeconds', 'timerColor'].map(k => [k, c.settings[k as keyof typeof c.settings] ?? state.settings[k as keyof Settings]])) });
        const changed = next.timerSeconds !== state.settings.timerSeconds; await save(next); if (changed) resetTimer(); break;
      }
      case 'timer-resize': {
        if (source !== 'timer-window') throw new Error(t('Ventana no autorizada'));
        const point = readPosition(c); if (!point) throw new Error(t('Posición no válida'));
        if (c.phase === 'start') timerResize = { pointer: point, bounds: await bounds('timer-window') };
        else if (c.phase === 'move') await resizeTimer(point);
        else { if (c.phase === 'end') await resizeTimer(point); timerResize = null; await write('timer-window.json', await bounds('timer-window')); }
        return { ok: true };
      }
      case 'mini-hit': return { ok: true }; // Native pointer polling also handles the transparent corners while ignored.
      case 'mini-pointer': {
        if (source !== 'mini') throw new Error(t('Ventana no autorizada'));
        const point = readPosition(c); if (!point) throw new Error(t('Posición no válida'));
        if (c.phase === 'start') miniDrag.begin(point, await bounds('mini'));
        else if (c.phase === 'move') { const position = miniDrag.move(point); if (position) await moveMini(position); }
        else if (c.phase === 'end') {
          const result = miniDrag.end(point);
          if (result?.dragged) { if (result.position) await moveMini(result.position); const { x, y } = await bounds('mini'); await write('window-state.json', { x, y }); }
          else if (result) await showTools();
        } else miniDrag.cancel();
        return { ok: true };
      }
      case 'preferences': await preferences(); break;
      case 'about-link': if (source !== 'preferences') throw new Error(t('Ventana no autorizada')); await host('open', { target: c.target }); break;
      case 'quit': await host('exit'); break;
      default: throw new Error(t('Comando desconocido'));
    }
    await broadcast(); return { ok: true };
  }
  await listen<{ source: string; id: number; command: Command | { type: 'get-state' } }>('host-request', event => {
    const { source, id, command: c } = event.payload;
    void enqueue(async () => {
      let result: unknown;
      try { result = c?.type === 'get-state' ? state : await command(source, c as Command); }
      catch (e) { result = { ok: false, error: String(e) }; await broadcast(); }
      await host('reply', { label: source, value: { id, result } });
    });
  });
  await listen<Action>('host-shortcut', event => { void enqueue(async () => {
    await host('trace', { message: `shortcut received ${event.payload} initialized=${initialized} recording=${recording} activation=${state.settings.activation}` });
    if (!initialized || recording || !actions.includes(event.payload)) return;
    const action = event.payload;
    if ((action === 'pie' || action === 'pie2') && !piePress.press(action, state.settings.shortcuts[action])) return;
    if (state.settings.activation === 'hold' && isDrawingShortcut(action)) hold.press(action, state.settings.shortcuts[action]);
    else await perform(action, true);
  }); });
  await listen<{ token: string; event: string; error?: string }>('host-key', ({ payload: e }) => {
    const entry = watches.get(e.token); if (!entry) return;
    clearTimeout(entry.timeout);
    if (e.event === 'down') entry.down();
    else if (e.event === 'up') { watches.delete(e.token); entry.up(); }
    else if (e.event === 'error') { watches.delete(e.token); entry.error(e.error || 'The shortcut monitor stopped'); }
  });
  await listen<string>('host-menu', event => { void enqueue(async () => {
    if (!initialized) return;
    if (event.payload === 'show') await showTools(); else if (event.payload === 'preferences') await preferences(); else if (event.payload === 'quit') await host('exit');
  }); });
  await listen<{ label: string; kind: string; bounds: Area | null }>('host-window', ({ payload: e }) => {
    void enqueue(async () => {
      if (e.bounds) geometry.set(e.label, e.bounds);
      if (!initialized) return;
      if (e.label === 'preferences' && ['blur', 'close'].includes(e.kind) && recording) { recording = false; state.shortcutErrors = await register(state.settings); await broadcast(); }
      if (e.label === 'pie' && ['blur', 'close'].includes(e.kind)) { await closePie(); await broadcast(); }
      if (e.kind === 'close') {
        if (e.label === 'toolbar') { await collapse(); await broadcast(); }
        if (e.label === 'timer-window') { stopTimer(); state.timer.visible = false; await broadcast(); }
      }
      if (e.label === 'timer-window' && ['move', 'resize'].includes(e.kind) && !timerResize) {
        clearTimeout(timerSave); timerSave = setTimeout(() => { void enqueue(async () => { await write('timer-window.json', await bounds('timer-window')); }); }, 200);
      }
    });
  });
  state.settings = parseSettings(await read('settings.json'));
  state.toolbarExpanded = state.settings.toolbarMode === 'visible';
  const area = displays[0].workArea; state.toolbarAvailableHeight = area.height;
  const vertical = state.settings.toolbarOrientation === 'vertical'; const width = vertical ? 56 : 965;
  for (const d of displays) { const label = `overlay-${d.id}`; await create(label, 'overlay', d.bounds); overlayLabels.add(label); await win(label, 'show'); }
  await create('toolbar', 'toolbar', { x: area.x + Math.round((area.width - width) / 2), y: vertical ? area.y : area.y + 18, width, height: vertical ? area.height : 56 });
  await create('mini', 'mini', { x: area.x + 24, y: area.y + 24, width: MINI_SIZE, height: MINI_SIZE });
  await moveMini(readPosition(await read('window-state.json')) || { x: area.x + 24, y: area.y + 24 });
  state.shortcutErrors = await register(state.settings);
  await presentation(); initialized = true; await broadcast();
  // Poll only the small launcher's hit target. There is no time limit on a held drawing shortcut.
  let polling = false; let lastHit: boolean | null = null;
  setInterval(() => {
    if (!miniShown || miniDrag.active || polling || state.platform !== 'darwin') return;
    polling = true;
    void (async () => { const p = await cursor(); const b = geometry.get('mini')!; const hit = Math.hypot(p.x - b.x - MINI_SIZE / 2, p.y - b.y - MINI_SIZE / 2) <= MINI_RADIUS;
      if (hit !== lastHit) { await win('mini', 'ignore', { enabled: !hit }); lastHit = hit; }
    })().catch(console.error).finally(() => { polling = false; });
  }, 40);
  let monitorPoll = false;
  setInterval(() => {
    if (monitorPoll) return; monitorPoll = true;
    void enqueue(async () => {
      const next = await host<Display[]>('screens');
      if (JSON.stringify(next) === JSON.stringify(displays)) return;
      await closePie(); await setDrawing(false); displays = next; activeDisplay = Math.min(activeDisplay, next.length - 1);
      for (const d of next) {
        const label = `overlay-${d.id}`;
        if (!overlayLabels.has(label)) { await create(label, 'overlay', d.bounds); overlayLabels.add(label); }
        await move(label, d.bounds); await win(label, 'show');
      }
      for (const label of overlayLabels) if (!next.some(d => label === `overlay-${d.id}`)) await win(label, 'hide');
      await moveMini(await bounds('mini')); if (state.settings.toolbarOrientation === 'vertical') await toolbarLayout();
      if (geometry.has('timer-window')) { const b = await bounds('timer-window'); await move('timer-window', { ...b, ...fitPosition(b, b, areaFor(b)) }); }
      await broadcast();
    }).catch(console.error).finally(() => { monitorPoll = false; });
  }, 2000);
}
