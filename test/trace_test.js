// Checks vrx.js against the frames in Zaxcom's app trace (simulate mode).
const fs = require('fs'), V = require('../app/vrx');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const tx = [], rx = {};
for (const l of lines) {
  const m = l.match(/^vrx\s+([\d.]+) (\S+) (tx|rx) ((?:[0-9a-f]{2} ?)+)$/); if (!m) continue;
  const b = Buffer.from(m[4].replace(/ /g, ''), 'hex');
  if (m[3] === 'tx') tx.push({ t: +m[1], u: m[2], b }); else (rx[m[2]] = rx[m[2]] || []).push({ t: +m[1], b });
}
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
// 1. read request
ok(tx[0].b.equals(V.READ_REQUEST), 'read request bytes');
// 2. deframe every unit's receive stream
const frames = {};
for (const u of Object.keys(rx)) { frames[u] = []; const d = new V.Deframer((f) => frames[u].push(Object.assign(f, { t: 0 }))); rx[u].forEach((c) => d.push(c.b)); }
// replay with times: attach time of chunk that completed the frame
const timed = {};
for (const u of Object.keys(rx)) { timed[u] = []; let cur = 0; const d = new V.Deframer((f) => timed[u].push(Object.assign(f, { t: cur }))); rx[u].forEach((c) => { cur = c.t; d.push(c.b); }); }
const sets = timed.SIM0001.filter((f) => f.cmd === 0x80);
ok(sets.length > 10, 'settings frames from SIM0001: ' + sets.length);
ok(timed.SIM0001.filter((f) => f.cmd === 0x20).every((f) => /^VRX 9\.99 sn1001/.test(f.payload.toString('latin1'))), 'info frames');
const d0 = V.decode(sets[0].payload);
ok(d0.unitName === 'SIM-1001' && d0.unitSerialNum === 1001 && d0.channelCount === 10 && d0.minFreq === 215000 && d0.maxFreq === 217000, 'decode basics ' + JSON.stringify(d0).slice(0, 200));
ok(d0.channels[0].frequency === 215180 && d0.channels[0].channelEnable && !d0.channels[1].channelEnable, 'decode channels');
if (!process.argv[3]) ok(d0.hphMode === 'MONO' && d0.led === 'ON' && d0.squelch === 'MED' && d0.abButton === 'CHANNEL' && d0.starButton === 'ANNOUNCE' && d0.batteryType === 'ALKALINE' && d0.compander === 'OFF' && d0.audioEq === 'NORMAL' && d0.voicePromptsEnable === 'OFF' && d0.bootAnnounce === false && d0.gainBoost === false, 'decode settings ' + JSON.stringify(d0));
const s2 = V.decode(timed.SIM0002.find((f) => f.cmd === 0x80).payload);
ok(s2.channelCount === 8 && s2.minFreq === 192000 && s2.maxFreq === 216975, 'SIM0002 decode');
// 3. every write the app made == encode(last settings the unit reported before it, decoded write)
const writes = tx.filter((x) => x.b.length > 20);
ok(writes.length > 0, 'writes ' + writes.length);
writes.forEach((w, i) => {
  const before = sets.filter((f) => f.t < w.t).pop();
  const want = V.decode(w.b.subarray(6));
  const mine = V.frame(0x80, V.encode(before.payload, want));
  ok(mine.equals(w.b), 'write ' + (i + 1) + ' byte-identical');
  if (!mine.equals(w.b)) { for (let k = 0; k < mine.length; k++) if (mine[k] !== w.b[k]) console.log('  byte', k, mine[k].toString(16), w.b[k].toString(16)); }
  const after = sets.find((f) => f.t > w.t + 0.5);
  if (after) ok(V.differences(want, V.decode(after.payload)).length === 0, 'write ' + (i + 1) + ' confirmed by next read: ' + V.differences(want, V.decode(after.payload)));
});
console.log(fails ? fails + ' failed' : 'all trace checks pass');
process.exit(fails ? 1 : 0);
