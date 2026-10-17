; electron-builder auto-includes this file from the build resources
; directory (nsis.include defaults to build/installer.nsh). The customInstall
; macro runs inside the install section, after the file copy completes.
;
; ── DSH home detection ──────────────────────────────────────────────────────
;
; Detect an existing DeepSeek Harness home and leave a read-only hint file in
; the shell's userData directory (%APPDATA%/CetusPrism). The hint only feeds
; the shell's first-run inheritance prompt: nothing in the detected home is
; created, modified, or deleted here, and the shell re-verifies the hinted
; path before using it.
;
; ── CLI PATH opt-in ─────────────────────────────────────────────────────────
;
; The assisted installer shows a custom page (customPageAfterChangeDir, which
; the template inserts between the directory page and InstFiles) asking
; whether to add `<install>\bin` to the user PATH. The bin directory holds
; the `dsh.cmd` (cmd/PowerShell) and `dsh` (POSIX sh for Git Bash) shims that
; scripts/cli-shims.mjs writes beside the backend runtime; both forward to
; the bundled node.exe and CLI entry. The accepted directory is remembered in
; HKCU\Software\CetusPrism\CliPathDir and an explicit decline is remembered in
; CliPathDeclined. The assisted installer defaults to adding PATH. A silent
; first install adds PATH; a silent upgrade preserves an explicit decline. A
; declined upgrade removes an earlier opt-in. The template runs the previous
; version's uninstaller before customInstall, and that uninstaller deletes
; both markers, so customInit captures them for the install decision.
; Installing to a new directory removes the recorded old PATH element before
; adding the current one; reinstalling to the same directory keeps the
; existing element in place. PATH elements are compared case-insensitively
; (kernel32::lstrcmpiW) because reinstalling to the same directory can differ
; in drive-letter and path case.
; The value is always written back as REG_EXPAND_SZ, which behaves as
; REG_SZ for values without percent references. Each write broadcasts
; WM_SETTINGCHANGE so already-running programs' new terminals see the change.
;
; The registry root, subkey, and value name holding the simulated Path are
; overridable with defines so the standalone test harness exercises the
; functions against a scratch key instead of the real user environment.

!ifndef CETUS_PATH_REG_ROOT
  !define CETUS_PATH_REG_ROOT HKCU
!endif
!ifndef CETUS_PATH_REG_SUBKEY
  !define CETUS_PATH_REG_SUBKEY "Environment"
!endif
!ifndef CETUS_PATH_REG_VALUE
  !define CETUS_PATH_REG_VALUE "Path"
!endif

!define CETUS_REG_KEY "Software\CetusPrism"
!define CETUS_REG_CLIPATH_VALUE "CliPathDir"
!define CETUS_REG_CLIPATH_DECLINED_VALUE "CliPathDeclined"

!include "${__FILEDIR__}\upgrade-temp.nsh"

; ${BST_CHECKED} comes from WinMessages.nsh, which MUI2 includes before the
; customPageAfterChangeDir macro expands; defining it here would collide with
; that unguarded define.

; Page-only variables exist in the installer build; the uninstaller build
; never inserts the page and errors on unreferenced variables.
!ifndef BUILD_UNINSTALLER
Var CliPathCheckbox
; "1" = opted in on the CLI page, "0" = declined, "" = silent install (no page).
Var CliPathChosen
; The PATH element recorded by the previous accepted install; empty on a
; first install.
Var CliPathSavedDir
; "1" when the previous assisted install explicitly declined PATH; otherwise
; empty.
Var CliPathDeclined
; membership result of CetusCliPathHasDir, which only the installer build compiles
Var CetusPathFound
!endif
Var CetusDir
Var CetusToken
Var CetusRest
Var CetusPathWork
Var CetusPathRebuilt
Var CetusScanIdx

; The template runs the previous version's uninstaller between this macro and
; customInstall, and that uninstaller deletes both CLI PATH markers. Capture
; them here so the install decision survives an upgrade.
!macro customInit
  !ifndef BUILD_UNINSTALLER
  ReadRegStr $CliPathDeclined HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_DECLINED_VALUE}"
  ReadRegStr $CliPathSavedDir HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_VALUE}"
  !endif
!macroend

; ── the CLI PATH page (installer build only) ────────────────────────────────

!macro customHeader
  ; Language strings live in customHeader, which the generated script
  ; expands after addLangs (the MUI_LANGUAGE inserts that define the
  ; ${LANG_*} ids), while the page macro expands before them.
  ; Every language the generated installer ships, so no UI language renders
  ; an empty page. Non-Chinese languages fall back to the English copy.
  ; electron-builder's addLangs renames Spanish to "SpanishInternational",
  ; so its id is LANG_SPANISHINTERNATIONAL, not LANG_SPANISH.
  LangString CetusCliPageTitle ${LANG_ENGLISH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_SIMPCHINESE} "命令行工具（CLI）"
  LangString CetusCliPageTitle ${LANG_TRADCHINESE} "命令列工具（CLI）"
  LangString CetusCliPageTitle ${LANG_GERMAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_FRENCH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_SPANISHINTERNATIONAL} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_JAPANESE} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_KOREAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_ITALIAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_DUTCH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_DANISH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_SWEDISH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_NORWEGIAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_FINNISH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_RUSSIAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_PORTUGUESE} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_PORTUGUESEBR} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_POLISH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_UKRAINIAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_CZECH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_SLOVAK} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_HUNGARIAN} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_ARABIC} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_TURKISH} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_THAI} "Command-line tool (CLI)"
  LangString CetusCliPageTitle ${LANG_VIETNAMESE} "Command-line tool (CLI)"

  LangString CetusCliPageSubtitle ${LANG_ENGLISH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_SIMPCHINESE} "选择是否让 dsh 命令在终端中可用。"
  LangString CetusCliPageSubtitle ${LANG_TRADCHINESE} "選擇是否讓 dsh 命令在終端機中可用。"
  LangString CetusCliPageSubtitle ${LANG_GERMAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_FRENCH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_SPANISHINTERNATIONAL} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_JAPANESE} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_KOREAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_ITALIAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_DUTCH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_DANISH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_SWEDISH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_NORWEGIAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_FINNISH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_RUSSIAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_PORTUGUESE} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_PORTUGUESEBR} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_POLISH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_UKRAINIAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_CZECH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_SLOVAK} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_HUNGARIAN} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_ARABIC} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_TURKISH} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_THAI} "Choose whether the dsh command becomes available in your terminal."
  LangString CetusCliPageSubtitle ${LANG_VIETNAMESE} "Choose whether the dsh command becomes available in your terminal."

  LangString CetusCliPageHint ${LANG_ENGLISH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_SIMPCHINESE} "将内置的 dsh 启动器加入用户 PATH 环境变量，任何新终端窗口都可以直接运行 dsh（例如：dsh --profile headless $\"任务$\"）。卸载程序会自动移除。"
  LangString CetusCliPageHint ${LANG_TRADCHINESE} "將內建的 dsh 啟動器加入使用者 PATH 環境變數，任何新終端機視窗都可以直接執行 dsh（例如：dsh --profile headless $\"任務$\"）。解除安裝程式會自動移除。"
  LangString CetusCliPageHint ${LANG_GERMAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_FRENCH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_SPANISHINTERNATIONAL} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_JAPANESE} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_KOREAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_ITALIAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_DUTCH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_DANISH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_SWEDISH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_NORWEGIAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_FINNISH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_RUSSIAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_PORTUGUESE} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_PORTUGUESEBR} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_POLISH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_UKRAINIAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_CZECH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_SLOVAK} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_HUNGARIAN} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_ARABIC} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_TURKISH} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_THAI} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."
  LangString CetusCliPageHint ${LANG_VIETNAMESE} "Adds the bundled dsh launcher to your user PATH, so commands like dsh --profile headless $\"task$\" work in any new terminal window. Uninstalling removes it again."

  LangString CetusCliPageCheckbox ${LANG_ENGLISH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_SIMPCHINESE} "将 dsh 命令行加入 PATH（推荐）"
  LangString CetusCliPageCheckbox ${LANG_TRADCHINESE} "將 dsh 命令列加入 PATH（建議）"
  LangString CetusCliPageCheckbox ${LANG_GERMAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_FRENCH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_SPANISHINTERNATIONAL} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_JAPANESE} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_KOREAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_ITALIAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_DUTCH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_DANISH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_SWEDISH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_NORWEGIAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_FINNISH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_RUSSIAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_PORTUGUESE} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_PORTUGUESEBR} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_POLISH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_UKRAINIAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_CZECH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_SLOVAK} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_HUNGARIAN} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_ARABIC} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_TURKISH} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_THAI} "Add dsh to PATH (recommended)"
  LangString CetusCliPageCheckbox ${LANG_VIETNAMESE} "Add dsh to PATH (recommended)"
!macroend

!macro customPageAfterChangeDir
  !include "nsDialogs.nsh"


  Page custom CetusCliPathPageCreate CetusCliPathPageLeave

  Function CetusCliPathPageCreate
    !insertmacro MUI_HEADER_TEXT "$(CetusCliPageTitle)" "$(CetusCliPageSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 32u "$(CetusCliPageHint)"
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "$(CetusCliPageCheckbox)"
    Pop $CliPathCheckbox
    ${NSD_SetState} $CliPathCheckbox ${BST_CHECKED}
    nsDialogs::Show
  FunctionEnd

  Function CetusCliPathPageLeave
    ${NSD_GetState} $CliPathCheckbox $CliPathChosen
  FunctionEnd
!macroend

; ── PATH element helpers (both installer and uninstaller builds) ────────────

; Removes every element of the configured Path value equal to $CetusDir
; (case-insensitively) and broadcasts WM_SETTINGCHANGE. An absent or empty
; Path value is left untouched. The splitter function name is a macro
; parameter so the uninstaller copy calls its own namespace.
!macro CETUS_REMOVE_BODY SPLITFUNC
  ReadRegStr $CetusPathWork ${CETUS_PATH_REG_ROOT} "${CETUS_PATH_REG_SUBKEY}" "${CETUS_PATH_REG_VALUE}"
  StrCmp $CetusPathWork "" remove_done
  StrCpy $CetusPathRebuilt ""
remove_scan:
  StrCmp $CetusPathWork "" remove_write
  Call ${SPLITFUNC}
  StrCpy $CetusPathWork "$CetusRest"
  StrCpy $0 "$CetusToken"
  StrCpy $1 "$CetusDir"
  System::Call 'kernel32::lstrcmpiW(t r0, t r1)i .r2'
  StrCmp $2 "0" remove_skip
  StrCmp $CetusToken "" remove_skip
  StrCpy $CetusPathRebuilt "$CetusPathRebuilt;$CetusToken"
  Goto remove_scan
remove_skip:
  Goto remove_scan
remove_write:
  StrCpy $CetusPathRebuilt "$CetusPathRebuilt" "" 1
  WriteRegExpandStr ${CETUS_PATH_REG_ROOT} "${CETUS_PATH_REG_SUBKEY}" "${CETUS_PATH_REG_VALUE}" "$CetusPathRebuilt"
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=10000
remove_done:
!macroend

; The uninstall section may only call `un.`-prefixed functions, so the
; functions the uninstaller needs are emitted twice from one body macro each.
; NSIS treats "function not referenced" as an error under electron-builder,
; so each build compiles only the namespace it references: the installer
; build the plain set (customInstall), the uninstaller build the `un.` set
; (customUnInstall). Labels are function-local, so the duplicated bodies do
; not collide.

; Splits $CetusPathWork at its first ';': $CetusToken receives the element
; before the delimiter and $CetusRest the remainder after it. A string with
; no delimiter yields the whole string as the token and an empty remainder.
; Clobbers $0; callers must not hold $0 across the call.
!macro CETUS_SPLIT_TOKEN_BODY
  StrCpy $CetusToken ""
  StrCpy $CetusRest ""
  StrCpy $CetusScanIdx 0
split_scan:
  StrCpy $0 "$CetusPathWork" 1 $CetusScanIdx
  StrCmp $0 "" split_whole
  StrCmp $0 ";" split_mid
  IntOp $CetusScanIdx $CetusScanIdx + 1
  Goto split_scan
split_whole:
  StrCpy $CetusToken "$CetusPathWork"
  Return
split_mid:
  StrCpy $CetusToken "$CetusPathWork" $CetusScanIdx
  IntOp $CetusScanIdx $CetusScanIdx + 1
  StrCpy $CetusRest "$CetusPathWork" "" $CetusScanIdx
  Return
!macroend

!ifndef BUILD_UNINSTALLER

Function CetusCliPathSplitToken
  !insertmacro CETUS_SPLIT_TOKEN_BODY
FunctionEnd

; Sets $CetusPathFound to "1" when a ';'-separated element of the configured
; Path value equals $CetusDir case-insensitively, otherwise to "".
Function CetusCliPathHasDir
  StrCpy $CetusPathFound ""
  ReadRegStr $CetusPathWork ${CETUS_PATH_REG_ROOT} "${CETUS_PATH_REG_SUBKEY}" "${CETUS_PATH_REG_VALUE}"
has_scan:
  StrCmp $CetusPathWork "" has_out
  Call CetusCliPathSplitToken
  StrCpy $CetusPathWork "$CetusRest"
  StrCpy $0 "$CetusToken"
  StrCpy $1 "$CetusDir"
  System::Call 'kernel32::lstrcmpiW(t r0, t r1)i .r2'
  StrCmp $2 "0" has_hit
  Goto has_scan
has_hit:
  StrCpy $CetusPathFound "1"
has_out:
FunctionEnd

; Appends $CetusDir to the configured Path value unless an equal element is
; already present, then broadcasts WM_SETTINGCHANGE. A missing or empty Path
; value becomes just the directory.
Function CetusCliPathAdd
  Call CetusCliPathHasDir
  StrCmp $CetusPathFound "1" add_done
  ReadRegStr $CetusPathWork ${CETUS_PATH_REG_ROOT} "${CETUS_PATH_REG_SUBKEY}" "${CETUS_PATH_REG_VALUE}"
  StrCmp $CetusPathWork "" add_empty
  StrCpy $CetusPathWork "$CetusPathWork;$CetusDir"
  Goto add_write
add_empty:
  StrCpy $CetusPathWork "$CetusDir"
add_write:
  WriteRegExpandStr ${CETUS_PATH_REG_ROOT} "${CETUS_PATH_REG_SUBKEY}" "${CETUS_PATH_REG_VALUE}" "$CetusPathWork"
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=10000
add_done:
FunctionEnd

Function CetusCliPathRemove
  !insertmacro CETUS_REMOVE_BODY CetusCliPathSplitToken
FunctionEnd

!else

Function un.CetusCliPathSplitToken
  !insertmacro CETUS_SPLIT_TOKEN_BODY
FunctionEnd

Function un.CetusCliPathRemove
  !insertmacro CETUS_REMOVE_BODY un.CetusCliPathSplitToken
FunctionEnd

!endif

; ── running-application close (installer and uninstaller builds) ────────────

; The default check's graceful close is a plain WM_CLOSE round, and CetusPrism
; closes its window into the tray instead of exiting — the default loop can
; never succeed and lands in the "close manually" dialog. This override first
; asks the running instance to quit through its single-instance handshake
; (`--dsh-installer-quit`, a clean teardown that stops the backend too), then
; force-kills the process tree so an orphaned backend node.exe cannot hold
; runtime file locks, and only then falls back to the manual-close dialog for
; an instance this installer cannot terminate (elevated process).
!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!ifndef CETUS_INSTALLER_LOG_DIR
  !define CETUS_INSTALLER_LOG_DIR "$LOCALAPPDATA\CetusPrism\installer-logs"
!endif

!macro CETUS_CLOSE_TRACE _TEXT
  FileOpen $CetusCloseLog "$CetusCloseLogPath" a
  FileSeek $CetusCloseLog 0 END
  FileWriteUTF16LE $CetusCloseLog '${_TEXT}$\r$\n'
  FileClose $CetusCloseLog
!macroend

!macro customCheckAppRunning
  Var /GLOBAL CetusCloseLog
  Var /GLOBAL CetusCloseLogPath
  CreateDirectory "${CETUS_INSTALLER_LOG_DIR}"
  GetTempFileName $CetusCloseLogPath "${CETUS_INSTALLER_LOG_DIR}"
  FileOpen $CetusCloseLog "$CetusCloseLogPath" w
  FileWriteByte $CetusCloseLog 255
  FileWriteByte $CetusCloseLog 254
  FileClose $CetusCloseLog
  !insertmacro CETUS_CLOSE_TRACE "version=${VERSION} installer=$EXEPATH installDir=$INSTDIR target=${APP_EXECUTABLE_FILENAME}"
  System::Call 'kernel32::GetCurrentProcessId() i.R3'
  !insertmacro CETUS_CLOSE_TRACE "installerPid=$R3"
  System::Call 'shell32::IsUserAnAdmin() i.R3'
  !insertmacro CETUS_CLOSE_TRACE "installerAdmin=$R3"
  !ifndef BUILD_UNINSTALLER
    Call CetusPrepareUpgradeTemp
    IfErrors cetus_upgrade_temp_failed cetus_upgrade_temp_ready
cetus_upgrade_temp_failed:
    !insertmacro CETUS_CLOSE_TRACE "upgradeTemp=failed"
    MessageBox MB_OK|MB_ICONSTOP "$(uninstallFailed)$\r$\n$CetusCloseLogPath" /SD IDOK
    SetErrorLevel 2
    Quit
cetus_upgrade_temp_ready:
    !insertmacro CETUS_CLOSE_TRACE "upgradeTemp=$CetusUpgradeTemp"
  !endif
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  !insertmacro CETUS_CLOSE_TRACE "initialFind=$R0"
  StrCmp $R0 "0" 0 cetus_check_done
  nsExec::ExecToStack /OEM `"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH`
  Pop $R3
  Pop $R2
  !insertmacro CETUS_CLOSE_TRACE "tasklistExit=$R3 output=$R2"
  DetailPrint `Closing running "${PRODUCT_NAME}"...`
cetus_request_quit:
  ; A second launch forwards the flag to the tray instance and exits
  ; immediately; the owner quits without the close confirmation.
  ClearErrors
  Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --dsh-installer-quit`
  IfErrors cetus_quit_launch_failed cetus_quit_launched
cetus_quit_launch_failed:
  !insertmacro CETUS_CLOSE_TRACE "quitLaunch=failed"
  Goto cetus_quit_wait
cetus_quit_launched:
  !insertmacro CETUS_CLOSE_TRACE "quitLaunch=started"
cetus_quit_wait:
  StrCpy $R1 0
cetus_graceful_wait:
  IntOp $R1 $R1 + 1
  Sleep 500
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  !insertmacro CETUS_CLOSE_TRACE "gracefulFind=$R0 poll=$R1"
  StrCmp $R0 "0" 0 cetus_closed
  IntCmp $R1 16 cetus_force_close cetus_graceful_wait cetus_force_close
cetus_force_close:
  ; The graceful window expired. Force-kill the whole tree: /T reaps the
  ; backend node.exe child whose open handles would block the file copy.
  nsExec::ExecToStack /OEM `"$SYSDIR\taskkill.exe" /f /t /im "${APP_EXECUTABLE_FILENAME}"`
  Pop $R0
  Pop $R2
  !insertmacro CETUS_CLOSE_TRACE "taskkillExit=$R0 output=$R2"
  StrCpy $R1 0
cetus_force_wait:
  Sleep 500
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  !insertmacro CETUS_CLOSE_TRACE "forcedFind=$R0 poll=$R1"
  StrCmp $R0 "0" 0 cetus_closed
  IntOp $R1 $R1 + 1
  IntCmp $R1 16 cetus_close_failed cetus_force_wait cetus_close_failed
cetus_close_failed:
  !insertmacro CETUS_CLOSE_TRACE "result=close-failed"
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)$\r$\n$\r$\n$CetusCloseLogPath" /SD IDCANCEL IDRETRY cetus_request_quit
  SetErrorLevel 2
  Quit
cetus_closed:
  Sleep 300
cetus_check_done:
  !insertmacro CETUS_CLOSE_TRACE "result=check-complete"
!macroend

; ── install hook ────────────────────────────────────────────────────────────

!macro customInstall
  ReadRegStr $0 HKCU "Environment" "DSH_HOME"
  IfErrors env_missing 0
  StrCpy $1 "env"
  Goto hint_write
env_missing:
  StrCpy $0 ""
  IfFileExists "$PROFILE\.dsh\.credentials.yaml" default_found 0
  IfFileExists "$PROFILE\.dsh\settings.yaml" default_found 0
  IfFileExists "$PROFILE\.dsh\profiles\*.*" default_found hint_skip
default_found:
  StrCpy $0 "$PROFILE\.dsh"
  StrCpy $1 "default"
hint_write:
  CreateDirectory "$APPDATA\CetusPrism"
  WriteINIStr "$APPDATA\CetusPrism\install-detected-dsh-home.ini" "detected" "found" "$1"
  WriteINIStr "$APPDATA\CetusPrism\install-detected-dsh-home.ini" "detected" "path" "$0"
hint_skip:

  ; Apply the page choice. A silent install either enables PATH on first
  ; install or preserves a previous explicit decline. Both markers were
  ; captured in customInit; see the comment there for why the registry is
  ; not read here.
  StrCmp $CliPathChosen "" 0 clipath_dispatch
  StrCmp $CliPathDeclined "1" clipath_remove 0
  StrCpy $CliPathChosen "1"
clipath_dispatch:
  StrCmp $CliPathChosen "1" clipath_add 0
  StrCmp $CliPathChosen "0" clipath_remove 0
  Goto clipath_done
clipath_add:
  StrCpy $CetusDir "$INSTDIR\bin"
  StrCmp $CliPathSavedDir "" clipath_add_insert 0
  StrCpy $0 "$CliPathSavedDir"
  StrCpy $1 "$CetusDir"
  System::Call 'kernel32::lstrcmpiW(t r0, t r1)i .r2'
  StrCmp $2 "0" clipath_add_same 0
  ; Relocation removes the recorded old element first so the user PATH never
  ; keeps both the old and the new install directory.
  StrCpy $CetusDir "$CliPathSavedDir"
  Call CetusCliPathRemove
  StrCpy $CetusDir "$INSTDIR\bin"
  Call CetusCliPathAdd
  Goto clipath_add_write
clipath_add_same:
  ; Same directory up to drive-letter and path case: keep its PATH position
  ; and only re-add when the element was removed externally.
  Call CetusCliPathHasDir
  StrCmp $CetusPathFound "1" clipath_add_write 0
  StrCpy $CetusDir "$INSTDIR\bin"
  Call CetusCliPathAdd
  Goto clipath_add_write
clipath_add_insert:
  StrCpy $CetusDir "$INSTDIR\bin"
  Call CetusCliPathAdd
clipath_add_write:
  WriteRegStr HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_VALUE}" "$CetusDir"
  DeleteRegValue HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_DECLINED_VALUE}"
  Goto clipath_done
clipath_remove:
  StrCmp $CliPathSavedDir "" clipath_declined
  StrCpy $CetusDir "$CliPathSavedDir"
  Call CetusCliPathRemove
clipath_declined:
  WriteRegStr HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_DECLINED_VALUE}" "1"
  Goto clipath_cleared
clipath_cleared:
  DeleteRegValue HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_VALUE}"
  Goto clipath_done
clipath_done:
  Call CetusRestoreUpgradeTemp
!macroend

; ── uninstall hook ──────────────────────────────────────────────────────────

!macro customUnInstall
  ReadRegStr $0 HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_VALUE}"
  StrCmp $0 "" clipath_un_cleared
  StrCpy $CetusDir "$0"
  Call un.CetusCliPathRemove
clipath_un_cleared:
  DeleteRegValue HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_VALUE}"
  DeleteRegValue HKCU "${CETUS_REG_KEY}" "${CETUS_REG_CLIPATH_DECLINED_VALUE}"
!macroend
