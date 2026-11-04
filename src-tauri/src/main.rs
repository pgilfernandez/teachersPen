#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appearance;
#[cfg(target_os = "macos")]
mod mac_hold;
#[cfg(target_os = "macos")]
mod mac_panel;
mod platform;
use serde_json::{json, Value};
use std::{collections::HashSet, fs, sync::Mutex};
use tauri::{
    api::process::Command, CustomMenuItem, GlobalShortcutManager, Icon, Manager, PhysicalPosition,
    PhysicalSize, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, Window,
    WindowBuilder, WindowEvent, WindowUrl,
};

#[cfg(not(target_os = "macos"))]
use std::collections::HashMap;
#[cfg(not(target_os = "macos"))]
use tauri::api::process::{CommandChild, CommandEvent};

type Result<T> = std::result::Result<T, String>;
#[cfg(not(target_os = "macos"))]
#[derive(Default)]
struct Helpers(Mutex<HashMap<String, CommandChild>>);
#[cfg(target_os = "linux")]
#[derive(Default)]
struct RegisteredShortcuts(Mutex<HashSet<String>>);
#[derive(Default)]
struct LiveState {
    down: Mutex<HashSet<String>>,
    published: Mutex<Value>,
}
fn any_held(app: &tauri::AppHandle) -> bool {
    app.state::<LiveState>()
        .down
        .lock()
        .map(|keys| !keys.is_empty())
        .unwrap_or(false)
}
fn release_native(app: &tauri::AppHandle, token: &str) {
    if let Ok(mut keys) = app.state::<LiveState>().down.lock() {
        keys.remove(token);
        if !keys.is_empty() {
            return;
        }
    }
    let next = {
        let live = app.state::<LiveState>();
        let Ok(mut state) = live.published.lock() else {
            return;
        };
        if state["holding"] != true {
            return;
        }
        state["drawing"] = json!(false);
        state["holding"] = json!(false);
        state.clone()
    };
    // Return input immediately; a hidden WebView may defer its JS event queue.
    for (label, window) in app.windows() {
        if label.starts_with("overlay-") {
            let _ = platform::ignore(&window, true);
        }
    }
    let _ = app.emit_all("pen:state", next);
    trace("native hold release");
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn trace(message: impl std::fmt::Display) {
    if std::env::var_os("TEACHERSPEN_DEBUG_SHORTCUTS").is_some() {
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        eprintln!("TeachersPen {}: {}", time, message);
    }
}
fn number(v: &Value, name: &str) -> f64 {
    v[name].as_f64().unwrap_or(0.0)
}
fn text<'a>(v: &'a Value, name: &str) -> &'a str {
    v[name].as_str().unwrap_or("")
}
fn bounds(w: &Window) -> Result<Value> {
    let scale = w.scale_factor().map_err(err)?;
    let p = w.outer_position().map_err(err)?;
    let s = w.inner_size().map_err(err)?;
    Ok(
        json!({"x":p.x as f64/scale,"y":p.y as f64/scale,"width":s.width as f64/scale,"height":s.height as f64/scale}),
    )
}
fn set_bounds(w: &Window, b: &Value) -> Result<()> {
    let x = number(b, "x");
    let y = number(b, "y");
    let monitors = w.available_monitors().map_err(err)?;
    let target = monitors.iter().min_by(|a, b| {
        let distance = |m: &tauri::Monitor| {
            let s = m.scale_factor();
            let p = m.position();
            let z = m.size();
            let dx = (p.x as f64 / s - x)
                .max(0.0)
                .max(x - (p.x + z.width as i32) as f64 / s);
            let dy = (p.y as f64 / s - y)
                .max(0.0)
                .max(y - (p.y + z.height as i32) as f64 / s);
            dx * dx + dy * dy
        };
        distance(a).total_cmp(&distance(b))
    });
    let scale = target.map(|m| m.scale_factor()).unwrap_or(1.0);
    if b["x"].is_number() {
        w.set_position(PhysicalPosition::new(
            (x * scale).round() as i32,
            (y * scale).round() as i32,
        ))
        .map_err(err)?;
    }
    if b["width"].is_number() {
        w.set_size(PhysicalSize::new(
            (number(b, "width").max(1.0) * scale).round() as u32,
            (number(b, "height").max(1.0) * scale).round() as u32,
        ))
        .map_err(err)?;
    }
    Ok(())
}
fn screens(w: &Window) -> Result<Value> {
    let monitors = w.available_monitors().map_err(err)?;
    Ok(Value::Array(monitors.iter().enumerate().map(|(id,m)| {
        let s=m.scale_factor(); let p=m.position(); let z=m.size();
        let b=json!({"x":p.x as f64/s,"y":p.y as f64/s,"width":z.width as f64/s,"height":z.height as f64/s});
        let area=platform::work_area(m).unwrap_or_else(||b.clone());
        json!({"id":id,"bounds":b,"workArea":area,"scaleFactor":s})
    }).collect()))
}
fn create_window(app: &tauri::AppHandle, v: &Value) -> Result<()> {
    let label = text(v, "label");
    let role = text(v, "role");
    if ![
        "controller",
        "toolbar",
        "mini",
        "overlay",
        "preferences",
        "timer-window",
        "pie",
    ]
    .contains(&role)
        || label.len() > 64
    {
        return Err("Invalid window".into());
    }
    if app.get_window(label).is_some() {
        return Ok(());
    }
    let init = format!(
        "window.__PEN_ROLE__={};",
        serde_json::to_string(role).map_err(err)?
    );
    let b = &v["bounds"];
    let mut builder = WindowBuilder::new(app, label, WindowUrl::App("index.html".into()))
        .initialization_script(&init)
        .title(text(v, "title"))
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .decorations(role == "preferences")
        .transparent(role != "preferences")
        .resizable(role == "preferences")
        .minimizable(!cfg!(target_os = "windows"))
        .always_on_top(role != "preferences" && role != "controller")
        .skip_taskbar(if cfg!(any(target_os = "windows", target_os = "linux")) { role != "toolbar" } else { role != "preferences" })
        .disable_file_drop_handler()
        .on_navigation(|url| {
            matches!(url.scheme(), "tauri" | "asset")
                // Tauri 1.8 uses HTTPS for the local WebView2 origin on Windows.
                || (matches!(url.scheme(), "http" | "https")
                    && url.host_str() == Some("tauri.localhost"))
        })
        .inner_size(number(b, "width").max(1.0), number(b, "height").max(1.0));
    if b["x"].is_number() {
        builder = builder.position(number(b, "x"), number(b, "y"));
    }
    if role == "preferences" {
        builder = builder.min_inner_size(380.0, 400.0);
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.icon(Icon::Raw(include_bytes!("../../dist/icons/app-256.png").to_vec())).map_err(err)?;
    }
    let w = builder.build().map_err(err)?;
    #[cfg(target_os = "macos")]
    if mac_panel::passive(&w) { mac_panel::configure(&w)?; }
    platform::configure(&w, role)?;
    set_bounds(&w, b)?;
    if role == "overlay" {
        platform::ignore(&w, true)?;
    }
    Ok(())
}
fn storage_file(name: &str) -> Result<std::path::PathBuf> {
    if !["settings.json", "window-state.json", "timer-window.json"].contains(&name) {
        return Err("Invalid settings file".into());
    }
    let dir = tauri::api::path::config_dir()
        .ok_or("Missing configuration directory")?
        .join("TeachersPen");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join(name))
}

// Only the hidden controller can access storage, spawn the fixed helper or
// control other windows. Renderer requests carry their actual native label.
#[tauri::command]
async fn host(window: Window, app: tauri::AppHandle, op: String, args: Value) -> Result<Value> {
    if op == "request" {
        trace(format!(
            "request {} {}",
            text(&args["command"], "type"),
            text(&args["command"], "action")
        ));
        let payload = json!({"source":window.label(),"id":args["id"],"command":args["command"]});
        app.emit_to("controller", "host-request", payload)
            .map_err(err)?;
        return Ok(Value::Null);
    }
    if op == "theme" {
        return appearance::theme(&window).map(|theme| json!(theme));
    }
    if op == "toolbar-region" {
        if window.label() != "toolbar" {
            return Err("Unauthorized window".into());
        }
        platform::toolbar_region(&window, &args)?;
        return Ok(Value::Null);
    }
    if op == "drag" {
        if ["toolbar", "timer-window"].contains(&window.label()) {
            window.start_dragging().map_err(err)?;
        }
        return Ok(Value::Null);
    }
    #[cfg(target_os = "macos")]
    if op == "preview-pointer" && (window.label().starts_with("overlay-") || window.label() == "pie") {
        return tauri::async_runtime::spawn_blocking(move || mac_panel::preview_pointer(&window))
            .await.map_err(err)?;
    }
    if window.label() != "controller" {
        return Err("Unauthorized window".into());
    }
    match op.as_str() {
        "trace" => trace(text(&args, "message")),
        "environment" => {
            return Ok(
                json!({"platform":if cfg!(target_os="macos"){"darwin"}else if cfg!(target_os="windows"){"win32"}else{"linux"},"wayland":std::env::var_os("WAYLAND_DISPLAY").is_some(),"languages":platform::system_languages()}),
            )
        }
        "screens" => {
            // NSScreen and GTK monitor queries belong to the GUI thread.
            let (tx, rx) = std::sync::mpsc::channel();
            let w = window.clone();
            window
                .run_on_main_thread(move || {
                    let _ = tx.send(screens(&w));
                })
                .map_err(err)?;
            return rx.recv().map_err(err)?;
        }
        "cursor" => return platform::cursor(&window),
        "read" => {
            let p = storage_file(text(&args, "name"))?;
            return match fs::read_to_string(p) {
                Ok(s) => serde_json::from_str(&s).map_err(err),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
                Err(e) => Err(err(e)),
            };
        }
        "write" => {
            let p = storage_file(text(&args, "name"))?;
            let tmp = p.with_extension("json.tmp");
            fs::write(
                &tmp,
                serde_json::to_vec_pretty(&args["value"]).map_err(err)?,
            )
            .map_err(err)?;
            platform::replace_file(&tmp, &p)?;
        }
        "create" => create_window(&app, &args)?,
        "window" => {
            let w = app
                .get_window(text(&args, "label"))
                .ok_or("Window not found")?;
            match text(&args, "action") {
                "show" => {
                    #[cfg(target_os = "macos")]
                    if mac_panel::passive(&w) { mac_panel::show(&w)?; } else { w.show().map_err(err)?; }
                    #[cfg(not(target_os = "macos"))]
                    w.show().map_err(err)?;
                    platform::taskbar_style(&w)?;
                    if w.label().starts_with("overlay-") {
                        #[cfg(target_os = "linux")]
                        {
                            // Showing a GTK window may rebuild its input region.
                            // Start click-through unless drawing was published.
                            let drawing = app.state::<LiveState>().published.lock()
                                .map(|state| state["drawing"] == true).unwrap_or(false);
                            platform::ignore(&w, !drawing)?;
                        }
                        platform::raise_controls(&app);
                    } else {
                        #[cfg(target_os = "linux")]
                        platform::raise_controls(&app);
                    }
                }
                "hide" => w.hide().map_err(err)?,
                "close" => w.close().map_err(err)?,
                "focus" => {
                    if args["holding"] != true || any_held(&app) {
                        #[cfg(target_os = "macos")]
                        if !mac_panel::passive(&w) { w.set_focus().map_err(err)?; }
                        #[cfg(not(target_os = "macos"))]
                        w.set_focus().map_err(err)?;
                        #[cfg(target_os = "linux")]
                        platform::raise_controls(&app);
                    }
                }
                "bounds" => {
                    let b = &args["bounds"];
                    set_bounds(&w, b)?;
                }
                "ignore" => {
                    let stale_hold = args["holding"] == true && !any_held(&app);
                    platform::ignore(&w, stale_hold || args["enabled"].as_bool().unwrap_or(false))?;
                }
                "title" => w.set_title(text(&args, "title")).map_err(err)?,
                "get-bounds" => return bounds(&w),
                _ => return Err("Unknown window operation".into()),
            }
            platform::refresh_overlay_regions(&app);
        }
        "reply" => app
            .emit_to(text(&args, "label"), "pen:reply", args["value"].clone())
            .map_err(err)?,
        "broadcast" => {
            let mut args = args;
            if args["holding"] == true && !any_held(&app) {
                args["drawing"] = json!(false);
                args["holding"] = json!(false);
            }
            #[cfg(target_os = "linux")]
            let board_presentation_changed;
            {
                let live = app.state::<LiveState>();
                let mut previous = live.published.lock().map_err(err)?;
                #[cfg(target_os = "linux")]
                {
                    board_presentation_changed = previous["background"] != args["background"]
                        || previous["visible"] != args["visible"];
                }
                *previous = args.clone();
            }
            trace(format!(
                "state drawing={} holding={} activation={}",
                args["drawing"], args["holding"], args["settings"]["activation"]
            ));
            #[cfg(target_os = "macos")]
            {
                // Escape is global only while an unfocused annotation panel is
                // interactive. No input-monitoring permission is required.
                let enabled = args["drawing"] == true || !args["pie"].is_null();
                let mut manager = app.global_shortcut_manager();
                let registered = manager.is_registered("Escape").map_err(err)?;
                if enabled && !registered {
                    let handle = app.clone();
                    manager.register("Escape", move || {
                        let _ = handle.emit_to("controller", "host-menu", "escape");
                    }).map_err(err)?;
                } else if !enabled && registered {
                    manager.unregister("Escape").map_err(err)?;
                }
            }
            app.emit_all("pen:state", args.clone()).map_err(err)?;
            #[cfg(target_os = "linux")]
            if board_presentation_changed {
                // A board can become opaque without focusing/showing its
                // overlay. Restore the controls' stacking order in that case.
                platform::raise_controls(&app);
            }
        }
        "action" => app
            .emit_to(text(&args, "label"), "pen:action", args["action"].clone())
            .map_err(err)?,
        "dock" => platform::dock(&app, args["hidden"].as_bool().unwrap_or(false)),
        "tray" => {
            for (key, title) in [
                ("show", text(&args, "show")),
                ("preferences", text(&args, "preferences")),
                ("about", text(&args, "about")),
                ("quit", text(&args, "quit")),
            ] {
                app.tray_handle()
                    .get_item(key)
                    .set_title(title)
                    .map_err(err)?;
            }
        }
        "shortcuts" => {
            #[cfg(target_os = "macos")]
            mac_hold::clear(&app);
            #[cfg(target_os = "linux")]
            let registrations = app.state::<RegisteredShortcuts>();
            #[cfg(target_os = "linux")]
            let mut registered = registrations.0.lock().map_err(err)?;
            #[cfg(target_os = "linux")]
            {
                // Tao 0.16's X11 unregister_all leaves unread replies on the
                // registration channel. unregister waits for each reply.
                for shortcut in registered.clone() {
                    app.global_shortcut_manager().unregister(&shortcut).map_err(err)?;
                    registered.remove(&shortcut);
                }
            }
            #[cfg(not(target_os = "linux"))]
            app.global_shortcut_manager()
                .unregister_all()
                .map_err(err)?;
            let mut errors = Vec::new();
            if let Some(entries) = args.as_object() {
                for (action, value) in entries {
                    let shortcut = value.as_str().unwrap_or("");
                    if shortcut.is_empty() {
                        continue;
                    }
                    let handle = app.clone();
                    let id = action.clone();
                    #[cfg(target_os = "macos")]
                    let chord = shortcut.to_string();
                    if let Err(e) = app.global_shortcut_manager().register(shortcut, move || {
                        #[cfg(target_os = "macos")]
                        mac_hold::press(&handle, &chord);
                        trace(format!("shortcut {}", id));
                        let _ = handle.emit_to("controller", "host-shortcut", id.clone());
                    }) {
                        trace(format!("shortcut registration failed {} {}: {}", action, shortcut, e));
                        errors.push(
                            json!({"action":action,"shortcut":shortcut,"error":e.to_string()}),
                        );
                    } else {
                        #[cfg(target_os = "linux")]
                        registered.insert(shortcut.to_string());
                    }
                }
            }
            return Ok(Value::Array(errors));
        }
        "validate" => {
            let out = Command::new_sidecar("key-state")
                .map_err(err)?
                .args(["--validate", text(&args, "shortcut")])
                .output()
                .map_err(err)?;
            return Ok(if out.status.success() {
                Value::Null
            } else {
                json!(out.stderr.trim())
            });
        }
        "watch" => {
            let token = text(&args, "token").to_string();
            trace(format!("watch {} {}", token, text(&args, "shortcut")));
            #[cfg(target_os = "macos")]
            mac_hold::watch(&app, token, text(&args, "shortcut"))?;
            #[cfg(not(target_os = "macos"))]
            {
                let (mut rx, child) = Command::new_sidecar("key-state")
                    .map_err(err)?
                    .args([
                        "--watch",
                        text(&args, "shortcut"),
                        &std::process::id().to_string(),
                    ])
                    .spawn()
                    .map_err(err)?;
                app.state::<Helpers>()
                    .0
                    .lock()
                    .map_err(err)?
                    .insert(token.clone(), child);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let mut released = false;
                    let mut error = String::new();
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(s) => {
                                trace(format!("key {} {}", token, s.trim()));
                                if s.trim() == "down" {
                                    if let Ok(mut keys) = handle.state::<LiveState>().down.lock() {
                                        keys.insert(token.clone());
                                    }
                                }
                                if s.trim() == "up" {
                                    released = true;
                                    release_native(&handle, &token);
                                }
                                let _ = handle.emit_to(
                                    "controller",
                                    "host-key",
                                    json!({"token":token,"event":s.trim()}),
                                );
                            }
                            CommandEvent::Stderr(s) | CommandEvent::Error(s) => {
                                trace(format!("key error {} {}", token, s));
                                error = s;
                            }
                            CommandEvent::Terminated(_) => {
                                if !released {
                                    release_native(&handle, &token);
                                    let _=handle.emit_to("controller","host-key",json!({"token":token,"event":"error","error":if error.is_empty(){"The shortcut monitor stopped"}else{&error}}));
                                }
                                break;
                            }
                            _ => (),
                        }
                    }
                    if let Ok(mut children) = handle.state::<Helpers>().0.lock() {
                        children.remove(&token);
                    };
                });
            }
        }
        "stop-watch" => {
            #[cfg(target_os = "macos")]
            mac_hold::stop(&app, text(&args, "token"));
            #[cfg(not(target_os = "macos"))]
            {
                release_native(&app, text(&args, "token"));
                if let Some(child) = app
                    .state::<Helpers>()
                    .0
                    .lock()
                    .map_err(err)?
                    .remove(text(&args, "token"))
                {
                    let _ = child.kill();
                }
            }
        }

        "open" => {
            let url = match text(&args, "target") {
                "donate" => "https://github.com/sponsors/pgilfernandez",
                "paypal" => "https://www.paypal.com/donate?hosted_button_id=6N7UZHDQW3J6A",
                "github" => "https://github.com/pgilfernandez/teachersPen",
                _ => return Err("Unknown project link".into()),
            };
            tauri::api::shell::open(&app.shell_scope(), url, None).map_err(err)?;
        }
        "exit" => {
            tauri::api::process::kill_children();
            app.exit(0);
        }
        _ => return Err("Unknown host operation".into()),
    }
    Ok(Value::Null)
}
fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("GDK_BACKEND", "x11");
    #[cfg(target_os = "macos")]
    let icon = include_bytes!("../../dist/icons/trayTemplate@3x.png").to_vec();
    #[cfg(not(target_os = "macos"))]
    let icon = include_bytes!("../../dist/icons/trayTemplate.png").to_vec();
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show full toolbar"))
        .add_item(CustomMenuItem::new("preferences", "Preferences…"))
        .add_item(CustomMenuItem::new("about", "About teachersPen"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit TeachersPen"));
    let tray = SystemTray::new().with_icon(Icon::Raw(icon)).with_menu(menu);
    #[cfg(target_os = "macos")]
    let tray = tray.with_icon_as_template(true);
    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.manage(RegisteredShortcuts::default());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(mac_hold::MacHold::default());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.manage(Helpers::default());
    builder.plugin(tauri_plugin_single_instance::init(|app,_,_| { let _=app.emit_to("controller","host-menu","show"); })).manage(LiveState::default()).manage(platform::ToolbarRegion::default()).system_tray(tray)
        .invoke_handler(tauri::generate_handler![host])
        .setup(|app| {
            appearance::watch(&app.handle());
            #[cfg(target_os = "macos")]
            mac_hold::install(&app.handle())?;
            create_window(&app.handle(),&json!({"label":"controller","role":"controller","title":"TeachersPen","bounds":{"width":1,"height":1}}))?; Ok(()) })
        .on_system_tray_event(|app,event| {
            match event {
                SystemTrayEvent::MenuItemClick{id,..} => {
                    if id=="quit" {tauri::api::process::kill_children();app.exit(0);}
                    let _=app.emit_to("controller","host-menu",id);
                }
                #[cfg(target_os = "windows")]
                SystemTrayEvent::LeftClick{..} => {
                    let _=app.emit_to("controller","host-menu","show");
                }
                _ => ()
            }
        })
        .on_window_event(|event| {
            let w=event.window();
            if matches!(event.event(), WindowEvent::Focused(true)) && w.label().starts_with("overlay-") {
                platform::raise_controls(&w.app_handle());
            }
            if let WindowEvent::ThemeChanged(theme)=event.event() {appearance::changed(w,theme);return;}
            if w.label()=="controller"{return;}
            let kind=match event.event(){
                WindowEvent::CloseRequested{api,..}=>{api.prevent_close();let _=w.hide();"close"},
                WindowEvent::Moved(_)=>"move",
                WindowEvent::Resized(_)=>"resize",
                WindowEvent::ScaleFactorChanged{..}=>"scale",
                WindowEvent::Focused(false)=>"blur",
                _=>return
            };
            let _=w.emit_to("controller","host-window",json!({"label":w.label(),"kind":kind,"bounds":bounds(w).ok()}));
            if matches!(kind, "move" | "resize" | "scale" | "close") {
                platform::refresh_overlay_regions(&w.app_handle());
            }
        })
        .build(tauri::generate_context!()).expect("Could not start TeachersPen")
        .run(|_app,event| {if let tauri::RunEvent::ExitRequested{..}=event {tauri::api::process::kill_children();}});
}
