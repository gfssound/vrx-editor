#!/bin/bash
# Build the Linux AppImage: out/VRX-Editor-<version>-x86_64.AppImage (like Nova Relay's).
# One file with the editor and its own Electron inside: download, make it executable, run. Updating = replacing
# the file. Needs a Linux PC with internet (GitHub's release workflow runs it on Ubuntu).
#   tools/build_appimage.sh            x86_64 (most Linux PCs and laptops)
#   tools/build_appimage.sh aarch64    64-bit ARM
# Electron comes from its official GitHub releases and is checked against the published checksums; downloads are
# kept in dl/ so later builds don't fetch them again. The AppImage runtime is AppImage's static type2-runtime,
# so the computer doesn't need libfuse2 installed.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
V="$(node -p "require('./app/package.json').version")"
EV="33.2.1"
ARCH="${1:-x86_64}"
case "$ARCH" in x86_64) EA=x64 ;; aarch64) EA=arm64 ;; *) echo "Unknown arch $ARCH (x86_64 or aarch64)"; exit 1 ;; esac
DL="$ROOT/dl"; mkdir -p "$DL"
EB="https://github.com/electron/electron/releases/download/v$EV"
ZIP="electron-v$EV-linux-$EA.zip"
[ -f "$DL/SHASUMS256-$EV.txt" ] || curl -fsSL "$EB/SHASUMS256.txt" -o "$DL/SHASUMS256-$EV.txt"
[ -f "$DL/$ZIP" ] || curl -fsSL "$EB/$ZIP" -o "$DL/$ZIP"
want="$(grep " \*\?$ZIP\$" "$DL/SHASUMS256-$EV.txt" | cut -d' ' -f1)"; got="$(sha256sum "$DL/$ZIP" | cut -d' ' -f1)"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "$ZIP doesn't match Electron's checksum"; rm -f "$DL/$ZIP"; exit 1; }
[ -f "$DL/runtime-$ARCH" ] || curl -fsSL "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$ARCH" -o "$DL/runtime-$ARCH"
TOOL="$ROOT/dl/appimagetool/squashfs-root/AppRun"
if [ ! -x "$TOOL" ]; then
  [ -f "$DL/appimagetool-x86_64.AppImage" ] || curl -fsSL https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage -o "$DL/appimagetool-x86_64.AppImage"
  chmod +x "$DL/appimagetool-x86_64.AppImage"; mkdir -p "$DL/appimagetool"; (cd "$DL/appimagetool" && "$DL/appimagetool-x86_64.AppImage" --appimage-extract >/dev/null)
fi

AD="$ROOT/pkg/VRX-Editor-$ARCH.AppDir"
rm -rf "$AD"; mkdir -p "$AD/usr/lib"
unzip -q "$DL/$ZIP" -d "$AD/usr/lib/vrx-editor"
rm -f "$AD/usr/lib/vrx-editor/resources/default_app.asar"
APP="$AD/usr/lib/vrx-editor/resources/app"; mkdir -p "$APP/server"
cp desktop/main.js "$APP/"
printf '{\n  "name": "vrx-editor-desktop",\n  "productName": "VRX Editor",\n  "version": "%s",\n  "main": "main.js"\n}\n' "$V" > "$APP/package.json"
cp -R app/. "$APP/server/"
python3 -c "from PIL import Image; im = Image.open('mac/icon-1024.png'); im.resize((512,512), Image.LANCZOS).save('$APP/icon.png'); im.resize((256,256), Image.LANCZOS).save('$AD/vrx-editor.png')"
ln -s vrx-editor.png "$AD/.DirIcon"
cat > "$AD/vrx-editor.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=VRX Editor
Comment=Edit Zaxcom VRX receivers over USB
Exec=vrx-editor
Icon=vrx-editor
Terminal=false
Categories=AudioVideo;Audio;
StartupWMClass=VRX Editor
X-AppImage-Version=$V
DESK
cat > "$AD/AppRun" <<'RUN'
#!/bin/bash
# VRX Editor AppImage. Settings, presets and app.log live in ~/.config/vrx-editor.
#   --setup-usb      once: lets you use a VRX's USB port (udev rule; asks for your password)
#   --install-menu   add VRX Editor to the applications menu (points at this AppImage file)
#   --remove-menu    take it out again
#   --simulate [n]   try it with simulated VRX units;  --serial /dev/ttyACM0;  --any-usb
HERE="$(dirname "$(readlink -f "$0")")"
SELF="${APPIMAGE:-$HERE/AppRun}"
ENTRY="$HOME/.local/share/applications/vrx-editor-appimage.desktop"
ICON="$HOME/.local/share/icons/hicolor/256x256/apps/vrx-editor-appimage.png"
RULE="${VRX_UDEV_RULE:-/etc/udev/rules.d/60-zaxcom-vrx.rules}"
say() {
  echo "VRX Editor: $*" >&2
  if [ ! -t 2 ]; then
    if command -v zenity >/dev/null 2>&1; then zenity --info --title "VRX Editor" --text "$*" 2>/dev/null
    elif command -v notify-send >/dev/null 2>&1; then notify-send "VRX Editor" "$*"; fi
  fi
}
write_entry() {
  mkdir -p "$(dirname "$ENTRY")" "$(dirname "$ICON")"
  cp "$HERE/vrx-editor.png" "$ICON"
  sed -e "s|^Exec=.*|Exec=\"$SELF\"|" -e "s|^Icon=.*|Icon=vrx-editor-appimage|" "$HERE/vrx-editor.desktop" > "$ENTRY"
  command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$ENTRY")" 2>/dev/null || true
}
case "${1:-}" in
  --setup-usb)
    RULES='# Added by VRX Editor: anyone logged in may use a Zaxcom VRX USB port, and ModemManager leaves it alone.
SUBSYSTEM=="tty", ATTRS{manufacturer}=="Zaxcom*", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"
SUBSYSTEM=="tty", ATTRS{product}=="*VRX*", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"'
    CMD="printf '%s\n' \"\$0\" > $RULE && udevadm control --reload-rules && udevadm trigger --subsystem-match=tty"
    if [ -t 0 ]; then echo "Adding $RULE (sudo asks for your password)."; sudo sh -c "$CMD" "$RULES"
    elif command -v pkexec >/dev/null 2>&1; then pkexec sh -c "$CMD" "$RULES"
    else say "Run this from a terminal: $SELF --setup-usb"; exit 1; fi
    rc=$?; [ $rc = 0 ] && say "USB access for VRX set up. Unplug and replug the VRX." || say "USB setup did not finish."
    exit $rc ;;
  --install-menu|--add-to-menu) write_entry; say "VRX Editor added to the applications menu (it opens $SELF)."; exit 0 ;;
  --remove-menu) rm -f "$ENTRY" "$ICON"; say "VRX Editor removed from the applications menu. Settings stay in ~/.config/vrx-editor."; exit 0 ;;
esac
# A menu entry made earlier follows this file, so after an update it opens the new AppImage.
if [ -f "$ENTRY" ] && [ -n "${APPIMAGE:-}" ] && ! grep -qF "Exec=\"$SELF\"" "$ENTRY"; then write_entry; fi
# --no-sandbox: Chromium's sandbox helper needs root setup an AppImage can't have; the window only ever loads
# the editor from this computer.
exec "$HERE/usr/lib/vrx-editor/electron" --no-sandbox "$@"
RUN
chmod +x "$AD/AppRun"

mkdir -p "$ROOT/out"; OUT="$ROOT/out/VRX-Editor-$V-$ARCH.AppImage"; rm -f "$OUT"
ARCH="$ARCH" "$TOOL" --no-appstream --runtime-file "$DL/runtime-$ARCH" "$AD" "$OUT" >/dev/null 2>"$ROOT/pkg/appimagetool-$ARCH.log" || { cat "$ROOT/pkg/appimagetool-$ARCH.log"; exit 1; }
chmod +x "$OUT"
echo "$(basename "$OUT")  $(du -h "$OUT" | cut -f1)"
