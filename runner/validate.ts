#!/usr/bin/env bun
// The fast, dependency-free check `fledge lanes run verify` actually runs
// (see fledge.toml). Validates every .magpie/specs/*.3md structurally —
// parses, no dependency cycles, no duplicate skill names, placeholders
// match declared inputs — without executing anything. Deliberately does
// NOT run the real six targets: those need Safari, an iOS simulator, a
// live emulator, and real network access, none of which exist on a plain
// verify-gate runner. That live execution is what
// .github/workflows/test.yml's dedicated jobs are for.

import { validateAgent, formatReport } from "@corvidlabs/agent3md";

const glob = new Bun.Glob("*.3md");
const files = Array.from(glob.scanSync({ cwd: ".magpie/specs" })).sort();

let allOk = true;
for (const file of files) {
  const path = `.magpie/specs/${file}`;
  const src = await Bun.file(path).text();
  const report = validateAgent(src);
  console.log(formatReport(path, report));
  if (!report.ok) allOk = false;
}

if (!allOk) {
  console.error(`\n${files.length} spec(s) checked, at least one failed validation`);
  process.exit(1);
}
console.log(`\nall ${files.length} specs valid`);
