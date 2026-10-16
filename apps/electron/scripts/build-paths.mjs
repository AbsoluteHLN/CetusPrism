import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Resolve this CetusPrism checkout's output root inside the aggregate cxbuild tree. */
export function resolveCetusBuildRoot(repoRoot) {
  if (process.env.CETUS_BUILD_ROOT) return resolve(process.env.CETUS_BUILD_ROOT)

  const sourceRoot = resolve(repoRoot)
  for (let current = sourceRoot; ; current = dirname(current)) {
    const workspaceBuildRoot = join(current, 'cxbuild')
    if (existsSync(workspaceBuildRoot)) return join(workspaceBuildRoot, 'cetusprism')
    const parent = dirname(current)
    if (parent === current) break
  }

  return join(sourceRoot, 'cxbuild', 'cetusprism')
}
