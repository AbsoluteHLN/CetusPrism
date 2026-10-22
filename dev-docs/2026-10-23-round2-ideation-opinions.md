# 第二轮分歧意见 · 取舍与盲点（idea架构师）

日期：2026-10-23　分支：`release/v1.7.3`（HEAD `“docs(spec): record what the fifth review's gaps turned into” 批次`，未自行复核 git 状态，采信题面）
输入：`dev-docs/2026-10-23-chief-adjudication-memo.md`（下称 memo）、第一轮 upgrade-ideas、题面仓库事实。凡「已验证」均注明本次核验方式；「未验证」处附验证方法。

---

## G. GLM 推理档位声明（技术意见，待用户拍板）

**结论**：技术上应当**解耦「发不发思考参数」与「思考可不可见」两件事**；在网关回传 `reasoning_content` 之前，我建议**不给 GLM 声明任何产生计费思考的档位**，最多只声明 `off: null`（显式允许「不发思考参数」这个状态）。

- **证据（已验证）**：部署态 `D:\Cetus\dshconfig\profiles\web\cordis.patch.yml:37-38` 的 GLM 条目只声明了 `id/name`，未声明 `reasoningEfforts`——即当前 GLM 路由不发任何思考参数、UI 也不提供档位。同文件 `:26-35`（DeepSeek）与 `:44-51`（Qwen）都是「实测后才声明」的范式，且备忘 D2 交叉核对证明过：CSU 对不同模型接受的档位集合不同（DeepSeek 拒 medium/minimal、Qwen 拒 high/max），声明错档位会 400。题面给定事实：GLM 网关接受全部档位但思考 token 不回传（64 tokens 内无 content、无 reasoning_content，未验证——我未复测，验证法：对网关发带 `reasoning_effort` 的 1-token 请求并检查响应体）。
- **技术取舍**：
  1. **token 成本**：思考 token 按输出计费且不可见。参照点是 csu/DeepSeek 在 xhigh 下 reasoning_tokens=23（spec §0.11 实测），Flash 级模型的思考开销可能不大——但 GLM 5.3-Flash 的思考量**未验证**（验证法：同请求对比有无 `reasoning_effort` 的 `usage` 字段）。
  2. **模型行为**：思考可能提升回答质量但用户不可见不可审计；CetusPrism 的前端价值主张恰恰是「思维链渲染」，不可见思考直接打在这条主线上。
  3. **可观测性**：烧掉的 token 无任何回传证据，用量面板只能看到费用涨，无法归因。
- **折中做法（按成本升序）**：
  a. **档位与可见性解耦声明**：给模型目录加一个记录性字段（如 `reasoningReturn: 'visible' | 'hidden'`），声明档位但 UI 标注「思考不回传（计费）」。成本：pi-ai config schema + 客户端一行展示，约 2-3 文件；代价是多一个配置面字段。
  b. **只在能回传的路由声明**（DeepSeek/Qwen 已实测回传，GLM 缓声明），零代码，纯部署态决策。
  c. 全量声明 + 依赖 `REASONING_EFFORT_REJECTED` 兜底拒绝。已验证分类器存在（`packages/llm/llm-pi-ai/src/stream.ts:113`），但它管的是「拒绝」，管不了「接受但不可见」。
- **若必须二选一**：我选**不声明**。理由：S2.1 的口径是「实测 + 声明」两条腿，实测结论包含「思考不回传」这一事实；声明应当反映用户实际得到的东西。GLM 不是默认路由（部署态默认是 csu/DeepSeek max，`:52-57`），等待成本很低；而「烧 token 不显示」一旦被选中是持续性的成本与信任损耗。
- **风险**：若 GLM 思考对复杂任务收益显著，不声明等于放弃这部分质量；折中做法 (a) 可在用户愿意付「不可见成本」时兜底。

---

## H. D4 / D5 / D7 裁决意见

### D4 · STREAM_CLOSED 是否进共享默认重试集 —— **不改默认集，开逐路由 opt-in**

- **证据（已验证）**：默认可重试集为 `EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT`（`packages/llm/llm/src/retry-policy.ts:18-24`），STREAM_CLOSED 不在内；`packages/llm/llm-retry/tests/transport-recovery.spec.ts:191-214` 钉死其行为——1 次请求、零重试、turn 以 `STREAM_CLOSED` 错误终局。
- **结论**：**不改共享默认集；用既有 `retryPolicy.retryableCodes`（`retry-policy.ts:43`）按路由开启**。
- **理由**：partial EOF 是「响应体读到一半断掉」——已有部分文本流到用户侧（用例里 `partialText` 被丢弃、未 commit，`transport-recovery.spec.ts:207-208`）。重试语义上不重复（未提交任何 assistant/message），但成本上整段 prompt 重计费；若端点是系统性截断（长响应必断），5 次重试就是 5 倍成本——这正是 retry-storm 的形态。默认集是全仓共享面（备忘 §四：共享驱动不改默认值），而 opt-in 一个字段是既有机制，零新代码。
- **风险**：opt-in 路由的持有者需要理解「断流重试会重复计费」；建议在 llm-pi-ai README 的 `retryPolicy` 字段表加一句措辞（双语 + i18n 重录，`verify-translation-pairing` 走既有闸门）。

### D5 · pi-ai 链路 Retry-After 丢失 —— **接受缓解 + 向上游提 issue，双轨**

- **证据（已验证）**：仓库侧注释已自认根因——pi-ai 在边界把 Error 链压平成 message 字符串、丢弃 `cause`（`packages/llm/llm-pi-ai/src/stream.ts:40-46` 明文写着「discarding the original Error and its `cause` chain before it reaches us」）；`classifyPiAiError` 只能对**文本**做正则分类（`stream.ts:96-140`），无从拿到 HTTP 头。本地缓解位是 `retryPolicy.backoff.maxDelayMs`（`retry-policy.ts:31`，默认 10s）。`providerRetryAfterMs` 的覆盖机制在 `llm/src/index.ts:85,126` 存在，但 pi-ai 侧造不出这个值。
- **结论**：**接受缓解 + 向上游提 issue，两件都做**。缓解立即生效；上游修复（转发 cause 或 Retry-After）才是根治，且本仓注释（`stream.ts:45-46`）已经写明了期待形态——把这段直接贴进 issue 即可。
- **风险**：缓解的盲区是「上游要求等待 > maxDelayMs」：网关说等 60s，本地 10s 就重试，等于把 RATE_LIMIT 打成连续失败。若部署态网关确实长惩罚，把该路由 `maxDelayMs` 提到覆盖值即可（纯配置）。不建议在本仓 hack fetch/dispatcher 钩子去抓头——维护成本高于收益（AGENTS.md:137 优先维护中的依赖）。
- **未验证**：上游 pi-ai 是否已有相关 issue/修复计划——未验证，提 issue 前先搜其 tracker。

### D7 · discovery 对换址 baseURL 不 interrogate —— **不值得改**

- **证据（已验证）**：取舍已声明：目录自带的路由不 interrogate、只有目录未描述的路由才走网络询问（`packages/llm/llm-pi-ai/README.md:113`）。
- **结论：不改。** 决定性事实：当前部署唯一路由 `csu` 是**手工声明路由**（`cordis.patch.yml:14-15` 显式 `api`+`baseURL`，不在已安装目录里）——按 `README.md:113` 的规则它**本来就走网络询问**。D7 只影响「目录自带路由被换 baseURL」这一场景，而该场景现在不存在。
- **风险**：若未来有人把目录路由（如 openai）换址到私有网关，设置面会显示目录里的模型目录而非真实端点能力——到那天再给 discovery 加「换址即重新询问」的开关不迟，或并入第一份清单思路 5 的手动探针。

---

## I. 本轮盲点（架构师自答）

### I.1 最可能系统性漏掉的问题类

**结论：「持久数据 × 新代码」与「共享驱动 × 全量包」两类，且都已有具体嫌疑点。**

- 证据（本轮工作的覆盖面，已验证）：备忘 §五.4 的全部验证都是**单包 focused vitest**（agent-team / tool-agent-team / client-ui-agent-team / llm）；域集中在 agent-team + 模型接入。全仓约 40+ 包（`AGENTS.md:16-69` 的包组表），本轮除红线修复外未触及其余包。
- 最可能漏掉的三类，按风险排序：
  1. **旧持久日志重放**：stateVersion 5→6 的老会话重放回归被明确**留第二轮**（备忘 §五.2 缺口 5、`:163`）。备忘 §五.3 的「老折叠是新版子集、不会引入 failure」是**推理**，不是**执行证据**——重放回归（重写版缺口 5）还开着。这是本类问题的代表：单元用例全部从零造事件，没有一条用真实生产 JSONL 验证过。
  2. **部署态与仓库态漂移**：所有验证都在仓库树内跑，而用户的 App 是安装态且**尚未重启加载修复**（备忘 §四:130 明示）。部署态是另一个运行面（见 I.3 的两个实例）。
  3. **非功能性回归无门禁**：本轮动了 prompt 准入、压缩预算、developer role 方言——这些直接改 KV-cache 前缀命中与 token 成本，README「模型体验」各节把 KV Cache 效应当契约写（如 `packages/core/agent-loop/README.md:162`），但没有任何测量在跑；`benchmarks/` 性能门（`AGENTS.md:72`）本轮无运行证据。
- 方法论原因：六份审查出自同一次会话、同一批文件、同一套「读代码+跑单测」动作——它天然只覆盖**静态、单包、从零造数据**的问题类，漏掉的正是**时间维度（旧数据）、空间维度（未审查的包）、资源维度（token/缓存）**。

### I.2 只能再做一件事，做哪件

**结论：老会话（真实生产 JSONL）重放冒烟。**

- **理由**：它是唯一能同时命中「已识别但留第二轮的 stateVersion 重放缺口」（备忘 §五.2:163、§五.3 判断 3）和「下一版发布最大爆破半径」的动作——v1.7.3 一旦发出，用户旧 Session 打不开是最高优先级事故，而现有 `test:snapshot`（`AGENTS.md:90`）回放的是**录制夹具**，不是生产日志。备忘 §五.3 对 stateVersion 的兼容论证是纯推理（「旧版接受的边新版不存在」），把它变成执行证据只需要：拷贝生产数据目录中的真实 JSONL（只读、不触碰原文件），跑当前投影/查询路径，断言零 `failure`、快照集合完整。
- **成本**：1 个脚本或 spec（把生产样例 JSONL 拷进测试夹具，键控脱敏）+ 跑一轮 `pnpm vitest run --config configs/vitest.config.ts`；不触共享源码。
- **风险与前置**：夹具里可能含真实对话内容，需脱敏或放 git-ignored 的 owner-local 位置；「哪条路径算『通过』」要先定义（建议：`agentTeam` 投影重建成功 + `session-query` 全量可读 + 无 `failure` 字段）。
- **次选**（如果只能选闸门类）：pre-push 追加 affected vitest，但**必须连 `--config configs/vitest.config.ts` 一起钉**——备忘 §五.3 已证明裸命令会制造假红灯（`package.json:56` 是真源）。它是流程改进，兜的是「改动者忘了跑」，覆盖面不如重放。

### I.3 没人提过的部署态/仓库侧不一致（已验证两例）

1. **GLM 条目没声明 `contextWindow`**：`cordis.patch.yml:37-38` 只有 id/name。后果链：hand-declared 模型无目录条目可继承 → 走路由 `defaultContextWindow 262,144` 回退（`packages/llm/llm-pi-ai/README.zh.md:84`）→ 压缩阈值按 262K 算。若 GLM-5.3-Flash 真实窗口是 128K（同路由 DeepSeek 实测声明 128000，`:36`），压缩触发点**晚一倍**，长程任务会在逼近真窗口时溢出重试。**修复是部署态一行**（声明实测值），仓库侧零改动；实测方法：探针响应元数据或长程会话观察 `request/context` 日志。**未验证项：GLM 真实窗口大小。**
2. **部署态夹带仓外插件与明文凭据**：`insert` 引入 `file:///E:/KalciriteTools/agent-adapters/dsh-bot-companion/index3.js`（`cordis.patch.yml:87-88`），其 qq 配置内嵌 `loginUrl` 带 token（`:115`，值不复述）。两个问题：该插件完全绕过仓库全部闸门（JSDoc/i18n/`any` 禁令），仓库对它的存在零记账；明文 token 违背「Never commit credentials」的精神（`AGENTS.md:124`——虽在部署态非 git 文件，但同机泄露面存在）。**建议**：不删（部署态是用户资产），但在下一版备忘登记「部署态依赖清单」，并提醒该 token 宜改走环境引用。**未验证**：该插件版本与当前仓库 API 的兼容性。
3. 顺带核对过的一致项：部署态 `subagent-model-selection-settings.enabled: true` + 桌面 overlay 关闭另一半注册（`:127-138` 注释）与备忘 §二 记账一致，无冲突。

---

## 已验证 / 未验证汇总

| 类别 | 项 |
|---|---|
| 已验证（本次 Read/Grep） | D4 测试与默认集（`transport-recovery.spec.ts:191-214`、`retry-policy.ts:14-24,43`）；D5 上游压平（`stream.ts:40-46`）与 `providerRetryAfterMs` 通道（`llm/src/index.ts:85,126`）；D7 取舍声明（`README.md:113`）与 csu 为手工路由（`cordis.patch.yml:8-15`）；GLM 条目无档位声明、默认路由为 csu/DeepSeek max |
| 未验证（采信题面/备忘，未复跑） | GLM 64-token 无回传；网关对三模型的档位接受矩阵；「App 未重启」的当前运行态；koutput 探针脚本内容（`probe-effort-classification.ts` 等） |
| 本文档未运行任何测试或构建命令 | 全部结论基于只读取证 |
