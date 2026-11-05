//! Optional GNOME Shell drawing backend. The GTK controls still use XWayland.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Manager, Emitter};

const NAME: &str = "org.teacherspen.Gnome1";
const PATH: &str = "/org/teacherspen/Gnome1";
#[derive(Default)]
pub struct Backend(pub Mutex<Option<zbus::blocking::Connection>>);
type Result<T> = std::result::Result<T, String>;

fn dispatch(connection: &zbus::blocking::Connection, op: &str, args: &Value) -> Result<Value> {
    let proxy = zbus::blocking::Proxy::new(connection, NAME, PATH, NAME).map_err(|e| e.to_string())?;
    let response: String = proxy.call("Dispatch", &(op, args.to_string())).map_err(|e| e.to_string())?;
    serde_json::from_str(&response).map_err(|e| e.to_string())
}

pub fn call(app: &tauri::AppHandle, op: &str, args: &Value) -> Result<Value> {
    let connection = app.state::<Backend>().0.lock().map_err(|e| e.to_string())?.clone()
        .ok_or("GNOME backend is not connected")?;
    dispatch(&connection, op, args)
}

pub fn active(app: &tauri::AppHandle) -> bool {
    app.state::<Backend>().0.lock().map(|c| c.is_some()).unwrap_or(false)
}

pub fn initialize(app: &tauri::AppHandle, requested: &str) -> Value {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    if requested == "x11" || !wayland {
        return json!({"active":"x11", "requested":requested, "extensionAvailable":false,
            "error":if requested == "gnome" {"GNOME backend requires a Wayland session."} else {""}});
    }
    let connection = match zbus::blocking::Connection::session() {
        Ok(connection) => connection,
        Err(e) => return fallback(requested, e.to_string()),
    };
    // Do not auto-start or enable an extension. It must already be available.
    let hold_available = match dispatch(&connection, "connect", &json!({})) {
        Ok(info) if info["version"] == 1 || info["version"] == 2 => info["holdAvailable"] == true,
        Ok(_) => return fallback(requested, "Incompatible GNOME extension version.".into()),
        Err(_) => return fallback(requested, "Install and enable the TeachersPen GNOME extension, then restart TeachersPen.".into()),
    };
    // Subscribe before the controller registers shortcuts, so no input is lost.
    let events = match zbus::blocking::Proxy::new(&connection, NAME, PATH, NAME)
        .and_then(|proxy| proxy.receive_signal("Event")) {
        Ok(events) => events,
        Err(e) => return fallback(requested, e.to_string()),
    };
    *app.state::<Backend>().0.lock().unwrap() = Some(connection.clone());
    let handle = app.clone();
    std::thread::spawn(move || {
        for message in events {
            if let Ok((raw,)) = message.body::<(String,)>() {
                if let Ok(event) = serde_json::from_str::<Value>(&raw) {
                    if event["type"] == "hold" {
                        if let Some(token) = event["token"].as_str() {
                            if event["pressed"] == true {
                                if let Ok(mut keys) = handle.state::<crate::LiveState>().down.lock() {
                                    keys.insert(token.to_string());
                                }
                            } else {
                                crate::release_native(&handle, token);
                            }
                        }
                    }
                    let _ = handle.emit_to("controller", "host-gnome", event);
                }
            }
        }
    });
    // A heartbeat lets Shell release input if the process hangs, and lets the
    // controller report a disconnected extension instead of silently drawing nowhere.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if dispatch(&connection, "ping", &controls(&handle).unwrap_or(json!([]))).is_err() {
            let _ = handle.emit_to("controller", "host-gnome", json!({"type":"disconnected",
                "error":"GNOME extension disconnected. Restart TeachersPen or select X11/XWayland."}));
            break;
        }
    });
    json!({"active":"gnome", "requested":requested, "extensionAvailable":true, "holdAvailable":hold_available, "error":""})
}

fn fallback(requested: &str, error: String) -> Value {
    json!({"active":"x11", "requested":requested, "extensionAvailable":false, "error":error})
}

pub fn controls(app: &tauri::AppHandle) -> Result<Value> {
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        use gtk::prelude::*;
        let controls: Vec<Value> = ["toolbar", "mini", "timer-window", "preferences", "pie"].iter()
            .filter_map(|label| handle.get_webview_window(label))
            .filter_map(|window| {
                let gtk = window.gtk_window().ok()?;
                if !gtk.is_mapped() { return None; }
                let gdk = gtk.window()?;
                let (_, x, y) = gdk.origin();
                if window.label() == "toolbar" {
                    let state = handle.state::<crate::platform::ToolbarRegion>();
                    let rect = *state.0.lock().ok()?;
                    if let Some((left, top, width, height)) = rect {
                        return Some(json!({"x":x+left,"y":y+top,"width":width,"height":height}));
                    }
                }
                Some(json!({"x":x,"y":y,"width":gdk.width(),"height":gdk.height()}))
            }).collect();
        let _ = tx.send(Value::Array(controls));
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}
