# 上游差距评审：dsh-v0.2.1-rc.5 → dsh-v0.2.2-alpha.2（2026-11-03）

## 结论

本轮拉取上游最新评审标签 `dsh-v0.2.2-alpha.2`（2161 个提交、约 7253 个文件）。**不做整树合并**——本地浅历史无 merge-base，仓库纪律是选择性 backport（见 `docs/UPSTREAM.alignment.json`）。`fetched` 记录已更新，第三轮逐提交评审标记为 pending。

## 差距分布（按改动量）

| 区域 | 规模 | 主题 |
|---|---|---|
| packages/client + apps/web | ~900 文件 | Web 前端重构、会话流 UI |
| packages/experimental | ~640 文件 | 实验包大洗牌 |
| apps/desktop | ~180 | 桌面端 |
| **liveshare** | ~150 | 实时共享宿主/观看/客户端共享面（本轮最大新能力） |
| packages/core + session | ~260 | 会话核心 |
| packages/api / llm / web | ~290 | BFF、模型提供方、搜索 |

提交主题热点：web(218)、session(183)、desktop(102)、snapshot(63)、ptc(58)、sdk(35)、**liveshare(35)**、schedule(28)。

## 候选拉取清单（建议优先级）

1. **liveshare 宿主/观看面**——与 AeroidzServer 远程链路目标直接相关，建议整面评审后 backport
2. **session 持久化修复**（183 个提交里的修复类）——影响所有 fork 自有功能的地基
3. **sdk 变更**——远程客户端契约
4. ptc / snapshot 按痛点选择性拉取

## 保护项（fork 自有资产，拉取时不得覆盖）

- 四个模式的超频提示词（`packages/bundle/web-app/presets/*.patch.yml`，已登记 `forkOwnedCustomizations`）
- 本轮新增的 Pi/ZCode 外部运行时全套（adapter / transport / driver / source-build）——上游不存在对应物，无冲突风险
- `backendSeatVisible` 单按钮规则
