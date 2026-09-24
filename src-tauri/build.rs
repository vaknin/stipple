// The app manifest lists every command the frontend may call. Each gets an `allow-<command>`
// permission, and capabilities/default.json grants exactly those: no wildcard, no fs/shell plugin.
const COMMANDS: &[&str] = &[
    "monitors",
    "read_file",
    "save_png",
    "save_sidecar",
    "save_field",
    "remove_motion_files",
    "read_sidecar",
    "save_session",
    "read_session",
    "set_wallpaper",
    "add_to_theme_backgrounds",
    "theme_colors",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
