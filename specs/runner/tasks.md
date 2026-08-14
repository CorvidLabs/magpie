---
spec: runner.spec.md
---

## Tasks

- [x] Write spec (this one — adopted after the fact, against the engine
      as it already existed, not before implementation)
- [x] Implement module — six-target mode, generic `--specs-dir` mode,
      `.steps.toml` compilation, `critical`/`expected-fail` handling,
      the `exec()` timeout, exit-code fidelity
- [x] Prove it via real CI runs (magpie's own six targets, MacNTop/fledge
      dogfood pilots — since closed, see `context.md` — and
      `magpie-sandbox`'s disposable fixtures), not local testing alone
- [ ] An actual agent-driven fallback for guidance-only skills (currently
      skipped and logged, never handed to a model) — see Out of Scope
- [ ] Visual diffing of screenshot/recording artifacts against a baseline
- [ ] Flake-rate tracking across runs (currently anecdotal — this session's
      own observations, not a tracked metric)
