# Contributing

This is a **public reference**, not a product dump. Keep it small enough that a hiring manager can read the MCP tool layer in one sitting.

## What belongs here

- Clearer permission-aware schemas
- Better golden evals that fail when the catalog leaks
- Harness / playground fixes that make the demo more honest
- Dependency and SDK upgrades for `@modelcontextprotocol/server` and `@modelcontextprotocol/client`

## What does not

- Proprietary LucidDock / WayLucid production code
- Real customer data, tokens, or partner names
- Inflated metrics, bankruptcy/exit narrative, or invented integrations
- A second ontology, a second agent framework, or a database

## How to work

1. `pnpm install`
2. `pnpm test` and `pnpm eval` must stay green
3. Prefer one complete idea per PR
4. Match the existing TypeScript style: ESM, strict, no unused locals

Harborline is fictional seed data. Keep it that way.
