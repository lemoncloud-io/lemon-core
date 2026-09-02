# Spec: `$T` (type-coercion helper) — L2 (root export) contract + L1 diff

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** helpers/T

## Signature / identity

```ts
// L1 — src/helpers/helpers.ts:97-498 (object literal, 31 own members)
export const $T = { S, S2, SS, P, N, NN, F, FF, F3, B, BN, T, D, DT, EX, simples,
    catch, merge, template, makeRandomCode, clear, nul2str, normal, asMap, asLut,
    diff, perf, parseMeta, asMeta, onlyDefined, reduceAggr };

// L2 — src/extended/cores/commons.ts:97-205 (spreads L1, overrides 10, adds 1)
import { $T as _T } from '../../helpers/';           // commons.ts:20 — this is L1
export const $T = {
    ..._T,                                            // all 31 L1 members, then:
    S2, SS, US, B, BN, N, clear, nul2str, asLut, asMeta, reduceAggr,  // 10 overridden + US new
};

// src/index.ts:38
export { $T } from './extended/cores/commons';        // L2 wins at the package root
```

`Utilities` is not involved here — `$T` is a plain object literal in both files, not a class.
There is **no `Utilities`-style static/instance split** the way `$U` has; both `$T`s are
directly-callable member functions on a plain object.

**Verified by execution (2026-09-02, `require()` of L1/L2/root directly, no barrel):**

- `root.$T === commons.$T` → **`true`** — confirms `index.ts:38` is what a consumer actually
  gets, not the `export * from './helpers/'` at `index.ts:33`.
- `Object.keys(root.$T).length` → **32**; `Object.keys(l1.$T).length` → **31**;
  `Object.keys(l2.$T).length` → **32** (identical set to root, as expected since root is L2).
- Set difference: **L2 has exactly one member L1 doesn't** (`US`); **L1 has zero members L2
  doesn't** (spreading `..._T` first means every L1 key survives into L2, either passed through
  unchanged or overridden — none dropped).

## § 1. Full member inventory (32 members, root/L2 export)

Reference-identity column: whether `l1.$T.<member> === l2.$T.<member>` (same function object).
`true` = pass-through (L2 never redefines it, inherited verbatim via `..._T` spread) → the L1
line **is** the behavior you get at the root. `false` = L2 redefines it (a separate function
with, in some cases, different behavior — see § 3).

| # | Member | L1 line (`helpers.ts`) | L2 line (`commons.ts`) | Same ref? | Coverage (§ 2) |
| - | --- | --- | --- | --- | --- |
| 1 | `S` | `:101` | (spread, unchanged) | **true** | covered |
| 2 | `S2` | `:105` | `:100` | **false** — behavior differs (§ 3.1) | partial |
| 3 | `SS` | `:110` | `:102` | **false** — behavior differs (§ 3.2) | partial |
| 4 | `P` | `:119` | (spread, unchanged) | true | covered |
| 5 | `N` | `:130` | `:120` | **false** — functionally equivalent (§ 3.3) | uncovered (L2 object) |
| 6 | `NN` | `:135` | (spread, unchanged) | true | covered |
| 7 | `F` | `:144` | (spread, unchanged) | true | covered |
| 8 | `FF` | `:148` | (spread, unchanged) | true | covered |
| 9 | `F3` | `:157` | (spread, unchanged) | true | covered |
| 10 | `B` | `:161` | `:111` | **false** — functionally equivalent (§ 3.3) | uncovered (L2 object) |
| 11 | `BN` | `:170` | `:118` | **false** — functionally equivalent (§ 3.3) | uncovered (L2 object) |
| 12 | `T` | `:174` | (spread, unchanged) | true | **partial** (TZ blind spot, § 3.5) |
| 13 | `D` | `:186` | (spread, unchanged) | true | covered |
| 14 | `DT` | `:208` | (spread, unchanged) | true | **uncovered** (no test anywhere) |
| 15 | `EX` | `:219` | (spread, unchanged) | true | covered |
| 16 | `simples` | `:229` | (spread, unchanged) | true | covered |
| 17 | `catch` | `:259` | (spread, unchanged) | true | covered |
| 18 | `merge` | `:271` | (spread, unchanged) | true | covered |
| 19 | `template` | `:286` | (spread, unchanged) | true | covered |
| 20 | `makeRandomCode` | `:296` | (spread, unchanged) | true | covered |
| 21 | `clear` | `:305` | `:125` | **false** — functionally equivalent (§ 3.4) | **uncovered** (no test anywhere) |
| 22 | `nul2str` | `:311` | `:131` | **false** — functionally equivalent (§ 3.4) | **uncovered** (no test anywhere) |
| 23 | `normal` | `:319` | (spread, unchanged) | true | covered |
| 24 | `asMap` | `:330` | (spread, unchanged) | true | covered |
| 25 | `asLut` | `:339` | `:138` | **false** — functionally equivalent (§ 3.4) | **covered** (direct L2, § 2) |
| 26 | `diff` | `:369` | (spread, unchanged) | true | covered |
| 27 | `perf` | `:400` | (spread, unchanged) | true | covered |
| 28 | `parseMeta` | `:420` | (spread, unchanged) | true | covered |
| 29 | `asMeta` | `:452` | `:168` | **false** — functionally equivalent (§ 3.4) | **uncovered** (no test anywhere) |
| 30 | `onlyDefined` | `:472` (shorthand for imported `onlyDefined`, `../common/test-helper`) | (spread, unchanged) | true | covered |
| 31 | `reduceAggr` | `:477` | `:184` | **false** — functionally equivalent, delegates to own `N` (§ 3.4) | **uncovered** (no test anywhere) |
| 32 | `US` | — (does not exist in L1) | `:105` | n/a — L2-only | **covered** (direct L2) |

**Note (adjacent, not a `$T` member):** `commons.ts:40` also exports a *standalone*
`onlyDefined` function (different implementation, same name, not attached to `$T`) — this is the
symbol `index.ts:39` pins as `export { onlyDefined } from './common/test-helper'; //* L1 wins`.
Do not confuse this top-level `onlyDefined` with `$T.onlyDefined` (row 30 above, which is a
pass-through of L1's `$T.onlyDefined` and is unaffected by that pin).

## § 2. Coverage map (cross-checked against both spec files)

**Judgment rule (extended from U0's rule to the L1/L2 split):** *covered* = an active test calls
the member by name on **the object the root export actually is** (L2) and asserts on the
result — either directly in `commons.spec.ts`, or indirectly via `helpers.spec.ts` **for a
pass-through member only**, since a pass-through member is the literal same function object. For
an L2-overridden member, an L1-only assertion (`helpers.spec.ts`) does **not** count as covering
the root-exported object — it covers a different, textually-similar-but-distinct function. Any
member meeting neither bar is *uncovered*, regardless of how well its L1 analogue is tested.

| Verdict | Members | Count |
| --- | --- | --- |
| **covered** | `S`, `P`, `NN`, `F`, `FF`, `F3`, `D`, `EX`, `simples`, `catch`, `merge`, `template`, `makeRandomCode`, `normal`, `asMap`, `diff`, `perf`, `parseMeta`, `onlyDefined` (19, all pass-through, via `helpers.spec.ts`) + `asLut`, `US` (2, direct L2, via `commons.spec.ts`) | **21** |
| **partial** | `T` (pass-through, but its own spec's date-string+timezone assertions are commented out — see § 3.5) | **1** |
| **uncovered** | `DT` (no test in either spec, pass-through though it is); `B`, `BN`, `N` (L1 analogue tested, L2's own object never invoked); `clear`, `nul2str`, `asMeta`, `reduceAggr` (no test in either spec, for either version) | **10** |

21 + 1 + 10 = 32.

- `helpers.spec.ts`: 19 active `it(...)` tests, **0** skipped (`_it`) — imports `$T` from
  `./helpers` (L1's own object; matches U0's `helpers.spec.ts` reference), `wc -l` = 712 lines.
- `commons.spec.ts`: **3** active `it(...)` tests + **1** skipped `_it(...)`
  (`should pass parsePaginateParam`, `commons.spec.ts:134`) — imports `$T` from `./commons` (L2's
  own object), `wc -l` = 162 lines. Matches the task brief's "4 tests" (3 active + 1 skipped).
- The 6 members with **zero** coverage in either spec regardless of version line — `DT`, `clear`,
  `nul2str`, `asMeta`, `reduceAggr` (5) plus `T`'s TZ-varying branch (partial, not zero) — are
  U3-b (characterization test) candidates with no existing assertion to lift from; every other
  covered/partial member already has concrete input→output pairs in an active test that U2-style
  work can reuse directly.

## § 3. L1 vs L2 behavioral diff (the 11 non-identical members)

All values below: **verified by execution 2026-09-02** (`npx ts-node --transpile-only`, direct
`require()` of `helpers/helpers` and `extended/cores/commons`, unmodified clone, machine TZ =
`Asia/Seoul`). Script: `<scratchpad>/t-behavior-diff.ts`.

### 3.1 `S2` — arity loss (real, user-visible divergence; matches the cores-migration regression)

L1 signature: `S2(val, def = '', delim = ' ')` (3 params). L2 signature: `S2(v?, def?)` (2
params) — internally `(v, def) => _T.S2(v, def, ' ').trim()`, i.e. **always** calls L1's `S2`
with `delim` hardcoded to `' '`, then trims again (redundant but harmless, since L1's `S2`
already trims).

| Call | L1 result | L2 result | Same? |
| --- | --- | --- | --- |
| `S2('  a   b  ', '')` | `"a b"` | `"a b"` | yes (default delim matches) |
| `S2('  a   b  ', '', '_')` (3rd arg) | `"_a_b_"` | `"a b"` (3rd arg silently dropped at the type level; JS still lets extra args through at runtime, but L2's own body never reads a 3rd parameter) | **no** |
| `S2(undefined, 'x')` | `"x"` | `"x"` | yes |

**This is the exact defect `projects/@lemoncloud-io/lemon-core/patterns.md` (line ~193, ~472,
per that doc's own text) already names as "신규 실측 회귀 1" / the `d47d176` fix in
`lemon-templates-api`**: any call site written against L1's 3-arg `S2` (e.g.
`$T.S2(v, '', ' ')`) either fails to compile against L2's 2-arg signature, or — if it slips
through as untyped/`any` — silently loses the custom delimiter at runtime once the root export
became L2 in 4.3.0. **Preserved defect, not fixed here.**

### 3.2 `SS` — array-branch re-implementation + dropped `def` parameter

L1 signature: `SS(val, def = [])` (2 params, custom default honored). L2 signature: `SS(v?)` (1
param, **no `def` override possible at all**).

| Call | L1 result | L2 result | Same? |
| --- | --- | --- | --- |
| `SS(['a  b', 'c'])` (array item w/ internal double-space) | `["a  b","c"]` (L1's array branch maps through `S`, which trims but does not collapse internal whitespace) | `["a b","c"]` (L2's array branch maps through `S2`, which collapses internal whitespace too) | **no** |
| `SS('a, b ,  c')` (string input) | `["a","b","c"]` | `["a","b","c"]` | yes |
| `SS(null)` | `[]` | `[]` | yes |
| `SS([], ['DEF'])` (custom `def` on empty array) | `["DEF"]` | n/a — `L2.SS([])` → `[]` (no way to pass a custom default) | **no** |

**Preserved defect, not fixed here**: a caller relying on L1's `SS(val, customDefault)` silently
loses that default once resolved through the L2 (root) export — TypeScript will reject the extra
argument at the type level (2nd param doesn't exist on L2's signature), same failure shape as
`S2` above.

### 3.3 `B` / `BN` / `N` — separate function objects, but **functionally equivalent** on every input tried

L2's own `_B` helper (`commons.ts:29`) is a byte-for-byte copy of L1's `_B` (`helpers.ts:37`) —
the file comment at `commons.ts:28` says this is deliberate ("local copy of legacy `$T.B` — keep
decoupled: L1 `$T.B` semantics differ across version lines (4.2.x returns `boolean`)"), referring
to *lemon-core's own historical* version-line differences (documented in `patterns.md` § 버전
라인 현황), not to a live L1-vs-L2 split within this commit. `N` differs even more directly: L2's
`N` literally delegates to L1's `N` (`commons.ts:121`: `_T.N(v, def)`) for the number/string
branches, so it is a thin wrapper, not an independent reimplementation.

| Call | L1 | L2 | Same? |
| --- | --- | --- | --- |
| `B(true)` / `B(false)` / `B('yes')` / `B('no')` / `B(1)` / `B(0)` / `B(null)` / `B(undefined)` / `B('Y')` | `true,false,true,false,true,false,false,false,true` | identical, all 9 | yes, all 9 |
| `BN(true)` / `BN(false)` / `BN(1)` / `BN(0)` / `BN(null)` / `BN(undefined)` / `BN('yes')` | `1,0,1,0,0,undefined,1` | identical, all 7 | yes, all 7 |
| `N(true)` / `N(false)` / `N('12')` / `N('abc')` / `N(null)` / `N(undefined)` / `N(12.5)` | `1,0,12,0,0,0,12` | identical, all 7 | yes, all 7 |

**No behavioral divergence found for `B`/`BN`/`N` across these 23 probe inputs** — the split is
real (different object references, § 1) but not currently observable in output. Flagged so a
future edit to either copy doesn't silently diverge the two without anyone noticing (they are
**not** DRY — a fix to `helpers.ts:37`'s `_B` does not propagate to `commons.ts:29`'s `_B`).

### 3.4 `clear` / `nul2str` / `asLut` / `asMeta` / `reduceAggr` — verbatim-duplicated logic, functionally equivalent

All five are near-identical copy-paste between the two files (confirmed by direct source
comparison, not just execution) — same branching, same error message templates. Execution
confirms identical output:

| Member | Probe | L1 | L2 | Same? |
| --- | --- | --- | --- | --- |
| `clear` | `{a:1,b:undefined,c:0}` | `{"a":1,"c":0}` | `{"a":1,"c":0}` | yes |
| `nul2str` | `null` / `undefined` / `123` | `""` / `undefined` / `"123"` | identical | yes |
| `asLut` | `('A', {A:'alpha',B:'beta'})` | `"A"` | `"A"` | yes |
| `asLut` | `('alpha', MAP)` (reverse lookup) | `"A"` | `"A"` | yes |
| `asLut` | `('nope', MAP, {throwable:false, default:'DEF'})` | `"DEF"` | `"DEF"` | yes |
| `asLut` | `('nope', MAP)` (default `throwable=true`) | throws `.name[nope] is invalid key - asLut(name)` | identical throw | yes |
| `asMeta` | `{a:1,b:"x",c:[1,"y",{}],d:{}}` | `{"a":1,"b":"x","c":[1,"y"]}` | identical | yes |
| `reduceAggr` | `{doc_count:5, cat:{doc_count:3, buckets:[{key:'x',doc_count:2}]}}` | `{"doc_count":{"total":5},"cat":{"total":3,"x":2}}` | identical | yes |

`reduceAggr` internally calls `$T.N` (self-reference) — since § 3.3 found `N` functionally
equivalent, `reduceAggr`'s equivalence follows from that, not independently coincidental.

### 3.5 `T` — pass-through, but its own test already documents a TZ blind spot (ties to `ts.md`)

`$T.T` (`helpers.ts:174-182`) is a pass-through (same ref in L1 and L2/root) that calls `$U.dt`
internally — its correctness is entirely inherited from `$U.dt`'s contract
(`docs/specs/utilities/dt.md`, U1, this repo). `helpers.spec.ts:155-159` contains this, **as
written in the source**:

```ts
expect2(() => new Date().getTimezoneOffset()).toEqual(-9 * 60); //WARN! - can be different in env.
//TODO [Steve] optimize data-time with time-zone condition.
// expect2(() => $U.ts(new Date(1591282800000))).toEqual('2020-06-05 00:00:00'); // must be aware of time-zone.
// expect2(() => $T.T('2020-06-05 00:00:00')).toEqual(new Date('2020-06-05 00:00:00').getTime());
// expect2(() => $T.T('2020-06-05')).toEqual(new Date('2020-06-05 12:00:00').getTime());
```

The author already knew the date-string+timezone path is machine-dependent and commented the
assertions out rather than fix them — the only active `$T.T` assertions left
(`helpers.spec.ts:160-164`) are for `'0'` (epoch 0) and four invalid-format strings that throw,
none of which touch the TZ-sensitive branch. **This is the same class of "known, silently
disarmed" test as `utilities.spec.ts:59`'s `_it`-skipped `datetime()` test** (U0/U1 finding) —
except here the test wasn't skipped, its *specific assertions* were commented out while the
`it()` block itself stayed active. Full 3-zone behavior for the underlying `$U.dt`/`$U.ts`
mechanism: [ts.md](./ts.md).

## Known defects — preserved

This spec fixes behavior; it does not propose changes.

1. **`S2`'s 3rd parameter (`delim`) is unreachable through the root (L2) export** (§ 3.1). Any
   call site written for L1's `S2(val, def, delim)` either fails to typecheck against L2's
   2-param signature, or silently drops the delimiter if the call slips through untyped. This is
   the same defect class the cores-migration record (`projects/@lemoncloud-io/lemon-core/
   cores-migration/README.md`, vault) already documents as a real regression fixed once in
   `lemon-templates-api` (`d47d176`) — it is preserved *in lemon-core itself* wherever a 3-arg
   call exists (none found in this repo's own `src/`, per § "internal consumers" in
   [README.md](./README.md); the risk is entirely in downstream consumers of the package).
2. **`SS`'s custom `def` parameter is unreachable through the root (L2) export** (§ 3.2) — same
   shape as defect 1, one parameter narrower.
3. **`SS`'s array branch collapses internal whitespace in L2 but not in L1** (§ 3.2) — a
   behavior change independent of the parameter-count issue: even a 1-arg call
   (`$T.SS(['a  b'])`) returns a different string depending on which `$T` you hold.
4. **`B`/`BN`/`clear`/`nul2str`/`asLut`/`asMeta`/`reduceAggr` are duplicated, not shared, between
   L1 and L2** (§ 3.3, § 3.4) — currently behaviorally identical on every input tried, but a
   future fix to one copy will not propagate to the other, and nothing enforces they stay in
   sync (no shared test, no lint rule, no type-level contract binding them).
5. **`N`'s uncovered outer wrapper** (§ 3.3): L2's `N` is a real function distinct from L1's, but
   no active test calls `l2.$T.N` directly — its equivalence to L1 is established here by manual
   probe (7 inputs), not by the project's own test suite.
6. **`T`'s TZ-sensitive branch has commented-out assertions in its own spec** (§ 3.5) — a defect
   already known to the original author (`//TODO [Steve] optimize data-time with time-zone
   condition.`) and left in place, not fixed here.

## Not covered by existing spec

- `DT`, `clear`, `nul2str`, `asMeta`, `reduceAggr` — zero test coverage in either `helpers.spec.ts`
  or `commons.spec.ts`, for either L1 or L2. No existing assertion to lift for U3-b; new cases
  must be written from this spec's § 3.4 probes and source reading, not from an existing test.
- `B`/`BN`/`N`'s **L2-specific** object — L1's analogue is well tested (`helpers.spec.ts:149-154`,
  `:84`, `:137`), but that does not exercise `l2.$T.B`/`BN`/`N` as code; a U3-b case that imports
  from `lemon-core` root (or from `extended/cores/commons` directly) and asserts on `$T.B`/`BN`/`N`
  would newly cover the actual root-exported object.
- `S2`'s 3-arg (`delim`) call shape and `SS`'s 2-arg (`def`) call shape — neither is exercised in
  either active spec even against L1's own object (`helpers.spec.ts:126-134` only ever calls both
  with 1-2 args using the default delimiter).
- The reference-identity fact itself (`root.$T === l2.$T`, 21-of-32 members `sameRef`) — not
  something either spec file asserts; this spec is the first place it is written down and
  execution-checked.

## Evidence

All inventory and reference-identity values: `<scratchpad>/t-inventory.ts`, run via
`npx ts-node --transpile-only` from the lemon-core repo root, `require()`-ing
`src/index`, `src/helpers/helpers`, and `src/extended/cores/commons` directly by absolute path
(bypassing the barrel so L1 and L2 could be compared as distinct in-memory objects). All
behavioral-diff values: `<scratchpad>/t-behavior-diff.ts`, same method. No source file was
modified; `git status`/`git branch --show-current` checked clean/on-branch before and after.
Coverage-map verdicts: direct reading of `src/helpers/helpers.spec.ts` and
`src/extended/cores/commons.spec.ts` (line numbers cited inline above), cross-checked against
both files' `it(`/`_it(` counts via `grep -c`. All cells in § 3 are
**verified by execution 2026-09-02**; none in this file are `unverified`.
