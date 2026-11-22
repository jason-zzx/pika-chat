!ifdef BUILD_UNINSTALLER
  !macro customUnWelcomePage
    Var unDeleteUserData
    Var unWelcomeDialog
    Var unDeleteUserDataCheckbox

    UninstPage custom un.CustomWelcomeCreate un.CustomWelcomeLeave

    Function un.CustomWelcomeCreate
      StrCpy $unDeleteUserData "0"

      ${If} ${isUpdated}
        Abort
      ${EndIf}

      ${If} $LANGUAGE == 2052
        !insertmacro MUI_HEADER_TEXT "卸载 ${PRODUCT_NAME}" "从你的电脑移除 ${PRODUCT_NAME}"
        StrCpy $1 "即将卸载 ${PRODUCT_NAME}。请选择卸载后的数据处理方式："
        StrCpy $2 "同时删除个人配置与本地聊天数据（%AppData%\${PRODUCT_FILENAME}）"
        StrCpy $3 "提示：更新安装包缓存会自动清理；若你计划重新安装或改用便携版，建议保留个人数据。"
      ${Else}
        !insertmacro MUI_HEADER_TEXT "Uninstall ${PRODUCT_NAME}" "Remove ${PRODUCT_NAME} from your computer"
        StrCpy $1 "${PRODUCT_NAME} will be uninstalled. Choose how to handle your local data:"
        StrCpy $2 "Also delete personal settings and local chat data (%AppData%\${PRODUCT_FILENAME})"
        StrCpy $3 "Note: updater cache is removed automatically. Leave this unchecked if you plan to reinstall or switch to the portable zip."
      ${EndIf}

      nsDialogs::Create 1018
      Pop $unWelcomeDialog
      ${If} $unWelcomeDialog == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0u 0u 100% 24u "$1"
      Pop $0

      ${NSD_CreateCheckbox} 0u 34u 100% 24u "$2"
      Pop $unDeleteUserDataCheckbox
      ${NSD_SetState} $unDeleteUserDataCheckbox ${BST_UNCHECKED}

      ${NSD_CreateLabel} 0u 64u 100% 30u "$3"
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function un.CustomWelcomeLeave
      ${NSD_GetState} $unDeleteUserDataCheckbox $unDeleteUserData
    FunctionEnd
  !macroend

  !macro customUnInstall
    ${ifNot} ${isUpdated}
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
      ${if} $unDeleteUserData == ${BST_CHECKED}
        RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
        !ifdef APP_PRODUCT_FILENAME
          RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
        !endif
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      ${endif}
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endif}
  !macroend
!endif
