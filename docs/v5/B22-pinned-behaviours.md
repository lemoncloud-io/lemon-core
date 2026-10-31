# v5 B22 — fixes of the behaviours pinned by B18

Status: implemented 2026-10-31 on `fix/v5-b22-pinned-behaviours` (base `v5`, 5.0.15). No version change.

B18 (`docs/v5/B18-audit-coverage.md` § "Findings pinned as current behaviour") pinned six behaviours in
`*.b18.spec.ts` tests. The owner decision (2026-10-31): fix items 1–4, investigate item 5 and then fix or
deprecate it, document item 6 only. Each changed line carries a `//* v5 B22: …` comment, and each new or changed
assertion is in a test labelled `B22`. No other behaviour changes.

| #   | Where                                                         | Result                                           |
| --- | ------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `cores/dynamo/tools/utils.ts` `paginatedRequest()`            | fixed — `Query.exec()` / `Scan.exec()` call back |
| 2   | `cores/elastic/os2-service.ts` `generateSearchResult()`       | fixed — a 429 on page 1 retries                  |
| 3   | `cores/elastic/os2-query-service.ts` `buildQueryBody()`       | fixed — `$source: '*'` or an array with `#field` |
| 4   | `extended/cores/abstract-services.ts` `OS2Instance.search()`  | fixed — honours `params.indexName`               |
| 5   | `helpers/helpers.ts` legacy `$protocol(service, param, body)` | fixed — no caller is affected (usage below)      |
| 6   | `extended/cores/abstract-controllers.ts` `loadFromFile()`     | documented only (JSDoc), no change               |

The item numbers follow the B22 task. In the B18 list, `$protocol` is item 4 and `OS2Instance` is item 5.

## 1. `paginatedRequest()` never called back

-   Symptom: `Query.exec(cb)` / `Scan.exec(cb)` never called `cb` after a success or after a retryable error.
-   Cause: `async@3` `doWhilst(fn, test, cb)` calls the test as `test(...args, check)` and waits for `check`.
    The test function returned a boolean and never called `check`.
-   Fix: the test function calls `check(null, again)`. The retry, `loadAll` and `LastEvaluatedKey` rules are the
    same (`again` = `loadAll && lastEvaluatedKey`, or a retryable error).
-   Spec (`cores/dynamo/tools/utils.b18.spec.ts`):
    -   success → the callback gets the merged result;
    -   two pages (`LastEvaluatedKey`, then none) with `loadAll` → `startKey()` gets the first key, both pages are merged;
    -   a retryable error, then a success → one retry, then the result;
    -   a non-retryable error → `callback(err)` (B18 case, unchanged).

## 2. A 429 on the first search page ended with `[]`

-   Symptom: `searchAll()` / `generateSearchResult()` with `retryOptions.do` retried a 429 only after page 1.
    A 429 on page 1 ended the loop with no items and no error.
-   Cause: the retry used `continue`, and a `do … while` `continue` checks the loop condition. On page 1 there is no
    `body.search_after` yet, so the loop ended.
-   Fix: a retry sets a `retrying` flag, and the loop repeats while `retrying`. The retry limit (`maxRetries`) and the
    wait (`t`) are the same. A retry does not count against `limit` (before, a retry on page 2+ took one page off
    `limit`).
-   Spec (`cores/elastic/os2-service.b18.spec.ts`): a 429 on page 1, then two pages → all items, 3 calls; with
    `limit: 1` → the first page; two 429s with `maxRetries: 1` → the 429 error. The B18 case (429 on page 2) is
    unchanged.

## 3. `$source: '*'` or an array with a `#field` projection threw

-   Symptom: `buildQueryBody({ $source: '*', '#name': 1 })` threw `TypeError: $source.includes.push is not a function`.
-   Cause: the projection pushed into `$source.includes`. For a string or an array, `includes` is the
    `String`/`Array` method, not a list.
-   Fix: before a projected field is added, a string `$source` becomes `{ includes: [$source] }` and an array becomes
    `{ includes: [...array] }` (a copy; the caller's array is not changed).
-   Spec (`cores/elastic/os2-query-service.b18.spec.ts`, table rows labelled `B22`):

| Param                                                     | Before                                      | After                                   |
| --------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `{ $source: '*', '#b': 1 }`                               | `TypeError`                                 | `{ _source: { includes: ['*', 'b'] } }` |
| `{ $source: ['a'], '#b': 1 }`                             | `TypeError`                                 | `{ _source: { includes: ['a', 'b'] } }` |
| `{ $source: { includes: ['a'] }, '#b': 1 }`               | `{ includes: ['a', 'b'] }`                  | same                                    |
| `{ $source: 'a,!c', '#b': 1 }`                            | `{ includes: ['a', 'b'], excludes: ['c'] }` | same                                    |
| `{ $source: '*' }` / `{ $source: ['a'] }` (no projection) | `'*'` / `['a']`                             | same                                    |

## 4. `OS2Instance.search()` ignored `params.indexName`

-   Symptom: `OS2Instance.search(body, { indexName })` searched the instance's own index.
-   Cause: the override dropped the `indexName` branch of `AbstractOS2Instance.search()`.
-   Fix: with `indexName`, the search runs on a new `OS2Service` with the same options and the same FGAC manager,
    and that index name. The instance keeps its own index.
-   Spec (`extended/cores/abstract-services.b18.spec.ts`, `B22 OS2Instance.search() honours indexName`): the FGAC
    transport gets `POST <indexName>/_search` with `search_type`; the instance option stays the same.

## 5. Legacy `$protocol(service, param, body)` set `stage` only

-   Symptom: with a string first argument, the 2nd argument did not become `param`, and the 3rd did not become `body`.
-   Cause: `param` was read from `service` after `service` was set to the 1st argument, and `body` was read from that
    `param`. So the default `param` and `body` were the service URL.
-   Fix: in the legacy form, `param` is the 2nd argument and `body` is the 3rd. The 3rd argument is the body only, so
    `isProd` comes from the env (`NS=SS`) and not from the body. Arguments of `execute()` / `enqueue()` / `notify()`
    still win over these defaults. The context form `$protocol(context, service, options)` is unchanged.
-   Spec (`helpers/helpers.b18.spec.ts`, `B22 legacy $protocol(service, param, body) maps param and body`).

### Usage (2026-10-31, read-only scan of the local org repos)

Scan: every `$protocol(` in `*/src/**/*.ts` of the local org checkouts (not `node_modules`, the worktrees, or the
old v4.2 checkout): 61 repos call it. lemon-core itself is counted separately.

| Call shape                                              | Calls | Repos                  | Affected by the fix                              |
| ------------------------------------------------------- | ----- | ---------------------- | ------------------------------------------------ |
| `$protocol(context, service)`                           | 381   | 61                     | no                                               |
| `$protocol(context, service, options)`                  | 106   | 59                     | no                                               |
| `$protocol(service)` (legacy, 1 argument)               | 1     | 1 (`lemon-boards-api`) | no — it passes `param` and `body` to `execute()` |
| `$protocol(service, param, body)` (legacy, 3 arguments) | 0     | 0                      | —                                                |
| comments and docs only                                  | 21    | 6                      | —                                                |

The context-form count includes one multi-line call whose context is an object literal. In lemon-core, the calls
(`abstract-rest-apis.ts`, `abstract-service.ts`, specs) use the context form. No caller passes the 3-argument
legacy form, so no caller relies on the old `param`. The 1-argument caller always passes `param` and `body` to
`execute()`, so its request is the same before and after.

## 6. `loadFromFile()` drops the last letter of an object key (documented only)

-   Behaviour: an object key that starts with a capital letter holds nested mock models. Their `type` is the key
    with the first letter lower-cased and the last letter dropped: the key is read as a plural (`Users` → `user`).
    A singular key loses a real letter (`Owner` → `owne`). An array item may set its own `type`.
-   Not changed: the derived `type` names the nested models and their id sequence. A change would rename the
    `type` (and the ids) of existing mock data.
-   Doc: JSDoc on `loadFromFile()`. The B18 spec case (`Owner` → `owne`) stays as it is.

## Gates

| Gate                         | Result                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `npm test` (before)          | 107 files / 1470 tests                                                             |
| `npm test` (after, two runs) | 107 files / 1478 tests (+8), lines 95.05 % → 95.07 %, statements 93.60 % → 93.62 % |
| `npm run build`              | exit 0                                                                             |
| `npm run api:check`          | unchanged (`base=304 current=306 added=24 removed=22 allow=46 not-allowed=0`)      |
| `npm run esm:smoke`          | `names=141 subpaths=5`                                                             |
| `npm run lint`               | 0 errors (105 warnings, none on a changed line); `--fix` leaves the tree unchanged |
| `npm audit` / `--omit=dev`   | 0 / 0                                                                              |
