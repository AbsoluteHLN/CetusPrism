# dsh-electron

[English](README.md) | 中文

CetusPrism 桌面壳：一个 Rust（Tauri 2）窗口，承载 `dsh --profile web` 提供的同一 web 界面，后端随应用一起打包（Windows 渲染走 WebView2，Linux 走 WebKitGTK）。本目录保留历史上的 `apps/electron` 目录名与 `@deepseek-ai/dsh-electron` 包名。

## 架构

```
apps/electron/
  src-tauri/src/main.rs    shell: single instance, spawn backend, wait for
                           readiness, show frameless window, kill backend on exit;
                           tray icon, close-to-tray background mode
  src-tauri/src/platform_win.rs   Windows 平台面：命名互斥单实例、焦点事件、
                           kill-on-close job object、WinRT 通知、%APPDATA% 用户数据
  src-tauri/src/platform_linux.rs  Linux 平台面：Unix socket 单实例与焦点信号、
                           后端独立会话 + 父进程死亡信号、notify-send、XDG 用户数据
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
  scripts/pack-tauri.mjs             assemble dist/win-unpacked (no network)
  scripts/heal-deploy-links.mjs      deploy-layout invariant gate (see below)
  scripts/audit-junctions.mjs        verify every junction stays inside the runtime tree
  scripts/make-installer.mjs         NSIS installer via electron-builder --prepackaged
  scripts/build-deb.mjs              Linux .deb 构建：在 cetusprism/linux-build 容器内
                                     编译壳并调用 pack-linux.mjs
  scripts/pack-linux.mjs             容器内运行：staging + pnpm deploy + dpkg-deb 组装
  docker/linux-build.Dockerfile      Linux 构建镜像（rust:1-bookworm + WebKitGTK 等）
  build/installer.nsh      NSIS custom page + hooks: the CLI PATH opt-in page
                           (user PATH write, marker registry value, WM_SETTINGCHANGE
                           broadcast), the harness-home detection hint, and the
                           uninstall-time PATH cleanup
```

平台行为按面拆分而非复制：`main.rs` 通过 cfg 别名按平台选择 `platform` 模块，两侧函数签名一致。单实例方面，壳持有一个命名互斥量（Windows）或绑定 `$XDG_RUNTIME_DIR` 下的 Unix socket（Linux；第二次启动连接该 socket 通知第一个实例聚焦窗口），以普通 Node 子进程拉起后端（`backend/node.exe backend/entry.mjs`，Linux 为 `backend/node`），在 14400–14499 之间探测第一个空闲端口，等待后端输出 `dsh web: http://127.0.0.1:<port>` 就绪行（预算 60 秒，输出带 `[backend]` 前缀回显），然后按打印的 URL 打开无边框窗口。WebView2 初始化脚本安装 `window.dshDesktop` 桥，并接管页内标题栏绘制的 CSS `-webkit-app-region: drag` 区域；窗口控制命令（`dsh_quit`、`dsh_minimize`、`dsh_toggle_maximize`、`dsh_close`、`dsh_start_drag`）与系统浏览器移交（`dsh_open_external`，账号登录接缝：仅允许 HTTPS 或 loopback HTTP）通过 Tauri capability 授予 loopback 来源。最大化状态变化以 `dsh-desktop:window-state` CustomEvent 推送到页面；弹窗一律拒绝；壳退出时杀掉后端。壳的用户数据保持在 `%APPDATA%/CetusPrism`（Windows；Linux 为 `$XDG_DATA_HOME/CetusPrism`），安装器提示文件与壳的决策文件一直在这里；WebView2 的配置档位于 `%APPDATA%/CetusPrism/WebView2`（Linux 的 WebKitGTK 自管 XDG 目录）。

## 托盘与后台模式

关闭窗口（标题栏 X 或 Alt+F4）不再退出，而是隐藏到系统托盘：后端、其会话与运行中的回合继续执行，并弹出一一次性提示通知。托盘图标（任务栏右下角）左键点击恢复窗口；其菜单提供「显示主窗口」与「退出」，其中「退出」是真正的退出（`app.exit(0)`），经常规退出钩子杀掉后端。第二次启动会通知第一个实例，现在也会把隐藏的窗口恢复出来。页内退出路径（`dsh_quit`）以同样方式退出。

外壳同时为 web 界面提供系统通知能力：`dsh_notify` 以应用的 `com.cetusprism.desktop` AppUserModelId 展示 WinRT 通知（外壳启动时在 HKCU 注册该身份，仅含显示名），客户端包 `ui-desktop-notify` 在窗口未聚焦时经此弹出任务完成与失败提醒。

## CLI shim 与安装器的 PATH 选择页

`pack-tauri.mjs` 在 `<安装目录>/bin` 写入两个 CLI shim：`dsh.cmd`（cmd/PowerShell）与 `dsh`（POSIX sh，供 Git Bash 使用）。两者都通过脚本相对路径解析随包的 `node.exe` 与 CLI 入口，因此无需运行桌面壳，即可在任意工作目录使用 `dsh --version`、`dsh --profile headless "任务"` 等完整 CLI。同一 CLI 闭包也是桌面后端本身，CLI 启动的会话与桌面会话共享 harness home。

安装器在目录页与安装步骤之间显示一页，询问是否把 `<安装目录>\bin` 加入用户 PATH（复选框默认勾选；文案提供中英文，其余语言回退英文）。接受后该目录写入 `HKCU\Environment\Path`（REG_EXPAND_SZ、大小写不敏感去重），并记录在 `HKCU\Software\CetusPrism\CliPathDir`；升级时取消勾选会撤销先前加入的条目；静默安装（`/S`）保留上一次安装的选择。每次写入都广播 WM_SETTINGCHANGE，新开的终端无需重新登录即可看到变化。卸载程序会从用户 PATH 移除记录的目录并清除标记。PATH 元素函数将注册表根/子键/值名作为 define 暴露，独立 NSIS 测试以临时注册表键实测这组函数。

## 实验性功能

`backend/desktop-experimental.patch.yml` 在桌面端启用实验性的 **Agent Teams**（智能体团队）能力：持久的成员名册与共享任务 DAG（`agent-team`）、面向模型的团队工具（`tool-agent-team`），以及会话头部的 Team 操作（`ui-agent-team`）。这些行复述 `packages/experimental/agent-team-profile/cordis.patch.yml`（组合的规范出处）；`--patch` overlay 无法向自动初始化的 `web` profile 添加 bundle 层，因此只能复述而不能引用 bundle。这些包本身已在运行时闭包中随附。宿主平面的团队工具对所有会话可见，与实验 bundle 的进程级组合一致；加载后的行显示在「设置 → 内置插件」。要关闭该功能，从 `backend/entry.mjs` 的 `--patch` 链中去掉该 overlay 并重新打包。

## 首次运行的 home 继承与转移

harness 从 `$DSH_HOME`（默认 `~/.dsh`）解析其用户数据根目录。首次启动时壳会检测既有 home 并询问如何处理；已记录的决策（`%APPDATA%/CetusPrism/dsh-home.json`）在此后的每次启动中静默重放。决策文件格式与 Electron 壳完全一致，既有安装可原地升级。

- **检测优先级：** `$DSH_HOME` 环境变量 → 持有用户数据的默认 `~/.dsh`（`.credentials.yaml`、`settings.yaml`、`profiles`、`sessions`、`storages` 任一存在）→ 安装器提示文件。安装器（`build/installer.nsh`）在复制文件后以只读方式运行同一检测，并留下 `install-detected-dsh-home.ini` 提示；壳在使用任何提示路径前会重新验证。
- **继承** 保持解析不变（`$DSH_HOME` 环境变量或 `~/.dsh`）；决策会被记录，此后不再弹窗。
- **转移** 把既有 home 复制到用户选择的文件夹。安装特定的 `profiles/node_modules` 链接投影被排除（其 junction 指向创建它的安装；harness 在每次启动时重新物化）；其余内容原样复制。应用从不修改或删除原目录：确认对话框会报告两个路径并提供打开原文件夹的选项，删除始终是手动操作。复制失败时回退为继承原目录；转移后的 home 启动失败时提供切回原目录的选项（原目录仍然存在）。
- 决策文件为该启动失败回退记录 `fallbackHome`；整个流程不删除任何用户数据。

## 构建与打包（Windows）

```sh
pnpm run build:lib && pnpm run build:web   # repo-root face builds the deploy needs
node scripts/build-shell.mjs               # cargo build --release --offline
node scripts/pack-tauri.mjs                # dist/win-unpacked/CetusPrism.exe + backend/
node scripts/make-installer.mjs            # NSIS installer via electron-builder
dist/CetusPrism-<version>-setup.exe
```

整条链路不触碰网络：Rust 工具链与 cargo crate 缓存位于依赖缓存中（`CARGO_HOME`/`RUSTUP_HOME` 可覆盖钉死的 `E:/dependency-cache` 位置），后端宿主是普通 Node 可执行文件（`BACKEND_NODE_EXE` 可覆盖默认钉死的 node-v24.18.0-win-x64 副本，即随包的 `backend/node.exe`），NSIS 打包经 electron-builder 以 `--prepackaged` 运行。`pack-tauri.mjs` 复制 release 可执行文件（图标与版本元数据在编译期嵌入，因此不再运行 rcedit），以 hoisted pnpm deploy 把 CLI 闭包直接部署到 `resources/app/backend/runtime/`，执行 heal（见下文），并裁剪非 win32-x64 原生预编译产物与 LibreOffice kit。`CARGO_TARGET_DIR` 可重定向 Rust 目标树。

## 构建与打包（Linux .deb）

```sh
docker build -f docker/linux-build.Dockerfile -t cetusprism/linux-build .   # 一次
node scripts/build-deb.mjs
dist/CetusPrism-v<版本>-amd64.deb
```

构建在 `cetusprism/linux-build` 容器内进行（Debian bookworm，即 deb 要求的 glibc）：Tauri 壳对挂载的 cargo registry 缓存离线编译（WebKitGTK 4.1），随后 `pack-linux.mjs`——运行在挂载的 Linux Node v24.18.0 上——staging 出 `dist/linux-unpacked`，用同一 hoisted pnpm deploy 部署运行时闭包，裁剪非 linux-x64 预编译产物，并用 `dpkg-deb` 组装 deb：`/opt/CetusPrism/`、`cetusprism.desktop` 启动项、hicolor 图标与 `/usr/bin/dsh` shim。与 Windows 链路不同，容器内的 deploy 走宿主代理联网（`HTTP(S)_PROXY`，默认 `host.docker.internal:7897`）——store 在 Windows 侧填充，Linux 变体的可选原生包仍需获取。Windows 与 Linux 的目标树在依赖缓存 `cargo/targets/` 下并列（`cetusprism`、`cetusprism-linux`）。

## 部署布局：hoisted、自包含

后端运行时是一次 hoisted pnpm deploy：

```sh
pnpm --filter @deepseek-ai/dsh deploy --prod --offline \
  --node-linker=hoisted --config.inject-workspace-packages=true <runtime-dir>
```

`--node-linker=hoisted` 产生单一扁平、完全物化的 `node_modules`，没有 junction，因此复制或归档该树不会切断解析。对工作区根应用的非 legacy deploy 必须加 `--config.inject-workspace-packages=true`：它把闭包依赖的工作区包（vendor cosmokit/schemastery、原生 landlock 桩）物化为 `node_modules` 内的真实目录，而不是留回仓库的链接。缺少它时 legacy `--deploy --legacy` 隔离布局会被拒绝（`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`）；而 `--legacy` 与 `--node-linker=hoisted` 组合则完全不安装 `node_modules`。

deploy 根的依赖清单就是整个运行时闭包。pnpm deploy 只按传递关系物化 `dependencies`，从不自动安装未满足的 `peerDependencies`，而本仓库把服务定义（`@deepseek-ai/dsh-shell`、`dsh-sandbox`、`dsh-fs`、`dsh-session-title-llm` 等）声明为引入它们的插件的 peer。因此 `apps/cli` 显式声明 first-party peer 闭包（与 `python/sdk-runtime` 的 deploy 根清单同一模式）；闭包有缺口时启动会大声失败，加载器的 `Cannot find package` 列表会精确指出需要补充哪些包。上游桌面打包用机械化方式推导同一闭包——其 package-set 选择器遍历打包后 first-party 包的 `dependencies` **和** `peerDependencies`（`apps/desktop/scripts/prepare-package-set.ts`）。

`heal-deploy-links.mjs` 在每次 deploy 后运行，按 `.pnpm` 是否持有实例目录分两种模式：

- **Hoisted（随附形态）。** 仅验证：每个 workspace 覆盖包都必须以真实注入副本存在，且 junction 不变量遍历必须一无所获——一旦应用安装到其他路径，junction 的绝对目标就会悬空，NSIS 归档器也永远扫不完交叉引用的 junction 图。
- **Isolated（legacy 回退）。** pnpm 只把传递依赖保留在 `.pnpm` 实例目录里（启动器的 profile 回退遍历从不进入 `.pnpm`，`resolve.paths` 到不了 `.pnpm`），并留下指回源仓库的 `link:` junction。heal 会把闭包物化到顶层，把游离 junction 重指进运行时树，并把剩余 junction 物化为真实副本。

打包时裁剪非 win32-x64 原生预编译产物（node-pty 附带四个平台、每份约 58M；NSIS 产物只装 win32-x64）。`audit-junctions.mjs` 复查打包结果：每个 junction 都必须解析到树内。

## 运行时选择

窗口壳是 4–5 MB 的 Rust 可执行文件，宿主 WebView2（Windows 系统组件；Windows 10/11 自带），而非 Electron 运行时；后端仍运行在普通 Node v24.18.0 可执行文件（`backend/node.exe`）上：后端的原生加载器只接受确切的 Electron 版本（43.0.0/44.0.0/45.0.0-alpha.6），Electron-as-Node 从来不可用作宿主，普通 Node 可执行文件保持为打包的后端宿主。后端的会话持久化使用 `node:zlib.createZstdDecompress`，需要 Node ≥ 22.15；随包的 Node 24 满足该要求。

## 机器本地状态

首次启动时，harness 用随附 profile 模板初始化 `$DSH_HOME/profiles/web`，并以指向打包运行时的 junction 修复其模块回退。如果安装位置移动，删除 `$DSH_HOME/profiles/node_modules`——启动器会重新修复失效的 junction，但不会重指既有 junction。
