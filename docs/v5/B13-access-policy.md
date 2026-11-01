# v5 B13 — default data-access policy of `AbstractCRUDController`

Status: implemented 2026-10-30 on `feat/v5-b13-access-policy` (base `v5` @ `90da90ed`). Decision D67, design SPEC § 14 (vault). User-facing changes: `HOW_TO_UPGRADE_V5.md` § 11.7. Builds on the `sid`-less record rule of B5 (`docs/v5/B5-trust-boundary.md` § 5).

## Why

With the session on, the built-in CRUD handlers protected rows by site only: any role holder of the same `sid` could read every row of that site, and an empty `uid` matched an empty `uid`. B13 makes the default safe, close to the request: list the caller's site, read and write only the caller's own rows, admin does everything, everything else is refused. Services override it in code (three levels, below).

## Terms

- **Caller state `S`**: the session `{ sid, uid, gid, roles }` after `getCurrentSession()` normalization (a `sid` or `uid` that starts with `#` is empty). **Row `M`**: the model's `{ sid, uid, gid }`.
- **`AccessScope`**: `owner` (S.sid = M.sid, S.uid = M.uid, S.uid not empty) · `group` (S.sid = M.sid, S.gid = M.gid, S.gid not empty) · `site` (S.sid = M.sid, S.sid not empty) · `any` (every role holder). Every scope needs a role holder (`roles` not empty); a guest gets 403.
- **`AccessPolicy`**: a scope per action `{ list, read, create, update, delete }`. **`DEFAULT_ACCESS_POLICY`**: `list: 'site'`, the other four `'owner'`.
- **admin**: `hasAdminRole()` is true (local mode, an IAM SigV4 caller, or `roles` with `admin`) → every action. Other role names get no special case from the default.

## Rules (default policy, session on, not local mode)

`M` is a normal row with `sid` and `uid`. `T-nn` is the spec id: each id is an `it('B13 T-nn …')` in `src/extended/cores/abstract-controllers.spec.ts` (through the handlers) and, for T-01..T-27 and T-34..T-36, in `src/extended/cores/abstract-services.spec.ts` (`canDo()` / `packSearchParam()` directly).

| Caller | list | read | create | update | delete |
| --- | --- | --- | --- | --- | --- |
| ADM admin role | ✔ all (`?sid=` optional, else own site) T-01 | ✔ T-02 | ✔ T-03 | ✔ T-04 | ✔ T-05 |
| IAM SigV4 caller (no session) | ✔ as admin, no site filter T-06 | ✔ T-06 | ✔ T-06 | ✔ T-06 | ✔ T-06 |
| OWN same sid, same uid | ✔ own site pinned T-07 | ✔ T-08 | ✔ session `sid`/`uid`/`gid` stamped T-09 | ✔ T-10 | ✔ T-11 |
| SITE same sid, other uid | ✔ own site pinned T-12 | ✘ 403 T-13 | ✔ (own row) T-09 | ✘ 403 T-14 | ✘ 403 T-15 |
| OTHER other sid | ✔ own site only (`?sid=` ignored) T-16 | ✘ 403 T-17 | ✔ (own row) T-09 | ✘ 403 T-18 | ✘ 403 T-19 |
| NOUID session `uid` empty (incl. `#…`) | ✘ 403 T-20 | ✘ 403 T-20 | ✘ 403 T-20 | ✘ 403 T-20 | ✘ 403 T-20 |
| NOSID session `sid` empty (offsite `#`) | ✘ 403 T-21 (was: an unfiltered list) | ✘ 403 T-21 | ✘ 403 T-21 | ✘ 403 T-21 | ✘ 403 T-21 |
| GUEST `roles` empty | ✘ 403 T-22 | ✘ 403 T-22 | ✘ 403 T-22 | ✘ 403 T-22 | ✘ 403 T-22 |
| NOSESS no session (Lambda) | ✘ `403 IDENTITY-TOKEN` T-23 | ✘ T-23 | ✘ T-23 | ✘ T-23 | ✘ T-23 |

Special rows (non-admin caller):

| Row `M` | read · update · delete | Note |
| --- | --- | --- |
| empty `uid` (created with the session off, or by an offsite token) | ✘ 403 T-24 | `owner` never matches an empty `uid`. Admin only |
| no `sid` (legacy) | `SID_LEGACY_ACCESS=admin` (default) ✘ T-25 · `open` ✔ (v4 rule, every role holder) T-26 · `deny`: update/delete 403 **before** the admin check (as in B5), read as `admin` T-27 | The B5 rule now covers read too (read was open) |
| a `sid`-less row in a list | not matched by the session `sid` pin (no change) | `open` does not change the list pin |

Bulk and override cases:

| Case | Rule | Spec |
| --- | --- | --- |
| `doPostBulk` | phase 1 validates every item and calls `canDo('create', …, { throwable: false })`; a `false` counts as denied. Any denied → `403 NOT ALLOWED - bulk[create] denied ids[<id or #index,…>] @doPostBulk(…)`, zero writes | T-28 (denied), T-29 (all written) |
| `doPutBulk` | phase 1 loads every stored row (`404 NOT FOUND - …` first, current messages) and calls `canDo('update', row, { throwable: false })`. Any denied → `403 NOT ALLOWED - bulk[update] denied ids[<id,…>] @doPutBulk(…)`, zero writes | T-30 (denied, 404 first), T-31 (all written) |
| `canDo` override | runs before the default and falls back to `super.canDo` | T-32 |
| controller `policy` | `{ read: 'site' }` restores the site-wide read; `{ list: 'owner' }` lists own rows | T-33 |
| `accessPolicy()` override | the type default; the controller `policy` wins over it | T-34 |
| session off | the B5 § 6.4 rules, unchanged; `policy` and the pin are not used | T-35 |
| local mode | admin for all, no pin (unchanged) | T-36 |

## Old → new

| Point | Before (v5 up to B12) | B13 |
| --- | --- | --- |
| `read` | any role holder of the same `sid` (a `sid`-less row too) | `owner` (same `sid` and `uid`). A `sid`-less row follows `SID_LEGACY_ACCESS` |
| `update` / `delete` | same `sid` and `uid` (an empty `uid` matched an empty `uid`) | the same, but an **empty `uid` never matches** (session or row) |
| `create` | same `sid`, or no `sid` | the row carries the session `sid`/`uid`/`gid` (body values are overwritten, as before) → allowed for a role holder with a `uid`. **The `gid` stamp is new** (only when the session has one and the model has none) |
| `list` | no `canDo`; `packSearchParam` pinned `sid`. An offsite session (`sid` empty) listed **without a filter** | `doList` calls `canDo('list')` first (guest, no session, empty `sid`/`uid` → 403). Pin per the `list` scope: `site` → `sid`, `owner` → `sid` + `uid`, `group` → `sid` + `gid`, `any` → no pin (`?sid=` honoured). Admin as before (`?sid=`, `?uid=`, `0` = the session value) |
| session switch | `canDo` read env `USE_SESSION`; the controller read `options.useSession` | the 7 handlers pass `canDo(…, { useSession: confUseSession, policy: confPolicy })`. A direct `proxy.canDo()` call keeps the env default |
| admin order | `getCurrentSession({ throwable })` threw first, so an IAM caller and a `roles: ['admin']` context without `userAgent` got 403 | `hasAdminRole()` first (admin passes without a session), so the `roles: ['admin']` claim of `HOW_TO_UPGRADE_V5.md` § 11.3 works. The 403 messages after it are unchanged |
| bulk | `canDo` per item (throwable): the first denial threw, only its id was reported. With an override returning `false`, a `null` item reached `makeModel()` | two phases, every denied id reported, zero writes on a denial |
| session off | B5 § 6.4 | **unchanged**. An install without multi-tenancy has no `sid`/`uid` on its rows, so the policy would lock out everyone but admin |
| local mode | everyone is admin, no pin | unchanged |

## Override points (highest first)

1. **`MyManagerProxy.canDo()` override** — runs first, falls back to `super.canDo()`. Semi-public reads and ownership by another field (`model.id`, `userId`, member lists) belong here.

```ts
class ChannelsProxy extends MyManagerProxy<ChannelModel, ChannelManager, MyService> {
    public canDo<T extends ChannelModel>(action: CanDoActionType, model?: T, options?: CanDoOptions): boolean {
        const uid = this.proxy.getCurrentSession({ throwable: false, context: options?.context })?.uid;
        if (action === 'read' && model?.memberIds?.includes(uid)) return true; // members read across sites
        return super.canDo(action, model, options);
    }
}
```

2. **Controller option `policy`** (`CRUDCreationOptions.policy?: Partial<AccessPolicy>`, read through `protected get confPolicy()`, which a subclass may override) — only the 7 handlers of that controller.

```ts
super('pets', service, service.$pet, transformer, { useSession: true, policy: { read: 'site' } });
```

3. **Type default `MyManagerProxy.accessPolicy()`** — also used by direct `proxy.canDo()` calls.

```ts
class PetsProxy extends MyManagerProxy<PetModel, PetManager, MyService> {
    public accessPolicy(): AccessPolicy {
        return { ...super.accessPolicy(), list: 'owner' }; // each user lists own pets only
    }
}
```

4. Core default `DEFAULT_ACCESS_POLICY`. There is **no env switch**: the request is a code override, and one install switches with one `policy` line.

Merge: `{ ...DEFAULT_ACCESS_POLICY, ...accessPolicy(), ...options.policy }` (`MyManagerProxy.effectivePolicy(policy)`; `undefined` values are skipped). `doList` uses the same merge for the `list` scope it passes to `packSearchParam(…, { scope })`.

## Public surface

- New root names: `AccessScope` (type), `AccessPolicy` (type), `DEFAULT_ACCESS_POLICY` (value, frozen). `etc/api-names.allow.txt` has the 3 lines.
- New members: `CanDoOptions.policy?`, `CRUDCreationOptions.policy?`, `packSearchParam` option `scope?`, `MyManagerProxy.accessPolicy()`, `MyManagerProxy.effectivePolicy()`, `MyManagerProxy.canDoWithoutSession()` (protected, the session-off rules), `AbstractCRUDController.confPolicy` and `canDoOptions()` (protected).
- `MyCoreProxy.makeModelBase()` also stamps `gid` (non-empty only) from `parent` and from the session.
- The controller `makeModelBase()` does not throw `403 IDENTITY-TOKEN` for an admin without a session: that row gets empty `sid`/`uid` (a `sid`-less row, admin only by default).
- `packSearchParam()` with the session on: an admin without a session `sid` gets `sid: null` (no site filter) instead of a 403; a non-admin with an empty session `sid` under `site`/`owner`/`group` gets `403 NOT ALLOWED - list[<scope>] needs session .sid @…` (was: no filter).

## Compatibility

Behaviour changes inside v5 (session on only):

1. A same-site user's `read` of another user's row → 403.
2. An empty `uid` in the session or the row → 403 (admin excepted).
3. An offsite session (`sid` empty) `list` → 403.
4. A `sid`-less row: `read` admin only (`SID_LEGACY_ACCESS=open` keeps v4).
5. `gid` is stamped on create.
6. Admin is decided before the session (IAM SigV4 and `roles: ['admin']` claims pass).
7. Bulk reports every denied id and writes nothing on a denial.

**One-line restore of the v5 read rule:** `policy: { read: 'site' }` in the controller options.

`SID_LEGACY_ACCESS` keeps its name, values and default; there is no new env name.

**DoU (B6).** The socials `canDo` overrides (5) run first, so they keep working. backend, pushes and sockets mostly gate with `hasAdminRole` or override `doList`; what changes there is the inherited `doGet` of another user's row, which is now 403. Check each inherited `doGet` during the B6 migration (`docs/v5/B6-dou-migration.md`) and add `policy: { read: 'site' }` or a `canDo` override where a shared read is intended.

**lemon-templates-api.** `tests` (`useSession: false`) is unchanged; `mocks` and `callback` follow env `USE_SESSION`. No change needed beyond a smoke run.

## Files

| File | Change |
| --- | --- |
| `src/extended/cores/abstract-services.ts` | `AccessScope`, `AccessPolicy`, `DEFAULT_ACCESS_POLICY`, `CanDoOptions.policy`; `accessPolicy()`, `effectivePolicy()`, `canDo()` (session on), `canDoWithoutSession()` (the old rules); `packSearchParam` `scope`; `makeModelBase` `gid` |
| `src/extended/cores/abstract-controllers.ts` | `CRUDCreationOptions.policy`, `confPolicy`, `canDoOptions()`; 7 handlers pass `{ useSession, policy }`; `doList` `canDo('list')` + scope; 2-phase bulk; admin `makeModelBase` without a session |
| `src/extended/cores/abstract-services.spec.ts` | 32 new cases (default policy, T-01..T-27, scopes, T-34..T-36) |
| `src/extended/cores/abstract-controllers.spec.ts` | 36 new cases (T-01..T-36 through the handlers); `instance()` takes `policy` |
| `etc/api-names.allow.txt` | `+AccessScope`, `+AccessPolicy`, `+DEFAULT_ACCESS_POLICY` |
| `HOW_TO_UPGRADE_V5.md` | § 11.7 rewritten |
| `CHANGELOG.md`, `README.md` | unreleased entry; docs index row |
| `docs/v5/B13-access-policy.md` (this file) | new |

No existing spec expectation changed: the existing CRUD specs use the session owner, other-site (`$others`) and guest callers, whose results are the same under B13.

## Gates (2026-10-30, local)

| Gate | Base `v5` @ `90da90ed` | B13 |
| --- | --- | --- |
| `npm test` (`LS=1`) | 61 files, 704 passed | 61 files, 804 passed in 2 runs (+100: 36 handler cases, 32 `canDo`/`packSearchParam` cases that run in both spec files) |
| `npm run build` | ok | ok |
| `npm run api:check` | not-allowed=0 | base=304 current=304 added=22 removed=22 allow=44 not-allowed=0 (+3 names) |
| `npm run esm:smoke` | ok | ok names=141 subpaths=4 (+1: `DEFAULT_ACCESS_POLICY`; the two types are not runtime names) |
| `npx tsc --noEmit`, `npx eslint`, `npx prettier --check` (changed `.ts`) | — | 0 errors, no new warning |
| `npm audit --omit=dev` | 0 | found 0 vulnerabilities |
