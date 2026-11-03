# v5 — `getMulti()` options and `null` for a missing id (#207)

Status: implemented 2026-11-03 on `fix/v5-issue-207-getmulti` (base `develop`, 5.0.24). No version change.
Issue: https://github.com/lemoncloud-io/lemon-core/issues/207 (option A, approved by the owner).
Upgrade note: `HOW_TO_UPGRADE_V5.md` § 11.11.

## Symptom

`CoreManager.getMulti(['A', 'B'])` with a missing `B` threw
`404 NOT FOUND - test:B (S:1/2) - parallel(10/2)` instead of returning `[modelA, null]`.
The JSDoc and the `404 → null` mapping in `getMulti()` promised a `null` gap.

## Cause

`getMulti$()` passed only a number (the size) to `my_parallel()`. Since 4.1.1 the `my_parallel()` default of
`throwable` is env `MY_PARALLEL_THROW` (`'1'`, true), so the first missing id threw and the `404 → null` line in
`getMulti()` was never reached. The `throwable` JSDoc of `my_parallel()` still said `(default: false)`.

## Fix

-   `getMulti(idList, options?)`: `throwable` is `false` by default. A failed id whose error starts with
    `404 NOT FOUND` is `null`; any other error is thrown as the original object (type, stack, `code`, `cause`;
    the first non-404 id in input order; the `find()` / `findByKey()` rule). The result has the order and length
    of `idList`. `{ throwable: true }` keeps the 4.1.1+ throw.
-   `getMulti$(idList, idName?, options?)`: the default stays the `my_parallel()` default (throw, pinned in the
    specs since `1c962258`). With `{ throwable: false }` a failed id is the entry `GetMultiFailure` `{ id, error }`
    keyed by the input id (also with a custom `idName`); the type is `{ [id]: Model | GetMultiFailure }` (overload).
    The error scope is `getMulti$(<type>)`.
-   The read outcome is tracked per id (private `readMulti()`), apart from the model's own `error` field: a stored
    `error: 'pending'` is a model, a rejection `new Error('')` is a failure.
-   A number as `options` is still the size: `getMulti(ids, 100)` works as before.
-   `my_parallel()`: JSDoc of `throwable` corrected to `(default: true — env MY_PARALLEL_THROW, …)`. No code change.

Copilot review on #278 (follow-up 2):
-   With a custom `idName`, a failure whose input id equals a model's key is not written: the model wins (one log
    line; the `errNoti` report still counts it). Use `idName: 'id'` or `getMulti()` to see every failure.
-   Overloads: no options, a number, `{ size }` or `{ throwable: true }` → `{ [id]: Model }`; a `GetMultiOptions`
    variable or `{ throwable: false }` → `{ [id]: Model | GetMultiFailure }`.
-   A synchronous throw of an overridden `retrieve()` is recorded as a failure; report ids are cut to 255 chars.

## Options (`GetMultiOptions`)

| Option      | `getMulti()` default        | `getMulti$()` default          | Effect                                      |
| ----------- | --------------------------- | ------------------------------ | ------------------------------------------- |
| `size`      | env `MY_PARALLEL_SIZE` (10) | same                           | size of parallel execution                  |
| `throwable` | `false`                     | env `MY_PARALLEL_THROW` (true) | throw on the first failed id                |
| `errNoti`   | `false`                     | `false`                        | one `doReportError()` with the failed items |
| `context`   | none                        | none                           | request context for the `errNoti` report    |

`errNoti` sends one report `getMulti$(<type>) failed: <n>/<total> items` with the payload fields of the batch
read/update report (`total_count`, `failed_count`, `success_count`, `failed_items: [{ id, error }]`, `context`).
`failed_items` holds at most 20 entries; `omitted_count` gives the rest (`failed_count` is the true total).
`context` is the 2nd argument of `doReportError()` (the target without `REPORT_ERROR_ARN`). A throwing call throws
before the report. A failed report is logged and never fails the batch get. In local mode it returns `'!ignore'`.

## Specs

-   `src/extended/abstract-service.spec.ts` `#207 getMulti options`: mixed ids (`[A, null, A]`), numeric argument,
    `{ throwable: true }`, a non-404 error, `getMulti$()` map shape with `{ throwable: false }`, `errNoti` once / absent.
-   `#207 getMulti follow-up`: stored `error: 'pending'`, empty-message rejection, original error (`toBe`), custom
    `idName` keys, 25 failures → 20 items + `omitted_count: 5`, `context` forwarded.

Copilot review on #276 (follow-up): outcome apart from the model `error`, original error rethrown, `GetMultiFailure`
type, input-id keys with `idName`, 20-item report cap, `context` for the report.
-   Changed pinned lines: `getMulti(['1', '1'])` and `getMulti(['A', 'A'])` (`abstract-services.spec.ts`) → `[null, null]`;
    `getMulti$(['1', '1'])` still throws, with the new scope `getMulti$(test)`.

## Callers

The only caller found in the organization is carrot-pools2-api. It reads `null` gaps from `getMulti()`, so it gets
the documented result again. Code that caught the 404 error of `getMulti()` should check for `null`, or pass
`{ throwable: true }`.
