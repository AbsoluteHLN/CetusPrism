# 文档与规范合规核对（2026-10-23 本轮）— 2026-10-23-

核对对象：`dev-docs/2026-10-23-model-access-review.md`、`dev-docs/2026-10-23-cetusprism-upgrade-ideas.md`、`dev-docs/2026-10-23-agentloop-alignment-review.md`，以及本轮改动的源码注释与新增导出。
仓库：`E:\Projects\CetusPrism`，分支 `release/v1.7.3`。

**锚定提交：本报告的行号一律以 `401f3e82bc`（任务指定的 HEAD）为准。**
核对过程中仓库被并行的兄弟会话连续改动：HEAD 依次前移 `401f3e82bc` → `42d8a90e76` → `5073379125` → `33770460f6`，工作树另有未提交改动（见文末「并发改动对本次核对的影响」）。因此「实际行号」有两组：**HEAD `401f3e82bc`** 与 **收尾时 HEAD `33770460f6`**；漂移清单按前者给，后者差异集中在最后一节给。

核对方式：只读源码 + 跑仓库自带闸门脚本 + `git log`/`git blame`/`git show` 回溯；未做任何 git 写操作，未修改 `packages/` 与 `apps/` 下任何文件。

## 结论摘要

**本轮源码改动本身合规，没有发现会让 CI 闸门失败的新问题。** 三处关键点已核实：

- 新增导出 `REASONING_EFFORT_REJECTED_CODE`（`packages/llm/llm/src/error.ts:82`）JSDoc 完整，风格与同文件 `DEVELOPER_ROLE_REJECTED_CODE`（`error.ts:67`）一致；`verify-export-jsdoc` exit 0。
- `catalog.ts:981` 新增的 `{ compat: {} as ModelCompat }` **不是** `as unknown` 断言，不消耗 `scripts/no-unknown-casts.baseline.json` 的额度，也未触发 `verify-no-unknown-casts`；同函数 `catalog.ts:984` 有同型先例。
- `packages/llm/llm-pi-ai/src/catalog.ts:351` 的 `Unused oxlint-disable directive` warning **不是本轮引入**（见「规范偏离清单」第 4 条），oxlint 退出码 0，不阻断闸门。

**问题集中在文档侧：**

1. **行号漂移 27 处**（见「行号漂移清单」）。其中 5 处落在 D1/D2/P2 的**核心证据**上（`catalog.ts:1093`、`:943`、`:950`、`stream.ts:53-54`、`agentloop` 文档的 `constants.ts:7` / `standard.patch.yml:197` / `cordis.yml:45`），直接影响读者能否复核结论。
2. **文档内部自相矛盾 2 处**：`2026-10-23-model-access-review.md:90-96`「修法优先级 Top 5」整节已过期（列的 5 项在同文档 §三 里都已完成或被实测证伪）；`2026-10-23-cetusprism-upgrade-ideas.md:13` 体检 6 的断言与被引用的源码内容**方向相反**。
3. **章节编号重复 1 处**：`dev-docs/2026-10-23-agentloop-alignment-review.md` 在 HEAD 上有**两个 `## 3.`**（`:141` 与 `:155`），编号序列为 0,1,2,3,3,4,5。

**CI 现状：3 个闸门在 HEAD 上是红的，但都不是本轮造成的**（`verify-no-unknown-casts`、`verify-concrete-terms`、`verify-config-catalog`），证据见「脚本执行结果」。其中 `verify-config-catalog` 需要有人重跑 `pnpm run gen-config-catalog` 并同步 `docs/config-catalog.zh.md`，否则会一直卡 CI。

**Q7（README 中英同步）结论：不存在「改了配置示例就必须同步 README 中英双份」的规则。** `verify-translation-pairing` exit 0（558 对一致）；`dev-docs/` 整体被 `scripts/translation-pairing.manifest.json:10` 排除在配对范围外；本轮改的两个 YAML 是**配置值**（`thresholdRatio`/`headroomTokens`），不是新配置字段，字段本身的文档（`packages/compaction/compaction-basic/README.md` 中英双份 + 生成的 `docs/config-catalog.md`）无需改动。

## 脚本执行结果

命令统一为 `pnpm --dir 'E:\Projects\CetusPrism' run <script>`。运行时机为 HEAD 仍为 `401f3e82bc`、工作树无兄弟会话改动时。

| 脚本 | 退出码 | 关键输出 |
|---|---|---|
| `verify-archived-agent-notes` | 0 | `1917 frozen artifact(s) checked across 6 kind(s).` |
| `verify-agent-note-format` | 0 | `0 Agent Note(s) checked, all conform to .agents/notes/README.md § The file format.` |
| `verify-agent-note-classification` | 0 | `0 Agent Note(s) checked, structure consistent.` |
| `verify-doc-budgets` | 0 | `8 budgeted docs within ceiling.` |
| `verify-md-wrap` | 0 | `2392 file(s) checked, no hard-wrapped prose paragraphs.` |
| `verify-md-links` | 0 | `2366 file(s) checked, all relative cross-links and fragments resolve.` |
| `verify-doc-refs` | 0 | `3880 file(s) checked, all documentation references resolve.` |
| `verify-type-equiv` | 0 | `466 type-equiv block(s) match source structure and JSDoc (1:1 with manifest); 466 paired derivative(s).` |
| `verify-export-jsdoc` | 0 | `every exported name in each package API is documented.` |
| `verify-no-unknown-casts` | **1** | `new assertions to unknown are forbidden.` + 23 条命中，全部在本轮**未改动**的文件：`packages/client/ui-agent-preset/tests/apply.client.spec.ts`（9 条）、`packages/client/ui-computer-foreground/tests/delivery-toggle.client.spec.tsx:30`、`packages/client/ui-settings-usage/tests/usage.client.spec.tsx:104`、`packages/client/ui-sidebar-computer/tests/computer-body.client.spec.tsx:90,98`、`packages/client/ui-theme/tests/hln-appearance.client.spec.tsx:34,95`、`packages/core/agent/tests/invariant.spec.ts:16`、`packages/core/scope/tests/invariant.spec.ts:37,38`、`packages/experimental/agent-team/src/index.ts:74`、`packages/plan/plan-mode/tests/invariant.spec.ts:68`、`packages/session/session-log-deepseek/tests/invariant.spec.ts:80`、`packages/storage/storage-domain/tests/invariant.spec.ts:89`、`packages/subagent/tool-subagent/src/list-models.ts:113`、`scripts/test-invariants.spec.ts:137`。**`packages/llm/llm-pi-ai/src/catalog.ts` 不在命中列表中。** baseline 最后更新于 `eb61b2e8b8`（2026-10-06）。 |
| `verify-translation-pairing` | 0 | `558 pair(s) checked across all in-scope documentation, all consistent.` |
| `verify-concrete-terms` | **1** | `provenance is forbidden; name the exact source, field, identity, or evidence:` + 4 条命中：`apps/electron/README.md:275`、`apps/electron/README.zh.md:138`、`apps/electron/scripts/pack-tauri.mjs:116`、`scripts/check-offline-pack.mjs:11`。这 4 个文件最后改动都在 `c669f0d0bf`（2026-10-22），**本轮未触碰**。 |
| `verify-doc-site-fragments` | 0 | `5012 internal fragment reference(s) resolve; 201 raw-Markdown file(s) and llms.txt emitted.` |
| `verify-subsystem-pages` | 0 | `55 group(s) checked (49 linked, 6 explicitly exempt), all conform.` |
| `verify-config-catalog` | **1** | `gen-config-catalog: docs/config-catalog.md is stale. Run pnpm run gen-config-catalog and commit docs/config-catalog.md.` |
| `verify-cordis-config` | 0 | `220 config files passed.` |
| `pnpm exec oxlint --config configs/oxlintrc.staged.json packages/llm/llm/src/error.ts packages/llm/llm-pi-ai/src/catalog.ts packages/llm/llm-pi-ai/src/stream.ts` | 0 | 仅 1 条 warning：`packages/llm/llm-pi-ai/src/catalog.ts:351:3: warning: Unused oxlint-disable directive (no problems were reported).` |
| `pnpm exec oxlint --config configs/oxlintrc.json <同上三个文件>` | 0 | 同一条 warning，退出码仍为 0（`configs/oxlintrc.json` 的 `options.reportUnusedDisableDirectives` 为 `"warn"`）。 |

### 三个红灯闸门的归因（非本轮引入）

- **`verify-no-unknown-casts`**：23 条命中文件全部不在本轮改动文件列表内。本轮 `catalog.ts` 的新断言 `{ compat: {} as ModelCompat }`（`catalog.ts:981`）断言的是**已知** union 类型 `ModelCompat`（`catalog.ts:834`），不是 `unknown`，因此不计入 baseline 额度。同包既有的 `as unknown` 只有 `catalog.ts:799`、`config.ts:308`、`replay.ts:145` 三处，且都在 baseline 内。**与本轮无关。**
- **`verify-concrete-terms`**：4 条命中文件最后改动于 2026-10-22。**与本轮无关。**
- **`verify-config-catalog`**：`docs/config-catalog.md` 最后重生成于 `46f2b3cc23`（2026-10-18）。生成器 `scripts/gen-config-catalog.ts:682` 只扫 `packages/*/*/package.json` 并读 TS 源码里的 `Config` 声明，**不读 YAML**（全文检索 `\.yml|patch\.yml|cordis|preset` 只命中散文描述）。自 2026-10-18 起改动过的相关源文件是 `packages/client/ui-conversation/src/client/apply.ts`、`packages/client/ui-agent-preset/src/client/index.ts`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`，三者最后改动均为 `aafb979693`（2026-10-22）。本轮改的 `packages/llm/llm/src/types.ts`（`1e085e40f8`）改的是 `LlmConfigurableProvider`，而该接口**不在** `docs/config-catalog.md` 中（检索无命中），不构成 catalog 输入。**与本轮无关。**

### 归档笔记格式（Q1）的范围判定

三个 `verify-agent-note-*` 脚本都只遍历 `.agents/notes/`：`scripts/agent-note-tree.ts` 的 `agentNoteRoot = resolve(import.meta.dirname, '../.agents/notes')`，`verify-archived-agent-notes.ts:23` 的归档根是 `resolve(agentNoteRoot, 'archived')`。**`dev-docs/` 不受这三个脚本管辖**，所以它们「0 Agent Note(s) checked」是预期结果，不是「跳过」。`dev-docs/` 的约定来源是 `dev-docs/README.md` 一段话：「产品与架构的权威文档在 `docs/`；本目录只存放开发过程记录与构建证据……按日期归档；构建证据统一放在 `evidence/`」——没有强制模板、编号或语言后缀规则。

## 行号漂移清单

比对基线：文档引入时的提交状态 = `161549863d`（`catalog.ts` 当时为 `9a785a2f4f`、`stream.ts` 当时为 `c00b497ce5`）与 HEAD `401f3e82bc`。

### A. `dev-docs/2026-10-23-model-access-review.md`（22 处漂移）

| # | 文档位置 | 文档写的行号 | 引入时该行实际是什么 | `401f3e82bc` 实际行号 | 影响的结论 |
|---|---|---|---|---|---|
| 1 | `:11` ③ 目录物化 | `catalog.ts:991-1136` resolveRouteModels | `991`=JSDoc 首行，`export function resolveRouteModels(` 在 `999` | JSDoc `1015-1023`，函数 `1024-1170` | ③ 整段起点错位 +25 |
| 2 | `:11` ③ | `catalog.ts:1112-1116` deferred 读保留 modelErrors | `1112`=`...compat,`；真正的 `modelErrors.set(entry.id, error.message)` 在 `1122` | `1146-1148` | 「deferred 读保留 modelErrors」的证据指错行 +24 |
| 3 | `:12` ④ compat 合并 | `catalog.ts:921-952` | `921`=JSDoc，`resolveModelCompat(` 在 `929` | `945-985` | ④ 区间错位 +24 |
| 4 | `:12` ④ | `catalog.ts:950`（api 重指时弃 base 继承） | `950`=`}`（字段循环收尾）；真正的切断逻辑在 `958`：`const inherited = base?.api === api ? base.compat : undefined` | `983`：`const inherited = repointed ? undefined : base?.compat` | **引入时即指错行**；现 +25 |
| 5 | `:16` ⑧ pi-ai wire | `catalog.ts:704-712`（非 completions 一律 true） | `712`=`if (api !== 'openai-completions') return true` | 函数 `723-736`，该判定在 `726` | +14 |
| 6 | `:17` ⑨ | `stream.ts:171-262` | `171`=`export async function* toStreamChunks(` | `221-312` | +50 |
| 7 | `:17` ⑨ | `stream.ts:42-73` classify | `47`=`function classifyPiAiError(`，函数体 `47-93` | `47-94` | **引入时即错**（区间整体偏 5） |
| 8 | `:17` ⑨ | `stream.ts:85-140` mapStopReason | `85`=JSDoc，`export function mapStopReason(` 在 `90` | `106-163` | **引入时即错**（+5），现 +21 |
| 9 | `:19` ⑪ warnings 面 | `catalog.ts:968,1122,1135` | `968`=`RouteCatalog.warnings` 字段的 JSDoc 首行；`warnings.push(...)` 在 `1130` | `warnings` 字段 `1001`；`developerRoleWarning` `915-925`；`warnings.push(...)` `1155` | **三个号全部落在无关代码上**（分别落在 `resolveModelCompat` JSDoc、`modelErrors.set`、`maxTokens,`） |
| 10 | `:20` ⑫ token 计量 | `stream.ts:24-32`（mapUsage） | `24`=`export function mapUsage(`，函数体 `24-37` | `24-37` | 起点对，止点少 5 行 |
| 11 | `:28` **D1 证据** | `catalog.ts:1093`（模型字面量无条件 `...base`） | `1093`=`roleRiskModels.push(entry.id)`；真正的 `...base,` 在 `1101` | `...base,` 在 `1126` | **引入时即指错行**；D1 最关键证据 |
| 12 | `:28` **D1 证据** | `catalog.ts:943`（改 api 未配 compat 时返回 `{}`） | `943`=`if (gate?.[field] !== 'offer') {`；真正的 `return {}` 在 `951` | `974-981`，`return repointed ? { compat: {} as ModelCompat } : {}` 在 `981` | **引入时即指错行**；D1 核心证据 |
| 13 | `:30` D1 影响 | 注释 `:944-950` | `944`=`const offered = offeredCompatFields(api)`；讲 base.compat 的注释在 `952-957` | `967-972` | +15 |
| 14 | `:35` D2 证据 | `catalog.ts:851-872`（developerRoleWarning 覆盖 `supportsDeveloperRole`） | `872`=`const declared = configuredCompatEntries(route).find(... === 'supportsDeveloperRole')` | `developerRoleRisk` `875-896`，该判定在 `888-890` | +24 |
| 15 | `:35` D2 证据 | `catalog.ts:891-901` | `891`=developerRoleWarning 的 JSDoc 末行，`901`=其函数体 | `915-925` | +24 |
| 16 | `:36` / `:38` D2 | `stream.ts:53-54`（400 → INVALID_REQUEST） | `53`=注释，`54`=`if (/\b400\b\|invalid.?request/i.test(message)) return 'INVALID_REQUEST'` | `70`（413）/ `71`（400） | +17；D2 的「分类器在哪」定位失效 |
| 17 | `:47` D3 证据 | `catalog.ts:709-710`（对全部 host 做 `lower.includes`） | `709`=函数签名；`lower.includes` 在 `717-718` | **该写法已被本轮删除**：`733` 改为 `baseUrl.includes(...)`，`734` 改为 `baseUrl.toLowerCase().includes(CASE_INSENSITIVE_NON_OPENAI_HOST)`（常量在 `catalog.ts:691`） | 引用指向的代码已不存在 |
| 18 | `:52` D4 证据 | `catalog.ts:708-711`（openrouter 一律 false） | openrouter 分支实际在 `713-715` | `727-729` | **引入时即指错行**；现 +14 |
| 19 | `:59` D5 | `stream.ts:34-41`（XXX：pi-ai 压平 Error） | XXX 注释块 | XXX 注释块在 `39-46` | +5 |
| 20 | `:62` / `:70` D6、D8 | `stream.ts:42-72` | 跨注释与函数体 | `classifyPiAiError` `47-94` | 同 #7 |
| 21 | `:63` D6 修法 | 「在 `:55` 前加 408」 | `55`=`if (isDeveloperRoleRejectedError(...))`；5xx 在 `60` | 5xx 在 `72`，新增的 408 行在 `76` | 引入时即错位；现 +17 |
| 22 | `:63` D6 | `stream.ts:63` 全命中（词表比对） | `63`=TRANSPORT 分支注释 | `63`=D2 reasoning-effort 分支注释；原 TRANSPORT 注释在 `78-83` | 引入时即错位；现指向错误的分支 |

### B. `dev-docs/2026-10-23-cetusprism-upgrade-ideas.md`（1 处漂移）

| # | 文档位置 | 文档写的行号 | 引入时该行实际是什么 | `401f3e82bc` 实际行号 | 影响的结论 |
|---|---|---|---|---|---|
| 23 | `:12` 体检 5（persona 双源漂移） | `apps/cli/config/examples/glm-harness/cordis.yml:44-53` | `42`=`- id: system-prompt`，`44-53`=persona 块 | 本轮 `1861ee8d80` 在 42 行插入 `compaction-basic` 块，persona 现为 `52-64` | **+10**；两处 persona 对照的锚点错位 |

### C. `dev-docs/2026-10-23-agentloop-alignment-review.md`（HEAD 版本，4 处漂移）

> 核对对象是**提交在仓库里的版本**（`401f3e82bc`，210 行，标题「# Agent Loop 行为对齐复核（AgentLoop对齐师 · 2026-10-23）」）。工作树里另有一份 103 行的兄弟会话改写稿（标题「独立验证版」），未提交，不在本次核对范围内。

| # | 文档位置 | 文档写的行号 | `401f3e82bc` 实际行号 | 影响的结论 |
|---|---|---|---|---|
| 24 | `:46` §1 复核表「并发上限两侧同为 10」 | `packages/core/agent-loop/src/constants.ts:7` | **该文件只有 6 行**；`6` = `export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`。`:7` **越界** | 引用越界（off-by-one），读者按图索骥会落空 |
| 25 | `:113` §1 P2 行「persona 双份」 | `packages/bundle/web-app/presets/standard.patch.yml:197` | `197` = `order: 5`；文档引用的 persona 文本「powered by the {{model}} model」在 `204`（persona 块 `199-206`） | 指错行；引文与所指文本不在同一处 |
| 26 | `:113` §1 P2 行「persona 双份」 | `apps/cli/config/examples/glm-harness/cordis.yml:45` | `45` = compaction 注释行；文档引用的 persona 文本「You are a coding agent.」在 `55`（persona 块 `52-64`） | 指错行；同样因本轮插入 compaction 块而 +10 错位 |
| 27 | `:135` §2 复核表第 5 条 | `packages/llm/llm-pi-ai/src/catalog.ts:604-712` | `604-612` 落在 `input?: PiAiModality[]` 的 JSDoc；`712` 落在 `sendsDeveloperRole` 的 JSDoc 中段 | 上界越界：`sendsDeveloperRole` 现为 `723-736`（+11 起算），区间不再覆盖该函数 |

### D. 核对通过、未漂移的引用（抽查样本，均逐行核对过）

`llm-retry/src/index.ts:194-241`（`:215` 按 code 匹配、`:227-235` 尊重 Retry-After）——**任务点名的这一处正确**；`catalog.ts:38`（NO_COST）、`catalog.ts:604-620`（reasoningEfforts 字段）、`config.ts:220,513`、`:272`、`:266-293`、`:334-357`、`:360-362`、`:372-376`、`:474-497`；`provider.ts:47-63`、`:144-159`、`:167-192`；`adapter.ts:232-241`、`:318-324`、`:330-424`、`:348`；`context.ts:53`、`:158-164`、`:196-200`；`adapter-failure.ts:16-28`；`retry-policy.ts:14`、`:18-24`、`:40-41`；`types.ts:245-277`；`index.ts:130-147`、`:175-184`、`:186-209`；`store.ts:41,64`；`provider-form.client.spec.tsx:843-850`；`replay.ts:57-66`；`discovery.ts:240-249`、`:275-286`；`transport.ts:36-42`；`catalog.spec.ts:1046-1108`；`error.ts:67`；`AGENTS.md:134,139,140,152,153,168`；`zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md:50,84`；`2026-10-22-composer-agent-team-spec-v1.zh.md:29-59`、`:270`、`:277-287`；`llm-pi-ai/README.zh.md:113`（句尾确有「`cordis.patch.yml` 仍然是决定路由服务内容的唯一事实」）；`compaction-basic/src/config.ts:20,23,75`、`:106`、`:191-194`；`compaction-basic/src/index.ts:158-176`、`:178-188`、`:190-234`、`:292-298`；`compaction/src/tool-pairing.ts:112-126`；`core/agent-loop/src/tool-calls.ts:89-100`、`:146-161`、`:153-154,170-174`、`:199-213`、`:238-260`；`core/tools/src/index.ts:1303-1312`、`:270-276`；`core/tools/src/schema.ts:625-630`；`core/tools/tests/execution-mode.spec.ts:88-117`；`core/system-prompt/src/index.ts:125-159`、`:303-307`、`:405-443`、`:429`；`llm/src/message.ts:151-180`、`:187-193`；`agent-loop/src/agent.ts:643-647`；`agent-preset-registry/src/backend.ts:73,182-207`、`:187-196`；`ui-agent-preset/src/client/backend-store.ts:161-173`；`core/agent-loop/README.md:217`；`tool-subagent/src/list-models.ts:76-80`；`tool-fs/src/read.ts:136`；`tool-web/src/search.ts:364`；`tool-session-query/src/index.ts:90`；`tool-subagent/src/index.ts:470`；`standard.patch.yml:196-203`（本轮 +7 行后恰好对上 persona 块）；`cordis.yml:10`、`:16`、`:20`、`:24-27`、`:28-34`。

> `ModelsSection.tsx:420-435` 属**半对**：warnings 渲染实际在 `420-425`（`420`=warnings 取值、`424`=map、`425`=`<li>`），`435` 落在 `modelErrors` 列表而非 warnings。文档说「`ModelsSection.tsx:420-435` 渲染」，方向正确、止点越界。

## 规范偏离清单

### 1. `dev-docs/2026-10-23-agentloop-alignment-review.md:141` 与 `:155` 出现两个 `## 3.` 标题

- **违反的规则**：`docs/AGENTS.md` 目录结构要求文档章节层级唯一且可导航；同目录先例 `dev-docs/2026-10-22-zcode-agentloop-parity.md` 的编号严格递增不重复（`## 0.`→`## 7.`）。
- **证据**：`git show 401f3e82bc:dev-docs/2026-10-23-agentloop-alignment-review.md` 的标题序列为 `## 0.`(14)、`## 1.`(31)、`## 2.`(127)、**`## 3. 影响排序`(141)**、**`## 3. 建议动作`(155)**、`## 4.`(190)、`## 5.`(200)——`## 3.` 出现两次，其后直接跳到 `## 4.`。
- **建议**：把 `:155` 改为 `## 4. 建议动作（最小修法 + preset/底座开关隔离）`，并把后面的 `## 4.`/`## 5.` 顺延为 `## 5.`/`## 6.`；或把 `:155` 改成无编号 `## 建议动作（最小修法 + preset/底座开关隔离）`。

### 2. `dev-docs/2026-10-23-model-access-review.md:90-96`「修法优先级 Top 5」整节已过期

- **违反的规则**：`docs/AGENTS.md`「Document current state. Keep history in commits, PRs…」——文档只描述当前状态；同文档 §三「落地状态」（`:75-88`）已记录这些项的最终状态。
- **证据**：Top 5 列的 D1、D2①、D6、D4、D3，在同文档 `:79-86` 的落地状态表里分别是「✅ 已修（本次）」「⚠️ 部分落地（实测后收缩）／① 经实测证伪，不做」「✅ 已修（本次）」「✅ 已修（`9a785a2f4f`）」「✅ 已修（本次）」。本轮 `401f3e82bc` 追加 D2 实测取证段落时没有回头改这一节。
- **建议**：把「四、修法优先级 Top 5」改成「已落地项」或直接删除，避免读者按已作废的建议动代码。

### 3. `dev-docs/2026-10-23-cetusprism-upgrade-ideas.md:13` 体检 6 的断言与源码相反

- **违反的规则**：`docs/AGENTS.md`「Document current state」+ `AGENTS.md:150`「Tests describe behavior, not correctness」——体检项必须反映源码现状。
- **证据**：文档写「`packages/client/ui-conversation/tests/skeleton.client.spec.tsx:388,552,586,618` 仍断言旧品牌文案（品牌已改名 CetusPrism）」。实际这 4 行是 `expect(view.getByText('CetusPrism')).toBeTruthy()`（`388`）、`expect(b.view.getByText('CetusPrism')).toBeTruthy()`（`552`）、`expect(b.view.queryByText('CetusPrism')).toBeNull()`（`586`）、`expect(b.view.getByText('CetusPrism')).toBeTruthy()`（`618`）——**断言的是新品牌**。旧文案 `'Into the Unknown'` / `'探索未至之境'` 已由 `6a382f4358`（2026-10-23 01:18:55）替换，而本文提交于 `161549863d`（01:19:09），晚 14 秒。
- **附带不一致**：标题写「3 条永远失败的用例」，正文列了 4 个行号。
- **建议**：删除该体检项，或改写为「本轮已修（`6a382f4358`）」；同步删除由它派生的「思路 6：修复 3 条基线失败用例」（`:57-63`）与「Top 3 排序建议」第 1 条（`:83`），否则思路 6 的前提不存在。

### 4. `dev-docs/2026-10-23-model-access-review.md:39` 引用了不在仓库里的取证脚本

- **违反的规则**：`dev-docs/README.md`「构建证据统一放在 `evidence/`（…按日期分目录）」。
- **证据**：文档写「脚本 `koutput/probe-gateway-wire-fields.mjs`」。`koutput/` 在 `.gitignore:32` 被忽略（`git ls-files koutput/` 返回 0 条），文件确实存在于本地但**未纳入版本控制**，读者无法复核 D2 的实测数据（`:40-43` 的三组 200/400 结论完全依赖它）。`dev-docs/evidence/`（`.gitignore:23`）同样是本地归档目录，但按日期分目录、可被同机复核。
- **建议**：把探针脚本与原始响应归档到 `dev-docs/evidence/2026-10-23-model-access-review/`，文档改为指向该目录；若坚持不入库，需在「未验证项」里明确标注「数据仅存于本地、不可复核」。

### 5. `dev-docs/2026-10-23-model-access-review.md:88` 的回归反向验证记录不可复现

- **违反的规则**：`docs/AGENTS.md` 要求证据可被复核。
- **证据**：文档写「`git stash push -- packages/llm/llm-pi-ai/src/{catalog,stream}.ts` 后，4 条新用例全部转红（`4 failed | 358 passed`），恢复后 `362 passed`」。`{catalog,stream}` 是 bash 的花括号展开，Windows PowerShell / cmd 不展开该语法；`git stash` 本身是改动工作树的写操作，复核者照抄会得到与文档不同的行为。
- **建议**：改为记录可复现的形式——写明被验证的提交号（如「在 `f4d90a6f2c` 的父提交上跑，4 条用例转红」），或贴出实际使用的 PowerShell 等价命令与 `git diff` 片段。

### 6. `packages/llm/llm-pi-ai/src/catalog.ts:351` 的 oxlint warning 不是本轮引入（核对通过，非偏离）

- **实际配置**：`configs/oxlintrc.json` 的 `@stylistic/max-len` = `error`，`code: 140`，`ignoreUrls/ignoreStrings/ignoreTemplateLiterals: true`；`.editorconfig` 只规定 `end_of_line = lf` + `insert_final_newline = true`，**没有** `max_line_length`。
- **核对结果**：本轮新增/改动的源码行（`error.ts:69-82`、`catalog.ts:691`、`:723-736`、`:945-985`、`stream.ts:47-94`、`:192-207`）均未超出 140 列的有效长度；oxlint 对三个文件零 error。
- **warning 归因**：`git log -1 --format='%h %ad %s' -- packages/llm/llm-pi-ai/src/catalog.ts` = `f4d90a6f2c 2026-10-23 fix(llm-pi-ai): land the model-access review D1/D3/D6/D8`；`git blame -L 349,353 -- packages/llm/llm-pi-ai/src/catalog.ts` 显示 `351` 行的 `// oxlint-disable-next-line typescript/no-redundant-type-constituents` 归属 `68d31243349`（2026-10-04），类型别名块 `346-352` 归属 `b9b251a9fd`（2026-10-02）。本轮改 `catalog.ts` 的 4 个提交（`ac51383f21`、`c00b497ce5`、`9a785a2f4f`、`f4d90a6f2c`）都没碰 `345-352` 行。oxlint 退出码 0，`reportUnusedDisableDirectives` 配置为 `"warn"`，不阻断闸门。**属既有遗留**（该 disable 指向的行 `352` 从未被规则命中，规则报在联合类型起点 `346`），清理它属于独立小改动，不在本轮范围。

### 7. 本轮新增导出与断言的合规性（核对通过，非偏离）

- `packages/llm/llm/src/error.ts:82` 的 `REASONING_EFFORT_REJECTED_CODE`：JSDoc 完整（解释 pi-ai 发送的档位来源、400 不可区分的原因、修复位置、终态不进重试集），与同文件 `DEVELOPER_ROLE_REJECTED_CODE`（`:67`）的写法一致——两个都是**常量导出**，因此都不带 `@param`/`@returns`；文件内的函数导出（如 `isDeveloperRoleRejectedError:99-101`、`isContextWindowExceededError:141-142`、`errorChain:173-176`、`isHarnessError:222-223`）都带 `@param`/`@returns`。`verify-export-jsdoc` exit 0。
- `packages/llm/llm-pi-ai/src/catalog.ts:981` 的 `{ compat: {} as ModelCompat }`：断言目标是**已知** union 类型 `ModelCompat`（`:834`），不是 `unknown`，所以既不消耗 `scripts/no-unknown-casts.baseline.json` 里 `packages/llm/llm-pi-ai/src/catalog.ts` 的那 1 条额度（该额度对应既有的 `catalog.ts:799` `(efforts as unknown)`），也不触发 `verify-no-unknown-casts`。同函数 `catalog.ts:984` 有同型先例（`{ ...inherited, ...configured } as ModelCompat`），仓库既有偏好就是「用已知类型断言而非 `as unknown`」，本轮写法一致。

### 8. 低优先级观察：本轮三份文档的章节编号体系互不一致

- model-access-review 用中文数字（`一、`～`四、`）+ 末尾无编号节；upgrade-ideas 用 `1.`～`4.` + 无编号尾节；agentloop 用 `0.` 起。
- 仓库先例本身两派并存：`2026-10-22-zcode-agentloop-parity.md` 用 `0.`～`7.`，`2026-10-22-upstream-integration-report.md` 用 `1.`～`10.`，`2026-10-18-integration-spec.md` / `2026-10-18-integration-report.md` / `2026-10-20-multibase-refactor-spec-v2.zh.md` 用无编号。
- 风险点是 agentloop 文档 `:127` 的「§2『不得照搬清单』复核」与 `:135` 的「§6 不得照搬清单」实际指向**另一份文档**（parity）的 §2/§6，与本文的 `## 5.` 编号打架；叠加上面第 1 条的重复 `## 3.`，读者更难定位。
- 建议：同一天的三份文档统一编号（本轮建议都用 `0.` 起始，或都无编号），并在 `dev-docs/README.md` 补一句命名/编号约定。**这不是闸门失败项。**

### 9. 低优先级观察：`dev-docs/` 的中文文档命名两派并存

- 用 `.zh.md` 的：`2026-10-20-multibase-refactor-spec-v2.zh.md`、`2026-10-22-composer-agent-team-spec-v1.zh.md`、`zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md`。
- 中文但无后缀的：`2026-10-18-integration-report.md`、`2026-10-22-upstream-integration-report.md`、`2026-10-22-zcode-agentloop-parity.md`。
- 本轮三份纯中文文档延续了「无后缀」这一支。因为 `dev-docs/` 整体被 `scripts/translation-pairing.manifest.json:10` 排除在英中配对之外，**不会触发 `verify-translation-pairing`**（exit 0 实证），只是命名无法区分语言。**不是闸门失败项。**

### 10. Q7 结论：不存在「改了配置示例就必须同步 README 中英双份」的规则

- **查证依据**：`AGENTS.md:172`「Docs accompany every code change: update affected README and JSDoc contracts together. Routine bilingual work follows `docs/AGENTS.md`」；`docs/AGENTS.md:44`「Pairs update together: … and re-records」。二者约束的是**文档事实变化**要同步，不是「配置示例文件」变更要连带改 README。
- `docs/AGENTS.md:32` 把 `docs/config-catalog.md` 列为生成物，「Hand edits to generated English sources or regions; Chinese counterparts update through pairing only」——生成物走重生成 + 配对流程，不属于「改了示例就要改 README」。
- **本轮两个 YAML 改的是配置值不是配置字段**：`packages/bundle/web-app/presets/standard.patch.yml`（`+7` 行，`thresholdRatio: 0.9` / `headroomTokens: 8192`）与 `apps/cli/config/examples/glm-harness/cordis.yml`（`+10` 行，同两个字段）。字段本身早已存在，`packages/compaction/compaction-basic/README.md:66-67` 中英双份已完整记载 `thresholdRatio` / `headroomTokens` 的默认值与含义，`packages/llm/llm-deepseek/README.md:77` 与 `README.zh.md:77` 也已引用；没有任何 README 声明「standard preset 的压缩阈值是 X」。
- **实测**：`pnpm --dir 'E:\Projects\CetusPrism' run verify-translation-pairing` → exit 0，`558 pair(s) checked across all in-scope documentation, all consistent.`。本轮确实动过 README 的只有 `packages/llm/llm/README.md` + `README.zh.md` + `README.i18n.yaml`（提交 `c00b497ce5` / `1e085e40f8`），配对记录已重录且一致。
- **结论**：Q7 的规则**不存在**，本轮也**没有违反**它。

## 并发改动对本次核对的影响

核对过程中仓库被并行的兄弟会话连续改动，**不是本轮的工作，也不是本报告的对象**。为免读者误判，列出对本报告结论的影响（收尾时 HEAD = `33770460f6`，工作树有 2 个已跟踪文件被改 + 3 个未跟踪文件）：

| 改动 | 对本报告的影响 |
|---|---|
| HEAD 连续前移：`401f3e82bc` → `42d8a90e76`（`fix(llm-pi-ai): keep the effort refusal next to the effort`）→ `5073379125`（`fix(llm-pi-ai): read the effort refusal the way the gateway states it`）→ `33770460f6`（`fix(compaction): state the pressure shape as the mechanism that produces it`），改了 `packages/llm/llm-pi-ai/src/stream.ts` 与 `apps/cli/config/examples/glm-harness/cordis.yml` | `stream.ts` 从 312 行变 **359 行**，A 组里 #6–#10、#16、#19–#22 的「实际行号」需再 +32～+47。收尾 HEAD 下的新位置：`mapUsage` 起 `24`、`classifyPiAiError` `96-141`（413→`116`、400→`117`、5xx→`118`、408→`121`）、`mapStopReason` `152`、`developerRoleGuidance` `227`、`reasoningEffortGuidance` `250`、`toStreamChunks` `267-359`、XXX 注释仍在 `39-46`。**结论（漂移存在、方向、幅度类别）不变，绝对行号需按新 HEAD 复读。** |
| `cordis.yml` 的 compaction 注释被改写 | `thresholdRatio` 由 `49` 移到 `51`，persona 块由 `52-64` 移到 `54-66`（引文「You are a coding agent.」在 `57`）。C 组 #26 的漂移幅度因此由 +10 变为 +12。 |
| `packages/bundle/web-app/presets/standard.patch.yml` 的 persona 块由 `199-206` 移到 `202-206+` | C 组 #25 的偏离量随之变化；文档写的 `:197` 仍指向 `order: 5`，仍非 persona 文本。 |
| 工作树未提交：`dev-docs/2026-10-23-agentloop-alignment-review.md`（被兄弟会话重写为 103 行「独立验证版」，含两个 `## 7.`）、`packages/llm/llm-pi-ai/tests/catalog.spec.ts` | 不在本报告核对范围。若以工作树而非 HEAD 为准：`agentloop` 文档的重复编号位置由 `:141/:155` 变为 `:84/:98`；该文档的其余结构与引用随之整体改写。**本报告的 C 组结论针对的是提交在仓库里的 210 行版本。** |
| 新增未跟踪文件 `dev-docs/2026-10-23--agent-team-conformance-review.md`、`dev-docs/2026-10-23--regression-coverage-review.md` | 兄弟会话的交付物，不在本次范围。 |
| 本报告 `dev-docs/2026-10-23--docs-compliance-review.md` | 本次唯一写入的文件；UTF-8 无 BOM、LF 换行（实测 0 个 CR、末尾有换行）。写入后重跑 11 个文档闸门全部 exit 0。 |

## 未验证项与验证方法

| 项 | 状态 | 验证方法 |
|---|---|---|
| vendor `@earendil-works/pi-ai@0.87` dist 的行号（model-access-review 中的 `openai-completions.js:1217-1301`、`:1306-1340`、`:187/:197`、`openai-responses-shared.js:125`、`utils/error-body.js:111-118`、`:362-371`、`:34-40`、`:1261-1279`、`:1222-1232`、`:1256,1260`、`:1311-1339`） | **未验证** | 本轮未打开 vendor dist 逐行比对。核验方法：读 `vendor/` 下对应 `dist/api/*.js` 与 `dist/utils/error-body.js`，按同样方式比对行号；vendor 版本由 `vendor/README.md` 的上游 SHA 锁定。 |
| agentloop 文档中标注 `[pack]` 的上游行号（`scheduler.ts:60-83`、`scheduler.ts:48`、`tools.ts:42-58`、`batch-runner.ts:56-90`、`turn-loop.ts:77-113`、`compact/policy.ts:6-14`、`model-anomaly.ts:23-62,111-127`、`turn-tool-warnings.ts:14-82`、`model-config.ts:246-264`） | **未验证** | 文档自述这些行号来自上游 pack blob、未与工作树交叉验证；上游副本不在本仓库，`apps/zcode-cli/...`、`docs/design/v2/loop/...`、`packages/provider/...` 在本仓库均不存在。核验方法：取 ZCode 3.15.1 @ `aac4755` 副本后逐行 diff。 |
| D2 的 csu 私有网关实测数据（`api.chat.csu.edu.cn/v1`） | **部分验证** | 措辞样本已进入分类器（`stream.ts:64-67` 的拒绝词表与文档 `:44` 列举的一致），但**原始响应与探针脚本未入库**（`koutput/` 被 gitignore），无法复核。核验方法：见「规范偏离清单」第 4 条。 |
| `verify-md-wrap` / `verify-md-links` / `verify-doc-refs` 对本轮三份文档的**逐文件**覆盖情况 | **部分验证** | 三个脚本是仓库级扫描（2392 / 2366 / 3880 文件）且均 exit 0，说明这三份文档在扫描范围内且无硬换行、无坏链接、无坏引用；但脚本不输出逐文件结果。核验方法：读 `scripts/verify-md-wrap.ts` 等的 glob 范围确认包含 `dev-docs/**/*.md`。 |
| `verify-doc-budgets` 是否覆盖 `dev-docs/` | **不适用** | 该脚本只管 `scripts/doc-budgets.manifest.json` 列出的 8 份固定文档，dev-docs 不在其中，因此本轮 model-access-review（`401f3e82bc` 下 102 行）的行数变更**不受预算闸门约束**。 |
| 三个红灯闸门在 HEAD 之前是否曾为绿 | **未验证** | 受限于「禁止 git 写操作」，未做 checkout/stash 对照。核验方法：在 CI 流水线或一次性工作副本上跑 `pnpm run check:ci:static`，或读 CI 历史日志。 |
| `2026-10-23-cetusprism-upgrade-ideas.md:13` 的「spec §1.4 已用 stash 对照确认与既有基线一致」 | **未验证** | 该断言依赖 spec 文档的转引；spec 本轮有改动（`5cdc53821b`），但该提交早于本文提交，行号未漂移（已核对 `spec:29-59`、`:270`、`:277-287`）；「stash 对照」这一步本身无记录可查。 |
| 文档中「凭据仅 `apiKeyEnv` 引用名，值未读取、未回显」 | **已核实形式、未核实内容** | 文档本身不含任何凭据值；本轮只读核对了 `packages/llm/llm-pi-ai/src/index.ts:186-209` 的凭据解析路径，**未读取任何部署态凭据**，因此无法核实部署态 `cordis.patch.yml` 的实际内容。 |
| 本轮 4 个新增/修改的回归用例（`tests/catalog.spec.ts`、`tests/adapter.spec.ts`、`tests/provider-form.client.spec.tsx`）的实际通过情况 | **未运行** | 本次为只读核对，未执行 `vitest`。核验方法：`pnpm --dir 'E:\Projects\CetusPrism' exec vitest run --config configs/vitest.config.ts packages/llm/llm-pi-ai packages/client/ui-settings-models`。 |
