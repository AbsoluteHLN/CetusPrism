# 依赖指向

本项目所有依赖的唯一来源是 `E:\dependency-cache`；禁止联网重新安装依赖。

全局规则与机器级指向表的唯一权威是 [`E:\dependency-cache\DEPENDENCY-BOUNDARY.md`](E:\dependency-cache\DEPENDENCY-BOUNDARY.md)，本文只记录本项目特有事项。面向未来"开发边界"技能的提示词见根目录 [`DSH开发边界.md`](DSH开发边界.md)。

## 本项目说明

- pnpm workspace（`packages/` + `website/` + `apps/*`）；pnpm 11 忽略 `.npmrc` 的 `store-dir`，实际解析以 `pnpm-workspace.yaml` 钉死的 `storeDir: E:\dependency-cache\pnpm\store` 为准（机器级兜底是 `E:\dependency-cache\pnpm\home\config\config.yaml`）。
- node_modules 为项目内 pnpm 原生硬链接目录，物理字节只在 store 一份（2026-09-25 起废除 per-project 容器与 junction 机制）。
- 桌面壳（Tauri）与各包的构建产物在本仓库内：壳构建链为 `apps/electron/scripts/build-shell.mjs` → `pack-tauri.mjs` → `make-installer.mjs`，产物落 `apps/electron/dist/`，cargo 构建缓存落 `apps/electron/src-tauri/target/`（两者均已 gitignore；历史外部归档点 `E:\dependency-cache\archive\build-stages` 已于 2026-09-20 删除，不再使用）。布局决策与 kalcirite 契约的采纳记录见 [`dev-docs/cetusprism-build-layout.md`](dev-docs/cetusprism-build-layout.md)。

## 校验

```sh
pnpm config get store-dir   # 应输出 E:\dependency-cache\pnpm\store
```
