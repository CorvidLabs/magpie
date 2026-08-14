---
spec: runner.spec.md
---

## Context

Everything else in this repo — six target specs, `.magpie/`-style dogfood
scripts, the reusable `workflow_call` workflow, the sandbox — exists to
exercise this one engine. It's deliberately small (~430 lines) and has no
runtime dependency beyond `@corvidlabs/agent3md` and Bun's own built-ins;
every actual capability (HTTP, PTY-wrapped CLI, AppleScript, `simctl`,
`adb`) comes from shelling out to a real binary, never from a library this
module imports.

`specs_dir = "specs"` in `.specsync/config.toml` is spec-sync's own
natural default — not a workaround. It used to be `module-specs`, because
magpie's own `agent.3md` test specs lived at `specs/*.3md` and collided
with spec-sync's convention of the same directory name for module
contracts like this one. Resolved the other way now: magpie's own specs
moved to `.magpie/specs/` instead (load-bearing throughout `run.ts`'s own
`--specs-dir` default-value logic, now `isGeneric = specsDir !== ".magpie/specs"`),
freeing the bare `specs/` name — deliberately, since it's a directory name
plenty of other real projects already use for their own purposes, and a
testbed meant to be dropped into someone else's repo shouldn't force them
to rename what was already there first.

## Related Modules

- `.magpie/specs/*.3md` — the six target specs this engine executes by default.
- `scripts/*.sh` / `scripts/*.applescript` — glue a `tool=` template shells
  out to, kept outside this module because they're spec-owned, not
  engine-owned (a different caller repo brings its own).
- `.github/workflows/test.yml` — the reusable `workflow_call` workflow
  that runs this engine on GitHub-hosted runners; not part of this module
  since it's CI configuration, not source.

## Design Decisions

- **Generic mode only ever checks exit code, never response semantics.**
  A shared engine running someone else's specs can't know what "correct"
  means for their project — this is why `fledge http-get` against a real
  500 still needs `curl -f` (or equivalent) to get exit-code-based failure
  detection in generic mode; `fledge http-get`'s own exit code reflects
  whether the request completed, not the HTTP status.
- **`critical: false` over silently passing or globally suppressing
  failures.** Considered making generic mode never job-fatal at all
  (simpler), rejected because real dogfood consumers (a caller's actual
  build step failing) genuinely want that to fail their job. Landed on a
  per-step opt-out instead, driven by the spec itself
  (`cost="expected-fail"` / `expect_fail = true`), not a blanket policy.
- **`.steps.toml` compiles to `agent.3md` text, not a parallel data
  model.** Keeps exactly one execution path (`Agent` + `validateAgent()`)
  regardless of authoring format — a compiler bug produces an invalid
  `.3md` string that the *same* validator rejects, rather than a second
  code path that could silently diverge in behavior from the first.
