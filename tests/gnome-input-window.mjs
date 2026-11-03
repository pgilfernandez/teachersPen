import Gtk from 'gi://Gtk?version=3.0';
import GLib from 'gi://GLib';
Gtk.init(null);
const window = new Gtk.Window({title: 'TeachersPen hold test', default_width: 300, default_height: 100});
const entry = new Gtk.Entry();
entry.connect('changed', () => GLib.file_set_contents(`${GLib.getenv('TEACHERSPEN_TEST_ROOT')}/typed.txt`, entry.text));
window.add(entry); window.show_all(); entry.grab_focus();
window.connect('destroy', () => Gtk.main_quit());
Gtk.main();
