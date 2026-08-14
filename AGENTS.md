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
2. **CI is the verification ground, not this machine — and don't run
   GUI-app steps here at all.** Several targets (web/macOS Automation
   permissions, iOS Simulator networking) only behave correctly on a real
   GitHub-hosted runner, so don't trust a local claim of "this works" for
   those. But the sharper rule, learned the expensive way: `open -a`,
   `osascript` driving a real app, and `pkill`/`killall` against one
   don't run in an isolated sandbox on a dev machine — they act on
   whatever's actually running there. A session that ran these "just to
   test locally" opened, navigated, and then force-killed the operator's
   real Safari — twice, the second time via `--targets=`, which is a
   documented no-op in generic mode and so didn't scope anything. CLI/
   HTTP/file-based steps are fine to run locally; a step that opens,
   drives, or kills a GUI application is not, full stop — push it and let
   CI verify instead. The web driver's target browser is now configurable
   ($MAGPIE_BROWSER, see scripts/web-open.sh) — Safari pinned explicitly
   in CI (confirmed working there; Chrome hung a full 8-minute CI timeout
   when tried), Google Chrome as the default everywhere else, since
   Chrome isn't the operator's daily-driver browser. That's a
   blast-radius reduction for the default case, not permission to run
   these steps locally — the rule above still applies regardless of which
   app the current default targets.
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
- `.magpie/specs/*.3md` — one spec per target, human-readable and
  machine-routable at once.
- `scripts/` — small glue (AppleScript, shell) a `tool=` template shells
  out to, used only to dodge shell-quoting hell inside a single-line
  template.
- `.github/workflows/test.yml` — the real CI: a reusable `workflow_call`
  workflow other repos can point at their own specs.

## Dogfood

`CorvidLabs/magpie-sandbox` (private, disposable, "break freely") is
where the engine gets exercised now — real dogfood PRs against MacNTop
and fledge were tried first, closed after real spec-sync/trust governance
friction on their end turned out to be more than the pilots were worth;
revisit real-repo dogfooding once the engine itself (and step-authoring
ergonomics — see `.steps.toml`) are more proven out. The sandbox's own
two jobs mirror the exact `with:` blocks those two PRs used, so the
`workflow_call` mechanism itself stays proven without needing a real,
governed repo in the loop.

## Current milestone

All six targets have real (non-guidance) adapters — Android (`adb` via a
live emulator) was the last one to move off guidance-only. Spec Sync
*is* adopted here now (`specs/`, spec-sync's own natural default —
magpie's own test specs live at `.magpie/specs/` instead, deliberately
namespaced so this testbed doesn't claim a directory name other real
projects already use for their own purposes; see `specs/runner/context.md`
for the full reasoning), covering the engine's own source (`runner/*.ts`)
with `fledge spec check` passing at 100% coverage.
`.steps.toml` is the newest piece: a much lower-friction way to author a
generic-mode spec, after hand-writing raw `.3md` caused three separate
accidental dependency-cycle mistakes this project's own history.

<!-- CorvidLabs trust toolchain: BEGIN (managed, do not edit inside) -->
## CorvidLabs trust toolchain

This repository uses one trust gate. Every session must use it and must not bypass or weaken it.

- Run `fledge trust verify` before calling a change complete.
- Keep module specs synchronized with implementation changes.
- Treat an Augur block verdict as a hard stop that must be surfaced and de-risked.
- Record and verify provenance with Attest after the repository's verification lane passes.
- Keep generated trust configuration and this managed block in place.

<!-- CorvidLabs trust toolchain: END -->
