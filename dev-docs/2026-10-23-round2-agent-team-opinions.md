# 第二轮裁决意见（S4 智能体团队升级：A/B/C 三问）

- 作者：智能体团队架构师（本文件为本 Bot 专属产出）
- 日期：2026-10-23
- 范围：只回答第二轮三问（A：resume() 错误码拆分；B：档案 preset 与请求 preset 优先级；C：`allowedPresets` 是否对账真实 preset 目录）。不重复首轮审查内容，不引用已收口项。
- 代码基线：`E:\Projects\CetusPrism` 分支 `release/v1.7.3`（本 Bot 本轮零代码改动、零 git 写操作；本文所有证据为本轮实读实跑所得）。
- 本轮验证命令（已验证）：`pnpm vitest run --config configs/vitest.config.ts packages/experimental/agent-team/tests/upgrade.spec.ts` → 1 file / 42 tests 全绿，exit 0（2026-10-23 实跑）。

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

- 两类拼错的失真等级不同：backend 拼错会走完 provisioning 硬失败、失败成员占名字占名额（正是 `dbaf5e308c` 关闭的形态）；preset 拼错的后果只是「成员行记录了一个不生效的 id」，子会话实际跑继承预设——软失真，且已有边界条款覆盖其语义。
- 对账成本不匹配：preset 目录在另一个服务（`AgentPresetRegistry`，`list()` 为异步 `:238`），而 agent-team 的 `checkRanges` 是同步集合判定（`range.ts:33-59`）；要么给实验包新开对 preset-registry 的硬注入（装载顺序耦合、需先验证所有部署形态下 agentPresets 必在——**未验证**），要么把校验改异步穿透到 spawn 主链路。为一个当前不生效的记录值付出跨包耦合，收益不成立。
- 但边界必须从「无人提过」变成「明文登记」：在 spec「已知边界」追加一条（与 #1 并列）：allowedPresets 为 Team 自声明集合，不与部署 preset 目录对账，未知 preset id 静默记录且不生效；同时 `spawn_teammate` 的 preset 参数描述应补一句「须为部署声明的 preset id」（`tool-agent-team/src/index.ts:411` 现在只提 range，未提目录），避免模型自由编 id。

### 风险 / 遗漏

- 未来若 preset 变为 per-child 可施加（spec 已注明那需要动全仓共享的 subagent 层，spec :287-288），目录对账即成为必须项，应与施加点同轮落地（届时错误码可沿用 `TEAM_PRESET_NOT_ALLOWED` 或新增 `TEAM_PRESET_NOT_AVAILABLE`，对齐 backend 的两段语义）。
- 模型侧可用性缺口：Team 工具面没有「列出部署 preset」的入口（`list_agent_profiles` 只列档案，`tool-agent-team/src/index.ts:525-533`），模型无从校验自己填的 preset id；登记边界时一并写明。
- 未验证项：agentPresets 与 agent-team 在全部部署形态中的共在性（上列）；Team 侧异步调用 registry 的远端协议开销（`AgentPresetRegistry extends TypertRemoteService`，`agent-preset-registry/src/index.ts:89`——未验证）。

---

## Chief 裁决复核（本轮权限内）

- 三问的分派本身无误判：A 确为错误折叠而非重复投递问题（备忘录 :168 的定性与我本轮对 resume 链的取证一致）；B 确为规格缺口（`roster.ts:466` 与同函数内 name/backend/route 冲突口径不一致）；C 的正确问法确实是「可枚举目录是否存在且可达」——答案是存在（`list()`）但跨服务且异步。
- 备忘录 :168 登记的 park 吞错残留（`roster.ts:401-405`）维持挂账，属于 A 题风险面的真实残留项，本轮证据一致。
- 未发现 Chief 本轮裁决与代码事实相悖之处。
