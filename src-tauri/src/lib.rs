use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the Next.js sidecar process so it can be killed on app exit — a
/// dropped Tauri `CommandChild` does NOT terminate the process, which would
/// otherwise orphan the Node server on the fixed port.
#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

/// Pick the loopback port for the Next.js sidecar.
///
/// Prefer a fixed port so the webview origin — and therefore its localStorage /
/// IndexedDB — stays stable across launches. Only skip it if something is
/// actively listening there (a TIME_WAIT socket from a previous run doesn't
/// count — node sets SO_REUSEADDR and will bind it fine).
fn pick_port() -> u16 {
    const PREFERRED: u16 = 41730;
    let nothing_listening = |port: u16| {
        TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(200),
        )
        .is_err()
    };
    for candidate in PREFERRED..PREFERRED + 20 {
        if nothing_listening(candidate) {
            return candidate;
        }
    }
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind a local port")
        .local_addr()
        .expect("failed to read local addr")
        .port()
}

/// A GUI app launched from Finder/Dock inherits only the bare system PATH, so
/// user-installed CLIs the server shells out to (ffmpeg, ffprobe, codex,
/// codex-imagegen) go missing. Recover the interactive login shell's PATH and
/// fold in a few common bin dirs.
fn resolve_user_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();

    let shell_path = std::env::var("SHELL").ok().and_then(|sh| {
        std::process::Command::new(sh)
            .args(["-lic", "printf %s \"$PATH\""])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    });

    let home = std::env::var("HOME").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();
    if let Some(sp) = shell_path {
        parts.extend(sp.split(':').map(String::from));
    }
    parts.extend(base.split(':').map(String::from));
    let extras = [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
    ];
    for extra in extras {
        if !parts.contains(&extra) {
            parts.push(extra);
        }
    }
    parts.retain(|p| !p.is_empty());
    parts.join(":")
}

/// Same problem as `resolve_user_path`, for a single scalar var: a GUI-launched
/// app doesn't source `.zshrc`, so overrides like `CODEX_IMAGEGEN_MODEL` set
/// there never reach the sidecar unless we go fetch them from the login shell.
fn resolve_user_env_var(name: &str) -> Option<String> {
    if let Ok(v) = std::env::var(name) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    let sh = std::env::var("SHELL").ok()?;
    std::process::Command::new(sh)
        .args(["-lic", &format!("printf %s \"${name}\"")])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Block until the sidecar is accepting connections (or give up after `timeout`).
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn start_server(app: &AppHandle, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    // Bundled: <resources>/server/server.js  (staged by scripts/desktop/build-server.mjs)
    let server_entry = app
        .path()
        .resolve("server/server.js", tauri::path::BaseDirectory::Resource)?;

    let data_dir = app.path().app_data_dir()?;
    let media_dir = data_dir.join("generated");
    std::fs::create_dir_all(&media_dir)?;

    let server_dir = server_entry
        .parent()
        .expect("server.js has no parent dir")
        .to_path_buf();

    // The Node runtime ships as a resource, not the sidecar — a binary launched
    // from Contents/MacOS/ gets its own macOS Dock tile (tauri-apps/tauri#14014).
    // The `helios-node` sidecar is a shim that hides itself from the Dock and
    // then exec's this.
    let node_rel = if cfg!(windows) {
        "server/node-bin/node.exe"
    } else {
        "server/node-bin/node"
    };
    let node_bin = app
        .path()
        .resolve(node_rel, tauri::path::BaseDirectory::Resource)?;

    let mut cmd = app
        .shell()
        .sidecar("helios-node")?
        .current_dir(server_dir)
        .args([
            "--disable-warning=ExperimentalWarning".to_string(), // node:sqlite
            "-r".to_string(),
            "./sidecar-guard.js".to_string(),
            server_entry.to_string_lossy().to_string(),
        ])
        .env("HELIOS_NODE_BIN", node_bin.to_string_lossy().to_string())
        .env("PATH", resolve_user_path())
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("HELIOS_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("HELIOS_MEDIA_DIR", media_dir.to_string_lossy().to_string());

    // codex-imagegen is spawned from inside the Next.js server with the
    // sidecar's env, so a .zshrc override like CODEX_IMAGEGEN_MODEL has to be
    // forwarded explicitly — see resolve_user_env_var.
    if let Some(model) = resolve_user_env_var("CODEX_IMAGEGEN_MODEL") {
        cmd = cmd.env("CODEX_IMAGEGEN_MODEL", model);
    }

    let (mut rx, child) = cmd.spawn()?;

    *app.state::<Sidecar>().0.lock().unwrap() = Some(child);

    // Drain sidecar output to the parent console for debugging.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[next] {}", String::from_utf8_lossy(&line))
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[next] {}", String::from_utf8_lossy(&line))
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[next] server exited: {:?}", payload.code)
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn kill_sidecar(app: &AppHandle) {
    if let Some(child) = app.state::<Sidecar>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // In `tauri dev` we point at an externally-run `next dev` instead of
            // spawning the bundled sidecar (which only exists after a build).
            if let Ok(dev_url) = std::env::var("HELIOS_DEV_URL") {
                if let Some(window) = handle.get_webview_window("main") {
                    if let Ok(parsed) = dev_url.parse() {
                        let _ = window.navigate(parsed);
                    }
                }
                return Ok(());
            }

            let port = pick_port();
            start_server(&handle, port)?;

            std::thread::spawn(move || {
                if !wait_for_server(port, Duration::from_secs(90)) {
                    eprintln!("[tauri] server never came up on port {port}");
                    return;
                }
                if let Some(window) = handle.get_webview_window("main") {
                    if let Ok(parsed) = format!("http://127.0.0.1:{port}/").parse() {
                        let _ = window.navigate(parsed);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running HeliosGen")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_sidecar(app);
            }
        });
}
