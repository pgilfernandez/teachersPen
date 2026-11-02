export type Appearance = 'light' | 'dark';
export function applyTheme(theme: Appearance) {
  document.documentElement.dataset.theme = theme;
}

// Shared fallback for Electron and system WebViews; addListener also supports
// the original Big Sur Safari/WebKit version.
const preference = window.matchMedia('(prefers-color-scheme: dark)');
const followSystem = () => applyTheme(preference.matches ? 'dark' : 'light');
followSystem();
if (!(window as Window & { __PEN_NATIVE__?: boolean }).__PEN_NATIVE__) {
  if (preference.addEventListener) preference.addEventListener('change', followSystem);
  else preference.addListener(followSystem);
}
