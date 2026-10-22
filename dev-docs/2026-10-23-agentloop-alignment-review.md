# Agent Loop 行为对齐复核（AgentLoop对齐师 · 2026-10-23）

- 审查对象：`dev-docs/2026-10-22-zcode-agentloop-parity.md`（下称「基线文档」）的 P0/P1/P2 清单，独立复核而非照抄。
- 上游基线：ZCode 3.15.1 @ `aac4755666d09fdcd70272fcf063c077a639015f`。上游行号全部来自 pack blob
  （`pack-d460ebf9082a3459f5a8978ea6216bd4999171ba.pack`），**未经工作树交叉验证**——工作树文件已删，
  交叉验证需要重新展开工作树或取得 3.16.2 副本。
- 本仓基线：审查期间 HEAD 已从 `7c7a9c9501` 前移至 `c00b497ce5`（新增 `ea8785b21c`/`e7f1f3ee7c`/`ac51383f21`/
  `5cdc53821b`/`271d53245f`/`55b4279128`/`c00b497ce5` 七笔，其中两笔直接处理 developer-role 方言风险）。
  本文行号以当前工作树为准。
- 本轮只读调研：未运行测试/构建，未改任何 `packages/` 源文件。

---

## 0. 结论摘要

1. **P0「并行调度可能把有依赖的调用并行」定性不成立（伪差距），且方向恰好相反**：
   本仓调度是 fail-closed（默认全 exclusive），上游反而对无元数据工具 fail-open；上游的「拓扑排序」
   因 `dependsOn` 恒为空数组而是死代码路径。真正残留的是吞吐方言与契约责任差异。
2. **P1 压缩预算是真差距，但主害不是机制而是默认值**：200K 窗口下本仓默认 ~102K 启动压缩，
   上游 ~166K 启动——模型可见上下文只有上游的 ~62%。属配置可修，不需要动代码。
3. **P1 快速回填熔断缺失是真差距**（基线归并在压缩项里，本文单列）：压缩→回填→再压缩循环无熔断。
4. **P1 软告警是真差距**：上游 3.15.1 已有完整实现（检测 + `<system-reminder>` 注入 + 事件），
   不是纸面设计；本仓无对应实现。
5. **P2 system 三段契约与 reasoningLevel 是方言差异，不是真差距**：两者语义等价、表达力等价；
   剩余缺口是「两份 persona 字面漂移」与「无出站实测」。
6. **P2 重试次数差异在当前 HEAD 已消除**：GLM harness 已显式对齐上游 10 次（`cordis.yml:28-34`）。
7. §6「不得照搬清单」7 条全部成立，无需推翻。

---

## 1. P0/P1/P2 复核表

> 上游行号标注 [pack]（来自 pack blob，未交叉验证）；本仓行号来自当前工作树，已直接读取。

### P0-1 工具调度拓扑 —— 【结论：伪差距（基线定性错误，方向相反）】

| 断言 | 证据 |
|---|---|
| 上游确有拓扑排序→分组→组间串行 | `apps/zcode-cli/packages/core/src/tool/scheduler.ts:60-83`（topologicalSort → groupByParallel → validateNoCycles）[pack] |
| **但上游 `dependsOn` 恒为空**，拓扑排序与 validateNoCycles 是死代码路径 | `apps/zcode-cli/packages/core/src/runtime/methods/tools.ts:42-58`（`dependsOn: []`，第 49 行）[pack]；全上游 grep `dependsOn` 无第二个 runtime 构造点 [pack] |
| 上游真实并行判据：READ_ONLY_TOOLS 白名单 + 显式元数据；无名字无元数据 → **true（fail-open）** | `scheduler.ts:85-103`（`canRunInParallel`）、`:233-243`（READ_ONLY_TOOLS：Read/Glob/Grep/WebSearch/WebFetch/TodoRead/**TodoWrite**/AskUserQuestion/Skill）[pack]；有名字、不在白名单、无元数据的工具落到最后 `return tool.sideEffectScope === "none"` = false → 独占屏障 |
| 上游组间串行、组内并行、结果按组序 | `executor/batch-runner.ts:56-90`（逐组 `executeBatch`）+ `:24-54`（组内 Promise.all）[pack] |
| 本仓按 `executionMode` 分组，但 **fillPool 在每次启动前重分类**，非 parallel 调用不会进入并行池 | `packages/core/agent-loop/src/tool-calls.ts:89-100`（分组）、`:199-214`（fillPool 重分类：`nextToStart > 0 && mode === 'parallel' && executionMode(nextCall).kind !== 'parallel'` 即 break） |
| 本仓 `executionMode` 是 **fail-closed**：仅显式 `isConcurrencySafe(args) === true` 才并行；未声明/抛异常/非 true/args 校验失败一律 exclusive | `packages/core/tools/src/index.ts:1303-1312`；`packages/core/tools/src/schema.ts:625-630`（包装器 args 校验失败返回 false） |
| 本仓主流只读工具已显式 opt-in 并行 | `packages/fs/tool-fs/src/read.ts:136`、`read-image.ts:238`、`packages/web/tool-web/src/search.ts:364`、`fetch.ts:498`、`packages/session-query/tool-session-query/src/index.ts:90,103,118`、`packages/subagent/tool-subagent/src/index.ts:470` |
| 并发上限两侧同为 10 | 上游 `scheduler.ts:48` [pack] ↔ 本仓 `packages/core/agent-loop/src/constants.ts:7` |
| 悬挂 tool call 双侧都有兜底 | 上游 `docs/design/v2/loop/tool-calling-loop.md:72` [pack] ↔ 本仓 `tool-calls.ts:238-260` + `agent.ts:331-352`（ToolCallRecovery） |

**判断题 1 的答案（是否真会让模型表现变差）**：不会。触发「有依赖的调用被并行」的场景在本仓被
两层机制挡住：(a) `executionMode` 对未声明工具恒 exclusive（`tools/src/index.ts:1305`）；
(b) parallel 组内每步启动前重新分类，遇到 exclusive 即停（`tool-calls.ts:204-205`）。唯一能并行的路径是
工具作者显式声明 `isConcurrencySafe => true`，而该声明附带的正确性契约有专门 Agent Note
（`packages/core/tools/src/index.ts:270-276` 引用）与测试（`packages/core/tools/tests/execution-mode.spec.ts:88-117`
覆盖抛异常/非布尔/参数感知）。真实残留差异是**吞吐方言**：上游白名单让 9 种只读工具免声明即并行
（含 TodoWrite），本仓要求逐工具 opt-in——未声明的读类工具会串行，是性能差异，不是正确性差异。
基线文档 §3 差异 #2 与 §5 路线 B 的 P0「引入依赖拓扑」应撤回：上游拓扑不承载真实依赖，照搬语义≈照搬死代码。

### P1-a 压缩预算量纲 —— 【结论：真差距（默认值级），影响为「提前截断」】

| 项 | 上游 [pack] | 本仓 |
|---|---|---|
| 预算常量族 | 200K 窗口 / 32K 输出预留 / 21K preflight / 13K buffer / 阈值 100% / 连续失败上限 3：`compact/policy.ts:6-14` | 比例制：thresholdRatio 0.8 / retainRatio 0.16：`packages/compaction/compaction-basic/src/config.ts:20,23`；headroomTokens 默认 65536：`config.ts:75` |
| 启动点（200K 窗口、32K 输出） | effectiveWindow = 200K−21K = 179K；threshold = 179K−13K = **166K**：`policy.ts:67-88` | messageBudget = 200K−32K = 168K；pressureBudget = 168K−65,536 = 102,464；thresholdTokens = min(160K, 102,464) = **≈102K**：`config.ts:172,181,191-194` |
| 结构化决策 | `AutoCompactDecision`（五态 reason，含 `circuit_breaker`）：`policy.ts:41-65,124-154` | 无对应结构体；失败仅 `ctx.logger.warn` 后继续（`compaction-basic/src/index.ts:166-173`） |
| 触发时机 | 每 model-step 前：`runtime/methods/turn-loop.ts:77-113` [pack] | 每 pre-step：`compaction-basic/src/index.ts:158-176`（本仓 turn 内每步同样过 preStep，时机等价） |
| 局部压缩 | microcompact 独立机制：`compact/microcompact.ts`、`runtime/methods/microcompact.ts` [pack] | 无 microcompact；近似物是可选 `toolResultPruner` 先行 prune 再重测（`compaction-basic/src/index.ts:292-298,323-327`） |
| 丢 tool 配对风险 | — | **不成立**：切点强制 tool-pairing 平衡（`packages/compaction/compaction/src/tool-pairing.ts:112-126`；`compaction-basic/src/region.ts` 用其筛 range） |
| 压缩可观测性 | 事件 + traceId [pack] | `compaction/start|summary|end|prune` 声明合并 Session 事件（`compaction/src/types.ts:18-91`），满足 `model-visible ⟺ logged` |

**判断题 2 的答案（实际后果）**：
1. **提前截断（真差距）**：默认 headroom 65,536 + 0.8 比例使 200K 模型在 ≈102K 就压，上游到 ≈166K。
   长程任务模型可见历史少了约 64K token——这是「GLM 发挥最大作用」最直接受损点。
   注意 headroom/thresholdRatio 都可按 `modelPolicies` 逐路由覆盖（`config.ts:81-96,118-139`），
   所以是**默认值差异，纯配置可修**，不是机制缺失。
2. **重复压缩（部分真差距）**：本仓 overflow 重试计数在每条 `assistant/message` 后清零
   （`index.ts:184-188`），pressure 压缩每步都查；压缩后工具结果快速增长时会「摘要→数批→再摘要」，
   无终止语义，代价是每轮一次摘要 LLM 调用 + 上下文抖动 + 不收敛风险。上游有 `<3 tool turns / 3 次
   consecutive refills` 熔断（见 P1-b）。
3. **丢 tool 配对（不成立）**：见上表。基线文档担心的配对丢失被 tool-pairing 平衡约束挡住。

### P1-b 每 model-step reactive compact + 快速回填熔断 —— 【结论：真差距】

| 项 | 上游 [pack] | 本仓 |
|---|---|---|
| reactive compact 频控 | 每 model-step 重试链最多一次：`reactiveCompactAttemptedInCurrentModelStep`（`runtime/methods/turn-loop-state.ts:110`），完整 tool batch 后重置（`:186-192`） | `agent/request-error` waterfall 恢复，`maxOverflowRetries` 默认 1（`compaction-basic/src/config.ts:106`）；计数在 `assistant/message` 成功后清零（`compaction-basic/src/index.ts:184-188`）、`agent/status: idle` 时删除（`:178-180`）——**每步都重新可用，无跨步记忆** |
| 快速回填熔断 | `<3 tool turns` 内再压缩 → consecutiveRapidRefills+1；连续 3 次 → 抛 `CompactRapidRefillError` 终止 turn：`turn-loop-state.ts:21-22,160-174` + `turn-loop.ts:87-113` | **无对应实现**（全仓 grep 无 rapid-refill / consecutiveRapidRefills） |

**判断题 3 的答案（软告警/熔断缺失的可观测后果）**：压缩循环无熔断时的表现是——
每轮多一次摘要调用（延迟+费用）、上下文在「长→摘要→回填→再压缩」间抖动、且可能永不收敛；
用户侧看不到任何终止信号，只能事后从 transcript 发现。上游在第 3 次快速回填时抛
`CompactRapidRefillError`，把「压缩不收敛」变成显式 turn error（`turn-loop.ts:102-109`）。

### P1-c 软告警层 —— 【结论：真差距】

| 项 | 上游 [pack] | 本仓 |
|---|---|---|
| 重复调用检测 | `runtime/helpers/model-anomaly.ts:23-62`：`toolName + stableJson(input)` 签名、阈值 3、streak 语义、`maxBudgetWarningsPerTurn=3`；用户新输入重置 streak（`turn-loop.ts:62-65`） | 无（全仓 grep `repeatedToolCall`/`model-anomaly` 无生产命中） |
| 预算告警 | `model-anomaly.ts:64-91`（`toolCallWarningThreshold` 默认不启用） | 无 |
| 模型可见注入 | `<system-reminder>` 附件：`runtime/methods/turn-tool-warnings.ts:28-36,57-65`（`systemReminderAttachmentEntry("model_anomaly", …)`），文案见 `model-anomaly.ts:93-109` | 无 |
| 事件契约 | `SessionEventType.ModelAnomalyWarning`（`turn-tool-warnings.ts:37-49,66-80`） | 无 |

**判断题 3（续）**：缺软告警的可观测后果——doom loop 只能靠用户打断、max-tokens 粘性或工具自身
失败语义结束；每步重复请求带完整上下文，成本线性膨胀且无法自愈；doom loop 在 UI/日志层不可见
（要事后翻 transcript）。上游用 ≤3 条模型可见 reminder 把自纠偏交给模型，并保持「不禁工具、
不结束 turn」的软语义（`model-anomaly-fallbacks.md:27-29,43-60` [pack]）。

### P2 system 三段契约 + reasoningLevel 映射 —— 【结论：方言差异，非真差距】

| 项 | 上游 [pack] | 本仓 | 判定依据 |
|---|---|---|---|
| system 分段 | 三段：`system[0]` CLI prefix（精确串 `You are ZCode, an interactive coding agent`，`context/sections/cli-prefix.ts:8`）+ `system[1]` static + `system[2]` dynamic，本质是**缓存 breakpoint 分配**（`system-prompt-contract.md:27-72,93-101`） | 有序 section 注册表：`harness:identity`(-1000) → persona-prefix(0) → … → persona-suffix(10200)（`packages/core/system-prompt/src/index.ts:125-159,425-442`），投影为 system/message 事件（`agent-loop/src/agent.ts:410-418`） | 两侧都是「固定身份前缀 + 静态指导 + 动态上下文」；分段粒度是架构方言。缓存差异对 GLM（openai-completions，无 Anthropic cache_control）几乎不生效 |
| 身份文案 | `You are ZCode, an interactive coding agent` | `You are an AI agent powered by DeepSeek Harness.`（`system-prompt/src/index.ts:425-431`） | 产品身份**理应不同**；§6.4 也禁止照搬 |
| persona 双份 | 单一来源（contract 文档） | `packages/bundle/web-app/presets/standard.patch.yml:197`（"powered by the {{model}} model"）vs `apps/cli/config/examples/glm-harness/cordis.yml:45`（"You are a coding agent."）字面仍不一致 | 真·小差距：需要收敛到单一来源或声明等价性验收（基线差异 #6 维持） |
| reasoningLevel | `EnumOptionSpecConfig`（values+map，显式 overlay，不按模型名推断）：`packages/provider/src/config/model-config.ts:246-264` [pack] | `reasoningEfforts` dict（档位→线格式映射，未声明 pin 为 unsupported；`off` 无值 = send nothing）：`packages/llm/llm-pi-ai/src/catalog.ts:614-620,737-748`；档位解析 `agent.ts:556-575` | **表达力等价**（枚举规格对象 vs 字符串映射 dict，均为 per-model 显式声明）。本仓近期还补了 developer-role 方言的警告+repair（`e7f1f3ee7c`、`ac51383f21`）。剩余唯一待办：出站实测 |
| role 词表 | `system|user|assistant|tool`（`agent/message-history.ts:28`）[pack] | 多 `developer` 一档（`packages/llm/llm/src/message.ts:187-193`），用于 tool-registry 变更通知（`agent.ts:643-647`）；GLM 方言层 `supportsDeveloperRole: false`（`cordis.yml:16`）+ repair 开关（`e7f1f3ee7c`）+ 事前警告（`ac51383f21`） | 方言差异；三层防线在当前 HEAD 已连通 |

### P2 重试次数 —— 【结论：伪差距（本审查期内已被消除）】

- 基线文档 2.6/差异 #4 称「GLM 覆盖压到 maxRetries: 2（cordis.yml:28-30）」。
- 当前工作树 `apps/cli/config/examples/glm-harness/cordis.yml:28-34` 已显式 `maxRetries: 10`，
  注释明确说明对齐上游预算（10 次 + 指数退避 + jitter + provider wait hint 优先）。
- 本仓包默认 5（`packages/llm/llm/src/retry-policy.ts:14`）与上游 10 的差异保留为「非 GLM 路由默认值」，
  可配置、由 provider 覆盖——维持基线 §4「不需要同形」的判定。

---

## 2. §6「不得照搬清单」复核 —— 【结论：全部成立】

| # | 条目 | 复核结论 | 证据 |
|---|---|---|---|
| 1 | TurnMachine/TurnState 不作本仓 turn 状态源 | 成立 | 上游 turn 机器在 runtime 内部自持（`turn-loop.ts:202-207`）[pack]；本仓 turn 边界以 Session 事件为准（`agent.ts:305` turn/start、`:356` step/end、`:385` turn/end） |
| 2 | canonical history/CacheStats/replaceMessages 不作第二历史源 | 成立 | 本仓 `deriveMessages()` 从事件日志推导（`agent.ts:671`）；上游 message-history 维护自己的 canonical 数组 [pack] |
| 3 | 工具注册/执行/权限注入不得绕过 `ctx.tools` | 成立（现状已满足，非风险项） | 本仓调度全程走 `ctx.tools[TOOL_RUNTIME_SCHEDULER]`（`tool-calls.ts:153-154,170-174`）；审批链在 `tools/pre-execute` waterfall（`tools/src/index.ts:153`） |
| 4 | 身份串不作产品身份 | 成立 | 本仓已有 harness:identity + persona 机制（`system-prompt/src/index.ts:425-442`），无需照搬 |
| 5 | provider 目录不直接替换 llm-pi-ai | 成立 | 上游 `config/provider/zcode-builtin.json`（revision 31，templateRules/builtinModelIds，模型面为 GLM-5.3 系）[pack] 与本仓 catalog 的模型档案模型（compat 开关/sendsDeveloperRole/reasoningEfforts，`catalog.ts:604-712`）目录面本就不同源；GLM 型号在部署层由环境变量决定（`cordis.yml:20`） |
| 6 | glm-5.2-reasoning-depth.md 不可作依据 | 成立（两侧一致） | 基线 `zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:9`；上游已被 Provider Refactor 取代 [pack] |
| 7 | 账号配置/网关/授权头不进本仓 | 成立 | 安全边界，无代码面触碰 |

---

## 3. 影响排序（按对模型表现的实际影响，非改动量）

| # | 项 | 定性 | 为什么排这里 |
|---|---|---|---|
| 1 | 压缩预算默认值（P1-a） | 真差距（配置可修） | 102K vs 166K 启动点 = 长程任务模型可见上下文差 ~64K，是 GLM 长任务表现第一敏感项；且纯配置可修 |
| 2 | 快速回填熔断缺失（P1-b） | 真差距 | 压缩-回填循环无终止语义：重复摘要调用费钱、上下文抖动、无收敛信号 |
| 3 | 软告警缺失（P1-c） | 真差距 | doom loop 无模型自纠偏层，成本线性膨胀且不可自愈、事后才可见 |
| 4 | 并行调度拓扑（P0） | 伪差距（降级为吞吐方言） | 本仓 fail-closed 无正确性风险；仅未声明只读工具损失并行吞吐，待实测再议 |
| 5 | persona 双份漂移（P2） | 方言 + 待收敛 | 影响模型行为基线的一致性，但两份分属不同部署面 |
| 6 | reasoning 出站实测（P2） | 需实测 | 无 GLM 端点，`reasoning_effort` 是否入请求体未验证 |
| 7 | 重试次数（P2） | 已消除 | `cordis.yml:34` 已对齐 10 次 |

---

## 3. 建议动作（最小修法 + preset/底座开关隔离）

`packages/core/agent-loop` 与 `packages/compaction/compaction-basic` 是全仓共享驱动，以下每条都按
「默认关闭、GLM preset 显式打开」隔离，不影响其他底座会话。

**Top 1：GLM 压缩预算对齐（纯配置，零代码，先做）**
- 修法：在 GLM 部署 preset 的 `compaction-basic` 配置里加 `modelPolicies`（provider `glm-harness`）覆盖：
  `thresholdRatio: 0.9` + `headroomTokens: 0`（或 ≤8K），使 200K/32K 场景启动点从 ≈102K 抬到 ≈166K
  （对齐上游 effectiveWindow−buffer 的形状）；`retainRatio` 可保 0.16。
- 隔离：`resolveTargetPolicy` 本就按 provider/model 精确路由（`compaction-basic/src/config.ts:118-139`），
  天然按底座隔离，其他模型不受影响。
- 验收：单测断言该路由的 `resolveCompactSpec().thresholdTokens ≈ 166_000`（fixture 化数值表，防止默认值漂移无感知）。

**Top 2：快速回填熔断（compaction-basic 小改动 + opt-in 配置）**
- 修法：`BasicCompactionEngine` 增加 `rapidRefillGuard?: { toolTurnThreshold?: number; maxConsecutive?: number }`
  （默认关闭）；维护 `toolTurnsSinceCompact`/`consecutiveRapidRefills`：成功 compact 后清零 tool-turns，
  在 `agent/pre-step` 观察到「完成一个完整 tool-result batch 且距上次 compact 不足 toolTurnThreshold」时
  递增 consecutive，≥maxConsecutive 时不再自动压缩并抛 `CompactionRapidRefillError`（经现有
  `agent/request-error` 呈现为终态错误），事件照常入 Session 日志。
- 隔离：配置项默认关闭 ⇒ 现有全部路由行为不变；GLM preset 打开。
- 规模：约 60–80 行 + 单测；不触碰 `agent-loop` 主路径。

**Top 3：重复调用软告警（agent-loop 侧 opt-in 插件）**
- 修法：新增独立插件（不进 `tool-calls.ts`），在每步工具结果提交后按
  `toolName + stableJson(arguments)` 计连续 streak（streak 语义照抄上游 `model-anomaly.ts:106-127`：
  键相同 +1、否则重置；新用户输入/新 turn 重置），首次跨过阈值 3 时 append 一条
  `developer/message`（模型可见且 logged，满足不变量）并保留计数；每 turn 上限 3 条。
- 隔离：插件默认不注册；仅在 GLM preset 的插件清单里挂载。streak 状态放插件闭包，不进 agent-loop。
- 规模：约 100 行 + 单测；不改动共享调度器。

**不建议做**：引入上游拓扑排序（死代码路径）；改 role 词表删 developer（方言层已闭环）；
pre-commit 加 typecheck（见 §5）。

---

## 4. 未验证项与验证方法

| 项 | 状态 | 如何验证 |
|---|---|---|
| 上游行号 | **未经工作树交叉验证**（来自 pack blob，delta 解析行号与 `aac4755` 一致） | 展开工作树或对 `aac4755` 重新 checkout 后逐文件 diff |
| GLM 请求体实际字段 | 未验证（端点为占位地址 `cordis.yml:10`） | 换真实网关后抓包：`reasoning_effort` 是否出现、`developer` 是否被 repair 改写、并行批次是否被网关正常接受 |
| 压缩启动点数值推演 | 由两侧常量推导（102K vs 166K），未跑真实 meter | 用 `ctx.tokenMeter.measure` 在 fixture 会话上断言 `spec.thresholdTokens` |
| 上游 3.16.2 差异面 | 未获取 | 另取上游副本后重跑对照 |
| `inbox.ts`/`assistant-stream.ts` | 本轮仅结构浏览，未逐行审 | 后续如做 P1-c 插件需通读注入时机 |

## 5. 闸门判断（回应本轮 typecheck 样本）

本仓 loop/compaction 相关包的测试覆盖是好的（`tool-calls.spec.ts`、`execution-mode.spec.ts` 覆盖
exclusive/parallel/abort/scheduler-failure），三处 typecheck 错误全部落在 agent-team 测试文件而非共享驱动。
判断：**pre-commit 不应加 typecheck**——TS6133/TS2322 只有 tsc 能报，加进 pre-commit 会把每次提交拖到
分钟级（`typecheck` 依赖 `build:lib:host`），破坏「pre-commit 快、pre-push 严」的现有分工
（`lefthook.yml:5-38` vs `:52-55`）。代价更低的补法：
1. CI 层把 `pnpm run typecheck` + `vitest run` 设为合并必跑（本地闸门不变）；
2. pre-push 的 typecheck 依赖完整构建太慢，改为 `tsc -b --incremental` 的独立脚本，把闸门从「装好了才跑得动」变成「随时可跑」；
3. 针对共享驱动补两条廉价守卫测试：`executionMode` 对未知工具恒 exclusive（已有近似覆盖）、
   compaction 默认预算数值 fixture（防本审查第 1 条发现的「默认值漂移无感知」）。
