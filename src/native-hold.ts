import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { HoldMonitor } from './hold';

export class NativeHoldMonitor implements HoldMonitor {
  constructor(readonly executable: string) {}
  get available() { return existsSync(this.executable); }
  validate(shortcut: string): string | null {
    try {
      execFileSync(this.executable, ['--validate', shortcut], { timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      return null;
    } catch (error) {
      const details = error as { stderr?: Buffer };
      return details.stderr?.toString().trim() || 'No se puede iniciar el comprobador de teclas. Vuelve a compilar o reinstalar TeachersPen.';
    }
  }
  watch(shortcut: string, down: () => void, up: () => void, error: (message: string) => void) {
    const child = spawn(this.executable, ['--watch', shortcut, String(process.pid)], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let settled = false;
    let buffer = '';
    let details = '';
    const fail = (message: string) => {
      if (settled) return;
      settled = true; clearTimeout(readyTimeout); child.kill();
      error(message);
    };
    const readyTimeout = setTimeout(() => fail('No se puede comprobar el atajo. Se ha desactivado el dibujo por seguridad.'), 2000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const event = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (settled) continue;
        if (event === 'down') { clearTimeout(readyTimeout); down(); }
        if (event === 'up') { settled = true; clearTimeout(readyTimeout); up(); }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { details = (details + chunk.toString()).slice(-4000); });
    child.once('error', e => fail(`No se puede comprobar la liberación del atajo: ${e.message}`));
    child.once('close', () => fail(details.trim() || 'Se ha cerrado el comprobador de teclas. El dibujo se ha desactivado.'));
    return () => { settled = true; clearTimeout(readyTimeout); child.kill(); };
  }
}
