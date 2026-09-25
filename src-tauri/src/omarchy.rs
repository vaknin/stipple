//! Omarchy integration: the `omarchy` CLI, the current-background symlink, the theme.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::sys::{find_in_path, home, is_executable, run};

/// `~/.local/state/omarchy/current`
pub fn state_dir() -> Result<PathBuf, String> {
    Ok(home()?.join(".local/state/omarchy/current"))
}

/// The `omarchy` CLI. Its own bin dir first ($OMARCHY_PATH/bin, then the packaged location),
/// PATH last: an app started from the launcher does not have /usr/share/omarchy/bin on PATH, and
/// that directory also holds the helper scripts `omarchy theme bg set` calls.
pub fn omarchy_bin() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(p) = std::env::var_os("OMARCHY_PATH").filter(|p| !p.is_empty()) {
        candidates.push(PathBuf::from(p).join("bin/omarchy"));
    }
    candidates.push(PathBuf::from("/usr/share/omarchy/bin/omarchy"));
    candidates.extend(find_in_path("omarchy"));
    candidates
        .into_iter()
        .find(|p| is_executable(p))
        .ok_or_else(|| "the omarchy command was not found (is this Omarchy?)".to_string())
}

fn omarchy(args: &[&str]) -> Result<String, String> {
    omarchy_with(args, &[])
}

fn omarchy_with(args: &[&str], env: &[(&str, &OsStr)]) -> Result<String, String> {
    let bin = omarchy_bin()?;
    let dir = bin.parent().map(Path::to_path_buf).unwrap_or_default();
    run(&bin, args, Some(&dir), env)
}

/// What `omarchy theme bg current` prints for a file: the basename without its extension or a
/// leading "123-", dashes as spaces, every word capitalised. Mirrors the script's perl
/// `s/\.[^.]+$//; s/^\d+-//; s/-/ /g; s/\b(\w)/\U$1/g` byte for byte (ASCII word characters).
pub fn pretty_name(file_name: &str) -> String {
    let mut s = file_name.as_bytes().to_vec();
    if let Some(dot) = s.iter().rposition(|&b| b == b'.')
        && dot + 1 < s.len()
    {
        s.truncate(dot);
    }
    let digits = s.iter().take_while(|b| b.is_ascii_digit()).count();
    if digits > 0 && s.get(digits) == Some(&b'-') {
        s.drain(..=digits);
    }
    let word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut prev_word = false;
    for b in s.iter_mut() {
        if *b == b'-' {
            *b = b' ';
        }
        let w = word(*b);
        if w && !prev_word {
            *b = b.to_ascii_uppercase();
        }
        prev_word = w;
    }
    String::from_utf8_lossy(&s).into_owned()
}

#[derive(Debug, Serialize)]
pub struct SetResult {
    /// The symlink points at the file and `bg current` names it.
    pub ok: bool,
    /// `readlink -f ~/.local/state/omarchy/current/background`
    pub current_link: String,
    /// `omarchy theme bg current`
    pub current_name: String,
    pub expected_name: String,
    /// stderr of `omarchy theme bg set` when it failed (the symlink may still have moved)
    pub warning: Option<String>,
}

pub fn set_background(file: &Path) -> Result<SetResult, String> {
    let abs = file.canonicalize().map_err(|e| format!("{}: {e}", file.display()))?;
    let abs_s = abs.to_str().ok_or("the path is not UTF-8")?;
    let warning = omarchy(&["theme", "bg", "set", abs_s]).err();
    let link = state_dir()?.join("background");
    let current_link = link.canonicalize().map(|p| p.display().to_string()).unwrap_or_default();
    let current_name = omarchy(&["theme", "bg", "current"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let expected_name = pretty_name(abs.file_name().and_then(|n| n.to_str()).unwrap_or_default());
    let ok = current_link == abs_s && current_name == expected_name;
    if !ok && current_link != abs_s {
        return Err(warning.unwrap_or_else(|| format!("the background still points at {current_link}")));
    }
    Ok(SetResult {
        ok,
        current_link,
        current_name,
        expected_name,
        warning,
    })
}

/// The current theme's slug (`kanagawa`): theme.name, else `omarchy theme current` lowercased.
pub fn theme_slug() -> Result<String, String> {
    let raw = match std::fs::read_to_string(state_dir()?.join("theme.name")) {
        Ok(s) => s,
        Err(_) => omarchy(&["theme", "current"])?.to_lowercase().replace(' ', "-"),
    };
    let slug = raw.trim().to_string();
    let valid = !slug.is_empty()
        && slug != "unknown"
        && slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        && !slug.starts_with('.');
    if valid {
        Ok(slug)
    } else {
        Err(format!("no usable theme name ({slug:?})"))
    }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ThemeColors {
    pub mode: String,
    pub background: String,
    pub foreground: String,
    pub accent: String,
}

pub fn theme_colors() -> Result<ThemeColors, String> {
    let path = state_dir()?.join("theme/colors.toml");
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    parse_colors(&text)
}

pub fn parse_colors(text: &str) -> Result<ThemeColors, String> {
    let t: toml::Table = toml::from_str(text).map_err(|e| format!("colors.toml: {e}"))?;
    let hex = |k: &str| -> Result<String, String> {
        let v = t
            .get(k)
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("colors.toml has no {k}"))?;
        let ok = v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit());
        if ok {
            Ok(v.to_ascii_lowercase())
        } else {
            Err(format!("colors.toml {k} is not #rrggbb: {v}"))
        }
    };
    Ok(ThemeColors {
        mode: t.get("mode").and_then(|v| v.as_str()).unwrap_or("dark").to_string(),
        background: hex("background")?,
        foreground: hex("foreground")?,
        accent: hex("accent")?,
    })
}

/// Switch Omarchy to the Stipple theme (the shell plugin installs it and rewrites its colours)
/// unless it is the current one, keeping the background. Returns whether it switched.
pub fn use_stipple_theme() -> Result<bool, String> {
    let dir = home()?.join(".config/omarchy/themes/stipple");
    if !dir.is_dir() {
        return Err(format!(
            "there is no Stipple theme ({} is missing). Install the shell plugin first: shell-plugin/install.sh",
            dir.display()
        ));
    }
    if theme_slug().is_ok_and(|s| s == "stipple") {
        return Ok(false);
    }
    // theme set reads $OMARCHY_PATH (the stock themes, the templates), which a launcher may not pass
    let root = omarchy_bin()?.parent().and_then(Path::parent).map(Path::to_path_buf);
    let mut env: Vec<(&str, &OsStr)> = vec![("OMARCHY_THEME_SKIP_BACKGROUND", OsStr::new("1"))];
    if std::env::var_os("OMARCHY_PATH").is_none_or(|p| p.is_empty())
        && let Some(root) = root.as_deref().filter(|r| r.join("default/themed").is_dir())
    {
        env.push(("OMARCHY_PATH", root.as_os_str()));
    }
    omarchy_with(&["theme", "set", "stipple"], &env)?;
    Ok(true)
}

/// The weather location, which gives the Stipple theme its sun.
#[derive(Debug, Serialize, PartialEq)]
pub struct SunLocation {
    pub name: String,
    /// Both or neither: `omarchy-weather-location --set <name>` stores no coordinates.
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

/// `~/.local/state/omarchy/settings/weather.json` (omarchy-weather-location); None without one.
pub fn sun_location() -> Result<Option<SunLocation>, String> {
    let path = home()?.join(".local/state/omarchy/settings/weather.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(parse_weather(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// `{"name": "haifa", "latitude": 32.8, "longitude": 35.0}`; coordinates out of range count as none.
pub fn parse_weather(text: &str) -> Option<SunLocation> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let v = v.as_object()?;
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let coord = |k: &str, max: f64| v.get(k).and_then(|x| x.as_f64()).filter(|x| x.abs() <= max);
    let (latitude, longitude) = match (coord("latitude", 90.0), coord("longitude", 180.0)) {
        (Some(la), Some(lo)) => (Some(la), Some(lo)),
        _ => (None, None),
    };
    if name.is_empty() && latitude.is_none() {
        return None;
    }
    Some(SunLocation {
        name,
        latitude,
        longitude,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_names_match_the_script() {
        assert_eq!(pretty_name("cat-stipple-1920x1080.png"), "Cat Stipple 1920x1080");
        assert_eq!(pretty_name("cat-stipple-1920x1080-2.png"), "Cat Stipple 1920x1080 2");
        assert_eq!(pretty_name("cat-16x9.png"), "Cat 16x9");
        assert_eq!(
            pretty_name("01_blonde-swordswoman-black.jpg"),
            "01_blonde Swordswoman Black"
        );
        assert_eq!(pretty_name("2024-beach.png"), "Beach");
        assert_eq!(pretty_name("my.photo.v2.webp"), "My.Photo.V2");
        assert_eq!(pretty_name("noext"), "Noext");
    }

    #[test]
    fn colours() {
        let c =
            parse_colors("mode = \"dark\"\naccent = \"#DCD7BA\"\nbackground = \"#1f1f28\"\nforeground = \"#dcd7ba\"\n")
                .unwrap();
        assert_eq!(c.accent, "#dcd7ba");
        assert_eq!(c.background, "#1f1f28");
        assert!(parse_colors("background = \"red\"").is_err());
    }

    #[test]
    fn weather_locations() {
        let at = |name: &str, la: Option<f64>, lo: Option<f64>| {
            Some(SunLocation {
                name: name.into(),
                latitude: la,
                longitude: lo,
            })
        };
        assert_eq!(
            parse_weather(r#"{"name":"haifa","latitude":32.8,"longitude":35.0}"#),
            at("haifa", Some(32.8), Some(35.0))
        );
        assert_eq!(parse_weather("{\n  \"name\": \"haifa\"\n}\n"), at("haifa", None, None));
        assert_eq!(
            parse_weather(r#"{"name":"x","latitude":-33,"longitude":-151.2}"#),
            at("x", Some(-33.0), Some(-151.2))
        );
        // half a pair, strings, out of range: no coordinates
        assert_eq!(parse_weather(r#"{"name":"x","latitude":32.8}"#), at("x", None, None));
        assert_eq!(
            parse_weather(r#"{"name":"x","latitude":"32.8","longitude":"35"}"#),
            at("x", None, None)
        );
        assert_eq!(
            parse_weather(r#"{"name":"x","latitude":95,"longitude":35}"#),
            at("x", None, None)
        );
        assert_eq!(
            parse_weather(r#"{"latitude":1,"longitude":2}"#),
            at("", Some(1.0), Some(2.0))
        );
        assert_eq!(parse_weather(r#"{"name":""}"#), None);
        assert_eq!(parse_weather("[1, 2]"), None);
        assert_eq!(parse_weather("not json"), None);
    }
}
