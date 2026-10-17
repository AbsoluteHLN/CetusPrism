# CetusPrism 2026-10-18 集成验收记录

基于本地整合后的 `main`，产品版本保持 `1.7.1-beta.1`。本记录与[实施规格](2026-10-18-integration-spec.md)配套；最终提交由 Git 历史标识，不发布 release。

## GitHub 与官方兼容

- GitHub main 的最新 Linux 工作已通过本地 merge 纳入，包含 [PR #8](https://github.com/AbsoluteHLN/CetusPrism/pull/8) 的 Linux 打包、长期 TUI 和 Team 模型限制。
- [PR #5](https://github.com/AbsoluteHLN/CetusPrism/pull/5) 为旧 `v1.6.5` 验收分支，存在冲突。其有效 Linux 工作已被较新主线覆盖，保持未合并，避免版本回退。
- 官方源码已抓取并复核到 `dsh-v0.2.1-rc.2`，完整版本与提交映射见 [UPSTREAM.alignment.json](../docs/UPSTREAM.alignment.json)。本地浅历史未建立共同祖先；本轮选择性回移官方 QuestionComposer 单选自定义行焦点修复，没有声称全量升级。
- 官方权限、凭据优先级、远程 API、profile 和独立实验 CUA 栈的整体迁移仍待独立设计验收。

## 行为与文件

| 范围 | 主要修改文件 | 行为与兼容性 |
|---|---|---|
| 背景与 composer | `apps/web/public/hln-cetus-theme.css`、`apps/web/tests/cetus-motion.e2e.ts` | 统一背景动效参数、关闭减弱动画下的根伪元素动画，固定 36px 淡出带并保留输入卡片空间；沿用 KalciriteUI v3.5 tokens。 |
| Agent 模式 | `packages/bundle/web-app/presets/standard.patch.yml`、`packages/client/ui-agent-preset/`、`packages/preset/agent-preset-registry/src/display.ts` | composer 菜单新增「ZCode 原则模式」，复用 Standard 工具与策略，仅替换 persona 指导，默认仍为 Standard；不导入 ZCode runtime、账号、凭据或私有配置。 |
| 选择与恢复 | `apps/web/tests/zcode-preset.snapshot.ts`、`snapshots/web/zcode-preset/`、既有 preset 测试及本地 expected | authored keyless 场景通过真实 Web 会话创建请求，固定模型可见 prompt、工具 schema 和持久化事件，并验证刷新与独立冷恢复。该请求快照从发货配置派生场景 overlay，固定 Bash 工具而不执行命令；产品仍按系统选择 Bash 或 PowerShell。开发者工具开关不改变预设可用性或默认值。 |
| computer use | `apps/electron/backend/desktop-computer-use.patch.yml`、`packages/bundle/web-app/cordis.patch.yml`、`packages/experimental/computer-use-cua-driver-native/` | 重新挂接 computer 侧栏与 foreground 控件；原 Browser 侧栏保留。原生快照将元素 token 映射加入模型可见结果，执行前遵从会话投递策略。无 agent 的程序调用使用 composition 默认值。SDK 仍为 `@trycua/cua-driver 0.28.0`。 |
| Team 模型 | `packages/experimental/agent-team/`、`packages/client/ui-settings-subagent/`、`packages/experimental/tool-agent-team/tests/loader-composition.spec.ts` | 保留 Host 模型授权与 Team 独立限制；writer 继续 `team/member` payload v2，读取已有 v2 和历史过渡 v3，内存归一化而不重写日志。 |
| 文档与检查 | `docs/subsystems/agent-team.*`、`docs/subsystems/session.*`、相关包 README、生成目录、`scripts/persistence-artifacts.ts`、`scripts/session-snapshot-corpus.corpus.ts`、`scripts/verify-repository-references.*` | 更新双语与 API 类型，保留官方版本来源；上游 revision ledger 允许精确提交 pin，其他文件仍拒绝提交标识，组织 URL 检查保持有效。快照旧代际保留，借用索引对齐已选 v4。 |

`docs/persistence-schema.json` 为生成文件，包含展开后的完整类型目录，因此本轮 diff 较大；不是手工修改的运行时配置。依赖锁仅增加三个本地 workspace 关系，不升级外部包。

## 持久化确认

当前 Session writer 保持 V4、Team projection stateVersion 保持 5；新增 `computer-use/delivery` 和 Team 可选 `model`、`modelProvider`、`reasoningEffort` 经分类均为 same-version compatible additions，不要求 Session 5。本地 ACK `2026-10-18-team-model-delivery` 与最终 check 通过：63 roots 对应 9 条历史记录，无差异。历史确认资料遵循既定精简策略保留在维护者工作区的 ignored `docs/persistence-changes/`；此结果不等于已验证无历史资料的新 clone 通过全部历史检查，也不承诺旧严格 reader 降级读取新字段。

## 验证证据

本机原始日志、截图、ACK 与监督记录统一位于 ignored `dev-docs/evidence/2026-10-18-*`，避免把机器日志和截图散落到产品源码。

- 集成单元回归：14 个文件、228 项通过。
- Windows 完整 build 通过，生成 398 个 client artifacts；未重新发布安装包。
- 背景/composer 浏览器回归：3 项通过；设置、Team 模型保存与刷新导航：1 项通过。
- ZCode 菜单、请求、持久化、刷新及独立冷恢复：2 项通过；已查看深浅主题成功截图。
- 既有 preset 选择与编辑回归：2 个文件、15 项通过。监督发现并修复 Windows-only 工具清单后，ZCode 场景重新生成和只读回放分别 2 项通过，快照目录复核 3 项通过。
- native SDK opt-in e2e：1 项通过。真实 WinForms fixture 完成截图、元素 token、后台 UIA 点击和 fresh-state/marker 双重确认；fixture 已关闭。
- headless authored 快照：native computer use、Team targets、GLM harness 3 个场景 refresh 与 replay 通过，保留已提交的 v3 前代。
- Session 快照目录检查：3 项通过。
- revision ledger 规则回归：10 项通过，1 项平台条件跳过；其他文件的非法 commit 引用和 ledger 中的非法组织 URL 仍拒绝。
- lint 通过，仅既有 unused-disable warnings；234 份配置、79 个包的依赖策略、Client i18n 检查通过。相关双语 pair 检查通过。

完整 `doc-sync` 汇总为 31 项通过、11 项失败。随后修复其中四类并分别验证：全库双语 558 对通过、插件清单 freshness 通过、8 份有预算文档通过、Session v0–v4 格式引用通过。没有重新运行整个聚合检查，不能将这些定向补救称为完整 `doc-sync` 全绿。

余下七类问题已按原主线与本地 ignored 输入分类，未关闭或绕过检查：Markdown 链接仍依赖本机历史 Agent Note 的缺失 anchor；type-equivalence 存在 schedule 注册遗漏和 LLM/telemetry 等旧漂移；20 处既有 export JSDoc 缺失；Team README 原 Summary 超长；四份未改 README 的 Model Experience 缺项；本地 ignored Agent Note 缺规定章节；文档标准测试仍使用旧 sidecar 格式、遗漏 code-language library 并扫描 ignored 本地模板。具体原始日志和基线比较保留在本机 evidence。

独立监督接受本轮 Windows 产品行为、持久化、原生工具保留与权限策略证据，并发现了已修复的跨平台快照缺陷。Linux 实跑结果仍待可用主机或 CI：已配置 SSH 主机连接超时，本机 Docker Linux engine 不可用。本次代码与记录通过正常 Git hooks 提交、推送到 `main`；准确提交和远端验证结果见 Git 历史与交付回复，不发布 release。

## 未验证、阻塞与下一步

- 未验证：真实 GLM/其他 provider 的质量增益、Linux/macOS 执行及第三方桌面应用、重新打包后的完整 Windows 安装升级流程。原生实测不代表所有应用自动化都已验收；本轮模式是原生 ZCode 原则指导，不是外部 ZCode runtime 集成。
- 兼容性后续：单独设计官方 rc.2 大范围 API/权限/profile 迁移；清理已确认的 origin 文档漂移与本地 ignored 历史扫描策略冲突。
- 额度目标：既有 goal 处于 paused 且未完成，新目标创建被工具拒绝；当前工具不提供恢复或替换未完成目标的接口。本轮没有伪造完成旧目标，因此不能提供准确的本轮 goal token 统计。
- 回滚：通过回退本轮集成提交恢复此前组合；不删除或覆盖已提交 Session fixture 代际，不修改用户凭据与会话文件。
