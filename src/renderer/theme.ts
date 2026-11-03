export type Appearance = 'light' | 'dark';
export function applyTheme(theme: Appearance) {
  document.documentElement.dataset.theme = theme;
}

// Apply an initial theme while the native appearance subscription starts.
applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
