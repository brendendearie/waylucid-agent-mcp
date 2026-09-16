#!/usr/bin/env tsx
import { GOLDEN, runGoldenSet } from "./run.ts";

async function main(): Promise<void> {
  const { passed, failed, results } = await runGoldenSet();
  console.log(`waylucid eval  ·  ${passed}/${results.length} passed\n`);
  for (const result of results) {
    const mark = result.pass ? "PASS" : "FAIL";
    console.log(`${mark}  ${result.id}  —  ${result.title}`);
    if (!result.pass) {
      for (const check of result.checks.filter((row) => !row.pass)) {
        console.log(`      ${check.check.kind}: ${check.detail}`);
      }
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} golden case(s) failed. ${GOLDEN.length} in the set.`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
