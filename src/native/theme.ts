import { listen } from '@tauri-apps/api/event';
import { applyTheme, type Appearance } from '../renderer/theme';
import { host } from './host';

export async function installNativeTheme() {
  let changed = false;
  await listen<Appearance>('pen:theme', event => {
    changed = true;
    applyTheme(event.payload);
  });
  try {
    const theme = await host<Appearance>('theme');
    if (!changed) applyTheme(theme);
  } catch (error) { console.error('System appearance:', error); }
}
