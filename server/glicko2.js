// Glicko-2 rating system (Glickman, 2012). One game = one rating period.
const SCALE = 173.7178;
const TAU = 0.5;
const EPS = 1e-6;
export const DEFAULT_RATING = { rating: 1200, rd: 350, vol: 0.06 };

const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * @param {{rating:number, rd:number, vol:number}} player
 * @param {{rating:number, rd:number, score:number}[]} results  score: 1 win, 0.5 draw, 0 loss
 * @param {number} idlePeriods  rating periods elapsed without play (inflates RD first)
 */
export function glicko2(player, results, idlePeriods = 0) {
  const mu = (player.rating - 1500) / SCALE;
  let phi = player.rd / SCALE;
  const sigma = player.vol;
  if (idlePeriods > 0) phi = Math.sqrt(phi * phi + idlePeriods * sigma * sigma);
  if (!results.length) return { rating: player.rating, rd: Math.min(350, phi * SCALE), vol: sigma };

  let vInv = 0, deltaSum = 0;
  for (const r of results) {
    const muJ = (r.rating - 1500) / SCALE, phiJ = r.rd / SCALE;
    const gj = g(phiJ), e = E(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // volatility via the Illinois algorithm
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (TAU * TAU);
  };
  let A = a, B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;
  return {
    rating: Math.max(100, Math.min(4000, muNew * SCALE + 1500)),
    rd: Math.max(30, Math.min(350, phiNew * SCALE)),
    vol: Math.max(0.01, Math.min(0.2, sigmaNew)),
  };
}

export const expectedScore = (a, b) => E((a.rating - 1500) / SCALE, (b.rating - 1500) / SCALE, b.rd / SCALE);
