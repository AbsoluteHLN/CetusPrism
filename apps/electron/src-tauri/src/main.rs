//! CetusPrism desktop shell: spawns the packaged backend runtime as a
//! plain-Node child, waits for its readiness line, and shows the web GUI in
//! an undecorated webview window.
//!
//! The backend is `resources/app/backend/entry.mjs` beside the executable
//! (same packaged geometry the Electron shell used), run by the bundled
//! Node runtime. On first launch the shell detects an existing DeepSeek
//! Harness home and asks whether to inherit or transfer it (see
//! `dsh_home.rs`); the resolved home reaches the backend as `DSH_HOME`.
//! Quitting the shell kills the backend. Development override:
//! `DSH_SHELL_BACKEND_DIR` points at a directory holding the Node runtime and
//! `entry.mjs`.
//!
//! Platform behavior (single instance, focus signal, backend teardown,
//! toasts, user-data paths, system browser handoff) lives behind the
//! cfg-aliased `platform` module: `platform_win.rs` on Windows,
//! `platform_linux.rs` on Linux, `platform_macos.rs` on macOS, with
//! identical function signatures.

// Windowed subsystem in release: no console window beside the app window.
// Debug builds keep the console so backend output is observable.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod bridge;
mod dsh_home;
#[cfg(target_os = "linux")]
mod platform_linux;
#[cfg(target_os = "macos")]
mod platform_macos;
#[cfg(windows)]
mod platform_win;
#[cfg(windows)]
mod notify;
#[cfg(windows)]
use platform_win as platform;
#[cfg(target_os = "linux")]
use platform_linux as platform;
#[cfg(target_os = "macos")]
use platform_macos as platform;

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::Color;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// First port probed for the backend, inside the Projects range (14400–14499).
const PORT_RANGE_START: u16 = 14400;
/// Ports probed before giving up.
const PORT_RANGE_TRIES: u16 = 100;
/// Readiness budget: the backend boots a full plugin tree.
const READINESS_TIMEOUT: Duration = Duration::from_secs(60);
/// The readiness line the backend prints once its web server listens; the
/// printed URL carries the access token the web surface requires.
const BACKEND_READY_MARK: &str = "dsh web: http://127.0.0.1:";
/// Watcher poll interval for unexpected backend exits.
const BACKEND_WATCH_INTERVAL: Duration = Duration::from_millis(500);

/// The one-time background-mode hint toast, raised the first time the window
/// hides into the tray so the still-running app is discoverable.
const BACKGROUND_HINT_TITLE: &str = "CetusPrism 仍在后台运行";
const BACKGROUND_HINT_BODY: &str = "已驻留在任务栏右下角托盘；点击托盘图标可恢复窗口，或在托盘菜单中选择退出。";

/// Backend child and shell bookkeeping, shared between the boot flow, the
/// watcher thread, and the exit hook.
struct ShellState {
    backend: Mutex<Option<Child>>,
    /// Windows: the kill-on-close job the backend child is assigned to, as
    /// the raw handle value (`HANDLE` itself is not `Send`). The OS closes a
    /// dead process's handles, which terminates everything in the job — so a
    /// shell that dies any way (quit, crash, force kill) can never leave a
    /// backend running with its session claims held. Linux: always `None`;
    /// the session plus the parent-death signal cover the same semantics.
    backend_job: Mutex<Option<isize>>,
    quitting: AtomicBool,
    last_maximized: Mutex<Option<bool>>,
    /// Whether the close-to-tray hint toast has been raised this launch.
    close_hint_shown: AtomicBool,
}

fn main() {
    if !platform::first_instance() {
        platform::signal_focus();
        return;
    }
    platform::set_app_user_model_id();
    let state = Arc::new(ShellState {
        backend: Mutex::new(None),
        backend_job: Mutex::new(platform::create_backend_job()),
        quitting: AtomicBool::new(false),
        last_maximized: Mutex::new(None),
        close_hint_shown: AtomicBool::new(false),
    });
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            dsh_quit,
            dsh_minimize,
            dsh_toggle_maximize,
            dsh_close,
            dsh_start_drag,
            dsh_open_external,
            dsh_notify
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            platform::register_identity("CetusPrism");
            setup_tray(&handle)?;
            platform::spawn_focus_listener(handle.clone());
            boot(handle, state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<Arc<ShellState>>();
                if !state.quitting.load(Ordering::SeqCst) {
                    // Background mode: a close request (titlebar X via
                    // dsh_close, or Alt+F4) hides the window instead; the
                    // process keeps running and the tray restores it.
                    api.prevent_close();
                    hide_to_tray(window.app_handle());
                }
                return;
            }
            if let WindowEvent::Resized(_) = event {
                let handle = window.app_handle();
                let state = handle.state::<Arc<ShellState>>();
                let maximized = window.is_maximized().unwrap_or(false);
                if let Some(webview) = handle.get_webview_window("main") {
                    push_maximized(|script| webview.eval(script), &state.last_maximized, maximized);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("CetusPrism shell failed to initialize")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                kill_backend(app_handle);
            }
        });
}

/// Create the tray icon: left-click restores the window; the menu offers
/// restore and a real quit (close-to-tray means a closed window is hidden,
/// so the tray owns the only exit affordance while hidden).
fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let open = MenuItemBuilder::with_id("open", "显示主窗口").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app).item(&open).separator().item(&quit).build()?;
    TrayIconBuilder::with_id("main")
        // The tray draws at the system's small-icon size (16px at 100% DPI).
        // default_window_icon hands over one decoded bitmap of the largest
        // bundle icon (128-256px), which the system then shrinks into mush;
        // this dedicated 32px render keeps the tray crisp while the window
        // keeps the full logo icon.
        .icon(tauri::include_image!("icons/tray-32.png"))
        .tooltip("CetusPrism")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Restore the window from the tray: visible, unminimized, focused.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Same as [`show_main_window`], for platform faces that only hold an
/// `AppHandle` (the second-launch focus path).
fn focus_main_window(app: &AppHandle) {
    show_main_window(app);
}

/// Hide the window into the tray (background mode), raising the one-time
/// hint toast so the running app stays discoverable.
fn hide_to_tray(app: &AppHandle) {
    let state = app.state::<Arc<ShellState>>();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if !state.close_hint_shown.swap(true, Ordering::SeqCst) {
        platform::show_toast(BACKGROUND_HINT_TITLE, BACKGROUND_HINT_BODY);
    }
}

/// Boot sequence: resolve the home, start the backend, show the window.
fn boot(app: AppHandle, state: Arc<ShellState>) {
    let user_data_dir = user_data_dir();
    let custom_home = match resolve_initial_home(&user_data_dir) {
        Ok(home) => home,
        Err(HomePromptAbort) => {
            app.exit(0);
            return;
        }
    };
    let backend_dir = resolve_backend_dir();
    let url = match start_backend(&state, custom_home.as_deref(), &backend_dir) {
        Ok(url) => url,
        Err(error) => {
            eprintln!("[shell] backend failed to start: {error}");
            offer_home_fallback(&app, &user_data_dir);
            return;
        }
    };
    if let Err(error) = create_main_window(&app, &url) {
        eprintln!("[shell] window failed to open: {error}");
        app.exit(1);
        return;
    }
    watch_backend(app, state);
}

/// Create the single window loading the backend's web surface.
fn create_main_window(app: &AppHandle, url: &str) -> Result<WebviewWindow, String> {
    let parsed: tauri::Url = url.parse().map_err(|error| format!("backend URL malformed: {error}"))?;
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
        .title("CetusPrism")
        .inner_size(1440.0, 900.0)
        // Frameless: the in-page titlebar owns dragging and the window
        // controls (bridge.rs + dsh-desktop-titlebar). Windows keeps native
        // resize edges on undecorated resizable windows; X11 sessions get
        // them from the web surface, Wayland may not support either.
        .decorations(false)
        .background_color(Color(0x0a, 0x0e, 0x13, 0xff))
        .initialization_script(bridge::INIT_SCRIPT);
    #[cfg(windows)]
    let builder = builder.data_directory(user_data_dir().join("WebView2"));
    let window = builder
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .build()
        .map_err(|error| format!("window build failed: {error}"))?;
    let state = app.state::<Arc<ShellState>>();
    let maximized = window.is_maximized().unwrap_or(false);
    push_maximized(|script| window.eval(script), &state.last_maximized, maximized);
    Ok(window)
}

/// Report the first free loopback port at or after [`PORT_RANGE_START`].
fn probe_free_port() -> std::io::Result<u16> {
    for port in PORT_RANGE_START..PORT_RANGE_START.saturating_add(PORT_RANGE_TRIES) {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                drop(listener);
                return Ok(port);
            }
            Err(_) => continue,
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, "port space exhausted"))
}

/// Spawn the backend runtime and wait for its readiness line.
///
/// Backend output streams to the shell console with a `[backend]` prefix for
/// the backend's lifetime, so boot failures and later backend logs (login,
/// crashes) stay diagnosable from the console. The spawned child is parked in
/// [`ShellState::backend`]; the exit hook and [`watch_backend`] own it from
/// then on.
fn start_backend(state: &ShellState, custom_home: Option<&Path>, backend_dir: &Path) -> Result<String, String> {
    let node = backend_dir.join(platform::backend_node_file_name());
    let entry = backend_dir.join("entry.mjs");
    if !node.is_file() || !entry.is_file() {
        return Err(format!("backend runtime missing at {}（需要先完成打包，或设置 DSH_SHELL_BACKEND_DIR）", backend_dir.display()));
    }
    let port = probe_free_port().map_err(|error| format!("no free backend port: {error}"))?;
    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = custom_home {
        command.env("DSH_HOME", home);
    }
    platform::prepare_backend_command(&mut command);
    let mut child = command.spawn().map_err(|error| format!("backend spawn failed: {error}"))?;
    platform::adopt_backend_child(*state.backend_job.lock().expect("backend job mutex"), &child);
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[backend] {line}");
        }
    });
    let (sender, receiver) = mpsc::channel::<Result<String, String>>();
    // Drain backend stdout for the child's lifetime: dropping this pipe read
    // end after readiness would EPIPE-kill the backend on its next stdout
    // write (e.g. the Platform login flow's request logs).
    let ready_sent = AtomicBool::new(false);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("[backend] {line}");
            if line.contains(BACKEND_READY_MARK) && !ready_sent.swap(true, Ordering::Relaxed) {
                let _ = sender.send(Ok(extract_ready_url(&line)));
            }
        }
        if !ready_sent.swap(true, Ordering::Relaxed) {
            let _ = sender.send(Err("backend exited before reporting readiness".into()));
        }
    });
    match receiver.recv_timeout(READINESS_TIMEOUT) {
        Ok(ready) => {
            *state.backend.lock().expect("backend mutex") = Some(child);
            ready
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("backend did not report readiness within {}s", READINESS_TIMEOUT.as_secs()))
        }
    }
}

/// Extract the printed URL from a readiness line, token query included.
fn extract_ready_url(line: &str) -> String {
    let Some(index) = line.find(BACKEND_READY_MARK) else {
        return line.trim().to_string();
    };
    line[index + "dsh web: ".len()..].trim().to_string()
}

/// Abort marker: the user declined the first-run home prompt.
struct HomePromptAbort;

/// Resolve the harness home for this launch, prompting on first run only.
///
/// A recorded decision replays silently. Otherwise the shell detects an
/// existing home — `$DSH_HOME`, then the default home with user data, then
/// the installer's hint — and asks whether to inherit it or copy it to a
/// folder the user picks. Declining ends the launch; backing out of the
/// picker keeps the existing home (and leaves the decision unrecorded, so
/// the prompt returns next launch).
fn resolve_initial_home(user_data_dir: &Path) -> Result<Option<PathBuf>, HomePromptAbort> {
    if let Some(recorded) = dsh_home::read_decision(user_data_dir) {
        return Ok(match recorded.mode {
            dsh_home::DshHomeMode::Custom => recorded.home,
            dsh_home::DshHomeMode::Default => None,
        });
    }
    let detected = dsh_home::detect_existing_dsh_home().or_else(|| {
        dsh_home::read_install_hint(user_data_dir)
            .filter(|path| path.exists())
            .map(|path| dsh_home::DshHomeCandidate { path, source: dsh_home::DshHomeSource::InstallerHint })
    });
    let Some(detected) = detected else {
        // Fresh machine: no home to inherit, never prompt again.
        dsh_home::write_decision(user_data_dir, dsh_home::DshHomeMode::Default, None, None);
        return Ok(None);
    };
    let detail = format!(
        "配置目录：{}\n\n继承后，已有的登录密钥、会话记录和个性化设置将原样保留，不会被修改。\n也可以把配置复制到其他文件夹使用；复制不会改动原文件夹。",
        detected.path.display()
    );
    let buttons = ["继承并继续使用（推荐）", "转移到新文件夹…", "退出"];
    let choice = rfd::MessageDialog::new()
        .set_title("CetusPrism")
        .set_description(&detail)
        .set_level(rfd::MessageLevel::Info)
        .set_buttons(rfd::MessageButtons::YesNoCancelCustom(
            buttons[0].to_string(),
            buttons[1].to_string(),
            buttons[2].to_string(),
        ))
        .show();
    match choice {
        rfd::MessageDialogResult::Custom(label) if label == buttons[0] => {
            eprintln!("[shell] inheriting existing harness home at {} ({:?})", detected.path.display(), detected.source);
            dsh_home::write_decision(user_data_dir, dsh_home::DshHomeMode::Default, None, Some(&detected.path));
            Ok(None)
        }
        rfd::MessageDialogResult::Custom(label) if label == buttons[1] => transfer_home(user_data_dir, &detected.path),
        // 退出、关闭对话框或任何未识别的回退都结束本次启动。
        _ => Err(HomePromptAbort),
    }
}

/// Transfer the existing home: copy it into a folder the user picks, then
/// point the shell at the copy. The original home is reported (with a button
/// to open it in the file manager) and left untouched — deletion is always
/// manual.
fn transfer_home(user_data_dir: &Path, source_home: &Path) -> Result<Option<PathBuf>, HomePromptAbort> {
    let default_destination = platform::default_config_destination();
    let picked = rfd::FileDialog::new()
        .set_title("选择把现有配置复制到哪个文件夹")
        .set_directory(&default_destination)
        .set_can_create_directories(true)
        .pick_folder();
    let Some(destination) = picked else {
        // Backing out of the picker keeps the existing home in place.
        return Ok(None);
    };
    if let Err(error) = dsh_home::copy_dsh_home(source_home, &destination) {
        rfd::MessageDialog::new()
            .set_title("CetusPrism")
            .set_level(rfd::MessageLevel::Error)
            .set_description(&format!("{error}\n\n将继续使用原配置目录，原目录未受影响。"))
            .set_buttons(rfd::MessageButtons::OkCustom("确定".to_string()))
            .show();
        return Ok(None);
    }
    dsh_home::write_decision(user_data_dir, dsh_home::DshHomeMode::Custom, Some(&destination), Some(source_home));
    let confirm = rfd::MessageDialog::new()
        .set_title("配置已转移")
        .set_level(rfd::MessageLevel::Info)
        .set_description(&format!(
            "已有配置已复制到新文件夹\n\n新配置目录：{}\n原目录：{}\n\n原目录保持原样，未被修改或删除。请先确认应用在新目录下运行正常，再自行删除原目录。",
            destination.display(),
            source_home.display()
        ))
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            "打开原文件夹".to_string(),
            "确定".to_string(),
        ))
        .show();
    if confirm == rfd::MessageDialogResult::Ok {
        let _ = platform::open_in_system(&source_home.display().to_string());
    }
    Ok(Some(destination))
}

/// After a failed backend boot, offer to revert a `custom` home decision back
/// to the recorded fallback home (the original directory was never deleted).
/// Reverting records the default-mode decision and relaunches; declining
/// exits.
fn offer_home_fallback(app: &AppHandle, user_data_dir: &Path) {
    let Some(decision) = dsh_home::read_decision(user_data_dir) else { return };
    let (Some(home), Some(fallback)) = (decision.home.clone(), decision.fallback_home.clone()) else {
        return;
    };
    if decision.mode != dsh_home::DshHomeMode::Custom || !fallback.exists() {
        return;
    }
    let proceed = rfd::MessageDialog::new()
        .set_title("后端启动失败")
        .set_level(rfd::MessageLevel::Error)
        .set_description(&format!(
            "当前配置目录：{}\n原配置目录仍在：{}\n\n可以改回原配置目录重新启动；两个目录都不会被删除。",
            home.display(),
            fallback.display()
        ))
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            "改回原配置目录".to_string(),
            "退出".to_string(),
        ))
        .show();
    if proceed == rfd::MessageDialogResult::Ok {
        dsh_home::write_decision(user_data_dir, dsh_home::DshHomeMode::Default, None, Some(&fallback));
        app.restart();
    }
    app.exit(1);
}

/// Poll the backend child; an unexpected exit takes the shell down with it,
/// mirroring the Electron shell's `exit` handler.
fn watch_backend(app: AppHandle, state: Arc<ShellState>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(BACKEND_WATCH_INTERVAL);
        let status = {
            let mut backend = state.backend.lock().expect("backend mutex");
            match backend.as_mut() {
                Some(child) => child.try_wait().ok().flatten(),
                None => return,
            }
        };
        if let Some(status) = status {
            if !state.quitting.load(Ordering::SeqCst) {
                eprintln!("[shell] backend exited unexpectedly with status {status}");
                app.exit(1);
            }
            return;
        }
    });
}

/// Kill the backend child; the `before-quit` counterpart.
fn kill_backend(app: &AppHandle) {
    let state = app.state::<Arc<ShellState>>();
    state.quitting.store(true, Ordering::SeqCst);
    let child = {
        let mut backend = state.backend.lock().expect("backend mutex");
        backend.take()
    };
    if let Some(child) = child {
        platform::teardown_backend(child);
    }
}

/// Push the maximize state to the page whenever it changes; the in-page
/// titlebar restyles itself (`dsh-titlebar-maximized`). Deduplicated against
/// the last pushed value so a resize storm does not flood the page.
fn push_maximized(eval: impl FnOnce(&str) -> Result<(), tauri::Error>, last: &Mutex<Option<bool>>, maximized: bool) {
    let mut last = last.lock().expect("maximize mutex");
    if *last != Some(maximized) {
        *last = Some(maximized);
        let _ = eval(&format!(
            "window.dispatchEvent(new CustomEvent('dsh-desktop:window-state', {{detail: {maximized}}}))",
        ));
    }
}

/// The shell's user-data directory (platform-defined; decisions, the
/// installer hint, and the WebView2 profile live here).
fn user_data_dir() -> PathBuf {
    platform::user_data_dir()
}

/// Backend location: beside the packaged executable (Windows/Linux pack), in
/// the macOS bundle's Resources half, or a dev override. The macOS runtime
/// ships under `Contents/Resources` so codesign seals it as resources —
/// files under `Contents/MacOS` would each demand a code signature.
fn resolve_backend_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("DSH_SHELL_BACKEND_DIR") {
        if !override_dir.trim().is_empty() {
            return PathBuf::from(override_dir);
        }
    }
    let exe = std::env::current_exe().expect("current executable");
    let exe_dir = exe.parent().expect("executable directory");
    let beside = exe_dir.join("resources").join("app").join("backend");
    if beside.join("entry.mjs").exists() {
        return beside;
    }
    exe_dir.join("../Resources/app/backend")
}

#[tauri::command]
fn dsh_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn dsh_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn dsh_toggle_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn dsh_close(app: AppHandle) {
    hide_to_tray(&app);
}

/// Show a desktop notification on behalf of the web surface (the client's
/// desktop-notification plugin raises task toasts through it).
#[tauri::command]
fn dsh_notify(title: String, body: String) {
    platform::show_toast(&title, &body);
}

#[tauri::command]
fn dsh_start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

/// The URL schemes a system-browser handoff may carry. Loopback HTTP stays
/// allowed because the Harness web surface itself is loopback-served.
fn is_openable_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false
    };
    if parsed.username() != "" || parsed.password().is_some() {
        return false
    }
    match parsed.scheme() {
        "https" => true,
        "http" => matches!(
            parsed.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("[::ffff:127.0.0.1]")
        ),
        _ => false,
    }
}

/// Open a URL in the system default browser. The web client hands over the
/// account authorization URL here; the validation mirrors the client-side
/// host guard (HTTPS, or loopback HTTP, never carrying credentials).
#[tauri::command]
fn dsh_open_external(url: String) -> Result<(), String> {
    if !is_openable_url(&url) {
        return Err("dsh_open_external: only https or loopback http URLs are openable".into())
    }
    platform::open_in_system(&url)
        .map_err(|error| format!("dsh_open_external: {error}"))
}

#[cfg(test)]
mod open_external_tests {
    use super::is_openable_url;

    #[test]
    fn accepts_https_and_loopback_http() {
        assert!(is_openable_url("https://platform.deepseek.com/sign_in?token=1"));
        assert!(is_openable_url("http://127.0.0.1:14400/sign_in"));
        assert!(is_openable_url("http://localhost/callback"));
        assert!(is_openable_url("http://[::1]/callback"));
    }

    #[test]
    fn rejects_non_http_schemes_and_remote_http() {
        assert!(!is_openable_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("http://platform.deepseek.com/sign_in"));
        assert!(!is_openable_url("ftp://127.0.0.1/file"));
    }

    #[test]
    fn rejects_urls_carrying_credentials_or_garbage() {
        assert!(!is_openable_url("https://user:secret@platform.deepseek.com/sign_in"));
        assert!(!is_openable_url("https://user@platform.deepseek.com/"));
        assert!(!is_openable_url("not a url"));
        assert!(!is_openable_url(""));
    }
}
