# 第二轮裁决意见（S4 智能体团队升级：A/B/C 三问 + 补充 D/E 两问）

- 作者：智能体团队架构师（本文件为本 Bot 专属产出）
- 日期：2026-10-23
- 范围：第二轮三问（A：resume() 错误码拆分；B：档案 preset 与请求 preset 优先级；C：`allowedPresets` 是否对账真实 preset 目录），以及回归风险审查员重写稿（`dev-docs/2026-10-23-regression-risk-review.md`，`“docs(review): take the regression review's rewritten draft” 批次`）的补充两问（D：广播目标顺序的头阻塞语义；E：resume 失败原因折叠的 cause 钉子）。不重复首轮审查内容，不引用已收口项。
- 代码基线：`E:\Projects\CetusPrism` 分支 `release/v1.7.3`（本 Bot 本轮零代码改动、零 git 写操作；本文所有证据为本轮实读实跑所得）。
- 本轮验证命令（已验证）：`pnpm vitest run --config configs/vitest.config.ts packages/experimental/agent-team/tests/upgrade.spec.ts` → 1 file / 42 tests 全绿，exit 0（2026-10-23 04:43 实跑）。
- **基线更新（05:43 补记）**：A/B/C 作答后，首席已落 `“fix(agent-team): let the profile pin the preset, and keep the resume failure” 批次`（问题 B 的档案钉 preset + 问题 A 的 resume 失败原因落账）与 `第二轮裁决记录批次`（第二轮裁决记录）；本文件 A–C 章节保留作答时的原文与当时的行号，D/E 两章按**落地后的新基线**作答。同文件同命令复跑：1 file / 47 tests 全绿，exit 0（47 = 42 + 落地波新增 5 例）。A–C 章节中受该提交影响的行号（如 `park()` 从 :390-406 移至 :395-413）以 D/E 章引注的当前行号为准。

---

## 问题 A：`resume()` 失败要不要按底层原因拆分错误码？

**一句话结论：不拆。保留单一 `TEAM_MEMBER_NOT_RESUMABLE`，把补强做在「诊断落账」而不是第二个错误码上——而且"拆出 `PERSISTENCE_UNAVAILABLE`"这个前提本身在当前接线下不成立，resume 路径根本到不了那个错误。**

### 证据（已验证）

1. `resume()` 现状：先事务置 active（`roster.ts:349-362`），再 `ctx.subagents.sendMessage`（`roster.ts:366`）；失败 → `park()` 回写 dormant（`roster.ts:371`；`park` 定义 `roster.ts:390-406`，只翻相位、不写 error 字段）→ 抛单一 `TEAM_MEMBER_NOT_RESUMABLE`，把 `errorMessage(error)` 内嵌进消息（`roster.ts:373`），原始错误挂 `cause`（`roster.ts:375`）。
2. resume 链上实际能到达的底层错误只有两类（文件行号逐一核实）：
   - `NOT_RESUMABLE`：`continuation.ts:420`（observeSession 失败）、`:431`（无可续传描述符）、`:453`（materialize 失败包装）；
   - `CONTINUATION_UNAVAILABLE`：`continuation.ts:540-548`（`requireSessionQuery`），由 coldResume `continuation.ts:412` 使用。
3. **`PERSISTENCE_UNAVAILABLE` 从 resume 路径不可达**：它唯一产地是 `requirePersistence()`（`continuation.ts:533`，函数体 `528-537`），唯一调用点在 `startContinuable()` 内（`continuation.ts:108`，定义 `:104`）；而 subagent 服务里 `startContinuable` 的调用方只有 Team 的 spawn 路径（`roster.ts:558`）。`sendMessage → deliverFollowup（continuation.ts:298-301）→ coldResume（continuation.ts:406-456）`整条链不含 `startContinuable`。
4. 错误到模型的呈现链（已验证）：`TeamError` 与 `SubagentError` 均继承 `HarnessError`（`agent-team/src/error.ts`；`subagent/subagent/src/error.ts:10-14`）；工具层 `toolErrorResult`（`core/tools/src/index.ts:1909-1915`）把错误渲染为 `Error: <message>` 文本 + `error.info = { name, code }`（`errorInfo`，`core/tools/src/index.ts:661-668`）。**info 只取最外层错误的 code**；底层原因正是靠 `roster.ts:373` 的消息内嵌才到达模型，`cause` 不序列化进工具结果。
5. 契约已钉死单一 code：`upgrade.spec.ts:447` 断言 `code: 'TEAM_MEMBER_NOT_RESUMABLE'`。
6. `control.ts:72,90` 的 `NOT_RESUMABLE` / `PERSISTENCE_UNAVAILABLE` 映射属于 subagent 远程控制面契约；Team 走进程内路径，不经过该映射表。

### 理由

- 错误的消费者是 Lead 模型（经 `toolErrorResult`），不是程序。拆码只对「按原因分叉的后续逻辑」有价值，而这里不存在分叉：无论 `CONTINUATION_UNAVAILABLE` 还是 `NOT_RESUMABLE`，处置都是同一条——park 回写 + 报因给 Lead。决策有用的信息（底层原因）已经以文本形式在消息里。
- "拆出 `PERSISTENCE_UNAVAILABLE`" 是以提示词措辞为前提的伪差距：该错误在 resume 链上结构性不可达（证据 3）。若未来 coldResume 改为依赖持久化，届时再评估，现在拆是给不可达路径立契约。
- 真正的缺口是**失败原因不留痕**：spawn 失败会落账 `error: errorMessage(error)` 进成员行（`roster.ts:575-579`，投影 schema 已有 error 字段：`projection.ts:436`、`:475`），而 resume 失败只回写相位（`roster.ts:371` → `:390-406`），原因只活在当次工具结果里，会话重启后无据可查。

### 风险 / 遗漏

- 首选补强（可延后、非本轮必改）：resume 失败 park 回写时把 `errorMessage(error)` 一并写入成员行 `error` 字段。投影转换边已允许 active→dormant（`projection.ts:325-330`），schema 无需扩。
- 挂账残留（首席备忘录已登记，维持）：`park()` 吞掉 journal 写回失败（`roster.ts:401-405`）会让成员停在 active 而无 runtime，下一次 resume 报 `TEAM_MEMBER_NOT_FOUND`（`roster.ts:342-343`）——误导性码来自 park 失败，不是来自错误码设计。
- 未验证项：`sendMessage` 因邮箱挂起上限/邻接拒绝而抛错的具体分支未逐条跑（`subagent/src/index.ts:276-277` 仅注释声明）；即便命中，也会被 `roster.ts:372-376` 同样折叠为 `TEAM_MEMBER_NOT_RESUMABLE`，"成员未被复活"的语义仍成立。

---

## 问题 B：档案 preset 与请求 preset 冲突时，谁赢？

**一句话结论：档案赢，冲突报错——`roster.ts:466` 现在是 `request.preset ?? profile?.preset`（请求静默覆盖档案），这是全函数里唯一不遵循「档案声明 + 冲突报 `TEAM_PROFILE_CONFLICT`」口径的档案字段，应改为档案优先并在冲突时报 `TEAM_PROFILE_CONFLICT`。**

### 证据（已验证）

1. 现状：`roster.ts:466` `const preset = request.preset ?? profile?.preset`，无冲突检查。
2. 同一函数内其它档案字段的既有口径：
   - name：请求与档案名冲突 → `TEAM_PROFILE_CONFLICT`（`roster.ts:450-455`）；
   - backend：取值档案优先（`roster.ts:465` `profile?.backend ?? request.provider`）且显式冲突 → `TEAM_PROFILE_CONFLICT`（`roster.ts:456-461`）；
   - 模型路由：注释明言「A declared profile pins the route; a request may only narrow it with the same provider and model」，冲突 → `TEAM_PROFILE_CONFLICT`（`roster.ts:628-639`）；
   - allowedEfforts：档案范围在 Team 之上再收窄（`roster.ts:469-475`）。
3. 契约文本把档案定位为可复用身份：`types.ts:313-314`（"the profile owns the name, description, and route"）；工具描述同口径（`tool-agent-team/src/index.ts:374`）；spec S4.1.1 将 `preset` 列为档案实体字段（spec :206）；preset 持久落在成员行（`types.ts:116-117`，写入 `roster.ts:536`）。
4. 测试现状：preset 相关用例只钉了「range 内外」与「空 range 放行」（`upgrade.spec.ts:596-607`、`:610-627`），没有任何用例钉「请求覆盖档案 preset」——改语义不破坏现有契约（本轮 grep 全部 preset 断言核实）。

### 理由

- 同一 `profile_id` 被不同 Team 实例化时应产出同一身份（spec S4.1.4 跨会话按 id 寻址的前提）；现在请求带一个不同 preset 就能静默改变成员身份且不留任何冲突痕迹，与 name/backend/route 的冲突口径不一致，属实现缝隙而非有意设计——没有文档、测试或注释声明过"请求 preset 覆盖档案 preset"。
- 落法（建议，属 S4.1/S4.3 正文修订，不进 §4.8）：spawnAdmitted 的档案冲突检查块（`roster.ts:449-462`）增加一条 preset 冲突分支；`roster.ts:466` 改为档案优先取值（`profile?.preset ?? request.preset`，配合冲突检查后两者仅在未冲突时可达同一结果）。
- 与 §4.8 / 已知边界 #1 的关系：那条边界讲的是「preset 记录了但不施加到子会话」（首轮已裁定有意，本轮不重议）；本题只决定成员行**记录哪个声明值**、冲突是否报错，两者正交，不要混写。

### 风险 / 遗漏

- 行为变更风险：依赖"请求 preset 覆盖档案"的现存调用方会从静默成功变为 `TEAM_PROFILE_CONFLICT`。已验证无测试钉旧行为；但若有真实部署依赖此覆盖，需要迁移说明（README 补一句即可）。
- 语义边界要写清：effort 是「档案给范围、请求在范围内选」（`roster.ts:469-475`），preset 是单值身份字段，不要套用范围语义。
- 未验证项：真实部署中是否存在依赖覆盖行为的 profile patch（仓库内未发现，线上配置无法从本仓验证）。

---

## 问题 C：`allowedPresets` 要不要对账真实 preset 目录？

**一句话结论：本轮按「登记为已知边界」处理，不加目录对账；但要把边界写实——Team 侧的 allowedPresets 是自声明集合，不与部署 preset 目录对账。若未来 preset 真正按成员生效，则必须补上目录校验（镜像 S4.3.3 的后端口径）。**

### 证据

- 已验证——目录存在且可枚举：`AgentPresetRegistry`（`agent-preset-registry/src/index.ts:89`，挂为 `Context.agentPresets`，`:62-66`）；预设由 `agent-preset` 插件注册（`agent-preset/src/index.ts:27-29` 调 `register`，registry 侧 `:142`）；有异步可枚举读 API `async list(): Promise<AgentPreset[]>`（`:238`，行内含 broken 诊断）与 `async resolve(id?)`（`:265`）。
- 已验证：agent-team 的服务注入表是 `['agents','sessions','sessionPersistence','sessionProjections','subagents','llm']`（`agent-team/src/index.ts:155`），不含 `agentPresets`。
- 后端目录校验先例及其成立条件：`TEAM_BACKEND_NOT_AVAILABLE` 在成员行创建前对 `ctx.subagents.list()` 对账（`roster.ts:485-490`，动机注释 `:481-484`），spec S4.3.3 明文「取值必须来自实际存在的后端目录，否则拒绝」（spec :230）。该检查可行，因为它复用**同一注入服务、同步 in-process 列表**。
- preset 的影响等级（首轮已裁定的有意边界，此处只引用不复议）：preset 仅记录与校验、不施加，子会话预设继承父级（spec 已知边界 #1，spec :278-288；`child-agent.ts:205`、`SubagentCapabilities` `types.ts:130-136`、`ContinuableCreateRequest` `types.ts:219-229`）。

### 理由

- 两类拼错的失真等级不同：backend 拼错会走完 provisioning 硬失败、失败成员占名字占名额（正是 `“fix(agent-team): refuse an execution backend the deployment does not have” 修复` 关闭的形态）；preset 拼错的后果只是「成员行记录了一个不生效的 id」，子会话实际跑继承预设——软失真，且已有边界条款覆盖其语义。
- 对账成本不匹配：preset 目录在另一个服务（`AgentPresetRegistry`，`list()` 为异步 `:238`），而 agent-team 的 `checkRanges` 是同步集合判定（`range.ts:33-59`）；要么给实验包新开对 preset-registry 的硬注入（装载顺序耦合、需先验证所有部署形态下 agentPresets 必在——**未验证**），要么把校验改异步穿透到 spawn 主链路。为一个当前不生效的记录值付出跨包耦合，收益不成立。
- 但边界必须从「无人提过」变成「明文登记」：在 spec「已知边界」追加一条（与 #1 并列）：allowedPresets 为 Team 自声明集合，不与部署 preset 目录对账，未知 preset id 静默记录且不生效；同时 `spawn_teammate` 的 preset 参数描述应补一句「须为部署声明的 preset id」（`tool-agent-team/src/index.ts:411` 现在只提 range，未提目录），避免模型自由编 id。

### 风险 / 遗漏

- 未来若 preset 变为 per-child 可施加（spec 已注明那需要动全仓共享的 subagent 层，spec :287-288），目录对账即成为必须项，应与施加点同轮落地（届时错误码可沿用 `TEAM_PRESET_NOT_ALLOWED` 或新增 `TEAM_PRESET_NOT_AVAILABLE`，对齐 backend 的两段语义）。
- 模型侧可用性缺口：Team 工具面没有「列出部署 preset」的入口（`list_agent_profiles` 只列档案，`tool-agent-team/src/index.ts:525-533`），模型无从校验自己填的 preset id；登记边界时一并写明。
- 未验证项：agentPresets 与 agent-team 在全部部署形态中的共在性（上列）；Team 侧异步调用 registry 的远端协议开销（`AgentPresetRegistry extends TypertRemoteService`，`agent-preset-registry/src/index.ts:89`——未验证）。

---

## 补充问题 D：广播目标顺序的「头阻塞」语义

**一句话结论：外层短路不是"按目标本地队列序"不变量本身——那条不变量由按目标串行化（`serializeDispatch`）加逐目标积压补投（`dispatchBroadcastThrough`）承载；建议先改实现（跨目标短路改为逐目标独立尝试、聚合返回）再钉新语义。这个改动不触碰持久化协议，对"不丢消息"零影响；而现状语义在新 S4 世界里有一个真实的活性代价。**

### 证据（已验证）

1. 投递栈三层：`tryDispatchBroadcast`（`mailbox.ts:261-281`，inFlight 去重）→ `dispatchBroadcastAdmitted`（:290-304，按 `targetIds` 顺序，**首个失败即 `return false`**，:301）→ `serializeDispatch`（:490-505，按 targetId 串行）→ `dispatchBroadcastThrough`（:314-340，每次投递把该目标**积压的全部广播**按持久队列序补投到被请求条目为止）。
2. 「按目标本地队列序」的真正承载者是后两层：`serializeDispatch`（:490-505）按 targetId 串行化投递，`dispatchBroadcastThrough`（:320-338）逐目标补投积压。外层 for 的顺序不承载任何排序不变量——跨目标本无顺序契约。
3. 失败形状：`deliverBroadcast` 对无 runtime 目标走 `target === undefined` 分支（`mailbox.ts:373-380`），`persistedTargetRecorded` 查不到 → 返回 false，边不落、消息保持 queued（warn：`mailbox.ts:385`）。dormant 成员（合法目标，`resolveReachableMember` 只接受 active/dormant，`roster.ts:101`）正好命中此分支。
4. 既有测试只钉了「失败目标**之前**的目标保留边」：`upgrade.spec.ts:898-941`（targetIds `['alpha','beta']`、beta 末位 released → alpha 保留边、status queued、resume(beta) 后只补投 beta）。**失败目标之后的 live 目标**无任何用例；这正是重写稿缺口 4（:89）与待确认问题 1（:114）的空白。
5. 补投驱动清单（已验证）：(a) 成员启动/复活 `recoverFor`（`mailbox.ts:89-111`，重投该成员的全部积压消息与广播）；(b) 新广播 admission 时对每个目标走 `dispatchBroadcastThrough`，把该目标积压的**全部**广播一并补投（:320-338——新广播 B2 点名 live 时，积压的 B1 会被一并送到 live）；(c) 没有定时器/周期驱动。
6. **传染性（关键）**：starved 目标自己的恢复也被头阻塞——`recoverFor(live)`（`mailbox.ts:103-110`）对点名 live 的积压广播调 `tryDispatchBroadcast`，而它仍从 `targetIds` 头部开始迭代（:295），撞上头部 ghost 依旧提前返回。live 的自救通道只有两条：头部目标复活（其恢复把头部送完、循环继续到 live），或任一**新广播**点名 live。
7. 重写稿 :89 的验收措辞有一处与实现不符：「后续任一新驱动（如再发一条普通消息）才补投」——普通单播的驱动链（`tryDispatchAdmitted` → `dispatchThrough`，`mailbox.ts:508-528`）只过滤 `state.messages` 队列，**不触碰积压广播**。能补投积压广播的驱动是：新广播点名该目标（证据 5b）、头部目标复活、或进程重启后的冷恢复。

### 裁决 + 理由

- **裁决：这不是"按目标本地队列序"的有意不变量，而是外层短路的实现缝隙；建议先改实现再钉新语义（逐目标独立尝试、聚合返回）。**
- 依据一：队列序不变量由 `serializeDispatch` + `dispatchBroadcastThrough` 承载（证据 1），与外层是否短路无关。把 `if (!delivered) return false`（:301）改为聚合（`allDelivered &&= delivered`，循环后返回），每个目标仍按各自本地队列序投递、失败目标保持 queued——**语义只多不少**。
- 依据二：与 spec 的意图一致。S4.4 宣称的是"每目标一条投递边"（spec :269；投影层对重复边直接抛错，`projection.ts:404-411`），不是"目标间串行、遇阻全停"。头阻塞下 `[dormant, live]` 里 live 的等待时长取决于别人的复活时机，这不是广播原语该有的语义。
- 现状可钉但代价真实：生产中能坐上"头部"的只有 dormant（合法）或「active 无 runtime」——后者正是备忘录 :168 挂账的 park 吞错残留形态（`roster.ts:411-413`），它会成为永不解决的头部，压制其后所有目标直到下次新广播点名。若首席决定本轮零代码，钉现状必须如实写"live 本次驱动收不到、要等新广播点名或头部复活"，不能按重写稿 :89 的"普通消息补投"写（不成立）。
- 对「不丢消息」的影响：**两种语义都不丢，改动不触碰持久化协议**。durable broadcast 记录、per-target 边、投递前 `targetRecorded` 幂等检查（`mailbox.ts:358`）、`markBroadcastDelivered` 的重复边防护（:419-420）全部不变。差异只在"谁在本驱动内被投递"——所以这个选择是时延/公平性取舍，不碰消息丢失性质；改实现不会让"不丢"变差，只会让"送达更及时"。

### 风险 / 遗漏

- 钉新语义的用例要同时断言三个性质：live 本进程本次驱动内收到（新语义）；dormant 头部目标保持 queued、边不落；头部复活后只补投头部（live 不重复投）。红→绿可逆：撤掉聚合改动（恢复短路）转红。
- 若维持现状：README/spec 需明写「广播按 targetIds 顺序投递，首个不可达目标会阻断其后目标在本驱动内的送达，直至该目标复活或新广播点名」——把现状从隐式行为升格为登记语义，避免调度缝改动导致静默漂移。
- 未验证项：`trackDispatch`/`inFlightMessages` 在聚合实现下的簿记等价性（本 Bot 未写实现验证，属建议落法时的实现者职责）；跨目标聚合失败时 `status: 'queued'` 的既有语义不变（`broadcast` :250 的 accepted/queued 二值不变，聚合只影响内部循环）。

---

## 补充问题 E：resume 失败的原因折叠——要不要钉「cause 可观测」？

**一句话结论：拆码与补诊断不是二选一——首席已按问题 A 的裁决落地"单码 + 原因落账"（`“fix(agent-team): let the profile pin the preset, and keep the resume failure” 批次`），现在唯一还开着的钉子是"抛出的 `TeamError.cause` 保留原始错误"；补一条断言即可，红→绿可逆。若拆码与保留 cause 只能取一：选保留 cause，不拆码。**

### 证据

1. 已落地（已验证，当前源码 + git log）：`park()` 增加 `reason` 参数并把原因写进成员行 `error`（`roster.ts:395`、`:403` `...reason === undefined ? {} : { error: reason }`）；resume 失败传 `errorMessage(error)`（`roster.ts:375`）；成功复活时剥离陈旧 failure（`roster.ts:355-358`）。新用例钉住：`upgrade.spec.ts:522-539`（成行 error）、`:541-559`（复活清陈因）。
2. 单码与 cause 仍在（已验证）：`roster.ts:377-379`——单一 `TEAM_MEMBER_NOT_RESUMABLE` + `{ cause: error }`。`PERSISTENCE_UNAVAILABLE` 仍从 resume 路径结构性不可达（`requirePersistence` 唯一调用点 `continuation.ts:108`，spawn 专属），重写稿 :88 里"含 `PERSISTENCE_UNAVAILABLE` 类"的前提与首轮 A 题取证一致地不成立。
3. **cause 目前零断言**（已验证）：grep `\.cause|cause:` 在 agent-team 全部测试只命中 `team.spec.ts:1754-1762` 的 `lifecycle.settle` 包装用例，与 resume 无关。重写稿 :88 要求的「cause 可观测」钉子仍缺。
4. 信息通道对照（已验证）：抛出的 `TeamError` 消息内嵌底层文案（:377）、`cause` 保留原始对象（:379）、durable 行落 `errorMessage` 文案（:403）。**cause 是唯一保留原始错误类型与 code 的通道**——成员行 `error` 只存 `errorMessage()` 文本，`cause` 上才有 `SubagentError` 的 name/code（如 observeSession 失败 → `continuation.ts:420`）。

### 裁决

- **要补钉**。落法：在既有 `'keeps a teammate dormant when its resume fails'`（`upgrade.spec.ts:505-520`）旁追加：捕获 rejects 后断言 `error.cause` 为 Error 且其 `message` 与 mock 的 `'the session is not available'`（:509）一致；可再加一例以 `SubagentError('...', 'NOT_RESUMABLE')` 作 mock，断言 `cause.code` 透传。红→绿可逆验证：删掉 `roster.ts:379` 的 `{ cause: error }` 转红。
- 与问题 A 的关系：A 题的最终形态已由 `“fix(agent-team): let the profile pin the preset, and keep the resume failure” 批次` 落地——拆码被否、单码保留、原因落账实现并有用例。E 是这条线的收尾：把"cause 透传"从实现细节升格为被钉住的契约，与 A 题"诊断增强"方向同源。
- 二选一的取舍：**保留 cause**。理由：(1) Team 层没有按底层原因分叉的后续行为，第二个错误码不产生任何决策差异（A 题理由，仍然成立）；(2) cause 的信息量严格大于一个新 team 码（原始 name + code + message 全保留），且不需要 Team 层自建"底层原因 → team 码"映射表；(3) 拆码要动已钉契约（`upgrade.spec.ts` 现存三处 code 断言：:515、:532、:550）而收益为零——其唯一理论消费场景（`PERSISTENCE_UNAVAILABLE`）在 resume 路径不可达。

### 风险 / 遗漏

- cause 断言建议钉「身份/文案 + code 存在性」，不要钉死具体错误类：真实链路的 cause 多为 `SubagentError`（`subagent/src/error.ts:10-14`），mock 可控；钉类会放大无关重构的脆性。
- park 吞错残留仍在（`roster.ts:411-413` warn 后吞）：原因落账以「park 写回成功」为前提，journal 写回失败时行停在 active 且无 error 文案——该残留维持备忘录 :168 挂账，与 cause 钉子正交。
- 未验证项：未实跑带 cause 断言的新用例（本 Bot 不改测试文件；以上红→绿判断基于 roster.ts:379 的透传实现与 grep 证据，落地时按用例红→绿可逆流程验证）。

---

## Chief 裁决复核（本轮权限内）

- 三问的分派本身无误判：A 确为错误折叠而非重复投递问题（备忘录 :168 的定性与我本轮对 resume 链的取证一致）；B 确为规格缺口（`roster.ts:466` 与同函数内 name/backend/route 冲突口径不一致）；C 的正确问法确实是「可枚举目录是否存在且可达」——答案是存在（`list()`）但跨服务且异步。
- 备忘录 :168 登记的 park 吞错残留（`roster.ts:401-405`）维持挂账，属于 A 题风险面的真实残留项，本轮证据一致。
- 未发现 Chief 本轮裁决与代码事实相悖之处。

### 补充复核（05:43，针对 A/B/C 作答后的落地波）

- `“fix(agent-team): let the profile pin the preset, and keep the resume failure” 批次` 对问题 B 的落地与本 Bot 建议一致且精确：档案冲突检查块新增 preset 冲突分支报 `TEAM_PROFILE_CONFLICT`（`roster.ts:472-477`），取值改为档案优先（`:485` `profile?.preset ?? request.preset`），注释明言「the declared profile wins over the request」（:482-484）——即档案赢、冲突报错，与本文件 B 章裁决一致。
- 问题 A 的诊断落账同波实现（`park(root, memberId, reason)` → 成员行 `error`，`roster.ts:395/:403`），即本文件 A 章"首选补强"项；拆码未做，符合 A 章结论。首席在追加简报中实测确认的「resume 半途断裂重复投递窗口不存在」（`“fix(agent-team): stop the mailbox from waking a dormant teammate” 修复` 相位前置、`continuation-activation.ts:521→:530` 原子交付）与本 Bot 对 resume 链的取证无冲突，E 题按此事实基线作答。
- `“fix(tool-agent-team): say that a preset is recorded, not applied” 修复`（工具文案「preset is recorded, not applied」）与本文件 C 章"登记边界 + 文案提示"方向一致；C 章的「已知边界登记 + 目录对账延后」裁决未被本波推翻。
- 对 D/E 两问，首席本轮尚未裁决；本文件给出的建议是 D 先改实现再钉新语义、E 补 cause 断言，供下一轮采纳。
