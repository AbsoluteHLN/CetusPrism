# ZCode / Pi 外部运行时接入现状与底层接入方案

> 状态：研究稿（2026-11-01）。本轮不改产品决策，只记录实测事实、协议缺口、按 seam 排布的落地步骤与验证计划。
> 相关文档：`dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md`、`dev-docs/2026-10-22-zcode-agentloop-parity.md`、`dev-docs/2026-10-20-multibase-refactor-spec-v2.zh.md`、`.workbuddy/memory/2026-10-29.md`。

## 一、当前架构与真实可用面

两条互不衔接的契约：

1. **目录/探测契约**：`BuiltinAgentBackendProvider.describe()` 只回答版本、来源与兼容性（`packages/preset/agent-preset-registry/src/backend.ts:45-53`）；`AgentPresetRegistry.registerBackend()` 是宿主入口（`src/index.ts:168-170`），Remote 暴露为 `backends`（`:176-179`）。DSH 硬编码就绪；Pi/ZCode 行来自探针（`backend.ts:63-71,219-244`）。
2. **执行契约**：`ExternalRuntimeAdapter` 提供 `capabilities/start/stop/request/subscribe`（`src/external-runtime.ts:358-373`）；Pi 适配器 `src/external-runtime-pi.ts`，ZCode 适配器 `src/external-runtime-zcode.ts`，传输与请求关联在 `src/external-runtime-transport.ts`。

真实可用面（本轮核对）：

| 能力 | 状态 | 证据 |
|---|---|---|
| 定位并探测已安装运行时 | 可用 | `external-runtime.ts:282-314` |
| 诚实的未配置/不兼容目录行 | 可用 | `backend.ts:219-244`、`backend.spec.ts` |
| 编程式注册/注销 provider | 仅测试 | `backend.spec.ts:50-89`、`registry.spec.ts:381-392` |
| Pi JSONL 请求关联与事件归一 | 对 fake 子进程可用 | `external-runtime-pi.ts`、`tests/external-runtime-adapters.spec.ts` |
| ZCode NDJSON 关联与通知归一 | 对 fake 子进程可用 | `external-runtime-zcode.ts`、同上 |
| 源码构建 clone→install→build→probe→回执 | 对本地 git fixture 可用 | `source-build.ts`、`tests/source-build.spec.ts` |
| **生产环境注册 provider** | **不存在** | 全仓唯一 `registerBackend` 调用在测试 |
| **会话绑定后端** | **不存在** | `backend-store.ts:181-188` 明确拒绝非 DSH；会话头无后端字段 |
| **Agent 执行外部运行时** | **不存在** | 无 `AgentFactory` 分派、无适配器消费者 |
| **设置页安装入口** | **不存在** | `installExternalRuntimeFromSource` 仅测试调用 |

结论：协议线（wire layer）是扎实的，产品集成止步于“探测 + 目录”。`select()` 的拒绝是**有意设计**，不是缺陷；在会话绑定落地前保持诚实拒绝。

## 二、本轮已修复的真实缺陷

1. **停止泄漏未决请求**：两个适配器的 `stop()` 先置空 `transport` 再停止，`onExit()` 因 transport 为空提前返回，`requests.failAll()` 永不执行——所有 `request()` 永久挂起。现改为 `stop()` 先 `failAll(new Error('<runtime> stopped'))`（`external-runtime-pi.ts`、`external-runtime-zcode.ts`）。
2. **启动超时泄漏子进程**：Pi 的 `get_state` 超时只清空 `this.transport`，子进程继续运行。现补 `void transport.stop()`。
3. **spawn 失败与 stdin EPIPE 无人处理**：传输层只监听 `exit`，不监听 `error`；ENOENT 会让 `start()` 等满 10 秒。现新增 `onError` 回调，适配器收到后 `failAll` 并发 `notice`（`external-runtime-transport.ts`）。
4. **请求无超时**：静默运行时会让调用方永久挂起。现 `requestTimeoutMs`（默认 30s）在适配器选项上，超时以明确方法名报错。
5. **源码构建供应链守卫未接入流水线**：`assertUpstreamSource()` 有定义但 `installExternalRuntimeFromSource()` 没调用，注释承诺的守卫可被绕过。现流水线强制校验，测试用 `allowUnofficialSource` 显式豁免本地 fixture。

## 三、协议级缺口（按上游分类）

### Pi（`pi --mode rpc`）

- 事件词汇有遗漏：`tool_execution_update`、`text_start/end`、`thinking_start/end`、`agent_end`、`turn_start/end`、`compaction_end` 未映射；`run_ended` 从不发出。
- 交互请求完全未处理：`extension_ui_request`（select/confirm/input/editor 对话框）需要 `extension_ui_response` 回复；不回复会阻塞扩展。当前适配器对此静默。
- 会话持久化被配置关闭：默认 `--no-session`，无法恢复；上游提供 `--session-dir`、`new_session`、`switch_session`、`fork`、`get_state.sessionFile`。
- 模型/认证未暴露：Pi 自管 provider/key/thinking；RPC 提供 `get_available_models`、`set_model`、`get_available_thinking_levels`，当前均未调用。
- 一个进程 = 一个会话，无多会话路由。

### ZCode（`zcode app-server --stdio`）

- 无握手：`start()` 以“收到任意第一行”作为就绪；健康但静默的服务器会等到 10s 超时，无关的首帧会误判就绪。
- 事件词汇未与官方 schema 对齐：当前按 `model.streaming`/`tool.updated`/`turn.*` 解析；官方 `live-session-updates.md` 描述 token 级流式尚未实现，未来映射为 `session/update` + `agent_message_chunk`。若服务器改用该词汇，事件会被静默丢弃。
- 交互请求被结构化拒绝：`interaction/requestPermission` 与 `interaction/requestUserInput` 以 `-32601` 拒绝，但 `capabilities()` 声称 `hostPermission/hostUserInput: true`——自相矛盾，任何需要授权的工具都会失败且无用户补救。
- 取消语义缺失：上游是 `session/cancel` 通知（`stopReason: "cancelled"`），当前只把 `turn.completed(resultType==='cancelled')` 映射成 `idle.aborted`；`turn.failed` 反而报成 `idle.aborted:false`。
- 会话能力未用：`session/resume/list/read/messages/events/subscribe`、`session/lifecycle/*` 均未调用；`session/create` 返回的 `sessionId` 被丢弃，多会话无法按 payload 的 `sessionId` 分流。
- 认证是外部流程：`zcode login` 是浏览器流程，app-server 无法代做；已登出的运行时会显示 ready。

## 四、按 seam 排布的落地步骤（关键路径 0–4）

### 步骤 0：钉住协议契约并修订决策记录

- 在 registry 包测试下保存两个上游的协议 fixture（Pi 的 `rpc.md`/`rpc-commands.md`/`json.md`/`rpc-extension-ui.md`；ZCode 的 `zcode-protocol/index.ts` 与 app-server 设计文档），记录上游 commit；不 vendor 源码。
- 把 `minVersion` 的 CLI 语义版本比较换成“经验证的上游版本区间 + 能力标识”；探针优先协商能力。
- 在计划文档补记产品决策变更：获取方式改为“源码构建接入”，执行允许真实外部运行时；外部权限 broker 是授权链（本机不承诺自己的权限链）。

### 步骤 1：生产环境注册 provider

- 新增宿主编排插件（如 `external-runtime-bootstrap.ts`），在 `ctx.effect` 内调用 `ctx.agentPresets.registerBackend(...)`；由 web-app bundle patch 挂载。
- 持久化显式可执行路径、回执 commit/version、启用位；不持久化凭据。
- 把 `BuiltinAgentBackendProvider` 从“只描述”扩为执行 provider：`describe/capabilities/createSession/listModels/dispose`。

### 步骤 2：能力协商与诚实目录

- 扩展 `ExternalRuntimeCapabilities` 与 `AgentBackendCapabilities`：协议版本、流式、steer、followUp、cancel、resume、会话持久化、模型列举、思考档位、权限模式、user input、工具执行归属、附件、用量。
- Pi 探针：`get_state` + `get_available_models` + `get_available_thinking_levels`。
- ZCode 探针：`session/lifecycle/getState` + `workspace/readState`。

### 步骤 3：会话级后端绑定

- 会话头字段 + `agent-backend/selected` 事件与投影（对照 `agent-preset/selected`，`src/session.ts:20-44`）。
- 宿主 Remote 校验后创建新会话并保留旧会话；`backend-store.ts` 的拒绝改为调用该 Remote。
- 后端 chip 当前是会话级 slot，但选择语义是“下一个会话”，需要明确文案或移动位置。

### 步骤 4：宿主执行桥（核心缺口）

- `AgentFactory` 单槽学会按会话后端分派，或新增路由实现包裹 loop factory（`packages/core/agent/src/index.ts:164-197`、`agent-loop/src/index.ts:369`）。
- 在 `ExternalRuntimeAdapter` 上实现 `Agent`：`followup/send/steer → prompt/session.send`，`cancel → abort/session.cancel`，`whenIdle → idle 事件`。
- 事件映射进 Session 日志：`run_started → turn/start`、`message_* → assistant/message|attempt`、`tool_* → tool/call|result`、`idle → turn/end`。
- 捕获外部会话标识（Pi `sessionFile/sessionId`；ZCode `session/create` 返回值），只在 Cetus 元数据里保存非敏感 id。

### 步骤 5–8（后续）

- 模型列举/选择与认证就绪探测（Pi `get_available_models`/`set_model`；ZCode `session/setModel`/`setThoughtLevel`/`setMode`，登出时提示 `zcode login`）。
- 权限与用户输入桥：`permission_request`/`user_input_request` 事件 + 回复通道，决策必须绑定 session + toolCallId，未知/超时一律 fail-closed。
- 源码构建配方：Pi `packages/coding-agent/dist/bundle/cli.js` 用 `node <path>` 启动；ZCode 走 turbo/SEA 产物。配方需要从单一 `executable` 扩展为 `{command,args}` 或写 launcher。
- 生命周期硬化：已实现请求超时/停止结算/spawn 错误；剩余：行长度上限、写背压、崩溃后目录标记 faulted、重连策略、ZCode `session/subscribe` 缺口恢复。

## 五、风险

1. 契约漂移：适配器词汇来自散文文档，无钉死 schema；ZCode 的 `model.streaming` 假设可能不匹配已发布服务器。
2. 与既有计划冲突：真实外部执行等于第二个 Agent loop 与第二份会话状态；计划文档当前禁止（`:84`），需显式修订。
3. 双事实源：外部运行时自有会话库；若桥接不把每个模型可见输入/输出写进 Cetus Session，会破坏“模型可见 ⟺ 已记录”。
4. 工具授权错配：`hostSideToolExecution:false` 意味着 Cetus 的 `ctx.tools`/沙箱链不治理外部工具；只有实现步骤 6 才能满足 A06/A07。
5. 同步探测阻塞：`locateExternalRuntime` 用无超时的 `spawnSync`，每次目录读取都会跑；运行时挂起会冻结宿主事件循环。**本轮未修**，应为下一步低风险改造。
6. 版本语义：Pi `minVersion 0.74.0` 与当前 coding-agent 1.4.0 不对应；ZCode `0.1.0` 与 CLI 0.17.1 不对应，且都不是协议版本。
7. Windows 可执行性：源码构建产物是 JS 入口，不能直接 spawn；配方与 `cmd.exe` 回退都需要 launcher 与正确引用。
8. 供应链：守卫本轮已接入流水线，但默认分支构建仍不可复现；应钉 ref 并记录 commit。

## 六、验证计划（与本轮改动对应）

- 已跑：`external-runtime-adapters.spec.ts`（9 用例，含停止结算与 spawn 失败）、`source-build.spec.ts`（含守卫）。
- 待补：行长度上限与 EPIPE、`stop()` 后 `request()` 立即拒绝、超时报文、ZCode 多会话按 `sessionId` 分流、权限回复 fail-closed。
- 真机证据：记录 OS/日期、上游 commit、`--version` 与可执行文件 hash、启动命令、会话 id/事件区间、请求→工具→跟进、允许与拒绝两种权限结果、取消、恢复同一外部会话。未跑时必须标 `not_run`，不得把 mock 结果当真实模型证据。
