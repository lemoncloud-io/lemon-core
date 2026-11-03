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

-   `getMulti(idList, options?)`: `throwable` is `false` by default. An entry whose error starts with
    `404 NOT FOUND` is `null`; any other error is thrown (the first one; the `find()` / `findByKey()` rule).
    The result has the order and length of `idList`. `{ throwable: true }` keeps the 4.1.1+ throw.
-   `getMulti$(idList, idName?, options?)`: the default stays the `my_parallel()` default (throw, pinned in the
    specs since `1c962258`). With `{ throwable: false }` a failed id is the entry `{ id, error }` in the map
    (the 4.0 shape). The error scope is `getMulti$(<type>)`.
-   A number as `options` is still the size: `getMulti(ids, 100)` works as before.
-   `my_parallel()`: JSDoc of `throwable` corrected to `(default: true — env MY_PARALLEL_THROW, …)`. No code change.

## Options (`GetMultiOptions`)

| Option      | `getMulti()` default        | `getMulti$()` default          | Effect                                      |
| ----------- | --------------------------- | ------------------------------ | ------------------------------------------- |
| `size`      | env `MY_PARALLEL_SIZE` (10) | same                           | size of parallel execution                  |
| `throwable` | `false`                     | env `MY_PARALLEL_THROW` (true) | throw on the first failed id                |
| `errNoti`   | `false`                     | `false`                        | one `doReportError()` with the failed items |

`errNoti` sends one report `getMulti$(<type>) failed: <n>/<total> items` with the payload fields of the batch
read/update report (`total_count`, `failed_count`, `success_count`, `failed_items: [{ id, error }]`). A failed
report is logged and never fails the batch get. In local mode `doReportError()` returns `'!ignore'`.

## Specs

-   `src/extended/abstract-service.spec.ts` `#207 getMulti options`: mixed ids (`[A, null, A]`), numeric argument,
    `{ throwable: true }`, a non-404 error, `getMulti$()` map shape with `{ throwable: false }`, `errNoti` once / absent.
-   Changed pinned lines: `getMulti(['1', '1'])` and `getMulti(['A', 'A'])` (`abstract-services.spec.ts`) → `[null, null]`;
    `getMulti$(['1', '1'])` still throws, with the new scope `getMulti$(test)`.

## Callers

The only caller found in the organization is carrot-pools2-api. It reads `null` gaps from `getMulti()`, so it gets
the documented result again. Code that caught the 404 error of `getMulti()` should check for `null`, or pass
`{ throwable: true }`.
