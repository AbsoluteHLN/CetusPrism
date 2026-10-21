# CetusPrism 整理 · 上游升级 · 闭环核验（2026-10-22）

- 仓库：`E:\Projects\CetusPrism`，分支 `release/v1.7.3`
- 评审基线 HEAD：`9f0ab4bfb78bc0baf27138363e7ba97b4be42db6`
- 上游：`github.com/deepseek-ai/deepseek-harness`，远端名 `official`，`refs/remotes/official/master` = `687f282e8625c6b8d11ff58211a90524be2e4317`
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
仍是 `687f282e86`，与账本 `docs/UPSTREAM.alignment.json` 记录的 `upstreamCommit` 完全一致。
**官方最新上游库已拉齐，没有可拉的新版本。** 且本 fork 与官方**没有共同祖先**
（`git merge-base --all HEAD official/master` 为空），因此不能 merge/rebase。

所以「升级」的真实内容只能是：**按仓库既有规矩做窄范围回移 + 刷新对齐账本**。

### 4.2 筛选方法（账本规矩：窄范围、preimage 精确、可验证）

1. 分叉面：`git diff --name-only ec48669f48 HEAD`（fork 改了 1435 个文件）
   vs `git diff --name-only ec48669f48 official/master`（上游改了 4059 个文件）
   → 冲突面 439 个文件（client 117 / experimental 39 / subagent 23）
2. 上游 1281 个非 merge 提交里，**567 个**与 fork 分叉面零重叠
3. 其中 **223 个**的每个改动文件在本 fork 真实存在（避免凭空引入上游路径）
4. 对这 223 个逐个跑 `git apply --check`（工作树实证），**69 个**能干净落地
5. 从中人工复核 diff、排除依赖本 fork 不存在的上游 API 者，挑出 8 个真正相关且低风险的

### 4.3 已回移的 8 个上游修复

| 提交 | 标题 | 为什么相关 |
| --- | --- | --- |
| `288a2bd6dc` | fix(cordis): adopt effect disposers from their owning fiber | 本次根修把跨 fiber 的 contribution 交给 `ctx.effect` 回收，这条上游修复正是该归属语义的正解 |
| `898ed6d192` | fix(api-gateway): count mux traffic as heartbeat liveness | 桌面端长会话靠 mux 保活，空闲长会话不再被当断连 |
| `14e9bf61cb` | fix(hmr,skills): contain watcher errors that arrive after close | 桌面宿主长期挂文件监听，关闭后的迟到错误会变未捕获异常 |
| `df41b7cd2d` | fix(credentials-local): contain watcher errors that arrive after close | 同族：凭据监听错误兜底 |
| `3121a4b5da` | fix(ui-chat): show a stopped notice for turns interrupted by a DSH stop | 被打断的轮次此前无提示，用户会以为卡死 |
| `6ec995d49b` | fix(session-title): keep the first output line and bound the cap by the request | 会话标题取首行 + 按预算截断 |
| `8953554b5e` | fix(web): clip the collapsed right sidebar so PageUp cannot shift the frame | 右侧栏折叠时 PageUp 推移整个框架 |
| `5578ecf655` | refactor(session-projection): return the exact change-feed disposer | 投影订阅返回精确 disposer，避免状态漂移 |

### 4.4 复核过但**故意没回移**的

| 提交 | 不回移的原因 |
| --- | --- |
| `59ba1321eb`（node-pty conpty） | 改动产品里**每一个** Windows 终端的 PTY 分配方式；上游那个 console host 缺陷本机复现不出来，收益不确定而影响面覆盖全部终端 |
| `599b9f45d4`（插件补丁保留） | 依赖上游 app-boot 的 `profilePatchPreset`/`ProfilePatch`，本 fork 没有，回移后编译不过 |
| `15ae753dcd`（预设贡献检查） | 依赖上游 plugin-manager 的 `bundleDeclarations`，本 fork 没有 |

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
5. **上游 vendor/cordis 的 effect 归属语义**：`288a2bd6dc` 修的正是本 fork 依赖的那套语义，
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
