# CetusPrism 构建与目录布局决策（fork 侧）

本文件记录本 fork 对 kalcirite-project-rules §5（项目目录契约）的采纳方式与显式例外。
上游 deepseek-harness 的布局契约见根目录 `AGENTS.md`；两者冲突时，涉及上游目录的部分
以上游为准——本文件只登记 fork 侧新增的目录事实。

## 已采纳的 kalcirite 契约键

| 键 | 落点 | 状态 |
|---|---|---|
| `EVIDENCE` | `verify-evidence/` | 生效（gitignored，索引见其 README.md；2026-09-25 起） |
| `TMP` | `temp/` | 生效（gitignored；2026-09-25 起，此前无散落 scratch，故无迁移） |
| 依赖指向 | `DEPENDENCIES.md` + `DSH开发边界.md` | 生效；node_modules 为 pnpm 原生硬链接，storeDir 钉 `E:\dependency-cache\pnpm\store` |

## 显式例外（legacy，保留理由）

1. **构建产物根不是 `cxbuild/`，而是 `apps/electron/dist/`（Web/桌面装配）与
   `apps/electron/src-tauri/target/`（cargo 构建缓存）**。
   - 理由：上游仓库的打包链（`pack-tauri.mjs` → `make-installer.mjs`）与
     dist 内的已跟踪部署清单（win-unpacked 下的 runtime manifests）都锚定在该路径；
     迁移是跨上游的全链改造，收益仅剩"目录名统一"，故按 §6 规则 6 记录例外而非迁移。
   - 两者均已 gitignore；dist 内被上游跟踪的部分不受影响。
2. **上游固有的顶层目录**（`apps/ packages/ vendor/ native/ python/ website/`
   `benchmarks/ snapshots/ patches/ scripts/ docs/ dev-docs/`）按上游 `AGENTS.md` 布局
   保留，不套用 kalcirite 白名单重排。

## 目录整理记录（2026-09-25，kalcirite §6/§7）

- 删除五处陈旧残留（均为链接农场/可再生构建输出，零源码丢失）：
  `examples/`、`packages/code-runtime/`、`packages/e2b/`（空目录骨架）；
  `vendor/schemastery/apps/`（ancient deploy-probe 残骸，8 个 junction 中 4 个指向
  `vendor/cosmokit`、4 个悬空；删除前后核验 cosmokit/schemastery 完好）；
  `native/landlock-run/`（仅剩 3 个 lib 构建产物）。五者均不在 pnpm-lock importer、
  tsconfig 引用与 pnpm-workspace 成员清单中。
- 归档被取代的工作文档：见 `dev-docs/archive/README.md`。
- 仓库根的用户未跟踪文件 `配置说明.md` 与 `.zcode/` 按既有约定不纳入整理与提交。
