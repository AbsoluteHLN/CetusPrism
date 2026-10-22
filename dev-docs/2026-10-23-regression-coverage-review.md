# 2026-10-23- 回归与覆盖风险核对

范围：`E:\Projects\CetusPrism` @ `release/v1.7.3` HEAD `401f3e82bc`。核对对象为本轮 6 处已推送改动（`f4d90a6f2c` / `e40d84380f` / `171d72117f` / `c00b497ce5` / `1e085e40f8` / `1861ee8d80`）。全程只读仓库，唯一写入为本文件。

核对方法：读源码 + 读测试 + 跑测试 + 用 Node 24 `--experimental-strip-types` 直接调用仓库真实源码做探针（不改任何文件）。每条结论带 `文件:行号` 或「命令 + 退出码 + 输出」。

---

## 结论摘要

1. **本轮改动的测试覆盖整体是「钉住了机制、没钉住效果」**：12 处新用例全部通过，但其中 3 处用例所选夹具无法展示修复声称要解决的现象（D1 用 `zai` 夹具，而 `zai` 的 compat 字段与 `anthropic-messages` 的读取集**交集为空**）。
2. **最高风险：`REASONING_EFFORT_REJECTED` 漏掉部署态自己的措辞。** 新分类器要求「effort 短语 + 拒绝词」同时出现（`packages/llm/llm-pi-ai/src/stream.ts:64-65`），而部署态 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml:28` 记录的 CSU 网关对 DeepSeek 的原话是 `reasoning_effort must be low, high, xhigh, max` —— **不含任何拒绝词**，实测落回 `INVALID_REQUEST`。新码在部署态的 DeepSeek 路由上根本不会触发。
3. **最高风险：压缩预算的文档与注释把阈值说成「窗口的 90%」，实际不是。** 公式是 `min(window×ratio, window − reserved − headroom)`（`packages/compaction/compaction-basic/src/config.ts:191-194`），在 128K 窗 + 32,768 reserved 下阈值是 **87,040 = 窗口的 68%**，`ratio` 根本不是约束项。该错误说法出现在 4 处面向人的文本里。
4. **共享代码默认值没有被绕过。** `packages/llm/llm/src/retry-policy.ts` 与 `packages/compaction/*/src` 本轮**未改**；压缩预算只改 preset / 示例 YAML，服务默认（`0.8` / `65_536`）原样保留并被 `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts:328-342` 钉住。唯一跨部署生效的共享默认值变化在 preset 层，且 preset 可被 profile patch 按 id 覆盖（`packages/bundle/web-app/presets/standard.patch.yml:1-3`）。
5. **跨包契约：无「漏登记」的代码清单，但有两处文档清单漏登记。** `REASONING_EFFORT_REJECTED_CODE` 已由 `packages/llm/llm/src/index.ts:46` 的 `export * from './error.ts'` 导出；「不在默认重试集」这一终态属性被 `packages/llm/llm/tests/retry-policy.spec.ts:16` 的精确集合断言间接钉住。漏的是 `packages/llm/llm-pi-ai/README.md:117` 与 `docs/user/guide/providers.md`（Troubleshooting 段，`:196` 起）两份面向人的 code 清单——`DEVELOPER_ROLE_REJECTED` 与 `REASONING_EFFORT_REJECTED` 两个码都不在其中。
6. **部署态 `csu` 路由不会被 D3 误判。** 实测经真实解析器：`warnings=[]`，三个模型的 `compat` 均为 `{"supportsDeveloperRole":false}`。`api.chat.csu.edu.cn` 不在厂商名单里（改前改后都不在），`sendsDeveloperRole` 两次都是 `true`；真正压住告警的是路由级 `compat.supportsDeveloperRole: false`（`openai-completions` 提供该字段，`catalog.ts:234`）。
7. **既有基线失败与本轮无关。** `packages/llm/llm/tests/invariant.spec.ts:121` 的 `no readable registration` 失败：该文件最后一次改动是 `b9b251a9fd`（2026-10-02 初始导入），本轮窗口（`c00b497ce5~1..401f3e82bc`）内 `packages/llm/llm/tests/` 与 `packages/llm/llm/src/index.ts` 均未被触碰。

---

## 逐项核对

### A. `f4d90a6f2c` — D1/D3/D6/D8（模型接入审查）

#### D1：路由级 `api` 重指后残留 `base.compat`

**判定：⚠️ 有缺口（机制钉住、效果未钉住）**

实现：`packages/llm/llm-pi-ai/src/catalog.ts:945-985`（`resolveModelCompat`），关键三行：
- `catalog.ts:973` — `const repointed = base !== undefined && base.api !== api`
- `catalog.ts:974-982` — 无任何配置项时，重指返回 `{ compat: {} }`，非重指返回 `{}`（不带 `compat` 键）
- `catalog.ts:983` — `const inherited = repointed ? undefined : base?.compat`

之所以必须是「空块」而不是「无 compat」，是因为模型字面量用展开携带旧块：`catalog.ts:1126` 的 `...base` 会把 `base.compat` 留在模型上，`catalog.ts:1137` 的 `...compat` 负责覆盖掉它。

**pi-ai 侧的合并语义（已核对 vendor 源码）**：`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1307-1338` 是**逐字段 `??` 合并**（`model.compat.X ?? detected.X`），`:1308-1310` 仅在 `!model.compat` 时直接返回 `detectCompat(model)`。因此 `compat: {}` 与「无 compat」在 pi-ai 侧等价，都是回落到 baseURL 探测——这正是修复想要的「地板」。空块在**模型字面量**侧才是关键（必须覆盖掉 `...base` 带来的旧块）。

回归用例：
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1430` — 重指丢弃已安装 compat
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1446` — 未重指时保留已安装 compat
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1453` — 重指 + 已配开关，只带配置项

**缺口 1（夹具选错，声称的效果无法被展示）**：提交说明称修的是「两协议共有的字段会保留旧协议的值」。实测各内置条目的 compat 键与 `anthropic-messages` 读取集（`anthropic-messages.js:138-146, 675-782` 所读字段）的交集：

| 条目 | compat 键 | 与 anthropic 共有字段 |
|---|---|---|
| `zai/glm-4.7`（**当前用例的夹具**） | supportsStore, supportsDeveloperRole, supportsReasoningEffort, maxTokensField, thinkingFormat, supportsStrictMode, zaiToolStream | **[] 空** |
| `deepseek/deepseek-v4-pro` | 上列 + `supportsMidConvoSystemMessages` | **`["supportsMidConvoSystemMessages"]`** |

即：`catalog.spec.ts:1430` 用的 `zai` 夹具里**根本不存在共有字段**，它只能证明「compat 块被清空」，证明不了「共有字段不再保留旧值」。真正会泄漏的夹具是 `deepseek` → `anthropic-messages`（`supportsMidConvoSystemMessages` 在 anthropic 侧被 `anthropic-messages.js:141` 读取）。

**缺口 2（wire 层未钉住）**：用例只断言目录层的 `model.compat`，没有任何用例断言请求体上该字段的实际取值。

**缺口 3（边界未钉住）**：路由级 `api` 与模型级 `api` 的交互未覆盖。`catalog.ts:1089` 是 `const api = request.api ?? base?.api ?? routeApi`；`routeApi` 来自 `sharedCatalogApi(defaults)`（`catalog.ts:1071`），当已安装目录的模型协议不一致时为 `undefined`，此时每模型回落到 `base.api`（不重指）。没有用例覆盖「路由不写 `api`、目录内模型协议不一致」这条路径下 `repointed` 的取值。

#### D3：`sendsDeveloperRole` 改为大小写敏感

**判定：⚠️ 有缺口（厂商名单只钉了 2/14）**

实现：`packages/llm/llm-pi-ai/src/catalog.ts:678-683`（`RECOGNIZED_NON_OPENAI_HOSTS`，14 个 host，`deepseek.com` 移出）、`catalog.ts:691`（`CASE_INSENSITIVE_NON_OPENAI_HOST = 'deepseek.com'`）、`catalog.ts:723-736`（`sendsDeveloperRole`，`:733` 改为大小写敏感、`:734` 单独保留 deepseek 的大小写不敏感）。

**vendor 前提已核对**：`dist/api/openai-completions.js:1222` 为 `baseUrl.includes("api.z.ai")`（大小写敏感）、`:1232` 为 `baseUrl.toLowerCase().includes("deepseek.com")`（大小写不敏感）。与 `catalog.ts:672-676` 的注释一致 ✅。

回归用例：`packages/llm/llm-pi-ai/tests/catalog.spec.ts:1479`（`https://API.Z.AI/v1` → 告警）、`:1487`（`https://api.z.ai/v1` → 无告警）、`:1491`（`https://API.DEEPSEEK.COM/v1` → 无告警）。

**缺口 4**：14 个大小写敏感 host 只测了 `api.z.ai` 一个，其余 13 个（`open.bigmodel.cn` / `api.together.ai` / `api.together.xyz` / `api.moonshot.` / `openrouter.ai` / `api.cloudflare.com` / `gateway.ai.cloudflare.com` / `integrate.api.nvidia.com` / `api.ant-ling.com` / `cerebras.ai` / `api.x.ai` / `chutes.ai` / `opencode.ai`）的大小写行为无断言。

**缺口 5（潜在漂移，无守卫）**：镜像名单与 pi-ai `detectCompat` 的一致性没有任何测试钉住。当前两者**是同步的**（逐一比对 `dist/api/openai-completions.js:1217-1246` 与 `catalog.ts:678-703`，14 个 host + 13 个 provider id 全部对应）。但一次 pi-ai 升级新增厂商 host 时，镜像会静默失配：镜像会**继续发出** developer-role 告警而 pi-ai 其实不发送（假阳性），或镜像继续压住告警而 pi-ai 真的发送（假阴性）。没有漂移守卫测试。

**缺口 6（未被测到的分支）**：`developerRoleRisk` 里 `OPENAI_FAMILY_HOSTS`（`catalog.ts:810-816`）用的是**小写化匹配**（`catalog.ts:897`），与 `RECOGNIZED_NON_OPENAI_HOSTS` 的大小写敏感规则**方向相反**。这个不对称是安全的（两个名单都是「无风险」豁免方向），但没有任何用例覆盖 `https://API.OPENAI.COM/v1` 这类大小写变体。

#### D6：HTTP 408 → `TIMEOUT`

**判定：⚠️ 有缺口（分类钉住，重试行为未钉住）**

实现：`packages/llm/llm-pi-ai/src/stream.ts:73-76`。

回归用例：`packages/llm/llm-pi-ai/tests/adapter.spec.ts:379-391` 的 `it.each` 中新增 `[408, 'TIMEOUT']`（`:382`）。

**缺口 7（跨包行为未钉住）**：`TIMEOUT` 在 `packages/llm/llm/src/retry-policy.ts:18-24` 的 `DEFAULT_RETRYABLE_CODES` 里，所以 D6 把一个**终态**失败（此前落 `PI_AI_ERROR`）变成了**可重试**失败（默认最多 5 次）。这是本轮唯一改变「失败会不会被重发」的改动，且作用于**所有** pi-ai 路由。但没有任何测试钉住「pi-ai 的 408 会被重试」这条端到端链路：`packages/llm/llm-retry/tests/retry.spec.ts` 只覆盖了 `EMPTY_RESPONSE`（`:252`）与显式 `retryableCodes` 覆盖场景。

**缺口 8（顺序边界未钉住）**：`stream.ts:71` 的 400 兜底在 `:76` 的 408 之前，所以「body 里带 408 的 400」判为 `INVALID_REQUEST`（实测确认）。这是对的，但没有用例钉住这个顺序。同理 `:72` 的 5xx 在 408 之前。

#### D8：`no api key for provider` → `MISSING_CREDENTIAL`

**判定：✅ 有测试钉住（边界有小缺口）**

实现：`packages/llm/llm-pi-ai/src/stream.ts:49-52`；vendor 抛出处 `dist/api/openai-completions.js:39`。

回归用例：`packages/llm/llm-pi-ai/tests/catalog.spec.ts:395` 在既有用例上补了 `code: 'MISSING_CREDENTIAL'` 断言。

**缺口 9（文案缺口）**：该 code 落到 `packages/llm/llm-pi-ai/src/stream.ts:155-157` 的指引分支时既不是 `DEVELOPER_ROLE_REJECTED_CODE` 也不是 `REASONING_EFFORT_REJECTED_CODE`，因此**不附加任何可操作指引**，操作员只看到 pi-ai 的原始串 `No API key for provider: local-llm`。对比 `llm-deepseek` 的同名失败会点名要修的引用（`packages/llm/llm-deepseek/README.md:118`）。没有用例断言 D8 应带指引。

### B. `e40d84380f` — Models 页「诊断必须有出口」

**判定：⚠️ 有缺口（正常行路径已钉住，setup 卡路径未钉住）**

实现：`packages/client/ui-settings-models/src/client/ModelsSection.tsx:417-425`（`warnings` 渲染，含 `[...new Set(row.entry.warnings)]` 去重）、`:432-439`（`modelErrors`）、`:441-448`（setup 卡路径）、`:538-539`（正常行路径）。

回归用例：`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx:900` —「shows every diagnostic a route carries at once」，同一条路由同时带 route-level failure + risk + per-model failure，断言三者都出现在 `row.textContent` 中。

**缺口 10（setup 卡路径无覆盖）**：`:445-448` 的 setup 卡分支同样渲染 `{error}{warnings}{modelErrors}`，但三个相关用例（`:841` / `:871` / `:900`）用的路由都带 `settingsPath: ['providers','openai']`，而 `needsSetup`（`ModelsSection.tsx:169-173`）在 `row.entry.settingsPath.length > 0` 时直接返回 `false`——**永远走不到 setup 卡**。该分支无任何断言。

**缺口 11（去重未覆盖）**：`ModelsSection.tsx:424` 的 `new Set` 去重无断言（重复 warning 应只渲染一次）。

### C. `171d72117f` — `REASONING_EFFORT_REJECTED`

**判定：❌ 有风险（部署态自己的措辞不被识别）**

实现：
- `packages/llm/llm/src/error.ts:82` — `export const REASONING_EFFORT_REJECTED_CODE = 'REASONING_EFFORT_REJECTED'`
- `packages/llm/llm-pi-ai/src/stream.ts:60-67` — 分类器
- `packages/llm/llm-pi-ai/src/stream.ts:155-157` — 指引接线
- `packages/llm/llm-pi-ai/src/stream.ts:189-206` — `reasoningEffortGuidance`

回归用例：`packages/llm/llm-pi-ai/tests/adapter.spec.ts:393-417`，用真实样本措辞 `Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.`，断言 code 与指引文案。

**实测分类结果**（Node 探针，直接调用真实 `mapStopReason`；pi-ai 的错误串格式为 `"<status>: <body>"`，见 `dist/utils/error-body.js:111-118`）：

| 输入 | 分类 |
|---|---|
| `400: {"error":{"message":"Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low."}}`（用例样本 / CSU Qwen） | `REASONING_EFFORT_REJECTED` ✅ |
| `400: {"error":{"message":"Invalid value for 'reasoning_effort': 'high'. Supported values are: 'low', 'medium'."}}`（OpenAI 风格） | `REASONING_EFFORT_REJECTED` ✅ |
| `400: {"error":{"message":"reasoning_effort must be low, high, xhigh, max"}}`（**CSU DeepSeek 原话**） | **`INVALID_REQUEST`** ❌ |
| `400: {"error":{"message":"Invalid request: missing required parameter"}}`（普通 400） | `INVALID_REQUEST` ✅（无误报） |
| `408: {"error":{"message":"Request Timeout"}}` | `TIMEOUT` ✅ |
| `408: upstream request timeout` | `TIMEOUT` ✅ |
| `No API key for provider: local-llm` | `MISSING_CREDENTIAL` ✅ |
| `400: {"error":{"message":"context window is 408 tokens"}}` | `INVALID_REQUEST` ✅（400 先于 408） |
| `400: {"error":{"message":"Unexpected message role."}}` | `DEVELOPER_ROLE_REJECTED` ✅（未被新规则挤掉） |

**缺口 12（本轮最高风险）**：`stream.ts:65` 的拒绝词表是 `unsupported|not\s+support|unknown|unrecognized|invalid|unexpected|not\s+allowed`，**不含 `must be` / `must be one of` / `expected`**。部署态 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml:26-29` 白纸黑字记着 CSU 网关对 DeepSeek 的原话是 `reasoning_effort must be low, high, xhigh, max`——该串点名了被拒的 effort，却因缺少拒绝词而落回 `INVALID_REQUEST`，操作员拿不到「该改哪一行」的指引。用例只钉住了 Qwen 措辞。

**缺口 13（拒绝词表过宽的副作用）**：拒绝词含 `invalid` / `unexpected`，任何提到 `reasoning effort` 的 400 都会改判为 `REASONING_EFFORT_REJECTED`（实测 `400: {"error":{"message":"invalid reasoning effort given"}}` → 新码）。两者都是终态，重试行为不变，只影响文案与分类，无用例界定这一取舍。

**缺口 14（终态属性只被间接钉住）**：「不进默认重试集」由 `packages/llm/llm/tests/retry-policy.spec.ts:16` 的精确集合断言 `['EMPTY_RESPONSE','RATE_LIMIT','SERVER','TIMEOUT','TRANSPORT']` 间接保证 ✅（误登记会让该用例转红）。但没有用例直接断言 `REASONING_EFFORT_REJECTED` 不被重试。

### D. `c00b497ce5` — warnings → 配置面闭环

**判定：✅ 主体有测试钉住（两处分支未覆盖）**

实现：
- `packages/llm/llm/src/types.ts:268-276` — `LlmConfigurableProvider.warnings`
- `packages/llm/llm-pi-ai/src/index.ts:127-146` — `directoryEntries` 携带 warnings
- `packages/llm/llm-pi-ai/src/catalog.ts:810-816` — `OPENAI_FAMILY_HOSTS`
- `packages/llm/llm-pi-ai/src/catalog.ts:880-899` — `developerRoleRisk`（去重后的路由级判定）
- `packages/llm/llm-pi-ai/src/catalog.ts:905-925` — `developerRoleWarning`（一条路由一条，模型名内嵌）
- `packages/llm/llm-pi-ai/src/catalog.ts:1081` — `catalogEndpoint = request.baseURL === undefined`
- `packages/client/ui-settings-models/src/client/store.ts:34-42, :64` — `ProviderDirectoryEntry.warnings` 与 join
- `packages/client/ui-settings-models/src/client/ModelsSection.tsx:417-425, :447, :538`
- `packages/client/ui-settings-models/src/client/locales.ts:36, :168` — `configRisk` 词条（en/zh）
- `packages/client/ui-settings-models/src/client/ModelsSection.module.css:631-646`

回归用例：
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1086` — 已安装目录背书的路由不告警（含把 OpenAI 端点写出来也不告警）
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1105` — 一条路由只出一条告警，模型名内嵌，非推理模型不点名
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1339` — 风险随目录条目走到配置面，且不夺走路由的服务能力
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts:1355` — 部署已作答的风险被丢弃
- `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx:841` — 风险显示在它所属的路由旁
- `packages/client/ui-settings-models/tests/store.client.spec.ts:19-27` — 风险随 join 落到行上

i18n 完整性由**类型层面**保证：`locales.ts:165` 的 `zh: { [Key in keyof typeof en]: string }`，漏登记 `configRisk` 会编译失败 ✅。

**缺口 15（`OPENAI_FAMILY_HOSTS` 分支未覆盖）**：`catalog.ts:897` 这条「OpenAI 自家 API 域不告警」的豁免只在 `catalog.spec.ts:1086-1103` 以小写 `https://api.openai.com/v1` 覆盖过；`catalog.ts:810-816` 里的 `chatgpt.com` / `openai.azure.com` / `cognitiveservices.azure.com` / `azure-api.net` 四个域无任何用例。

**缺口 16（`catalogEndpoint` 判据未覆盖）**：`catalog.ts:1081` 以「是否写了 `baseURL`」区分「目录端点」与「部署自选端点」。判据本身被 `catalog.spec.ts:1086-1103` 间接覆盖，但「写了与目录完全相同的 baseURL」这一等价情形无用例。

### E. `1e085e40f8` — 逐模型失败带到配置面（同批上下文）

**判定：✅ 有测试钉住**

实现：`packages/llm/llm-pi-ai/src/index.ts:138-146`（`modelErrors`）、`packages/llm/llm/src/types.ts`、`packages/client/ui-settings-models/src/client/store.ts`、`ModelsSection.tsx:432-439, :448, :539`。

回归用例：`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx:871` —「shows a per-model failure beside the route that still serves」；`packages/client/ui-settings-models/tests/store.client.spec.ts:29-37` — 逐模型失败随 join 落到仍能服务的行上。

### F. `1861ee8d80` — 压缩预算对齐

**判定：❌ 有风险（GLM 示例未被钉住 + 面向人的数字说错）**

实现：`packages/bundle/web-app/presets/standard.patch.yml:90-96`（`thresholdRatio: 0.9` / `headroomTokens: 8192`）、`apps/cli/config/examples/glm-harness/cordis.yml:42-50`（同样两个值）。

回归用例：
- `packages/bundle/web-app/tests/compaction-budget.spec.ts:48-58` — 读出厂 preset，断言 `87_040 / 159_040 / 221_184`
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts:328-342` — 断言服务默认给 `29_696 / 101_696 / 163_840`

**算术已核对**（公式 `packages/compaction/compaction-basic/src/config.ts:191-194`：`thresholdTokens = floor(min(window×ratio, window − reserved − headroom))`；`reserved = 32_768`）：

| window | 默认（0.8 / 65_536） | preset（0.9 / 8_192） | preset 实际占窗比 |
|---|---|---|---|
| 128_000 | 29_696 | 87_040 | **68.0%** |
| 200_000 | 101_696 | 159_040 | **79.5%** |
| 262_144 | 163_840 | 221_184 | **84.4%** |

**缺口 17（GLM 示例无守卫）**：`packages/bundle/web-app/tests/compaction-budget.spec.ts:34-36` 只读 `../presets/standard.patch.yml`。同一提交在 `apps/cli/config/examples/glm-harness/cordis.yml:42-50` 加了同样两个值，**没有任何测试读它**。`apps/cli/tests/profiles/headless/tests/glm-harness.e2e.ts` 会加载该 overlay，但只验证组合能跑通，不校验预算数字。标准 preset 的漂移被守住了，GLM 示例的漂移没有——正是本提交想防的那类漂移。

**缺口 18（面向人的数字说错，4 处）**：preset 注释（`standard.patch.yml:91-94`）、GLM 注释（`cordis.yml:43-47`）、`docs/user/guide/glm-harness.md:21`、`docs/user/guide/glm-harness.zh.md:21` 都写「在模型上下文窗口的 90% 处触发压缩」。实测在 128K 窗上是 **68%**——`ratio` 不是约束项，约束项是 `headroomTokens` 与 reserved（`window − reserved − headroom`）。ratio 要到窗口 ≥ `(32768+8192)/(1−0.9) = 409_600` 才成为约束。操作员按 90% 理解会误判会话还剩多少上下文。

**缺口 19（reserved 未被钉住）**：两个用例都把 `reservedCompletionTokens` 固定成 `32_768`。部署态 `csu` 的 DeepSeek 路由未声明 `maxTokens`，因此回落到 `packages/llm/llm-pi-ai/src/config.ts:68` 的 `DEFAULT_MAX_TOKENS = 32_768`——**今天恰好等于夹具**，但这条联系没有任何测试钉住。路由一旦声明 `maxTokens`，阈值会静默移动（例如 reserved 变 64_512 时 128K 阈值掉到 54_272，只有窗口的 42%）。

---

## 未覆盖的测试缺口

按优先级排序。每条给出该加在哪个文件哪一行附近、断言什么。

### P0-1 ｜ `REASONING_EFFORT_REJECTED` 漏掉部署态自己的措辞

- **位置**：`packages/llm/llm-pi-ai/tests/adapter.spec.ts`，紧邻 `:393-417` 的既有用例之后（建议 `:418` 起）。
- **用例**：`it('names the effort declaration when the gateway states the levels it takes')`
- **断言**：mock server 回 `400` + body `{"error":{"message":"reasoning_effort must be low, high, xhigh, max"}}`；断言 `failure.code === 'REASONING_EFFORT_REJECTED'` 且 `failure.message` 含 `reasoningEfforts`。
- **配套改动**：`packages/llm/llm-pi-ai/src/stream.ts:65` 的拒绝词表需覆盖 `must be` / `expected` 一类措辞（或改为「effort 短语 + 出现枚举档位」的判据）。

### P0-2 ｜ GLM 示例的压缩预算无守卫

- **位置**：新建 `packages/bundle/web-app/tests/compaction-budget.spec.ts`（与 `:48-58` 的 preset 用例并列），或扩该文件。
- **用例**：`it('gives the GLM composition the same shaped budget')`
- **断言**：读 `apps/cli/config/examples/glm-harness/cordis.yml`，用 `loadCordisYaml` 解析出 `compaction-basic` 行，`resolveConfig` + `resolveTargetPolicy` + `resolveCompactSpec` 后断言 `thresholdOf(128_000) === 87_040` / `thresholdOf(200_000) === 159_040`。
- **注意**：跨仓读 `apps/cli/...` 需要用 `new URL('../../../../apps/cli/config/examples/glm-harness/cordis.yml', import.meta.url)`。

### P0-3 ｜ 面向人的「90%」说法与实际不符

- **位置**：`packages/bundle/web-app/presets/standard.patch.yml:91-94`、`apps/cli/config/examples/glm-harness/cordis.yml:43-47`、`docs/user/guide/glm-harness.md:21`、`docs/user/guide/glm-harness.zh.md:21`。
- **断言**：文案改为「窗口减去一次输出预留与一小段摘要余量（128K 窗上约为 68%）」之类的事实描述；或补一条用例断言「注释里写的百分比 = 实测阈值 / 窗口」。
- **建议**：在 `packages/bundle/web-app/tests/compaction-budget.spec.ts` 加一条 `it('describes the threshold it actually computes')`，把阈值占窗比写进断言，避免文案再次漂移。

### P1-4 ｜ D1 的夹具无法展示共有字段泄漏

- **位置**：`packages/llm/llm-pi-ai/tests/catalog.spec.ts:1430` 之后（建议 `:1445`）。
- **用例**：`it('drops the field the two protocols share when a route repoints the api')`
- **断言**：用 `deepseek` 路由、`api: 'anthropic-messages'`、模型 `deepseek-v4-pro`；断言 `model.compat` 不含 `supportsMidConvoSystemMessages`（当前夹具 `zai` 无法体现这一条）。

### P1-5 ｜ D6 改变了失败的可重试性，无跨包断言

- **位置**：`packages/llm/llm-retry/tests/retry.spec.ts`，紧邻 `:252` 的 `EMPTY_RESPONSE` 用例之后。
- **用例**：`it('retries a provider timeout under the default retryable codes')`
- **断言**：用 `code: 'TIMEOUT'` 的失败，断言发生一次重试后成功（与 `retry.spec.ts:252` 同形）。

### P1-6 ｜ setup 卡路径的风险/失败渲染无覆盖

- **位置**：`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx`，紧邻 `:900` 之后。
- **用例**：`it('shows every diagnostic on the first-run setup card')`
- **断言**：构造 `settingsPath: []` 且 `credential.configured !== true` 的路由（使 `needsSetup` 为真，见 `ModelsSection.tsx:169-173`），断言 setup 卡内同时出现 route failure、risk、per-model failure。

### P1-7 ｜ 厂商名单与 pi-ai 探测的一致性无守卫

- **位置**：`packages/llm/llm-pi-ai/tests/catalog.spec.ts:1479-1495` 之后（建议 `:1496`）。
- **用例**：`it('mirrors the hosts pi-ai itself recognises')`
- **断言**：对 `RECOGNIZED_NON_OPENAI_HOSTS` 的每个 host 各写一个大小写变体，断言告警出现；并断言 `deepseek.com` 的任意大小写都不告警。更好的做法是把名单与 pi-ai 的 `detectCompat` 对照（vendor 源码在 `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1217-1246`），升级后自动转红。

### P2-8 ｜ D8 失败没有可操作指引

- **位置**：`packages/llm/llm-pi-ai/tests/catalog.spec.ts:395` 所在用例。
- **断言**：若决定补指引，则断言 `failure.message` 点名要补的凭据引用（形如 `apiKeyEnv`）；当前实现（`stream.ts:155-157`）只对两个 code 加指引。

### P2-9 ｜ `OPENAI_FAMILY_HOSTS` 其余四个域未覆盖

- **位置**：`packages/llm/llm-pi-ai/tests/catalog.spec.ts:1086` 之后。
- **断言**：`chatgpt.com` / `openai.azure.com` / `cognitiveservices.azure.com` / `azure-api.net` 各一条，均 `warnings` 为空。

### P2-10 ｜ 去重渲染未覆盖

- **位置**：`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx:900` 之后。
- **断言**：路由带两条相同 warning 时，行内该文案只出现一次（`ModelsSection.tsx:424`）。

### P2-11 ｜ reserved 与 maxTokens 的联系未钉住

- **位置**：`packages/bundle/web-app/tests/compaction-budget.spec.ts:48` 之后。
- **断言**：补一条「reserved 变化时阈值随之变化」的用例（如 `reserved = 65_512` 时 128K 阈值为 `54_272`），把「预算依赖模型输出预留」这一事实写进断言。

---

## 共享包影响面判定

| 包 | 本轮改了什么 | 是否影响**不使用**该包的会话 | 隔离机制 | 是否绕过隔离改了共享默认值 |
|---|---|---|---|---|
| `packages/llm/llm` | `src/error.ts`（+`REASONING_EFFORT_REJECTED_CODE`）、`src/types.ts`（+`warnings` 字段） | 否。两处都是**纯增量**（新常量 / 新可选字段），不改任何既有语义 | 不需要（增量） | **否**。`src/retry-policy.ts` 本轮未改，默认可重试集仍是 `['EMPTY_RESPONSE','RATE_LIMIT','SERVER','TIMEOUT','TRANSPORT']`（`retry-policy.ts:18-24`，被 `packages/llm/llm/tests/retry-policy.spec.ts:16` 精确钉住） |
| `packages/llm/llm-pi-ai` | `src/catalog.ts`（D1 / D3 / warnings 规则）、`src/stream.ts`（D6 / D8 / 新码） | **是**——只要会话用了任一 pi-ai 路由就受影响（`stream.ts` 的分类器对所有 pi-ai 路由生效） | **没有 preset/底座开关**。D1/D3/D6/D8 都是共享包里的无条件代码改动，隔离只能靠路由自身的配置 | **否**（未改共享默认值），但 **D6 把 408 从终态改成可重试**，等于改了所有 pi-ai 路由的失败语义，且无跨包测试（见 P1-5） |
| `packages/compaction/*` | **未改任何 `src`**。只改了 `packages/bundle/web-app/presets/standard.patch.yml` 与 `apps/cli/config/examples/glm-harness/cordis.yml` 两个 YAML | 否（服务默认原样） | preset / 示例 overlay | **否**。服务默认 `thresholdRatio = 0.8`（`packages/compaction/compaction-basic/src/config.ts:20`）、`headroomTokens = 65_536`（`:75`）未被改，且被 `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts:328-342` 钉住 |
| `packages/bundle/web-app` | `presets/standard.patch.yml:90-96` 加了 compaction-basic 的 config | **是**——所有跑 standard preset 的 Web 部署的压缩点都变了 | **preset**。`standard.patch.yml:1-3` 明写「Edits saved from the Web editor override this row's `config.plugins` by id from the profile patch」，即 profile patch 可按 id 覆盖 | preset 本身**就是**共享默认值，但它是**有意的、可被 profile patch 覆盖的**部署层默认值，且有 `packages/bundle/web-app/tests/compaction-budget.spec.ts:48-58` 钉住 |
| `packages/client/ui-settings-models` | `store.ts` / `ModelsSection.tsx` / `locales.ts` / CSS | 只影响打开 Models 设置页的会话 | 页面自身 | 否（纯增量渲染） |

**结论**：本轮**没有任何改动绕过隔离直接改了共享的代码默认值**。唯一的跨部署生效的共享默认值变化在 preset 层（`packages/bundle/web-app/presets/standard.patch.yml`），这是该提交的明示意图，且该 preset 可被 profile patch 按 id 覆盖。需要点名的是 `packages/llm/llm-pi-ai` 的 D6：它没有 preset 开关，是共享包里的无条件语义变更（终态 → 可重试），影响面覆盖全部 pi-ai 路由。

---

## 部署态耦合判定

对象：`D:\Cetus\dshconfig\profiles\web\cordis.patch.yml`（只读）。

### `csu` 路由与 D3（大小写敏感）

**判定：✅ 不被误判。** 实测经真实解析器 `resolveProfiles`：

```
[csu-as-deployed] route=csu catalogError=undefined
[csu-as-deployed] warnings=[]
[csu-as-deployed] model=DeepSeek api=openai-completions baseUrl=https://api.chat.csu.edu.cn/v1 compat={"supportsDeveloperRole":false}
[csu-as-deployed] model=GLM     api=openai-completions baseUrl=https://api.chat.csu.edu.cn/v1 compat={"supportsDeveloperRole":false}
[csu-as-deployed] model=Qwen    api=openai-completions baseUrl=https://api.chat.csu.edu.cn/v1 compat={"supportsDeveloperRole":false}
```

理由链：
- `api.chat.csu.edu.cn` 不在 `RECOGNIZED_NON_OPENAI_HOSTS`（`catalog.ts:678-683`）里，**改前改后都不在**——改前是 `lower.includes(host)`，改后是 `baseUrl.includes(host)`，两者结果相同。所以 D3 对 csu 的 `sendsDeveloperRole` 取值**没有变化**（都是 `true`，即 pi-ai 会发 developer role）。
- 真正压住告警的是路由级 `compat.supportsDeveloperRole: false`（部署态 `:16-19`）。`developerRoleRisk`（`catalog.ts:888-889`）先查路由级再查模型级，命中即 `return false`。
- 该字段对 `openai-completions` 是 `offer`（`catalog.ts:234`），因此不会被 `assertOfferedCompatFields` 拒绝、也不会被 `catalog.ts:955` 的「不提供就跳过」静默丢弃。
- 反向验证（把开关去掉）：

```
[csu-switch-removed] warnings=["llm-pi-ai: provider \"csu\" models \"DeepSeek\", \"Qwen\" are reasoning models on an endpoint pi-ai resolves as OpenAI, ... Set `compat.supportsDeveloperRole: false` on this route or on the model entries so they travel as `system`."]
[csu-switch-removed] model=DeepSeek ... compat=undefined
[csu-switch-removed] model=GLM     ... compat=undefined
```

  告警正确点名了 DeepSeek 与 Qwen 两个推理模型，且**正确排除了 GLM**（GLM 未声明 `reasoningEfforts`）。路由级开关的效果与文案均正确。

### `csu` 路由与 D1（重指）

**判定：✅ 不受影响。** 部署态 `csu` 的 `api: openai-completions`（`:14`）与模型协议一致，无重指；`csu` 不在 pi-ai 内置目录里，故 `base === undefined` → `repointed` 恒为 `false`（`catalog.ts:973`）→ `resolveModelCompat` 走非重指分支。实测 `compat=undefined`（无 compat 键）→ pi-ai 侧回落到 baseURL 探测，符合预期。

### `csu` 路由与 D6 / D8

**判定：✅ 无耦合。** 两者只改错误分类，不改路由解析。

### `csu` 路由与 `REASONING_EFFORT_REJECTED`

**判定：❌ 有风险（且是本轮最重要的部署态缺口）。**

- **档位声明本身是自洽的**：`DeepSeek` 声明 `off/low/high/xhigh/max`（部署态 `:30-35`），`Qwen` 声明 `off/low/medium/xhigh`（`:47-51`）；部署态选用的档位 `agent-default-model.reasoningEffort: max`（`:57`）与 `chatReasoningEffort: xhigh`（`:124`）都在声明范围内 → 正常不会触发新码。
- **但网关的拒绝措辞不被新分类器识别**：部署态 `:28` 记录的 CSU 对 DeepSeek 的原话是 `reasoning_effort must be low, high, xhigh, max`，实测分类为 `INVALID_REQUEST`（见 P0-1 的实测表）。**新码在部署态的 DeepSeek 路由上不会触发**，操作员看到的仍是「无效请求」而没有「改 `reasoningEfforts` 声明」这一行指引。
- **噪音风险（低）**：拒绝词表含 `invalid` / `unexpected`，任一提到 `reasoning effort` 的 400 都会改判为 `REASONING_EFFORT_REJECTED`。两者都终态，重试行为不变，只影响分类与文案，无用例界定。

### `csu` 路由与压缩预算（`1861ee8d80`）

**判定：⚠️ 有影响，无部署态守卫。**

- 部署态 `:61-62` 是 `agent-preset-registry: default: standard / selectedDefault: standard`，且**全文没有覆盖 `compaction` 组**（已检索 `compaction|thresholdRatio|headroom|agent-preset`）→ 部署态吃的是 standard preset 的**新**预算。
- `csu` 的 `DeepSeek` 声明 `contextWindow: 128000`（部署态 `:36`），未声明 `maxTokens` → 回落 `packages/llm/llm-pi-ai/src/config.ts:68` 的 `DEFAULT_MAX_TOKENS = 32_768`。
- 于是该路由的压缩触发点从 **29,696**（旧默认）移到 **87,040**（新 preset），占 128K 窗的 **68%**，不是文档所说的 90%（见 P0-3）。
- 部署态无任何测试守护这些数字。

---

## 未验证项与验证方法

以下内容**我没有实际跑过**，只做了只读推理或源码阅读，判断以「未验证」标注。

1. **「撤掉修复后测试转红」的实际红/绿实验——未验证（且在本轮约束下不可执行）。**
   任务说明给的路径是 `git stash push -- <单个文件>` + `git stash pop`，但本次仓库工作区**是干净的**（`git -C 'E:\Projects\CetusPrism' status --short` 输出为空），修复已随提交入库，`git stash push` 没有可暂存的内容；要把源码退回修复前，只能用 `git checkout` 或直接改 `packages/` 下的源文件，而两者都被「仓库与约束（必须遵守）」明确禁止（禁止 `git checkout`、禁止修改 `packages/` 下源文件）。因此按任务给出的兜底口径「若不确定就改用只读推理并标注未验证」执行。
   **已做的替代验证（只读、不改仓库）**：
   - 用 Node 24 `--experimental-strip-types` 直接 import 仓库真实源码，调用真实的 `resolveProfiles` 与 `mapStopReason`，得到上文所有实测输出（探针为 `node -e` 内联 base64，无临时文件）。
   - 逐条推理断言与被撤代码的对应关系：D1 的三条断言在 `resolveModelCompat` 返回 `{}`（而非 `{compat:{}}`）时，`catalog.spec.ts:1430` 的 `expect(model?.compat).toEqual({})` 会因拿到 zai 的 compat 块而失败——**判定：会转红**；D3 的三条断言在 `baseUrl.toLowerCase().includes(host)` 复辟时，`catalog.spec.ts:1479`（`API.Z.AI` 应告警）会失败而 `:1487`/`:1491` 仍绿——**判定：会转红**；D6 的 `[408,'TIMEOUT']`（`adapter.spec.ts:382`）在 408 分支移除后会落 `PI_AI_ERROR` 而失败——**判定：会转红**；D8 的 `code:'MISSING_CREDENTIAL'`（`catalog.spec.ts:395`）在分类分支移除后会落 `PI_AI_ERROR` 而失败——**判定：会转红**；新码用例（`adapter.spec.ts:409-415`）在分类器移除后会落 `INVALID_REQUEST` 而失败——**判定：会转红**。以上均为推理，**未实测**。

2. **完整测试套件未全跑。** 只跑了 `packages/llm/llm`、`packages/llm/llm-pi-ai`、`packages/client/ui-settings-models`、`packages/bundle/web-app`、`packages/compaction/compaction-basic` 五个包。`apps/cli`、`apps/web`、`packages/llm/llm-retry`、`packages/llm/llm-deepseek`、`packages/core/agent-loop` 等**未跑**。全仓 `pnpm test` 未执行。

3. **`apps/cli/tests/profiles/headless/tests/glm-harness.e2e.ts` 未跑**（e2e，需要本地 wire 端点与 loader smoke）。因此「GLM overlay 能加载」只是读代码推断，未实测。

4. **D6 端到端重试行为未实测。** 只确认了 `TIMEOUT ∈ DEFAULT_RETRYABLE_CODES`（`retry-policy.ts:22`）与分类器返回 `TIMEOUT`（实测），没有实际跑一次「pi-ai 408 → 自动重试」的端到端。

5. **pi-ai 升级后的镜像漂移未验证。** 只核对了当前锁定的 `pi-ai@0.87` 的 `detectCompat`（`dist/api/openai-completions.js:1217-1246`）与镜像名单一致；未来版本是否一致无法验证。

6. **部署态端到端行为未实测。** `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml` 全程只读，未启动该部署、未发真实请求。所有关于部署态的结论均由「用真实解析器喂入部署态配置」推得（探针输出见上），或由部署态文件文本推得。

7. **「90%」说法的纠正文案未落地。** 本文件只指出四处文本与实测不符（P0-3），未修改它们（超出本任务写入范围）。

---

## 附：实际执行的命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git -C 'E:\Projects\CetusPrism' status --short` | 0 | 空输出（工作区干净） |
| `git -C 'E:\Projects\CetusPrism' log --oneline 1861ee8d80..401f3e82bc` | 0 | 5 个提交：`401f3e82bc` `171d72117f` `e40d84380f` `3f54f909ae` `f4d90a6f2c` |
| `git -C 'E:\Projects\CetusPrism' log --oneline c00b497ce5~1..401f3e82bc -- packages/llm/llm/src packages/llm/llm/tests` | 0 | 仅 `src/error.ts`（`171d72117f`、`d617b6912f`）与 `src/types.ts`（`1e085e40f8`、`c00b497ce5`）；`tests/` 未被触碰 |
| `git -C 'E:\Projects\CetusPrism' log --oneline c00b497ce5~1..401f3e82bc -- packages/llm/llm/tests/invariant.spec.ts` | 0 | 空输出 → 本轮未触碰该文件 |
| `node ... vitest.mjs run --root 'E:\Projects\CetusPrism' --config 'E:\Projects\CetusPrism\configs\vitest.config.ts' packages/llm/llm` | 1 | `1 failed | 51 passed (52)` 文件，`1 failed | 1268 passed (1269)` 用例。唯一失败：`packages/llm/llm/tests/invariant.spec.ts:121` `reports a notification whose registry cannot be re-read` → `AssertionError: expected [Function] to throw an error` |
| `node ... vitest.mjs run ... packages/llm/llm-pi-ai packages/client/ui-settings-models packages/bundle/web-app packages/compaction/compaction-basic` | 0 | `40 passed (40)` 文件，`875 passed (875)` 用例 |
| `node --experimental-strip-types --input-type=module -e <base64>`（部署态 csu 解析） | 0 | `warnings=[]`，三模型 `compat={"supportsDeveloperRole":false}`；去掉开关后告警点名 DeepSeek+Qwen 并排除 GLM |
| `node --experimental-strip-types --input-type=module -e <base64>`（错误分类器） | 0 | 9 条措辞的分类结果（见「逐项核对 C」表）；CSU DeepSeek 原话 → `INVALID_REQUEST` |
| `node --experimental-strip-types --input-type=module -e <base64>`（D1 共有字段与重指边界） | 0 | `zai/*` 与 anthropic 共有字段交集 `[]`；`deepseek/deepseek-v4-pro` 交集 `["supportsMidConvoSystemMessages"]`；重指后 `compat={}`；模型级不被新协议提供的开关 → 报错；路由级无模型可取 → 报错 |
| `node --experimental-strip-types --input-type=module -e <base64>`（pi-ai 内置 compat） | 0 | zai 7 个模型 compat 键、deepseek 2 个模型 compat 键（见 P1-4 表） |

只读检查（无退出码语义，仅供复核）：`git show`（`f4d90a6f2c` / `e40d84380f` / `171d72117f` / `c00b497ce5` / `1861ee8d80` / `1e085e40f8`）、`git log -1 --format`（`b9b251a9fd` 2026-10-02 / `eb61b2e8b8` 2026-10-06）、`Select-String` 于 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml`、`packages/llm/llm-pi-ai/README.md`、`docs/user/guide/providers.md`、`packages/client/ui-chat/src/client/chat/MessageItem.tsx`、以及 `node_modules/@earendil-works/pi-ai/dist/{api/openai-completions.js,utils/error-body.js}`。
