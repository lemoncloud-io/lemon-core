# v5 B13 — 호출 채널과 relay 정리 (계획)

상태: 계획 2026-10-30. 기준 `v5` @ `90da90ed` (lemon-core 5.0.5), lemon-model `v5` @ `2591c21`. 구현은 이 계획의 P0부터 진행한다.

## 1. 배경 — 지금의 사실

### 1.1 내부·외부 판정 신호가 둘이다

| 신호 | 정의 | 쓰는 곳 |
| --- | --- | --- |
| Host 헤더 | `hasHostHeader(headers)` (`lambda-web-handler.ts`). Host가 있으면 외부다 | `x-protocol-context` 수용, JSON `x-lemon-identity` 해석 |
| `context.domain` | `requestContext.domainName`, 없으면 Host (`prepareContext()`) | `fields/admin` 게이트 (`abstract-controllers.ts` `doGetAdminFields`) |

- 두 신호는 어긋날 수 있다. Host가 없고 `domainName`이 있는 이벤트는 헤더 기준으로는 내부, `domain` 기준으로는 외부다.
- protocol 수신 함수는 호출자 context를 그대로 받는다. 그래서 `domain`에는 최초 요청의 외부 도메인이 남는다. `domain`은 출처를 담을 뿐 채널을 담지 않는다.

### 1.2 `x-protocol-context`는 호출자 context 전체를 넘긴다

- web은 헤더 `x-protocol-context`, SNS·SQS는 메시지 안의 protocol param `context`로 넘긴다.
- 수신 함수는 그 JSON을 자기 context로 쓴다.
- 문제 셋:
  - **신뢰 범위가 넓다.** `cookie`·`authorization`·`referer`·`origin`·`clientIp`·`userAgent`·`domain` 같은 최초 요청 값이 하류로 간다. 하류는 그 값을 자기 요청 값처럼 쓴다.
  - **크다.** hop마다 context 전체를 직렬화하고 서명하고 파싱한다. SQS 큐의 최대 메시지 크기가 4096바이트인 서비스가 있다(templates-api `MyQueue`).
  - **채널과 hop이 없다.** 하류는 자기가 내부 호출을 받았는지 모른다. `depth`는 호출자가 손으로 올린다.

### 1.3 서명은 키가 있어야 켜진다

- `PROTOCOL_SIGN_KEY`가 없으면 검증 모드는 `off`다. templates-api dev는 키가 없다(B10-verify-enforce § 현황).
- 그래서 `lambda:InvokeFunction` 권한만 있으면 JSON identity로 `roles: ["admin"]`을 주장할 수 있다.

### 1.4 v4 호출자가 있다

- DoU 다섯 repo는 lemon-core v4(`^4.3.0`, `^4.1.15`)다. 서로 `x-protocol-context`로 호출한다(B10-verify-enforce § 현황).
- 그래서 v5 수신 함수는 당분간 `x-protocol-context`를 받아야 한다.
- DoU 다섯 repo는 모두 v5 이관 대상이다. 이관은 이 계획(B13)이 끝난 뒤 진행한다(오너 2026-10-30). 그래서 이관 중에는 v4와 v5가 섞인다.

## 2. 목표

1. 진입 지점에서 채널을 한 번 정한다. 게이트는 그 값만 본다.
2. 내부 hop에는 최소 relay만 싣는다. relay는 identity 요약과 trace다. relay는 서명한다.
3. 여러 hop을 지나도 identity와 trace가 이어진다. 로그로 hop을 이어 볼 수 있다.
4. `x-protocol-context`는 deprecated다. v5 송신은 기본으로 보내지 않는다. 수신은 모드로 받는다 → 경고한다 → 거부한다.
5. 운영 도구는 서명된 identity로만 admin을 주장한다.

## 3. 설계

### D1. 채널 — `context.channel`

| 진입 | `channel` |
| --- | --- |
| web, Host 있음 | `external` |
| web, Host 없음 (직접 invoke, protocol web) | `internal` |
| 로컬 express (`$U.isLocalMode()`) | `local` |
| protocol SNS·SQS 수신 (`handleProtocol`) | `internal` |

- 수신 함수가 직접 정한다. relay는 채널을 싣지 않는다.
- 게이트는 `channel`을 본다. `fields/admin`은 `channel !== 'external'`일 때만 허용한다.
- `domain`은 출처 정보로 남긴다. 게이트에는 쓰지 않는다.
- 타입: lemon-model `NextContext`에 선택 필드 `channel`과 `trace`(D3)를 더한다. 기존 필드는 바꾸지 않는다.

### D2. relay 봉투 — `x-lemon-relay`

| 항목 | 값 |
| --- | --- |
| web 운반 | 헤더 `x-lemon-relay` |
| SNS·SQS 운반 | protocol param의 `relay` 필드. `context` 필드는 싣지 않는다 |
| 형식 | `r1.<base64url(JSON)>` |
| 서명 | 기존 서명을 그대로 쓴다. web은 `x-protocol-signature`, canonical의 context 자리에 relay 문자열을 넣는다. SNS·SQS는 메시지 서명 그대로다 |
| 크기 목표 | 1 KB 이하 |

relay JSON:

| 키 | 뜻 | 출처 |
| --- | --- | --- |
| `idt` | identity 요약: `sid`·`uid`·`gid`·`roles`·`identityId`·`lang` (화이트리스트) | 호출자 `context.identity` |
| `tid` | trace id. 최초 진입 요청의 requestId | 호출자 `trace.tid`, 없으면 호출자 `requestId` |
| `hop` | 이번 호출의 hop 수. 호출자 hop + 1 | 호출자 `trace.hop` |
| `src` | 최초 진입 경로 URI (B10 `source`) | 호출자 `trace.src`, 없으면 호출자 `source` |
| `via` | 바로 앞 호출자 서비스 URI | 호출자 `myProtocolURI()` |
| `pid` | 바로 앞 호출자 requestId | 호출자 `requestId` |
| `iat` | 서명 시각 (epoch 초) | 송신 시각 |

- 화이트리스트 밖의 identity 값(`meta`·토큰·`accessKey`·`apiKey` 등)은 싣지 않는다.
- `cookie`·`authorization`·`referer`·`origin`·`clientIp`·`userAgent`·`domain`은 싣지 않는다.
- 수신 함수의 context:
  - `identity` = `idt`
  - `channel` = `internal`
  - `depth` = `hop`
  - `source` = `src`
  - `trace` = `{ tid, hop, via, pid }`
  - `requestId`·`accountId` = 수신 함수 자기 값
- hop 상한: `PROTOCOL_MAX_HOP` (기본 8). 넘으면 `508 LOOP DETECTED - protocol hop <n>`. 무한 호출 사슬을 운영에서 끊는다.

### D3. traceability

- `context.trace = { tid, hop, via?, pid? }`. 외부 진입은 `{ tid: requestId, hop: 0 }`이다.
- 진입마다 로그 한 줄: `TRACE tid=<tid> hop=<hop> ch=<channel> via=<via|-> src=<path>`. identity 값은 찍지 않는다.
- CloudWatch Logs Insights에서 `tid` 하나로 여러 함수의 로그를 이어 본다.
- `doReportError()` 보고에 `trace`를 넣는다.

### D4. `x-protocol-context` deprecated

| 쪽 | env | 값 | 기본 |
| --- | --- | --- | --- |
| 송신 | `PROTOCOL_LEGACY_CONTEXT` | `off`: relay만 보낸다. `send`: relay와 legacy를 함께 보낸다 (v4 수신 함수용) | `off` |
| 수신 | `PROTOCOL_LEGACY_ACCEPT` | `accept`: 받는다. `warn`: 받고 `PROTOCOL deprecated x-protocol-context` 한 줄을 남긴다. `reject`: 거부한다 | `warn` |

- relay와 legacy가 함께 오면 relay를 쓴다.
- legacy로 받은 context는 지금 동작을 유지한다. 단 `channel = internal`을 넣는다. v4 호출자의 하류 동작을 바꾸지 않으려는 것이다.
- `HEADER_PROTOCOL_CONTEXT`에 `@deprecated`를 단다. v6에서 지운다.
- 송신 기본이 `off`인 이유: v5 송신 함수는 지금 templates-api뿐이다. templates-api는 v4 서비스를 부르지 않는다.
- DoU 이관 중 설정:

| 단계 | 이관된 서비스(v5)의 설정 |
| --- | --- |
| 일부만 v5 | 송신 `PROTOCOL_LEGACY_CONTEXT=send` (아직 v4인 수신 함수용). 수신 `PROTOCOL_LEGACY_ACCEPT=warn` (아직 v4인 호출자용) |
| 모두 v5 | 송신 `off`. 수신 `warn`을 유지하고 `PROTOCOL deprecated` 줄이 0인지 본다 |
| `deprecated` 줄 0 확인 뒤 | 수신 `reject`. 그다음 `enforce`(D6) |

### D5. 운영 도구의 identity

- 지금 도구(`lambda:invoke --identity`, `loop:check`, `fields:admin`)는 서명 없는 JSON `x-lemon-identity`를 보낸다. `enforce`에서는 403이다.
- 도구는 KMS 비대칭 키로 서명한 짧은 JWT를 `x-lemon-identity`로 보낸다. lemon-core는 `kms/*` issuer JWT를 이미 검증한다(`parseIdentityJWT`, `docs/header-identity-token.md`).
- JWT: `iss = kms/<alias>`, `sid`, `roles`, `exp = now + 300`. 운영자에게 `kms:Sign` 권한이 필요하다.
- 서명 없는 JSON identity는 D4와 같은 길로 deprecated 처리한다(`enforce`에서 거부, 그 밖에는 경고).

### D6. 검증 모드 전환

- templates-api dev에 `PROTOCOL_SIGN_KEY`를 두고 `PROTOCOL_VERIFY`를 `warn` → `enforce`로 올린다. 절차는 B10-verify-enforce 런북을 따른다.
- env 파일과 배포는 사람이 한다.

## 4. 작업 묶음과 우선순위

**마일스톤 목적:** 하류가 채널과 출처를 혼동하지 않고, hop을 지나도 identity와 trace가 이어지게 한다.
**목표 상태:** templates-api dev에서 protocol 2-hop 사슬이 relay만으로 돌고, `tid` 하나로 두 함수 로그가 이어진다. `x-protocol-context`는 송신되지 않는다.

| 우선 | WP | 내용 | 왜 |
| --- | --- | --- | --- |
| **P0** | WP1 lemon-model | `NextContext`에 `channel?`·`trace?` 타입 | 모든 단계가 이 타입을 쓴다 |
| **P0** | WP2 lemon-core 채널 | D1. 진입별 `channel`, `fields/admin` 게이트 전환, spec | 판정 신호를 하나로 |
| **P0** | WP3 lemon-core relay | D2·D3·hop 상한·D4 모드. 송신 3 transformer, 수신 web·SNS·SQS, spec (v4 호출자 호환, 크기 측정) | 최소 relay와 trace |
| **P0** | WP4 templates-api 적용 | lemon-core 새 버전 소비. callback proxy·루프 테스트를 relay로. `loop-recv`는 `channel`·`trace.hop`으로 판정. dev 실증 | 실제 경로 확인 |
| P1 | WP5 도구 JWT | D5. `bin/lib`에서 KMS JWT 발급, `loop:check`·`lambda:invoke`·`fields:admin` 적용 | `enforce`에서도 도구가 동작 |
| P1 | WP6 모드 전환 | D6. dev 키와 `enforce` | IAM만으로 admin 주장 차단 |
| P2 | WP7 | local transport가 relay를 그대로 쓰는지 확인 (같은 transformer) | 로컬과 Lambda 같은 경로 |
| P2 | WP8 | DoU 다섯 repo의 v5 이관(B13 뒤 별도 진행). D4 이관 중 설정표를 따른 뒤 `PROTOCOL_LEGACY_ACCEPT=reject` | legacy 수신 종료 |

**P0 최소 경로:** WP1 → WP2·WP3 → WP4. 개발 중에는 `npm link`로 lemon-model → lemon-core → templates-api를 잇는다. 릴리스는 lemon-model → lemon-core → templates-api 순서다.

## 5. 검증 계획

| 단계 | 검증 |
| --- | --- |
| WP1 | `tsc`, lemon-model 테스트 |
| WP2 | spec: 진입 넷의 `channel`. Host 없음 + `domainName` 있음 이벤트가 `internal`. protocol 수신이 `internal`. `fields/admin`이 `channel`로 판정 |
| WP3 | spec: relay 왕복(web·SNS·SQS), 서명 일치·불일치, 화이트리스트 밖 값 제외, hop 상한 508, legacy 세 모드, relay와 legacy 동시 수신, v4 호출자 이벤트 수신, relay 크기(대표 context 대비) |
| WP3 | 전체 `npm test`가 기준선과 같은 실패만 낸다. `api-check`, `esm:smoke`, `dup:check` |
| WP4 | templates-api 루프 spec, mock spec, 로컬 `loop:check --target express`, dev `loop:check --stage dev`, dev 로그에서 `tid`로 두 함수 줄 잇기 |

## 6. 오너가 정할 값

| 값 | 기본 (제안) |
| --- | --- |
| `PROTOCOL_LEGACY_CONTEXT` 기본 | `off` |
| `PROTOCOL_LEGACY_ACCEPT` 기본 | `warn` |
| `PROTOCOL_MAX_HOP` | 8 |
| relay 헤더 이름 | `x-lemon-relay` |
| 도구 JWT의 KMS 키 alias (WP5) | 미정 |
| dev `enforce` 전환 시점 (WP6) | WP5 뒤 |

## 7. 범위 밖

- DoU repo 코드 변경. DoU v5 이관은 B13 뒤 별도로 진행한다.
- relay 암호화. relay는 서명만 한다. 값은 base64url이라 읽을 수 있다. 그래서 화이트리스트에 비밀 값을 넣지 않는다.
- API Gateway·ALB 설정 변경.
