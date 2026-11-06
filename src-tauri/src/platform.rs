#![allow(unexpected_cfgs)] // objc 0.2 macros predate rustc check-cfg.

use serde_json::{json, Value};
use tauri::{Monitor, WebviewWindow as Window};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use tauri::Manager;
type Result<T> = std::result::Result<T, String>;

pub fn replace_file(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::rename(from, to).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
        }
        let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 9) } == 0 {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }
}

pub fn cursor(w: &Window) -> Result<Value> {
    let (x, y) = raw_cursor()?;
    #[cfg(not(target_os = "macos"))]
    let mut scale = 1.0;
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let mut display = 0;
    for (i, m) in monitors.iter().enumerate() {
        #[cfg(target_os = "macos")]
        let (mx, my, mw, mh) = (
            m.position().x as f64 / m.scale_factor(),
            m.position().y as f64 / m.scale_factor(),
            m.size().width as f64 / m.scale_factor(),
            m.size().height as f64 / m.scale_factor(),
        );
        #[cfg(not(target_os = "macos"))]
        let (mx, my, mw, mh) = (
            m.position().x as f64,
            m.position().y as f64,
            m.size().width as f64,
            m.size().height as f64,
        );
        if x >= mx && x < mx + mw && y >= my && y < my + mh {
            display = i;
            #[cfg(not(target_os = "macos"))]
            {
                scale = m.scale_factor();
            }
            break;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let (x, y) = (x / scale, y / scale);
    Ok(json!({"x":x,"y":y,"display":display}))
}

#[cfg(target_os = "macos")]
fn raw_cursor() -> Result<(f64, f64)> {
    #[repr(C)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const std::ffi::c_void) -> *const std::ffi::c_void;
        fn CGEventGetLocation(e: *const std::ffi::c_void) -> Point;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(e: *const std::ffi::c_void);
    }
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return Err("Cannot read pointer".into());
        }
        let p = CGEventGetLocation(event);
        CFRelease(event);
        Ok((p.x, p.y))
    }
}
#[cfg(target_os = "windows")]
fn raw_cursor() -> Result<(f64, f64)> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(p: *mut Point) -> i32;
    }
    let mut p = Point { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut p) } == 0 {
        Err("Cannot read pointer".into())
    } else {
        Ok((p.x as f64, p.y as f64))
    }
}
#[cfg(target_os = "linux")]
fn raw_cursor() -> Result<(f64, f64)> {
    use std::os::raw::{c_int, c_uint, c_ulong, c_void};
    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(name: *const i8) -> *mut c_void;
        fn XDefaultRootWindow(d: *mut c_void) -> c_ulong;
        fn XQueryPointer(
            d: *mut c_void,
            w: c_ulong,
            root: *mut c_ulong,
            child: *mut c_ulong,
            rx: *mut c_int,
            ry: *mut c_int,
            wx: *mut c_int,
            wy: *mut c_int,
            mask: *mut c_uint,
        ) -> c_int;
        fn XCloseDisplay(d: *mut c_void) -> c_int;
    }
    unsafe {
        let d = XOpenDisplay(std::ptr::null());
        if d.is_null() {
            return Err("Cannot connect to X11".into());
        }
        let (mut root, mut child, mut x, mut y, mut wx, mut wy, mut mask) = (0, 0, 0, 0, 0, 0, 0);
        XQueryPointer(
            d,
            XDefaultRootWindow(d),
            &mut root,
            &mut child,
            &mut x,
            &mut y,
            &mut wx,
            &mut wy,
            &mut mask,
        );
        XCloseDisplay(d);
        Ok((x as f64, y as f64))
    }
}

pub fn work_area(m: &Monitor) -> Option<Value> {
    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::{
            appkit::NSScreen,
            base::{id, nil},
            foundation::{NSArray, NSRect},
        };
        use objc::{msg_send, sel, sel_impl};
        let list = NSScreen::screens(nil);
        let main = if list.count() > 0 {
            list.objectAtIndex(0)
        } else {
            nil
        };
        if main == nil {
            return None;
        }
        let main_frame: NSRect = msg_send![main, frame];
        for i in 0..list.count() {
            let screen: id = list.objectAtIndex(i);
            let frame: NSRect = msg_send![screen, frame];
            let top = main_frame.size.height - frame.origin.y - frame.size.height;
            if (frame.origin.x - m.position().x as f64 / m.scale_factor()).abs() < 2.0
                && (top - m.position().y as f64 / m.scale_factor()).abs() < 2.0
            {
                let area: NSRect = msg_send![screen, visibleFrame];
                return Some(
                    json!({"x":area.origin.x,"y":main_frame.size.height-area.origin.y-area.size.height,"width":area.size.width,"height":area.size.height}),
                );
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = m;
    None
}

pub fn configure(w: &Window, role: &str) -> Result<()> {
    taskbar_style(w)?;
    #[cfg(target_os = "linux")]
    if role != "controller" {
        let window = w.clone();
        let handle = w.app_handle().clone();
        w.run_on_main_thread(move || {
            use gtk::prelude::*;
            if let Ok(gtk) = window.gtk_window() {
                let resized = handle.clone();
                gtk.connect_size_allocate(move |_, _| refresh_overlay_regions(&resized));
                let mapped = handle.clone();
                gtk.connect_map(move |_| refresh_overlay_regions(&mapped));
                gtk.connect_unmap(move |_| refresh_overlay_regions(&handle));
            }
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        let window = w.clone();
        w.run_on_main_thread(move || {
            #[link(name = "user32")]
            extern "system" {
                fn SendMessageW(w: isize, message: u32, wparam: usize, lparam: isize) -> isize;
            }
            if let Ok(hwnd) = window.hwnd() {
                unsafe {
                    // Tauri assigns ICON_SMALL only. Windows uses ICON_BIG for
                    // the taskbar; borrow the same icon owned by the window.
                    let icon = SendMessageW(hwnd.0 as isize, 0x007F, 0, 0);
                    if icon != 0 {
                        SendMessageW(hwnd.0 as isize, 0x0080, 1, icon);
                    }
                }
            }
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    if role != "preferences" {
        let window = w.clone();
        w.run_on_main_thread(move || {
            #[link(name = "user32")]
            extern "system" {
                fn GetWindowLongPtrW(w: isize, index: i32) -> isize;
                fn SetWindowLongPtrW(w: isize, index: i32, value: isize) -> isize;
                fn SetWindowPos(w: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
            }
            if let Ok(hwnd) = window.hwnd() {
                unsafe {
                    // Tao keeps WS_CAPTION/WS_SYSMENU even without decorations.
                    // A shaped window can expose these native caption controls.
                    let style = GetWindowLongPtrW(hwnd.0 as isize, -16);
                    SetWindowLongPtrW(hwnd.0 as isize, -16, style & !(0x00C00000 | 0x00080000 | 0x00040000));
                    SetWindowPos(hwnd.0 as isize, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020);
                }
            }
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let window = w.clone();
        let role = role.to_string();
        w.run_on_main_thread(move || unsafe {
            use cocoa::{base::id, foundation::NSRect};
            use objc::{
                class, msg_send,
                runtime::{Class, Object, Sel},
                sel, sel_impl, Encode,
            };
            let Ok(ptr) = window.ns_window() else {
                return;
            };
            let ns = ptr as id;
            if role != "preferences" && role != "controller" {
                let level: i64 = if role == "pie" {
                    1004
                } else if role == "overlay" {
                    1000
                } else if role == "mini" {
                    1003
                } else {
                    1002
                };
                let _: () = msg_send![ns,setLevel:level];
                let _: () = msg_send![ns,setCollectionBehavior:257u64];
                let _: () = msg_send![ns,setHasShadow:false];
            }
            if role == "toolbar" || role == "overlay" {
                // Tao's sendEvent implementation resolves super from the object's
                // actual class. Changing that class adds an extra level and makes
                // event dispatch recurse. Add only this missing method to TaoWindow.
                extern "C" fn free_frame(this: &Object, _: Sel, frame: NSRect, screen: id) -> NSRect {
                    unsafe {
                        let style: u64 = msg_send![this, styleMask];
                        if style & 1 != 0 {
                            return msg_send![super(this,class!(NSWindow)),constrainFrameRect:frame toScreen:screen];
                        }
                    }
                    frame
                }
                extern "C" {
                    fn class_addMethod(class: *const Class, selector: Sel, implementation: *const std::ffi::c_void, types: *const i8) -> i8;
                }
                let class = (&*(ns as *mut Object)).class();
                let rect = NSRect::encode();
                let signature = std::ffi::CString::new(format!("{}@:{}@",rect.as_str(),rect.as_str())).unwrap();
                class_addMethod(class,sel!(constrainFrameRect:toScreen:),free_frame as *const () as *const std::ffi::c_void,signature.as_ptr());
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    if role == "mini" {
        #[link(name = "gdi32")]
        extern "system" {
            fn CreateEllipticRgn(l: i32, t: i32, r: i32, b: i32) -> isize;
        }
        #[link(name = "user32")]
        extern "system" {
            fn SetWindowRgn(w: isize, r: isize, redraw: i32) -> i32;
        }
        let s = w.scale_factor().map_err(|e| e.to_string())?;
        let hwnd = w.hwnd().map_err(|e| e.to_string())?.0 as isize;
        unsafe {
            SetWindowRgn(
                hwnd,
                CreateEllipticRgn(
                    (3.0 * s) as i32,
                    (3.0 * s) as i32,
                    (45.0 * s) as i32,
                    (45.0 * s) as i32,
                ),
                1,
            );
        }
    }
    #[cfg(target_os = "linux")]
    if role == "mini" {
        let window = w.clone();
        w.run_on_main_thread(move || {
            use gtk::prelude::*;
            if let Ok(gtk) = window.gtk_window() {
                gtk.realize();
                if let Some(gdk) = gtk.window() {
                    let region = gtk::cairo::Region::create();
                    for y in 3..45 {
                        let half = (21.0_f64.powi(2) - (y as f64 + 0.5 - 24.0).powi(2)).sqrt();
                        let x = (24.0 - half).ceil() as i32;
                        let _ = region.union_rectangle(&gtk::cairo::RectangleInt::new(x, y, 48 - x * 2, 1));
                    }
                    gdk.input_shape_combine_region(&region, 0, 0);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Desktop window managers can raise a focused overlay above its tool windows.
// Restore their order without taking keyboard focus away from drawing.
pub fn raise_controls(app: &tauri::AppHandle) {
    refresh_overlay_regions(app);
    #[cfg(target_os = "windows")]
    for label in ["toolbar", "mini", "timer-window", "preferences", "pie"] {
        if let Some(window) = app.get_webview_window(label) {
            let target = window.clone();
            let _ = window.run_on_main_thread(move || {
                #[link(name = "user32")]
                extern "system" {
                    fn SetWindowPos(w: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
                }
                if target.is_visible().unwrap_or(false) {
                    if let Ok(hwnd) = target.hwnd() {
                        unsafe { SetWindowPos(hwnd.0 as isize, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); }
                    }
                }
            });
        }
    }
    #[cfg(target_os = "linux")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            use gtk::prelude::*;
            let overlays: Vec<_> = handle.webview_windows().into_iter()
                .filter(|(label, _)| label.starts_with("overlay-"))
                .map(|(_, window)| window)
                .collect();
            let parent = overlays.iter()
                .find(|window| window.is_focused().unwrap_or(false))
                .or_else(|| overlays.first())
                .and_then(|window| window.gtk_window().ok());
            for label in ["toolbar", "mini", "timer-window", "preferences", "pie"] {
                if let Some(window) = handle.get_webview_window(label) {
                    if let Ok(gtk) = window.gtk_window() {
                        // XFWM keeps transient controls above their drawing
                        // parent, even when that parent receives keyboard focus.
                        // The main toolbar must remain an independent window:
                        // XFCE's task list can omit transient child windows.
                        if label == "toolbar" {
                            gtk.set_transient_for(None::<&gtk::Window>);
                            gtk.set_skip_taskbar_hint(false);
                            gtk.set_skip_pager_hint(false);
                        } else if let Some(ref overlay) = parent {
                            gtk.set_transient_for(Some(overlay));
                        }
                        if gtk.is_visible() {
                            gtk.set_keep_above(true);
                            if let Some(gdk) = gtk.window() {
                                if let Some(overlay) = parent.as_ref().and_then(|gtk| gtk.window()) {
                                    gdk.restack(Some(&overlay), true);
                                }
                                gdk.raise();
                            }
                        }
                    }
                }
            }
        });
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let _ = app;
}

// Toolbar bounds in GTK client coordinates, measured from the rendered content.
#[derive(Default)]
pub struct ToolbarRegion(pub std::sync::Mutex<Option<(i32, i32, i32, i32)>>);

pub fn toolbar_region(w: &Window, args: &serde_json::Value) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let values: Vec<f64> = ["x", "y", "width", "height", "viewportWidth", "viewportHeight"]
            .iter().filter_map(|key| args[*key].as_f64()).collect();
        if values.len() != 6 || values.iter().any(|v| !v.is_finite())
            || values[2..].iter().any(|v| *v <= 0.0) {
            return Err("Invalid toolbar rectangle".into());
        }
        let window = w.clone();
        w.with_webview(move |webview| {
            use gtk::prelude::*;
            let view = webview.inner();
            let Ok(gtk) = window.gtk_window() else { return; };
            let Some((offset_x, offset_y)) = view.translate_coordinates(&gtk, 0, 0) else { return; };
            let sx = view.allocated_width() as f64 / values[4];
            let sy = view.allocated_height() as f64 / values[5];
            let x = (values[0] * sx).floor() as i32 + offset_x;
            let y = (values[1] * sy).floor() as i32 + offset_y;
            let right = ((values[0] + values[2]) * sx).ceil() as i32 + offset_x;
            let bottom = ((values[1] + values[3]) * sy).ceil() as i32 + offset_y;
            let app = window.app_handle();
            if let Ok(mut rect) = app.state::<ToolbarRegion>().0.lock() {
                *rect = Some((x, y, right - x, bottom - y));
            }
            refresh_overlay_regions(&app);
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (w, args);
    Ok(())
}

// Keep holes for the controls in both the visible and mouse-input regions.
// XFWM can raise a full-screen drawing overlay on the first pointer press,
// even after an explicit restack. Holes remain effective regardless of Z order.
pub fn refresh_overlay_regions(app: &tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            use gtk::prelude::*;
            let controls: Vec<_> = ["toolbar", "mini", "timer-window", "preferences", "pie"]
                .iter()
                .filter_map(|label| handle.get_webview_window(label))
                .filter_map(|window| {
                    let gtk = window.gtk_window().ok()?;
                    if !gtk.is_mapped() { return None; }
                    let gdk = gtk.window()?;
                    let (_, x, y) = gdk.origin();
                    if window.label() == "toolbar" {
                        // Do not reserve the transparent remainder of GTK's
                        // allocation (or guess before the first DOM measurement).
                        let state = handle.state::<ToolbarRegion>();
                        let rect = *state.0.lock().ok()?;
                        return rect.map(|(left, top, width, height)|
                            (x + left, y + top, width, height, false));
                    }
                    Some((x, y, gdk.width().max(0), gdk.height().max(0), window.label() == "pie"))
                })
                .collect();
            for (label, window) in handle.webview_windows() {
                if !label.starts_with("overlay-") { continue; }
                let Ok(gtk) = window.gtk_window() else { continue; };
                let Some(gdk) = gtk.window() else { continue; };
                let (_, origin_x, origin_y) = gdk.origin();
                let (visible, input) = overlay_regions(gdk.width().max(1), gdk.height().max(1), origin_x, origin_y, &controls);
                gtk.shape_combine_region(Some(&visible));
                if gtk.accepts_focus() {
                    gtk.input_shape_combine_region(Some(&input));
                } else {
                    gtk.input_shape_combine_region(Some(&gtk::cairo::Region::create()));
                }
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

// DeleteTab alone does not exclude a window from Alt+Tab. Windows tool windows
// keep the mini launcher, overlays and dialogs out of the application switcher.
pub fn taskbar_style(w: &Window) -> Result<()> {
    #[cfg(target_os = "windows")]
    if w.label() != "toolbar" {
        let window = w.clone();
        w.run_on_main_thread(move || {
            #[link(name = "user32")]
            extern "system" {
                fn GetWindowLongPtrW(w: isize, index: i32) -> isize;
                fn SetWindowLongPtrW(w: isize, index: i32, value: isize) -> isize;
            }
            if let Ok(hwnd) = window.hwnd() {
                unsafe {
                    let style = GetWindowLongPtrW(hwnd.0 as isize, -20);
                    SetWindowLongPtrW(hwnd.0 as isize, -20, (style & !0x00040000) | 0x00000080);
                }
            }
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = w;
    Ok(())
}

pub fn ignore(w: &Window, enabled: bool) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let window = w.clone();
        w.run_on_main_thread(move || unsafe {
            use cocoa::base::{id, BOOL, NO, YES};
            use objc::{class, msg_send, sel, sel_impl};
            let Ok(ptr) = window.ns_window() else {
                return;
            };
            let ns = ptr as id;
            let _: () = msg_send![ns,setIgnoresMouseEvents:if enabled{YES}else{NO}];
            if enabled {
                let key: BOOL = msg_send![ns, isKeyWindow];
                if key == YES {
                    let _: () = msg_send![ns, resignKeyWindow];
                }
                // WebKit otherwise leaves its custom drawing cursor cached
                // until another pointer event, despite already passing clicks.
                let cursor: id = msg_send![class!(NSCursor), arrowCursor];
                let _: () = msg_send![cursor, set];
            }
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        w.set_ignore_cursor_events(enabled)
            .map_err(|e| e.to_string())?;
        taskbar_style(w)
    }
    #[cfg(target_os = "linux")]
    {
        let window = w.clone();
        w.run_on_main_thread(move || {
            use gtk::prelude::*;
            if let Ok(gtk) = window.gtk_window() {
                gtk.realize();
                gtk.set_accept_focus(!enabled);
                gtk.set_focus_on_map(!enabled);
                if enabled {
                    // Store the shape on GtkWidget so GTK preserves it when
                    // mapping/resizing the window, including its first show.
                    gtk.input_shape_combine_region(Some(&gtk::cairo::Region::create()));
                } else {
                    // Restore the full input area, following future resizes.
                    gtk.input_shape_combine_region(None);
                }
            }
        })
        .map_err(|e| e.to_string())?;
        refresh_overlay_regions(&w.app_handle());
        Ok(())
    }
}
pub fn dock(app: &tauri::AppHandle, hidden: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || unsafe {
            use cocoa::{appkit::NSApplication, base::nil};
            use objc::{msg_send, sel, sel_impl};
            let ns = NSApplication::sharedApplication(nil);
            let _: bool = msg_send![ns,setActivationPolicy:if hidden{1i64}else{0i64}];
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, hidden);
}


pub fn system_languages() -> Vec<String> {
    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::base::id;
        use objc::{class, msg_send, sel, sel_impl};
        let preferred: id = msg_send![class!(NSLocale), preferredLanguages];
        let count: usize = msg_send![preferred, count];
        return (0..count).filter_map(|i| {
            let locale: id = msg_send![preferred, objectAtIndex: i];
            let text: *const std::ffi::c_char = msg_send![locale, UTF8String];
            if text.is_null() { None } else { Some(std::ffi::CStr::from_ptr(text).to_string_lossy().into_owned()) }
        }).collect();
    }
    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetUserPreferredUILanguages(flags: u32, count: *mut u32, buffer: *mut u16, size: *mut u32) -> i32;
        }
        let mut count = 0;
        let mut size = 0;
        unsafe {
            GetUserPreferredUILanguages(8, &mut count, std::ptr::null_mut(), &mut size);
            if size > 0 {
                let mut buffer = vec![0u16; size as usize];
                if GetUserPreferredUILanguages(8, &mut count, buffer.as_mut_ptr(), &mut size) != 0 {
                    return buffer.split(|c| *c == 0).filter(|s| !s.is_empty()).map(String::from_utf16_lossy).collect();
                }
            }
        }
        Vec::new()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let locale = ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|key| std::env::var(key).ok().filter(|v| !v.is_empty()));
        if matches!(locale.as_deref(), Some("C" | "POSIX" | "C.UTF-8")) { return vec!["en".into()]; }
        let mut preferred: Vec<String> = std::env::var("LANGUAGE").unwrap_or_default().split(':').filter(|v| !v.is_empty()).map(str::to_owned).collect();
        if let Some(locale) = locale { preferred.push(locale); }
        preferred
    }
}

// GTK window managers can constrain a requested monitor-sized window to the
// work area. Return the actual WebView origin/allocation, not the requested one.
#[cfg(target_os = "linux")]
pub fn viewport_bounds(window: &Window) -> Result<Value> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let target = window.clone();
    window.with_webview(move |webview| {
        use gtk::prelude::*;
        let result = (|| {
            let gtk = target.gtk_window().ok()?;
            if !gtk.is_mapped() { return None; }
            let view = webview.inner();
            let (offset_x, offset_y) = view.translate_coordinates(&gtk, 0, 0)?;
            let (_, x, y) = gtk.window()?.origin();
            let (width, height) = (view.allocated_width(), view.allocated_height());
            if width <= 0 || height <= 0 { return None; }
            Some(json!({"x":x + offset_x,"y":y + offset_y,"width":width,"height":height}))
        })();
        let _ = tx.send(result.unwrap_or(Value::Null));
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(1)).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn overlay_regions(width: i32, height: i32, origin_x: i32, origin_y: i32, controls: &[(i32, i32, i32, i32, bool)]) -> (gtk::cairo::Region, gtk::cairo::Region) {
    let visible = gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(0, 0, width, height));
    let input = visible.copy();
    for &(x, y, width, height, input_only) in controls {
        let rect = gtk::cairo::RectangleInt::new(x - origin_x, y - origin_y, width, height);
        let _ = input.subtract_rectangle(&rect);
        if !input_only { let _ = visible.subtract_rectangle(&rect); }
    }
    (visible, input)
}

#[cfg(all(test, target_os = "linux"))]
mod region_tests {
    #[test]
    fn transparent_radial_blocks_input_without_hiding_annotations() {
        let controls = [(-1920, 100, 1920, 1080, true), (-1800, 120, 300, 50, false)];
        let (visible, input) = super::overlay_regions(1920, 1080, -1920, 100, &controls);
        assert!(visible.contains_point(500, 500));
        assert!(!visible.contains_point(130, 30));
        assert!(input.is_empty());
        let (closed_visible, closed_input) = super::overlay_regions(1920, 1080, -1920, 100, &controls[1..]);
        assert!(closed_visible.contains_point(500, 500));
        assert!(closed_input.contains_point(500, 500));
        assert!(!closed_input.contains_point(130, 30));
    }
}
