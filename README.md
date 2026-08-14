# magpie

[![CI](https://github.com/CorvidLabs/magpie/actions/workflows/test.yml/badge.svg)](https://github.com/CorvidLabs/magpie/actions/workflows/test.yml)
[![Bun](https://img.shields.io/badge/Bun-1.x-fbf0df.svg)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A generic cross-platform testbed: one `.3md` spec file per target (web, API,
iOS, macOS, CLI, Android), each driving *real* commands against *real*
state. No mocking, no headless-browser download, no simulated anything.
Runs on GitHub-hosted runners, not anyone's laptop.

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
  - **Web** → Safari, driven through `System Events` keystrokes
    (`scripts/web-open.sh`) — not Safari's own AppleScript dictionary,
    which needs a macOS Automation consent grant a fresh CI runner doesn't
    have
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
- **CI, not a laptop.** `.github/workflows/test.yml` splits targets across
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
  dialog for AppleScript-driven Safari/Calculator control, with no one there
  to click "Allow." Disposable runners still sidestep the class of problem
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
                 the CorvidLabs trust toolchain (`fledge trust adopt`) — Spec Sync is the
                 one piece deliberately not adopted here; see AGENTS.md's "Current milestone"
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

All six targets have real (non-guidance) adapters. Most recent full CI run
on GitHub-hosted runners: 11/12 steps passing — API, web (2/2), macOS
(2/2), CLI (2/2) all clean; iOS 4/5, with only `simctl openurl` flaky
(boot/screenshot/record/shutdown all pass regardless — it fails the same
way on a real runner as it did in local sandboxed dev, so it reads as a
genuine `simctl` quirk, not an environment fluke). Android just landed and
is still on its first CI verification pass as of this write-up.

The `workflow_call` reusable-workflow mechanism itself — not just the
engine in isolation — has been proven live in `CorvidLabs/magpie-sandbox`,
including the exact `with:` blocks both real dogfood PRs use.
