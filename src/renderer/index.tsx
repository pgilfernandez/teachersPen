import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { actionLabels, actions, defaults, type Action, type Command, type Settings, type State, type Tool, type ToolbarMode } from '../shared';
import { MINI_RADIUS, MINI_SIZE } from '../toolbar';
import { Pencil, Slash, ArrowUpRight, RectangleHorizontal, Circle, Undo2, Redo2, Trash2, Eye, EyeOff, Settings as SettingsIcon, Timer as TimerIcon, GripVertical, PanelTopClose, RotateCw, Power, X, type LucideIcon } from 'lucide-react';
import { DrawingHistory, type Stroke } from '../model';
import { paintStroke } from './draw';

const role = new URLSearchParams(location.search).get('role') || 'toolbar';
document.body.className = role;
const command = (value: Command) => window.pen.command(value);
const action = (value: Action) => command({ type: 'action', action: value });
const toolNames: Record<Tool, string> = { freehand: 'Lápiz', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo', circle: 'Círculo' };
const toolIcons: Record<Tool, LucideIcon> = { freehand: Pencil, line: Slash, arrow: ArrowUpRight, rectangle: RectangleHorizontal, circle: Circle };
function keyLabel(value: string) { return value.replace(/Control/g, 'Ctrl').replace(/Shift/g, 'Mayús').replace(/Space/g, 'Espacio'); }

function App() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState('');
  useEffect(() => {
    // Subscribe first so a startup broadcast cannot be lost between initial read and listener setup.
    let received = false;
    const unsubscribe = window.pen.onState(next => { received = true; setState(next); });
    window.pen.getState().then(next => { if (!received) setState(next); }).catch(e => setError(String(e)));
    return unsubscribe;
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state?.drawing) void action('toggle');
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [state?.drawing]);
  if (!state) return error ? <p role="alert">{error}</p> : null;
  if (role === 'overlay') return <Overlay state={state} />;
  if (role === 'preferences') return <Preferences state={state} />;
  if (role === 'mini') return <MiniLauncher state={state} />;
  return <Toolbar state={state} />;
}

function MiniLauncher({ state }: { state: State }) {
  const pointer = useRef<number | null>(null);
  const hit = useRef<boolean | null>(null);
  useEffect(() => {
    hit.current = null;
    if (state.toolbarExpanded || state.settings.toolbarMode !== 'minimal') pointer.current = null;
  }, [state.toolbarExpanded, state.settings.toolbarMode]);
  useEffect(() => {
    const sendHit = (interactive: boolean) => {
      if (hit.current === interactive || pointer.current !== null) return;
      hit.current = interactive;
      void command({ type: 'mini-hit', interactive });
    };
    const move = (event: MouseEvent) => sendHit(Math.hypot(event.clientX - MINI_SIZE / 2, event.clientY - MINI_SIZE / 2) <= MINI_RADIUS);
    const leave = () => sendHit(false);
    document.addEventListener('mousemove', move);
    document.documentElement.addEventListener('mouseleave', leave);
    return () => { document.removeEventListener('mousemove', move); document.documentElement.removeEventListener('mouseleave', leave); };
  }, []);
  const send = (phase: 'start' | 'move' | 'end' | 'cancel', event: React.PointerEvent) =>
    command({ type: 'mini-pointer', phase, x: event.screenX, y: event.screenY });
  return <button className="mini-launcher" aria-label="Abrir barra de dibujo" title="TeachersPen · Clic para abrir, arrastra para mover"
    onPointerDown={event => {
      if (event.button !== 0 || pointer.current !== null) return;
      event.preventDefault(); pointer.current = event.pointerId;
      if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
      void send('start', event);
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId) void send('move', event); }}
    onPointerUp={event => { if (pointer.current === event.pointerId) { pointer.current = null; void send('end', event); } }}
    onPointerCancel={event => { if (pointer.current !== null) { pointer.current = null; void send('cancel', event); } }}
    onLostPointerCapture={event => { if (pointer.current !== null) { pointer.current = null; void send('cancel', event); } }}
    onClick={event => { if (event.detail === 0) void command({ type: 'show-tools' }); }}>
    <img src="mini-launcher.svg" width="50" height="50" alt="" draggable={false} aria-hidden="true" />
  </button>;
}

function Overlay({ state }: { state: State }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef(new DrawingHistory());
  const current = useRef<Stroke | null>(null);
  const pointerId = useRef<number | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const frame = useRef<number | null>(null);
  const redraw = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = canvas.current;
      if (!element) return;
      const ctx = element.getContext('2d')!;
      const scale = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, element.width, element.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      if (latest.current.visible) {
        for (const stroke of history.current.strokes) paintStroke(ctx, stroke);
        if (current.current) paintStroke(ctx, current.current);
      }
    });
  };
  const finish = () => {
    if (current.current) history.current.add(current.current);
    current.current = null;
    pointerId.current = null;
    redraw();
  };
  useEffect(() => {
    const resize = () => {
      const element = canvas.current!;
      const scale = window.devicePixelRatio || 1;
      element.width = Math.round(innerWidth * scale);
      element.height = Math.round(innerHeight * scale);
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    const off = window.pen.onAction(value => {
      finish();
      if (value === 'undo') history.current.undo();
      if (value === 'redo') history.current.redo();
      if (value === 'clear') history.current.clear();
      redraw();
    });
    window.addEventListener('blur', finish);
    return () => {
      off(); window.removeEventListener('resize', resize); window.removeEventListener('blur', finish);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => { if (!state.drawing) finish(); redraw(); }, [state.drawing, state.visible]);
  return <div className={`overlay-surface ${state.background} ${state.drawing ? 'drawing' : ''}`}>
    <canvas ref={canvas}
      onPointerDown={event => {
        if (!state.drawing || event.button !== 0 || pointerId.current !== null) return;
        event.preventDefault();
        void command({ type: 'active-display' });
        pointerId.current = event.pointerId;
        // Synthetic smoke-test events do not have an active native pointer.
        if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
        current.current = { tool: state.tool, color: state.settings.colors[state.color], width: state.settings.width, transparency: state.settings.transparency, points: [{ x: event.clientX, y: event.clientY }] };
        redraw();
      }}
      onPointerMove={event => {
        if (pointerId.current !== event.pointerId || !current.current) return;
        const stroke = current.current;
        const point = { x: event.clientX, y: event.clientY };
        if (stroke.tool === 'freehand') {
          const last = stroke.points[stroke.points.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.5) stroke.points.push(point);
        } else stroke.points = [stroke.points[0], point];
        redraw();
      }}
      onPointerUp={event => {
        if (pointerId.current !== event.pointerId || !current.current) return;
        const point = { x: event.clientX, y: event.clientY };
        if (current.current.tool === 'freehand') current.current.points.push(point);
        else current.current.points = [current.current.points[0], point];
        finish();
      }}
      onPointerCancel={finish} onLostPointerCapture={finish}
    />
    {state.timerEnd && <Timer end={state.timerEnd} />}
    {state.drawing && state.settings.toolbarMode !== 'hidden' && <div className="drawing-hint">{toolNames[state.tool]} · {state.holding ? 'Suelta el atajo para interactuar' : 'Esc para interactuar'}</div>}
  </div>;
}
function Timer({ end }: { end: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  return <div className={`timer ${left <= 10 ? 'ending' : ''}`} role="timer">{Math.floor(left / 60).toString().padStart(2, '0')}:{(left % 60).toString().padStart(2, '0')}</div>;
}
function Toolbar({ state }: { state: State }) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (element.current) {
        const bounds = element.current.getBoundingClientRect();
        void command({ type: 'toolbar-size', width: bounds.width + 16, height: bounds.height + 16, orientation: state.settings.toolbarOrientation });
      }
    });
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, [state.settings.toolbarOrientation]);
  const tip = (label: string, name: Action) => `${label} · ${keyLabel(state.settings.shortcuts[name]) || 'Sin atajo'}`;
  const warning = state.holdError || state.shortcutErrors.join('\n') || (state.wayland ? 'Compatibilidad experimental con Wayland' : '');
  return <main className={`toolbar-shell ${state.settings.toolbarOrientation === 'vertical' ? 'toolbar-vertical' : ''}`} style={state.settings.toolbarOrientation === 'vertical' ? { maxHeight: Math.max(48, state.toolbarAvailableHeight - 16) } : undefined} ref={element}>
    <div className="toolbar">
      <div className="drag-handle" title="Arrastra para mover la barra" role="img" aria-label="Mover barra"><GripVertical size={18} aria-hidden="true" /></div>
      <div className="button-group">
        {(Object.keys(toolNames) as Tool[]).map(tool => { const ToolIcon = toolIcons[tool]; return <button key={tool} className={`icon-button ${state.tool === tool && state.drawing ? 'selected' : ''}`} title={tip(toolNames[tool], tool)} aria-label={toolNames[tool]} aria-pressed={state.tool === tool && state.drawing} onClick={() => void command({ type: 'tool', tool })}><ToolIcon size={21} aria-hidden="true" /></button>; })}
        <button className={`board-button board-white ${state.background === 'white' ? 'active' : ''}`} aria-label="Pizarra blanca" aria-pressed={state.background === 'white'} onClick={() => void action('white')} title={tip('Pizarra blanca', 'white')} />
        <button className={`board-button board-black ${state.background === 'black' ? 'active' : ''}`} aria-label="Pizarra negra" aria-pressed={state.background === 'black'} onClick={() => void action('black')} title={tip('Pizarra negra', 'black')} />
        <button className={`icon-button timer-button ${state.timerEnd ? 'selected' : ''}`} aria-label="Temporizador" aria-pressed={!!state.timerEnd} onClick={() => void action('timer')} title={tip('Temporizador', 'timer')}><span className="timer-five" aria-hidden="true"><TimerIcon size={22} /><span className="timer-number">5</span></span></button>
      </div>
      <div className="divider" />
      <div className="colors">{state.settings.colors.map((color, index) => <button key={index} className={`swatch ${state.color === index && state.drawing ? 'active' : ''}`} style={{ backgroundColor: color }} title={tip(`Color ${index + 1}`, `color${index}` as Action)} aria-label={`Color ${index + 1}`} aria-pressed={state.color === index && state.drawing} onClick={() => void command({ type: 'color', index })} />)}</div>
      <label className="width-control" title="Grosor del trazo"><span>px</span><input aria-label="Grosor" type="number" min="1" max="40" value={state.settings.width} onChange={e => void command({ type: 'width', width: Number(e.target.value) })} /></label>
      <label className="width-control" title="Transparencia de los trazos: 0% opaco, 100% invisible"><input aria-label="Transparencia de los trazos" type="number" min="0" max="100" step="1" value={state.settings.transparency} onChange={e => void command({ type: 'transparency', transparency: Number(e.target.value) })} /><span>%</span></label>
      <div className="divider" />
      <button className="icon-button" aria-label="Deshacer" title={tip('Deshacer', 'undo')} onClick={() => void action('undo')}><Undo2 size={21} aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Rehacer" title={tip('Rehacer', 'redo')} onClick={() => void action('redo')}><Redo2 size={21} aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Borrar todo" title={tip('Borrar todo', 'clear')} onClick={() => void action('clear')}><Trash2 size={20} aria-hidden="true" /></button>
      <button className={`icon-button ${!state.visible ? 'selected' : ''}`} aria-label="Ocultar o mostrar" title={tip('Ocultar / mostrar', 'visible')} onClick={() => void action('visible')}>{state.visible ? <Eye size={21} aria-hidden="true" /> : <EyeOff size={21} aria-hidden="true" />}</button>
      <div className="divider" />
      <button className={`icon-button ${warning ? 'has-warning' : ''}`} aria-label="Preferencias" title={warning ? `Preferencias\n${warning}` : 'Preferencias'} onClick={() => void command({ type: 'preferences' })}><SettingsIcon size={20} aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Contraer barra" title={state.settings.toolbarMode === 'hidden' ? 'Ocultar barra' : 'Contraer barra'} onClick={() => void command({ type: 'collapse-tools' })}><PanelTopClose size={20} aria-hidden="true" /></button>
      <button className={`icon-button ${state.settings.toolbarOrientation === 'vertical' ? 'selected' : ''}`} aria-label="Girar barra" aria-pressed={state.settings.toolbarOrientation === 'vertical'} title={state.settings.toolbarOrientation === 'horizontal' ? 'Poner la barra vertical' : 'Poner la barra horizontal'} onClick={() => void command({ type: 'toggle-toolbar-orientation' })}><RotateCw size={20} aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Salir" title="Salir de TeachersPen" onClick={() => void command({ type: 'quit' })}><Power size={20} aria-hidden="true" /></button>
    </div>
  </main>;
}
function Preferences({ state }: { state: State }) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(state.settings));
  useEffect(() => { setDraft(previous => ({ ...previous, transparency: state.settings.transparency })); }, [state.settings.transparency]);
  useEffect(() => { setDraft(previous => ({ ...previous, toolbarOrientation: state.settings.toolbarOrientation })); }, [state.settings.toolbarOrientation]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingActivation, setChangingActivation] = useState(false);
  const [changingToolbar, setChangingToolbar] = useState(false);
  const [recording, setRecording] = useState<Action | null>(null);
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setMessage(''); };
  const busy = saving || changingActivation || changingToolbar;
  const changeToolbar = async (mode: ToolbarMode) => {
    setChangingToolbar(true);
    try {
      const result = await command({ type: 'toolbar-mode', mode });
      if (result.ok) {
        setDraft(previous => ({ ...previous, toolbarMode: mode }));
        setMessage('Modo de barra aplicado y guardado.');
      } else setMessage(result.error || 'No se ha podido cambiar la barra.');
      return result.ok;
    } catch (error) { setMessage(String(error)); return false; }
    finally { setChangingToolbar(false); }
  };
  const changeActivation = async (activation: Settings['activation']) => {
    setChangingActivation(true);
    try {
      const result = await command({ type: 'activation', activation });
      if (result.ok) {
        setDraft(previous => ({ ...previous, activation }));
        setMessage('Modo de activación aplicado y guardado.');
      } else setMessage(result.error || 'No se ha podido cambiar el modo de activación.');
    } catch (error) { setMessage(String(error)); }
    finally { setChangingActivation(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const result = await command({ type: 'settings', settings: draft });
      setMessage(result.ok ? 'Preferencias guardadas.' : result.error || 'No se han podido guardar.');
    } catch (error) { setMessage(String(error)); }
    finally { setSaving(false); }
  };
  return <main className="preferences-main">
    <header><div className="eyebrow">TEACHERSPEN / PREFERENCIAS</div><h1>Tu pantalla, tu pizarra.</h1><p>Configura las herramientas para acompañar tus clases.</p></header>
    <section><h2>Barra de dibujo</h2>
      <div className="toolbar-options" role="radiogroup" aria-label="Barra de dibujo">{(['visible', 'minimal', 'hidden'] as ToolbarMode[]).map(mode => <label className={state.settings.toolbarMode === mode ? 'active' : ''} key={mode}>
        <input id={`toolbar-${mode}`} type="radio" name="toolbar-mode" checked={state.settings.toolbarMode === mode} disabled={busy} onChange={() => void changeToolbar(mode)} />
        <span><strong>{({ visible: 'Visible', minimal: 'Mínima', hidden: 'Oculta' })[mode]}</strong><small>{({ visible: 'La barra completa permanece en pantalla.', minimal: 'Un círculo con el icono. Arrastra para moverlo; haz clic para abrir la barra.', hidden: 'Solo el icono del sistema. Dibuja usando los atajos.' })[mode]}</small></span>
      </label>)}</div>
      <p className="help">Se aplica y guarda al seleccionarlo. El botón mínimo tiene un 15% de opacidad, y un 40% al pasar el ratón.</p>
    </section>
    <section><h2>Dibujo</h2><div className="setting-row"><label htmlFor="line-width">Grosor del trazo</label><div><input id="line-width" type="number" min="1" max="40" value={draft.width} onChange={e => field('width', Number(e.target.value))} /> <span className="muted">px</span></div></div>
      <div className="setting-row"><span id="activation-label">Activación</span><div className="activation-options" role="radiogroup" aria-labelledby="activation-label">
        <label className={state.settings.activation === 'toggle' ? 'active' : ''}><input id="activation-toggle" type="radio" name="activation" checked={state.settings.activation === 'toggle'} disabled={busy} onChange={() => void changeActivation('toggle')} />Pulsar para activar / desactivar</label>
        <label className={state.settings.activation === 'hold' ? 'active' : ''}><input id="activation-hold" type="radio" name="activation" checked={state.settings.activation === 'hold'} disabled={busy || !state.holdAvailable} onChange={() => void changeActivation('hold')} />Mantener pulsado</label>
      </div></div>
      <p className="help">El modo de activación se aplica y guarda al seleccionarlo.</p>
      {state.settings.activation === 'hold' && <p className="help">Mantén pulsado el atajo de activación, de una herramienta o de un color mientras dibujas. Al soltar cualquiera de sus teclas vuelves a interactuar. Los botones de la barra también permiten activar el dibujo manualmente.</p>}
      <p className="help">Al salir del dibujo, los trazos permanecen visibles y puedes volver a usar las aplicaciones de debajo. Esc sale del modo dibujo.</p>
    </section>
    <section><h2>Colores</h2><div className="preset-colors">{draft.colors.map((color, index) => <label key={index}><input aria-label={`Color ${index + 1}`} type="color" value={color} onChange={e => field('colors', draft.colors.map((old, i) => i === index ? e.target.value : old))} /><span>Color {index + 1}</span></label>)}</div></section>
    <section><h2>Atajos globales</h2><p className="help">Pulsa un campo y escribe la combinación. Se aplican al guardar. Esc cancela; Retroceso elimina el atajo.</p>
      <div className="shortcut-list">{actions.map(name => <div className="shortcut-row" key={name}><label htmlFor={`shortcut-${name}`}>{actionLabels[name]}</label><input id={`shortcut-${name}`} readOnly value={recording === name ? 'Pulsa la combinación…' : keyLabel(draft.shortcuts[name])} placeholder="Sin atajo" onFocus={() => { setRecording(name); void command({ type: 'record-shortcut', active: true }); }} onBlur={() => { setRecording(null); void command({ type: 'record-shortcut', active: false }); }} onKeyDown={event => {
        event.preventDefault();
        if (event.key === 'Tab') { setRecording(null); event.currentTarget.blur(); return; }
        if (event.key === 'Escape') { event.currentTarget.blur(); return; }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (name !== 'toggle') field('shortcuts', { ...draft.shortcuts, [name]: '' });
          event.currentTarget.blur(); return;
        }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        if (!event.ctrlKey && !event.altKey && !event.metaKey) { setMessage('Incluye Ctrl, Alt o Cmd para evitar activar herramientas mientras escribes.'); return; }
        const key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : event.code === 'Space' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
        const parts = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && (state.platform === 'darwin' ? 'Command' : 'Super'), key].filter(Boolean);
        field('shortcuts', { ...draft.shortcuts, [name]: parts.join('+') });
        event.currentTarget.blur();
      }} /><button className="remove-shortcut" disabled={name === 'toggle'} aria-label={`Eliminar atajo de ${actionLabels[name]}`} onClick={() => field('shortcuts', { ...draft.shortcuts, [name]: '' })}><X size={16} aria-hidden="true" /></button></div>)}</div>
    </section>
    <section><h2>Temporizador</h2><div className="setting-row"><label htmlFor="timer-duration">Duración en minutos</label><input id="timer-duration" type="number" min="1" max="120" step="1" value={draft.timerSeconds / 60} onChange={e => field('timerSeconds', Math.max(1, Number(e.target.value)) * 60)} /></div><p className="help">El atajo inicia o cancela la cuenta atrás. Cambiar la duración se aplica al siguiente temporizador.</p></section>
    {state.shortcutErrors.length > 0 && <div className="notice" role="alert">{state.shortcutErrors.join('\n')}</div>}
    {state.holdError && <div className="notice" role="alert">{state.holdError}</div>}
    {state.wayland && <div className="notice">Esta versión utiliza X11/XWayland. La superposición sobre aplicaciones Wayland nativas no está garantizada.</div>}
    <footer className="preferences-footer"><button disabled={busy} onClick={() => { setDraft(defaults()); void changeToolbar('visible').then(ok => { if (ok) setMessage('Barra visible restaurada. Pulsa Guardar para aplicar los demás valores.'); }); }}>Restaurar valores</button><button className="primary" disabled={busy} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar preferencias'}</button></footer>
    <p className="save-message" role="status">{message}</p>
    <p className="version">TeachersPen 0.1 · Todo se guarda en este ordenador.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
