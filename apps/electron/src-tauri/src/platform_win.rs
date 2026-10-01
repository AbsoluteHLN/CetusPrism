//! Windows platform face of the shell: single-instance mutex, focus event,
//! the backend's kill-on-close job object, Windows toasts, and the
//! Windows-specific user-data and browser-open behaviors. The Linux face
//! lives in `platform_linux.rs`; both expose the same function signatures and
//! `main.rs` picks one through a cfg-aliased `platform` module.

use std::io;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use tauri::AppHandle;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{
    CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, CREATE_NO_WINDOW, INFINITE,
};

use crate::notify;

const SINGLE_INSTANCE_MUTEX: PCWSTR = w!("Local\\CetusPrism.SingleInstance");
const FOCUS_EVENT_NAME: PCWSTR = w!("Local\\CetusPrism.Focus");

/// Hold a named mutex for the process lifetime; `false` when another shell
/// instance already owns it.
pub fn first_instance() -> bool {
    // `DSH_SHELL_INSTANCE_MUTEX` renames the lock so a packed smoke instance
    // can run beside an installed instance (the same override pattern as
    // `DSH_SHELL_BACKEND_DIR`); shipped launches share the default name.
    let override_name = std::env::var("DSH_SHELL_INSTANCE_MUTEX").ok()
        .map(|value| value.trim().to_string())
        .filter(|name| !name.is_empty())
        .map(|name| format!("Local\\CetusPrism.{name}\0").encode_utf16().collect::<Vec<u16>>());
    let mutex_name = match &override_name {
        Some(name) => PCWSTR::from_raw(name.as_ptr()),
        None => SINGLE_INSTANCE_MUTEX,
    };
    match unsafe { CreateMutexW(None, false, mutex_name) } {
        Ok(handle) => {
            // The mutex handle stays open for the process lifetime; the OS
            // releases it at exit, which is what makes the lock detectable.
            let _ = handle;
            unsafe { GetLastError() != ERROR_ALREADY_EXISTS }
        }
        Err(_) => true, // a mutex API failure must not block the shell
    }
}

/// Nudge the running instance's window to the front.
pub fn signal_focus() {
    if let Ok(event) = unsafe { CreateEventW(None, false, false, FOCUS_EVENT_NAME) } {
        let _ = unsafe { SetEvent(event) };
    }
}

/// Watch a named auto-reset event; a second launch signals it to focus the
/// existing window (the Electron shell's `second-instance` handler).
pub fn spawn_focus_listener(app: AppHandle) {
    std::thread::spawn(move || {
        let event = match unsafe { CreateEventW(None, false, false, FOCUS_EVENT_NAME) } {
            Ok(event) => event,
            Err(_) => return,
        };
        loop {
            if unsafe { WaitForSingleObject(event, INFINITE) } != WAIT_OBJECT_0 {
                return;
            }
            crate::focus_main_window(&app);
        }
    });
}

/// Windows-only spawn flag: keep the backend console hidden in windowed
/// release builds.
pub fn prepare_backend_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW.0);
}

/// Create the kill-on-close job the backend child is assigned to. `None` when
/// the job API fails — that must not block the launch; the explicit
/// teardown hook stays the primary teardown path.
pub fn create_backend_job() -> Option<isize> {
    let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.ok()?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let written = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if written.is_err() {
        eprintln!("[shell] backend job limits failed; kill_backend stays the only teardown path");
    }
    Some(job.0 as isize)
}

/// Assign the freshly spawned backend to the kill-on-close job. Job
/// membership is inherited by everything the backend spawns later, and the
/// assignment must happen before the child could detach on its own.
pub fn adopt_backend_child(job: Option<isize>, child: &Child) {
    let Some(job) = job else { return };
    let process = HANDLE(child.as_raw_handle());
    if let Err(error) = unsafe { AssignProcessToJobObject(HANDLE(job as *mut _), process) } {
        eprintln!("[shell] backend job assignment failed: {error}");
    }
}

/// Kill the backend child and reap it.
pub fn teardown_backend(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// The shell's user-data directory, pinned to `%APPDATA%/CetusPrism` so the
/// installer's hint file and the decision file keep their Electron-era paths.
pub fn user_data_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").expect("APPDATA is set on Windows");
    Path::new(&appdata).join("CetusPrism")
}

/// The directory offered by default when the user transfers an existing home.
pub fn default_config_destination() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|profile| Path::new(&profile).join("CetusPrism-config"))
        .unwrap_or_else(|_| PathBuf::from("CetusPrism-config"))
}

/// Open a path or URL with the system handler. `explorer` takes a single
/// argument and forwards it to the default handler, avoiding a shell
/// interpolation of the value.
pub fn open_in_system(target: &str) -> io::Result<()> {
    Command::new("explorer").arg(target).spawn().map(|_| ())
}

/// Pin the toast identity onto this process; call once at boot.
pub fn set_app_user_model_id() {
    notify::set_app_user_model_id();
}

/// Register the toast identity so toasts show the app's name.
pub fn register_identity(display_name: &str) {
    notify::register_identity(display_name);
}

/// Show one toast. Failures are logged, never fatal.
pub fn show_toast(title: &str, body: &str) {
    notify::show_toast(title, body);
}

/// The bundled Node runtime file name beside `entry.mjs`.
pub fn backend_node_file_name() -> &'static str {
    "node.exe"
}
