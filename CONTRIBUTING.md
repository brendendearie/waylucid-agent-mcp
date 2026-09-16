# Contributing

Keep this repo small enough that someone can read the MCP tool layer in one sitting.

Use fictional data only.

1. Install the pinned pnpm version and run `pnpm install --frozen-lockfile`.
2. Reproduce bugs with failing tests, or state new behavior explicitly.
3. For writes, assert final state as well as the returned result. For denials, assert unchanged state.
4. Run `pnpm check`. Review both successful and rejected paths.
5. Keep documentation claims aligned with executable evidence.

Do not commit credentials, real customer records, or invented performance claims. Never fix a test by silently broadening a role. New dependencies require a reason; preserve the release-age policy and explicit build-script allowlist.

Changes to roles, schemas, redaction, transports, or plan execution should include a negative regression test. CI must run without model-provider secrets. Live-provider experiments need separate, clearly labeled results.
