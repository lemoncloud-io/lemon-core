# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
