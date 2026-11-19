/* vrx-link.js: VRX Editor's stand-in for the GuiBridge link, so the same VRX page runs against
 * the local USB server (server.js) instead of the bridge. Same calls the page uses:
 * state.vrx / state.presets, subscribe, connected, vrxWrite, vrxWaitFor, vrxPresets, plus vrxCaps. */
(function () {
  'use strict';
  const state = { vrx: null, presets: null, info: null };
  const subs = new Set();
  let ok = false, failSince = 0;
  const emit = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, method, body) {
    const r = await fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    return d;
  }
  let presetsHeldUntil = 0;
  async function poll() {
    try {
      const d = await api('/api/state');
      state.vrx = d.vrx; state.portErrors = d.portErrors || []; state.info = { version: d.version, simulate: d.simulate, usb: d.usb };
      if (Date.now() > presetsHeldUntil) state.presets = d.presets;
      link.vrxCaps = d.caps;
      ok = true; failSince = 0;
    } catch (e) {
      if (!failSince) failSince = Date.now();
      if (Date.now() - failSince > 3000) ok = false;
    }
    emit();
  }
  const link = {
    state,
    vrxCaps: null,
    waitText: 'Starting VRX Editor…',
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    connected() { return ok; },
    async vrxWrite(n) {
      const r = await api('/api/write', 'POST', n);
      await poll();
      return r;
    },
    async vrxWaitFor(uuid, check, timeoutMs) {
      const t0 = Date.now();
      while (Date.now() - t0 < (timeoutMs || 15000)) {
        const u = ((state.vrx && state.vrx.vrxs) || []).find((v) => v.uuid === uuid);
        if (u && !u.needsRead && check(u)) return true;
        await sleep(500); await poll();
      }
      return false;
    },
    async vrxPresets(presets) {
      await api('/api/presets', 'PUT', { presets });
      state.presets = { presets: JSON.parse(JSON.stringify(presets)) }; presetsHeldUntil = Date.now() + 1500; emit();
    }
  };
  window.GuiBridgeLink = link;
  poll();
  setInterval(poll, 1000);
})();
