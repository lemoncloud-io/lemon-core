# v5 — `inc()` cache race and shared dummy storage

Status: implemented on `feat/v5-ddb-inc` on 2026-10-30 (base `v5` @ `88502a04`, 5.0.10). Upgrade note: `HOW_TO_UPGRADE_V5.md` § 17.

## Purpose

1. Concurrent `inc()` calls on the same id in one `ManagerProxy` leave the cache at a value that is not the final one. `saveAllUpdates({ useBatch: true })` then writes that cache back and loses increments.
2. With a `.yml` dummy table, managers of one service do not share storage. Real DynamoDB (one table) does.

## Reproduction (2026-10-30, `v5` @ `a4485015`)

### 1. `inc()` cache race (dev DynamoDB)

One proxy, `inc({ n: 1 })` N times on one id with `my_parallel`.

| N | DB value | proxy cache | DB after `saveAllUpdates({ useBatch: true })` |
| --- | --- | --- | --- |
| 10 | 10 | 9 | — |
| 20 | 20 | 18 | 18 (increments lost) |

The default `saveAllUpdates()` (diff only) is safe. Dummy storage does not reproduce it: `DummyStorageService.update()` serializes per id (`withLock`).

### 2. Dummy storage not shared (dummy vs dev DynamoDB)

One service with two managers, `$test` and `$mock`.

| Action | dummy | DynamoDB |
| --- | --- | --- |
| read through `$mock` storage a raw `_id` saved through `$test` storage | not found | found |
| `nextSeq(k)` through `$test` storage, then through `$mock` storage | 1000001, 1000001 | consecutive |

## Cause

1. `ManagerProxy.inc()` (`src/extended/abstract-service.ts`) writes the `storage.update()` response into `_org[id]` and `_new[id]`. When concurrent responses arrive out of order, the call that finishes last overwrites the cache, and its value is not guaranteed to be the latest.
2. `CoreService.makeStorageService()` creates `new ProxyStorageService(this, this.tableName, …)` per manager. For a `.yml` table name, `ProxyStorageService.makeStorageService()` creates a new `DummyStorageService` each time, and each one loads `./data/<file>.yml` into its own buffer.

## Change

1. `ManagerProxy` keeps a promise chain per id (`$incQueues`, private). The `inc()` body (`update` → `get` → cache write) runs one at a time per id, with the same pattern as `DummyStorageService.withLock`. A failed call rejects to its caller and the chain continues. The entry is removed when its tail settles. Different ids run in parallel.
2. For a `.yml` table, `CoreService` creates one inner storage (`$dummy`, private, created on first use) and passes it to the `ProxyStorageService` of every manager. Another service instance has its own. DynamoDB tables are unchanged (each manager has its own field whitelist, so each keeps its own `DynamoStorageService`). Dummy storage has no whitelist, so sharing it filters the same way. `hello()` strings are unchanged.

No public name changes.

## Behavior difference from v4

- Same-id `inc()` calls on one proxy no longer run concurrently. N calls take the sum of N responses. Different proxies stay parallel.
- With a `.yml` dummy, the managers of one service see the same buffer and the same `nextSeq()` counter. Specs that assumed a separate buffer per manager change.

## Tests

`src/extended/abstract-service.spec.ts`:

- `should keep the proxy cache at the final value when inc() responses arrive out of order`: earlier calls respond later. The cache, and storage after `saveAllUpdates({ useBatch: true })`, are N. Fails on the old code (cache 1).
- `should run the next inc() on the same id after a rejected inc()`: the next `inc()` runs after the first `update()` fails.
- `should share the inner dummy storage between managers of one service`: same inner storage, raw `_id` read across managers, consecutive `nextSeq()`, separate storage for another service instance. Fails on the old code.
