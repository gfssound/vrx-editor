# VRX Editor

A desktop app for editing Zaxcom VRX receivers over USB, on Mac, Windows and Linux, without the GuiBridge:
channels (frequency, delay, voting, enable), unit names and every setting Zaxcom's own VRX app offers, for one VRX
or several at once, with Compare and Presets. Same screens as the VRX page of the GuiBridge redesign.

Not made by Zaxcom and contains no Zaxcom code. The USB messages were worked out from what Zaxcom's VRX app sends
(see [docs/usb-protocol.md](docs/usb-protocol.md)). Before trusting it on set, write to one VRX and check the unit itself.

## Download

Get the newest version from the [Releases page](https://github.com/gfssound/vrx-editor/releases/latest):

| Computer | Download | Install |
|---|---|---|
| Mac with Apple Silicon (M1 and later) | `VRX-Editor-<version>-AppleSilicon.dmg` | Open it, drag VRX Editor onto Applications. First time: System Settings › Privacy & Security › Open Anyway. |
| Mac with Intel | `VRX-Editor-<version>-Intel.dmg` | Same as above. |
| Windows 10/11, 64-bit | `VRX-Editor-<version>-Windows.zip` | Unzip the whole folder, double-click `VRX Editor/VRX Editor.exe` (More info › Run anyway the first time). `Install shortcuts.bat` adds Start menu and desktop shortcuts. |
| Linux, x86_64 | `VRX-Editor-<version>-x86_64.AppImage` | `chmod +x` it, run it once with `--setup-usb` (USB permission), then double-click. `--install-menu` adds a menu entry. |

Nothing else needs installing: each download carries what it needs to run.

## Using it

- Quit Zaxcom's VRX app first: only one program can use a VRX's USB port at a time.
- Plug in a VRX and open VRX Editor. Each VRX is read when it appears and every 5 s after that.
- Change what you need, then **WRITE**. Each unit is written, read back and compared; "Last written at…" means every unit confirmed it.
- Try it without a VRX: start it with `--simulate` (Mac: hold Option while opening it).
- If a VRX isn't found by name, `app.log` lists every serial port seen; start it with `--serial /dev/ttyACM0` (Linux), `--serial COM5` (Windows) or `--serial /dev/cu.usbmodem…` (Mac).

| | Presets, settings and `app.log` |
|---|---|
| Mac | `~/Library/Application Support/VRX Editor` (View › Show Log in Finder) |
| Windows | `%APPDATA%\VRX Editor` (VRX Editor › Show Log File) |
| Linux | `~/.config/vrx-editor` |

## Making a release

1. Change the version in `app/package.json` and add a `## <version>` section to `RELEASE_NOTES.md`.
2. Commit and push to `main`.

`.github/workflows/release.yml` then builds every download on GitHub's own machines, starts each one with simulated
units to check it, and puts them on the Releases page as "VRX Editor &lt;version&gt;". To rebuild one download, use
Actions › Release › Run workflow and pick `mac`, `windows` or `linux` (`none` just rewrites the release notes).

The downloads aren't signed with an Apple Developer ID or a Microsoft certificate, which is why macOS and Windows ask
once before the first start.

## How it's built

```
app/            the editor: server.js (Node 18+), vrx.js (USB protocol), ports.js (finding VRX units), sim.js (simulated units), public/ (the page)
web/            page sources; python3 tools/build_page.py rebuilds app/public from them
mac/            Build VRX Editor.command (makes the .app and .dmg on any Mac) and window.js (the app's own window)
desktop/main.js the window for Windows and the Linux AppImage (Electron)
windows/        files that go next to the app in the Windows zip
tools/          build_windows.sh, build_appimage.sh, release_notes.js, build_page.py
test/           trace_test.js (protocol against captured frames), windows_ports_test.js, smoke.js (a built app with simulated units), fake_vrx_pty.py, ui_test.py
```

- **Server:** `node app/server.js [--port 8095] [--no-open] [--simulate [n]] [--serial …] [--any-usb] [--data dir] [--log file]`, plain Node with no packages on Mac and Linux. API: `/api/state`, `POST /api/write` (writes, waits 1 s, re-reads and compares), `PUT /api/presets`, `/api/log`, `/api/ping`.
- **Finding units:** Mac: the USB device tree (`ioreg`), maker Zaxcom or product VRX. Linux: `/dev/serial/by-id`. Windows: COM ports from the registry, and the product name each USB device reports (PowerShell), when the port list changes.
- **Serial:** Mac and Linux: `stty` raw mode and a small shell helper. Windows: the [serialport](https://serialport.io) package, carried inside the Windows app.
- **Mac app:** `mac/window.js` (JavaScript for Automation, compiled with `osacompile`) starts the server and shows the page in a WebKit window. The builder downloads the official Node.js from nodejs.org, checks it against the published checksums and puts it in the app (`VRX_MAC_ARCH=arm64|x64` for one kind of Mac only).
- **Windows and Linux:** Electron 33 runs the server as plain Node and shows the page in its own window, like Nova Relay.

Tests: `node test/trace_test.js test/traces/trace-1.txt`, `node test/trace_test.js test/traces/trace-2.txt 2`,
`node test/windows_ports_test.js`, `node test/smoke.js --server app` (all run by `.github/workflows/tests.yml` on Linux, Mac and Windows).
