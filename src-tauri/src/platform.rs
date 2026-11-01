#![allow(unexpected_cfgs)] // objc 0.2 macros predate rustc check-cfg.

use serde_json::{json, Value};
use tauri::{Monitor, Window};
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
                let level: i64 = if role == "overlay" {
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
            if role == "overlay" {
                use cocoa::base::{BOOL, NO, YES};
                use objc::declare::ClassDecl;
                // Derive from NSPanel, not TaoWindow: Tao's dynamic super call
                // in sendEvent must not become recursive after conversion.
                extern "C" fn never_key(_: &Object, _: Sel) -> BOOL { NO }
                extern "C" fn unrestricted(_: &Object, _: Sel, frame: NSRect, _: id) -> NSRect { frame }
                extern "C" fn original_cleanup(this: &mut Object, _: Sel) {
                    unsafe { let _:()=msg_send![super(this,class!(NSWindow)),dealloc]; }
                }
                let panel=Class::get("TeachersPenDrawingPanel").unwrap_or_else(|| {
                    let mut cls=ClassDecl::new("TeachersPenDrawingPanel",class!(NSPanel)).unwrap();
                    cls.add_method(sel!(canBecomeKeyWindow),never_key as extern "C" fn(&Object,Sel)->BOOL);
                    cls.add_method(sel!(canBecomeMainWindow),never_key as extern "C" fn(&Object,Sel)->BOOL);
                    cls.add_method(sel!(constrainFrameRect:toScreen:),unrestricted as extern "C" fn(&Object,Sel,NSRect,id)->NSRect);
                    cls.add_method(sel!(dealloc),original_cleanup as extern "C" fn(&mut Object,Sel));
                    cls.register()
                });
                let original=(&*(ns as *mut Object)).class();
                // No extra storage may be required when converting an existing window.
                if panel.instance_size() <= original.instance_size() {
                    extern "C" { fn object_setClass(object:id,class:*const Class)->*const Class; }
                    object_setClass(ns,panel);
                    let style:u64=msg_send![ns,styleMask];
                    let _:()=msg_send![ns,setStyleMask:style | (1u64<<7)];
                    let _:()=msg_send![ns,setHidesOnDeactivate:NO];
                    let _:()=msg_send![ns,setBecomesKeyOnlyIfNeeded:YES];
                    let _:()=msg_send![ns,setFloatingPanel:YES];
                } else {
                    eprintln!("TeachersPen: incompatible NSPanel layout; retaining the original window");
                }
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
        let hwnd = w.hwnd().map_err(|e| e.to_string())?.0;
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
                        let _ = region.union_rectangle(&gtk::cairo::RectangleInt {
                            x,
                            y,
                            width: 48 - x * 2,
                            height: 1,
                        });
                    }
                    gdk.input_shape_combine_region(&region, 0, 0);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    }
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
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let window = w.clone();
        w.run_on_main_thread(move || {
            use gtk::prelude::*;
            if let Ok(gtk) = window.gtk_window() {
                gtk.realize();
                gtk.set_accept_focus(!enabled);
                if let Some(gdk) = gtk.window() {
                    if enabled {
                        gdk.input_shape_combine_region(&gtk::cairo::Region::create(), 0, 0);
                    } else {
                        let region =
                            gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt {
                                x: 0,
                                y: 0,
                                width: gtk.allocated_width().max(1),
                                height: gtk.allocated_height().max(1),
                            });
                        gdk.input_shape_combine_region(&region, 0, 0);
                    }
                }
            }
        })
        .map_err(|e| e.to_string())
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
