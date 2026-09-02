# Spec: `$U.env` / `$U.get_env`

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** utilities/env

## Signature

```ts
public get_env(name: string, def_val?: string): any   // utilities.ts:80-86
public env(name: string, def_val?: string): any        // utilities.ts:88-90
```

`env` is a one-line delegate to `get_env` (`utilities.ts:89`, `return this.get_env(name, def_val)`)
— confirmed identical output for identical input by execution 2026-09-02.

```ts
public get_env(name: string, def_val?: string): any {
    if (typeof this._$.environ === 'function') return this._$.environ(name, def_val);
    const val = (process && process.env[name]) || undefined;
    return val === undefined ? def_val : val;
}
```

`get_env` has **two entirely different implementations** selected at call time by whether
`this._$.environ` (the engine core injected in the `Utilities` constructor, `utilities.ts:72-73`)
is a function:

- **Branch A — `this._$.environ` present** (`utilities.ts:81`): delegates fully to
  `this._$.environ(name, def_val)`. `def_val` and its fallback logic belong to whatever
  `environ` implementation the host engine supplies.
- **Branch B — no `environ`** (`utilities.ts:83-85`): reads `process.env[name]` directly, with
  `|| undefined` — meaning a **falsy** value (in practice, `''`) is treated as "not set" and
  replaced by `def_val`.

## Which branch actually runs — a correction to U0

**U0 (§ 2, coverage map) judged `get_env` "partial: ... 기본(`process.env`) 분기만 —
`this._$.environ` 분기는 미실행 확인"** (only the process.env fallback branch runs; the
`environ` branch is unexercised). Tracing the actual construction path shows this is
**backwards**:

- `utilities.spec.ts:18-22`'s `instance()` builds `$U` via
  `new Utilities($engine)` where `$engine = $builder.instance().$engine`
  (`utilities.spec.ts:19`, `import * as $builder from './builder.spec'`).
- `builder.spec.ts:17-20`'s `instance()` calls `buildEngine(scope, options)` with **no
  arguments** when invoked this way.
- `buildEngine` (`builder.ts:205-206`) does `options = options || {}` and then
  **unconditionally** does `const _environ = build_environ(options);` and assigns it to
  `public environ: ... = _environ` on the constructed `$engine` (`builder.ts:211`, `:247-248`).
  There is no code path through `buildEngine()` that leaves `environ` undefined.
- Therefore **every `$U` built through `buildEngine()`** — including the one
  `utilities.spec.ts:27-33`'s `check env()` test uses, and including `$U` as consumed
  throughout the rest of the codebase via `src/engine/index.ts:26` — **always takes Branch A**.
  Branch B (the raw `process.env` fallback) is only reachable by constructing a `Utilities`
  instance by hand with a `_$`/`EngineCore` stub that has no `environ` function — which is not
  how `$U` is built anywhere in the current codebase or in the active test suite.

This spec's tables below therefore verify **Branch A** as the behavior that governs
`utilities.spec.ts:27-33` and all real usage, and **Branch B** separately as a distinct code
path reachable only via manual construction (done here purely to characterize it, not because
any current call site reaches it).

## `build_environ` (Branch A's actual implementation, `builder.ts:31-37`)

```ts
export const build_environ = (options: EngineOption) => (name: string, defVal: any) => {
    const env = options.env || (process && process.env) || {};
    const val = env[name];
    if (defVal && defVal instanceof Error && val === undefined) throw defVal;
    return val === undefined ? defVal : val;
};
```

Reads from `options.env` if the engine was built with one (`buildEngine(global, { env:
process.env })` in `src/engine/index.ts:23` passes `process.env` explicitly; `builder.spec.ts`'s
bare `buildEngine()` call has no `options.env`, so it falls back to `process.env` too) — in
both cases the effective source is `process.env`. The key behavioral difference from Branch B
is the **missing `|| undefined`**: Branch A checks `val === undefined` only, so an empty string
value is returned as-is rather than treated as unset.

## Behavior table — Branch A (`this._$.environ` present — the real, exercised path)

| Call | `process.env[name]` | Result | Evidence |
| --- | --- | --- | --- |
| `$U.get_env('hi')` | unset | `undefined` | `utilities.spec.ts:30` + `builder.ts:33` — verified by execution 2026-09-02 |
| `$U.get_env('hi', '')` | unset | `''` | `utilities.spec.ts:31` — verified by execution 2026-09-02 |
| `$U.get_env('hi', 'hoho')` | unset | `'hoho'` | `utilities.spec.ts:32` — verified by execution 2026-09-02 |
| `$U.get_env(KEY, 'fallback')` | `''` (explicitly set to empty string) | `''` — **not** `'fallback'` | `builder.ts:34` (`val === undefined` only) — verified by execution 2026-09-02 |
| `$U.get_env(KEY, 'fallback')` | `'value1'` | `'value1'` | verified by execution 2026-09-02 |
| `$U.get_env(KEY)` | `'123'` | `'123'` (string — **no numeric coercion**, unlike `qs_parse`) | verified by execution 2026-09-02, `typeof` confirmed `'string'` |
| `$U.env(KEY)` vs `$U.get_env(KEY)` | any | identical value | `utilities.ts:89` — verified by execution 2026-09-02 (`===` compared) |

## Behavior table — Branch B (no `environ` — reachable only via manual construction, not by any current call site)

| Call | `process.env[name]` | Result | Evidence |
| --- | --- | --- | --- |
| `get_env(KEY, 'fallback')` | `''` | `'fallback'` — **treats empty string as unset** | `utilities.ts:84` (`|| undefined` coerces falsy to `undefined`) — verified by execution 2026-09-02 |
| `get_env(KEY, 'fallback')` | `'set'` | `'set'` | verified by execution 2026-09-02 |
| `get_env(KEY, 'fallback')` | unset | `'fallback'` | verified by execution 2026-09-02 |
| `get_env(KEY)` | unset | `undefined` | verified by execution 2026-09-02 |

## Known defects — preserved

This spec fixes behavior; it does not propose changes.

1. **Branch A and Branch B disagree on empty-string handling** (`builder.ts:34` vs.
   `utilities.ts:84`). Branch A returns `''` verbatim; Branch B silently substitutes `def_val`.
   This is a genuine, newly-confirmed divergence not previously documented in U0 or
   `patterns.md` — a caller relying on `get_env(name, someDefault)` to fall back on an empty
   env var will see that fallback fire only if `$U` happens to have been constructed without a
   real engine (which, per the trace above, essentially never happens in this codebase).
2. **Branch B is effectively dead code in the current codebase.** Every construction path found
   (`src/engine/index.ts:23`, `utilities.spec.ts:19-20` via `builder.spec.ts`) produces an
   `environ` function, so Branch B (`utilities.ts:83-85`) is unreachable by any traced call
   site. It remains live code (not deleted), just unexercised outside a hand-built stub.
3. **`this._$` typed as required, not optional, but not always populated.** `Utilities`'s
   constructor signature (`utilities.ts:72`, `public constructor(_$: EngineCore)`) does not mark
   `_$` optional or guarantee `environ` exists on it; `get_env`'s runtime `typeof
   this._$.environ === 'function'` check (`:81`) is the only guard. A caller constructing
   `Utilities` directly with a partial stub (as this spec's Branch-B script does) gets silently
   different behavior with no type error, since `EngineCore`'s own `environ` field is itself
   optional in `types.ts` (unverified — not read as part of this WP's scope; inferred from the
   runtime check's necessity).
4. **No type coercion** — `get_env`/`env` never convert numeric-looking strings, unlike
   `qs_parse` (`qs.md`). A value of `'123'` stays the string `'123'`.

## Environment dependencies

- **env vars**: reads whichever single `name` is requested, sourced from `process.env`
  (directly in Branch B, or via `options.env → process.env` fallback in Branch A's
  `build_environ`).
- **Engine construction state**: behavior branches on whether `this._$.environ` exists — this
  is a constructor-time dependency, not a call-time one.
- **No filesystem, no clock.**

## Not covered by existing spec

- `utilities.spec.ts:27-33` covers Branch A only (as established above) for: unset+no-default,
  unset+empty-default, unset+non-empty-default. It does **not** cover: a *set* (non-empty)
  value, an empty-string *set* value, or numeric-looking string values (all newly covered
  above).
- Branch B (`this._$.environ` absent) has **zero** coverage anywhere, active or otherwise — it
  is only exercised by this spec's own verification script.
- `is_dev()` (`utilities.ts:92-95`, layered on `get_env('ENV')`/`('NODE_ENV')`/`('STAGE')`) has
  no test coverage at all (confirmed absent from `utilities.spec.ts` by full-file read) and is
  outside this WP's five-member scope — noted here only because it is `get_env`'s only internal
  consumer in this file.

## Evidence

Branch A was verified via the **engine-booted import** method
(`import { $U } from '.../src/engine/index'`, per `README.md`'s convention) — this actually
runs `buildEngine()` and gives the real `environ`, matching how `$U` is constructed everywhere
in the codebase. Branch B was verified via a **hand-built stub**
(`new Utilities({ log: () => {}, err: () => {} } as any)`), specifically to exercise code that
no traced call site currently reaches. A synthetic env key (`__U1_SPEC_TEST_VAR__` /
`__U1_SPEC_TEST_VAR2__`) was used for all mutation tests; the prior value (or absence) was
restored immediately after each script ran, and no real environment variable value is quoted
in this file. All cells are **verified by execution 2026-09-02**; none are `unverified`.
