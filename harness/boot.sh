#!/usr/bin/env bash
# Boot the whole manual-test stack:
#
#   1. stage the demo's static assets from @libid/claim-full's bundle
#      (skippable: SKIP_ASSETS=1)
#   2. render env from the committed network file (keeper.toml is static —
#      nothing to render there)
#   3. docker compose up (anvil → declarative deploy → notary → backend,
#      plus the one-shot JWKS keeper: a real MPC-TLS rotation of Google's
#      JWKS roots through the notary, so Google claims work locally)
#   4. health-check everything and print a status table
#   5. run the vite dev server in the foreground
#
# Ctrl-C (or any exit) tears the compose stack down unless KEEP_STACK=1.
#
# GH_OAUTH_CLIENT_ID / GH_OAUTH_CLIENT_SECRET: export real GitHub OAuth App
# credentials for a real click-through; unset, the stack boots with dummies
# (everything works except the GitHub consent screen).

set -euo pipefail

HARNESS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HARNESS/.." && pwd)"

# Local-development secrets: the git-ignored .env at the repo root holds the
# OAuth client id/secret (GH_OAUTH_CLIENT_ID/SECRET, etc.). Source it if
# present so a real click-through works with no manual `export`. Values in
# the file take effect for this boot (they override any prior shell export).
if [ -f "$ROOT/.env" ]; then
  echo "==> sourcing $ROOT/.env"
  set -a
  # shellcheck disable=SC1090,SC1091
  . "$ROOT/.env"
  set +a
fi

if [ "${SKIP_ASSETS:-}" != "1" ]; then
  # @libid/claim-full bundles every static proving asset (tlsn wasm bundle,
  # released circuits sha256-verified against the release manifest, noir
  # acvm/abi wasm); its libid-claim-assets bin copies them into the demo's
  # public/. Prereq: `pnpm -C ts install` has run.
  (
    cd "$ROOT/ts" \
      && pnpm --filter @libid/claim-full build \
      && pnpm --filter @libid/claim-demo stage-assets
  )
fi

bash "$HARNESS/render-env.sh"

cleanup() {
  if [ "${KEEP_STACK:-}" != "1" ]; then
    echo ""
    echo "==> tearing down the compose stack (KEEP_STACK=1 to keep it)"
    docker compose -f "$HARNESS/docker-compose.yml" down -v || true
  fi
}
trap cleanup EXIT

echo "==> docker compose up"
docker compose -f "$HARNESS/docker-compose.yml" up -d --wait

# ── health checks ──────────────────────────────────────────────────────────
check() { # name command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  %-20s OK\n' "$name"
  else
    printf '  %-20s FAILED  (%s)\n' "$name" "$*"
    return 1
  fi
}

echo ""
echo "Stack status:"
ok=0
check "anvil rpc" curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://127.0.0.1:8545 || ok=1
check "notary /info" curl -fsS http://127.0.0.1:7048/info || ok=1
check "backend /health" curl -fsS http://localhost:8722/health || ok=1
# The keeper is one-shot: healthy = ran once and exited 0 (JWKS roots
# rotated on-chain; Google claims now verify). `compose wait` blocks until
# the container exits and propagates its exit code — `up --wait` can return
# while the MPC-TLS tick is still in flight.
check "keeper (JWKS once)" \
  docker compose -f "$HARNESS/docker-compose.yml" wait keeper || ok=1
[ "$ok" = 0 ] || { echo "A health check failed — see docker compose logs."; exit 1; }

echo ""
echo "  notary pubkey: $(curl -fsS http://127.0.0.1:7048/info)"
echo ""
echo "==> starting the demo UI at http://localhost:5173 (Ctrl-C stops everything)"
cd "$ROOT/ts" && pnpm --filter @libid/claim build && pnpm --filter @libid/claim-demo dev
