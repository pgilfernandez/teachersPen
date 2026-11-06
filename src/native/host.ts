import { invoke } from '@tauri-apps/api/core';
export const host = <T = unknown>(op: string, args: unknown = {}): Promise<T> => invoke<T>('host', { op, args });
