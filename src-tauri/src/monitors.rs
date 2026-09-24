//! Connected monitors from `hyprctl monitors -j`.

use serde::Serialize;
use serde_json::Value;

use crate::sys::{find_in_path, run};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Monitor {
    pub name: String,
    pub description: String,
    /// Physical pixels as the screen shows them (swapped for a 90/270 degree transform).
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub focused: bool,
}

pub fn list() -> Result<Vec<Monitor>, String> {
    let hyprctl = find_in_path("hyprctl").unwrap_or_else(|| "/usr/bin/hyprctl".into());
    let out = run(&hyprctl, &["monitors", "-j"], None)?;
    parse(&out)
}

/// `hyprctl monitors -j`: width / height are physical pixels before the transform; transforms 1, 3,
/// 5 and 7 turn the output by 90 or 270 degrees.
pub fn parse(json: &str) -> Result<Vec<Monitor>, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("hyprctl gave unreadable JSON: {e}"))?;
    let arr = v.as_array().ok_or("hyprctl did not list monitors")?;
    let mut out = Vec::new();
    for m in arr {
        let (Some(w), Some(h)) = (m["width"].as_u64(), m["height"].as_u64()) else {
            continue;
        };
        if w == 0 || h == 0 || m["disabled"].as_bool() == Some(true) {
            continue;
        }
        let turned = m["transform"].as_u64().unwrap_or(0) % 2 == 1;
        let (width, height) = if turned {
            (h as u32, w as u32)
        } else {
            (w as u32, h as u32)
        };
        out.push(Monitor {
            name: m["name"].as_str().unwrap_or("?").to_string(),
            description: m["description"].as_str().unwrap_or("").to_string(),
            width,
            height,
            scale: m["scale"].as_f64().unwrap_or(1.0),
            focused: m["focused"].as_bool().unwrap_or(false),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_turns() {
        let json = r#"[
          {"name":"eDP-1","description":"BOE 0x0BCA","width":1920,"height":1080,"scale":2.0,"transform":0,"focused":true,"disabled":false},
          {"name":"DP-1","description":"Dell","width":2560,"height":1440,"scale":1.0,"transform":1,"focused":false},
          {"name":"HDMI-A-1","width":1920,"height":1080,"scale":1.0,"transform":0,"focused":false,"disabled":true}
        ]"#;
        let m = parse(json).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].width, m[0].height, m[0].focused), (1920, 1080, true));
        assert_eq!((m[1].width, m[1].height), (1440, 2560));
        assert!(parse("nope").is_err());
    }
}
