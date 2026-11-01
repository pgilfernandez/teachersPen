fn main() {
    // Tauri links the app's VC runtime statically without applying crt-static to
    // host proc-macros, which must remain dynamically loadable during the build.
    std::env::set_var("STATIC_VCRUNTIME", "true");
    tauri_build::build()
}
