import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment } from '../scripts/host-environment.mjs';

test('native launcher removes inherited Snap libraries and module caches without requiring SNAP', () => {
  const source = {
    LD_LIBRARY_PATH: '/opt/native/lib:/snap/core20/current/lib/x86_64-linux-gnu',
    LD_PRELOAD: '/snap/core20/lib/libpthread.so.0 /opt/native/helper.so',
    GTK_PATH: '/snap/code/current/usr/lib/gtk-3.0',
    GIO_MODULE_DIR: '/home/pablo/snap/code/common/.cache/gio-modules',
    GDK_PIXBUF_MODULE_FILE: '/home/pablo/snap/code/common/loaders.cache',
    GSETTINGS_SCHEMA_DIR: '/home/pablo/snap/code/226/schemas',
    XDG_DATA_DIRS: '/snap/code/current/usr/share:/usr/local/share:/usr/share',
    DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  };
  assert.deepEqual(hostEnvironment(source, 'linux'), {
    LD_LIBRARY_PATH: '/opt/native/lib', LD_PRELOAD: '/opt/native/helper.so',
    XDG_DATA_DIRS: '/usr/local/share:/usr/share', DISPLAY: ':0',
    WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: source.DBUS_SESSION_BUS_ADDRESS,
  });
  assert.ok(source.GTK_PATH, 'the parent environment is unchanged');
  assert.deepEqual(hostEnvironment(source, 'darwin'), source);
});
