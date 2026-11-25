/**
 * Keep the Desktop build tree outside the repository.
 *
 * The build tree holds downloaded archives, prepared runtimes and packaged
 * artifacts, so none of it belongs to the project. The repository keeps one
 * link that points at the shared cache; Windows resolves that link as a
 * directory junction, which keeps the textual path the build scripts need
 * while every byte stays on the cache volume.
 *
 * @module scripts/desktop-build-cache
 */

import { lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')

/** Name of the in-tree link that exposes the shared Desktop build cache. */
export const DESKTOP_BUILD_LINK_NAME = '.build-cache'

/** Shared cache directory that owns the Desktop build tree on this machine. */
export const DEFAULT_SHARED_BUILD_ROOT = 'E:\\dependency-cache\\cetusprism\\desktop-build'

/**
 * Resolve the shared cache directory that owns the Desktop build tree.
 *
 * The override exists so a build can run against a different cache without
 * editing the repository; the default is the one shared cache every machine
 * in this workspace uses.
 * @param {NodeJS.ProcessEnv} env - Build environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform.
 * @returns {string} Absolute shared cache directory.
 */
export function sharedDesktopBuildRoot(env = process.env, hostPlatform = process.platform) {
  const override = env.DSH_DESKTOP_BUILD_ROOT
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  if (hostPlatform === 'win32') return DEFAULT_SHARED_BUILD_ROOT
  // Other hosts have no E-drive cache; the link directory is then the tree itself.
  return join(APP_ROOT, DESKTOP_BUILD_LINK_NAME)
}

/**
 * Resolve the in-tree link path that exposes the shared build tree to the build scripts.
 * @returns {string} Absolute link path.
 */
export function desktopBuildLinkPath() {
  return join(APP_ROOT, DESKTOP_BUILD_LINK_NAME)
}

/**
 * Report whether one path is a link rather than a real directory.
 * @param {string} path - the path to inspect.
 * @returns {'missing' | 'link' | 'directory'} the kind of entry found.
 */
export function desktopBuildLinkState(path) {
  try {
    const stat = lstatSync(path)
    return stat.isSymbolicLink() ? 'link' : 'directory'
  } catch {
    return 'missing'
  }
}

/**
 * Create the in-tree link when it is missing and confirm that it resolves to the shared cache.
 *
 * A link that points somewhere else is a boundary violation, so it fails loudly
 * instead of silently filling the project tree with build output.
 * @param {NodeJS.ProcessEnv} env - Build environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform.
 * @returns {string} The link path.
 */
export function ensureDesktopBuildLink(env = process.env, hostPlatform = process.platform) {
  const link = desktopBuildLinkPath()
  if (hostPlatform !== 'win32') {
    mkdirSync(link, { recursive: true })
    return link
  }
  const shared = sharedDesktopBuildRoot(env, hostPlatform)
  mkdirSync(shared, { recursive: true })
  const state = desktopBuildLinkState(link)
  if (state === 'missing') {
    symlinkSync(shared, link, 'junction')
    return link
  }
  if (state === 'directory') {
    throw new Error(`desktop build cache: ${link} is a real directory; the build tree belongs in ${shared}`)
  }
  const resolved = realpathSync(link)
  const expected = realpathSync(shared)
  if (resolved.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`desktop build cache: ${link} points at ${resolved}, not ${expected}`)
  }
  return link
}
