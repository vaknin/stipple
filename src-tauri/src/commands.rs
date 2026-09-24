//! The commands the frontend can call. Nothing broader: no fs or shell plugin (see build.rs and
//! capabilities/default.json). Errors are user-facing strings.

use std::path::PathBuf;

use serde::Serialize;
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

/// `<png stem>.stipple.json` next to a saved wallpaper (in the output folder or the theme
/// backgrounds): the grid and every setting. Replaces an existing one (a motion change).
#[tauri::command]
pub async fn save_sidecar(png_path: String, json: String) -> Result<String, String> {
    let png = files::wallpaper_png(&files::wallpaper_roots()?, &PathBuf::from(png_path))?;
    let path = files::save_sidecar(&png, &json)?;
    Ok(path.display().to_string())
}

/// The dot field of a saved Dots wallpaper, for the animated wallpaper: raw RGB body (3 bytes per
/// dot), headers `x-png-path` (percent-encoded path of the wallpaper) and `x-size` (`<W>x<H>`).
/// Written as `<dir>/.stipple/<stem>/field.png`.
#[tauri::command]
pub async fn save_field(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the dot field as a raw body".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("");
    let png = PathBuf::from(files::percent_decode(header("x-png-path")));
    let png = files::wallpaper_png(&files::wallpaper_roots()?, &png)?;
    let size = header("x-size")
        .split_once('x')
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .ok_or("x-size must be <width>x<height>")?;
    let path = files::save_field(&png, size, bytes)?;
    Ok(path.display().to_string())
}

#[derive(Serialize)]
pub struct Sidecar {
    json: String,
    /// The PNG is in the output folder or the theme backgrounds, so Save may update it in place.
    editable: bool,
}

/// The sidecar of a PNG the user opened, if it has one (reopening a Stipple wallpaper).
#[tauri::command]
pub async fn read_sidecar(path: String) -> Result<Option<Sidecar>, String> {
    let png = PathBuf::from(path);
    let editable = files::wallpaper_png(&files::wallpaper_roots()?, &png).is_ok();
    Ok(files::read_sidecar(&png)?.map(|json| Sidecar { json, editable }))
}

/// `omarchy theme bg set <path>`, then checks the symlink and `omarchy theme bg current`.
#[tauri::command]
pub async fn set_wallpaper(path: String) -> Result<omarchy::SetResult, String> {
    let file = files::settable(&PathBuf::from(path))?;
    omarchy::set_background(&file)
}

/// Copy a saved wallpaper into `~/.config/omarchy/backgrounds/<theme>/` so it joins the rotation,
/// with its sidecar and dot field (the animated wallpaper plays there too).
#[tauri::command]
pub async fn add_to_theme_backgrounds(path: String) -> Result<String, String> {
    let file = files::inside(&files::wallpapers_dir()?, &PathBuf::from(path))?;
    let dest = files::theme_backgrounds_dir()?.join(omarchy::theme_slug()?);
    Ok(files::copy_wallpaper(&file, &dest)?.display().to_string())
}

/// mode, background, foreground and accent of the current Omarchy theme.
#[tauri::command]
pub async fn theme_colors() -> Result<omarchy::ThemeColors, String> {
    omarchy::theme_colors()
}
