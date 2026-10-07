// Throwaway gap scan: list bare package imports used by deployed lib code
// that the deploy tree cannot resolve. Run: node scripts/scan-bare-gaps.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, dirname } from 'node:path'

const runtimeRoot = 'E:/dependency-cache/cetusprism/dist/win-unpacked/resources/app/backend/runtime'
const nm = join(runtimeRoot, 'node_modules')
const builtins = new Set([...builtinModules, 'node:inspector'])

const imports = new Map() // bare name -> Set of importing packages
const BARE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

function* walkJs(dir, depth) {
  if (depth > 8) return
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of ents) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) { if (ent.name !== '.pnpm' || depth === 0) yield* walkJs(full, depth + 1) }
    else if (/\.(js|mjs|cjs)$/.test(ent.name)) yield full
  }
}

function pkgOfRealPath(file) {
  // file lives either at top-level node_modules/<...> or inside .pnpm/<inst>/node_modules/<...>
  const norm = file.replaceAll('\\', '/')
  const marker = norm.indexOf('/node_modules/')
  if (marker < 0) return 'runtime-root'
  const rest = norm.slice(marker + '/node_modules/'.length)
  const parts = rest.split('/')
  const name = parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0]
  return name
}

// scan every package dir (top-level and .pnpm instances)
const roots = [nm, join(nm, '.pnpm')]
for (const root of roots) {
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const base = join(root, ent.name)
    const pkgBases = root === nm
      ? [base]
      : [join(base, 'node_modules')]
    for (const pkgBase of pkgBases) {
      let pkgs
      try { pkgs = readdirSync(pkgBase, { withFileTypes: true }) } catch { continue }
      for (const p of pkgs) {
        if (!p.isDirectory()) continue
        const pkgDir = join(pkgBase, p.name)
        for (const file of walkJs(pkgDir, 0)) {
          let src
          try { src = readFileSync(file, 'utf8') } catch { continue }
          for (const m of src.matchAll(BARE)) {
            const spec = m[1] ?? m[2] ?? m[3]
            if (!spec) continue
            if (spec.startsWith('.') || spec.startsWith('#') || spec.startsWith('node:')) continue
            if (builtins.has(spec)) continue
            const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
            if (!imports.has(name)) imports.set(name, new Set())
            imports.get(name).add(pkgOfRealPath(file))
          }
        }
      }
    }
  }
}

// resolvable now? top-level, or via the package's own instance node_modules,
// or the hidden hoist — approximate with existsSync probes from top level,
// then report what top-level resolution misses (loader profile-dir fallback
// can only bridge what the fallback dir links, and the fallback BFS only
// links what the closure manifests name).
const missing = []
for (const [name, users] of [...imports.entries()].sort()) {
  const top = existsSync(join(nm, name, 'package.json'))
  if (!top) missing.push({ name, users: [...users].slice(0, 4) })
}
console.log('bare imports scanned:', imports.size, 'not at top level:', missing.length)
for (const m of missing) console.log(m.name, '<-', m.users.join(', '))
