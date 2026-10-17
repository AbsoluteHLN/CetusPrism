/** Replay legacy NSIS update file migration with a long packaged asset path. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('This check requires Windows')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const builder = realpathSync(join(root, 'node_modules/electron-builder'))
const lib = join(dirname(builder), 'app-builder-lib')
const cache = process.env.ELECTRON_BUILDER_CACHE ?? 'E:/dependency-cache/electron-builder/Cache'
const compiler = join(cache, 'nsis/nsis-3.0.4.1/makensis.exe')
const evidence = mkdtempSync(join(tmpdir(), 'cetus-upgrade-'))
const base = join(process.env.USERPROFILE, '.cp')
const baseExisted = existsSync(base)
mkdirSync(base, { recursive: true })
const install = mkdtempSync(join(base, 'test-'))
// This relative filename is shipped by the 1.7.0-beta.1 Inspector payload.
const relative = 'resources/app/backend/runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/models/issues_manager/descriptions/selectElementAccessibilityInteractiveContentAttributesSelectDescendant.md'
const asset = join(install, relative)
mkdirSync(dirname(asset), { recursive: true })
writeFileSync(asset, 'legacy packaged asset fixture\n')
const template = readFileSync(join(lib, 'templates/nsis/uninstaller.nsh'), 'utf8')
const legacy = template.match(/Function un\.atomicRMDir\r?\n[\s\S]*?FunctionEnd/)?.[0]
if (!legacy) throw new Error('Pinned legacy migration function is missing')
function compile(name, source) {
  const file = join(evidence, `${name}.nsi`)
  writeFileSync(file, `\uFEFF\nUnicode true\nSilentInstall silent\nRequestExecutionLevel user\nOutFile "${join(evidence, `${name}.exe`)}"\n${source}`)
  execFileSync(compiler, ['/V2', file], { stdio: 'inherit' })
}
function run(name) {
  const file = join(evidence, `${name}.exe`).replace(/'/g, "''")
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$check = Start-Process -FilePath '${file}' -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru; exit $check.ExitCode`,
  ], { timeout: 30000, windowsHide: true })
}
try {
  compile('legacy', `
!include "LogicLib.nsh"
!define UNINSTALL_FILENAME "Uninstall fixture.exe"
${legacy.replaceAll('un.atomicRMDir', 'LegacyAtomicRemove')}
Section
  InitPluginsDir
  FileOpen $0 "$EXEDIR\\plugin-dir.log" w
  FileWrite $0 "$PLUGINSDIR"
  FileClose $0
  StrCpy $INSTDIR "${install}"
  CreateDirectory "$PLUGINSDIR\\old-install"
  Push ""
  Call LegacyAtomicRemove
  Pop $R0
  FileOpen $0 "$EXEDIR\\migration-result.log" w
  FileWrite $0 "$R0"
  FileClose $0
SectionEnd
`)
  run('legacy')
  if (readFileSync(join(evidence, 'migration-result.log'), 'utf8') !== asset) throw new Error('Legacy long-path migration failure was not reproduced')
  if (!existsSync(asset)) throw new Error('Failed legacy migration did not preserve the asset')
  console.log('legacy long-path migration failure: reproduced')
  compile('repair', `
!include "${join(root, 'build/upgrade-temp.nsh')}"
Section
  Call CetusPrepareUpgradeTemp
  IfErrors failed
  FileOpen $0 "$EXEDIR\\prepared-temp.log" w
  FileWrite $0 "$CetusUpgradeTemp"
  FileClose $0
  ExecWait '"$EXEDIR\\legacy.exe" /S' $R0
  Call CetusRestoreUpgradeTemp
  ReadEnvStr $R0 "TEMP"
  ReadEnvStr $R1 "TMP"
  FileOpen $0 "$EXEDIR\\restored-env.log" w
  FileWrite $0 "$R0$\\n$R1"
  FileClose $0
  Goto done
failed:
  SetErrorLevel 2
done:
SectionEnd
`)
  run('repair')
  if (readFileSync(join(evidence, 'migration-result.log'), 'utf8') !== '0') throw new Error('Short staging did not repair legacy migration')
  const restored = readFileSync(join(evidence, 'restored-env.log'), 'utf8').split('\n')
  if (restored[0] !== process.env.TEMP || restored[1] !== process.env.TMP) throw new Error('Installer environment was not restored')
  console.log('short staging migration and environment restoration: passed')
  console.log(`Evidence: ${evidence}`)
} finally {
  const target = resolve(install)
  if (!target.startsWith(resolve(base) + sep)) throw new Error('Unexpected fixture cleanup target')
  rmSync(target, { recursive: true, force: true })
  if (!baseExisted) {
    try { (await import('node:fs')).rmdirSync(base) } catch (error) { if (error.code !== 'ENOTEMPTY') throw error }
  }
}
