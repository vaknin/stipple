//! Reading source photos and writing wallpapers. Every write creates a new file: nothing is ever
//! overwritten except a wallpaper's own sidecar and dot field, and the app's session file.
//!
//! A wallpaper `<dir>/<stem>.png` has its settings in `<dir>/<stem>.stipple.json` and, for Dots, its
//! dot field (for the animated wallpaper) in `<dir>/.stipple/<stem>/field.png`: hidden, so
//! `omarchy theme bg next` (which rotates every image in the folder) never shows it.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::sys::home;

pub const MAX_READ: u64 = 64 * 1024 * 1024;
pub const MAX_PNG: usize = 256 * 1024 * 1024;
pub const MAX_SIDECAR: usize = 32 * 1024 * 1024;
/// Largest dot field side (2 x 4096 columns, layout.ts COLS_MAX).
pub const MAX_FIELD: u32 = 8192;
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "cr3"];
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// `~/Pictures/Wallpapers`
pub fn wallpapers_dir() -> Result<PathBuf, String> {
    Ok(home()?.join("Pictures/Wallpapers"))
}

/// `~/.config/omarchy/backgrounds`
pub fn theme_backgrounds_dir() -> Result<PathBuf, String> {
    Ok(home()?.join(".config/omarchy/backgrounds"))
}

/// Where saved wallpapers live: the output folder and the theme backgrounds.
pub fn wallpaper_roots() -> Result<Vec<PathBuf>, String> {
    Ok(vec![wallpapers_dir()?, theme_backgrounds_dir()?])
}

fn ext_of(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

/// A photo to convert: PNG, JPEG or WebP, at most 64 MB, or a Canon CR3 (its camera JPEG).
pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let ext = ext_of(path);
    if !ext.as_deref().is_some_and(|e| IMAGE_EXTS.contains(&e)) {
        return Err(format!("{} is not a PNG, JPEG, WebP or CR3 file", path.display()));
    }
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if ext.as_deref() == Some("cr3") {
        return crate::raw::cr3_jpeg(path);
    }
    if meta.len() > MAX_READ {
        return Err(format!("{} is larger than 64 MB", path.display()));
    }
    fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// `%XX` escapes decoded (the frontend sends header values through encodeURIComponent).
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && let (Some(hi), Some(lo)) = (hex(b[i + 1]), hex(b[i + 2]))
        {
            out.push(hi << 4 | lo);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A safe file-name stem: letters, digits, `_` and `.` kept (any script), everything else one
/// dash; no leading dot or dash; at most 80 characters.
pub fn sanitize_stem(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_alphanumeric() || ch == '_' || ch == '.' {
            out.push(ch);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches(|c| c == '-' || c == '.').chars().take(80).collect();
    let out = out.trim_end_matches(['-', '.']).to_string();
    if out.is_empty() { "wallpaper".into() } else { out }
}

/// Width and height from a PNG's IHDR chunk.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != PNG_MAGIC || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((w, h))
}

/// Create `<dir>/<base><ext>`, or `<base>-2<ext>`, `-3`… if taken (atomic: create_new).
fn create_unique(dir: &Path, base: &str, ext: &str) -> Result<(PathBuf, File), String> {
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for n in 1..10_000 {
        let name = if n == 1 {
            format!("{base}{ext}")
        } else {
            format!("{base}-{n}{ext}")
        };
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(f) => return Ok((path, f)),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
    }
    Err(format!("too many files named {base}{ext} in {}", dir.display()))
}

fn write_all(path: &Path, mut f: File, bytes: &[u8]) -> Result<(), String> {
    let res = f.write_all(bytes).and_then(|()| f.sync_all());
    if let Err(e) = res {
        let _ = fs::remove_file(path);
        return Err(format!("{}: {e}", path.display()));
    }
    Ok(())
}

/// Save a rendered wallpaper as `<dir>/<stem>-stipple-<W>x<H>.png` (suffixed on collision). The
/// bytes must be a PNG of exactly `size`.
pub fn save_png(dir: &Path, stem: &str, size: (u32, u32), bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.len() > MAX_PNG {
        return Err("the image is larger than 256 MB".into());
    }
    match png_size(bytes) {
        None => return Err("the data is not a PNG".into()),
        Some(s) if s != size => {
            return Err(format!("the PNG is {}x{}, expected {}x{}", s.0, s.1, size.0, size.1));
        }
        Some(_) => {}
    }
    let base = format!("{}-stipple-{}x{}", sanitize_stem(stem), size.0, size.1);
    let (path, f) = create_unique(dir, &base, ".png")?;
    write_all(&path, f, bytes)?;
    Ok(path)
}

/// A path that must be an existing file directly inside `dir`.
pub fn inside(dir: &Path, path: &Path) -> Result<PathBuf, String> {
    let dir = dir.canonicalize().map_err(|e| format!("{}: {e}", dir.display()))?;
    let p = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    if p.parent() != Some(dir.as_path()) || !p.is_file() {
        return Err(format!("{} is not a file in {}", p.display(), dir.display()));
    }
    Ok(p)
}

/// Replace `path` with `bytes` in one step (a temporary file in the same folder, then a rename),
/// so the shell plugin watching it never reads half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("bad path")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("bad file name")?;
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let f = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    write_all(&tmp, f, bytes)?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

fn png_stem(png: &Path) -> Result<&str, String> {
    if ext_of(png).as_deref() != Some("png") {
        return Err(format!("{} is not a PNG", png.display()));
    }
    png.file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "bad file name".into())
}

/// `<dir>/<stem>.stipple.json` for `<dir>/<stem>.png`.
pub fn sidecar_path(png: &Path) -> Result<PathBuf, String> {
    Ok(png.with_file_name(format!("{}.stipple.json", png_stem(png)?)))
}

/// The textures the animated wallpaper reads: the Dots field, the Letters Columns keyframes and
/// their glyph atlas, and the night's coverage (the art drawn the other way round, for an hour
/// whose colours have crossed over).
pub const MOTION_FILES: &[&str] = &["field", "frames", "glyphs", "night"];

/// `<dir>/.stipple/<stem>/<name>.png` for `<dir>/<stem>.png`, `name` one of MOTION_FILES.
pub fn motion_path(png: &Path, name: &str) -> Result<PathBuf, String> {
    if !MOTION_FILES.contains(&name) {
        return Err(format!("{name} is not a motion file"));
    }
    let stem = png_stem(png)?;
    let dir = png.parent().ok_or("bad path")?;
    Ok(dir.join(".stipple").join(stem).join(format!("{name}.png")))
}


/// A wallpaper PNG this app may write beside: an existing `.png` file somewhere under one of
/// `roots` (the output folder, the theme backgrounds). Returns the canonical path.
pub fn wallpaper_png(roots: &[PathBuf], path: &Path) -> Result<PathBuf, String> {
    let p = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    let allowed = roots
        .iter()
        .filter_map(|d| d.canonicalize().ok())
        .any(|d| p.starts_with(&d));
    if !allowed || !p.is_file() || ext_of(&p).as_deref() != Some("png") {
        return Err(format!("{} is not a saved wallpaper", p.display()));
    }
    Ok(p)
}

/// Write the sidecar of a wallpaper PNG (replacing it: motion changes rewrite only this). The
/// JSON must parse.
pub fn save_sidecar(png: &Path, json: &str) -> Result<PathBuf, String> {
    if json.len() > MAX_SIDECAR {
        return Err("the settings file is larger than 32 MB".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("invalid JSON: {e}"))?;
    let path = sidecar_path(png)?;
    write_atomic(&path, json.as_bytes())?;
    Ok(path)
}

/// The sidecar of a PNG, if it has one.
pub fn read_sidecar(png: &Path) -> Result<Option<String>, String> {
    let path = sidecar_path(png)?;
    match fs::metadata(&path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
        Ok(m) if m.len() > MAX_SIDECAR as u64 => return Err(format!("{} is larger than 32 MB", path.display())),
        Ok(_) => {}
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Largest session file: settings only, no grid.
pub const MAX_SESSION: usize = 1024 * 1024;

/// `$XDG_STATE_HOME/stipple/session.json` (`~/.local/state/stipple/session.json` by default): the
/// photo and settings the app was last left with, to resume there.
pub fn session_path() -> Result<PathBuf, String> {
    let state = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute());
    Ok(match state {
        Some(dir) => dir,
        None => home()?.join(".local/state"),
    }
    .join("stipple/session.json"))
}

/// Replace the session file (atomically: a crash never leaves half of one).
pub fn save_session(path: &Path, json: &str) -> Result<(), String> {
    if json.len() > MAX_SESSION {
        return Err("the session is larger than 1 MB".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("invalid JSON: {e}"))?;
    write_atomic(path, json.as_bytes())
}

/// The session file, if there is one.
pub fn read_session(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
        Ok(m) if m.len() > MAX_SESSION as u64 => return Err(format!("{} is larger than 1 MB", path.display())),
        Ok(_) => {}
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Encode an RGB dot field (3 bytes per dot, row-major) as a PNG: 8 bits, no colour profile, so
/// the plugin's shader reads back exactly these bytes.
pub fn encode_field(size: (u32, u32), rgb: &[u8]) -> Result<Vec<u8>, String> {
    let (w, h) = size;
    if !(1..=MAX_FIELD).contains(&w) || !(1..=MAX_FIELD).contains(&h) {
        return Err(format!("the dot field is {w}x{h}, at most {MAX_FIELD} a side"));
    }
    if rgb.len() != w as usize * h as usize * 3 {
        return Err(format!(
            "the dot field has {} bytes, expected {}",
            rgb.len(),
            w as usize * h as usize * 3
        ));
    }
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, w, h);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    let mut writer = enc.write_header().map_err(|e| format!("field.png: {e}"))?;
    writer.write_image_data(rgb).map_err(|e| format!("field.png: {e}"))?;
    writer.finish().map_err(|e| format!("field.png: {e}"))?;
    Ok(out)
}

/// Write one motion texture of a wallpaper PNG (replacing it): `name` is one of MOTION_FILES.
pub fn save_field(png: &Path, name: &str, size: (u32, u32), rgb: &[u8]) -> Result<PathBuf, String> {
    let path = motion_path(png, name)?;
    let bytes = encode_field(size, rgb)?;
    write_atomic(&path, &bytes)?;
    Ok(path)
}

/// Remove the motion textures of a wallpaper PNG that are not in `keep` (a style or effect that
/// no longer uses them). Missing files are fine. Folders left empty go too.
pub fn remove_motion_files(png: &Path, keep: &[String]) -> Result<(), String> {
    let mut dir = None;
    for name in MOTION_FILES {
        let path = motion_path(png, name)?;
        dir = path.parent().map(Path::to_path_buf);
        if keep.iter().any(|k| k == name) {
            continue;
        }
        match fs::remove_file(&path) {
            Err(e) if e.kind() != ErrorKind::NotFound => return Err(format!("{}: {e}", path.display())),
            _ => {}
        }
    }
    // remove_dir only removes an empty folder: `<stem>`, then `.stipple`
    if let Some(dir) = dir
        && fs::remove_dir(&dir).is_ok()
        && let Some(up) = dir.parent()
    {
        let _ = fs::remove_dir(up);
    }
    Ok(())
}

/// Copy a file into `dest_dir` under its own name (suffixed on collision).
pub fn copy_unique(src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let stem = src.file_stem().and_then(|s| s.to_str()).ok_or("bad file name")?;
    let ext = ext_of(src).map(|e| format!(".{e}")).unwrap_or_default();
    let bytes = fs::read(src).map_err(|e| format!("{}: {e}", src.display()))?;
    let (path, f) = create_unique(dest_dir, stem, &ext)?;
    write_all(&path, f, &bytes)?;
    Ok(path)
}

/// Copy a wallpaper into `dest_dir` with its sidecar and motion textures, under the (possibly suffixed)
/// new name. The copied sidecar's `image.file` names the copy.
pub fn copy_wallpaper(png: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let dest = copy_unique(png, dest_dir)?;
    if let Some(json) = read_sidecar(png)? {
        let json = match serde_json::from_str::<serde_json::Value>(&json) {
            Ok(mut v) => {
                if let Some(image) = v.get_mut("image").and_then(|i| i.as_object_mut()) {
                    let name = dest.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                    image.insert("file".into(), name.into());
                }
                serde_json::to_string(&v).map_err(|e| e.to_string())?
            }
            Err(_) => json,
        };
        save_sidecar(&dest, &json)?;
    }
    for name in MOTION_FILES {
        let src = motion_path(png, name)?;
        if src.is_file() {
            let bytes = fs::read(&src).map_err(|e| format!("{}: {e}", src.display()))?;
            write_atomic(&motion_path(&dest, name)?, &bytes)?;
        }
    }
    Ok(dest)
}

/// Files a wallpaper may be set from: our own output folder or the theme backgrounds.
pub fn settable(path: &Path) -> Result<PathBuf, String> {
    if !ext_of(path).is_some_and(|e| IMAGE_EXTS.contains(&e.as_str())) {
        return Err(format!("{} is not a PNG, JPEG or WebP file", path.display()));
    }
    let p = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    let ok_dirs = [wallpapers_dir()?, theme_backgrounds_dir()?];
    let allowed = ok_dirs
        .iter()
        .filter_map(|d| d.canonicalize().ok())
        .any(|d| p.starts_with(&d));
    if !allowed || !p.is_file() {
        return Err(format!("{} is not a saved wallpaper", p.display()));
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_round_trip() {
        let d = tmp("session");
        let path = d.join("stipple/session.json");
        assert_eq!(read_session(&path).unwrap(), None);
        save_session(&path, r#"{"a":1}"#).unwrap();
        assert_eq!(read_session(&path).unwrap().as_deref(), Some(r#"{"a":1}"#));
        save_session(&path, r#"{"a":2}"#).unwrap();
        assert_eq!(read_session(&path).unwrap().as_deref(), Some(r#"{"a":2}"#));
        assert!(save_session(&path, "{not json").is_err());
        assert!(save_session(&path, &format!(r#""{}""#, "x".repeat(MAX_SESSION))).is_err());
        // a failed write leaves the last session and no temporary file
        assert_eq!(read_session(&path).unwrap().as_deref(), Some(r#"{"a":2}"#));
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&d);
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("stipple-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = PNG_MAGIC.to_vec();
        b.extend([0, 0, 0, 13]);
        b.extend(b"IHDR");
        b.extend(w.to_be_bytes());
        b.extend(h.to_be_bytes());
        b.extend([8, 6, 0, 0, 0]);
        b
    }

    #[test]
    fn stems() {
        assert_eq!(sanitize_stem("cat"), "cat");
        assert_eq!(sanitize_stem("My Photo (1)"), "My-Photo-1");
        assert_eq!(sanitize_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize_stem(".hidden"), "hidden");
        assert_eq!(sanitize_stem("  "), "wallpaper");
        assert_eq!(sanitize_stem("צילום-חתול"), "צילום-חתול");
        assert_eq!(sanitize_stem(&"a".repeat(200)).len(), 80);
        assert_eq!(percent_decode("My%20Photo%20%281%29"), "My Photo (1)");
        assert_eq!(percent_decode("%D7%A6"), "צ");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn saves_never_overwrite() {
        let d = tmp("save");
        let a = save_png(&d, "cat", (1920, 1080), &png(1920, 1080)).unwrap();
        let b = save_png(&d, "cat", (1920, 1080), &png(1920, 1080)).unwrap();
        let c = save_png(&d, "cat", (1920, 1080), &png(1920, 1080)).unwrap();
        assert_eq!(a.file_name().unwrap(), "cat-stipple-1920x1080.png");
        assert_eq!(b.file_name().unwrap(), "cat-stipple-1920x1080-2.png");
        assert_eq!(c.file_name().unwrap(), "cat-stipple-1920x1080-3.png");
        assert!(save_png(&d, "cat", (1920, 1080), &png(1920, 1079)).is_err());
        assert!(save_png(&d, "cat", (1920, 1080), b"not a png at all, not at all").is_err());

        let roots = [d.clone()];
        let b = wallpaper_png(&roots, &b).unwrap();
        let s = save_sidecar(&b, "{\"v\":1}").unwrap();
        assert_eq!(s.file_name().unwrap(), "cat-stipple-1920x1080-2.stipple.json");
        assert_eq!(read_sidecar(&b).unwrap().as_deref(), Some("{\"v\":1}"));
        save_sidecar(&b, "{\"v\":2}").unwrap();
        assert_eq!(read_sidecar(&b).unwrap().as_deref(), Some("{\"v\":2}"));
        assert!(save_sidecar(&b, "{nope").is_err());
        assert_eq!(read_sidecar(&a).unwrap(), None);
        assert!(wallpaper_png(&roots, Path::new("/etc/hostname")).is_err());
        assert!(wallpaper_png(&roots, &s).is_err());
        // no temporary files left behind
        let names: Vec<_> = fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert!(
            names.iter().all(|n| !n.to_string_lossy().ends_with(".tmp")),
            "{names:?}"
        );

        let other = tmp("copy");
        let c1 = copy_unique(&a, &other).unwrap();
        let c2 = copy_unique(&a, &other).unwrap();
        assert_eq!(c1.file_name().unwrap(), "cat-stipple-1920x1080.png");
        assert_eq!(c2.file_name().unwrap(), "cat-stipple-1920x1080-2.png");
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&other);
    }

    #[test]
    fn dot_fields() {
        let d = tmp("field");
        let a = save_png(&d, "cat", (4, 4), &png(4, 4)).unwrap();
        let rgb: Vec<u8> = (0..6 * 8 * 3).map(|i| (i * 37 % 256) as u8).collect();
        let f = save_field(&a, "field", (6, 8), &rgb).unwrap();
        assert_eq!(f, d.join(".stipple/cat-stipple-4x4/field.png"));
        let dec = png::Decoder::new(std::io::BufReader::new(File::open(&f).unwrap()));
        let mut r = dec.read_info().unwrap();
        let mut buf = vec![0; r.output_buffer_size().unwrap()];
        let info = r.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height, info.color_type), (6, 8, png::ColorType::Rgb));
        assert_eq!(&buf[..info.buffer_size()], &rgb[..]);
        assert!(save_field(&a, "field", (6, 8), &rgb[1..]).is_err());
        assert!(save_field(&a, "field", (0, 8), &[]).is_err());
        assert!(save_field(&a, "field", (MAX_FIELD + 1, 1), &vec![0; (MAX_FIELD as usize + 1) * 3]).is_err());
        assert!(save_field(&a, "../x", (6, 8), &rgb).is_err());
        let fr = save_field(&a, "frames", (6, 8), &rgb).unwrap();
        assert_eq!(fr, d.join(".stipple/cat-stipple-4x4/frames.png"));
        let gl = save_field(&a, "glyphs", (6, 8), &rgb).unwrap();
        let ni = save_field(&a, "night", (6, 8), &rgb).unwrap();
        assert_eq!(ni, d.join(".stipple/cat-stipple-4x4/night.png"));
        remove_motion_files(&a, &["field".into(), "frames".into()]).unwrap();
        assert!(f.exists() && fr.exists() && !gl.exists() && !ni.exists());
        remove_motion_files(&a, &["field".into(), "frames".into()]).unwrap();

        // a copy takes its sidecar and field along under the new name
        save_sidecar(&a, "{\"image\":{\"file\":\"cat-stipple-4x4.png\",\"width\":4},\"v\":1}").unwrap();
        let theme = tmp("field-theme");
        copy_unique(&a, &theme).unwrap();
        let c = copy_wallpaper(&a, &theme).unwrap();
        assert_eq!(c.file_name().unwrap(), "cat-stipple-4x4-2.png");
        let v: serde_json::Value = serde_json::from_str(&read_sidecar(&c).unwrap().unwrap()).unwrap();
        assert_eq!(v["image"]["file"], "cat-stipple-4x4-2.png");
        assert_eq!(v["image"]["width"], 4);
        assert_eq!(fs::read(motion_path(&c, "field").unwrap()).unwrap(), fs::read(&f).unwrap());
        assert_eq!(fs::read(motion_path(&c, "frames").unwrap()).unwrap(), fs::read(&fr).unwrap());
        assert!(!motion_path(&c, "glyphs").unwrap().exists());
        assert_eq!(
            motion_path(&c, "field").unwrap(),
            theme.join(".stipple/cat-stipple-4x4-2/field.png")
        );
        // a plain PNG copies alone
        let plain = save_png(&d, "dog", (4, 4), &png(4, 4)).unwrap();
        let p = copy_wallpaper(&plain, &theme).unwrap();
        assert_eq!(read_sidecar(&p).unwrap(), None);
        assert!(!motion_path(&p, "field").unwrap().exists());
        // removing every texture removes the emptied folders
        remove_motion_files(&c, &[]).unwrap();
        assert!(!theme.join(".stipple").exists());
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&theme);
    }

    #[test]
    fn reads_only_images() {
        let d = tmp("read");
        let p = d.join("x.PNG");
        fs::write(&p, png(4, 4)).unwrap();
        assert_eq!(read_image(&p).unwrap().len(), 29);
        let t = d.join("x.txt");
        fs::write(&t, "hi").unwrap();
        assert!(read_image(&t).is_err());
        assert!(read_image(&d.join("missing.png")).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
