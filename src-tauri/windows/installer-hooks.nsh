; Installerhaken voor de NSIS-installer (bundle > windows > nsis > installerHooks).
;
; WAAROM. Tot en met 2026.39.0 heette het programmabestand open-fem2d-studio.exe
; (naar het Cargo-pakket). Nu heet het open-fem-studio.exe. De installatiemap
; blijft dezelfde (%LOCALAPPDATA%\Open FEM Studio): die volgt de productnaam,
; net als de registersleutels waaraan de installer een eerdere installatie
; herkent.
;
; WAT DE TAURI-INSTALLER ZELF AL DOET (CLI 2.11, sjabloon installer.nsi):
;  - Herinstallatiepagina, keuze "eerst verwijderen" (de standaard): de OUDE
;    uninstaller draait en haalt open-fem2d-studio.exe en de snelkoppelingen
;    die ernaar wijzen weg.
;  - Keuze "niet verwijderen", en ook een passieve of stille installatie
;    (/P, /S): de nieuwe installer leest de vorige naam uit het register
;    (waarde MainBinaryName onder de uninstall-sleutel), verwijdert dat
;    bestand en zet de startmenusnelkoppeling om naar het nieuwe bestand.
;
; WAT ER DAN NOG MIS KAN GAAN, EN WAT DEZE HAKEN DOEN:
;  1. Het oude programma draait nog. De installer controleert alleen of
;     open-fem-studio.exe draait; open-fem2d-studio.exe valt erbuiten, en een
;     draaiend bestand kan niet worden verwijderd. PREINSTALL vraagt daarom
;     ook het oude programma te sluiten, met dezelfde melding.
;  2. Het oude bestand blijft staan (het register noemde het niet, of
;     verwijderen mislukte). POSTINSTALL haalt het alsnog weg.
;  3. Een dode snelkoppeling. De bureaubladsnelkoppeling zet de installer
;     alleen om als het vinkje "snelkoppeling op het bureaublad" op de
;     laatste pagina aan staat, en een op de taakbalk vastgemaakte
;     snelkoppeling nooit. POSTINSTALL zet elke snelkoppeling van het product
;     die nog naar open-fem2d-studio.exe wijst om naar het nieuwe bestand:
;     bureaublad, startmenu en taakbalk.
;
; DE IDENTIFIER (vanaf de uitgave na 2026.39.1): org.openaec.fem2d-studio werd
; org.openaec.fem-studio. De installer geeft elke snelkoppeling die hij maakt
; de identifier als AppUserModelID mee, maar een snelkoppeling die hij alleen
; omzet of laat staan houdt de oude. POSTINSTALL zet die daarom op elke
; snelkoppeling van het product die naar het programma wijst, zodat de
; taakbalk vastgemaakte en gestarte vensters onder één knop houdt. De
; app-datamappen zelf neemt de app bij de eerste start over (kopie, zie
; src-tauri/crates/appdata-migratie). Kiest de gebruiker bij het verwijderen
; "ook de app-gegevens verwijderen", dan gaan in POSTUNINSTALL ook de mappen
; onder de oude identifier weg; het sjabloon kent alleen de nieuwe.
;
; Deze macro's worden binnen de secties van installer.nsi ingevoegd; de
; variabelen ($PassiveMode, $UpdateMode, $AppStartMenuFolder,
; $DeleteAppDataCheckboxState) en macro's (IsShortcutTarget,
; SetShortcutTarget, SetLnkAppUserModelId) komen uit dat sjabloon en zijn
; daar dan bekend.

!define OPENFEM_OUDE_BINARY "open-fem2d-studio.exe"
!define OPENFEM_OUDE_IDENTIFIER "org.openaec.fem2d-studio"

; Wijst de snelkoppeling `lnk` naar het oude programmabestand, dan wijst hij
; daarna naar het nieuwe. Wijst hij (dan) naar het programma, dan krijgt hij
; de huidige identifier als AppUserModelID. Gebruikt $0-$5 (via de macro's
; van het sjabloon).
!macro OpenFemZetSnelkoppelingOm lnk
  ${If} ${FileExists} "${lnk}"
    !insertmacro IsShortcutTarget "${lnk}" "$INSTDIR\${OPENFEM_OUDE_BINARY}"
    Pop $0
    ${If} $0 = 1
      !insertmacro SetShortcutTarget "${lnk}" "$INSTDIR\${MAINBINARYNAME}.exe"
      DetailPrint "Snelkoppeling omgezet naar ${MAINBINARYNAME}.exe: ${lnk}"
    ${EndIf}
    !insertmacro IsShortcutTarget "${lnk}" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro SetLnkAppUserModelId "${lnk}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; 1. Draait het oude programma nog? Zelfde gedrag als de controle van het
  ;    sjabloon voor het nieuwe: vragen (behalve passief/stil), dan stoppen.
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${OPENFEM_OUDE_BINARY}"
  !else
    nsis_tauri_utils::FindProcess "${OPENFEM_OUDE_BINARY}"
  !endif
  Pop $R0
  ${If} $R0 = 0
    nsis_tauri_utils::StrReplace "$(appRunningOkKill)" "{{product_name}}" "${PRODUCTNAME}"
    Pop $R2
    ${If} ${Silent}
    ${OrIf} $PassiveMode = 1
      StrCpy $R3 1
    ${ElseIf} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$R2" IDOK`
      StrCpy $R3 1
    ${Else}
      StrCpy $R3 0
    ${EndIf}
    ${If} $R3 = 1
      !if "${INSTALLMODE}" == "currentUser"
        nsis_tauri_utils::KillProcessCurrentUser "${OPENFEM_OUDE_BINARY}"
      !else
        nsis_tauri_utils::KillProcess "${OPENFEM_OUDE_BINARY}"
      !endif
      Pop $R0
      Sleep 500
      ${If} $R0 <> 0
      ${AndIf} $R0 <> 2
        nsis_tauri_utils::StrReplace "$(failedToKillApp)" "{{product_name}}" "${PRODUCTNAME}"
        Pop $R3
        Abort $R3
      ${EndIf}
    ${Else}
      nsis_tauri_utils::StrReplace "$(appRunning)" "{{product_name}}" "${PRODUCTNAME}"
      Pop $R3
      Abort $R3
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 2. Het oude programmabestand alsnog weghalen.
  ${If} ${FileExists} "$INSTDIR\${OPENFEM_OUDE_BINARY}"
    Delete "$INSTDIR\${OPENFEM_OUDE_BINARY}"
    DetailPrint "Oud programmabestand verwijderd: $INSTDIR\${OPENFEM_OUDE_BINARY}"
  ${EndIf}

  ; 3. Snelkoppelingen die nog naar het oude bestand wijzen omzetten.
  !insertmacro OpenFemZetSnelkoppelingOm "$DESKTOP\${PRODUCTNAME}.lnk"
  !insertmacro OpenFemZetSnelkoppelingOm "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !if "${STARTMENUFOLDER}" != ""
    !insertmacro OpenFemZetSnelkoppelingOm "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !endif
  !insertmacro OpenFemZetSnelkoppelingOm "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Een oud programmabestand dat er om welke reden ook nog staat, houdt anders
  ; de installatiemap in stand.
  Delete "$INSTDIR\${OPENFEM_OUDE_BINARY}"
  RMDir "$INSTDIR"

  ; "Ook de app-gegevens verwijderen": dan ook die onder de oude identifier
  ; (dezelfde voorwaarden als het sjabloon voor de mappen van de nieuwe).
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\${OPENFEM_OUDE_IDENTIFIER}"
    RmDir /r "$LOCALAPPDATA\${OPENFEM_OUDE_IDENTIFIER}"
  ${EndIf}
!macroend
