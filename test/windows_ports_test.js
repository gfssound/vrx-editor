// Checks the Windows side of app/ports.js on any computer: the COM port list from the registry, the USB details
// from PowerShell, VRX detection, and the serial port wrapper (with a stand-in for the serialport package).
//   node test/windows_ports_test.js
'use strict';
const path = require('path');
const Module = require('module');
const cp = require('child_process');
const { EventEmitter } = require('events');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

Object.defineProperty(process, 'platform', { value: 'win32' });

// Stand-ins for reg.exe and powershell.exe
let regOut = '', psOut = '', psCalls = 0;
cp.execFile = (cmd, args, opts, cb) => {
  if (typeof opts === 'function') cb = opts;
  if (cmd === 'reg') return setImmediate(() => cb(null, regOut, ''));
  if (/powershell/i.test(cmd)) { psCalls++; return setImmediate(() => cb(null, psOut, '')); }
  setImmediate(() => cb(new Error('unexpected ' + cmd)));
};

// Stand-in for the serialport package
const opened = [];
class FakeSP extends EventEmitter {
  constructor(o) { super(); this.o = o; this.isOpen = false; this.sets = []; opened.push(this); }
  open(cb) { if (this.o.path === 'COM9') return setImmediate(() => cb(new Error('Opening COM9: Access denied'))); this.isOpen = true; setImmediate(() => cb(null)); }
  set(o, cb) { this.sets.push(o); cb && cb(null); }
  write(b) { this.written = (this.written || []).concat([Buffer.from(b)]); }
  close(cb) { this.isOpen = false; setImmediate(() => { this.emit('close'); cb && cb(null); }); }
}
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'serialport' ? 'serialport' : realResolve.call(this, req, ...rest); };
require.cache.serialport = { id: 'serialport', filename: 'serialport', loaded: true, exports: { SerialPort: FakeSP } };

const P = require(path.join(__dirname, '..', 'app', 'ports.js'));
const scan = () => new Promise((r) => P.scan((e, l) => r(l)));

(async () => {
  regOut = '\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM\r\n    \\Device\\USBSER000    REG_SZ    COM5\r\n    \\Device\\Serial0    REG_SZ    COM1\r\n    \\Device\\USBSER001    REG_SZ    COM7\r\n\r\n';
  psOut = JSON.stringify([
    { com: 'COM5', name: 'USB Serial Device (COM5)', mfg: 'Microsoft', id: 'USB\\VID_1D50&PID_6018\\GFS02', desc: 'VRX' },
    { com: 'COM1', name: 'Communications Port (COM1)', mfg: '(Standard port types)', id: 'ACPI\\PNP0501\\0', desc: null },
    { com: 'COM7', name: 'USB Serial Device (COM7)', mfg: 'Microsoft', id: 'USB\\VID_2341&PID_0043&MI_00\\6&1234', desc: 'Arduino Uno' }
  ]);
  let l = await scan();
  ok(l.length === 3, 'three COM ports listed');
  const v = l.find((d) => d.path === 'COM5');
  ok(v && v.vrx && v.product === 'VRX' && v.serial === 'GFS02' && v.usb && v.vendor === 'USB 1D50:6018', 'VRX found by its own product name: ' + JSON.stringify(v));
  ok(!l.find((d) => d.path === 'COM1').vrx && !l.find((d) => d.path === 'COM1').usb, 'COM1 is not a VRX and not USB');
  const a = l.find((d) => d.path === 'COM7');
  ok(!a.vrx && a.usb && a.serial === '', 'other USB device not taken; composite id gives no serial');
  await scan(); await scan();
  ok(psCalls === 1, 'PowerShell asked only when the port list changes (' + psCalls + ')');
  regOut = regOut.replace('    \\Device\\USBSER001    REG_SZ    COM7\r\n', '');
  psOut = JSON.stringify({ com: 'COM5', name: 'Zaxcom VRX (COM5)', mfg: 'Zaxcom', id: 'USB\\VID_1D50&PID_6018\\GFS03', desc: null });
  l = await scan();
  ok(psCalls === 2 && l.length === 2, 'unplug noticed, single PowerShell object read');
  ok(l[0].vrx && l[0].vendor === 'Zaxcom', 'a Zaxcom driver name also counts: ' + JSON.stringify(l[0]));
  regOut = ''; l = await scan(); ok(l.length === 0, 'no ports');
  regOut = '    \\Device\\USBSER000    REG_SZ    COM5\r\n'; psOut = 'not json'; l = await scan();
  ok(l.length === 1 && l[0].path === 'COM5' && !l[0].vrx, 'broken PowerShell answer: port still listed, not taken as a VRX');
  psOut = JSON.stringify([{ com: 'COM5', name: 'USB Serial Device (COM5)', mfg: 'Microsoft', id: 'USB\\VID_1D50&PID_6018\\GFS02', desc: 'VRX' }]);
  l = await scan(); ok(l[0].vrx, 'asked again after a broken answer');
  ok(P._test.WIN_DETAILS.includes('BusReportedDeviceDesc') && P.serialLibrary() === 'serialport', 'serial library: ' + P.serialLibrary());

  // Serial port wrapper
  const sp = new P.SerialPort('COM5').start();
  const got = []; sp.on('data', (b) => got.push(b));
  const closes = []; sp.on('close', (w) => closes.push(w));
  await new Promise((r) => setTimeout(r, 20));
  const f = opened[opened.length - 1];
  ok(f.o.baudRate === 115200 && f.isOpen && f.sets.some((s) => s.dtr), 'opened at 115200 with DTR on');
  sp.write(Buffer.from([0xaa, 1])); ok(f.written && f.written[0][0] === 0xaa, 'write goes to the port');
  f.emit('data', Buffer.from('hi')); ok(got.length === 1, 'data passed on');
  const e = new Error('disconnected'); e.disconnected = true; f.isOpen = false; f.emit('close', e);
  ok(closes[0] === 'unplugged', 'unplug reported: ' + closes[0]);
  const bad = new P.SerialPort('COM9').start(); const bc = []; bad.on('close', (w) => bc.push(w));
  await new Promise((r) => setTimeout(r, 20));
  ok(/could not open COM9 \(Opening COM9: Access denied\)/.test(bc[0]), 'open failure reported: ' + bc[0]);
  const s2 = new P.SerialPort('COM5').start(); const c2 = []; s2.on('close', (w) => c2.push(w));
  await new Promise((r) => setTimeout(r, 20)); s2.close(); await new Promise((r) => setTimeout(r, 20));
  ok(c2.length === 0, 'closing it ourselves is not reported as an unplug');

  console.log(fails ? fails + ' FAILED' : 'all Windows port checks pass');
  process.exit(fails ? 1 : 0);
})();
