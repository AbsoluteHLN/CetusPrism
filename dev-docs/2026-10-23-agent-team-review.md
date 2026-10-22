# 智能体团队 S4 升级审查（档案 / 驻留 / 模式范围 / 群聊广播）

审查者：智能体团队架构师 · 2026-10-23 · 基线：commit `5d87f61543` / `2e5d7fc1b6` / `7c7a9c9501`（release/v1.7.3）
范围：`agent-team/src`、`tool-agent-team/src`、`client-ui-agent-team/src/client`、三份 README、`cordis.patch.yml`、规格 §4 S4。
已认定的有意边界（不再提）：preset 仅校验不施加；`MemberStatus` dormant 缺失已修；`allowedEfforts` readonly 已修。

## 一、设计体检

### A.【P0】dormant 与投递链相位脱节：mail 会冷复原休眠成员，且复原产物不完整
**结论**：三条投递路径都不检查成员相位。`send_message`/`broadcast_message` 对 dormant 目标解析放行（`roster.ts:101`），投递层对「运行时不在线」的目标一律走 `steerHostSubagentPrompt`（`mailbox.ts:550-561` 单播、`mailbox.ts:373-383` 广播）；该调用在 activation 缺失时执行 `coldResume`（`subagent/src/continuation.ts:298-301,406-456`），而 `drainChildren` 只 dispose 不留任何「禁止再入」标记（`continuation-activation.ts:418-440`），`assertAdmitting` 只挡 manager/父树级排水（`:446-455`）。因此任何一条投递都会把 dormant 成员原地复活——与规格「显式不做」第 2 条「dormant 不会被 send_message 唤醒，唤醒只有 reactivate_teammate」（`dev-docs/2026-10-22-composer-agent-team-spec-v1.zh.md:288-289`）直接冲突。Lead 重启时 `recoverFor` 以 Lead 身份重投全部未送达项（`mailbox.ts:94-96`），等于重启即唤醒全部带积压的 dormant 成员。
**连锁缺陷 A3**：冷复原产生的子 Agent 在创建瞬间相位仍是 dormant，`tryMembership` 只认 active/provisioning（`roster.ts:154`），带 descriptor 直接返回 undefined（`roster.ts:160`）→ `tool-agent-team` 不安装 Team 工具（`tool-agent-team/src/index.ts:736-744` 仅挂 `agent/created`，`tool-agent-team/tests/tool-team.spec.ts` 无对应用例）。`resume()` 先 `sendMessage` 后 transact 记 active（`roster.ts:348-370`），使**正常 reactivate 路径也命中该窗口**：复活的成员没有任何 Team 工具，无法回消息；同时 Lead 对它 `interrupt_agent`/`release_teammate` 报 TEAM_MEMBER_NOT_FOUND（`roster.ts:75`、`roster.ts:303`）。工具层文案还自相矛盾：POLICY 同时写「starts or resumes an inactive target」与「send_message does not wake a dormant member」（`tool-agent-team/src/index.ts:134`），`send_message` 描述只说 inactive（`:476`），`wait_agent` 的 noProgress 指引未提 reactivate（`:137`）。
**影响**：休眠语义事实上不成立；被 mail 唤醒的成员成「运行中但档案 dormant、无成员资格、无工具」的僵尸态，只能靠再次 reactivate 修复；`reactivate_teammate` 主路径自身受影响。
**验证方式（未跑运行时）**：spawn→release→sendMessage→断言成员 runtime 被 coldResume 复活且 scope 内无 Team 工具；或直接跑下文用例 3。
**建议**：① `dispatchOnce`/`dispatchBroadcastThrough` 在投递前（建议与 steer 同置于 `journal.transact` 串行域，消除 release 竞窗）读目标相位，dormant 直接 return false 保持 queued；送达闭环由 reactivate 触发的 `recoverFor`（teammate 分支按 targetId 重投，`mailbox.ts:94-96`）完成。② `resume()` 先 transact 记 active 再提交 prompt，失败时回写 dormant（active→dormant 是合法边，`projection.ts:327-328`）。

### B.【P1】档案 vs 范围两层组合：正交不冲突，但「半份路由」静默失效
**结论**：两层职责清晰——档案提供 name/description/backend/route（`roster.ts:428-433`），范围对**替换后的生效值**做集该校验（`roster.ts:441-445` → `range.ts:39-60`），档案 `allowedEfforts` 又在 Team 范围之前先行收窄（`roster.ts:434-440`）；不重复、不冲突。但 `resolveModelRoute` 仅当 provider 与 model **同时**声明才认档（`roster.ts:585`），而 `normalizeProfile` 不做配对校验（`profile.ts:29-41`）：只声明 provider（或只声明 model）的档案会被静默忽略路由，成员实际跑在 Lead 路由/Team 默认上，且请求侧路由也不与之冲突检查。
**影响**：配置错误无声降级；与「档案钉死路由」的承诺（`types.ts:63-70`）相悖。
**建议**：`profile.ts` 声明期校验 provider/model 必须成对出现，否则 `TEAM_INVALID_CONFIG`。

### C.【P1】广播持久化上限：展开后逐目标计费，与单播独立
**结论**：上限检查在**展开后**逐目标执行（`mailbox.ts:215-226`），符合规格 S4.4.4（`spec:242`）与 README 双语（`README.zh.md:97`）。但广播 pending 与单播 pending **分开计数**：单播检查只数 `state.messages`（`mailbox.ts:135-141`），广播检查只数 `broadcasts/broadcastDelivered`（`:216-219`），且该独立性已被用例固化（`upgrade.spec.ts:579-595`）——同一目标最多可积 `2×maxPendingMessagesPerMember` 条。`Config.maxPendingMessagesPerMember` 的文档口径是单一上限（`types.ts:279-280`），与实现不一致。另广播满员错误信息未带目标名（`mailbox.ts:222`，单播有 `:139`）。
**建议**：统一或在 Config/README 写明「单播与广播各计一套」；错误信息补目标名。

### D.【P2】投影状态机：边集与现有写入点闭合，缺的是「未来边」的防爆语义
**结论**：`isMemberTransition`（`projection.ts:325-330`）允许 provisioning→active/dormant/failed、active→dormant、dormant→active。现有写入点全覆盖：spawn 失败 provisioning→failed（`roster.ts:530-536`）、成功 active（`:550-558`）、release active→dormant（`:313`）、resume dormant→active（`:362`）；active→failed、dormant→failed、failed→任意 均无写入者。`stateVersion` 5→6（`projection.ts:513`）与 v2/v3 写兼容（`:112-127,293-294`）一致。**缺边的后果**：一旦未来新增越界写入（如运行时崩溃记 active→failed），`applyProjectionEvent` 抛错置 failure（`:302-304`）且粘滞，`TeamJournal.state()` 从此对整个 Team 抛错（`journal.ts:33`），roster/mailbox/task 全部不可用，浏览器只见 failure。
**建议**：不为假设边扩集合；在 `dev-docs` 或 README 登记该失败模式（failure 字段即全 Team 冻结），未来加边时必须同步升 stateVersion 并写迁移用例。

### E.【P2】广播 ack 缺事件驱动补录
**结论**：单播有目标侧事件补账（`observeSessionEvent` → `markDelivered`，`mailbox.ts:72-82,581-593`）；广播投递边只靠 `deliverBroadcast` 内同步 checkpoint（`:358-359,371,383`），checkpoint 失败后该边要等 Lead 或目标重启才会由 `recoverFor` 补上（`:103-110`）——live 目标 + 瞬时 flush 失败的组合下，边可长时间悬置。
**建议**：`observeSessionEvent` 识别广播 id（`team-broadcast-` 前缀或查 `broadcasts` 集合）后改走 `markBroadcastDelivered`。

### F. 死信风险：有界，无永久黑洞
队列按目标封顶（满则 `TEAM_MAILBOX_FULL` 拒发，`mailbox.ts:135-141`），不存在无限积压；不可复原目标的消息持续留队并在每次 agent 启动重试（`:89-110`），仅 warn 可观测，无 TTL/DLQ。属可接受语义，但 README 未写「队列满后发送方收到 TEAM_MAILBOX_FULL」这一交互，建议补一句。

### G. 跨 Team 复用无重复身份缺陷
同 Team 名唯一含失败成员（`roster.ts:502-504`），跨 Team 重复实例化即复用语义本身（`:498-501` 注释背书）；投影按 teamId 隔离（`projection.ts:292`）。未发现缺陷。

## 二、缺口清单

**必须补（4）**
1. 投递链相位检查（A 主因）——改 `mailbox.ts` `dispatchOnce`/`dispatchBroadcastThrough`（或 `serializeDispatch` 回调入口），dormant 目标跳过投递；最小改动面约 10 行。
2. `resume()` 顺序反转：先记 active、失败回写 dormant——`roster.ts:333-371`；消除 reactivate 产物无工具的窗口。
3. 规格核心边界无回归保护：补「dormant 收信不唤醒、复原后送达」与「reactivate 后成员可用 Team 工具」两组用例（现状 33/33 全绿恰因无用例覆盖此边界）。
4. 工具层文案矛盾修正：`POLICY`、`send_message` 描述、`NO_ACTIVE_PEER_MESSAGE` 补齐 dormant/reactivate 语义——`tool-agent-team/src/index.ts:134,137,476,517`。

**可以延后（4）**
a. 档案半份路由声明期拒绝（B，改 `profile.ts`）；b. 广播 ack 事件驱动补账（mailbox.ts `observeSessionEvent`）；c. Config/README 上限口径与广播错误信息（`types.ts:279`、`mailbox.ts:222`）；d. 跨 Team 档案复用与广播部分失败用例（upgrade.spec.ts）。

**明确不做（3）**
1. preset 施加（有意边界，`packages/subagent/subagent/src/child-agent.ts:205`、`types.ts:130-136,219-229`）。
2. dormant 计入 maxMembers 但不占并发槽（已实现，`roster.ts:505`；并发池另一条限额）。
3. 邮箱 TTL/死信队列：上限已封顶，收益不抵复杂度。

## 三、落地方案（针对「必须补」）

1. **`packages/experimental/agent-team/src/mailbox.ts`**：在 `dispatchOnce`（现 `:531`）与 `dispatchBroadcastThrough`（现 `:314`）取 `journal.state(root)` 后，目标成员 `phase === 'dormant'` 即返回 false；投递与判定放进同一 `journal.transact` 消除与 release 的竞态窗口。`recoverFor` 走同一路径无需改动，resume 后由 `agent/created`→`recoverFor` 自动送达积压。
2. **`packages/experimental/agent-team/src/roster.ts` `resume()`**：将「dormant→active」transact 提到 `sendMessage` 之前；sendMessage 抛错时回写 dormant 并抛 `TEAM_MEMBER_NOT_RESUMABLE`。active→dormant 回写边合法（`projection.ts:327-328`）。
3. **用例一（`tests/upgrade.spec.ts`）**：`keeps a dormant teammate parked when mail arrives`——spawn→release→`sendMessage` 得 `queued`、断言成员未冷复原且 phase 仍 dormant、`reactivate_teammate` 后积压消息进入成员历史。
4. **用例二（`tests/upgrade.spec.ts`）**：`keeps a member dormant when reactivate fails`——mock 复原失败，断言 `TEAM_MEMBER_NOT_RESUMABLE` 且成员仍 dormant、可重试。
5. **用例三（`tool-agent-team/tests/tool-team.spec.ts`）**：`installs team tools on a reactivated teammate`——reactivate 后在成员 scope 断言 `send_message` 等工具已注册（防 A3 回归）。
6. **`tool-agent-team/src/index.ts`**：POLICY 末句改为「send_message steers a running target and starts or resumes an inactive target; a dormant target stays parked until reactivate_teammate delivers its queued mail」；`NO_ACTIVE_PEER_MESSAGE` 增加「a dormant teammate needs reactivate_teammate, not send_message」。

（全文约 5.4k 字）
