#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;
use serde_json::{json, Value};
use std::{collections::HashMap, fs, sync::Mutex};
use tauri::{
    api::process::{Command, CommandChild, CommandEvent},
    CustomMenuItem, GlobalShortcutManager, Icon, Manager, PhysicalPosition, PhysicalSize,
    SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, Window, WindowBuilder,
    WindowEvent, WindowUrl,
};

type Result<T> = std::result::Result<T, String>;
#[derive(Default)]
struct Helpers(Mutex<HashMap<String, CommandChild>>);
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
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
        "window.__PEN_NATIVE__=true;window.__PEN_ROLE__={};",
        serde_json::to_string(role).map_err(err)?
    );
    let b = &v["bounds"];
    let mut builder = WindowBuilder::new(app, label, WindowUrl::App("index.html".into()))
        .initialization_script(&init)
        .title(text(v, "title"))
        .visible(false)
        .focused(false)
        .decorations(role == "preferences")
        .transparent(role != "preferences")
        .resizable(role == "preferences")
        .always_on_top(role != "preferences" && role != "controller")
        .skip_taskbar(role != "preferences")
        .disable_file_drop_handler()
        .on_navigation(|url| {
            matches!(url.scheme(), "tauri" | "asset")
                || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
        })
        .inner_size(number(b, "width").max(1.0), number(b, "height").max(1.0));
    if b["x"].is_number() {
        builder = builder.position(number(b, "x"), number(b, "y"));
    }
    if role == "preferences" {
        builder = builder.min_inner_size(380.0, 400.0);
    }
    let w = builder.build().map_err(err)?;
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
        let payload = json!({"source":window.label(),"id":args["id"],"command":args["command"]});
        app.emit_to("controller", "host-request", payload)
            .map_err(err)?;
        return Ok(Value::Null);
    }
    if op == "drag" {
        if ["toolbar", "timer-window"].contains(&window.label()) {
            window.start_dragging().map_err(err)?;
        }
        return Ok(Value::Null);
    }
    if window.label() != "controller" {
        return Err("Unauthorized window".into());
    }
    match op.as_str() {
        "environment" => {
            return Ok(
                json!({"platform":if cfg!(target_os="macos"){"darwin"}else if cfg!(target_os="windows"){"win32"}else{"linux"},"wayland":std::env::var_os("WAYLAND_DISPLAY").is_some()}),
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
                "show" => w.show().map_err(err)?,
                "hide" => w.hide().map_err(err)?,
                "close" => w.close().map_err(err)?,
                "focus" => w.set_focus().map_err(err)?,
                "bounds" => {
                    let b = &args["bounds"];
                    set_bounds(&w, b)?;
                }
                "ignore" => platform::ignore(&w, args["enabled"].as_bool().unwrap_or(false))?,
                "title" => w.set_title(text(&args, "title")).map_err(err)?,
                "get-bounds" => return bounds(&w),
                _ => return Err("Unknown window operation".into()),
            }
        }
        "reply" => app
            .emit_to(text(&args, "label"), "pen:reply", args["value"].clone())
            .map_err(err)?,
        "broadcast" => app.emit_all("pen:state", args.clone()).map_err(err)?,
        "action" => app
            .emit_to(text(&args, "label"), "pen:action", args["action"].clone())
            .map_err(err)?,
        "dock" => platform::dock(&app, args["hidden"].as_bool().unwrap_or(false)),
        "tray" => {
            for (key, title) in [
                ("show", text(&args, "show")),
                ("preferences", text(&args, "preferences")),
                ("quit", text(&args, "quit")),
            ] {
                app.tray_handle()
                    .get_item(key)
                    .set_title(title)
                    .map_err(err)?;
            }
        }
        "shortcuts" => {
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
                    if let Err(e) = app.global_shortcut_manager().register(shortcut, move || {
                        let _ = handle.emit_to("controller", "host-shortcut", id.clone());
                    }) {
                        errors.push(
                            json!({"action":action,"shortcut":shortcut,"error":e.to_string()}),
                        );
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
                            if s.trim() == "up" {
                                released = true;
                            }
                            let _ = handle.emit_to(
                                "controller",
                                "host-key",
                                json!({"token":token,"event":s.trim()}),
                            );
                        }
                        CommandEvent::Stderr(s) | CommandEvent::Error(s) => error = s,
                        CommandEvent::Terminated(_) => {
                            if !released {
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
        "stop-watch" => {
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
    let icon = if cfg!(target_os = "macos") {
        include_bytes!("../../dist/icons/trayTemplate.png").to_vec()
    } else {
        include_bytes!("../../dist/icons/tray.png").to_vec()
    };
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show full toolbar"))
        .add_item(CustomMenuItem::new("preferences", "Preferences…"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit TeachersPen"));
    let tray = SystemTray::new().with_icon(Icon::Raw(icon)).with_menu(menu);
    #[cfg(target_os = "macos")]
    let tray = tray.with_icon_as_template(true);
    tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,_,_| { let _=app.emit_to("controller","host-menu","show"); })).manage(Helpers::default()).system_tray(tray)
        .invoke_handler(tauri::generate_handler![host])
        .setup(|app| { create_window(&app.handle(),&json!({"label":"controller","role":"controller","title":"TeachersPen","bounds":{"width":1,"height":1}}))?; Ok(()) })
        .on_system_tray_event(|app,event| {if let SystemTrayEvent::MenuItemClick{id,..}=event {
            if id=="quit" {tauri::api::process::kill_children();app.exit(0);}
            let _=app.emit_to("controller","host-menu",id);
        }})
        .on_window_event(|event| {
            let w=event.window();if w.label()=="controller"{return;}
            let kind=match event.event(){
                WindowEvent::CloseRequested{api,..}=>{api.prevent_close();let _=w.hide();"close"},
                WindowEvent::Moved(_)=>"move",
                WindowEvent::Resized(_)=>"resize",
                WindowEvent::ScaleFactorChanged{..}=>"scale",
                WindowEvent::Focused(false)=>"blur",
                _=>return
            };
            let _=w.emit_to("controller","host-window",json!({"label":w.label(),"kind":kind,"bounds":bounds(w).ok()}));
        })
        .build(tauri::generate_context!()).expect("Could not start TeachersPen")
        .run(|_app,event| {if let tauri::RunEvent::ExitRequested{..}=event {tauri::api::process::kill_children();}});
}
