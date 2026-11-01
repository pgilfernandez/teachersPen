import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { actions, actionLabels, defaults, parseSettings, tools, type Action, type Command, type Settings, type State, type ToolbarMode } from './shared';
import { MiniDrag, MINI_RADIUS, MINI_SIZE, fitPosition, readPosition } from './toolbar';
import type { Point } from './model';
import { HoldActivation, isDrawingShortcut } from './hold';
import { NativeHoldMonitor } from './native-hold';

const smoke = process.argv.includes('--smoke-test');
app.setName('TeachersPen');
const overlays = new Map<number, BrowserWindow>();
let toolbar: BrowserWindow;
let mini: BrowserWindow | undefined;
let miniPosition: Point | null = null;
let accessory = false;
const miniDrag = new MiniDrag();
let preferences: BrowserWindow | undefined;
let timerWindow: BrowserWindow | undefined;
let timerReady: Promise<void> | undefined;
let timerResize: { pointer: Point; bounds: Electron.Rectangle } | null = null;
let timerGeometrySave: ReturnType<typeof setTimeout> | undefined;
const TIMER_WIDTH = 320;
const TIMER_HEIGHT = 180;
const TIMER_RATIO = TIMER_WIDTH / TIMER_HEIGHT;
let tray: Tray;
let activeDisplay: number;
let quitting = false;
let rebuilding = false;
let toolbarSized = false;
let recordingShortcut = false;
let timerTimeout: ReturnType<typeof setTimeout> | undefined;
const nativeDirectory = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'native') : path.join(__dirname, 'native');
const holdMonitor = new NativeHoldMonitor(path.join(nativeDirectory, process.platform === 'win32' ? 'key-state.exe' : 'key-state'));
const state: State = {
  drawing: false, tool: 'freehand', color: 1, visible: true, background: 'transparent', timerEnd: null,
  timer: { visible: false, running: false, elapsedMs: 0, startedAt: null },
  settings: defaults(), shortcutErrors: [], platform: process.platform,
  wayland: process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY,
  holding: false, holdAvailable: holdMonitor.available, holdError: null, toolbarExpanded: true, toolbarAvailableHeight: 0
};
const hold = new HoldActivation(holdMonitor, action => {
  state.holding = true;
  state.holdError = null;
  if (action !== 'toggle') perform(action, true);
  else activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  setDrawing(true);
}, () => setDrawing(false), message => { state.holdError = message; broadcast(); });
// Electron 37's overlay backend is supported on X11. Do not silently claim Wayland support.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');
if (process.argv.includes('--software-rendering')) app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (toolbar) showTools(); });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
function windows() { return [...overlays.values(), toolbar, mini, preferences, timerWindow].filter((win): win is BrowserWindow => !!win && !win.isDestroyed()); }
function broadcast() { for (const win of windows()) win.webContents.send('pen:state', state); }
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function saveSettings(settings: Settings) {
  if (smoke) return;
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(`${settingsPath()}.tmp`, JSON.stringify(settings, null, 2));
  renameSync(`${settingsPath()}.tmp`, settingsPath());
}
function updateDock() {
  const hidden = state.settings.toolbarMode === 'hidden';
  if (process.platform === 'darwin' && accessory !== hidden) {
    accessory = hidden;
    app.setActivationPolicy(hidden ? 'accessory' : 'regular');
  }
  preferences?.setSkipTaskbar(hidden);
}
function miniShape() {
  if (!mini || process.platform === 'darwin') return;
  const rows: Electron.Rectangle[] = [];
  for (let y = 3; y < MINI_SIZE - 3; y++) {
    const half = Math.sqrt(MINI_RADIUS ** 2 - (y + 0.5 - MINI_SIZE / 2) ** 2);
    const x = Math.ceil(MINI_SIZE / 2 - half);
    rows.push({ x, y, width: MINI_SIZE - x * 2, height: 1 });
  }
  mini.setShape(rows);
}
function moveMini(point: Point) {
  if (!mini) return;
  const area = screen.getDisplayNearestPoint({ x: Math.round(point.x + MINI_SIZE / 2), y: Math.round(point.y + MINI_SIZE / 2) }).workArea;
  const fitted = fitPosition(point, { width: MINI_SIZE, height: MINI_SIZE }, area);
  mini.setPosition(fitted.x, fitted.y);
  miniShape();
}
function updateMiniHit(interactive?: boolean) {
  if (!mini || process.platform !== 'darwin' || miniDrag.active) return;
  const bounds = mini.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const hit = interactive ?? Math.hypot(cursor.x - bounds.x - MINI_SIZE / 2, cursor.y - bounds.y - MINI_SIZE / 2) <= MINI_RADIUS;
  mini.setIgnoreMouseEvents(!hit, { forward: true });
}
function applyToolbarPresentation() {
  updateDock();
  if (!toolbar || !mini) return;
  const full = state.settings.toolbarMode === 'visible' || state.toolbarExpanded;
  if (full) { mini.hide(); toolbar.showInactive(); }
  else {
    toolbar.hide();
    if (state.settings.toolbarMode === 'minimal') { mini.showInactive(); updateMiniHit(); }
    else mini.hide();
  }
  refreshTrayMenu();
}
function showTools() {
  if (!toolbar) return;
  if (state.settings.toolbarMode === 'minimal' && mini) {
    const point = mini.getBounds();
    const area = screen.getDisplayMatching(point).workArea;
    const size = toolbar.getBounds();
    const position = fitPosition({ x: point.x, y: point.y + MINI_SIZE + 8 }, size, area);
    toolbar.setPosition(position.x, position.y);
    if (state.settings.toolbarOrientation === 'vertical') prepareToolbarLayout(position, area);
  }
  state.toolbarExpanded = true;
  applyToolbarPresentation(); broadcast();
}
function prepareToolbarLayout(anchor?: Point, workArea?: Electron.Rectangle) {
  if (!toolbar) return;
  const bounds = toolbar.getBounds();
  const area = workArea || screen.getDisplayMatching(bounds).workArea;
  const areaChanged = state.toolbarAvailableHeight !== area.height;
  state.toolbarAvailableHeight = area.height;
  const vertical = state.settings.toolbarOrientation === 'vertical';
  // Give the column room to measure itself before the renderer fits the final size.
  const size = { width: Math.min(vertical ? 66 : 1000, area.width), height: vertical ? area.height : Math.min(72, area.height) };
  const position = fitPosition(anchor || bounds, size, area);
  toolbar.setBounds({ ...position, ...size });
  if (areaChanged) broadcast();
}
function collapseTools() {
  if (state.settings.toolbarMode === 'visible') return setToolbarMode('minimal');
  state.toolbarExpanded = false;
  miniDrag.cancel();
  applyToolbarPresentation(); broadcast();
  return { ok: true };
}
function setToolbarMode(mode: ToolbarMode) {
  if (!['visible', 'minimal', 'hidden'].includes(mode)) return { ok: false, error: 'Modo de barra no válido' };
  try {
    const next = { ...state.settings, toolbarMode: mode };
    saveSettings(next);
    state.settings = next;
    state.toolbarExpanded = mode === 'visible';
    miniDrag.cancel();
    applyToolbarPresentation(); broadcast();
    return { ok: true };
  } catch (error) { return { ok: false, error: String(error) }; }
}
function rememberMiniPosition() {
  if (!mini) return;
  const { x, y } = mini.getBounds();
  miniPosition = { x, y };
  if (smoke) return;
  const file = path.join(app.getPath('userData'), 'window-state.json');
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(miniPosition));
    renameSync(`${file}.tmp`, file);
  } catch (error) { console.error('No se pudo guardar la posición del círculo', error); }
}
function rememberTimerBounds() {
  clearTimeout(timerGeometrySave);
  if (smoke || !timerWindow || timerWindow.isDestroyed()) return;
  const file = path.join(app.getPath('userData'), 'timer-window.json');
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(timerWindow.getBounds()));
    renameSync(`${file}.tmp`, file);
  } catch (error) { console.error('No se pudo guardar el tamaño del temporizador', error); }
}
function timerBounds(): Electron.Rectangle {
  let area = (screen.getAllDisplays().find(display => display.id === activeDisplay) || screen.getPrimaryDisplay()).workArea;
  let position: Point = { x: area.x + area.width - TIMER_WIDTH - 32, y: area.y + 155 };
  let width = TIMER_WIDTH;
  if (!smoke) {
    try {
      const saved = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'timer-window.json'), 'utf8'));
      const point = readPosition(saved);
      if (point) { position = point; area = screen.getDisplayNearestPoint(point).workArea; }
      if (Number.isFinite(saved.width)) width = saved.width;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('No se pudo cargar el tamaño del temporizador', error); }
  }
  width = Math.round(Math.max(280, Math.min(width, 960, area.width, area.height * TIMER_RATIO)));
  const size = { width, height: Math.round(width / TIMER_RATIO) };
  return { ...fitPosition(position, size, area), ...size };
}
async function showTimer() {
  if (!timerWindow || timerWindow.isDestroyed()) {
    const win = createWindow('timer-window', {
      ...timerBounds(), title: 'Temporizador · TeachersPen', frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false, focusable: true,
      skipTaskbar: true, roundedCorners: false, acceptFirstMouse: true
    });
    timerWindow = win;
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: state.settings.toolbarMode === 'hidden' });
    const saveLater = () => {
      if (timerResize) return;
      clearTimeout(timerGeometrySave);
      timerGeometrySave = setTimeout(rememberTimerBounds, 200);
    };
    win.on('moved', saveLater);
    win.on('move', saveLater);
    win.on('closed', () => { if (timerWindow === win) { timerWindow = undefined; timerReady = undefined; timerResize = null; } });
    timerReady = new Promise<void>(resolve => win.webContents.once('did-finish-load', () => resolve()));
  }
  const win = timerWindow;
  await timerReady;
  if (!quitting && state.timer.visible && win && !win.isDestroyed()) win.showInactive();
}
function stopTimer() {
  clearTimeout(timerTimeout);
  if (state.timer.startedAt !== null) state.timer.elapsedMs += Date.now() - state.timer.startedAt;
  state.timer.startedAt = null;
  state.timer.running = false;
  state.timerEnd = null;
}
function resetTimer() {
  stopTimer();
  state.timer.elapsedMs = 0;
}
function startTimer() {
  if (state.timer.running) { stopTimer(); return; }
  const duration = state.settings.timerSeconds * 1000;
  if (state.settings.timerDirection === 'down' && state.timer.elapsedMs >= duration) state.timer.elapsedMs = 0;
  state.timer.startedAt = Date.now();
  state.timer.running = true;
  if (state.settings.timerDirection === 'down') {
    state.timerEnd = Date.now() + duration - state.timer.elapsedMs;
    timerTimeout = setTimeout(() => {
      stopTimer(); state.timer.elapsedMs = duration; broadcast();
    }, Math.max(0, duration - state.timer.elapsedMs));
  }
}
function resizeTimer(pointer: Point) {
  if (!timerResize || !timerWindow) return;
  const { bounds, pointer: start } = timerResize;
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.round(Math.max(280, Math.min(bounds.width + pointer.x - start.x + pointer.y - start.y, 960, area.width, area.height * TIMER_RATIO)));
  const size = { width, height: Math.round(width / TIMER_RATIO) };
  timerWindow.setBounds({ ...fitPosition(bounds, size, area), ...size });
}
function createWindow(role: string, options: Electron.BrowserWindowConstructorOptions) {
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'icons', 'app-256.png'), ...options, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer ${role}: ${details.reason}`);
    // Fail open: never leave an invisible input-blocking overlay after a crash.
    if (role === 'overlay') setDrawing(false);
    if (role === 'timer-window') win.hide();
  });
  win.loadFile(path.join(__dirname, 'index.html'), { query: { role } });
  return win;
}
function setDrawing(drawing: boolean) {
  if (!drawing) { hold.dismiss(); state.holding = false; }
  state.drawing = drawing;
  if (drawing) state.visible = true;
  for (const overlay of overlays.values()) {
    // Automated drawing uses synthetic renderer events; let the user's real clicks pass.
    overlay.setIgnoreMouseEvents(smoke || !drawing);
    overlay.setFocusable(drawing);
  }
  if (drawing && !smoke) overlays.get(activeDisplay)?.focus();
  broadcast();
}
function sendDrawingAction(action: Action) {
  // Clear all screens; undo/redo operate on the last screen used for drawing.
  const targets = action === 'clear' ? [...overlays.values()] : [overlays.get(activeDisplay)];
  for (const win of targets) win?.webContents.send('pen:action', action);
}
function perform(action: Action, fromShortcut = false) {
  if (fromShortcut) activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  if (tools.includes(action as typeof tools[number])) {
    state.tool = action as typeof tools[number]; setDrawing(true);
  } else if (action.startsWith('color')) {
    state.color = Number(action.slice(-1));
    if (fromShortcut) setDrawing(true);
  } else switch (action) {
    case 'toggle': setDrawing(!state.drawing); break;
    case 'undo': case 'redo': case 'clear': sendDrawingAction(action); break;
    case 'visible': state.visible = !state.visible; if (!state.visible) setDrawing(false); break;
    case 'white': case 'black':
      state.background = state.background === action ? 'transparent' : action;
      if (state.background !== 'transparent') {
        // Opening a board from a clean, hidden canvas must not reveal the old ink.
        // Clear through the history so the user can still explicitly undo it.
        if (!state.visible) sendDrawingAction('clear');
        setDrawing(true);
      } else if (!fromShortcut) setDrawing(false);
      break;
    case 'timer':
      state.timer.visible = !state.timer.visible;
      if (state.timer.visible) {
        void showTimer().catch(error => console.error('No se pudo abrir el temporizador', error));
      } else { stopTimer(); timerResize = null; timerWindow?.hide(); }
      break;
  }
  broadcast();
}
function handleShortcut(action: Action, settings = state.settings) {
  if (settings.activation === 'hold' && isDrawingShortcut(action)) hold.press(action, settings.shortcuts[action]);
  else perform(action, true);
}
function registerShortcuts(settings: Settings): string[] {
  hold.stop();
  if (state.holding) setDrawing(false);
  globalShortcut.unregisterAll();
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const accelerator = settings.shortcuts[action];
    if (!accelerator) continue;
    const normalized = accelerator.toLowerCase();
    if (seen.has(normalized)) { errors.push(`${actionLabels[action]}: atajo duplicado (${accelerator})`); continue; }
    seen.add(normalized);
    if (settings.activation === 'hold' && isDrawingShortcut(action)) {
      const error = holdMonitor.validate(accelerator);
      if (error) { errors.push(`${actionLabels[action]}: ${error}`); continue; }
    }
    try {
      if (!globalShortcut.register(accelerator, () => handleShortcut(action, settings))) errors.push(`${actionLabels[action]}: no se puede registrar ${accelerator}`);
    } catch { errors.push(`${actionLabels[action]}: combinación no válida (${accelerator})`); }
  }
  return errors;
}
async function createOverlays() {
  for (const display of screen.getAllDisplays()) {
    if (overlays.has(display.id)) continue;
    const overlay = createWindow('overlay', {
      ...display.bounds, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, movable: false, skipTaskbar: true, focusable: false,
      roundedCorners: false, enableLargerThanScreen: true
    });
    overlays.set(display.id, overlay);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: state.settings.toolbarMode === 'hidden' });
    overlay.setIgnoreMouseEvents(true);
    overlay.on('closed', () => { overlays.delete(display.id); });
    await new Promise<void>(resolve => overlay.webContents.once('did-finish-load', () => { overlay.showInactive(); resolve(); }));
    overlay.setIgnoreMouseEvents(smoke || !state.drawing);
    overlay.setFocusable(state.drawing);
  }
}
function openPreferences() {
  setDrawing(false);
  if (preferences && !preferences.isDestroyed()) { preferences.show(); return; }
  preferences = createWindow('preferences', { width: 650, height: 800, minWidth: 570, minHeight: 500, title: 'Preferencias · TeachersPen', backgroundColor: '#f6f5f1', autoHideMenuBar: true, skipTaskbar: state.settings.toolbarMode === 'hidden' });
  preferences.once('ready-to-show', () => preferences?.show());
  const finishRecording = () => {
    if (!recordingShortcut) return;
    recordingShortcut = false;
    state.shortcutErrors = registerShortcuts(state.settings); broadcast();
  };
  preferences.on('closed', () => { preferences = undefined; finishRecording(); });
  preferences.on('blur', finishRecording);
}
function makeTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icons', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('TeachersPen');
  refreshTrayMenu();
  // macOS opens the native context menu itself; other platforms can open it on click.
  if (process.platform !== 'darwin') tray.on('click', () => tray.popUpContextMenu());
}
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar barra completa', click: showTools },
    { label: 'Contraer / ocultar barra', enabled: state.toolbarExpanded, click: () => { collapseTools(); } },
    { label: 'Barra de dibujo', submenu: (['visible', 'minimal', 'hidden'] as ToolbarMode[]).map(mode => ({
      label: ({ visible: 'Visible', minimal: 'Mínima', hidden: 'Oculta' })[mode], type: 'radio' as const, checked: state.settings.toolbarMode === mode,
      click: () => { const result = setToolbarMode(mode); if (!result.ok) dialog.showErrorBox('TeachersPen', result.error || 'No se pudo cambiar la barra'); }
    })) },
    { label: 'Dibujar / interactuar', click: () => perform('toggle') },
    { label: 'Volver al escritorio', click: () => { state.background = 'transparent'; setDrawing(false); } },
    { label: 'Preferencias…', click: openPreferences },
    { type: 'separator' }, { label: 'Salir de TeachersPen', click: () => app.quit() }
  ]));
}
async function start() {
  if (!smoke) {
    try { state.settings = parseSettings(JSON.parse(readFileSync(settingsPath(), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('No se pudieron cargar las preferencias', error); }
    try { miniPosition = readPosition(JSON.parse(readFileSync(path.join(app.getPath('userData'), 'window-state.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('No se pudo cargar la posición del círculo', error); }
  }
  if (smoke && process.argv.includes('--smoke-hidden-start')) state.settings.toolbarMode = 'hidden';
  state.toolbarExpanded = state.settings.toolbarMode === 'visible';
  updateDock();
  if (process.platform === 'darwin') app.dock!.setIcon(path.join(__dirname, 'icons', 'app-256.png'));
  activeDisplay = screen.getPrimaryDisplay().id;
  ipcMain.handle('pen:get-state', event => {
    if (!windows().some(win => win.webContents === event.sender)) throw new Error('Ventana no autorizada');
    return state;
  });
  ipcMain.handle('pen:command', (event, command: Command) => {
    if (!windows().some(win => win.webContents === event.sender) || !command || typeof command !== 'object') return { ok: false, error: 'Comando no autorizado' };
    try {
      switch (command.type) {
        case 'active-display':
          for (const [id, overlay] of overlays) if (overlay.webContents === event.sender) activeDisplay = id;
          break;
        case 'action': if (actions.includes(command.action)) perform(command.action); break;
        case 'tool':
          if (tools.includes(command.tool)) {
            const exit = state.drawing && state.tool === command.tool;
            state.tool = command.tool; setDrawing(!exit);
          }
          break;
        case 'color':
          if (Number.isInteger(command.index) && command.index >= 0 && command.index < 5) {
            const exit = state.drawing && state.color === command.index;
            state.color = command.index; setDrawing(!exit);
          }
          break;
        case 'width': {
          const next = { ...state.settings, width: parseSettings({ width: command.width }).width };
          saveSettings(next); state.settings = next; break;
        }
        case 'transparency': {
          const next = { ...state.settings, transparency: parseSettings({ transparency: command.transparency }).transparency };
          saveSettings(next); state.settings = next; break;
        }
        case 'record-shortcut':
          if (event.sender !== preferences?.webContents) return { ok: false, error: 'Solo se pueden editar atajos desde Preferencias' };
          recordingShortcut = command.active === true;
          if (command.active) { hold.stop(); setDrawing(false); globalShortcut.unregisterAll(); }
          else state.shortcutErrors = registerShortcuts(state.settings);
          break;
        case 'toolbar-size':
          if (event.sender === toolbar?.webContents && command.orientation === state.settings.toolbarOrientation && Number.isFinite(command.width) && Number.isFinite(command.height)) {
            const bounds = toolbar.getBounds();
            const area = screen.getDisplayMatching(bounds).workArea;
            const vertical = command.orientation === 'vertical';
            const width = Math.max(vertical ? 66 : 200, Math.min(1600, Math.ceil(command.width)));
            const height = Math.max(48, Math.min(vertical ? area.height : 180, Math.ceil(command.height)));
            const anchor = { x: toolbarSized ? bounds.x : Math.round(bounds.x + (bounds.width - width) / 2), y: bounds.y };
            const position = fitPosition(anchor, { width, height }, area);
            toolbar.setBounds({ ...position, width, height });
            toolbarSized = true;
          }
          break;
        case 'toolbar-mode': return setToolbarMode(command.mode);
        case 'show-tools': showTools(); break;
        case 'collapse-tools': return collapseTools();
        case 'toggle-toolbar-orientation': {
          const toolbarOrientation = state.settings.toolbarOrientation === 'horizontal' ? 'vertical' : 'horizontal';
          const next: Settings = { ...state.settings, toolbarOrientation };
          saveSettings(next); state.settings = next;
          prepareToolbarLayout();
          break;
        }
        case 'timer-control':
          if (command.action === 'reset') resetTimer();
          else if (command.action === 'start') startTimer();
          else if (command.action === 'direction') {
            const next = { ...state.settings, timerDirection: state.settings.timerDirection === 'down' ? 'up' as const : 'down' as const };
            saveSettings(next); state.settings = next; resetTimer();
          }
          break;
        case 'timer-settings': {
          const data = command.settings;
          if (!data || typeof data !== 'object') return { ok: false };
          const next = parseSettings({ ...state.settings,
            timerText: data.timerText ?? state.settings.timerText,
            timerSeconds: data.timerSeconds ?? state.settings.timerSeconds,
            timerColor: data.timerColor ?? state.settings.timerColor });
          saveSettings(next);
          if (next.timerSeconds !== state.settings.timerSeconds) resetTimer();
          state.settings = next;
          break;
        }
        case 'timer-resize': {
          if (event.sender !== timerWindow?.webContents || !timerWindow) return { ok: false, error: 'Ventana no autorizada' };
          const pointer = readPosition(command);
          if (!pointer) return { ok: false, error: 'Posición no válida' };
          if (command.phase === 'start') timerResize = { pointer, bounds: timerWindow.getBounds() };
          else if (command.phase === 'move') resizeTimer(pointer);
          else {
            if (command.phase === 'end') resizeTimer(pointer);
            timerResize = null; rememberTimerBounds();
          }
          return { ok: true };
        }
        case 'mini-hit':
          if (event.sender === mini?.webContents) updateMiniHit(command.interactive === true);
          return { ok: true };
        case 'mini-pointer': {
          if (event.sender !== mini?.webContents || !mini) return { ok: false, error: 'Ventana no autorizada' };
          const pointer = readPosition(command);
          if (!pointer) return { ok: false, error: 'Posición no válida' };
          if (command.phase === 'start') {
            const { x, y } = mini.getBounds(); miniDrag.begin(pointer, { x, y });
          } else if (command.phase === 'move') {
            const position = miniDrag.move(pointer); if (position) moveMini(position);
          } else if (command.phase === 'end') {
            const result = miniDrag.end(pointer);
            if (result?.dragged) { if (result.position) moveMini(result.position); rememberMiniPosition(); }
            else if (result) showTools();
            updateMiniHit();
          } else miniDrag.cancel();
          return { ok: true };
        }
        case 'preferences': openPreferences(); break;
        case 'activation': {
          if (command.activation !== 'toggle' && command.activation !== 'hold') return { ok: false, error: 'Modo de activación no válido' };
          const next = { ...state.settings, activation: command.activation };
          const errors = registerShortcuts(next);
          if (errors.length) { state.shortcutErrors = registerShortcuts(state.settings); broadcast(); return { ok: false, error: errors.join('\n') }; }
          try { saveSettings(next); }
          catch (error) { state.shortcutErrors = registerShortcuts(state.settings); throw error; }
          setDrawing(false);
          state.settings = next; state.shortcutErrors = []; state.holdError = null; break;
        }
        case 'settings': {
          // Presentation is applied immediately by its own control, including tray changes.
          const next = parseSettings({ ...command.settings, toolbarMode: state.settings.toolbarMode });
          const orientationChanged = next.toolbarOrientation !== state.settings.toolbarOrientation;
          const errors = registerShortcuts(next);
          if (errors.length) { state.shortcutErrors = registerShortcuts(state.settings); broadcast(); return { ok: false, error: errors.join('\n') }; }
          try { saveSettings(next); }
          catch (error) { state.shortcutErrors = registerShortcuts(state.settings); throw error; }
          if (next.timerSeconds !== state.settings.timerSeconds || next.timerDirection !== state.settings.timerDirection) resetTimer();
          state.settings = next; state.shortcutErrors = []; state.holdError = null;
          if (orientationChanged) prepareToolbarLayout();
          break;
        }
        case 'quit': app.quit(); break;
        default: return { ok: false, error: 'Comando desconocido' };
      }
      broadcast();
      return { ok: true };
    } catch (error) { return { ok: false, error: String(error) }; }
  });
  await createOverlays();
  const area = screen.getPrimaryDisplay().workArea;
  state.toolbarAvailableHeight = area.height;
  const initialVertical = state.settings.toolbarOrientation === 'vertical';
  const initialWidth = initialVertical ? 66 : 965;
  toolbar = createWindow('toolbar', {
    x: area.x + Math.round((area.width - initialWidth) / 2), y: initialVertical ? area.y : area.y + 18,
    width: initialWidth, height: initialVertical ? area.height : 72, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, hasShadow: false, skipTaskbar: true
  });
  toolbar.setAlwaysOnTop(true, 'screen-saver', 1);
  if (process.platform === 'darwin') toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: state.settings.toolbarMode === 'hidden' });
  toolbar.on('close', event => { if (!quitting) { event.preventDefault(); collapseTools(); } });
  let toolbarDisplay = screen.getDisplayMatching(toolbar.getBounds()).id;
  toolbar.on('moved', () => {
    const display = screen.getDisplayMatching(toolbar.getBounds());
    if (display.id !== toolbarDisplay) {
      toolbarDisplay = display.id;
      if (state.settings.toolbarOrientation === 'vertical') prepareToolbarLayout();
    }
  });
  await new Promise<void>(resolve => toolbar.webContents.once('did-finish-load', () => resolve()));
  mini = createWindow('mini', {
    x: area.x + 24, y: area.y + 24, width: MINI_SIZE, height: MINI_SIZE,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    focusable: false, resizable: false, movable: false, skipTaskbar: true, roundedCorners: false, acceptFirstMouse: true
  });
  mini.setAlwaysOnTop(true, 'screen-saver', 2);
  if (process.platform === 'darwin') mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: state.settings.toolbarMode === 'hidden' });
  mini.on('hide', () => miniDrag.cancel());
  await new Promise<void>(resolve => mini!.webContents.once('did-finish-load', () => resolve()));
  moveMini(miniPosition || { x: area.x + 24, y: area.y + 24 });
  state.shortcutErrors = registerShortcuts(state.settings);
  makeTray();
  applyToolbarPresentation();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'TeachersPen', submenu: [ { label: 'Preferencias…', click: openPreferences }, { type: 'separator' }, { role: 'quit', label: 'Salir de TeachersPen' } ] },
    { label: 'Edición', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
  ]));
  screen.on('display-added', () => { void createOverlays(); });
  screen.on('display-removed', (_event, display) => {
    overlays.get(display.id)?.destroy();
    if (activeDisplay === display.id) activeDisplay = screen.getPrimaryDisplay().id;
    if (mini) moveMini(mini.getBounds());
    if (state.settings.toolbarOrientation === 'vertical') prepareToolbarLayout();
    if (timerWindow) {
      const bounds = timerWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      timerWindow.setBounds({ ...fitPosition(bounds, bounds, area), width: bounds.width, height: bounds.height });
    }
  });
  screen.on('display-metrics-changed', () => {
    if (rebuilding) return;
    rebuilding = true;
    setDrawing(false);
    for (const display of screen.getAllDisplays()) overlays.get(display.id)?.setBounds(display.bounds);
    if (mini) moveMini(mini.getBounds());
    if (state.settings.toolbarOrientation === 'vertical') prepareToolbarLayout();
    rebuilding = false;
  });
  app.on('activate', () => { if (state.settings.toolbarMode !== 'hidden') applyToolbarPresentation(); });
  const stopHolding = () => { hold.stop(); if (state.holding) setDrawing(false); };
  powerMonitor.on('suspend', stopHolding);
  powerMonitor.on('lock-screen', stopHolding);
  broadcast();
  if (smoke) await runSmoke();
}
async function runSmoke() {
  const assert: typeof import('node:assert/strict') = (await import('node:assert/strict')).default;
  const overlay = overlays.get(activeDisplay)!;
  const hasInk = () => overlay.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const c = document.querySelector('canvas');
    resolve(c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0));
  })))`);
  // Give React a turn to install event listeners, then exercise the real renderer/IPC.
  await new Promise(resolve => setTimeout(resolve, 500));
  for (const icon of ['app-256.png', 'tray.png', 'trayTemplate.png']) {
    assert.equal(nativeImage.createFromPath(path.join(__dirname, 'icons', icon)).isEmpty(), false, `El icono nativo ${icon} debe poder cargarse`);
  }
  if (process.argv.includes('--smoke-hidden-start')) {
    assert.equal(toolbar.isVisible(), false, 'El arranque oculto no debe revelar la barra');
    assert.equal(mini!.isVisible(), false);
    if (process.platform === 'darwin') assert.equal(app.dock!.isVisible(), false);
  }
  assert.equal(state.drawing, false);
  const clickToolButton = async (label: string) => {
    const position = await toolbar.webContents.executeJavaScript(`(() => { const button=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}); const r=button.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
    toolbar.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
    toolbar.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    await toolbar.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  if (state.settings.toolbarMode === 'hidden') showTools();
  await clickToolButton('Lápiz'); assert.equal(state.drawing, true);
  await clickToolButton('Lápiz'); assert.equal(state.drawing, false, 'El mismo botón debe salir del dibujo');
  await clickToolButton('Línea');
  await clickToolButton('Flecha'); assert.equal(state.tool, 'arrow'); assert.equal(state.drawing, true);
  await clickToolButton('Flecha'); assert.equal(state.drawing, false);
  await clickToolButton('Color 2'); assert.equal(state.drawing, true);
  await clickToolButton('Color 2'); assert.equal(state.drawing, false);
  for (const board of ['Pizarra blanca', 'Pizarra negra']) {
    await clickToolButton(board); assert.equal(state.drawing, true);
    await clickToolButton(board); assert.equal(state.drawing, false); assert.equal(state.background, 'transparent');
  }
  const compactBar = await toolbar.webContents.executeJavaScript(`({grip:!!document.querySelector('.drag-handle .lucide-grip-vertical'),logo:!!document.querySelector('.brand'),footer:!!document.querySelector('.toolbar-footer'),width:document.querySelector('.width-control input').getBoundingClientRect().width,timer:document.querySelector('.timer-five').textContent,last:Array.from(document.querySelectorAll('.toolbar > button')).slice(-4).map(b=>b.getAttribute('aria-label'))})`);
  assert.equal(compactBar.grip, true);
  assert.equal(compactBar.logo, false); assert.equal(compactBar.footer, false);
  assert.ok(compactBar.width >= 68); assert.equal(compactBar.timer, '5');
  assert.deepEqual(compactBar.last, ['Preferencias', 'Contraer barra', 'Girar barra', 'Salir']);
  assert.ok(toolbar.getBounds().height <= 76, 'La ventana debe ajustarse a una sola fila');
  if (state.settings.toolbarMode === 'visible') {
    await clickToolButton('Contraer barra');
    assert.equal(state.settings.toolbarMode, 'minimal');
    assert.equal(toolbar.isVisible(), false); assert.equal(mini!.isVisible(), true);
    setToolbarMode('visible');
  }
  if (state.settings.toolbarMode === 'hidden') collapseTools();
  perform('freehand');
  assert.equal(state.drawing, true);
  await new Promise(resolve => setTimeout(resolve, 100));
  const ink = await overlay.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('canvas');
    const pointer = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {bubbles:true, pointerId:1, clientX:x, clientY:y, button:0, buttons:1}));
    pointer('pointerdown', 100, 200); pointer('pointermove', 200, 260); pointer('pointerup', 200, 260);
    return new Promise(resolve => requestAnimationFrame(() => {
      const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      resolve(pixels.some((v,i) => i % 4 === 3 && v > 0));
    }));
  })()`);
  assert.equal(ink, true, 'El renderer debe pintar el trazo');
  perform('circle');
  await new Promise(resolve => setTimeout(resolve, 100));
  const circlePixels = await overlay.webContents.executeJavaScript(`(async () => {
    const canvas = document.querySelector('canvas');
    const pointer = (type,x,y) => canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,clientX:x,clientY:y,button:0,buttons:1}));
    pointer('pointerdown',420,420); pointer('pointermove',480,420); pointer('pointerup',480,420);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scale = devicePixelRatio;
    const alpha = (x,y) => canvas.getContext('2d').getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data[3];
    return [alpha(480,420),alpha(420,360),alpha(420,420)];
  })()`);
  assert.ok(circlePixels[0] > 0 && circlePixels[1] > 0, 'El círculo debe tener el mismo radio horizontal y vertical');
  assert.equal(circlePixels[2], 0, 'El círculo debe conservar su interior transparente');
  perform('undo');
  await new Promise(resolve => setTimeout(resolve, 100));
  perform('undo');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), false);
  perform('redo');
  await new Promise(resolve => setTimeout(resolve, 100));
  perform('visible');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), false, 'Ocultar debe dejar la pantalla limpia');
  perform('white'); assert.equal(state.background, 'white');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), false, 'La pizarra blanca no debe recuperar los trazos ocultos');
  perform('black'); assert.equal(state.background, 'black');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), false, 'La pizarra negra debe seguir limpia');
  perform('undo');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), true, 'El borrado al abrir una pizarra debe poder deshacerse');
  perform('clear');
  perform('white');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), false, 'Borrar todo y cambiar a blanco debe mantener el lienzo limpio');
  perform('black');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await hasInk(), false, 'Borrar todo y cambiar a negro debe mantener el lienzo limpio');
  perform('white');
  perform('white'); assert.equal(state.background, 'transparent');
  assert.equal(state.drawing, false, 'Pulsar de nuevo la pizarra debe salir del dibujo');
  perform('toggle'); assert.equal(state.drawing, true);
  perform('toggle'); assert.equal(state.drawing, false);
  openPreferences();
  await new Promise<void>(resolve => preferences!.webContents.once('did-finish-load', () => resolve()));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(await preferences!.webContents.executeJavaScript(`document.body.innerText.includes('Atajos globales')`));
  const settingsBeforeMode = structuredClone(state.settings);
  const modePosition = await preferences!.webContents.executeJavaScript(`(() => { const input = document.getElementById('activation-hold'); input.scrollIntoView({block:'center'}); const r = input.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`);
  preferences!.webContents.sendInputEvent({ type: 'mouseDown', ...modePosition, button: 'left', clickCount: 1 });
  preferences!.webContents.sendInputEvent({ type: 'mouseUp', ...modePosition, button: 'left', clickCount: 1 });
  const selectedMode = await preferences!.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = await window.pen.getState();
      if (state.settings.activation === 'hold') return state;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return window.pen.getState();
  })()`);
  assert.equal(selectedMode.settings.activation, 'hold', 'Seleccionar mantener pulsado debe aplicarse sin pulsar Guardar');
  assert.deepEqual(selectedMode.settings, { ...settingsBeforeMode, activation: 'hold' }, 'Cambiar la activación debe conservar los demás ajustes');
  assert.equal(await preferences!.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => resolve(document.getElementById('activation-hold').checked)))`), true);
  const rejected = await preferences!.webContents.executeJavaScript(`(async () => {
    const current = await window.pen.getState();
    current.settings.shortcuts.arrow = current.settings.shortcuts.line;
    return window.pen.command({type:'settings', settings:current.settings});
  })()`);
  assert.equal(rejected.ok, false, 'Se deben rechazar los atajos duplicados');
  assert.equal(state.settings.shortcuts.arrow, defaults().shortcuts.arrow, 'Un fallo debe restaurar los atajos anteriores');
  const saved = await preferences!.webContents.executeJavaScript(`(async () => {
    const current = await window.pen.getState();
    current.settings.width = 8;
    return window.pen.command({type:'settings', settings:current.settings});
  })()`);
  assert.equal(saved.ok, true);
  assert.equal(state.settings.width, 8);
  const miniControl = await preferences!.webContents.executeJavaScript(`(() => { const input = document.getElementById('toolbar-minimal'); input.scrollIntoView({block:'center'}); const r=input.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  preferences!.webContents.sendInputEvent({ type: 'mouseDown', ...miniControl, button: 'left', clickCount: 1 });
  preferences!.webContents.sendInputEvent({ type: 'mouseUp', ...miniControl, button: 'left', clickCount: 1 });
  await preferences!.webContents.executeJavaScript(`(async () => { const end=Date.now()+3000; while(Date.now()<end) { if((await window.pen.getState()).settings.toolbarMode==='minimal') return; await new Promise(r=>setTimeout(r,20)); } })()`);
  assert.equal(state.settings.toolbarMode, 'minimal');
  assert.equal(toolbar.isVisible(), false);
  assert.equal(mini!.isVisible(), true);
  mini!.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
  assert.equal(await mini!.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>resolve(getComputedStyle(document.querySelector('button')).opacity)))`), '0.15');
  mini!.webContents.sendInputEvent({ type: 'mouseMove', x: 28, y: 28 });
  assert.equal(await mini!.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>resolve(getComputedStyle(document.querySelector('button')).opacity)))`), '0.4');
  const miniBefore = mini!.getBounds();
  await mini!.webContents.executeJavaScript(`(async () => {
    const button=document.querySelector('button');
    const send=(type,x,y)=>button.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2,button:0,screenX:x,screenY:y}));
    send('pointerdown',${miniBefore.x + 28},${miniBefore.y + 28});
    send('pointermove',${miniBefore.x + 92},${miniBefore.y + 76});
    send('pointerup',${miniBefore.x + 92},${miniBefore.y + 76});
    await window.pen.getState();
  })()`);
  assert.equal(toolbar.isVisible(), false, 'Arrastrar el círculo no debe abrir la barra');
  assert.equal(mini!.getBounds().x, miniBefore.x + 64);
  assert.equal(mini!.getBounds().y, miniBefore.y + 48);
  const miniAfterDrag = mini!.getBounds();
  mini!.webContents.sendInputEvent({ type: 'mouseDown', x: 28, y: 28, button: 'left', clickCount: 1 });
  mini!.webContents.sendInputEvent({ type: 'mouseUp', x: 28, y: 28, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(toolbar.isVisible(), true, 'Un clic en el círculo debe abrir la barra');
  assert.equal(mini!.isVisible(), false);
  collapseTools();
  assert.deepEqual(mini!.getBounds(), miniAfterDrag, 'Contraer debe devolver el círculo a su posición');
  assert.equal(setToolbarMode('hidden').ok, true);
  assert.equal(toolbar.isVisible(), false);
  assert.equal(mini!.isVisible(), false);
  assert.equal(tray.isDestroyed(), false);
  if (process.platform === 'darwin') {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(app.dock!.isVisible(), false, 'El modo oculto debe quitar el icono del Dock');
  }
  perform('freehand');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(toolbar.isVisible(), false, 'Dibujar en modo oculto no debe revelar la barra');
  assert.equal(mini!.isVisible(), false);
  assert.equal(await overlay.webContents.executeJavaScript(`document.querySelector('.drawing-hint')===null`), true);
  setDrawing(false);
  showTools();
  assert.equal(toolbar.isVisible(), true, 'El menú del sistema debe poder recuperar la barra');
  collapseTools();
  assert.equal(toolbar.isVisible(), false);
  const holdSettings: Settings = { ...state.settings, activation: 'hold', shortcuts: { ...state.settings.shortcuts, toggle: 'Control+Shift+F19' } };
  state.shortcutErrors = registerShortcuts(holdSettings);
  assert.equal(state.shortcutErrors.length, 0, state.shortcutErrors.join(', '));
  state.settings = holdSettings;
  assert.equal(state.holdAvailable, true);
  // A shortcut already released when its watcher starts must never latch drawing on.
  await new Promise<void>((resolve, reject) => {
    holdMonitor.watch(holdSettings.shortcuts.toggle,
      () => reject(new Error('El atajo de prueba debería estar suelto')),
      resolve, message => reject(new Error(message)));
  });
  assert.equal(state.drawing, false);
  const nativeProbe = process.argv.find(arg => arg.startsWith('--test-native-hold='))?.slice('--test-native-hold='.length);
  if (nativeProbe) {
    const { spawn } = await import('node:child_process');
    const waitFor = async (predicate: () => boolean, timeout = 400) => {
      const deadline = Date.now() + timeout;
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(predicate(), `El modo dibujo debe responder a la pulsación/liberación nativa (drawing=${state.drawing}, holding=${state.holding}, error=${state.holdError})`);
    };
    for (const modifierFirst of [false, true]) {
      const probe = spawn(nativeProbe, modifierFirst ? ['--modifier-first'] : [], { stdio: ['ignore', 'pipe', 'pipe'] });
      let postedDown = false;
      let modifierReleased = false;
      let probeError = '';
      probe.stdout.on('data', (chunk: Buffer) => {
        const message = chunk.toString();
        // macOS does not dispatch synthesized CGEvents to Carbon global hotkeys.
        // Enter via the same callback and check real native state/release end to end.
        if (message.includes('down')) { postedDown = true; handleShortcut('toggle'); }
        if (message.includes('modifier-up')) modifierReleased = true;
      });
      probe.stderr.on('data', (chunk: Buffer) => { probeError += chunk.toString(); });
      const exited = new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.once('close', code => code === 0 ? resolve() : reject(new Error(probeError || `Prueba nativa: ${code}`)));
      });
      try {
        await waitFor(() => postedDown, 3000);
        await waitFor(() => state.drawing && state.holding, 1000);
        assert.equal(toolbar.isVisible(), false, 'El atajo mantenido debe dibujar sin revelar la barra oculta');
        assert.equal(mini!.isVisible(), false);
        if (modifierFirst) {
          await waitFor(() => modifierReleased, 2000);
          await waitFor(() => !state.drawing, 1000);
        }
        await exited;
        await waitFor(() => !state.drawing && !state.holding);
      } finally { await exited; }
    }
    console.log('HOLD NATIVO OK: activación con estado real del teclado, liberación de tecla y de modificador.');
  }
  perform('timer'); assert.equal(state.timer.visible, true); assert.equal(state.timer.running, false);
  perform('timer'); assert.equal(state.timer.visible, false);
  setToolbarMode('visible');
  assert.equal(toolbar.isVisible(), true);
  assert.equal(mini!.isVisible(), false);
  assert.equal(await overlay.webContents.executeJavaScript('typeof window.require'), 'undefined');
  assert.ok(state.shortcutErrors.length === 0, state.shortcutErrors.join(', '));
  const artifacts = app.isPackaged ? path.join(app.getPath('temp'), 'teacherspen-smoke') : path.join(app.getAppPath(), '.artifacts');
  mkdirSync(artifacts, { recursive: true });
  await preferences!.webContents.executeJavaScript('window.scrollTo(0,0)');
  writeFileSync(path.join(artifacts, 'mini.png'), (await mini!.webContents.capturePage()).toPNG());
  writeFileSync(path.join(artifacts, 'toolbar.png'), (await toolbar.webContents.capturePage()).toPNG());
  writeFileSync(path.join(artifacts, 'preferences.png'), (await preferences!.webContents.capturePage()).toPNG());
  console.log('SMOKE OK: ventanas reales, dibujo Canvas, deshacer, IPC, pizarras, modo interacción, preferencias y atajos registrados.');
  app.quit();
}
app.on('before-quit', () => { quitting = true; hold.stop(); clearTimeout(timerTimeout); clearTimeout(timerGeometrySave); rememberTimerBounds(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
