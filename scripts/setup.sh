#!/usr/bin/env bash
# Rookery setup for macOS (Apple Silicon first; Intel Macs and Linux also work).
#
#   bash scripts/setup.sh                 install deps, build assets, create + seed the database, self-test
#   bash scripts/setup.sh --nginx         ...and install the Nginx server block (brew services)
#   bash scripts/setup.sh --service       ...and install the launchd agent so the server starts at login
#   bash scripts/setup.sh --tunnel        ...and install the Cloudflare Tunnel config + launchd agent
#   bash scripts/setup.sh --all           all of the above
#   bash scripts/setup.sh --skip-selftest skip the end-to-end self-test
#
# Environment: CHESS_DOMAIN=chess.example.com  TUNNEL_ID=<cloudflared tunnel UUID>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_NGINX=0; WITH_SERVICE=0; WITH_TUNNEL=0; SELFTEST=1
for arg in "$@"; do
  case "$arg" in
    --nginx) WITH_NGINX=1 ;;
    --service) WITH_SERVICE=1 ;;
    --tunnel) WITH_TUNNEL=1 ;;
    --all) WITH_NGINX=1; WITH_SERVICE=1; WITH_TUNNEL=1 ;;
    --skip-selftest) SELFTEST=0 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

CHESS_DOMAIN="${CHESS_DOMAIN:-chess.example.com}"
TUNNEL_ID="${TUNNEL_ID:-}"
OS="$(uname -s)"; ARCH="$(uname -m)"

say()  { printf '\n\033[1;33m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '    \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

say "Platform"
ok "$OS $ARCH"
if [ "$OS" = "Darwin" ] && [ "$ARCH" != "arm64" ]; then warn "Intel Mac detected: Homebrew lives in /usr/local instead of /opt/homebrew (handled automatically)."; fi
if [ "$OS" != "Darwin" ]; then warn "Not macOS: Homebrew, launchd and the Nginx paths below do not apply; the app itself runs fine."; fi

BREW_PREFIX=""
if have brew; then BREW_PREFIX="$(brew --prefix)"; ok "Homebrew at $BREW_PREFIX"
elif [ "$OS" = "Darwin" ]; then warn "Homebrew not found — install it from https://brew.sh to let this script install Stockfish and Nginx."; fi

# ---- Node.js -----------------------------------------------------------------------------------
say "Node.js"
if ! have node; then
  if have brew; then brew install node; else die "Node.js 20+ is required (https://nodejs.org)."; fi
fi
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20 or newer is required (found $(node -v))."
ok "node $(node -v) at $NODE_BIN"

# ---- Stockfish ---------------------------------------------------------------------------------
say "Stockfish"
if have brew; then
  brew list stockfish >/dev/null 2>&1 || brew install stockfish
fi
STOCKFISH_BIN=""
for candidate in "${STOCKFISH_PATH:-}" /opt/homebrew/bin/stockfish /usr/local/bin/stockfish "$(command -v stockfish 2>/dev/null || true)" /usr/games/stockfish /usr/bin/stockfish; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then STOCKFISH_BIN="$candidate"; break; fi
done
if [ -n "$STOCKFISH_BIN" ]; then
  SF_NAME="$(printf 'uci\nquit\n' | "$STOCKFISH_BIN" 2>/dev/null | sed -n 's/^id name //p' | head -1)"
  ok "${SF_NAME:-Stockfish} at $STOCKFISH_BIN"
  ok "bounded to 2 worker processes x (Hash 32 MB, Threads 1) with an async FIFO queue"
else
  warn "Stockfish not found. Bots, review and analysis fall back to the built-in engine until you install it (brew install stockfish)."
fi

# ---- npm dependencies ------------------------------------------------------------------------------
say "Dependencies"
if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund >/dev/null; else npm install --omit=dev --no-audit --no-fund >/dev/null; fi
ok "fastify, ws, better-sqlite3, bcryptjs installed"
node -e "require('better-sqlite3')(':memory:').close()" 2>/dev/null || node --input-type=module -e "import D from 'better-sqlite3'; new D(':memory:').close();" || die "better-sqlite3 failed to load (try: npm rebuild better-sqlite3)."
ok "better-sqlite3 native module loads"

# ---- generated assets ---------------------------------------------------------------------------------
say "Assets (generated locally, no CDN)"
node scripts/gen-pieces.mjs | sed 's/^/    /'
node scripts/gen-sounds.mjs | sed 's/^/    /'
PIECES="$(find public/pieces -name '*.svg' | wc -l | tr -d ' ')"
SOUNDS="$(find public/sounds -name '*.wav' | wc -l | tr -d ' ')"
[ "$PIECES" -eq 48 ] || die "expected 48 SVG pieces, found $PIECES"
[ "$SOUNDS" -eq 12 ] || die "expected 12 WAV sounds, found $SOUNDS"
ok "$PIECES SVG pieces (4 sets x 12) and $SOUNDS WAV sound effects"

# ---- database ---------------------------------------------------------------------------------------------
say "Database (SQLite, WAL)"
mkdir -p data logs
node scripts/init-db.mjs | sed 's/^/    /'
ok "data/chess.db migrated and seeded"

# ---- deployment files ---------------------------------------------------------------------------------------
say "Deployment files"
GEN="$ROOT/deploy/generated"
mkdir -p "$GEN"
CLOUDFLARED_BIN="$(command -v cloudflared 2>/dev/null || echo "${BREW_PREFIX:-/opt/homebrew}/bin/cloudflared")"
render() { # render <template> <output>
  sed -e "s|__PROJECT_ROOT__|$ROOT|g" -e "s|__SERVER_NAME__|$CHESS_DOMAIN|g" -e "s|__CHESS_DOMAIN__|$CHESS_DOMAIN|g" \
      -e "s|__NODE_BIN__|$NODE_BIN|g" -e "s|__STOCKFISH_BIN__|${STOCKFISH_BIN:-/opt/homebrew/bin/stockfish}|g" \
      -e "s|__ALLOWED_ORIGINS__|https://$CHESS_DOMAIN|g" -e "s|__TUNNEL_ID__|${TUNNEL_ID:-YOUR-TUNNEL-UUID}|g" \
      -e "s|__HOME__|$HOME|g" -e "s|__CLOUDFLARED_BIN__|$CLOUDFLARED_BIN|g" "$1" > "$2"
}
render deploy/nginx.conf "$GEN/chess.conf"
render deploy/com.local.chess.plist "$GEN/com.local.chess.plist"
render deploy/cloudflared-config.yml "$GEN/cloudflared-config.yml"
render deploy/com.local.chess.cloudflared.plist "$GEN/com.local.chess.cloudflared.plist"
ok "rendered into deploy/generated/ for domain $CHESS_DOMAIN"
if have plutil; then plutil -lint "$GEN/com.local.chess.plist" >/dev/null && ok "launchd plist is valid"; fi

if [ "$WITH_NGINX" -eq 1 ]; then
  say "Nginx"
  [ "$OS" = "Darwin" ] || die "--nginx is only automated on macOS."
  have brew || die "Homebrew is required for --nginx."
  brew list nginx >/dev/null 2>&1 || brew install nginx
  mkdir -p "$BREW_PREFIX/etc/nginx/servers"
  cp "$GEN/chess.conf" "$BREW_PREFIX/etc/nginx/servers/chess.conf"
  nginx -t
  brew services restart nginx
  ok "installed $BREW_PREFIX/etc/nginx/servers/chess.conf — Nginx is serving http://localhost/"
fi

if [ "$WITH_SERVICE" -eq 1 ]; then
  say "launchd service"
  [ "$OS" = "Darwin" ] || die "--service is only available on macOS."
  mkdir -p "$HOME/Library/LaunchAgents"
  cp "$GEN/com.local.chess.plist" "$HOME/Library/LaunchAgents/com.local.chess.plist"
  launchctl bootout "gui/$(id -u)/com.local.chess" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.chess.plist"
  ok "com.local.chess loaded — the server now starts at login and restarts if it exits (RSS ceiling 900 MB)"
fi

if [ "$WITH_TUNNEL" -eq 1 ]; then
  say "Cloudflare Tunnel"
  [ "$OS" = "Darwin" ] || die "--tunnel is only automated on macOS."
  have cloudflared || { have brew && brew install cloudflared; } || die "cloudflared is required (brew install cloudflared)."
  [ -n "$TUNNEL_ID" ] || die "Set TUNNEL_ID (from: cloudflared tunnel create rookery) and CHESS_DOMAIN, then re-run with --tunnel."
  [ -f "$HOME/.cloudflared/$TUNNEL_ID.json" ] || die "Tunnel credentials $HOME/.cloudflared/$TUNNEL_ID.json not found — run: cloudflared tunnel create rookery"
  mkdir -p "$HOME/.cloudflared" "$HOME/Library/LaunchAgents"
  cp "$GEN/cloudflared-config.yml" "$HOME/.cloudflared/config.yml"
  cloudflared tunnel --config "$HOME/.cloudflared/config.yml" ingress validate
  cp "$GEN/com.local.chess.cloudflared.plist" "$HOME/Library/LaunchAgents/com.local.chess.cloudflared.plist"
  launchctl bootout "gui/$(id -u)/com.local.chess.cloudflared" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.chess.cloudflared.plist"
  ok "tunnel $TUNNEL_ID is routing https://$CHESS_DOMAIN to http://127.0.0.1:80"
fi

# ---- self-test & memory budget ---------------------------------------------------------------------------------
if [ "$SELFTEST" -eq 1 ]; then
  say "Self-test (boots a throwaway server on a spare port with a temporary database)"
  if node scripts/test-rules.mjs >/dev/null; then ok "rules engine: perft and variant checks pass"; else die "rules engine tests failed (run: npm test)"; fi
  if node scripts/selftest.mjs --quiet | sed 's/^/    /'; then ok "end-to-end checks passed, including the < 800 MB memory budget"; else die "self-test failed (run: npm run selftest)"; fi
fi

say "Done"
cat <<EOF
    Start the server:      npm start                (http://127.0.0.1:8080)
    Health check:          curl -s http://127.0.0.1:8080/api/health

    Production on this Mac:
      bash scripts/setup.sh --nginx                  Nginx on :80 serving static files from disk
      bash scripts/setup.sh --service                launchd agent (auto-start, 900 MB ceiling)
      CHESS_DOMAIN=chess.example.com TUNNEL_ID=<uuid> bash scripts/setup.sh --tunnel
EOF
