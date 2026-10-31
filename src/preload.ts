import { contextBridge, ipcRenderer } from 'electron';
import type { Action, Command, PenAPI, State } from './shared';
const api: PenAPI = {
  getState: () => ipcRenderer.invoke('pen:get-state'),
  command: (command: Command) => ipcRenderer.invoke('pen:command', command),
  onState(callback) {
    const listener = (_event: unknown, state: State) => callback(state);
    ipcRenderer.on('pen:state', listener);
    return () => ipcRenderer.removeListener('pen:state', listener);
  },
  onAction(callback) {
    const listener = (_event: unknown, action: Action) => callback(action);
    ipcRenderer.on('pen:action', listener);
    return () => ipcRenderer.removeListener('pen:action', listener);
  }
};
contextBridge.exposeInMainWorld('pen', api);
