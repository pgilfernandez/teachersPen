use crate::{err, Result};
#[cfg(target_os = "linux")]
use tauri::Manager;
use tauri::{Theme, Window};

#[cfg(not(target_os = "linux"))]
pub fn name(theme: &Theme) -> &'static str {
    if matches!(theme, Theme::Dark) {
        "dark"
    } else {
        "light"
    }
}
pub fn theme(window: &Window) -> Result<String> {
    #[cfg(not(target_os = "linux"))]
    {
        window
            .theme()
            .map(|theme| name(&theme).to_string())
            .map_err(err)
    }
    #[cfg(target_os = "linux")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let app = window.app_handle();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(linux::current(&app));
            })
            .map_err(err)?;
        rx.recv().map(str::to_string).map_err(err)
    }
}
pub fn watch(app: &tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    linux::watch(app);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}
pub fn changed(window: &Window, theme: &Theme) {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window.emit("pen:theme", name(theme));
    }
    #[cfg(target_os = "linux")]
    {
        let _ = theme;
        linux::publish(&window.app_handle());
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use gtk::traits::SettingsExt;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};
    use zbus::{
        blocking::{Connection, Proxy},
        zvariant::OwnedValue,
    };
    #[derive(Default)]
    pub struct Preference(Mutex<Option<bool>>);
    pub fn current(app: &AppHandle) -> &'static str {
        if let Some(dark) = *app.state::<Preference>().0.lock().unwrap() {
            return if dark { "dark" } else { "light" };
        }
        let dark = gtk::Settings::default()
            .map(|settings| {
                settings.is_gtk_application_prefer_dark_theme()
                    || settings
                        .gtk_theme_name()
                        .map(|name| name.to_ascii_lowercase().contains("dark"))
                        .unwrap_or(false)
            })
            .unwrap_or(false);
        if dark {
            "dark"
        } else {
            "light"
        }
    }
    pub fn publish(app: &AppHandle) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let theme = current(&handle);
            // Linux StatusNotifier/AppIndicator hosts do not apply macOS's
            // template tint. Supply the contrasting artwork explicitly.
            let icon = if theme == "dark" {
                include_bytes!("../../dist/icons/trayLight.png").as_slice()
            } else {
                include_bytes!("../../dist/icons/trayTemplate.png").as_slice()
            };
            let _ = handle.tray_handle().set_icon(tauri::Icon::Raw(icon.to_vec()));
            let _ = handle.emit_all("pen:theme", theme);
        });
    }
    fn update(app: &AppHandle, value: Option<&OwnedValue>) {
        // Read has two variant layers on older portals; downcast_ref unwraps it.
        let mode = value.and_then(|value| value.downcast_ref::<u32>()).copied();
        *app.state::<Preference>().0.lock().unwrap() = match mode {
            Some(1) => Some(true),
            Some(2) => Some(false),
            _ => None,
        };
        publish(app);
    }
    fn portal(app: &AppHandle) -> zbus::Result<()> {
        let connection = Connection::session()?;
        let proxy = Proxy::new(
            &connection,
            "org.freedesktop.portal.Desktop",
            "/org/freedesktop/portal/desktop",
            "org.freedesktop.portal.Settings",
        )?;
        // Subscribe first so a change during the initial read cannot be lost.
        let signals = proxy.receive_signal_with_args(
            "SettingChanged",
            &[(0, "org.freedesktop.appearance"), (1, "color-scheme")],
        )?;
        let value: Option<OwnedValue> = proxy
            .call("Read", &("org.freedesktop.appearance", "color-scheme"))
            .ok();
        update(app, value.as_ref());
        for message in signals {
            if let Ok((_, _, value)) = message.body::<(String, String, OwnedValue)>() {
                update(app, Some(&value));
            }
        }
        Ok(())
    }
    pub fn watch(app: &AppHandle) {
        app.manage(Preference::default());
        publish(app);
        if let Some(settings) = gtk::Settings::default() {
            let handle = app.clone();
            settings.connect_gtk_theme_name_notify(move |_| publish(&handle));
            let handle = app.clone();
            settings.connect_gtk_application_prefer_dark_theme_notify(move |_| publish(&handle));
        }
        let handle = app.clone();
        std::thread::spawn(move || loop {
            let _ = portal(&handle);
            update(&handle, None);
            // Retry only after a portal disconnect/failure; normal operation is event driven.
            std::thread::sleep(std::time::Duration::from_secs(30));
        });
    }
}
