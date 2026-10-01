/**
 * deepseek-harness-backend-runtime entry — boots the bundled dsh CLI in
 * `web` profile mode.
 *
 * The desktop shell spawns this file with plain Node (Electron's
 * `ELECTRON_RUN_AS_NODE`); everything after this file's path is forwarded to
 * the web surface as its own flag set (`--host` / `--port` / `--trusted-host`).
 * The credentials overlay beside this file pins the credentials row to the
 * shared default document, so the desktop reads the same key store as every
 * other dsh entry point. The slimming overlay that follows disables the
 * Office document preview; pack-tauri prunes the LibreOffice kit it would
 * otherwise ship. The computer-use overlay that follows mounts the
 * registration service and the experimental native Cua Driver provider. The
 * experimental overlay after it enables the Agent Teams feature set (host
 * service, team tools, browser Team action).
 * @module deepseek-harness-backend-runtime/entry
 */

import { dirname, join } from 'node:path'
import { enableCompileCache } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cliBin = join(here, 'runtime', 'lib', 'bin.js')

// The CLI boots a large ESM plugin tree; the V8 compile cache stores its
// parse/skip results after the first boot so later boots skip recompiling
// unchanged modules. The no-argument form keeps NODE_COMPILE_CACHE in charge
// of the directory and treats an unusable cache location as best-effort.
enableCompileCache()

// The shell owns our stdout/stderr pipes; if it stops draining them (crash,
// kill), the next log write reports EPIPE as an uncaught exception and would
// kill the backend mid-session. Non-EPIPE stream errors keep failing loud
// through the uncaught path.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EPIPE') return
    throw error
  })
}

// The CLI parses process.argv.slice(2); argv[1] names the program for
// diagnostics, and the profile plus the overlays precede the caller's
// web-surface flags. Overlays apply in argv order after the profile layer.
process.argv = [process.argv[0], cliBin, '--profile', 'web', '--patch', join(here, 'credentials-home.patch.yml'), '--patch', join(here, 'desktop-slim.patch.yml'), '--patch', join(here, 'desktop-computer-use.patch.yml'), '--patch', join(here, 'desktop-experimental.patch.yml'), ...process.argv.slice(2)]

// The bundled bin.js guards its own `runCli()` with `import.meta.main`,
// which is false for any importer; the entry must invoke the exported
// function itself.
const { runCli } = await import(pathToFileURL(cliBin).href)
await runCli()
