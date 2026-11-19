'use strict';
// VRX USB protocol, written from frames observed on the USB link (see claude/vrx-usb-protocol.md).
// Contains no Zaxcom code.
//
// Frame: AA | ck | len lo | len hi | addr | cmd | payload[len]
//   ck = (sum of every byte from len lo to the end of the payload) & 0xFF
// cmd 0x80, payload 44 33 22 11       -> read settings (host to unit, addr 00)
// cmd 0x80, payload = settings struct -> settings (unit to host, addr FF) / write (host to unit, addr 00)
// cmd 0x20, payload = ASCII info      -> e.g. "VRX 9.99 sn1001" (unit to host)

const MAGIC = 0x11223344;
const STRUCT_VERSION = 5;
const HEADER = 64;
const CH_SIZE = 8;

function frame(cmd, payload, addr) {
  const p = Buffer.from(payload || []);
  const b = Buffer.alloc(6 + p.length);
  b[0] = 0xaa; b.writeUInt16LE(p.length, 2); b[4] = addr || 0; b[5] = cmd; p.copy(b, 6);
  let s = 0; for (let i = 2; i < b.length; i++) s += b[i];
  b[1] = s & 0xff;
  return b;
}

const READ_REQUEST = frame(0x80, Buffer.from([0x44, 0x33, 0x22, 0x11]));

// Pulls whole frames out of a byte stream. The unit also prints console text into the same stream,
// so anything that isn't a checksum-valid frame is skipped.
class Deframer {
  constructor(onFrame, onStray) { this.buf = Buffer.alloc(0); this.onFrame = onFrame; this.onStray = onStray || (() => {}); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const i = this.buf.indexOf(0xaa);
      if (i < 0) { if (this.buf.length) this.onStray(this.buf); this.buf = Buffer.alloc(0); return; }
      if (i > 0) { this.onStray(this.buf.subarray(0, i)); this.buf = this.buf.subarray(i); }
      if (this.buf.length < 6) return;
      const len = this.buf.readUInt16LE(2);
      if (len > 2048) { this.onStray(this.buf.subarray(0, 1)); this.buf = this.buf.subarray(1); continue; }
      if (this.buf.length < 6 + len) return;
      const f = this.buf.subarray(0, 6 + len);
      let s = 0; for (let k = 2; k < f.length; k++) s += f[k];
      if ((s & 0xff) !== f[1]) { this.onStray(this.buf.subarray(0, 1)); this.buf = this.buf.subarray(1); continue; }
      this.buf = this.buf.subarray(6 + len);
      this.onFrame({ addr: f[4], cmd: f[5], payload: Buffer.from(f.subarray(6)) });
    }
  }
}

// Header checksum: the 16 little-endian u32 words of bytes 0-63 add up to 0 (mod 2^32).
function headerSum(p) { let s = 0; for (let o = 0; o < HEADER; o += 4) s = (s + p.readUInt32LE(o)) >>> 0; return s; }
function setHeaderChecksum(p) { p.writeUInt32LE(0, 4); p.writeUInt32LE((0x100000000 - headerSum(p)) >>> 0, 4); }

// Settings this app reads and writes: every option Zaxcom's VRX app 1.1.0 offers, each seen written (two captures);
// any other value a unit holds is shown as VALUE_<n> and left untouched.
const FIELDS = {
  bootAnnounce: { off: 29, bool: true },
  hphMode: { off: 32, map: { MONO: 0, STEREO: 1, BALANCED: 2 } },
  led: { off: 33, map: { OFF: 0, ON: 1, DIM: 2 } },
  abButton: { off: 35, map: { OFF: 0, CHANNEL: 1, DELAY: 2, ANNOUNCE: 3 } },
  starButton: { off: 36, map: { OFF: 0, CHANNEL: 1, DELAY: 2, ANNOUNCE: 3 } },
  compander: { off: 38, map: { OFF: 0, COMPANDER1: 1, COMPANDER2: 2 } },
  batteryType: { off: 39, map: { NIMH: 0, ALKALINE: 1, LITHIUM: 2 } },
  audioEq: { off: 44, map: { NORMAL: 0, BOOST_LOW: 1, BOOST_HIGH: 2 } },
  gainBoost: { off: 45, bool: true },
  // Zaxcom's app lists these OFF, RIGHT, LEFT, CENTER (values 0-3).
  voicePromptsEnable: { off: 48, map: { OFF: 0, RIGHT: 1, LEFT: 2, CENTER: 3 } },
  squelch: { off: 49, map: { LOW: 0x50, MED: 0x28, HIGH: 0x0a } }
};
// Typed settings: delay in ms (u16 at 30) and the 6-digit hex encryption code (u32 at 40).
const DELAY_OFF = 30, ENC_OFF = 40;
// What the page may offer (true = shown; a list = the options it may offer).
const CAPS = { delayMs: true, encryption: true };
Object.keys(FIELDS).forEach((k) => { CAPS[k] = FIELDS[k].bool ? true : Object.keys(FIELDS[k].map); });

function check(p) {
  if (p.length < HEADER) return 'settings too short (' + p.length + ' bytes)';
  if (p.readUInt32LE(0) !== MAGIC) return 'unknown settings marker';
  if (p[28] !== STRUCT_VERSION) return 'settings layout ' + p[28] + ' (this app knows layout ' + STRUCT_VERSION + ')';
  const n = p[46];
  if (p.length !== HEADER + CH_SIZE * n) return 'channel count ' + n + ' does not match ' + p.length + ' bytes';
  return '';
}

function decode(p) {
  const why = check(p);
  if (why) return { error: why };
  const o = {};
  o.unitName = p.subarray(8, 24).toString('latin1').replace(/\0.*$/s, '');
  o.unitSerialNum = p.readUInt32LE(24);
  for (const [k, f] of Object.entries(FIELDS)) {
    const b = p[f.off];
    if (f.bool) o[k] = b === 0 ? false : b === 1 ? true : 'VALUE_' + b;
    else { const name = Object.keys(f.map).find((x) => f.map[x] === b); o[k] = name || 'VALUE_' + b; }
  }
  o.delayMs = String(p.readUInt16LE(DELAY_OFF));
  o.encryption = p.readUInt32LE(ENC_OFF).toString(16).toUpperCase().padStart(6, '0');
  o.channelCount = p[46];
  o.minFreq = p.readUInt32LE(52);
  o.maxFreq = p.readUInt32LE(56);
  o.channels = [];
  for (let i = 0; i < o.channelCount; i++) {
    const c = HEADER + CH_SIZE * i;
    o.channels.push({ channelNumber: i + 1, frequency: p.readUInt32LE(c), delayEnable: p[c + 5] === 1, votingEnable: p[c + 6] === 1, channelEnable: p[c + 7] === 1 });
  }
  o.headerChecksumOk = headerSum(p) === 0;
  return o;
}

// Builds the bytes to write: the unit's own last-read settings with the requested changes applied.
// Bytes this app doesn't understand are sent back exactly as the unit reported them.
function encode(rawLast, want) {
  const why = check(rawLast);
  if (why) throw new Error('Not written: ' + why + '.');
  const p = Buffer.from(rawLast);
  if (want.unitName !== undefined) {
    const n = String(want.unitName);
    if (!/^[\x20-\x7e]{1,15}$/.test(n)) throw new Error('Unit name must be 1-15 plain characters.');
    p.fill(0, 8, 24); p.write(n, 8, 'latin1');
  }
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = want[k];
    if (v === undefined || /^VALUE_/.test(String(v))) continue;
    if (f.bool) { if (typeof v !== 'boolean') throw new Error(k + ' must be on or off.'); p[f.off] = v ? 1 : 0; }
    else { if (!(v in f.map)) throw new Error(k + ' value ' + v + ' is not supported by this app.'); p[f.off] = f.map[v]; }
  }
  if (want.delayMs !== undefined && String(want.delayMs) !== '') {
    const d = Number(want.delayMs);
    if (!Number.isInteger(d) || d < 0 || d > 65535) throw new Error('Delay must be a whole number of ms.');
    p.writeUInt16LE(d, DELAY_OFF);
  }
  if (want.encryption !== undefined) {
    if (!/^[0-9A-Fa-f]{6}$/.test(String(want.encryption))) throw new Error('Encryption must be exactly 6 hex digits.');
    p.writeUInt32LE(parseInt(want.encryption, 16), ENC_OFF);
  }
  const n = p[46], lo = Math.min(p.readUInt32LE(52), p.readUInt32LE(56)), hi = Math.max(p.readUInt32LE(52), p.readUInt32LE(56));
  const chans = want.channels || [];
  for (let i = 0; i < n; i++) {
    const c = HEADER + CH_SIZE * i, w = chans[i];
    p[c + 4] = i + 1; // channel number, 1-based, as Zaxcom's app sends it
    if (!w) continue;
    const f = Number(w.frequency);
    if (!Number.isInteger(f) || (lo && hi && (f < lo || f > hi))) throw new Error('CH ' + (i + 1) + ' frequency ' + f + ' kHz is outside ' + lo + '-' + hi + ' kHz.');
    p.writeUInt32LE(f, c);
    p[c + 5] = w.delayEnable ? 1 : 0; p[c + 6] = w.votingEnable ? 1 : 0; p[c + 7] = w.channelEnable ? 1 : 0;
  }
  setHeaderChecksum(p);
  return p;
}

// Which of the requested settings a unit's report doesn't show (after a write).
function differences(want, got) {
  const out = [];
  if (want.unitName !== undefined && want.unitName !== got.unitName) out.push('name');
  if (want.delayMs !== undefined && String(want.delayMs) !== '' && String(Number(want.delayMs)) !== got.delayMs) out.push('delayMs');
  if (want.encryption !== undefined && String(want.encryption).toUpperCase() !== got.encryption) out.push('encryption');
  for (const k of Object.keys(FIELDS)) if (want[k] !== undefined && !/^VALUE_/.test(String(want[k])) && want[k] !== got[k]) out.push(k);
  (want.channels || []).forEach((w, i) => {
    const g = got.channels[i]; if (!g) return;
    ['frequency', 'delayEnable', 'votingEnable', 'channelEnable'].forEach((k) => { if ((k === 'frequency' ? Number(w[k]) : !!w[k]) !== g[k]) out.push('CH ' + (i + 1) + ' ' + k); });
  });
  return out;
}

module.exports = { frame, READ_REQUEST, Deframer, decode, encode, differences, setHeaderChecksum, headerSum, check, FIELDS, CAPS, MAGIC, HEADER, CH_SIZE };
