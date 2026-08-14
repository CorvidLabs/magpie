---
spec: runner.spec.md
---

## User Stories

- As magpie itself, I want to route a natural-language request to a
  skill, fill its typed inputs, and run the rendered command for real —
  no mocking — so that a target's own six specs prove their real drivers
  work.
- As a dogfooding repo, I want to point this engine at my own
  `.3md`/`.steps.toml` specs and get an honest exit code back, so my CI
  actually reflects whether my real commands passed.
- As anyone reading `report.json` (a human or another tool), I want every
  `ok`/`critical` value to mean exactly what it says — never fabricated,
  never silently downgraded — so the report is trustworthy without
  needing to re-read the source to double-check it.

## Acceptance Criteria

- `run.ts` with no flags reproduces magpie's own six-target behavior
  unchanged (default `--specs-dir` behaves identically to no flag at all).
- `run.ts --specs-dir=<other>` runs every `.3md` and `.steps.toml` skill
  found there, ignoring `--targets` entirely, on exit code alone.
- A `critical: false` (or absent → `true`) step's outcome is always
  visible in `report.json`, regardless of whether it affects the process
  exit code.
- `validate.ts` never executes a command — parse and `validateAgent()`
  only — so it's safe to run anywhere, including a generic verify-gate
  runner with none of the real targets' tooling installed.

## Constraints

- No network calls except the ones a spec's own `tool=` makes (`fledge
  http-get`, `curl`) — the engine itself has no fetch/HTTP logic.
- Every external capability is a real binary invocation, never a library
  import — keeps the engine portable across whatever a caller's `tool=`
  needs, at the cost of the engine itself knowing nothing about HTTP
  status codes, Accessibility trees, or `adb` semantics.
- `.steps.toml` skills must be bare/parameterless — the same constraint
  generic mode already imposes on hand-written `.3md`, inherited rather
  than special-cased.

## Out of Scope

- An actual agent-driven fallback loop (a guidance-only skill with no
  `tool=` is skipped and logged, never handed to a model to interpret and
  improvise) — the biggest real gap relative to the original "scripted
  backbone + agent fallback" design; not attempted here.
- Visual diffing of screenshots/recordings against a baseline — artifacts
  prove liveness, not regression-freedom.
- Any format beyond `.3md`/`.steps.toml` (no YAML, no JSON step lists) —
  see this module's own design discussion on why TOML was chosen and
  YAML wasn't.
