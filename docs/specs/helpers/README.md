# Spec: `$T` (type-coercion helper) & `$U.ts` — baseline + current-behavior contracts

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** helpers
**Branch/commit at time of writing:** `develop` @ `cb10f1d0` (4.3.0)
**Program:** module hardening, track 1, WP-U3-a (repeats the U0+U1 procedure for `$T`)

## Purpose

**Fix current behavior in writing — this is not a proposal to change anything.** This spec
documents two things: (1) the fact that `$T` has **two independent definitions** in this
repository, which one wins at the package root, and where the two diverge; (2) `$U.ts`
(`Utilities.timestamp`), a member `$U`'s U1 spec did not cover, including its relationship to
`$U.dt` and its own DST exposure (defect #22). No source under `src/` was touched to produce
this spec.

## The core finding — `$T` has two definitions, and the root export is not the one `patterns.md` documents

| | **L1** | **L2** |
| --- | --- | --- |
| File | `src/helpers/helpers.ts:97` (`export const $T = { ... }`, ends `:498`) | `src/extended/cores/commons.ts:97` (`export const $T = { ..._T, ... }`, ends `:205`) |
| Origin | Native to lemon-core since 2020 | Copied in from `@lemoncloud/lemon-templates-api/cores` during the 4.3.0 cores-migration (see `commons.ts:15` `@origin` tag; `projects/@lemoncloud-io/lemon-core/cores-migration/README.md`, vault) |
| Relationship | — | Spreads L1's `$T` (imported as `_T` from `'../../helpers/'`, `commons.ts:20`) then overrides 10 members and adds 1 new one |
| Member count | 31 | 32 |
| **`import { $T } from 'lemon-core'` resolves to** | — | **this one** (`src/index.ts:38`: `export { $T } from './extended/cores/commons'; //* L2 wins — 4.2.x semantics`) |

`src/index.ts:33` does `export * from './helpers/'` (which would export L1's `$T`), but
`:37`-`:38` re-export the whole `extended/cores` barrel and then explicitly pin
`export { $T } from './extended/cores/commons'`. A later named export overrides an earlier
`export *` for the same name in TypeScript/ESM barrel semantics — confirmed by execution
(`root.$T === commons.$T`, `true`; see [T.md](./T.md) § Evidence). **Every consumer that does
`import { $T } from 'lemon-core'` gets L2**, not L1.

### How to tell which definition you have (decision table)

| Import | Resolves to |
| --- | --- |
| `import { $T } from 'lemon-core'` (package root) | **L2** (`extended/cores/commons.ts:97`) |
| `import { $T } from 'lemon-core/dist/extended/cores/commons'` (deep import) | L2, same object as root |
| `import { $T } from 'lemon-core/dist/helpers/helpers'` (deep import) | L1 |
| Internal file `src/extended/abstract-service.ts:46` | `import { ... $T ... } from '../helpers'` → **L1** — the one internal source file still consuming L1 directly (6 occurrences); this is deliberate, not an oversight: the same file is pinned for `$ES6` at `index.ts:40` with the comment "L1 wins — keep existing behavior", so its author already treats this file as the L1-compat boundary |
| Internal files `src/extended/cores/abstract-services.ts:82`, `abstract-controllers.ts:37` | `import { $T } from './commons'` → **L2** |
| `src/helpers/helpers.ts` (31 internal uses) | defines and consumes its own L1 `$T` |
| `src/extended/cores/commons.ts` (12 internal uses) | defines and consumes its own L2 `$T`, plus imports L1 as `_T` for delegation |

Full member-by-member diff, coverage map, and execution evidence: [T.md](./T.md).
`$U.ts` contract (DST defect #22, relationship to `$U.dt`, 3-zone table): [ts.md](./ts.md).

## Documentation defects found (not fixed here — coordinator's call, same as U0/U1)

1. **`projects/@lemoncloud-io/lemon-core/patterns.md` § 헬퍼 $U와 $T, "`$T` — 타입 강제 헬퍼"
   heading cites `src/helpers/helpers.ts:27`.** The actual `export const $T = {` is at
   `helpers.ts:97`, a ~70-line drift (same class of line-drift the U0 report already found for
   `$U`). Every per-member line citation in that section is stale by the same amount (e.g.
   `S`(:31) is actually `:101`, `S2`(:35) is actually `:105`, etc.) — see [T.md](./T.md) § 1 for
   the corrected lines.
2. **`patterns.md`'s `$T` section never mentions L2 or the root-export decision at all.** It
   documents only L1's shape (25 of L1's 31 members — missing `BN`, `clear`, `nul2str`, `asLut`,
   `asMeta`, `reduceAggr` from its own list, though `BN`/`asLut` are covered separately a few
   paragraphs later under "현행" as a 4.2.x-vs-develop version-line note, not as an L1-vs-L2
   note). It gives no reader any signal that `import { $T } from 'lemon-core'` actually returns a
   *different* object with *different* behavior for `S2`/`SS` (see [T.md](./T.md) § 3 for the
   concrete behavioral divergence). This is the single most consequential documentation gap this
   spec found — a spec-writer reading only `patterns.md` would characterize the wrong object.
3. Proposed correction text (coordinator to apply, not applied here): replace the section
   heading and opening bullet with a pointer to this spec, e.g. *"`$T` has two definitions —
   `src/helpers/helpers.ts:97` (L1) and `src/extended/cores/commons.ts:97` (L2, spreads L1 +
   overrides). The root package export (`import { $T } from 'lemon-core'`) is **L2**
   (`index.ts:38`). Current-behavior contract: `docs/specs/helpers/T.md` (lemon-core)."*

## Common conventions (same as U1's `docs/specs/utilities/`)

- **Line evidence**: every behavioral claim cites `<file>:<line>`. A claim with no line citation
  is marked `unverified` rather than stated as fact.
- **Source vs. document**: where `patterns.md` (vault) and the source disagree, the source wins.
  Divergences are called out as a `Note`, not silently corrected — editing `patterns.md` is the
  coordinator's job, tracked above.
- **Execution vs. inference**: every table cell backed by a run is marked
  `verified by execution 2026-09-02`. Cells that could not be run are marked `unverified`.
- **Machine timezone notation**: this machine is KST (`Asia/Seoul`,
  `new Date().getTimezoneOffset() === -540`). `ts.md` additionally carries **all three** of
  `TZ=Asia/Seoul` / `TZ=UTC` / `TZ=America/New_York` columns from the start (not KST+UTC only)
  because `dt.md`'s "machine-invariant" claim for `$U.dt` was already found to break under a
  real DST zone (`America/New_York`) — the same risk applies to `$U.ts`, so this spec does not
  repeat U1's initial 2-zone-then-patch path.
- **Execution method**: all values were produced by `npx ts-node --transpile-only <script>.ts`
  against the unmodified clone, from the repo root, with temp scripts kept under the scratchpad
  directory (`<scratchpad>/`, never committed, never left in the repo). All scripts used
  **direct class/const import via absolute `require()` path** (e.g.
  `require('$GITHUB_DIR/lemoncloud-io/lemon-core/src/extended/cores/commons')`), not the
  package-root barrel, so that L1 and L2 could be loaded and compared side by side as distinct
  objects in the same process.
- **Two spec files cross-referenced for coverage**: `src/helpers/helpers.spec.ts` (19 active
  tests, 0 skipped — imports `$T` from `./helpers`, i.e. tests **L1's own object**) and
  `src/extended/cores/commons.spec.ts` (3 active tests + 1 skipped `_it` — imports `$T` from
  `./commons`, i.e. tests **L2's own object**). Coverage verdicts in T.md are cross-checked
  against both; per-member verdicts distinguish "tested via the L1 spec, but that's not the
  object `lemon-core`'s root exports" from "tested against the actual root-exported object."

## Scope note

This spec fixes the *behavior* of `$T` (L1 shape, L2 shape, and their diff) and `$U.ts` only. It
does not evaluate whether any of it is *correct*, and proposes no fix — defects are recorded
under each file's **Known defects — preserved** section specifically so a later refactor does
not silently "fix" them. Any actual behavior change is Steve's call, tracked separately (same
posture as U0/U1).
