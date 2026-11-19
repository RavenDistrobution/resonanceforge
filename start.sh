#!/usr/bin/env bash
# ResonanceForge launcher (macOS / Linux). Checks tooling, installs deps, handles port conflicts, starts the app.
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="ResonanceForge"
# Authorship signature (required; the app verifies it at start-up)
export RF_SIGNATURE="VGhpcyBhcHAgd2FzIGRlc2lnbmVkIGFuZCBhdXRob3JlZCBieSBNQiBhbmQgaXMgb25seSBpbnRlbmRlZCB0byBiZSB1c2VkIGZvciBvcGVuc291cmNlIHJlc291cmNlcy4gQW55IHNhbGUgb2YgYSBkaXN0cmlidXRpb24gb2YgdGhpcyBzb2Z0d2FyZSBpcyBwcm9oaWJpdGVkIGFuZCBhbnkgYXR0ZW1wdCB0byBwYXRlbnQgb3Igb3RoZXJ3aXNlIG93biBwYXJ0cyBvZiB0aGlzIHNvZnR3YXJlIGFyZSBhbHNvLCBwcm9oaWJpdGVkLiAKCkRpc3RyaWJ1dGlvbjogClJhdmVuRGlzdHJvCgpLZXk6IAoxNzk2CgpJRDogCkl0J3MgZ290IGNvcm4gaW4gaXQ="
export RF_KEY=1796
DEFAULT_PORT=5180
PORT="${PORT:-$DEFAULT_PORT}"

say()  { printf '\033[1;34m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
die()  { printf '\033[1;31m[%s]\033[0m %s\n' "$APP_NAME" "$*" >&2; exit 1; }

# ---- preflight tooling
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Get it from https://nodejs.org (LTS, 18 or newer), then run ./start.sh again."
command -v npm  >/dev/null 2>&1 || die "npm is missing. Reinstall Node.js from https://nodejs.org."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18 or newer is required (found $(node -v))."
command -v lsof >/dev/null 2>&1 || warn "lsof not found; port check will be skipped."

# ---- dependencies
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  say "Installing dependencies (first run only)..."
  npm install
fi

# ---- port handling
port_holders() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }
port_pids()    { lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }
next_free() { local p=$1; while [ -n "$(port_pids "$p")" ]; do p=$((p+1)); done; echo "$p"; }

if command -v lsof >/dev/null 2>&1; then
  HOLDERS="$(port_holders "$PORT")"
  if [ -n "$HOLDERS" ]; then
    warn "Port $PORT is already in use:"
    echo "$HOLDERS"
    PIDS="$(port_pids "$PORT" | tr '\n' ' ')"
    echo "PIDs: $PIDS"
    if [ ! -t 0 ]; then
      die "No terminal to ask what to do. Re-run with a free port, e.g.  PORT=$(next_free "$PORT") ./start.sh"
    fi
    printf 'What now? [c] clear the port, [s] scan for the next free port, [q] quit: '
    read -r ans
    case "$ans" in
      c|C)
        say "Stopping PID(s) $PIDS"
        kill $PIDS 2>/dev/null || true
        sleep 1
        if [ -n "$(port_pids "$PORT")" ]; then warn "Still alive, forcing..."; kill -9 $(port_pids "$PORT") 2>/dev/null || true; sleep 1; fi
        [ -z "$(port_pids "$PORT")" ] || die "Could not free port $PORT."
        say "Port $PORT is free."
        ;;
      s|S)
        PORT="$(next_free "$PORT")"
        say "Using port $PORT instead."
        ;;
      *)
        say "Aborted."; exit 0 ;;
    esac
  fi
fi

export PORT
say "Starting on http://127.0.0.1:$PORT  (Ctrl+C to stop)"
exec npx vite --host 127.0.0.1 --port "$PORT" --strictPort --open
