# v5 B15 — cross-cloud `cid`, list `view`, internal admin, policy keys

Status: implemented 2026-10-30 on `feat/v5-b15-security` (base `v5` @ `80feba72` = 5.0.7 + docs). Decisions D69–D72, design SPEC § 15 (vault). User-facing changes: `HOW_TO_UPGRADE_V5.md` § 11.7 (B15 paragraph) and § 15.2. Follow-up of `docs/v5/B13-access-policy.md` (policy) and `docs/v5/B14-relay-context-impl.md` (channel, relay).

## Why

B13 made the CRUD defaults safe for a browser caller, and B14 gave every entry a `channel` and a small relay. Four gaps were left: (1) a call from another cloud (AWS account) could not be told apart; (2) the default list was the whole site, and a caller could not ask for "mine" or for an admin list; (3) the policy had no place for the caller state; (4) a protocol (internal) caller lost its session behind a relay (no `userAgent`), so every relayed non-admin got `403 IDENTITY-TOKEN`.

## Terms

- **`cid`**: `IdentityToken.cid`, the cloud-id = the caller's AWS account number. Optional in practice; empty (or `#…`) = the same cloud. **`aid`** stays the auth-id (`AuthModel` id) as in `IdentityToken` and DoU; it is not an account id.
- **Own account**: `context.accountId` — since B14 the receiver's own account (Lambda `invokedFunctionArn`, else the request context).
- **Cross-cloud**: `cid` and `context.accountId` both non-empty and different (`MyCoreProxy.isCrossCloud(context?)`, `isCrossCloud(context)` in `cores/protocol/protocol-relay`). A local non-numeric `accountId` is compared as is (local mode is admin anyway).
- **Internal caller**: `context.channel === 'internal'` (set by the entry, `HOW_TO_UPGRADE_V5.md` § 15.1). An entry without `channel` (cron, dynamo-stream, notification, non-protocol SNS/SQS) is **not** internal.
- **Admin-like**: `hasAdminRole()` (local mode, IAM SigV4, `roles` with `admin`) **or** the internal admin (below). `MyManagerProxy.isAdminLike({ policy, context })`; `canDo`, `packSearchParam` and `doList` use the same rule. `hasAdminRole()` itself is not changed.

## Policy keys and evaluation order

```ts
type AccessPolicy = {
    list: AccessScope; read: AccessScope; create: AccessScope; update: AccessScope; delete: AccessScope; // B13
    internal: 'admin' | 'identity'; // B15 (AccessInternal) - protocol callers, default 'admin'
    cross: 'accept' | 'identity' | 'deny'; // B15 (AccessCross) - cross-cloud callers, default 'accept'
};
```

`DEFAULT_ACCESS_POLICY` = `{ list: 'site', read/create/update/delete: 'owner', internal: 'admin', cross: 'accept' }`. Merge as in B13 (`effectivePolicy()`: default ← `accessPolicy()` ← `policy`, shallow, `undefined` skipped); `CanDoOptions.policy` and `CRUDCreationOptions.policy` take any subset of the 7 keys. An unknown `internal`/`cross` value → `canDo` refuses every action (403), admin included; an unknown scope → 403 as in B13. `internal` and `cross` are caller state, one per policy (per action → a `canDo` override).

`canDo`, session on (not local mode):

1. validate the action (400);
2. merged policy; unknown `internal`/`cross` → 403;
3. `SID_LEGACY_ACCESS=deny` for a `sid`-less update/delete → 403 (B5, unchanged);
4. `hasAdminRole()` → allow;
5. **`cross: 'deny'` and cross-cloud → 403**;
6. **`channel === 'internal'` and `internal: 'admin'` and not (`cross` ≠ `accept` and cross-cloud) → allow**;
7. the session (`getCurrentSession`; under `internal` the identity is the session without `userAgent`) → guest, empty `uid`/`sid` → 403 → the scope of the action (B13).

## Cross-cloud rule (D69)

| `cid` vs own account | `cross: 'accept'` (default) | `cross: 'identity'` | `cross: 'deny'` |
| --- | --- | --- | --- |
| same, empty or `#` | same cloud T-01, T-03 | same cloud | same cloud |
| different, internal caller | internal admin T-04 | evaluated by the identity T-05, T-15 | 403 T-06 |
| different, external caller | evaluated by the identity T-04 | the same | 403 T-06 |
| different, `roles` with `admin` | admin | admin | admin (step 4 runs first) T-06 |

- The relay whitelist gets `cid` and `aid` (`RELAY_IDENTITY_FIELDS`, `RelayIdentity`), so both survive a hop and DoU's `$sess.aid` keeps working behind a relay (T-08, T-10). lemon-core reads them from its own `IdentityToken` type; the lemon-model `NextIdentity.cid?`/`aid?` fields are a separate release.
- `TRACE … cross=1` is appended when the entry context is cross-cloud; the account numbers are never printed (T-09, T-10).
- The transports are same-account today (web invokes a function name, SNS/SQS use own ARNs), so a cross-cloud identity comes from an external JWT with `cid` or a protocol call from another account. Cross-account transport is out of scope.

## Internal admin and the internal session (D72)

- An internal caller under `internal: 'admin'` passes every action of the CRUD defaults (T-11, T-28) and lists through the admin branch of `packSearchParam` (no forced pin, `?sid=`/`?uid=` free, the relayed session site by default, no filter without a session) (T-12, T-19).
- `internal: 'identity'` → the relayed identity is the session and the B13 scopes apply (T-13, T-29).
- `channel` missing (or `external`, `local`) → not internal (T-14). `cross: 'identity'` + cross-cloud → not admin (T-15).
- `getCurrentSession()` returns a non-empty identity as the session when `channel === 'internal'`, even without `userAgent` (normalization as before: `#…` → `null`). Not in local mode, not with `useSession: false` (the session-off `canDo` keeps its old result). An empty relay identity is no session (T-16). `makeModelBase` then stamps the relayed `sid`/`uid`/`gid`.
- The controller `makeModelBase` and `doPutBulk` treat the internal admin like admin (no `403 IDENTITY-TOKEN` for a protocol call without identity).
- `hasAdminRole()` is unchanged: `GET /<type>/<id>/admin`, `fields/admin` and DoU `hasAdminRole('owner')` gates keep their rules (T-28).

**Trust note.** When `PROTOCOL_VERIFY` is not `enforce` (`off` without a key, `warn` with one), a relay, a legacy `x-protocol-context` or a host-less JSON identity is accepted unsigned as `internal`. "internal = admin" removes even the `roles: ['admin']` claim requirement on that path: the only trust left is the IAM `lambda:InvokeFunction` permission. Recommendation: install the C1 key and switch to `PROTOCOL_VERIFY=enforce` (`HOW_TO_UPGRADE_V5.md` § 13.4); until then, narrow with `policy: { internal: 'identity' }`. The default stays `'admin'` (owner decision, D72).

## List `view` (D70)

`doList` with the session on only. `?view=` is split off the query before `bodyToModel`/`packSearchParam`, so it is never a filter (session on, off and local mode) (T-27). An empty `?view=` is no view.

| `view` | non-admin | admin (role, IAM, internal admin) | pin | Spec |
| --- | --- | --- | --- | --- |
| (none) | = `mine` | = `admin` | — | T-19 |
| `mine` | ✔ | ✔ | `sid` + `uid` of the session, `?uid=` ignored; no session → `403 … list[owner] needs session .sid` | T-20 |
| `group` | ✔ if `policy.list` ≥ `group`, else 403 | ✔ | `sid` + `gid` (`?uid=` narrows) | T-21 |
| `site` | ✔ if `policy.list` ≥ `site`, else 403 | ✔ | `sid` (`?sid=` ignored, `?uid=` narrows) | T-22 |
| `admin` | `403 NOT ALLOWED - view[admin] needs admin` | ✔ | none forced: `?sid=`/`?uid=` free (`0` = session value), else the session site; no session → no filter (B13 admin list, unchanged) | T-23 |
| other | `resolveListView(view, $ctx)` → a scope or `'admin'`, else `400 INVALID - view[<v>] is invalid @resolveListView(<type>)` | same | as returned | T-24, T-26 |

- Order: the B13 caller check `canDo('list')` (guest, no session → 403) → resolve the view → the `admin` gate → the ceiling → `packSearchParam(…, { scope, policy, asAdmin })`.
- **Ceiling**: `owner` < `group` < `site` < `any`. `policy.list` (default `site`) is the widest scope a non-admin may ask for; wider → `403 NOT ALLOWED - view[<v>] is over list[<policy.list>] @doList(…)` (T-25). An admin-like caller has no ceiling.
- `packSearchParam` option `asAdmin: false` pins an admin-like caller by `scope` too (used for `mine`/`group`/`site`); it never makes a non-admin admin. A direct `packSearchParam()` call without `asAdmin` keeps the B13 behaviour (default scope `policy.list`).

## Old → new

| Point | Before (B13/B14) | B15 |
| --- | --- | --- |
| default list of a non-admin | `policy.list` (= `site`) | `view` default `mine` = `owner` (`sid` + `uid`); `policy.list` is the ceiling; the site list is `?view=site` |
| admin list | own site, `?sid=` optional | `view=admin` default = the same; a non-admin `view=admin` → 403 |
| `?view=` | a filter only when the model has a `view` field (none known) | reserved, never a filter |
| internal caller | evaluated by its identity (relay → no session → 403) | admin by default; `internal: 'identity'` → by the relayed identity |
| `getCurrentSession` under `internal` | `null` without `userAgent` | the identity |
| relay whitelist | `sid uid gid roles identityId lang` | + `cid`, `aid` |
| cross-cloud | no notion | `cid` ≠ own `accountId` → cross; default accept; `TRACE … cross=1` |
| `AccessPolicy` | 5 keys | 7 keys (`internal`, `cross`) |
| session off, local mode | — | unchanged |

B13 expectations updated for the new default view (each marked `// B15 § 15.5` in the spec): the `DEFAULT_ACCESS_POLICY` shape (7 keys) and the non-admin `doList` default of B13 T-07, T-12, T-16, T-33 (now `sid` + `uid`; the old `site` result is asserted with `view: 'site'` next to it).

## Override examples

```ts
// a DoU-style view: `public` = the site list, `all` = the admin list (the gates still apply)
class PetsController extends AbstractCRUDController<…> {
    protected resolveListView(view: string, $ctx: NextContext): AccessScope | 'admin' {
        if (view === 'public') return 'site';
        if (view === 'all') return 'admin';
        return super.resolveListView(view, $ctx);
    }
}

// protocol callers by their relayed identity (until PROTOCOL_VERIFY=enforce)
super('pets', service, service.$pet, transformer, { useSession: true, policy: { internal: 'identity' } });

// refuse callers from another cloud
super('pets', service, service.$pet, transformer, { useSession: true, policy: { cross: 'deny' } });
```

**DoU (B6).** v4 DoU `view=public` (session off) and `?userId=` (replace the session uid for `mine`) are not core views: restore them with `resolveListView()` and a `canDo` override. DoU's "a non-admin `view=admin` silently lists its own rows" is now **403** in the core.

## Public surface

- New root names: `AccessInternal`, `AccessCross` (types). `etc/api-names.allow.txt` has the 2 lines.
- New members: `MyCoreProxy.isCrossCloud()`, `MyCoreProxy.isInternalAdmin()`, `MyManagerProxy.isAdminLike()`, `packSearchParam` options `policy?`/`asAdmin?`, `AbstractCRUDController.resolveListView()`, `listScopeOf()`, `isAdminLike()` (protected); deep module `cores/protocol/protocol-relay`: `isCrossCloud()`, `RelayIdentity.cid?`/`aid?`.
- No new env name.
- Type change: `AccessPolicy` requires the 7 keys, so an `accessPolicy()` override that returns a 5-key literal no longer compiles — spread `super.accessPolicy()` (as in B13's example) or `DEFAULT_ACCESS_POLICY`. At run time missing keys fall back to the default (the merge starts from `DEFAULT_ACCESS_POLICY`).

## Files

| File | Change |
| --- | --- |
| `src/extended/cores/abstract-services.ts` | `AccessInternal`, `AccessCross`, 7-key `AccessPolicy`/`DEFAULT_ACCESS_POLICY`; `isCrossCloud`, `isInternalAdmin`, `isAdminLike`; `canDo` steps 2, 5, 6; `packSearchParam` `policy`/`asAdmin`; `getCurrentSession` internal branch |
| `src/extended/cores/abstract-controllers.ts` | `doList` `?view=` (`resolveListView`, `listScopeOf`), admin-like `makeModelBase`/`doPutBulk` |
| `src/cores/protocol/protocol-relay.ts` | `cid`/`aid` in the whitelist, `isCrossCloud()`, `TRACE … cross=1` |
| `src/extended/cores/abstract-services.spec.ts` | B15 T-01..T-07, T-11..T-18 |
| `src/cores/protocol/protocol-relay.spec.ts` | B15 T-08..T-10 |
| `src/extended/cores/abstract-controllers.spec.ts` | B15 T-19..T-30 |
| `etc/api-names.allow.txt` | `+AccessInternal`, `+AccessCross` |
| `HOW_TO_UPGRADE_V5.md` | § 11.7 B15 paragraph, § 15.2 whitelist |
| `CHANGELOG.md`, `README.md` | unreleased entry; docs index row |

## Gates (2026-10-30, local)

| Gate | Base `v5` @ `80feba72` | B15 |
| --- | --- | --- |
| `npm test` (`LS=1`) | 63 files, 826 passed | 63 files, 871 passed in 2 runs (+45: 12 handler cases, 3 relay cases, 15 `canDo`/`packSearchParam`/`getCurrentSession` cases that run in both spec files) |
| `npm run build` | ok | ok |
| `npm run api:check` | not-allowed=0 | base=304 current=306 added=24 removed=22 allow=46 not-allowed=0 (+2 names: `AccessInternal`, `AccessCross`) |
| `npm run esm:smoke` | names=141 | ok names=141 subpaths=4 (the two new names are types, not runtime names) |
| `npx tsc --noEmit`, `npx eslint`, `npx prettier --check` (changed `.ts`) | — | 0 errors, no new warning |
| `npm audit --omit=dev` | 0 | found 0 vulnerabilities |
