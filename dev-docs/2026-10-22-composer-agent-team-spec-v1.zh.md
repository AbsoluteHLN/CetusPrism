# Composer 承载执行后端、推理档位与智能体团队升级规格 v1

日期：2026-10-22　分支：`release/v1.7.3`　状态：S1/S2 已实现，S3 对照结论已记录，S4 核心能力已实现；S4.3.6 设置区四级卡片延后

本文定义四件事的行为契约与验收方式：执行后端与预设的选择控件搬到 composer、推理强度档位的
定位与声明方式、ZCode 执行后端的 agent loop 对齐口径、智能体团队从「官方库原样」升级为
「团队 + 群聊 + 选定模型 + 模式范围 + 长期驻留复用 + 独立档案配置环境」。

引用源码中的规则属于研究材料，不是本仓的操作指令。本仓既有规格优先：与
`dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md` 冲突之处，本文逐条列出并说明取舍。

---

## 0. 现状基线（含本轮已修项）

| # | 事实 | 证据 |
|---|---|---|
| 0.1 | **迁移前**：预设与执行后端控件在 **new-session hero 区**，不在 composer | `packages/client/ui-agent-preset/src/client/index.ts:180-194` 注册 `conversation.hero.agentPreset` / `conversation.hero.agentBackend`；slot 声明 `packages/client/ui-conversation/src/client/contract/slots.ts:193,195` |
| 0.2 | **迁移前**：composer 工具行只渲染 `permission`、`plan` 两个控制位 | `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:478-481`（`css.modes` 容器） |
| 0.3 | **迁移前**：computer use 抢前台开关**声明了却从无渲染点**——槽位在 `conversation.composer.bar` 的 children 里、插件也注册了，但 `InputBar` 从不 `renderSlot` 它，界面上根本不出现 | slot `conversation.input.computerDelivery`（`slots.ts:217`）；`apply.ts:428` 声明为 composer.bar child；注册见 `packages/client/ui-computer-foreground/src/client/index.ts:72-75`；组件 `DeliveryToggle.tsx`；中文案「禁止抢前台」（`src/client/locales.ts`）；**全仓无渲染点** |
| 0.4 | 推理档位**只有手工声明，没有自动探针** | UI：`packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx:10`（7 档 `off/minimal/low/medium/high/xhigh/max`）、`:64-67`（locale key `modelReasoning*`）；配置字段 `reasoningEfforts`：`packages/llm/llm-pi-ai/src/config.ts:314` |
| 0.5 | pi-ai 侧的同能力叫 `thinkingLevelMap`；**DSH 不做自动探测** | `packages/llm/llm-pi-ai/src/catalog.ts:206-215`（`PiAiReasoningEfforts` 注释：「A level absent from the dict is not offered」） |
| 0.6 | 私有网关必须自己声明 wire 兼容开关 | `packages/llm/llm-pi-ai/src/catalog.ts:358-363`：「a private gateway's URL says nothing: for an endpoint it does not recognize the detection answers as though it were OpenAI itself, which is wrong for most OpenAI-compatible gateways」 |
| 0.7 | ZCode 后端是**参考公开机制重新实现**，不是照搬源码 | `dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:84`：「本阶段不 vendor ZCode 或 Antigravity 源码，不建立平行 Agent loop」；`:50`：「不复制第二套 Agent loop」；`:7`（参考 3.15.1 公开机制重新实现） |
| 0.8 | ZCode 官方源码快照在本机 | `C:\Users\19635\AppData\Local\Temp\cetusprism-zcode-official-20261013-2`（2026-10-13 clone，`aac47556…`，ZCode 3.15.1，provider revision 31）；核验记录 `dev-docs/evidence/2026-10-13-zcode-source.md:4-10` |
| 0.9 | 智能体团队：**群聊无**、选定模型**有**、模式范围**只有枚举无范围**、驻留复用**无**、档案**无** | 见 §4.1 逐项判定 |
| 0.10 | 团队成员身份只存在于 Lead Session 日志，成员名一次性占用 | `packages/experimental/agent-team/src/types.ts:53`（`TeamMemberPhase` 无 dormant）、`src/roster.ts:337-339`（`TEAM_MEMBER_NAME_TAKEN`）、`src/README.md:75,221` |

### 0.11 本轮已修：csu 上游 400 `Unexpected message role`

- **现象**：任何推理模型请求返回 `400 invalid_request_error "Unexpected message role."`。
- **根因**：pi-ai 对推理模型把 system prompt 发成 `developer` role；`supportsDeveloperRole`
  的默认检测只认少数已知厂商，`api.chat.csu.edu.cn` 不在其中 → 被当成 OpenAI 本身 → 发
  `developer`。CSU 网关（响应体带 `reasoning` / `token_ids` / `kv_transfer_params`，是 SGLang
  形态）只认 `system`。
- **直连实测**（4 组，`POST https://api.chat.csu.edu.cn/v1/chat/completions`）：

  | role | `reasoning_effort` | 结果 |
  |---|---|---|
  | `developer` | `xhigh` | **400** `Unexpected message role.` |
  | `system` | `xhigh` | **200**，reasoning_tokens=23 |
  | `system` | 无 | 200 |
  | `developer` | 无 | **400** |

  唯一变量是 role，与档位无关。
- **DSH 端到端 A/B**（安装态 `bin.js --profile headless --patch <overlay>`，同一模型
  `csu/Qwen3.8-Flash-Next` + 档位 `xhigh`）：

  | overlay | 结果 |
  |---|---|
  | 无 `compat` | `dsh: INVALID_REQUEST: 400 {"message":"Unexpected message role."…}`，exit 1 |
  | `compat.supportsDeveloperRole: false` | 正常 reasoning + 回答 `OK`，**exit 0** |

- **落地**：用户 profile `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml` 的 `csu` provider
  增加 `compat.supportsDeveloperRole: false`（备份 `cordis.patch.yml.bak-20261022-1955`）。
  **运行中的 App 需重启才加载新 profile。**
- **仓库侧缺口**：DSH 已支持这个开关（`packages/llm/llm-pi-ai/src/config.ts:127,333`；
  回归用例 `packages/llm/llm-pi-ai/tests/catalog.spec.ts:872-884,1013-1029`），但**错误呈现层
  不会把这条 400 翻译成可行动提示**。见 §2.3。

---

## 1. S1 · 执行后端与预设搬进 composer

### 1.1 目标

新建会话时能选「用哪套预设（标准模式等）」与「用哪个执行后端（DSH / Pi / ZCode）」，两个
控件与 computer use 抢前台开关、模型选择器处在**同一控制行**，用户在输入框旁就能改。

### 1.2 行为契约

| 条款 | 内容 |
|---|---|
| S1.1 | composer 工具行新增两个会话级单座槽位：`conversation.input.agentPreset`、`conversation.input.agentBackend`，owner 均为 `InputControlOwnerProps`（与 `conversation.input.permission` / `conversation.input.plan` 同型）。 |
| S1.2 | 渲染顺序：`permission` → `computerDelivery` → `agentPreset` → `agentBackend` → `plan` → （既有 `left` / `model` / `activity` / `right` 位置不变）。预设与后端相邻，因为二者都是「这次会话用什么跑」的同一决定；权限类在前、运行类在后。`computerDelivery` 补上渲染点后与前两者同行（此前它只有声明没有渲染）。 |
| S1.3 | **hero 区的两个 chip 移除**，不在两处同时提供同一设置。hero 只保留会话头部的只读标签（`conversation.session.header.actions`，`ui-agent-preset/src/client/index.ts:195-202`）。 |
| S1.4 | 槽位 scope 由 `session-maybe` 改为 `session`：composer 必然有会话，且后端目录是部署事实、预设选择是会话事实。blank session 也是会话，`scope: 'session'` 成立。 |
| S1.5 | 行为不变的部分：预设选择器绑定到 blank session 的机制（`seat-store.ts` 的 `AgentPresetSeatController`）、后端目录的「装不上就可见但拒绝」语义（`backend-store.ts`）全部保留，只换槽位与位置。 |
| S1.6 | 「选了新会话默认值」这一动作仍只在设置区（`AgentPresetSection`，`ui-agent-preset/src/client/index.ts:248-255`）——composer 只做本次会话的选择，不做默认值的编辑，避免同一字段两个入口。 |
| S1.7 | 窄屏降级：预设 chip 文本可折叠为图标（复用 `conversation.input.model` 的 `--dsh-composer-model-text-display` 机制，`slots.ts:222-227`）。 |
| S1.8 | **迁移带出的行为变更（必须显式）**：hero 的 chip 只服务于「下一个会话」，对一个已经开始的会话，旧代码在客户端就静默丢弃这次选择（`seat-store.ts` 的 `apply()` 里 `!session.blank` → `clearStage()` 直接 return），chip 标签却已经先跳到新选择上，等于**说谎**。composer 的 chip 服务的是「当前会话」，因此显式选择必须交给 Host 裁决：`select()` 走 `apply(asked=true)`，已开始会话的切换会被 Host 以 `already started` 拒绝，拒绝原因由 Toast 播报，标签回落到会话真正运行的预设。无人主动触发的 stage（会话列表变动带来的被动 apply）仍然静默丢弃，不去打扰 Host。 |

### 1.3 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/client/ui-conversation/src/client/contract/slots.ts` | 新增两个 `conversation.input.*` 槽位声明；删除 `conversation.hero.agentPreset` / `conversation.hero.agentBackend` 声明与 `SlotFactoryMap` 里的对应项；删除 `HeroAgentPresetOwnerProps` / `HeroAgentBackendOwnerProps`；`ComposerBarProps` 的 `PropsRenderSlots` 联合补两个新槽位 |
| 2 | `packages/client/ui-conversation/src/client/apply.ts` | `conversation.composer.bar` 的 children 补两个新槽位；删除 `conversation.content` 的两个 hero child 声明 |
| 3 | `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | `css.modes` 容器内插入三个 `renderSlot`（`computerDelivery` + 两个新槽位） |
| 4 | `packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx` | 删除 hero 工作区行里的两个 `renderSlot`（hero 不再提供这两个入口） |
| 5 | `packages/client/ui-agent-preset/src/client/index.ts` | 两个 `slots.register` 的 `name` 由 `conversation.hero.*` 改为 `conversation.input.*`；文件头注释与 `apply` 注释同步 |
| 6 | `packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx` / `AgentBackendSeat.tsx` | `PropsRuntime` 指向新槽位；`sessionId` 由可选变为必填（`session` scope），保留信息读取改为按 sessionId 显式取；注释与 Toast 锚点说明同步。**几何不变**——本来就是 28px 紧凑 chip，label 可省略号截断 |
| 7 | `packages/client/ui-agent-preset/src/client/seat-store.ts` | `apply()` 增加 `asked` 参数，显式选择交给 Host 裁决（见 S1.8） |
| 8 | `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | 槽位派发集合与控制位集合补三项 |
| 9 | `packages/client/ui-agent-preset/tests/*.spec.ts` | 注册名断言从 `conversation.hero.*` 改为 `conversation.input.*`；「已开始会话」用例改为新契约（S1.8）并补一条「无人主动触发的 stage 仍静默丢弃」 |
| 10 | `packages/client/ui-agent-preset/README.md` / `.zh.md` / `README.i18n.yaml` | 「new-session chip」措辞改「composer 控制行」；补拒绝播报；英文与中文同步 + i18n 记录重录 |
| 11 | `docs/subsystems/slots.md` / `.zh.md` | 槽位树：删 `conversation.hero.agentPreset`，`conversation.composer.bar` 下补三项 |
| 12 | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | **生成物**：`pnpm run gen-client-catalog` 重新生成，不手改 |
| 13 | `packages/client/ui-conversation/README.md` / `.zh.md` | **无需改动**：该 README 不枚举工具行槽位表 |
| 14 | `packages/client/ui-computer-foreground/README.md` / `.zh.md` | **无需改动**：其「输入区工具行中的会话级单座槽位」描述此前与实际不符（无渲染点），本轮补上渲染点后描述才成立 |

### 1.4 验收

- `vitest packages/client/ui-agent-preset packages/client/ui-conversation`：除 3 条**基线既有**失败外全绿。
  - 基线既有失败（`packages/client/ui-conversation/tests/skeleton.client.spec.tsx`）：hero 标题在品牌改名后
    已是 `CetusPrism`，三处用例仍断言旧文案 `Into the Unknown` / `探索未至之境`。
    **已用 `git stash` 对照确认在改动前的 HEAD 上同样失败**，与本次迁移无关。
- 断言 composer 工具行同时出现预设 chip、后端 chip 与抢前台 chip，且 hero 区不再出现前两者。
- 断言 computer use 抢前台 chip 仍在同一行且位置未被挤掉（`ui-computer-foreground` 的
  `apply.client.spec.ts` 注册断言不变）。

---

## 2. S2 · 推理强度档位：定位、声明与实测

### 2.1 回答「推理强度探针在哪」

**CetusPrism 没有自动探针。** 现状是三条并行的东西，被同一个词混在一起：

| 层 | 位置 | 作用 |
|---|---|---|
| 声明（UI） | `packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx`；设置 → 模型 → 某一行 → 「推理强度」 | 三选一：不声明 / 非推理模型 / 声明档位；选「声明档位」后勾选具体档位 |
| 声明（配置） | provider 配置里的 `reasoningEfforts`，例如 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml` 的 `csu` → `models[].reasoningEfforts` | `off: null` 表示「关（不发思考参数）」，其余档位填自己的线上拼写 |
| 发现工具 | `packages/subagent/tool-subagent/src/list-models.ts` | 子智能体侧列出「本 scope 可用的模型 → 档位」，是**读取已声明的**，不是探测 |

所以「档位对不对」只能靠**声明 + 实测**，没有探针替你确认上游收不收某个档位。

### 2.2 规格：档位必须是「实测 + 声明」两条腿

| 条款 | 内容 |
|---|---|
| S2.1 | 档位声明的线上拼写必须来自**该端点实测**的结果，不照抄别家。本仓已验证 CSU 接受 `xhigh`（直连实测 200，reasoning_tokens=23）。 |
| S2.2 | `off: null` 与「不声明」是两种语义：`off` 显式声明该模型支持「不发思考参数」；不声明表示继承目录默认值。UI 的三选一必须保持这个区分（`ModelReasoningEfforts.tsx:24-31`）。 |
| S2.3 | 模型列表里的档位发现工具只显示**已声明**的档位；未声明的模型不提供档位选择，而不是提供一个会失败的猜测值。 |
| S2.4 | 档位校验是**白名单**语义：所选档位必须落在「模型广告过 ∩ Team 允许 ∩ Host 允许」三层交集内（`packages/experimental/agent-team/src/roster.ts:285-319`）。 |

### 2.3 规格：把 400 变成可行动提示

S0.11 的 400 在界面上只显示原始 JSON。规格要求：

| 条款 | 内容 |
|---|---|
| S2.5 | LLM 错误分类新增一类 `upstream_rejects_request`（或复用既有「参数不被上游接受」类目），命中 `invalid_request_error` + 消息含 `Unexpected message role` 时，错误文案指向「该端点不接受 `developer` role，请在该 provider 的 `compat` 下设 `supportsDeveloperRole: false`」。 |
| S2.6 | 提示必须带**具体可执行的改法**（provider id + 字段名 + 值），不是「请检查配置」。 |
| S2.7 | 文案只在**该端点确实不收 `developer`** 时出现；同一条 400 若来自别的参数问题，不得误导。 |

> 实现锚点：仓库现有错误分类在 `packages/llm/llm-deepseek/` 与 `packages/llm/llm/src/`，
> 具体落点待实施时确认；本条只定行为。

---

## 3. S3 · ZCode 执行后端的 agent loop 对齐口径

### 3.1 冲突声明

用户要求「ZCode 模式必须完全一致（照搬 ZCode 源码的 agent loop）」，与本仓既有规格
`dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:84`（「不建立平行 Agent loop」、
`:50`「不复制第二套 Agent loop」）**直接冲突**。既有规格的理由是：

1. 复制第二套 Agent loop 会与官方 Agent / Session / LLM 接口分叉，双份实现要各自跟随上游；
2. 既有契约要求「任何模型可见状态必须进入 Session 日志，遵守 `model-visible ⟺ logged`」
   （同文件 `:49`），平行 loop 会绕开这条不变量；
3. 官方源码是 Apache-2.0 的独立项目，逐行搬运会引入持续的同步义务与许可声明义务。

因此本文把「完全一致」重新定义为**可判定、可验收的一致性**：

### 3.2 对齐口径（规格）

| 条款 | 内容 |
|---|---|
| S3.1 | **对照源**：本机 ZCode 3.15.1 快照 `C:\Users\19635\AppData\Local\Temp\cetusprism-zcode-official-20261013-2`（commit `aac47556…`，provider revision 31）。快照的 `.git` 已清理，比对以文件内容为准。 |
| S3.2 | **对齐维度**（逐点比对，产出差异表）：消息序列与 role 构造；工具调用循环与并行度；上下文压缩/截断；停止条件（轮数/token/工具数）；思考参数传递；错误与重试。 |
| S3.3 | **一致性判定分三类**：语义等价 / 有差异（列差异与影响）/ 本仓无对应实现。**「语义等价」是验收口径**，不要求逐行同形。 |
| S3.4 | **不得照搬的部分**：ZCode 的账号配置、订阅网关地址、授权头、运行时路径、私有参数一律不进本仓（同文件 `:15,39`）；模型容量与档位以用户显式配置为准，不继承官方服务的容量（同文件 `:15`）。 |
| S3.5 | 若某维度确需**逐行同形**才能保证 GLM 效果，则该维度记为「需要上游同形」，并同时记录：为什么语义等价不足、照搬后的同步义务、以及它会撞上哪条既有不变量。**该记录是决策依据，不是自动授权。** |
| S3.6 | 实机证据要求：端点未提供真实凭据时，本地回放只能证明出站请求与会话回放，**不能证明真实 GLM 效果**（沿用同文件 `:15`）。因此「GLM 发挥最大作用」这一验收项**需要真实 GLM 端点凭据**，否则只能标为未验证。 |

### 3.3 交付物

`dev-docs/2026-10-22-zcode-agentloop-parity.md`：S3.2 六个维度的逐点对照表，每格带
`上游文件:行号` 与 `本仓文件:行号`；结尾给出差异清单与「需要上游同形」清单。

---

## 4. S4 · 智能体团队升级

### 4.1 现状逐项判定（基于源码核验）

| 目标 | 判定 | 证据 |
|---|---|---|
| 团队 + 群聊 | **部分** | 有持久邮箱与共享任务板；**无群聊**：无 room/channel/broadcast 概念，`send_message` 严格单目标（`agent-team/src/mailbox.ts:121` 禁自发；`src/types.ts:160-166` `targetId` 单值） |
| 选定模型 | **已实现** | `agent-team/src/types.ts:9-14,56-61`；`src/roster.ts:411-443` 路由解析；`:285-319` 三层校验；`:348-362` 落到子进程；`tool-agent-team/src/index.ts:294-305` 工具参数 |
| 选定模型有模式范围 | **部分** | 只有**精确枚举**：单档位 id 校验（`roster.ts:311-319`）、Team 级模型集合（`types.ts:195-198`）、Host 级集合（`tool-subagent/src/model-selection-settings.ts:36-58`）。**无范围语义**（无区间、无档位集合包）、**无后端范围**、**无 preset 范围** |
| 长期驻留 + 后续复用 | **未实现（Team 层）** | 无 `dormant` 态（`types.ts:53`）；成员名一次性占用（`roster.ts:337-339`）；工具集无 resume/reactivate（`tool-agent-team/src/index.ts:279-524` 共 9 个工具）。**底层已具备**：进程内驻留表 `subagent/src/continuation-activation.ts:176-178`、冷复原 descriptor `subagent/src/descriptor.ts:72-92` |
| 智能体信息的配置环境 | **部分** | 模型路由有独立配置位（`agent-team` 的 `allowedModels`/`defaultModel` 落在 profile patch，`agent-team-profile/cordis.patch.yml:20-27`）；**没有「智能体档案」实体**——名字、角色、默认模型、允许档位只能活在 Lead Session 日志里，跨会话不可寻址 |

### 4.2 实施顺序（依赖驱动）

调研给出的顺序理由成立，本规格采纳：**档案 → 驻留复用 → 模式范围 → 群聊**。
档案先行，因为成员名一次性占用必须先解除，「复用某智能体」才在语义上可能。

### 4.3 S4.1 智能体档案（Agent Profile）

| 条款 | 内容 |
|---|---|
| S4.1.1 | 新增档案实体 `AgentProfile`：`id`、`name`、`description`、`modelRoute`（provider/model/effort）、`allowedEfforts`、`preset`、`backend`。 |
| S4.1.2 | **存储位置遵循仓库既有范式**：档案**定义**走「Cordis 插件 Config + profile patch」范式（`packages/subagent/tool-subagent/src/model-selection-settings.ts:37-40` 的 `volatile()` 字段 → `packages/settings/settings/src/index.ts:302-350` → `packages/boot/config-editor/src/index.ts:34,87-137` 写 YAML），可版本化、可被用户审阅、可回滚。 |
| S4.1.3 | 档案**运行实例**继续走 Team Lead Session 日志（`agent-team/src/journal.ts:60-72`），遵守 `model-visible ⟺ logged` 不变量（`journal.ts:65-69`）。 |
| S4.1.4 | 档案可**按 id 跨会话寻址**（这正是「存智能体信息的配置环境」的落点），成员快照新增 `profileId` 引用（`types.ts:64-78`）。 |
| S4.1.5 | 成员名规则改为「档案已定义的名字」语义：**同一 Team 内名字唯一**（含失败成员，失败成员仍占用名字与名额——这是仓库既有契约，`team.spec.ts` 有用例钉住）。解除的是「跨 Team 的一次性占用」：档案是部署声明，可在任何 Team 再次实例化；同一 Team 内的复用走 S4.2 的 resume，而不是再起一个同名成员。 |
| S4.1.6 | 设置区新增档案卡片，读改路径复用既有 settings form 范式（参考 `packages/client/ui-settings-subagent/src/client/team-model-restriction-card-controller.ts`）。**本轮未实现（延后）**：档案的读写落点已由 S4.1.2 的 profile patch 满足，UI 卡片是可选的便利面，不阻塞其余三项。 |
| S4.1.7 | **档案字段与请求冲突的统一口径：档案声明的值优先，冲突即报 `TEAM_PROFILE_CONFLICT`，不做静默覆盖。** name 与 backend 一直如此（`roster.ts` 的档案冲突检查块）；`preset` 曾是全函数唯一的例外——请求 preset 静默覆盖档案 preset，同一 `profile_id` 因此可以被请求改写出另一种身份，与「同一档案按 id 跨会话寻址」（S4.1.4）的前提相抵触。2026-10-23 补齐为同一口径：**档案赢，冲突报错**。<br>**范围字段不适用此口径**：`allowedEfforts` 是「档案给范围、请求在范围内选」（档案范围在 Team 范围之上再收窄），与单值身份字段（name / backend / preset）不是一回事，不要套用。 |

### 4.4 S4.2 长期驻留与复用

| 条款 | 内容 |
|---|---|
| S4.2.1 | `TeamMemberPhase` 增 `dormant`（`types.ts:53`），语义：**档案已定义、进程内实例仍在或可冷复原、当前无回合执行**。`dormant` 不等于「未活跃」。 |
| S4.2.2 | 新增 `resumeTeammate(root, name)`：依据持久 descriptor（`subagent/src/descriptor.ts:72-92`）+ `continuation.ts` 的复原路径，把成员迁回 `active`；不可复原时返回结构化原因（如 `NOT_RESUMABLE`、`PERSISTENCE_UNAVAILABLE`，见 `continuation.ts:528-547`）。 |
| S4.2.3 | 工具层新增 `reactivate_teammate`；`list_agents`（`tool-agent-team/src/index.ts:365-373`）显示 `dormant` 态与「可复用」标识。 |
| S4.2.4 | 成员上限语义必须重新定义（`roster.ts:340-342`）：`maxMembers` 是否计入 dormant 成员——**计入**，否则「长期逗留」会绕过限额；但 `dormant` 不占并发槽位（并发池在 `continuation-activation.ts:41-56`，是另一条限额）。 |
| S4.2.5 | 新增事件 `team/member` 的 `dormant` 相位（不是新事件类型，是同一事件的新相位）；投影 `stateVersion` 递增 **5 → 6**（`projection.ts`，结构变更必须递增）。 |
| S4.2.6 | 复用路径必须走**既有冷恢复机制**（`subagent/src/continuation.ts` 对 continuable 子 Session 的冷复原，即 `ctx.subagents.sendMessage`），不得新开一条绕过持久日志的通道。**邮箱的普通投递不得冷复原成员**：dormant 成员不是可投递目标，其邮件留在持久队列里，等 `reactivate_teammate` 把它带回来再送达（与 §4「显式不做」第 2 条同义）。<br>2026-10-23 修订：原措辞要求复用路径走 `mailbox.ts` 的冷恢复投递，与「显式不做」第 2 条自相矛盾——投递链若冷复原成员，mail 就会唤醒 dormant 成员。实现原样即违反该条。裁决与取证见 `dev-docs/2026-10-23-chief-adjudication-memo.md` §三.B。 |

### 4.5 S4.3 模式范围

| 条款 | 内容 |
|---|---|
| S4.3.1 | 「范围」是三层独立的白名单，均为**集合语义**（不做区间）：`allowedEfforts`、`allowedBackends`、`allowedPresets`。 |
| S4.3.2 | `allowedEfforts` 的权威顺序：模型广告过的档位 ∩ Host 允许 ∩ Team 允许 ∩ 显式请求。既有三层交集（`roster.ts:285-319`）在此之上多一个「Team 允许集合」判定。 |
| S4.3.3 | `allowedBackends` 约束的是**执行后端**（`provider` 字段在 Team 里是 spawn/fork 后端，与 LLM provider 已被刻意分离，见 `types.ts:71-72`），不是 LLM provider。取值必须来自实际存在的后端目录，否则拒绝。 |
| S4.3.4 | `allowedPresets` 约束 Agent 预设；Team 侧当前完全不感知 preset（`packages/preset/agent-preset/src/index.ts` 无 Team 引用），需新增引用。 |
| S4.3.5 | 工具参数（`tool-agent-team/src/index.ts:285-306`）增可选 `backend` / `preset` / `effort`；`list_subagent_models` 的输出（`tool-subagent/src/list-models.ts:75-80`）标注每个模型是否落在允许范围内。 |
| S4.3.6 | UI：`team-model-restriction-card-controller.ts` 从「provider/model 两级」扩到「provider/model/档位/后端」四级。 |

### 4.6 S4.4 群聊

| 条款 | 内容 |
|---|---|
| S4.4.1 | 群聊是**广播**语义：一次投递到多个成员，成员都能读到；与点对点邮箱并列，不替代它。 |
| S4.4.2 | 投递复用既有可靠投递链：先落盘再投递（`mailbox.ts:140-147`）、按目标串行（`:192-209`）、目标去重（`:238-240,301-306`）、冷恢复重投（`:86-98`）。**不新建第二条投递链。** |
| S4.4.3 | 新增事件 `team/message/broadcast` 与 `team/message/broadcast-delivered`（载荷版本 1）；`TeamMessageSnapshot` 保留单目标快照，另加广播快照 `TeamBroadcastSnapshot`（`types.ts`）。投影状态新增 `broadcasts` 与 `broadcastDelivered` 两个集合，`stateVersion` 递增。 |
| S4.4.4 | 消息体上限、每目标待投递上限（`mailbox.ts:124-129` `TEAM_MAILBOX_FULL`、`:137-139` `TEAM_MESSAGE_TOO_LARGE`）对广播同样生效，按**展开后的目标数**计。 |
| S4.4.5 | 群消息**永不进模型对话面**（`journal.ts:65-69` 的 log-only 约束）。 |
| S4.4.6 | 决策前置：fork 保留上游已删除的 durable mailbox（上游 `“refactor(agent-team): send directly through Agent inbox steering” 重构` 改为直接 inbox steer），而广播依赖队列协议。**本规格选择保留 fork 的 mailbox 协议**，群聊叠加其上；与上游再同步时该语义冲突需登记在 `docs/UPSTREAM.alignment.json`。 |
| S4.4.7 | **目标顺序不承载语义**（2026-10-23 第二轮裁决并落地）：跨目标投递**逐目标独立尝试 + 聚合返回**。一个不可达目标（dormant 成员，或 `active` 但无 runtime 的成员）只让自己留在 `queued`、不落投递边，**不挡住同一次投递里的后续目标**——一个不可达成员不会让这次广播的其余目标一起挨饿。广播 `status` 仍是 `accepted`/`queued` 两值；持久化协议不动（持久记录、每目标投递边、投递前幂等检查、重复边防护全部不变），不丢消息。能补投积压广播的驱动**只有三个**：新点名该目标的广播、该目标复活、冷恢复；普通单播消息只过滤单播队列，**不**补投积压广播。 |

### 4.7 不变量（不得破坏）

沿用调研列出的 23 条，重点几条：

1. 同一 Agent scope 内工具名只能注册一次（`tool-subagent/src/list-models.ts:110-127`；回归用例 `tool-agent-team/tests/loader-composition.spec.ts:175`）。
2. 打包产物必须含该修复（`scripts/check-offline-pack.mjs:314-341`）。
3. 模型可选 ⇒ 必须同时有 durable policy + `list_subagent_models`（`tool-subagent/src/invariant.ts:19-41`）。
4. 成员名唯一（同一 Team 内）。
5. Team 事件 log-only。
6. 投影 `stateVersion` 每次结构变更递增。
7. 可续用子智能体必须有 session persistence + session query（`continuation.ts:528-547`）。
8. 销毁顺序：先关准入 → 等在途 → 释放直属子进程 → 释放投影（`agent-team/src/index.ts:197-206,350-365`）。

---

### 4.8 本轮实施结果（截至 2026-10-23）

| 子项 | 状态 | 落点 |
|---|---|---|
| S4.1 档案 | **已实现**（2026-10-23 补一处） | 新模块 `packages/experimental/agent-team/src/profile.ts`（`AgentProfileRegistry`）；配置项 `profiles`；`TeamMemberSnapshot.profileId` / `TeamMemberView.profileId` / `TeamMemberProjection.profileId`；`spawnTeammate({ profileId })` 走档案取名/描述/底座/路由，冲突报 `TEAM_PROFILE_CONFLICT`，未声明报 `TEAM_PROFILE_UNKNOWN`。**补**：档案字段的冲突口径补齐到 `preset`（见 S4.1.7）——档案 preset 优先，请求带不同 preset 报 `TEAM_PROFILE_CONFLICT`；此前请求静默覆盖档案，同一 `profile_id` 可被请求改写出另一种身份 |
| S4.2 驻留复用 | **已实现**（2026-10-23 补三处） | `TeamMemberPhase` 增 `dormant`；`roster.release()` / `roster.resume()`（resume 经 `ctx.subagents.sendMessage` 冷复原持久化子 Session）；投影允许 `active → dormant → active`；`stateVersion` 5 → 6。**补**：① 单播投递读目标相位，dormant 不冷复原（`mailbox.ts` `dispatchOnce`），dormant 成员的邮件留在持久队列等复活送达；② `resume()` 先记 `active` 再提交提示，失败回写 `dormant`——否则复活的成员在创建瞬间相位仍是 `dormant`，`tryMembership` 拒绝 → Team 工具不安装；③ resume 失败把失败原因写进成员行的 `error` 字段（此前只回写相位，原因只活在当次工具结果里，会话重启后无据可查），后续 resume 成功会清掉这条过期原因 |
| S4.3 模式范围 | **已实现**（2026-10-23 补一处） | 新模块 `src/range.ts`（`checkRanges`）；配置项 `allowedEfforts` / `allowedBackends` / `allowedPresets`；档案自身的 `allowedEfforts` 在 Team 限制之上再收窄；越界分别报 `TEAM_EFFORT_NOT_ALLOWED` / `TEAM_BACKEND_NOT_ALLOWED` / `TEAM_PRESET_NOT_ALLOWED`。**补**：`allowedBackends` 的取值还要过一遍「实际存在的后端目录」（`ctx.subagents.list()`，`roster.ts`），不在目录里的后端在**成员行创建之前**就被拒（`TEAM_BACKEND_NOT_AVAILABLE`）——此前它会先落一条 `provisioning` 成员行，再因 provider 找不到而失败成 `failed`，**失败成员照样占名字与名额** |
| S4.3.6 设置区四级卡片 | **延后** | 控制器仍停在 provider/model 两级（`packages/client/ui-settings-subagent/src/client/team-model-restriction-card-controller.ts`），未扩到「provider/model/档位/后端」四级。Team 侧的范围机制（`allowedEfforts` / `allowedBackends`）本身已实现并有守卫，卡片是可选便利面 |
| S4.4 群聊 | **已实现**（2026-10-23 补一处） | `mailbox.broadcast()`：一条持久广播记录 + 每目标一条投递边；复用既有邮箱链（先落盘、按目标串行、目标去重、冷恢复重投）；上限按展开后目标数计；新增事件 `team/message/broadcast` / `team/message/broadcast-delivered`。**补**：跨目标投递由「首个失败即返回」改为**逐目标独立尝试 + 聚合返回**，一个不可达目标不再挡住同一次投递里的后续目标（口径见 S4.4.7；三条验收断言钉在 `upgrade.spec.ts` 的「delivers a broadcast past an unreachable target in the same drive」） |
| 工具层 | **已实现** | `tool-agent-team` 新增 `list_agent_profiles` / `release_teammate` / `reactivate_teammate` / `broadcast_message`；`spawn_teammate` 增 `profile_id` / `preset` / `backend`；`list_agents` 输出带 `dormant` / `resumable` / `profile_id` / `preset` |
| 设置区档案卡片 | **延后** | 见 S4.1.6：profile patch 已提供「存智能体信息的配置环境」，UI 卡片是可选便利面 |

**未改动的既有契约**：成员名在同一 Team 内唯一（含失败成员）；`maxMembers` 计入 dormant 成员；Team 事件 log-only；
`model-visible ⟺ logged` 不变量；投递仍只有一条邮箱链。

**已知边界（本轮未解决，如实记录）**：

1. **preset 只被记录与校验，不被施加**：preset 是 Session 级编排（由用户在 composer 或 Host 侧选定），
   Team 侧无法替子会话改写编排。因此 `preset` 落在成员快照里并受 `allowedPresets` 约束，
   但真正让子会话跑在哪个 preset 上，仍由 Session 侧的 preset 选定权决定。
   **本轮取证确认这是有意的边界而非缺陷**：子 Agent 的 preset 由父级继承
   （`packages/subagent/subagent/src/child-agent.ts:205` 的 `composeFrom(childCtx, parent.ctx)`），
   `SubagentCapabilities`（`packages/subagent/subagent/src/types.ts:130-136`）只声明
   `toolFilter` 与 `persona` 两个 per-child 施加点，**没有** per-child preset；
   `ContinuableCreateRequest`（`types.ts:219-229`）同样只带 `sessionId` / `parent` / `signal`。
   团队走 continuable 路径（`packages/experimental/agent-team/src/roster.ts:513`），
   要按成员施加 preset 就必须在 subagent 层开新口子——那是**全仓共享包**改动，
   影响所有 DSH 会话，按工程纪律须按 preset/底座开关隔离，不属于本轮范围。
2. **dormant 成员不会被 `send_message` 唤醒**：消息照常入队并在其复原后送达（与离线成员同语义），
   唤醒动作只有 `reactivate_teammate`（它带一次任务）。
   **2026-10-23 补记**：这条此前只是登记的边界，实现并未满足——单播投递在目标运行时不在线时会走
   `steerHostSubagentPrompt`，而它在 activation 缺失时冷复原该成员，等于 mail 唤醒 dormant 成员。
   现已在投递链读相位拦截，并补了回归用例（`agent-team/tests/upgrade.spec.ts`、
   `tool-agent-team/tests/tool-team.spec.ts`）。
3. **`maxMembers` 计入 dormant 成员**（S4.2.4 的口径）：长期逗留不会绕过成员上限，
   但 dormant 不占并发槽位。
   **2026-10-23 补记**：这条此前只是登记的边界——实现确实计入（`release()` 只改相位、成员行保留，
   `roster.ts` 的 `state.members.length` 仍计入它），但**没有测试钉住**；现已补回归用例
   （`agent-team/tests/upgrade.spec.ts`「counts a dormant teammate against the member limit」）。
4. **`allowedPresets` 不与部署的 preset 目录对账**：Team 侧的 `allowedPresets` 是**自声明集合**，
   取值不与部署里真实存在的 preset 目录比对，因此写错的 preset id 会被**静默记录且不生效**
   （与边界 1 同源：preset 只被记录与校验，不被施加）。
   **2026-10-23 裁决：本轮不加目录校验**，理由有二——① 失真等级不对等：`allowedBackends` 拼错会走完
   provisioning 硬失败、失败成员占名字占名额（S4.3.3 的目录校验正是为此而立），而 preset 拼错的后果
   只是「成员行记了一个不生效的 id」，子会话实际跑继承预设；② 对账成本不匹配：preset 目录在另一个服务
   `AgentPresetRegistry`（`list()` 是异步），而 agent-team 的注入表不含它、`checkRanges` 是同步判定，
   要对账就得给实验包新开硬注入（装载顺序耦合）或者把校验异步穿透到 spawn 主链路。
   **配套**：`spawn_teammate` 的 `preset` 参数描述已补「须为部署声明过的 preset id」，避免模型自由编 id；
   Team 工具面目前没有「列出部署 preset」的入口（`list_agent_profiles` 只列档案），这一点一并记明。
   **未来触发条件**：若 preset 变为按成员施加（那需要动全仓共享的 subagent 层），目录对账即升格为必须项，
   须与施加点同轮落地。

---

## 5. 验收汇总

| 规格 | 验收方式 |
|---|---|
| S1 | `vitest packages/client/ui-agent-preset packages/client/ui-conversation` 全绿；composer 同时出现预设 chip 与后端 chip；hero 不再出现 |
| S2.1 | 设置 → 模型 → 某行的「推理强度」可见三选一与档位勾选；profile 中 `reasoningEfforts` 生效 |
| S2.5-2.7 | 对 `developer` role 拒绝的端点，错误文案给出 provider id + `compat.supportsDeveloperRole: false` 的具体改法 |
| S3 | `dev-docs/2026-10-22-zcode-agentloop-parity.md` 覆盖六个维度，每格带两侧 `文件:行号` |
| S4.1 | 档案落在 profile patch，可被设置区读改；跨会话按 id 寻址成功 |
| S4.2 | `dormant` 成员可被 `reactivate_teammate` 复活；成员上限计入 dormant |
| S4.3 | 越界的档位/后端/预设被拒绝且错误分类明确 |
| S4.4 | 广播消息被所有目标收到且去重生效；上限按展开后目标数计 |

**环境基线说明**：`check:node-compat` 现有 2 条失败均为环境基线（jsdom 缺 `ResizeObserver`、
Windows 无符号链接权限），与本规格无关。

---

## 6. 明确不做

- 不把 ZCode 官方源码 vendor 进本仓，不建立平行 Agent loop（沿用既有计划 `:84`）。
- 不读取、不复制、不写入 ZCode/Antigravity 的 credentials、runtime、privateConfig 或等价字段。
- 不把外部驱动安装到 CetusPrism，不自动 merge 或发布 release。
- 不因「档位」自动扩大端点上下文容量或开启未经支持的档位。
- 不在本规格内改动上游同步策略（`docs/UPSTREAM.alignment.json` 的登记只做增量）。
