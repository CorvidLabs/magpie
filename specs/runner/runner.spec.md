---
module: runner
version: 1
status: draft
files:
  - runner/run.ts
  - runner/validate.ts

db_tables: []
depends_on: []
---

# Runner

## Purpose

The engine: loads an `agent.3md` spec with `@corvidlabs/agent3md`, routes a
request to a skill, fills its typed inputs, renders the real shell command,
and executes it. Two entry points: `run.ts` (execute — either magpie's own
six hand-written target sections, or a generic `--specs-dir`-driven mode
for dogfooding another repo) and `validate.ts` (the fast, dependency-free
structural check `fledge lanes run verify` actually runs — no execution,
just parse + `validateAgent()` over every `.magpie/specs/*.3md`).

## Public API

### CLI flags (`run.ts`)

| Flag | Default | Effect |
|------|---------|--------|
| `--targets=<a,b,...>` | all six | Restricts magpie's own hardcoded target sections to a subset. Ignored entirely in generic mode (every skill in every spec file under `--specs-dir` runs regardless). |
| `--specs-dir=<path>` | `.magpie/specs` | Anything other than the literal string `.magpie/specs` switches the engine from magpie's own six hand-written sections to generic mode. |
| `--out-dir=<path>` | `artifacts` | Where `report.json` and per-skill artifacts/logs are written. |

### `report.json` schema (`StepResult[]`)

| Field | Type | Meaning |
|-------|------|---------|
| `target` | string | The spec file's basename (minus `.3md`/`.steps.toml`), or one of magpie's six hardcoded target names. |
| `skill` | string | The skill's `label` from its `agent.3md` plane. |
| `z` | number | The skill plane's `z` position. |
| `routedVia` | string \| null | The natural-language request that routed to this skill via `agent.route()`, or `null` if fetched directly by name (`agent.get()`). |
| `command` | string \| null | The fully-rendered shell command, or `null` for a guidance-only skill. |
| `exitCode` | number \| null | The executed command's real exit code, or `null` if never run (guidance-only, or an unfilled `{placeholder}` in generic mode). |
| `ok` | boolean | Whether this step passed. See Invariants for exactly what this does and doesn't mean. |
| `note` | string | Human-readable context — captured stdout/stderr, or a reason a step didn't run. |
| `durationMs` | number | Wall-clock time for the step's `exec()` call. |
| `artifacts` | string[] | Paths to files this step produced (screenshots, recordings, response bodies, per-skill logs). |
| `critical` | boolean, optional | Defaults `true` (absent = critical). `false` marks a step whose failure is reported honestly but doesn't fail the whole run — either a real, repeatedly-observed environment limitation outside this engine's control (`ios/open`, `ios/shutdown`), or a spec author's own deliberate negative test case (`cost="expected-fail"` in a hand-written `.3md`, or `expect_fail = true` in a `.steps.toml`). |

### `.steps.toml` shape (compiled to `agent.3md` in memory)

| Key | Required | Meaning |
|-----|----------|---------|
| `agent` | yes | Becomes the compiled spec's `agent:` frontmatter and identity-plane label. |
| `persona` | no | Becomes the compiled spec's `persona:` frontmatter. |
| `[[steps]].name` | yes | Becomes the skill's `label` and its sole `triggers=` phrase. |
| `[[steps]].run` | yes | Becomes the skill's bare `tool=` command. Must not contain a `"` character (breaks the compiled attribute — use a wrapper script instead, same constraint hand-written `tool=` always had). |
| `[[steps]].expect_fail` | no | `true` compiles to `cost="expected-fail"`, mapping to `critical: false` at execution time. |

## Invariants

1. `ok: false` in `report.json` is only ever set from a real, executed
   command's actual exit code (or a real timeout) — never fabricated,
   never silently downgraded to `true`. The one deliberate exception is
   symmetric: a skill that *couldn't* run (guidance-only, or an unfilled
   `{placeholder}` in generic mode) reports `ok: true`, because nothing
   was asserted, not because something passed.
2. `run.ts` exits non-zero if any `critical` step's `ok` is `false`.
   Before this was added, a run could show real `FAIL`s in `report.json`
   while GitHub Actions still reported the job green — every PASS/FAIL in
   this report was cosmetic to CI until this was fixed.
3. Generic mode never fills a `{placeholder}` — a shared engine dogfooding
   someone else's repo can't know their real values (a binary path, an
   app name). A skill left with one unfilled is skipped, never run broken.
4. `.steps.toml` compiles to the *same* `agent.3md` text format hand-written
   specs use, parsed and validated by the identical `@corvidlabs/agent3md`
   call (`validateAgent()` / `new Agent()`) — it is an authoring
   convenience, never a second, parallel execution path.
5. `exec()` bounds every command to 120 seconds (`SIGKILL` on expiry).
   Two different `simctl` operations independently hung past their
   surrounding step's own timeout on real CI runs before this existed,
   burning the whole remaining budget with nothing after them able to
   report; the bound is set with real margin above the slowest known-good
   case observed (82s for one legitimately-slow, non-hung retry).

## Behavioral Examples

```
Given .magpie/specs/cli.3md declares a "version" skill with tool=
  "fledge rune run --timeout=15 --json -- {binary} --version"
When run.ts routes the request "check the git binary version" and fills
  {binary: "git"}
Then it executes `fledge rune run --timeout=15 --json -- 'git' --version`,
  parses the rune JSON envelope, and records ok: true only if the wrapped
  process's own exit_code was 0 and its output matched /version/i.
```

```
Given a caller repo's .magpie/specs/ has only a bare-command,
  cost="expected-fail" skill (a deliberate negative test case)
When run.ts runs in generic mode against that specs-dir
Then the skill's real non-zero exit is recorded as ok: false in
  report.json, but run.ts still exits 0 — critical: false steps are never
  hidden, just never job-fatal.
```

```
Given a *.steps.toml with one [[steps]] entry whose run contains a
  literal double-quote character
When run.ts compiles it
Then compileStepsToml throws before executing anything, naming the
  offending step and pointing at the wrapper-script workaround — never
  silently emits a corrupted tool= attribute.
```

## Error Cases

| Error | When | Behavior |
|-------|------|----------|
| agent3md validation failure | A spec (hand-written `.3md` or compiled from `.steps.toml`) fails `validateAgent()` — a dependency cycle, a duplicate skill name, a malformed input type | `loadAgentFromSource` throws immediately; nothing in that file executes. |
| Command timeout | Any `exec()` call runs past 120s | The process is `SIGKILL`ed; `timedOut: true` is set on the result, `ok` is forced `false` regardless of exit code. |
| Missing `agent`/`steps` in `.steps.toml` | The TOML source is missing the required top-level key, or `steps` is empty | `compileStepsToml` throws before any skill is compiled or run. |
| `"` in a `.steps.toml` step's `run` | The value would corrupt the compiled `tool=` attribute | `compileStepsToml` throws naming the step, before compiling the file at all. |
| No iOS simulator found | `xcrun simctl list devices available -j` has no available "iPhone 17" | `run.ts` throws before attempting to boot anything (non-generic `ios` section only). |

## Dependencies

- `@corvidlabs/agent3md` — the parser/validator/router every spec (hand-written or compiled) goes through.
- `bun:*` built-ins — `Bun.Glob`, `Bun.spawn`, `Bun.file`, `Bun.write`, native `.toml` module import.
- External binaries invoked at runtime, never imported: `fledge` (`http-get`, `rune run`), `git`, `osascript`, `screencapture`, `xcrun simctl`, `adb`, `curl`, `sh`.

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1 | 2026-08-14 | Initial spec, written against the engine as of this session: six-target mode, generic `--specs-dir` mode, `.steps.toml` compilation, `critical`/`expected-fail` handling, the 120s `exec()` timeout, and the exit-code-fidelity fix. |
