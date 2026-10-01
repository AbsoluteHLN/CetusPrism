export type Resolve = (specifier: string) => string

// Node built-ins load through dynamic imports: this module is reached by the
// loader's browser face, where static named imports of `node:fs` fail the
// bundle. The functions below never run in a browser, and a dynamic import of
// an externalized built-in only throws if called.

// Order matters: the directory ignores itself before the helper appears in it.
const HELPER_FILES = {
  '.gitignore': '# created by cordis automatically\n*\n',
  // The one-argument form of `import.meta.resolve` anchors on this file, so
  // resolution happens in the project scope. A resolve call also survives a
  // bundling host, which transforms modules inside its root and redirects the
  // `import()` in them to its own resolver.
  'resolve.mjs': 'export default (specifier) => import.meta.resolve(specifier)\n',
}

const cache: Record<string, Promise<Resolve | undefined>> = Object.create(null)

/** Nearest ancestor of `dir` that owns a `package.json`, if any. */
async function findScope(dir: string): Promise<string | undefined> {
  const [{ existsSync }, { dirname, join }] = await Promise.all([
    import('node:fs'), import('node:path'),
  ])
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

async function resolveScope(baseUrl: string | undefined): Promise<string | undefined> {
  if (!baseUrl) return
  let dir: string
  try {
    const { fileURLToPath } = await import('node:url')
    dir = fileURLToPath(new URL('.', baseUrl))
  } catch {
    return
  }
  return await findScope(dir)
}

async function write(path: string, content: string) {
  // Another process may be writing the same path; `rename` is atomic, so a
  // concurrent reader only ever observes the complete helper.
  const { writeFile, rename } = await import('node:fs/promises')
  const temp = `${path}.${process.pid}`
  await writeFile(temp, content)
  await rename(temp, path)
}

async function _createResolve(scope: string): Promise<Resolve | undefined> {
  const [{ mkdir }, { join }, { pathToFileURL }] = await Promise.all([
    import('node:fs/promises'), import('node:path'), import('node:url'),
  ])
  const dir = join(scope, '.cordis')
  try {
    await mkdir(dir, { recursive: true })
    for (const [name, content] of Object.entries(HELPER_FILES)) {
      await write(join(dir, name), content)
    }
  } catch {
    // Read-only filesystems are legitimate; the caller falls back to a native `import()`.
    return
  }
  const url = pathToFileURL(join(dir, 'resolve.mjs')).href
  return (await import(/* @vite-ignore */ url)).default
}

/**
 * Build a bare-specifier resolver anchored in the config file's project.
 *
 * `import()` inside this module would anchor on the loader's own dependency
 * graph, so the resolver delegates to a generated `import.meta.resolve` helper
 * placed in the nearest project directory above the config file. Returns
 * `undefined` when no project can be located or the helper cannot be written
 * (read-only filesystem); callers then fall back to a plain `import()`.
 * @param baseUrl — the config file's URL, anchoring the project search.
 * @returns the resolver, or `undefined` when unresolvable.
 */
export async function createResolve(baseUrl: string | undefined) {
  const scope = await resolveScope(baseUrl)
  if (!scope) return
  return await (cache[scope] ??= _createResolve(scope))
}
