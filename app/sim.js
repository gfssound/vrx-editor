'use strict';
// Simulated VRX units (--simulate), for trying the app with no VRX plugged in.
// Built from the settings layout in vrx.js; behaves like a unit on its USB port:
// answers a read with the settings and an info line, takes a write, prints a little console text.
const { EventEmitter } = require('events');
const V = require('./vrx');

function makeSettings(serial, name, n, lo, hi, firstF, step) {
  const p = Buffer.alloc(V.HEADER + V.CH_SIZE * n);
  p.writeUInt32LE(V.MAGIC, 0);
  p.write(name, 8, 'latin1');
  p.writeUInt32LE(serial, 24);
  p[28] = 5;
  // Same starting values as the units seen in the trace: MONO, LED on, A/B channel, * announce, alkaline, squelch medium.
  p[32] = 0; p[33] = 1; p[34] = 1; p[35] = 1; p[36] = 3; p[37] = 1; p[39] = 1; p[46] = n; p[49] = 0x28; p[51] = 1;
  p.writeUInt32LE(lo, 52); p.writeUInt32LE(hi, 56);
  for (let i = 0; i < n; i++) { const c = V.HEADER + V.CH_SIZE * i; p.writeUInt32LE(firstF + i * step, c); }
  p[V.HEADER + 7] = 1; // CH 1 enabled
  V.setHeaderChecksum(p);
  return p;
}

class SimPort extends EventEmitter {
  constructor(k) {
    super();
    this.dev = 'sim:' + (k + 1);
    this.serial = 1001 + k;
    this.settings = k % 2 ? makeSettings(this.serial, 'SIM-' + this.serial, 8, 192000, 216975, 192000, 3475)
      : makeSettings(this.serial, 'SIM-' + this.serial, 10, 215000, 217000, 215180, 180);
    this.deframer = new V.Deframer((f) => this.onFrame(f));
    this.open = false;
  }
  start() { this.open = true; return this; }
  close() { this.open = false; }
  write(buf) { if (this.open) this.deframer.push(Buffer.from(buf)); }
  onFrame(f) {
    if (f.cmd !== 0x80) return;
    if (f.payload.length === 4) {
      const out = Buffer.concat([Buffer.from('\x1b[0m\r\r', 'latin1'), V.frame(0x80, this.settings, 0xff), Buffer.from('\r\r', 'latin1'),
        V.frame(0x20, Buffer.from(('VRX sim sn' + this.serial + '\0'.repeat(16)).slice(0, 16), 'latin1'))]);
      setTimeout(() => { if (this.open) this.emit('data', out); }, 12);
    } else if (!V.check(f.payload) && f.payload.length === this.settings.length) {
      const p = Buffer.from(f.payload);
      for (let i = 0; i < p[46]; i++) p[V.HEADER + V.CH_SIZE * i + 4] = 0;
      V.setHeaderChecksum(p);
      setTimeout(() => { this.settings = p; }, 150);
    }
  }
}

module.exports = { SimPort };
