# 回归风险审查：agent-team 升级 + developer-role 闭环（2026-10-23）

审查者：回归风险审查员。方法：只读 git 取证 + vitest 实测 + typecheck 实测。范围 = 7 个指定提交（52ce2d5156..HEAD 内），范围内另有模型接入/compaction 工作仅作影响面参考。

## 一、影响面矩阵

| 提交 | 改动 | 受影响包 | 风险 |
|---|---|---|---|
| 5d87f61543 | agent-team 服务层 +1767 行 | 仅 experimental/agent-team + 其 client/tool 消费方 | 低：包内自洽；投影扩展见 §3 |
| 2e5d7fc1b6 | tool 层 4 个新动作 + client dormant 修复 | tool-agent-team、client-ui-agent-team | 低（已实测全绿） |
| 7c7a9c9501 / 5cdc53821b | 配置示例 + 规格文档 | 无代码 | 无 |
| ea8785b21c | agentProfileSchema.allowedEfforts 改 readonly | agent-team 类型契约 | 低 |
| e7f1f3ee7c | llm/src/error.ts 新代码 + stream.ts 分类 | **llm 全体消费方**（所有 DSH 会话的错误分类路径） | 中：400 误分类见 §2-6 |
| ac51383f21 | catalog.ts 警告 + config.ts warnings 字段 | llm-pi-ai（共享驱动）、api 配置面 | 中：镜像 pi-ai 内部判定，漂移风险见 §2-6 |
| （轮内其他）1861ee8d80 等 | compaction-basic 仅测试 +15；llm-pi-ai src +442 | compaction-basic、llm-pi-ai | 低 |

共享包结论（Q1）：**本轮 7 提交零改动 `packages/core/agent-loop`**（`git diff 52ce2d5156..HEAD --stat -- packages/core/agent-loop` 输出为空，退出码 0）；`compaction-basic` 仅测试文件 +15 行（1861ee8d80，非本职责提交）。唯一触及的共享驱动是 **llm-pi-ai + llm（+442 行）**：所有经 pi-ai 路由的 DSH 会话受影响。影响为增量式——新增 `RouteCatalog.warnings`（catalog.ts:914）、新错误码 `DEVELOPER_ROLE_REJECTED`（error.ts:71）、`classifyPiAiError` 新分类分支（stream.ts:47）。唯一行为改变是 400 类错误的分类与文案，不改重试集合之外的任何既有路径。

**未来隔离开关的最小侵入点**（若要在 agent-loop 按 preset/底座隔离）：改 `packages/core/agent/src/runtime-types.ts:26` 的 `AgentOptions`。它已是 declaration-merge 可扩展契约（先例：`packages/subagent/subagent/src/depth.ts:12` 用 `declare module` 增补）。注入方式：底座/preset 包在自己的 types 里 merge 一个可选命名空间字段，在 preset 挂载解析时填值，`ReactLoopAgent` 构造器读取（`packages/core/agent-loop/src/agent.ts:125`）。agent-loop 源文件零改动，符合 AGENTS.md:135「Plugins, not loop changes」。

## 二、覆盖缺口清单（8 条）

【缺什么 / 建议加在哪个文件 / 验收标准】

1. **resume 半途断裂**：`upgrade.spec.ts:375` 只覆盖 sendMessage 失败。sendMessage 成功后、active 边提交前 abort（roster.ts:357 transact 内 `throwIfAborted`）会让成员 runtime 已跑但 roster 仍 dormant，重复 resume 将二次投递。→ 加在 `upgrade.spec.ts`：mock transact 抛出后断言成员阶段仍为 dormant、后续 resume 不重复投递。验收：构造取消后二次 resume 恰好一次投递。未验证（未实测该路径真实行为）。
2. **档案 preset 覆盖**：`roster.ts:431` `request.preset ?? profile?.preset` 允许请求静默覆盖档案声明 preset，但 spec 无「profile 声明 preset + 请求另一 preset」用例，是有意 override 还是漏校验无 pin。→ 加在 `upgrade.spec.ts` profiles 组。验收：两用例（覆盖成功 + 与 spec 声明的边界一致）。
3. **广播半途失败**：`mailbox.ts:295-303` target A 送达后 target B 失败的 early-return-false 路径无用例；现有 `upgrade.spec.ts:675` 只测 unreachable 正例。→ 加广播部分：A 已记录 delivered 边、B 保留 pending、recoverFor 重投仅 B。验收：投递边集合精确断言。
4. **跨 Team 档案复用**：roster.ts:496-509 注释声明「Reusing a profile in another Team」是设计意图，但零测试。→ 加在 `upgrade.spec.ts`：同一 profileId 在两个 Team 各 spawn 一员，双方独立记录 profileId。验收：互不串号、name 各自可用。
5. **dormant 恢复失败**：`upgrade.spec.ts:375` 已覆盖 sendMessage 拒绝路径（保持 dormant），此条不缺；但「resume 成功后立刻再 release→再 resume」的往返幂等无用例，建议补 1 条。
6. **sendsDeveloperRole 漏判/误判**：`catalog.spec.ts` 新用例只测 4 条正路（警告/已声明/非推理/已知 vendor）。漏：a) Responses 协议 + reasoning + 无声明的路径（`catalog.ts` sendsDeveloperRole 首分支 `api !== 'openai-completions'` 返回 true，仅靠 `compatGate(api)!=='offer'` 拦截——该门禁与分支组合无 pin）；b) `NON_OPENAI_PROVIDER_IDS` 精确名匹配的镜像漂移（route 名 'deepseek' 但 URL 指向别家网关）；c) `isDeveloperRoleRejectedError`（error.ts:71-73）对含 `developer_message` 字段名的 400 文本的误分类——convert.spec.ts 仅 1 条正例、零反例。→ 加在 `convert.spec.ts` + `catalog.spec.ts`。验收：反例矩阵至少 3 条（无关 400 不误分类、recognized-host 子串边界、Responses+offer 路径）。**【Chief 订正 2026-10-23】「仅 1 条正例、零反例」与事实不符**：`packages/llm/llm-pi-ai/tests/convert.spec.ts` 现有 **2 条正例 + 3 条反例**——正例 `:941-951`（角色被拒）、`:966-979`（措辞不含角色名仍被认出）；反例 `:955-958`（400 不提角色 → `INVALID_REQUEST`）、`:960-963`（有 developer 字样但无拒绝措辞 → `INVALID_REQUEST`）、`:984-987`（不提消息角色 → `INVALID_REQUEST`）。反例面已存在；真正缺的是「含 `developer_message` **字段名**」这一类具体措辞，以及 recognized-host 子串边界。
7. **stateVersion 5→6 checkpoint 弃用路径**：`projection-events.spec.ts:101,200` 只测新写入；旧 v5 checkpoint 行（SQLite projection-cache）弃用→全量重放（`session-projection/src/index.ts:430,512`）无 pin 用例。→ 加 fixture 重放用例（参考 `session-projection-cache/tests/cache.spec.ts:636` 的既有手法）。验收：v5 行被弃用、从 init 全量重放后状态与 v6 一致。
8. **MemberStatus 穷尽 pin**：client 侧 union（TeamAction.tsx:29）靠手抄。→ 在 `client-ui-agent-team` 测试加穷尽性守卫：`const _pin: Record<TeamMemberProjection['phase'], true> = {...}`，服务端加枚举值即编译失败。**【Chief 订正 2026-10-23】pin 的键写错**：应钉 `TeamMemberView['status']`（运行时视图，`types.ts:131`），不是 `TeamMemberProjection['phase']`（持久相位，`types.ts:53`）——后者只有 4 个值且不含 `running`/`inactive`，钉不住客户端真正在用的那套词表。**更根本的修法不是加 pin，而是把手抄去掉**：客户端直接写 `type MemberStatus = TeamMemberView['status']`（`TeamMemberView` 已经从 `@deepseek-ai/dsh-experimental-agent-team/client` 导出，见 `packages/experimental/agent-team/src/client.ts:7`），服务端加枚举值客户端自动跟随，pin 就不必要了。**本轮已按订正后的写法落地。**

## 三、必答判断题结论

**Q2 已覆盖部分**：dormant 恢复失败（375）、档案名冲突（207）、route/effort/backend 冲突（221/242/264）、三范围拒绝（436-497）、广播全员投递与天花板（513-656）。除上表 8 条外无其他明显缺口。

**Q3 持久化兼容**：`projection.ts:513` stateVersion 5→6。框架语义：checkpoint 行 `ver` ≠ live `stateVersion` 即弃用，从 init 全量重放日志（`session-projection/src/index.ts:430`：「row.ver !== def.stateVersion → continue」）。老 JSONL：team/member 事件 v2/v3 均被接受（projection.ts:112-127、293-297），broadcast 事件是新增、老日志不存在 → 重放结果与升级前一致。**无需迁移、无需版本门禁**——框架的 ver 失配-弃用-重放就是迁移机制。代价仅是老会话首次打开多一次全量 fold（性能，非正确性）。风险点：新事件类型写入后，旧版本二进制按 AGENTS.md:131 required-on-read 规则会拒绝该日志；仓库政策明示不承诺 downgrade（AGENTS.md:7），可接受，建议在 v1.7.3 发布说明标注。

**Q4 类型断裂面排查方法**（本轮最有价值产出）：
服务端唯一事实源 = `agent-team/src/types.ts`（TS 契约）+ `projection.ts` zod schema（运行时）。手写副本是全部断裂面。可执行排查：
- 找副本：`git grep -n "'provisioning'" -- packages/ | grep -v agent-team/src`。命中：`client-ui-agent-team/TeamAction.tsx:29`（已修）与 `tool-agent-team/src/index.ts:154,246,281,292`（4 份 JSON-schema enum 副本，当前同步但无类型保护）。**【Chief 订正 2026-10-23】此条两处不准**：① `TeamAction.tsx:29` **并未修**——现仍是手抄 union `type MemberStatus = 'running' | 'inactive' | 'provisioning' | 'dormant' | 'failed'`（同文件 `:28` 的注释明说 running/inactive 来自子会话的实时回合状态），本审查 §二 第 8 条也把它列为「靠手抄」，两处自相矛盾；② `:154,246,281,292` **不是同一份枚举的 4 份副本**：`:154` 是成员状态（`running/inactive/provisioning/dormant/failed`），`:246` 是任务状态（`pending/in_progress/completed/deleted`），`:281`/`:292` 是消息投递状态（`accepted/queued`）——三个不同域，**只有 `:154` 复制了成员状态**；本条所依据的 `grep "'provisioning'"` 也只命中 `:154`（及 `:134` 的政策散文）。真正该钉的是 `:154` 一处。
- 类型层根治：客户端 `type MemberStatus = TeamMemberProjection['phase']`（索引派生；TeamAction.tsx:4-7 已导入该类型，改法零成本）。**【Chief 订正 2026-10-23】派生源写错**：`TeamMemberProjection['phase']` 是**持久相位** `TeamMemberPhase` = `provisioning | active | dormant | failed`（`packages/experimental/agent-team/src/types.ts:53`），而客户端要的是**运行时视图** `TeamMemberView['status']` = `running | inactive | provisioning | dormant | failed`（同文件 `:131`）。按 phase 派生会把 `running`/`inactive` 换成 `active`，直接改坏 UI 语义。正确写法是 `type MemberStatus = TeamMemberView['status']`（`TeamMemberView` 已由 `packages/experimental/agent-team/src/client.ts:7` 导出，改法同样零成本）。
- 运行时契约层（JSON schema enum 不受 tsc 保护）：pin 测试 `const _pin: Record<TeamMemberView['status'], true> = {...}`，服务端加枚举值即编译失败。
- tsc 兜底即 pre-push typecheck（实测 HEAD 退出码 0）——MemberStatus 正是 strict 编译会拦的错误，本轮 37 秒后即修（2e5d7fc1b6），push 历史从未含断裂。

**Q5 闸门缺口**：实测 `lefthook.yml`——pre-commit 6 个 job + pre-push 仅 `pnpm run typecheck`，**均不跑 vitest**。JSON-schema enum 副本与运行时 switch 漏 case 两类断裂 tsc/oxlint 都抓不住，只能靠 CI。建议（符合仓库「本地快、CI 全量」哲学）：pre-commit 不加 vitest；pre-push 在 typecheck 后追加 focused vitest，由 `git diff --name-only` 推导受影响包跑对应 spec；配合第 8 条 pin 测试把契约收敛到编译期。

**Q6 基线失败处置**（实测修正题面）：
- **3 条 hero 失败已不存在**：轮内 `6a382f4358` 已把断言改为产品新文案（实测 HEAD 上 ui-conversation + ui-agent-preset 共 52 文件 810 用例全过，退出码 0）。题面信息已过时，无需处置。
- **invariant.spec.ts:120** 实测仍失败：`pnpm vitest run packages/llm/llm packages/llm/llm-pi-ai` → 退出码 1，1295 用例中 1 失败（`invariant.spec.ts:121` 期望 `no readable registration` 抛错、实际未抛）。该断言属于共享包 llm 的不变式，与 developer-role 改动无直接关系（未验证引入提交），但它是 CI 覆盖门的一部分。建议**现在修**：先判产品语义——若 register 失败应抛错则修产品，若已改为静默则改断言。成本约半小时，收益是 CI 恢复全绿。

## 四、上线前必做清单

1. **修 invariant.spec.ts:120 基线失败**。验证：`& 'E:\dependency-cache\node-runtime\node.exe' 'E:\Projects\CetusPrism\node_modules\vitest\vitest.mjs' run --root 'E:\Projects\CetusPrism' --config 'E:\Projects\CetusPrism\configs\vitest.config.ts' packages/llm/llm` → 退出码 0，输出 `Tests N passed`。
2. **全量 typecheck**（pre-push 闸门，已实测本轮 HEAD 为绿，合并前再跑一次）。验证：`pnpm run typecheck` → 退出码 0，无 `error TS`。
3. **老会话重放冒烟**：用 `pnpm run test:snapshot` 或 v5 时代会话 fixture 重放，确认 agentTeam 投影无 failure 字段。验证：退出码 0；`state.failure` 不出现于输出。
4. **（发布后跟踪）补本清单 §2 的 8 条缺口**，优先 1/3/6（失败路径与误判面）。

## 附：未验证事项
- resume 半途 abort 的真实行为——静态推断，未实测。
- invariant 失败的引入提交——未做 blame 取证。
- 工作区含未提交改动（`llm-pi-ai/src/catalog.ts` 等模型接入后续），llm-pi-ai 测试结果含该状态；agent-team/tool-agent-team 无未提交改动，结论不受影响。
