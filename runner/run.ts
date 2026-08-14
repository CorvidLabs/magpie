#!/usr/bin/env bun
// Orchestrator for the testbed POC.
//
// Loads each .magpie/specs/<target>.3md with the real @corvidlabs/agent3md library,
// routes a natural-language request to a skill (proving trigger matching
// works), fills its typed inputs, renders the real shell command, and
// actually executes it. No mocking: every non-stub step below runs a real
// binary against real state (a live URL, a live Safari window, a live
// simulator, a live app window) and writes a real artifact to artifacts/.

import { Agent, validateAgent, formatReport } from "@corvidlabs/agent3md";
import { mkdir } from "node:fs/promises";

interface StepResult {
  target: string;
  skill: string;
  z: number;
  routedVia: string | null;
  command: string | null;
  exitCode: number | null;
  ok: boolean;
  note: string;
  durationMs: number;
  artifacts: string[];
  // Defaults true (unset = critical). Explicitly false only for
  // teardown/cleanup steps like ios/shutdown: a real run hit "CoreSimulatorService
  // connection interrupted" there even after a retry — Apple's own simulator
  // daemon being flaky, not something magpie controls — and a lingering
  // simulator on an ephemeral CI VM that's destroyed right after the job
  // isn't a real problem the way a failed assertion about the system under
  // test is. Still reported as FAIL in the report, just not job-fatal.
  critical?: boolean;
}

const results: StepResult[] = [];
const ROOT = process.cwd();
const log = (line: string) => console.log(line);

// `bun runner/run.ts --targets=api,cli` runs a subset (used by CI so each
// runner OS only does the targets it can actually drive). No flag = all six.
const targetArg = process.argv.find((a) => a.startsWith("--targets="));
const requestedTargets = targetArg ? targetArg.slice("--targets=".length).split(",") : null;
const shouldRun = (target: string) => !requestedTargets || requestedTargets.includes(target);

// `--specs-dir=<path>` and `--out-dir=<path>` point this engine at another
// project's own .3md specs instead of magpie's own demo ones — this is the
// whole mechanism by which "dogfood magpie on project X" works. Left at the
// default (".magpie/specs"), magpie runs its own six hand-written, richly-
// asserted target sections below, unchanged. Pointed elsewhere, it switches
// to a generic engine: every .3md file directly under specs-dir, every
// skill with a `tool` (in z order), executed and recorded on exit code
// alone — no per-skill custom assertions, because a shared engine can't
// know what "correct" means for someone else's project. Skills need to be
// bare/parameterless (a dogfooding repo's spec authors know their own real
// values — a binary path, an app name — and can bake them straight into
// `tool=` rather than this engine guessing at fill values); a skill still
// carrying an unfilled `{placeholder}` is skipped with a clear reason
// rather than run broken.
//
// The default is namespaced (".magpie/specs", not bare "specs") on
// purpose: "specs" is a common directory name plenty of other tooling
// already wants (Spec Sync's own default among them — see
// .specsync/config.toml, which reclaimed the bare name once this moved).
// A testbed meant to be dropped into other people's real projects
// shouldn't force them to rename something that was already there first.
const specsDirArg = process.argv.find((a) => a.startsWith("--specs-dir="));
const outDirArg = process.argv.find((a) => a.startsWith("--out-dir="));
const specsDir = specsDirArg ? specsDirArg.slice("--specs-dir=".length) : ".magpie/specs";
const outDir = outDirArg ? outDirArg.slice("--out-dir=".length) : "artifacts";
const isGeneric = specsDir !== ".magpie/specs";
await mkdir(outDir, { recursive: true }); // record() writes report.json here from the very first step

async function runGeneric(): Promise<void> {
  const md3Files = Array.from(new Bun.Glob("*.3md").scanSync({ cwd: specsDir })).sort();
  const stepsFiles = Array.from(new Bun.Glob("*.steps.toml").scanSync({ cwd: specsDir })).sort();
  if (md3Files.length === 0 && stepsFiles.length === 0) log(`  no .3md or .steps.toml files found under ${specsDir}`);

  for (const file of md3Files) {
    const specPath = `${specsDir}/${file}`;
    const dir = file.replace(/\.3md$/, "");
    log(`\n=== ${specPath} ===`);
    const agent = await loadAgent(specPath);
    await mkdir(`${outDir}/${dir}`, { recursive: true });
    await runSkillsGeneric(agent, dir);
  }

  for (const file of stepsFiles) {
    const specPath = `${specsDir}/${file}`;
    const dir = file.replace(/\.steps\.toml$/, "");
    log(`\n=== ${specPath} (compiled from .steps.toml) ===`);
    const absPath = specPath.startsWith("/") ? specPath : `${process.cwd()}/${specPath}`;
    const mod = await import(absPath);
    const compiled = compileStepsToml(mod.default as StepsToml, specPath);
    const agent = loadAgentFromSource(compiled, specPath);
    await mkdir(`${outDir}/${dir}`, { recursive: true });
    await runSkillsGeneric(agent, dir);
  }
}

async function runSkillsGeneric(agent: Agent, dir: string): Promise<void> {
    const skills = [...agent.manifest().skills].sort((a, b) => a.z - b.z);
    for (const s of skills) {
      // cost="expected-fail" is magpie's own convention (cost is a free-form
      // tag per the agent3md spec, not a closed set), not a formal part of
      // agent.3md itself: a shared engine running someone else's specs
      // can't know their skills' intent, but a spec author CAN mark "this
      // one is a deliberate negative test case" so its failure is still
      // honestly reported but doesn't fail the whole job — the same
      // critical:false reasoning as ios/open and ios/shutdown below, just
      // driven by the spec instead of hardcoded per-skill JS.
      const expectedFail = s.cost === "expected-fail";
      if (!s.tool) {
        record({ target: dir, skill: s.name, z: s.z, routedVia: null, command: null, exitCode: null, ok: true, note: "guidance-only, skipped (no tool=)", durationMs: 0, artifacts: [] });
        continue;
      }
      const cmd = agent.command(s.name)!;
      if (/\{[a-zA-Z_]+\}/.test(cmd)) {
        // Not run, so not really a failure either — an engine limitation
        // notice, not a broken assertion.
        record({ target: dir, skill: s.name, z: s.z, routedVia: null, command: cmd, exitCode: null, ok: true, note: "skipped: unfilled {placeholder} — generic mode only runs bare tool= commands", durationMs: 0, artifacts: [] });
        continue;
      }
      const e = await exec(cmd);
      const logPath = `${outDir}/${dir}/${s.name}.log`;
      await Bun.write(logPath, `$ ${cmd}\n\n--- stdout ---\n${e.stdout}\n--- stderr ---\n${e.stderr}\n`);
      record({ target: dir, skill: s.name, z: s.z, routedVia: null, command: cmd, exitCode: e.exitCode, ok: e.exitCode === 0, note: (e.stdout.trim() || e.stderr.trim()).slice(0, 200), durationMs: e.durationMs, artifacts: [logPath], critical: !expectedFail });
    }
}

function loadAgentFromSource(src: string, label: string): Agent {
  const report = validateAgent(src);
  log(formatReport(label, report));
  if (!report.ok) throw new Error(`${label} failed agent3md validation`);
  return new Agent(src);
}

async function loadAgent(specPath: string): Promise<Agent> {
  const src = await Bun.file(specPath).text();
  return loadAgentFromSource(src, specPath);
}

// A .steps.toml is a much lower-friction way to write a spec than
// hand-authoring .3md directly: no frontmatter ceremony, no manual
// z-numbering, no triggers to invent when routing was never the point,
// no [[z=N|...]] dependency-link syntax to accidentally cycle — this
// session hit that exact mistake three separate times hand-writing .3md
// by hand. It compiles to a real, fully valid agent.3md in memory: same
// parser, same validation, same guarantees. This is an authoring
// convenience layered on top of the format, not a second engine.
interface StepsToml {
  agent: string;
  persona?: string;
  steps: { name: string; run: string; expect_fail?: boolean }[];
}

function compileStepsToml(data: StepsToml, sourceFile: string): string {
  if (!data.agent) throw new Error(`${sourceFile}: missing required top-level "agent" key`);
  if (!Array.isArray(data.steps) || data.steps.length === 0) throw new Error(`${sourceFile}: needs at least one [[steps]] entry`);
  const lines = [
    "---",
    "3md: 1.0",
    "axis: skill",
    `agent: ${data.agent}`,
    ...(data.persona ? [`persona: ${data.persona}`] : []),
    "---",
    `Compiled in-memory from ${sourceFile} by runner/run.ts's .steps.toml support — edit the source, not this generated form.`,
    "",
    `@plane z=0 label="${data.agent}" kind=identity`,
    `# ${data.agent}`,
    "",
  ];
  data.steps.forEach((step, i) => {
    if (!step.name || !step.run) throw new Error(`${sourceFile}: step ${i} needs both "name" and "run"`);
    // Same constraint hand-written tool= always had — a double quote
    // breaks the attribute it's embedded in. A wrapper script (see
    // scripts/*.sh elsewhere in this repo) is the documented way around
    // it, same as it's always been.
    if (step.run.includes('"')) throw new Error(`${sourceFile}: step "${step.name}"'s run contains a double quote, which breaks the compiled tool= attribute — write a wrapper script instead`);
    const cost = step.expect_fail ? ` cost="expected-fail"` : "";
    lines.push(`@plane z=${i + 1} label="${step.name}" kind=skill triggers="${step.name}" tool="${step.run}"${cost}`);
    lines.push(`# Skill: ${step.name}`, "");
  });
  return lines.join("\n");
}

// Default 2 minutes: a real, observed CI run needed 82s for a single
// legitimately-slow (not hung) `ios/open` retry, so this needs real
// margin above that — but every exec() call used to have NO timeout at
// all, and two different `simctl` operations (record's background
// process, and a bare `shutdown` call) have each independently hung past
// their surrounding step's own timeout on a real run, burning the full
// remaining budget before anything else could report. Bounding every
// command here, once, beats hardening each risky call site individually
// as they're discovered one at a time.
async function exec(cmd: string, timeoutMs = 120_000) {
  const start = performance.now();
  const proc = Bun.spawn(["/bin/sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const killer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);
  const durationMs = Math.round(performance.now() - start);
  return { stdout, stderr, exitCode, durationMs, timedOut: durationMs >= timeoutMs };
}

function record(r: StepResult) {
  results.push(r);
  const badge = r.ok ? "PASS" : "FAIL";
  log(`  [${badge}] ${r.target}/${r.skill} — ${r.note} (${r.durationMs}ms)`);
  if (r.command) log(`         $ ${r.command}`);
  // Written after every step, not just at the end: a run.ts process killed
  // mid-flight by a step timeout (this has happened) otherwise loses the
  // whole structured report even though individual artifacts survive.
  // Fire-and-forget is fine here — worst case the very last step's write
  // loses a race with process exit, which beats losing everything.
  Bun.write(`${outDir}/report.json`, JSON.stringify(results, null, 2)).catch(() => {});
}

if (isGeneric) {
  log(`\nrunning generic mode against ${specsDir} (magpie's own six hand-written target sections are skipped)`);
  await runGeneric();
} else {

for (const dir of ["api", "cli", "web", "macos", "ios", "android"]) {
  await mkdir(`artifacts/${dir}`, { recursive: true });
}

// ============================== API ==============================
log("\n=== API target (.magpie/specs/api.3md) ===");
if (shouldRun("api")) {
  const agent = await loadAgent(".magpie/specs/api.3md");
  const request = "call the api and check the response";
  const [match] = agent.route(request);
  log(`  routed "${request}" -> ${match.skill.name} (hits: ${match.hits.join(", ")})`);
  const cmd = agent.command(match.skill.name, { url: "https://example.com" })!;
  const { stdout, stderr, exitCode, durationMs } = await exec(cmd);
  await Bun.write("artifacts/api/response.json", stdout);
  let ok = false, note = "no response";
  try {
    const parsed = JSON.parse(stdout);
    ok = exitCode === 0 && parsed.ok === true && parsed.status >= 200 && parsed.status < 300;
    note = `status ${parsed.status}, ${stdout.length}B body`;
  } catch {
    note = stderr.trim().slice(0, 200) || "failed to parse response";
  }
  record({ target: "api", skill: match.skill.name, z: match.skill.z, routedVia: request, command: cmd, exitCode, ok, note, durationMs, artifacts: ["artifacts/api/response.json"] });
}

// ============================== CLI ==============================
log("\n=== CLI target (.magpie/specs/cli.3md) ===");
if (shouldRun("cli")) {
  const agent = await loadAgent(".magpie/specs/cli.3md");

  const req1 = "check the git binary version";
  const [m1] = agent.route(req1);
  log(`  routed "${req1}" -> ${m1.skill.name} (hits: ${m1.hits.join(", ")})`);
  const cmd1 = agent.command(m1.skill.name, { binary: "git" })!;
  const e1 = await exec(cmd1);
  await Bun.write("artifacts/cli/version.json", e1.stdout);
  let ok1 = false, note1 = "";
  try {
    const parsed = JSON.parse(e1.stdout);
    ok1 = parsed.status === "ok" && parsed.data.exit_code === 0 && /version/i.test(parsed.data.clean_output);
    note1 = parsed.data.clean_output.trim();
  } catch { note1 = e1.stderr.trim().slice(0, 200); }
  record({ target: "cli", skill: m1.skill.name, z: m1.skill.z, routedVia: req1, command: cmd1, exitCode: e1.exitCode, ok: ok1, note: note1, durationMs: e1.durationMs, artifacts: ["artifacts/cli/version.json"] });

  // fetched directly by name (a bare command, no placeholders) instead of routed
  const status = agent.get("status")!;
  const cmd2 = agent.command(status.name)!;
  const e2 = await exec(cmd2);
  await Bun.write("artifacts/cli/status.json", e2.stdout);
  let ok2 = false, note2 = "";
  try {
    const parsed = JSON.parse(e2.stdout);
    // magpie is itself a real pushed git repo now, so a clean `git status`
    // (exit 0) is the expected outcome — not "not a git repository" (that
    // was only ever true in the throwaway pre-init local sandbox).
    ok2 = parsed.status === "ok" && parsed.data.exit_code === 0;
    note2 = parsed.data.clean_output.trim() || "(clean)";
  } catch { note2 = e2.stderr.trim().slice(0, 200); }
  record({ target: "cli", skill: status.name, z: status.z, routedVia: null, command: cmd2, exitCode: e2.exitCode, ok: ok2, note: note2, durationMs: e2.durationMs, artifacts: ["artifacts/cli/status.json"] });
}

// ============================== WEB ==============================
log("\n=== Web target (.magpie/specs/web.3md) ===");
if (shouldRun("web")) {
  const agent = await loadAgent(".magpie/specs/web.3md");
  const chain = agent.resolve("screenshot").map((s) => s.name);
  log(`  dependency chain for "screenshot": ${chain.join(" -> ")}`);

  const req = "open this web page in the browser";
  const [m1] = agent.route(req);
  log(`  routed "${req}" -> ${m1.skill.name} (hits: ${m1.hits.join(", ")})`);
  const cmd1 = agent.command(m1.skill.name, { url: "https://example.com" })!;
  const e1 = await exec(cmd1);
  const title = e1.stdout.trim();
  await Bun.write("artifacts/web/title.txt", title);
  record({ target: "web", skill: m1.skill.name, z: m1.skill.z, routedVia: req, command: cmd1, exitCode: e1.exitCode, ok: e1.exitCode === 0 && title.length > 0, note: `title: "${title}"`, durationMs: e1.durationMs, artifacts: ["artifacts/web/title.txt"] });

  const shot = agent.get("screenshot")!;
  const shotPath = `${ROOT}/artifacts/web/screenshot.png`;
  const cmd2 = agent.command(shot.name, { path: shotPath })!;
  const e2 = await exec(cmd2);
  record({ target: "web", skill: shot.name, z: shot.z, routedVia: null, command: cmd2, exitCode: e2.exitCode, ok: e2.exitCode === 0, note: "full-screen capture", durationMs: e2.durationMs, artifacts: [shotPath] });
}

// ============================== macOS ==============================
log("\n=== macOS target (.magpie/specs/macos.3md) ===");
if (shouldRun("macos")) {
  const agent = await loadAgent(".magpie/specs/macos.3md");
  const req = "launch the app and read its accessibility ui elements";
  const [m1] = agent.route(req);
  log(`  routed "${req}" -> ${m1.skill.name} (hits: ${m1.hits.join(", ")})`);
  const cmd1 = agent.command(m1.skill.name, { app: "Calculator" })!;
  const e1 = await exec(cmd1);
  await Bun.write("artifacts/macos/ui-elements.txt", e1.stdout);
  const elementCount = e1.stdout.split(",").map((s) => s.trim()).filter(Boolean).length;
  record({ target: "macos", skill: m1.skill.name, z: m1.skill.z, routedVia: req, command: cmd1, exitCode: e1.exitCode, ok: e1.exitCode === 0 && elementCount > 0, note: `${elementCount} UI elements read`, durationMs: e1.durationMs, artifacts: ["artifacts/macos/ui-elements.txt"] });

  const shot = agent.get("screenshot")!;
  const shotPath = `${ROOT}/artifacts/macos/screenshot.png`;
  const cmd2 = agent.command(shot.name, { path: shotPath })!;
  const e2 = await exec(cmd2);
  record({ target: "macos", skill: shot.name, z: shot.z, routedVia: null, command: cmd2, exitCode: e2.exitCode, ok: e2.exitCode === 0, note: "full-screen capture", durationMs: e2.durationMs, artifacts: [shotPath] });
}

// ============================== iOS Simulator ==============================
log("\n=== iOS Simulator target (.magpie/specs/ios.3md) ===");
if (shouldRun("ios")) {
  const agent = await loadAgent(".magpie/specs/ios.3md");

  const listRaw = await exec("xcrun simctl list devices available -j");
  const list = JSON.parse(listRaw.stdout);
  let device: { udid: string; label: string } | null = null;
  for (const runtime of Object.keys(list.devices)) {
    const found = (list.devices[runtime] as any[]).find((d) => d.name === "iPhone 17" && d.isAvailable);
    if (found) { device = { udid: found.udid, label: `${found.name} (${runtime})` }; break; }
  }
  if (!device) throw new Error("no available 'iPhone 17' simulator found on this host");
  log(`  using simulator: ${device.label} [${device.udid}]`);

  const boot = agent.get("boot")!;
  const cmdBoot = agent.command(boot.name, { device: device.udid })!;
  const eBoot = await exec(cmdBoot);
  record({ target: "ios", skill: boot.name, z: boot.z, routedVia: null, command: cmdBoot, exitCode: eBoot.exitCode, ok: eBoot.exitCode === 0, note: eBoot.exitCode === 0 ? "booted" : eBoot.stderr.trim().slice(0, 200), durationMs: eBoot.durationMs, artifacts: [] });

  await exec(`xcrun simctl bootstatus ${device.udid} -b`);

  const open = agent.get("open")!;
  const cmdOpen = agent.command(open.name, { device: device.udid, url: "https://example.com" })!;
  const eOpen = await exec(cmdOpen);
  record({ target: "ios", skill: open.name, z: open.z, routedVia: null, command: cmdOpen, exitCode: eOpen.exitCode, ok: eOpen.exitCode === 0, note: eOpen.exitCode === 0 ? "opened in mobile Safari" : eOpen.stderr.trim().slice(0, 200), durationMs: eOpen.durationMs, artifacts: [], critical: false });

  const shot = agent.get("screenshot")!;
  const shotPath = `${ROOT}/artifacts/ios/screenshot.png`;
  const cmdShot = agent.command(shot.name, { device: device.udid, path: shotPath })!;
  const eShot = await exec(cmdShot);
  record({ target: "ios", skill: shot.name, z: shot.z, routedVia: null, command: cmdShot, exitCode: eShot.exitCode, ok: eShot.exitCode === 0, note: "screenshot of live simulator", durationMs: eShot.durationMs, artifacts: [shotPath] });

  const rec = agent.get("record")!;
  const recPath = `${ROOT}/artifacts/ios/recording.mp4`;
  const cmdRec = agent.command(rec.name, { device: device.udid, path: recPath, seconds: "3" })!;
  const eRec = await exec(cmdRec);
  record({ target: "ios", skill: rec.name, z: rec.z, routedVia: null, command: cmdRec, exitCode: eRec.exitCode, ok: eRec.exitCode === 0, note: "3s screen recording", durationMs: eRec.durationMs, artifacts: [recPath] });

  const down = agent.get("shutdown")!;
  const cmdDown = agent.command(down.name, { device: device.udid })!;
  const eDown = await exec(cmdDown);
  const downOk = eDown.exitCode === 0 && !eDown.timedOut;
  const downNote = eDown.timedOut ? "timed out — killed after 120s, see exec()'s own timeout" : downOk ? "shut down, no simulator left running" : (eDown.stderr.trim() || eDown.stdout.trim()).slice(0, 200);
  record({ target: "ios", skill: down.name, z: down.z, routedVia: null, command: cmdDown, exitCode: eDown.exitCode, ok: downOk, note: downNote, durationMs: eDown.durationMs, artifacts: [], critical: false });
}

// ============================== Android ==============================
// First real (non-guidance) pass — proven via reactivecircus/android-
// emulator-runner, which owns the emulator's boot/shutdown lifecycle for
// the duration of one CI step. Nothing to boot/teardown here ourselves.
log("\n=== Android target (.magpie/specs/android.3md) ===");
if (shouldRun("android")) {
  const agent = await loadAgent(".magpie/specs/android.3md");

  const req = "list connected android devices";
  const [m1] = agent.route(req);
  log(`  routed "${req}" -> ${m1.skill.name} (hits: ${m1.hits.join(", ")})`);
  const cmd1 = agent.command(m1.skill.name)!;
  const e1 = await exec(cmd1);
  await Bun.write("artifacts/android/devices.txt", e1.stdout);
  const hasDevice = /\bdevice\b/.test(e1.stdout) && !/^List of devices attached\s*$/.test(e1.stdout.trim());
  record({ target: "android", skill: m1.skill.name, z: m1.skill.z, routedVia: req, command: cmd1, exitCode: e1.exitCode, ok: e1.exitCode === 0 && hasDevice, note: e1.stdout.trim().slice(0, 200) || "no devices listed", durationMs: e1.durationMs, artifacts: ["artifacts/android/devices.txt"] });

  const shot = agent.get("screenshot")!;
  const cmdShot = agent.command(shot.name)!;
  const eShot = await exec(cmdShot);
  record({ target: "android", skill: shot.name, z: shot.z, routedVia: null, command: cmdShot, exitCode: eShot.exitCode, ok: eShot.exitCode === 0, note: eShot.exitCode === 0 ? "screenshot of live emulator" : eShot.stderr.trim().slice(0, 200), durationMs: eShot.durationMs, artifacts: ["artifacts/android/screenshot.png"] });

  // critical: false — same reasoning as ios/open and ios/shutdown: this is
  // evidence capture, not correctness-proving (devices + screenshot above
  // already prove the emulator is alive and capturable). Real, currently
  // undiagnosed CI flake — two consecutive real runs failed fast (~1.4-2s)
  // with the artifact confirmed never created, but zero stderr either
  // time; `note` used to be a hardcoded string that hid whatever error
  // text existed, now shows the real stderr on failure so the next
  // occurrence is actually diagnosable instead of a silent flake.
  const rec = agent.get("record")!;
  const cmdRec = agent.command(rec.name)!;
  const eRec = await exec(cmdRec);
  record({ target: "android", skill: rec.name, z: rec.z, routedVia: null, command: cmdRec, exitCode: eRec.exitCode, ok: eRec.exitCode === 0, note: eRec.exitCode === 0 ? "3s screen recording" : eRec.stderr.trim().slice(0, 200) || "failed with no stderr output", durationMs: eRec.durationMs, artifacts: ["artifacts/android/recording.mp4"], critical: false });
}

} // end of magpie's own hardcoded target sections (isGeneric === false)

// ============================== Report ==============================
await mkdir(outDir, { recursive: true });
await Bun.write(`${outDir}/report.json`, JSON.stringify(results, null, 2));

log("\n=== Summary ===");
const byTarget = new Map<string, StepResult[]>();
for (const r of results) {
  if (!byTarget.has(r.target)) byTarget.set(r.target, []);
  byTarget.get(r.target)!.push(r);
}
for (const [target, steps] of byTarget) {
  const pass = steps.filter((s) => s.ok).length;
  log(`  ${target}: ${pass}/${steps.length} ${pass === steps.length ? "OK" : "CHECK"}`);
}
log(`\nfull report: ${outDir}/report.json`);

// Real gap this caught itself on: nothing above ever called process.exit,
// so a run with a genuine FAIL (not a hang, not a timeout — an actual
// non-zero exit from a real command) still exited 0 and GitHub Actions
// reported the whole job green. Every PASS/FAIL in this report was
// cosmetic from CI's perspective until now.
const allFailed = results.filter((r) => !r.ok);
const criticalFailed = allFailed.filter((r) => r.critical !== false);
if (allFailed.length > criticalFailed.length) {
  log(`\n${allFailed.length - criticalFailed.length} non-critical step(s) failed (reported above, not job-fatal): ${allFailed.filter((r) => r.critical === false).map((r) => `${r.target}/${r.skill}`).join(", ")}`);
}
if (criticalFailed.length > 0) {
  log(`\n${criticalFailed.length} step(s) failed: ${criticalFailed.map((r) => `${r.target}/${r.skill}`).join(", ")}`);
  process.exit(1);
}
