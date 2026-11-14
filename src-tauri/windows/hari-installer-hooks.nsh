; Fork (Hari, L-276): release builds install as "Hari" (tauri.hari.conf.json).
; The app id stays com.monocode.desktop and the program stays monocode.exe, so
; settings, chats and accounts carry over. These hooks move a MonoCode install
; over to Hari. MonoCode's own folder is left on disk.

!define HARI_OLD_PRODUCT "MonoCode"
!define HARI_OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${HARI_OLD_PRODUCT}"

!macro NSIS_HOOK_PREINSTALL
  ; The in-app updater runs the installer with /UPDATE and no folder, so the
  ; first Hari install from MonoCode would land in %LOCALAPPDATA%\Hari. Put it
  ; beside MonoCode instead (E:\Installed\MonoCode -> E:\Installed\Hari).
  ${If} $UpdateMode = 1
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ReadRegStr $R9 SHCTX "Software\${MANUFACTURER}\${HARI_OLD_PRODUCT}" ""
    ${If} $R9 != ""
    ${AndIf} ${FileExists} "$R9\${MAINBINARYNAME}.exe"
      ${GetParent} $R9 $R9
      StrCpy $INSTDIR "$R9\${PRODUCTNAME}"
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend

!macro HARI_MOVE_SHORTCUT folder
  ; MonoCode's shortcut (only if it opens that MonoCode) becomes Hari's. An
  ; update makes no shortcuts of its own, so Hari's is made here.
  !insertmacro IsShortcutTarget "${folder}\${HARI_OLD_PRODUCT}.lnk" "$R9\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    ${IfNot} ${FileExists} "${folder}\${PRODUCTNAME}.lnk"
      CreateShortcut "${folder}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "${folder}\${PRODUCTNAME}.lnk"
    ${EndIf}
    Delete "${folder}\${HARI_OLD_PRODUCT}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R9 SHCTX "Software\${MANUFACTURER}\${HARI_OLD_PRODUCT}" ""
  ${If} $R9 != ""
  ${AndIf} $R9 != $INSTDIR
    !insertmacro HARI_MOVE_SHORTCUT "$SMPROGRAMS"
    !insertmacro HARI_MOVE_SHORTCUT "$DESKTOP"
    ; MonoCode's uninstaller can delete the app data Hari now shares, so its
    ; Installed apps entry goes. Its folder stays until you delete it.
    DeleteRegKey SHCTX "${HARI_OLD_UNINSTKEY}"
    DeleteRegKey SHCTX "Software\${MANUFACTURER}\${HARI_OLD_PRODUCT}"
  ${EndIf}
!macroend
