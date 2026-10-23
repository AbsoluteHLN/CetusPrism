# S4 回归与覆盖风险审查（回归风险审查员 · 2026-10-23）

范围：`E:\Projects\CetusPrism` @ `release/v1.7.3`，**审查基线 HEAD `“docs(review): add the agent-team design review” 批次`**。注意：开局事实中的「HEAD `S4 配置+规格批次`，工作树干净，未 push」已过时——该轮审查后仓库已推进约 20 个提交（模型接入/AgentLoop/压缩修复波次），且分支已与 `origin/release/v1.7.3` 同步（`git status -sb` 无 ahead/behind）。当前工作树另有 3 个未提交文件（`agent-team/src/roster.ts` +10、`tests/upgrade.spec.ts` +37、`tests/team.spec.ts` +8/−2），是裁决备忘 §三.A 三项的**在途落地波次**，本文将其作为「在途」单列，不与 HEAD 混算。

方法：读源码 + 读测试 + 跑测试 + `git show` 对照基线折叠语义。全程只读，唯一写入是本文件。

**同日状态更新（审查快照之后）**：①缺口 1（广播投递失败路径）与缺口 2（跨 Team 档案复用）已由「`test(agent-team): cover the broadcast, profile and resume gaps the review named`」补测批次闭环（`tests/upgrade.spec.ts` +142：失败路径用例 `upgrade.spec.ts:898-941`、跨 Team 用例 `upgrade.spec.ts:383-414`）；②「`let the profile pin the preset, and keep the resume failure`」批次已合入 resume 失败保留与档案 pin preset（roster.ts +31、upgrade.spec +110），缺口 3 的 cause 断言仍未落、随缺口 4 的实现轮一并补；③缺口 4（广播头阻塞）已裁决为「先改实现为逐目标独立尝试 + 聚合返回，再钉新语义」（见缺口 4 与「待确认问题」1）。另有一处驱动面勘误：普通单播消息不触发积压广播补投，详见缺口 1、4。下文未标注处均为审查时点快照。

---

## 结论摘要

1. **S4 三批提交未触及任何共享驱动**：`S4 服务层批次`（agent-team 服务层，14 文件全在 `packages/experimental/agent-team`）、`S4 工具层批次`（tool-agent-team + client-ui-agent-team）、`S4 配置+规格批次`（glm 示例配置 + 规格）三批合计无一文件位于 `packages/core/agent-loop`、`packages/compaction/compaction-basic`、`packages/llm/*` 源码（对三批逐批跑 `git show --stat`，三次均验）。共享包回归风险 = 低；窗口内 llm-pi-ai / compaction 的改动全部来自裁决修复波次（`“fix(llm-pi-ai): land the model-access review D1/D3/D6/D8” 批次` / `“fix(llm): name the effort declaration when the endpoint refuses a reasoning effort” 修复` / `“feat(compaction): give the model the window instead of a flat reserve” 批次` 等），已由本地交叉核对闭环（`dev-docs/2026-10-23-regression-coverage-review.md`）。
2. **持久化兼容安全，无需迁移**：`projection.ts:513` `stateVersion: 6`；老折叠只接受 `provisioning → {active, failed}`（zcode 逐维对照批次时点的 projection.ts 转移判定），新折叠 `isMemberTransition`（`src/projection.ts:325-330`）是其**超集**（新增 dormant 边），老会话重放不会引入 failure；缓存行按 `ver` 匹配，不匹配即丢弃并从日志全量重折（`session-projection-cache/tests/cache.spec.ts:636` 钉住）。
3. **客户端枚举断裂已被本轮修掉**：`client-ui-agent-team/src/client/TeamAction.tsx:29` 的 `MemberStatus` 已含 `'dormant'`，`memberStatusKey`（`:45-53`）与 `memberDotState`（`:55-64`）穷尽，locale 中英双词条就位（`locales.ts:30, :64`）。
4. **upgrade.spec 覆盖了任务书五缺口中的三个**：dormant 恢复失败回退（`upgrade.spec.ts:375-390`）、档案冲突（`:207-240`）、范围拒绝（`upgrade.spec.ts:436-475`）均已钉住；**广播投递失败、跨 Team 档案复用**当时仍无用例（同日已由补测批次闭环前两条，见文首状态更新与各缺口条目现状标注）。叠加在途波次后，审查时点剩余用例缺口 5 条、零代码收口 3 条（见下）。
5. **3 条基线失败已处置完毕，无需再裁**：`“test(ui-conversation): assert the hero copy the product ships” 修复`（01:18:55「assert the hero copy the product ships」）更新断言；本次实测 `packages/client/ui-conversation` + `packages/client/ui-agent-preset` + agent-team 三套 **12 个测试文件 303 条用例全部通过，退出码 0**（03:36:43 运行，基线 = HEAD + 3 个在途文件）。

---

## 必答判断题

### 1. 共享包隔离：未触及；未来隔离开关的最小侵入点

三轮提交文件清单核对（对三批各跑一次 `git show --stat`）：改动全部落在 `packages/experimental/{agent-team,tool-agent-team,client-ui-agent-team}`、`apps/cli/config/examples/glm-harness/cordis.yml`、`apps/cli/config/examples/agent-team-profile/cordis.patch.yml` 与文档。共享驱动零改动。

未来若要在 `packages/core/agent-loop` 引入按 preset/底座隔离的开关，最小侵入点（按侵入度排序）：

- **首选：不动共享代码，走已存在的配置缝。** 压缩预算类开关走 `compaction-basic` 的 `modelPolicies` 按路由覆盖（`packages/compaction/compaction-basic/src/config.ts:118-139`，裁决备忘 §三.C 已核实架构支持），开关即路由表本身，天然按底座隔离。
- **机制类（软告警/回填熔断）**：在 `packages/core/agent-loop` 新增一个默认无监听的 waterfall（如 `agent/step-anomaly`），配置放 agent preset 配置块（如 `anomalyWarnings{...}`），未配置即关闭——未监听 + 未配置 = 对其他 DSH 会话零变化。锚点：`packages/core/agent-loop/src/index.ts:59`（现有 projection `stateVersion: 2`）与 `inbox.ts:64` 同构。**注意** AGENTS.md:135 约束：「Plugins, not loop changes」——在 agent-loop 加 waterfall 属于改共享驱动，必须同步 `docs/architecture.md`，且默认值必须是「关」。
- **禁改点**：共享调度分类路径（`packages/core/tools/src/index.ts:1303-1312` 的 `isConcurrencySafe` 恒缺省、`tool-calls.ts:204-205` 每步重分类）不要为 preset 加分支——那是 AgentLoop对齐师已裁定的伪差距方向。

### 2. 测试覆盖：upgrade.spec.ts 覆盖了什么、漏了什么

已覆盖（提交态 `packages/experimental/agent-team/tests/upgrade.spec.ts`）：

- 档案解析全链路：声明序列出（:111-143）、成员字段取自档案（:145-162）、profileId 落易变行（:164-177）与持久行（:179-192）、未知 profile（:194-205）、名字与模型路由冲突（:207-240）、effort 越界（:242-262）、backend 冲突（:264-276）、未声明后端时必须给请求后端（:278-289）。
- dormant 正路径与**恢复失败回退**：release→dormant+resumable（:293-318）、resume→active 持久行（:320-332）、信不唤醒（:334-351）、驻留期间的信在 resume 后补投（:353-373）、**resume 失败回退 dormant 且可再 resume**（:375-390，mock `ctx.subagents.sendMessage` reject → `TEAM_MEMBER_NOT_RESUMABLE`）、非 dormant/未知名 resume 拒绝（:392-411）、仅 Lead 可 release/resume（:413-432）。
- 范围拒绝：effort / backend / preset 三个范围（`upgrade.spec.ts:436-475`）+ 空范围=不设限（:477-495）+ ranges() 读回（:497-509）。
- 广播正路径：逐目标投递（:513-532）、身份与状态回报（:534-551）、持久投影记录（:553-584）、自环/空目标拒绝（:586-604）、每目标配额按展开集计（:606-618）、超限拒（:620-635）、广播与普通消息上限独立（:637-653）、不可达目标不产生 delivered 边（:675-686）。

**任务书五缺口的对照结论**：

| 缺口 | 状态 |
|---|---|
| dormant 恢复失败路径 | ✅ 已覆盖（`upgrade.spec.ts:375-390`）；但错误折叠语义仍无钉（见缺口 3） |
| 档案冲突 | ✅ 已覆盖（`upgrade.spec.ts:207-240`：名字冲突 + 路由冲突 + 后端冲突） |
| 范围拒绝 | ✅ 已覆盖（三个范围码 + 空集语义） |
| 广播投递失败 | ✅ 失败路径与补投已由补测批次覆盖（`upgrade.spec.ts:898-941`：失败目标保持 queued 且无 delivered 边、已收目标保留边、resume 后仅补投该目标）；目标顺序头阻塞（缺口 4）按 D 裁决待实现轮落地后钉新语义 |
| 跨 Team 档案复用 | ✅ 已由补测批次覆盖（`upgrade.spec.ts:383-414`：同 profileId 跨 Team 各自成行、实例 id 不同、名字互不冲突、行互不可见；审查时点观察为所有测试单 Team，原引用 `upgrade.spec.ts:56`、`team.spec.ts:88`） |

### 3. 持久化事件兼容：stateVersion 5→6，老会话重放安全，无需迁移

- **状态是事件的重折，不是被信任的载荷**：投影缓存行按 `ver` 比对活跃单元的 `stateVersion`（`session-projection/src/index.ts:430`），不匹配即丢弃、从 `init` 起对整条日志重折（同文件 `:460,512`）；`session-projection-cache/tests/cache.spec.ts:636` 明确钉住「当前文档的行全部不过 live unit 的 stateVersion」路径。agent-team 侧自己也有钉：`agent-team/tests/projection-events.spec.ts:101,200` 断言 checkpoint `ver === teamProjectionDefinition.stateVersion`。
- **折叠语义是旧版的超集**：基线折叠（zcode 逐维对照批次时的 projection.ts）只接受 `provisioning → {active, failed}`；新折叠（`projection.ts:325-330`）额外放行 `provisioning→dormant`、`active→dormant`、`dormant→active`。任何「旧版接受、新版拒绝」的边不存在，老 JSONL 重放不会引入 `failure`。快照 schema 对旧载荷向后兼容：`phase` 枚举扩了 `'dormant'`（`projection.ts:81`），`profileId/preset/reasoningEffort` 均为 optional（`:77-79`）；`team/member` 事件的 version 2/3 双版本 union 并归一为 v2（`projection.ts:112-127`）。
- **版本门禁已存在且生效**：不支持的**未来**版本在折叠时抛错并落终端 `failure`（`projection.ts:293-300` + `applyProjectionEvent` 的 catch 置 failure，`:302-305`），客户端面板把 `team.failure` 渲染为告警（`client-ui-agent-team/src/client/TeamAction.tsx:334-336`）——即老代码读新会话会「响亮失败」而不是静默错折，符合 AGENTS.md「Misconfiguration fails loud」。
- **结论**：不需要数据迁移，不需要额外版本门禁；`stateVersion` 递增本身即是门禁（registry 甚至拒绝同 key 跨版本共享 cell：`session-projection/tests/registry.spec.ts:483-491`）。唯一建议：补一条「旧版（v5 时代）事件序列 + 含 profileId 的新行混存」的重放回归用例（见缺口 5）。

### 4. 类型断裂面：dormant 断裂已修；同类排查方法

`client-ui-agent-team` 的 `MemberStatus` 已含 `'dormant'`（`TeamAction.tsx:29`），两个 switch（`memberStatusKey:45-53`、`memberDotState:55-64`）穷尽且各自有 v8-ignore 之外的编译期穷尽性（TS switch 无 default + 返回值类型约束），locale zh/en 双词条就位（`locales.ts:30,64`）。该断裂面**已闭环**。

系统性排查方法（按成本从低到高）：

1. **复制型 union 是根因**：客户端 `type MemberStatus = ...`（`TeamAction.tsx:29`）是手抄字面量，与服务层 `TeamMemberPhase`（`agent-team/src/types.ts`）无编译期关联。最小修法：客户端从 `@deepseek-ai/dsh-experimental-agent-team/client` 导入该 union（该类型已从 client 面导出，`TeamAction.tsx:5` 已在导入 `TeamMemberProjection`），让「服务层加值」直接变成客户端编译错。
2. **穷尽性守卫**：闭合 union 的消费端映射写成 `const KEY: Record<MemberStatus, TeamKey> = {...} satisfies Record<MemberStatus, TeamKey>`，或 switch 末尾 `assertNever`（AGENTS.md:132 已有此纪律）——新枚举值出现即编译红。
3. **契约测试**：客户端测试里加一条 `expectTypeOf<ServicesPhase>().toExtend<MemberStatus>()` 型断言（或运行时 `expect(PHASES).toEqual(clientStatuses)`），把「服务层扩了、客户端没跟」变成用例红而非线上降级。
4. **排查指令**：对每个服务层闭合枚举，`git grep -n "<枚举字面量全集>" packages/*/src packages/client` 比对引用点是否各自复制了缩减版 union。本轮以 `dormant` 全仓 grep（58 文件）逐一核对服务层/工具层/客户端三面：`roster.ts:101,206-212,223,786,795`（服务侧 dormant 合法目标/视图）、`tool-agent-team/src/index.ts:208`（工具面透传）、`TeamAction.tsx:29-95`（客户端，已修）——未发现第二处「服务加了、客户端没跟」的**活跃**断裂；`core/agent-loop/src/runtime-context.ts:33` 的 "dormant" 是注释用词，非枚举面。SDK 面：本轮未触及 `SessionEventMap` 与 agent-loop，两侧 SDK 快照无新增义务（AGENTS.md:156 的触发条件不满足）。

### 5. 基线失败处置：已修，无需再裁

3 条基线失败（hero 标题断言旧文案）已由 `“test(ui-conversation): assert the hero copy the product ships” 修复` 修复——修复提交早于上轮裁决 14 秒（文档规范核对已标注时序）。我的实测收口：两个客户端包 + agent-team 全套 **12 文件 303 用例全绿，退出码 0**（命令见「上线前必做」#3）。结论：**已修，留痕即可，勿再列入上线清单**。

---

## 一、影响面矩阵

| 改动 | 直接受影响 | 传导面 | 风险 | 依据 |
|---|---|---|---|---|
| S4 服务层批次（档案/驻留/范围/广播/投影） | `packages/experimental/agent-team`（src 9 文件 + tests 2） | 所有使用 agent-team 的 preset/会话 | **中**（共享驱动未触及；新增相位与事件版本均有 union 门禁） | 对该批跑 `git show --stat` |
| S4 工具层批次（工具层+客户端） | `tool-agent-team`（+220）、`client-ui-agent-team`（TeamAction/locales） | Team 工具的全部 LLM 调用方、roster 面板 | **中低**（客户端枚举断裂已在本轮闭环；工具错误码新增需同步人读清单，见 P2-3） | 对该批跑 `git show --stat` |
| S4 配置+规格批次 | `glm-harness/cordis.yml`、`agent-team-profile/cordis.patch.yml`、规格文档 | 部署示例的 preset 行为 | **低**（示例 overlay；预算数字无守卫，见缺口 6） | 对该批跑 `git show --stat` |
| 在途波次（未提交） | `roster.ts` +10（`TEAM_BACKEND_NOT_AVAILABLE` 目录校验前置于成员行）+ 两个 spec | 关闭裁决 A.1「越界后端占名占额」 | **低**（修复方向正确：先校验后写行，且补了持久断言） | `git diff -- packages/experimental/agent-team` |
| 全仓 typecheck | 测试文件三处错误 | pre-push 闸门 | **已闭环**（Chief 修复入库；完整闸门结果以其群内贴出为准，我未复跑 bundle） | lefthook.yml:52-55 唯一类型闸门 |

## 二、覆盖缺口清单（4 条用例缺口 + 1 条重放钉子 + 3 条零代码收口）

1. **广播投递失败路径**（✅ 已闭环——补测批次以 released 成员为不可达目标钉住整条链：投递在该目标失败后 `status: 'queued'`、该目标无 `broadcastDelivered` 边、已收到目标保留边；resume 复活该成员后仅对其补投、已收目标不重投（`upgrade.spec.ts:898-941`）。审查时点原案「再次驱动」措辞勘误：补投仅由 resume（头部复活）/冷恢复（`mailbox.ts:91-111` 冷恢复驱动含积压广播重试）/新一轮点名该目标的广播触发；普通单播消息**不**触发补投——`dispatchThrough`（`mailbox.ts:508-528`）只过滤单播队列 `state.messages`，不触碰积压广播）。
2. **跨 Team 档案复用**（【缺什么】同一 `profiles` 配置实例化两个 Team（两个 lead Session），同 profileId 各自成行、互不串名、互不占对方 `maxMembers`【建议加在】`upgrade.spec.ts` 新增 describe，或在 team.spec.ts 身份段并列【验收标准】`registry` 契约注释宣称「同一身份可在任意 Team 实例化」（`profile.ts:44-50`），用例须钉住：Team A spawn 后，Team B 用同 profileId spawn 成功且两行 `profileId` 相同、名字互不冲突）。
3. **resume 失败的错误折叠语义**（【缺什么】`roster.ts:368-377` 把任意底层失败（含 `PERSISTENCE_UNAVAILABLE` 类）压成单一 `TEAM_MEMBER_NOT_RESUMABLE` 并附 cause——这是裁决备忘 §二 已登记「补测试」项；现有用例只钉了「回退 dormant」没钉「cause 可观测」【加在】`upgrade.spec.ts:375-390` 既有用例旁追加断言 `rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_RESUMABLE' })` 之外再断 `cause` 保留原始错误【验收标准】用例红→绿可逆（撤掉 cause 断言即红）。
4. **广播目标顺序的头阻塞语义**（【缺什么·现状】`dispatchBroadcastAdmitted`（`mailbox.ts:290-304`）按 targetIds 顺序投递、首个失败即 `return false`：构造 `[ghost, live]` 目标序，live 目标在本进程本次驱动内收不到该广播、消息保持 queued【已裁决】D 章裁决采纳「先改实现为逐目标独立尝试 + 聚合返回，再钉新语义」（P0，Chief 下一轮实现），不再按「钉住现状」出用例；验收以 round2 团队意见 D 章三条断言为准——live 目标本次驱动内收到 / dormant 头部保持 queued 且不落 delivered 边 / 头部复活后仅补投头部、live 不重复投（红→绿可逆：恢复短路即转红）【驱动面勘误】补投仅由 resume（头部复活）/冷恢复/新一轮点名该目标的广播触发；普通单播消息不触发——`dispatchThrough`（`mailbox.ts:508-528`）只过滤单播队列 `state.messages`，不触碰积压广播【加在】`upgrade.spec.ts` `Team broadcast`【验收标准】用例需同时断言「不丢」与「顺序」。
5. **stateVersion 5→6 老会话重放回归**（【缺什么】构造含 `phase: 'failed'` 与无 `profileId` 老快照行 + 当前定义混合的 JSONL 重放，断言 `failure === undefined` 且缓存行 ver=6 重写【加在】`agent-team/tests/projection-events.spec.ts`（已有 checkpoint 断言位 `:200`）【验收标准】撤掉任一兼容分支（如 v3 union 或 dormant 枚举）用例转红。

**零代码收口（3 条）**：
- `types.ts` 广播配额 JSDoc 与 per-channel 实测语义的字面冲突，两处措辞收敛即闭环（智能体团队架构师已指出，我确认 `upgrade.spec.ts:606-653` 钉的正是 per-channel）。
- `tool-agent-team` 工具文案「the member runs under」降级为记录性字段描述（`tool-agent-team/src/index.ts:376,411`）。
- failed spawn 永久占名占额是既有契约——README 补一句边界声明即可收口（`agent-team/README.md:241` 附近；在途波次的 `TEAM_BACKEND_NOT_AVAILABLE` 已把「可用后端」半边堵上）。

## 三、上线前必做清单（按序）

1. **合入在途 agent-team 修复波次**（roster.ts + 两 spec），随后全绿收口。验证：`& 'E:\dependency-cache\node-runtime\node.exe' 'E:\Projects\CetusPrism\node_modules\vitest\vitest.mjs' run --root 'E:\Projects\CetusPrism' --config 'E:\Projects\CetusPrism\configs\vitest.config.ts' 'packages/experimental/agent-team/tests'` → **退出码 0**，期望尾行 `Test Files N passed / Tests N passed`（当前含在途改动为 303 全绿，03:36 实测）。
2. **完整 `pnpm run typecheck` exit 0** 后才允许 push（pre-push 唯一类型闸门，`lefthook.yml:52-55`）。期望输出：无 `error TS` 行、退出码 0。**未验证**（完整脚本含 bundle 构建，属 Chief 闸门范围，结果以其群内贴出为准）。
3. **基线噪音清零确认**：`... vitest.mjs run ... 'packages/client/ui-conversation/tests/skeleton.client.spec.tsx' 'packages/client/ui-agent-preset/tests'` → 退出码 0、`Test Files` 全 passed。已实测通过（303 绿中含这两包），把「3 条基线失败」从所有遗留清单中移除，防止红基线训练团队忽视红。
4. **补失败路径用例**（上表缺口 1、2、3、4；同日更新：缺口 1、2 已由补测批次闭环，剩缺口 3 的 cause 断言与缺口 4 随 D 实现轮落地），vitest 对应 spec exit 0，且每条用例的「验收撤红」可演示（注释掉断言即红）。
5. **push 前置**：`git push` 由 Chief 统一执行；pre-push 会跑 typecheck，退出码非 0 即阻断。当前分支已与远端同步，本清单第 3 条（广播失败路径用例）合入后需再走一次完整闸门。

## 闸门判断（是否补闸门、补在哪、代价）

- **pre-commit 维持不跑 vitest/typecheck**（`lefthook.yml:5-38` 全部类型无关检查）：TS6133/TS2322 只有 tsc 能报，塞进 pre-commit 会把每次提交拖到分钟级，且与 pre-push 职责重复。
- **pre-push 的 typecheck 是唯一本地类型闸门，但它依赖完整构建、慢到本地没人跑**——这是三处错误能潜伏的根因。建议：pre-push 换独立 `tsc -b --incremental` 脚本（不带 bundle），CI 保留完整 `pnpm run typecheck` 兜底。代价：一次脚本工作量 + 首次冷构建分钟级、增量后秒级（增量耗时未实测，标注未验证）。
- **两个零成本 vitest 守卫**（不进钩子，进 CI 常规套件）：① 广播投递失败路径用例（缺口 1）；② 枚举契约守卫（客户端 union 覆盖服务层全集的编译期/用例断言）。
- 不建议 pre-commit 加 typecheck：会让提交卡在完整构建上，把开发者推向 `--no-verify`，反而拆掉其余六个检查的防线。

## 待确认问题

1. 广播目标顺序的头阻塞语义（缺口 4）：**已裁决收口**——采纳「逐目标独立尝试 + 聚合返回」，先改实现再钉新语义（P0，Chief 下一轮实现），验收断言以 round2 团队意见 D 章为准（见缺口 4），本条不再悬挂。
2. S4.2.6 规格自相矛盾的裁决（备忘 §三.B 选项 2）若采纳「resume 走 subagent 冷复原」，`upgrade.spec.ts:379` 对 `ctx.subagents.sendMessage` 的 mock 位置仍然正确；若改走 mailbox，该用例与实现需同波调整。
3. `TEAM_BACKEND_NOT_AVAILABLE`（在途）与 `TEAM_EFFORT_NOT_ALLOWED` 的错误文案需同步进面向人的 code 清单（`tool-agent-team/README` 与 providers Troubleshooting 段），与上一轮回归核对缺口 5 同型——属于同一份待办。
