// Smoke test for a built VRX Editor (any system): starts its server with two simulated VRX units, reads them,
// writes a change and checks it was confirmed, and checks the page is served.
//   node test/smoke.js --server <folder with server.js> [--runner <node or Electron binary>] [--expect-serial serialport]
//   node test/smoke.js --gui <app binary> --data <its data folder> [-- extra app args]
//     (opens the real app with --simulate and checks its server answers, then closes it)
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const a = process.argv.slice(2);
const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const extra = a.includes('--') ? a.slice(a.indexOf('--') + 1) : [];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function req(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ code: res.statusCode, text: s }));
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function waitPort(file, ms, proc) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const p = fs.readFileSync(file, 'utf8').trim(); if (p) return Number(p); } catch (e) { /* not yet */ }
    if (proc && proc.exitCode != null) throw new Error('exited with ' + proc.exitCode);
    await sleep(200);
  }
  throw new Error('no port file after ' + ms + ' ms: ' + file);
}
function killTree(p) {
  if (!p || p.exitCode != null) return;
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' }); } catch (e) { /* gone */ } }
  else { try { process.kill(-p.pid, 'SIGTERM'); } catch (e) { try { p.kill('SIGTERM'); } catch (e2) { /* gone */ } } }
}

async function checkServer(port, logFile) {
  let st;
  for (let i = 0; i < 50; i++) {
    st = JSON.parse((await req(port, 'GET', '/api/state')).text);
    if (st.vrx.vrxs.length === 2 && st.vrx.vrxs.every((u) => !u.needsRead)) break;
    await sleep(200);
  }
  ok(st.simulate && st.vrx.vrxs.length === 2 && st.vrx.vrxs.every((u) => !u.needsRead), 'two simulated units read: ' + st.vrx.vrxs.map((u) => u.unitName).join(', '));
  const u = st.vrx.vrxs[0];
  const want = Object.assign({}, u, { unitName: 'SMOKE-1', squelch: 'HIGH' });
  const w = JSON.parse((await req(port, 'POST', '/api/write', want)).text);
  ok(w.ok && w.confirmed, 'write confirmed: ' + JSON.stringify(w));
  st = JSON.parse((await req(port, 'GET', '/api/state')).text);
  const after = st.vrx.vrxs.find((x) => x.unitSerialNum === u.unitSerialNum);
  ok(after && after.unitName === 'SMOKE-1' && after.squelch === 'HIGH', 'unit reads back the change');
  const page = await req(port, 'GET', '/');
  ok(page.code === 200 && /<title>VRX Editor<\/title>/.test(page.text), 'page served');
  const js = await req(port, 'GET', '/sources.js');
  ok(js.code === 200 && js.text.length > 10000, 'page sources served');
  return st;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrx-smoke-'));
  if (arg('--server')) {
    const dir = path.resolve(arg('--server'));
    const runner = arg('--runner') ? path.resolve(arg('--runner')) : process.execPath;
    const pf = path.join(tmp, 'port'), log = path.join(tmp, 'app.log');
    const p = spawn(runner, [path.join(dir, 'server.js'), '--no-open', '--port', '0', '--simulate', '2', '--data', tmp, '--port-file', pf, '--log', log],
      { cwd: dir, env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), stdio: 'inherit', detached: process.platform !== 'win32' });
    try {
      const port = await waitPort(pf, 20000, p);
      const st = await checkServer(port, log);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      ok(st.version === pkg.version, 'version ' + st.version);
      const first = fs.readFileSync(log, 'utf8').split('\n').find((l) => / at http/.test(l)) || '';
      console.log('     ' + first.replace(/^\S+ /, ''));
      if (arg('--expect-serial')) ok(first.includes('serial: ' + arg('--expect-serial')), 'serial library: ' + arg('--expect-serial'));
      if (process.platform === 'win32') {
        // The real Windows port listing (registry + PowerShell) runs without errors.
        const P = require(path.join(dir, 'ports.js'));
        const list = await new Promise((r) => P.scan((e, l) => r(e ? e.message : l)));
        ok(Array.isArray(list), 'COM port scan works: ' + JSON.stringify(list));
        const sp = new P.SerialPort('COM250').start();
        const why = await new Promise((r) => sp.on('close', r));
        ok(/could not open COM250/.test(why), 'a missing port is reported: ' + why);
      }
    } catch (e) { ok(false, e.message); }
    killTree(p);
  }
  if (arg('--gui')) {
    const data = path.resolve(arg('--data'));
    fs.mkdirSync(data, { recursive: true });
    const pf = path.join(data, 'port'); try { fs.unlinkSync(pf); } catch (e) { /* none */ }
    const p = spawn(path.resolve(arg('--gui')), ['--simulate', '2'].concat(extra), { stdio: 'inherit', detached: process.platform !== 'win32' });
    try {
      const port = await waitPort(pf, 60000, p);
      await checkServer(port);
      ok(p.exitCode == null, 'app still running with its window');
    } catch (e) {
      ok(false, 'app: ' + e.message);
      try { console.log(fs.readFileSync(path.join(data, 'app.log'), 'utf8').slice(-3000)); } catch (e2) { /* no log */ }
    }
    killTree(p);
  }
  await sleep(500);
  console.log(fails ? fails + ' FAILED' : 'smoke test passed');
  process.exit(fails ? 1 : 0);
})();
