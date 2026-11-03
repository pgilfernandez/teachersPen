import './build-gnome.mjs';
import {execFileSync} from 'node:child_process';
const uuid = 'teacherspen@pgilfernandez.github.io';
const env = {...process.env, XDG_DATA_HOME: `${process.env.HOME}/.local/share`, XDG_DATA_DIRS: '/usr/local/share:/usr/share'};
for (const key of Object.keys(env)) if (key.startsWith('GIO_') || key.startsWith('GTK_') || key.startsWith('GDK_') || key === 'GSETTINGS_SCHEMA_DIR') delete env[key];
execFileSync('gnome-extensions', ['install', '--force', `dist/gnome/${uuid}.shell-extension.zip`], {stdio: 'inherit', env});
try {
    execFileSync('gnome-extensions', ['enable', uuid], {stdio: 'inherit', env});
} catch {
    // GNOME discovers a newly installed UUID on the next login. Persist its
    // enabled state now without restarting or replacing the user's Shell.
    execFileSync('gjs', ['-c', `const Gio = imports.gi.Gio; const settings = new Gio.Settings({schema_id: 'org.gnome.shell'}); const ids = settings.get_strv('enabled-extensions'); if (!ids.includes('${uuid}')) settings.set_strv('enabled-extensions', [...ids, '${uuid}']); Gio.Settings.sync();`], {stdio: 'inherit', env});
    console.log(`GNOME may require logging out and back in before enabling a newly installed extension. Then run: gnome-extensions enable ${uuid}`);
}
