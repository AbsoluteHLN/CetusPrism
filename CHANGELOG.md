# Changelog

所有显著变更记录于此。格式参考 Keep a Changelog；版本号遵循 SemVer。
本文件自 1.7.3 起建立——此前的版本历史以 git tag 与提交记录为准。

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
