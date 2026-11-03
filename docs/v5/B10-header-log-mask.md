# v5 B10 — 민감 헤더 로그 마스킹

상태: 2026-10-30 `feat/v5-b10-3-header-log-mask`에 구현 (기준 `v5` @ `96608d14`, #238 머지 뒤). B10 묶음 항목 3 "`x-protocol-context` 헤더는 필요할 때만(로그)". 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 13.3.

## 배경

`LambdaHandler.findService()`(`src/cores/lambda/lambda-handler.ts`)는 모든 이벤트의 헤더 전체를 `_log(NS, '> headers =', $U.json(headers))`로 남긴다. CloudWatch에 다음 값이 그대로 찍힌다.

- `authorization`: Bearer 토큰.
- `cookie`: 세션 쿠키.
- `x-protocol-context`: 내부 호출 context JSON.
- `x-protocol-signature`: 내부 호출 서명(B5).
- `x-lemon-identity`: 내부 호출 identity JSON 또는 JWT.

헤더를 지우면 경로 판정(`findService()`, `isExternal()`, B5 신뢰 경계)이 바뀐다. 그래서 헤더는 그대로 두고 로그에서만 값을 가린다(PLAN T14 판정).

같은 결의 지점:

- `LambdaNotificationHandler.packNotificationParamBody()`(`lambda-notification-handler.ts`): `_inf(NS, '! event.headers =', $U.json(event.headers))`. SNS HTTP 구독 알림의 헤더 전체.
- `MyHttpHeaderTool.signToken()`(`lambda-web-handler.ts`): KMS·HS256 서명 값 자체를 `_inf`로 남긴다.
- `MyHttpHeaderTool.parseIdentityHeader()`(`lambda-web-handler.ts`): 파싱 실패 시 `_err(NS, '!WARN! identity =', val)`로 identity 헤더 원문을 남긴다. 전수 조회에서 찾았다.

전수 조회: `grep -rn --include='*.ts' -E "_(log|inf|err)\(.*(headers|authorization|cookie|x-protocol|identity|signature)" src | grep -v spec`. 9건이 걸린다. 위 5건(주석 처리된 줄 1건 제외)을 고쳤다. 나머지 3건은 범위 밖이다(§ 영향).

## 변경

새 내부 모듈 `src/lib/log-mask.ts`. `safe-json.ts`·`qs-compat.ts`와 같은 규칙이다. `lib/index.ts`와 다른 barrel에서 내보내지 않는다. 다른 모듈을 import하지 않는다.

- `maskValue(v)`: `[masked:<String(v).length>]`. 원문 글자를 남기지 않는다(접두 노출 없음). 빈 문자열은 `[masked:0]`.
- `maskHeaders(headers, extra?)`: 민감 키의 값을 `maskValue()`로 바꾼 새 객체를 돌려준다. 키는 소문자로 비교한다. 배열 값(`multiValueHeaders` 꼴)은 원소마다 가린다. 입력은 바꾸지 않는다. `null`·`undefined`는 `{}`다.
- `SENSITIVE_HEADERS`: 표준 이름 6개 — `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-amz-security-token`.
- lemon 프로토콜 이름 3개는 호출자가 `extra`로 넘긴다. 목록은 `src/cores/protocol/protocol-sign.ts`의 `PROTOCOL_LOG_MASKED_HEADERS` 하나다 — `HEADER_PROTOCOL_CONTEXT`·`HEADER_PROTOCOL_SIGNATURE`·`HEADER_LEMON_IDENTITY`. env로 이름을 바꾸면 마스킹도 따라간다.

상수 자리 이동:

- `HEADER_PROTOCOL_CONTEXT`를 `protocol-service.ts`에서 `protocol-sign.ts`로 옮겼다. `protocol-service.ts`는 같은 이름으로 다시 내보낸다. `protocol-service.ts`는 클래스 정의 시점에 `LambdaHandler.REPORT_ERROR`를 읽는다. 그래서 `lambda-handler.ts`가 `protocol-service.ts`를 import하면 적재 순환으로 깨진다. `protocol-sign.ts`는 `engine`·`config`만 import한다.
- `HEADER_LEMON_IDENTITY`를 `lambda-web-handler.ts`의 비공개 상수에서 `protocol-sign.ts`로 옮겼다. 같은 이유다. env 이름·기본값은 같다.

적용한 곳:

| 파일 | 위치 | 전 | 후 |
| --- | --- | --- | --- |
| `src/cores/lambda/lambda-handler.ts` | `findService()` | `$U.json(headers)` | `$U.json(maskHeaders(headers, PROTOCOL_LOG_MASKED_HEADERS))` |
| `src/cores/lambda/lambda-notification-handler.ts` | `packNotificationParamBody()` | `$U.json(event.headers)` | `$U.json(maskHeaders(event.headers, PROTOCOL_LOG_MASKED_HEADERS))` |
| `src/cores/lambda/lambda-web-handler.ts` | `signToken()` KMS·HS256 2곳 | `signature` | `maskValue(signature)` |
| `src/cores/lambda/lambda-web-handler.ts` | `parseIdentityHeader()` 실패 로그 | `val` | `maskValue(val)` |
| `src/cores/lambda/lambda-web-handler.ts` | `prepareContext()` `identity(req)`·`identity(new)` 2곳 | `$U.json($req)`·`$U.json({ ...$idt })` | `maskHeaders(…, IDENTITY_LOG_MASKED_FIELDS)` — `apiKey`·`accessKey` 만 가림(코디네이터 결정) |

판정 로직은 원래 `headers`를 그대로 읽는다. 마스킹본은 로그 인자로만 쓴다. 메시지 문구는 그대로다. `$U.json()`은 바꾸지 않았다.

## 검증

- `src/lib/log-mask.spec.ts`(새, 7건): `maskValue()` 길이·빈 문자열·비문자열, 표준 목록 소문자, 대소문자 혼용 키(`Authorization`·`COOKIE`·`X-Protocol-Context`) 마스킹과 비민감 키(`host`·`content-type`·`x-amz-sns-message-type`) 보존, `extra` 없이는 표준 목록만, 배열·비문자열·빈 문자열, `null`·`undefined` → `{}`, 입력 불변. 결과 JSON에 토큰·쿠키·context 원문과 부분 문자열이 없다.
- `src/cores/lambda/lambda-handler.spec.ts`(+1건): `authorization`·`x-protocol-context`·`cookie`가 든 web 이벤트에서 `findService()`가 `'web'`을 돌려준다. `$engine.$console.log` spy로 로그에 `[masked:<len>]`가 있고 원문이 없음을 확인한다. 이벤트 헤더 원문은 그대로다.
- 재현(임시 spec, 커밋하지 않음): `findService()` 로그 `"Authorization":"[masked:27]"`·`"x-protocol-context":"[masked:15]"`, 알림 핸들러 로그 `"x-lemon-identity":"[masked:7]"`, `signToken()` HS256 로그 `[masked:43]`(서명 원문 없음), `parseIdentityHeader()` 실패 로그 `[masked:18]`.
- `npx vitest run` (log-mask·lambda-handler·lambda-notification-handler·lambda-web-handler spec): 4 files, 52 passed. `LS=1`과 없이 모두 통과.
- `npx tsc --noEmit` 오류 0. 바꾼 `.ts`의 `npx eslint` 오류 0(기존 경고 3건). `npx prettier --check`는 `protocol-service.ts`의 기존 줄(`buildProtocolURI(...)` 호출 2곳) 1파일만 걸린다. 이번 변경 줄은 통과한다.

## 영향

- CloudWatch의 헤더 로그에서 민감 헤더 9종의 값이 `[masked:<len>]`으로 바뀐다. 헤더 값으로 디버깅하던 절차는 길이만 보게 된다.
- 서명 로그는 길이만 남는다. 서명 값 대조가 필요하면 요청 쪽에서 본다.
- 경로 판정·응답·헤더 객체는 같다.
- 공개 export 이름(root)은 그대로다. deep 경로 `dist/cores/protocol/protocol-sign`에 `HEADER_PROTOCOL_CONTEXT`·`HEADER_LEMON_IDENTITY`·`PROTOCOL_LOG_MASKED_HEADERS`가 새로 보인다. `dist/cores/protocol/protocol-service`의 `HEADER_PROTOCOL_CONTEXT`는 같은 이름·값으로 남는다.
- `prepareContext()` Cognito 분기의 `identity(req)`·`identity(new)` 로그는 헤더가 아니지만 같은 결이라 넣었다 — `apiKey`(사용량 계획 키, 자격 그 자체)·`accessKey`(임시 IAM 키 id)만 `[masked:<len>]`. `cognitoIdentityId`·`accountId`·`userAgent` 등은 그대로 찍힌다. `NextIdentity` 객체 자체는 바꾸지 않는다(로그 인자만).
- 범위 밖으로 둔 로그 1건:
  - `src/extended/abstract-service.ts` `fetchIdentityAccess()`의 `identity[domain]`: 계정 API 응답이다. `@deprecated`(3.2.10부터 쓰지 않음)다.
