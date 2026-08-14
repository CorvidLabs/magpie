# magpie

A generic cross-platform testbed: one `.3md` spec file per target (web, API,
iOS, macOS, CLI — Android sketched but not yet wired), each driving *real*
commands against *real* state. No mocking, no headless-browser download, no
simulated anything. Runs on GitHub-hosted runners, not anyone's laptop.

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
  - **Web** → Safari, driven by AppleScript (`scripts/web-open.applescript`)
  - **macOS** → a launched app's Accessibility tree, read via
    `System Events` (`scripts/macos-launch.sh`) — the same bridge a native
    `AXUIElement` adapter would call
  - **iOS** → `xcrun simctl` directly (boot → open → screenshot → record →
    shutdown), no Appium/WebDriverAgent needed
  - **Android** → not wired yet. `specs/android.3md` is deliberately
    guidance-only (no `tool=`) until a real emulator is available — the
    `agent3md` spec explicitly designs for this case. Next step:
    [`reactivecircus/android-emulator-runner`](https://github.com/reactivecircus/android-emulator-runner).
- **CI, not a laptop.** `.github/workflows/test.yml` splits targets across
  GitHub-hosted runners: `ubuntu-latest` runs CLI only, `macos-latest` runs
  API/web/macOS/iOS (Xcode + simulators ship preinstalled). API moved off
  Linux after the first real run: `fledge-plugin-http` is a Swift package
  that calls Darwin-only Foundation/CoreFoundation APIs and doesn't build
  under swift-corelibs-foundation on Linux — a real upstream portability
  bug, not something fixable from this repo's workflow file. Every "Run …
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
specs/       one agent.3md per target — the test spec, human-readable and machine-routable
scripts/     small glue (AppleScript, shell) a tool= template shells out to,
             used only to dodge shell-quoting hell inside a single-line template
runner/      run.ts — loads each spec with @corvidlabs/agent3md, routes,
             fills, executes, asserts, writes artifacts/report.json
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
      macos-targets: macos       # empty string skips a job entirely
      linux-targets: ''
```

The reusable workflow checks out `CorvidLabs/magpie` into `.magpie-engine/`
alongside the caller's own checkout and runs `.magpie-engine/runner/run.ts`
against the caller's `specs-dir`. A skill needing a build step first (compile
before launching) does that inside its own `tool=` script, living in the
caller's repo — the engine stays generic and doesn't need to know Swift from
Rust.

## Status

Proven locally: API, CLI, iOS (boot/screenshot/record/shutdown — `openurl`
timed out in one sandboxed dev environment, not simulator-side). Web and
macOS route/execute correctly but need a host with Screen Recording
permission granted (any normal GitHub-hosted `macos-latest` runner) to
capture the screenshot artifact — that's exactly what CI is for.
