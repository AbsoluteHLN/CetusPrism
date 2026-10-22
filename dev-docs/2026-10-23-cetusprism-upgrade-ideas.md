# CetusPrism 升级思路清单

日期：2026-10-23　分支：`release/v1.7.3`　作者：idea架构师
输入：`AGENTS.md`、`dev-docs/2026-10-22-composer-agent-team-spec-v1.zh.md`（下称 spec）、`dev-docs/2026-10-22-zcode-agentloop-parity.md`（下称 parity）。本轮已落地项（S4 团队四件套、`DEVELOPER_ROLE_REJECTED` 专项错误码 `packages/llm/llm/src/error.ts:67`、reasoningEffort 映射链、preset 校验边界）不再提议。带「转引」的证据出自上述已读文档，其余均经本次 Grep/Read 核验。

## 1. 现状体检

1. **ZCode 底座是永久死选项**：probe 未配置时恒为 `unconfigured`（`packages/preset/agent-preset-registry/src/backend.ts:187-196`），客户端对非 ready 后端直接拒绝（`packages/client/ui-agent-preset/src/client/backend-store.ts:161-173`），且全仓生产代码零处 `registerBackend`（parity §1:38-39）。UI 一直挂着一个永远选不动的「ZCode」。
2. **工具调度无依赖语义**：`packages/core/agent-loop/src/tool-calls.ts:85-100` 只按 `executionMode` 分组（`mode === 'parallel' ? planned.slice(next) : [first]`），能并全并；有副作用顺序要求的一批调用可能同时发起（parity 差异 #2，判「需要上游同形」）。
3. **压缩预算是比例制、无 microcompact**：`packages/compaction/compaction-basic/src/config.ts:20,23` 阈值 0.8 / 保留 0.16，与上游 200K/32K/13K 常量制不可换算；局部压缩无对应实现（parity §2.3:83）。
4. **无 doom-loop 软告警层**：重复工具调用、预算告警均无模型可见提示（parity §2.4:94「本仓无对应实现」）；README 自认「无内置 turn 预算」（`packages/core/agent-loop/README.md:217`）。
5. **persona 双源漂移**：`packages/bundle/web-app/presets/standard.patch.yml:207` 与 `apps/cli/config/examples/glm-harness/cordis.yml:56-64` 是两份措辞不一致的手写 persona，会继续分叉（parity 差异 #6）。
6. **基线曾有 3 条永远失败的用例**：`packages/client/ui-conversation/tests/skeleton.client.spec.tsx:388,552,586,618` 断言旧品牌文案（品牌已改名 CetusPrism）。**已于 `“test(ui-conversation): assert the hero copy the product ships” 修复`（2026-10-23 01:18:55）修复，改为断言现行品牌文案，本仓 `packages/client/ui-conversation` 现 656/656 全绿。** 本条写作时该修复已入库 14 秒，故此处的「仍断言旧品牌文案」与事实不符。

## 2. 升级思路清单

### 思路 1：工具调度引入依赖拓扑 + parallelGroups（P0）

- **问题**：如体检 2；`tool-calls.ts:90` 的分组对整段剩余调用一刀切并行，不感知资源冲突。
- **方案**：在 `tool-calls.ts` 分类处加资源键推导（路径/资源 id 归一化），冲突调用降级 exclusive 或拆组，组间串行；语义对齐上游 `scheduler.ts:60-83`（转引 parity §2.2），不复制上游文件。新增 Config 开关 `toolScheduling: 'legacy' | 'topological'`（默认 legacy，preset/底座可覆盖）。
- **收益**：消除对照表中唯一「行为级执行正确性」差异（parity 差异 #2）。
- **成本**：2-3 个文件（tool-calls.ts、config schema、测试）；agent-loop 是全仓共享驱动，影响所有 DSH 会话，须开关隔离 opt-in。
- **风险与前置**：键推导过宽会过度串行；需快照钉住「开关关闭时行为不变」。前置：先落思路 6 恢复干净基线。

### 思路 2：doom-loop 软告警（P1）

- **问题**：如体检 4；模型反复重放同一失败调用时无模型可见纠偏层。
- **方案**：`agent.ts` 步骤组装处统计「同签名工具调用连续重复次数」与「turn 累计 token」，达阈值时插入 `developer/message` 提示（模型可见、不结束 turn、不禁工具）。复用既有 `developer/message` 事件类型即无需动 `SessionEventMap`；若需独立投影再开新事件。阈值做成 Config 字段（AGENTS.md:139 禁硬编码 tunables）。
- **收益**：长程任务获得自纠偏层，补齐 parity「需要上游同形」清单（parity §4）。
- **成本**：agent.ts 1-2 处 + 快照；影响所有会话 → 与思路 1 共用开关机制。
- **风险与前置**：告警文本模型可见必须满足 `model-visible ⟺ logged`（AGENTS.md:134）；阈值过灵敏会污染上下文，默认值偏保守。

### 思路 3：压缩预算常量族 + reactive 熔断（P1）

- **问题**：如体检 3；长程任务逼近窗口时的行为与上游不可对齐（parity 差异 #3）。
- **方案**：`compaction-basic/src/config.ts` 增上游量纲字段（输出预留、preflight、buffer 等，按路由模型覆盖），默认值保持现比例制不变；`src/index.ts:190-194` 的溢出处理增「每 model-step 至多一次 reactive compact + 快速回填熔断」。microcompact 后置。
- **收益**：GLM 200K 窗口的预算语义可显式声明；溢出兜底有熔断。
- **成本**：2-3 个文件 + config-catalog 重生成 + 快照；共享包但默认行为不变，无会话迁移。
- **风险与前置**：与思路 1/2 同为共享包，宜分批串行；字段 JSDoc 需完整（AGENTS.md:168）。

### 思路 4：persona 单源 + system 三段契约（P2）

- **问题**：如体检 5。
- **方案**：persona 文本收敛到单一来源（建议 `packages/core/system-prompt/src/index.ts` 导出或独立模板文件），`standard.patch.yml` 与 `cordis.yml` 引用同一来源；按 parity §5 P2 落地 system 三段。实施前先读 `system-prompt/src/index.ts`（parity §7:231 标注未逐行阅读）。
- **收益**：双源停止漂移；提示词改动单点生效。
- **成本**：约 3 个配置/源文件；persona 变更触发快照重录（AGENTS.md:153）。
- **风险与前置**：模型行为基线变化，需快照 A/B 对照；示例配置受众不同，合并前确认语义等价。

### 思路 5：端点实测探针（声明前实测，不自动落盘）

- **问题**：档位/compat 只有手工声明、无探针（spec §0.4-0.5：`ModelReasoningEfforts.tsx`、`catalog.ts`；发现工具 `packages/subagent/tool-subagent/src/list-models.ts:76-80` 只回显已声明档位）；S0.11 的 400 直到线上才暴露（spec §0.11:29-59）。
- **方案**：`packages/llm/llm-pi-ai/src/discovery.ts` 增最小探针（1-token 请求，携带候选档位与 compat 组合），`ui-settings-models` 模型行加「实测」按钮，把 200/400 结果回填为 `compat.supportsDeveloperRole` / `reasoningEfforts` 候选。
- **收益**：配置期一键发现 developer-role/档位拼写问题，把 S0.11 类事故挡在配置期。
- **成本**：2 个包 + README 双语与 i18n 重录；不进会话热路径。
- **风险与前置**：消耗真实额度，默认仅手动触发；结果只作候选（理由见「不建议做」第 3 条）。

### 思路 6：修复 3 条基线失败用例 —— 【已完成，本轮内】

- **问题**：如体检 6。
- **状态**：**已由 `“test(ui-conversation): assert the hero copy the product ships” 修复` 完成**——`skeleton.client.spec.tsx:388,552,586,618` 改为断言现行品牌文案，`packages/client/ui-conversation` 现 656/656 全绿（退出码 0）。
- **本条保留的原因**：它记录了「回归判定基线」这一前置条件的来历；下面 Top 3 里排在第一位的「修复 3 条基线失败用例」即指此项，已完成。
- **收益**：回归判定恢复「除已知环境基线外全绿」；思路 1/2 的回归判定不再带噪音。
- **成本**：1 个测试文件，无产品改动。
- **风险与前置**：无。

### 思路 7：设置区智能体档案卡片（S4.1.6 补账）

- **问题**：档案目前只能手改 profile patch（spec §4.8:270 明示延后），跨会话身份管理无 UI 面。
- **方案**：`packages/client/ui-settings-subagent` 沿用 `team-model-restriction-card-controller.ts` 范式增档案卡片：列表/新建/编辑 name、description、modelRoute、allowedEfforts、preset、backend，经 config-editor 写回 YAML。
- **收益**：S4 档案能力闭环到非 YAML 用户。
- **成本**：1 个 client 包 + settings 写回链路；不触共享包、不影响既有会话。
- **风险与前置**：文案走 locale 字典（AGENTS.md:152）；写回过 misconfiguration-fails-loud 校验（AGENTS.md:140）。

### 思路 8：ZCode 底座去留裁决（文档先行）

- **问题**：如体检 1；A07「ZCode 底座必须运行真实 ZCode AgentRuntime」仍 pending（parity §2.7:131-132）。
- **方案**：二选一并写裁决记录进 dev-docs：(a) 废止——从后端目录摘除 zcode 或标 deprecated 并写明原因；(b) 立项真实 AgentRuntime 适配。
- **收益**：消除「看得见选不动」的死选项，或正式启动 A07。
- **成本**：(a) 约 2-3 个文件 + README；(b) 数十文件、跨周期。
- **风险与前置**：(b) 需先裁决是否废止「不建立平行 Agent loop」约束（`zcode-harness-adapter-plan:50,84`，转引），属规格级变更。

## 3. Top 3 排序建议

1. **思路 6（基线用例）——【已完成】**：成本最低、立刻把回归判定基线修干净，是其余所有共享包改动的前置。已由 `“test(ui-conversation): assert the hero copy the product ships” 修复` 落地。
2. **思路 1（调度拓扑）**：对照表唯一被裁「需要上游同形」的执行正确性差异（parity §4），直接影响副作用任务的结果正确性，且为 P0。**注意**：后续 AgentLoop 对齐复核已独立核实上游 `dependsOn` 在生产入口恒为空数组，拓扑排序是空转——「与上游同形」这一条已不需要做；剩下的只是「要不要新增上游没有的能力」这一产品决策。
3. **思路 2（软告警）**：改动面最小的模型可见能力补齐，与思路 1 同在 agent-loop，可共用同一隔离开关与快照基建，边际成本最低。

压缩（思路 3）紧随其后：重要但语义改动最重，宜在开关机制验证后单独一批。

## 4. 明确不建议做的事

1. **照搬 ZCode 源码/建平行 Agent loop**：撞既有规格（`zcode-harness-adapter-plan:50,84`，转引）、产生第二份运行时状态源、绕过 `ctx.tools` 授权链、违反 `model-visible ⟺ logged`（AGENTS.md:134）。
2. **为 Team 开 per-child preset 施加口子**：spec §4.8:277-287 已取证这是有意边界；开口子要改全仓共享的 `SubagentCapabilities`，影响所有 DSH 会话，收益只覆盖 Team 场景。preset 记录在快照并受 `allowedPresets` 约束已够用。
3. **探针自动改写路由配置**：`cordis.patch.yml` 必须保持唯一事实（`packages/llm/llm-pi-ai/README.zh.md:113`）；实测结果自动落盘会让声明失去可审计性。探针只出候选，采纳永远是人手。
4. **群聊消息进模型对话面**：Team 事件 log-only 是投影与派生历史的既有不变量（spec S4.4.5；`journal.ts:65-69`，转引）；破坏它等于把协作噪音灌进每个成员上下文并破坏快照回放。
5. **现在追上游 3.16.2 基线**：3.15.1 工作树不可直接读、3.16.2 副本未获取（parity §1:34、§7:226），此时对齐是在移动靶上打靶；应先固定 3.15.1 基线并建立周期重对齐机制。

## 未验证项

- 思路 1 资源键推导的具体算法、思路 2 阈值默认值：未验证，实施时以快照与实测定标。
- 思路 5 探针请求形态：未验证。验证方法：按 spec §0.11 的直连实测法对目标网关发 1-token 请求，复测 4 组 role/档位矩阵。
