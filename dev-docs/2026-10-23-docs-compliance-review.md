# 文档与规范合规核对（agent-team composer 轮）— 2026-10-23

核对对象：本轮 `feat(agent-team)` 三批提交（`S4 服务层批次` / `S4 工具层批次` / `S4 配置+规格批次`）及其后的修复与文档提交，**当前基线 HEAD `“docs(spec): turn the replay argument into evidence…” spec 批次`，工作树干净**。行号一律以当前工作树为准。核对方式只读：跑仓库闸门（不带 `--write`）+ 读源码 + 读 git 历史（log/diff/show），未做任何 git 写操作。
上一版报告（基线 `“docs(spec): record the fifth review's corrections and adjudication” 批次`，报 3 条违规 V1–V3）已入库；本版为**复核更新**：逐项重跑全部闸门，确认 V1/V2/V3 闭环状态并覆盖新增提交（`“fix(agent-team): stop the mailbox from waking a dormant teammate” 修复`、`“fix(agent-team): declare the effort list the way the runtime keeps it” 修复`、`“fix(tool-agent-team): say that a preset is recorded, not applied” 修复`、`“docs(spec): correct the parity table's GLM retry budget and line numbers” 修正`、`“docs(spec): realign the memo with the review's rewritten draft” 批次`、`“docs(review): land the rewritten compliance review and the round-two opinions” 批次`、`“fix(agent-team): let the profile pin the preset, and keep the resume failure” 批次`、`第二轮裁决记录批次`、`“docs(spec): turn the replay argument into evidence…” spec 批次`）。

## 结论摘要

**八条规则全部通过；上一轮 3 条违规（V1/V2/V3）已全部闭环；push 前仍剩两个红闸门，但均为 2026-10-22 及更早的其他批次遗留，不属本轮改动。**

- `verify-translation-pairing` 全仓 **558 对全部一致，exit 0**（上一轮 V1 失步已消除）。
- `verify-export-jsdoc` **exit 0**；`verify-config-catalog` / `verify-cordis-config`（220 files）/ oxlint / 编码检查全部通过。
- `verify-no-unknown-casts` 仍 **exit 1**，但失败条目已**不含本轮任何文件**（agent-team 的 `src/index.ts:74` 已由 `“fix(agent-team): declare the effort list the way the runtime keeps it” 修复` 以改写声明方式消除）；剩余条目来自 `“fix(discovery): register list_subagent_models once per scope” 批次`、`“feat(conversation): move the preset and backend chips into the composer tool row” 批次` 等 2026-10-22 及更早提交。
- `verify-concrete-terms` 仍 **exit 1**（4 处命中与上一轮完全相同：`apps/electron/README.md:275`、`apps/electron/README.zh.md:138`、`apps/electron/scripts/pack-tauri.mjs:116`、`scripts/check-offline-pack.mjs:11`），非本轮引入。

## ① 合规核对表

| # | 规则 | 结论 | 证据 |
|---|---|---|---|
| 1 | README 双语同步 + 哈希重录 | **通过** | `pnpm run verify-translation-pairing packages/experimental/agent-team/README.md`、`…README.zh.md`、`…tool-agent-team/README.md`、`…README.zh.md` 各自 exit 0（「1 named pair(s) consistent」）；不带参数全仓语料校验 **558 pair(s) checked, all consistent, exit 0**（上一轮 V1 的 `docs/config-catalog.i18n.yaml` 两节失步已随 `“feat: integrate optional ZCode guidance…” 集成批次` 之后的重录闭环）。四个 README 三件套（.md/.zh.md/.i18n.yaml）均在本轮 diff 中同步更新（对服务层批次跑 `git show --stat`：README.md/zh.md/i18n.yaml 各 ±24 行） |
| 2 | 导出 JSDoc | **通过** | `pnpm run verify-export-jsdoc` exit 0（全仓：「every exported name in each package API is documented」）。人工抽查：`profile.ts:44-51`（`AgentProfileRegistry` 类）、`:54`/`:68`/`:76`/`:85`（构造器与三方法全带 `@param`/`@returns`/`@throws`）；`range.ts:5-11`（`TeamRanges`）、`:18-26`（`RangeRequest` 字段级注释）、`:28-38`（`checkRanges` 带 `@throws` 三错误码）。tool-agent-team 新增 4 工具（`broadcast_message`/`list_agent_profiles`/`release_teammate`/`reactivate_teammate`）与改造的 `spawn_teammate` 为 `defineTool` 对象字面量、非包导出，JSDoc 闸门不覆盖；均带完整 `description` 与逐参数描述（`tool-agent-team/src/index.ts:372-411`、`:492`、`:527`、`:584`、`:600`），且 `“fix(tool-agent-team): say that a preset is recorded, not applied” 修复` 已把 preset 措辞降级为「记录性字段」 |
| 3 | schemastery 风格 | **通过** | agent-team 服务 schema 可选字段一律裸 `z.string()`（`agent-team/src/index.ts:68-70,75-76`），必填用 `.required()`（`:60-67`），无 `.optional()` 误用；带 4 行注释解释 `allowedEfforts` 为何声明为可变数组（`:71-74`）。全 experimental 包 `.optional()` 命中均为 **zod** 侧（`projection.ts:3` 为 `import { z } from 'zod'`，zod 的 `.optional()` 是正确写法，不适用本规则）；tool-agent-team 新 schema 用 `{ type: 'string' }` 无 `required` 表示可选，一致。类型契约冲突已闭环：`types.ts:92` `readonly allowedEfforts?: string[]`（可变数组，注释说明 view 侧才 readonly）与 schema `z.array(z.string())`（`index.ts:75`）同型——`“fix(agent-team): declare the effort list the way the runtime keeps it” 修复` 以改写声明而非 baseline 登记方式关闭上一轮 V2 |
| 4 | lint 严（禁 any/未用） | **通过** | oxlint 对两个 experimental 包整体 exit 0（`tsx scripts/run-oxlint.ts packages/experimental/agent-team packages/experimental/tool-agent-team` → EXIT=0），仅 3 条 warning（「Unused oxlint-disable directive」：`mailbox.ts:618`、`roster.ts:737`、`roster.ts:868`，均为 `typescript/no-deprecated` 抑制）。溯源：`git log -S` 显示这批指令来自 `v1.6.2 初始导入批次`（2026-10-02 初始导入），非本轮引入，且 warning 级不挂闸门。本轮新增代码零 `any`、零未用变量（pre-commit staged lint 与本检查双重覆盖） |
| 5 | UTF-8 无 BOM + LF + EOF | **通过** | 本轮 39 个改动文件（对「服务层批次起 → HEAD」范围跑 `git diff --name-only`，限定 `packages/experimental apps/cli/config dev-docs`）逐一字节级检查：BOM=0、CRLF=0、孤立 CR=0、EOF 无多余空行（脚本输出「ALL CLEAN」）。S4 配置+规格批次到 HEAD 之间的 23 个后续提交文件同批覆盖 |
| 6 | 产物只进 `koutput/` | **通过** | `git ls-files koutput/` 为 0 条；上一版基线到 HEAD 的 23 个改动文件全部位于 `packages/`、`dev-docs/`、`apps/cli/config/`、`docs/`，无产物外溢 |
| 7 | 规格 §4.8 与代码一致 | **通过（含 2026-10-23 增补逐条核对）** | S4.1 `profile.ts:51` `AgentProfileRegistry`、`roster.ts:460-477` name/backend/preset 三类 `TEAM_PROFILE_CONFLICT`、`profile.ts:94` `TEAM_PROFILE_UNKNOWN`；**S4.1.7 preset 冲突口径**：`roster.ts:472-477`「request.preset ≠ profile.preset → `TEAM_PROFILE_CONFLICT`」与 spec 增补行一致；S4.2 dormant：`types.ts` 相位枚举含 `dormant`、`roster.ts` release/resume、`projection.ts` `stateVersion: 6`、**dormant 不被投递唤醒** `mailbox.ts:583-586`（`parkedMember()`，`“fix(agent-team): stop the mailbox from waking a dormant teammate” 修复`）——spec「单播投递读目标相位，dormant 不冷复原」与代码一致；resume 失败回写语义（先记 active、失败回 dormant + `error` 字段）由 `“fix(agent-team): let the profile pin the preset, and keep the resume failure” 批次` 落地并带 +110 行测试（回归审查员已独立验收）；S4.3 `range.ts:39` `checkRanges` 三错误码；S4.4 `mailbox.ts` `broadcast()`；工具层 4 新工具 + `spawn_teammate` 增参逐段核对。**边界新增项**（「allowedPresets 不与 preset 目录对账」+ 2026-10-23 裁决）与 `tool-agent-team/src/index.ts:411` 的 preset 参数描述（「须为部署声明过的 preset id；未声明 id 被记录但不生效」）一致 |
| 8 | 配置示例注释与上游语义 | **通过** | `agent-team-profile/cordis.patch.yml` profiles 示例整块注释并说明档案拥有 name/description/route；`glm-harness/cordis.yml:34` `maxRetries: 10` 带 4 行注释，与上游 10 次预算同源（`dev-docs/2026-10-22-zcode-agentloop-parity.md:114` 上游 10、本仓默认 5 `retry-policy.ts`）。2→10 是把 GLM 覆盖拉回上游预算语义，非放大重试；`“docs(spec): correct the parity table's GLM retry budget and line numbers” 修正` 已同步修正 parity 文档漂移（V3 闭环） |
| 9 | dev-docs 是否需要双语 | **判断：不需要** | `scripts/translation-pairing.manifest.json` `excluded` 含 `dev-docs/`；既有惯例两语皆可（`2026-10-22-zcode-agentloop-parity.md` 纯中文、`2026-10-22-upstream-integration-report.md` 纯英文）。dev-docs 是过程记录而非产品文档 |

## ② 违规清单

**本轮合规违规：0 条。**

上一轮 V1–V3 处置核验：

- **V1（`docs/config-catalog.i18n.yaml` 两节哈希失步）→ 已闭环**。全仓 `verify-translation-pairing` 558 对一致、exit 0。
- **V2（`agent-team/src/index.ts:74` 新增 `as unknown as` 断言未入 baseline）→ 已闭环**：`“fix(agent-team): declare the effort list the way the runtime keeps it” 修复` 改写声明（types.ts:92 可变数组 + schema 保持 `string[]`），断言整体删除；`verify-no-unknown-casts` 失败列表已无 agent-team 文件。
- **V3（`2026-10-22-zcode-agentloop-parity.md` GLM retry 行号与结论漂移）→ 已闭环**：`“docs(spec): correct the parity table's GLM retry budget and line numbers” 修正` 修正，现 `:120` 写明「GLM 覆盖对齐上游预算 maxRetries: 10（cordis.yml:34）」。

**跨批次遗留（非本轮引入，但 push 前须知悉归属）2 条**：

- **L1【`verify-no-unknown-casts` exit 1｜未知归属批次】** 剩余未登记断言位于 `packages/client/ui-agent-preset/tests/apply.client.spec.ts`（多处）、`packages/core/scope/tests/invariant.spec.ts:37-38`、`packages/subagent/tool-subagent/src/list-models.ts:113`（`“fix(discovery): register list_subagent_models once per scope” 批次`，2026-10-22 discovery 批次）等约 20+ 条，全部为 2026-10-22 及更早提交引入。修法：由各批次 owner 走「改写优先、扩 baseline 须记录理由」流程，或由 Chief 集中登记 baseline。
- **L2【`verify-concrete-terms` exit 1｜electron/pack 相关 owner】** 4 处命中（`apps/electron/README.md:275`、`apps/electron/README.zh.md:138`、`apps/electron/scripts/pack-tauri.mjs:116`、`scripts/check-offline-pack.mjs:11`）与上一轮完全相同，非本轮引入。

## ③ 闸门执行清单（push 前必跑）

| 步骤 | 命令 | 期望退出码 | 本报告实测 |
|---|---|---|---|
| 1 | `pnpm run verify-translation-pairing`（只读，全仓） | 0（已验证：558 pairs consistent） | ✅ |
| 2 | `pnpm run verify-export-jsdoc` | 0（已验证） | ✅ |
| 3 | `pnpm run verify-config-catalog` | 0（已验证：up to date） | ✅ |
| 4 | `pnpm run verify-cordis-config` | 0（已验证：220 files passed） | ✅ |
| 5 | `pnpm exec oxlint --config configs/oxlintrc.json packages/experimental/agent-team packages/experimental/tool-agent-team` | 0（已验证；3 条初始导入遗留 warning 可容忍） | ✅ |
| 6 | whitespace / 编码钩子 | 本报告规则 5 已预检通过（39 文件零 BOM/CRLF/EOF 异常） | ✅ |
| 7 | `pnpm run verify-no-unknown-casts` | 当前 **1**（遗留约 20+ 条，见 L1；不属本轮，push 前须由归属 owner 处置或 Chief 集中登记） | ⚠️ |
| 8 | `pnpm run verify-concrete-terms` | 当前 **1**（4 处遗留，见 L2，electron/pack owner） | ⚠️ |
| 9 | `pnpm run typecheck`（pre-push 唯一类型闸门） | Chief 闸门；`tsc -b` 已绿，完整 typecheck 由 Chief 确认后放行 | ⏳ |

**红线结论**：本轮自身 0 红线；步骤 7/8 的失败为跨批次遗留，push 前必须由 Chief 明确归属——要么修掉，要么登记 baseline 后知悉放行，否则 CI 仍会拒。
