#![allow(unexpected_cfgs)] // objc 0.2 macros predate rustc check-cfg.

//! Mouse-interactive annotation panels that leave the current application active.
use cocoa::base::{id, nil, BOOL, NO, YES};
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use objc::{
    class,
    declare::ClassDecl,
    msg_send,
    runtime::{Class, Object, Sel},
    sel, sel_impl,
};
use std::sync::OnceLock;
use tauri::{Manager, Window};

pub fn passive(window: &Window) -> bool {
    window.label().starts_with("overlay-") || window.label() == "pie"
}

fn panel_class() -> &'static Class {
    static PANEL: OnceLock<&'static Class> = OnceLock::new();
    PANEL.get_or_init(|| {
        let mut class = ClassDecl::new("TeachersPenAnnotationPanel", class!(NSPanel)).unwrap();
        extern "C" fn no(_: &Object, _: Sel) -> BOOL {
            NO
        }
        extern "C" fn unconstrained(_: &Object, _: Sel, frame: NSRect, _: id) -> NSRect {
            frame
        }
        extern "C" fn send_event(this: &Object, _: Sel, event: id) {
            unsafe {
                // Dispatch directly to NSPanel, avoiding Tao's dynamic-super
                // recursion, then reinstall the preview after WebKit's cursor.
                let _: () = msg_send![super(this, class!(NSPanel)), sendEvent: event];
                let kind: u64 = msg_send![event, type];
                if [5, 8, 17].contains(&kind) {
                    install_cursor(this as *const Object as id);
                }
            }
        }
        unsafe {
            class.add_method(
                sel!(sendEvent:),
                send_event as extern "C" fn(&Object, Sel, id),
            );
            class.add_method(
                sel!(canBecomeKeyWindow),
                no as extern "C" fn(&Object, Sel) -> BOOL,
            );
            class.add_method(
                sel!(canBecomeMainWindow),
                no as extern "C" fn(&Object, Sel) -> BOOL,
            );
            class.add_method(
                sel!(constrainFrameRect:toScreen:),
                unconstrained as extern "C" fn(&Object, Sel, NSRect, id) -> NSRect,
            );
        }
        class.register()
    })
}

pub fn configure(window: &Window) -> Result<(), String> {
    let panel = panel_class();
    let ptr = window.ns_window().map_err(|e| e.to_string())?;
    extern "C" {
        fn class_getInstanceSize(class: *const Class) -> usize;
        fn object_setClass(object: id, class: *const Class) -> *const Class;
    }
    // TaoWindow has no extra ivars. Do not change an object's class if AppKit's
    // panel layout is larger on a future OS release.
    unsafe {
        if class_getInstanceSize(panel) > class_getInstanceSize((&*(ptr as *mut Object)).class()) {
            return Err("macOS annotation panel has an incompatible object layout".into());
        }
    }
    let target = window.clone();
    window
        .run_on_main_thread(move || unsafe {
            let Ok(ptr) = target.ns_window() else { return };
            let ns = ptr as id;
            // Inherit directly from NSPanel, not TaoWindow: Tao's sendEvent:
            // resolves super dynamically and would recurse in a TaoWindow subclass.
            object_setClass(ns, panel);
            let style: u64 = msg_send![ns, styleMask];
            let _: () = msg_send![ns, setStyleMask: style | (1u64 << 7)];
            // The object was allocated as TaoWindow, so NSPanel's initializer
            // never set the WindowServer nonactivation tag. Updating styleMask
            // alone does not set that tag on an existing window.
            let selector = sel!(_setPreventsActivation:);
            let supported: BOOL = msg_send![ns, respondsToSelector: selector];
            if supported == YES {
                let _: () = msg_send![ns, _setPreventsActivation: YES];
            }
            let _: () = msg_send![ns, setAcceptsMouseMovedEvents: YES];
            let _: () = msg_send![ns, setFloatingPanel: YES];
            let _: () = msg_send![ns, setHidesOnDeactivate: NO];
            let _: () = msg_send![ns, setBecomesKeyOnlyIfNeeded: YES];
        })
        .map_err(|e| e.to_string())
}

pub fn show(window: &Window) -> Result<(), String> {
    let target = window.clone();
    window
        .run_on_main_thread(move || unsafe {
            if let Ok(ptr) = target.ns_window() {
                let _: () = msg_send![ptr as id, orderFrontRegardless];
            }
        })
        .map_err(|e| e.to_string())
}

// Keep the cursor with its overlay; no global cursor hiding or focus is needed.
static CURSOR_KEY: u8 = 0;
extern "C" {
    fn objc_setAssociatedObject(object: id, key: *const u8, value: id, policy: usize);
    fn objc_getAssociatedObject(object: id, key: *const u8) -> id;
}

unsafe fn install_cursor(window: id) {
    let cursor = objc_getAssociatedObject(window, &CURSOR_KEY);
    if cursor == nil {
        return;
    }
    let ignored: BOOL = msg_send![window, ignoresMouseEvents];
    if ignored == YES {
        return;
    }
    let point: NSPoint = msg_send![class!(NSEvent), mouseLocation];
    let number: i64 =
        msg_send![class!(NSWindow), windowNumberAtPoint: point belowWindowWithWindowNumber: 0i64];
    let own: i64 = msg_send![window, windowNumber];
    if number == own {
        let _: () = msg_send![cursor, set];
    }
}

pub fn update_cursors(app: &tauri::AppHandle, state: &serde_json::Value) -> Result<(), String> {
    let enabled = state["drawing"] == true && state["pie"].is_null();
    let width = state["settings"]["width"]
        .as_f64()
        .unwrap_or(6.0)
        .clamp(1.0, 40.0);
    let alpha = 1.0
        - state["settings"]["transparency"]
            .as_f64()
            .unwrap_or(0.0)
            .clamp(0.0, 100.0)
            / 100.0;
    let index = state["color"].as_u64().unwrap_or(0) as usize;
    let hex = state["settings"]["colors"][index]
        .as_str()
        .unwrap_or("#ef4444");
    let rgb = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xef4444);
    for (label, window) in app.windows() {
        if !label.starts_with("overlay-") {
            continue;
        }
        let target = window.clone();
        window.run_on_main_thread(move || unsafe {
            let Ok(ptr) = target.ns_window() else { return };
            let ns = ptr as id;
            if !enabled {
                let previous = objc_getAssociatedObject(ns, &CURSOR_KEY);
                if previous != nil {
                    let arrow: id = msg_send![class!(NSCursor), arrowCursor];
                    let _: () = msg_send![arrow, set];
                }
                objc_setAssociatedObject(ns, &CURSOR_KEY, nil, 1);
                return;
            }
            let image: id = msg_send![class!(NSImage), alloc];
            let image: id = msg_send![image, initWithSize: NSSize::new(48.0, 48.0)];
            let _: () = msg_send![image, lockFocus];
            let color: id = msg_send![class!(NSColor), colorWithSRGBRed: ((rgb >> 16) & 255) as f64 / 255.0
                green: ((rgb >> 8) & 255) as f64 / 255.0 blue: (rgb & 255) as f64 / 255.0 alpha: alpha];
            let _: () = msg_send![color, setFill];
            let rect = NSRect::new(NSPoint::new(24.0 - width / 2.0, 24.0 - width / 2.0), NSSize::new(width, width));
            let path: id = msg_send![class!(NSBezierPath), bezierPathWithOvalInRect: rect];
            let _: () = msg_send![path, fill];
            let _: () = msg_send![image, unlockFocus];
            let cursor: id = msg_send![class!(NSCursor), alloc];
            let cursor: id = msg_send![cursor, initWithImage: image hotSpot: NSPoint::new(24.0, 24.0)];
            objc_setAssociatedObject(ns, &CURSOR_KEY, cursor, 1);
            install_cursor(ns);
            let _: () = msg_send![cursor, release];
            let _: () = msg_send![image, release];
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}
