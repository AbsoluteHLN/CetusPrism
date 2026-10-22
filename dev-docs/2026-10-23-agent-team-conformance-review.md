# S4 智能体团队升级 · 实现一致性核对

日期：2026-10-23-　分支：`release/v1.7.3`　HEAD：`401f3e82bc`
核对对象：`dev-docs/2026-10-22-composer-agent-team-spec-v1.zh.md` §4（S4.1–S4.4、§4.7 不变量、§4.8 实施结果）
　　　　　`dev-docs/2026-10-23-agentloop-alignment-review.md`（§5 闸门判断、§6 不得照搬清单、P0-1 / P2 前提）
核对范围：只读源码；仅本文档为写入产物。未修改任何 `packages/` / `apps/` 源文件，未改测试，未做 git 写操作。

---

## 结论摘要

| 子项 | 判定 | 一句话理由 |
|---|---|---|
| **S4.1 档案** | ⚠️ 有偏差 | 实体与存储范式到位，但规格列的 `modelRoute(provider/model/effort)` 里的 **effort 一项在 `AgentProfile` 上不存在**（`provider`/`model` 有，`effort` 无）；其余字段、`profileId` 引用、成员名唯一性全部一致 |
| **S4.2 驻留复用** | ⚠️ 有偏差 | `dormant` 相位、release/resume、`stateVersion=6`、`maxMembers` 计入 dormant 均成立；但 **S4.2.6 要求的「复用路径走既有冷恢复投递（mailbox）」未做到**（实现走 `ctx.subagents.sendMessage`），且 resume 的结构化原因被收敛成单一错误码 |
| **S4.3 模式范围** | ⚠️ 有偏差 | 三层白名单与四层交集都真实现了；但 **S4.3.3 明文要求的「取值必须来自实际存在的后端目录，否则拒绝」完全未实现**，`allowedPresets` 同形；**S4.3.6 的设置区四级卡片未实现且 §4.8 未记录为延后**；S4.3.5 的「标注是否落在允许范围内」只做到 provider/model 的过滤、未做到档位层标注 |
| **S4.4 群聊** | ✅ 一致 | 复用同一条邮箱链（先落盘 / 按目标串行 / 目标去重 / 冷恢复重投）、上限按展开后目标数计、群消息永不进模型对话面、事件与投影版本号一致 |
| **不变量（§4.7）** | ✅ 仍成立 | 5 条重点不变量逐条在源码中可验证成立；其中「`maxMembers` 计入 dormant」缺测试钉住 |
| **群组审查 P0-1 前提** | ✅ 前提成立 | 上游 `dependsOn` 确为恒空数组（`tools.ts:49`），拓扑排序退化为单层；本轮已把审查标注【pack 未验证】的上游行号全部交叉验证通过。唯一偏差：本仓 `constants.ts` 常量在第 6 行（审查写 `:7`） |
| **群组审查 P2 重试前提** | ✅ 前提成立 | 本仓默认 5（`retry-policy.ts:14`）、GLM preset 显式 10（`cordis.yml:34`，注释 `:30-33`），「本审查期内已被消除」属实，HEAD 版行号精确 |
| **S4.1.6 延后判断** | ✅ 仍然成立 | 档案读写落点确实已满足「存智能体信息的配置环境」：volatile Config → settings 描述/更新 → config-editor 写 profile patch YAML，且声明变更即时重建注册表；档案卡片确实仍未实现 |

**最重的三处偏差**（详见下文对应小节）：

1. **S4.3.3 `allowedBackends` 无后端目录校验**（❌ 未实现）——真实目录 `ctx.subagents.list()` 就在手边却从未被查；越界后端不是被「拒绝」，而是先落一条 `provisioning` 成员行、再失败成 `failed`，仍占名字与名额。
2. **S4.3.6 设置区范围卡片未实现且未登记为延后**（❌ 未实现）——控制器仍停在 provider/model 两级；§4.8 的「本轮实施结果」表里完全没有这一项，读规格会误以为已覆盖。
3. **S4.2.6 复用路径绕开了既有冷恢复投递链**（⚠️ 与规格不符）——`roster.resume()` 直调 `ctx.subagents.sendMessage`，不走 `mailbox` 的冷恢复投递；§4.8 自己记录了另一种落法，规格内部即不自洽。

---

## S4.1 档案逐字段核对

### 字段级

规格 S4.1.1（规格 `:206`）列的字段 → 实现位置：

| 规格字段 | 实现位置 | 判定 |
|---|---|---|
| `id` | `packages/experimental/agent-team/src/types.ts:73`（`AgentProfile.id`）；规范化 `src/profile.ts:14,17-19` | ✅ 一致 |
| `name` | `types.ts:75`；规范化与校验 `src/profile.ts:15,20-25` | ✅ 一致 |
| `description` | `types.ts:77`；非空校验 `src/profile.ts:16,26-28` | ✅ 一致 |
| `modelRoute`（provider/model/**effort**） | `provider` → `types.ts:81`；`model` → `types.ts:83`；**effort 无对应字段** | ⚠️ 有偏差（见下） |
| `allowedEfforts` | `types.ts:85`；规范化 `src/profile.ts:29-31,39` | ✅ 一致 |
| `preset` | `types.ts:87`；规范化 `src/profile.ts:40` | ✅ 一致 |
| `backend` | `types.ts:79`；规范化 `src/profile.ts:36` | ✅ 一致 |

**关于 `modelRoute` 的 effort 缺口**：仓库里「带 effort 的路由」类型是 `TeamAgentRoute`（`types.ts:9-14`，含 `reasoningEffort`），但档案实体 `AgentProfile`（`types.ts:71-88`）**没有引用它，也没有自己的 effort 字段**。因此一个声明式档案**无法钉住默认推理档位**；档案能约束档位的唯一方式是 `allowedEfforts`（白名单）而非 `modelRoute.effort`（默认值）。实现路径上，档案带 effort 的场景仍只能走请求侧 `request.agentOptions.reasoningEffort`（`src/roster.ts:595-600`）。这是「规格已声明、实现未落」的字段级缺口，规模小但可实测：`AgentProfile` 的规范化函数 `normalizeProfile`（`src/profile.ts:13-42`）根本不处理 effort 键，多写的 effort 会被静默丢弃。

### 存储位置（S4.1.2）

规格 S4.1.2（规格 `:207`）要求档案**定义**走「Cordis 插件 Config + profile patch」范式，并点名 `packages/subagent/tool-subagent/src/model-selection-settings.ts:37-40` 的 `volatile()` 字段。

| 检查项 | 证据 | 判定 |
|---|---|---|
| 规格引用的 `volatile()` 锚点属实 | `packages/subagent/tool-subagent/src/model-selection-settings.ts:37-40` = `static Config = z.object({ enabled: z.boolean().default(false).volatile(), allowedModels: z.array(...).default([]).volatile() })` | ✅ 锚点有效 |
| 档案走 Cordis 插件 Config | `src/types.ts:290`（`profiles?: Volatile<AgentProfile[]> | AgentProfile[]`）；`src/index.ts:165`（`profiles: z.array(agentProfileSchema).default([]).volatile()`）；schema `src/index.ts:64-76` | ✅ 一致 |
| 落在 profile patch | `packages/experimental/agent-team-profile/cordis.patch.yml:20-38`（`agent-team` 条目下 `profiles` 注释示例 + 三层白名单） | ✅ 一致 |
| 写入 YAML | `packages/boot/config-editor/src/index.ts:34`（`documentPath` = `profileContext.patchPath`）、`:87-140`（`edit()` 改写 YAML 序列节点） | ✅ 一致 |
| 声明变更即时生效 | `src/index.ts:335-342`（`profileRegistry()` 按声明引用变化重建注册表） | ✅ 一致 |

### `profileId` 引用（S4.1.4）

| 规格要求 | 实现位置 | 判定 |
|---|---|---|
| `TeamMemberSnapshot.profileId` | `src/types.ts:115` | ✅ 存在 |
| `TeamMemberProjection.profileId` | `src/types.ts:188`；投影装配 `src/projection.ts:473`；Zod 校验 `src/projection.ts:434` | ✅ 存在 |
| （额外）`TeamMemberView.profileId` | `src/types.ts:139`；列表装配 `src/roster.ts:219`；`memberView` `src/roster.ts:748` | ✅ 存在 |
| 写入快照 | `src/roster.ts:490`（`...profile === undefined ? {} : { profileId: profile.id }`） | ✅ 一致 |
| 未声明档案报错 | `src/profile.ts:94` → `TEAM_PROFILE_UNKNOWN` | ✅ 一致 |
| 冲突报错 | 名称冲突 `src/roster.ts:415-420`、后端冲突 `src/roster.ts:421-426`、路由冲突 `src/roster.ts:588-594` → `TEAM_PROFILE_CONFLICT` | ✅ 一致 |

### 成员名唯一性（S4.1.5，含失败成员）

| 检查项 | 证据 | 判定 |
|---|---|---|
| 同 Team 内名字唯一 | `src/roster.ts:502-504`（`state.members.some(member => member.name === name)` → `TEAM_MEMBER_NAME_TAKEN`） | ✅ 一致 |
| 失败成员仍占名 | 失败成员保留在 `state.members`（`src/roster.ts:530-534` 落 `phase:'failed'`），故上条判定自然覆盖 | ✅ 一致 |
| 失败成员仍占名额 | `src/roster.ts:505-507`（`state.members.length >= this.maxMembers`） | ✅ 一致 |
| **有测试钉住** | `packages/experimental/agent-team/tests/team.spec.ts:398-409`「records failed provisioning durably, reserves its name, and counts it against the limit」：先以 `provider:'missing'` 造出失败成员，再断言 `TEAM_MEMBER_NAME_TAKEN` 与 `TEAM_MEMBER_LIMIT` | ✅ 已钉住 |

> 补充：跨 Team 复用由档案语义承担——档案是部署声明（`src/profile.ts:44-50` 注释），同一 id 可在任何 Team 再次实例化；同 Team 内复用走 S4.2 resume。与规格一致。

---

## S4.2 驻留复用核对

| 规格条款 | 实现位置 | 判定 |
|---|---|---|
| S4.2.1 `TeamMemberPhase` 增 `dormant` | `src/types.ts:53`（`'provisioning' \| 'active' \| 'dormant' \| 'failed'`）；Zod `src/projection.ts:81` | ✅ 一致 |
| S4.2.1 语义「档案已定义、实例仍在或可冷复原、当前无回合」 | `src/roster.ts:286-293` 注释 + `:294-322` 实现；`list()` 把 dormant 映射为 `status:'dormant'` + `resumable:true`（`src/roster.ts:210-212,223`） | ✅ 一致 |
| S4.2.2 `resume` 把成员迁回 `active` | `src/roster.ts:333-371`（先冷复原、再在 journal 事务里把 `phase` 置 `active`） | ✅ 一致 |
| S4.2.2 经 `ctx.subagents.sendMessage` 冷复原 | `src/roster.ts:348` | ✅ 与 §4.8 一致（但与 S4.2.6 原文有出入，见下） |
| S4.2.2 不可复原时返回结构化原因 | 底层 `packages/subagent/subagent/src/continuation.ts:420,431,453` = `NOT_RESUMABLE`；`:527-537` = `PERSISTENCE_UNAVAILABLE`；Team 层 `src/roster.ts:350-354` 收敛为**单一** `TEAM_MEMBER_NOT_RESUMABLE`（原码留在 `cause`） | ⚠️ 有偏差（结构化原因被压平） |
| S4.2.3 工具层 `reactivate_teammate` | `packages/experimental/tool-agent-team/src/index.ts:599` | ✅ 一致 |
| S4.2.3 `list_agents` 显示 `dormant` 与「可复用」 | `tool-agent-team/src/index.ts:154`（`enum` 含 `dormant`）、`:163`（`resumable`）；字段装配 `:170-176` | ✅ 一致 |
| S4.2.4 `maxMembers` **计入** dormant | `src/roster.ts:505-507`：dormant 成员仍留在 `state.members`，长度计入 | ✅ 一致 |
| S4.2.4 dormant **不占**并发槽位 | 并发池 `packages/subagent/subagent/src/continuation-activation.ts:41-57`（`ActivationPool.reserve`）；释放成员走 `drainChildren` → `dispose`（`:418-440`）归还槽位 | ✅ 一致 |
| S4.2.5 `team/member` 的 `dormant` 相位 | `src/types.ts:119`（快照 `phase`）；写入 `src/roster.ts:313`；投影接受 `active→dormant→active`（`src/projection.ts:325-330`） | ✅ 一致 |
| S4.2.5 投影 `stateVersion` 5→6 | `src/projection.ts:513`（`stateVersion: 6`） | ✅ 一致 |
| S4.2.6 复用路径走既有冷恢复投递，不得新开绕过持久日志的通道 | 实现走 `src/roster.ts:348` 的 `ctx.subagents.sendMessage`，**不经过 `mailbox` 的冷恢复投递路径**（`src/mailbox.ts:89-111` / `:314-340`） | ⚠️ 与规格原文不符（§4.8 已按另一落法登记） |

### S4.2.6 的具体分歧

规格 S4.2.6（规格 `:222`）原文：「复用路径必须走既有冷恢复投递（`mailbox.ts:254-261,317-331`），不得新开一条绕过持久日志的通道。」

- 实现：`roster.resume()` 直接调 `ctx.subagents.sendMessage(caller, member.id, request.prompt, { signal })`（`src/roster.ts:348`）。这**不是**规格点名的 mailbox 冷恢复投递路径；它确实复用了持久化子 Session（冷复原由 subagent 侧完成），没有绕过持久日志，但也不是 mailbox 那条链。
- 规格自身不自洽：§4.8「S4.2 驻留复用」行（规格 `:266`）写的是「`roster.resume()`（resume 经 `ctx.subagents.sendMessage` 冷复原持久化子 Session）」。即 §4.4 的条款与 §4.8 的实施结果对同一件事给了两种口径。**以实现为准时，§4.4 的 S4.2.6 条款应被标记为「未按原文落地，已在 §4.8 改口径」**。
- 实践影响：dormant 期间入队的普通消息仍会在成员复原后送达——`mailbox.recoverFor` 对广播与普通消息都做了冷恢复重投（`src/mailbox.ts:89-111`），而 `resolveReachableMember` 明确把 dormant 视为合法消息目标（`src/roster.ts:93-105`）。所以「冷恢复重投」这一**结果**成立，只是**触发点**来自 subagent 复原而非 mailbox 投递链。

### 测试覆盖

`packages/experimental/agent-team/tests/upgrade.spec.ts:292-375`「Team dormant teammates」覆盖：release 落 dormant 行、列表显示 dormant+resumable、durable 保留、resume 回 active、非 dormant 拒绝 resume、未知名字拒绝、非 Lead 拒绝 release/resume。

**缺口**：**「`maxMembers` 计入 dormant 成员」没有测试钉住**。`upgrade.spec.ts` 全文件无 `maxMembers` 断言；`tests/team.spec.ts` 中 `maxMembers` 只出现在 `:187,285,399`，覆盖的是「失败成员计入」而非「dormant 成员计入」。实现确实计入（`src/roster.ts:505`），但缺回归保护。

---

## S4.3 模式范围核对

### 三层白名单（S4.3.1）

| 层 | 实现位置 | 判定 |
|---|---|---|
| `allowedEfforts` | `src/range.ts:40-46`（`TEAM_EFFORT_NOT_ALLOWED`） | ✅ 一致 |
| `allowedBackends` | `src/range.ts:47-53`（`TEAM_BACKEND_NOT_ALLOWED`） | ✅ 机制在，❌ 目录校验缺失（见下） |
| `allowedPresets` | `src/range.ts:54-60`（`TEAM_PRESET_NOT_ALLOWED`） | ✅ 机制在，⚠️ 无 preset 目录（见下） |
| 集合语义、不做区间 | `src/range.ts:6-11`（注释与 `TeamRanges` 定义）、`src/index.ts:323-329`（`ranges()` 读配置） | ✅ 一致 |
| 空列表 = 不设限 | `src/range.ts:40,47,54`（`length > 0` 才判） | ✅ 一致 |

### `allowedEfforts` 的权威顺序（S4.3.2）

规格要求：模型广告过的档位 ∩ Host 允许 ∩ Team 允许 ∩ 显式请求。

实现把四层都做成**必过的独立闸门**（顺序与规格书写顺序不同，但交集语义等价——交集与求值次序无关）：

| 层 | 实现位置 | 错误码 |
|---|---|---|
| 档案自身档位（在 Team 之上再收窄） | `src/roster.ts:434-440` | `TEAM_EFFORT_NOT_ALLOWED` |
| Team 允许集合 | `src/roster.ts:441-445` → `src/range.ts:40-46` | `TEAM_EFFORT_NOT_ALLOWED` |
| Team 模型清单 | `src/roster.ts:446-451` | `TEAM_MODEL_NOT_ALLOWED` / `TEAM_MODEL_REQUIRED` |
| Host 允许集合 | `src/roster.ts:452-469` | `TEAM_HOST_MODEL_NOT_ALLOWED` / `..._DISABLED` / `..._UNAVAILABLE` |
| 模型广告过的档位 | `src/roster.ts:470-478`（`resolveModelInfo` → `info.reasoning.efforts`） | `TEAM_REASONING_EFFORT_NOT_ALLOWED` |
| 显式请求 | 档位取值来源 `src/roster.ts:585-615`（档案钉定 / 请求 `agentOptions` / 继承 Lead） | — |

✅ **四层交集成立**。档案声明路由时，请求只能收窄不能改写（`src/roster.ts:588-594` 冲突即拒）。另注：`src/range.ts:31-33` 的注释也明确「检查发生在更窄的天花板之后」，与实现顺序一致。

### `allowedBackends` 的目录来源与校验（S4.3.3）——**❌ 未实现**

规格 S4.3.3（规格 `:230`）原文：「`allowedBackends` 约束的是**执行后端**（`provider` 字段在 Team 里是 spawn/fork 后端，与 LLM provider 已被刻意分离）……**取值必须来自实际存在的后端目录，否则拒绝。**」

| 检查项 | 事实 | 判定 |
|---|---|---|
| 实现里有「后端目录」吗 | **没有**。`src/range.ts:47-53` 只做「请求值 ∈ 配置白名单」的集合判断，不查任何目录 | ❌ |
| 目录在仓库里存在吗 | **存在且触手可及**：`ctx.subagents.list()` 返回已注册 subagent provider 名（`packages/subagent/subagent/src/index.ts:543-545`），正是 spawn/fork 后端目录 | — |
| Team 服务是否注入了它 | **是**：`static inject = ['agents','sessions','sessionPersistence','sessionProjections','subagents','llm']`（`src/index.ts:155`） | — |
| 是否被查过 | **否**：`src/range.ts` / `src/roster.ts` 全无 `subagents.list()` 调用（grep `backend` 命中见 `src/range.ts:47-53`、`src/roster.ts:421-430,443,484,515` 等，无目录校验） | ❌ |
| 越界后端的后果 | **不是「拒绝」**：先在 journal 事务里落一条 `provisioning` 成员行（`src/roster.ts:496-509`），再在 `startContinuable` 里因 `expectProvider` 抛 `NO_PROVIDER`（`packages/subagent/subagent/src/index.ts:612-618`）失败，最终记成 `phase:'failed'`（`src/roster.ts:529-548`） | ❌ 语义不符 |
| 失败后的残留代价 | 该失败成员**仍占名字与名额**（`src/roster.ts:502-507`），见测试 `tests/team.spec.ts:398-409`（`provider:'missing'` → 成员 failed → 同名再起报 `TEAM_MEMBER_NAME_TAKEN`、新成员报 `TEAM_MEMBER_LIMIT`） | ⚠️ 代价可观测 |

**结论**：S4.3.3 的「目录来源 + 否则拒绝」是一条**明文契约**，当前实现**只有集合白名单的一半**。空 `allowedBackends` 时（当前 profile patch 的默认值，`packages/experimental/agent-team-profile/cordis.patch.yml:37`）任意拼写的后端都会被接受到 Team 层，只有下游 provider 查找才会失败。

### `allowedPresets` 是否真的接上了 preset（S4.3.4）——⚠️ 半接

| 检查项 | 事实 | 判定 |
|---|---|---|
| Team 侧新增了 preset 引用 | 是：`preset` 进入成员快照（`src/types.ts:117`）、投影（`src/types.ts:190`）、工具参数（`tool-agent-team/src/index.ts:409-411`）、白名单校验（`src/range.ts:54-60`） | ✅ |
| preset 目录是否被查 | **否**。`packages/preset/agent-preset/src/index.ts` 对 `Team`/`agentTeam` **零命中**（grep `agentTeam\|team\|Team` → No matches found）。`allowedPresets` 校验的是自由文本名单 | ⚠️ 同 `allowedBackends` 形态 |
| preset 是否被「施加」 | 否。§4.8 已知边界 #1（规格 `:277-287`）如实记录：preset 只被记录与校验，真正跑在哪个 preset 由 Session 侧决定；并给出取证（子 Agent 的 preset 由父级继承 `packages/subagent/subagent/src/child-agent.ts:205`，`SubagentCapabilities` 只有 `toolFilter`/`persona` 两个 per-child 施加点） | ✅ 边界已如实登记 |

⚠️ 注意：§4.8 的已知边界只声明了「preset 不被施加」，**没有**声明「preset id 不对照真实 preset 目录校验」。这是规格结论与实现之间未被登记的缺口。

### 工具参数与发现工具（S4.3.5）——⚠️ 部分

| 要求 | 实现位置 | 判定 |
|---|---|---|
| `spawn_teammate` 增可选 `backend` | `tool-agent-team/src/index.ts:397-400`（参数）、`:443-447`（取值：显式 > 档案 > Team 默认后端） | ✅ |
| 增可选 `preset` | `tool-agent-team/src/index.ts:409-411`（参数）、`:467`（写入请求） | ✅ |
| 增可选 `effort` | `tool-agent-team/src/index.ts:401-403`（`reasoning_effort`） | ✅ |
| `list_subagent_models` 输出「标注每个模型是否落在允许范围内」 | `packages/subagent/tool-subagent/src/list-models.ts:59-80`：模型**被过滤**（只列允许路由），档位列表**原样列出模型广告过的全部档位**；Team 侧贡献策略 `tool-agent-team/src/index.ts:74-86` 只有 `routes`（provider/model），**不携带档位层** | ⚠️ provider/model 层=过滤式实现；**档位层无标注** |

### 设置区 UI（S4.3.6）——❌ 未实现

规格 S4.3.6（规格 `:233`）：「`team-model-restriction-card-controller.ts` 从「provider/model 两级」扩到「provider/model/档位/后端」四级。」

| 检查项 | 事实 | 判定 |
|---|---|---|
| 控制器现状 | `packages/client/ui-settings-subagent/src/client/team-model-restriction-card-controller.ts:12-15`（`TeamModelRestrictionSettings` 只有 `allowedModels` / `defaultModel`）、`:222-228`（候选只有 provider/model + `hostAllowed` 标注） | ❌ 仍是两级 |
| 是否覆盖 preset | 否 | ❌ |
| §4.8 是否登记为延后 | **否**。§4.8「本轮实施结果」表（规格 `:263-270`）列了 S4.1 / S4.2 / S4.3 / S4.4 / 工具层 / 设置区档案卡片，**没有 S4.3.6 这一行**，也没有把它列入「已知边界」 | ❌ 规格结论被静默略过 |

---

## S4.4 群聊核对

### 复用既有邮箱链（S4.4.2）——✅

| 规格要求 | 实现位置 | 判定 |
|---|---|---|
| 先落盘再投递 | 广播：`src/mailbox.ts:237-241`（`appendAndFlush`）先于 `:244` 的 dispatch 注册；普通消息同构 `:153-160` | ✅ |
| 按目标串行 | `src/mailbox.ts:490-505`（`serializeDispatch`，按 `targetId` 排队）；广播逐目标串行 `:295-302` | ✅ |
| 目标去重 | `src/mailbox.ts:597-602`（`targetRecorded` 查目标 Session 已收）、`:613-627`（`persistedTargetRecorded` 查冷态持久日志）；广播侧 `:358-360`、`:321-329` | ✅ |
| 冷恢复重投 | `src/mailbox.ts:89-111`：普通消息 `:94-100`，广播 `:103-110` | ✅ |
| 不新建第二条投递链 | 广播复用同一 `TeamMailbox`、同一 `TeamJournal`、同一 `inFlightMessages` 去重表、同一 `dispatchTails` | ✅ |

### 上限按展开后的目标数计（S4.4.4）——✅（字节上限有一处口径差）

| 限制 | 实现位置 | 判定 |
|---|---|---|
| 每目标待投递上限（`TEAM_MAILBOX_FULL`）按**展开后目标数**计 | `src/mailbox.ts:202-209`（展开并去重目标 id）、`:213-226`（逐目标查该目标的挂起广播数） | ✅ 一致 |
| 消息体上限（`TEAM_MESSAGE_TOO_LARGE`） | `src/mailbox.ts:234-236`（对**一份**广播内容算字节） | ⚠️ 口径差：广播内容只存一份（`src/types.ts:243-250`），字节上限按单份计，未乘展开后目标数 |
| 测试 | `tests/upgrade.spec.ts:548`「counts every expanded broadcast target against that target pending ceiling」、`:562`、`:579`（广播上限与普通消息上限相互独立） | ✅ 已钉住（针对挂起数） |

判定说明：规格 `:242` 原文「消息体上限、每目标待投递上限……按**展开后的目标数**计」可作两种读法。实现对「每目标待投递上限」严格按展开后目标数计（主要语义，✅）；对「消息体上限」按单份内容计（因内容物理上只存一份，⚠️ 需规格方确认口径）。普通消息路径对照：`src/mailbox.ts:135-142`（每目标挂起数）、`:150-152`（字节数）。

### 群消息永不进模型对话面（S4.4.5）——✅

- Team 事件一律经 `TeamJournal.appendAndFlush` 追加（`src/journal.ts:61-73`），注释明写「Team events never enter the conversation surface」（`:66-68`），实现是**不带 surface 参数**地调用 `root.session.append`（`:69-70`）——即只进日志、不进对话面。
- 群消息投递给目标成员时走的是子会话的 **inbox**（`steerHostSubagentPrompt`，`src/mailbox.ts:382`），不是 Lead 的对话面。

### 事件与投影（S4.4.3）——✅

| 要求 | 实现位置 | 判定 |
|---|---|---|
| 新增事件 `team/message/broadcast`（载荷版本 1） | `src/types.ts:410-411`；写 `src/mailbox.ts:237-241`；解析 `src/projection.ts:156-160` | ✅ |
| 新增事件 `team/message/broadcast-delivered`（载荷版本 1） | `src/types.ts:412-418`；写 `src/mailbox.ts:423-428`；解析 `src/projection.ts:162-167` | ✅ |
| `TeamMessageSnapshot` 保留单目标快照 | `src/types.ts:212-219` | ✅ |
| 新增广播快照 `TeamBroadcastSnapshot` | `src/types.ts:243-250`；逐目标投递边 `TeamBroadcastDelivery` `:252-256` | ✅ |
| 投影新增 `broadcasts` 与 `broadcastDelivered` | `src/projection.ts:180-183`（`TeamState`）、`:216-229`（状态 schema）、`:390-419`（两个事件的应用分支） | ✅ |
| `stateVersion` 递增 | `src/projection.ts:513` = `6`（与 S4.2.5 共用同一次递增） | ✅ |

### 广播的其它实现要点（§4.8 声明核对）

- 「一条持久广播记录 + 每目标一条投递边」：`src/mailbox.ts:227-233` + `:416-430` ✅
- 「目标去重」：展开时 `targetIds` 去重（`src/mailbox.ts:208`）✅
- 工具层 `broadcast_message`：`tool-agent-team/src/index.ts:492` ✅
- 工具描述与系统提示同步：`tool-agent-team/src/index.ts:134`（prompt）、`:492-515`（实现）、`:516-525`（`list_agents` 描述提到 dormant）✅

---

## 不变量核对

规格 §4.7（规格 `:246-257`）列出 23 条，重点几条逐条核对：

| # | 不变量 | 证据 | 判定 |
|---|---|---|---|
| 1 | 成员名唯一（同一 Team 内，含失败成员） | `src/roster.ts:502-504`；测试 `tests/team.spec.ts:398-409` | ✅ 仍成立 |
| 2 | `maxMembers` 计入 dormant 成员 | `src/roster.ts:505-507`（dormant 留在 `state.members`） | ✅ 成立（⚠️ 无测试钉住） |
| 3 | Team 事件 log-only | `src/journal.ts:61-73`（无 surface 的 `session.append`） | ✅ 仍成立 |
| 4 | `model-visible ⟺ logged` | 档案实例只以 `team/member` 快照进 Lead 日志（`src/roster.ts:314-318`、`:363-367`）；`TeamMemberSnapshot.profileId`（`src/types.ts:115`）与运行时视图分离 | ✅ 仍成立 |
| 5 | 投递只有一条邮箱链 | 广播与单播同走 `TeamMailbox`（`src/mailbox.ts:58-65` / `:176-183`）、同一 journal、同一去重表 | ✅ 仍成立 |
| 6 | 投影 `stateVersion` 每次结构变更递增 | `src/projection.ts:513` = 6（本轮 S4.2.5 / S4.4.3 两处结构变更合并为一次递增） | ✅ 成立 |
| 7 | 可续用子智能体必须有 session persistence + session query | `packages/subagent/subagent/src/continuation.ts:527-537`（`requirePersistence` → `PERSISTENCE_UNAVAILABLE`）、`:539+`（session query 解析）；`src/roster.ts:513`（团队走 continuable 路径） | ✅ 仍成立 |
| 8 | 销毁顺序：先关准入 → 等在途 → 释放直属子进程 → 释放投影 | `src/index.ts:260-269`（`ctx.effect` 注册投影并在拆卸时释放 runtime）；`src/roster.ts:397-399`（`stopTeammates` 走 `drainContinuableChildren`） | ✅ 仍成立 |
| 9 | 同一 Agent scope 内工具名只能注册一次 | `packages/subagent/tool-subagent/src/list-models.ts:110-127`（进程级 scope 注册表）；`tool-agent-team/src/index.ts:363` 按 scope 贡献策略 | ✅ 仍成立 |

---

## 群组审查前提的独立复核

复核对象：`dev-docs/2026-10-23-agentloop-alignment-review.md`。

### ⚠️ 复核对象存在两个版本（必须先说明）

该文档在当前工作树里是**未提交的重写版**，与 HEAD 里的已提交版不是同一篇：

| | HEAD 已提交版（`git show HEAD:dev-docs/…`） | 工作树重写版（磁盘上） |
|---|---|---|
| 行数 / 标题 | 210 行，《Agent Loop 行为对齐复核（AgentLoop对齐师 · 2026-10-23）》 | 103 行，《Agent loop 对齐复核（独立验证版）》 |
| 章节编号 | §1 P0/P1/P2 复核表、**§2 §6 不得照搬清单复核**、§3 影响排序、§3 建议动作、§4 未验证项、**§5 闸门判断** | §0 结论摘要、§1 P0 复核、§2 P1 复核、§3 P2 复核、§4 勘误、§5 §6 清单复核、§6 影响排序、§7 建议动作 |
| git 状态 | 已提交（`401f3e82bc`） | **未提交修改**（`git status` = ` M`），mtime `2026-10-23 02:05:43`（早于本轮写入） |

**任务简报引用的章节号（§5 闸门判断、§6 不得照搬清单、P0-1、P2「本审查期内已被消除」）对应的是 HEAD 已提交版**；工作树重写版把这两节重新编号为 §5「§6 清单逐条复核」与（无闸门节）。本轮复核**以 HEAD 已提交版为准**，同时把重写版作为对照列出。本轮未对该文件做任何写入（`git status` 中的 ` M` 在本轮开始前即存在，且本轮唯一的写操作是新建本文档）。

### 取证方法（重要）

- 本次核对给出的 vendor 路径提示是 `node_modules/.pnpm/@earendil-works+pi-ai@0.87.*/node_modules/@earendil-works/pi-ai/dist/`。**该路径无法支撑 P0-1 的前提**：pi-ai 0.87 的 dist 是 LLM 传输层库，对 `dependsOn` / `scheduleTools` / `parallelGroups` **全部 0 命中**（grep 全 dist，exit=0，No matches found）。
- P0-1 的「上游」实为 **ZCode 快照**。本机快照仍在：`C:\Users\19635\AppData\Local\Temp\cetusprism-zcode-official-20261013-2`，工作树文件已删（该目录下文件总数 = 0），但 `.git\objects\pack\pack-d460ebf9082a3459f5a8978ea6216bd4999171ba.pack` 在位，与审查所引 `pack-d460ebf…` 一致。
- 取证方式（**只读**）：`git verify-pack -v <idx>` 枚举对象；`GIT_OBJECT_DIRECTORY` 指向上游 objects、`--git-dir` 指向本仓 `.git`，用 `git cat-file -p` 读树与 blob。commit = `aac4755666d09fdcd70272fcf063c077a639015f`（「feat: update to v3.15.1」），与规格 §0.8 记录的 `aac4755…` 一致。
- **工作树并发写入提示**：本轮进行期间（02:12:54 / 02:13:25）`packages/llm/llm-pi-ai/src/stream.ts` 与 `packages/llm/llm-pi-ai/tests/convert.spec.ts` 被**其它会话**改动（与近期 HEAD 提交 `f4d90a6f2c fix(llm-pi-ai): land the model-access review D1/D3/D6/D8` 同域）。本轮未触碰这两个文件，且本文引用的所有证据文件均未被改动，故结论不受影响；但重跑本文命令时应注意工作树已非纯净状态。

### P0-1 工具调度拓扑 = 「伪差距」——✅ 前提在源码中成立

以 HEAD 已提交版（`git show HEAD:dev-docs/2026-10-23-agentloop-alignment-review.md`）§1「P0-1 工具调度拓扑」逐条复核：

| 审查断言（HEAD 版） | 独立复核（实测） | 判定 |
|---|---|---|
| 上游确有拓扑排序→分组→组间串行：`core/src/tool/scheduler.ts:60-83`（topologicalSort → groupByParallel → validateNoCycles） | 实读 blob `33ca59f72e8d4290e0e059d0da8fc997cf7afc42`（245 行）：`:60-83` 确为 `schedule()`，内含 `sorted = this.topologicalSort(items)`（`:74`）→ `groups = this.groupByParallel(sorted)`（`:75`）→ `this.validateNoCycles(groups)`（`:76`），返回 `parallelGroups`（`:80`） | ✅ 行号精确 |
| **上游 `dependsOn` 恒为空**，拓扑排序与 validateNoCycles 是死代码路径：`core/src/runtime/methods/tools.ts:42-58`（`dependsOn: []`，第 49 行） | 实读 blob `e1b36d1324b5e51072b78ea274c7c1a80915c956`（304 行）：`tools.ts:42-58` 是 `dependencies` 映射体，`dependsOn: [],` 落在 **第 49 行**，map 内无任何分支改写它 | ✅ 精确 |
| 「全上游 grep `dependsOn` 无第二个 runtime 构造点」 | 全树 grep `dependsOn`（`git grep` over `aac4755`）：工具调度域内仅 3 处——生产端 `tools.ts:49`、类型声明 `core/src/tool/scheduler.ts:32`、消费端 `core/src/tool/scheduler.ts:64`（`dependencies: tool.dependsOn`）。其余命中全部在 `core/src/workflow/**`（`workflow/expert/parsers/graph-seed.ts:57`、`workflow/lifecycle.ts:299`、`workflow/scheduler/planner-expansion.ts:95` 等），是**动态工作流节点 DAG**，不是 runtime 构造点，也不喂给 `toolScheduler.schedule` | ✅ **断言准确** |
| 上游并行判据：`scheduler.ts:85-103`（`canRunInParallel`）、`:233-243`（READ_ONLY_TOOLS） | 实读：`:85-103` 确为 `private canRunInParallel(tool: ToolDependency): boolean`；`:233-243` 确为 `export const READ_ONLY_TOOLS = new Set([...])`，成员含 `Read/Glob/Grep/WebSearch/WebFetch/TodoRead/TodoWrite/AskUserQuestion/Skill` | ✅ 行号与方法名均精确 |
| 上游「无名字无元数据 → true（fail-open）」；有名字不在白名单无元数据 → 落到 `return tool.sideEffectScope === "none"` = false → 独占屏障 | 实读 `:93-95` = `if (!hasToolName && !hasSafetyMetadata) return true`（fail-open）；`:97` 取 `readOnlyTools.has(toolName)`；`:98-102` 排除 `destructive` / `concurrentSafe===false`，末位仅 `sideEffectScope === "none"` 放行 → 具名未标注工具落到 false（独占） | ✅ 成立。**注**：生产路径 `tools.ts:48` 恒带 `toolName: tc.name`，故 fail-open 分支在生产中不可达；「方向恰好相反」指的是**机制默认值**，非生产行为 |
| 拓扑退化为单层 | `topologicalSort`（`scheduler.ts:105-115`）入度全部来自 `item.dependencies.length`（`:111`），依赖恒空 → 单层 | ✅ 逻辑闭合 |
| 上游组间串行、组内并行：`core/src/tool/executor/batch-runner.ts:56-90` + `:24-54`（组内 Promise.all） | 实读该 blob（160 行）：`:24-54` = `executeToolBatch`，`:33` 为 `Promise.all(toolCalls.map(...))`，`:37-38` 按 `maxConcurrency` 分块、`:39-50` 块内 `Promise.all`；`:56` 起 = `executeToolSchedule`（组间串行） | ✅ 行号精确 |
| 并发上限两侧同为 10：上游 `scheduler.ts:48` ↔ 本仓 `packages/core/agent-loop/src/constants.ts:7` | 实读上游 `scheduler.ts:48` = `const DEFAULT_MAX_CONCURRENCY = 10;`；本仓 `packages/core/agent-loop/src/constants.ts:6` = `export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`（该文件共 6 行，故常量为第 **6** 行，审查写 `:7` 偏移 1 行） | ✅ 语义精确（行号偏移 1） |
| 本仓 `executionMode` 是 fail-closed：仅显式 `isConcurrencySafe(args) === true` 才并行 | 实读 `packages/core/tools/src/index.ts:1303-1312`：`:1305` `if (!tool?.isConcurrencySafe) return { kind: 'exclusive' }`；`:1308` 仅 `concurrencySafe === true` 才 parallel；`:1309-1310` 抛错也 exclusive | ✅ 精确 |
| 本仓 fillPool 每次启动前重读 `executionMode`：`tool-calls.ts:199-214` | 实读 `packages/core/agent-loop/src/tool-calls.ts:199-214`：`fillPool` 内 `:204-205` = `if (nextToStart > 0 && mode === 'parallel' && ctx.tools.executionMode(nextCall.exec).kind !== 'parallel') break` | ✅ 精确 |

**结论**：P0-1 判为「伪差距」的**每一条前提都在上游源码与本仓源码中独立成立**，且**本轮已把审查标注为【pack 未验证】的上游行号全部完成交叉验证**（`tools.ts:49`、`scheduler.ts:48/60-83/85-103/233-243`、`batch-runner.ts:24-54/56-90` 全部对上）。**唯一需要修正的是本仓侧一个行号**：`packages/core/agent-loop/src/constants.ts` 的常量在第 **6** 行（该文件仅 6 行），审查写 `:7`。

### 工作树重写版与 HEAD 版的差异（本轮附带发现）

未提交的重写版对同一 P0-1 有两处表述退化，需注意不要以重写版为准：

| 重写版表述 | 问题 | HEAD 版表述（准确） |
|---|---|---|
| 「全仓 grep 仅类型定义与空数组字面量」 | 不准确：`workflow/**` 域确有非空 `dependsOn`（另一领域，不影响结论） | 「全上游 grep `dependsOn` 无第二个 runtime 构造点」——精确限定在 runtime 构造点，正确 |
| 方法名写作 `canRunParallel` | 拼写错误 | `canRunInParallel`（`scheduler.ts:85`）——正确 |
| 上游并行批处理引 `batch-runner.ts:32-33`（缺 `tool/executor/` 路径段） | 路径不完整 | `core/src/tool/executor/batch-runner.ts:56-90` / `:24-54`——正确 |
| 删去了「上游 fail-open / 本仓 fail-closed，方向恰好相反」的观察 | 丢失了一个真实的机制差异（生产不可达） | 保留在 §0 第 1 条与 §1 表格 |

此外重写版的 §1.1 未保留 HEAD 版「并发上限两侧同为 10」「悬挂 tool call 双侧都有兜底」两条本轮可验证的对照（上游 `scheduler.ts:48` ↔ 本仓 `constants.ts:6`）。

### P2 重试次数 = 「伪差距（本审查期内已被消除）」——✅ 前提成立

以 HEAD 已提交版 §1「P2 重试次数」逐条复核：

| 审查断言（HEAD 版） | 独立复核（实测） | 判定 |
|---|---|---|
| 基线文档称「GLM 覆盖压到 `maxRetries: 2`（`cordis.yml:28-30`）」 | 读取 `apps/cli/config/examples/glm-harness/cordis.yml:28-34`：`maxRetries: 10`（第 **34** 行），注释块 `:30-33` 明写「Upstream ZCode spends a budget of 10 retries with exponential backoff and jitter, and honors a provider wait hint over its own backoff. This harness keeps that budget instead of the shorter local default」 | ✅ 基线断言有误，勘误属实 |
| 本仓包默认 5：`packages/llm/llm/src/retry-policy.ts:14` | 实读 `retry-policy.ts:14` = `const DEFAULT_MAX_RETRIES = 5` | ✅ **行号精确** |
| 因此「默认 5 vs 10」的差异保留为「非 GLM 路由默认值」，可配置、由 provider 覆盖 → 伪差距 | 本仓默认 5 与 GLM 显式 10 是同量纲可配置，非行为差距 | ✅ 结论成立 |

**结论**：P2 的前提（「本审查期内已被消除」）**属实且行号精确**——HEAD 版引用的 `retry-policy.ts:14` 与 `cordis.yml:28-34` 全部对得上。⚠️ 反倒是**工作树重写版**把默认常量引成了 `retry-policy.ts:40-41`（`:40` 是 `maxRetries: number` 的类型声明、`:41` 是 `maxRetries?: number`，**常量其实在 `:14`**），并把 GLM 行号写成 `cordis.yml:28-30`（实际 `maxRetries: 10` 在 `:34`）。以 HEAD 版为准。

### §2「不得照搬清单」与 §5 闸门判断（HEAD 版编号）

| 条目 | 复核 | 判定 |
|---|---|---|
| §2-4 身份串 `You are ZCode, an interactive coding agent` 不作产品身份 | `packages/` 全量 grep `You are ZCode` → **No matches found** | ✅ 成立（可独立验证） |
| §2-3 调度全程经 `ctx.tools` | 本仓 `packages/core/agent-loop/src/tool-calls.ts:153-154,170-174`；审查另指 `tools/src/index.ts:153` 审批 waterfall | 未逐行复核（本轮只复核了 `tool-calls.ts:199-214` 的 fillPool） |
| §2-1 TurnMachine/TurnState 不作 turn 状态源 | 审查依据本仓 `agent.ts:305`（turn/start）、`:356`（step/end）、`:385`（turn/end） | 未逐行复核 |
| §2-2 canonical history 不成第二历史源 | 审查依据本仓 `deriveMessages()`（`agent.ts:671`） | 未逐行复核 |
| §2-5 provider 目录不直接替换 `llm-pi-ai` | 审查依据上游 `config/provider/zcode-builtin.json`（revision 31）与本仓 `catalog.ts:604-712` | 未复核 |
| §2-6 `glm-5.2-reasoning-depth.md` 不可作依据 | 审查依据 `zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:9` | 未复核 |
| §2-7 账号配置/网关/授权头不进仓 | 政策性条款，无反证可查 | 未验证 |
| §0/§3「真差距计数 P0=0 / P1=2 / P2=0」 | P0=0 的两条依据：P0-1 伪差距（本轮已逐行复核，**全部成立**）；P0-2「ZCode 底座保持 unconfigured」本轮未复核。P2=0 的依据（重试已消除、其余为方言）本轮已复核 P2 一条，**成立** | 部分验证 |
| §3 影响排序 / §3 建议动作（Top 1/2/3） | 属行动建议，不在本次实现一致性核对范围 | 不适用 |
| §5 闸门判断（「pre-commit 不应加 typecheck」，三处 typecheck 错误落在 agent-team 测试文件） | 本轮**未复核**：未跑 typecheck、未核对 `lefthook.yml:5-38/:52-55`。⚠️ 值得注意的是本轮跑的 `packages/experimental/agent-team` + `packages/experimental/tool-agent-team` 测试**全绿（167/167）**，与「错误落在 agent-team 测试文件」的说法方向一致（当前 HEAD 上这些测试已通过） | 未验证（部分旁证） |

**总体**：群组审查的 **§2 清单、§5 闸门判断与 §3 影响排序**，在本轮可独立验证的范围内**与源码事实相符**；P0-1 与 P2 两条前提**逐行验证成立**。需要记录的行号偏差只有一处：`packages/core/agent-loop/src/constants.ts` 的并发常量为第 **6** 行（审查写 `:7`）。

---

## S4.1.6 延后项的现状复核（Q7）

规格 S4.1.6（规格 `:211`）：「设置区新增档案卡片……**本轮未实现（延后）**：档案的读写落点已由 S4.1.2 的 profile patch 满足，UI 卡片是可选的便利面，不阻塞其余三项。」

**判定：延后判断现在仍然成立，且理由比规格写作时更充分。**

| 论据 | 证据 | 判定 |
|---|---|---|
| 档案定义落在插件 Config 的 volatile 字段 | `src/index.ts:165`（`profiles: z.array(agentProfileSchema).default([]).volatile()`）；`src/types.ts:290` | ✅ |
| 通用设置机制能把它**读**出来 | `packages/settings/settings/src/index.ts:302-340`（`describe()` 对 active 插件条目取 `volatileForm(schema)` 并投影 `value`/`base`/`user`）；`packages/settings/settings/src/schema.ts:37-47`（`volatileForm` 递归挑选 volatile 字段，`plainSchema` 保留数组与嵌套对象结构，`:19-31`） | ✅ |
| 通用设置机制能把它**写**回去 | `packages/settings/settings/src/index.ts:347-350`（`update(ns, patch, rev)` 合并补丁）；`packages/boot/config-editor/src/index.ts:87-140`（`edit()` 校验、解析并改写 profile patch 的 YAML 序列节点，含「被 home patch 覆盖则报错」保护 `:139-140`） | ✅ |
| 写入目标就是 profile patch | `packages/boot/config-editor/src/index.ts:34`（`documentPath` = `profileContext.patchPath`） | ✅ |
| 声明变更即时生效（不需重启） | `src/index.ts:335-342`（`profileRegistry()` 在声明引用变化时重建 `AgentProfileRegistry`） | ✅ |
| 部署侧有真实落点与示例 | `packages/experimental/agent-team-profile/cordis.patch.yml:28-34`（`profiles` 注释示例）、`:35-38`（三层白名单） | ✅ |
| 档案卡片确实仍未实现 | `packages/client/ui-settings-subagent/src` 全量 grep `profiles`/`agentProfile` → **No matches found** | ✅ 确认为延后 |
| 档案的运行实例仍在 Lead 日志 | `src/roster.ts:314-318`（`team/member` 快照含 `profileId`） | ✅ 与 S4.1.3 一致 |

**唯一需要补充的限定**：客户端设置界面是**卡片制**的，`packages/client/ui-settings*/src/client/` 下只有按插件手写的卡片组件（如 `ui-settings-subagent/src/client/TeamModelRestrictionFields.tsx`），**没有**渲染「对象数组」这类通用 volatile 表单的通用组件。因此「档案可读可写」的成立范围是**配置层 / 设置服务层 / profile patch YAML 层**（可被设置服务、CLI、YAML 直接读写），**不是**「用户在设置界面里有一条档案卡片」。这正好落在规格给卡片留的「可选便利面」定位内。

---

## 未验证项与验证方法

| # | 未验证项 | 原因 | 验证方法 |
|---|---|---|---|
| 1 | 群组审查 §2-1 / §2-2 / §2-3 / §2-5 / §2-6 / §2-7 | 本轮聚焦 P0-1 / P2 两条前提，未逐行复核清单其余各条 | 逐条读 `packages/core/agent-loop/src/agent.ts`（`:305,356,385,671`）、`tool-calls.ts:153-154,170-174`、`packages/core/tools/src/index.ts:153`；对 §2-5/6/7 做 `packages/` 全量 grep（provider 目录、`glm-5.2-reasoning-depth.md` 引用、credentials/runtime/privateConfig 关键字） |
| 2 | 群组审查 §5 闸门判断（「pre-commit 不应加 typecheck」；三处 typecheck 错误落在 agent-team 测试文件） | 本轮未跑 typecheck、未读 `lefthook.yml` | 跑 `pnpm --dir 'E:\Projects\CetusPrism' run typecheck` 复核报错文件；读 `lefthook.yml:5-38`（pre-commit）与 `:52-55`（pre-push）。⚠️ 旁证：本轮 agent-team + tool-agent-team 测试 **167/167 全绿**，与「错误落在 agent-team 测试文件」方向一致 |
| 3 | 群组审查 P0-2「ZCode 底座保持 unconfigured」 | 本轮未复核 | 读 `packages/preset/agent-preset-registry/src/backend.ts:73,182-207`、`packages/client/ui-agent-preset/src/client/backend-store.ts:161-173`、`builtin-agent-adapter.ts:125-127` |
| 4 | S4.4.4 字节上限「按展开后目标数计」的正确口径 | 规格 `:242` 措辞可两读，实现按单份计 | 需规格方裁定；若裁定为「单份计」，应在 §4.8 已知边界补记该口径 |
| 5 | `AgentProfile` 缺失 effort 字段是**有意省略**还是**遗漏** | 规格未说明档案是否应钉默认档位 | 查 S4 提交 `5d87f61543`（`feat(agent-team): add agent profiles, long-lived residency, mode ranges, and team broadcast`）与 `ea8785b21c`（`fix(agent-team): keep the declared profile contract assignable`）的提交说明 / PR 讨论，确认设计意图 |
| 6 | `allowedBackends` / `allowedPresets` 是否应接目录 | 规格 S4.3.3 明文要求后端目录；preset 目录无明文要求 | 同上，查 S4 提交的评审记录；本轮已按**规格原文**判定 S4.3.3 未实现 |
| 7 | 客户端设置界面能否渲染「对象数组」volatile 字段 | 本轮只确认「无档案卡片」，未穷举通用表单渲染能力 | 在设置 UI 中定位任意对象数组 volatile 字段（如 `packages/llm/llm-pi-ai/src/config.ts` 的 `models[]`）的既有渲染实现，判断 `profiles[]` 能否复用 |
| 8 | `maxMembers` 计入 dormant 的回归保护 | 当前无测试 | 新增用例：设 `maxMembers: 1` → release 一个成员 → 再 spawn 期望 `TEAM_MEMBER_LIMIT` |
| 9 | 上游 `core/src/tool/scheduler.ts:154-201`（非并行工具 flush 单例组） | 本轮读了 `:44-84`、`:85-103`、`:105-115`、`:233-243`，未读 `:154-201` | `git cat-file -p <commit>:apps/zcode-cli/packages/core/src/tool/scheduler.ts` 读 `:154-201` |
| 10 | 上游 `batch-runner.ts:56-90` 的组间串行实现细节 | 本轮读到 `:56` 函数签名即止 | 同上，读 `:56-90` |

### 本轮实际执行的命令（全部只读）

| 命令 | 退出码 | 用途 |
|---|---|---|
| `git -C 'E:\Projects\CetusPrism' log --oneline -5` / `rev-parse HEAD` / `branch --show-current` | 0 | 确认 `401f3e82bc` / `release/v1.7.3` |
| `git -C 'E:\Projects\CetusPrism' log --oneline --all --grep='agent-team' -20` | 0 | 定位 S4 提交（S4 主提交 `5d87f61543`、工具层 `2e5d7fc1b6`、后续修复 `ea8785b21c`） |
| `git -C 'E:\Projects\CetusPrism' log --oneline -30 -- packages/experimental/agent-team` | 0 | 同一目的的包维度视图 |
| `git verify-pack -v <upstream idx>` | 0 | 枚举上游 pack（commit 1 / tree 989 / blob 15321） |
| `GIT_OBJECT_DIRECTORY=<upstream objects> git --git-dir='E:\Projects\CetusPrism\.git' cat-file -p <commit>:<path>` | 0 | 只读读上游树与 blob（`tools.ts`、`scheduler.ts`、`tool/executor/batch-runner.ts`） |
| `GIT_OBJECT_DIRECTORY=<upstream objects> git --git-dir=... grep -n 'dependsOn' <commit> -- '*.ts'` | 0 | 上游全树 `dependsOn` 取证 |
| `GIT_OBJECT_DIRECTORY=<upstream objects> git --git-dir=... ls-tree -r --name-only <commit>` | 0 | 定位上游 `tool/executor/batch-runner.ts` 真实路径 |
| `git --git-dir='E:\Projects\CetusPrism\.git' show 'HEAD:dev-docs/2026-10-23-agentloop-alignment-review.md'` | 0 | 读群组审查的**已提交版**（简报所引 §5/§6 编号对应此版） |
| `git -C 'E:\Projects\CetusPrism' diff --stat -- dev-docs/2026-10-23-agentloop-alignment-review.md` | 0 | 确认该文件是**未提交修改**（94 insertions / 201 deletions），非本轮所致 |
| `git verify-pack` / `Get-ChildItem` 遍历 pi-ai vendor dist | 0 | 确认 pi-ai dist 为传输层库，无调度器（`dependsOn`/`scheduleTools`/`parallelGroups` 均 0 命中） |
| `node vitest.mjs run --root 'E:\Projects\CetusPrism' --config 'E:\Projects\CetusPrism\configs\vitest.config.ts' packages/experimental/agent-team packages/experimental/tool-agent-team` | **0** | **8 个测试文件 / 167 个用例全绿**（agent-team + tool-agent-team） |
