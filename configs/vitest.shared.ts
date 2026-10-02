import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

/** Repository root (the directory holding `configs/`). */
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * Workspace alias table for vite `resolve.alias`, folded from
 * `configs/tsconfig.base.json`'s `paths` map. This replaces
 * vite-tsconfig-paths, which only serves importers under the tsconfig's own
 * directory — a restriction the compiler faces outgrew when they moved into
 * `configs/`. Keys sort longest-first so subpath entries win over their bare
 * prefixes; `*` patterns become capture-group regexes with `$1` substitutions.
 * @returns the alias table.
 */
export function workspaceAliases(): { find: string | RegExp; replacement: string }[] {
  const { config } = ts.readConfigFile(fileURLToPath(new URL('../configs/tsconfig.base.json', import.meta.url)), name => ts.sys.readFile(name))
  const paths = (config?.compilerOptions?.paths ?? {}) as Record<string, readonly string[]>
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Object.entries(paths)
    .sort(([left], [right]) => right.length - left.length)
    .flatMap(([key, targets]) => {
      const target = targets[0]
      if (target === undefined) return []
      // Anchored: a bare paths key maps its exact specifier only — subpath
      // imports fall through to node resolution, matching the paths semantics.
      if (!key.includes('*')) return [{ find: new RegExp(`^${escape(key)}$`), replacement: resolve(REPO_ROOT, 'configs', target) }]
      const star = key.indexOf('*')
      return [{
        find: new RegExp(`^${escape(key.slice(0, star))}(.*)${escape(key.slice(star + 1))}$`),
        replacement: resolve(REPO_ROOT, 'configs', target).replace(/\*/, '$1'),
      }]
    })
}

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Worker arguments that keep process-wide Web Storage from shadowing jsdom storage.
 * Node lists the positive spelling in `allowedNodeEnvironmentFlags` for this negatable flag.
 */
export const vitestExecArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

/**
 * Transform standard TypeScript decorators before Vite's default parser sees source files.
 * @returns a pre-transform Vite plugin shared by source-mode test configurations.
 */
export function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}
