/**
 * Windows packaging directories for the CetusPrism desktop shell.
 *
 * Staging holds `win-unpacked`; `dist` receives only the final NSIS installer.
 *
 * @module @deepseek-ai/dsh-electron/cetus-win-paths
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** Flat installer output on Windows build hosts. */
export const DEFAULT_CETUS_DIST_DIR = 'E:/dependency-cache/cetusprism/dist'

/** Mutable staging tree that feeds electron-builder. */
export const DEFAULT_CETUS_STAGING_DIR = 'E:/dependency-cache/cetusprism/desktop-build/cetus-win-staging'

/**
 * Resolve the directory that receives the finished installer.
 * @param {NodeJS.ProcessEnv} [env] - Build environment.
 * @returns {string} Absolute dist directory.
 */
export function resolveCetusDistDir(env = process.env) {
  const override = env.CETUS_DIST_DIR
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  if (process.platform === 'win32') return DEFAULT_CETUS_DIST_DIR
  return join(appRoot, 'dist')
}

/**
 * Resolve the staging directory for `win-unpacked`.
 * @param {NodeJS.ProcessEnv} [env] - Build environment.
 * @returns {string} Absolute staging directory.
 */
export function resolveCetusStagingDir(env = process.env) {
  const override = env.CETUS_STAGING_DIR
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  if (process.platform === 'win32') return DEFAULT_CETUS_STAGING_DIR
  return resolveCetusDistDir(env)
}

/**
 * Resolve the packed tree electron-builder consumes.
 * @param {NodeJS.ProcessEnv} [env] - Build environment.
 * @returns {string} Absolute `win-unpacked` directory.
 */
export function resolveWinUnpackedDir(env = process.env) {
  return join(resolveCetusStagingDir(env), 'win-unpacked')
}

/**
 * Read the product version the Windows installer publishes under.
 * @returns {string} Version from `apps/electron/package.json`.
 */
export function readCetusElectronVersion() {
  const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('cetus win paths: apps/electron/package.json has no version')
  }
  return manifest.version
}

/**
 * Installer file name for one product version.
 * @param {string} version - Product version.
 * @returns {string} NSIS artifact name.
 */
export function cetusInstallerName(version) {
  return `CetusPrism-v${version}-setup.exe`
}