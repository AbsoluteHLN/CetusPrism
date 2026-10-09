# dsh-electron

English | [中文](README.zh.md)

The CetusPrism desktop shell: a Rust (Tauri 2) window over the same web
surface `dsh --profile web` serves, with the backend shipped inside the app.
Windows renders the surface through WebView2; Linux uses WebKitGTK. The
folder keeps its historical `apps/electron` name and the
`@deepseek-ai/dsh-electron` package name.

## Architecture

```
apps/electron/
  src-tauri/src/main.rs    shell: single instance, spawn backend, wait for
                           readiness, show frameless window, kill backend on exit;
                           tray icon, close-to-tray background mode
  src-tauri/src/platform_win.rs   Windows face: named-mutex single instance,
                           focus event, kill-on-close job object, WinRT toasts,
                           %APPDATA% user data, explorer handoff
  src-tauri/src/platform_linux.rs  Linux face: Unix-socket single instance and
                           focus signal, backend session + parent-death signal,
                           notify-send / xdg-open, XDG user data. main.rs picks
                           one face through the cfg-aliased `platform` module
  src-tauri/src/dsh-home.rs  harness-home detection, first-run decision record,
                           transfer copy (Rust port of the removed dsh-home.ts)
  src-tauri/src/bridge.rs  the injected bridge script: window.dshDesktop plus
                           the titlebar drag takeover
  src-tauri/src/notify.rs  Windows toasts: WinRT toast through the pinned
                           windows crate, HKCU AppUserModelId identity
  src-tauri/capabilities/  ACL grant for the dsh_* window-control commands on
                           the loopback web surface
  backend/entry.mjs        backend bootstrap: runs the CLI's `web` profile from ./runtime
                           with the four desktop overlays below, in argv order
  backend/credentials-home.patch.yml  pins the backend's credentials row to the shared
                           default document (~/.dsh/.credentials.yaml), so the desktop
                           reads the same key store as every other dsh entry point
  backend/desktop-slim.patch.yml  disables the Office document preview (pack-tauri
                           prunes the LibreOffice kit it would ship)
  backend/desktop-computer-use.patch.yml  mounts the computer-use registration
                           service and the experimental native Cua Driver provider
  backend/desktop-experimental.patch.yml  enables the experimental Agent Teams
                           feature set (host roster/task DAG, team tools, browser
                           Team action); restates agent-team-profile's composition
  scripts/build-shell.mjs            cargo build --release --offline from the dependency cache
  scripts/pack-tauri.mjs             assemble the win-unpacked payload (no network)
  scripts/heal-deploy-links.mjs      deploy-layout invariant gate (see below)
  scripts/audit-junctions.mjs        verify every junction stays inside the runtime tree
  scripts/make-installer.mjs         NSIS installer via electron-builder --prepackaged
  scripts/build-deb.mjs              Linux .deb leg: native cargo build + pack, with
                           an optional Ubuntu 22.04.2 sysroot adapter
  scripts/pack-linux.mjs             native deb staging and dpkg-deb assembly
  docker/linux-build.Dockerfile      legacy Windows-host compatibility image (not used by Linux)
  build/installer.nsh      NSIS custom page + hooks: the CLI PATH opt-in page
                           (user PATH write, marker registry value, WM_SETTINGCHANGE
                           broadcast), the harness-home detection hint, and the
                           uninstall-time PATH cleanup
```

Platform behavior is split, not duplicated: `main.rs` compiles one `platform`
module per target with identical function signatures. Windows keeps the
named-mutex single instance, the named focus event, the kill-on-close job
object around the backend child, WinRT toasts, `%APPDATA%/CetusPrism` user
data, and WebView2 profile data under it. Linux binds one Unix socket under
`$XDG_RUNTIME_DIR` for both single-instance detection and the focus signal,
spawns the backend in its own session with `PR_SET_PDEATHSIG` (a quit signals
the whole process group; a shell crash kills the child), raises toasts
through `notify-send` (best-effort), keeps user data under
`$XDG_DATA_HOME/CetusPrism`, and hands file/URL opens to `xdg-open`. On both
platforms a second launch focuses the first instance's window, and quitting
the shell kills the backend.

The shell holds a single-instance lock (a second launch signals the first to
focus its window), spawns the backend as a plain-Node
child (`backend/node backend/entry.mjs`), probes the first free port in
14400–14499, waits for the backend's `dsh web: http://127.0.0.1:<port>`
readiness line (60s budget, output echoed with a `[backend]` prefix), and
opens a frameless window at the printed URL. WebView2 initialization scripts
install the `window.dshDesktop` bridge and take over the CSS
`-webkit-app-region: drag` regions the in-page titlebar draws; window-control
commands (`dsh_quit`, `dsh_minimize`, `dsh_toggle_maximize`, `dsh_close`,
`dsh_start_drag`) and the system-browser handoff (`dsh_open_external`, the
account sign-in seam: HTTPS or loopback-HTTP URLs only) are granted to the
loopback origin through a Tauri
capability. Maximize-state changes are pushed to the page as a
`dsh-desktop:window-state` CustomEvent; popups are denied; quitting the shell
kills the backend. The shell's user data stays at `%APPDATA%/CetusPrism`
(Windows) or `$XDG_DATA_HOME/CetusPrism` (Linux), where the installer's hint
file and the shell's decision file have always lived; on Windows, WebView2
keeps its profile under `%APPDATA%/CetusPrism/WebView2`.

## Tray and background mode

Closing the window (titlebar X or Alt+F4) hides it into the system tray
instead of exiting: the backend, its sessions, and any running turns keep
going, and a one-time toast says so. The tray icon (bottom-right, next to
the clock) restores the window on a left click; its menu offers 显示主窗口
and 退出, where 退出 is the real quit (`app.exit(0)`), killing the backend
through the normal exit hook. A second launch signals the first instance,
which now also unhides the window. The in-page 退出 path (`dsh_quit`) quits
the same way.

The shell also serves the web surface's own toasts: `dsh_notify` shows a
WinRT toast under the app's `com.cetusprism.desktop` AppUserModelId, whose
HKCU identity the shell registers at boot (display name only), and the
client package `ui-desktop-notify` raises task-completion and failure
toasts through it while the window is unfocused.

## CLI shims and the installer's PATH page

`pack-tauri.mjs` writes two CLI shims into `<install>/bin`: `dsh.cmd`
(cmd/PowerShell) and `dsh` (POSIX sh, for Git Bash). Both resolve the
bundled `node.exe` and the CLI entry through script-relative paths, so `dsh
--version`, `dsh --profile headless "task"`, and the rest of the CLI work
from any working directory without the shell running. The same CLI closure
also powers the desktop backend itself, so a CLI-launched session and a
desktop session share the harness home.

The installer shows a page between the directory page and the install step
asking whether to add `<install>\bin` to the user PATH (checkbox checked by
default; English and Chinese copy, other languages fall back to English).
Accepting writes the directory into `HKCU\Environment\Path` (as
REG_EXPAND_SZ, case-insensitive dedupe) and remembers it under
`HKCU\Software\CetusPrism\CliPathDir`; declining on an upgrade reverses a
previous opt-in; a silent install (`/S`) preserves whatever the previous
install chose. Every write broadcasts WM_SETTINGCHANGE so new terminals see
the change without re-login. The uninstaller removes the recorded directory
from the user PATH and clears the marker. The PATH element functions are
exercised against a scratch registry key by a standalone NSIS harness (they
take the registry root/subkey/value as defines for exactly that reason).

## Experimental features

`backend/desktop-experimental.patch.yml` enables the experimental
**Agent Teams** feature set on the desktop: the durable roster and shared
task DAG (`agent-team`), the model-facing team tools (`tool-agent-team`),
and the conversation-header Team action (`ui-agent-team`). The rows restate
`packages/experimental/agent-team-profile/cordis.patch.yml`, the canonical
home of the composition; a `--patch` overlay cannot add a bundle layer to
the auto-initialized `web` profile, which is why the rows are restated
rather than bundled. The packages themselves ship in the runtime closure
already. The host-plane team tools are visible to every session, matching
the experimental bundle's process-wide composition; the loaded rows appear
in Settings → Built-in plugins. To turn the feature off, drop the overlay
from the `--patch` chain in `backend/entry.mjs` and rebuild.

## First-run home inheritance and transfer

The harness resolves its user-data root from `$DSH_HOME` (default `~/.dsh`).
On first launch the shell detects an existing home and asks what to do; a
recorded decision (`%APPDATA%/CetusPrism/dsh-home.json`) replays silently on
every later launch. The decision file format is unchanged from the Electron
shell, so an existing install upgrades in place.

- **Detection precedence:** `$DSH_HOME` env → default `~/.dsh` holding user
  data (any of `.credentials.yaml`, `settings.yaml`, `profiles`,
  `sessions`, `storages`) → the installer's hint file. The installer
  (`build/installer.nsh`) runs the same detection read-only after copying
  files and leaves `install-detected-dsh-home.ini` as the hint; the shell
  re-verifies any hinted path before using it.
- **Inherit** keeps resolution unchanged (`$DSH_HOME` env or `~/.dsh`); the
  decision is recorded so the prompt never runs again.
- **Transfer** copies the existing home into a folder the user picks. The
  install-specific `profiles/node_modules` link projection is excluded (its
  junctions point at the installation that created them; the harness
  re-materializes it at each boot); everything else copies verbatim. The
  original directory is never modified or deleted by the app: the
  confirmation dialog reports both paths and offers to open the original,
  and removal stays manual. A failed copy falls back to inheriting the
  original, and a failed backend boot with a transferred home offers to
  switch back (the original still exists).
- The decision file records `fallbackHome` for that boot-failure fallback;
  nothing in the flow deletes user data.

## Build and pack (Windows)

```sh
pnpm run build:lib && pnpm run build:web   # repo-root face builds the deploy needs
node scripts/build-shell.mjs               # cargo build --release --offline
node scripts/pack-tauri.mjs                # win-unpacked/CetusPrism.exe + backend/
node scripts/make-installer.mjs            # NSIS installer via electron-builder
CetusPrism-<version>-setup.exe  (Windows output: E:/dependency-cache/cetusprism/dist)
```

Nothing in the chain touches the network: the Rust toolchain and the cargo
crate cache live in the dependency cache (`CARGO_HOME`/`RUSTUP_HOME`
override the pinned `E:/dependency-cache` locations), the backend host is a
plain Node executable (`BACKEND_NODE_EXE` overrides the default pinned
node-v24.18.0-win-x64 copy, shipped as `backend/node.exe`), and the NSIS
pack runs through electron-builder with `--prepackaged`. `pack-tauri.mjs`
copies the release executable (icon and version metadata are embedded at
compile time, so no rcedit pass runs), deploys the CLI closure straight into
`resources/app/backend/runtime/` with a hoisted pnpm deploy, heals the
deploy (below), and prunes non-win32-x64 native prebuilds and the
LibreOffice kit. `CARGO_TARGET_DIR` redirects the Rust target tree, and `CETUS_DIST_DIR` redirects the assembled payload and installer output: on Windows both default to `E:/dependency-cache/cetusprism/dist` so the ~500MB artifact stays out of the project tree; other hosts keep `apps/electron/dist`.

## Build and pack (Linux .deb)

```sh
pnpm run build:lib && pnpm run build:web
node scripts/build-deb.mjs
CetusPrism-v<version>-amd64.deb  (apps/electron/dist)
```

The Linux path uses the native Rust/Cargo toolchain, Node, and `dpkg-deb`; it
does not require Docker. Rust, Cargo, pnpm, WebKitGTK development files, and
musl tools may all live in the shared dependency cache. Override locations with
`CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR`, and `CETUS_NATIVE_SYSROOT`.
The script temporarily copies the web build into Tauri's `frontend` directory
and restores the source placeholder after compiling. Missing crates are
downloaded into the shared Cargo cache unless `CETUS_CARGO_OFFLINE=true` is
set.

The package contains the native Tauri shell, web frontend, Node backend
runtime, Linux glibc/musl native extensions, `/usr/bin/dsh`, and the desktop
launcher. Windows and Linux Rust target trees live under the shared cache's
`cargo/targets/` directory.

The Ubuntu 22.04.2 LTS adapter uses a shared sysroot and never installs system
packages. Set `CETUS_UBUNTU_TARGET=22.04.2` and
`CETUS_UBUNTU_SYSROOT=/home/kalcirite/dependency-cache/sysroot/ubuntu-22.04.2`
to link the Rust shell, GTK/WebKitGTK bindings, and native Node extensions
against Ubuntu 22.04's glibc 2.35 baseline. The sysroot, GCC 11, development
packages, and pnpm remain in the shared dependency cache.

```sh
CETUS_UBUNTU_TARGET=22.04.2 \
CETUS_UBUNTU_SYSROOT=/home/kalcirite/dependency-cache/sysroot/ubuntu-22.04.2 \
CETUS_CARGO_OFFLINE=true \
node scripts/build-deb.mjs
```

## Deploy layout: hoisted, self-contained

The backend runtime is a hoisted pnpm deploy:

```sh
pnpm --filter @deepseek-ai/dsh deploy --prod --offline \
  --node-linker=hoisted --config.inject-workspace-packages=true <runtime-dir>
```

`--node-linker=hoisted` produces one flat, fully materialized `node_modules`
with no junctions, so copying or archiving the tree cannot sever resolution.
`--config.inject-workspace-packages=true` is required for a non-legacy
deploy of a workspace-rooted app: it materializes the workspace packages the
closure depends on (vendor cosmokit/schemastery, the native landlock stubs)
as real directories inside `node_modules` instead of leaving links back into
the repository. The legacy `--deploy --legacy` isolated layout is rejected
without it (`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`), and `--legacy` combined
with `--node-linker=hoisted` installs no `node_modules` at all.

The deploy root's dependency list is the whole runtime closure. pnpm deploy
materializes `dependencies` transitively but never auto-installs unsatisfied
`peerDependencies`, and the harness declares service definitions
(`@deepseek-ai/dsh-shell`, `dsh-sandbox`, `dsh-fs`, `dsh-session-title-llm`,
…) as peers of the plugins that import them. `apps/cli` therefore declares
the first-party peer closure explicitly (mirroring `python/sdk-runtime`'s
deploy-root manifest); a boot with a gap fails loudly with the loader's
`Cannot find package` list naming exactly which packages to add. Upstream's
desktop pack derives the same closure mechanically — its package-set
selector walks `dependencies` **and** `peerDependencies` of the packed
first-party packages (`apps/desktop/scripts/prepare-package-set.ts`).

`heal-deploy-links.mjs` runs after every deploy in one of two modes, decided
by whether `.pnpm` holds instance directories:

- **Hoisted (shipped).** Verification only: every workspace-override package
  must be present as a real injected copy, and the junction invariant walks
  must find nothing — a junction's absolute target dangles once the app
  installs to any other path, and the NSIS archiver never finishes scanning
  a cross-referencing junction graph.
- **Isolated (legacy fallback).** pnpm keeps transitive deps only inside
  `.pnpm` instance dirs, which the launcher's profile-fallback walk never
  enters (`resolve.paths` never reaches `.pnpm`), and leaves `link:`
  junctions to the source repository. The heal materializes the closure to
  the top level, repoints stray junctions into the runtime tree, and
  materializes every remaining junction into a real copy.

Packing prunes non-win32-x64 native prebuilds (node-pty ships four platforms
at ~58M per copy; the NSIS artifact only ever installs on win32-x64).
`audit-junctions.mjs` re-checks the packed tree: every junction must resolve
inside it.

## Runtime choice

The window shell is a 4-5 MB Rust executable that hosts WebView2 (a Windows
system component; Windows 10/11 ship it) instead of an Electron runtime, and
the backend still runs on a plain Node v24.18.0 executable
(`backend/node.exe`): the backend's native loader accepts only exact
Electron versions (43.0.0/44.0.0/45.0.0-alpha.6), so Electron-as-Node was
never a usable host and the plain Node executable remains the packaged
backend host. The backend's session persistence uses
`node:zlib.createZstdDecompress`, which needs Node ≥ 22.15; the bundled Node
24 satisfies it.

## Machine-local state

First boot initializes `$DSH_HOME/profiles/web` from the bundled profile
templates and heals its module fallback with junctions into the packed
runtime. If the installation moves, delete `$DSH_HOME/profiles/node_modules`
— the launcher re-heals stale junctions but does not re-point existing ones.
