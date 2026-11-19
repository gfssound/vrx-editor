# VRX Editor release notes

Each version's section is put on its GitHub release page by `.github/workflows/release.yml`.

## 0.1.3
- First release on GitHub, with ready-made downloads for Mac (Apple Silicon and Intel), Windows and Linux.
- **New: Windows version** (Windows 10/11, 64-bit): its own window, nothing to install. VRX units are found by the name they report over USB; app.log lists every COM port seen, and `--serial COM5` picks one by hand.
- **Linux AppImage** now has its own window (like Nova Relay's), so it no longer needs Chrome or Chromium installed. `--setup-usb` and `--install-menu` as before (`--add-to-menu` still works).
- **Mac:** the app carries the official Node.js for its kind of Mac, so nothing else is needed. The red note in the header now says when a VRX port can't be used (no permission, or in use by another app).

## 0.1.2
- Linux version (tar.gz and AppImage). Port problems shown in the header.

## 0.1.1
- Every setting and option Zaxcom's VRX app offers.

## 0.1.0
- First Mac version.
