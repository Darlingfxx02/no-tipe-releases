; Copyright (c) 2026 Darlingfxx02.
; SPDX-License-Identifier: Apache-2.0
; Native No Type pages. Included after Tauri's languages and globals.
!include nsDialogs.nsh

Var NoTipeDialog
Var NoTipeDpi
Var NoTipeBodyFont
Var NoTipeTitleFont
Var NoTipeBrandFont
Var NoTipeSmallFont
Var NoTipeIcon
Var NoTipePath
Var NoTipeHeading
Var NoTipeStatus
Var NoTipeFinished
Var NoTipeLaunch

LangString ntInstall ${LANG_ENGLISH} "Install ${PRODUCTNAME}"
LangString ntInstall ${LANG_RUSSIAN} "Установить ${PRODUCTNAME}"
LangString ntUpdate ${LANG_ENGLISH} "Update ${PRODUCTNAME}"
LangString ntUpdate ${LANG_RUSSIAN} "Обновить ${PRODUCTNAME}"
LangString ntWelcome ${LANG_ENGLISH} "Your voice. Into words."
LangString ntWelcome ${LANG_RUSSIAN} "Голос становится текстом."
LangString ntDescription ${LANG_ENGLISH} "Dictate, transcribe and write in your own style.$\r$\nLet's get ${PRODUCTNAME} ready for you."
LangString ntDescription ${LANG_RUSSIAN} "Диктуйте, расшифровывайте и пишите в своём стиле.$\r$\nПодготовим ${PRODUCTNAME} к работе."
LangString ntFolder ${LANG_ENGLISH} "Install location"
LangString ntFolder ${LANG_RUSSIAN} "Папка установки"
LangString ntChange ${LANG_ENGLISH} "Change…"
LangString ntChange ${LANG_RUSSIAN} "Изменить…"
LangString ntLicense ${LANG_ENGLISH} "License and terms"
LangString ntLicense ${LANG_RUSSIAN} "Лицензия и условия"
LangString ntFolderError ${LANG_ENGLISH} "Choose a writable folder with enough free space."
LangString ntFolderError ${LANG_RUSSIAN} "Выберите доступную для записи папку со свободным местом."
LangString ntInstalling ${LANG_ENGLISH} "Getting things ready."
LangString ntInstalling ${LANG_RUSSIAN} "Готовим всё к работе."
LangString ntInstallingDescription ${LANG_ENGLISH} "${PRODUCTNAME} is being installed on your computer.$\r$\nYou can open it when installation is complete."
LangString ntInstallingDescription ${LANG_RUSSIAN} "${PRODUCTNAME} устанавливается на ваш компьютер.$\r$\nПосле установки можно сразу начать работу."
LangString ntRuntime ${LANG_ENGLISH} "Checking system components…"
LangString ntRuntime ${LANG_RUSSIAN} "Проверяем системные компоненты…"
LangString ntCopy ${LANG_ENGLISH} "Installing ${PRODUCTNAME}…"
LangString ntCopy ${LANG_RUSSIAN} "Устанавливаем ${PRODUCTNAME}…"
LangString ntDone ${LANG_ENGLISH} "You're all set."
LangString ntDone ${LANG_RUSSIAN} "Всё готово."
LangString ntDoneDescription ${LANG_ENGLISH} "${PRODUCTNAME} is installed. Open the app to choose$\r$\nyour microphone and speech model."
LangString ntDoneDescription ${LANG_RUSSIAN} "${PRODUCTNAME} установлен. Откройте приложение,$\r$\nчтобы выбрать микрофон и модель распознавания."
LangString ntOpen ${LANG_ENGLISH} "Open ${PRODUCTNAME}"
LangString ntOpen ${LANG_RUSSIAN} "Открыть ${PRODUCTNAME}"
LangString ntClose ${LANG_ENGLISH} "Close"
LangString ntClose ${LANG_RUSSIAN} "Закрыть"
LangString ntDesktop ${LANG_ENGLISH} "Create a desktop shortcut"
LangString ntDesktop ${LANG_RUSSIAN} "Создать ярлык на рабочем столе"
LangString ntDetails ${LANG_ENGLISH} "Details"
LangString ntDetails ${LANG_RUSSIAN} "Подробности"
LangString ntRemoving ${LANG_ENGLISH} "Removing ${PRODUCTNAME}."
LangString ntRemoving ${LANG_RUSSIAN} "Удаляем ${PRODUCTNAME}."
LangString ntRemovingDescription ${LANG_ENGLISH} "Removing the app from your computer."
LangString ntRemovingDescription ${LANG_RUSSIAN} "Удаляем приложение с компьютера."

; All measurements are logical pixels, scaled with the window's current DPI.
!macro NT_MOVE HWND X Y W H
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $4 ${HWND}
  IntOp $0 ${X} * $NoTipeDpi
  IntOp $0 $0 / 96
  IntOp $1 ${Y} * $NoTipeDpi
  IntOp $1 $1 / 96
  IntOp $2 ${W} * $NoTipeDpi
  IntOp $2 $2 / 96
  IntOp $3 ${H} * $NoTipeDpi
  IntOp $3 $3 / 96
  System::Call 'user32::MoveWindow(p r4, i r0, i r1, i r2, i r3, i1)'
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NT_LABEL PARENT TEXT FONT X Y W H RESULT
  System::Call 'user32::CreateWindowExW(i0, w "STATIC", w "${TEXT}", i0x50000000, i0, i0, i0, i0, p ${PARENT}, p0, p0, p0) p.s'
  Pop ${RESULT}
  SendMessage ${RESULT} ${WM_SETFONT} ${FONT} 1
  !insertmacro NT_MOVE ${RESULT} ${X} ${Y} ${W} ${H}
!macroend

!macro NT_GUI PREFIX
Function ${PREFIX}NoTipeGuiInit
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.s'
  Pop $NoTipeDpi
  ${IfThen} $NoTipeDpi = 0 ${|} StrCpy $NoTipeDpi 96 ${|}
  CreateFont $NoTipeBodyFont "Segoe UI" 10
  CreateFont $NoTipeSmallFont "Segoe UI" 9
  CreateFont $NoTipeBrandFont "Segoe UI" 16 600
  CreateFont $NoTipeTitleFont "Segoe UI" 23 600

  ; Keep the window centered on the monitor chosen by NSIS.
  IntOp $3 640 * $NoTipeDpi
  IntOp $3 $3 / 96
  IntOp $4 440 * $NoTipeDpi
  IntOp $4 $4 / 96
  System::Call '* (i0, i0, i r3, i r4) p.r0'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i.r1'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i.r2'
  System::Call 'user32::AdjustWindowRectExForDpi(p r0, i r1, i0, i r2, i $NoTipeDpi)'
  System::Call '*$0(i.r1, i.r2, i.r3, i.r4)'
  IntOp $3 $3 - $1
  IntOp $4 $4 - $2
  System::Free $0
  System::Call '* (i, i, i, i) p.r0'
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r0)'
  System::Call '*$0(i.r1, i.r2, i.r5, i.r6)'
  System::Free $0
  IntOp $1 $1 + $5
  IntOp $1 $1 - $3
  IntOp $1 $1 / 2
  IntOp $2 $2 + $6
  IntOp $2 $2 - $4
  IntOp $2 $2 / 2
  System::Call 'user32::MoveWindow(p $HWNDPARENT, i r1, i r2, i r3, i r4, i1)'

  ; Hide MUI's stock banner, divider and branding text.
  !insertmacro NT_HIDE 1037
  !insertmacro NT_HIDE 1038
  !insertmacro NT_HIDE 1046
  !insertmacro NT_HIDE 1034
  !insertmacro NT_HIDE 1039
  !insertmacro NT_HIDE 1035
  !insertmacro NT_HIDE 1036
  !insertmacro NT_HIDE 1045
  !insertmacro NT_HIDE 1256
  !insertmacro NT_HIDE 1028
  !insertmacro NT_HIDE -1
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1
  !insertmacro NT_MOVE $0 420 384 180 40
  SendMessage $0 ${WM_SETFONT} $NoTipeBodyFont 1
  GetDlgItem $0 $HWNDPARENT 2
  !insertmacro NT_MOVE $0 296 384 112 40
  SendMessage $0 ${WM_SETFONT} $NoTipeBodyFont 1

  InitPluginsDir
  File /oname=$PLUGINSDIR\no-tipe.ico "${INSTALLERICON}"
  !if "${LICENSE}" != ""
    File /oname=$PLUGINSDIR\LICENSE.txt "${LICENSE}"
  !endif
  IntOp $0 48 * $NoTipeDpi
  IntOp $0 $0 / 96
  System::Call 'user32::LoadImageW(p0, w "$PLUGINSDIR\no-tipe.ico", i1, i r0, i r0, i0x10) p.s'
  Pop $NoTipeIcon
  System::Call 'user32::CreateWindowExW(i0, w "STATIC", w "", i0x50000003, i0, i0, i0, i0, p $HWNDPARENT, p0, p0, p0) p.s'
  Pop $0
  !insertmacro NT_MOVE $0 40 36 48 48
  SendMessage $0 ${STM_SETICON} $NoTipeIcon 0
  !insertmacro NT_LABEL $HWNDPARENT "${PRODUCTNAME}" $NoTipeBrandFont 102 34 420 32 $0
  !insertmacro NT_LABEL $HWNDPARENT "${VERSION} · Windows" $NoTipeSmallFont 103 67 400 22 $0
  no_tipe_ui::Muted /NOUNLOAD "$0"
  no_tipe_ui::Theme /NOUNLOAD "$HWNDPARENT"
FunctionEnd

Function ${PREFIX}NoTipeLayout
  !insertmacro NT_MOVE $NoTipeDialog 40 124 560 244
  ; MUI may show its header and separator again when changing pages.
  !insertmacro NT_HIDE 1034
  !insertmacro NT_HIDE 1039
  !insertmacro NT_HIDE 1035
  !insertmacro NT_HIDE 1036
  !insertmacro NT_HIDE 1045
  !insertmacro NT_HIDE 1037
  !insertmacro NT_HIDE 1038
  !insertmacro NT_HIDE 1046
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  no_tipe_ui::Theme /NOUNLOAD "$NoTipeDialog"
FunctionEnd

Function ${PREFIX}NoTipeGuiEnd
  System::Call 'user32::DestroyIcon(p $NoTipeIcon)'
  System::Call 'gdi32::DeleteObject(p $NoTipeBodyFont)'
  System::Call 'gdi32::DeleteObject(p $NoTipeSmallFont)'
  System::Call 'gdi32::DeleteObject(p $NoTipeBrandFont)'
  System::Call 'gdi32::DeleteObject(p $NoTipeTitleFont)'
FunctionEnd
!macroend

!macro NT_HIDE ID
  GetDlgItem $0 $HWNDPARENT ${ID}
  ShowWindow $0 ${SW_HIDE}
!macroend

!insertmacro NT_GUI ""
!insertmacro NT_GUI "un."

Function .onGUIEnd
  Call NoTipeGuiEnd
FunctionEnd
Function un.onGUIEnd
  Call un.NoTipeGuiEnd
FunctionEnd

Function NoTipeWelcome
  Call SkipIfPassive
  nsDialogs::Create 1018
  Pop $NoTipeDialog
  ${IfThen} $NoTipeDialog == error ${|} Abort ${|}
  Call NoTipeLayout
  !insertmacro NT_LABEL $NoTipeDialog "$(ntWelcome)" $NoTipeTitleFont 0 0 560 46 $NoTipeHeading
  !insertmacro NT_LABEL $NoTipeDialog "$(ntDescription)" $NoTipeBodyFont 0 55 560 52 $0
  no_tipe_ui::Muted /NOUNLOAD "$0"
  !insertmacro NT_LABEL $NoTipeDialog "$(ntFolder)" $NoTipeSmallFont 0 124 420 20 $0
  no_tipe_ui::Muted /NOUNLOAD "$0"
  !insertmacro NT_LABEL $NoTipeDialog "$INSTDIR" $NoTipeSmallFont 0 152 422 28 $NoTipePath
  ${NSD_AddStyle} $NoTipePath 0x8000 ; SS_PATHELLIPSIS
  ${NSD_CreateButton} 0 0 100% 24u "$(ntChange)"
  Pop $1
  !insertmacro NT_MOVE $1 436 145 124 36
  SendMessage $1 ${WM_SETFONT} $NoTipeSmallFont 1
  ${NSD_OnClick} $1 NoTipeChangeFolder
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ntInstall)"
  ReadRegStr $2 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${If} $2 != ""
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ntUpdate)"
    EnableWindow $1 0 ; An update retains the existing install location.
  ${EndIf}
  !if "${LICENSE}" != ""
    ${NSD_CreateLink} 0 0 100% 14u "$(ntLicense)"
    Pop $0
    !insertmacro NT_MOVE $0 0 216 240 22
    SendMessage $0 ${WM_SETFONT} $NoTipeSmallFont 1
    ${NSD_OnClick} $0 NoTipeShowLicense
    no_tipe_ui::Muted /NOUNLOAD "$0"
  !endif
  no_tipe_ui::Theme /NOUNLOAD "$NoTipeDialog"
  nsDialogs::Show
FunctionEnd

Function NoTipeWelcomeLeave
  GetInstDirError $0
  ${If} $0 <> 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(ntFolderError)"
    Abort
  ${EndIf}
FunctionEnd

Function NoTipeChangeFolder
  Pop $0
  nsDialogs::SelectFolderDialog "$(ntFolder)" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    StrCpy $INSTDIR $0
    SendMessage $NoTipePath ${WM_SETTEXT} 0 "STR:$INSTDIR"
  ${EndIf}
FunctionEnd

Function NoTipeShowLicense
  Pop $0
  ExecShell "open" "$PLUGINSDIR\LICENSE.txt"
FunctionEnd

Function NoTipeMaintenanceShow
  StrCpy $NoTipeDialog $R4
  Call NoTipeLayout
FunctionEnd

Function NoTipeProgressShow
  StrCpy $NoTipeDialog $mui.InstFilesPage
  Call NoTipeLayout
  !insertmacro NT_LABEL $NoTipeDialog "$(ntInstalling)" $NoTipeTitleFont 0 0 560 46 $NoTipeHeading
  !insertmacro NT_LABEL $NoTipeDialog "$(ntInstallingDescription)" $NoTipeBodyFont 0 55 560 52 $0
  no_tipe_ui::Muted /NOUNLOAD "$0"
  ShowWindow $mui.InstFilesPage.Text ${SW_HIDE}
  !insertmacro NT_LABEL $NoTipeDialog "$(ntRuntime)" $NoTipeSmallFont 0 125 560 24 $NoTipeStatus
  no_tipe_ui::Muted /NOUNLOAD "$NoTipeStatus"
  !insertmacro NT_MOVE $mui.InstFilesPage.ProgressBar 0 161 560 8
  !insertmacro NT_MOVE $mui.InstFilesPage.ShowLogButton 0 196 124 32
  SendMessage $mui.InstFilesPage.ShowLogButton ${WM_SETTEXT} 0 "STR:$(ntDetails)"
  !insertmacro NT_MOVE $mui.InstFilesPage.Log 144 188 416 54
  no_tipe_ui::Theme /NOUNLOAD "$NoTipeDialog"
FunctionEnd

Function NoTipeRuntimeStatus
  ${IfThen} $NoTipeStatus != 0 ${|} SendMessage $NoTipeStatus ${WM_SETTEXT} 0 "STR:$(ntRuntime)" ${|}
FunctionEnd
Function NoTipeCopyStatus
  ${IfThen} $NoTipeStatus != 0 ${|} SendMessage $NoTipeStatus ${WM_SETTEXT} 0 "STR:$(ntCopy)" ${|}
FunctionEnd

Function NoTipeFinish
  Call SkipIfPassive
  nsDialogs::Create 1018
  Pop $NoTipeDialog
  ${IfThen} $NoTipeDialog == error ${|} Abort ${|}
  Call NoTipeLayout
  StrCpy $NoTipeFinished 1
  StrCpy $NoTipeLaunch 1
  !insertmacro NT_LABEL $NoTipeDialog "$(ntDone)" $NoTipeTitleFont 0 0 560 46 $NoTipeHeading
  !insertmacro NT_LABEL $NoTipeDialog "$(ntDoneDescription)" $NoTipeBodyFont 0 55 560 52 $0
  no_tipe_ui::Muted /NOUNLOAD "$0"
  ${NSD_CreateCheckbox} 0 0 100% 20u "$(ntDesktop)"
  Pop $NoTipePath
  !insertmacro NT_MOVE $NoTipePath 0 138 560 28
  SendMessage $NoTipePath ${WM_SETFONT} $NoTipeBodyFont 1
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ntClose)"
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ntOpen)"
  no_tipe_ui::Theme /NOUNLOAD "$NoTipeDialog"
  nsDialogs::Show
FunctionEnd

Function NoTipeAbort
  ${If} $NoTipeFinished = 1
    StrCpy $NoTipeLaunch 0
    Call NoTipeFinishLeave
    SetErrorLevel 0
    ; Return normally so NSIS notifies nsDialogs to destroy the custom page.
    ; Quit here makes the callback return an abort flag before that notification.
  ${EndIf}
FunctionEnd

Function NoTipeFinishLeave
  ${NSD_GetState} $NoTipePath $0
  ${IfThen} $0 = ${BST_CHECKED} ${|} Call CreateOrUpdateDesktopShortcut ${|}
  ${IfThen} $NoTipeLaunch = 1 ${|} Call RunMainBinary ${|}
FunctionEnd

Function un.NoTipeConfirmTheme
  FindWindow $NoTipeDialog "#32770" "" $HWNDPARENT
  Call un.NoTipeLayout
FunctionEnd

Function un.NoTipeProgressShow
  StrCpy $NoTipeDialog $mui.InstFilesPage
  Call un.NoTipeLayout
  !insertmacro NT_LABEL $NoTipeDialog "$(ntRemoving)" $NoTipeTitleFont 0 0 560 46 $NoTipeHeading
  !insertmacro NT_LABEL $NoTipeDialog "$(ntRemovingDescription)" $NoTipeBodyFont 0 55 560 52 $0
  no_tipe_ui::Muted /NOUNLOAD "$0"
  ShowWindow $mui.InstFilesPage.Text ${SW_HIDE}
  !insertmacro NT_MOVE $mui.InstFilesPage.ProgressBar 0 161 560 8
  !insertmacro NT_MOVE $mui.InstFilesPage.ShowLogButton 0 196 124 32
  SendMessage $mui.InstFilesPage.ShowLogButton ${WM_SETTEXT} 0 "STR:$(ntDetails)"
  !insertmacro NT_MOVE $mui.InstFilesPage.Log 144 188 416 54
  no_tipe_ui::Theme /NOUNLOAD "$NoTipeDialog"
FunctionEnd
