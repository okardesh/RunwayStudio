Unicode true
SetCompressor /SOLID zlib

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!include "MUI2.nsh"

!ifndef ARCH
  !error "ARCH must be supplied, for example /DARCH=arm64"
!endif

!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR must be supplied"
!endif

Name "Runway"
Icon "icon.ico"
UninstallIcon "icon.ico"
OutFile "..\release\Runway Installer for Windows (${ARCH}).exe"
InstallDir "$LOCALAPPDATA\Programs\Runway"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section /o "Runway Studio" SEC_STUDIO
  SetOutPath "$INSTDIR\Studio"
  File /r "..\release\${PAYLOAD_DIR}\*.*"
  CreateDirectory "$SMPROGRAMS\Runway"
  CreateShortCut "$SMPROGRAMS\Runway\Runway Studio.lnk" "$INSTDIR\Studio\Runway Studio.exe"
  WriteUninstaller "$INSTDIR\Uninstall Runway.exe"
SectionEnd

Section /o "Runway Robot" SEC_ROBOT
  SetOutPath "$INSTDIR\Robot"
  File /r "..\Robot\release\${PAYLOAD_DIR}\*.*"
  CreateDirectory "$SMPROGRAMS\Runway"
  CreateShortCut "$SMPROGRAMS\Runway\Runway Robot.lnk" "$INSTDIR\Robot\Runway Robot.exe"
  WriteUninstaller "$INSTDIR\Uninstall Runway.exe"
SectionEnd

Section -RegisterUninstaller
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Runway" "DisplayName" "Runway"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Runway" "UninstallString" '"$INSTDIR\Uninstall Runway.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Runway" "DisplayIcon" "$INSTDIR\Studio\Runway Studio.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Runway" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Runway" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Runway\Runway Studio.lnk"
  Delete "$SMPROGRAMS\Runway\Runway Robot.lnk"
  RMDir "$SMPROGRAMS\Runway"
  RMDir /r "$INSTDIR\Studio"
  RMDir /r "$INSTDIR\Robot"
  Delete "$INSTDIR\Uninstall Runway.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Runway"
SectionEnd