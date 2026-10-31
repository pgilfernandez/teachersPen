import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { actions, actionLabels, defaults, parseSettings, tools, type Action, type Command, type Settings, type State } from './shared';
import { HoldActivation, isDrawingShortcut } from './hold';
import { NativeHoldMonitor } from './native-hold';

const smoke = process.argv.includes('--smoke-test');
app.setName('TeachersPen');
const overlays = new Map<number, BrowserWindow>();
let toolbar: BrowserWindow;
let preferences: BrowserWindow | undefined;
let tray: Tray;
let activeDisplay: number;
let quitting = false;
let rebuilding = false;
let recordingShortcut = false;
let timerTimeout: ReturnType<typeof setTimeout> | undefined;
const nativeDirectory = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'native') : path.join(__dirname, 'native');
const holdMonitor = new NativeHoldMonitor(path.join(nativeDirectory, process.platform === 'win32' ? 'key-state.exe' : 'key-state'));
const state: State = {
  drawing: false, tool: 'freehand', color: 1, visible: true, background: 'transparent', timerEnd: null,
  settings: defaults(), shortcutErrors: [], platform: process.platform,
  wayland: process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY,
  holding: false, holdAvailable: holdMonitor.available, holdError: null
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
  app.on('second-instance', () => { toolbar?.show(); });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
function windows() { return [...overlays.values(), toolbar, preferences].filter((win): win is BrowserWindow => !!win && !win.isDestroyed()); }
function broadcast() { for (const win of windows()) win.webContents.send('pen:state', state); }
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function saveSettings(settings: Settings) {
  if (smoke) return;
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(`${settingsPath()}.tmp`, JSON.stringify(settings, null, 2));
  renameSync(`${settingsPath()}.tmp`, settingsPath());
}
function createWindow(role: string, options: Electron.BrowserWindowConstructorOptions) {
  const win = new BrowserWindow({
    ...options, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer ${role}: ${details.reason}`);
    // Fail open: never leave an invisible input-blocking overlay after a crash.
    if (role === 'overlay') setDrawing(false);
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
      }
      break;
    case 'timer':
      clearTimeout(timerTimeout);
      state.timerEnd = state.timerEnd ? null : Date.now() + state.settings.timerSeconds * 1000;
      if (state.timerEnd) timerTimeout = setTimeout(() => { state.timerEnd = null; broadcast(); }, state.settings.timerSeconds * 1000 + 1000);
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
    if (process.platform === 'darwin') overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
  preferences = createWindow('preferences', { width: 650, height: 800, minWidth: 570, minHeight: 500, title: 'Preferencias · TeachersPen', backgroundColor: '#f6f5f1', autoHideMenuBar: true });
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
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    if (Math.abs(x + y - 15) < 3) {
      const offset = (y * 16 + x) * 4;
      pixels[offset] = 40; pixels[offset + 1] = 105; pixels[offset + 2] = 210; pixels[offset + 3] = 255;
    }
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: 16, height: 16, scaleFactor: 1 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('TeachersPen');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar herramientas', click: () => toolbar.showInactive() },
    { label: 'Dibujar / interactuar', click: () => perform('toggle') },
    { label: 'Volver al escritorio', click: () => { state.background = 'transparent'; setDrawing(false); } },
    { label: 'Preferencias…', click: openPreferences },
    { type: 'separator' }, { label: 'Salir de TeachersPen', click: () => app.quit() }
  ]));
  tray.on('click', () => toolbar.showInactive());
}
async function start() {
  if (!smoke) {
    try { state.settings = parseSettings(JSON.parse(readFileSync(settingsPath(), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('No se pudieron cargar las preferencias', error); }
  }
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
        case 'tool': if (tools.includes(command.tool)) { state.tool = command.tool; setDrawing(true); } break;
        case 'color': if (Number.isInteger(command.index) && command.index >= 0 && command.index < 5) state.color = command.index; break;
        case 'width': {
          const next = { ...state.settings, width: parseSettings({ width: command.width }).width };
          saveSettings(next); state.settings = next; break;
        }
        case 'record-shortcut':
          if (event.sender !== preferences?.webContents) return { ok: false, error: 'Solo se pueden editar atajos desde Preferencias' };
          recordingShortcut = command.active === true;
          if (command.active) { hold.stop(); setDrawing(false); globalShortcut.unregisterAll(); }
          else state.shortcutErrors = registerShortcuts(state.settings);
          break;
        case 'toolbar-size':
          if (event.sender === toolbar?.webContents && Number.isFinite(command.height)) toolbar.setContentSize(toolbar.getContentSize()[0], Math.max(90, Math.min(180, Math.ceil(command.height))));
          break;
        case 'preferences': openPreferences(); break;
        case 'settings': {
          const next = parseSettings(command.settings);
          const errors = registerShortcuts(next);
          if (errors.length) { state.shortcutErrors = registerShortcuts(state.settings); broadcast(); return { ok: false, error: errors.join('\n') }; }
          try { saveSettings(next); }
          catch (error) { state.shortcutErrors = registerShortcuts(state.settings); throw error; }
          state.settings = next; state.shortcutErrors = []; state.holdError = null; break;
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
  toolbar = createWindow('toolbar', {
    x: area.x + Math.round((area.width - 965) / 2), y: area.y + 18,
    width: 965, height: 150, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, hasShadow: false, skipTaskbar: true
  });
  toolbar.setAlwaysOnTop(true, 'screen-saver', 1);
  if (process.platform === 'darwin') toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toolbar.on('close', event => { if (!quitting) { event.preventDefault(); toolbar.hide(); } });
  await new Promise<void>(resolve => toolbar.webContents.once('did-finish-load', () => { toolbar.showInactive(); resolve(); }));
  state.shortcutErrors = registerShortcuts(state.settings);
  makeTray();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'TeachersPen', submenu: [ { label: 'Preferencias…', click: openPreferences }, { type: 'separator' }, { role: 'quit', label: 'Salir de TeachersPen' } ] },
    { label: 'Edición', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
  ]));
  screen.on('display-added', () => { void createOverlays(); });
  screen.on('display-removed', (_event, display) => {
    overlays.get(display.id)?.destroy();
    if (activeDisplay === display.id) activeDisplay = screen.getPrimaryDisplay().id;
  });
  screen.on('display-metrics-changed', () => {
    if (rebuilding) return;
    rebuilding = true;
    setDrawing(false);
    for (const display of screen.getAllDisplays()) overlays.get(display.id)?.setBounds(display.bounds);
    rebuilding = false;
  });
  app.on('activate', () => toolbar.showInactive());
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
  assert.equal(state.drawing, false);
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
  perform('toggle'); assert.equal(state.drawing, false);
  openPreferences();
  await new Promise<void>(resolve => preferences!.webContents.once('did-finish-load', () => resolve()));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(await preferences!.webContents.executeJavaScript(`document.body.innerText.includes('Atajos globales')`));
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
  const holdSettings: Settings = { ...state.settings, activation: 'hold', shortcuts: { ...state.settings.shortcuts, toggle: 'Control+Shift+F19' } };
  state.shortcutErrors = registerShortcuts(holdSettings);
  assert.equal(state.shortcutErrors.length, 0, state.shortcutErrors.join(', '));
  state.settings = holdSettings;
  assert.equal(state.holdAvailable, true);
  // A shortcut already released when its watcher starts must never latch drawing on.
  hold.press('toggle', holdSettings.shortcuts.toggle);
  await new Promise(resolve => setTimeout(resolve, 150));
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
  perform('timer'); assert.ok(state.timerEnd && state.timerEnd > Date.now());
  perform('timer'); assert.equal(state.timerEnd, null);
  assert.equal(await overlay.webContents.executeJavaScript('typeof window.require'), 'undefined');
  assert.ok(state.shortcutErrors.length === 0, state.shortcutErrors.join(', '));
  const artifacts = app.isPackaged ? path.join(app.getPath('temp'), 'teacherspen-smoke') : path.join(app.getAppPath(), '.artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(path.join(artifacts, 'toolbar.png'), (await toolbar.webContents.capturePage()).toPNG());
  writeFileSync(path.join(artifacts, 'preferences.png'), (await preferences!.webContents.capturePage()).toPNG());
  console.log('SMOKE OK: ventanas reales, dibujo Canvas, deshacer, IPC, pizarras, modo interacción, preferencias y atajos registrados.');
  app.quit();
}
app.on('before-quit', () => { quitting = true; hold.stop(); clearTimeout(timerTimeout); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
