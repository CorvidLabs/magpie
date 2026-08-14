---
spec: runner.spec.md
---

## Test Plan

No unit test suite exists for this module — it's proven the same way
every target spec is: real execution on real CI runners, not mocks.
`bun run validate` (→ `runner/validate.ts`) is the one thing that *is*
safe and fast to run anywhere, including a generic verify gate; it
covers the structural half (every spec parses, no cycles, no malformed
inputs) but never executes a command, so it can't catch a behavioral
regression in `run.ts` itself.

### Structural (fast, no live dependencies — `bun run validate`)

- Every `specs/*.3md` parses and passes `validateAgent()`.
- A synthetic spec covering all three generic-mode edge cases (bare
  command, unfilled `{placeholder}`, guidance-only skill) behaves as
  documented — proven locally before `.steps.toml` shipped, and again
  after, since the same three cases apply to compiled specs too.
- A `.steps.toml` step containing a `"` fails to compile with a clear
  error, rather than producing a corrupted `tool=` attribute.

### Integration (real CI runners — no local equivalent for most of these)

- Magpie's own six targets, run via `.github/workflows/test.yml`'s three
  jobs (`linux`, `macos`, `android`).
- Generic mode's `workflow_call` mechanism itself (not just the engine in
  isolation) proven live via `magpie-sandbox`'s two jobs, each mirroring
  a real caller's exact `with:` block.
- `critical: false` handling proven both ways: a step that's supposed to
  fail (`magpie-sandbox`'s `intentional-failure`/`expected-failure`) does
  fail without failing the job; a step that's a real, repeated
  environment limitation (`ios/open`, `ios/shutdown`) does the same.

### Known gaps

- Nothing exercises the `.steps.toml` compiler's error paths (missing
  `agent`, empty `steps`, missing `name`/`run`) on live CI — only checked
  locally before each push.
- No regression test pins `report.json`'s exact shape — a future field
  rename would only be caught by a downstream consumer breaking, not by
  anything in this repo.
