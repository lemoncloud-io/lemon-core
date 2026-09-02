# Spec: `$U` (utilities.ts) — priority member contracts

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** utilities
**Source:** `src/engine/utilities.ts` (1,013 lines), class `Utilities`, `$U = new Utilities($engine)` (`src/engine/builder.ts:236`)
**Branch/commit at time of writing:** `develop` @ `cb10f1d0` (4.3.0)

## Purpose

**Fix current behavior in writing — this is not a proposal to change anything.** These five
files document what `$U`'s five highest-priority members actually do today, verified against
source and, where feasible, against live execution. No source under `src/` was touched to
produce this spec. This is WP-U1 of the lemon module hardening program, track 1; the
preceding WP (U0) produced the inventory/coverage baseline and timezone defect findings this
spec builds on:
`projects/@lemoncloud-io/module-hardening/outputs/2026-09-02-U0-utilities-baseline.md` (vault).

**Downstream use (U2):** the Behavior tables in these five files are meant to be lifted
directly into characterization tests — each row is a concrete input → concrete output pair
with a source line to anchor it, not a paraphrase. When U2 writes `utilities.spec.ts` cases,
these tables are the source of truth for expected values, not `patterns.md` and not developer
memory.

## Members covered

| # | Member | File | Source |
| - | --- | --- | --- |
| 1 | `$U.dt` (→ static `Utilities.datetime`) | [dt.md](./dt.md) | `utilities.ts:272` (instance) → `:201` (static) |
| 2 | `$U.now` | [now.md](./now.md) | `utilities.ts:276` |
| 3 | `$U.env` / `$U.get_env` | [env.md](./env.md) | `utilities.ts:88` / `:80` |
| 4 | `$U.hash` | [hash.md](./hash.md) | `utilities.ts:630` |
| 5 | `$U.qs_parse` / `$U.qs_stringify` | [qs.md](./qs.md) | `utilities.ts:705` / `:726` |

## Common conventions

- **Line evidence**: every behavioral claim cites `utilities.ts:<line>`. A claim with no line
  citation is marked `unverified` rather than stated as fact.
- **Source vs. document**: where `projects/@lemoncloud-io/lemon-core/patterns.md` (vault) and
  the source disagree, the source wins. Divergences are called out per-file as a `Note`, not
  silently corrected — `patterns.md` itself is out of scope for this spec (coordinator handles
  that edit separately).
- **Execution vs. inference**: every table cell that was run through code is marked
  `verified by execution 2026-09-02`. Cells that could not be run are marked `unverified`, not
  silently inferred and presented as fact.
- **Machine timezone notation**: this machine is KST (`Asia/Seoul`, `new Date().getTimezoneOffset() === -540`).
  Where behavior is machine-timezone-dependent, tables carry both a **"KST machine"** column
  (this machine, live-verified) and a **"UTC machine"** column (verified by re-running the same
  script with `TZ=UTC`, not by an actual second machine — noted per-table).
- **Execution method**: all values were produced by `npx ts-node --transpile-only <script>.ts`
  against the unmodified clone, run from the repo root, with temp scripts kept under the
  scratchpad directory (never committed, never left in the repo). Two import styles were used
  and each file's Evidence section says which:
  - **direct class import** — `import { Utilities } from '.../src/engine/utilities'` with a
    hand-built minimal `{ log, err }` stub standing in for `EngineCore` — used where the member
    under test does not depend on `this._$` beyond logging (`dt`/`now`/`hash`/`qs_*`).
  - **engine-booted import** — `import { $U } from '.../src/engine/index'`, which runs the real
    `buildEngine()` bootloader — used for `env`/`get_env`, because whether `this._$.environ`
    exists changes which branch runs (see `env.md` § Environment dependencies).
- **Environment hygiene**: any script that touched `process.env` restored the prior value (or
  deleted the key) before exiting, and no real environment variable value is quoted anywhere
  in this spec or the vault — only a synthetic key (`__U1_SPEC_TEST_VAR__`) used solely for the
  test run.

## Scope note

This spec fixes the *behavior* of five members only. It does not evaluate whether that
behavior is correct or propose any fix — defects found are recorded under each file's
**Known defects — preserved** section specifically so they are *not* accidentally fixed as a
side effect of a later refactor. Any actual behavior change is a separate, explicit decision
(see each file's defect notes for "not fixed here").
