/** Name of the in-tree link that exposes the shared Desktop build cache. */
export const DESKTOP_BUILD_LINK_NAME: string

/** Shared cache directory that owns the Desktop build tree on this machine. */
export const DEFAULT_SHARED_BUILD_ROOT: string

/**
 * Resolve the shared cache directory that owns the Desktop build tree.
 * @param env - Build environment.
 * @param hostPlatform - Build-host platform.
 * @returns Absolute shared cache directory.
 */
export function sharedDesktopBuildRoot(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
): string

/**
 * Resolve the in-tree link path that exposes the shared build tree to the build scripts.
 * @returns Absolute link path.
 */
export function desktopBuildLinkPath(): string

/**
 * Report whether one path is a link rather than a real directory.
 * @param path - the path to inspect.
 * @returns The kind of entry found.
 */
export function desktopBuildLinkState(path: string): 'missing' | 'link' | 'directory'

/**
 * Create the in-tree link when it is missing and confirm that it resolves to the shared cache.
 * @param env - Build environment.
 * @param hostPlatform - Build-host platform.
 * @returns The link path.
 */
export function ensureDesktopBuildLink(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
): string
