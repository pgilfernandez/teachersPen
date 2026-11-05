//! Offline, per-user installation of the exact extension shipped in the app.
use serde_json::{json, Value};
use std::{ffi::OsString, fs, path::{Path, PathBuf}, process::Command, sync::Mutex};
use tauri::Manager;

const UUID: &str = "teacherspen@pgilfernandez.github.io";
const ARCHIVE: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist/gnome/teacherspen@pgilfernandez.github.io.shell-extension.zip"));
const METADATA: &str = include_str!("../../extensions/gnome/metadata.json");
static INSTALLING: Mutex<()> = Mutex::new(());
type Result<T> = std::result::Result<T, String>;

fn data_home(app: &tauri::AppHandle) -> Result<PathBuf> {
    // Match the host desktop, even when launched from VS Code's Snap terminal.
    if let Some(dir) = std::env::var_os("XDG_DATA_HOME") {
        if Path::new(&dir).is_absolute() && !dir.to_string_lossy().contains("/snap/") { return Ok(PathBuf::from(dir)); }
    }
    app.path().home_dir().map(|home| home.join(".local/share")).map_err(|e| e.to_string())
}

fn external_paths(name: &str, value: &str, app_dir: Option<&Path>) -> String {
    let separator = if name == "LD_PRELOAD" { ' ' } else { ':' };
    value.split(|c: char| c == ':' || (name == "LD_PRELOAD" && c.is_whitespace()))
        .filter(|part| !part.is_empty() && !part.contains("/snap/")
            && !app_dir.map(|dir| Path::new(part).starts_with(dir)).unwrap_or(false))
        .collect::<Vec<_>>().join(&separator.to_string())
}

fn host_command(program: &str, data: &Path) -> Command {
    let mut command = Command::new(program);
    let app_dir = std::env::var_os("APPDIR").map(PathBuf::from);
    for (key, value) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("GTK_") || name.starts_with("GDK_") || name.starts_with("GIO_")
            || name == "GSETTINGS_SCHEMA_DIR" || name == "GI_TYPELIB_PATH" {
            command.env_remove(&key);
        }
        if ["LD_LIBRARY_PATH", "LD_PRELOAD", "XDG_DATA_DIRS", "PATH"].contains(&name.as_ref()) {
            let filtered = external_paths(&name, &value.to_string_lossy(), app_dir.as_deref());
            if filtered.is_empty() { command.env_remove(&key); } else { command.env(&key, filtered); }
        }
    }
    for name in ["APPDIR", "APPIMAGE", "ARGV0"] { command.env_remove(name); }
    command.env("XDG_DATA_HOME", data);
    command
}

fn supported(version: &str) -> bool {
    let metadata: Value = serde_json::from_str(METADATA).expect("valid bundled extension metadata");
    let major = version.split('.').next().unwrap_or("");
    metadata["shell-version"].as_array().unwrap().iter().any(|entry| entry.as_str() == Some(major))
}

pub fn status(app: &tauri::AppHandle) -> Result<Value> {
    let data = data_home(app)?;
    let version = host_command("gnome-shell", &data).arg("--version").output().ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|text| text.split_whitespace().find(|part| part.starts_with(|c: char| c.is_ascii_digit())).map(str::to_owned));
    let installed: Option<Value> = fs::read(data.join("gnome-shell/extensions").join(UUID).join("metadata.json"))
        .ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let bundled: Value = serde_json::from_str(METADATA).map_err(|e| e.to_string())?;
    Ok(json!({"shellVersion":version,"supported":version.as_deref().map(supported).unwrap_or(false),
        "installedVersion":installed.and_then(|value| value.get("version").cloned()),"bundledVersion":bundled["version"]}))
}

struct CommandResult { success: bool, error: String }

fn install_archive(cache: &Path, data: &Path, run: impl Fn(&[OsString], &Path) -> Result<CommandResult>) -> Result<Value> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let temporary = cache.join(format!("extension-install-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&temporary).map_err(|e| e.to_string())?;
    let result = (|| {
        let archive = temporary.join(format!("{UUID}.shell-extension.zip"));
        fs::write(&archive, ARCHIVE).map_err(|e| e.to_string())?;
        let installed = run(&["install".into(), "--force".into(), archive.into_os_string()], data)?;
        if !installed.success { return Err(format!("gnome-extensions install: {}", installed.error)); }
        // A successful install may not be discovered until the next login. Do
        // not report it as a failed installation if enabling is deferred.
        let enabled = run(&["enable".into(), UUID.into()], data);
        Ok(json!({"installed":true,"enabled":enabled.as_ref().map(|result| result.success).unwrap_or(false),"needsLogout":true}))
    })();
    let _ = fs::remove_dir_all(&temporary);
    result
}

pub fn install(app: &tauri::AppHandle) -> Result<Value> {
    let _guard = INSTALLING.try_lock().map_err(|_| "Installation already in progress".to_string())?;
    if status(app)?["supported"] != true {
        return Err("La extensión incluida es compatible con GNOME 46 y 50.".into());
    }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    install_archive(&cache, &data_home(app)?, |args, data| {
        let output = host_command("gnome-extensions", data).args(args).output().map_err(|e| format!("gnome-extensions: {e}"))?;
        Ok(CommandResult {success: output.status.success(), error: String::from_utf8_lossy(&output.stderr).trim().to_string()})
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    #[test]
    fn desktop_tools_do_not_load_appimage_or_snap_libraries() {
        assert_eq!(external_paths("LD_LIBRARY_PATH", "/tmp/.mount_teachers/usr/lib:/snap/core20/lib:/usr/lib", Some(Path::new("/tmp/.mount_teachers"))), "/usr/lib");
        assert_eq!(external_paths("PATH", "/tmp/.mount_teachers/usr/bin:/usr/local/bin:/usr/bin", Some(Path::new("/tmp/.mount_teachers"))), "/usr/local/bin:/usr/bin");
        assert_eq!(external_paths("LD_PRELOAD", "/snap/core20/lib/a.so /opt/helper.so", None), "/opt/helper.so");
    }
    #[test]
    fn supported_versions_preserve_46_and_include_50_only() {
        assert!(supported("46.0")); assert!(supported("50.1"));
        assert!(!supported("51.0")); assert!(!supported(""));
    }
    #[test]
    fn offline_install_cleans_archive_and_reports_deferred_enable() {
        let cache = std::env::temp_dir().join(format!("teacherspen-installer-test-{}", std::process::id()));
        let calls = RefCell::new(Vec::new());
        let result = install_archive(&cache, Path::new("/tmp/desktop-data"), |args, data| {
            assert_eq!(data, Path::new("/tmp/desktop-data"));
            calls.borrow_mut().push(args.to_vec());
            if args[0] == "install" {
                assert_eq!(args[1], "--force");
                assert_eq!(fs::read(Path::new(&args[2])).unwrap(), ARCHIVE);
                Ok(CommandResult {success:true,error:String::new()})
            } else {
                assert_eq!(args, &[OsString::from("enable"), OsString::from(UUID)]);
                Ok(CommandResult {success:false,error:"not discovered yet".into()})
            }
        }).unwrap();
        assert_eq!(result["installed"], true); assert_eq!(result["needsLogout"], true);
        assert_eq!(result["enabled"], false); assert_eq!(calls.borrow().len(), 2);
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        let failure = install_archive(&cache, Path::new("/tmp/desktop-data"), |args, _| {
            assert_eq!(args[0], "install");
            Ok(CommandResult {success:false,error:"permission denied".into()})
        });
        assert!(failure.unwrap_err().contains("permission denied"));
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        fs::remove_dir(&cache).unwrap();
    }
}
