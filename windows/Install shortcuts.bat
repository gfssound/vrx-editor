@echo off
rem VRX Editor: add Start menu and desktop shortcuts for this folder's "VRX Editor.exe".
rem Optional: you can also just double-click "VRX Editor.exe". Run this again after moving the folder.
setlocal
set "APPDIR=%~dp0VRX Editor"
if not exist "%APPDIR%\VRX Editor.exe" (
  echo Couldn't find "VRX Editor.exe" next to this file. Unzip the whole download first.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {" ^
  "  $l = $s.CreateShortcut((Join-Path $dir 'VRX Editor.lnk'));" ^
  "  $l.TargetPath = '%APPDIR%\VRX Editor.exe'; $l.WorkingDirectory = '%APPDIR%';" ^
  "  $l.IconLocation = '%APPDIR%\vrx-editor.ico'; $l.Description = 'VRX Editor'; $l.Save() }"
if errorlevel 1 (
  echo Couldn't create the shortcuts. You can still double-click "VRX Editor.exe".
) else (
  echo Done: VRX Editor is in the Start menu and on the desktop.
)
pause
