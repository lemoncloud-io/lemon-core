# v5 B18 — devDependencies audit and coverage

Status: B18-d implemented 2026-10-30 on `chore/v5-b18-audit-coverage` (base `v5` @ `da5de79b` = 5.0.11). The coverage slices B18-a/b/c add the **Coverage** section. No runtime change: `src/` and the published files are untouched; only `devDependencies`, `package-lock.json` and `.npmignore` change.

## Audit

`npm audit --omit=dev` was already 0 (B11) and stays 0. The full `npm audit` (devDependencies included):

| | Rows | Severity |
|---|---|---|
| Before (5.0.11) | 9 | 7 moderate, 2 critical |
| After (B18-d) | 6 | 4 moderate, 2 critical |

The rows have two roots.

1. **vitest chain — fixed.** `vitest` and `@vitest/coverage-v8` (direct devDependencies, `^4.1.4`) pulled `@vitest/mocker < 4.1.12` (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8). Both move to `^4.1.12` together (latest 4.x; they must stay on the same version). The lock change is the vitest 4.1.12 tree only (`@vitest/*`, `chai`, `rolldown` 1.2.16 and small helpers). Major 5 is out of scope. Test counts are unchanged: 64 files, 880 tests.
2. **lemon-devkit chain — pending.** `lemon-devkit ^0.2.1` (installed 0.2.2) depends on the deprecated `request@2.88.2`, which brings `form-data <= 2.5.5` (critical), `qs`, `tough-cookie` and `uuid` (moderate). The 6 remaining rows are this chain (`lemon-devkit`, `request`, `form-data`, `qs`, `tough-cookie`, `uuid`); `npm audit` offers no fix. lemon-core keeps the devDependency: the AWS specs call `loadProfile()` from lemon-devkit through `src/environ.ts`. The fix belongs in lemon-devkit (drop `request`, release 0.2.3). After that release, this repo moves to `lemon-devkit ^0.2.3` and the audit is expected to reach 0. No `overrides` entry or stub for `request` is added here.

## Codecov

The last Codecov and Travis remnants are removed: the `.npmignore` blocks `# codecov` / `.codecov.yml` and `# travis` / `.travis.yml` (both files are gone since B17, which kept these lines as harmless). Coverage stays local, with no upload service:

- `vitest.config.ts`: `coverage.enabled: true`, provider `v8`, reporters `text` and `html`, `reportsDirectory: 'coverage'`.
- `coverage/` is ignored by `.gitignore` (`coverage` pattern), so the HTML report is never committed.
- `npm test` prints the text table. Total at 5.0.11 + B18-d: 70.28 % lines (68.98 % statements, 63.72 % branches, 70.09 % functions).

## Coverage

Filled in by the coverage slices (B18-a/b/c).
