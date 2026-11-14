// Endgame & checkmate drills. Stockfish plays the other side at full strength.
//   goal 'mate'  — deliver checkmate
//   goal 'win'   — promote safely / reach a decisive material edge (or mate)
//   goal 'draw'  — hold the draw as the defender
export const DRILLS = [
  { id: 'kqk', name: 'King + Queen vs King', category: 'Checkmates', goal: 'mate', userColor: 'w', par: 14,
    fen: '8/8/8/3k4/8/8/8/KQ6 w - - 0 1',
    description: 'Box the king in with the queen a knight\'s move away, bring your own king up, and mate on the edge.',
    tips: ['Keep the queen a knight-move from the enemy king to shrink its box.', 'Watch out for stalemate when the king is in the corner.'] },
  { id: 'krk', name: 'King + Rook vs King', category: 'Checkmates', goal: 'mate', userColor: 'w', par: 20,
    fen: '8/8/8/3k4/8/8/8/KR6 w - - 0 1',
    description: 'Cut the king off with the rook, take the opposition with your king, and check when the kings face each other.',
    tips: ['The rook builds the wall; the king does the pushing.', 'Use a waiting rook move to hand the opposition to your opponent.'] },
  { id: 'kbbk', name: 'Two Bishops Mate', category: 'Checkmates', goal: 'mate', userColor: 'w', par: 24,
    fen: '8/8/8/3k4/8/8/8/KBB5 w - - 0 1',
    description: 'Use the bishops side by side as a moving wall and herd the king into a corner.',
    tips: ['Adjacent bishops control two neighbouring diagonals — a wall the king cannot cross.', 'Any corner works with two bishops.'] },
  { id: 'kbnk', name: 'Bishop + Knight Mate', category: 'Checkmates', goal: 'mate', userColor: 'w', par: 36,
    fen: '8/8/8/3k4/8/8/8/KBN5 w - - 0 1',
    description: 'The hardest basic mate: drive the king to a corner of your bishop\'s colour using the W-manoeuvre.',
    tips: ['Mate is only possible in a corner the bishop can attack.', 'The knight travels in a "W" shape along the edge to keep the king from escaping.'] },
  { id: 'opposition', name: 'King + Pawn: The Opposition', category: 'Pawn Endgames', goal: 'win', userColor: 'w', par: 14,
    fen: '8/8/8/4k3/8/4K3/4P3/8 b - - 0 1',
    description: 'Your king is in front of the pawn and Black must give way. Seize the key squares and escort the pawn home.',
    tips: ['Kings facing each other with an odd number of squares between them: whoever is NOT to move has the opposition.', 'Lead with the king, not the pawn.'] },
  { id: 'lucena', name: 'Lucena Position', category: 'Rook Endgames', goal: 'win', userColor: 'w', par: 12,
    fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
    description: 'Your pawn is on the 7th but your king is in the way. Build a bridge with the rook to shelter it from checks.',
    tips: ['First check the enemy king away from the pawn\'s file.', 'Bring the rook to the 4th rank — that is the bridge that blocks the checks.'] },
  { id: 'philidor', name: 'Philidor Position', category: 'Rook Endgames', goal: 'draw', userColor: 'b', par: 22,
    fen: '4k3/7R/r7/3KP3/8/8/8/8 b - - 0 1',
    description: 'A pawn down, but drawn with correct defence: keep your rook on the 6th rank until the pawn advances, then check from behind.',
    tips: ['Your rook on the 6th rank stops the enemy king from advancing.', 'The moment the pawn steps to the 6th, drop the rook to the 1st rank and give checks from behind.'] },
];

export const drillById = (id) => DRILLS.find((d) => d.id === id) || null;
