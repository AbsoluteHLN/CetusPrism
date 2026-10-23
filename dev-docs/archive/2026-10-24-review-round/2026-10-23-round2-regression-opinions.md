# 第二轮意见：订正复核、处置表确认与闸门裁决（回归风险审查员，2026-10-23）

审查对象：HEAD `“fix(tool-agent-team): say that a preset is recorded, not applied” 修复`（本地；任务面为 `“docs(spec): record what the fifth review's gaps turned into” 批次`，其上另有 4 个 docs/tool 提交）。方法：源码取证 + `pnpm vitest run --config configs/vitest.config.ts` 实测。产物仅此文件。

## 一、Chief 的 4 处订正复核

**订正 1（convert.spec.ts 计数）——成立。** 实测现状：2 条正例 + 4 条反例断言。正例 `convert.spec.ts:941-951`（`unsupported role 'developer'` → `DEVELOPER_ROLE_REJECTED` + 文案含 `compat.supportsDeveloperRole`）、`:966-979`（措辞 `Unexpected message role.` 不点名角色仍认出，且文案不冒称事实）；反例 `:955-958`、`:960-963`、`:984-987`，另有 `:988-992`（`the message role must be user or assistant` → `INVALID_REQUEST`）为第 4 条反例（Chief 记 3 条，少数了一条，方向无碍）。首稿错误根因：我只 diff 了 `“fix(llm): name the switch that repairs a rejected developer role” 修复` 单提交（当时仅 1 条新 `it`），未对累计 HEAD 现状取证。仍真缺的：`developer_message` 字段名措辞与 recognized-host 子串边界——Chief 订正亦点名此二项，一致。

**订正 2（三域枚举）——成立。** `tool-agent-team/src/index.ts:154` 成员状态、`:246` 任务状态、`:281`/`:292` 消息投递状态，三个不同域；我首稿「4 份 JSON-schema enum 副本」量词错误，实际与成员状态同域的只有 `:154`。补充两点对 Chief 的补充：① 三处仍各是**各自域**的手写副本、无类型保护，排查方法仍然适用，只是该钉的是 `:154` 一处；② `:136` 的 `ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']>`（索引派生）是正确范本，值得在意见里点名。

**订正 3（TeamAction.tsx:29）——实质成立，但「并未修」措辞过强。** 两个对象不同：① 「dormant 缺失」这一编译错误**确实已修**——`S4 工具层批次` 的 diff 明确含 `-type MemberStatus = 'running' | 'inactive' | 'provisioning' | 'failed'` → `+…'dormant'…`（我第一轮已读该 diff，有据）；② 手抄本身未消除（Chief 引 `:28` 注释「Durable lifecycle overlaid with the member Session's live turn activity」正确），我 §二.8 又称其「靠手抄」，同文档两处语义不同却共用「已修」一词，是我的表述缺陷。裁决：Chief 实质判断成立，「并未修」应读作「手抄未去掉」；「dormant 已补值」这个字面事实也成立。落地 `“fix(client-ui-agent-team): derive the member status from the server's view” 修复` 后争议消失（见下）。

**订正 4（派生源）——成立，且是四条中最重要的订正。** `types.ts:53` `TeamMemberPhase = 'provisioning' | 'active' | 'dormant' | 'failed'`（持久相位）≠ `TeamMemberView['status']`（`types.ts:138` 现行，`running | inactive | provisioning | dormant | failed`，含运行时回合叠加）。按 phase 派生会把 `running`/`inactive` 换成 `active`，改坏 UI 语义；我的首稿写法是错的。`client.ts:7` 确认导出 `TeamMemberView`，`TeamAction.tsx:6` 已导入。注意：Chief 订正中引 `types.ts:131` 已过时（该行现为 `TeamMemberSnapshotV2`，status union 漂移至 `:138`；`client.ts:7` 行号准确）——内容对，行号随 types.ts 后续提交漂移。

## 二、处置表逐条确认

| 缺口 | 确认/异议 |
|---|---|
| 1 resume 半途断裂 | 确认「先取证」。补充：“test(agent-team): cover the broadcast, profile and resume gaps the review named” 批次 未覆盖 abort 注入路径（roster.ts:357 transact 内 `throwIfAborted`），静态风险仍在，仍标未验证。 |
| 2 档案 preset 覆盖 | 确认留第二轮（规格问题；`roster.ts:431` request 覆盖 profile 的语义需规格先裁决）。 |
| 3 广播半途失败 | 确认直接落地；新用例「keeps the delivered edge and re-delivers only the failed target」与我的验收标准一致（mailbox.ts:295-303 路径）。 |
| 4 跨 Team 档案复用 | 确认直接落地；新 its「instantiates one declared profile again in another Team」命中设计意图（roster.ts:496-509 注释）。 |
| 5 往返幂等 | 确认；「one prompt per resume」验收正确。 |
| 6 sendsDeveloperRole | 确认部分落地。6a 已补（“test(llm-pi-ai): pin the developer role warning on the Responses protocol” 批次）；6c 我的「零反例」不成立（见订正 1）；真缺口收窄为 `developer_message` 字段名措辞 + recognized-host 子串边界（Chief 订正同此）；6b 镜像漂移留议：建议低成本先补「provider 名 deepseek + 别家 URL」双向 pin，再谈跟 pi-ai detectCompat 的同步机制。 |
| 7 stateVersion 5→6 | 确认留第二轮（跨包 session-projection）。补充：框架语义（ver 失配→弃用 checkpoint→全量重放，`session-projection/src/index.ts:430,512`）我第一轮已静态验证，风险是性能非正确性。 |
| 8 穷尽 pin | 确认 Chief 改法更根本：去掉手抄后加值即编译错，pin 冗余。已按 `TeamMemberView['status']` 落地（`“fix(client-ui-agent-team): derive the member status from the server's view” 修复`，`TeamAction.tsx:6,30`）。 |

## 三、本轮落地质量复核（命令 + 退出码）

- `“test(llm-pi-ai): pin the developer role warning on the Responses protocol” 批次`：Responses 协议钉 4 位置（警告/已声明/非推理/completions 交叉对照），结构镜像既有 completions 用例，质量合格。
- `“test(agent-team): cover the broadcast, profile and resume gaps the review named” 批次`：3 条 its 与缺口语义一一对应；未读断言细节全文（结构已验）。
- `“fix(client-ui-agent-team): derive the member status from the server's view” 修复`：派生写法正确，`TeamMemberView` 经 `client.ts:7` 导出、`TeamAction.tsx:6` 导入、`:30` 派生，零行为变更。验收过。
- `“fix(llm): observe the invariant on the event, not on the commit” 重写`：重写合理——`llm/src/index.ts:354-359` 明写「non-vetoing：one broken listener must not starve or veto」，credentials 兄弟 `invariant.spec.ts:25` 确为直接 emit 断言。语义从「提交时抛出」改为「事件上观察」，与产品一致。
- 实测：`pnpm vitest run --config configs/vitest.config.ts packages/llm/llm-pi-ai packages/experimental/agent-team` → 退出码 0，524 passed；`packages/llm/llm` → 1296 passed。

**新风险（需Chief跟进）**：llm 整包存在**非确定性抖动**——我 05:02 首跑 `1 failed | 1295 passed`（退出码 1，失败用例名未捕获），随后 4 连跑全绿（05:03、05:04×3）。频率约 1/5。“fix(llm): observe the invariant on the event, not on the commit” 重写 声明的「1296 绿」在单次快照上成立，但该包存在偶发红，pre-push 若加 focused vitest 会被它间歇性假红灯。建议：找出抖动用例（生命周期/时序类嫌疑）并加确定性边界，再上闸门。

## 四、闸门裁决

**裁：pre-push 加 focused vitest，阻断式，且必须钉 `--config configs/vitest.config.ts`。**

形态（lefthook.yml pre-push 追加）：
1. 新脚本 `scripts/run-focused-vitest.ts`：从 `git diff --name-only <merge-base-with-remote>..HEAD` 收集变更文件；映射到 workspace 包根（pnpm-workspace globs + 最长前缀匹配）；仅当命中 `packages/*/*/src/**` 或其 tests 时输出包根列表。
2. 执行行统一形态：`node_modules/.bin/vitest run --config configs/vitest.config.ts <derived paths>`（**配置必带**；别名表与 jsdom setup 都在其中，裸跑会造假红灯——本轮已由双方实测证明：裸跑 agent-team tests 红为假信号，带配置 2 passed / 0）。
3. 阻断语义：vitest 退出码非 0 即阻断 push；输出保留 vitest 原生摘要（FAIL 文件 + 用例名）。超时上限 5 分钟，超时降级为告警（打印「本地闸门超时，CI 兜底」），避免本地闸门变成时长灾难。
4. 推导粒度：包级（`packages/<group>/<pkg>` 的 tests/ 或 src/ 变更 → 跑该包全部 spec），不做文件级映射（vitest 自带 `--changed` 在 monorepo alias 下不可靠，风险大于收益）。
5. 本轮闸门实际放过什么（已验证/未验证区分）：① llm invariant 红带着 push（我第一轮实测 05:24 前后 1295/1 失败、退出码 1；当时 pre-push typecheck 退出码 0）——**已验证**；② 我首稿两处事实错误——任何自动化闸门都抓不住 doc 事实错误，说明「结论必须带可重跑命令」是比闸门更根本的纪律；③ 第五份审查的零覆盖批次——未独立验证，无法归因闸门；④ agent-team/tests/invariant.spec.ts 裸跑红灯属**调用方法错误**（我的第一轮实测命令一直带 config，未受此影响），不是闸门放行。

结论：**pre-push 加 focused vitest（阻断、包级、--config 钉死、5 分钟上限），且先修掉上述抖动**；不把 vitest 加进 pre-commit（与「本地快、CI 全量」纪律一致）。

## 未验证事项
- llm 抖动用例名与根因（1/5 次复现，未捕获名称）。
- upgrade.spec 3 条新 its 的断言细节（仅验其存在与命名）。
- 「第五份审查点出的零覆盖批次」内容（未见原文）。
- 备忘引用的 `types.ts:131` 行号在 HEAD 已漂移至 `:138`（内容仍准确）。
