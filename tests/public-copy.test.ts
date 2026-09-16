import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ROOTS = ["README.md", "CONTRIBUTING.md", "package.json", "playground", "src", "docs"];

/** Phrases that belong in an unpublished brief, not on a public GitHub page. */
const FORBIDDEN = [
  /hiring[- ]managers?/i,
  /five-minute read/i,
  /sanitized public/i,
  /public reference/i,
  /what this is not/i,
  /not a customer deployment/i,
  /not an open-source of proprietary/i,
];

function walk(path: string, files: string[]): void {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === "dist") continue;
      walk(join(path, name), files);
    }
    return;
  }
  if (/\.(md|tsx?|json|html|css)$/.test(path)) files.push(path);
}

describe("public copy", () => {
  it("does not ship unpublished-brief language in README, CONTRIBUTING, package, playground, src, or docs", () => {
    const files: string[] = [];
    for (const name of ROOTS) walk(join(ROOT, name), files);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
          hits.push(`${relative(ROOT, file)}  ${pattern}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
