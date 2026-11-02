# v5 B39 — public rows and guest callers

Status: implemented 2026-11-02 on `feat/v5-b39-public-rows` (base `v5` @ `e3424d45` = 5.0.22). Decision D105 (rules h and h′, a revision of D67 "session off unchanged", adopted by the owner 2026-11-02), design SPEC § 39.1 (vault), facts § 39.2 (I-1 guest token, I-3 `uid: ''` storage, V1 session-off IAM caller). User-facing changes: `HOW_TO_UPGRADE_V5.md` § 11.7 (B39 paragraph). Follow-up of `docs/v5/B13-access-policy.md` and `docs/v5/B15-security.md`.

## Why

Owner decision (2026-11-02): a caller whose `uid` is empty is a **guest**, and a row whose `uid` is empty is **public**; public rows appear in a list **only for admin**. Under B13 both were "admin only": an empty-`uid` caller got `403` on every action (from the `.uid (user-id) is required!` throw before `canDo`), and an empty-`uid` row could be read by admin only. B39 opens one thing — reading public rows in reach — and keeps them out of every non-admin list.

## Terms

- **Session `S`**: `{ sid, uid, gid, roles }` after `getCurrentSession()` normalization: a `#…` `sid`/`uid` → `null`, absent/`null`/`''` → `''`. **Row `M`**: the stored `{ sid, uid }` as it is (absent and `''` are "empty"; a stored `''` is DynamoDB `NULL` and reads back as `''`, I-3).
- **Guest caller** (rule a): a session (`identity` present) with empty `roles` **or** an empty `uid` (absent, `''`, `#…`). `MyManagerProxy.isGuestSession(S)`. A DoU guest token (`roles: ['guest']`, its own `uid`, I-1) is **not** a B39 guest — it is a member.
- **Member**: `roles` not empty, `sid` and `uid` not empty.
- **Public row** (rule b): `sid` not empty and `uid` empty. `MyManagerProxy.isPublicModel(M)`. A `sid`-less row is **not** public — `SID_LEGACY_ACCESS` (D47) decides as before.
- **`public` policy key** (rule f, 8th key, `AccessPublic`): `'site'` (default) = public rows of the caller's `sid`; `'any'` = public rows of every site; `'none'` = B13 (admin only). `MyManagerProxy.isPublicVisible(mode, S, M)`; an unknown value reaches nobody.

## Rules (session on, not local mode)

`T-nn` is the spec id: each id is an `it('B39 T-nn …')` in `src/extended/cores/abstract-services.spec.ts` (`describe('abstract-services B39 public rows')`, all 16) and, for T-03…T-10, T-13, T-14 and T-16, in `src/extended/cores/abstract-controllers.spec.ts` (`describe('AbstractCRUDController B39 public rows')`, through the handlers).

| Caller | list | read public row (same `sid`) | read public row (other `sid`) | read private row | create | update / delete public row |
| --- | --- | --- | --- | --- | --- | --- |
| admin (incl. IAM SigV4) | ✔ public rows included T-10 | ✔ | ✔ | ✔ | ✔ | ✔ T-08 |
| member | ✔ public rows **excluded** T-10 | ✔ T-07 (was ✘) | ✘ `site` · ✔ `any` T-07 (or by the scope, ex: `read: 'any'`) | B13 scope | B13 scope | ✘ 403, any scope T-08 |
| guest — empty `uid` (NOUID, `#…`) | ✘ 403 T-06 | ✔ T-03 (was ✘) | ✘ `site` · ✔ `any` T-05 | ✘ 403 T-04 | ✘ 403 T-06 | ✘ 403 T-06 |
| guest — empty `roles` | ✘ 403 T-06 | ✔ T-03 (was ✘) | ✘ `site` · ✔ `any` T-05 | ✘ 403 T-04 | ✘ 403 T-06 | ✘ 403 T-06 |
| `public: 'none'` (member or guest) | as above | ✘ 403 T-09 (B13) | ✘ 403 T-09 | as above | as above | B13 scope for a member (T-09); guest ✘ |
| empty `sid` (offsite `#`) | ✘ 403 (rule g, before the guest check) | ✘ | ✘ | ✘ | ✘ | ✘ |

`canDo` order (session on; **bold** = B39):

| Step | Condition | Result |
| --- | --- | --- |
| 1 | unknown `internal`/`cross` | 403 |
| 2 | `sid`-less update/delete + `SID_LEGACY_ACCESS=deny` | 403 |
| 3 | `hasAdminRole()` | allow |
| 4 | `cross: 'deny'` + cross-cloud | 403 |
| 5 | internal admin | allow |
| 6 | no session (`getCurrentSession` throws on no identity / empty `sid`) | `403 IDENTITY-TOKEN` |
| 7 | `S.sid` empty (`#…` → `null`) | `403 NOT ALLOWED` |
| **8** | **guest**: `read` ∧ public row ∧ in reach (`public`) → allow, else `403 NOT ALLOWED` | T-03…T-06 |
| 9 | `list` without a row | allow (caller check); `doList` pins and adds `excludePublic` |
| **10** | **public row + member** (`public` ≠ `'none'`): `read` in reach → allow; `update`/`delete` → 403; otherwise to step 11 | T-07, T-08 |
| 11 | scope compare (`sid`-less row → `SID_LEGACY_ACCESS`) | B13 (T-12) |

Session off (`useSession: false`, `canDoWithoutSession`):

| Case | Before | B39 | Spec |
| --- | --- | --- | --- |
| order | `getCurrentSession(throwable)` before `hasAdminRole()` | `SID_LEGACY_ACCESS=deny` check → **`hasAdminRole()`** → session (as `canDo`, h′, adopted) | T-14 |
| IAM SigV4 caller (no `sid`), `throwable` | `403 IDENTITY-TOKEN - check x-lemon-identity` (doGet/doPost/doPut/doDelete) | admin, allowed | T-14 |
| no identity, no signature | `403 IDENTITY-TOKEN - .identity …` | unchanged | T-14 |
| any action by an empty caller `uid`, `throwable` (single-row handlers) | `403 IDENTITY-TOKEN - .uid (user-id) is required!` | unchanged — the `.uid` throw stays with the session off (rule j is session on only), so no public row is minted by `create` | T-13 |
| update/delete by an empty caller `uid`, `throwable: false` (bulk) | `''` matched `''` (G8) | 403 (h, adopted) | T-13 |
| list/read/create by an empty caller `uid`, same `sid`, `throwable: false` | allowed (§ 6.4) | unchanged | T-13 |
| `doList` by an empty caller `uid` | no caller check, no pin (B13 T-35) | unchanged (no exclusion either) | T-13 |
| guest (`roles` empty) | 403 | 403 (unchanged) | T-13 |

Lists (rule e): `doList` passes `{ excludePublic: true }` to `manager.list()` when the session is on and the caller is not admin-like — every non-admin view (`mine`, `group`, `site`, and a scope `any` from a `resolveListView()` override). The admin-like caller (any view) and session off keep the public rows. `buildQuery` adds `must: { exists: { field: 'uid' } }`; the DynamoDB scan fallback (`buildScanFilter`) adds `attribute_exists(uid) AND NOT attribute_type(uid, 'NULL')` (T-10, T-11).

## Old → new

| Point | Before (B13/B15) | B39 |
| --- | --- | --- |
| `getCurrentSession({ throwable })` | threw `403 IDENTITY-TOKEN - .uid (user-id) is required!` for an empty `uid` | **session on** (`useSession` not `false`): returns the session (`uid: ''`, or `null` for `#…`); `canDo` decides (T-16). **Session off** (`useSession: false`, the `canDoWithoutSession` call): the `.uid` throw stays (T-13). `.identity`, `check x-lemon-identity` and `.sid` throws unchanged |
| member read of a public row of its site | 403 (`owner` never matches an empty `uid`) | allowed |
| guest read of a public row in reach | 403 | allowed |
| public row update/delete by a member | 403 under `owner`; allowed under `update: 'site'`/`'any'` | 403 under every scope (admin only) |
| non-admin list | public rows of the pinned site included (`site`/`group` views) | excluded (all views) |
| `DEFAULT_ACCESS_POLICY` | 7 keys | 8 keys (`public: 'site'`) |
| session off: admin order, empty-`uid` writes | session first; `''` matched `''` | admin first; empty `uid` never updates/deletes |
| `packSearchParam` (non-admin, session on) | an empty `uid`: `403 IDENTITY-TOKEN - .uid …` with `throwable`, else listed under `site`/`group`/`any` | a guest → `403 NOT ALLOWED - list[<scope>] needs session .uid` (`.roles` for empty roles), after the `.sid` check |

Changed existing assertions (each with a comment in the spec):

| Spec | `it` | Old → new | Reason |
| --- | --- | --- | --- |
| `abstract-services.spec.ts` (runs in both spec files) | `B13 § 14.1 DEFAULT_ACCESS_POLICY and effectivePolicy()` | 7 keys → 8 keys (`public: 'site'`) | rule f |
| same | `B13 T-20 NOUID (empty or `#` uid) → 403 for every action` | `_all($.hashUid, { …ROW, uid: '' })` NONE → `{ …NONE, read: true }`; `_can($.nouid, 'read', ROW, { throwable })` message `403 IDENTITY-TOKEN - .uid (user-id) is required!` → `403 NOT ALLOWED - action[read] is invalid @canDo(read:test/1000001)` | rules c and j |
| same | `B13 T-24 a row with an empty uid → read/update/delete admin only` | OWN `read` false → true; update/delete still false | rule d |
| `abstract-controllers.spec.ts` | `B13 T-24 a row with an empty uid → admin only` | OWN `doGet` `403 NOT ALLOWED - action[read]` → the row | rule d |

No B13 T-20 (handlers), T-22, T-35, B15 T-18 or B18 assertion changed: their outcomes are the same (a private row stays 403 for a guest; the `.uid` message was asserted only in the services T-20).

## "How" decisions

| Decision | Reason |
| --- | --- |
| Helpers are public methods of `MyManagerProxy` (`isGuestSession`, `isPublicModel`, `isPublicVisible`), not root functions | a service `canDo` override reuses them with `this.`; no new root name besides `AccessPublic` |
| `isGuestSession` also treats a raw `#…` `uid` as empty | T-01 asserts `#u1` → guest; the same rule as the `getCurrentSession()` normalization, so the result does not depend on whether the caller normalized first |
| `AccessPolicy.public` is optional in the type | services building a 7-key `AccessPolicy` literal still compile; the merged policy always has `site` |
| an unknown `public` value is not refused at step 1 (unlike `internal`/`cross`) | it fails closed by itself: `isPublicVisible` is false (guest denied, member falls to the scope compare), update/delete of public rows stays 403 |
| member read of a public row **out of reach** falls to the scope compare (not a hard 403) | keeps every B13 cell outside SPEC § 39.1 "바뀌는 셀" unchanged: with `read: 'any'` a member still reads another site's public row, as in B13 |
| member update/delete of a public row → 403 before the scope compare | rule d (explicit branch): `update: 'site'`/`'any'` does not open it |
| `create` is not a public-row action | the controller stamps the session `uid` on create, so a member never creates a public row; a guest is refused at step 8 |
| the `.uid` throw is removed only when `getCurrentSession` is called with the session on (`useSession !== false`) | rule j exists to reach the `canDo` guest step; with the session off, read/create stay as before (h) and an empty-`uid` caller must not `create` rows with an empty `uid` (= mint public rows). `canDoWithoutSession` passes `useSession: false`; `packSearchParam` does not call `getCurrentSession` with the session off |
| session-off empty `uid` (no throw, `throwable: false`): only update/delete is refused; a `sid`-less row with `SID_LEGACY_ACCESS=open` keeps the v4 rule | rule h names update/delete only; `SID_LEGACY_ACCESS` meaning is not changed (SPEC "하지 않는 것") |
| OpenSearch exclusion is one term (`must exists(uid)`) | a stored `''` is DynamoDB `NULL` and the stream sync sends `null`, which OS does not index (I-2: 0 literal `''` docs) |
| scan exclusion uses a new `DynamoScanFilter` condition `{ key, attrType }` → `attribute_type(#k, :k0)` | the scan builder had no `attribute_type`; `exists` alone does not exclude a `NULL` attribute. The value is the string `'NULL'` (DocumentClient marshals it to `{ S: 'NULL' }`) |
| `doList` passes the third `list()` argument only when excluding; `list()` passes the second `buildScanFilter()` argument only when excluding | existing overrides and spies see the same calls as before for admin and session off |
| `packSearchParam` guest check comes after the `.sid` check and inside the scope branches | keeps the B13/B18 messages (`needs session .sid`, `list[<unknown>] is invalid`, `needs session .uid` under `owner`) |

## Files

| File | Change |
| --- | --- |
| `src/extended/cores/abstract-services.ts` | `AccessPublic`, `AccessPolicy.public?`, `DEFAULT_ACCESS_POLICY.public = 'site'`; `getCurrentSession` without the `.uid` throw with the session on (kept with `useSession: false`); `isGuestSession`, `isPublicModel`, `isPublicVisible`; `canDo` steps 7, 8, 10; `canDoWithoutSession` admin first + empty-`uid` writes; `packSearchParam` guest check; `buildQuery`/`buildScanFilter`/`list` option `excludePublic` |
| `src/extended/cores/abstract-controllers.ts` | `doList` passes `{ excludePublic: true }` for a non-admin with the session on |
| `src/cores/dynamo/dynamo-scan-service.ts` | `DynamoScanFilter` condition `{ key, attrType }` → `attribute_type()` |
| `src/extended/cores/abstract-services.spec.ts` | `describe('abstract-services B39 public rows')` T-01…T-16; 3 B13 `it` updated (above) |
| `src/extended/cores/abstract-controllers.spec.ts` | `describe('AbstractCRUDController B39 public rows')` T-03…T-10, T-13, T-14, T-16; B13 T-24 updated |
| `etc/api-names.allow.txt` | `+AccessPublic` |
| `HOW_TO_UPGRADE_V5.md` § 11.7, `CHANGELOG.md`, `README.md`, `docs/v5/B13-access-policy.md` | B39 paragraph, unreleased entries, docs index row, "→ B39" marks |
| `docs/v5/B39-public-rows.md` (this file) | new |

## Spec ids

| id | Assertion |
| --- | --- |
| T-01 | `isGuestSession`: `roles` empty / `uid` absent / `''` / `null` / `#u1` → true; member and DoU guest (`roles: ['guest']`, own `uid`) → false |
| T-02 | `isPublicModel`: `sid` + `uid` absent/`''`/`null` → true; `sid` empty or `uid` set → false; `isPublicVisible` per mode |
| T-03 | guest read of a same-`sid` public row → allow |
| T-04 | guest read of a private row → `403 NOT ALLOWED` |
| T-05 | guest read of another site public row → 403 (`site`) / allow (`any`) |
| T-06 | guest list/create/update/delete → 403 (public row or not); `packSearchParam` refuses a guest |
| T-07 | member read of a same-`sid` public row → allow; another site → 403 (`site`) |
| T-08 | member update/delete of a public row → 403 under `owner`/`site`/`any`; admin and IAM → allow |
| T-09 | `public: 'none'` → member and guest public read 403 (B13) |
| T-10 | `list(…, { excludePublic })` (service) and `doList` (handlers): non-admin `mine`/`group`/`site` body has `must exists(uid)`; admin (no view, `admin`, `mine`), IAM and session off have none |
| T-11 | `buildQuery` body with and without the option; `buildScanFilter` → `… AND attribute_exists(#uid) AND NOT attribute_type(#uid, :uid0)` with `:uid0 = 'NULL'`; no option → unchanged |
| T-12 | a `sid`-less row is never public — `SID_LEGACY_ACCESS` `admin`/`open`/`deny` results as B13 T-25…T-27 |
| T-13 | session off: empty caller `uid` with `throwable` → `403 IDENTITY-TOKEN - .uid (user-id) is required!` on every action/handler (unchanged); `throwable: false` (bulk) update/delete 403 (h), list/read/create as § 6.4; `doList` unchanged |
| T-14 | session off: IAM SigV4 (`throwable: true`) → admin; no identity → `403 IDENTITY-TOKEN` |
| T-15 | `DEFAULT_ACCESS_POLICY.public === 'site'`; `policy` overrides `none`/`any` |
| T-16 | `getCurrentSession({ throwable })`, session on: `uid` empty → `{ …, uid: '' }` (`#…` → `null`); `sid` empty and no identity keep the throws |

## Gates (2026-11-02, local)

| Gate | Base `v5` @ `e3424d45` | B39 |
| --- | --- | --- |
| `npm test` (`LS=1`) | 113 files, 1616 passed | 113 files, 1659 passed in 2 runs (+43: 16 service cases that run in both spec files, 11 handler cases). `abstract-services.spec.ts` 67 → 83, `abstract-controllers.spec.ts` 130 → 157 |
| `npm run build` | ok | ok |
| `npm run api:check` | not-allowed=0 | base=304 current=307 added=25 removed=22 allow=47 not-allowed=0 (+1 name `AccessPublic`, a type) |
| `npm run esm:smoke` | ok | ok names=141 subpaths=5 (unchanged: `AccessPublic` is not a runtime name) |
| `npx tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | — | 0 errors, 105 warnings (none on a B39 line); `--fix` changed no file |
| `npm audit --omit=dev` | — | found 0 vulnerabilities |
| `npm audit` (all) | 15 moderate | 15 moderate, all dev-only `minimatch <11.0.1` (GHSA-g3hv-75wg-m249, no fix), present on the base; `--omit=dev` 0 (`package.json` / `package-lock.json` unchanged) |
