# Spec: `$U.ts` (→ `Utilities.timestamp`) — DST defect #22, relationship to `$U.dt`

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** helpers/ts

## Signature

```ts
// instance member, delegates immediately (utilities.ts:269-271)
public ts(d?: undefined | number | Date, timeZone?: number)

// static implementation (utilities.ts:177-182)
public static timestamp(date?: undefined | number | Date, timeZone?: number): string
```

`$U.ts === Utilities.timestamp` in behavior (thin delegate, no extra logic at `:269-271`), the
same pattern U1's `dt.md` already documented for `$U.dt`/`Utilities.datetime`. `$U.ts` is the
**format** direction (instant → `'YYYY-MM-DD HH:MM:SS'` string); `$U.dt` is the **parse**
direction (string/number/Date → `Date` instant). They share the same `diff` formula
(`(timeZone ?? 0) * 60 + tzo`) but apply it with **opposite sign** — see § 3.

## § 1. Behavior — 3-zone table (all rows: fixed epoch `1614241198963`, i.e.
`2021-02-25T08:19:58.963Z`, the exact anchor `utilities.spec.ts:264` hardcodes)

Executed by `npx ts-node --transpile-only <scratchpad>/u-ts-3zone.ts` under
`TZ=Asia/Seoul`, `TZ=UTC`, `TZ=America/New_York` — **verified by execution 2026-09-02** for
every cell.

| Call | `Asia/Seoul` (`tzo=-540`, no DST) | `UTC` (`tzo=0`, no DST) | `America/New_York` (`tzo=+240`, **DST**, call-time is EDT) |
| --- | --- | --- | --- |
| `$U.ts(FIXED)` (no `timeZone`) | `'2021-02-25 08:19:58'` | `'2021-02-25 08:19:58'` | **`'2021-02-25 07:19:58'`** |
| `$U.ts(FIXED, 0)` | `'2021-02-25 08:19:58'` | `'2021-02-25 08:19:58'` | `'2021-02-25 07:19:58'` |
| `$U.ts(FIXED, 9)` | `'2021-02-25 17:19:58'` | `'2021-02-25 17:19:58'` | `'2021-02-25 16:19:58'` |
| `$U.ts(FIXED, -5)` | `'2021-02-25 03:19:58'` | `'2021-02-25 03:19:58'` | `'2021-02-25 02:19:58'` |
| `$U.ts(new Date(FIXED))` | `'2021-02-25 08:19:58'` | `'2021-02-25 08:19:58'` | `'2021-02-25 07:19:58'` |

**Reading the table**: on the two non-DST zones (`Asia/Seoul`, `UTC`), `$U.ts(FIXED)` produces
the **same string regardless of machine zone or explicit `timeZone`** — because `diff = timeZone*60
+ tzo`, and the format-direction shift (`+1 * diff * 60` seconds, `utilities.ts:182`) combined
with reading the result back through *this same machine's* local getters exactly cancels `tzo`
out of the final displayed string, leaving only the requested `timeZone` (0 when omitted) as a
UTC-relative label. This mirrors `dt.md`'s already-derived "epoch-invariant across non-DST
zones" finding for `$U.dt`, and holds here too — confirmed across two independent non-DST zones.

On `America/New_York` (a real DST zone), the same call produces a value **one hour earlier**
than the other two zones. This is defect #22.

## § 2. Defect #22 — `$U.ts`'s no-`timeZone` path is DST-machine-dependent

**Mechanism.** `Utilities.timestamp` samples `tzo` from `new Date().getTimezoneOffset()` at
**call time** (`utilities.ts:179-180`, `now = new Date()` / `tzo = now.getTimezoneOffset()`), not from the target `date`/instant
being formatted. On 2026-09-02 (this spec's execution date), `America/New_York` is in EDT
(`tzo=+240`). The target instant being formatted, `FIXED` = `2021-02-25T08:19:58.963Z`, falls in
**EST** season (`tzo` would be `+300` if evaluated *at that date*). Because the code uses the
call-time offset (`+240`) instead of the target-date offset (`+300`), the shift applied is short
by exactly one hour — reproducing precisely the DST-mismatch mechanism `dt.md` already documented
for `$U.dt`'s string-parse branch, but here on the **format** side and **only** exposed when
`timeZone` is *omitted or explicit-but-still-adds a machine-tzo term* (every row in § 1 shows the
1-hour NY discrepancy, since `tzo` enters `diff` unconditionally regardless of whether
`timeZone` itself was given).

**Where this breaks a real test.** `utilities.spec.ts:264` — inside the `"check JWTHelper()"`
test (part of trap #22 in this WP's brief) — hardcodes:

```ts
const current = 1 ? 1614241198963 : $U.current_time_ms();
expect2(() => $U.ts(current)).toEqual('2021-02-25 08:19:58');
```

Per § 1, this assertion **passes** on `Asia/Seoul` (this repo's CI/dev default) and on `UTC`, and
**fails** on `America/New_York` (actual: `'2021-02-25 07:19:58'`). This is the same failure
family the U0 baseline already logged in aggregate (`lambda-*-handler.spec.ts`'s
`encodeIdentityJWT and verifyToken` tests, "9-hour mismatch" class, `2026-09-02-U0-utilities-
baseline.md` § 4 table, vault) — `check JWTHelper()` in `utilities.spec.ts` is a **sibling**
instance of the identical mechanism, just exposed as a 1-hour (DST-delta) mismatch here rather
than a 9-hour (KST-vs-UTC) mismatch there, because the machine under test here is itself a DST
zone rather than merely a different fixed offset. There is no comment in the source
acknowledging this specific fragility (unlike `$T.T`'s TZ assertions, which the author did
comment out — see [T.md](./T.md) § 3.5); `check JWTHelper()`'s hardcoded string is left fully
active. **Preserved defect, not fixed here.**

## § 3. Relationship to `$U.dt` — the `+1 *` / `-1 *` sign difference is a format/parse inverse, not a bug

`Utilities.timestamp` (`utilities.ts:182`): `dt.setSeconds(dt.getSeconds() + 1 * diff * 60)` —
**adds** `diff` minutes to the instant before reading its local wall-clock fields.
`Utilities.datetime` (`utilities.ts:255`, per `dt.md`): `ret.setSeconds(ret.getSeconds() + -1 *
diff * 60)` — **subtracts** `diff` minutes after naively parsing the string via a local-time
`Date` constructor.

These are opposite directions of the *same* transformation:

- `timestamp` starts from a real instant and must **shift it so this machine's local getters
  print the target zone's wall clock** → shift forward by the target zone's offset relative to
  this machine (`+diff`).
- `datetime` starts from digits that were just naively parsed *as if local* and must **undo that
  local interpretation and re-anchor to the target zone** → shift backward by the same quantity
  (`-diff`).

**Round-trip check (verified by execution, `Asia/Seoul`, `<scratchpad>/u-ts-3zone.ts`):**

```
$U.ts(FIXED, 5)                    = '2021-02-25 13:19:58'   // format FIXED as UTC+5 wall-clock
$U.dt('2021-02-25 13:19:58', 5)     .getTime() = 1614241198000
FIXED                                          = 1614241198963
```

The parsed-back instant equals `FIXED` to the second (the 963ms sub-second component is lost
because `$U.ts`'s string format has no fractional seconds — expected precision loss from the
format itself, not a sign or offset bug). **Verdict: the opposite signs are the correct and
necessary relationship for `$U.ts`/`$U.dt` to round-trip through the same `timeZone` value; this
is not a defect.** This holds identically on all three zones tested (the round-trip property
does not depend on machine timezone, only the *individual* `$U.ts(FIXED)` no-`timeZone` value
does, per § 1/§ 2).

## § 4. `timeZone` argument handling — same coverage pattern as `$U.dt`

`Utilities.timestamp`'s `date` argument accepts `undefined | number | Date` only (no string
branch — unlike `datetime`, which accepts `string | number | Date`). Verified:

| Input | `timeZone` | Result (`Asia/Seoul`) | Evidence |
| --- | --- | --- | --- |
| `undefined` | *(omitted)* | current instant, formatted per the same `diff` rule as any other input | `utilities.ts:178` (`date ? ... : new Date()`) — verified by execution 2026-09-02 |
| epoch number | *(omitted)* → `diff = tzo` | shown in § 1 | `:178-181` — verified |
| epoch number | explicit (`0`/`9`/`-5`) | shown in § 1, all honored | `:181-182` — verified, **unlike `$U.dt`'s number/Date branches, `$U.ts` does *not* silently ignore `timeZone` for number input** — the entire method funnels through the single `diff`-based shift regardless of input type, since `date` is normalized to a `Date` object (`:178`) before the `diff` math runs |
| `Date` object | explicit | shown in § 1 (`new Date(FIXED)` row) | `:178`, same code path as number — verified |

This is a **contract difference from `$U.dt`** worth flagging explicitly: `$U.dt`'s Known
defect 2 (`dt.md`) — "`timeZone` silently ignored for number/Date input" — does **not** apply to
`$U.ts`. `$U.ts` always applies `timeZone` (subject to the DST caveat in § 2), for every accepted
input type, because `timestamp()` has no per-type early-return branches the way `datetime()`
does — it normalizes to a `Date` unconditionally at `:178` before the single shared `diff`
calculation.

## Environment dependencies

- **Clock**: reads `new Date()` twice per call (`utilities.ts:178` for the `undefined`-date
  default, `:179` to read `tzo`) — non-deterministic across runs only when `date` itself is
  omitted; deterministic given a fixed `date` argument (subject to § 2's DST caveat).
- **Machine timezone (`tzo = new Date().getTimezoneOffset()`, sampled at call time)**: the sole
  source of § 2's defect. On non-DST zones this is a fixed constant per machine and the result is
  effectively machine-invariant for a given `timeZone` argument (§ 1). On a DST zone it varies
  with the calendar date of the *call*, not the date being formatted, producing the mismatch in
  § 2 whenever the two dates straddle a DST transition.
- **No env vars, no filesystem.**

## Known defects — preserved

This spec fixes behavior; it does not propose changes.

1. **`$U.ts`'s implicit `tzo` term makes every no-explicit-correction call DST-machine-dependent**
   (§ 2) — reproduces the exact mechanism `dt.md` documented for `$U.dt`, on the format side.
   Breaks `utilities.spec.ts:264`'s `check JWTHelper()` hardcoded assertion specifically on
   `America/New_York`-class machines (task brief's defect #22). Not fixed here — same
   `now.getTimezoneOffset()`-at-call-time root cause as `$U.dt`'s Known defect 5 (`dt.md`);
   fixing one likely means fixing both together, since they share the exact `diff` formula.
2. **No source comment marks this fragility** (unlike `$T.T`'s commented-out assertions,
   [T.md](./T.md) § 3.5) — `check JWTHelper()`'s `$U.ts` assertion is fully active and will fail
   silently-until-CI-runs-on-a-DST-machine, with no `//WARN!` or `//TODO` flagging it the way
   sibling code in the same file does (`utilities.spec.ts:263`'s `new Date().getTimezoneOffset()`
   assertion two lines above *is* flagged `//WARN! - can be different in env.`, but the very next
   line's `$U.ts` assertion is not).

## Not covered by existing spec

- No existing test in `utilities.spec.ts` varies `TZ` or asserts on `$U.ts` under any zone other
  than whatever the CI/dev machine happens to be — the 3-zone table above is new, not lifted from
  an existing (even skipped) test.
- No existing test isolates the `$U.ts`/`$U.dt` round-trip relationship (§ 3) — this spec is the
  first place that pairing is checked by execution.
- No existing test exercises `$U.ts`'s `Date`-object input branch in isolation (only number input
  is exercised, `utilities.spec.ts:264`, `:305`).

## Evidence

All values in this file were produced by `npx ts-node --transpile-only <scratchpad>/u-ts-
3zone.ts`, run three times with `TZ=Asia/Seoul`, `TZ=UTC`, and `TZ=America/New_York` prefixed,
against the unmodified clone, via `new Utilities({log,err,inf})` direct construction (no engine
boot needed for this member). No source file was modified. All cells are
**verified by execution 2026-09-02**; none in this file are `unverified`.
