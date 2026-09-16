#!/usr/bin/env tsx
import { runGoldenSet } from "./run.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--json")) throw new Error("Usage: pnpm eval [--json]");
  const report = await runGoldenSet();
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`waylucid deterministic regression · ${report.passed}/${report.total} passed\n`);
    console.log(`${report.scope}\n`);
    for (const result of report.results) {
      console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.id} — ${result.title}`);
      if (result.error) console.log(`      execution: ${result.error}`);
      for (const check of result.checks.filter((row) => !row.pass)) console.log(`      ${check.check.kind}: ${check.detail}`);
    }
    console.log(`\n${report.checks.passed}/${report.checks.total} assertions passed.`);
  }
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
