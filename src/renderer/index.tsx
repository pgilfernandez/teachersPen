import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { actionLabels, actions, defaults, type Action, type Command, type Settings, type State, type Tool } from '../shared';
import { DrawingHistory, type Stroke } from '../model';
import { paintStroke } from './draw';

const role = new URLSearchParams(location.search).get('role') || 'toolbar';
document.body.className = role;
const command = (value: Command) => window.pen.command(value);
const action = (value: Action) => command({ type: 'action', action: value });
const toolNames: Record<Tool, string> = { freehand: 'Lápiz', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo', circle: 'Círculo' };
const toolIcons: Record<Tool, string> = { freehand: '✎', line: '╱', arrow: '↗', rectangle: '▭', circle: '○' };
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
  return <Toolbar state={state} />;
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
        current.current = { tool: state.tool, color: state.settings.colors[state.color], width: state.settings.width, points: [{ x: event.clientX, y: event.clientY }] };
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
    {state.drawing && <div className="drawing-hint">{toolNames[state.tool]} · {state.holding ? 'Suelta el atajo para interactuar' : 'Esc para interactuar'}</div>}
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
      if (element.current) void command({ type: 'toolbar-size', height: element.current.getBoundingClientRect().height + 16 });
    });
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, []);
  const tip = (label: string, name: Action) => `${label} · ${keyLabel(state.settings.shortcuts[name]) || 'Sin atajo'}`;
  return <main className="toolbar-shell" ref={element}>
    <div className="toolbar">
      <div className="brand" title="Arrastra para mover la barra"><span className="brand-icon">✎</span><strong>Teachers<span>Pen</span></strong><span className="drag-dots">⠿</span></div>
      <button className={`mode ${state.drawing ? 'selected' : ''}`} title={tip('Dibujar / interactuar', 'toggle')} onClick={() => void action('toggle')}>{state.drawing ? '✎ Dibujando' : '↖ Interactuar'}</button>
      <div className="divider" />
      <div className="button-group">{(Object.keys(toolNames) as Tool[]).map(tool => <button key={tool} className={`icon-button ${state.tool === tool && state.drawing ? 'selected' : ''}`} title={tip(toolNames[tool], tool)} aria-label={toolNames[tool]} onClick={() => void command({ type: 'tool', tool })}>{toolIcons[tool]}</button>)}</div>
      <div className="divider" />
      <div className="colors">{state.settings.colors.map((color, index) => <button key={index} className={`swatch ${state.color === index ? 'active' : ''}`} style={{ backgroundColor: color }} title={tip(`Color ${index + 1}`, `color${index}` as Action)} aria-label={`Color ${index + 1}`} aria-pressed={state.color === index} onClick={() => void command({ type: 'color', index })} />)}</div>
      <label className="width-control" title="Grosor del trazo"><span>px</span><input aria-label="Grosor" type="number" min="1" max="40" value={state.settings.width} onChange={e => void command({ type: 'width', width: Number(e.target.value) })} /></label>
      <div className="divider" />
      <button className="icon-button" aria-label="Deshacer" title={tip('Deshacer', 'undo')} onClick={() => void action('undo')}>↶</button>
      <button className="icon-button" aria-label="Rehacer" title={tip('Rehacer', 'redo')} onClick={() => void action('redo')}>↷</button>
      <button className="icon-button" aria-label="Borrar todo" title={tip('Borrar todo', 'clear')} onClick={() => void action('clear')}>⌫</button>
      <button className={`icon-button ${!state.visible ? 'selected' : ''}`} aria-label="Ocultar o mostrar" title={tip('Ocultar / mostrar', 'visible')} onClick={() => void action('visible')}>{state.visible ? '◉' : '◎'}</button>
      <button className="icon-button" aria-label="Preferencias" title="Preferencias" onClick={() => void command({ type: 'preferences' })}>⚙</button>
    </div>
    <div className="toolbar-footer"><span className={`status-dot ${state.drawing ? 'on' : ''}`} /><span>{state.holding ? 'Suelta el atajo para interactuar' : state.drawing ? 'Dibuja sobre cualquier aplicación' : state.settings.activation === 'hold' ? 'Mantén el atajo para dibujar' : 'Puedes usar las aplicaciones de debajo'}</span><kbd>{keyLabel(state.settings.shortcuts.toggle)}</kbd><div className="footer-spacer" />
      <button className={state.background === 'white' ? 'active' : ''} onClick={() => void action('white')} title={tip('Pizarra blanca', 'white')}>Blanca</button>
      <button className={state.background === 'black' ? 'active' : ''} onClick={() => void action('black')} title={tip('Pizarra negra', 'black')}>Negra</button>
      <button className={state.timerEnd ? 'active' : ''} onClick={() => void action('timer')} title={tip('Temporizador', 'timer')}>◷ Temporizador</button>
      <button onClick={() => void command({ type: 'quit' })}>Salir</button>
    </div>
    {(state.shortcutErrors.length > 0 || state.wayland || state.holdError) && <div className="toolbar-warning" onClick={() => void command({ type: 'preferences' })}>{state.holdError || (state.wayland ? 'Wayland: compatibilidad experimental mediante XWayland. Consulta las preferencias.' : 'Hay atajos no disponibles. Abre Preferencias para revisarlos.')}</div>}
  </main>;
}
function Preferences({ state }: { state: State }) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(state.settings));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingActivation, setChangingActivation] = useState(false);
  const [recording, setRecording] = useState<Action | null>(null);
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setMessage(''); };
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
    <section><h2>Dibujo</h2><div className="setting-row"><label htmlFor="line-width">Grosor del trazo</label><div><input id="line-width" type="number" min="1" max="40" value={draft.width} onChange={e => field('width', Number(e.target.value))} /> <span className="muted">px</span></div></div>
      <div className="setting-row"><span id="activation-label">Activación</span><div className="activation-options" role="radiogroup" aria-labelledby="activation-label">
        <label className={state.settings.activation === 'toggle' ? 'active' : ''}><input id="activation-toggle" type="radio" name="activation" checked={state.settings.activation === 'toggle'} disabled={changingActivation || saving} onChange={() => void changeActivation('toggle')} />Pulsar para activar / desactivar</label>
        <label className={state.settings.activation === 'hold' ? 'active' : ''}><input id="activation-hold" type="radio" name="activation" checked={state.settings.activation === 'hold'} disabled={changingActivation || saving || !state.holdAvailable} onChange={() => void changeActivation('hold')} />Mantener pulsado</label>
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
      }} /><button className="remove-shortcut" disabled={name === 'toggle'} aria-label={`Eliminar atajo de ${actionLabels[name]}`} onClick={() => field('shortcuts', { ...draft.shortcuts, [name]: '' })}>×</button></div>)}</div>
    </section>
    <section><h2>Temporizador</h2><div className="setting-row"><label htmlFor="timer-duration">Duración en minutos</label><input id="timer-duration" type="number" min="1" max="120" step="1" value={draft.timerSeconds / 60} onChange={e => field('timerSeconds', Math.max(1, Number(e.target.value)) * 60)} /></div><p className="help">El atajo inicia o cancela la cuenta atrás. Cambiar la duración se aplica al siguiente temporizador.</p></section>
    {state.shortcutErrors.length > 0 && <div className="notice" role="alert">{state.shortcutErrors.join('\n')}</div>}
    {state.holdError && <div className="notice" role="alert">{state.holdError}</div>}
    {state.wayland && <div className="notice">Esta versión utiliza X11/XWayland. La superposición sobre aplicaciones Wayland nativas no está garantizada.</div>}
    <footer className="preferences-footer"><button disabled={changingActivation || saving} onClick={() => { setDraft(defaults()); setMessage('Valores restaurados. Pulsa Guardar para aplicarlos.'); }}>Restaurar valores</button><button className="primary" disabled={saving || changingActivation} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar preferencias'}</button></footer>
    <p className="save-message" role="status">{message}</p>
    <p className="version">TeachersPen 0.1 · Todo se guarda en este ordenador.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
