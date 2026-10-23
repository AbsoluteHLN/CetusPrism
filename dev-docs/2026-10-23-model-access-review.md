# 模型接入链路审查（developer-role 基线之外的缺陷）— 2026-10-23

范围：`packages/llm/llm-pi-ai/src`、`packages/llm/llm/src`、`packages/llm/llm-retry/src`、vendor `@earendil-works/pi-ai@0.87` dist、部署态 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml`（只读）。基线（DEVELOPER_ROLE_REJECTED 分类、developerRoleWarning、reasoningEffort→wire）为上轮成果，本文只列**之外**的发现；每条带 `文件:行号`，未验证处单独标注。

## 一、接入链路全景

| 段 | 位置 | 说明 |
|---|---|---|
| ① 配置 schema | `packages/llm/llm-pi-ai/src/config.ts:334-357`（profile）、`:360-362`（providers dict）、`:266-293`（compat 漂移闸） | `api` 仅允许 `supportedProtocols()`＝completions/responses/anthropic（`provider.ts:47-63`） |
| ② 写校验 | `llm-pi-ai/src/index.ts:175-184`（internal/config）、`config.ts:372-376`（assertServiceable） | 仅校验变更路由 |
| ③ 目录物化 | `config.ts:474-497` → `catalog.ts:1016-1169` resolveRouteModels | catalog 兜底 + 逐字段覆盖；deferred 读保留 modelErrors（:1145-1148） |
| ④ compat 合并 | `catalog.ts:945-985`（模型>路由>installed `base.compat`；api 重指时弃 base 继承 :983） | 未决字段落 pi-ai 检测 |
| ⑤ Provider 物化 | `provider.ts:167-192`；catalog 路由未改 api 时复用 catalog provider（:172，:144-159），保留 API 实现与环境凭据发现 | |
| ⑥ 请求冻结 | `adapter.ts:232-241`（快照）、`:318-324`（prepareCall）、`:330-424`（单快照贯穿全流） | 凭据随快照冻结（:348） |
| ⑦ 上下文转换 | `context.ts:158-164`（system 单槽）、:196-200（中段 system 折叠为 user）、:53（developer 历史拒绝） | |
| ⑧ pi-ai wire | vendor `dist/api/openai-completions.js:1217-1301` detectCompat、:1306-1340 getCompat（`model.compat ?? 检测`）、:187/:197 参数装配与请求 | **独立验证**：Responses 协议无 baseURL 检测，`openai-responses-shared.js:125` `instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system"` —— 仓库 `catalog.ts:723-736` 对非 completions 一律 true，判定正确 |
| ⑨ 流翻译/错误分类 | `stream.ts:267-359`、:96-140 classify、:152-209 mapStopReason | vendor 错误文本=status+body（`dist/utils/error-body.js:111-118`），400/429/5xx 数字可达 |
| ⑩ 失败→重试 | `llm/src/adapter-failure.ts:16-28`、`llm/src/retry-policy.ts:18-24`（默认可重试集）、`llm-retry/src/index.ts:194-241`（:215 按 code 匹配、:227-235 尊重 Retry-After） | |
| ⑪ warnings 面 | `catalog.ts:1001,1147,1155` → `config.ts:220,513` → `llm/src/types.ts:245-277` → `llm-pi-ai/src/index.ts:130-147` → 设置前端 `store.ts:41,64` → `ModelsSection.tsx:420-435` 渲染 | **闭环成立**：消费方存在（UI ModelsSection 渲染 + `tests/provider-form.client.spec.tsx:843-850`） |
| ⑫ token 计量 | `stream.ts:24-37`（mapUsage）、vendor :362-371（chunk.usage/choice.usage 双路径）、`catalog.ts:38`（NO_COST）、`replay.ts:57-66`（历史归零） | 见 D7 说明 |
| ⑬ 凭据语义 | `llm-pi-ai/src/index.ts:186-209`（命名引用缺失 → `MISSING_CREDENTIAL` fail-loud；未命名 → pi-ai 环境发现）、`discovery.ts:240-249`（探针键校验） | 语义闭环 ✓ |

部署态核验（只读）：`cordis.patch.yml:8-19` 为 `csu` 路由补 `compat.supportsDeveloperRole: false`（route 级），并显式收窄 baseURL/models；因已显式声明，新告警面不误报。凭据仅 `apiKeyEnv` 引用名，值未读取、未回显。

## 二、缺陷清单

### D1【中】路由级 `api` 重指后，旧协议 `base.compat` 经 `...base` 残留进 wire 模型
- 证据：`catalog.ts:1126`（模型字面量无条件 `...base`，含 `compat`）+ `resolveModelCompat` 在「改了 api、未配 compat」时返回 `{}`（`catalog.ts:981`；继承被 :983 有意切断）。
- 复现：catalog 路由（如 `anthropic`）设 `api: openai-completions` 指向兼容网关、不写 compat → 物化模型携带 anthropic 形状的 compat。
- 影响：两协议共享的字段（如 `supportsLongCacheRetention`）以旧协议值参与 completions 的 getCompat（vendor :1311-1339），行为与注释 :967-972 宣称相悖；developer-role 告警不受影响（其读取在 risk 判定内独立完成）。
- 修法：`api !== base.api` 时从 floor 中剔除 `base.compat`（改动 1 文件：catalog.ts）。
- **已修（本次）**：`catalog.ts` 的 `resolveModelCompat` 现在判定 `repointed = base !== undefined && base.api !== api`；重指且未配 compat 时返回 `{ compat: {} }`（空块在 pi-ai 侧是「覆盖到检测值之上」的显式空集，而非「无 compat」），重指且配了 compat 时只留配置字段。回归：`tests/catalog.spec.ts` 的 `describe('the compat floor under a repointed api')` 三例（丢弃 / 未重指保留 / 配置字段独占）。

### D2【中】私有网关 compat 误判只对 developer role 有配置期告警
- 证据：告警仅覆盖 `supportsDeveloperRole`（`catalog.ts:875-896,915-925`）；detectCompat 对未识别 URL 其余判定同为"当 OpenAI"：`maxTokensField=max_completion_tokens`（vendor:1264）、`supportsUsageInStreaming=true`（:1262）、`thinkingFormat=openai`/`supportsReasoningEffort=true`（:1261,1269-1279），均直接决定 wire 字段。
- 复现：老网关（one-api/旧 vLLM 系）+ 手声明路由 → `max_completion_tokens` 或 `stream_options`/`reasoning_effort` 被 400 拒绝，分类 INVALID_REQUEST（`stream.ts:117`）终态、无修复指引。
- 影响：与 csu 事故同根（URL 无法自证），每个 quirk 都要一次线上 400 才暴露。
- 修法：① 配置期告警扩展至 `maxTokensField`（与 developer-role 同路径，不阻断路由）；② `stream.ts:117` 增加 `stream_options`/`reasoning_effort` 拒认措辞的分类并附 `compat.*` 指引（1-2 文件）。
- **实测取证（2026-10-23，csu 私有网关 `api.chat.csu.edu.cn/v1`）**：逐变体实测（脚本 `koutput/probe-gateway-wire-fields.mjs`，凭据只报长度）：
  - `max_completion_tokens` → DeepSeek/GLM/Qwen **全部 200**；
  - `stream_options: {include_usage:true}` → 全部 **200**；
  - `reasoning_effort: high` → DeepSeek **200**，GLM **200**，Qwen **400**，措辞 `Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.`。
  - 结论：**① 不成立**。「URL 无法自证」不足以判定 `maxTokensField` / `stream_options` 有风险——真实网关普遍两种都接受；按此扩展会对每个私有网关普遍告警，正是上轮「逐模型刷 8 条预警」的同类错误。配置能力本就存在（`compat.maxTokensField`，`config.ts:272`），缺的是「怎么知道该设」的依据，那只能来自实测。
  - **② 已修（本次）**：新增 `REASONING_EFFORT_REJECTED`（`llm/src/error.ts`）与分类/指引（`llm-pi-ai/src/stream.ts`）。措辞识别要求同时出现 `reasoning effort` 与拒绝类词（unsupported/not support/unknown/unrecognized/invalid/unexpected/not allowed），且排在 400 兜底之前；终态（不在默认重试集）。回归：`tests/adapter.spec.ts` 的 `it('names the effort declaration when the endpoint refuses a reasoning effort')`，用真实样本措辞。

### D3【低】`sendsDeveloperRole` 大小写敏感性偏离 vendor → 漏发预警告
- 证据：仓库对全部 host 做 `lower.includes`（`catalog.ts:733-734`）；vendor 仅 deepseek.com 小写化，其余 host 大小写敏感（vendor:1222-1232）。baseURL 写作 `https://API.Z.AI/v1` 时 vendor 视为未识别 → 发 `developer`；仓库判 false → 不告警。
- 影响：仅预警告缺失（运行时 400 已有 DEVELOPER_ROLE_REJECTED 兜底）。修法：RECOGNIZED 名单改大小写敏感匹配（1 文件）。
- **已修（本次）**：`catalog.ts` 把 `deepseek.com` 从 `RECOGNIZED_NON_OPENAI_HOSTS` 拆出为 `CASE_INSENSITIVE_NON_OPENAI_HOST`（唯一按 vendor 小写化匹配的 host），其余 host 与 openrouter 判定一律改为大小写敏感的 `baseUrl.includes(...)`，与 vendor `detectCompat`（:1222-1232，仅 deepseek 一处 `.toLowerCase()`）逐条对齐。回归：`tests/catalog.spec.ts` 的 `describe('the developer-role risk against the endpoint pi-ai reads')` 三例（`API.Z.AI` 告警 / `api.z.ai` 不告警 / `API.DEEPSEEK.COM` 不告警）。

### D4【低】OpenRouter「模型 id 前缀」规则未复刻
- 证据：vendor `supportsDeveloperRole = isOpenRouter && (id 以 anthropic/ 或 openai/ 开头) || (!isNonStandard && !isOpenRouter)`（vendor:1256,1260）；仓库按 provider/host 名单判 openrouter 一律 false（`catalog.ts:727-729`）。
- 复现：openrouter 路由改指私有网关 + `anthropic/*` 模型 + reasoning → vendor 发 developer、仓库无预警告。
- 修法：`sendsDeveloperRole` 增加 model id 前缀入参（1-2 文件）。
- **已修**（提交 `“fix(llm-pi-ai): answer the developer-role detection per model for OpenRouter” 修复`）：`sendsDeveloperRole` 已按 model id 前缀判定（`anthropic/` / `openai/`），回归见 `tests/catalog.spec.ts` 的 `it('warns for the OpenRouter models pi-ai serves as OpenAI')`。

### D5【低】pi-ai 链路 Retry-After 全程丢失
- 证据：`providerRetryAfterMs` 仅 llm-deepseek 装配（`llm-deepseek/src/transport.ts:36-42`）；pi-ai 错误路径只留 message 文本（vendor `utils/error-body.js:111-118`），header 丢弃；llm-retry 尊重该字段但恒缺省（`llm-retry/src/index.ts:227-235`）。
- 影响：严格限流网关按本地退避（默认上限 10s）反复撞 429。根因同 `stream.ts:39-46` XXX（pi-ai 压平 Error）。本地缓解=调该路由 `retryPolicy.backoff.maxDelayMs`；根治需上游透出 header。

### D6【低】HTTP 408 未分类 → 终态丢弃
- 证据：`stream.ts:96-140` 无 408 分支；`"408: ..."` 落 `PI_AI_ERROR`（终态）。408 属瞬态超时，应进 TIMEOUT/SERVER。
- 修法：在 5xx 分支（`:118`）之后加 `/\b408\b/ → TIMEOUT`（1 文件）。这是「应重试却被丢弃」的唯一实证缺口；其余默认集合（`retry-policy.ts:18-24`）与分类词表经 vendor 全部 12 处截断措辞逐一比对均闭环（`stream.ts:124` 全命中：anthropic:330/605、openai-completions:484、responses:138 与 shared:656、codex:43、azure:99、vertex:211 等）。
- **已修（本次）**：`stream.ts` 的 `classifyPiAiError` 新增 `/\b408\b/ → 'TIMEOUT'`（置于 5xx 之后、timeout 措辞之前）。回归：`tests/adapter.spec.ts` 的 HTTP 映射表新增 `[408, 'TIMEOUT']` 一行。

### D7【低】discovery 对 catalog 路由永不 interrogate 换址后的 baseURL
- 证据：`discovery.ts:275-286`：provider 命中 catalog 即返回目录清单，草稿的 baseURL 不参与；仅 catalog 缺失才走网络。README:129 已声明该取舍，但对「repoint 已有路由的 baseURL」场景会给出误导性候选。修法（可选）：draft baseURL ≠ catalog 端点时改为 interrogate（1 文件）。

### D8【信息】"No API key" 落 `PI_AI_ERROR`，缺凭据语义 code
- 证据：vendor `openai-completions.js:34-40` throw `No API key for provider: …`；`stream.ts:96-140` 无对应分支 → `PI_AI_ERROR`。终态正确（不该重试），但 code 丢失凭据语义。修法（可选，1 文件）：分类器加 `no api key for provider` → `MISSING_CREDENTIAL`。
- **已修（本次）**：`stream.ts` 的 `classifyPiAiError` 新增 `/no api key for provider/i → 'MISSING_CREDENTIAL'`（置于 401/403 之后、quota 之前）。回归：`tests/catalog.spec.ts` 的 `it('leaves an unauthenticated route to its protocol rather than inventing a credential')` 补上 `code: 'MISSING_CREDENTIAL'` 断言。

**缺陷合计 8 条**（D1-D4 行为缺陷，D5-D6 弹性缺口，D7-D8 低危/可观测性）。

## 三、落地状态

| 编号 | 状态 | 落点 |
|---|---|---|
| D1 api 重指残留 `base.compat` | ✅ 已修（本次） | `catalog.ts` `resolveModelCompat` + 3 条回归 |
| D2 compat 告警只覆盖 developer role | ⚠️ 部分落地（实测后收缩） | ② 运行时分类已修（`REASONING_EFFORT_REJECTED`）；① 配置期扩展经实测证伪，不做 |
| D3 大小写敏感偏离 vendor | ✅ 已修（本次） | `catalog.ts` `sendsDeveloperRole` + 3 条回归 |
| D4 OpenRouter 模型 id 前缀 | ✅ 已修（`“fix(llm-pi-ai): answer the developer-role detection per model for OpenRouter” 修复`） | `catalog.ts` + 1 条回归 |
| D5 pi-ai 链路 Retry-After 丢失 | ⏸ 未做 | 根因在上游（pi-ai 压平 Error 链） |
| D6 HTTP 408 未分类 | ✅ 已修（本次） | `stream.ts` `classifyPiAiError` + 1 条回归 |
| D7 discovery 不 interrogate 换址 | ⏸ 未做 | 可选，README 已声明取舍 |
| D8 "No API key" 缺凭据语义 code | ✅ 已修（本次） | `stream.ts` `classifyPiAiError` + 1 条回归 |

回归有效性已反向验证：`git stash push -- packages/llm/llm-pi-ai/src/{catalog,stream}.ts` 后，4 条新用例（D1/D3/D6/D8 各一）全部转红（`4 failed | 358 passed`），恢复后 `362 passed`。

## 四、仍待处理

原来这一节列的是「修法优先级 Top 5」，但那五项在同一文档的落地状态表里已全部落地或被实测证伪——按它动代码会做已经做过的事。留下的是真正还开着的：

| 项 | 状态 | 说明 |
|---|---|---|
| D2① 配置期告警扩展至 `maxTokensField` | **不做** | 实测证伪：csu 网关接受 `max_completion_tokens` 与 `stream_options`（全部 200）。「URL 无法自证」不足以判定这两个字段有风险，按此扩展会对每个私有网关普遍告警——正是上轮「逐模型刷 8 条预警」的同类错误。能力本就存在（`compat.maxTokensField`，`config.ts:272`），缺的是依据，而依据只能来自实测 |
| D5 pi-ai 链路 Retry-After 丢失 | **待上游** | 根因在 pi-ai 压平 Error 链（`stream.ts` 的 XXX 注释）。本地只能靠该路由的 `retryPolicy.backoff.maxDelayMs` 缓解，根治需上游透出 header。2026-10-23 探针顺带实测：csu 网关连发请求即在 openresty 层撞 429（HTML 错误体，无 JSON、无 Retry-After）——分类靠错误文本里的 429 数字仍可达，本地退避是唯一防线 |
| D7 discovery 对换址后的 baseURL 不 interrogate | **可选** | README:129 已声明该取舍。改法是 draft baseURL ≠ 目录端点时改为 interrogate（1 文件） |
| GLM 推理档位声明 | **待用户决定** | 网关接受全部档位，但 GLM 思考 token 不回传（64 tokens 内无 content、无 reasoning_content），声明会「烧 token 不显示」 |
| GLM `contextWindow` 补一行 | **建议补，待用户确认** | 直连实测（2026-10-23，脚本 `koutput/probe-glm-context-window.mjs`，凭据只报长度）：上游校验器原话 `max_model_len=max_total_tokens=262144`，total 校验为「输入+输出 ≤ 262144」（`max_tokens` 16384–200000 均接受，流式首 chunk 即断连，未付长生成）。仓库侧 GLM 条目未声明、内置目录无同 id 条目，物化落 `DEFAULT_CONTEXT_WINDOW = 262_144`（`config.ts:65` 经 `catalog.ts:1109` 兜底）——**与真实值恰好一致，压缩阈值当前无偏差**，此前「不补则触发点晚约一倍」的担忧（基于真实 128K 的假设）实测证伪。仍建议补一行：默认值自述 a guess by construction（`config.ts:130-131`），声明把「猜测恰好命中」换成显式契约，防网关换底座后静默漂移，并与同部署 DeepSeek 条目显式声明 128000 对齐。`maxTokens` 维持不声明：现 cap 32,768，实测 16384–200000 均接受，够用 |

## 未验证项与验证方法

- 各网关对 `stream_options`/`reasoning_effort`/`max_completion_tokens` 的实际拒认措辞（D2 分类词汇需真实样本；可用本地 mock 网关复现，参照 `tests/adapter.spec.ts` 的 http endpoint 手法）。**→ 已取证（csu 网关，见 D2 条目）；`reasoning_effort` 的真实样本已入分类器，其余网关（one-api/旧 vLLM 系）仍无样本。**
- D7 的 UI 侧实际行为（需在 Models 页对已配置路由改 baseURL 后点「获取模型」复测）。
- 复现 profile 单测可仿 `tests/catalog.spec.ts:1046-1108`（warnings 断言）与 `tests/compat-upgrade.spec.ts`（compat 合并）。
