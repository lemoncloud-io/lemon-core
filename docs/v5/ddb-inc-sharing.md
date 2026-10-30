# v5 — `inc()` 캐시 경합과 dummy storage 공유

상태: 2026-10-30 `feat/v5-ddb-inc`에 구현 (기준 `v5` @ `88502a04`, 5.0.10). 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 17.

## 목적

1. 한 `ManagerProxy`에서 같은 id로 `inc()`를 동시에 부르면 캐시가 최종값이 아니다. 이 캐시를 `saveAllUpdates({ useBatch: true })`가 다시 써서 증가분을 잃는다.
2. `.yml` dummy 테이블에서 같은 서비스의 매니저끼리 storage를 공유하지 않는다. 실 DynamoDB(같은 테이블)와 동작이 다르다.

## 재현 (2026-10-30, `v5` @ `a4485015`)

### 1. `inc()` 캐시 경합 (dev DynamoDB)

같은 프록시에서 `my_parallel`로 같은 id에 `inc({ n: 1 })` N번.

| N | DB 값 | 프록시 캐시 | `saveAllUpdates({ useBatch: true })` 뒤 DB |
| --- | --- | --- | --- |
| 10 | 10 | 9 | — |
| 20 | 20 | 18 | 18 (증가분 손실) |

기본 `saveAllUpdates()`(diff만)는 안전하다. dummy에서는 재현되지 않는다 — `DummyStorageService.update()`가 id별로 직렬화한다(`withLock`).

### 2. dummy storage 비공유 (dummy vs dev DynamoDB)

한 서비스에서 `$test`·`$mock` 두 매니저.

| 동작 | dummy | DynamoDB |
| --- | --- | --- |
| `$test` storage로 저장한 raw `_id`를 `$mock` storage로 읽기 | 없음 | 있음 |
| `nextSeq(k)`를 `$test` storage, 이어서 `$mock` storage로 | 1000001, 1000001 | 연속값 |

## 원인

1. `ManagerProxy.inc()`(`src/extended/abstract-service.ts`)는 `storage.update()` 응답을 받은 뒤 그 값을 `_org[id]`·`_new[id]`에 쓴다. 동시 호출의 응답 순서가 뒤바뀌면 마지막에 끝난 호출이 캐시를 덮는다. 그 값이 최신값이라는 보장이 없다.
2. `CoreService.makeStorageService()`가 매니저마다 `new ProxyStorageService(this, this.tableName, …)`를 만든다. 테이블 이름이 `.yml`이면 `ProxyStorageService.makeStorageService()`가 매번 새 `DummyStorageService`를 만들고, 각자 `./data/<file>.yml`을 자기 버퍼로 읽는다.

## 변경

1. `ManagerProxy`에 id별 promise 체인(`$incQueues`, 비공개)을 둔다. `inc()` 본문(`update` → `get` → 캐시 반영)이 같은 id에서 하나씩 돈다. 패턴은 `DummyStorageService.withLock`과 같다. 실패한 호출은 호출자에게 reject되고 체인은 이어진다. 꼬리가 끝나면 항목을 지운다. 다른 id는 병렬이다.
2. `CoreService`가 `.yml` 테이블이면 내부 storage 하나(`$dummy`, 비공개, 첫 사용 때 생성)를 만들어 모든 매니저의 `ProxyStorageService`에 넘긴다. 서비스 인스턴스가 다르면 따로 갖는다. DynamoDB 테이블은 그대로다(매니저마다 필드 whitelist가 달라 `DynamoStorageService`를 따로 둔다). dummy는 whitelist가 없어 공유해도 필터링이 같다. `hello()` 문자열은 같다.

공개 이름은 바뀌지 않는다.

## v4와 동작 차이

- 같은 프록시의 같은 id `inc()`가 동시에 돌지 않는다. N번 호출의 총 시간이 응답 N번의 합이 된다. 다른 프록시끼리는 그대로 병렬이다.
- `.yml` dummy에서 한 서비스의 매니저들이 같은 버퍼·`nextSeq()` 카운터를 본다. 매니저별로 버퍼가 따로라고 가정한 spec은 바뀐다.

## 테스트

`src/extended/abstract-service.spec.ts`:

- `should keep the proxy cache at the final value when inc() responses arrive out of order` — 앞선 호출의 응답을 더 늦게 돌려준다. 캐시와 `saveAllUpdates({ useBatch: true })` 뒤 storage가 N이다. 수정 전 코드에서 실패(캐시 1).
- `should run the next inc() on the same id after a rejected inc()` — 첫 `update()`가 실패해도 다음 `inc()`가 돈다.
- `should share the inner dummy storage between managers of one service` — 내부 storage 동일, raw `_id` 교차 읽기, `nextSeq()` 연속, 다른 서비스 인스턴스는 별도. 수정 전 코드에서 실패.
