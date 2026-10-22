# 模型接入链路审查（S4 · release/v1.7.3 · HEAD 7c7a9c9501）

- 审查人：模型接入架构师
- 日期：2026-10-23
- 范围：`packages/llm/llm-pi-ai`、`packages/llm/llm`、`packages/llm/llm-retry`、vendor `@earendil-works/pi-ai@0.87` dist、部署态 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml`
- 方法：只读源码 + 部署配置核对；凭据一律只报引用名与存在性，不回显值。所有结论带 `文件:行号`；未验证项单列并给验证方法。

## 结论摘要

接入链路的**结构**是健康的：profile → catalog 物化 → provider 复用/新建 → 请求冻结快照 → vendor wire → 回程分类 → agent/request-error → llm-retry，每一跳都有明确归属，快照冻结与 `maxRetries: 0`（适配层单次尝试，重试交还 agent 恢复层）的设计是闭环的。

但围绕 **developer-role 兼容缺陷**（本组已知的 400 事故形态），仓库侧的"事前警告 + 事后指引"两道防线**各自断了一环**：

1. 事前：`developerRoleWarning` 算出来了，但 `warnings` 字段**全仓无任何消费者**（静默丢弃）。
2. 事后：分类器要求报错文本含 `developer` 一词，而 CSU 网关的实测文案是 `Unexpected message role.`——**漏报**，落回 `INVALID_REQUEST`，修复指引永远不出现。
3. 无论落在哪个 code，都不在默认可重试集合，回合永久失败；仓库侧没有自愈监听（而 compaction 系插件已证明该扩展点支持自愈）。

当前生产侧能跑起来，靠的是部署态 `cordis.patch.yml` 的一行 `compat.supportsDeveloperRole: false`——这是补丁，不是闭环。

对 Chief「补闸门」问题的判断见文末第五节。

---

## 一、接入链路全景（逐段 `文件:行号`）

以下路径均指 `E:\Projects\CetusPrism` 仓库内相对路径；vendor 指 `node_modules/.pnpm/@earendil-works+pi-ai@0.87._668e591a145b2f01e7c43f2074273b4c/node_modules/@earendil-works/pi-ai/dist/`。

### 1. 配置层（profile 进来）

- 部署态 profile：`D:\Cetus\dshconfig\profiles\web\cordis.patch.yml:8-47`（`csu` 路由：`apiKeyEnv: CSU_API_KEY`（仅引用名，值未读取）、`api: openai-completions`、`baseURL`、`compat.supportsDeveloperRole: false`、三个模型条目）。
- 默认模型：`cordis.patch.yml:48-53`（`agent-default-model`：csu/DeepSeek + `reasoningEffort: max`）。
- 子智能体模型白名单：`cordis.patch.yml:131-141`（`subagent-model-selection-settings.allowedModels`：csu × DeepSeek/GLM/Qwen）。
- Schema：`packages/llm/llm-pi-ai/src/config.ts:334-357`（profile schema；`compat` 266-293；`reasoningEfforts` dict 305-308，仅 `off` 允许空值）；顶层 `Config` 360-362（`providers` 字典，空 = dormant）。
- 路由键即 provider id：`config.ts:91-127`（`PiAiProviderProfile`，dict key IS the route）。

### 2. 解析与目录物化（profile → Model）

- 运行时读取：`packages/llm/llm-pi-ai/src/index.ts:163-170` `profiles()`，`deferred` 模式调用 `resolveProfiles`，memoize 于 raw 快照身份。
- 标量默认与校验：`config.ts:418-519`（streamIdleTimeout/maxRequestImageBytes 等校验 437-456；`defaultContextWindow/defaultMaxTokens/defaultInput` 落默认 462-484）。
- 模型物化：`catalog.ts:945-1078` `resolveRouteModels`——逐条目合并 `...base` + 覆盖（1033-1051）；capacity 链 `entry → catalog → route 默认`（1019-1026）；`reasoningEfforts` → `thinkingLevelMap`，未声明层钉 `null`（753-807）；compat 合并 `route → model` 逐字段、继承仅当 api 未改（875-906）。
- **事前警告**：`developerRoleWarning`（catalog.ts:835-855），镜像 vendor 判定 `sendsDeveloperRole`（704-712，vendor 名单 672-689），挂接于 1030-1032，产出进 `RouteCatalog.warnings`（1077）→ `ResolvedPiAiProviderProfile.warnings`（config.ts:513）。
- 写入闸门：`index.ts:172-181` `internal/config` 拦截 → `assertServiceable`（config.ts:372-376，strict 重解析变更路由）。

### 3. 注册与快照（catalog → pi-ai Provider）

- 路由注册：`index.ts:285-308` `ensureRegistrationFacts`——只有路由集 / displayName / retryPolicy 变化才重注册（103-114 `registrationFacts`）；空路由集 = dormant（296-301）。
- 快照：`adapter.ts:232-241` `current()`——profiles → 新建 `Models` collection，配置变更换新集合不 mutate，请求冻结快照（330-341 注释）。
- Provider 构造：`provider.ts:167-192` `buildProvider`——catalog 路由且未改协议时复用 catalog provider（144-159，保留其 API 实现与 ambient auth），否则 `createProvider` 走协议表（47-51：仅 completions / responses / anthropic 三协议）。
- 认证方法：`provider.ts:131-135` `routeAuth`——OAuth-only catalog 路由被显式 key 命中时补 harness apiKey 方法（否则 `openai-codex` 类路由会拒收显式 key）。

### 4. 请求构造（seam → pi-ai）

- effort/maxTokens 解析与校验：`packages/llm/llm/src/index.ts:885-919` `resolveCallWithInfo`（请求未给 effort 时用 `defaultEffort`，不在 efforts 列表 → `UNSUPPORTED_REASONING_EFFORT`）。
- 冻结：`adapter.ts:318-324` `prepareCall`（prepare 时刻锁快照，换模型下一 step 才生效）。
- 流主体：`adapter.ts:330-424` `streamWithSnapshot`——凭据解析 348（每调用一次并冻结）、idle watchdog 350-355（默认 300s，config.ts:47）、图片能力预检 358-365、历史转换 `context.ts:284-338`（systemPrompt 切分 158-164；developer role 历史显式拒收 `UNSUPPORTED_CONTENT` context.ts:53）、SDK 调用 380-389（`maxRetries: 0` 131）。
- effort 语义：harness `ReasoningEffortId`（`packages/llm/llm/src/brand.ts:67`）→ adapter 校验 `getSupportedThinkingLevels`（`models.ts:59-67`，复刻 pi-ai 对 `xhigh`/`max` 的不对称默认）→ 以 `ThinkingLevel` 原样传入 pi-ai（`adapter.ts:115-132`）。
- 凭据：`index.ts:183-206` `resolveApiKey`——未命名凭据 → 交给 pi-ai ambient；命名即 fail-loud `MISSING_CREDENTIAL`（200-205），不给 ambient 回退（防误用 OPENAI_API_KEY 计费他人）。

### 5. wire 请求（vendor 事实）

- `detectCompat`：vendor `api/openai-completions.js:1217-1301`；**未识别 URL → `supportsDeveloperRole: true`（1260）**；`getCompat` 1306-1337 逐字段 `??` 合并 model.compat。
- 系统角色：`openai-completions.js:895` `instructionRole = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system"`；Responses 协议同型：`openai-responses-shared.js:125`（`supportsDeveloperRole !== false` 即 developer，无 URL 探测）。
- effort → wire：`openai-completions.js:711-714`（openai 格式：`reasoning_effort = thinkingLevelMap[effort] ?? effort`）；其它格式 618-720；off 的空值语义 715-719。
- 输出上限字段：586-592（`maxTokensField` 决定 `max_tokens` vs `max_completion_tokens`）；推理预算钳制 757-763。
- usage：1174-1185（completions：`reasoning` 取自 `completion_tokens_details.reasoning_tokens`）；responses 协议 `api/openai-responses-shared.js:443-452`。

### 6. 回程与恢复（错误 → 重试 → 终态）

- 事件翻译：`stream.ts:171-262` `toStreamChunks`（无终态收尾 → `STREAM_CLOSED` 262）；usage 映射 `mapUsage` 24-32；终态分类 `mapStopReason` 85-140（溢出 86-98、空响应 104-112、error 分类 128-138）。
- 错误分类：`classifyPiAiError`（`stream.ts:42-73`，文本匹配，XXX 注释自认 pi-ai 拍扁 cause 链）；`DEVELOPER_ROLE_REJECTED` 判定在 `packages/llm/llm/src/error.ts:78-82`，guidance 在 `stream.ts:153-157`。
- failure 归一：`llm/src/index.ts:1146-1154` `adapterFailureChunk`；`LlmError.failure` 携带 code/status/providerRetryAfterMs（80-131）；归一化规则 `adapter-failure.ts:16-28`。
- 重试执行：`agent-loop/src/agent.ts:495` 发 `agent/request-error` → `llm-retry/src/index.ts:194-241` `recover`（code 检查 215、预算 223、provider Retry-After 优先 227-238、可取消退避 149-192）。
- 可重试集合：`packages/llm/llm/src/retry-policy.ts:18-24`（EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT），normal 默认 5 次（14）。
- 自愈对照样例：`compaction-basic/src/index.ts:190`、`compaction-image-offload/src/index.ts:27` 在同一扩展点改写输入后重试。

### 7. 授权流（login）

- 方法枚举：`login.ts:29-36`（oauth / api-key，仅 catalog provider）；注册与事件转译 120-160；凭据落 `credentialStore`（`auth.ts:36-38` recordKeyFor = `llm-pi-ai/<providerId>`），刷新由 pi-ai 自持锁（`adapter.ts:107-112` 注入语义）。

---

## 二、缺陷清单

严重度：P0（生产事故形态）/ P1（确定缺陷，条件触发）/ P2（防御性/观测性）。

### D1【P0】developer-role 兼容缺陷的闭环断在三处，事前信号静默丢弃、事后分类对实测文案漏报、终态不可恢复

- **证据**：
  - 事前信号无消费者：`developerRoleWarning`（catalog.ts:835-855，挂接 1031-1032）→ `RouteCatalog.warnings`（1077）→ `ResolvedPiAiProviderProfile.warnings`（config.ts:513）。全 `packages/` 检索 `.warnings`：除 config.ts:513 赋值处外仅 boot/plugin-manager 的同名无关字段；目录入口 `directoryEntries`（index.ts:144）只透传 `catalogError`。设计意图原文见 catalog.ts:824-828 注释（"so the route says so now rather than at the first request"）——落空。
  - 事后分类漏报：`isDeveloperRoleRejectedError`（llm/src/error.ts:78-82）要求文本含 `developer`；部署态实测 CSU 网关 400 文案为 `Unexpected message role.`（cordis.patch.yml:18 注释，部署侧直连实测）→ 落入 `classifyPiAiError` 的 400 分支（stream.ts:54）成 `INVALID_REQUEST`，`developerRoleGuidance`（stream.ts:153-157）永不触发。现有测试只覆盖含 `developer` 的文案（`llm-pi-ai/tests/convert.spec.ts:941-954`）。
  - 终态不可重试：`DEVELOPER_ROLE_REJECTED` 与 `INVALID_REQUEST` 均不在 `DEFAULT_RETRYABLE_CODES`（retry-policy.ts:18-24）→ 无重试、无自愈（对比 compaction 系在同一扩展点自愈：compaction-basic/src/index.ts:190）；仓库侧也无默认值（`PiAiCompatProfile.supportsDeveloperRole` 可选，resolveModelCompat catalog.ts:875-906 只透传，未设则交给 vendor `??` 检测）。
- **复现条件**：hand-declared 推理路由 + 未识别私有 URL + 未设 compat 开关 + 网关拒绝文案不含 `developer`。`csu` 路由在打补丁前正是此形态（patch 注释记录了 developer→400 / system→200 的实测）。
- **影响面**：所有"私有 OpenAI 兼容网关 + 推理模型"新路由的首次接入；当前仅 `csu` 一条路由靠部署补丁幸免，任何新增同类路由都会原样复现。`retryPolicy.mode: always` 是现存的运营侧缓解（llm-retry/src/index.ts:199-214），但对恒定 400 是无意义重试，耗尽后仍终态失败。
- **修法**（三处独立，按性价比排序）：
  1. `warnings` 接出口：在 `index.ts` 的 `ensureDirectory`/路由注册处对非空 `profile.warnings` 逐条 `ctx.logger.warn`（仿 `onReplayDegrade` 的现成模式，index.ts:222-227），并给 `LlmConfigurableProvider` 加可选 `warnings` 字段透传目录——改动 2 文件（index.ts + llm 目录类型），约 10 行。
  2. 分类补词面：`isDeveloperRoleRejectedError` 增加对 `unexpected message role` / `unknown role` / `role.*not.*support` 类网关文案的识别（保留现有 `developer` 快路径），并加 CSU 实测文案 fixture——改动 1 文件 + 测试。
  3. 自愈（可选，P2）：在 `agent/request-error` 上对 `DEVELOPER_ROLE_REJECTED` 挂"提示配置"级恢复动作；不建议自动改写部署配置。
- **改动文件数**：2（仅 1+2）；含自愈再 +1。

### D2【P1】部署态 `csu` 的 GLM 条目残缺：静默按"非推理、无图、262144 上下文"服务

- **证据**：`cordis.patch.yml:34-35`（GLM 条目只有 id/name）。由 catalog 合并规则推得：hand-declared 路由无 catalog base（catalog.ts:950-951，`csu` 非 pi-ai 内置 provider）→ `reasoningEfforts` 缺省 ⇒ 非推理（catalog.ts:758-765）；`input` 未声明 → 落 `defaultInput [text]`（config.ts:344）；`contextWindow/maxTokens` 落默认 262144/32768（config.ts:342-343，config.ts:64-68）。
- **复现条件**：向 csu/GLM 发带图请求 → `UNSUPPORTED_CONTENT`（adapter.ts:358-361）；选中 GLM 后保留 `reasoningEffort: max`（`agent-default-model` 或 UI 保留值）→ 请求时 `UNSUPPORTED_REASONING_EFFORT`（llm/src/index.ts:905-910，非重试）；若 GLM 实际上下文 < 262144，溢出检测（stream.ts:86-98 用 `model.contextWindow`）失准 → 本应触发 compaction 的输入直接被网关 400。
- **影响面**：部署态确定性失败面；GLM-5.3-Flash 是否推理模型、真实窗口多大——未验证。
- **修法**：改 `cordis.patch.yml` 一处（部署文件，非 packages）：给 GLM 补 `reasoningEfforts`（若支持推理）、`contextWindow/maxTokens`、必要时 `input`。**改动文件数：0（仅 patch.yml）**。
- **如何验证**：直连网关列模型/试探 effort；或查网关文档确认 GLM-5.3-Flash 能力与窗口。

### D3【P1】`mapUsage` 丢弃 `reasoning`：`TokenUsage.reasoningTokens` 在 pi-ai 适配器下恒缺省

- **证据**：pi-ai 两协议都产出 `usage.reasoning`（vendor openai-completions.js:1182；openai-responses-shared.js:449）；harness 词表有 `reasoningTokens?`（llm/src/types.ts:188）；但 `mapUsage`（llm-pi-ai/src/stream.ts:24-32）未映射。
- **复现条件**：任意一次带推理的调用（csu/DeepSeek + `reasoningEffort: max` 是常态路径）。
- **影响面**：usage 面板/审计无法区分推理 token 与可见输出；`outputTokens` 恒含推理（vendor 注释明言 completion_tokens 已含 reasoning_tokens，openai-completions.js:1175-1176），reasoning 占比高的会话输出量被系统性高估。usage 只在终态事件出现一次，**数据丢了无法事后重建**。
- **修法**：`mapUsage` 增加一行 `...usage.reasoning > 0 ? { reasoningTokens: usage.reasoning } : {}`（与 cache 字段同风格）。**改动文件数：1（+测试）**。

### D4【P1】同一物理故障（流中断）两种结局：in-band 截断可重试，`STREAM_CLOSED` 不可重试

- **证据**：pi-ai 以 error 事件上报的截断文本 → `TRANSPORT`（stream.ts:63，在默认可重试集合 retry-policy.ts:23）；事件流无终态直接结束 → `LlmError('STREAM_CLOSED')`（stream.ts:262）→ 不在集合内 → 回合死。分类整体依赖词面匹配（42-73），pi-ai 拍扁 cause 链（XXX 注释 34-41），网关措辞一变即漏成 `PI_AI_ERROR`（不可重试）。
- **复现条件**：前者：网关返回其特有截断文案（`stream ended before/without …` 系）；后者：pi-ai 事件迭代器在无 `done/error` 的情况下完成（防御路径，罕见但存在）；或任意新网关措辞未被 42-72 覆盖。
- **影响面**：长回复 + 不稳定链路下，重试预算（默认 5 次）对部分中断形态失效；错误被归类 `PI_AI_ERROR` 后不可重试。
- **修法**：`STREAM_CLOSED` 并入 `TRANSPORT`（一行，语义同为"传输层未给终态"）；中期随 vendor 升级推动 error cause 透传，用 `code`/`cause` 替代文本匹配（stream.ts:34-41 注释已指路）。**改动文件数：1**。

### D5【P1】`agent-default-model.reasoningEffort` 与 allowedModels 只在请求时爆炸：配置期无能力校验

- **证据**：配置 schema 为裸字符串（`packages/core/agent-default-model/src/index.ts:51-55`，`reasoningEffort: z.string().volatile()`）；拼错的 effort / 与所选模型能力不匹配的组合，要走到 `resolveCallWithInfo`（llm/src/index.ts:885-919）或 adapter `resolveReasoningLevel`（adapter.ts:158-169）才抛 `UNSUPPORTED_REASONING_EFFORT`——不在可重试集合（retry-policy.ts:18-24），回合即死。`subagent-model-selection-settings.allowedModels` 同理（`packages/subagent/tool-subagent/src/model-selection-settings.ts:37-40`），路由/模型存在性要到请求时以 `UNKNOWN_MODEL`/`NO_ADAPTER`（adapter.ts:244-263）暴露。
- **复现条件**：换模型不换 effort（如部署态 GLM 无推理声明 + 保留 max）；或手改 default-model 的 effort 拼写。
- **影响面**：Host 模型选择策略（defaultModel / allowedModels）是子智能体路由的入口；错误延迟到请求时才出现，且错误形态是"回合永久失败"而非"保存被拒"。
- **修法**：保存路径（`saveSelection` / settings 写入）增加一次 `adapter.resolveModel(provider, model)` 探测并校验 effort ∈ `reasoning.efforts`（目录已具备该能力，llm/src/index.ts:929-933 的 prepareCall 路径）。**改动文件数：2-3**（agent-default-model + 校验挂点）。

### D6【P2】developer-role 镜像检测与 vendor 行为存在两处偏差，且无 drift gate

- **证据**：镜像 `sendsDeveloperRole`（catalog.ts:704-712）对 `openrouter` 路由一律返回 false；vendor 对 openrouter 上 `anthropic/*`、`openai/*` 模型返回 `supportsDeveloperRole: true`（openai-completions.js:1256,1260）→ 这类模型的事前警告漏发（漏警方向）。镜像硬编码 vendor 主机/提供者清单（catalog.ts:672-689），vendor `detectCompat` 变动时静默漂移——与 THINKING_LEVEL_GATE 等编译期 drift gate（catalog.ts:75-83）不对称。
- **复现条件**：openrouter catalog 路由上的 anthropic/openai 前缀推理模型且未设 compat 开关。
- **影响面**：警告准确性（不影响 wire 行为，wire 由 vendor 真值决定）。
- **修法**：一致性快照测试（对 vendor `detectCompat` 与镜像逐模型比对，漂移即红）；或从 vendor dist 读表生成镜像。**改动文件数：1-2**。

### D7【P2】路由目录只透传 `catalogError`：per-model 错误与 warnings 在配置面不可见

- **证据**：`directoryEntries` 仅透传 `catalogError`（index.ts:144）；`modelErrors` 只在请求时变 `INVALID_CONFIG`（adapter.ts:255-257）；warnings 无出口（见 D1）。`ResolvedPiAiProviderProfile` 的三个诊断字段（config.ts:210-220）一半有出口一半没有。
- **影响面**：运营者修配置时看得见"路由坏了"，看不见"哪个模型坏、为什么、怎么修"。
- **修法**：目录 entry 增加 `modelErrors`/`warnings` 摘要字段（与 D1 修法 1 同一落点）。**改动文件数：2**。

### D8【P2/确认】凭据缺失语义：设计正确，无需改动（审查结论而非缺陷）

- **证据**：命名凭据缺失 → fail-loud `MISSING_CREDENTIAL`，错误信息给出修复路径，且拒绝 ambient 回退防串租户计费（index.ts:183-206 注释完整）；非重试合理（重发无益，retry-policy.ts:18-24 不含之）；空值与缺失同义、引导词正确（199-205）。OAuth-only catalog 路由被显式 key 命中时补 api-key 方法（provider.ts:131-135）避免"Provider is not configured"假阴性。
- **未验证项**：`assertUsableApiKey` 的具体拒收规则（llm/src/api-key.ts 未读）。如需验证：读该文件并核对空串/空白/不可打印字符的处理与 `MISSING_CREDENTIAL`/`INVALID_CREDENTIAL` 的分工（error.ts:44-51 已给出二者语义边界）。

### 事实修正（对开局给定事实的更正）

- 开局简报称"400 在 stream.ts 被分类为 INVALID_REQUEST，无任何仓库侧应对"。实测：本仓**已有**三层应对——catalog 事前警告（catalog.ts:835-855）、`DEVELOPER_ROLE_REJECTED` 事后分类 + 修复指引（llm/src/error.ts:67-82、stream.ts:50,134,153-157）。真实缺口是这三层**互不连通**（D1）：警告无人消费、分类器被实测文案绕过、终态不可恢复。缺陷定性从"没有"修正为"断链"。

---

## 三、修法优先级 Top 5

1. **D1（developer-role 断链）**——它是当前唯一已知的生产事故形态的完整因果链：400 → 回合死亡 → 运营者无提示。三处修法互相独立且每处 ≤3 文件、均为小改；其中"warnings 接 logger + 目录"是把已写好、已测试（catalog.spec.ts:1053）的能力接上最后一米，收益/成本比全表最高。
2. **D2（部署态 GLM 条目补齐）**——零代码、一行 YAML，消除三个确定性失败面（图、effort、溢出计量）；排第二因代价最低、当轮生效。
3. **D3（reasoningTokens 映射补齐）**——一行修法，但数据是单次性的（usage 不重放），晚一个版本修复就永久丢一批会话的推理计量；下游一切"推理开销"归因都压在这一个字段上。
4. **D4（STREAM_CLOSED 归并 TRANSPORT）**——重试预算对"同一故障"表现不一致，属于恢复语义的正确性问题；一行改动即可让截断类失败在默认策略下自愈。
5. **D5（defaultModel/allowedModels 配置期校验）**——Host 模型选择策略的闭环缺口：坏配置从"保存被拒"退化为"回合即死"。排在 D6/D7 之前，因为它直接决定子智能体委托链路的可用性。

（D6/D7 为防御性改进：镜像漂移风险与诊断可见性，建议随 vendor 升级窗口一并处理。）

## 四、待确认问题

1. **CSU 网关对 `reasoning_effort` 的真实接受度**：`thinkingFormat` 经 detectCompat 落在 `openai`（发 `reasoning_effort`，vendor openai-completions.js:711-714），部署注释只验证了 role 维度（system→200）。`reasoning_effort: "max"` 是否被网关接受/透传未验证。验证：直连发 `reasoning_effort: max` 与不带该字段的对照请求。
2. **CSU 400 响应体的最终词面**：D1b 依据部署注释的实测文案（`Unexpected message role.`）。pi-ai 抛出的 errorMessage 是否逐字保留网关文案未在本仓验证（pi-ai 拍扁 cause 的行为已由 XXX 注释与 vendor 代码佐证）。验证：对网关重现 400，取 pi-ai error 事件原文喂 `isDeveloperRoleRejectedError`。
3. **GLM-5.3-Flash 能力**（推理与否、上下文、多模态）：未验证，见 D2。
4. `assertUsableApiKey` 拒收规则：未读（`packages/llm/llm/src/api-key.ts`），见 D8。

## 五、闸门判断（回应 Chief 的统一问题）

**要不要补闸门：要，但不是 pre-commit，而是两类廉价测试闸门 + 维持 pre-push 现状。**

1. **为什么这批错误能过 pre-commit**（对本域的印证）：`lefthook.yml` pre-commit 全部是类型无关检查（oxlint 无类型信息 + 翻译配对 + 第三方声明 + 空白 + vendor 守卫），TS6133/TS2322 只有 tsc 能报；而本审查的 D1-D4 全是**行为断言缺失**，tsc 也报不了——`isDeveloperRoleRejectedError` 的词面匹配只有"含 developer"的 fixture（convert.spec.ts:941-954），没有真实网关文案（CSU 的 `Unexpected message role.`）用例；`warnings` 有产出断言（catalog.spec.ts:1053）但**没有任何测试断言它被消费**——因为事实上没有消费者。
2. **补在哪、代价多少**：
   - 在 vitest（不进钩子，随 CI/pre-push 已有链路）补两条守卫：① 网关文案 fixture 集进 `convert.spec.ts` 的分类用例（把 CSU 实测文案固定下来，≈10 行）；② "诊断必须有出口"约定测试——遍历 `ResolvedPiAiProviderProfile` 的诊断字段（`warnings`/`modelErrors`/`catalogError`），断言各自至少有一个消费点或被目录透传（约 30 行，防 D1/D7 类静默再发）。
   - 不建议把 vitest 或 typecheck 加进 pre-commit：typecheck 依赖完整构建（Chief 已核实的 `typecheck = build:lib:host && typecheck:contracts-ready`），进 pre-commit 会把每次提交拖到分钟级；本缺陷族靠针对性断言守，成本 ~40 行测试，无闸门时延代价。
3. **vendor drift 守卫**（D6）：随下一个 pi-ai 升级补 `detectCompat` 快照一致性测试即可，不单独立闸门。
