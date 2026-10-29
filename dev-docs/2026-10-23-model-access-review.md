# CetusPrism 模型接入链路正确性与闭环审查（2026-10-23）

- 审查人：模型接入架构师
- 范围：`packages/llm/*`（llm / llm-pi-ai / llm-retry）+ vendor `@earendil-works/pi-ai@0.87`（openai-completions 路径）+ 部署态 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml`
- 仓库基线：分支 `release/v1.7.3`（群内其他成员汇报 HEAD=d7bd69592a，产品版本 1.7.5）
- 方法：全量读码 + 部署态只读核对；每条结论附 文件:行号；未经实测的判断单独标注「未验证」。
- 红线核验：部署态仅接 csu provider 三个模型（DeepSeek / GLM / Qwen），无 MiniMax 路由；凭据仅经 `apiKeyEnv: CSU_API_KEY` 注入，无明文凭据落盘（本文件与群回复均不回显任何凭据值）。

---

## 一、接入链路全景（profile 配置 → catalog 物化 → pi-ai route → wire 请求）

### 1. 部署态 profile 配置（输入端）
- `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml:8-19`：`llm-ai` 补丁声明 csu provider —— `apiKeyEnv: CSU_API_KEY`（凭据从环境注入，无明文）、`api: openai-completions`、baseURL 指向 csu 网关，并显式 `compat.supportsDeveloperRole: false`（:16-19，附实测注释：developer role → 400 "Unexpected message role."，system role → 200）。
- 三模型声明：csu/DeepSeek（`cordis.patch.yml:20-36`，reasoningEfforts off/low/high/xhigh/max，contextWindow:128000）；csu/GLM（:37-56，六档，contextWindow:262144）；csu/Qwen（:57-69，四档，**未声明 contextWindow**）。
- 旧 deepseek 直连与 deepseek-account 路由已 disabled（:77-81）；agent-default-model = csu/Qwen xhigh（:83-88）；subagent allowedModels 白名单仅 csu/GLM + csu/Qwen（:169-177）；bot-companion chat=csu/DeepSeek xhigh、dev=csu/Qwen（:213-218）。
- 结论：部署态满足「只走 csu 三模型」红线，未发现旁路模型配置（llm-deepseek 两路由已禁）。

### 2. catalog 物化（模型元数据 → compat 推导）
- `packages/llm/llm-pi-ai/src/catalog.ts:234`：`supportsDeveloperRole` 是 offer 里的可选声明，**仓库无任何默认值兜底**，缺省时交给 vendor 自动探测。
- `catalog.ts:730-743`：`sendsDeveloperRole` 推导 —— 未识别 provider 默认 **true**（照发 developer role），Responses API 恒 true。
- `catalog.ts:882-903`：`developerRoleRisk` 命中时仅产生 warning，不拒绝 route 物化。
- 部署态补丁用显式 `compat.supportsDeveloperRole: false` 覆盖了上述默认（vendor 合并逻辑见 `vendor pi-ai@0.87 openai-completions.js:1312`，逐字段 `??` 覆盖，显式声明优先）。这是**手写救火补位，不是仓库内安全默认**（见缺陷 D2）。

### 3. provider 注册与凭据解析（route 建立段）
- `packages/llm/llm-pi-ai/src/index.ts:104-115`：注册时逐条固化事实；`index.ts:198-221` `resolveApiKey` fail-loud —— 命名凭据解析不到直接抛 `MISSING_CREDENTIAL`（:215-220），不静默降级。
- `packages/llm/llm/src/index.ts:154-169`：`assertUsableApiKey` 拒绝空 key / 含不可入 HTTP 头字符的 key，报错只引用凭据引用名（ref），不回显值 —— 语义正确。
- `index.ts:259-270`、`:309-331`：配置变更走原子换装（先验证后提交，无中间态）；`:319-325` 裸挂载零路由时注册休眠、不产生可用模型。
- `packages/llm/llm/src/index.ts:396-440`：`LlmRuntime.registerAdapter` 全有或全无、重复注册 `DUPLICATE_ADAPTER`、disposer 与 fiber 绑定 —— 注册面无缺陷。

### 4. adapter 模型解析与 reasoning effort 决策
- `packages/llm/llm-pi-ai/src/adapter.ts:78-85`：凭据缺失映射 `MISSING_CREDENTIAL`；`:130` 请求层固定 `maxRetries: 0`（重试完全交给上层 llm-retry，避免双侧重试放大）。
- `adapter.ts:157-169`：effort 解析为 strict 模式 —— 请求档位不在模型声明 `reasoningEfforts` 内时抛 `UNSUPPORTED_REASONING_EFFORT`；`packages/llm/llm/src/reasoning-effort.ts:76-110` 的 Auto/lenient 降级阶梯在此路径**未被使用**（`reasoning-effort.ts:18-19` 注明 strict/lenient 由调用方选择）。
- `packages/llm/llm-pi-ai/src/effort-probe.ts:554-558`：探针把任何 2xx 视为「effort 支持」，不校验响应体语义（另见观察 O2）。

### 5. wire 请求（vendor 组装段）
- `vendor openai-completions.js:1217-1301` `detectCompat`：按 provider 名/baseURL 黑名单式识别已知厂商；**未识别端点（如 csu）默认 `supportsDeveloperRole: true`（:1260）**、`supportsReasoningEffort: true`（:1261）、`maxTokensField: "max_completion_tokens"`（:1264，csu 不在 `useMaxTokens` 名单）。
- `:1306-1340` `getCompat`：显式 `model.compat` 逐字段覆盖探测值 —— D 盘补丁的 `supportsDeveloperRole: false` 即由此生效。
- `:895` `instructionRole = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system"` —— 发什么 role 由这一个开关决定。
- `:713` 等：`reasoning_effort` 经 `model.thinkingLevelMap` 映射发出（reasoningEffort→thinkingLevel→wire 的映射链终点）；`:893` transformMessages、`:894` mid-convo tool 透传。
- token 预算：`:1264` 决定 `max_tokens` vs `max_completion_tokens` 字段名（csu 落 `max_completion_tokens`，该网关是否识别该字段**未验证**）。

### 6. 流式回传、错误分类与重试闭环
- `packages/llm/llm-pi-ai/src/stream.ts:39-46`：XXX 注释自证 —— vendor 把一切错误拍平成 `output.errorMessage` 纯文本（`vendor openai-completions.js:500-510`，cause/status 全丢），仓库只能对文本做字面匹配分类（`:96-140`）：`MISSING_CREDENTIAL`(:101)、`DEVELOPER_ROLE_REJECTED`(:108)、`REASONING_EFFORT_REJECTED`(:113)、400/413→`INVALID_REQUEST`(:116-117)、无 finish_reason→`TRANSPORT`(:130-137)、**兜底 `PI_AI_ERROR`(:139)**。
- 溢出/空响应边界：`stream.ts:153-179`（EMPTY_RESPONSE 可重试、溢出上抛）；客户端中断：`stream.ts:358` `STREAM_CLOSED`。
- 非 HarnessError 的适配器异常一律归一为 `UNKNOWN`（`packages/llm/llm/src/adapter-failure.ts:16-28`、`:105-107`）。
- 重试闭环：默认可重试集 = `[EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]`（`packages/llm/llm/src/retry-policy.ts:18-24`，不含 INVALID_REQUEST —— 400 不重试是正确设计）；`packages/llm/llm-retry/src/index.ts:194-241` recover 主循环（`:215-217` 不可重试码直接 next()、`:223` 超 maxRetries 放弃、`:227-238` Retry-After 封顶）、预算按 step 记账（`:125-138`）、不变量校验 provider/连续性（`llm-retry/src/invariant.ts:101-118`）。
- 计量：vendor `parseChunkUsage`（`openai-completions.js:1159-1188`）双通道取 usage（chunk.usage 优先 :362-364，choice.usage 回退 :368-372），字段全 `|| 0` 兜底；assembler 侧 `packages/llm/llm/src/assembler.ts:85-87` 仅保留最后一个 usage chunk，**整流无 usage 时 `_usage` 保持 undefined**。

---

## 二、缺陷清单（按严重度排序，共 6 条）

> 每条含：严重度 / 证据（文件:行号）/ 复现条件 / 影响面 / 修法 / 改动文件数。

### D1【高】错误分类依赖纯文本匹配，上游措辞漂移即降级为不可重试的未知错误
- 证据：vendor `openai-completions.js:500-510`（catch 路径把一切错误拍平为 `output.errorMessage=formatProviderError(normalizeProviderError(error))`，status/cause 丢弃）；`stream.ts:39-46`（XXX 注释自证只能拿 message 文本）；`stream.ts:96-140` 分类器全部为字面词匹配；`stream.ts:139` 兜底 `PI_AI_ERROR`；`adapter-failure.ts:105-107` 非 HarnessError→`UNKNOWN`；`retry-policy.ts:18-24`（`PI_AI_ERROR`/`UNKNOWN` 均不在默认重试集）。
- 复现条件：csu 网关返回任何措辞不含既有字面词的错误（例如 5xx 文案改为 "upstream hiccup"，或新增限流变体），或 HTTP 层异常形态变化。
- 影响面：可重试故障被终局化（不重试、无自动恢复），且用户侧拿不到任何分类指引；这是接入链路里唯一「静默改变故障语义」的环节。当前 `TRANSPORT` 恰好匹配 vendor "Stream ended without finish_reason"（`openai-completions.js:484`）属措辞巧合，无契约保障。
- 修法：在 llm-pi-ai 包装层把 vendor 错误结构化透传（保留 status/cause 上抛），`stream.ts` 分类器改为「先看结构化 status/cause，再回退文本匹配」；vendor 侧可给错误对象补 status 字段。
- 改动文件数：约 2-4（`packages/llm/llm-pi-ai/src/stream.ts` + vendor 补丁/升级 + 可选 `llm/src/retry-policy.ts`）。

### D2【高】仓库/vendor 对未识别端点的 compat 默认不安全，部署态靠手写补丁救火
- 证据：vendor `openai-completions.js:1260` `supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter)` —— csu 这类未识别端点默认 **true**；`catalog.ts:730-743` sendsDeveloperRole 未识别→true、Responses 恒 true；`catalog.ts:234` offer 无仓库默认；`catalog.ts:882-903` developerRoleRisk 命中仅警告不拒 route。部署态实测（cordis.patch.yml:16-19 注释）：developer role→400。
- 复现条件：在仓库内新增任何一个未在 vendor 探测名单里的 openai-completions 兼容端点、且不在补丁里显式写 `compat.supportsDeveloperRole: false`，首个带 reasoning 的请求即发 `developer` role → 400 → `INVALID_REQUEST` 终局。
- 影响面：新模型/新网关接入的默认路径是坏的；D 盘补丁只保护 csu，不保护下一次接入。
- 修法：翻转仓库默认 —— catalog 对未识别端点推导 `supportsDeveloperRole:false`（或 risk 命中直接拒绝物化 route，`catalog.ts:882-903` 从 warning 升级为阻断），vendor `detectCompat` 同步收紧；确需 developer role 的端点显式声明。
- 改动文件数：约 2（`catalog.ts` + vendor detectCompat；部署补丁可随后简化）。

### D3【中】csu/Qwen（当前 agent-default 主力模型）未声明 contextWindow，静默落猜测默认 262144
- 证据：cordis.patch.yml:57-69（Qwen 段无 contextWindow 字段；对比 :36 DeepSeek 128000、:56 GLM 262144 均显式）；`packages/llm/llm-pi-ai/src/config.ts:65/:68` 缺省默认 contextWindow=262144 / maxTokens=32768，均为无出处的猜测值。
- 复现条件：当前部署已生效 —— agent-default-model=csu/Qwen xhigh（cordis.patch.yml:83-88）实际运行在 262144 猜测窗口上；真实窗口未验证。
- 影响面：若 csu/Qwen 真实窗口小于 262144，压缩/截断阈值整体偏晚 → 长会话在临近真实上限时才触发压缩，可能收到上游 400（上下文超限）且被归为 `INVALID_REQUEST` 终局失败（与 D1 叠加后无自动恢复）。
- 修法：D 盘补丁为 csu/Qwen 补 `contextWindow`（实测确认后填入）；仓库侧 `config.ts` 把「缺声明」从静默默认改为显式 warning。
- 改动文件数：1（部署补丁）+1（config.ts 警告，可选）。
- 未验证：csu/Qwen 真实 contextWindow。验证方法：向 csu 网关发超长 prompt 二分实测，或查阅其 /models 元数据。

### D4【中】reasoning effort 不匹配时 strict 直接抛错终局，现成的 Auto/lenient 降级链路未接通
- 证据：`adapter.ts:157-169`（strict 抛 `UNSUPPORTED_REASONING_EFFORT`）；`reasoning-effort.ts:36-44`（六档阶梯）、`:76-110`（Auto/lenient 就近降级）已实现但该路径未使用；`:18-19` 注明模式由调用方选择。另 `effort-probe.ts:554-558` 探针对任意 2xx 即接受「effort 支持」，不校验响应体。
- 复现条件：配置声明中任一模型档位更名/删档（如上游把 xhigh 改名），或配置笔写了不存在的档位。
- 影响面：部署态三模型档位当前恰好齐备所以未爆；一旦上游档位变化，对应模型的全部请求终局失败，而不是降级到最近支持档。
- 修法：默认改走 lenient（降级事实写 warning 供观测），strict 仅在显式配置时启用；探针 2xx 后追加一次响应体合法性判断。
- 改动文件数：约 1-2（`adapter.ts`、可选 `effort-probe.ts`）。

### D5【低】maxTokens 默认 32768 为猜测值，且 wire 字段名对 csu 未验证
- 证据：`config.ts:65/:68` maxTokens 默认 32768；cordis.patch.yml 三模型段（:20-69）均未覆写 maxTokens；vendor `openai-completions.js:1264` `maxTokensField` —— csu 不在 `useMaxTokens` 名单，将发 `max_completion_tokens`（OpenAI 专用字段名），`:1146-1154` 亦随之带 `strict` 字段。
- 复现条件：现有部署即处于此状态。
- 影响面：对 128k 窗口的 csu/DeepSeek，32768 输出上限偏保守（可用性无损、上限浪费）；更大风险是 csu 网关若不识别 `max_completion_tokens`/`strict` 字段，可能 400 或静默忽略 —— 目前请求能跑通，说明至少未被拒（隐式证据：线上会话正常），**字段是否真正生效未验证**。
- 修法：实测确认后，在补丁里为三模型显式声明 `maxTokens`，必要时补 `compat.maxTokensField: "max_tokens"`；仓库侧 `config.ts` 默认值加来源注释。
- 改动文件数：1（部署补丁；vendor 字段仅实测确认需要时再改）。
- 未验证：csu 网关对 `max_completion_tokens` 的识别。验证方法：抓包对比请求体，或用 min/max 两组 maxTokens 各发一次观察截断行为。

### D6【低】token 计量与流式边界完全信任上游回传，usage 缺失时静默失真
- 证据：vendor `parseChunkUsage`（`openai-completions.js:1159-1188`）所有字段 `|| 0` 兜底，`totalTokens` 由这些零兜底值累加；usage 双通道（chunk.usage :362-364 / choice.usage :368-372）任一缺失都不告警；`assembler.ts:85-87` 只保留最后一个 usage chunk，无 usage 时 `_usage` 保持 undefined。
- 复现条件：csu 网关在某类响应（如工具调用流或错误恢复流）上省略 usage 字段。
- 影响面：压缩触发、成本归集、重试预算全部以 usage 为输入；上游裁剪字段时计量静默归零/缺失，长会话可能漏压缩。当前主链路 usage 正常回传（线上会话计量工作正常），**usage 完全缺失时的端到端表现未验证**。
- 修法：流结束仍无 usage 时打 warning 并标注「计量缺失」，压缩决策对零 usage 做保守处理（按消息长度估算兜底）。
- 改动文件数：约 2（`llm-pi-ai/src/stream.ts` + `llm/src/assembler.ts` 或消费方）。
- 未验证：csu 各响应形态下 usage 覆盖率。验证方法：开 debug 日志跑一轮含工具调用的会话，核对每回合 usage chunk 是否在场。

### 观察项（不计入缺陷）
- O1：`stream.ts:108` 对 `DEVELOPER_ROLE_REJECTED` 特判为 terminal 不重试 —— 该语义正确（developer role 400 重试无意义）；配合 D2 修复后此路径仅作为防线保留。
- O2：`effort-probe.ts:21-24` 注释明确探针与 stream 分类器刻意不互复用 —— 两套文本匹配并存，措辞漂移面 ×2（D1 的衍生风险）。
- O3：凭据缺失为双层 fail-loud（仓库 `resolveApiKey` 先抛 + vendor `getClientApiKey` 二次拦截），第二层同样靠文本匹配回收（`stream.ts:101`），归入 D1 一并加固。

---

## 三、修法优先级 Top 5

1. **错误结构化透传**（消 D1）：llm-pi-ai 包装层保留 vendor 错误的 status/cause，stream.ts 分类器结构优先、文本兜底；同步把 `PI_AI_ERROR` 纳入一次性可重试评估。改动约 2-4 文件，收益覆盖所有未来端点。
2. **仓库 compat 默认翻转**（消 D2）：catalog.ts:730-743 未识别端点默认 `supportsDeveloperRole:false` + `catalog.ts:882-903` 风险命中由警告升级为阻断（允许显式 opt-in）；vendor detectCompat 同步。改动约 2 文件。
3. **Qwen contextWindow 显式声明**（消 D3）：实测后写入 D 盘补丁（1 文件）；`config.ts:65/:68` 缺声明改为 warning。
4. **effort 默认 lenient**（消 D4）：adapter.ts 默认走 reasoning-effort.ts:76-110 的就近降级 + warning，strict 改为显式 opt-in；探针 2xx 后校验响应体。改动 1-2 文件。
5. **maxTokens 契约显式化**（消 D5）：实测 csu 对 `max_completion_tokens`/`strict` 字段的行为后，补丁统一声明 maxTokens 与必要的 compat 字段（1 文件），消除对 config.ts 猜测默认与 OpenAI 专属字段名的隐式依赖。

---

## 附：合规确认与未验证清单

- 合规：仅 csu 三模型在用（cordis.patch.yml:20-69），llm-deepseek 两路由 disabled（:77-81），subagent 白名单限 csu/GLM+csu/Qwen（:169-177），无 MiniMax 路由；凭据经 `apiKeyEnv` 注入、无明文落盘；本审查未修改任何源码，D 盘部署文件只读。
- 未验证清单：① csu/Qwen 真实 contextWindow（D3）；② csu 对 `max_completion_tokens`/`strict` 字段的识别（D5）；③ usage 全缺失时的端到端计量表现（D6）。验证方法已随各条附注。
