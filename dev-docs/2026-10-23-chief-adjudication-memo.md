# Chief 裁决备忘 · 2026-10-23 晨

范围：`E:\Projects\CetusPrism` @ `release/v1.7.3`。输入 = 群组 6 份审查（已到 4 份：升级思路 / 模型接入 / AgentLoop 对齐 / 智能体团队）+ 3 份本地交叉核对（回归覆盖 / 文档规范 / S4 一致性）。每条带 `文件:行号` 或「命令 + 退出码」。

---

## 一、已闭环（已提交并推送，无需再裁）

| 编号 | 事项 | 落点 | 验证 |
|---|---|---|---|
| D1 | 路由级 `api` 重指后旧协议 `base.compat` 经 `...base` 残留进 wire 模型 | `catalog.ts` `resolveModelCompat`（`945-985`，判定在 `973`，空块在 `981`） | 夹具换成带**共有字段**的条目（`supportsLongCacheRetention`），撤掉修复 → 2 条转红 |
| D2 | 私有网关 compat 误判只对 developer role 有告警 | **收缩**：① 经实测证伪不做（csu 网关接受 `max_completion_tokens` 与 `stream_options`，全部 200；按「URL 无法自证」扩展会对每个私有网关普遍告警）；② 落地为 `REASONING_EFFORT_REJECTED` + 指引 | 真实措辞 10/10 分类符合预期（`koutput/probe-effort-classification.ts`） |
| D3 | `sendsDeveloperRole` 大小写敏感偏离 vendor | `catalog.ts` `sendsDeveloperRole`（`723-736`），仅 `deepseek.com` 小写化（`691`） | 3 条回归 + 部署态/全目录实测 0 警告 |
| D4 | OpenRouter 模型 id 前缀规则未复刻 | `9a785a2f4f` | 既有回归 |
| D6 | HTTP 408 未分类 → 终态丢弃 | `stream.ts` `classifyPiAiError`（`96-140`） | HTTP 映射表新增 `[408,'TIMEOUT']` |
| D8 | "No API key" 落 `PI_AI_ERROR`，缺凭据语义 | `stream.ts` → `MISSING_CREDENTIAL` | 既有用例补 code 断言 |
| — | `warnings` → 配置面闭环 | `c00b497ce5` | 客户端三通道同显守卫（`e40d84380f`） |
| — | 压缩预算 preset/示例对齐 | `1861ee8d80` | **文案已按机制重写**（`33770460f6`）：阈值 = `min(窗×ratio, 窗 − 输出预留 − headroom)`，`ratio 0.9` 不是约束项，128K 窗实为 87,040（68%），原「90%」说法 4 处全改 |
| — | `docs/config-catalog.md` 过期 | `74dde8494b` | 生成器重跑，`verify-config-catalog` 由红转绿 |

---

## 二、交叉核对推翻/修正了什么（这三份核对的价值）

| 核对 | 发现 | 处置 |
|---|---|---|
| 回归覆盖 | **我新加的分类器漏掉部署态自己的措辞**：CSU 网关对 DeepSeek 的原话是 `reasoning_effort must be low, high, xhigh, max`，不含任何拒绝词 → 实测落回 `INVALID_REQUEST`，新码在部署态根本不触发 | 改为「强拒绝词 **或** 档位枚举」判据（`5073379125`），部署态原话 + 4 条边界用例 |
| 回归覆盖 | **D1 夹具选错**：`zai` 的 compat 键与 anthropic 读取集**交集为空**，只能证明「块被清空」，证明不了「共有字段不再保留旧值」 | 换成带共有字段的条目（`a53bb15d47`） |
| 回归覆盖 | `retry-policy.ts:40-41` 引的是注释不是默认值（实为 `:14`） | 已修 |
| 文档规范 | **upgrade-ideas 的 Top 1 解决的是不存在的问题**：它称旧品牌断言「仍存在」，而修复提交 `6a382f4358`（01:18:55）比该文档提交（01:19:09）**早 14 秒** | 已改为「已完成」并标注时序 |
| 文档规范 | model-access-review 的「修法优先级 Top 5」列的 5 项在同一文档已标为完成/证伪 | 改为「四、仍待处理」 |
| 文档规范 | 27 处行号漂移（22 在 model-access / 4 在 agentloop / 1 在 upgrade-ideas） | 全部重指；另修 agentloop 的 `canRunParallel`→`canRunInParallel` |
| S4 一致性 | **规格 S4.3.3 明文要求「`allowedBackends` 取值必须来自实际存在的后端目录，否则拒绝」，实现只有一半**（`packages/experimental/agent-team/src/range.ts:47-53`）；真实目录 `ctx.subagents.list()`（`packages/subagent/subagent/src/index.ts:543-545`）就在手边，Team 服务已注入 `subagents`（`src/index.ts:155`）却从未查。越界后端不是被「拒绝」，而是先落一条 `provisioning` 成员行（`src/roster.ts:496-509`）再因 `expectProvider` 抛 `NO_PROVIDER`（`subagent/src/index.ts:612-618`）失败成 `failed`，**仍占名字与名额** | **已落地（见 §三.A）** |
| S4 一致性 | 规格 S4.3.6「设置区四级卡片」**未实现且未在 §4.8 实施结果表登记**——控制器仍停在 provider/model 两级（`packages/client/ui-settings-subagent/src/client/team-model-restriction-card-controller.ts:12-15,222-228`）。读规格会误判为已覆盖 | **已落地（见 §三.A）** |
| S4 一致性 | 规格 S4.2.6 要求复用走 mailbox 冷恢复投递，实现直调 `ctx.subagents.sendMessage`（`src/roster.ts:348`）——**规格内部即不自洽**（§4.8 记录了另一种落法） | **已裁（见 §三.B）** |
| S4 一致性 | `maxMembers` 计入 dormant（`src/roster.ts:505`）**无测试钉住**；resume 把 `NOT_RESUMABLE`/`PERSISTENCE_UNAVAILABLE` 压成单一 `TEAM_MEMBER_NOT_RESUMABLE` | 守卫测试**已补**（见 §三.A）；resume 的错误码细分仍未处理 |

---

## 三、待裁（第二轮讨论的议程）

### A. S4 规格与实现的三处落差 —— **已落地（2026-10-23 夜）**

1. **补 `allowedBackends` 的目录校验**：规格已明文要求，实现缺失，且失败模式不好（越界后端仍占名字与名额）。范围：1 个包 + 测试。
2. **§4.8 实施结果表补 S4.3.6 一行**（卡片未实现，登记为延后）。这是文档记账，5 分钟。
3. **补 `maxMembers` 计入 dormant 的测试**。已有行为，缺守卫。

**落地细节**：

| 项 | 落点 | 验证 |
|---|---|---|
| ① 目录校验 | `agent-team/src/roster.ts`：范围校验之后、成员行创建之前查 `ctx.subagents.list()`（`packages/subagent/subagent/src/index.ts:543-545`），不在目录里报 `TEAM_BACKEND_NOT_AVAILABLE` | 撤掉校验 → 新用例转红，且错误从 `TEAM_BACKEND_NOT_AVAILABLE` 退回 `SubagentError{code:'NO_PROVIDER'}`——**后者证明旧行为确实发生在成员行写入之后**，失败成员因此占名字与名额 |
| ② S4.3.6 登记 | 规格 §4.8 新增一行「设置区四级卡片 = 延后」 | 文档记账 |
| ③ dormant 计入上限的守卫 | `agent-team/tests/upgrade.spec.ts`「counts a dormant teammate against the member limit」 | 既有行为的回归守卫（实现本来就对：`release()` 只改相位、成员行保留） |

**既有契约未变**：「创建失败仍占名字与名额」是 Team 的既有契约（成员名是身份，同一 Team 只允许一个实例）。
因此 `tests/team.spec.ts` 那条用例不能再用「未知后端」造失败——未知后端现在被**提前拒绝**、什么都不占；
改用真实的创建失败（`startContinuable` 拒绝）来钉这条契约，断言保持「失败成员占名字、占名额」。
两条语义就此分开：**后端不存在 → 提前拒绝、不留痕；创建失败 → 留失败行、占名字与名额。**

### B. S4.2.6 的规格自相矛盾 —— **已裁（2026-10-23 夜，取选项 2）**

规格 §4.2.6 要求「复用路径必须走既有冷恢复投递（`mailbox.ts:254-261,317-331`），不得新开一条绕过持久日志的通道」；实现直调 `ctx.subagents.sendMessage`。§4.8 自己记录了另一种落法。

- 选项 1：改实现走 mailbox（贴合 §4.2.6 的字面，但要多绕一层，且与 §4.8 的记录冲突）
- 选项 2：改规格 §4.2.6，说明「resume 走 subagent 冷复原，broadcast 走 mailbox」——**这条更贴实现**

**裁决：选项 2**，并补一条更硬的约束。§4.2.6 的原意是「不要新建第二条投递链」，而 `ctx.subagents.sendMessage` 走的是 subagent 自己的持久化通道（`continuation.ts`），不是新链；§4.8 的实施结果表也已按这一落法记账。

**但字面照抄会捅出一个更严重的洞**，这是群组第四份审查（`dev-docs/2026-10-23-agent-team-review.md`）提出、Chief 独立复核成立的 P0：

| 事实 | 证据 |
|---|---|
| `mailbox.ts` 全文没有 `dormant` | 全文检索无命中 |
| dormant 成员是合法消息目标 | `roster.ts:101`（`member.phase !== 'active' && !== 'dormant'` 才抛错） |
| 目标运行时不在线时，单播投递仍会 steer | `mailbox.ts` `dispatchOnce`：目标不在线且持久会话里没有该消息 → 落到 `steerHostSubagentPrompt` |
| steer 在 activation 缺失时冷复原 | `packages/subagent/subagent/src/continuation.ts:299-301`（`activation === undefined` → `coldResume`） |
| 规格「显式不做」第 2 条要求 dormant 不被 `send_message` 唤醒 | `dev-docs/2026-10-22-composer-agent-team-spec-v1.zh.md:288-289` |

⇒ **一封 mail 会原地复活已释放的成员**，与规格写明的「显式不做」直接冲突；`Lead` 重启时 `recoverFor`（`mailbox.ts:89-110`）还会批量重投，等于重启即唤醒全部带积压的 dormant 成员。

**事实纠正（Chief 复核）**：群组报告称「三条投递路径都不检查成员相位」不准确。广播路径在目标不在线时 `return false`（`mailbox.ts` `deliverBroadcast` 的 `target === undefined` 分支末句），**不会**冷复原；成立的是**单播路径一条**。

**落地**（本轮已提交）：

1. `mailbox.ts`：单播投递在 steer 之前读目标相位，dormant 直接 `return false`——邮件留在持久队列里，等 `reactivate_teammate` 把它带回来再送达（`recoverFor` 走同一路径，天然衔接）。
2. `roster.ts` `resume()`：**先**把相位记为 `active`，**再**提交提示；失败回写 `dormant`（`active → dormant` 是合法边，`projection.ts:327-328`）。顺序反过来时，复活的成员在创建瞬间相位仍是 `dormant`，`tryMembership`（`roster.ts:154`）拒绝 → Team 工具从不安装（`tool-agent-team/src/index.ts:736-744` 只挂 `agent/created`）→ 复活的成员没有工具、无法回消息。
3. 工具层文案：`POLICY` / `send_message` / `reactivate_teammate` / `NO_ACTIVE_PEER_MESSAGE` 四处把「dormant 不被唤醒、邮件等待复活后送达」写清，消除原先「starts or resumes an inactive target」与「does not wake a dormant member」并置的歧义。
4. 规格 §4.2.6 改写（见 `dev-docs/2026-10-22-composer-agent-team-spec-v1.zh.md`）。

**反向验证**（逐条退回修复，确认用例转红）：撤掉相位判定 → 「does not wake a dormant teammate with mail」转红；撤掉回写 → 「keeps a teammate dormant when its resume fails」转红；把相位事务挪回提示提交之后 → 「installs the Team tools on a reactivated teammate」与「delivers the mail that waited for a dormant teammate」同时转红。

### C. 压缩预算按路由分层（AgentLoop A2）

- **已做**：standard preset 与 GLM 示例已对齐（`thresholdRatio 0.9` + `headroom 8192`）。
- **仍开着**：非 GLM 路由仍吃服务默认 `0.8 / headroom 65,536`（`compaction-basic/src/config.ts:20,75`），128K 窗阈值 ≈ 54K（上游 preflight-v1 ≈ 107K）——**提前约一半压缩**，长程任务过早丢细节、摘要频次翻倍。
- **落法**：架构已支持 `modelPolicies` 精确覆盖（`config.ts:118-139`），**无需改共享代码**，按路由表逐条加即可。开关即路由表本身，天然按底座隔离。
- **待裁**：给哪些路由补？范围多大？

### D. 软告警层（AgentLoop A1 / idea 思路 2）

- 上游 `turn-tool-warnings.ts:14-82` 注入模型可见 system-reminder + `ModelAnomalyWarning` 事件（阈值 3、每 turn 上限 3）。
- 本仓无对应。可观测后果：同参重复调用 doom loop 无提醒、无事件可聚合。
- 落法：agent-loop 新增 `agent/step-anomaly` waterfall（默认无监听 = 零变化），开关放 agent preset 配置 `anomalyWarnings{repeatedToolCall?,budget?,maxPerTurn?}`，未配置即关闭 → 只影响开启该配置的 preset，其他 DSH 会话不受影响。
- **待裁**：做不做？阈值取多少？

### E. 工具调度拓扑 —— **伪差距，但理由要改**

- idea 文档 Top 2 说这是「对照表唯一被裁『需要上游同形』的执行正确性差异」，定为 P0。
- AgentLoop 对齐师独立核实：上游 `dependsOn` 在唯一生产入口 `scheduleTools` **恒为空数组**（上游 `runtime/methods/tools.ts:49`，全树 grep 仅类型定义与空数组字面量），拓扑排序是空转。
- ⇒ **「与上游同形」不需要做**（本仓现状已一致：都没有依赖拓扑）。
- ⇒ 剩下的只是「要不要新增上游没有的能力」这一**产品决策**，不是对齐决策。且 `packages/core/agent-loop` 是全仓共享驱动。
- **注**：我先前一度把「上游没有 `dependsOn`」当成事实——那是因为搜的是 npm 包 `@earendil-works/pi-ai` 而非 ZCode 上游仓库；上游**确实有**该字段，只是恒空。结论不变，理由要写准。

### F. ZCode 底座去留（idea 思路 8）

- 文档先行，需要一次独立裁决。本轮不动。

### G. 部署态与 D5/D7/GLM 档位

- **GLM 推理档位**：网关接受全部档位，但 GLM 思考 token 不回传（64 tokens 内无 content、无 reasoning_content）→ 声明会「烧 token 不显示」。**待用户决定**。
- **D5**（pi-ai 链路 Retry-After 丢失）：根因在上游（pi-ai 压平 Error 链），本地只能靠 `retryPolicy.backoff.maxDelayMs` 缓解。
- **D7**（discovery 对换址后的 baseURL 不 interrogate）：README:129 已声明取舍，可选。

---

## 四、本轮不动的

- `packages/core/agent-loop`、`packages/compaction/compaction-basic`、`packages/llm/llm-pi-ai` 是**共享驱动**，影响所有 DSH 会话。C/D/E 三项若落地，一律按 preset/底座开关隔离，不改共享默认值。
- 不擅自重启用户正在运行的 App（CetusPrism App 与其后端 node 进程）——400 修复与新 preset 预算都还没加载。

---

## 五、群组第五份审查（回归与覆盖风险）的复核与裁决

输入：`dev-docs/2026-10-23-regression-risk-review.md`（8 条覆盖缺口 + Q2–Q6 必答判断题）。

### 1. 首稿的 4 处事实错误（已在首稿就地订正；后被作者重写取代）

首稿（提交 `7e195235cf`）有 4 处结论与源码不符，我已就地订正并附证据：

| # | 原文 | 事实 | 证据 |
|---|---|---|---|
| 1 | 「`convert.spec.ts` 仅 1 条正例、零反例」 | 实为 **2 条正例 + 3 条反例** | `packages/llm/llm-pi-ai/tests/convert.spec.ts:941-951`、`:966-979` 为正例；`:955-958`、`:960-963`、`:984-987` 为反例 |
| 2 | 「`tool-agent-team/src/index.ts:154,246,281,292`（4 份 JSON-schema enum 副本）」 | 三者分属**不同域**：`:154` 成员状态、`:246` 任务状态、`:281`/`:292` 消息投递状态；**只有 `:154` 复制了成员状态** | 同文件 `enum:` 行逐条核对；该条所依据的 `grep "'provisioning'"` 只命中 `:154` 与 `:134` 的政策散文 |
| 3 | 「`client-ui-agent-team/TeamAction.tsx:29`（已修）」 | **并未修**，且与首稿 §二 第 8 条「靠手抄」自相矛盾 | `packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx:29` |
| 4 | 根治写法 `TeamMemberProjection['phase']` | 派生源写错：`phase` 是**持久相位** `provisioning｜active｜dormant｜failed`，客户端要的是**运行时视图** `running｜inactive｜provisioning｜dormant｜failed`；按 phase 派生会把 `running`/`inactive` 换成 `active`，改坏 UI | `packages/experimental/agent-team/src/types.ts:53` 与 `:131`；`TeamMemberView` 已由 `src/client.ts:7` 导出 |

**后续**：作者在我入库后**重写了整份文档**（基线改为正确的 `e587aac456`，并把在途落地波次单列），新版更详实且**不含上述 4 处错误**——订正因此成为空操作，记录留档。重写版的缺口编号与首稿不同，下面的处置按**新版**列。

**裁决（仍然成立）**：订正 4 的改法（`type MemberStatus = TeamMemberView['status']`）比「加 pin」更根本——去掉手抄后，服务端加枚举值客户端自动跟随，pin 就不必要了。重写版 §四.4 独立推荐的修法（「客户端从 client 面导入该 union，让服务层加值直接变成客户端编译错」）与此一致。按订正后的写法落地。

### 2. 覆盖缺口的处置（按重写版编号）

重写版的清单 = 4 条用例缺口 + 1 条重放钉子 + 3 条零代码收口：

| 缺口 | 处置 | 理由 |
|---|---|---|
| 1 广播投递失败路径 | **直接落地** | 纯回归守卫，无行为变更 |
| 2 跨 Team 档案复用 | **直接落地** | `roster.ts` 注释已声明这是设计意图，却零测试 |
| 3 resume 失败的错误折叠语义（cause 可观测） | **留第二轮** | 与「resume 错误码细分」是同一个问题，见第二轮问题 A |
| 4 广播目标顺序的头阻塞语义 | **留第二轮** | 「首个失败即 return false」是有意不变量还是应逐目标独立重试——属语义裁决，用例钉哪个取决于裁决 |
| 5 stateVersion 5→6 老会话重放回归 | **留第二轮** | 跨包（`session-projection`）改动 |
| 零代码收口 ① 广播配额 JSDoc 与 per-channel 语义措辞冲突 | **留第二轮** | 两处措辞收敛，零成本但需与 S4.4.4 口径对齐 |
| 零代码收口 ② 工具文案「the member runs under」 | **留第二轮** | 降级为记录性字段描述 |
| 零代码收口 ③ failed spawn 永久占名占额 | **本轮已做** | README 已补边界声明（本次一并落地） |

**首稿缺口 1（resume 半途断裂）已关闭**：实测 22 条探针全过（`koutput/resume-abort.spec.ts`，git-ignored），结论是**重复投递窗口不存在**——`d0d7a3276b` 把相位记录提前到提示提交之前，审查引用的 `roster.ts:357` 是**修复前**的文件。交付与最后一次 abort 检查是原子的（`continuation-activation.ts:521` → `:530` 之间无 `await`），**已送达的提示不可能随后被拒绝**。残留的是一个更窄的问题：`park()` 吞掉 journal 失败（`roster.ts:401-405`）会让成员停在 `active` 而无 runtime，后续 resume 报 `TEAM_MEMBER_NOT_FOUND`——不是重复投递。

**首稿缺口 2（档案 preset 与请求 preset 的优先级）** —— 规格问题，留第二轮（第二轮问题 B）。

### 3. 重写版五问的采信

| 问题（重写版） | 采信情况 |
|---|---|
| 1 共享包隔离与未来隔离开关的最小侵入点 | **采信**。首选「不动共享代码，走 `compaction-basic` 的 `modelPolicies` 按路由覆盖」；机制类（软告警/回填熔断）才进 agent-loop，且默认值必须是「关」，同时要同步 `docs/architecture.md`；**禁改点**是共享调度分类路径（`packages/core/tools/src/index.ts:1303-1312`）——那正是已裁定的伪差距方向 |
| 2 测试覆盖 | 缺口清单见上表，处置已定 |
| 3 持久化事件兼容（stateVersion 5→6） | **采信**，且比首稿更精确：老折叠是新版折叠的**子集**（新版只多放行 dormant 边），任何「旧版接受、新版拒绝」的边不存在，老 JSONL 重放不会引入 `failure`；不需要迁移，`stateVersion` 递增本身即是门禁 |
| 4 类型断裂面 | **采信方法**（复制型 union 是根因 → 客户端改为导入服务端 union → 穷尽性守卫 → 契约测试 → `git grep` 排查指令）；其推荐的修法与本轮已落地的一致 |
| 5 基线失败处置 | **采信**（3 条 hero 失败已由 `6a382f4358` 修掉，实测两包 + agent-team 共 303 用例全绿） |

**闸门判断（重写版新增的独立小节，我的补充）**：pre-commit 与 pre-push **都不跑 vitest**（pre-push 只有 `pnpm run typecheck`），这条成立。但重写版举的那个例子不成立，且它的教训比它的结论更重要。

`packages/experimental/agent-team/tests/invariant.spec.ts` **在仓库真实命令下是跑得起来的**：`vitest run --config configs/vitest.config.ts` → 2 passed，退出码 0。alias 表由 `configs/vitest.shared.ts:17-35` 从 `configs/tsconfig.base.json` 的 paths 折出，`@deepseek-ai/dsh-invariants` 在其中有映射；**只有漏掉 `--config configs/vitest.config.ts` 时 alias 表才缺失**，那时它会以「找不到包」红。仓库的真实测试命令是 `pnpm run test` → `vitest run --config configs/vitest.config.ts`（`package.json:56`）。

⇒ **这不是代码缺陷，是调用姿势的问题。** 因此审查建议的落法（pre-push 追加「按受影响包推导的 focused vitest」）方向对，但**闸门必须连配置一起钉住**：只写 `vitest run <path>` 而不钉 `--config`，闸门自己会造出「代码坏了」的假红灯——typecheck 绿、真实用例也绿，只有闸门红。

### 4. 本轮落地（已提交）

| 项 | 提交 | 验证 |
|---|---|---|
| 重写版缺口 1 广播投递失败路径 + 缺口 2 跨 Team 档案复用（另含 resume 往返幂等） | `4f13403e6e` | `packages/experimental/agent-team` + `tool-agent-team` 共 8 个文件 176/176，退出码 0 |
| 类型断裂面去掉手抄（重写版 §四.4 的推荐修法） | `3eaaf48d6d` | `packages/experimental/client-ui-agent-team` 33/33，退出码 0 |
| Responses 协议 developer-role 告警钉子（首稿缺口 6a） | `8cf1ddc4e7` | `packages/llm/llm-pi-ai/tests/catalog.spec.ts` 104/104；变异 `sendsDeveloperRole` 的短路 → 新用例转红、其余 103 条仍绿 |
| `packages/llm/llm` 整包基线红灯 | `b3a7d59646` | 整包 52 个文件 1296/1296，退出码 0——**该包此前是红的** |
| 重写版零代码收口 ③ + 后端目录校验入正文 | `dbee9d28f8` | 中英配对已重录并复验通过（`verify-translation-pairing` 退出码 0） |
| 重写版审查文档入库 | `a7fadf15bf` | 取代首稿 `7e195235cf` |

**本轮所有验证命令都带 `--config configs/vitest.config.ts`**：仓库没有根 vitest 配置，裸 `vitest run <path>` 既无 alias 表也不带 jsdom setup，会给出误导性的红灯（`window is not defined`、`ResizeObserver is not defined`、「找不到包」）。这与上面闸门判断是同一条事实。

**仍留第二轮**：重写版缺口 3（resume 失败的原因折叠 = 第二轮问题 A）、缺口 4（广播目标顺序的头阻塞语义）、缺口 5（stateVersion 5→6 老会话重放回归，跨包）、零代码收口 ① ②；以及首稿缺口 2（档案 preset 与请求 preset 的优先级 = 第二轮问题 B，规格问题）。
