# Spec: `$U.dt` (→ `Utilities.datetime`)

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** utilities/dt

## Signature

```ts
// instance member, delegates immediately (utilities.ts:272-274)
public dt(dt?: string | number | Date, timeZone?: number)

// the actual implementation is a static method (utilities.ts:201)
public static datetime(dt?: string | number | Date, timeZone?: number)
```

`$U.dt === Utilities.datetime` in behavior (thin delegate, no extra logic added at `:272-274`).
Note `$engine.dt` (`builder.ts:246`) is a **separate reference that points at the same static
function**, not a wrapper around `$U.dt` — same behavior, different access path. `$U` is an
*instance* of `Utilities`; `Utilities.datetime`/`Utilities.timestamp` are `static` and are not
reachable as `$U.datetime`/`$U.timestamp` (only via `$U.dt`/`$U.ts`, or `Utilities.datetime`
directly).

## Behavior — string input (the format-detection branch, `utilities.ts:203-256`)

The string branch is a two-stage pipeline:

1. Regex-match `dt` against 7 fixed formats, in order, and build a normalized
   `'YYYY-MM-DD HH:MM:SS'` string, filling missing time-of-day with **`12:00:00`**
   (`utilities.ts:208-241`). No match → normalized string stays `''`.
2. Parse that string into a Date via `new Date(y, m-1, d, h, i, s, 0)` — **a local-time
   constructor call** (`utilities.ts:242-254`) — then shift it by
   `diff = (timeZone ?? 0) * 60 + tzo` minutes, where `tzo = new Date().getTimezoneOffset()`
   is the *executing machine's* offset (`utilities.ts:204-206`, `:255`).

Because step 2 mixes a local-time constructor with a machine-tzo-based shift, the two effects
algebraically cancel **as long as the machine's offset is the same at call time and at the target
date (non-DST zones — see the DST caveat below the format table)**: the resulting UTC instant
(epoch) is then independent of the machine's own timezone, and is exactly `Date.UTC(y, m-1, d, h, i, s) − timeZone_hours × 3600000` (with
`timeZone` treated as `0` when omitted). This was derived from source and confirmed by
re-running the identical script under both `TZ=Asia/Seoul` and `TZ=UTC` and observing identical
`.toISOString()` output for every case below (verified by execution 2026-09-02). What *does*
vary by machine timezone is how that instant prints (`.toString()`, `.getHours()`) and whether
it equals a **locally-constructed** comparison Date such as `new Date(1978, 11, 1, 12, 0, 0)` —
which is exactly what `utilities.spec.ts:59-79`'s skipped test compares against.

### Format table (all rows: `timeZone` omitted, i.e. `?? 0`)

| Input | Format matched | Normalized string | Result `.toISOString()` (invariant across **non-DST** zones — see DST caveat) | Result `.toString()` on **this machine (KST)** | Evidence |
| --- | --- | --- | --- | --- | --- |
| `'1978-12-01'` | `YYYY-MM-DD` | `'1978-12-01 12:00:00'` | `1978-12-01T12:00:00.000Z` | `Fri Dec 01 1978 21:00:00 GMT+0900` | `utilities.ts:208-210` — verified by execution 2026-09-02 |
| `'79-11-26'` | `[4-9][0-9]-MM-DD` (2-digit, → `19xx`) | `'1979-11-26 12:00:00'` | `1979-11-26T12:00:00.000Z` | `Mon Nov 26 1979 21:00:00 GMT+0900` | `utilities.ts:211-213` — verified by execution 2026-09-02 |
| `'19-11-26'` | `[0-3][0-9]-MM-DD` (2-digit, → `20xx`) | `'2019-11-26 12:00:00'` | `2019-11-26T12:00:00.000Z` | `Tue Nov 26 2019 21:00:00 GMT+0900` | `utilities.ts:214-216` — verified by execution 2026-09-02 |
| `'1978-12-01 12:34'` | date + `H:M` | `'1978-12-01 12:34:00'` | `1978-12-01T12:34:00.000Z` | `Fri Dec 01 1978 21:34:00 GMT+0900` | `utilities.ts:217-219` — verified by execution 2026-09-02 |
| `'1978-12-01 12:34:20'` | date + `H:M:S` | `'1978-12-01 12:34:20'` | `1978-12-01T12:34:20.000Z` | `Fri Dec 01 1978 21:34:20 GMT+0900` | `utilities.ts:220-224` — verified by execution 2026-09-02 |
| `'19781201'` | compact `YYYYMMDD` | `'1978-12-01 12:00:00'` | `1978-12-01T12:00:00.000Z` | `Fri Dec 01 1978 21:00:00 GMT+0900` | `utilities.ts:225-227` — verified by execution 2026-09-02 |
| `'19781201 1234'` | compact `YYYYMMDD HHMM` | `'1978-12-01 12:34:00'` | `1978-12-01T12:34:00.000Z` | `Fri Dec 01 1978 21:34:00 GMT+0900` | `utilities.ts:228-241` — verified by execution 2026-09-02 |
| `''` (empty) | no format matches | `''` | — returns `null` | `null` | `utilities.ts:242-243` (`if (!ts) return null`) — verified by execution 2026-09-02 |
| `'not-a-date'` | no format matches | `''` | — returns `null` | `null` | same as above — verified by execution 2026-09-02 |

Every date-only format fills `12:00:00` — confirmed for all 4 date-only formats above
(`utilities.ts:210`, `:213`, `:216`, `:227`).

> **DST caveat (added 2026-09-02, coordinator).** The "invariant" column holds only on machines
> whose UTC offset does not change between *now* and the *target date* — i.e. non-DST zones such
> as `Asia/Seoul` and `UTC`, which is where the rows above were verified. `utilities.ts:205` takes
> `tzo` from `new Date().getTimezoneOffset()` (call time), not from the constructed target date, so
> on a DST zone the result shifts by the DST delta when the two differ: under
> `TZ=America/New_York` on 2026-09-02 (EDT) the same `'1978-12-01'` (EST) input yields
> `1978-12-01T13:00:00.000Z`, one hour later than the table. Preserved defect — see Known defects
> item 5. Characterization tests (U2) compute the expected instant with the same call-time offset
> so they pass on any machine while still pinning this behavior.

### `timeZone` explicit vs. omitted (input `'1978-12-01'`)

| `timeZone` | `diff` (minutes, this machine) | Result `.toISOString()` | Result `.toString()` on KST machine | Evidence |
| --- | --- | --- | --- | --- |
| *(omitted)* → `?? 0` | `0*60 + (-540) = -540` | `1978-12-01T12:00:00.000Z` | `21:00:00 GMT+0900` | `utilities.ts:206` — verified by execution 2026-09-02 |
| `9` (matches machine) | `9*60 + (-540) = 0` | `1978-12-01T03:00:00.000Z` | `12:00:00 GMT+0900` | verified by execution 2026-09-02 |
| `0` (explicit, same as omitted) | `0*60 + (-540) = -540` | `1978-12-01T12:00:00.000Z` | `21:00:00 GMT+0900` | verified by execution 2026-09-02 — `timeZone: 0` and `timeZone: undefined` produce **identical** output, confirming `?? 0` (nullish coalescing, not falsy-coalescing) |
| `-5` | `-5*60 + (-540) = -840` | `1978-12-01T17:00:00.000Z` | `Sat Dec 02 1978 02:00:00 GMT+0900` | verified by execution 2026-09-02 |

**Note (patterns.md correction).** `projects/@lemoncloud-io/lemon-core/patterns.md` § 헬퍼
$U와 $T, item 1, describes the omitted-`timeZone` path as "`timeZone * 60` becomes `NaN`, so
`if (diff)` is false, and the machine's local timezone passes through uncorrected." That
description does not match the source: `utilities.ts:206` reads `(timeZone ?? 0) * 60 + tzo`,
so `undefined` becomes `0`, not `NaN`, and `diff` on this (KST) machine is `-540` (truthy) —
the correction *does* run, it just runs using the wrong assumed input timezone (UTC instead of
the intended local one). U0 documented this same finding
(`2026-09-02-U0-utilities-baseline.md` § 4(B)); this spec's job is only to record the current
behavior, not to edit `patterns.md` — that correction is the coordinator's, tracked separately.

## Behavior — number / `Date` input (`utilities.ts:257-260`)

These two branches **do not touch `diff` or `timeZone` at all** — the second argument is
silently ignored.

| Input | `timeZone` | Result | Evidence |
| --- | --- | --- | --- |
| `1700000000000` (number) | *(omitted)* | `2023-11-14T22:13:20.000Z` | `utilities.ts:257-258` — verified by execution 2026-09-02 |
| `1700000000000` | `9` | `2023-11-14T22:13:20.000Z` (identical) | `utilities.ts:257-258` — verified by execution 2026-09-02, `timeZone` has zero effect |
| `1700000000000` | `-5` | `2023-11-14T22:13:20.000Z` (identical) | same — verified by execution 2026-09-02 |
| `new Date(2020,0,1)` (Date object) | `9` | same reference (`ret === dt`, not a copy) | `utilities.ts:259-260` — verified by execution 2026-09-02 (`Utilities.datetime(D, 9) === D` → `true`) |

## Behavior — `undefined` / unsupported input

| Input | Result | Evidence |
| --- | --- | --- |
| `undefined` | `new Date()` — current instant, **`timeZone` argument also ignored here** (this branch is reached only when `dt` itself is `undefined`, so `timeZone` never enters the diff calculation) | `utilities.ts:261-262` — verified by execution 2026-09-02 (`dt(undefined, 9)` returns a value within 1s of `Date.now()`) |
| `true` (boolean, off-contract per the TS signature but reachable at runtime through untyped callers) | throws `Error('Invalid type of dt: boolean')` | `utilities.ts:263-264` — verified by execution 2026-09-02 |
| `{}` (plain object, not a `Date`) | throws `Error('Invalid type of dt: object')` | `utilities.ts:259` (`instanceof Date` check fails) + `:263-264` — verified by execution 2026-09-02 |

## Environment dependencies

- **Clock**: reads `new Date()` twice per string-branch call (`utilities.ts:204`, used only to
  read `tzo`) and once for the `undefined` branch (`:262`) — non-deterministic across runs only
  in the `undefined` case; the string/number/Date branches are deterministic given fixed inputs.
- **Machine timezone (`tzo = new Date().getTimezoneOffset()`)**: consumed in the string branch
  only (`utilities.ts:205`). As derived above, it cancels out of the final UTC instant — it
  only affects the *rendering* of that instant and any comparison against a locally-constructed
  `Date`. This machine: KST, `tzo = -540` (verified by execution 2026-09-02, matches
  `utilities.spec.ts:69`'s hardcoded assertion).
- **No env vars, no filesystem.**

## Known defects — preserved

This spec fixes behavior; it does not propose changes. The following are documented so a
later refactor does not "fix" them as an unnoticed side effect — any actual change is a
separate, explicit decision.

1. **Omitted-`timeZone` string parse assumes UTC input, not local input** (`utilities.ts:206`).
   Any caller passing a bare date/datetime string without a `timeZone` argument implicitly
   asserts that string is UTC; on a non-UTC machine the returned instant is offset from what a
   naive reading of the string would suggest. This is exactly why
   `utilities.spec.ts:59` (`_it`, skipped) fails on this (KST) machine — the skipped assertions
   compare against locally-constructed dates (e.g. `new Date(1978, 11, 1, 12, 0, 0)`, which on
   this machine represents `1978-12-01T03:00:00Z`) against the actual result
   (`1978-12-01T12:00:00Z`) — a 9-hour mismatch. Confirmed by U0 and re-confirmed here by
   execution.
2. **`timeZone` is silently ignored for number and `Date` inputs** (`utilities.ts:257-260`).
   Only string input honors the second argument. A caller migrating a call site from a string
   date to an epoch-ms number will see the `timeZone` argument silently stop applying, with no
   error or warning.
3. **`timeZone` is silently ignored when `dt` is `undefined`** (`utilities.ts:261-262`,
   newly confirmed by execution for this spec — not called out explicitly in U0). `$U.dt(undefined, 9)`
   returns the same as `$U.dt()` — plain `new Date()`. This is a third, previously-unnamed
   instance of the same "timeZone silently no-ops" family as defect 2, and it is the exact
   mechanism behind `$U.now()`'s behavior (see `now.md`).
4. **`Date` input returns the same object reference**, not a copy (`utilities.ts:259-260`).
   Callers that later mutate the returned Date (e.g. `.setSeconds(...)`) will mutate the
   caller's original object too.
5. **Offset is sampled at call time, not at the target date** (`utilities.ts:205`,
   `now.getTimezoneOffset()` where `now = new Date()`). On DST zones this makes string parsing
   off by the DST delta whenever the current date and the target date are on different sides of a
   DST transition (verified: `TZ=America/New_York`, `'1978-12-01'` → 13:00Z instead of 12:00Z).
   Invisible on `Asia/Seoul`/`UTC`. Preserved; fixing it means reading the offset from the
   constructed date instead.

## Not covered by existing spec

- `utilities.spec.ts:59`'s `datetime()` test is declared with `_it(...)` (the skip helper,
  `src/common/test-helper.ts:108`), not `it(...)` — it does not run in the active suite. It is
  the **only** call site of `dt`/`datetime` in the spec file. Net: `$U.dt` has **zero** active
  test coverage (matches U0 § 2's "uncovered" verdict for `dt`).
- No existing test exercises: number input, `Date` input, `undefined` input, the compact
  `YYYYMMDD [HHMM]` formats, or invalid/unparseable strings (all newly covered above).
- No existing test exercises multiple explicit `timeZone` values against the same input to
  isolate the `diff` formula (the table above does; the skipped test only ever omits
  `timeZone` or implicitly uses the KST-only expectation).

## Evidence

All values in this file were produced by executing `Utilities.datetime(...)` directly
(`import { Utilities } from '.../src/engine/utilities'`, no engine boot needed — this member
touches no `this._$` state) via `npx ts-node --transpile-only` against the unmodified source,
run twice: once under the shell's default `TZ` (this machine, `Asia/Seoul`) and once with
`TZ=UTC` prefixed, to populate the "machine-invariant" vs. "this machine" columns and to
confirm the epoch-invariance claim. No source file was modified. All cells are
**verified by execution 2026-09-02** except where marked otherwise; none in this file are
`unverified`.
