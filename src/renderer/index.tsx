import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { actionLabels, actions, defaults, type Action, type Command, type Settings, type State, type Tool, type ToolbarMode } from '../shared';
import { MINI_RADIUS, MINI_SIZE } from '../toolbar';
import { Pencil, Slash, ArrowUpRight, RectangleHorizontal, Circle, Undo2, Redo2, Trash2, Eye, EyeOff, Settings as SettingsIcon, TimerFive, Whiteboard, Blackboard, GripVertical, MoveDiagonal, RotateCcw, ArrowDownUp, Play, Pause, PanelTopClose, RotateCw, Power, X, type EditableIcon } from './icons';
import { DrawingHistory, type Stroke } from '../model';
import { paintStroke } from './draw';

const role = new URLSearchParams(location.search).get('role') || 'toolbar';
document.body.className = role;
const command = (value: Command) => window.pen.command(value);
const action = (value: Action) => command({ type: 'action', action: value });
const toolNames: Record<Tool, string> = { freehand: 'Lápiz', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo', circle: 'Círculo' };
const toolIcons: Record<Tool, EditableIcon> = { freehand: Pencil, line: Slash, arrow: ArrowUpRight, rectangle: RectangleHorizontal, circle: Circle };
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
  if (role === 'timer-window') return state.timer.visible ? <Timer state={state} /> : null;
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
    {state.drawing && state.settings.toolbarMode !== 'hidden' && <div className="drawing-hint">{toolNames[state.tool]} · {state.holding ? 'Suelta el atajo para interactuar' : 'Esc para interactuar'}</div>}
  </div>;
}
function Timer({ state }: { state: State }) {
  const [now, setNow] = useState(Date.now());
  const pointer = useRef<number | null>(null);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  const [config, setConfig] = useState(false);
  const elapsed = state.timer.elapsedMs + (state.timer.startedAt === null ? 0 : Math.max(0, now - state.timer.startedAt));
  const down = state.settings.timerDirection === 'down';
  const seconds = down ? Math.max(0, Math.ceil(state.settings.timerSeconds - elapsed / 1000)) : Math.floor(elapsed / 1000);
  const configure = (settings: Partial<Pick<Settings, 'timerText' | 'timerSeconds' | 'timerColor'>>) => command({ type: 'timer-settings', settings });
  const control = (value: 'reset' | 'direction' | 'start') => command({ type: 'timer-control', action: value });
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfig(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  const resize = (phase: 'start' | 'move' | 'end' | 'cancel', event: React.PointerEvent) => {
    void command({ type: 'timer-resize', phase, x: event.screenX, y: event.screenY });
  };
  return <div className={`timer-panel ${down && seconds <= 10 ? 'ending' : ''}`}>
    <div className="timer-grip" title="Arrastrar temporizador" aria-label="Arrastrar temporizador"><GripVertical aria-hidden="true" /></div>
    <div className="timer-content">
      <input className="timer-caption" aria-label="Texto del temporizador" maxLength={120} value={state.settings.timerText} style={{ color: state.settings.timerColor }} onChange={event => void configure({ timerText: event.target.value })} />
      <span className="timer-clock" role="timer" style={{ color: state.settings.timerColor }}>{Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}</span>
      <div className="timer-controls">
        <button title="Reiniciar" aria-label="Reiniciar temporizador" onClick={() => void control('reset')}><RotateCcw aria-hidden="true" /><span>Reset</span></button>
        <button title={down ? 'Cambiar a cuenta ascendente' : 'Cambiar a cuenta atrás'} aria-label={down ? 'Cambiar a cuenta ascendente' : 'Cambiar a cuenta atrás'} aria-pressed={!down} onClick={() => void control('direction')}><ArrowDownUp aria-hidden="true" /></button>
        <button title={state.timer.running ? 'Pausar' : 'Iniciar'} onClick={() => void control('start')}>{state.timer.running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}<span>{state.timer.running ? 'Pausar' : 'Iniciar'}</span></button>
      </div>
    </div>
    <button className="timer-gear" title="Configurar temporizador" aria-label="Configurar temporizador" aria-expanded={config} onClick={() => setConfig(!config)}><SettingsIcon aria-hidden="true" /></button>
    {config && <div className="timer-config" role="dialog" aria-label="Configuración del temporizador">
      <div className="timer-config-heading"><strong>Temporizador</strong><button aria-label="Cerrar configuración" onClick={() => setConfig(false)}><X aria-hidden="true" /></button></div>
      <label>Texto<input maxLength={120} value={state.settings.timerText} onChange={event => void configure({ timerText: event.target.value })} /></label>
      <label>Tiempo (segundos)<input type="number" min="10" max="7200" defaultValue={state.settings.timerSeconds} key={state.settings.timerSeconds} onBlur={event => {
        const value = Number(event.target.value);
        if (Number.isFinite(value) && value >= 10 && value <= 7200) void configure({ timerSeconds: value });
        else event.target.value = String(state.settings.timerSeconds);
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <label>Color<input type="color" value={state.settings.timerColor} onChange={event => void configure({ timerColor: event.target.value })} /></label>
    </div>}
    <button className="timer-resize" title="Arrastrar para cambiar el tamaño" aria-label="Cambiar tamaño del temporizador"
      onPointerDown={event => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        resize('start', event);
      }}
      onPointerMove={event => { if (pointer.current === event.pointerId) resize('move', event); }}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return;
        pointer.current = null;
        resize('end', event);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => { if (pointer.current === event.pointerId) { pointer.current = null; resize('cancel', event); } }}
      onLostPointerCapture={event => { if (pointer.current === event.pointerId) { pointer.current = null; resize('cancel', event); } }}
    ><MoveDiagonal aria-hidden="true" /></button>
  </div>;
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
        <button className={`board-button board-white ${state.background === 'white' ? 'active' : ''}`} aria-label="Pizarra blanca" aria-pressed={state.background === 'white'} onClick={() => void action('white')} title={tip('Pizarra blanca', 'white')}><Whiteboard /></button>
        <button className={`board-button board-black ${state.background === 'black' ? 'active' : ''}`} aria-label="Pizarra negra" aria-pressed={state.background === 'black'} onClick={() => void action('black')} title={tip('Pizarra negra', 'black')}><Blackboard /></button>
        <button className={`icon-button timer-button ${state.timer.visible ? 'selected' : ''}`} aria-label="Temporizador" aria-pressed={state.timer.visible} onClick={() => void action('timer')} title={tip('Temporizador', 'timer')}><span className="timer-five" aria-hidden="true"><TimerFive size={22} /></span></button>
      </div>
      <div className="divider" />
      <div className="colors">{state.settings.colors.map((color, index) => <button key={index} className={`swatch ${state.color === index && state.drawing ? 'active' : ''}`} style={{ backgroundColor: color }} title={tip(`Color ${index + 1}`, `color${index}` as Action)} aria-label={`Color ${index + 1}`} aria-pressed={state.color === index && state.drawing} onClick={() => void command({ type: 'color', index })} />)}</div>
      <label className="width-control" title="Grosor del trazo"><span>px</span><input aria-label="Grosor" type="number" min="1" max="40" value={state.settings.width} onChange={e => void command({ type: 'width', width: Number(e.target.value) })} /></label>
      <label className="width-control" title="Opacidad de los trazos: 100% opaco, 0% transparente"><input aria-label="Opacidad de los trazos" type="number" min="0" max="100" step="1" value={100 - state.settings.transparency} onChange={e => void command({ type: 'transparency', transparency: 100 - Number(e.target.value) })} /><span>%</span></label>
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
  useEffect(() => { setDraft(previous => ({ ...previous, timerText: state.settings.timerText, timerColor: state.settings.timerColor, timerDirection: state.settings.timerDirection, timerSeconds: state.settings.timerSeconds })); }, [state.settings.timerText, state.settings.timerColor, state.settings.timerDirection, state.settings.timerSeconds]);
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
  const shortcutRow = (name: Action, label: React.ReactNode = actionLabels[name]) => <div className="shortcut-row" key={name}><div className="shortcut-label">{typeof label === 'string' ? <label htmlFor={`shortcut-${name}`}>{label}</label> : label}</div><input id={`shortcut-${name}`} aria-label={`Atajo de ${actionLabels[name]}`} readOnly value={recording === name ? 'Pulsa la combinación…' : keyLabel(draft.shortcuts[name])} placeholder="Sin atajo" onFocus={() => { setRecording(name); void command({ type: 'record-shortcut', active: true }); }} onBlur={() => { setRecording(null); void command({ type: 'record-shortcut', active: false }); }} onKeyDown={event => {
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
      }} /><button className="remove-shortcut" disabled={name === 'toggle'} aria-label={`Eliminar atajo de ${actionLabels[name]}`} onClick={() => field('shortcuts', { ...draft.shortcuts, [name]: '' })}><X size={16} aria-hidden="true" /></button></div>;
  return <main className="preferences-main">
    <section><h2>Dibujo</h2>
      <div className="setting-row"><label htmlFor="line-width">Grosor del trazo</label><div className="number-with-unit"><input id="line-width" type="number" min="1" max="40" value={draft.width} onChange={e => field('width', Number(e.target.value))} /><span>px</span></div></div>
      <div className="setting-row"><label htmlFor="stroke-opacity">Opacidad del trazo</label><div className="number-with-unit"><input id="stroke-opacity" type="number" min="0" max="100" value={100 - draft.transparency} onChange={e => field('transparency', 100 - Number(e.target.value))} /><span>%</span></div></div>
      <div className="setting-row"><label htmlFor="activation-mode">Activación</label><select id="activation-mode" value={state.settings.activation} disabled={busy} onChange={e => void changeActivation(e.target.value as Settings['activation'])}><option value="toggle">Pulsar para alternar</option><option value="hold" disabled={!state.holdAvailable}>Mantener pulsado</option></select></div>
      {state.settings.activation === 'hold' && <p className="help setting-help">Mantén el atajo para dibujar; suéltalo para interactuar.</p>}
      <div className="setting-row"><label htmlFor="toolbar-mode">Barra de dibujo</label><select id="toolbar-mode" value={state.settings.toolbarMode} disabled={busy} onChange={e => void changeToolbar(e.target.value as ToolbarMode)}><option value="visible">Visible</option><option value="minimal">Mínima</option><option value="hidden">Oculta</option></select></div>
      <div className="setting-row"><label htmlFor="timer-duration">Temporizador</label><div className="number-with-unit"><input id="timer-duration" type="number" min="1" max="120" step="1" value={draft.timerSeconds / 60} onChange={e => field('timerSeconds', Math.max(1, Number(e.target.value)) * 60)} /><span>min</span></div></div>
    </section>
    <section><h2>Colores</h2><div className="shortcut-list color-shortcuts">{draft.colors.map((color, index) => shortcutRow(`color${index}` as Action, <span className="color-preset"><span>Color {index + 1}</span><input aria-label={`Color ${index + 1}`} type="color" value={color} onChange={e => field('colors', draft.colors.map((old, i) => i === index ? e.target.value : old))} /></span>))}</div></section>
    <section><h2>Funciones</h2><div className="shortcut-list">{actions.filter(name => !name.startsWith('color')).map(name => shortcutRow(name, name === 'toggle' ? 'Activar / salir' : actionLabels[name]))}</div>
      <p className="help">Pulsa un campo y escribe el atajo. Esc cancela; Retroceso lo borra.</p>
    </section>
    {state.shortcutErrors.length > 0 && <div className="notice" role="alert">{state.shortcutErrors.join('\n')}</div>}
    {state.holdError && <div className="notice" role="alert">{state.holdError}</div>}
    {state.wayland && <div className="notice">X11/XWayland: la superposición sobre aplicaciones Wayland nativas no está garantizada.</div>}
    <footer className="preferences-footer"><button disabled={busy} onClick={() => { setDraft(defaults()); void changeToolbar('visible').then(ok => { if (ok) setMessage('Pulsa Guardar para restaurar los demás valores.'); }); }}>Restaurar valores</button><button className="primary" disabled={busy} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar'}</button></footer>
    <p className="save-message" role="status">{message}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
