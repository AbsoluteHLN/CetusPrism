//! Linux platform face of the shell: single-instance detection and the
//! focus signal ride one Unix socket, the backend runs in its own session
//! with a parent-death signal, and toasts and file/URL opening go through
//! the desktop's `notify-send` / `xdg-open` helpers, best-effort. The
//! Windows face lives in `platform_win.rs`; both expose the same function
//! signatures and `main.rs` picks one through a cfg-aliased `platform`
//! module.

use std::io;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use tauri::AppHandle;

/// The Unix socket that carries single-instance detection and the focus
/// signal, under `$XDG_RUNTIME_DIR` (falling back to `/tmp` when unset, as in
/// containers). `DSH_SHELL_INSTANCE_MUTEX` renames the socket so a packed
/// smoke instance can run beside an installed one.
fn instance_socket_path() -> PathBuf {
    let id = std::env::var("DSH_SHELL_INSTANCE_MUTEX").ok()
        .map(|value| value.trim().to_string())
        .filter(|name| !name.is_empty())
        .map(|name| format!("cetusprism-{name}.sock"))
        .unwrap_or_else(|| "cetusprism.sock".to_string());
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").ok()
        .filter(|dir| !dir.is_empty())
        .unwrap_or_else(|| "/tmp".to_string());
    Path::new(&runtime_dir).join(id)
}

/// The listener bound by [`first_instance`], handed to
/// [`spawn_focus_listener`] so the instance socket is bound exactly once.
static INSTANCE_LISTENER: std::sync::Mutex<Option<UnixListener>> = std::sync::Mutex::new(None);

/// Bind the instance socket; `false` when another shell instance already
/// owns it. A socket file left by a dead process is detected (connect fails)
/// and replaced, so a crash never wedges the next launch.
pub fn first_instance() -> bool {
    let path = instance_socket_path();
    let bind_fresh = || -> io::Result<()> {
        let listener = UnixListener::bind(&path)?;
        *INSTANCE_LISTENER.lock().expect("instance listener mutex") = Some(listener);
        Ok(())
    };
    if bind_fresh().is_ok() {
        return true;
    }
    // A connectable socket means a live instance; an unreachable one is
    // stale, so remove it and try to claim the name once. AF_UNIX connect is
    // a local kernel call — it returns immediately with success, ECONNREFUSED
    // or EAGAIN, so no timeout is needed for liveness probing.
    if UnixStream::connect(&path).is_ok() {
        return false;
    }
    let _ = std::fs::remove_file(&path);
    bind_fresh().is_ok()
}

/// Nudge the running instance's window to the front.
pub fn signal_focus() {
    signal_instance(b"f");
}

/// Ask the running instance to quit cleanly (`--dsh-installer-quit`): the
/// reinstalling installer needs the shell and its backend child gone.
pub fn signal_quit() {
    signal_instance(b"q");
}

fn signal_instance(kind: &[u8; 1]) {
    let Ok(mut stream) = UnixStream::connect(instance_socket_path()) else { return };
    let _ = std::io::Write::write_all(&mut stream, kind);
}

/// Accept on the instance socket; every connection is a second launch asking
/// to focus the existing window (the Electron shell's `second-instance`
/// handler), or an installer handshake asking for a clean quit. The socket
/// was bound by [`first_instance`].
pub fn spawn_focus_listener(app: AppHandle) {
    let listener = INSTANCE_LISTENER.lock().expect("instance listener mutex").take();
    let Some(listener) = listener else { return };
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let mut kind = [b'f'];
                    let _ = std::io::Read::read_exact(&mut stream, &mut kind);
                    if kind[0] == b'q' {
                        app.exit(0);
                    } else {
                        crate::focus_main_window(&app);
                    }
                }
                Err(_) => return,
            }
        }
    });
}

/// Linux spawns the backend into its own session so a quit can signal the
/// whole process group.
pub fn prepare_backend_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(io::Error::last_os_error());
            }
            // Die with the shell even on a shell crash: the kernel signals
            // this child when its parent thread goes away.
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// Linux has no job-object equivalent to adopt into; the session plus the
/// parent-death signal set at spawn cover the teardown semantics.
pub fn create_backend_job() -> Option<isize> {
    None
}

pub fn adopt_backend_child(_job: Option<isize>, _child: &Child) {}

/// Kill the backend's whole session (the child became a session leader, so
/// its process group id equals its pid), then reap it. Falls back to a
/// direct kill when the group signal fails.
pub fn teardown_backend(mut child: Child) {
    let pid = child.id() as i32;
    if unsafe { libc::kill(-pid, libc::SIGKILL) } != 0 {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// The shell's user-data directory under the XDG data home.
pub fn user_data_dir() -> PathBuf {
    let data_home = std::env::var("XDG_DATA_HOME").ok()
        .filter(|dir| !dir.is_empty() && dir.starts_with('/'))
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_default();
            Path::new(&home).join(".local").join("share").to_string_lossy().to_string()
        });
    Path::new(&data_home).join("CetusPrism")
}

/// The directory offered by default when the user transfers an existing home.
pub fn default_config_destination() -> PathBuf {
    std::env::var("HOME")
        .map(|home| Path::new(&home).join("CetusPrism-config"))
        .unwrap_or_else(|_| PathBuf::from("CetusPrism-config"))
}

/// Open a path or URL with the desktop's default handler, best-effort.
pub fn open_in_system(target: &str) -> io::Result<()> {
    Command::new("xdg-open").arg(target).spawn().map(|_| ())
}

/// Notifications ride the freedesktop `notify-send` helper; a desktop
/// without it only loses the toast, never the launch.
pub fn set_app_user_model_id() {}

pub fn register_identity(_display_name: &str) {}

pub fn show_toast(title: &str, body: &str) {
    let _ = Command::new("notify-send").arg(title).arg(body).spawn();
}

/// The bundled Node runtime file name beside `entry.mjs`.
pub fn backend_node_file_name() -> &'static str {
    "node"
}
