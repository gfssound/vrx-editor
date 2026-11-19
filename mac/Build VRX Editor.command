#!/bin/bash
# Builds "VRX Editor.app" and a .dmg on a Mac. Needs the macOS tools that come with every Mac (osacompile, sips,
# iconutil, plutil, codesign, hdiutil). Node.js goes inside the app: the official one from nodejs.org (checked
# against its published checksums), or, with no internet, the Node.js 18+ already on this Mac.
#   VRX_MAC_ARCH=arm64 | x64   build for one kind of Mac only: VRX-Editor-<v>-AppleSilicon.dmg / -Intel.dmg
#                              (about half the size; GitHub's release workflow makes both). Default: both kinds.
#   VRX_BUILD_QUIET=1          no prompts and no Finder window (GitHub's Mac build machine).
# Works from the repository (mac/ next to app/) or from an unzipped package (this file next to app/ and mac/).
set -u
cd "$(dirname "$0")" || exit 1
if [ -f app/package.json ]; then ROOT="$PWD"; MAC="$PWD/mac"; else ROOT="$(cd .. && pwd)"; MAC="$PWD"; fi
cd "$ROOT" || exit 1
NODE_VERSION="v22.11.0"            # Node.js LTS inside the app. Change here to update.
STEP=""
step() { STEP="$*"; echo; echo "== $*"; }
fail() { echo; echo "FAILED while: $STEP"; [ -n "${1:-}" ] && echo "$1"; echo; [ "${VRX_BUILD_QUIET:-}" = 1 ] || read -r -p "Press Return to close this window." _; exit 1; }
printf '\033]0;Build VRX Editor\007'

VER=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' app/package.json | head -1)
[ -n "$VER" ] || { STEP="reading the version"; fail "app/package.json is missing."; }
case "${VRX_MAC_ARCH:-both}" in
  arm64) ARCHS="arm64"; DMGNAME="VRX-Editor-$VER-AppleSilicon.dmg" ;;
  x64) ARCHS="x64"; DMGNAME="VRX-Editor-$VER-Intel.dmg" ;;
  *) ARCHS="arm64 x64"; DMGNAME="VRX-Editor-$VER.dmg" ;;
esac
echo "VRX Editor $VER builder ($ARCHS)"
OUT="$ROOT/build"
WORK="$OUT/work"
rm -rf "$OUT" || fail
mkdir -p "$WORK" || fail

step "Getting Node.js $NODE_VERSION from nodejs.org"
NODE_OK=""
BASE="https://nodejs.org/dist/$NODE_VERSION"
if curl -fsSL "$BASE/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt" 2>/dev/null; then
  NODE_OK=1
  for arch in $ARCHS; do
    f="node-$NODE_VERSION-darwin-$arch.tar.gz"
    curl -fsSL "$BASE/$f" -o "$WORK/$f" || fail "Could not download $f."
    want="$(grep " $f\$" "$WORK/SHASUMS256.txt" | cut -d' ' -f1)"
    got="$(shasum -a 256 "$WORK/$f" | cut -d' ' -f1)"
    [ -n "$want" ] && [ "$want" = "$got" ] || fail "$f didn't match nodejs.org's checksum, so it wasn't used."
    mkdir -p "$WORK/node-$arch" && tar -xzf "$WORK/$f" -C "$WORK/node-$arch" --strip-components 1 || fail "Could not unpack $f."
    echo "Node.js $NODE_VERSION for $arch: checked"
  done
fi
NODE=""
if [ -z "$NODE_OK" ]; then
  echo "nodejs.org couldn't be reached; using the Node.js on this Mac instead."
  for c in "$(command -v node 2>/dev/null)" /usr/local/bin/node /opt/homebrew/bin/node /opt/local/bin/node; do
    if [ -n "$c" ] && [ -x "$c" ]; then NODE="$c"; break; fi
  done
  [ -n "$NODE" ] || fail "No internet and no Node.js on this Mac. Connect to the internet, or install Node.js from https://nodejs.org, and run this again."
  "$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || fail "Node $("$NODE" -v) is too old; VRX Editor needs 18 or newer."
  echo "Using $NODE ($("$NODE" -v))"
fi
# Node.js to check the app files with: the downloaded one for this Mac, else any on this Mac.
CHECKNODE="$NODE"
if [ -n "$NODE_OK" ]; then
  HOSTARCH="$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )"
  CHECKNODE="$WORK/node-$HOSTARCH/bin/node"
  [ -x "$CHECKNODE" ] || CHECKNODE="$(command -v node 2>/dev/null || echo "$WORK/node-$(echo $ARCHS | cut -d' ' -f1)/bin/node")"
fi

step "Checking the editor's server"
"$CHECKNODE" -e 'require("./app/vrx.js"); require("./app/ports.js"); require("./app/sim.js")' || fail "The app files are damaged; unzip the package again."

APP="$OUT/VRX Editor.app"
step "Making the app"
osacompile -l JavaScript -s -o "$APP" "$MAC/window.js" || fail "osacompile could not build the window."
RES="$APP/Contents/Resources"
mkdir -p "$RES/app" || fail
cp -R app/. "$RES/app/" || fail "Could not copy the app files."

step "Bundling Node.js"
if [ -n "$NODE_OK" ]; then
  for arch in $ARCHS; do
    mkdir -p "$RES/node/$arch" && cp "$WORK/node-$arch/bin/node" "$RES/node/$arch/node" && chmod 755 "$RES/node/$arch/node" || fail "Could not copy Node into the app."
    echo "Node.js $NODE_VERSION for $arch: $(du -h "$RES/node/$arch/node" | cut -f1)"
  done
else
  REAL=$("$NODE" -e 'console.log(require("fs").realpathSync(process.execPath))')
  if otool -L "$REAL" 2>/dev/null | grep -E '^[[:space:]]+[/@]' | grep -v -E '^[[:space:]]+(/usr/lib/|/System/)' | grep -q .; then
    echo "This Node uses libraries outside macOS, so the app will run it from $NODE instead of a copy."
  else
    mkdir -p "$RES/node" && cp "$REAL" "$RES/node/node" && chmod 755 "$RES/node/node" || fail "Could not copy Node into the app."
    echo "Copied $(du -h "$RES/node/node" | cut -f1) Node into the app (it still falls back to $NODE)."
  fi
  echo "$NODE" > "$RES/node-path"
fi

step "Icon"
ICS="$OUT/icon.iconset"; mkdir -p "$ICS"
for s in 16 32 128 256 512; do
  sips -z $s $s "$MAC/icon-1024.png" --out "$ICS/icon_${s}x${s}.png" >/dev/null || fail "sips could not size the icon."
  d=$((s * 2)); sips -z $d $d "$MAC/icon-1024.png" --out "$ICS/icon_${s}x${s}@2x.png" >/dev/null || fail
done
iconutil -c icns "$ICS" -o "$RES/applet.icns" || fail "iconutil could not make the icon."
rm -rf "$ICS" "$RES/Assets.car"

step "App details (Info.plist)"
PL="$APP/Contents/Info.plist"
plutil -remove CFBundleIconName "$PL" >/dev/null 2>&1
plutil -replace CFBundleIconFile -string applet "$PL" || fail
plutil -replace CFBundleIdentifier -string com.gfssound.vrxeditor "$PL" || fail
plutil -replace CFBundleName -string "VRX Editor" "$PL" || fail
plutil -replace CFBundleDisplayName -string "VRX Editor" "$PL" || fail
plutil -replace CFBundleShortVersionString -string "$VER" "$PL" || fail
plutil -replace CFBundleVersion -string "$VER" "$PL" || fail
plutil -replace LSMinimumSystemVersion -string 12.0 "$PL" || fail
plutil -replace NSHighResolutionCapable -bool YES "$PL" || fail
plutil -replace NSAppTransportSecurity -json '{"NSAllowsLocalNetworking":true}' "$PL" || fail
plutil -lint "$PL" >/dev/null || fail "Info.plist is not valid."

step "Signing (ad hoc, for this Mac)"
xattr -cr "$APP" 2>/dev/null
codesign --force --deep --sign - "$APP" || fail "codesign failed."
codesign --verify --deep "$APP" || fail "The signed app does not verify."

step "Disk image"
STAGE="$OUT/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/" && ln -s /Applications "$STAGE/Applications" || fail
DMG="$OUT/$DMGNAME"
# LZMA (ULMO, macOS 10.15+; the app needs 12) packs noticeably smaller than the usual zlib (UDZO).
# The size is given (the app plus room to spare): hdiutil's own guess can come out too small ("No space left on device").
MB=$(( $(du -sm "$STAGE" | cut -f1) * 12 / 10 + 20 ))
hdiutil create -volname "VRX Editor $VER" -srcfolder "$STAGE" -fs HFS+ -size "${MB}m" -ov -format ULMO "$DMG" >/dev/null || \
  hdiutil create -volname "VRX Editor $VER" -srcfolder "$STAGE" -fs HFS+ -size "${MB}m" -ov -format UDZO "$DMG" >/dev/null || fail "hdiutil could not make the disk image."
rm -rf "$STAGE" "$WORK"

echo
echo "Done:"
echo "  $APP"
echo "  $DMG"
echo "Drag VRX Editor to Applications from the disk image, or open it straight from the build folder."
echo "Hold Option while opening VRX Editor to try it with two simulated VRX units."
[ "${VRX_BUILD_QUIET:-}" = 1 ] || { open "$OUT"; read -r -p "Press Return to close this window." _; }
exit 0
