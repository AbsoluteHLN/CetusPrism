# ZCode agent loop 一致性对照表

日期：2026-10-22　分支：`release/v1.7.3`　上游基线：`zai-org/ZCode` @ `aac4755666d09fdcd70272fcf063c077a639015f`（3.15.1）
对应规格：`dev-docs/2026-10-22-composer-agent-team-spec-v1.zh.md` §3（S3.1–S3.6）

本文是规格 §3.3 要求的交付物：六个维度逐点对照，每格带**上游 `文件:行号`** 与**本仓 `文件:行号`**，
结尾给出差异清单与「需要上游同形」清单。

---

## 0. 结论摘要

1. **本仓当前不是照搬 ZCode 源码，而且本仓根本不存在「ZCode 后端的 agent loop」。**
   `zcode` 执行底座当前只是一个**目录条目**（无适配器 → `unconfigured`），客户端对非 DSH 底座**硬拒绝**，
   真正执行 GLM 的是**原生 DSH loop + persona/preset 叠加**。
2. 真正跑 GLM 的原生 loop 与上游 ZCode 在六个维度上的对照结论：
   **消息角色、工具调度、压缩预算、推理参数、重试**＝有差异；**停止条件**＝部分语义等价 + 部分本仓无对应实现。
3. 「完全一致」在既有规格下**不可执行**：照搬会绕过 `ctx.tools` 授权链、产生第二份运行时状态源、
   违反 `model-visible ⟺ logged` 不变量，并与 `dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:84`
   （「不建立平行 Agent loop」）直接冲突。故按规格 §3 的口径走**路线 B：在原生 DSH loop 内逐点对齐可观测行为**。
4. **「GLM 发挥最大作用」目前无法验证**：本仓 GLM 端点是占位地址
   `https://your-glm-gateway.invalid/v1`（`apps/cli/config/examples/glm-harness/cordis.yml:10`），
   且本仓推理档位链路**从未做出站实测**（`dev-docs/2026-10-20-multibase-refactor-spec-v2.zh.md:28`）。

---

## 1. 对照基线与证据来源

| 项 | 事实 | 证据 |
|---|---|---|
| 上游基线版本 | 3.15.1，commit `aac4755666d09fdcd70272fcf063c077a639015f`（provider 配置 revision 31） | `dev-docs/evidence/2026-10-13-zcode-source.md:4-10` |
| 上游源码可读性 | 本机副本 `C:\Users\19635\AppData\Local\Temp\cetusprism-zcode-official-20261013-2` 的**工作树文件已被删除**（863 个空目录），只剩 `.git\objects\pack\pack-d460ebf9082a3459f5a8978ea6216bd4999171ba.pack`（92,078,274 B / 16,312 objects） | 读 pack 内 blob（delta 解析 + zlib inflate）取得，行号与该 commit 一致 |
| 上游未被 vendor | 仓库内 `package.json` / `pnpm-lock.yaml` / `native/` / `vendor/` 均无 `zcode|zhipu|zai-org` 命中 | 全仓 grep NO MATCH |
| 基线漂移 | 本机 3.15.1 vs 本仓规格记录的 3.16.2（main `3c5b2276`） | `dev-docs/2026-10-20-multibase-refactor-spec-v2.zh.md:21` |
| 本仓 ZCode 侧自述 | 「ZCode-inspired behavior, implemented with native Harness plugins; **no ZCode runtime**」 | `apps/cli/config/examples/glm-harness/cordis.yml:2`；`docs/user/guide/glm-harness.md:5,31,33` |
| 本仓 ZCode 后端现状 | 只有目录条目 + 拒绝路径，无 adapter 实现 | `packages/preset/agent-preset-registry/src/backend.ts:73,182-207`；`packages/client/ui-agent-preset/src/client/backend-store.ts:161-173`；`packages/preset/agent-preset-registry/src/builtin-agent-adapter.ts:125-127` |

> 全仓 `registerBackend` 的**生产调用点为零**（唯一调用在测试
> `packages/preset/agent-preset-registry/tests/registry.spec.ts:383-385`）⇒ ZCode 底座在生产中恒为 `unconfigured`。

---

## 2. 六维度逐点对照表

> 「本仓」列均指**实际执行 GLM 的原生 DSH loop**（因为 ZCode 底座没有 loop）。

### 2.1 消息序列与 role 构造 —— **有差异**

| 环节 | 上游（ZCode 3.15.1） | 本仓（CetusPrism 原生 loop） |
|---|---|---|
| 角色闭集 | `system \| user \| assistant \| tool`，**无 developer**：`apps/zcode-cli/packages/core/src/agent/message-history.ts:27-37` | 5 角色，**多一个 `developer`**：`packages/llm/llm/src/message.ts:152,158,163,168,174` |
| 工具结果 | 每个 tool call 一条独立 tool 消息，带 `toolCallId`：`message-history.ts:103-110` | `createToolResultMessage`：`packages/core/agent-loop/src/tool-calls.ts:277-281` |
| 助手消息 | 携带 `reasoning` 块：`message-history.ts:95-101` | 见 `packages/core/agent-loop/src/agent.ts:410-418` 的 system 投影与工具回合组装 |
| system 分段 | 三段契约 `system[0]`/`[1]`/`[2]`：`apps/zcode-cli/docs/design/v2/loop/system-prompt-contract.md:27-29,36-46,54-72` | `SystemPromptProjection.project` 提交：`packages/core/agent-loop/src/agent.ts:410-418`；两份手写 persona（内容不一致）：`packages/bundle/web-app/presets/standard.patch.yml:192-203`、`apps/cli/config/examples/glm-harness/cordis.yml:38-50` |
| 身份前缀 | 精确串 `You are ZCode, an interactive coding agent`：`apps/zcode-cli/packages/core/src/context/sections/cli-prefix.ts:8-23` | 全仓 **0 处引用**（grep `You are ZCode\|zcode-agent` 于 `packages/` → NO MATCH） |
| provider 方言 | GLM 走 `anthropic-messages`：`config/provider/zcode-builtin.json:18-22` | GLM 覆盖显式 `supportsDeveloperRole: false`：`apps/cli/config/examples/glm-harness/cordis.yml:16` |

**差异影响**：本仓 role 词表多一档，system 分段契约不同；GLM 侧已在**方言层**规避 `developer`，
但不是逐字一致。**本仓侧缺口**：需要出站实测确认请求体真的不带 `developer`。

### 2.2 工具调用多轮循环与并行度 —— **有差异（行为级）**

| 环节 | 上游 | 本仓 |
|---|---|---|
| 调度算法 | 拓扑排序 → `parallelGroups` → 组间串行：`apps/zcode-cli/packages/core/src/tool/scheduler.ts:60-83` | **无依赖拓扑**；按 `ctx.tools.executionMode` 动态重分类：`packages/core/agent-loop/src/tool-calls.ts:89-100,199-213` |
| 执行 | 逐组执行，组内并行：`apps/zcode-cli/packages/core/src/tool/executor/batch-runner.ts:70-71,132` | exclusive 屏障 + 有界滚动并行池：`tool-calls.ts:122-247` |
| 并发上限 | `DEFAULT_MAX_CONCURRENCY = 10`：`scheduler.ts:48` | `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`：`packages/core/agent-loop/src/constants.ts:7` |
| 结果顺序 | 按 `executionOrder` | 按模型序提交：`tool-calls.ts:146-161` |
| 禁止退化 | 「必须把 `parallelGroups` 交给 `executeSchedule()`，不得退回 `executeBatch()`」：`apps/zcode-cli/docs/design/v2/loop/tool-calling-loop.md:365-367` | — |
| 无悬挂 tool call | 每个 tool call 必须有结果：同文件 `:72` | 取消/失败时补合成错误结果：`tool-calls.ts:238-260` |

**差异影响**：默认并发数相同（10），**调度语义不同**——有依赖或副作用顺序要求的一批调用，在本仓可能并行发起。
这是最直接影响 GLM 执行正确性的一条。

### 2.3 上下文压缩 / 截断 —— **有差异**

| 环节 | 上游 | 本仓 |
|---|---|---|
| 预算常量 | 200K 窗口 / 32K 输出预留 / 21K preflight / 13K buffer / 阈值 100% / 连续失败上限 3：`apps/zcode-cli/packages/core/src/compact/policy.ts:6-14` | 阈值比 0.8 / 保留比 0.16：`packages/compaction/compaction-basic/src/config.ts:20,23`；另有 `headroomTokens/compactionRetries/maxOverflowRetries`（`:27-35`） |
| 决策结构 | `AutoCompactDecision{shouldCompact, tokenCount, tokenSource, threshold, contextWindow, effectiveContextWindow, outputReserveTokens, thresholdPercent, reason}`，reason 五态：`policy.ts:41-65` | 无对应结构体 |
| 触发时机 | 每模型步前 microcompact + autoCompact：`apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:77-114` | `auto` 时在 `agent/pre-step`：`packages/compaction/compaction-basic/src/index.ts:140,158-160` |
| 溢出兜底 | 每 model-step 最多一次 reactive compact + 快速回填熔断：`apps/zcode-cli/docs/design/v2/loop/model-anomaly-fallbacks.md:67` | `agent/request-error` 上处理上下文溢出：`compaction-basic/src/index.ts:190-194` |
| 局部压缩 | `apps/zcode-cli/packages/core/src/compact/microcompact.ts` 存在 | **本仓无对应实现** |

**差异影响**：机制族同类，但触发时机、预算量纲（比例 vs token 常量）、熔断语义不同——
这正是「GLM 发挥最大作用」最敏感的一段。

### 2.4 停止条件 —— **部分语义等价 + 部分本仓无对应实现**

| 环节 | 上游 | 本仓 |
|---|---|---|
| tool-call 硬上限 | **不设**（面向长程任务），计数仅 telemetry：`model-anomaly-fallbacks.md:7,13,25,39` | **同样不设**：`packages/core/agent-loop/src/tool-calls.ts:85-100` |
| turn 退出 | 由 `needs_follow_up` 驱动：`apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:230-232` | 结束原因闭集 `completed/max-tokens/blocked/error/aborted`：`packages/core/agent-loop/src/agent.ts:52,318,325,341,370,375-380` |
| 软告警 | 重复工具调用阈值 3、预算告警上限 3，**模型可见但不结束 turn**：`model-anomaly-fallbacks.md:15,27,43-60` | **本仓无对应实现** |
| provider 异常 | 返回 `stop` 但带 tool calls 时继续处理：`model-anomaly-fallbacks.md:16` | **本仓无对应实现** |
| 工具可结束回合 | — | 工具 `concludesTurn` 可直接结束 turn：`agent.ts:534-538`；`max-tokens` 粘性不可被 completed 降级（`:336-341`） |

**差异影响**：语义等价部分＝「无 tool-call 硬上限」。缺的是上游靠模型自纠偏避免 doom loop 的**软告警层**。

### 2.5 思考 / 推理参数 —— **有差异**

| 环节 | 上游 | 本仓 |
|---|---|---|
| 档位模型 | `reasoningLevel?: EnumOptionSpecConfig \| null`，**显式 overlay 规则**（不按模型名推断）：`packages/provider/src/config/model-config.ts:248-264`，序列化 `:270-275` | `reasoningEffort` 从 agent options / 持久化 header 解析：`packages/core/agent-loop/src/agent.ts:556-575`；`resolveReasoningLevel`：`packages/llm/llm-pi-ai/src/adapter.ts:343-347`；档位→线格式映射：`packages/llm/llm-pi-ai/src/catalog.ts:617-620,705-748` |
| 方言开关 | provider 配置 revision 31：`config/provider/zcode-builtin.json:3` | `thinkingFormat/supportsReasoningEffort/requiresReasoningContentOnAssistantMessages`：`packages/llm/llm-pi-ai/src/catalog.ts:395-401`；`apps/cli/config/examples/glm-harness/cordis.yml:13-18` |
| 作废文档 | `apps/zcode-cli/docs/design/v2/model/glm-5.2-reasoning-depth.md` 已被 Provider Refactor 取代 | 本仓同样记录不可作依据：`dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:9` |

**差异影响**：能力面覆盖相近，但**建模方式不同**（枚举规格 overlay vs 字符串档位映射）。

### 2.6 错误与重试 —— **有差异**

| 环节 | 上游 | 本仓 |
|---|---|---|
| 默认重试 | **10 次**（事件 `maxAttempts = 11`），指数退避 + jitter：`model-anomaly-fallbacks.md:31` | `normal` 模式**默认 maxRetries 5**：`packages/llm/llm/src/retry-policy.ts:36-46`；`always` 无限（`:48-54`） |
| 退避常量 | — | `initialDelayMs 500 / maxDelayMs 10000 / jitterRatio 0.1`：`retry-policy.ts:26-34` |
| provider 覆盖退避 | `retry-after-ms`/`retry-after` 仅在合理时覆盖本地退避：`model-anomaly-fallbacks.md:31` | `providerRetryAfterMs` 覆盖本地退避：`packages/llm/llm/src/index.ts:227-234` |
| 重试预算模型 | 「单次尝试收敛为 1」+「无上限哨兵（0）」：`apps/zcode-cli/packages/adapters/src/model/retry-budget.ts:11-15,37-47,59-62` | 无对应 sentinel 语义 |
| malformed tool call | 先 repair，再转**模型可见错误输出**：`model-anomaly-fallbacks.md:17` | **本仓无对应实现** |
| loop 续跑 | — | `agent/request-error` waterfall 收到 `kind:'retry'` 则 continue：`packages/core/agent-loop/src/agent.ts:494-509` |
| GLM 实际取值 | — | GLM 覆盖对齐上游预算 `maxRetries: 10`：`apps/cli/config/examples/glm-harness/cordis.yml:34`（上游 10，本仓默认 5） |

**差异影响**：语义等价部分＝「provider 指示的等待时间可覆盖本地退避」。差异＝默认 5 vs 10、退避上限常量不同、
缺 malformed tool call repair 路径。

### 2.7 补充：ZCode 后端本体 —— **本仓无对应实现**

| 环节 | 上游 | 本仓 |
|---|---|---|
| 运行时 | 真实 `AgentRuntime` + stdio `agent-server` 接入候选；core 导出 `AgentRuntime` 与注入接口 | 只有目录条目：`backend.ts:73,182-207`；客户端硬拒绝：`backend-store.ts:161-173`；`driver!=='native'` 拒绝执行：`builtin-agent-adapter.ts:125-127`；真正执行的是 `packages/core/agent-loop/src/agent.ts:98` |

本仓规格已把它列为 **pending 任务 A07**：「ZCode 底座必须运行真实 ZCode AgentRuntime」：
`dev-docs/2026-10-20-multibase-refactor-spec-v2.zh.md:47-49,89`。

---

## 3. 差异清单（按影响排序）

| # | 差异 | 两侧证据 | 影响 |
|---|---|---|---|
| 1 | **ZCode 底座没有 loop** | 上游真实 runtime ↔ 本仓 `backend.ts:182-207` / `backend-store.ts:166-173` / `builtin-agent-adapter.ts:125-127` | 用户当前**无法进入任何「ZCode 模式」**；所谓 ZCode 模式实为 DSH + persona |
| 2 | **并行调度语义不同** | 上游 `scheduler.ts:60-83` + `batch-runner.ts:70-71` ↔ 本仓 `tool-calls.ts:89-100,199-213` | 有依赖/副作用顺序要求的调用可能并行发起，**行为级差异** |
| 3 | **压缩预算与时机不同** | 上游 `policy.ts:6-14` + `turn-loop.ts:77-114` ↔ 本仓 `compaction-basic/src/config.ts:20,23`、`index.ts:158-160,190-194` | 长程任务接近上下文上限时的行为不同 |
| 4 | **默认重试次数不同** | 上游 10（`model-anomaly-fallbacks.md:31`）↔ 本仓 5（`retry-policy.ts:14`）；GLM 覆盖已对齐上游的 10（`apps/cli/config/examples/glm-harness/cordis.yml:34`） | 瞬态失败下任务完成率不同 |
| 5 | **缺软告警机制** | 上游 `model-anomaly-fallbacks.md:16-17,43-60` ↔ 本仓无 | 缺模型自纠偏层 |
| 6 | **system prompt 契约未落地且两份 persona 不一致** | 上游 `system-prompt-contract.md:27-72` + `cli-prefix.ts:8` ↔ 本仓 `standard.patch.yml:202-207` vs `cordis.yml:56-66` | 模型行为基线与上游不同，且两份提示词会继续漂移 |
| 7 | **role 词表与 provider 目录模型不同** | 上游 `message-history.ts:27-37` + `model-config.ts` ↔ 本仓 `message.ts:158` + `llm-pi-ai/src/catalog.ts` | 逐条对照需显式映射表 |
| 8 | **上游基线已过期** | 3.15.1 ↔ 3.16.2（`spec-v2:21`） | 对齐对象本身在漂移 |

---

## 4. 「需要上游同形」清单

规格 S3.5 要求：确需**逐行同形**才能保证 GLM 效果的维度，必须记录理由、同步义务与撞上的不变量。

| 维度 | 判定 | 理由 | 同步义务 | 撞上的不变量 |
|---|---|---|---|---|
| 工具调度（依赖拓扑 + 分组串行） | **需要上游同形** | 副作用顺序是执行正确性问题，语义近似不足以保证；但可在本仓 loop 内**重新实现同一语义**，不必复制上游文件 | 跟随上游调度语义变更 | 不得绕过 `ctx.tools` 的 `TOOL_RUNTIME_SCHEDULER`（`tool-calls.ts:153-154,170-174`） |
| 压缩预算（token 常量族 + reactive compact 熔断） | **需要上游同形（量纲）** | 0.8/0.16 比例制与 200K/32K/13K 常量制不可直接换算，长程任务表现直接相关 | 跟随上游常量与熔断策略 | 压缩事件必须入 Session 日志 |
| 软告警（重复调用 / 预算） | **需要上游同形（可观测行为）** | 属模型可见状态，缺了就是少一层 | 跟随上游阈值 | `model-visible ⟺ logged` |
| 消息角色 | **不需要** | 差异是「多一档」，方言层已规避 | — | — |
| 推理参数 | **不需要**（本仓能力面已覆盖） | 建模方式不同但可表达同一集合 | — | — |
| 重试次数 | **不需要** | 可配置，默认值差异由 provider 覆盖即可 | — | — |
| ZCode 后端本体 | **单列**：要么正式废止既有计划的「不建立平行 Agent loop」约束，要么承认 ZCode 后座仍是 A07 pending | — | — | 会产生第二份运行时状态源 |

---

## 5. 两条路线的改动面与风险

### 路线 A：照搬源码

**改动面**：新增一整套 ZCode 侧运行时——`apps/zcode-cli/packages/core/src/agent/{message-history,turn-machine,turn-state}.ts`、
`src/tool/scheduler.ts` + `src/tool/executor/*`、`src/runtime/methods/{turn-loop,compact-active}.ts`、`src/compact/*`、
`src/context/{builder,sections/*}`，再加 `packages/provider/src/config/model-config.ts` 的 overlay 语义。

**风险（本仓硬约束）**：

- 与既有 Agent/Session/LLM 接口分叉：上游会话真相在 `AgentRuntime` 内部事件存储，本仓真相在
  `packages/session` 的 Session 事件日志 ⇒ 产生**第二份运行时状态源**
  （`dev-docs/2026-10-20-multibase-refactor-spec-v2.zh.md:57`）。
- 绕过权限与沙箱链：上游自带 `toolRegistry`/`toolExecutor`/`permissionBroker` 注入（同文件 `:55`），
  本仓工具执行必须走 `ctx.tools`。
- 直接违反 `dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:84`、`:50`。
- 许可与来源：Apache-2.0 + NOTICE 需逐项保留（同文件 `:59`）。

### 路线 B：逐点对齐可观测行为（**本规格采纳**）

| 优先级 | 本仓文件:位置 | 需要做什么 | 对齐上游 |
|---|---|---|---|
| P0 | `packages/core/agent-loop/src/tool-calls.ts:85-100,199-213` | 引入依赖拓扑 + `parallelGroups` 逐组执行，保留现有模型序提交与取消补结果；**按 preset/底座开关隔离**，不全局替换 | `scheduler.ts:60-83`、`batch-runner.ts:70-71,132` |
| P0 | `packages/preset/agent-preset-registry/src/backend.ts:73,182-207` + `packages/client/ui-agent-preset/src/client/backend-store.ts:161-173` | 真有 ZCode 底座前保持 `unconfigured` + 明确原因 | `spec-v2:89`（A07） |
| P1 | `packages/compaction/compaction-basic/src/config.ts:20-35`、`index.ts:140-194` | 引入上游预算常量族、microcompact 步骤、每 model-step 一次 reactive compact + 快速回填熔断；按路由模型覆盖 | `policy.ts:6-14`、`turn-loop.ts:77-114`、`model-anomaly-fallbacks.md:67` |
| P1 | `packages/core/agent-loop/src/agent.ts:296-396` | 增加重复工具调用 / 预算**软告警**（模型可见提示，不结束 turn、不禁工具） | `model-anomaly-fallbacks.md:16-17,27,43-60` |
| P2 | `packages/llm/llm/src/retry-policy.ts:36-54` | 默认重试对齐上游预算语义（10 次），保留 `providerRetryAfterMs` 覆盖 | `retry-budget.ts:37-47`、`model-anomaly-fallbacks.md:31` |
| P2 | `packages/core/system-prompt/src/index.ts` + `packages/bundle/web-app/presets/standard.patch.yml:192-203` | system 三段落地 + 单一 persona 来源（合并 `cordis.yml:38-50`） | `system-prompt-contract.md:27-72`、`cli-prefix.ts:8` |
| P2 | `packages/llm/llm-pi-ai/src/catalog.ts:705-748` + `packages/core/agent-loop/src/agent.ts:556-575` | `reasoningEffort` 映射到 `reasoningLevel` 枚举规格语义；补出站实测 | `model-config.ts:249-276` |

**路线 B 的风险**：

- `packages/core/agent-loop` 是全仓共享驱动，改 P0/P1 会影响**所有 DSH 会话** ⇒ 必须按 preset/底座开关隔离。
- `packages/compaction/compaction-basic` 同样是共享包 ⇒ 常量变更需要按路由模型覆盖。
- 「逐点对齐」永远落后于上游漂移 ⇒ 需要固定基线 + 周期性重对齐机制。

---

## 6. 不得照搬的清单

1. 上游 `TurnMachine/TurnState`（`agent/turn-machine.ts:41-66`）的阶段语义可以**对齐行为**，
   但**不能作为本仓的 turn 状态源**——本仓 turn 边界以 Session 事件为准（`agent.ts:305,329,356,385`）。
2. 上游 `message-history.ts` 的 canonical history + `CacheStats`（`:70-75`）与 `replaceMessages`（`:119`）
   不能成为第二份历史源。
3. 上游自带工具注册/执行/权限注入不能带入会绕过 `ctx.tools` 链。
4. 上游身份串 `You are ZCode, an interactive coding agent`（`cli-prefix.ts:8`）不能直接作为本仓产品身份写入。
5. 上游 `packages/provider` 的 provider 目录/overlay 模型不能直接替换本仓 `packages/llm/llm-pi-ai`，
   两套目录模型不同，需显式映射而非替换。
6. `apps/zcode-cli/docs/design/v2/model/glm-5.2-reasoning-depth.md` **不可作为实现依据**
   （本仓亦记录于 `dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:9`）。
7. 上游账号配置、订阅网关地址、授权头、运行时路径、私有参数一律不进本仓
   （`dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:15,39`）。

---

## 7. 未知与风险

1. 上游工作树不可直接读（文件已删，仅 pack 可读）。本文上游行号来自 pack blob，与 `aac4755` 一致，
   但**未经工作树交叉验证**。
2. **上游 3.16.2 未获取**（网络不可达），3.16.2 的差异面未知 ⇒ 对齐基线需固定为 3.15.1 或另取副本。
3. 本仓 Qwen/推理档位链路**无出站实测**（`spec-v2:28`），未验证 `reasoning_effort` 是否真出现在请求体。
4. 本仓 GLM 端点为占位地址 ⇒ **无法做任何真实 GLM 效果验证**。
5. 两处 grep 因超时中止：`@zcode` scope 全仓 import 扫描、`packages/core` + `apps` 二次 zcode 扫描
   （依据仓库级 `zcode|ZCode|ZCODE` 全量 grep 的 44 个文件结果）。
6. `packages/core/system-prompt/src/index.ts` 未逐行阅读，P2 改动点为包级锚点而非行级。
7. 本轮为只读调研，**未运行任何测试/构建**。
