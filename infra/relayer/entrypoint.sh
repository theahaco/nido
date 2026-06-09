#!/bin/sh
set -eu
umask 077

mkdir -p /app/config/keys
printf '%s' "$KEYSTORE_FUND_B64" | base64 -d > /app/config/keys/fund.json
printf '%s' "$KEYSTORE_CHANNEL_001_B64" | base64 -d > /app/config/keys/channel-001.json
printf '%s' "$KEYSTORE_CHANNEL_002_B64" | base64 -d > /app/config/keys/channel-002.json

(caddy run --config /app/Caddyfile --adapter caddyfile; kill $$) &

exec /app/openzeppelin-relayer
