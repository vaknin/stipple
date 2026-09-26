//! Stipple: photo -> text-art wallpaper for Omarchy. The art is made in the webview by the
//! vendored Typist engine; this side reads photos, writes wallpapers and talks to Hyprland and
//! Omarchy.

mod commands;
mod files;
mod launch;
mod monitors;
mod omarchy;
mod raw;
mod sys;

pub fn run() {
    let (launch_path, listener) = launch::forward_or_listen();
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(tauri_plugin_dialog::init())
        .manage(launch::LaunchPath(std::sync::Mutex::new(launch_path)))
        .setup(move |app| {
            if let Some(listener) = listener {
                launch::serve(app.handle().clone(), listener);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::monitors,
            commands::read_file,
            commands::save_png,
            commands::save_sidecar,
            commands::save_field,
            commands::remove_motion_files,
            commands::read_sidecar,
            commands::save_session,
            commands::read_session,
            commands::set_wallpaper,
            commands::theme_colors,
            commands::sun_location,
            commands::use_stipple_theme,
            launch::take_launch_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stipple");
}
