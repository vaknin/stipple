//! Small process and path helpers (std only).

use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())
}

pub fn is_executable(p: &Path) -> bool {
    p.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// The first executable `name` on PATH.
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(name))
        .find(|p| is_executable(p))
}

/// PATH with `dir` in front (so a script's own helpers resolve even when a launcher started us
/// with a minimal PATH).
pub fn path_with(dir: &Path) -> OsString {
    let mut dirs = vec![dir.to_path_buf()];
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p).filter(|d| d != dir));
    }
    std::env::join_paths(dirs).unwrap_or_else(|_| dir.as_os_str().to_owned())
}

/// Run a program, return its stdout. A non-zero exit is an error carrying stderr.
pub fn run(program: &Path, args: &[&str], path_prefix: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = path_prefix {
        cmd.env("PATH", path_with(dir));
    }
    let out = cmd
        .output()
        .map_err(|e| format!("could not run {}: {e}", program.display()))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!(
            "{} {} failed ({}): {}",
            program.display(),
            args.join(" "),
            out.status,
            if err.is_empty() { "no error output".into() } else { err }
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
