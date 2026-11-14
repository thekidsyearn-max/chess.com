// Shared session state and navigation hooks (kept separate to avoid import cycles).
export const session = { user: null, ratings: {}, build: '', version: '' };

let navigator_ = (path) => { location.href = path; };
export const setNavigator = (fn) => { navigator_ = fn; };
export const navigate = (path, opts) => navigator_(path, opts);

export const VARIANT_NAMES = { standard: 'Standard', chess960: 'Chess960', koth: 'King of the Hill', threecheck: 'Three-Check', crazyhouse: 'Crazyhouse', atomic: 'Atomic' };
export const VARIANT_BLURB = {
  standard: 'Classical chess rules.',
  chess960: 'Fischer Random: one of 960 shuffled back ranks, normal rules, generalised castling.',
  koth: 'King of the Hill: march your king to d4, e4, d5 or e5 to win instantly.',
  threecheck: 'Three-Check: give check three times to win.',
  crazyhouse: 'Crazyhouse: captured pieces change sides and can be dropped back on the board.',
  atomic: 'Atomic: every capture explodes the surrounding pieces. Blow up the enemy king.',
};
export const SPEED_NAMES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily', unlimited: 'Unlimited', imported: 'Imported' };
export const SPEED_ICON = { bullet: '🚀', blitz: '⚡', rapid: '⏱', daily: '☀️', unlimited: '∞', imported: '📥' };
export const CATEGORY_NAMES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily', puzzle: 'Puzzles', chess960: 'Chess960', koth: 'King of the Hill', threecheck: 'Three-Check', crazyhouse: 'Crazyhouse', atomic: 'Atomic' };

export const REASONS = {
  checkmate: 'by checkmate', stalemate: 'by stalemate', insufficient: 'by insufficient material', fifty: 'by the 50-move rule', repetition: 'by threefold repetition',
  explosion: 'by king explosion', hill: 'by reaching the hill', threecheck: 'by three checks', resign: 'by resignation', timeout: 'on time', abandon: 'by abandonment',
  agreement: 'by agreement', aborted: 'Game aborted', 'timeout-insufficient': 'timeout vs insufficient material', 'server-restart': 'Server restarted',
  'drill-complete': 'Drill complete', 'drill-failed': 'Drill failed',
};

export function resultText(game) {
  if (game.status === 'aborted') return 'Game aborted';
  const r = game.result;
  if (r === '1/2-1/2') return `Draw ${REASONS[game.reason] || ''}`.trim();
  if (r === '1-0' || r === '0-1') return `${r === '1-0' ? 'White' : 'Black'} wins ${REASONS[game.reason] || ''}`.trim();
  return 'In progress';
}
