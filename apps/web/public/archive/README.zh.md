# apps/web/public 归档

以下条目已被取代并移出对外服务的 `public/` 根目录，使发行包只携带当前生效的资源集。每条记录其原始路径、归档日期与后继文件。

| 归档路径（`apps/web/public/` 下） | 日期 | 后继 |
|---|---|---|
| `hln-ui-v2/` | 2026-09-28 | `/hln-ui-v3.2/` + `/hln-cetus-theme.css`（Kalcirite UI v3.2 接入） |
| `hln-ui-v2.3/` | 2026-09-28 | `/hln-ui-v3.2/` |
| `hln-ui-system-v2.css` | 2026-09-28 | `/hln-ui-v3.2/hln-ui-system-v3.2.css` |
| `hln-v2-fix.js` | 2026-09-28 | `/hln-ui-v3.2/hln-v32-fix.js` |
| `hln-ui-v3.2/` | 2026-09-30 | `/hln-ui-v3.5/` + `/hln-cetus-theme.css`（Kalcirite UI v3.5 接入；对外服务的是 2026-09-29 前的陈旧快照，此处归档的是当前上游 v3.2 dist 字节与随包发布的 shim） |

恢复方式：将条目移回 `apps/web/public/` 的原始路径，并让 Web 外壳（`apps/web/index.html`）重新引用它。

[English](README.md) | 中文
