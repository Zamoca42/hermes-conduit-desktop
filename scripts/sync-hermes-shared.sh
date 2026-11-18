#!/usr/bin/env bash
# Copies the gateway client files from Hermes Agent at one commit.
#
#   scripts/sync-hermes-shared.sh <commit-or-tag>
set -euo pipefail
ref="${1:?usage: sync-hermes-shared.sh <commit-or-tag>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/src/vendor/hermes-shared"
files=(json-rpc-channel.ts json-rpc-gateway.ts gateway-events.ts gateway-contract.generated.ts reconnect-backoff.ts)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --filter=blob:none --no-checkout "${HERMES_REPO:-https://github.com/NousResearch/hermes-agent}" "$tmp/ha"
git -C "$tmp/ha" checkout --quiet "$ref" -- LICENSE $(printf 'apps/shared/src/%s ' "${files[@]}")
for f in "${files[@]}"; do cp "$tmp/ha/apps/shared/src/$f" "$dest/$f"; done
cp "$tmp/ha/LICENSE" "$dest/LICENSE"
sha="$(git -C "$tmp/ha" rev-parse "$ref")"
sed -i.bak -E "s/^- Commit: .*/- Commit: \`$sha\` ($(date -u +%Y-%m-%d))/" "$dest/UPSTREAM.md" && rm -f "$dest/UPSTREAM.md.bak"
echo "Synced hermes-shared to $sha"
