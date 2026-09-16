# Security scope

This is a local, single-user, fictional-data simulator. The public role selector demonstrates enforcement **after a role is chosen**; it does not establish who the caller is.

## Regression coverage

- Direct calls to tools absent from a role's catalog.
- Fields outside a role's schema and internal-note leakage.
- Malformed plans, unsafe placeholder dependencies, ambiguous lookups.
- Invalid roles, malformed JSON, excessive bodies, invalid Host and cross-origin requests.
- Requests whose wording must not accidentally turn a read into a write.

## Trust boundaries

The playground uses loopback binding and Host/Origin validation. These reduce accidental network exposure and browser-origin attacks. They do not prevent another process/user on the same machine selecting supervisor. Do not tunnel, reverse-proxy, or deploy this development server.

MCP schemas and server registration enforce the chosen role. Annotations such as `destructiveHint` do not implement confirmation. Plan validation cannot prove that an arbitrary live-model action faithfully reflects user intent; production hosts must add human approval and scoped authority as appropriate.

Provider calls are opt-in and use environment credentials. Never put secrets in prompts, fixtures, screenshots, or logs. Do not use customer data.

No verified identity, tenant isolation, durable audit log, transaction rollback, rate limiting, public hosting, or general prompt-injection defense is provided. Passing tests establish only the exercised behaviors.

For real deployments, follow the [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices) and design authentication/resource authorization for the actual system.
