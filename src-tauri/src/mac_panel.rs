#![allow(unexpected_cfgs)] // objc 0.2 macros predate rustc check-cfg.

//! Mouse-interactive annotation panels that leave the current application active.
use cocoa::base::{id, BOOL, NO, YES};
use cocoa::foundation::{NSPoint, NSRect};
use objc::{
    class,
    declare::ClassDecl,
    msg_send,
    runtime::{Class, Object, Sel},
    sel, sel_impl,
};
use std::sync::OnceLock;
use tauri::WebviewWindow as Window;

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
        unsafe {
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

// Read-only pointer sampling for a preview drawn by the unfocused WebView.
pub fn preview_pointer(window: &Window) -> Result<serde_json::Value, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let target = window.clone();
    window.run_on_main_thread(move || {
        let result = (|| -> Result<serde_json::Value, String> {
            unsafe {
                let ns = target.ns_window().map_err(|e| e.to_string())? as id;
                let ignored: BOOL = msg_send![ns, ignoresMouseEvents];
                if ignored == YES { return Ok(serde_json::Value::Null); }
                let point: NSPoint = msg_send![class!(NSEvent), mouseLocation];
                let number: i64 = msg_send![class!(NSWindow), windowNumberAtPoint: point belowWindowWithWindowNumber: 0i64];
                let own: i64 = msg_send![ns, windowNumber];
                if number != own { return Ok(serde_json::Value::Null); }
            }
            let point = crate::platform::cursor(&target)?;
            let origin = target.inner_position().map_err(|e| e.to_string())?;
            let scale = target.scale_factor().map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "x": point["x"].as_f64().unwrap_or(0.0) - origin.x as f64 / scale,
                "y": point["y"].as_f64().unwrap_or(0.0) - origin.y as f64 / scale
            }))
        })();
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(1))
        .map_err(|e| e.to_string())?
}
