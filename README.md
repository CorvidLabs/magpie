# magpie

[![CI](https://github.com/CorvidLabs/magpie/actions/workflows/test.yml/badge.svg)](https://github.com/CorvidLabs/magpie/actions/workflows/test.yml)
[![Bun](https://img.shields.io/badge/Bun-1.x-fbf0df.svg)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A generic cross-platform testbed: one `.3md` spec file per target (web, API,
iOS, macOS, CLI, Android), each driving *real* commands against *real*
state. No mocking, no headless-browser download, no simulated anything.

`bun runner/run.ts` runs anywhere Bun and a target's own real tools exist
— a real device included, not only CI. `.github/workflows/test.yml` runs
it on GitHub-hosted runners, but that's a choice about *where* to get
the permission grants some targets need (Screen Recording, KVM,
Automation/TCC), not a statement that local or on-device execution isn't
real. Screenshot/video capture specifically needs those grants wherever
it runs, CI or not — see "Why CI, specifically" below for exactly which
ones and why CI is where this project got them without hand-configuring a
machine's TCC settings.

## Why this shape

- **The spec format is [`agent.3md`](https://github.com/CorvidLabs/agent-3md).**
  Each `specs/<target>.3md` is a small agent: an identity plane plus a few
  skill planes. A skill declares `triggers` (natural-language phrases that
  route to it), typed `inputs`, and an optional `tool=` command template.
  `route("open this web page") → fill inputs → run the rendered command` is
  the whole loop — see `runner/run.ts`.
- **Every target's driver is something that already exists.** Nothing here
  is a custom UI-automation layer:
  - **API** → `fledge http-get` (CorvidLabs/fledge-plugin-http)
  - **CLI** → `fledge rune run` (CorvidLabs/rune) — PTY-wrapped, so output
    matches a real terminal even for tools that behave differently headless
  - **Web** → a configurable real browser (`$MAGPIE_BROWSER`), driven
    through `System Events` keystrokes (`scripts/web-open.sh`) — not the
    browser's own AppleScript dictionary, which needs a macOS Automation
    consent grant a fresh CI runner doesn't have. Safari in CI (pinned
    explicitly in `test.yml` — confirmed working there; Chrome hung the
    full 8-minute step timeout when tried), Google Chrome everywhere else
    by default, since this drives a real GUI browser window that gets
    force-killed and Chrome isn't anyone's daily-driver browser here
  - **macOS** → a launched app's Accessibility tree, read via
    `System Events` (`scripts/macos-launch.sh`) — the same bridge a native
    `AXUIElement` adapter would call
  - **iOS** → `xcrun simctl` directly (boot → open → screenshot → record →
    shutdown), no Appium/WebDriverAgent needed
  - **Android** → `adb` against a real emulator that
    [`reactivecircus/android-emulator-runner`](https://github.com/reactivecircus/android-emulator-runner)
    boots for the one CI step it runs in (devices → screenshot → record) —
    unlike `simctl`, that action owns the whole boot/shutdown lifecycle
    itself, so there's no separate boot/teardown skill the way iOS has one
- **Why CI, specifically.** `.github/workflows/test.yml` splits targets across
  GitHub-hosted runners: `ubuntu-latest` runs CLI and, in a separate job,
  Android (KVM-accelerated emulator); `macos-latest` runs API/web/macOS/iOS
  (Xcode + simulators ship preinstalled). Android's job specifically needs
  to be Linux, not macOS: the first attempt put it on `macos-latest` and
  failed every time with `HVF error: HV_UNSUPPORTED` — GitHub's hosted
  macOS runners are themselves VMs and don't support nested virtualization
  for Hypervisor.framework, so hardware-accelerated Android emulation is
  fundamentally unavailable there. `fledge` itself is installed via its
  `install.sh` (a prebuilt release binary) rather than `cargo install` or
  `brew` — the cargo path alone was a confirmed 10-minute job, compiling
  ~355 dependencies from source every run. API moved off Linux after the
  first real run: `fledge-plugin-http` is a Swift package that calls
  Darwin-only Foundation/CoreFoundation APIs and doesn't build under
  swift-corelibs-foundation on Linux — a real upstream portability bug,
  not something fixable from this repo's workflow file. Every "Run …
  targets" step also carries a hard `timeout-minutes`, after a first macOS
  run hung indefinitely — likely a macOS Automation/Apple-Events consent
  dialog for AppleScript-driven browser/Calculator control, with no one
  there to click "Allow." Disposable runners still sidestep the class of problem
  this project ran into locally during development: macOS's Screen Recording
  permission is a one-time, per-host grant, so a sandboxed local process
  can't `screencapture` or record video without it, no matter how correct
  the command is.

## Running it

```sh
bun install
bun runner/run.ts                    # all targets
bun runner/run.ts --targets=api,cli  # subset — what CI's ubuntu job runs
```

Artifacts (screenshots, recordings, raw responses, per-step JSON) land under
`artifacts/<target>/`; `artifacts/report.json` is the combined report.

## Layout

```
specs/           one agent.3md per target — the test spec, human-readable and machine-routable
scripts/         small glue (AppleScript, shell) a tool= template shells out to,
                 used only to dodge shell-quoting hell inside a single-line template
runner/run.ts    loads each spec with @corvidlabs/agent3md, routes, fills,
                 executes, asserts, writes artifacts/report.json
runner/validate.ts  the fast, dependency-free check `fledge lanes run verify` runs —
                    every spec parses, no cycles, no unfilled placeholders left dangling
fledge.toml, AGENTS.md, .trust.toml, .augur.toml, .attest.json
                 the CorvidLabs trust toolchain (`fledge trust adopt`), contract gate included
module-specs/    real Spec Sync module contracts for this engine's own source (runner/*.ts) —
                 not specs/, which already means something else here; see its own context.md
```

## Using this in another repo

`runner/run.ts` has two modes:

- **Default** (`specs-dir` unset, or `specs`) — magpie's own six hand-written,
  richly-asserted target sections, unchanged. This is what runs on pushes
  and PRs to this repo.
- **Generic** (`--specs-dir=<path>` pointing anywhere else) — every `.3md`
  file directly under that directory, every skill with a `tool=` in `z`
  order, executed and recorded on exit code alone. No per-skill custom
  assertions — a shared engine can't know what "correct" means for someone
  else's project, only whether their command succeeded. Skills need to be
  bare/parameterless: a dogfooding repo's spec authors know their own real
  values (a binary path, an app name) and bake them straight into `tool=`
  rather than this engine guessing fill values; a skill left with an
  unfilled `{placeholder}` is skipped with a clear reason instead of run
  broken.

Writing raw `.3md` by hand for the generic case is more ceremony than the
common case needs — frontmatter, manual `z` numbers, inventing trigger
phrases when routing was never the point, and `[[z=N|...]]` dependency
links that are surprisingly easy to point the wrong way into an
accidental cycle (this repo's own specs did that three separate times).
For a flat list of steps with no routing/dependency needs, a
**`*.steps.toml`** in the same specs-dir is a much lower-friction
alternative — same rules (bare commands only), compiled to a real,
fully-validated `agent.3md` in memory before it runs:

```toml
agent = "quick-steps"
persona = "optional, one line"

steps = [
  { name = "hello", run = "echo hello" },
  { name = "broken-on-purpose", run = "false", expect_fail = true },  # reported as FAIL, but doesn't fail the whole job — see magpie-sandbox
]
```

(TOML's `[[steps]]` array-of-tables syntax works identically — both parse to
the same array, and the compiler doesn't care which was used — but the
inline form above reads as one line per step instead of a three-line block
repeated per step, which matters once a fixture has more than two or three.)

A skill needing `{placeholder}`-style parameterization, routing by
natural language, or `[[z=N|...]]` dependencies still needs real `.3md` —
`.steps.toml` only covers the bare-command case, which is also the only
case generic mode itself ever executes.

`.github/workflows/test.yml` is a reusable workflow (`on: workflow_call`).
Another repo adds:

```yaml
jobs:
  dogfood:
    uses: CorvidLabs/magpie/.github/workflows/test.yml@main
    with:
      specs-dir: .magpie-specs   # avoid colliding with an existing specs/ (e.g. Spec Sync's)
      macos-targets: macos       # the literal string "none" skips a job entirely
      linux-targets: none        # (not empty string — see test.yml's own comment on why)
```

The reusable workflow checks out `CorvidLabs/magpie` into `.magpie-engine/`
alongside the caller's own checkout and runs `.magpie-engine/runner/run.ts`
against the caller's `specs-dir`. A skill needing a build step first (compile
before launching) does that inside its own `tool=` script, living in the
caller's repo — the engine stays generic and doesn't need to know Swift from
Rust.

## Status

All six targets have real (non-guidance) adapters and pass in CI. `ok`
in `report.json` reflects reality honestly — `run.ts` exits non-zero if
any step fails, so a green job means every step actually passed. Two
steps are marked `critical: false` (still reported as FAIL when they
happen, just not job-fatal), both in `specs/ios.3md`, both real GitHub
macOS-runner limitations hit repeatedly across this project's own CI runs
rather than magpie bugs:

- **`ios/open`** (`simctl openurl`) — a real, structural networking
  reliability limit; failed even with two retries and backoff across
  multiple runs. `screenshot`/`record` still run and produce real
  evidence regardless of whether the URL actually loaded in time.
- **`ios/shutdown`** — pure cleanup on an ephemeral CI VM that's
  destroyed right after the job anyway; once hit "CoreSimulatorService
  connection interrupted," Apple's own simulator daemon, not something
  magpie controls.

Android needed its own real fix before it worked at all: the first
attempt ran on `macos-latest` and failed every time with
`HVF error: HV_UNSUPPORTED` (GitHub's hosted macOS runners can't do
nested virtualization for hardware-accelerated emulation) — moved to
`ubuntu-latest` with KVM enabled, the actual documented pattern for
`reactivecircus/android-emulator-runner`.

The `workflow_call` reusable-workflow mechanism itself — not just the
engine in isolation — has been proven live in `CorvidLabs/magpie-sandbox`,
including the exact `with:` blocks both real dogfood PRs use.
