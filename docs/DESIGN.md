# Design decisions

## Two different failure classes

Authorization asks whether a role may perform an action. Intent handling asks whether that action matches this request. Hiding `cases.resolve` from an operator does nothing to stop an accidental case creation in response to “do not open a case.” Both layers need tests.

| Decision | Benefit | Cost / limitation |
| --- | --- | --- |
| Different tool set per role | Smaller surface; direct forbidden calls fail at dispatch | More catalogs to test; production identity requires a trusted adapter |
| Strict role-specific schemas | Forbidden fields fail visibly instead of being silently discarded | Clients must refresh catalogs when contracts change |
| Narrow deterministic grammar | Reproducible examples and conservative refusals | Not general natural-language understanding |
| Whole-plan validation | A bad later call is caught before earlier writes | Runtime conflicts may still follow successful steps |
| Unambiguous result binding | No arbitrary first-record selection | Zero/multiple matches require clarification |
| Stop on first execution error | No continuation with failed dependencies | No rollback of earlier writes; not an atomic transaction |
| In-memory store | Runs without infrastructure | No durability, tenancy, idempotency keys, or distributed concurrency |
| Real MCP clients in tests | Discovery, schemas, transport and results exercised together | Does not prove compatibility with every host UI |

## Interpreting the evidence

Store tests establish domain behavior. Protocol tests include calls absent from the catalog. HTTP tests exercise the local transport. Golden fixtures compare behavior and post-state; inverted fixtures verify that the runner can fail.

No score here estimates LLM accuracy. Provider tests substitute responses. A live-model evaluation would separately record model/version, prompts, catalogs, repeated trials, costs, failures, and human-reviewed outcomes.

## Production work left out

An authenticated adapter must derive identity and scopes from verified credentials. Durable storage needs tenant/record-level authorization, concurrency control, idempotency, audit events, and recovery semantics. Consequential actions need application-enforced confirmation. Rate limits, telemetry, and feedback-driven planning should follow explicit requirements.

The next useful extension is one complete adapter with those boundaries tested.
