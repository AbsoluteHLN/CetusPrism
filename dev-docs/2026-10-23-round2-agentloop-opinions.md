# 第二轮意见：压缩预算分层（D）与软告警层（E）

日期：2026-10-23 04:45　作者：AgentLoop对齐师　独立意见，不重复第一轮复核内容。
基线：`release/v1.7.3` @ `a1433b9430d30aa94fb463fbcdbd6364121ed495`（`git rev-parse HEAD` 实测；**Chief 给的 `b5d522e762` 已落后 4 个提交**，本地=远端）。本文只写本文件，未动任何其他文件。

## 0. 前提修正（先于两题，均已验证）

1. **D 题前提部分过时**：web-app standard preset 已覆盖压缩预算——`packages/bundle/web-app/presets/standard.patch.yml:88-99`（`thresholdRatio: 0.9` + `headroomTokens: 8192`，注释明说 128K 窗从 ~30K 提到 ~87K），并有双向锁定测试 `packages/bundle/web-app/tests/compaction-budget.spec.ts:58-92`（standard 与 GLM cordis.yml 各一套断言）。**已验证**：`pnpm vitest run --config configs/vitest.config.ts packages/bundle/web-app/tests/compaction-budget.spec.ts` → `Test Files 1 passed / Tests 2 passed`，退出码 0。主装配面（standard）的 128K 阈值=87,040，不再是我第一轮说的 54K。
2. **tool-result-pruner 已装配**：`standard.patch.yml:102-107`、`ptc.patch.yml:78-83`（thresholdChars 8192 / head 4096 / tail 1024）。第一轮建议 A2 的"装配 pruner"一项已由他人落地。
3. **E 题前提成立**：全仓 `packages/` grep `anomaly|repeatedToolCall` 0 命中（已验证，2026-10-23 04:41）。另外 Chief 引用的"阈值 3"只对应**重复调用**告警；上游的**预算**告警默认是关的（上游 `runtime/helpers/model-anomaly.ts:70-73`：未配置 `toolCallWarningThreshold` 直接返回 undefined）。
4. `apps/cli/config/` 下只有 `examples/`（glob 验证），无生产默认装配；compaction-basic 的生产装配点就是两个 web-app patch + GLM 示例 + 测试快照。

## D. 压缩预算按路由分层

**结论：不按路由补 `modelPolicies`；改在 preset 装配层补齐——只需给 `packages/bundle/web-app/presets/ptc.patch.yml:74-75` 补一份与 standard 相同的 `thresholdRatio 0.9 / headroomTokens 8192`，并扩一条装配闸门测试。优先级：中低（排在 E 之后）。**

- 证据：生产装配点共两处——`standard.patch.yml:88-99`（已覆盖）、`ptc.patch.yml:74-75`（**无 config，吃服务默认 0.8/65536**）；GLM 示例 `apps/cli/config/examples/glm-harness/cordis.yml:42-50`（已覆盖）。`apps/cli/config` 无其他生产配置（已验证）。快照（`snapshots/**`）是测试产物，不算生产面（未逐一验证其用途）。
- 理由：①隔离单元本来就应是 preset：`compaction-basic` 是插件，`standard.patch.yml:80-87` 的 `isolate: {compaction: true}` 已把压缩组按 preset 隔离——preset 级覆盖天然满足 Chief 的硬约束，**不需要动共享包，也不需要路由表**。②`modelPolicies` 适合「同一 preset 服务多个 contextWindow 差异大的模型」；当前两个 patch 都是单模型形状，而 0.9 比例制本身窗口自适应（128K→87K、200K→159K、262K→221K，测试已锁），逐路由抄常量反而引入第二份需要同步的表。③「给哪些路由」的答案因此收缩为：**ptc 一条**（若确认 ptc 面有真实流量；其使用面我未验证，见文末）。
- 风险与对策：未来新 preset 装配 compaction-basic 忘带 config → 沿用 `compaction-budget.spec.ts` 的解析模式，加一条「每个生产 patch 内 compaction-basic 必须显式预算」的测试（模式与 `loader-composition.spec.ts:59-70` 锁 YAML 顺序同构）。不建议改服务默认值 0.8/65536——那正是硬约束禁止的共享默认变更。
- 优先级：**第 3 位左右**（低于 E、低于进行中的功能线）：它只影响 ptc 面与未装配组合，主路由已由现有测试锁定。

## E. 软告警层

**结论：做；阈值与上限照上游（重复调用 3、每 turn 注入上限 3；预算告警默认关）；按 preset 插件装配隔离，`packages/core/agent-loop` 源码零改动。**

- 落点与 seam：新建独立小插件包（如 `dsh-agent-anomaly-warnings`，与 `dsh-compaction-basic` 同构的可组合件），不进共享驱动：
  1. 检测：订阅 `session/event` 的 `tool/call` 事件（`tool-calls.ts:263-266` 有 name+arguments），按 `name + stableJson(args)` 算签名连击（上游算法 `runtime/helpers/model-anomaly.ts:111-127`），per-agent 计数，`turn/end` 重置。
  2. 注入：监听既有 `agent/pre-step` waterfall（`agent.ts:276-282`，compaction-basic 同一 seam），达标时把提醒文本 **prepend 进 `PreStepDecision.messages`**；`agent.ts:419-423` 在 step 首次请求时把这些消息以 `user/message` 持久化——模型可见、进 Session 日志（满足 `model-visible ⟺ logged`），不新增消息协议。
  3. 事件：同时 `ctx.logger.warn` 一条结构化日志（聚合用）；如需会话内可查事件，再议新增 Session 事件类型（那是 Session 包的公共面，第一轮不建议本轮扩）。
- 配置形状（preset 行）：`{ repeatedToolCallThreshold?: 3, maxWarningsPerTurn?: 3, budgetToolCallThreshold?: undefined }`——`budgetToolCallThreshold` 缺省即关闭，与上游默认行为一致；未配置整段 = 插件不装配 = 零行为。
- **为何不扩大共享驱动默认**：不改 `agent-loop` 任何文件与默认值（只用既有 waterfall/inbox/事件）；插件默认不装配；开启它的 preset（建议先 `standard.patch.yml` 的 zcode-inspired 行 + GLM 示例）才生效。对比第一轮我提的「改 agent-loop 加事件」方案：本方案连共享包的新事件都不加，隔离更干净。
- 风险：①提醒 prepend 会让本已 `completed` 的 turn 多走一步模型调用（上游 reminder 同语义，上限 3 条缓解）；②注入的是 user-role 快照而非上游的 system-reminder 方言——GLM（openai-completions、无 developer role）下 user 快照是本仓既有 idiom（runtime context 同通道，`agent.ts:274-280`），可接受但措辞要自识（建议前缀 `Runtime notice:`）；③签名对大参数（长 file 内容）有成本——上游用 stableJson 规范化后 JSON.stringify，超长参数建议截断哈希（实现细节，未验证成本）。
- 阈值：照上游 3/3（上游 `model-anomaly.ts:28-29`，【pack 未验证】同第一轮标注）；不建议自创。

## 对 Chief 的两点修正

1. **"非 GLM 路由仍吃服务默认"已不成立**：standard preset 覆盖 + 测试双锁（见前提 1，已验证）。真正待补的只有 `ptc.patch.yml:74-75`。若按原方案"全表补 modelPolicies"，是在为不存在的问题加维护面。
2. **E 题描述漏了预算告警默认关闭**这一半：上游 `detectToolCallBudgetWarning` 无配置阈值即返回 undefined（`model-anomaly.ts:70-73`，【pack 未验证】）；落地时预算告警应保持默认关，只默认开重复调用告警，否则每 turn 注入量不可控。

## 已验证 / 未验证

- 已验证：HEAD `a1433b9430`（`git rev-parse`）；`compaction-budget.spec.ts` 2 passed、退出码 0（命令见上）；`standard.patch.yml:98-99,102-107`、`ptc.patch.yml:74-83` 装配形状；`agent/pre-step` waterfall 与 firstAttempt 追加（`agent.ts:276-282,419-423`）；inbox splice 持久化（`inbox.ts:227-242`）；`packages/` 无 anomaly 实现（grep 0 命中）；`apps/cli/config` 仅 examples。
- 未验证：ptc preset 的实际使用面（哪些部署选 ptc.patch——影响 D 的优先级）；注入 user 消息对 GLM KV cache 的影响（无出站环境）；上游 model-anomaly 行号（沿用第一轮【pack 未验证】标注）；未运行 compaction-basic 或 agent-loop 的其他测试套件。
