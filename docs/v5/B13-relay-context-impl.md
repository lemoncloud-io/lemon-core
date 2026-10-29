# v5 B13 — 호출 채널과 relay 구현 기록 (WP1–WP3)

상태: 2026-10-30 구현. lemon-model `feat/v5-b13-context-channel` (기준 `v5` @ `2591c21`), lemon-core `feat/v5-b13-relay` (기준 `v5` @ `90da90ed`, 5.0.5). 계획은 `docs/v5/B13-relay-context.md`(D1–D4, § 4 WP1–WP3)다. 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 15. WP4(templates-api 적용)는 별건이다.

## 변경

### lemon-model (WP1)

- `src/types/core-types.ts`: `NextContext`에 선택 필드 `channel?: 'external' | 'internal' | 'local'`와 `trace?: NextTrace`를 더했다. `NextTrace = { tid; hop; via?; pid?; src? }`를 export했다. 기존 필드는 그대로다.
- `src/types/core-types.spec.ts`(새 파일): 타입 모양 spec 1건.

### lemon-core (WP2·WP3)

| 파일 | 변경 |
| --- | --- |
| `src/cores/protocol/protocol-relay.ts` (새) | relay 만들기·인코딩·디코딩·검증, 수신 context(D2), hop 상한, legacy 모드, `TRACE` 줄. deep 모듈(루트 export 없음) |
| `src/cores/protocol/protocol-sign.ts` | `HEADER_LEMON_RELAY` 정의(로그 마스킹 목록에 추가), `readConfig()` export, `HEADER_PROTOCOL_CONTEXT`에 `@deprecated` |
| `src/cores/protocol/protocol-service.ts` | web·SNS·SQS 송신이 relay를 싣는다. legacy context는 `PROTOCOL_LEGACY_CONTEXT=send`일 때만. SNS·SQS 수신 `transformToParam(event, own)`이 relay·legacy·없음 세 경우로 context를 만든다 |
| `src/cores/lambda/lambda-web-handler.ts` | `packContext()`: relay 수신(D2), legacy 모드, JSON identity 경고 줄, 진입 `channel`·`trace`, `TRACE` 줄 |
| `src/cores/lambda/lambda-sns-handler.ts`, `lambda-sqs-handler.ts` | `packContext()`가 수신 함수 자기 id(`awsRequestId`, `invokedFunctionArn` 계정)를 돌려준다. 이것을 `transformToParam`에 넘긴다 |
| `src/cores/lambda/lambda-alb-handler.ts` | ALB 요청에도 `channel`·`trace` |
| `src/extended/cores/abstract-controllers.ts` | `fields/admin` 게이트를 `channel === 'external'` 거부로 바꿨다 |
| `src/engine/engine.ts` | `doReportError()` payload에 `trace` |
| `HOW_TO_UPGRADE_V5.md` | § 15, 점검표 3줄 |
| spec | 새 파일 2(`protocol-relay.spec.ts` 13건, `lambda-channel.spec.ts` 5건). 기존 spec 6개의 기대값을 새 모양으로 고쳤다(`channel`·`trace` 추가, 송신 헤더가 `x-lemon-relay`) |

## 결정 (계획 밖에서 정한 것)

| 결정 | 이유 |
| --- | --- |
| 로컬 모드는 protocol 헤더가 없는 진입에만 이긴다. relay·legacy·SNS·SQS 수신은 로컬 모드에서도 `internal` | local transport가 Lambda와 같은 경로를 타게 한다(WP7). 로컬 express 요청은 `host`가 있어 relay를 무시하므로 충돌이 없다 |
| ALB 진입도 `channel`을 넣는다(`host` 있음 → `external`, 로컬 → `local`) | ALB context도 컨트롤러에 닿는다. `channel`이 없으면 새 게이트를 통과한다 |
| 게이트는 `channel === 'external'`만 거부한다. 로컬 모드라도 `external`이면 거부 | 계획 D1 그대로("`channel`만 본다"). `channel`이 없는 context(엔트리 밖에서 만든 것)는 외부가 아니다 — 예전 "빈 `domain`"과 같은 결과 |
| `runtime.external`은 그대로 `domain` 유무를 보고한다 | templates-api `fields:admin` 도구가 로컬 express에서 `external: true`를 기대한다. 정보 값일 뿐 게이트가 아니다 |
| web `transformToParam`의 id 대조는 `channel`이 있는 context(엔트리가 만든 것)에는 하지 않는다 | relay 수신 context의 `requestId`는 수신 함수 자기 값이라 `requestContext.requestId`(호출자 값)와 다르다. 대신 `packContext()`에서 `relay.pid`와 `requestContext.requestId`를 대조한다(`400 INVALID CONTEXT - relay pid`) |
| 수신 자기 id: web은 `awsRequestId`(없으면 새 uuid)·`invokedFunctionArn` 계정(없으면 `requestContext.accountId`). SNS·SQS는 같은 값, 없으면 메시지 id와 주제·큐 ARN 계정 | D2 "수신 함수 자기 값". 단위 테스트처럼 Lambda context가 없을 때도 값이 있게 한다 |
| SNS·SQS relay: `requestId` 속성이 있으면 `relay.pid`와 같아야 한다. `accountId` 속성은 대조하지 않는다 | 송신이 두 값을 같은 호출자 `requestId`로 채운다. relay에는 계정이 없다 |
| SNS·SQS에서 relay도 context도 없으면 `{ channel: 'internal', trace, 자기 id }` | D1 "protocol 수신은 `internal`". 예전에는 `undefined`였다 |
| `trace`에 `src`도 넣는다 | `NextTrace`에 `src`가 있고, 다음 hop 송신이 `trace.src`를 먼저 읽는다 |
| `tid`가 없으면(호출자 `trace.tid`·`requestId` 둘 다 없음, 또는 ALB처럼 requestId 없는 진입) 새 uuid | 그 지점부터라도 사슬을 잇는다 |
| (후속) `requestId`는 안전한 id(`/^[\w.:-]{1,128}$/`)일 때만 `tid`로 쓴다. 아니면 새 uuid. 채널이 아니라 값으로 판정한다 | 로컬 express의 requestId는 `2026-10-30 03:32:57.040`처럼 공백이 있고 같은 ms 안에서 겹친다. 값 규칙이면 legacy context로 들어온 같은 값도 함께 막는다. Lambda `awsRequestId`·API Gateway id는 규칙에 맞아 그대로다. `context.requestId`는 바꾸지 않는다 |
| (후속) SNS·SQS의 같은 서비스 callback(in-process `handleProtocol`)도 한 hop이다: `nextHopContext()`로 `trace.hop` + 1, 같은 `tid`·`src`, `via` = 이 서비스, `pid` = 이 수신의 requestId, `depth` = 새 hop. 같은 상한(`508`)과 `TRACE` 줄 | 예전에는 `depth`만 손으로 올려 한 서비스 안의 callback 고리를 막지 못했다. 원격 callback은 원래 `execute()` → relay로 hop이 오른다 |
| relay 디코딩: 모르는 키·화이트리스트 밖 identity 키는 버린다. 형식 오류는 `400 INVALID CONTEXT - relay <reason>`. 문자열 필드 2048자, 전체 4096바이트 상한 | 앞으로 키가 늘어도 받는다. 오류 범주는 legacy의 `INVALID CONTEXT`와 같다 |
| `TRACE` 줄의 `via`는 서비스 호스트만, `src`는 경로만. 값의 공백은 `_`로 바꾸고 128자에서 자른다 | identity·계정 번호를 로그에 남기지 않는다. relay 값으로 줄을 깨지 못하게 한다 |
| `PROTOCOL deprecated x-protocol-context <서비스> (<web\|sns\|sqs>)`. `<서비스>`는 legacy context `source`의 호스트 | legacy에는 `via`가 없다. `source`는 최초 진입 서비스다. 전송 종류는 `PROTOCOL unsigned` 줄과 같은 꼴로 붙였다 |
| JSON identity 줄 `PROTOCOL deprecated json identity (web)`는 `accept`가 아니면 찍는다(`reject`에서도 거부하지 않음) | 지시: 동작·enforce 규칙은 그대로 |
| legacy로 받은 context의 `trace`는 `{ tid: <legacy requestId>, hop: 0 }`로 덮는다 | D3 "relay 없는 진입은 hop 0" |
| hop은 호출자 `trace.hop`에서 센다. 손으로 올린 `depth`는 relay에 실리지 않는다 | D2 `hop` 정의. 수신 `depth` = `hop` |
| relay는 `PROTOCOL_LEGACY_ACCEPT`의 대상이 아니다. relay와 legacy가 함께 오면 deprecated 줄도 없다 | D4 "relay와 legacy가 함께 오면 relay를 쓴다" |
| SNS·SQS 송신은 relay를 `getHelloArn()`보다 먼저 만든다 | hop 초과(508)가 다른 오류보다 먼저 나온다 |
| `x-lemon-relay`를 헤더 로그 마스킹 목록에 넣었다 | relay에 `sid`·`uid` 같은 identity id가 있다. `x-protocol-context`와 같은 취급 |
| `doReportError()`는 payload 최상위에 `trace`를 둔다 | `context` 안에도 이미 있지만 찾기 쉽게 한다 |

### `domain`·host를 보는 다른 자리 (grep)

| 자리 | 판단 |
| --- | --- |
| `lambda-web-handler.ts` `hasHostHeader()`·`isExternal()` | 진입 규칙 자체(외부 요청의 protocol 헤더 무시). 그대로 |
| `MyHttpHeaderTool.parseIdentityHeader()`의 `isInternal` | JSON identity는 host 없는 요청에서만 해석. 신뢰 경계라 그대로 |
| `abstract-service.ts` `fetchIdentityAccess()`, `abstract-services.ts` `asNextContext()` | `domain`을 데이터로 넘길 뿐. 게이트 아님 |
| ALB·notification handler의 `domain = Host` | 데이터. 게이트 아님 |
| `engine.ts` `domainPrefix` | 보고 데이터. 게이트 아님 |

바꾼 게이트는 `doGetAdminFields` 하나다.

## 검증

명령은 모두 `AWS_PROFILE=nonexistent-local AWS_EC2_METADATA_DISABLED=true`로 돌렸다. git·AWS 호출·env 파일 읽기는 하지 않았다.

| 항목 | 기준선 | 변경 뒤 |
| --- | --- | --- |
| lemon-model `npm test` | 21 suites, 293 passed | 22 suites, 294 passed |
| lemon-model `npm run build`·`tsc --noEmit` | — | 0 |
| lemon-core `npx tsc --noEmit` | — | 0 |
| lemon-core 새 spec | — | `protocol-relay.spec.ts` 15, `lambda-channel.spec.ts` 6 통과 (후속 3건 포함) |
| lemon-core `npm test` | 61 files, 704 tests, 9 failed | 63 files, 726 tests, 9 failed (같은 9건, 후속 포함) |
| `npm run build` | — | 0, `gen-esm-wrapper` 139 named + default |
| `npm run api:check` | `base=304 current=301 added=19 removed=22 allow=41 not-allowed=0` | 같음 |
| `npm run esm:smoke` | `ok names=140 subpaths=4` | 같음 |
| `npm run dup:check` | `files=92 decls=426 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0` | `files=93 decls=459 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0` (후속 포함) |

기준선의 실패 9건(변경 뒤에도 같은 9건): `bin/lib/fields-types.spec.mjs` 1, `dummy-controller` 1, `general-api-controller` 2, `general-controller` 2, `tools.spec` `awsConfig()` 1, `abstract-controllers` express 2(`fields/admin over express …`, 없는 프로필로 자격 증명을 찾다가 5초 시간 초과).

### relay 크기

| context | relay | legacy context JSON |
| --- | --- | --- |
| 대표 호출자(identity 12필드, cookie·authorization·referer·origin·clientIp·domain 포함) | 411 B | 957 B |
| 실제 API Gateway 이벤트 표본(`sample.event.web.signed.json`, Cognito identity) | 411 B | 1009 B |

## 영향

- templates-api(링크, 읽기 전용 확인): `npx tsc --noEmit` 0. `src/modules/callback/` jest 6 suites 72 tests 중 1 실패 — `api-callback.spec.ts` "should pass basic CRUD"의 `doGet('1')` 404 문구(`proxy/callback/id:1` 기대, `not found @doGet(callback/1)` 받음). `AbstractCRUDController.doGet` 문구라 이번 변경과 관계없다.
- templates-api가 WP4에서 볼 곳: `api-callback.ts`가 `depth`를 손으로 올려 보낸다. relay에는 `depth`가 실리지 않고 수신 `depth` = `hop`(≥ 1)이라 `loop-recv`의 `depth > 0` 판정은 그대로 참이다. 판정을 `channel`·`trace.hop`으로 바꾸는 일은 WP4다.
- DoU(v4) 수신 함수로 보내는 v5 서비스는 `PROTOCOL_LEGACY_CONTEXT=send`가 필요하다(§ 15.5 표).
