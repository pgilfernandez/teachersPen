//! Observe releases of our registered Carbon hotkeys. Unlike querying global
//! physical key state in a child process, this also works in Finder launches.
use crate::{err, release_native, trace, LiveState, Result};
use serde_json::json;
use std::{collections::HashMap, ffi::c_void, sync::Mutex};
use tao::accelerator::Accelerator;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct HoldKeys {
    pressed: HashMap<u32, u32>,
    watches: HashMap<String, u32>,
}
#[derive(Default)]
pub struct MacHold(pub Mutex<HoldKeys>);
#[repr(C)]
struct EventSpec {
    class: u32,
    kind: u32,
}
#[repr(C)]
#[derive(Default)]
struct HotKey {
    signature: u32,
    id: u32,
}
#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn GetApplicationEventTarget() -> *mut c_void;
    fn InstallEventHandler(
        target: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> i32,
        count: u32,
        events: *const EventSpec,
        data: *mut c_void,
        handler: *mut *mut c_void,
    ) -> i32;
    fn GetEventKind(event: *mut c_void) -> u32;
    fn GetEventParameter(
        event: *mut c_void,
        name: u32,
        kind: u32,
        actual: *mut u32,
        size: u32,
        actual_size: *mut u32,
        value: *mut c_void,
    ) -> i32;
}
fn accelerator(shortcut: &str) -> Result<Accelerator> {
    shortcut
        .replace("CommandOrControl", "Command")
        .parse()
        .map_err(err)
}
pub fn press(app: &AppHandle, shortcut: &str) {
    if let Ok(a) = accelerator(shortcut) {
        let mut mask = 0;
        for part in shortcut.split('+') {
            mask |= match part.trim().to_ascii_uppercase().as_str() {
                "CTRL" | "CONTROL" => 4096,
                "SHIFT" => 512,
                "ALT" | "OPTION" => 2048,
                "COMMAND" | "CMD" | "SUPER" | "COMMANDORCONTROL" | "COMMANDORCTRL"
                | "CMDORCTRL" | "CMDORCONTROL" => 256,
                _ => 0,
            };
        }
        if let Ok(mut keys) = app.state::<MacHold>().0.lock() {
            keys.pressed.insert(a.id().0 as u32, mask);
        }
    }
}
fn release(app: &AppHandle, id: u32) {
    let tokens = {
        let store = app.state::<MacHold>();
        let Ok(mut keys) = store.0.lock() else {
            return;
        };
        keys.pressed.remove(&id);
        let tokens: Vec<String> = keys
            .watches
            .iter()
            .filter(|(_, key)| **key == id)
            .map(|(token, _)| token.clone())
            .collect();
        for token in &tokens {
            keys.watches.remove(token);
        }
        tokens
    };
    for token in tokens {
        release_native(app, &token);
        trace(format!("Carbon key {} up", token));
        let _ = app.emit_to(
            "controller",
            "host-key",
            json!({"token":token,"event":"up"}),
        );
    }
}
unsafe extern "C" fn event(_next: *mut c_void, event: *mut c_void, data: *mut c_void) -> i32 {
    let app = &*(data as *const AppHandle);
    let mut key = HotKey::default();
    if GetEventKind(event) == 6 {
        if GetEventParameter(
            event,
            u32::from_be_bytes(*b"----"),
            u32::from_be_bytes(*b"hkid"),
            std::ptr::null_mut(),
            std::mem::size_of::<HotKey>() as u32,
            std::ptr::null_mut(),
            &mut key as *mut _ as *mut c_void,
        ) == 0
            && key.signature == u32::from_be_bytes(*b"htrs")
        {
            release(app, key.id);
            return 0;
        }
    } else {
        // App-local modifier changes are not a global keyboard monitor. Keep
        // the normal responder chain intact after ending the affected chord.
        let mut modifiers = 0u32;
        if GetEventParameter(
            event,
            u32::from_be_bytes(*b"kmod"),
            u32::from_be_bytes(*b"magn"),
            std::ptr::null_mut(),
            4,
            std::ptr::null_mut(),
            &mut modifiers as *mut _ as *mut c_void,
        ) == 0
        {
            if modifiers & (1 << 13) != 0 {
                modifiers |= 512;
            }
            if modifiers & (1 << 14) != 0 {
                modifiers |= 2048;
            }
            if modifiers & (1 << 15) != 0 {
                modifiers |= 4096;
            }
            let ids: Vec<u32> = app
                .state::<MacHold>()
                .0
                .lock()
                .map(|keys| {
                    keys.pressed
                        .iter()
                        .filter(|(_, mask)| modifiers & **mask != **mask)
                        .map(|(id, _)| *id)
                        .collect()
                })
                .unwrap_or_default();
            for id in ids {
                release(app, id);
            }
        }
    }
    -9874 // eventNotHandledErr: let AppKit continue handling the event.
}
pub fn install(app: &AppHandle) -> Result<()> {
    let events = [
        EventSpec {
            class: u32::from_be_bytes(*b"keyb"),
            kind: 6,
        },
        EventSpec {
            class: u32::from_be_bytes(*b"keyb"),
            kind: 4,
        },
    ];
    let data = Box::into_raw(Box::new(app.clone()));
    let mut handler = std::ptr::null_mut();
    let status = unsafe {
        InstallEventHandler(
            GetApplicationEventTarget(),
            event,
            events.len() as u32,
            events.as_ptr(),
            data as *mut c_void,
            &mut handler,
        )
    };
    if status != 0 {
        unsafe {
            drop(Box::from_raw(data));
        }
        return Err(format!(
            "Cannot install hotkey release handler ({})",
            status
        ));
    }
    // The handler and its AppHandle remain alive until this process exits.
    Ok(())
}
pub fn watch(app: &AppHandle, token: String, shortcut: &str) -> Result<()> {
    let id = accelerator(shortcut)?.id().0 as u32;
    let down = {
        let store = app.state::<MacHold>();
        let mut keys = store.0.lock().map_err(err)?;
        if keys.pressed.contains_key(&id) {
            keys.watches.insert(token.clone(), id);
            app.state::<LiveState>()
                .down
                .lock()
                .map_err(err)?
                .insert(token.clone());
            true
        } else {
            false
        }
    };
    trace(format!(
        "Carbon key {} {}",
        token,
        if down { "down" } else { "up" }
    ));
    app.emit_to(
        "controller",
        "host-key",
        json!({"token":token,"event":if down{"down"}else{"up"}}),
    )
    .map_err(err)
}
pub fn stop(app: &AppHandle, token: &str) {
    if let Ok(mut keys) = app.state::<MacHold>().0.lock() {
        keys.watches.remove(token);
    }
    release_native(app, token);
}
pub fn clear(app: &AppHandle) {
    let tokens = {
        let store = app.state::<MacHold>();
        let Ok(mut keys) = store.0.lock() else {
            return;
        };
        keys.pressed.clear();
        keys.watches
            .drain()
            .map(|(token, _)| token)
            .collect::<Vec<_>>()
    };
    for token in tokens {
        release_native(app, &token);
        let _ = app.emit_to(
            "controller",
            "host-key",
            json!({"token":token,"event":"up"}),
        );
    }
}
