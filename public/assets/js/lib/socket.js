// WebSocket client: auto-reconnect, typed listeners, and server clock synchronisation.
const listeners = new Map();
let ws = null, wantOpen = false, retry = 0, pingTimer = null, reconnectTimer = null;
let rtt = 0, offset = 0, samples = 0, opened = false;
const queue = [];

function emit(type, msg) {
  const set = listeners.get(type);
  if (set) for (const fn of [...set]) { try { fn(msg); } catch (e) { console.error('socket listener', type, e); } }
}

function ping() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: performance.now(), rtt: Math.round(rtt) }));
}

function open() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0; opened = true;
    for (const m of queue.splice(0)) ws.send(JSON.stringify(m));
    ping(); setTimeout(ping, 400); setTimeout(ping, 1200);
    clearInterval(pingTimer);
    pingTimer = setInterval(ping, 5000);
    emit('open', {});
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === 'pong') {
      // round trip measured on the monotonic clock; server time estimated at the midpoint
      const sample = performance.now() - msg.c;
      rtt = samples ? rtt * 0.7 + sample * 0.3 : sample;
      const est = msg.s + sample / 2 - Date.now();
      offset = samples ? (sample <= rtt ? est : offset * 0.8 + est * 0.2) : est;
      samples++;
      return;
    }
    emit(msg.t, msg);
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    if (opened) emit('close', {});
    opened = false;
    if (!wantOpen) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(open, Math.min(8000, 400 * 2 ** retry++));
  };
  ws.onerror = () => {};
}

export const socket = {
  connect() { wantOpen = true; open(); },
  disconnect() { wantOpen = false; clearTimeout(reconnectTimer); if (ws) ws.close(); },
  reconnect() { if (ws) ws.close(); wantOpen = true; setTimeout(open, 50); },
  send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); else if (queue.length < 50) queue.push(msg); },
  on(type, fn) {
    let set = listeners.get(type);
    if (!set) listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  },
  get connected() { return !!ws && ws.readyState === 1; },
  get rtt() { return rtt; },
  // current server time in ms (local clock corrected by the measured offset)
  serverNow() { return Date.now() + offset; },
};
