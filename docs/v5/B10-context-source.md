# v5 B10 — `context.source`에 최초 요청 경로 싣기

상태: 2026-10-29 `feat/v5-b10-context-source`에 구현 (기준 `v5` @ `d0744af7`, lemon-core 5.0.3). B10 묶음 항목 1. 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 13.

## 배경

외부 요청의 `context.source`는 `packContext()` 마지막 단계에서 `myProtocolURI($ctx)`로 만든다. 그래서 값이 `api://<account>@<service>#<version>` 꼴이고 서비스 단위까지만 남는다. 내부 protocol 호출을 받는 쪽은 받은 context를 그대로 쓴다. 따라서 하류 서비스는 최초 호출이 어느 경로(`/type/id/cmd`)였는지 모른다.

## 변경

- `src/cores/lambda/lambda-web-handler.ts` `packContext()`: `event.pathParameters`가 있으면 `myProtocolURI($ctx, type, id, cmd)`로 `source`를 만든다.
  - `type`은 `web.transformToParam()`과 같은 규칙이다: `pathParameters.type`, 없으면 `resource`(없으면 `path`)의 첫 마디.
  - `id`·`cmd`는 `pathParameters.id`·`.cmd` 그대로다. 경로 인코딩은 `MyProtocolService.asPath()`가 한다(`type`·`id`는 `encodeURIComponent`, `cmd`는 `encodeURI`).
  - `pathParameters`가 없으면 v4와 같은 값(경로 없음)이다.
- 내부 호출 수신 분기(host 없음 + `x-protocol-context`)는 바꾸지 않았다. 호출자의 `source`가 그대로 하류로 간다.
- 공개 export 이름 변경 없음.

| 요청 | `source` |
| --- | --- |
| `GET /hello/{id}`, `id=a_123_test` | `api://<account>@lemon-core-dev/hello/a_123_test#<version>` |
| `pathParameters = { type: 'hello', id: 'a b', cmd: 'c/d' }` | `api://<account>@lemon-core-dev/hello/a%20b/c/d#<version>` |
| `pathParameters` 없음 | `api://<account>@lemon-core-dev#<version>` (v4와 같음) |
| 내부 호출 수신 | 호출자 context의 `source` 그대로 |

## 검증

- `src/cores/lambda/lambda-web-handler.spec.ts`: 기존 `packContext()` 단언 2건을 경로가 붙은 값으로 고쳤다. 새 케이스 1건(경로 있음·없음·내부 호출 보존)을 더했다.
- `npx vitest run` (lambda-web-handler·protocol-service·engine spec): 3 files, 50 passed.
- `npx tsc --noEmit` 오류 0. 바꾼 `.ts`의 `npx eslint` 오류 0, `npx prettier --check` 통과.

## 영향

- lemon-core 안에서 `source`를 읽는 곳은 `engine.ts`의 `doReportError()`·`doReportSlack()` 두 곳뿐이다. 둘 다 `source === 'express'` 정확 일치 비교다. `packContext()`는 `'express'`를 만들지 않으므로 결과가 바뀌지 않는다.
- 서비스 코드가 `source`를 서비스 URI와 정확 일치로 비교하면 깨진다. 서비스 부분만 비교한다: `new URL(source).host`가 서비스, `.pathname`이 경로, `.hash`가 버전이다.
- `source`는 서명되는 context JSON의 일부다. 값만 길어지고 서명 규칙은 같다.
