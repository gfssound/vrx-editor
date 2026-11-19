'use strict';
// Finding VRX units on USB and talking to their serial ports.
// Mac and Linux need no add-on packages: the port is set to raw mode with stty and read/written through a small
// shell helper. Windows uses the serialport package, which the Windows app carries inside it.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// macOS: the USB device tree (ioreg) names each device's maker and product and lists its serial port.
function listMac(cb) {
  execFile('ioreg', ['-r', '-c', 'IOUSBHostDevice', '-l', '-w0'], { maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
    if (err) return cb(err, []);
    const found = [];
    // Each matched device starts a new tree at column 0 ("+-o Name@…").
    out.split(/\n(?=\+-o )/).forEach((chunk) => {
      const get = (key) => { const m = chunk.match(new RegExp('"' + key + '" = "([^"]*)"')); return m ? m[1] : ''; };
      const vendor = get('USB Vendor Name') || get('kUSBVendorString');
      const product = get('USB Product Name') || get('kUSBProductString');
      const serial = get('USB Serial Number') || get('kUSBSerialNumberString');
      const callouts = [...chunk.matchAll(/"IOCalloutDevice" = "([^"]*)"/g)].map((m) => m[1]);
      callouts.forEach((p) => found.push({ path: p, vendor, product, serial }));
    });
    cb(null, found);
  });
}

// Linux (and the GuiBridge Pi): udev names a VRX /dev/serial/by-id/usb-Zaxcom_VRX_<serial>…
function listLinux(cb) {
  const dir = process.env.VRX_BYID_DIR || '/dev/serial/by-id';
  fs.readdir(dir, (err, names) => {
    if (err) return cb(null, []);
    cb(null, names.map((n) => {
      let real = path.join(dir, n); try { real = fs.realpathSync(real); } catch (e) { /* keep link */ }
      const m = n.match(/^usb-([^_]+)_(.+?)_([^_]+)-if/);
      return { path: real, vendor: m ? m[1] : '', product: m ? m[2] : n, serial: m ? m[3] : '' };
    }));
  });
}

// Windows: the COM port list comes from the registry (fast, every scan); the USB details of each port
// (product name the device reports, maker, USB ids) come from PowerShell, only when the list changes.
// A VRX uses Windows' own USB serial driver, so its port is called "USB Serial Device (COMn)" and the
// maker is "Microsoft"; the product name the VRX itself reports (BusReportedDeviceDesc) is what names it.
const WIN_DETAILS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$out = @()',
  "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\((COM\\d+)\\)' } | ForEach-Object {",
  '  $com = $Matches[1]',
  "  $desc = (Get-PnpDeviceProperty -InstanceId $_.PNPDeviceID -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc').Data",
  '  $out += [pscustomobject]@{ com = $com; name = $_.Name; mfg = $_.Manufacturer; id = $_.PNPDeviceID; desc = $desc }',
  '}',
  'ConvertTo-Json -Compress -InputObject @($out)'
].join('\n');
let winCache = { key: null, list: [] }, winBusy = false;
function parseRegComPorts(out) {
  // "    \Device\USBSER000    REG_SZ    COM5"
  return out.split(/\r?\n/).map((l) => l.trim().match(/^(\S+)\s+REG_SZ\s+(COM\d+)$/i)).filter(Boolean).map((m) => ({ dev: m[1], com: m[2].toUpperCase() }));
}
function winDetail(com, d) {
  d = d || {};
  const id = String(d.id || '');
  const usb = /^USB\\/i.test(id) || /^USBSER/i.test(d.dev || '');
  const vid = (id.match(/VID_([0-9A-F]{4})/i) || [])[1] || '';
  const pid = (id.match(/PID_([0-9A-F]{4})/i) || [])[1] || '';
  // USB\VID_xxxx&PID_xxxx\<serial> (a composite device has &MI_nn and a Windows-made id instead)
  const serial = /&MI_/i.test(id) ? '' : (id.split('\\')[2] || '');
  const mfg = String(d.mfg || '');
  const vendor = mfg && !/^(microsoft|\(standard)/i.test(mfg) ? mfg : (vid ? 'USB ' + vid.toUpperCase() + ':' + pid.toUpperCase() : '');
  return { path: com, vendor, product: String(d.desc || d.name || com), serial, usb, name: String(d.name || '') };
}
function listWindows(cb) {
  execFile('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'], { windowsHide: true }, (err, out) => {
    const ports = err ? [] : parseRegComPorts(out);
    const key = JSON.stringify(ports);
    if (key === winCache.key || winBusy) return cb(null, winCache.list.length || !ports.length ? winCache.list : ports.map((p) => winDetail(p.com, { dev: p.dev })));
    if (!ports.length) { winCache = { key, list: [] }; return cb(null, []); }
    winBusy = true;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_DETAILS],
      { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (perr, pout) => {
        winBusy = false;
        let details = [];
        try { details = JSON.parse(String(pout).trim() || '[]'); if (!Array.isArray(details)) details = [details]; } catch (e) { details = []; }
        const by = {}; details.forEach((d) => { if (d && d.com) by[String(d.com).toUpperCase()] = d; });
        const list = ports.map((p) => winDetail(p.com, Object.assign({ dev: p.dev }, by[p.com])));
        // Only cache a full answer, so a slow or failed PowerShell is asked again on the next scan.
        if (!perr && details.length) winCache = { key, list };
        cb(null, list);
      });
  });
}

function isVrx(d) { return /zaxcom/i.test(d.vendor) || /\bvrx\b/i.test(d.product) || /\bvrx\b|zaxcom/i.test(d.name || ''); }

// All serial devices with a flag for the ones that look like a VRX.
function scan(cb) {
  const lister = process.platform === 'darwin' ? listMac : process.platform === 'win32' ? listWindows : listLinux;
  lister((err, list) => cb(err, (list || []).map((d) => Object.assign(d, { vrx: isVrx(d) }))));
}

// Windows: the port is opened with the serialport package (bundled in the Windows app).
let SerialLib = null, serialLibError = '';
function serialLib() {
  if (SerialLib || serialLibError) return SerialLib;
  try { SerialLib = require('serialport').SerialPort; } catch (e) { serialLibError = e.message; }
  return SerialLib;
}
class WinSerialPort extends EventEmitter {
  constructor(dev) { super(); this.dev = dev; this.open = false; }
  start() {
    const Lib = serialLib();
    this.open = true;
    if (!Lib) { setImmediate(() => this.finish('could not open ' + this.dev + ' (the serial library is missing: ' + serialLibError + ')')); return this; }
    this.sp = new Lib({ path: this.dev, baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, rtscts: false, autoOpen: false });
    this.sp.on('data', (b) => this.emit('data', b));
    this.sp.on('close', (err) => this.finish(err && err.disconnected === false ? 'closed ' + this.dev + ' (' + err.message + ')' : 'unplugged'));
    this.sp.on('error', (err) => { if (this.open && !this.sp.isOpen) this.finish('could not open ' + this.dev + ' (' + err.message + ')'); });
    this.sp.open((err) => {
      if (err) return this.finish('could not open ' + this.dev + ' (' + err.message + ')');
      // Like a terminal program: data terminal ready on, so the VRX knows someone is listening.
      this.sp.set({ dtr: true, rts: true }, () => {});
    });
    return this;
  }
  finish(why) { if (!this.open) return; this.open = false; try { if (this.sp && this.sp.isOpen) this.sp.close(() => {}); } catch (e) { /* gone */ } this.emit('close', why); }
  write(buf) { if (this.open && this.sp && this.sp.isOpen) this.sp.write(buf); }
  close() { this.open = false; try { if (this.sp && this.sp.isOpen) this.sp.close(() => {}); } catch (e) { /* gone */ } }
}

// One open serial port. Emits 'data' (Buffer), 'close' (reason).
class SerialPort extends EventEmitter {
  constructor(dev) { super(); this.dev = dev; this.open = false; }
  start() {
    // fd 3 stays open for the whole session so the raw settings aren't reset; one cat reads, the other writes.
    const script = 'exec 3<>"$1" || exit 2\n' +
      'stty raw -echo -echoe -echok -echoctl -echoke -ixon -ixoff -icrnl -opost 115200 <&3 2>/dev/null || stty raw -echo 115200 <&3 || exit 3\n' +
      'cat <&3 &\n' +
      'exec cat >&3\n';
    this.proc = spawn('/bin/sh', ['-c', script, 'vrxport', this.dev], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    this.open = true;
    let errText = '';
    this.proc.stdout.on('data', (b) => this.emit('data', b));
    // Only the reading cat holds our stdout. When it ends, either the helper failed to start
    // (it exits at once with code 2/3, handled below) or the VRX was unplugged.
    this.proc.stdout.on('end', () => {
      setTimeout(() => { if (this.open) { this.open = false; this.close(); this.emit('close', 'unplugged'); } }, 300);
    });
    this.proc.stderr.on('data', (b) => { errText += b.toString(); });
    this.proc.stdin.on('error', () => {});
    this.proc.on('exit', (code) => {
      if (!this.open) return;
      this.open = false;
      const why = errText.trim().split('\n').pop() || '';
      this.emit('close', code === 2 ? 'could not open ' + this.dev + (why ? ' (' + why + ')' : '') : code === 3 ? 'could not set up ' + this.dev + (why ? ' (' + why + ')' : '') : 'unplugged');
    });
    return this;
  }
  write(buf) { if (this.open) this.proc.stdin.write(buf); }
  close() {
    if (!this.proc) return;
    this.open = false;
    try { process.kill(-this.proc.pid, 'SIGTERM'); } catch (e) { try { this.proc.kill(); } catch (e2) { /* gone */ } }
  }
}

module.exports = {
  scan, isVrx,
  SerialPort: process.platform === 'win32' ? WinSerialPort : SerialPort,
  serialLibrary: () => (process.platform !== 'win32' ? 'system (stty)' : serialLib() ? 'serialport' : 'missing: ' + serialLibError),
  _test: { parseRegComPorts, winDetail, WIN_DETAILS }
};
