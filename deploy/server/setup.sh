#!/usr/bin/env bash
# Sets up the OmniLaya backend (Laya, SearXNG, Caddy) on a fresh Ubuntu server.
# Made for Oracle Cloud's Always Free ARM server; works on any Ubuntu or Debian box with a public IP.
#
#   sudo bash setup.sh
#
# Safe to run again: existing keys in .env are kept. At the end it prints, and saves to
# omnilaya-secrets.env, the values the Cloudflare deploy script needs.
set -euo pipefail

cd "$(dirname "$0")"
say() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

say "Installing Docker (skipped if present)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null

say "Opening ports 80 and 443 in the server firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything but SSH.
if command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true; fi
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

say "Finding the public IP"
IP="${PUBLIC_IP:-$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me)}"
if ! printf '%s' "$IP" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Could not find a public IPv4 address. Set PUBLIC_IP=1.2.3.4 and run again." >&2
  exit 1
fi
DASHED="${IP//./-}"
echo "Public IP: $IP"

say "Writing .env (keys are generated once and kept)"
touch .env
chmod 600 .env
keep() { grep -E "^$1=" .env | head -n1 | cut -d= -f2- || true; }
key() { openssl rand -hex 32; }
LAYA_API_KEY="$(keep LAYA_API_KEY)"; LAYA_API_KEY="${LAYA_API_KEY:-$(key)}"
SEARCH_KEY="$(keep SEARCH_KEY)"; SEARCH_KEY="${SEARCH_KEY:-$(key)}"
SEARXNG_SECRET="$(keep SEARXNG_SECRET)"; SEARXNG_SECRET="${SEARXNG_SECRET:-$(key)}"
# sslip.io names resolve to the IP written in them, so Caddy can get certificates without a domain.
LAYA_HOST="${LAYA_HOST:-laya.$DASHED.sslip.io}"
SEARCH_HOST="${SEARCH_HOST:-search.$DASHED.sslip.io}"
CORES="$(nproc)"
cat > .env <<EOF
LAYA_API_KEY=$LAYA_API_KEY
SEARCH_KEY=$SEARCH_KEY
SEARXNG_SECRET=$SEARXNG_SECRET
LAYA_HOST=$LAYA_HOST
SEARCH_HOST=$SEARCH_HOST
LAYA_THREADS=$CORES
EOF

say "Building and starting the containers (the first build takes a few minutes)"
docker compose up -d --build

say "Waiting for Laya to load its checkpoints (the first start downloads about 3 GB)"
for i in $(seq 1 90); do
  if curl -fsS "https://$LAYA_HOST/health" >/dev/null 2>&1; then
    echo "Laya is up: https://$LAYA_HOST/health"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "Laya did not answer after 15 minutes. Check: docker compose logs laya caddy" >&2
    exit 1
  fi
  sleep 10
done

say "Checking both services with their keys"
curl -fsS "https://$LAYA_HOST/v1/systemone" \
  -H "Authorization: Bearer $LAYA_API_KEY" -H 'Content-Type: application/json' \
  -d '{"state":{"request":"test"},"questions":{"ok":{"type":"noul","instructions":"Is this a test?"}}}' >/dev/null \
  && echo "Laya answers."
curl -fsS "https://$SEARCH_HOST/search?q=laya&format=json&engines=duckduckgo" \
  -H "Authorization: Bearer $SEARCH_KEY" >/dev/null \
  && echo "SearXNG answers."

cat > omnilaya-secrets.env <<EOF
LAYA_PROVIDERS=laya
LAYA_BASE_URL=https://$LAYA_HOST
LAYA_API_KEY=$LAYA_API_KEY
SEARCH_PROVIDER=searxng
SEARXNG_BASE_URL=https://$SEARCH_HOST
SEARXNG_API_KEY=$SEARCH_KEY
EOF
chmod 600 omnilaya-secrets.env

say "Done. Copy $(pwd)/omnilaya-secrets.env to your computer and run the Cloudflare step (see DEPLOY.md):"
cat omnilaya-secrets.env
