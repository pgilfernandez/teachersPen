// A native binary must not load GTK/GIO modules or glibc from a Snap runtime.
// These variables can survive in terminals even when SNAP itself is unset.
export function hostEnvironment(source, platform = process.platform) {
  const env = { ...source };
  if (platform !== 'linux') return env;
  for (const key of [
    'LD_LIBRARY_PATH', 'LD_PRELOAD', 'GTK_PATH', 'GTK_EXE_PREFIX',
    'GIO_MODULE_DIR', 'GIO_EXTRA_MODULES', 'GI_TYPELIB_PATH',
    'GDK_PIXBUF_MODULE_FILE', 'GDK_PIXBUF_MODULEDIR', 'GTK_IM_MODULE_FILE',
    'GSETTINGS_SCHEMA_DIR', 'XDG_DATA_DIRS',
  ]) {
    if (!env[key]) continue;
    const separator = key === 'LD_PRELOAD' ? /[:\s]+/ : ':';
    const clean = env[key].split(separator).filter(entry => entry && !entry.includes('/snap/'));
    if (clean.length) env[key] = clean.join(key === 'LD_PRELOAD' ? ' ' : ':');
    else delete env[key];
  }
  return env;
}
