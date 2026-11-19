#!/usr/bin/env node
'use strict';
// VRX Editor: edits Zaxcom VRX receivers over USB from a Mac, Windows or Linux computer without the GuiBridge.
// Not made by Zaxcom; contains no Zaxcom code. The USB protocol was worked out from observed frames.
//
//   node server.js [--port 8095] [--no-open] [--simulate [n]] [--serial /dev/cu.x | COM5]… [--any-usb]
//                  [--data dir] [--log file] [--port-file file] [--exit-with pid] [--exit-when-idle s] [--no-trace]

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const V = require('./vrx');
const { scan, SerialPort, serialLibrary } = require('./ports');
const { SimPort } = require('./sim');

const VERSION = require('./package.json').version;

// ---------- options ----------
const argv = process.argv.slice(2);
const opt = { port: 8095, open: true, simulate: 0, serial: [], anyUsb: false, trace: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], next = () => argv[++i];
  if (a === '--port') opt.port = Number(next());
  else if (a === '--no-open') opt.open = false;
  else if (a === '--simulate') opt.simulate = /^\d+$/.test(argv[i + 1] || '') ? Number(next()) : 2;
  else if (a === '--serial') opt.serial.push(next());
  else if (a === '--any-usb') opt.anyUsb = true;
  else if (a === '--data') opt.data = next();
  else if (a === '--log') opt.log = next();
  else if (a === '--port-file') opt.portFile = next();
  else if (a === '--exit-with') opt.exitWith = Number(next());
  else if (a === '--no-trace') opt.trace = false;
  else if (a === '--exit-when-idle') opt.idle = Number(next());
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 8).join('\n')); process.exit(0); }
}
if (process.env.VRX_EDITOR_SIMULATE) opt.simulate = Number(process.env.VRX_EDITOR_SIMULATE) || 2;
const DATA = opt.data || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'VRX Editor')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'VRX Editor')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vrx-editor'));
fs.mkdirSync(DATA, { recursive: true });

// ---------- log (rotated at 5 MB) ----------
function log(...a) {
  const line = new Date().toISOString() + ' ' + a.join(' ') + '\n';
  if (!opt.log) return process.stdout.write(line);
  try {
    const st = fs.statSync(opt.log);
    if (st.size > 5 * 1024 * 1024) fs.renameSync(opt.log, opt.log + '.1');
  } catch (e) { /* new file */ }
  try { fs.appendFileSync(opt.log, line); } catch (e) { /* ignore */ }
}
const hex = (b) => Buffer.from(b).toString('hex').replace(/(..)(?!$)/g, '$1 ');

// ---------- units ----------
const units = new Map(); // dev path -> unit
let lastUpdateTime = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function touch() { lastUpdateTime = Date.now(); }

class Unit {
  constructor(dev, port, usb) {
    this.dev = dev; this.port = port; this.usb = usb || {};
    this.raw = null; this.model = null; this.info = ''; this.error = ''; this.lastRead = 0;
    this.queue = Promise.resolve(); this.waiters = [];
    this.deframer = new V.Deframer((f) => this.onFrame(f), (s) => { if (opt.trace && s.length && s.some((x) => x > 0x20 && x < 0x7f)) log(this.tag(), 'text', JSON.stringify(s.toString('latin1'))); });
    port.on('data', (b) => { if (opt.trace) log(this.tag(), 'rx', hex(b)); this.deframer.push(b); });
    port.on('close', (why) => {
      log(this.tag(), 'closed:', why); this.gone = true; units.delete(dev);
      if (why !== 'unplugged') { retryAt.set(dev, Date.now() + 10000); portErrors.set(dev, why); } else portErrors.delete(dev);
      touch();
    });
    port.start();
    log(this.tag(), 'opened', JSON.stringify(this.usb));
    this.loop();
  }
  tag() { return '[' + this.dev + ']'; }
  send(buf) { if (opt.trace) log(this.tag(), 'tx', hex(buf)); this.port.write(buf); }
  onFrame(f) {
    if (f.cmd === 0x80 && f.payload.length >= V.HEADER) {
      const m = V.decode(f.payload);
      if (m.error) { this.error = 'This VRX reports ' + m.error + '; it is shown but not written.'; log(this.tag(), 'settings ignored:', m.error); }
      else { this.error = ''; portErrors.delete(this.dev); this.raw = f.payload; this.model = m; this.lastRead = Date.now(); touch(); }
      this.waiters.splice(0).forEach((w) => w(!m.error));
    } else if (f.cmd === 0x20) {
      this.info = f.payload.toString('latin1').replace(/\0.*$/s, '').trim();
    } else if (opt.trace) log(this.tag(), 'frame cmd', f.cmd.toString(16), 'addr', f.addr.toString(16), 'len', f.payload.length);
  }
  // Runs one job at a time on this port.
  job(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }
  read(timeout) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== done); resolve(false); }, timeout || 1500);
      const done = (ok) => { clearTimeout(t); resolve(ok); };
      this.waiters.push(done);
      this.send(V.READ_REQUEST);
    });
  }
  async loop() {
    let misses = 0;
    while (!this.gone) {
      const ok = await this.job(() => this.read());
      misses = ok ? 0 : misses + 1;
      if (!ok && !this.raw && misses === 3) { this.error = 'No answer from this port yet.'; touch(); }
      await sleep(this.raw ? 5000 : 1500);
    }
  }
  write(want) {
    return this.job(async () => {
      if (!this.raw) throw new Error('This VRX has not been read yet.');
      const p = V.encode(this.raw, want);
      this.send(V.frame(0x80, p));
      await sleep(1000);
      let ok = await this.read(2000);
      if (!ok) { await sleep(500); ok = await this.read(2000); }
      if (!ok) return { confirmed: false, diffs: ['no answer after writing'] };
      const diffs = V.differences(want, this.model);
      log(this.tag(), 'write', diffs.length ? 'NOT confirmed: ' + diffs.join(', ') : 'confirmed');
      return { confirmed: !diffs.length, diffs };
    });
  }
  view(uuid) {
    const base = { uuid, port: this.dev, usb: this.usb, info: this.info, error: this.error };
    if (!this.model) return Object.assign(base, { needsRead: true });
    const m = Object.assign({}, this.model); delete m.headerChecksumOk;
    return Object.assign(base, m, { lastRead: this.lastRead });
  }
}

function uuidList() {
  const out = [], seen = {};
  [...units.values()].sort((a, b) => (a.dev < b.dev ? -1 : 1)).forEach((u) => {
    let id = u.model ? 'SN' + u.model.unitSerialNum : 'PORT:' + u.dev;
    if (seen[id]) id += '@' + u.dev; seen[id] = 1;
    out.push([id, u]);
  });
  return out;
}

// ---------- finding units ----------
let lastScan = [];
const retryAt = new Map(); // ports that failed to open wait 10 s before the next try
const portErrors = new Map(); // port -> why it could not be used (shown in the header)
function rescan() {
  if (opt.simulate) return;
  scan((err, list) => {
    if (err) log('scan error', err.message);
    const devs = new Map();
    list.forEach((d) => { if (d.vrx || (opt.anyUsb && (/usbmodem|ttyACM/.test(d.path) || d.usb))) devs.set(d.path, d); });
    opt.serial.forEach((p) => {
      const win = process.platform === 'win32' && /^COM\d+$/i.test(p);
      if (win ? list.some((d) => d.path === p.toUpperCase()) : fs.existsSync(p)) devs.set(win ? p.toUpperCase() : p, { path: p, vendor: '', product: 'manual', serial: '' });
    });
    const sig = JSON.stringify(list.map((d) => [d.path, d.vendor, d.product]));
    if (sig !== JSON.stringify(lastScan.map((d) => [d.path, d.vendor, d.product]))) log('USB serial devices:', JSON.stringify(list));
    lastScan = list;
    for (const [p, d] of devs) if (!units.has(p) && !(retryAt.get(p) > Date.now())) { units.set(p, new Unit(p, new SerialPort(p), d)); touch(); }
  });
}
if (opt.simulate) for (let k = 0; k < opt.simulate; k++) { const s = new SimPort(k); units.set(s.dev, new Unit(s.dev, s, { product: 'simulated VRX' })); }
rescan();
setInterval(rescan, 2000);

// ---------- presets ----------
const PRESETS = path.join(DATA, 'presets.json');
function loadPresets() { try { return JSON.parse(fs.readFileSync(PRESETS, 'utf8')); } catch (e) { return { presets: [] }; } }
function savePresets(p) { fs.writeFileSync(PRESETS + '.tmp', JSON.stringify(p, null, 1)); fs.renameSync(PRESETS + '.tmp', PRESETS); }

// ---------- web ----------
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
function body(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('bad JSON')); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function hint(e) {
  if (process.platform === 'win32' && /access denied|busy|in use/i.test(e)) return 'The VRX USB port is in use by another app (quit Zaxcom VRX or another VRX Editor).';
  if (/serial library is missing/i.test(e)) return 'This copy of VRX Editor is missing its serial library: download the Windows version again.';
  if (/permission denied/i.test(e)) {
    if (process.platform !== 'linux') return 'No permission for the VRX USB port.';
    const how = process.env.APPIMAGE ? 'run ' + path.basename(process.env.APPIMAGE) + ' --setup-usb' : 'run ./install.sh --usb';
    return 'No permission for the VRX USB port: ' + how + ' once (or add yourself to the dialout group), then unplug and replug the VRX.';
  }
  if (/busy/i.test(e)) return 'The VRX USB port is in use by another app (quit Zaxcom VRX or another VRX Editor).';
  return 'A VRX USB port could not be used.';
}
let lastPoll = 0;
function state() {
  lastPoll = Date.now();
  return {
    version: VERSION, simulate: !!opt.simulate, caps: V.CAPS,
    vrx: { lastUpdateTime, vrxs: uuidList().map(([id, u]) => u.view(id)) },
    presets: loadPresets(),
    usb: lastScan.map((d) => ({ path: d.path, vendor: d.vendor, product: d.product, vrx: d.vrx })),
    portErrors: [...portErrors].map(([p, e]) => ({ port: p, error: e, hint: hint(e) }))
  };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true, version: VERSION });
    if (url.pathname === '/api/state') return send(res, 200, state());
    if (url.pathname === '/api/write' && req.method === 'POST') {
      const want = await body(req);
      const hit = uuidList().find(([id]) => id === want.uuid);
      if (!hit) return send(res, 404, { error: 'That VRX is no longer connected.' });
      const r = await hit[1].write(want);
      return send(res, 200, Object.assign({ ok: true }, r));
    }
    if (url.pathname === '/api/presets' && req.method === 'PUT') {
      const p = await body(req);
      if (!Array.isArray(p.presets)) return send(res, 400, { error: 'presets must be a list' });
      savePresets({ presets: p.presets });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/log') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(opt.log && fs.existsSync(opt.log) ? fs.readFileSync(opt.log) : 'Logging to the terminal.');
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'unknown' });
    if (url.pathname === '/favicon.ico') { res.writeHead(302, { Location: '/favicon.png' }); return res.end(); }
    let f = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
    if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    log('request error', req.url, e.message);
    send(res, 400, { error: e.message });
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && opt.port) { log('port', opt.port, 'busy, picking a free one'); opt.port = 0; return server.listen(0, '127.0.0.1'); }
  log('server error', e.message); process.exit(1);
});
server.listen(opt.port, '127.0.0.1', () => {
  const port = server.address().port, url = 'http://127.0.0.1:' + port + '/';
  log('VRX Editor', VERSION, 'at', url, opt.simulate ? '(simulating ' + opt.simulate + ' units)' : '', 'data in', DATA, '|', process.platform, process.arch, 'node', process.versions.node, '| serial:', serialLibrary());
  if (opt.portFile) fs.writeFileSync(opt.portFile, String(port));
  if (opt.open) {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    execFile(cmd, args, { windowsHide: true }, () => {});
  }
});

// Quit with the app window.
if (opt.idle) setInterval(() => { if (lastPoll && Date.now() - lastPoll > opt.idle * 1000) shutdown('no window open for ' + opt.idle + ' s'); }, 2000);
if (opt.exitWith) setInterval(() => { try { process.kill(opt.exitWith, 0); } catch (e) { shutdown('app closed'); } }, 1000);
function shutdown(why) { log('stopping:', why); units.forEach((u) => { u.gone = true; u.port.close(); }); setTimeout(() => process.exit(0), 100); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
