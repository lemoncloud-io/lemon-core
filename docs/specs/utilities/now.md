# Spec: `$U.now`

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** utilities/now

## Signature

```ts
public now()
```

`(utilities.ts:276-278)`. Takes **no arguments** — the signature accepts none, and there is no
way to pass a `timeZone` or a specific instant through `now()` itself.

```ts
public now() {
    return this.dt();
}
```

## Behavior table

| Call | Delegates to | Result | Evidence |
| --- | --- | --- | --- |
| `$U.now()` | `this.dt()` = `Utilities.datetime(undefined, undefined)` | `new Date()` — the current instant at call time | `utilities.ts:277` → `:272-274` → `:261-262` — verified by execution 2026-09-02 (`now().getTime()` falls within `[Date.now() before, Date.now() after]` bracketing the call) |
| return type | `Date` instance | `now() instanceof Date === true` | verified by execution 2026-09-02 |

Because `dt()` is called with **zero arguments**, `dt`'s internal `dt` parameter is `undefined`,
which routes to the `dt === undefined` branch (`utilities.ts:261-262`, `ret = new Date()`) —
the same branch documented in `dt.md` § Behavior — `undefined` / unsupported input. `now()`
does not go through the string-format branch, so **the timezone/`diff` defects documented in
`dt.md` (defects 1–3) do not affect `now()`'s numeric value** — `now()` always returns the
true current instant, unaffected by machine timezone.

## Environment dependencies

- **Clock**: reads the system clock once per call, via `new Date()` inside
  `Utilities.datetime`'s `undefined` branch (`utilities.ts:262`). Non-deterministic across
  calls/runs by design (it's "now").
- **Machine timezone**: not consulted at all for `now()` — the `undefined`-input branch never
  reaches the `tzo`/`diff` code (`utilities.ts:204-206` is inside the `typeof dt == 'string'`
  branch only, `:203`). Confirmed by execution: `now()`'s value is identical regardless of the
  process `TZ` setting (only its *string rendering*, not its instant, would differ — not tested
  here since `now()` returns a `Date` object, not a string).
- **No env vars, no filesystem, no arguments accepted** — nothing else to vary.

## Known defects — preserved

`now()` itself introduces no new defect beyond what it inherits from `dt()`'s `undefined`
branch. It is documented here because U0 flagged it as "uncovered, inherits `dt`'s defects" —
this spec's execution shows the inheritance claim is only partially true: **`now()` does not
inherit the timezone-parsing defects (1–2) documented in `dt.md`**, because it never reaches
the string-parsing branch where those live. The only thing it inherits from `dt()` is defect 3
in `dt.md` (`timeZone` silently ignored for `undefined` input) — but `now()` never *offers* a
`timeZone` parameter in the first place, so that defect is unreachable through `now()` and only
matters for direct `dt(undefined, tz)` callers.

**Correction relative to U0.** U0 (§ 2, coverage map) states: `now` "어디서도 호출되지 않음
(내부적으로 dt()를 호출하므로 검증되어도 dt의 결함을 그대로 물려받음)" — uncovered, and would
inherit `dt`'s defects if it were tested. Execution for this spec shows that framing overstates
the inheritance: `now()` is unaffected by `dt`'s timezone-string-parsing defects because it
never supplies a string `dt` argument. The "uncovered" verdict itself is still correct — no
active test calls `now()`.

## Not covered by existing spec

- No active test in `utilities.spec.ts` calls `$U.now()` at all, directly or indirectly
  (confirmed by reading the file in full — the only reference to date/time helpers besides the
  skipped `datetime()` test is `$U.ts`/`current_time_ms`, both distinct from `now`/`dt`).
- No coverage exists for confirming `now()`'s independence from machine timezone (newly
  established here, see Behavior table).

## Evidence

Verified by execution 2026-09-02 — `npx ts-node --transpile-only` against a direct
`Utilities` instance built from a minimal `{ log, err }` stub (no engine boot required; `now`
touches no `this._$` state), bracketing `Date.now()` calls around `$U.now()` to confirm it
returns a live current-time `Date`, and calling `Utilities.datetime(undefined, 9)` to confirm
the second argument is a no-op when the first is `undefined`. No source file was modified.
