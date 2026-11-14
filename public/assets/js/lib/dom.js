// Tiny DOM toolkit: hyperscript, toasts, modals and formatting helpers.
export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) { if (part[0] === '#') el.id = part.slice(1); else el.classList.add(part.slice(1)); }
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); append(el, kids); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(text, kind = '', ms = 4200, onClick = null) {
  const root = document.getElementById('toasts');
  const el = h('.toast', { class: kind }, text);
  const gone = () => el.remove();
  el.addEventListener('click', () => { if (onClick) onClick(); gone(); });
  root.append(el);
  setTimeout(gone, ms);
  return el;
}

// modal(title, bodyNode | (close) => node, { wide }) -> close()
export function modal(title, body, { wide = false, onClose = null } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const box = h('.modal', { class: wide ? 'wide' : '', role: 'dialog', 'aria-modal': 'true' }, title ? h('h2', title) : null, typeof body === 'function' ? body(close) : body);
  const back = h('.modal-back', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
  document.addEventListener('keydown', esc);
  root.append(back);
  return close;
}

export function confirmDialog(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    let answered = false;
    modal(title, (close) => h('div', h('p.muted', text), h('.row', { style: { justifyContent: 'flex-end' } },
      h('button.btn', { onclick: () => { answered = true; close(); resolve(false); } }, 'Cancel'),
      h('button.btn.primary', { onclick: () => { answered = true; close(); resolve(true); } }, okLabel))), { onClose: () => { if (!answered) resolve(false); } });
  });
}

export const fmtClock = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return '–';
  ms = Math.max(0, ms);
  const total = Math.floor(ms / 1000), hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
  if (hh) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  if (ms < 10_000) return `${mm}:${String(ss).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
};

export const fmtDuration = (ms) => {
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 86_400_000), hr = Math.floor((ms % 86_400_000) / 3_600_000), mn = Math.floor((ms % 3_600_000) / 60_000);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${mn}m` : `${Math.max(1, mn)}m`;
};

export const timeAgo = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
};

export const fmtEval = (cp, mate) => {
  if (mate === 'W') return '1-0';
  if (mate === 'B') return '0-1';
  if (mate != null) return (mate > 0 ? '+M' : '-M') + Math.abs(mate);
  if (cp == null) return '0.0';
  const v = cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
};

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const copyText = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } }); document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } };
export const download = (name, text, type = 'text/plain') => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
