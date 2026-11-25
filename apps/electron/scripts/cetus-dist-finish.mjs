/**
 * Leave only the current CetusPrism installer under the shared dist directory.
 *
 * @module @deepseek-ai/dsh-electron/cetus-dist-finish
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cetusInstallerName } from './cetus-win-paths.mjs'

/**
 * Remove every dist entry except the installer for this version.
 * @param {object} input - Finalization request.
 * @param {string} input.distDir - Absolute dist directory.
 * @param {string} input.version - Published product version.
 * @returns {string} Absolute installer path kept in dist.
 */
export function finalizeCetusDistInstaller({ distDir, version }) {
  const keep = cetusInstallerName(version)
  const keepPath = join(distDir, keep)
  if (!existsSync(keepPath) || !statSync(keepPath).isFile()) {
    throw new Error(`cetus dist finish: installer missing at ${keepPath}`)
  }
  for (const entry of readdirSync(distDir)) {
    if (entry === keep) continue
    const path = join(distDir, entry)
    rmSync(path, { recursive: true, force: true })
  }
  return keepPath
}