//! `stipple [image]`: one window for all launches. The first process listens on
//! `$XDG_RUNTIME_DIR/stipple.sock`; a later launch hands its image (or nothing, just to be raised)
//! to that window and exits. The frontend opens a launch image once the session is restored
//! (`take_launch_path`) and later ones as they arrive (the `open-path` event).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The image this process was started with, until the frontend takes it.
pub struct LaunchPath(pub Mutex<Option<String>>);

fn socket_path() -> Option<PathBuf> {
    std::env::var_os("XDG_RUNTIME_DIR").map(|d| PathBuf::from(d).join("stipple.sock"))
}

/// The first argument, made absolute so the running window can open it from its own directory.
fn arg_path() -> Option<String> {
    let arg = std::env::args_os().nth(1)?;
    let path = PathBuf::from(arg);
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    Some(path.to_string_lossy().into_owned())
}

/// Hands the launch image to a running Stipple and exits, or claims the socket for this one.
/// Returns this process's launch image and listener (None when there is no runtime dir).
pub fn forward_or_listen() -> (Option<String>, Option<UnixListener>) {
    let path = arg_path();
    let Some(socket) = socket_path() else { return (path, None) };

    if let Ok(mut stream) = UnixStream::connect(&socket) {
        let line = path.as_deref().unwrap_or("");
        if writeln!(stream, "{line}").is_ok() {
            std::process::exit(0);
        }
    }

    // Nobody answered: the socket, if there is one, was left by a Stipple that died.
    let _ = std::fs::remove_file(&socket);
    (path, UnixListener::bind(&socket).ok())
}

/// Raises the window for every later launch and passes its image on.
pub fn serve<R: Runtime>(app: AppHandle<R>, listener: UnixListener) {
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut line = String::new();
            if BufReader::new(stream).read_line(&mut line).is_err() {
                continue;
            }
            let path = line.trim_end_matches('\n');
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if !path.is_empty() {
                let _ = app.emit_to("main", "open-path", path);
            }
        }
    });
}

/// The image Stipple was launched with, once.
#[tauri::command]
pub fn take_launch_path(state: tauri::State<'_, LaunchPath>) -> Option<String> {
    state.0.lock().ok()?.take()
}
