/* VRX Editor desktop window (Windows and the Linux AppImage), modelled on Nova Relay's.
   Starts the editor's server (app/server.js, run as plain Node by Electron's own binary) and shows its page in
   its own window: no browser and no Node.js needed on the computer. Closing the window stops everything.
   Options: --simulate [n] (try it with simulated VRX units), --serial COM5 | /dev/ttyACM0, --any-usb. */
'use strict';
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SERVER = path.join(__dirname, 'server', 'server.js');
const DATA = process.platform === 'win32' ? path.join(app.getPath('appData'), 'VRX Editor')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'vrx-editor');
const LOG = path.join(DATA, 'app.log');
const PORTFILE = path.join(DATA, 'port');
const WINFILE = path.join(DATA, 'window.json');
let server = null, win = null, quitting = false, url = '';

app.setName('VRX Editor');
if (process.platform === 'win32') app.setAppUserModelId('com.gfssound.vrxeditor');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// Only the editor's own options are passed on to the server (Electron and the AppImage add their own).
function serverOptions(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--simulate') { out.push(a); if (/^\d+$/.test(argv[i + 1] || '')) out.push(argv[++i]); }
    else if (a === '--serial' && argv[i + 1]) out.push(a, argv[++i]);
    else if (a === '--any-usb' || a === '--no-trace') out.push(a);
  }
  return out;
}

function tail(file, n) { try { const s = fs.readFileSync(file, 'utf8'); return s.slice(-n); } catch (e) { return ''; } }

function startServer() {
  fs.mkdirSync(DATA, { recursive: true });
  try { fs.unlinkSync(PORTFILE); } catch (e) { /* none */ }
  const args = [SERVER, '--no-open', '--port', '8095', '--data', DATA, '--port-file', PORTFILE, '--log', LOG,
    '--exit-with', String(process.pid), ...serverOptions(process.argv.slice(1))];
  server = spawn(process.execPath, args, {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), cwd: path.dirname(SERVER),
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true
  });
  let err = '';
  server.stderr.on('data', (d) => { err += d; });
  server.on('exit', (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox('VRX Editor stopped', 'The editor\'s server stopped (code ' + code + ').\n\n' + (err || tail(LOG, 1500)).slice(-1500) + '\n\nLog: ' + LOG);
    app.quit();
  });
}

function waitForPort(ms) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    (function check() {
      let port = '';
      try { port = fs.readFileSync(PORTFILE, 'utf8').trim(); } catch (e) { /* not yet */ }
      if (port) {
        return http.get('http://127.0.0.1:' + port + '/api/ping', (r) => { r.resume(); resolve('http://127.0.0.1:' + port + '/'); })
          .on('error', () => (Date.now() > end ? reject(new Error('no answer')) : setTimeout(check, 150)));
      }
      if (!server || Date.now() > end) return reject(new Error('The editor\'s server did not start. Details are in ' + LOG));
      setTimeout(check, 100);
    })();
  });
}

function loadWindowState() { try { return JSON.parse(fs.readFileSync(WINFILE, 'utf8')); } catch (e) { return {}; } }
function saveWindowState() {
  if (!win) return;
  try { fs.writeFileSync(WINFILE, JSON.stringify(Object.assign(win.getNormalBounds(), { maximized: win.isMaximized() }))); } catch (e) { /* ignore */ }
}

async function start() {
  startServer();
  url = await waitForPort(15000);
  const st = loadWindowState();
  win = new BrowserWindow({
    width: st.width || 1300, height: st.height || 900, x: st.x, y: st.y, minWidth: 900, minHeight: 600,
    title: 'VRX Editor', backgroundColor: '#1a1b1d', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (st.maximized) win.maximize();
  // Links that leave the editor open in the web browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); if (/^https?:/.test(u)) shell.openExternal(u); } });
  win.on('close', saveWindowState);
  win.on('closed', () => { win = null; });
  await win.loadURL(url);
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'VRX Editor', submenu: [
    { label: 'Open in Web Browser', accelerator: 'CmdOrCtrl+Shift+B', click: () => url && shell.openExternal(url) },
    { label: 'Show Log File', click: () => shell.showItemInFolder(LOG) },
    { type: 'separator' }, { role: 'quit' }] },
  { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] }
]));

app.whenReady().then(start).catch((e) => { dialog.showErrorBox('VRX Editor could not start', String(e && e.message || e)); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; if (server && server.exitCode == null) server.kill(); });
