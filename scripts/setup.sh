#!/usr/bin/env bash
# ape-signal self-host bootstrap (Debian/Ubuntu + systemd).
# Idempotent: re-runnable, never overwrites an existing /etc/ape-signal.env.
# Prerequisite: Claude Code CLI installed and logged in as THIS user.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_DIR="/opt/ape-signal"   # the systemd units hardcode WorkingDirectory=/opt/ape-signal
ENV_PATH="/etc/ape-signal.env"
UNIT_SRC="$REPO_DIR/systemd"
UNIT_DST="/etc/systemd/system"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say()  { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

say "Checking prerequisites"
command -v git  >/dev/null 2>&1 || fail "git not found"
command -v node >/dev/null 2>&1 || fail "node not found (need >= 20)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "Node $(node -v) is too old; need >= 20"
command -v claude >/dev/null 2>&1 \
  || fail "claude CLI not found. Install Claude Code and run 'claude login' as this user."
echo "OK: git, node $(node -v), claude present"

# The shipped systemd units hardcode /opt/ape-signal. Warn (don't fail — the user
# may have edited the units) so a wrong clone location doesn't silently break the
# services after they're enabled.
if [ "$REPO_DIR" != "$EXPECTED_DIR" ]; then
  printf 'WARNING: repo is at %s but the systemd units expect %s.\n' "$REPO_DIR" "$EXPECTED_DIR" >&2
  printf '         Clone to %s, or edit WorkingDirectory in systemd/*.service, or the services will fail.\n' "$EXPECTED_DIR" >&2
fi

if [ "$CHECK_ONLY" = "1" ]; then
  # Reads the root-owned 600 env file — run as the same (root) user as the rest.
  say "Running doctor (check-only)"
  npm --prefix "$REPO_DIR" run --silent doctor -- --env-file="$ENV_PATH" || true
  exit 0
fi

say "Fetching submodule + dependencies"
git -C "$REPO_DIR" submodule update --init --recursive
npm --prefix "$REPO_DIR" ci   # WITH dev deps: tsx is the runtime

if [ ! -f "$ENV_PATH" ]; then
  say "Creating $ENV_PATH from template"
  sudo cp "$REPO_DIR/.env.example" "$ENV_PATH"
  sudo chmod 600 "$ENV_PATH"
  echo "Created $ENV_PATH. Fill in your secrets, then re-run this script."
  exit 0
fi
echo "Found existing $ENV_PATH (left untouched)."

say "Installing systemd units"
sudo cp "$UNIT_SRC/ape-signal-scan@.service" "$UNIT_DST/"
sudo cp "$UNIT_SRC/ape-signal-scan-preopen.timer" "$UNIT_DST/"
sudo cp "$UNIT_SRC/ape-signal-scan-preus.timer" "$UNIT_DST/"
sudo cp "$UNIT_SRC/ape-signal-listener.service" "$UNIT_DST/"
sudo systemctl daemon-reload
sudo systemctl enable --now ape-signal-scan-preopen.timer ape-signal-scan-preus.timer
sudo systemctl enable --now ape-signal-listener.service

say "Validating configuration"
# On a slow/cold VPS the Claude probe can be slow; if this aborts, the services
# are already installed+enabled — just re-run `./scripts/setup.sh --check`.
npm --prefix "$REPO_DIR" run --silent doctor -- --env-file="$ENV_PATH"

say "Done"
echo "Scans: Mon-Fri 08:45 & 15:15 Europe/Berlin. Listener: systemctl status ape-signal-listener"
