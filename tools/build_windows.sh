#!/bin/bash
# Build the Windows app: out/VRX-Editor-<version>-Windows.zip, a "VRX Editor" folder that runs as it is
# (VRX Editor.exe, with its own Electron and the serialport library inside; nothing to install).
# Runs on Linux or a Mac with internet (GitHub's release workflow runs it on Ubuntu). Downloads are checked
# against the published checksums and kept in dl/ so later builds don't fetch them again.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
V="$(node -p "require('./app/package.json').version")"
EV="33.2.1"                 # Electron (same as Nova Relay)
SERIALPORT="12.0.0"         # serialport package; its Windows part is a ready-made (prebuilt) library
DL="$ROOT/dl"; mkdir -p "$DL"
EB="https://github.com/electron/electron/releases/download/v$EV"
ZIP="electron-v$EV-win32-x64.zip"
[ -f "$DL/SHASUMS256-$EV.txt" ] || curl -fsSL "$EB/SHASUMS256.txt" -o "$DL/SHASUMS256-$EV.txt"
[ -f "$DL/$ZIP" ] || curl -fsSL "$EB/$ZIP" -o "$DL/$ZIP"
want="$(grep " \*\?$ZIP\$" "$DL/SHASUMS256-$EV.txt" | cut -d' ' -f1)"; got="$(sha256sum "$DL/$ZIP" | cut -d' ' -f1)"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "$ZIP doesn't match Electron's checksum"; rm -f "$DL/$ZIP"; exit 1; }

OUT="$ROOT/pkg/VRX-Editor-$V-Windows"
APP="$OUT/VRX Editor"
rm -rf "$OUT"; mkdir -p "$APP"
unzip -q "$DL/$ZIP" -d "$APP"
mv "$APP/electron.exe" "$APP/VRX Editor.exe"
rm -f "$APP/resources/default_app.asar" "$APP/LICENSES.chromium.html"
RES="$APP/resources/app"; mkdir -p "$RES/server"
cp desktop/main.js "$RES/"
printf '{\n  "name": "vrx-editor-desktop",\n  "productName": "VRX Editor",\n  "version": "%s",\n  "main": "main.js"\n}\n' "$V" > "$RES/package.json"
python3 -c "from PIL import Image; Image.open('mac/icon-1024.png').resize((512,512), Image.LANCZOS).save('$RES/icon.png')"
cp -R app/. "$RES/server/"

# The serialport package, Windows x64 only (the npm package carries ready-made libraries for every system).
(cd "$RES/server" && npm install --no-save --omit=dev --no-audit --no-fund --ignore-scripts --loglevel=error "serialport@$SERIALPORT" >/dev/null)
B="$RES/server/node_modules/@serialport/bindings-cpp"
[ -f "$B/prebuilds/win32-x64/@serialport+bindings-cpp.node" ] || [ -n "$(ls "$B"/prebuilds/win32-x64/*.node 2>/dev/null)" ] || { echo "serialport has no ready-made Windows x64 library"; exit 1; }
find "$B/prebuilds" -mindepth 1 -maxdepth 1 -type d ! -name win32-x64 -exec rm -rf {} +
rm -rf "$B/src" "$B/build" "$RES/server/package-lock.json"
(cd "$RES/server" && node -e "require.resolve('serialport')") || { echo "serialport didn't install"; exit 1; }

python3 -c "from PIL import Image; Image.open('mac/icon-1024.png').save('$APP/vrx-editor.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
cp "windows/Install shortcuts.bat" "windows/READ ME FIRST.txt" "$OUT/"
sed -i "s/@VERSION@/$V/g" "$OUT/READ ME FIRST.txt"
sed -i 's/$/\r/' "$OUT/Install shortcuts.bat" "$OUT/READ ME FIRST.txt"   # Windows line endings
mkdir -p "$ROOT/out"
(cd "$ROOT/pkg" && rm -f "$ROOT/out/VRX-Editor-$V-Windows.zip" && zip -qrX -9 "$ROOT/out/VRX-Editor-$V-Windows.zip" "VRX-Editor-$V-Windows")
ls -la "$ROOT/out/VRX-Editor-$V-Windows.zip" | awk '{print $5, $9}'
