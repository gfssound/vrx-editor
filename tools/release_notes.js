// Prints the release notes for one version: its section of RELEASE_NOTES.md plus how to install each download.
//   node tools/release_notes.js 0.1.3
'use strict';
const fs = require('fs'), path = require('path');
const v = process.argv[2] || require('../app/package.json').version;
const md = fs.readFileSync(path.join(__dirname, '..', 'RELEASE_NOTES.md'), 'utf8');
const m = md.split(/^## /m).find((s) => s.startsWith(v + '\n') || s.startsWith(v + ' '));
const notes = m ? m.slice(m.indexOf('\n') + 1).trim() : '';
console.log(`${notes}

### Downloads
- **Mac:** Apple menu › About This Mac says Apple M… → \`VRX-Editor-${v}-AppleSilicon.dmg\`, or Intel → \`VRX-Editor-${v}-Intel.dmg\`. Open it and drag VRX Editor onto Applications. The first time, macOS says it can't check the app: System Settings › Privacy & Security › **Open Anyway**.
- **Windows 10/11 (64-bit):** \`VRX-Editor-${v}-Windows.zip\`. Unzip the whole folder, open "VRX Editor" and double-click **VRX Editor.exe**. If Windows says it protected your PC: More info › Run anyway. "Install shortcuts.bat" adds Start menu and desktop shortcuts.
- **Linux (x86_64):** \`VRX-Editor-${v}-x86_64.AppImage\`. Make it executable (\`chmod +x\`), then once run \`./VRX-Editor-${v}-x86_64.AppImage --setup-usb\` so you can use a VRX's USB port, and double-click it. \`--install-menu\` adds it to the applications menu.

Quit Zaxcom's VRX app first: only one program can use a VRX's USB port at a time. Try any version without a VRX by starting it with \`--simulate\` (on a Mac, hold Option while opening it).

Not made by Zaxcom and contains no Zaxcom code. Before trusting it on set, write to one VRX and check the unit itself.`);
