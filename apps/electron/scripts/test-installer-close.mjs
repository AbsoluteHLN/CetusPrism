/** Exercise the production NSIS close hook against private Windows processes. */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'win32') throw new Error('This check requires Windows')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'cetus-close-'))
const image = `CetusClose-${Date.now()}.exe`
const builder = resolve(root, 'node_modules/electron-builder')
const builderReal = realpathSync(builder)
const lib = join(dirname(builderReal), 'app-builder-lib')
const cache = process.env.ELECTRON_BUILDER_CACHE ?? 'E:/dependency-cache/electron-builder/Cache'
const nsis = join(cache, 'nsis/nsis-3.0.4.1')
const source = readFileSync(join(root, 'build/installer.nsh'), 'utf8')
const hookStart = source.indexOf('; ── running-application close')
const hookEnd = source.indexOf('; ── install hook', hookStart)
if (hookStart < 0 || hookEnd < 0) throw new Error('Production close hook is missing')
const hook = source.slice(hookStart, hookEnd)
writeFileSync(join(scratch, 'worker.cs'), `
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
class Worker {
  static void Main(string[] args) {
    var dir = AppDomain.CurrentDomain.BaseDirectory;
    if (args.Length > 0 && args[0] == "--child") { Thread.Sleep(60000); return; }
    if (Array.IndexOf(args, "--dsh-installer-quit") >= 0) {
      File.WriteAllText(Path.Combine(dir, "quit-request"), "yes"); return;
    }
    if (args.Length > 0 && args[0] == "forced") {
      var child = Process.Start(Process.GetCurrentProcess().MainModule.FileName, "--child");
      File.WriteAllText(Path.Combine(dir, "child-pid"), child.Id.ToString());
    }
    File.WriteAllText(Path.Combine(dir, "ready"), "yes");
    if (args.Length > 0 && args[0] == "graceful") {
      while (!File.Exists(Path.Combine(dir, "quit-request"))) Thread.Sleep(50);
      Thread.Sleep(2000);
      File.WriteAllText(Path.Combine(dir, "graceful-exit"), "yes"); return;
    }
    Thread.Sleep(60000);
  }
}`)
execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', `/out:${join(scratch, image)}`, join(scratch, 'worker.cs')])
writeFileSync(join(scratch, 'test.nsi'), `\uFEFF
Unicode true
Name "Cetus close regression"
OutFile "${join(scratch, 'close-check.exe')}"
RequestExecutionLevel user
SilentInstall silent
!addincludedir "${join(lib, 'templates/nsis/include')}"
!addplugindir /x86-unicode "${join(cache, 'nsis/nsis-resources-3.4.1/plugins/x86-unicode')}"
!include "nsProcess.nsh"
!define APP_EXECUTABLE_FILENAME "${image}"
!define PRODUCT_NAME "Cetus close regression"
!define VERSION "test"
!define CETUS_INSTALLER_LOG_DIR "${scratch}"
LangString uninstallFailed 1033 "Uninstall failed"
LangString appCannotBeClosed 1033 "Close failed"
!include "${join(root, 'build/upgrade-temp.nsh')}"
${hook}
Section
  StrCpy $INSTDIR "${scratch}"
  !insertmacro customCheckAppRunning
  Call CetusRestoreUpgradeTemp
  FileOpen $0 "$INSTDIR\\hook-complete" w
  FileWrite $0 "yes"
  FileClose $0
SectionEnd
`)
execFileSync(join(nsis, 'makensis.exe'), ['/V2', join(scratch, 'test.nsi')], { stdio: 'inherit' })
function runCloseCheck() {
  const executable = join(scratch, 'close-check.exe').replace(/'/g, "''")
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$check = Start-Process -FilePath '${executable}' -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru; exit $check.ExitCode`,
  ], { timeout: 25000, windowsHide: true })
}
runCloseCheck()
if (!existsSync(join(scratch, 'hook-complete'))) throw new Error('No-process close hook did not complete')
console.log('no running process: passed')
for (const mode of ['graceful', 'forced']) {
  for (const name of ['ready', 'quit-request', 'graceful-exit', 'hook-complete', 'child-pid']) rmSync(join(scratch, name), { force: true })
  const worker = spawn(join(scratch, image), [mode], { windowsHide: true })
  const exited = new Promise(resolveExit => worker.once('exit', resolveExit))
  try {
    for (let i = 0; i < 100 && !existsSync(join(scratch, 'ready')); i++) await delay(50)
    if (!existsSync(join(scratch, 'ready'))) throw new Error('Worker did not start')
    runCloseCheck()
    await Promise.race([exited, delay(2000).then(() => { throw new Error('Worker remained alive') })])
    if (!existsSync(join(scratch, 'hook-complete'))) throw new Error(`${mode}: close hook did not complete`)
    if (mode === 'graceful' && !existsSync(join(scratch, 'graceful-exit'))) throw new Error('Graceful teardown was force-killed before completion')
    if (mode === 'forced') {
      const pid = Number(readFileSync(join(scratch, 'child-pid'), 'utf8'))
      let alive = true
      try { process.kill(pid, 0) } catch (error) { if (error.code !== 'ESRCH') throw error; alive = false }
      if (alive) throw new Error('Backend child survived forced teardown')
    }
    console.log(`${mode}: passed`)
  } finally {
    if (worker.exitCode === null) {
      execFileSync(join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/f', '/t', '/pid', String(worker.pid)], { stdio: 'ignore' })
      await exited
    }
  }
}
console.log(`Evidence: ${scratch}`)
const logs = readdirSync(scratch).filter(name => name.endsWith('.tmp')).map(name => readFileSync(join(scratch, name), 'utf16le')).join('\n')
for (const expected of ['initialFind=603', 'initialFind=0', 'quitLaunch=started', 'taskkillExit=0', `output="${image}"`, 'result=check-complete']) {
  if (!logs.includes(expected)) throw new Error(`Missing shutdown diagnostic: ${expected}`)
}
console.log('shutdown diagnostics: passed')
