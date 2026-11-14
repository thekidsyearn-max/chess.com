// Private challenge link: /play/friend/:inviteCode
import { h, mount, toast, copyText } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate, VARIANT_NAMES } from '../lib/state.js';

export default async function friendView(root, [code]) {
  let ch;
  try { ({ challenge: ch } = await api.get(`/api/challenges/${code}`)); }
  catch (e) { mount(root, h('.page.narrow', h('.card.empty', h('h2', 'Invite not found'), h('p.muted', e.message), h('a.btn.primary', { href: '/play' }, 'Back to play')))); return; }
  if (ch.gameId) { navigate(`/game/${ch.gameId}`, { replace: true }); return; }
  const link = `${location.origin}/play/friend/${code}`;
  const details = h('p.muted', `${VARIANT_NAMES[ch.variant]} · ${ch.tc.replace('+', ' | ')} · ${ch.rated ? 'Rated' : 'Casual'} · ${ch.creator} plays ${ch.color === 'random' ? 'a random colour' : ch.color}`);
  let timer = null;
  if (ch.expired) mount(root, h('.page.narrow', h('.card.empty', h('h2', 'This invite has expired'), h('a.btn.primary', { href: '/play' }, 'Create a new one'))));
  else if (ch.mine) {
    const input = h('input.input', { value: link, readonly: true, onclick: (e) => e.target.select() });
    mount(root, h('.page.narrow', h('.card.col', h('h1', '🤝 Challenge a friend'), details,
      h('.row', input, h('button.btn.primary', { onclick: async () => { await copyText(link); toast('Invite link copied', 'ok'); } }, 'Copy link')),
      h('.seeking', h('span.spinner'), h('.grow', h('b', 'Waiting for your friend to open the link…'), h('.muted.small', 'The game starts automatically. You can keep this tab open.'))))));
    // fall back to polling in case the socket notification is missed
    timer = setInterval(async () => { try { const r = await api.get(`/api/challenges/${code}`); if (r.challenge.gameId) navigate(`/game/${r.challenge.gameId}`); } catch { /* keep waiting */ } }, 4000);
  } else {
    mount(root, h('.page.narrow', h('.card.col.center', h('h1', `${ch.creator} challenges you`), details,
      h('button.btn.primary.big', { onclick: async (e) => { e.target.disabled = true; try { const r = await api.post(`/api/challenges/${code}/accept`); navigate(`/game/${r.gameId}`); } catch (ex) { toast(ex.message, 'err'); e.target.disabled = false; } } }, 'Accept challenge'))));
  }
  return () => clearInterval(timer);
}
