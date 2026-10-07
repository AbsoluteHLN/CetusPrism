// Throwaway auditor: verify every junction inside the packed backend runtime
// resolves within the packed tree. Run: node scripts/audit-junctions.mjs
import { readdirSync, readlinkSync, existsSync } from 'node:fs'

const root = 'E:/dependency-cache/cetusprism/dist/win-unpacked/resources/app/backend/runtime'
const p = root + '/node_modules'
const out = []
let n = 0

function walk(d, depth) {
  if (depth > 7) return
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch (e) { out.push('READDIR_FAIL ' + d + ' ' + e.code); return }
  for (const en of ents) {
    const full = d + '/' + en.name
    n++
    if (en.isSymbolicLink()) {
      let t
      try { t = readlinkSync(full) } catch (e) { out.push('READLINK_FAIL ' + full + ' ' + e.code); continue }
      const tn = t.replaceAll('\\', '/')
      if (!tn.startsWith(root)) out.push('OUTSIDE ' + full + ' -> ' + t)
      else if (!existsSync(full)) out.push('DANGLING ' + full + ' -> ' + t)
    } else if (en.isDirectory()) walk(full, depth + 1)
  }
}

walk(p, 0)
console.log('entries:', n, 'problems:', out.length)
for (const o of out.slice(0, 20)) console.log(o)

const byTarget = new Map()
for (const o of out) {
  if (!o.startsWith('OUTSIDE ')) continue
  const t = o.split(' -> ')[1]
  byTarget.set(t, (byTarget.get(t) ?? 0) + 1)
}
console.log('--- unique outside targets ---')
for (const [t, c] of [...byTarget.entries()].sort()) console.log(c + 'x ' + t)
