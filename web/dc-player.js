/* dc-player.js — runs the GuiBridge redesign pages (.dc.html canvas format) as a plain offline web app.
 * Supports what those pages use: {{holes}}, <sc-for>, <sc-if>, <dc-import>, on* handlers,
 * <helmet> styles, links between pages, and class Component extends DCLogic with setState.
 * No libraries, no network. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; if (!this.state) this.state = {}; }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, next);
      if (this.__inst) this.__inst.schedule();
    }
    forceUpdate() { if (this.__inst) this.__inst.schedule(); }
  }
  window.DCLogic = DCLogic;

  const DEFS = {};          // component name -> { tpl, Cls }
  const HELMETS = new Set();

  // ---------- loading ----------
  function prep(src) {
    // <sc-for>, <sc-if>, <dc-import> become <template>s so the HTML parser keeps them anywhere (even inside <select>).
    return src
      .replace(/<sc-for\b/g, '<template data-sc="for"').replace(/<\/sc-for>/g, '</template>')
      .replace(/<sc-if\b/g, '<template data-sc="if"').replace(/<\/sc-if>/g, '</template>')
      .replace(/<dc-import\b/g, '<template data-sc="import"').replace(/<\/dc-import>/g, '</template>');
  }
  function define(name, src) {
    const doc = new DOMParser().parseFromString(prep(src), 'text/html');
    const root = doc.querySelector('x-dc');
    const helmet = root.querySelector('helmet');
    if (helmet) { helmet.remove(); }
    const script = doc.querySelector('script[data-dc-script]');
    const Cls = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic);
    DEFS[name] = { tpl: root, Cls, helmet };
  }
  function injectHelmet(name) {
    const d = DEFS[name];
    if (HELMETS.has(name) || !d.helmet) return;
    HELMETS.add(name);
    d.helmet.querySelectorAll('style').forEach((s) => {
      const el = document.createElement('style');
      el.textContent = s.textContent;
      document.head.appendChild(el);
    });
  }

  // ---------- holes ----------
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const ONE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    const parts = path.split('.');
    let v;
    for (let i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { v = scope[i][parts[0]]; break; }
    }
    for (let k = 1; k < parts.length && v != null; k++) v = v[parts[k]];
    return v;
  }
  const str = (v) => (v == null || v === false ? (v === false ? 'false' : '') : String(v));
  function interp(text, scope) { return text.replace(HOLE, (_, p) => str(lookup(p, scope))); }
  function attrValue(text, scope) { const m = text.match(ONE); return m ? lookup(m[1], scope) : interp(text, scope); }

  // ---------- building ----------
  const BOOL_PROPS = { disabled: 1, checked: 1, selected: 1, readonly: 1, readOnly: 1, hidden: 1 };
  function eventName(attr, el) {
    const ev = attr.slice(2).toLowerCase();
    if (ev === 'change') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && t !== 'checkbox' && t !== 'radio')) return 'input';
    }
    return ev;
  }
  function dispatch(e) { const h = e.currentTarget.__dcOn && e.currentTarget.__dcOn[e.type]; if (h) h(e); }
  function ensureListeners(el) {
    if (!el.__dcOn) return;
    el.__dcBound = el.__dcBound || {};
    Object.keys(el.__dcOn).forEach((t) => { if (!el.__dcBound[t]) { el.addEventListener(t, dispatch); el.__dcBound[t] = true; } });
  }

  function buildChildren(tplParent, scope, out) {
    const kids = tplParent.content ? tplParent.content.childNodes : tplParent.childNodes;
    for (const n of kids) buildNode(n, scope, out);
  }
  function buildNode(n, scope, out) {
    if (n.nodeType === 3) { out.appendChild(document.createTextNode(interp(n.data, scope))); return; }
    if (n.nodeType !== 1) return;
    if (n.tagName === 'TEMPLATE' && n.dataset.sc) {
      const kind = n.dataset.sc;
      if (kind === 'for') {
        const list = attrValue(n.getAttribute('list') || '', scope) || [];
        const as = n.getAttribute('as') || 'item';
        list.forEach((item, i) => buildChildren(n, scope.concat([{ [as]: item, $index: i }]), out));
      } else if (kind === 'if') {
        if (attrValue(n.getAttribute('value') || '', scope)) buildChildren(n, scope, out);
      } else if (kind === 'import') {
        const host = document.createElement('dc-host');
        host.style.display = 'contents';
        const props = {};
        let name = '';
        for (const a of n.attributes) {
          if (a.name === 'name') { name = a.value; continue; }
          if (a.name === 'data-sc' || a.name.indexOf('hint-') === 0) continue;
          const key = a.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          props[key] = attrValue(a.value, scope);
        }
        host.__dcHost = { name, props };
        host.setAttribute('data-c', name);
        out.appendChild(host);
      }
      return;
    }
    const el = n.namespaceURI && n.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(n.namespaceURI, n.localName)
      : document.createElement(n.localName);
    const props = {};
    for (const a of n.attributes) {
      const name = a.name;
      if (/^on[a-z]+$/i.test(name) && ONE.test(a.value)) {
        const fn = attrValue(a.value, scope);
        if (typeof fn === 'function') { el.__dcOn = el.__dcOn || {}; el.__dcOn[eventName(name, n)] = fn; }
        continue;
      }
      const v = attrValue(a.value, scope);
      if (BOOL_PROPS[name] || BOOL_PROPS[name.toLowerCase()]) { props[name.toLowerCase()] = !!v && v !== 'false'; continue; }
      if (name === 'value' && (n.localName === 'input' || n.localName === 'textarea' || n.localName === 'select')) { props.value = str(v); continue; }
      if (v === undefined || v === null) continue;
      el.setAttribute(name, typeof v === 'boolean' ? String(v) : str(v));
    }
    el.__dcProps = props;
    if (n.localName !== 'select') buildChildren(n, scope, el); else buildChildren(n, scope, el);
    applyProps(el, props);
    ensureListeners(el);
    out.appendChild(el);
  }
  function applyProps(el, props) {
    if ('disabled' in props) { el.disabled = props.disabled; if (props.disabled) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }
    if ('checked' in props) el.checked = props.checked;
    if ('readonly' in props) el.readOnly = props.readonly;
    if ('hidden' in props) el.hidden = props.hidden;
    if ('value' in props && el.value !== props.value) el.value = props.value;
  }

  // ---------- morphing (keeps focus and caret while typing) ----------
  function morphChildren(live, next) {
    const L = Array.from(live.childNodes), N = Array.from(next.childNodes);
    for (let i = 0; i < N.length; i++) {
      const n = N[i], l = L[i];
      if (!l) { live.appendChild(n); mountHosts(n); continue; }
      if (l.nodeType === 3 && n.nodeType === 3) { if (l.data !== n.data) l.data = n.data; continue; }
      if (l.nodeType === 1 && n.nodeType === 1 && l.localName === n.localName && l.namespaceURI === n.namespaceURI &&
          (!n.__dcHost || (l.__dcInst && l.__dcInst.name === n.__dcHost.name))) {
        morphEl(l, n);
        continue;
      }
      unmountHosts(l);
      live.replaceChild(n, l);
      mountHosts(n);
    }
    for (let i = N.length; i < L.length; i++) { unmountHosts(L[i]); live.removeChild(L[i]); }
  }
  function morphEl(l, n) {
    if (n.__dcHost) { l.__dcInst.update(n.__dcHost.props); return; }
    for (const a of Array.from(l.attributes)) if (!n.hasAttribute(a.name)) l.removeAttribute(a.name);
    for (const a of Array.from(n.attributes)) if (l.getAttribute(a.name) !== a.value) l.setAttribute(a.name, a.value);
    l.__dcOn = n.__dcOn;
    ensureListeners(l);
    if (l.__dcOn == null && l.__dcBound) l.__dcOn = {};
    if (l.localName === 'select') { morphChildren(l, n); applyProps(l, n.__dcProps || {}); return; }
    morphChildren(l, n);
    applyProps(l, n.__dcProps || {});
  }
  function hostsIn(node) {
    if (node.nodeType !== 1) return [];
    const list = node.__dcHost ? [node] : [];
    return list.concat(Array.from(node.querySelectorAll('dc-host')));
  }
  function mountHosts(node) { hostsIn(node).forEach((h) => { if (!h.__dcInst && h.__dcHost) new Inst(h.__dcHost.name, h.__dcHost.props, h); }); }
  function unmountHosts(node) { hostsIn(node).forEach((h) => { if (h.__dcInst) h.__dcInst.unmount(); }); }

  // ---------- instances ----------
  class Inst {
    constructor(name, props, host) {
      if (!DEFS[name]) throw new Error('Unknown component ' + name);
      this.name = name; this.host = host; this.pending = false;
      host.__dcInst = this;
      injectHelmet(name);
      this.logic = new DEFS[name].Cls(props || {});
      this.logic.props = props || {};
      this.logic.__inst = this;
      this.render();
      if (this.logic.componentDidMount) this.logic.componentDidMount();
    }
    update(props) { this.logic.props = props || {}; this.render(); }
    schedule() { if (this.pending) return; this.pending = true; Promise.resolve().then(() => { this.pending = false; if (this.host.isConnected) this.render(); }); }
    render() {
      const vals = this.logic.renderVals() || {};
      const out = document.createElement('div');
      buildChildren(DEFS[this.name].tpl, [vals], out);
      morphChildren(this.host, out);
    }
    unmount() { if (this.logic.componentWillUnmount) this.logic.componentWillUnmount(); }
  }

  // ---------- pages ----------
  const PAGES = {};
  function show(page) {
    const app = document.getElementById('app');
    Object.keys(PAGES).forEach((k) => { PAGES[k].style.display = k === page ? '' : 'none'; });
    if (!PAGES[page]) {
      const host = document.createElement('div');
      host.className = 'dc-page';
      app.appendChild(host);
      PAGES[page] = host;
      new Inst(page, {}, host);
    }
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const m = a.getAttribute('href').match(/^(?:\.\/)?([A-Za-z0-9_.-]+)\.dc\.html$/);
    if (m && DEFS[m[1]]) { e.preventDefault(); location.hash = m[1]; }
    else if (a.getAttribute('href') === '#') e.preventDefault();
  });
  window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (DEFS[p]) show(p); });

  window.DCPlayer = {
    start(start) {
      document.querySelectorAll('script[type="text/x-dc-source"]').forEach((s) => define(s.dataset.name, s.textContent));
      const p = location.hash.slice(1);
      show(DEFS[p] ? p : start);
    }
  };
})();
