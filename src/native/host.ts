import { invoke } from '@tauri-apps/api/tauri';
export const host = <T = unknown>(op: string, args: unknown = {}): Promise<T> => invoke<T>('host', { op, args });
