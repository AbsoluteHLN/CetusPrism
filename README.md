# CetusPrism

CetusPrism 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面发行版：一个"一切皆插件"的 AI 智能体工作台，以内置运行时的桌面应用形式交付，开箱即用。

> 预发布说明：本项目处于 pre-release 阶段，迭代较快，接口与数据格式可能发生不兼容变更。运行前请阅读[安全说明](docs/SAFETY.zh.md)。

## 功能特性

- **桌面应用**：Tauri 壳 + 内置后端运行时，安装即用，支持系统托盘常驻，不依赖系统浏览器。
- **完整上游能力**：会话管理、技能（skills）、MCP 工具接入、浏览器与计算机使用、终端与子进程执行、定时任务、子代理等，全部继承自 DeepSeek Harness。
- **插件化架构**：基于 [Cordis](https://github.com/cordiverse/cordis) 的"一切皆插件"设计，新行为通过扩展点组合，而不是修改核心循环。
- **本地优先**：会话与工作区数据保存在本机；模型请求所需的一切输入都可从会话日志重建。
- **Cetus 主题**：琥珀强调色与深色界面的统一视觉层。

## 下载安装

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `CetusPrism-v<版本>-setup.exe`（NSIS 安装向导，可选将 `dsh` 命令加入 PATH） |
| Linux amd64 | `CetusPrism-v<版本>-amd64.deb` |

系统要求：Windows 10 及以上（WebView2 随系统分发）；或主流 Linux 发行版（依赖 WebKitGTK 4.1）。

## 快速开始

1. 启动 CetusPrism，在设置中配置 `DEEPSEEK_API_KEY`（也可放在根目录 `.env` 文件中；凭据不会进入会话日志）。
2. 新建会话即可开始对话；工具调用、文件访问与终端执行均在会话内进行。

## 从源码构建

环境要求：Node.js ^22.19 或 >=24、pnpm、Rust stable（Windows 需 MSVC 工具链；Linux 需 `libwebkit2gtk-4.1-dev` 等系统库）。

```sh
pnpm install
pnpm run build          # 构建 lib/types 与运行时产物
pnpm run dist:win       # Windows 安装包（NSIS）
pnpm run dist:linux     # Linux deb 包
```

非 git 检出构建时需要设置 `DSH_CLIENT_COMMIT_HASH` 环境变量。

更多开发信息见 [docs/development.md](docs/development.md) 与 [docs/architecture.md](docs/architecture.md)。

## 目录结构

```
packages/    @deepseek-ai/dsh-<pkg> 工作区包（core、llm、shell、session、web 等）
apps/
  web/       Web 前端（主题、界面、e2e 快照）
  electron/  桌面壳（Tauri/Rust）、后端引导与打包脚本
vendor/      源码 vendor 的 Cordis 框架（钉定上游版本）
python/      Python SDK 与运行时
docs/        文档（架构、测试、用户指南）
```

根目录其余散落文件均为工具链按约定钉在仓库根的配置，移动会破坏解析：
pnpm 工作区三件套（`package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`）、
TypeScript 面配置（`tsconfig*.json`、`tsdown.config.ts`）、测试配置
（`vitest.*.config.ts`、`pytest.ini`）、规范与提交钩子（`.editorconfig`、
`.oxlintrc*`、`.jscpd.json`、`lefthook.yml`、`.gitattributes`），以及标准
仓库文档（`LICENSE`、`THIRD_PARTY_NOTICES.md`、`UPSTREAM.alignment.json`）。
配套文档（安全说明、贡献指南、品牌规范、基准测试等）集中在 `docs/` 下。

## 许可证

[MIT](LICENSE)。第三方组件的许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；`vendor/` 内的 Cordis 框架各包保留其上游 MIT `LICENSE`。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 上游项目与全部核心能力。
- [Cordis](https://github.com/cordiverse/cordis) —— 插件化运行时框架。
