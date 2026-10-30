# v5 B18 — devDependencies audit and coverage

Status: implemented 2026-10-30 on `chore/v5-b18-audit-coverage` (base `v5` @ `da5de79b` = 5.0.11): B18-d (audit, `.npmignore`), B18-a/b/c (offline specs), and one formatting commit. No runtime change: the only `src/` edit outside specs is a prettier line wrap in `dynamo-service.ts`; the published files are otherwise untouched.

## Audit

`npm audit --omit=dev` was already 0 (B11) and stays 0. The full `npm audit` (devDependencies included):

| | Rows | Severity |
|---|---|---|
| Before (5.0.11) | 9 | 7 moderate, 2 critical |
| After (B18-d) | 6 | 4 moderate, 2 critical |
| 5.0.12 (lemon-devkit 0.2.3) | **0** | — |

The rows have two roots.

1. **vitest chain — fixed.** `vitest` and `@vitest/coverage-v8` (direct devDependencies, `^4.1.4`) pulled `@vitest/mocker < 4.1.12` (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8). Both move to `^4.1.12` together (latest 4.x; they must stay on the same version). The lock change is the vitest 4.1.12 tree only (`@vitest/*`, `chai`, `rolldown` 1.2.16 and small helpers). Major 5 is out of scope. Test counts are unchanged: 64 files, 880 tests.
2. **lemon-devkit chain — fixed in 5.0.12.** `lemon-devkit ^0.2.1` (installed 0.2.2) depended on the deprecated `request@2.88.2`, which brought `form-data <= 2.5.5` (critical), `qs`, `tough-cookie` and `uuid` (moderate) — the 6 rows left after B18-d. lemon-core keeps the devDependency (the AWS specs call `loadProfile()` through `src/environ.ts`), so the fix went into lemon-devkit: 0.2.3 replaces `request` with Node `http`/`https` in `exec-cli`. 5.0.12 moves to `lemon-devkit ^0.2.3`; `npm audit` is **0** (all and `--omit=dev`).

## Codecov

The last Codecov and Travis remnants are removed: the `.npmignore` blocks `# codecov` / `.codecov.yml` and `# travis` / `.travis.yml` (both files are gone since B17, which kept these lines as harmless). Coverage stays local, with no upload service:

- `vitest.config.ts`: `coverage.enabled: true`, provider `v8`, reporters `text` and `html`, `reportsDirectory: 'coverage'`.
- `coverage/` is ignored by `.gitignore` (`coverage` pattern), so the HTML report is never committed.
- `npm test` prints the text table. Total at 5.0.11 + B18-d: 70.28 % lines (68.98 % statements, 63.72 % branches, 70.09 % functions).

## Coverage

`npm test` (`LS=1 vitest run`, v8) before and after B18:

| | Files / tests | Statements | Branches | Functions | Lines |
|---|---|---|---|---|---|
| 5.0.11 | 64 / 880 | 68.98 % | 63.72 % | 70.09 % | 70.28 % (6185 / 8800) |
| B18 | 87 / 1136 | 95.15 % | 85.87 % | 95.57 % | **96.39 %** |

23 new `*.b18.spec.ts` files, 256 new tests, all offline: no AWS, DynamoDB, OpenSearch or network. The AWS SDK v3 clients are stubbed at `Client.prototype.send` (the tests assert the command class and its `input`), OpenSearch through a fake client or proxy, HTTP through `vi.spyOn` / partial `vi.mock` of the internal helpers, env keys are saved and restored, waits run on fake timers. Dummy values only (`123456789012`, `test-bucket`, `*.invalid`).

| Slice | Scope | Uncovered lines before → after |
|---|---|---|
| B18-a | `src/cores/dynamo/**`, `src/lib/dynamodb-value.ts` | 709 → 5 |
| B18-b | `src/cores/aws/*` (s3, kms, sqs, sns), `src/cores/elastic/os2-*`, `src/cores/storage/{storage,http-storage}-service.ts` | 693 → 1 |
| B18-c | `src/extended/**`, `src/cores/api/api-service.ts`, `src/engine/{utilities,engine}.ts`, `src/helpers/helpers.ts` | 923 → 45 |

Left uncovered on purpose: dead code (`tools/query.ts` `formatAttributeValue`, `synchronizeContents._parrallel`, two `new Error()` never thrown in `os2-service.ts`), `$X2.loadCredentials` (reads local AWS credentials), and branches the types or the call order rule out.

### Findings pinned as current behaviour (not fixed here)

The specs document these as they are today, each in a test labelled `B18`; fixing any of them changes behaviour and belongs in its own change.

1. `cores/dynamo/tools/utils.ts` `paginatedRequest()`: `async@3`'s `doWhilst` calls the test as `test(...args, cb)`, but the test function returns a boolean and never calls `cb`, so `Query.exec()` / `Scan.exec()` never call back after a success or a retryable error. Nothing in `src/` calls `.exec()` today.
2. `cores/elastic/os2-service.ts` `generateSearchResult()`: a 429 retry only works after the first page; a 429 on page 1 ends the loop with `[]`.
3. `cores/elastic/os2-query-service.ts` `buildQueryBody()`: `$source: '*'` (or an array) together with a `#field` projection throws `TypeError: $source.includes.push is not a function`.
4. `helpers.ts` legacy `$protocol(service, param, body)`: sets `stage` only; `param` is read after `service` is reassigned.
5. `OS2Instance.search()` ignores `params.indexName` (the base `AbstractOS2Instance.search()` supports it).
6. `loadFromFile()` derives a type by dropping the last letter of the object key (`Owner` → `owne`).

Known timing-sensitive test outside B18: `helpers.spec.ts › should pass my_sequence()` assumes `waited(100)` never ends early; it failed once on a loaded machine and passed on rerun.
