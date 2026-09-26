// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's GBM/EGL teardown races at exit and crashes WebKitWebProcess on window close
    // (SIGSEGV in libgbm -> Mesa, or a heap abort). Leaving the DMA-BUF renderer off avoids that path.
    // Kept overridable: set WEBKIT_DISABLE_DMABUF_RENDERER=0 to get it back.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: nothing else is running yet; this is before any thread is spawned.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    stipple_lib::run();
}
