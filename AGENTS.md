# magpie

Cross-platform agent-driven testbed. One `agent.3md` spec per target
(web, API, iOS, macOS, CLI, Android), each with real `tool=` bindings —
no mocking. `runner/run.ts` loads a spec, routes a natural-language
request to a skill, fills its typed inputs, and executes the rendered
command for real.

## Product rules

1. **No mocking, no simulated anything.** Every `tool=` shells out to a
   real binary against real state. If a target can't run somewhere
   (no adb here, no macOS TCC grant there), say so and skip — never fake
   a result.
2. **CI is the verification ground, not this machine.** Several targets
   (web/macOS Automation permissions, iOS Simulator networking) only
   behave correctly on a real GitHub-hosted runner. Don't trust a local
   claim of "this works" for those — trust the workflow run.
3. **Every `tool=` must render cleanly.** No unfilled `{placeholder}` in
   a rendered command, no dependency cycles in `[[z=N|...]]` links —
   `bun run validate` (or `fledge lanes run verify`) catches both before
   anything executes.
4. **Bun only** (not Node) for scripts and the runner.
5. Prefer **fledge** tasks: `fledge lanes run verify`, `fledge rune run`
   (the CLI target's own driver).

## Layout

- `runner/run.ts` — the engine: loads `@corvidlabs/agent3md`, routes,
  fills, executes, asserts, writes `artifacts/report.json`. Two modes:
  magpie's own six hardcoded target sections (default), or a generic
  `--specs-dir=<path>` mode for dogfooding another repo (see README's
  "Using this in another repo").
- `runner/validate.ts` — the fast, dependency-free structural check
  `fledge lanes run verify` actually runs.
- `specs/*.3md` — one spec per target, human-readable and
  machine-routable at once.
- `scripts/` — small glue (AppleScript, shell) a `tool=` template shells
  out to, used only to dodge shell-quoting hell inside a single-line
  template.
- `.github/workflows/test.yml` — the real CI: a reusable `workflow_call`
  workflow other repos can point at their own specs.

## Dogfood

MacNTop (macOS target) and fledge itself (CLI target) are the first two
pilot repos consuming magpie's generic engine —
[MacNTop#7](https://github.com/CorvidLabs/MacNTop/pull/7),
[fledge#510](https://github.com/CorvidLabs/fledge/pull/510). A private
sandbox, `CorvidLabs/magpie-sandbox`, proves the `workflow_call` mechanism
itself on every push before either PR needs to be trusted blind.

## Current milestone

All six targets have real (non-guidance) adapters as of this pass —
Android (`adb` via a live emulator) was the last one to move off
guidance-only. `specs/` intentionally collides in name with Spec Sync's
own convention (module contracts), which is why Spec Sync isn't adopted
here yet (`--no-specs` was passed to `fledge trust adopt`, with the
reason recorded in `.trust.toml`) — resolving that needs a directory
split, not a config trick.

<!-- CorvidLabs trust toolchain: BEGIN (managed, do not edit inside) -->
## CorvidLabs trust toolchain

This repository uses one trust gate. Every session must use it and must not bypass or weaken it.

- Run `fledge trust verify` before calling a change complete.
- Keep module specs synchronized with implementation changes.
- Treat an Augur block verdict as a hard stop that must be surfaced and de-risked.
- Record and verify provenance with Attest after the repository's verification lane passes.
- Keep generated trust configuration and this managed block in place.

<!-- CorvidLabs trust toolchain: END -->
