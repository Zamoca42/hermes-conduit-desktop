# Vendored from Hermes Agent

These files are copied unchanged from
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
`apps/shared/src`, under its MIT license (`LICENSE` here).

- Commit: `aaec1339aa325888919c522911c54a7e684c7f23` (2026-11-17)
- Files: `json-rpc-channel.ts`, `json-rpc-gateway.ts`, `gateway-events.ts`,
  `gateway-contract.generated.ts`, `reconnect-backoff.ts`

They give us the gateway's JSON-RPC client and its generated wire types, so
the desktop app speaks the same protocol as Hermes' own clients. Don't edit
them here: run `scripts/sync-hermes-shared.sh <commit>` to take a newer
copy, then fix whatever stops compiling in our code.
