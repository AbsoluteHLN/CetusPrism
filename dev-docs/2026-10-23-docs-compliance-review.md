# 文档与规范合规核对（agent-team composer 轮）— 2026-10-23

核对对象：本轮 `feat(agent-team)` 系列 6 个提交（`5d87f61543` → `5cdc53821b`，文档合规审查员 · 2026-10-23）。
行号一律以**当前工作树**（HEAD `aab778815d`）为准；对 `5d87f61543~1..5cdc53821b` 的 diff 逐段核对过。核对方式只读：跑仓库闸门（不带 `--write`）+ 读源码，未做 git 写操作。**上一轮同路径报告（model-access 方向）已提交入库（`aab778815d`），本文件按本轮任务重写，旧内容在 git 历史可查。**

## 结论摘要

**源码与文档本体合规；两个闸门红且都由本轮（含其触发的目录重生成）引入，push 前必须处理。**

- `verify-translation-pairing` **exit 1**：`docs/config-catalog.i18n.yaml` 两个 section 失步（agent-team、llm-pi-ai）。
- `verify-no-unknown-casts` **exit 1**：25 条断言中 `packages/experimental/agent-team/src/index.ts:74` 为本轮新增（`ea8785b21c8`），baseline 未含 `src/index.ts`。
- `verify-export-jsdoc` / `verify-config-catalog` / `verify-cordis-config` / oxlint / 编码检查全部通过。

## ① 合规核对表

| # | 规则 | 结论 | 证据 |
|---|---|---|---|
| 1 | README 双语同步 + 哈希重录 | **源文件通过 / 闸门红（归因目录重生成）** | 四个 README 三件套行数两两一致（agent-team 261/261/112，tool-agent-team 166/166/70）；`verify-translation-pairing` exit 1，仅报 `docs/config-catalog.i18n.yaml` 两节（`/plugin-config-catalog/deepseek-ai-dsh-experimental-agent-team`、`/deepseek-ai-dsh-llm-pi-ai`）。归因：`74dde8494b`（2026-10-23 02:29）重生成 catalog，新增内容正是本轮的 `profiles`/`allowedEfforts`/`allowedBackends`/`allowedPresets` 字段与 `AgentProfile` 接口（`git show 74dde8494b` 可证），但未同步重录 i18n 哈希（该 yaml 最后改动停在 `46f2b3cc23`）。**下游 `docs/config-catalog.md` 本身不要求双语重录，只有生成的 i18n yaml 哈希需 `--write` 重录** |
| 2 | 导出 JSDoc | **通过** | `verify-export-jsdoc` exit 0。人工抽查：`profile.ts:44-51`（类）、`:54`/`:68`/`:76`/`:85`（方法全带 `@param`/`@returns`/`@throws`）；`range.ts:5-11`（`TeamRanges`）、`:28-38`（`checkRanges` 带 `@throws` 三错误码）；`error.ts:65-77` `DEVELOPER_ROLE_REJECTED_CODE`、`:79-87` `isDeveloperRoleRejectedError`（带 `@param`/`@returns`）。4 个新工具（`list_agent_profiles`/`release_teammate`/`reactivate_teammate`/`broadcast_message`）是 `defineTool` 对象字面量、非包导出，闸门不管；均有完整 `description` 与参数描述（tool-agent-team `src/index.ts` 新增四段，diff 已逐行核） |
| 3 | schemastery 风格 | **通过** | `agentProfileSchema` 可选字段一律裸 `z.string()`（agent-team `src/index.ts:68-70,75`），无 `.optional()`；`.optional()` 仅出现在 zod 侧 `projection.ts`（`:3` 为 `import { z } from 'zod'`，`:47-455`），风格正确。tool-agent-team 新 schema 用 `{ type: 'string' }` 无 `required` 表示可选，一致 |
| 4 | lint 严（禁 any/未用） | **通过（但见 V2）** | `oxlint --config configs/oxlintrc.json` 对 `agent-team/src/{index,profile,range}.ts`、`tool-agent-team/src/index.ts`、`llm/src/error.ts` exit 0、零告警。`index.ts:74` 的 `as unknown as z<readonly string[]>` **无需 oxlint-disable**（oxlint 不报该写法），带解释性注释（`:71-73`）；但它撞的是另一条闸门，见 V2 |
| 5 | UTF-8 无 BOM + LF + EOF | **通过** | 本轮 14 个改动文件逐一字节级检查：BOM=0、CRLF=0、孤立 CR=0、EOF 无多余空行 |
| 6 | 产物只进 `koutput/` | **通过** | `git ls-files koutput/` 为 0 条；`git diff --name-only 5d87f61543~1 5cdc53821b` 共 30 个文件，全部为源码/测试/文档/配置，无产物外溢 |
| 7 | 规格 §4.8 与代码一致 | **通过（逐条核对）** | S4.1 `profile.ts:51` `AgentProfileRegistry`、`roster.ts:453,459` `TEAM_PROFILE_CONFLICT`、`profile.ts:94` `TEAM_PROFILE_UNKNOWN`、`types.ts:115/139/188/314` `profileId`；S4.2 `types.ts:53` `dormant` 相位、`roster.ts:286-321` release、`:325+` resume、`projection.ts:513` `stateVersion: 6`、`mailbox.ts:531` `dispatchOnce` 读相位；S4.3 `range.ts:39` `checkRanges` + 三错误码、`roster.ts:473` `TEAM_EFFORT_NOT_ALLOWED`、`:488` `TEAM_BACKEND_NOT_AVAILABLE`；S4.4 `mailbox.ts:176` `broadcast()`、`types.ts:411-413` 两个新事件；工具层 4 新工具 + `spawn_teammate` 增参已逐一在 diff 核对。边界 1 取证行号抽查成立：`child-agent.ts:205` 确为 `composeFrom(childCtx, parent.ctx)`。延后项（S4.3.6、档案卡片）如实标注 |
| 8 | 配置示例注释与上游语义 | **通过** | `agent-team-profile/cordis.patch.yml:28-38`：profiles 示例整块注释并说明「档案拥有 name、description 与 route」；三层白名单注明「集合语义、空列表不设限」——与 `range.ts:40/47/54`（`length > 0` 才生效）一致。`glm-harness/cordis.yml:28-34`：`maxRetries: 10` 带 4 行注释；「上游预算 10」有据（`dev-docs/2026-10-22-zcode-agentloop-parity.md:114` 上游 10 次；本仓默认 5 见 `retry-policy.ts:14`），2→10 正是把 GLM 覆盖从偏离拉回上游预算语义 |
| 9 | dev-docs 是否需要双语 | **判断：不需要** | `scripts/translation-pairing.manifest.json` `excluded` 含 `dev-docs/`；本目录既有惯例两语皆可（`2026-10-22-zcode-agentloop-parity.md` 纯中文、`2026-10-22-upstream-integration-report.md` 纯英文）。dev-docs 是过程记录而非产品文档，`docs/` 下的中英成对规范不适用；本规格用中文与「已知边界」表体裁一致 |

## ② 违规清单（3 条）

**V1【docs/config-catalog.i18n.yaml:194 附近｜规则 1】** 两个 section 哈希失步，闸门 exit 1。
修法：`pnpm run verify-translation-pairing --write docs/config-catalog.i18n.yaml` 重录两节哈希并随本轮提交（只改 yaml 哈希，不碰英文侧内容）。

**V2【agent-team/src/index.ts:74（`ea8785b21c8` 引入）｜规则 4 关联闸门】** `as unknown as z<readonly string[]>` 是**新增的对 unknown 的断言**，`scripts/no-unknown-casts.baseline.json`（最后更新 `eb61b2e8b8`）未含 `src/index.ts`，`verify-no-unknown-casts` exit 1。
修法（按仓纪律优先改写而非扩 baseline）：让 `AgentProfile.allowedEfforts` 的 schema 侧直接产出 readonly——例如用 `schemastery` 的类型层把数组 schema 包装为只读（参照同仓既有做法），或把 `AgentProfile.allowedEfforts` 收窄为 `string[]` 再在 `profile.ts` 归一化时冻结；若确需保留断言，须在 baseline 登记 + 记录理由。

**V3【dev-docs/2026-10-22-zcode-agentloop-parity.md:120,143,145（轻，跨轮漂移）｜规则 8 关联】** 仍写「GLM 覆盖压到 `maxRetries: 2`（cordis.yml:28-30）」，本轮已改为 10（现 `cordis.yml:34`），行号与结论双漂移。
修法：在该表加一行 2026-10-23 更新注记（「GLM 已对齐上游 10 次预算」），不必重排全文。

另记：工作树有 3 个未提交改动（`upgrade.spec.ts`、`TeamAction.tsx`、`llm-pi-ai/tests/catalog.spec.ts`），属兄弟会话在途改动，本报告未逐一深审。

## ③ 闸门执行清单（push 前必跑）

| 步骤 | 命令 | 期望退出码 |
|---|---|---|
| 1 | `pnpm run verify-translation-pairing`（只读，确认失步范围） | 当前 1，修复 V1 后 0 |
| 2 | `pnpm run verify-translation-pairing --write docs/config-catalog.i18n.yaml` | 0（重录后） |
| 3 | `pnpm run verify-config-catalog` | 0（当前已 up to date） |
| 4 | 处理 V2 后 `pnpm run verify-no-unknown-casts` | 0 |
| 5 | `pnpm run verify-export-jsdoc` | 0（已验证） |
| 6 | `pnpm run verify-cordis-config` | 0（已验证：220 files passed） |
| 7 | `pnpm exec oxlint --config configs/oxlintrc.json packages/experimental/agent-team/src/index.ts packages/experimental/agent-team/src/profile.ts packages/experimental/agent-team/src/range.ts packages/experimental/tool-agent-team/src/index.ts packages/llm/llm/src/error.ts` | 0（已验证） |
| 8 | `pnpm run verify-concrete-terms` | 当前 1（4 处命中文件均为 2026-10-22 既有改动，非本轮引入；push 前须知悉归属，由 electron/pack 相关 owner 修复） |
| 9 | whitespace 钩子（编码/行尾/EOF） | 本报告规则 5 已预检通过 |

步骤 1→2→4 为**红线**：不修复则 push 必被 CI 拒。
