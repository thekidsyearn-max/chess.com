# Rookery

A self-hosted chess platform for macOS (Apple Silicon) that runs behind Nginx and a
Cloudflare Tunnel in well under 1 GB of RAM. Live play, 25 bots, unlimited Game Review,
an analysis board, rated puzzles, Puzzle Rush/Battle, drills and five variants — with
every feature available to every user and no third-party assets or CDNs.

```bash
bash scripts/setup.sh && npm start      # http://127.0.0.1:8080
```

Rookery is an original project: its name, look, piece artwork, sounds and bot characters
are its own.

## What is in the box

| Area | Details |
| --- | --- |
| Rules | FIDE-complete engine shared by server and browser: castling, en passant, promotion, 50-move rule, threefold repetition (Zobrist hashing), insufficient material, stalemate, checkmate |
| Variants | Standard, Chess960 (all 960 arrays, generalised castling), King of the Hill, Three-Check, Crazyhouse (pockets and drops), Atomic (explosions) |
| Live play | `/ws` WebSockets, server-authoritative clocks with ping-based clock sync and lag compensation, matchmaking for 1+0 … 60+0 and daily 1d/3d/7d, draw offers, abort before move 2, resignation, 45 s disconnect grace, rematch, chat, spectators with a live evaluation bar |
| Friend games | Private invite links at `/play/friend/:inviteCode` |
| Board | Click or drag, up to 5 chained premoves, right-click squares (red, Shift green, Ctrl yellow, Alt blue) and arrows on a `<canvas>` overlay, promotion picker, move confirmation |
| Bots | 25 personalities from 250 to 3200+, each with its own UCI settings, depth cap, blunder model, style-biased move choice, thinking-time variance and chat lines; hints, takebacks and move feedback |
| Game Review | Stockfish MultiPV 3 on every position, win-probability and accuracy scores, Brilliant / Great / Best / Excellent / Good / Book / Inaccuracy / Mistake / Blunder / Miss, advantage graph, plain-English coach, Show Follow-Up, Retry Mistake |
| Analysis | Engine lines (MultiPV 1–5, depth, score, nodes/s), nested variation tree with comments and NAGs, PGN/FEN import and export, board editor, opening explorer over the ECO book plus every game on the server |
| Puzzles | 453 engine-verified puzzles across 23 themes, Glicko-2 ratings for solver and puzzle, hints, theme filter; Puzzle Rush (3 min, 5 min, Survival), Puzzle Battle |
| Learn | Coordinate trainer, seven endgame and checkmate drills against Stockfish |
| Accounts | bcrypt password hashes, HttpOnly SameSite=Lax session cookies (Secure over HTTPS), instant guest play, Glicko-2 per category with history charts, archive with filters and PGN download, profiles, follows, leaderboards |
| Look and feel | 10 board themes, 4 piece sets, coordinates inside/outside/off, 4 animation speeds, 3 sound themes with volume, dark / light / AMOLED |

## Requirements

- macOS on Apple Silicon (Intel Macs and Linux also work)
- Node.js 20 or newer
- Stockfish (`brew install stockfish`; `setup.sh` installs it when Homebrew is present).
  Without it Rookery still runs and falls back to its built-in engine.

## Setup

```bash
bash scripts/setup.sh                 # deps, assets, database, self-test
bash scripts/setup.sh --nginx         # also install the Nginx server block
bash scripts/setup.sh --service       # also install the launchd agent (auto-start)
CHESS_DOMAIN=chess.example.com TUNNEL_ID=<uuid> bash scripts/setup.sh --tunnel
```

`setup.sh` does the following, in order:

1. Checks Node, installs Stockfish through Homebrew if needed and finds the binary
   (`/opt/homebrew/bin/stockfish`, then `/usr/local/bin/stockfish`).
2. Installs npm dependencies.
3. Generates the 48 SVG pieces and 12 WAV sounds.
4. Creates `data/chess.db`, applies migrations, and seeds 612 opening lines (all 500 ECO
   codes) and the puzzle set.
5. Renders the deployment files into `deploy/generated/` with your paths and domain.
6. Runs the rules tests and the end-to-end self-test, which includes the memory check.

### Going public with Cloudflare Tunnel

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create rookery                       # prints the tunnel UUID
cloudflared tunnel route dns rookery chess.example.com
CHESS_DOMAIN=chess.example.com TUNNEL_ID=<uuid> bash scripts/setup.sh --all
```

Traffic then flows: browser → Cloudflare edge (QUIC, HTTP/2 fallback) → `cloudflared` →
Nginx on `127.0.0.1:80` → static files from disk, or Node on `127.0.0.1:8080` for
`/api/`, `/ws` and the HTML shell.

The Nginx block only accepts loopback connections by default. Remove the three
`allow` / `deny` lines in `deploy/nginx.conf` if devices on your LAN should reach it.

## Memory budget

Measured with Stockfish 16 on x86-64 Linux; Apple Silicon builds are in the same range.

| Component | Idle | Active play |
| --- | --- | --- |
| Node server (V8 heap capped at 256 MB) | about 90–125 MB | about 100–150 MB |
| Stockfish workers (max 2, Hash 32 MB, 1 thread each) | 0 MB (reaped after 90 s idle) | about 165 MB each, 330 MB for two |
| Nginx | under 10 MB | under 10 MB |
| **Total** | **about 100–135 MB** | **about 430–480 MB** |

`cloudflared` adds roughly 30–40 MB on top and was not measured here.

A single Stockfish process uses more than its 32 MB hash table because the NNUE network
is loaded alongside it, so two workers together cost about 330 MB rather than 90 MB. The
stack still stays far below the 750 MB target. Set `STOCKFISH_PROCESSES=1` to halve the
engine footprint.

What enforces the ceiling:

- `--max-old-space-size=256` on the Node process
- SQLite `cache_size = -16000`, `mmap_size = 67108864`, WAL, `synchronous = NORMAL`
- the engine pool: at most 2 processes, `Hash 32`, `Threads 1`, one async FIFO queue
- a watchdog that recycles engine workers at 85% of the ceiling and exits above it, after
  which launchd restarts the server
- launchd `SoftResourceLimits` / `HardResourceLimits` of 900 MB RSS in the plist. macOS
  treats `RLIMIT_RSS` as advisory, so the items above do the real work.

## Configuration

Environment variables (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT`, `HOST` | `8080`, `127.0.0.1` | Listen address |
| `DATA_DIR`, `DB_PATH` | `./data`, `./data/chess.db` | Database location |
| `STOCKFISH_PATH` | auto-detected | Engine binary |
| `STOCKFISH_PROCESSES` | `2` | Worker processes (hard cap 2) |
| `STOCKFISH_HASH_MB` | `32` | Hash per worker (hard cap 32) |
| `SYZYGY_PATH` | unset | Directory of Syzygy tablebase files, passed to Stockfish |
| `SERVE_STATIC` | `1` | Set `0` when Nginx serves `/assets`, `/pieces`, `/sounds` |
| `ALLOWED_ORIGINS` | unset | Extra origins allowed for API writes and WebSockets |
| `COOKIE_SECURE` | auto | `1` forces the Secure cookie flag |
| `REVIEW_NODES` | `300000` | Search budget per position in Game Review |
| `MEMORY_CEILING_MB` | `900` | Watchdog ceiling for Node plus engines |

## Commands

```bash
npm start                  # run the server
npm test                   # rules engine: perft for every variant, draw rules, SAN/FEN
npm run selftest           # end-to-end test against a throwaway server
npm run assets             # regenerate SVG pieces and WAV sounds
npm run db:init            # migrate and seed the database
npm run puzzles:generate   # mine a fresh puzzle set with Stockfish (about 30 minutes)
```

## Project layout

```
.
├── package.json
├── README.md
├── data/                          SQLite database (created by setup)
├── deploy/
│   ├── nginx.conf                 Nginx server block (static from disk, proxy /api and /ws)
│   ├── cloudflared-config.yml     Cloudflare Tunnel ingress
│   ├── com.local.chess.plist      launchd agent for the server (900 MB RSS limits)
│   └── com.local.chess.cloudflared.plist
├── scripts/
│   ├── setup.sh                   one-shot setup, optional Nginx / launchd / tunnel install
│   ├── init-db.mjs                migrations and seeding
│   ├── gen-pieces.mjs             SVG piece-set generator
│   ├── gen-sounds.mjs             PCM WAV synthesizer
│   ├── gen-puzzles.mjs            puzzle miner and verifier (Stockfish)
│   ├── test-rules.mjs             rules regression suite
│   └── selftest.mjs               end-to-end self-test
├── server/
│   ├── index.js                   Fastify bootstrap, static fallback, watchdog
│   ├── config.js  db.js           configuration, SQLite pragmas and migrations
│   ├── migrations/001_schema.sql
│   ├── users.js  glicko2.js       accounts, sessions, ratings
│   ├── ws.js  games.js            WebSocket hub, live game manager, clocks, matchmaking
│   ├── stockfish.js  engine.js    bounded UCI process pool and engine facade
│   ├── lite-engine.js  lite-worker.js   built-in alpha-beta engine (variants, fallback)
│   ├── bots.js                    move selection and chat engine
│   ├── review.js  coach.js  judge.js    Game Review, commentary, accuracy maths
│   ├── puzzles.js  battle.js      puzzles, Rush, Battle
│   ├── openings.js  explorer.js   ECO book and opening explorer
│   ├── seed.js  api.js            seeding, REST API
│   └── data/
│       ├── eco.js                 612 opening lines covering A00–E99
│       ├── puzzles.json           453 verified puzzles
│       ├── bots.js                the 25-bot roster
│       └── drills.js              endgame drills
└── public/
    ├── index.html
    ├── pieces/{modern,classic,wood,minimal}/*.svg
    ├── sounds/*.wav
    └── assets/
        ├── css/{app,board}.css
        └── js/
            ├── app.js             router and shell
            ├── chess/{chess,pgn}.js      rules engine and PGN (shared with the server)
            ├── lib/               board, sockets, settings, sound, widgets, move tree
            └── views/             one module per screen
```

## Things worth knowing

- **Variant bots.** Stockfish plays standard chess and Chess960 only. Bots in King of the
  Hill, Three-Check, Crazyhouse and Atomic use the built-in engine, which tops out around
  club strength regardless of the bot's listed rating. Review and analysis in those
  variants use it too.
- **Endgame tablebases.** None are bundled; five-piece Syzygy files are about 1 GB. Point
  `SYZYGY_PATH` at a directory of them and Stockfish will probe them in analysis, review
  and bot play.
- **Puzzle ratings.** Every puzzle's solution is verified unique by Stockfish. The starting
  ratings are estimates from the line's length and character, and Glicko-2 corrects them
  as people solve.
- **Bot ratings.** Bots from 1320 up use Stockfish's own `UCI_Elo` limiter. Below that
  they use a shallow search with calibrated random errors, so those ratings are
  approximate.
- **Restarts.** Daily games survive a restart. Live clocked games in progress are aborted.
- **Brotli.** Homebrew's Nginx has no Brotli module, so the config uses gzip and leaves a
  commented Brotli block for custom builds.

## License

MIT for Rookery's own code and artwork. Stockfish is a separate GPL-3.0 program that
Rookery runs as an external process.
