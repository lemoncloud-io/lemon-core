# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## Unreleased (5.x)

### Repository

* **B17 repository hygiene** (`docs/v5/B17-repo-hygiene.md`): `.travis.yml` removed (last changed 2022-02, nothing in the repo runs or references it; its Codecov token stays in git history and must be rotated by the owner) and the codecov badge with it; `.github/workflows/docgen.yaml` removed (typedoc, S3 copy and `gh-pages` deploy; the doc scripts went in #225). `CONTRIBUTING.md` gets the `v5` branch flow. No package change.

### Dependencies

* `lemon-model` `5.0.2` → `5.0.3`, exact pin (B17-f): strict consumers of `lemon-core/model` no longer need `skipLibCheck` (lemon-model B17-a fixes TS2411 on `GeneralItem` / `SimpleSearchParam`). No runtime change.

## 5.0.10 (2026-10-30)

### Fixes

* **B16-b resolution shims** (`docs/v5/B16-model-subpath.md` § Resolution shim, `HOW_TO_UPGRADE_V5.md` § 16): physical `model/package.json` and `testing/package.json` (`main`/`types` into `dist/`) so `lemon-core/model` and `lemon-core/testing` resolve for consumers on TypeScript `moduleResolution: node` and Jest 27, which ignore the `exports` map. The `exports` map is unchanged. Consumers remove the `paths` / `moduleNameMapper` lines they added for 5.0.9.

## 5.0.9 (2026-10-30)

### Features

* **B16 sub-path `lemon-core/model`** (`docs/v5/B16-model-subpath.md`, `HOW_TO_UPGRADE_V5.md` § 16): `export * from 'lemon-model'` — every lemon-model name (`field`, `fieldsOf`, `specsOf`, `FIELDS_KEY`, …) through lemon-core, with an ESM wrapper `dist/esm/model.mjs`. The objects are the lemon-model objects; `CoreModel` is the same class as on the root.

### Dependencies

* `lemon-model` pinned to the exact version `5.0.2` (was `^5.0.2`), D73: the lemon-core version fixes the lemon-model version ("the pair"), so one install holds one lemon-model and one `CoreModel` class. Each release names its lemon-model here.

### Consumers

* Do not declare `lemon-model` in a service. The 32 v4 names from `lemon-core`, every other lemon-model name from `lemon-core/model`.
* No root change: the root keeps the 32 v4 lemon-model names (S-06); `api:check` unchanged.

## 5.0.8 (2026-10-30)

* lemon-model `^5.0.2`.

### Behaviour changes

* **B15 security follow-up** (session on only; `docs/v5/B15-security.md`, `HOW_TO_UPGRADE_V5.md` § 11.7 and § 15.2). Session off and local mode are unchanged.
  1. `doList` reads `?view=`: no view = `mine` (`sid` + `uid`) for a non-admin (was the `site` list; ask `?view=site`), `admin` for an admin-like caller (the B13 admin list). `mine` · `group` · `site` · `admin`; other values → `400 INVALID - view[…] is invalid` unless `resolveListView()` is overridden.
  2. `policy.list` is the widest scope a non-admin may ask for (`owner` < `group` < `site` < `any`; wider → 403); a non-admin `view=admin` → `403 NOT ALLOWED - view[admin] needs admin`.
  3. `?view=` is reserved and never reaches `packSearchParam` as a filter.
  4. A protocol caller (`context.channel === 'internal'`) is admin for the CRUD defaults (`policy.internal: 'admin'`, default); `internal: 'identity'` evaluates it by the relayed identity. An entry without `channel` is not internal. `hasAdminRole()` is unchanged.
  5. `getCurrentSession()` returns the identity as the session under `channel: 'internal'` without `userAgent` (relayed users are no longer `403 IDENTITY-TOKEN`).
  6. The relay whitelist gets `cid` and `aid`.
  7. Cross-cloud (`identity.cid` ≠ own `context.accountId`): `policy.cross` `'accept'` (default), `'identity'`, `'deny'` (403); the `TRACE` line gets ` cross=1`.
  8. `AccessPolicy` / `DEFAULT_ACCESS_POLICY` have 7 keys (`internal: 'admin'`, `cross: 'accept'`); an unknown `internal`/`cross` value → 403.

### Features

* Root types `AccessInternal`, `AccessCross`; `MyCoreProxy.isCrossCloud()` / `isInternalAdmin()`, `MyManagerProxy.isAdminLike()`, `packSearchParam` options `policy`/`asAdmin`, `AbstractCRUDController.resolveListView()` (protected).

## 5.0.7 (2026-10-30)

* Re-publish of 5.0.6 (same source).

## 5.0.6 (2026-10-30)

### Behaviour changes

* **B14 call channel, relay and trace** (`docs/v5/B14-relay-context.md`, `docs/v5/B14-relay-context-impl.md`, `HOW_TO_UPGRADE_V5.md` § 15).
  1. Every entry sets `context.channel` (`external` / `internal` / `local`); `fields/admin` is gated by `channel !== 'external'` instead of `domain`.
  2. Internal hops carry the signed relay `x-lemon-relay` (identity summary + trace) instead of the caller's full context: downstream `$ctx.cookie`, `$ctx.authorization`, `$ctx.clientIp`, `$ctx.domain`, `identity.meta` are `undefined`.
  3. `context.trace` (`tid`, `hop`, `via`, `pid`, `src`) and one `TRACE` log line per entry; `doReportError()` adds `trace`.
  4. Hop cap `PROTOCOL_MAX_HOP` (default 8) → `508 LOOP DETECTED`.
  5. `x-protocol-context` is deprecated: `PROTOCOL_LEGACY_CONTEXT` (`off` default, `send`), `PROTOCOL_LEGACY_ACCEPT` (`warn` default, `accept`, `reject`); `HEADER_PROTOCOL_CONTEXT` `@deprecated`.
  6. lemon-model `^5.0.1` (`NextContext.channel`, `trace`).
* **B13 default data-access policy** of `AbstractCRUDController` (session on only; `docs/v5/B13-access-policy.md`, `HOW_TO_UPGRADE_V5.md` § 11.7). Restore the v5 read rule with `policy: { read: 'site' }`.
  1. A same-site user's `read` of another user's row → 403 (default `read: 'owner'`).
  2. An empty `uid` in the session or the row → 403 for every action (admin excepted).
  3. An offsite session (`sid` empty) `list` → 403 (was: an unfiltered list); `doList` calls `canDo('list')` first.
  4. A `sid`-less row: `read` is admin only like update/delete (`SID_LEGACY_ACCESS=open` keeps v4).
  5. `create` stamps the session `gid` (when the model has none).
  6. Admin is decided before the session: IAM SigV4 callers and `roles: ['admin']` claims pass without `403 IDENTITY-TOKEN`.
  7. `doPostBulk`/`doPutBulk` check every item first and report every denied id (`403 NOT ALLOWED - bulk[<action>] denied ids[…]`); nothing is written on a denial.

### Features

* Root names `AccessScope`, `AccessPolicy`, `DEFAULT_ACCESS_POLICY`; `CanDoOptions.policy`, controller option `policy`, `MyManagerProxy.accessPolicy()` / `effectivePolicy()`, `packSearchParam` option `scope`.


## 5.0.5 (2026-10-30)

* B10: `getHelloArn()` takes a 12-digit account only, own Lambda account first; circular-safe stringify on the error report path; secret header values masked in logs; `PROTOCOL_VERIFY=enforce` runbook and masked decrypted config values in the init log; CLI `lemon-fields-types` (`HOW_TO_UPGRADE_V5.md` § 13.1–§ 13.5).
* `LOCAL_TRANSPORT=mock` opt-in local transport for protocol calls (§ 11.3.1).

## [1.2.0](https://github.com/lemoncloud-io/lemon-core/compare/v1.1.2...v1.2.0) (2019-08-16)


### Bug Fixes

* context null ([5435b9b](https://github.com/lemoncloud-io/lemon-core/commit/5435b9b))
* improve `do_parrallel()` ([1cf5821](https://github.com/lemoncloud-io/lemon-core/commit/1cf5821))
* improve isUpperStr ([ee4a09d](https://github.com/lemoncloud-io/lemon-core/commit/ee4a09d))


### Features

* executeServiceApi() ([113c84a](https://github.com/lemoncloud-io/lemon-core/commit/113c84a))
* kms-service ([0c18c83](https://github.com/lemoncloud-io/lemon-core/commit/0c18c83))
* mod uuid ([bf3deff](https://github.com/lemoncloud-io/lemon-core/commit/bf3deff))
* s3 service ([ef91deb](https://github.com/lemoncloud-io/lemon-core/commit/ef91deb))
* sns-service ([981374a](https://github.com/lemoncloud-io/lemon-core/commit/981374a))
* WSC for web-socket client ([3fd3a15](https://github.com/lemoncloud-io/lemon-core/commit/3fd3a15))
* WSS for web-socket server ([0fc2bad](https://github.com/lemoncloud-io/lemon-core/commit/0fc2bad))


### Tests

* close server ([779d740](https://github.com/lemoncloud-io/lemon-core/commit/779d740))
* optimize test ([891b2e2](https://github.com/lemoncloud-io/lemon-core/commit/891b2e2))



### [1.1.2](https://github.com/lemoncloud-io/lemon-core/compare/v1.1.1...v1.1.2) (2019-08-10)



### 1.1.1 (2019-08-10)


### Bug Fixes

* environ path ([ca2d525](https://github.com/lemoncloud-io/lemon-core/commit/ca2d525))
* node null in parallel ([cab68bb](https://github.com/lemoncloud-io/lemon-core/commit/cab68bb))
* optimize doReportError() ([05f9b70](https://github.com/lemoncloud-io/lemon-core/commit/05f9b70))
* optimize test ([d8ca727](https://github.com/lemoncloud-io/lemon-core/commit/d8ca727))
* test error w/o crendentials ([d0d9984](https://github.com/lemoncloud-io/lemon-core/commit/d0d9984))
* test SQS ([04e7a67](https://github.com/lemoncloud-io/lemon-core/commit/04e7a67))
* type error ([6f01f27](https://github.com/lemoncloud-io/lemon-core/commit/6f01f27))


### Features

* optimize envrion test ([2d02647](https://github.com/lemoncloud-io/lemon-core/commit/2d02647))
* update `lemon-hello-api[#1](https://github.com/lemoncloud-io/lemon-core/issues/1).3.0` ([e0a0173](https://github.com/lemoncloud-io/lemon-core/commit/e0a0173))


### Tests

* **environ:** optimized ([80a6e2b](https://github.com/lemoncloud-io/lemon-core/commit/80a6e2b))
* improve tools ([d95c6ee](https://github.com/lemoncloud-io/lemon-core/commit/d95c6ee))
* optimize express ([21cf2f1](https://github.com/lemoncloud-io/lemon-core/commit/21cf2f1))
