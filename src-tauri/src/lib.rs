//! Typist Wall: photo -> text-art wallpaper for Omarchy. The art is made in the webview by the
//! vendored Typist engine; this side reads photos, writes wallpapers and talks to Hyprland and
//! Omarchy.

mod commands;
mod files;
mod monitors;
mod omarchy;
mod sys;

pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::monitors,
            commands::read_file,
            commands::save_png,
            commands::save_sidecar,
            commands::set_wallpaper,
            commands::add_to_theme_backgrounds,
            commands::theme_colors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Typist Wall");
}
