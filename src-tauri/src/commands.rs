//! The commands the frontend can call. Nothing broader: no fs or shell plugin (see build.rs and
//! capabilities/default.json). Errors are user-facing strings.

use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request, Response};

use crate::{files, monitors, omarchy};

/// Connected monitors (physical pixels) from Hyprland.
#[tauri::command]
pub async fn monitors() -> Result<Vec<monitors::Monitor>, String> {
    monitors::list()
}

/// The bytes of a photo the user picked or dropped (the dialog and drag-and-drop give paths).
#[tauri::command]
pub async fn read_file(path: String) -> Result<Response, String> {
    files::read_image(&PathBuf::from(path)).map(Response::new)
}

/// A rendered wallpaper: raw PNG body, headers `x-stem` (percent-encoded source name) and
/// `x-size` (`<W>x<H>`). Returns the absolute path it was saved at.
#[tauri::command]
pub async fn save_png(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the PNG as a raw body".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("");
    let stem = files::percent_decode(header("x-stem"));
    let size = header("x-size")
        .split_once('x')
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .filter(|&(w, h)| (1..=16384).contains(&w) && (1..=16384).contains(&h))
        .ok_or("x-size must be <width>x<height>")?;
    let path = files::save_png(&files::wallpapers_dir()?, &stem, size, bytes)?;
    Ok(path.display().to_string())
}

/// `<png stem>.typist.json` next to a saved wallpaper: the grid and every setting.
#[tauri::command]
pub async fn save_sidecar(png_path: String, json: String) -> Result<String, String> {
    let path = files::save_sidecar(&files::wallpapers_dir()?, &PathBuf::from(png_path), &json)?;
    Ok(path.display().to_string())
}

/// `omarchy theme bg set <path>`, then checks the symlink and `omarchy theme bg current`.
#[tauri::command]
pub async fn set_wallpaper(path: String) -> Result<omarchy::SetResult, String> {
    let file = files::settable(&PathBuf::from(path))?;
    omarchy::set_background(&file)
}

/// Copy a saved wallpaper into `~/.config/omarchy/backgrounds/<theme>/` so it joins the rotation.
#[tauri::command]
pub async fn add_to_theme_backgrounds(path: String) -> Result<String, String> {
    let file = files::inside(&files::wallpapers_dir()?, &PathBuf::from(path))?;
    let dest = files::theme_backgrounds_dir()?.join(omarchy::theme_slug()?);
    Ok(files::copy_unique(&file, &dest)?.display().to_string())
}

/// mode, background, foreground and accent of the current Omarchy theme.
#[tauri::command]
pub async fn theme_colors() -> Result<omarchy::ThemeColors, String> {
    omarchy::theme_colors()
}
