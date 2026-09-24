//! Reading source photos and writing wallpapers. Every write creates a new file: nothing is ever
//! overwritten except a wallpaper's own sidecar.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::sys::home;

pub const MAX_READ: u64 = 64 * 1024 * 1024;
pub const MAX_PNG: usize = 256 * 1024 * 1024;
pub const MAX_SIDECAR: usize = 32 * 1024 * 1024;
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp"];
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// `~/Pictures/Wallpapers`
pub fn wallpapers_dir() -> Result<PathBuf, String> {
    Ok(home()?.join("Pictures/Wallpapers"))
}

/// `~/.config/omarchy/backgrounds`
pub fn theme_backgrounds_dir() -> Result<PathBuf, String> {
    Ok(home()?.join(".config/omarchy/backgrounds"))
}

fn ext_of(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

/// A photo to convert: PNG, JPEG or WebP, at most 64 MB.
pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    if !ext_of(path).is_some_and(|e| IMAGE_EXTS.contains(&e.as_str())) {
        return Err(format!("{} is not a PNG, JPEG or WebP file", path.display()));
    }
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
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

/// Save a rendered wallpaper as `<dir>/<stem>-typist-<W>x<H>.png` (suffixed on collision). The
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
    let base = format!("{}-typist-{}x{}", sanitize_stem(stem), size.0, size.1);
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

/// Write `<png stem>.typist.json` next to a saved wallpaper. The JSON must parse.
pub fn save_sidecar(dir: &Path, png: &Path, json: &str) -> Result<PathBuf, String> {
    let png = inside(dir, png)?;
    if ext_of(&png).as_deref() != Some("png") {
        return Err("the sidecar belongs next to a PNG".into());
    }
    if json.len() > MAX_SIDECAR {
        return Err("the settings file is larger than 32 MB".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("invalid JSON: {e}"))?;
    let stem = png.file_stem().and_then(|s| s.to_str()).ok_or("bad file name")?;
    let path = png.with_file_name(format!("{stem}.typist.json"));
    fs::write(&path, json).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
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

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("typist-wall-test-{}-{name}", std::process::id()));
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
        assert_eq!(a.file_name().unwrap(), "cat-typist-1920x1080.png");
        assert_eq!(b.file_name().unwrap(), "cat-typist-1920x1080-2.png");
        assert_eq!(c.file_name().unwrap(), "cat-typist-1920x1080-3.png");
        assert!(save_png(&d, "cat", (1920, 1080), &png(1920, 1079)).is_err());
        assert!(save_png(&d, "cat", (1920, 1080), b"not a png at all, not at all").is_err());

        let s = save_sidecar(&d, &b, "{\"v\":1}").unwrap();
        assert_eq!(s.file_name().unwrap(), "cat-typist-1920x1080-2.typist.json");
        assert!(save_sidecar(&d, &b, "{nope").is_err());
        assert!(save_sidecar(&d, Path::new("/etc/hostname"), "{}").is_err());

        let other = tmp("copy");
        let c1 = copy_unique(&a, &other).unwrap();
        let c2 = copy_unique(&a, &other).unwrap();
        assert_eq!(c1.file_name().unwrap(), "cat-typist-1920x1080.png");
        assert_eq!(c2.file_name().unwrap(), "cat-typist-1920x1080-2.png");
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&other);
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
