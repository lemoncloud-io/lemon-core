# v5 B6 — migrating a service that carries a `src/cores/` copy

Status: procedure only (2026-10-28). No service code was changed and nothing was run in the services. The numbers are a read-only census of the five DoU backend repos (`develop`) and of 68 lemon-core consumer repos: grep and parser counts, no `tsc`, no `jest`. User-facing summary: `HOW_TO_UPGRADE_V5.md` § 12.

This is a per-repo procedure for a service that pins lemon-core `^4.x` and carries a `src/cores/` copy (11 files, about 6.3k lines; the 2026 template generation). The five DoU repos are the first targets, in this order:

| Order | Repo | Why |
| --- | --- | --- |
| 1 | `chatic-pushes-api` | 76 must-fix occurrences in 10 files (low end). 68 lemon-core import files and 36 spec files: 1/3.1 of sockets. 0 outgoing protocol calls, so the signing pair is only its 2 callers (backend, sockets). The only repo with a vitest config. Its two own items (`$T.S2` `'-'` ids, `@aws-sdk/client-sns` import) are covered by § 9.3 and § 8.1 |
| 2 | `chatic-sockets-api` | Same must-fix set (76 in 11 files). Reuses the 6-file change set fixed in pushes. Own work: 1 directory import, the WSS never-reject check, `lemon-model` `^1.2.2` → `^5.0.0` (section 10) |
| 3 | `chatic-backend-api` | Heaviest Stage B: 70 `domain === 'localhost'` checks and 4 outgoing protocol targets |
| 4 | `chatic-socials-api` | 80 must-fix occurrences in 11 files; 31 `domain` checks |
| 5 | `chatic-iap-api` | Fewest occurrences (73 in 9 files), but debt unrelated to v5 (pinned to 4.1.15, `ts-transformer-keys`, a direct `request` import, `@types/node` 18) would blur the cost of the procedure. Last |

Each repo goes through four stages, one PR each:

| Stage | Goal | Behaviour |
| --- | --- | --- |
| A | install v5, compile, test, run the harness; **keep** `src/cores/` | the copy keeps its v4 semantics (sync on, save on error, `domain` checks). Root-level v5 changes apply (section 3) |
| B | delete `src/cores/`, use the v5 root | switches on the § 11 contracts the copy hid |
| C | trust boundary and deploy, with the deploy lane | signatures, `enforce`, runtime |
| D | `@field()` models (optional) | none |

A alone is deployable. Splitting A and B is the default; putting both in one PR is the repo owner's choice.

## 1. Starting line

| Item | backend | sockets | pushes | socials | iap |
| --- | --- | --- | --- | --- | --- |
| lemon-core pin / installed | `^4.2.3` / none | `^4.2.3` / 4.2.3 | `^4.2.3` / none | `^4.2.3` / none | `^4.1.15` / 4.1.15 |
| `src/cores/` copy | 11 files, 6,320 lines | 6,304 | 6,332 | 6,334 | 6,173 |
| lemon-core import files / occurrences | 93 / 148 | 211 / 253 | 68 / 110 | 77 / 116 | 57 / 93 |
| spec files | 64 | 111 | 36 | 46 | 23 |
| root names used (unique) | 90 | 88 | 84 | 85 | 85 |
| names outside the v4.3.0 list | 0 | 0 | 0 | 0 | 0 |
| `lemon-model` declared | no | `^1.2.2` | no | no | no |
| serverless events | http 24, sqs 1, sns 1, stream 1, cron 1 | http 18 + websocket 4 + the same `backend` | http 20 + the same | http 18 + the same | http 18, no cron |
| `ReportBatchItemFailures` | 0 | 0 | 0 | 0 | 0 |

- All five: `engines.node >=22`, `.nvmrc` 22.15.1, CommonJS, `moduleResolution: node`, TypeScript `^4.7.4` (iap `^4.6.4`), jest 27 (iap 28). Only pushes has a vitest config.
- The cron event is declared with `enabled: false` in the four repos that have it.
- Root names: 102 in the union of the five, 76 common.
- The five copies are practically the same (`diff -bw` against the sockets copy: 0–45 lines per file).
- The copy exports 45 names (iap 44). All but one are also on the v5 root (`MyCoreManager`, `MyCoreService`, `$T`, `onlyDefined`, `AbstractCRUDController`, `OS2Service`, …). Only `$ES6` exists in the copy alone.

## 2. What breaks

Compile and run failures expected with v5:

| Item | backend | sockets | pushes | socials | iap |
| --- | --- | --- | --- | --- | --- |
| removed-name occurrences (without `CoreModel`) | 74 | 70 | 68 | 75 | 68 |
| files with removed names | 8 | 7 | 6 | 8 | 6 |
| `$T.S2` with 3 arguments | 3 | 4 | 7 (`'-'` 2) | 4 | 4 |
| `lemon-core/dist` directory import | 0 | 1 | 0 | 0 | 0 |
| `require('lemon-core/dist/exec-cli')` | 1 | 1 | 1 | 1 | 1 |
| **total / source files to fix** | **78 / 11** | **76 / 11** | **76 / 10** | **80 / 11** | **73 / 9** |

**Removed names: the 11 search names only** (files / occurrences, five repos together):

| Name | Files / occurrences | v5 |
| --- | --- | --- |
| `$ES6` | 30 / 125 | `$OS2` (§ 7.2). Only iap imports the root `$ES6`; the other four use the copy's local `$ES6` built with `_ES6(…)` |
| `Elastic6Option` | 15 / 60 | `OS2BaseOption` (§ 7.1) |
| `Elastic6SearchParams` | 10 / 35 | `OS2SearchParams` (§ 7.1) |
| `Elastic6Service` | 5 / 30 | `OS2CoreService` (§ 7.1) |
| `elasticsearch` | 5 / 25 | `Client` from `@opensearch-project/opensearch` (§ 7.2) |
| `Elastic6Instance` | 10 / 20 | `OS2Instance` (§ 7.2) |
| `_ES6` | 10 / 20 | `_OS2()` (§ 7.2) |
| `Elastic6QueryService` | 5 / 15 | `OS2QueryService` (§ 7.1) |
| `Elastic6Synchronizer` | 5 / 15 | `OS2Synchronizer` (§ 7.1) |
| `Elastic6Item` | 5 / 10 | `OS2Item` (§ 7.1) |

Zero in all five: Redis and Memcached names, `CacheService` (§ 6.1, § 6.3), `EngineType`, `ParsedVersion`, `$U.crypto(`, `dynamostr` (§ 8.3), `getCurrentIdentity$`, `createSyncToElastic6`, `lemon-core/dist/generated` (§ 10.1), `cores/elastic/elastic6-*` deep paths (§ 9.4), direct `lodash`/`ioredis`/`memcached` imports (§ 6).

**Six shared files hold 68 occurrences in every repo.** They came from the template together:

| File | Occurrences |
| --- | --- |
| `src/cores/abstract-services.ts` (copy) | 36 |
| `src/cores/abstract-controllers.spec.ts` (copy) | 9 |
| `src/modules/search/service.ts` | 9 |
| `src/modules/search/api-search.ts` | 5 |
| `src/modules/search/service.spec.ts` | 5 |
| `src/service/backend-service.ts` | 4 |

- Extra files per repo: backend `modules/auth/service.ts` (3) and `modules/clouds/service.ts` (3); sockets `modules/sockets/service.ts` (2); socials `modules/sites/service.ts` (3) and `modules/chats/service.ts` (4). pushes and iap have none.
- The same copy file also has the option fields `docType` (16) and `esVersion` (6), and every repo reads `ES6_INDEX`, `ES6_VERSION`, `OS2_VERSION`, `OS2_DOCTYPE` in 2 files, 6 occurrences (`api/hello-api.ts` and the copy) (§ 7.2, § 7.3).
- `CoreModel` keeps its name (interface → class, § 10.1). Every use is `interface X extends CoreModel` (backend 13, sockets 7, pushes 6, socials 6, iap 4); `new` and `instanceof` are 0. It is expected to compile unchanged.

**`$T.S2` with 3 arguments** (22 in total). v5 `S2` takes 2 (§ 9.3):

| Repo | Occurrences / files | Where | 3rd argument |
| --- | --- | --- | --- |
| backend | 3 / 2 | copy `commons.ts` 2, `modules/auth/oauth2/oauth2-transformer.ts` 1 | `' '` |
| sockets | 4 / 2 | copy `commons.ts` 2, `view/transformer.ts` 2 | `' '` |
| pushes | 7 / 3 | copy 2, `view/transformer.ts` 2, `modules/pushes/proxy.ts` 3 | `' '` 5, `'-'` 2 |
| socials | 4 / 2 | copy 2, `view/transformer.ts` 2 | `' '` |
| iap | 4 / 2 | copy 2, `view/transformer.ts` 2 | `' '` |

- `' '` gives the same result in v5 (white-space collapses to one space). Only the 2 pushes calls with `'-'` change a result: they build an id from a name, and v5 would leave a space where v4 put a hyphen (Stage A, A4).
- `$T.SS(v, def)` with 2 arguments: 0.

**`exec-cli`.** Each `src/index.ts` requires `lemon-core/dist/exec-cli` in its CLI branch (3 or more arguments). The file does not exist in v5. In the 68-repo census, 66 repos have the same branch.

**Directory import (sockets).** `src/lib/broadcast/audience.ts` imports `onlyDefined` from `lemon-core/dist`. TypeScript passes (`moduleResolution: node` ignores `exports`); Node fails at run time with `ERR_PACKAGE_PATH_NOT_EXPORTED` (§ 3).

**Undeclared packages.** v4 lemon-core installed them for the service; v5 does not:

| Package | backend | sockets | pushes | socials | iap |
| --- | --- | --- | --- | --- | --- |
| `lemon-model` | 16 files, undeclared | 20 files, `^1.2.2` | 16, undeclared | 14, undeclared | 11, undeclared |
| `source-map-support` | 1, undeclared | 1, undeclared | 1, undeclared | 1, undeclared | 1, undeclared |
| `@aws-sdk/client-sns` | — | — | 1, undeclared | — | — |
| `@aws-sdk/client-apigatewaymanagementapi` | — | 2 (run-time code), devDependency | — | — | — |
| `aws-lambda` (types), `ws` | — | 2 each, undeclared | — | — | — |
| `request`, `query-string`, `ts-transformer-keys` | — | — | — | — | undeclared (`ts-transformer-keys` exists only in the installed 4.1.15) |

## 3. What changes behaviour

| Item | backend | sockets | pushes | socials | iap |
| --- | --- | --- | --- | --- | --- |
| `$U.ts`/`$U.dt` without timeZone, src (spec) | 15 (10) | 7 (4) | 4 (2) | 4 (1) | 11 (6) |
| `$protocol(` calls in src / files | 16 / 10 | 12 / 9 | 7 / 5 | 9 / 7 | 7 / 4 |
| outgoing protocol targets (services) | 4 | 3 | 0 | 2 | 0 |
| incoming callers (signing pairs) | 2 | 2 (backend, socials) | 2 (backend, sockets) | 2 | 1 |
| `MyCoreManager` subclasses outside the copy / passing `{ enableSync }` | 12 / 0 | 12 / 0 | 10 / 0 | 5 / 0 | 7 / 0 |
| `guardProxy(` outside the copy, occurrences / files | 81 / 15 | 31 / 13 | 22 / 9 | 44 / 11 | 16 / 8 |
| `domain === 'localhost'` checks outside the copy, occurrences / files | 70 / 16 | 11 / 8 | 10 / 6 | 31 / 10 | 6 / 4 |
| outgoing context `domain: 'localhost'`, occurrences / files | 15 / 9 | 2 / 2 | 1 / 1 | 3 / 3 | 1 / 1 |
| `isUseSssion()` calls outside the copy | 1 | 3 | 1 | 1 | 1 |
| `canDo(` outside the copy / overrides (files, copy included) | 0 / 1 | 0 / 1 | 3 / 1 | 6 / 3 | 0 / 1 |
| `x-protocol-context` produced or consumed in src | 0 | 0 | 0 | 0 | 0 |
| `x-lemon-identity` in specs, occurrences / files | 6 / 3 | 16 / 3 | 5 / 2 | 5 / 2 | 5 / 2 |

Protocol call graph (who calls whom):

| Caller → | backend | sockets | pushes | socials | iap |
| --- | --- | --- | --- | --- | --- |
| backend | — | yes | yes | yes | yes |
| sockets | yes | — | yes | yes | — |
| socials | yes | yes | — | — | — |
| pushes, iap | — | — | — | — | — |

**The copy hides B5.** The copy holds the v4 meaning of three contracts: its `MyCoreManager` uses `enableSync ?? true`, its `guardProxy` saves on error, and its admin check trusts `domain === 'localhost'` from the incoming context. While the copy stays, these v5 changes (§ 11.3, § 11.6) do not reach the service. In `warn` mode a host-less call can still carry a context with `domain: 'localhost'`, so the copy keeps that elevation path open (§ 11.2). Deleting the copy (Stage B) brings the work with it: `{ enableSync: true }` on 46 managers (five repos together), 7 `isUseSssion()` calls, and a review of 194 `guardProxy` occurrences.

**Changes that apply already in Stage A.** These come from the lemon-core root, not from the copy:

- `$U.ts()`/`$U.dt()` without a timeZone use 9 instead of 0 (§ 11.8). The table counts include 1 call inside the copy (`abstract-controllers.ts`). If a repo writes UTC into stored keys or external APIs, do the B8 review in the A PR.
- Handlers never reject (§ 11.4). Code never registers its own SQS, SNS or DynamoDB Stream listener (0 in all five; lemon-core's default handling does the work). Without `ReportBatchItemFailures` the returned `batchItemFailures` are ignored, as in v4.
- Proxies accept any 2xx and time out after 25 000 ms (§ 11.5). `throw new Error('200 …')`: 0 in all five.
- A web request with a `host` header never supplies `x-protocol-context` (§ 11.2). No src code produces or reads that header.
- `GeneralAPIController` (§ 11.9): 0 in all five.

**AWS peers (§ 8.1).** Every repo needs at least these, by code use:

| Package | Needed for |
| --- | --- |
| `@aws-sdk/client-lambda`, `@aws-sdk/client-sns`, `@aws-sdk/client-sqs` | `$protocol` (`execute`, `notify`, `enqueue`) |
| `@aws-sdk/client-sns`, `@aws-sdk/client-iam`, `@aws-sdk/client-sts` | `doReportError` |
| `@aws-sdk/credential-providers` | the copy's `asyncCredentials` (local profile) |
| `@aws-sdk/client-kms` | config `*` values, `AWSKMSService`: backend confirmed (2 files); the other four not measured |
| `@aws-sdk/client-s3` | not used (0) |

## 4. Stage A — compile and run with the copy kept

Goal: v5 installed; build, tests and harness pass. The copy stays and keeps its v4 semantics.

| # | Change | Check | Why |
| --- | --- | --- | --- |
| A1 | `package.json`: `"lemon-core": "^5.0.0"`, `"lemon-model": "^5.0.0"` (§ 10.2). Add to `dependencies`: `@aws-sdk/client-lambda`, `@aws-sdk/client-sns`, `@aws-sdk/client-sqs`, `@aws-sdk/client-iam`, `@aws-sdk/client-sts`, `@aws-sdk/credential-providers`, and `@aws-sdk/client-kms` when the config has `*` values (backend: yes). Add `source-map-support`. Per repo: pushes nothing more (`client-sns` is in the list); sockets moves `@aws-sdk/client-apigatewaymanagementapi` to `dependencies` and adds `ws` and `@types/aws-lambda`; iap adds `query-string` and `ts-transformer-keys`, and either declares `request` or moves that call to `fetch` (§ 6, § 6.4). `engines.node` `>=24`, `.nvmrc` 24 (§ 1) | `npm ls lemon-core lemon-model` shows one copy of each (§ 5) | v4 lemon-core installed these; v5 does not (§ 6, § 8.1) |
| A2 | Delete the CLI branch in `src/index.ts` that requires `lemon-core/dist/exec-cli` (with its argument check and usage lines). `lemon-templates-api` did the same in B0 | `grep -rn exec-cli src` → 0 | the file is not in v5 |
| A3 | Search names: replace with table 8 (a). The 6 shared files plus the repo extras (section 2). In the copy, point the local `$ES6` at `$OS2` in its one definition line and keep the uses; iap also changes its root `$ES6` import in `service/backend-service.ts` to `$OS2`. Remove `docType`, `esVersion` and the `ES6_*`/`OS2_VERSION`/`OS2_DOCTYPE` env reads | see below | every removed name is one of the 11 search names (§ 7.1, § 7.2, § 7.3) |
| A4 | `$T.S2` with 3 arguments → 2. Drop a `' '` argument. In pushes `modules/pushes/proxy.ts` keep the `'-'` result (see below) | one spec: the new id equals a stored id | v5 `S2` takes 2 arguments (§ 9.3) |
| A5 | sockets only: `from 'lemon-core/dist'` → `from 'lemon-core'` (`onlyDefined`) | `grep -rn "from 'lemon-core/dist'" src` → 0 | a directory path is not in `exports` (§ 3) |
| A6 | `npx tsc --noEmit`, then `npm test` | both exit 0. If TypeScript 4.7 cannot read the v5 `d.ts`, raise TypeScript | confirms the predicted TS2554 (`S2`) and TS2305 (removed names) were all |
| A7 | Harness (section 9): `LOCAL_MODE: '1'` in the `local` env section (§ 11.3), boot with the repo's local express script (`express.lemon` form), `GET /` and the hello route 200, one `PROTOCOL sign key not set` line | boot median and smoke status codes recorded | same check as the lemon-core bundles |

A3 check (code lines; comments aside, the only hit left is the copy's `$ES6` alias line):

```bash
grep -rnE 'Elastic6|_ES6|\$ES6|elasticsearch|docType|esVersion|ES6_|OS2_VERSION|OS2_DOCTYPE' src
```

A4, the `'-'` case. v4 replaced each white-space run with the delimiter; v5 collapses to one space, so put the hyphen back:

```ts
// v4: $T.S2(v, '', '-')
$T.S2(v, '').replace(/ /g, '-')
```

This differs from v4 only when the value starts or ends with white-space (v4 kept a `-` there). If stored ids can have that, use `` `${v ?? ''}`.replace(/\s+/g, '-') ``, which is the v4 expression.

Peers under `npm link`: a linked lemon-core checkout resolves the SDK packages from its own `node_modules` and hides a missing peer (§ 8.1). Check A1 with a registry or `npm pack` install as well.

## 5. Stage B — remove the copy

Goal: delete the 11 files of `src/cores/` and use the v5 root. The § 11 contracts now apply.

| # | Change | backend | sockets | pushes | socials | iap | Check | Why |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | `../cores` / `../../cores` imports → `lemon-core` (files) | 55 | 118 | 31 | 47 | 23 | `src/cores` gone, `tsc` 0 | 44 of the 45 copy names are on the v5 root |
| | specs importing the copy's `commons.spec` → `lemon-core/testing` (§ 4) | 59 | 74 | 22 | 41 | 1 | | |
| | `$ES6` uses (the alias goes with the copy) → `$OS2` | | | | | | `grep -rn '\$ES6' src` → 0 | |
| B2 | every `MyCoreManager` subclass passes `{ enableSync: true }` | 12 | 12 | 10 | 5 | 7 | `grep -rc "enableSync: true"` = subclass count | v5 default is `false`; without it OS2 sync stops silently (§ 11.6) |
| B3 | `guardProxy` calls take the v5 default (no save on error); pass `{ saveOnError: true }` only where code reads the state fields after the call (occurrences) | 81 | 31 | 22 | 44 | 16 | list in the PR body | § 11.6 |
| B4 | `isUseSssion()` → `isUseSession()` | 1 | 3 | 1 | 1 | 1 | `grep -rn isUseSssion src` → 0 | removed alias (§ 9.2) |
| B5 | `domain === 'localhost'` checks → `$U.isLocalMode()` (local-only path) or a role check (elevation); note which for each call | 70 | 11 | 10 | 31 | 6 | `grep -rn localhost src` = logs and URLs only | `domain` grants nothing in v5 (§ 11.3) |
| | outgoing context `domain: 'localhost'` → claim the role (§ 11.3) | 15 | 2 | 1 | 3 | 1 | | |
| B6 | `$X` (`view/transformer.ts`, a local `$T` variant, all five) → `$T` (files using it) | 5 | 1 | 3 | 1 | 3 | specs for the `B`/`BN`/`N`/`F` differences | same clean-up as `lemon-templates-api` (§ 9.5) |
| B7 | `canDo` overrides (files, copy included): align with the v5 `sid` rule; change only an override that opens update/delete of `sid`-less records | 1 | 1 | 1 | 3 | 1 | same case as the `abstract-services.spec` `canDo` spec | § 11.7 |
| B8 | `$U.ts`/`$U.dt` without timeZone (src calls): pass `0` where UTC is expected (stored keys, external API times). A log-only `$U.ts()` (such as in `api/crons-api.ts`) can stay | 15 | 7 | 4 | 4 | 11 | KST/UTC decision table per call | +9 h (§ 11.8) |
| B9 | rerun A6 and A7, plus an identity check on an echo route (`/hello/echo` form): the same identity with and without a forged `x-protocol-context` header | | | | | | values recorded | same as the B5 gate (`docs/v5/B5-trust-boundary.md`, coordinator rerun) |

B2 in code. backend already passes an options object in 3 subclasses; add the flag there.

```ts
super('pet', parent, $FIELD.pet, { enableSync: true });
```

B5, outgoing context. The call is signed, so the claim is trusted (full snippet in § 11.3):

```ts
const roles: string[] = [...(identity?.roles ?? []), 'admin'];
const context = this.proxy.asNextContext(null, { identity: { ...identity, roles } });
```

Start with sync on for every manager: the copy's default was `true`. Turning it off for a model is a separate decision per model.

## 6. Stage C — trust boundary and deploy

With the deploy lane. The Lambda runtime, `ReportBatchItemFailures` and the distribution of `PROTOCOL_SIGN_KEY` are deploy-lane work, not service code.

| # | Change | Check | Owner | Why |
| --- | --- | --- | --- | --- |
| C1 | one install-wide `PROTOCOL_SIGN_KEY` (config `*` value); leave `PROTOCOL_VERIFY` unset (= `warn`) | no `PROTOCOL sign key not set` line at boot; count `PROTOCOL unsigned` lines | deploy lane (key distribution) | § 11.1 |
| C2 | signing pairs: a v5 caller signs. pushes is called by backend and sockets; sockets by backend and socials (graph in section 3). Stay in `warn` until all five are on v5 | record when `PROTOCOL unsigned` reaches 0 | service owners | `enforce` in a mixed state rejects v4 callers |
| C3 | SQS and stream event sources: `FunctionResponseTypes: [ReportBatchItemFailures]` (serverless `functionResponseType`), only if partial retry is wanted. Then confirm the listeners are idempotent (DoU uses lemon-core's default listeners only) | deploy-lane PR | deploy lane | § 11.4. Without it behaviour equals v4 |
| C4 | Lambda runtime `nodejs24.x` (the `custom` profile value) | deploy-lane PR | deploy lane | § 1 |
| C5 | after Stage B in all five and `PROTOCOL unsigned` at 0: `PROTOCOL_VERIFY=enforce` | the boot line and one `403` probe | deploy lane + owners | ends the transition (§ 11.1) |

## 7. Stage D — `@field()` models (optional)

`CoreModel` compiles unchanged through `interface X extends CoreModel` (section 2). Converting to `@field()` is per model and not needed for v5: `field` and `fieldsOf` from `lemon-model`, `declare` on narrowed redeclarations, a parity spec with set comparison (§ 10.3, § 10.4). backend, sockets, pushes and socials have devkit `fields:*` scripts; remove them when `src/generated/field-registry` has no entry left (§ 10.1). Priority: P2.

## 8. Replacement tables

**(a) Search names, options, env (A3).**

| v4 (used in DoU) | v5 | HOW_TO |
| --- | --- | --- |
| `$ES6` (copy local = `_ES6(…)`), root `$ES6` (iap) | `$OS2` / `_OS2()` | § 7.2 |
| `Elastic6Service` | `OS2CoreService` | § 7.1 |
| `Elastic6QueryService` | `OS2QueryService` | § 7.1 |
| `Elastic6Synchronizer` | `OS2Synchronizer` | § 7.1 |
| `Elastic6Instance` | `OS2Instance` | § 7.2 |
| `Elastic6Option` | `OS2BaseOption` (`docType`, `version` removed) | § 7.1 |
| `Elastic6SearchParams` | `OS2SearchParams` | § 7.1 |
| `Elastic6Item` | `OS2Item` | § 7.1 |
| `elasticsearch` (module re-export) | `import { Client } from '@opensearch-project/opensearch'` | § 7.2 |
| `docType` (16), `esVersion` (6) | removed | § 7.3 |
| env reads `ES6_INDEX`, `ES6_VERSION`, `OS2_VERSION`, `OS2_DOCTYPE` (`api/hello-api.ts`, copy) | `OS2_INDEX` only | § 7.2 |

**(b) Paths.**

| v4 | v5 | Stage | HOW_TO |
| --- | --- | --- | --- |
| `require('lemon-core/dist/exec-cli')` | delete the branch | A2 | — |
| `from 'lemon-core/dist'` | `from 'lemon-core'` | A5 | § 3 |
| `success`, `notfound`, `failure` from `lemon-core/dist/cores/lambda/lambda-wss-handler` | the root if the names are there; otherwise keep until v6 (`./dist/*` transition) | sockets, after B | § 3 |
| `lemon-core/dist/environ` (`loadProfile`, default) | keep (listed path) | — | § 3 |
| `../cores/*` | `lemon-core` / `lemon-core/testing` | B1 | § 4 |

**(c) Functions and options.**

| v4 | v5 | HOW_TO |
| --- | --- | --- |
| `$T.S2(v, def, delim)` | `$T.S2(v, def)` (+ `replace` for a non-space delimiter) | § 9.3 |
| `isUseSssion()` | `isUseSession()` | § 9.2 |
| manager `super(…)` | `super(…, { enableSync: true })` | § 11.6 |
| `guardProxy(ctx, cb)` | `guardProxy(ctx, cb, { saveOnError: true })` where needed | § 11.6 |
| `domain: 'localhost'` in an outgoing context | `roles: [...roles, 'admin']` claim | § 11.3 |
| `$U.ts()` expecting UTC | `$U.ts(undefined, 0)` | § 11.8 |
| `$X` | `$T` | § 9.5 |

**(d) sockets extras (second repo).** See section 10.

## 9. Harness verification (A7, B9)

- Link the lemon-core working copy with `npm link` until `lemon-core@^5.0.0` is published, then use the pin. Check peers without the link too (§ 8.1).
- Env: add only `LOCAL_MODE: '1'` to the `local` section of the repo's env file. Do not read, copy or record any other value.
- Gate values: boot median (seconds), `GET /` 200, the hello route 200, the one `PROTOCOL` line at boot. After B: the echo-route identity is the same with and without a forged `x-protocol-context` (lower and mixed case). One request each on a mock path and a search path, if the repo has them.
- Record status codes and hashes only. Never record boot logs or `GET /` bodies.

## 10. sockets specifics

- Own `LambdaWSSHandler` in `src/libs/wss/wss-agent.ts` (313 lines), registered with `setHandler('wss', …)`. A second handler in `src/libs/wsv2/lambda-wss-handler.ts`. The root `LambdaWSSHandler` and `$lambda.wss` are not used (0). v5 `LambdaHandler` still has `setHandler` and the `wss` type.
- 2 deep imports of `success`, `notfound`, `failure` from `lemon-core/dist/cores/lambda/lambda-wss-handler`: they work through the `./dist/*` transition and stop in v6 (§ 3).
- 1 directory import (`src/lib/broadcast/audience.ts`, `onlyDefined`): A5.
- websocket: 4 routes. The own handler can throw from `packContext`; v5 `LambdaHandler.handle` resolves `{ error }` instead of rejecting (§ 11.4). How API Gateway shows that on `$connect` is not measured. Check one rejected `$connect` in A7 or on a dev stage.
- `lemon-model` `^1.2.2` → `^5.0.0`, otherwise there are two copies. The 4 socket names it imports (`createOwnedWebSocketNetwork`, `WebSocketClosable`, `SocketUnsubscribe`, `NetworkSupportable`) are in the 5.0.0 `d.ts`; behaviour compatibility is not measured.
- `@aws-sdk/client-apigatewaymanagementapi` → `dependencies` (it is run-time code).
- Callers: backend (unicast) and socials (broadcast). They are the signing pair in C2.

## 11. Not measured / open

- `tsc` and jest were not run in any DoU repo. TS2554 (`S2`) and TS2305 (removed names) are predictions from signatures. Whether TypeScript 4.7 reads the v5 `d.ts` (generated by TypeScript 5.9) was checked only by a grep for TS5-only syntax (0). A6 decides.
- The real Lambda runtime value (`custom` profile) and the need for `client-kms` in four repos: env values were not opened. The repo owner checks in A1 and C4.
- websocket `$connect` under never-reject (sockets, section 10).
- `lemon-model` 1.x → 5.0.0 behaviour for the 4 socket names: name presence only.
- Whether B goes into the same PR as A: the repo owner's choice. The default is separate PRs (A alone is deployable).
- Subclass counts come from class declaration lines. A multi-line `super(…)` with options may be missed; the `enableSync` string itself is 0 outside the copy.

## 12. Sources

- "B6 X1·X32 — DoU 5 repo lemon-core 사용 전수와 v5 대조 (2026-10-28)" (vault report: lemon-core use in the five DoU repos, compared with v5).
- "B6 X3 — 소비 repo 68 deep import·제거 이름·런타임 전수 (2026-10-28)" (vault report: deep imports, removed names and runtimes in 68 consumer repos).
- `HOW_TO_UPGRADE_V5.md` § 1, § 3, § 4, § 5, § 6, § 6.1, § 6.3, § 6.4, § 7.1–§ 7.3, § 8.1, § 8.3, § 9.2–§ 9.5, § 10.1–§ 10.4, § 11.1–§ 11.9, § 12.
- `docs/v5/B0-local-harness.md` (the `exec-cli` branch removal and the harness), `docs/v5/B5-trust-boundary.md` (signature, local mode, coordinator rerun).
