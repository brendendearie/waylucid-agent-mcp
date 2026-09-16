# A five-minute demo

Use synthetic data and the mock planner. Start with `pnpm check`, then `pnpm playground`; open http://127.0.0.1:43123.

## 1. Make permissions visible

Select operator and run the prefilled Maya webhook request. Show the contact lookup, case creation, and linked task. Point to the new records in the snapshot.

Switch to viewer: write tools disappear. Run the same command: the workflow is blocked. Direct calls to hidden tools also fail; the tests assert unchanged state on denial.

## 2. Show a failure that matters

As operator, run `list follow-up tasks`. It must only list tasks. Then run `Do not open a case for Maya`: the deliberately limited grammar refuses the negated instruction.

A permitted write can still be the wrong action. Explain authorization versus intent, without claiming arbitrary language understanding.

## 3. Inspect the contract

Compare operator/supervisor `cases.update` schemas: only supervisor can send `tags`. Show the protocol regression that submits this field as operator and checks rejection plus unchanged state. Explain that lower roles get a note count, not note bodies.

Resetting the fictional desk requires supervisor. The role selector is a simulator, not a login.

## 4. Show repeatable evidence

Run the golden set. Open the harness-safety tests for malformed/ambiguous plans and the boundary tests for forbidden calls. Show actual results and explain what each gate proves.

Close with limitations: local role simulation, one-shot planning, in-memory state, no rollback. Discuss the controls a customer integration would require next.

## Design review questions

- Why enforce boundaries in both catalog design and server dispatch?
- What happens when step three fails after step two writes?
- Why is selecting the first search result unsafe?
- What would a live-model evaluation need beyond deterministic fixtures?
- Where should approval live when a tool is labeled destructive?
