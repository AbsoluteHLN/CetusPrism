# CetusPrism 整理 · 上游升级 · 闭环核验（2026-10-22）

- 仓库：`E:\Projects\CetusPrism`，分支 `release/v1.7.3`
- 评审基线 HEAD：`“chore(release): bump product version to 1.7.3” 版本提升`
- 上游：`github.com/deepseek-ai/deepseek-harness`，远端名 `official`，`refs/remotes/official/master` = `上游 rc.2 合并点（PR #6408）`
- 本轮产出提交：见文末「提交」一节

---

## 1. 用户指出的问题：新建会话 `already registered`

### 1.1 结论

**根因已定位、已修复、已回归覆盖；不再依赖「关掉开关」绕过。** 桌面端 overlay 恢复为
`modelSelectionSettings: true`，Team 的按需选模型能力重新可用。

### 1.2 根因（本轮新认知）

上游 master **根本没有这段代码**：`git diff official/master HEAD -- packages/experimental/tool-agent-team`
的 `+` 行全是本地新增——上游的 `tool-agent-team` 只有 `freshProvider`/`forkProvider`/`interrupt`，
既没有 `modelSelectionSettings` 开关，也没有 `registerListSubagentModels` 调用。
**重复注册是本 fork 自己引入的。**

具体链路：

1. `packages/subagent/tool-subagent/src/index.ts:360-362` → `registerListSubagentModels(runtimeCtx, policy)`
2. `packages/experimental/tool-agent-team/src/index.ts:239-258` → `registerListSubagentModels(scoped, …)`，
   其中 `scoped = agent.ctx`
3. 两者落在**同一个 Agent scope**，而 `packages/core/tools/src/index.ts:746-748` 的
   `NamedEntries` 对同层同名直接抛
   `tool "${name}" is already registered in this scope`
   （安装态位置：`runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js:2634`）

**漏测原因**：fork 自带的护栏测试
`packages/experimental/tool-agent-team/tests/loader-composition.spec.ts` 只挂了 team、没挂 tool-subagent，
所以测不到冲突。

**第二层根因（本轮踩到并修掉）**：这个包被打成**两个入口**——
`lib/index.js` 把 `list-models` 内联进去（`scopeStates` 的一份副本），
`lib/list-models.js` 又是独立的一份。团队走 `@deepseek-ai/dsh-tool-subagent/list-models`，
委派工具走包内 `./list-models.ts`，两侧各有一份模块级状态 → 共享状态永远建立不起来。
所以**状态必须放在进程级注册表里**（`Symbol.for` 键），而不是模块级 `WeakMap`。

### 1.3 改了什么

| 文件 | 改动 |
| --- | --- |
| `packages/subagent/tool-subagent/src/list-models.ts` | 每个 scope 只注册一次；多个贡献者的策略**取交集**；状态放在进程级注册表（`Symbol.for('dsh.tool-subagent.discovery.scope-states')`），跨两个构建入口共享 |
| `packages/experimental/tool-agent-team/src/index.ts` | Team 不再注册第二份工具，改为向共享工具贡献自己收窄后的策略（`teamDiscoveryPolicy`） |
| `packages/experimental/tool-agent-team/tests/loader-composition.spec.ts` | 新增回归用例：委派工具与 Team 同挂一个 Agent scope |
| `apps/electron/backend/desktop-experimental.patch.yml` | `modelSelectionSettings` 由 false 恢复为 true，并写明不变量 |

### 1.4 证据

- **修复前**：新回归用例失败，报错与用户所见完全一致：
  `Error: tool "list_subagent_models" is already registered in this scope`
  （`packages/core/tools/lib/index.js:2634` ← `packages/subagent/tool-subagent/lib/list-models.js` ←
  `packages/experimental/tool-agent-team/src/index.ts:271`）
- **修复后**：`vitest run packages/subagent/tool-subagent packages/experimental/tool-agent-team`
  → **9 个测试文件 / 191 个用例全绿**
- **回归面**：`vitest run --config configs/vitest.config.ts`（12 个受影响包）
  → **109 个测试文件通过 / 2103 个用例通过**；仅 3 个失败，全部是
  `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` 的
  `EPERM: operation not permitted, symlink`（Windows 未开开发者模式/无符号链接权限，与本轮改动无关）

### 1.5 安装态（`D:\Cetus\CetusPrism`）

- 已把修复后的 `dsh-tool-subagent/lib/{index.js,list-models.js}` 换进安装态 runtime
  （原文件备份在 `E:\dependency-cache\cetusprism\backup\tool-subagent-lib-2026-10-22\`）
- `desktop-experimental.patch.yml` 已与仓库源文件同步（sha256 一致：
  `6D47EE653D85854B0EFA1635D6AD87E9411929DB2832CC97730953305BC8713D`），
  `modelSelectionSettings: true`，UTF-8 无 BOM，2481 B
- 新增打包闸门：`scripts/check-offline-pack.mjs` 现在会检查
  「overlay 开了 Team 开关，但产物里的 tool-subagent 运行时代码还是旧版」这一组合并直接失败，
  防止**源码改了、产物没重建**导致崩溃复现

---

## 2. 用户指出的问题：QQ 通道

**未闭环（需要用户本人操作）**：必须用手机 QQ 扫码登录，并处理 168 安全风险提示。
本机无法代做。本轮未改动 QQ companion 的任何接线代码。

## 3. 用户指出的问题：模型探针

**部分闭环**：会话级模型选择（`subagent-model-selection-settings`）与
`agent-default-model`（csu/Qwen/xhigh）保持原状，未被本轮改动影响；
Team 的按需选模型能力在 overlay 恢复为 true 后重新可用（修复前被开关关着）。

---

## 4. 上游升级

### 4.1 「拉最新上游」的真相

重新 fetch（走 `127.0.0.1:7890` 代理）后：**官方 master 自 2026-10-17 起没有新提交**，
仍是 `上游 rc.2 合并点（PR #6408）`，与账本 `docs/UPSTREAM.alignment.json` 记录的 `upstreamCommit` 完全一致。
**官方最新上游库已拉齐，没有可拉的新版本。** 且本 fork 与官方**没有共同祖先**
（`git merge-base --all HEAD official/master` 为空），因此不能 merge/rebase。

所以「升级」的真实内容只能是：**按仓库既有规矩做窄范围回移 + 刷新对齐账本**。

### 4.2 筛选方法（账本规矩：窄范围、preimage 精确、可验证）

1. 分叉面：对「上游 0.2.1-alpha.1 发布点 → HEAD」与「上游 0.2.1-alpha.1 发布点 → official/master」各跑一次 `git diff --name-only <起点> <终点>`：fork 改了 1435 个文件，上游改了 4059 个文件
   → 冲突面 439 个文件（client 117 / experimental 39 / subagent 23）
2. 上游 1281 个非 merge 提交里，**567 个**与 fork 分叉面零重叠
3. 其中 **223 个**的每个改动文件在本 fork 真实存在（避免凭空引入上游路径）
4. 对这 223 个逐个跑 `git apply --check`（工作树实证），**69 个**能干净落地
5. 从中人工复核 diff、排除依赖本 fork 不存在的上游 API 者，挑出 8 个真正相关且低风险的

### 4.3 已回移的 8 个上游修复

| 提交 | 标题 | 为什么相关 |
| --- | --- | --- |
| cordis | fix(cordis): adopt effect disposers from their owning fiber | 本次根修把跨 fiber 的 contribution 交给 `ctx.effect` 回收，这条上游修复正是该归属语义的正解 |
| api-gateway | fix(api-gateway): count mux traffic as heartbeat liveness | 桌面端长会话靠 mux 保活，空闲长会话不再被当断连 |
| hmr/skills | fix(hmr,skills): contain watcher errors that arrive after close | 桌面宿主长期挂文件监听，关闭后的迟到错误会变未捕获异常 |
| credentials-local | fix(credentials-local): contain watcher errors that arrive after close | 同族：凭据监听错误兜底 |
| ui-chat | fix(ui-chat): show a stopped notice for turns interrupted by a DSH stop | 被打断的轮次此前无提示，用户会以为卡死 |
| session-title | fix(session-title): keep the first output line and bound the cap by the request | 会话标题取首行 + 按预算截断 |
| web | fix(web): clip the collapsed right sidebar so PageUp cannot shift the frame | 右侧栏折叠时 PageUp 推移整个框架 |
| session-projection | refactor(session-projection): return the exact change-feed disposer | 投影订阅返回精确 disposer，避免状态漂移 |

### 4.4 复核过但**故意没回移**的

| 提交 | 不回移的原因 |
| --- | --- |
| `“fix(subprocess): back Windows terminals with node-pty's bundled console host” 修复`（node-pty conpty） | 改动产品里**每一个** Windows 终端的 PTY 分配方式；上游那个 console host 缺陷本机复现不出来，收益不确定而影响面覆盖全部终端 |
| `“fix(plugins): preserve scoped patches during Host edits” 修复`（插件补丁保留） | 依赖上游 app-boot 的 `profilePatchPreset`/`ProfilePatch`，本 fork 没有，回移后编译不过 |
| `“fix(plugin): inspect preset contributions before profile activation” 修复`（预设贡献检查） | 依赖上游 plugin-manager 的 `bundleDeclarations`，本 fork 没有 |

### 4.5 上游新方向与本产品的相关性（结论）

上游 10-03 → 10-17 的新增主要面向**托管/云端**：api/remote-access RBAC（155 文件）、
llm-deepseek-account 新包、plugin-market/secret-mask UI、HTTPS web listener。
本 fork 是**本地桌面 + csu provider + ZCode/Pi 后端 + QQ companion**，
这些方向与本产品弱相关，且 HTTPS 那条还依赖 `selfsigned`（本地离线商店没有，装不了）。

### 4.6 账本

`docs/UPSTREAM.alignment.json` 已刷新：fetch 状态、第二轮评审数字、8 个回移提交及理由、
被否决项与原因、重复注册不变量（`discoveryRegistrationInvariant`）、新增证据文件指针。

---

## 5. 整理（零散文件 / 内部结构）

| 项 | 处理 | 结果 |
| --- | --- | --- |
| `verify-evidence/` 328 个证据/日志 | 逐文件搬到 `dev-docs/evidence/cetusprism-2026-10-21/`、`dev-docs/evidence/build-logs/`（仓库既有忽略位） | 已搬空并回收目录 |
| `koutput/CetusPrism-v1.7.3-setup.exe(+.blockmap)` | 与规范目录 `E:\dependency-cache\cetusprism\dist\` 逐字节同哈希（`1A253AE5…` / `E75D08D4…`） | 仓库内副本已回收，只留规范目录一份 |
| `temp/` 重型暂存（`koutput-stage` 630 MB、`offline-pack-probe` 533 MB 等 11 项） | mavis-trash 回收站回收 | 已回收 |
| `temp/cargo-target-offline`（1.72 GB Rust 缓存） | 保留（可再生的构建缓存，但离线重建代价高） | 保留在仓库内 |
| `packages/api/gateway/dist/{index.d.mts,index.mjs}` | **误提交的构建产物**（全仓唯一被跟踪的 dist 文件；该包真正的产物目录是 `lib/`） | `git rm --cached` + `.gitignore` 补 `packages/*/*/dist/`；磁盘文件保留 |
| 三处产物路径不一致 | `scripts/check-offline-pack.mjs`、`apps/electron/scripts/scan-bare-gaps.mjs`、`apps/electron/scripts/audit-junctions.mjs` 里硬编码的 `E:/dependency-cache/...` 改为与 `CETUS_DIST_DIR` 同一套解析规则 | 三处统一 |
| `.gitignore` | 新增 `koutput/`、`verify-evidence/`、`packages/*/*/dist/` | 已提交 |

---

## 6. 自主排查发现的问题（用户没点名的）

1. **仓库 overlay 没回流**（严重）：`apps/electron/backend/desktop-experimental.patch.yml`
   一直是 `true`，而安装态被改成 `false`——**重新打包会把崩溃打回来**。本轮两处已统一为 true
   并修好根因，另加打包闸门拦截「源码与产物不同步」。
2. **打包链不重建产物**：`apps/electron/scripts/pack-tauri.mjs` 只做 `pnpm deploy`，
   不重建 `lib/`。源码改了不重建就会打进旧代码——本轮已用 runtime 检查兜底。
3. **`@deepseek-ai/dsh-agent-loop` 依赖声明缺失**：`packages/subagent/tool-subagent/tests/harness.ts`
   引用了它，但该包 `package.json` 没声明（上游 master 同样没声明）。
   本机 pnpm 隔离布局下解析不到 → `packages/subagent/tool-subagent` 的 4 个测试套件
   **完全无法启动**（`Cannot find package '@deepseek-ai/dsh-agent-loop'`）。
   本轮用本地 junction 临时补链把这 4 个套件跑通（全部通过），**未改仓库依赖声明**
   （改声明必须同步 `pnpm-lock.yaml`，离线无法安全重算，装错会毁掉整个安装态）。
   → 建议下次联网时执行：给该包补 `devDependencies` + `pnpm install --lockfile-only`。
4. **包被打成两个入口导致模块状态分裂**：见 §1.2，是本次根修的第二层根因。
   任何在这类包里放模块级状态的写法都会踩同一个坑。
5. **上游 vendor/cordis 的 effect 归属语义**：`“fix(cordis): adopt effect disposers from their owning fiber” 修复` 修的正是本 fork 依赖的那套语义，
   已回移；安装态 runtime 的 cordis 仍是旧版（本轮未重建部署闭包），下次完整打包会带上。

---

## 7. 已验证 / 未验证

**已验证**

- 重复注册崩溃：修复前回归用例复现同样报错，修复后 191/191 通过
- 受影响面回归：109 文件 / 2103 用例通过（3 例 EPERM 环境失败已说明）
- 8 个上游回移：`git apply --check` 干净落地 + 上述测试全绿
- 安装态 runtime 已换成带修复的产物（含共享注册表标记校验）
- 安装态 overlay 与仓库源 sha256 一致、UTF-8 无 BOM
- 账本 JSON 解析通过、无 BOM
- 全仓不再有被跟踪的 `dist/` 文件

**未验证**

- **桌面端 GUI 里点「新建会话」的端到端**：内置浏览器工具本轮两次调用都 `BROWSER_OPERATION_TIMEOUT`
  （web-only 实例没有桌面壳桥接），GUI 点击仍未能自动验证；替代证据是后端侧
  「同一 scope 双重注册」的回归测试与安装态产物替换。
- **QQ 通道**：需要用户手机扫码 + 处理 168 安全风险。
- **安装态 cordis 与 8 个回移项的运行时代码**：安装态 runtime 只替换了
  `dsh-tool-subagent` 两个文件；其余回移项与 cordis 修复要等下一次完整打包才进安装态。
- **完整重打包**（Tauri shell + NSIS）：本轮未执行（离线、且会覆盖 `E:\dependency-cache\cetusprism\dist`）。
- `packages/skill/skill-filesystem` 的 3 个符号链接用例：需要 Windows 开发者模式或管理员权限。

---

## 8. 提交

本轮所有改动由**父会话统一提交一次**（此前约定：子任务/父会话不各自提交）。

---

## 9. 2026-10-22 12:38 安装态复核与运行时取证

本节记录同日第二轮复核：上一轮只做到「安装态替换 `dsh-tool-subagent` 两个文件 +
源码级回归」，本轮把运行实例、安装态产物与闸门结果一并取证。

### 9.1 运行实例

| 项 | 取值 |
|---|---|
| 桌面壳 | `CetusPrism.exe` pid 25436，启动于 2026-10-22 11:17:43（`D:\Cetus\CetusPrism\CetusPrism.exe`） |
| 后端 | `node.exe` pid 60788，`entry.mjs --port 14400 --no-open` |
| 监听 | 127.0.0.1:14400、127.0.0.1:9230 |
| dsh home | `D:\Cetus\dshconfig`（`.credentials.yaml` 607 B，2026-10-21 21:29:22） |

### 9.2 用户报的问题（新建会话 → `list_subagent_models` 重复注册）：根因修复已在安装态生效

- 安装态 `dsh-tool-subagent/lib/index.js`（39,257 B，**2026-10-22 03:16:22**）与
  `lib/list-models.js`（9,014 B，**03:16:22**）**两个入口都**含
  `Symbol.for("dsh.tool-subagent.discovery.scope-states")`（index.js:173 / list-models.js:45）
  与 `contributors` 合并逻辑（index.js:187/255-263、list-models.js:59/127-135）——
  即两个入口共享同一份 scope 状态，同一 scope 内的第二个注册者只贡献策略，不再重复注册。
- `lib/model-selection-settings.js`（2,845 B，2026-10-21 16:26:28）在位；
  `desktop-experimental.patch.yml`（2026-10-22 03:30:56）把 `modelSelectionSettings` 打开，
  即「根因已修、开关回开」，不是绕过。
- 源码级回归（本次实跑，exit 0）：
  `packages/subagent/tool-subagent` + `packages/experimental/tool-agent-team`
  → **9 文件 / 191 用例全绿**，含 `list-models.spec.ts` 里新增的
  「同一 scope 双注册合并、第一个退出工具仍存活、最后一个退出才释放」回归用例。
- 边界：以上是**产物与源码层**的证据。桌面 GUI 里点「新建会话」的实际点击路径
  本轮无法自动执行（无桌面自动化工具），因此**未做真机端到端确认**，详见 §9.6。

### 9.3 安装态仍未同步的部分

- **8 个上游回移 + vendor/cordis 的 effect 归属修复仍只在仓库侧**。安装态 runtime 由
  2026-10-21 21:46 的安装包生成，2026-10-22 03:16 只热替换了 `dsh-tool-subagent` 两个文件；
  `dsh-experimental-tool-agent-team/lib/index.js` 仍是 2026-10-21 16:26:28 的旧构建。
  补齐需要一次完整打包（离线 + 会覆盖 `E:\dependency-cache\cetusprism\dist`）并重启 App。
- **QQ 通道未通**：`D:\Cetus\dshconfig\bot-companion-host.json` 里 `qq-connector` 每分钟
  `connect close`，历史记录显示 NapCat onebot 端口 6705 45s 内没起来。需要手机扫码 + 处理 168 安全风险。

### 9.4 本轮提交

「chore(runtime): pin the Node floor to the tested matrix and refresh the Engram Go requirement」批次

- node engines 下限对齐 CI 实测矩阵（`.github/workflows/node-addon-system.yml` 跑
  24.22.1 / 22.23.4 / 26.12.1），根包与 5 个 `native/system/packages/*` 统一声明
  `^22.23.4 || >=24.22.1`；共享依赖仓里无任何依赖要求更高（扫描 `node_modules/.pnpm` 最高只到 `>=20`）。
- `docs/user/guide/mcp-memory.md` / `.zh.md`：Engram v1.20.0 的 Go 要求改为 1.26.10+（或 1.27.3+）。
- 钩子：pre-commit（third-party notices / whitespace / vendor manifest guard）全过；
  pre-push typecheck 38.60s 通过；推送范围「agent-loop 测试依赖声明修复批次 → Node 版本下限钉扎批次」落在 `release/v1.7.3`（exit 0）。

### 9.5 node-compat 闸门：4 passed / 2 failed（两条均为环境基线）

| 闸门 | 结果 | 判定 |
|---|---|---|
| dsh source-launch smoke | PASS (13.15s) | — |
| typecheck | PASS (31.27s) | — |
| Vitest jsdom smoke | **FAIL** | 环境基线：`scripts/vitest-environment.compat.spec.ts` 报 `ReferenceError: ResizeObserver is not defined`（jsdom 未提供该全局），与本轮改动无关 |
| profile resolution smoke | **FAIL** | 环境基线：`packages/boot/app-boot/tests/profile-resolution.spec.ts` 报 `EPERM ... symlink`（Windows 未开开发者模式，无法建符号链接） |

### 9.6 仍未验证

- **桌面端 GUI 里点「新建会话」**：本会话无桌面自动化工具（`computer_*` 不可用），
  无法自动点按；替代证据是 §9.2 的安装态产物核验与 191 例回归。
- **QQ 通道**：需用户手机扫码 + 处理 168 安全风险。
- **模型探针真实档位**：需要模型凭据。
- **8 个回移 + cordis 的安装态运行时代码**：需一次完整打包 + 重启窗口。

---

## 10. 2026-10-22 13:20 完整离线重打包与产物验收

§9.3 记录的「安装态缺 8 个回移 + cordis effect 修复」在本节闭环到**可安装产物**层面：
离线重编译 shell、刷新工作区产物、重新装配 runtime 并封装 NSIS 安装包，离线闸门与产物验收均通过。
**安装动作本身（覆盖安装 + 重启 App）仍需用户给窗口**；本节只交付已验证的安装包。

### 10.1 打包前备份（未删除任何既有产物）

| 项 | 值 |
|---|---|
| 备份目录 | `E:\dependency-cache\cetusprism\backup\installer-20261021-2146\` |
| 旧安装包 | `CetusPrism-v1.7.3-setup.exe` 86,699,977 B，sha256 `1a253ae5cc648dc822fcba14adadc51a8f04292c94efe88e3b93f9fb45c9219a` |
| 旧 blockmap | 90,095 B，sha256 `e75d08d431b79c3e2f3e036c41c1f0121ad54287dbe6430c7230c7ac6105f83e` |

两个哈希与 §7 记录一致，确认备份的就是当前 canonical 产物。

### 10.2 第一轮打包：闸门失败，命中两个真实缺陷

装配本身成功（`pack-tauri` exit 0、`make-installer` exit 0），但 `scripts/check-offline-pack.mjs`
**exit 1**：

```
- dev path literal "e:\dependency-cache" x270
- dynamic CRT import "VCRUNTIME140.dll"        (target machine would need the VC++ x64 redistributable)
- dynamic CRT import "VCRUNTIME140_1.dll"
```

根因：装配时复用了 `E:\dependency-cache\cargo\targets\cetusprism\release\CetusPrism.exe`
（2026-10-21 16:25:31）。该 exe 早于 `“fix(discovery): register list_subagent_models once per scope” 批次`（2026-10-22 03:47:52）落到
`apps/electron/scripts/build-shell.mjs` 的两个强制开关：

- `--remap-path-prefix=E:\dependency-cache=cargo-cache`——Rust 把 `file!()` 烘进 `.rdata` 的
  panic 定位串，`strip = "symbols"` 去不掉，只有 remap 能改写；
- `-C target-feature=+crt-static`——静态链接 MSVC CRT，目标机无需安装 VC++ x64 运行库。

`build-shell.mjs` 的注释写死了这两个开关的实测效果（"measured: 270 `E:\dependency-cache` hits"、
"`VCRUNTIME140.dll` / `VCRUNTIME140_1.dll` in the import table disappear"），与闸门实测逐字吻合。

**由此得到一个关于线上版本的结论**：当前已安装的 v1.7.3（2026-10-21 21:46 的安装包）用的
就是这个 exe，即**已安装版本带着 270 处构建机路径字面量和对 VC++ 运行库的动态依赖**。
这不是本次引入的缺陷，而是「开关落地前出的包」，本节把新包补齐。

### 10.3 第二轮：重编 shell + 刷新工作区产物

| 步骤 | 命令 | 结果 |
|---|---|---|
| 重编 shell | `node apps/electron/scripts/build-shell.mjs` | exit 0，4m45s，exe 4,640,768 → 4,763,648 B |
| 刷新产物 | `pnpm run build:lib`（host + client 两个 face） | exit 0 |
| 装配 runtime | `node apps/electron/scripts/pack-tauri.mjs` | exit 0，14,379 文件；deploy 全离线（downloaded 0 / reused 615） |
| 封装安装包 | `node apps/electron/scripts/make-installer.mjs` | exit 0 |

新 shell 的导入表从 **24 项降到 15 项**：`VCRUNTIME140.dll`、`VCRUNTIME140_1.dll` 与
`api-ms-win-crt-*` 全部消失（静态 CRT 生效）；闸门二进制扫描无 FAIL 行（路径字面量清零）。

`build:lib` 还修掉一个真实问题：`packages/client/ui-chat/lib/client.js` 此前是
**2026-10-21 16:24:04** 的旧构建，而 `src/client/locale.ts` 已在 2026-10-22 03:21 改过——
即「本轮已停止的回合提示」与 locale 改名**从未进入过产物**，旧安装包自然也不含。刷新后已包含。

### 10.4 离线闸门：exit 0

```
check-offline-pack: imported DLLs (15): …（无 vcruntime140*、无 api-ms-win-crt-*）
check-offline-pack: artifact size: 4763648 bytes
  warn: documented exception "e:\projects\cetusprism\apps\electron\src-tauri" x1（已登记例外）
  warn: runtime: the shipped tool-subagent runtime carries the one-registration-per-scope discovery fix
PASS: the pack chain is offline-safe and the shell carries no forbidden path or CRT dependency
GATE_EXIT=0
```

### 10.5 产物验收：两套判据全绿

**判据 A（强）**：按各包 `package.json` 的 `files` glob 取出「应当随包发布」的文件集合，
逐文件比对仓库产物与打包产物的 sha256——11 个包、22 个文件全部同哈希、零异常
（`client/ui-dockkit` 不在 backend runtime 闭包内，见下）。

**判据 B（辅）**：在打包产物整包范围内搜「只有修复后代码才出现」的区分性特征，11 条全中：

| 包 | 标记 | 含义 |
|---|---|---|
| `dsh-api-gateway` | `on("message"` | mux 心跳：任何帧都算存活（旧版只认 pong） |
| `dsh-hmr` | `disposed` | close 之后的 watcher error 不再上报 |
| `dsh-credentials-local` | `reportWatcherError` | 凭据 watcher 错误处理函数 |
| `dsh-skill-filesystem` | `handleWatcherError` | skills watcher 错误处理函数 |
| `dsh-session-title-llm` | `still return a short best-effort title` | session-title 首行截取系统提示 |
| `dsh-client-ui-chat` | `message.failure.interrupted`（旧 key `message.accountStopped` 已消失） | 停止回合提示与 locale 改名 |
| `dsh-client-ui-sidebar-right` | `overflow:clip` | 折叠右栏溢出裁剪（CSS 已内联进产物） |
| `dsh-tool-subagent` | `dsh.tool-subagent.discovery.scope-states` | 根因修复：进程级 scope 状态注册表（两个入口都命中） |
| `dsh-experimental-tool-agent-team` | `teamDiscoveryPolicy` | Team 只贡献策略、不再重复注册 |
| `cordis` | `effectOwners` | cordis effect 归属修复 |

`client/ui-dockkit` 未出现在 backend runtime 闭包里：它是仅前端包，且 `“fix(discovery): register list_subagent_models once per scope” 批次` 对
`DockSurface.tsx` 的改动**只有 JSDoc 注释**，无运行时行为，故不影响产物正确性。

### 10.6 两条判据陷阱（留给下一次复查的人）

1. **不能用新旧共有的标识符做判据**。第一轮用 `missedHeartbeats` 判 api-gateway 的心跳回移，
   但旧代码本来就有这个 Map——于是**陈旧产物被判成通过**。判据必须是修复后才出现的东西。
2. **打包器会内联「单次使用的 const」**。`const dispose = f(); return dispose` 会被打成
   `return f()`，所以 session-projection 的回移不能用 `return dispose` 判；它的判据落在
   「`onChanged` 站点形态」上：修复前是 `return () => void dispose()`（会包一层、丢掉 promise），
   修复后被内联成 `return this.ctx.effect(...)`。据此复核后确认**该回移本来就在产物里**，
   第一轮的「产物陈旧」判断是判据错误，不是构建缺陷。

### 10.7 新安装包

| 项 | 值 |
|---|---|
| 路径 | `E:\dependency-cache\cetusprism\dist\CetusPrism-v1.7.3-setup.exe` |
| 大小 | 86,705,473 B |
| sha256 | `b70152a51b9b7cd8153626d60f134b2f47058e13faaccd41f55b4a24f7a06a8c` |
| blockmap | 90,046 B，sha256 `2801bfad5811a11f3260124dc824f72f9f5b239519e825215897cbb652cf18cb` |
| 旧包（备份） | sha256 `1a253ae5cc648dc822fcba14adadc51a8f04292c94efe88e3b93f9fb45c9219a` |

### 10.8 上游差异与仍未验证

- **上游差异**：`official/master` 领先本 fork **22,394** 个提交（fork 独有 103 个），
  全量回移不现实，延续「逐条挑选上游修复回移」路线；本节 8 个回移即该路线的一次执行。
- **仍未验证**：
  - 桌面 GUI 里点「新建会话」——本会话无桌面自动化工具，未做真机端到端确认；
  - 新安装包尚未安装到 `D:\Cetus\CetusPrism`（需用户给重启窗口），§9.2 的安装态核验结论
    仍只对 2026-10-22 03:16 的热替换版本成立；
  - QQ 通道需手机扫码 + 处理 168 安全风险；模型探针真实档位需模型凭据。
