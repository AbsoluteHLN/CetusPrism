// Heal a freshly deployed backend runtime so it is self-contained. Two
// deploy layouts are supported:
//
// - Hoisted (`pnpm deploy --node-linker=hoisted
//   --config.inject-workspace-packages=true`): the closure arrives as one
//   flat, fully materialized `node_modules` — injected workspace packages
//   are real copies and no junction exists. This script then only verifies
//   the injected vendor packages and runs the junction invariant walks,
//   which are no-ops on a healthy hoisted deploy.
// - Isolated (legacy `--legacy` deploy): pnpm leaves junctions pointing back
//   into the source repository for packages forced to `link:` by workspace
//   overrides (cosmokit, schemastery), for the deployed CLI itself
//   (hidden-hoist self-link), and for the native landlock platform stubs,
//   and keeps transitive deps invisible to the profile-fallback BFS. This
//   script materializes canonical copies inside the runtime tree, repoints
//   every stray junction at them, and then materializes every remaining
//   junction into a real copy: electron-builder's 7z archiver dereferences
//   junctions while scanning, so pnpm's cross-referencing `.pnpm` graph
//   makes its scan never finish, and a junction's absolute target dangles
//   once the app installs to any other path.
//
// Idempotent: re-running copies over the same content and finds no junctions
// left. Run after `pnpm deploy`:
//   node scripts/heal-deploy-links.mjs
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmdirSync, rmSync, symlinkSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
// Runtime root defaults to the Windows unpacked tree (pack-tauri flow); the
// Linux pack passes its linux-unpacked runtime as argv[2].
const runtimeRoot = resolve(process.argv[2] ?? join(appRoot, 'dist', 'win-unpacked', 'resources', 'app', 'backend', 'runtime'))
const nm = join(runtimeRoot, 'node_modules')
const pnpmDir = join(nm, '.pnpm')

// The isolated layout keeps packages inside `.pnpm` instance dirs; the
// hoisted linker stores only `lock.yaml` there. Instance directories, not
// directory existence, decide the mode.
const isolated = (() => {
  try {
    return readdirSync(pnpmDir, { withFileTypes: true }).some(d => d.isDirectory() && !d.name.startsWith('.'))
  } catch { return false }
})()
console.log(`heal-deploy-links: ${isolated ? 'legacy isolated' : 'hoisted'} deploy detected`)

/** Runtime-tree path a stray junction target is redirected to, keyed by the repo path suffix. */
const EMBED_MAP = [
  { suffix: ['vendor', 'cosmokit'], dest: join(nm, '@deepseek-ai', 'cosmokit') },
  { suffix: ['vendor', 'schemastery'], dest: join(nm, '@deepseek-ai', 'schemastery') },
  { suffix: ['apps', 'cli'], dest: runtimeRoot },
  { suffix: ['native', 'landlock-run', 'packages', 'linux-x64'], dest: join(nm, '@deepseek-ai', 'node-addon-landlock-run-linux-x64') },
  { suffix: ['native', 'landlock-run', 'packages', 'linux-arm64'], dest: join(nm, '@deepseek-ai', 'node-addon-landlock-run-linux-arm64') },
]

/** Vendor files needed at runtime; node_modules is excluded (inner links are rebuilt below). */
const VENDOR_FILES = ['package.json', 'lib', 'LICENSE', 'README.md']

function materialize(srcRepoDir, dest) {
  mkdirSync(dest, { recursive: true })
  for (const name of VENDOR_FILES) {
    const src = join(srcRepoDir, name)
    if (!existsSync(src)) continue
    // An injected deploy already placed real copies at dest; copying onto
    // the identical path (same file through a resolved link) fails loudly.
    const target = join(dest, name)
    try {
      if (statSync(src).ino === statSync(target).ino && statSync(src).dev === statSync(target).dev) continue
    } catch { /* target absent — copy below */ }
    cpSync(src, target, { recursive: true, dereference: false })
  }
}

// 1+2. Vendor packages and native platform stubs. Injection already
// materialized them as real copies in a hoisted deploy — verify and fail
// loud rather than heal silently. An isolated deploy leaves `link:`
// junctions into the repository; materialize canonical copies and rebuild
// schemastery's two inner links (cosmokit and @standard-schema/spec).
if (isolated) {
  materialize(join(repoRoot, 'vendor', 'cosmokit'), EMBED_MAP[0].dest)
  const schemasteryDest = EMBED_MAP[1].dest
  materialize(join(repoRoot, 'vendor', 'schemastery'), schemasteryDest)
  const schemasteryNm = join(schemasteryDest, 'node_modules', '@deepseek-ai')
  mkdirSync(schemasteryNm, { recursive: true })
  relinkIfChanged(join(schemasteryNm, 'cosmokit'), EMBED_MAP[0].dest)
  const specInstance = readdirSync(pnpmDir).find(d => d.startsWith('@standard-schema+spec@'))
  if (specInstance === undefined) throw new Error('heal-deploy-links: @standard-schema/spec instance missing from the deployed .pnpm store')
  relinkIfChanged(
    join(schemasteryDest, 'node_modules', '@standard-schema', 'spec'),
    join(nm, '.pnpm', specInstance, 'node_modules', '@standard-schema', 'spec'),
  )
  for (const entry of EMBED_MAP.slice(3)) materialize(join(repoRoot, ...entry.suffix), entry.dest)
} else {
  for (const entry of EMBED_MAP) {
    if (entry.suffix[0] === 'apps' && entry.suffix[1] === 'cli') continue
    let st = null
    try { st = lstatSync(entry.dest) } catch { /* missing */ }
    if (st?.isSymbolicLink()) {
      // Defensive: injection materializes workspace packages as real
      // directories (hardlinked files); a link here would dangle once the
      // app installs to any other path. Replace it with the vendor copy.
      rmSync(entry.dest, { force: true })
      st = undefined
    }
    if (st === null) {
      materialize(join(repoRoot, ...entry.suffix), entry.dest)
      continue
    }
    if (!existsSync(join(entry.dest, 'package.json'))) {
      throw new Error(`heal-deploy-links: injected workspace package missing from the hoisted deploy: ${entry.dest}`)
    }
  }
}

// 3. Materialize the full deploy closure at top level (isolated layout
// only). pnpm's isolated layout keeps transitive deps only inside `.pnpm`
// instance dirs, which the profile-fallback BFS cannot reach through its
// textual parent walk (`resolve.paths` never enters `.pnpm`); the loader
// then fails on every plugin dep — scoped (`@deepseek-ai/dsh-*`) or bare
// (`zod`, `ws`, ...) — that the app reaches only transitively. Copying each
// instance's resolved dep dirs (dereferenced) to `node_modules/<name>` makes
// the whole closure textually resolvable, on this machine and on any install
// target. The hoisted linker does this natively, so the pass is skipped.
let materialized = 0
if (isolated) {
  mkdirSync(nm, { recursive: true })
  const instances = readdirSync(pnpmDir).filter(d => !d.startsWith('.') )
  for (const instance of instances) {
    const instNm = join(pnpmDir, instance, 'node_modules')
    let ents
    try { ents = readdirSync(instNm, { withFileTypes: true }) } catch { continue }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue
      if (ent.name.startsWith('@')) {
        const scopeDir = join(instNm, ent.name)
        for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue
          materializeDep(join(scopeDir, sub.name), join(nm, ent.name, sub.name))
        }
      } else {
        materializeDep(join(instNm, ent.name), join(nm, ent.name))
      }
    }
  }
  if (materialized > 0) console.log(`heal-deploy-links: materialized ${materialized} transitive package(s) to top level`)
}

/** Copy one resolved package dir to its top-level home unless a real copy already sits there. */
function materializeDep(src, dest) {
  if (existsSync(join(dest, 'package.json'))) return
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest)) rmdirSync(dest)
  cpSync(src, dest, { recursive: true, dereference: true })
  materialized++
}

/** Rewrite `link` to point at `dest` unless it already does. Junctions carry absolute targets. */
function relinkIfChanged(link, dest) {
  if (!existsSync(link) && !statLink(link)) return false
  let current = ''
  try { current = readlinkSync(link) } catch { return false }
  if (current.replaceAll('/', '\\').toLowerCase() === dest.toLowerCase()) return false
  rmdirSync(link)
  symlinkSync(dest, link, 'junction')
  return true
}

/** existsSync follows junctions; a dangling link still needs rewriting, so probe the link itself. */
function statLink(link) {
  try { statSync(link, { throwIfNoEntry: false }); return true } catch { return false }
}

// 4. Walk the tree and repoint every junction that leaves the runtime root.
const repoPrefix = repoRoot.replaceAll('/', '\\').toLowerCase() + '\\'
const runtimePrefix = runtimeRoot.replaceAll('/', '\\').toLowerCase() + '\\'
let repointed = 0
const unmapped = []

function walk(dir, depth) {
  if (depth > 8) return
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of ents) {
    const full = join(dir, ent.name)
    if (ent.isSymbolicLink()) {
      // POSIX deploys leave relative symlinks (`.bin` shims) that already
      // stay inside the runtime tree — verify containment, never rewrite.
      if (process.platform !== 'win32') {
        let target = ''
        try { target = resolve(dirname(full), readlinkSync(full)) } catch { continue }
        if (relative(runtimeRoot, target).startsWith('..')) unmapped.push(`${full} -> ${target}`)
        continue
      }
      let target = ''
      try { target = readlinkSync(full) } catch { continue }
      const norm = target.replaceAll('/', '\\').toLowerCase()
      if (norm === runtimeRoot.replaceAll('/', '\\').toLowerCase() || norm.startsWith(runtimePrefix)) continue
      const relSuffix = norm.startsWith(repoPrefix) ? norm.slice(repoPrefix.length).split('\\').filter(Boolean) : null
      const map = relSuffix
        ? EMBED_MAP.find(e => e.suffix.every((part, i) => relSuffix[i] === part) && relSuffix.length === e.suffix.length)
        : undefined
      if (map === undefined) { unmapped.push(`${full} -> ${target}`); continue }
      if (relinkIfChanged(full, map.dest)) repointed++
    } else if (ent.isDirectory()) {
      walk(full, depth + 1)
    }
  }
}

walk(nm, 0)

console.log(`heal-deploy-links: repointed ${repointed} junction(s) into the runtime tree`)
if (unmapped.length > 0) {
  console.log(`heal-deploy-links: ${unmapped.length} unmapped outside junction(s):`)
  for (const line of unmapped) console.log('  ' + line)
}

// 5. Materialize every remaining junction into a real copy, leaf-first: a
// link whose target subtree still contains links waits for the next pass.
// The hidden-hoist self-link points at the runtime root itself, so its copy
// excludes `node_modules` — the directory the link itself lives in; copying
// it would recurse into itself. Windows-only: on POSIX the hoisted deploy
// already produces real copies, and symlinks were verified in step 4.
const normPath = (p) => p.replaceAll('/', '\\').toLowerCase()
const runtimeNorm = normPath(runtimeRoot)

if (process.platform === 'win32') {
function collectLinks(dir, out) {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of ents) {
    const full = join(dir, ent.name)
    if (ent.isSymbolicLink()) out.push(full)
    else if (ent.isDirectory()) collectLinks(full, out)
  }
}

let materializedLinks = 0
while (true) {
  const links = []
  collectLinks(nm, links)
  if (links.length === 0) break
  let progressed = false
  for (const link of links) {
    const target = resolve(dirname(link), readlinkSync(link).replaceAll('/', '\\'))
    const targetNorm = normPath(target)
    if (targetNorm !== runtimeNorm && !targetNorm.startsWith(runtimeNorm + '\\')) {
      throw new Error(`heal-deploy-links: junction target outside the runtime tree: ${link} -> ${target}`)
    }
    if (normPath(link).startsWith(targetNorm + '\\')) {
      // Self-referential: the only such link is the hidden-hoist CLI link to
      // the runtime root. Copy the root's own files, minus `node_modules`.
      if (targetNorm !== runtimeNorm) {
        throw new Error(`heal-deploy-links: unexpected self-referential junction: ${link} -> ${target}`)
      }
      rmSync(link, { force: true })
      mkdirSync(link, { recursive: true })
      for (const name of readdirSync(target)) {
        if (name === 'node_modules') continue
        cpSync(join(target, name), join(link, name), { recursive: true })
      }
    } else {
      const inner = []
      collectLinks(target, inner)
      if (inner.length > 0) continue
      rmSync(link, { force: true })
      cpSync(target, link, { recursive: true })
    }
    progressed = true
    materializedLinks++
  }
  if (!progressed) throw new Error('heal-deploy-links: junction materialization made no progress (cycle or broken target)')
}
if (materializedLinks > 0) console.log(`heal-deploy-links: materialized ${materializedLinks} junction(s) into real copies`)
}
