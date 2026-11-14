-- Rookery schema v1

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  is_guest      INTEGER NOT NULL DEFAULT 0,
  bio           TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT '',
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  rating     REAL NOT NULL DEFAULT 1200,
  rd         REAL NOT NULL DEFAULT 350,
  vol        REAL NOT NULL DEFAULT 0.06,
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  peak       REAL NOT NULL DEFAULT 1200,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category)
) WITHOUT ROWID;
CREATE INDEX idx_ratings_board ON ratings(category, rating DESC);

CREATE TABLE rating_history (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  rating     REAL NOT NULL,
  game_id    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rating_history ON rating_history(user_id, category, created_at);

CREATE TABLE games (
  id            TEXT PRIMARY KEY,
  variant       TEXT NOT NULL DEFAULT 'standard',
  chess960_id   INTEGER,
  speed         TEXT NOT NULL,
  tc_base       INTEGER NOT NULL DEFAULT 0,
  tc_inc        INTEGER NOT NULL DEFAULT 0,
  tc_days       INTEGER NOT NULL DEFAULT 0,
  rated         INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'live',
  white_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  black_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  white_name    TEXT NOT NULL,
  black_name    TEXT NOT NULL,
  white_rating  INTEGER,
  black_rating  INTEGER,
  white_diff    INTEGER,
  black_diff    INTEGER,
  bot_id        TEXT,
  owner_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  start_fen     TEXT NOT NULL,
  fen           TEXT NOT NULL,
  moves         TEXT NOT NULL DEFAULT '',
  ply           INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'playing',
  result        TEXT NOT NULL DEFAULT '*',
  reason        TEXT NOT NULL DEFAULT '',
  eco           TEXT NOT NULL DEFAULT '',
  opening       TEXT NOT NULL DEFAULT '',
  clock_w       INTEGER NOT NULL DEFAULT 0,
  clock_b       INTEGER NOT NULL DEFAULT 0,
  turn_started  INTEGER NOT NULL DEFAULT 0,
  draw_offer    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX idx_games_white ON games(white_id, created_at DESC);
CREATE INDEX idx_games_black ON games(black_id, created_at DESC);
CREATE INDEX idx_games_status ON games(status, tc_days);
CREATE INDEX idx_games_owner ON games(owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE challenges (
  code       TEXT PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant    TEXT NOT NULL,
  tc         TEXT NOT NULL,
  rated      INTEGER NOT NULL DEFAULT 0,
  color      TEXT NOT NULL DEFAULT 'random',
  game_id    TEXT,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE eco (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL,
  name  TEXT NOT NULL,
  pgn   TEXT NOT NULL,
  uci   TEXT NOT NULL,
  ply   INTEGER NOT NULL,
  key   INTEGER NOT NULL
);
CREATE INDEX idx_eco_code ON eco(code);
CREATE INDEX idx_eco_key ON eco(key);

-- every position reachable inside the opening book, with the continuing book moves
CREATE TABLE eco_moves (
  key   INTEGER NOT NULL,
  uci   TEXT NOT NULL,
  code  TEXT NOT NULL,
  name  TEXT NOT NULL,
  PRIMARY KEY (key, uci)
) WITHOUT ROWID;

CREATE TABLE explorer (
  variant    TEXT NOT NULL,
  key        INTEGER NOT NULL,
  uci        TEXT NOT NULL,
  white      INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  black      INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rated_n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (variant, key, uci)
) WITHOUT ROWID;

CREATE TABLE puzzles (
  id        INTEGER PRIMARY KEY,
  fen       TEXT NOT NULL,
  moves     TEXT NOT NULL,
  last_move TEXT NOT NULL DEFAULT '',
  rating    REAL NOT NULL,
  rd        REAL NOT NULL DEFAULT 120,
  vol       REAL NOT NULL DEFAULT 0.06,
  themes    TEXT NOT NULL,
  plays     INTEGER NOT NULL DEFAULT 0,
  solved    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_puzzles_rating ON puzzles(rating);

CREATE TABLE puzzle_themes (
  theme     TEXT NOT NULL,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  rating    REAL NOT NULL,
  PRIMARY KEY (theme, puzzle_id)
) WITHOUT ROWID;

CREATE TABLE puzzle_attempts (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id  INTEGER NOT NULL,
  solved     INTEGER NOT NULL,
  rating     INTEGER NOT NULL,
  diff       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attempts_user ON puzzle_attempts(user_id, created_at DESC);

CREATE TABLE scores (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_scores_kind ON scores(kind, score DESC);
CREATE INDEX idx_scores_user ON scores(user_id, kind, score DESC);

CREATE TABLE reviews (
  game_id    TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE follows (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_id)
) WITHOUT ROWID;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
