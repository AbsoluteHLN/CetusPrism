# CetusPrism Agent 框架现状详解（2026-11-03）

供你评估下一轮修改的完整地图。覆盖：分层结构、数据流、扩展点、Pi/ZCode 接入现状、本轮新增的驱动器接缝、后端强化规则、项目结构约定。

## 1. 分层总览

```
┌─────────────────────────────────────────────────────────────┐
│ 前台（client / apps/web / apps/desktop）                      │
│  会话流渲染 ← 完全由 durable 日志驱动，不认识驱动器种类          │
├─────────────────────────────────────────────────────────────┤
│ Host 层（packages/client/*、bundle、api）                     │
│  AgentPresetSeat（预设chip）  AgentBackendSeat（后端chip）     │
│  backend-store：目录 / 选择持久化 / backendSeatVisible        │
├─────────────────────────────────────────────────────────────┤
│ 注册与工厂（packages/core）                                   │
│  AgentRegistry（dsh-agent）  ← 运行时面 Agent 契约             │
│  AgentLoop（dsh-agent-loop）  ← 生命周期/工厂/ teardown        │
│    ├─ ReactLoopAgent（默认驱动器：prompt 组装→LLM→工具）        │
│    └─ ExternalAgentDriver（本轮新增：外部运行时驱动器）          │
├─────────────────────────────────────────────────────────────┤
│ 地基（packages/core、llm、session）                           │
│  Session 追加式日志（唯一事实源）  LLM 提供方  工具运行时        │
│  会话投影（turnBoundary / inbox → 派生态）                     │
├─────────────────────────────────────────────────────────────┤
│ 外部运行时（packages/preset/agent-preset-registry）            │
│  PiRuntimeAdapter / ZCodeRuntimeAdapter（子进程 + stdio 协议） │
│  source-build（clone→build→register）  external-runtime-*    │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心数据流（不变量）

**追加式会话日志是唯一事实源。** 一切模型可见内容必须先进日志（`model-visible ⟺ logged`）；前台只是日志的投影。

一轮原生（ReactLoop）回合的事件序列：
`turn/start → step/start → (system/message) → user/message → request/header → [流式chunk] → assistant/message(带stream记录) → tool/call → tool/result → … → step/end → turn/end{reason}`

关键类型（`packages/core/session/src/types.ts` 的 `SessionEventMap`）：
- `turn/start|end`、`step/start|end`：边界；`turn/end.reason` ∈ completed/aborted/blocked/error/max-tokens
- `user/message`、`assistant/message`（含紧凑流记录 + usage + interrupted 标记）、`assistant/attempt`（无表面消息的失败尝试）
- `tool/call` + `tool/result`（result 用 `sourceEventSeqs` 回指 call）
- `request/header`、`request/context`：调用配置快照 / 路由元数据
- `agent/inbox/spliced`：inbox 两个待处理列表（next-turn / next-step）的持久变更

投影（`session-projections`，数据驱动）：`turnBoundary`（开回合/步骤水位）、`inbox`（待处理输入重建）。前台和驱动器都读投影，不扫日志。

## 3. Agent 运行时面（驱动器契约）

`packages/core/agent/src/runtime-types.ts` 声明、由模块增强合并出的完整 `Agent` 面：
`options / session / inbox / status / ctx` + 方法 `send / followup / steer / inject / cancel / whenIdle / runMaintenance`。

生命周期语义（两种驱动器共享同一套）：
- `followup` → next-turn 队列，唤醒驱动器；`steer` → next-step；`inject` → next-step 不唤醒
- 唤醒后清空的 message 仍开启回合边界（无步骤即 completed）
- `cancel(cause, {keepInbox})`：清队列（除非保留）+ 中止活动信号
- `whenIdle` 跟随替换工作直到真正收敛

**驱动器接缝（本轮新增）**：`AgentDriver extends Agent { readonly scope: Scope }`，`AgentDriverFactory = (loopCtx, id, options, session) => AgentDriver`。`CreateAgentOptions.driver` / `ResumeAgentOptions.driver` 可显式指定；缺省 = ReactLoopAgent。装配点在 `agent-loop/src/index.ts` 的 `prepare()`。

## 4. 外部运行时接入现状（Pi / ZCode）

### 已落地（本轮及前一轮）
| 件 | 位置 | 状态 |
|---|---|---|
| 共享传输（LF分帧/请求关联/.cmd回退） | `external-runtime-transport.ts` | ✅ 测试覆盖 |
| Pi 适配器（`pi --mode rpc --no-session`，命令信封吸收） | `external-runtime-pi.ts` | ✅ 含 runTurn/abortTurn |
| ZCode 适配器（`zcode app-server --stdio`，NDJSON 复用 parseRuntimeFrame） | `external-runtime-zcode.ts` | ✅ 含惰性 session/create |
| 契约 `ExternalRuntimeAdapter`（8 方法，含 `runTurn(input, signal)` / `abortTurn()`） | `external-runtime.ts` | ✅ |
| **ExternalAgentDriver**（完整 Agent 面 → durable 词汇翻译） | `external-agent-driver.ts` | ✅ 6 个端到端用例 |
| 源码构建接入（clone→build→probe→回执） | `source-build.ts` | ✅ |
| 单按钮规则（仅外部运行时应答过探测才显示后端 chip） | `ui-agent-preset/backend-store.ts` | ✅ |

### 驱动器回合映射（设计决策，评估修改时从这里入手）
- **一条被认领的 inbox message = 一个 step = 一次 `runTurn`**。外部运行时自己管内部模型/工具轮次；整轮的 delta 折叠成一条 `assistant/message`，工具事件按到达顺序落 `tool/call`+`tool/result` 对
- 运行中到达的 steering/follow-up 在同一回合内被后续 step 认领（与 ReactLoop 一致）
- abort：驱动器先 `adapter.abortTurn()` 再武装信号；中断前缀按 `interrupted: true` 结算
- 失败运行结算 `assistant/attempt`（不伪造模型可见历史）
- 适配器进程随 scope 处置自动 stop；首个回合惰性 start
- **已知边界**：外部运行时的 mid-run steering 直达（Pi `steer` 命令）未接，队列到下一 step；ZCode 的 `interaction/requestPermission` 被结构化拒绝（`-32601`）+ notice；多模态输入仅文本

### 未接的最后一环（任务#6）
Host 后端绑定：`backend-store.select()` 当前拒绝非 DSH（"not supported by this build yet"）。接通路径已完备——按选择构造 adapter + `ExternalAgentDriver`，用 `createAgent(ownerCtx, { sessionId, driver })` 建会话。resume 同一会话必须传同一 driver（契约已写明；**持久化引擎标记进 session meta 需要格式评审**，是当前硬缺口）。

## 5. 后端强化规则（本轮随接缝落地）

1. **一会话一驱动器**：驱动器由创建调用方选定，整个生命周期不变；工厂层 ownership 机器保证无双重驱动
2. **日志词汇单一来源**：外部驱动器写与 ReactLoop 完全相同的 `SessionEventMap` 词汇 → 投影/前台/回放零分叉，天然防耦合
3. **resume 一致性**：`driver` 选项在 create/resume 两侧；契约 + 文档强制同一 driver，防"外语种日志被认领"
4. **中止不泄漏**：`raceAbort` + `settled.catch` 模式保证 abort 竞态无未处理拒绝；适配器中断与信号双通道
5. **能力诚实**：ZCode `hostPermission/hostUserInput: true` 如实声明，交互面缺失时结构化拒绝而非悬挂

## 6. 项目结构约定（收敛后）

- 根目录只留清单/配置；`temp/` 保持空（构建残渣不入库）
- **src/ 内禁止构建产物**：2026-11 初发现 `agent-loop/src/` 被误写入 24 个 .js/.d.ts（错误 tsc 调用），已清除；复发检查 = `git status` 看 `packages/*/src/*.js`
- `dev-docs/`：顶层放当前规格（日期-主题.zh.md），`archive/` 放结题文档，`evidence/` 放按日期组织的构建/测试日志（202 个 .log 属正常资产）
- `docs/` 是正式文档（受 i18n 配对/引用闸门约束）；`dev-docs/` 是开发过程文档（不成对）
- 分支：`main`（基线）、`v2.0.1`（当前开发）、`AeroidzServer` / `AeroidzCilent`（远程链路，方案见 `2026-11-03-aeroidz-secure-link.zh.md`）

## 7. 验证基线（本轮）

- 驱动器 + 适配器：22/22；registry + agent-loop + agent 三包：657 通过
- typecheck 绿；新文件 lint 零警告
- 已知存量：`ui-deliverables/tests/prompt.host.spec.ts` 在干净 HEAD 上即红（与本仓所有改动无关，建议单独立案）；CI 覆盖率闸门（per-file 100%）对新文件的分支覆盖有待 CI 校准
