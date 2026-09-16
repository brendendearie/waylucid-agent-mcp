# Local verification record

Recorded September 16, 2026, America/Phoenix. Environment: Windows, Node 22.14.0, pnpm 11.19.0. This records a local verification run, not a hosted CI result.

| Gate | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; 173 lockfile entries passed configured supply-chain policies |
| `pnpm typecheck` | Passed |
| `pnpm test` | 125 tests across 11 files passed |
| `pnpm eval` | 18/18 fixtures, 66/66 assertions passed |
| `pnpm eval --json` | Standalone JSON parsed successfully |
| `pnpm build` | Playground production assets compiled |
| JUnit reporter used by CI | 125 tests passed and XML report emitted |
| Browser walkthrough | Operator three-step creation, viewer denial, read-only task probe, supervisor reset, 18/18 eval panel |
| Responsive check | 390px viewport has no horizontal page overflow after layout fix |
| Final desktop browser console | No warnings or errors |

The screenshot in README is from the actual local playground with fictional records. It is not a design mockup. Browser walkthroughs were interactive verification, not a committed automated UI test suite.

Key negative checks: forbidden tools and fields leave state unchanged; malformed or schema-invalid later calls prevent earlier writes; ambiguous lookups do not choose the first record; conditional/unsupported mutation commands refuse execution; failed runtime dependencies stop subsequent calls; a transport failure cannot masquerade as a permission denial. The CLI rejects unknown, duplicate, and conflicting flags before planning; JSON traces preserve completed/blocked exit statuses. The public-copy regression includes the documentation directory.

## Not verified

Hosted GitHub Actions runs, Linux/Node24 execution, live paid-provider behavior, third-party host GUIs, production security, load/scalability, durable recovery, and customer outcomes were not established by this run. The CI matrix defines future checks; only actual run results prove those environments.

The current reference retains earlier successful writes after a later runtime failure. It does not claim transactional rollback. Schema validation is not a general test of user intent for a live model.
