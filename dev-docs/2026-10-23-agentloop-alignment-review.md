# Agent loop 对齐复核（独立验证版）

日期：2026-10-23　审查者：AgentLoop对齐师　复核对象：`dev-docs/2026-10-22-zcode-agentloop-parity.md`
本仓：`release/v1.7.3`。上游：ZCode 3.15.1 @ `aac4755`，本机 pack `pack-d460ebf…`（在临时目录搭只读 git 骨架 + `GIT_OBJECT_DIRECTORY` 指向原 pack，用 `git cat-file` 读 blob 全文逐行计数；**工作树文件已删，未经工作树交叉验证**，下称【pack 未验证】）。

## 0. 结论摘要

| 优先级 | 条目 | 结论 |
|---|---|---|
| P0 | 工具调度拓扑 | **伪差距**（上游依赖恒空，两侧行为等价；本仓更保守） |
| P0 | ZCode 底座保持 unconfigured | 维持现状（与模型表现无关） |
| P1 | 压缩预算族 + 每 step reactive + 回填熔断 | **真差距**（默认路由量纲 + 步前 microcompact 缺失；GLM preset 已对齐） |
| P1 | 软告警层 | **真差距**（本仓无对应实现） |
| P2 | system 三段契约 / role 词表 / reasoningLevel 映射 / 重试默认 | **伪差距（方言）**，部分需出站实测 |

真差距计数：P0=0，P1=2，P2=0。另发现对照表 2 处错误（§4）。

## 1. P0 复核

### 1.1 工具调度拓扑 ——【伪差距】

对照表断言上游「拓扑排序 → parallelGroups」而本仓「无依赖拓扑」，隐含上游有真依赖分析。复核上游唯一生产入口 `scheduleTools`（`apps/zcode-cli/packages/core/src/runtime/methods/tools.ts:38-61`）：每个调用 `dependsOn: []` **恒为空**（`tools.ts:49`），无任何填充源（全仓 grep 仅类型定义与空数组字面量）。于是拓扑排序退化为单层，分组只由 `canRunInParallel`（metadata：readOnly/destructive/concurrentSafe/sideEffectScope + 内置白名单 `READ_ONLY_TOOLS`，`scheduler.ts:233-243`）决定，非并行工具 flush 成单例组（`scheduler.ts:154-201`）。

两侧实际语义对照（均【pack 未验证】上游行号）：
- 上游：组间串行、组内全量并发（`batch-runner.ts:32-33` `Promise.all`；组>10 才分块 `:37-40`，且分块间整段等待）；未知命名工具默认串行（`scheduler.ts:97-102`，fail-closed）。
- 本仓：`executeToolCalls` 首调用定组（`packages/core/agent-loop/src/tool-calls.ts:85-100`），exclusive 单调用屏障、parallel 连续段进池（`tool-calls.ts:89-100`）；池内每次 start 前**重读** `ctx.tools.executionMode`（`tool-calls.ts:199-213`），非 parallel 即断；结果按模型序提交（`:146-161`），取消补合成结果（`:238-260`）。
- 分类来源：本仓 `executionMode` 仅在工具显式 `isConcurrencySafe(args)===true` 时并行，未知/未声明/校验失败/抛错一律 exclusive（`packages/core/tools/src/index.ts:1303-1312`；包装层校验失败→false `packages/core/tools/src/schema.ts:625-630`）。生产标注抽查：仅只读类（tool-fs read/read-image、tool-web search/fetch、subagent、session-query）标 true，写类全部未标 → 串行。

**触发场景判定**：模型同批发 `[写文件A, 读文件A]`——上游 write 无并行 metadata → 单例组屏障，read 在其后组，串行；本仓 write 未标 `isConcurrencySafe` → exclusive 屏障，同样串行。`[grep, grep]` 两侧皆并行。两侧只在「某写类工具按参数声明并行安全」时才会分歧，当前生产无此标注。**结论：生产行为等价，本仓动态重读比上游静态快照更保守；P0 改动（照搬拓扑）无收益**。保留一条防回归：新增工具若误标 `isConcurrencySafe: () => true` 会打开真差距（见 §5-A3）。

### 1.2 ZCode 底座 unconfigured ——【维持现状】

`packages/preset/agent-preset-registry/src/backend.ts:73,182-207`、`packages/client/ui-agent-preset/src/client/backend-store.ts:161-173`、`builtin-agent-adapter.ts:125-127`（对照表已核，本轮未重复逐行验证）。这是产品状态而非 loop 行为差异，不影响模型表现；A07 是否推进属规格决策，不属行为对齐。

## 2. P1 复核

### 2.1 压缩预算族 ——【真差距（按路由分层）】

- 触发时机：对照表称上游「每模型步」、本仓「pre-step」。复核：本仓 `BasicCompactionEngine._registerAutomaticCompaction` 挂 `agent/pre-step` 做压力压缩（`packages/compaction/compaction-basic/src/index.ts:158-176`），即**每个模型步前**——与上游 `turn-loop.ts:77-114`（microcompact `:79` + autoCompact `:88`，每步）**时机等价**。溢出兜底：本仓 `agent/request-error` + `maxOverflowRetries`（`index.ts:190-234`，成功判据 `surface.replaceGeneration`，按 agent 计数、idle/新 assistant 消息重置 `:178-188`）。
- 预算量纲：本仓默认 0.8/0.16 + headroom 65,536（`compaction-basic/src/config.ts:20,23,75`），`thresholdTokens=min(0.8×window, window−maxTokens−headroom)`（`config.ts:191-194`）。128K 窗、maxTokens 8K → 阈值≈54K；上游 preflight-v1≈window−21K→107K。**非 GLM 默认路由提前约一半压缩**：真实后果是长程任务过早丢细节、摘要频次翻倍。GLM preset 已改 `thresholdRatio 0.9 / headroom 8192`（`apps/cli/config/examples/glm-harness/cordis.yml:42-50`，200K→~180K、128K→~107K，与上游 preflight-v1 几乎重合）→ GLM 路由此项**已对齐**。
- 快速回填熔断：上游 `evaluateRapidRefill` + `rapid_refill_blocked` 抛结构化错误（`turn-loop.ts:87,102-108`，【pack 未验证】）；本仓无对应「压缩后快速回填→连续再溢出」计数器，等价物是 `maxOverflowRetries`（默认 1，`config.ts:106`）。后果差异：压缩→回填→再溢出循环在本仓第 1 次重试后直接 turn error（fail-fast，不 doom loop 但丢诊断），上游熔断前给模型多 2 次自愈窗口且带结构化诊断事件。
- microcompact：上游每步前本地修剪最旧 tool result（`turn-loop.ts:79` + `compact/microcompact.ts` 存在，【pack 未验证】）；本仓无步前局部修剪，但有溢出时先行的可选 `toolResultPruner`（`compaction-basic/src/index.ts:292-298`）。后果：非溢出路径压力达标即整段摘要，工具结果重、对话轻时摘要质量损失更大。
- tool 配对：本仓 `selectCompactableRange`（`compaction-basic/src/region.ts`）边界规则本轮未读，压缩后 `deriveMessages()` 是否会产出无配对 `toolCallId` **未验证**。验证方法：构造长会话（assistant 带 tool-call + result 交错）→ 跑 `compactRegion` → 断言重放请求无悬空 `toolCallId`；已有测试基线在 `packages/compaction/compaction-basic/tests/`（存在性未确认）。

### 2.2 软告警层 ——【真差距】

上游实链已验证（非仅设计文档）：`detectRepeatedToolCallWarnings`（阈值 3、按 toolName+stableJson(input) 签名连击，`runtime/helpers/model-anomaly.ts:23-62,111-127`）、`detectToolCallBudgetWarning`（阈值可配，默认关闭 `:70-73`）、每 turn 注入上限 3（`:29,80`）；注入点 `turn-tool-warnings.ts:14-82` 以 `systemReminderAttachmentEntry("model_anomaly", …)` 进下一请求（模型可见），同时落 `ModelAnomalyWarning` 会话事件；接线于 `turn-tools.ts:21,274`。签名计数由 `turn-loop-state.ts:111-112` 持有，runtime 命令排水时清零（`turn-loop.ts:63-64`）。

本仓无对应实现（全 agent-loop 无 signature/streak 状态）。**可观测后果**：模型同参重复调用同一工具时（读失败重试、编辑冲突循环），无模型可见提醒 → token 空转直到用户取消；且没有事件可供 UI/日志聚合识别 doom loop。这是六个维度里唯一「上游有、本仓完全缺」的模型可见层。

## 3. P2 复核

| 项 | 结论 | 依据 |
|---|---|---|
| role 词表多 `developer` 一档 | **伪差距（方言）** | 本仓 5 角色（`packages/llm/llm/src/message.ts:151-180`）；GLM 方言显式 `supportsDeveloperRole: false`（`cordis.yml:16`）。仅剩出站确认：请求体不含 `developer`（需实测） |
| system 三段契约 | **伪差距（方言）** | 上游三段是 anthropic-messages 的 provider-visible 缓存分段（`system-prompt-contract.md:27-47`，【pack 未验证】）；本仓单 system 串 + 有序 section（`packages/core/system-prompt/src/index.ts:125-159,405-443`），动态上下文以 user 快照注入（`:303-307`）。GLM 走 openai-completions 单 system 串，三段结构本来不适用；应考察的是内容顺序与缓存稳定，不是段数 |
| reasoningLevel 映射 | **伪差距（建模差异）** | 本仓 `reasoningEfforts` 档位→线值映射已实现（`packages/llm/llm-pi-ai/src/catalog.ts:620,782-819`），GLM 声明 low/high/max（`cordis.yml:24-27`）；上游是 EnumOptionSpec overlay。能力面等价；需出站实测 `reasoning_effort` 真实出现 |
| 默认重试 5 vs 10 | **伪差距（可配置）** | 默认 5（`packages/llm/llm/src/retry-policy.ts:14`）；GLM preset 显式 10（见 §4 勘误） |

## 4. 对照表勘误（复核中发现）

1. §2.6/差异表#4「GLM 覆盖显式压到 `maxRetries: 2`（cordis.yml:28-30）」**有误**：实际是 `maxRetries: 10`，注释明说保留上游预算（`cordis.yml:28-34`）。重试维度在 GLM 路由已是同量纲。
2. §2.3 把触发时机列为差异——本仓压力压缩同样每 pre-step 执行（`compaction-basic/src/index.ts:158-176`），时机维度实为**等价**；真差异在量纲与熔断结构。
3. §2.2 P0 表述「上游拓扑排序」需限定：机制存在但 `dependsOn` 生产恒空（`tools.ts:49`），拓扑无实义。

## 5. §6 不得照搬清单逐条复核 ——【全部成立】

1. TurnMachine 不作 turn 状态源：成立。上游 `agent/turn-machine.ts` 存在（blob 确认），本仓 turn 边界以 Session 事件（`turn/start`/`step/start`/`step/end`/`turn/end`）为准（`agent.ts:305,329,356,385`）。
2. message-history canonical history + `CacheStats`/`replaceMessages`（上游 `:70-75,:119`，【pack 未验证】）不得成第二历史源：成立，本仓历史真相在 Session 事件（`agent.ts:671-685` deriveMessages）。
3. 上游工具注册/执行/权限注入不得绕过 `ctx.tools`：成立，本仓调度全程经 `TOOL_RUNTIME_SCHEDULER.prepare/dispatch/finalize`（`tool-calls.ts:153-154,170-174`）。
4. 身份串 `You are ZCode, an interactive coding agent`（`cli-prefix.ts:8`，【pack 未验证】）不进本仓：成立，`packages/` grep 0 命中；本仓身份为 `You are an AI agent powered by DeepSeek Harness.`（`packages/core/system-prompt/src/index.ts:429`）。
5. 上游 provider 目录不替换 `llm-pi-ai`，需显式映射：成立（上游 `packages/provider/src/config/model-config.ts:248-276` 行号本轮未复核；结论不依赖该行号）。
6. `glm-5.2-reasoning-depth.md` 不作实现依据：成立（该文档在 pack 中存在；按对照表与本仓 `zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:9` 维持弃用判定）。
7. 账号配置/网关/授权头不进仓：成立（政策性，无反证）。

## 6. 影响排序（按对模型表现的实际影响）

1. **P1 软告警缺失**：唯一缺位的模型可见自纠偏层，直接决定长程任务 doom loop 行为。
2. **P1 默认路由压缩预算**：非 GLM 路由 128K 窗阈值≈54K，比上游提前约一半压缩，伤长程任务连续性；GLM 路由已对齐，不急。
3. **P1 步前 microcompact 缺失**：压力触发即整段摘要，工具结果占比高时摘要质量受损（可部分用 tool-result-pruner 补）。
4. P0 调度拓扑：伪差距，仅需防误标回归。
5. P2 各项（system 分段/role/reasoning/retry）：方言差异；出站实测前不构成行动依据（GLM 端点为占位地址，当前无法实测，`cordis.yml:10`）。

## 7. 建议动作（含隔离方案）

`packages/core/agent-loop` 与 `packages/compaction/compaction-basic` 均为全仓共享驱动，以下方案都以「默认零行为变化、preset/路由显式开启」为原则。

**A1（Top）软告警层**：agent-loop 新增 `agent/step-anomaly` waterfall（默认无监听 = 零变化）；`step()` 取得 toolCalls 后按 `name+stableJson(args)` 签名计数（复用上游 stableJson 算法），达阈值且未超每 turn 上限时，把提醒文本经现有 `inbox.splice('next-step',…)` 注入（`agent.ts:536` 同路径），不结束 turn、不禁工具。开关放 agent preset 配置 `anomalyWarnings:{repeatedToolCall?,budget?,maxPerTurn?}`，未配置即关闭 → 只影响开启该配置的 preset（如 zcode-inspired），其他 DSH 会话不受影响。

**A2（Top）按路由补压缩预算**：架构已支持 `modelPolicies` 精确覆盖（`config.ts:118-139`），无需改共享代码——为每个非 GLM 底座路由补 `modelPolicies` 条目（阈值≈window−max(reservedOutput,8K) 上游同量纲），GLM preset 保持 `cordis.yml:42-50`。开关即路由表本身，天然按底座隔离。同时把 tool-result-pruner 装配进 standard/GLM preset，使步前压力路径先走模型免费修剪。

**A3（Top）防误标回归闸门**：保持现 fail-closed `executionMode`（`core/tools/src/index.ts:1303-1312`）不变，加一条仓库级测试/lint：枚举注册表里「非只读工具且 `isConcurrencySafe!==undefined`」即失败（白名单豁免）。放在 preset 测试层，不改运行时。

**A4**（不紧急）溢出恢复增加连击计数与结构化诊断事件（对齐上游 rapid-refill 语义，`maxOverflowRetries` 保留为最终闸门）；仅在 GLM preset 的 compaction 配置里开启。

**A5**（验证项，非改动）：待真实 GLM 端点可用后做出站实测三项：请求体无 `developer`、含 `reasoning_effort`、system 单串内容与压缩缓存行为；同时补压缩 tool 配对重放测试（§2.1 末条）。

## 7. 未知与限制

- 全部上游行号来自 pack blob 计数，【pack 未验证】；核验方法：临时 git 骨架 + `GIT_OBJECT_DIRECTORY` 只读 `cat-file`，未写入快照、未执行任何 git 写操作。
- 上游 3.16.2 未获取，结论仅对 `aac4755`（3.15.1）负责。
- `compaction-basic/src/region.ts` 与 `compaction/src` 基类本轮未逐行读，tool 配对完整性待 A5 实测。
- 本轮只读 + 仅写本文档；未运行测试/构建。
