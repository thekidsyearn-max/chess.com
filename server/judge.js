// Shared move-quality maths: win probability, per-move accuracy, loss buckets.
export const MATE_CP = 100_000;

// Win probability (0–100) for the side whose centipawn score is given.
export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-10_000, Math.min(10_000, cp)))) - 1);

// Engine line { cp | mate } (side-to-move POV) -> centipawns with mates mapped far out.
export const lineCp = (l) => (l.mate != null ? (l.mate > 0 ? MATE_CP - l.mate * 100 : -MATE_CP - l.mate * 100) : l.cp ?? 0);

// CAPS-style accuracy of a single move from the win-probability it gave up.
export const moveAccuracy = (wpBefore, wpAfter) => {
  const loss = Math.max(0, wpBefore - wpAfter);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
};

export function lossBucket(loss) {
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 20) return 'mistake';
  return 'blunder';
}

export const CLASS_INFO = {
  brilliant: { label: 'Brilliant', symbol: '!!' }, great: { label: 'Great Move', symbol: '!' }, best: { label: 'Best', symbol: '★' },
  excellent: { label: 'Excellent', symbol: '' }, good: { label: 'Good', symbol: '' }, book: { label: 'Book', symbol: '' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!' }, mistake: { label: 'Mistake', symbol: '?' }, blunder: { label: 'Blunder', symbol: '??' },
  miss: { label: 'Miss', symbol: '' }, forced: { label: 'Forced', symbol: '' },
};
