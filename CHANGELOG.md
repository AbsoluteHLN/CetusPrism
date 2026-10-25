# Changelog

所有显著变更记录于此。格式参考 Keep a Changelog；版本号遵循 SemVer。
本文件自 1.7.3 起建立——此前的版本历史以 git tag 与提交记录为准。

## [1.7.5] - 2026-10-26

版本线说明：产品版本 `1.7.4` → `1.7.5`；workspace 包版本 `0.2.1-alpha.1` 不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 随产品版本推进）。
本次按既有发布形状手工提升（根 `package.json` + 两个安装器应用 + 对齐记录 + 约束期望值），
**未使用** `pnpm run release:dsh`——该脚本按上游 dsh 的「全族单一版本线」模型工作，
会把约 280 个工作区包一并改写成产品版本，与本仓的双版本线约束闸门冲突。

### 模型目录反复取数与连接卡顿：一个根因族

- **根因（取数风暴）**：`llm/adapters-updated` 是无载荷事件，adapter 每次注册/替换/注销都会发一次；
  客户端有 4 处独立位置各自发 `session/modelCatalog` RPC，而 Host 端既无缓存也无 single-flight，
  每次都全量重算 providers × models。
- **根因（卡顿）**：客户端的 `ModelCatalogDirectory.refresh()` 主动清空在途请求，
  每个事件必开一条新请求；Chromium 同源 HTTP/1.1 只有 6 条并发连接，第 7 条起排队——
  于是「模型反复获取」在用户侧就表现为「后端与软件本体连接卡顿」。
- **放大器**：WS 心跳 2s，连续 2 次丢 pong 即 `terminate()` 重连，事件循环抖动被放大成一次完整重连，
  UI 还会强制显示 800ms「重新连接中」。
- **修复（Host 侧）**：`packages/api/session-controller/src/model-catalog-cache.ts` 新增
  `ModelCatalogCache`——TTL 3s + single-flight + generation 失效。`llm/adapters-updated`
  只作废不再重算；部署默认选择变化时缓存自动重建（默认键比对）。
- **修复（客户端侧）**：`packages/client/ui-model-selection/src/client/catalog.ts` 把同一波事件
  合并成一次读（60ms 窗口）；刷新期间目录立即置 `loading`，旧值不再应答读者；
  已在途的读**不丢弃**——等它结算再读一次，保证合并后仍拿到新鲜目录。
- **修复（面板侧）**：`packages/client/ui-settings-models` 的刷新同样合并，且只在已加载时刷新，
  空闲页面不因 adapter 事件白白取数。
- **回归**：`model-catalog-cache.host.spec.ts`（5 例）、`catalog.client.spec.ts`、
  `store-refresh.client.spec.ts`。三条红线各自被证伪后还原：关掉 Host 缓存复用 → 2 失败；
  客户端改回立即 reload → 2 失败；面板改回立即 load → 1 失败。

### Pi 与 ZCode 收敛为一种「外部运行时底座」

- **一个模式，两个上游**：`packages/preset/agent-preset-registry/src/external-runtime.ts`
  给出统一帧契约（request / notification / response / error）与统一帧解析——
  坏行返回 parse-error 帧，而不是抛出打断流。
- **底座从各自仓库来**：探测器只**查找**不下载。Pi 走 `pi --mode rpc --no-session`（JSONL），
  ZCode 走 `zcode app-server --stdio`（NDJSON）；未安装时报告「去哪个仓库装」，版本低于下限则拒绝。
- **不往产品依赖树加包**：两种底座都不作为 npm 依赖进入 CetusPrism，
  产品侧只提供统一适配器契约（`ExternalRuntimeAdapter`）。
- **去重**：`resolveBuiltinAgent` 的非 native 分支现在识别 pi/zcode，并说明「这是通过外部运行时
  注册表进入的同一种执行模式」，不再为 ZCode 保留一套独立底座逻辑。

### Linux 构建准备

- `apps/electron/scripts/build-deb.mjs` 的 `RUSTFLAGS` 增加
  `--remap-path-prefix=${CETUS_DEPENDENCY_ROOT}=cargo-cache`（含正斜杠形式），
  Linux 产物不再泄露依赖缓存绝对路径；此前只有 Windows 的 `build-shell.mjs` 做了这件事。
  前缀跟随依赖根而非硬编码，因此缓存放在别处的 Linux 主机同样覆盖。

## [1.7.4] - 2026-10-25

版本线说明：产品版本 `1.7.3` → `1.7.4`；workspace 包版本 `0.2.1-alpha.1` 不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 随产品版本推进）。

### 思考强度按模型能力裁定（跨模型携带脏 effort 的根治）

- **根因**：思考强度是**每个模型各自的能力**，不是全局概念。实测 `csu` 网关：
  Qwen 只吃 `off/low/medium/xhigh`，给 `high` 直接 400
  （`Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.`）；
  GLM 七档全吃，DeepSeek 五档。父模型（GLM/DeepSeek）给 Qwen 子路由写下
  `high`/`max` 这类脏值时，委派被整体拒绝——**模型本身可用，是能力协商缺失**。
- **协议中立的档位阶梯**（`packages/llm/llm/src/reasoning-effort.ts`）：
  `REASONING_EFFORT_LADDER`（off < minimal < low < medium < high < xhigh < max）
  与 `selectSupportedReasoningEffort`（精确命中 → 不低于请求的最近支持档 →
  否则最高支持档），不认识任何 provider。
- **裁定点落在请求边界**（`packages/core/agent-loop/src/agent.ts`）：在 waterfall 之后、
  `prepareCall` 之前统一裁定，一处覆盖主 Agent / 子智能体 / Agent Team 成员三条路径。
- **降级值不冒充用户选择**：降级时把 `adapterDefaults.reasoningEffort` 置为 `true`，
  沿用 llm 层「adapter 填充的默认值不算用户选择」的既有语义，下次 seed 自动丢弃。
- **委派路径同规则**（`packages/subagent/tool-subagent/src/model-selection.ts`）：
  父模型写的档位属于「模型作者」而非用户选择，故降级而非报错；子模型完全没有档位
  词汇时丢弃该档、用其自身默认。
- **既有契约一行未动**：`packages/llm/llm/src/index.ts` 的 `resolveCallWithInfo` /
  `UNSUPPORTED_REASONING_EFFORT` 严格拒绝语义保持不变——同一模型上用户显式选的非法档仍报错。

### 通用思考强度探针

- **探针实现**（`packages/llm/llm-pi-ai/src/effort-probe.ts`）：本期支持
  `openai-completions`；每档恰好一次请求；`off` 不发请求且声明恒为 `null`；
  2xx 即接受，非 2xx 拒绝并有界读取正文（≤64 KiB）；解析端点自报档位集合；
  apiKey 绝不入消息与日志。错误码 `EFFORT_PROBE_UNSUPPORTED / FAILED / ABORTED /
  INVALID_CREDENTIAL`；`openai-responses` / `anthropic-messages` 明确报不支持。
- **宿主 seam**（`packages/llm/llm-pi-ai/src/effort-probe-host.ts`）：复用 discovery
  同款 `storedDiscoveryProfile` 懒解析，探针复用**宿主持有的凭证与部署头**（含自鉴权
  header 通道），凭据不由请求方传入。
- **宿主 API**：`registerReasoningEffortProbe` / `probeReasoningEfforts` 与
  `@Remote('probeReasoningEfforts')` 远程声明。
- **探测优先、端点自报为辅**：自报集合不能替代逐档实测，冲突以实测为准并在 detail 说明。
- **产出可直接落库**：`declaration` 键=档位名、值=wire 拼写、`off: null`，与
  `llm-pi-ai` 的 `reasoningEfforts` schema 完全兼容，无需改配置 schema。
- **Models 页 UI**（`packages/client/ui-settings-models`）：每个模型行新增「探测推理档位」
  与「写回声明」，写回**只动被探测的那一个模型条目**的 `reasoningEfforts`，不碰同
  provider 的其它模型；中英双语字典齐备。

### 目录与文档

- `scripts/gen-cordis-catalog.ts` 的 `LINK_MAP` 登记两个新 remote 类型，
  重新生成 `packages/extensions/tool-cordis/src/api-catalog.ts` 与
  `docs/subsystems/llm-streaming.md` / `.zh.md`；`gen-cordis-catalog --check` 回到 exit 0
  （121 个产物 up to date）。

### 测试与验证

- 受影响包全绿：agent-loop + tool-subagent 32 文件 / 601 用例；llm-pi-ai 18 / 418；
  llm 14 / 300；ui-settings-models 13 / 331。
- 全量回归（`vitest run --config configs/vitest.config.ts`）：1910 文件 / 38860 用例，
  98 个失败文件**无一落在本轮改动包**；失败签名分布与既有基线吻合（EPERM symlink 60 /
  超时 21 / 缺 pwsh 9）。
- lint（`tsx scripts/run-oxlint.ts .`）exit 0；25 个改动文件全部 LF-only、无 BOM。
- 真机客户端窗体实测：选中 `csu/Qwen3.8-Flash-Next` 发真实消息，2 秒返回且无 4xx/5xx；
  该模型的档位菜单实测为 `Default / Off / Low / Medium / Xhigh`。

### 备注

- 本次版本号变更：4 个版本文件（根、`apps/desktop`、`apps/electron` 的 `package.json`，
  `docs/UPSTREAM.alignment.json` 的 `productVersion`）与本 CHANGELOG；
  **尚未打 tag、尚未发布 GitHub Release**。
- `pnpm-lock.yaml` 实测零 diff（workspace 协议版本不写入 lock）。
- 328 个 workspace 包仍在 `0.2.1-alpha.1`，本轮不动。

## [1.7.3] - 2026-10-21

版本线说明：产品版本从 `1.7.1-beta.1` 直接推进至 `1.7.3`。
`1.7.1-beta.1` 与 `1.7.2` 均无对应 git tag（本地 tag 最高为
`v1.6.2-prelease-2026-10-6-A`；`origin/main` 历史含 `v1.7.0-beta.2`
release 元数据提交，见 `archive/2026-10-13/main-review-origin-main`）。

### OneBot 通道（dsh-bot-companion）

- **直接回复分流**：群聊/私聊消息先过确定性分类器 `classifyQqProcessing`
  （`index.js:1129`），问候语与确认类短句（`QQ_DIRECT_PREFIX` 前缀，
  `index.js:1084`）走 canned 直复路径 `sendDirectReply`（`index.js:2011`），
  真实请求经 `dispatchRoute`（`index.js:2043`）进会话队列；带
  `/dev` 前缀的前缀直复会升级为 agent 请求而非丢失。
- **会话并发模型**：每会话严格 FIFO（`enqueueConversation`，
  `index.js:1408`），跨会话并行受 `maxConcurrentSessions` 闸门约束
  （`acquireDeliverySlot`，`index.js:1436`）；`bot_qq_status` 工具暴露
  `concurrency` 探针（活跃/峰值/排队/丢弃计数，`index.js:1456`）。
- **入站媒体提取**：`extractInboundMedia`（`index.js:1186`）只报类型与
  NapCat 已落盘的本地路径，不透传 QQ CDN 短时效签名链。
- **发送可靠性与节流**：`onFrame` 按 `message_id` 全局去重防重连重放
  （`index.js:2174`），`sendAction` 节流（`index.js:2093`）。

### MCP server（tooLib/QQBot/mcp-server）

- **会话感知保留**：队列超限时优先驱逐「仍持有其他消息的会话」的最旧行，
  繁忙会话不再顶掉其他会话的可回复消息；每次丢弃都计数
  （`server.mjs:131-139`），`droppedMessages` / `oldestCursor` 随收件箱返回
  （`server.mjs:169`）。
- **收件箱游标语义**：`cursor < oldestCursor - 1` 返回 `cursor_expired`
  （`server.mjs:164`），过期游标必须重新全量拉取，绝不静默跳过。

### 测试基建（本轮新增 45 用例，全部离线）

- `dsh-bot-companion/tests/fake-qq-source.mjs`：离线 fake WebSocket 与
  gated prompt 宿主，测试不触网、不连真实 QQ。
- `dsh-bot-companion/tests/direct-reply.test.mjs`：31 用例，覆盖直复
  分类矩阵、直复端到端与错误路径。
- `dsh-bot-companion/tests/concurrency.test.mjs`：8 用例，覆盖会话内
  FIFO、跨会话并行、并发上限、队列满丢弃计数、global 模式与 steer。
- `tooLib/QQBot/mcp-server/tests/retention-observability.test.mjs`：
  6 用例，覆盖会话身份、保留驱逐、busy 恢复、媒体契约与 8000 字上限。
- 离线运行结果（`node --test`，node-runtime 绝对路径）：
  companion 套件 89 tests / 86 pass / 3 fail（3 例均为既有失败：
  `companion.test.mjs` manifest 导出形状 1 例、`connector.test.mjs`
  owner DM 与群成员 /dev 各 1 例，与本轮新增文件分进程隔离）；
  mcp-server 套件 37 tests / 37 pass。

### 备注

- 本次版本号变更随本 PR 提交：6 个版本文件（根与 4 个 app 的
  `package.json`、`docs/UPSTREAM.alignment.json` 的 `productVersion`）
  与本 CHANGELOG 已进入本分支；**尚未打 tag、尚未发布 GitHub Release**。
- `pnpm-lock.yaml` 实测零 diff（workspace 协议版本不写入 lock）。
