import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event';

// Keep per-window requests and replies scoped to their native window in Tauri 2.
export function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<T>(event, handler);
}
