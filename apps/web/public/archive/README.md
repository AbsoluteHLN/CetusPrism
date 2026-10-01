# apps/web/public archive

Entries below were superseded and moved out of the served `public/` root so only
the active asset set ships. Each entry records its original path, archive date,
and successor.

| Archived path (under `apps/web/public/`) | Date | Successor |
|---|---|---|
| `hln-ui-v2/` | 2026-09-28 | `/hln-ui-v3.2/` + `/hln-cetus-theme.css` (Kalcirite UI v3.2 integration) |
| `hln-ui-v2.3/` | 2026-09-28 | `/hln-ui-v3.2/` |
| `hln-ui-system-v2.css` | 2026-09-28 | `/hln-ui-v3.2/hln-ui-system-v3.2.css` |
| `hln-v2-fix.js` | 2026-09-28 | `/hln-ui-v3.2/hln-v32-fix.js` |
| `hln-ui-v3.2/` | 2026-09-30 | `/hln-ui-v3.5/` + `/hln-cetus-theme.css` (Kalcirite UI v3.5 integration; the served copy was a pre-2026-09-29 stale snapshot, archived bytes are the current upstream v3.2 dist plus the shipped shim) |

Restore by moving an entry back to `apps/web/public/` at its original path; the
web shell (`apps/web/index.html`) must also reference it again.

English | [中文](README.zh.md)
