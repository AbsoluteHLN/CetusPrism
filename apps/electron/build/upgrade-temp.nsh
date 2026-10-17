; Short, per-run staging for legacy NSIS uninstallers. Environment changes
; apply only to this installer and its children, never the user's settings.
!ifndef BUILD_UNINSTALLER
Var CetusUpgradeTemp
Var CetusUpgradeOldTemp
Var CetusUpgradeOldTmp
Var CetusUpgradeBaseCreated

Function CetusPrepareUpgradeTemp
  StrCmp $CetusUpgradeTemp "" 0 cetus_upgrade_ready
  ReadEnvStr $CetusUpgradeOldTemp "TEMP"
  ReadEnvStr $CetusUpgradeOldTmp "TMP"
  ClearErrors
  StrCpy $CetusUpgradeBaseCreated "0"
  IfFileExists "$PROFILE\.cp\*.*" cetus_upgrade_base_ready
  CreateDirectory "$PROFILE\.cp"
  IfErrors cetus_upgrade_failed
  StrCpy $CetusUpgradeBaseCreated "1"
cetus_upgrade_base_ready:
  GetTempFileName $CetusUpgradeTemp "$PROFILE\.cp"
  IfErrors cetus_upgrade_failed
  Delete "$CetusUpgradeTemp"
  CreateDirectory "$CetusUpgradeTemp"
  IfErrors cetus_upgrade_failed
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$CetusUpgradeTemp") i.R3'
  StrCmp $R3 0 cetus_upgrade_restore_failed
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$CetusUpgradeTemp") i.R3'
  StrCmp $R3 0 cetus_upgrade_restore_failed
cetus_upgrade_ready:
  ClearErrors
  Return
cetus_upgrade_restore_failed:
  Call CetusRestoreUpgradeTemp
cetus_upgrade_failed:
  SetErrors
FunctionEnd

Function CetusRestoreUpgradeTemp
  StrCmp $CetusUpgradeTemp "" cetus_upgrade_restore_done
  StrCmp $CetusUpgradeOldTemp "" 0 +3
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", p 0)'
    Goto +2
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$CetusUpgradeOldTemp")'
  StrCmp $CetusUpgradeOldTmp "" 0 +3
    System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", p 0)'
    Goto +2
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$CetusUpgradeOldTmp")'
  ; Nonempty staging is retained for recovery; never recursively remove it.
  RMDir "$CetusUpgradeTemp"
  StrCmp $CetusUpgradeBaseCreated "1" 0 +2
    RMDir "$PROFILE\.cp"
  StrCpy $CetusUpgradeTemp ""
cetus_upgrade_restore_done:
FunctionEnd

Function .onGUIEnd
  Call CetusRestoreUpgradeTemp
FunctionEnd
!endif
