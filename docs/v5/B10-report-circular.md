# v5 B10 — 오류 보고의 순환 구조 처리

상태: 2026-10-29 `feat/v5-b10-2-report-circular`에 구현 (기준 `v5` @ `8d105ef5`, lemon-core 5.0.4 + #237). B10 묶음 항목 2 "[core] ERROR - Converting circular structure to JSON 처리 doReportError()". 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 13.2.

## 배경

오류 보고 경로는 모두 맨 `JSON.stringify()`를 썼다.

- `doReportError()`(`src/engine/engine.ts`): `$message(e)`가 `$U.json()`을 쓴다. 그 `_log` 호출은 `try` 밖이다.
- payload `{ service, message, context: { ...context, event }, data }` → `AWSSNSService.reportError()` → `asErrorPayload()`(`src/common/test-helper.ts`): `_msg`·`_pack`이 `JSON.stringify(e)`를 쓴다.
- `AWSSNSService.publish()`: 로그의 `$U.json(payload)`와 `Message.default`의 `JSON.stringify(payload)`가 겹친다.

순환 구조가 들어오는 곳:

- 비-`Error` 객체로 던진 오류. http 응답·axios 오류는 `req` ↔ `res`·`socket`을 가진다.
- `Error`의 `errors`·`cause` 속 객체.
- `data`·`context`(`event` 포함) 안의 객체.

증상:

- `asErrorPayload()`·`publish()`에서 던진 예외는 `reportError()`의 `.catch`가 `'ERROR - Converting circular…'` 문자열로 바꾼다. 프로세스는 죽지 않는다. 보고는 조용히 사라진다.
- `doReportError()`의 `$message(e)`는 `try` 밖이다. `message`·`statusMessage`가 없는 순환 객체이면 `doReportError()`가 reject한다.
- 맨 `JSON.stringify(new Error('x'))`는 `{}`다. 객체 속 `Error`의 메시지가 사라진다.

재현(수정 전): `const r = { statusMessage: 'Bad' }; r.req = { res: r }; asErrorPayload(r, {})` → throw. `e = new Error(); e.errors = [r]`도 같다.

## 변경

새 내부 모듈 `src/lib/safe-json.ts`의 `safeStringify(value, space?)`를 쓴다. `qs-compat.ts`와 같은 규칙이다. `lib/index.ts`와 다른 barrel에서 내보내지 않는다. 공개 export 이름은 그대로다.

- replacer가 조상 경로를 스택으로 추적한다. 조상으로 되돌아오는 참조를 `'[Circular]'`로 바꾼다. 순환이 아닌 공유 참조(`{ a: x, b: x }`)는 그대로 찍는다. 그래서 `WeakSet` 대신 조상 스택을 썼다.
- `Error`는 `{ name, message, stack?, ...own enumerable props }`로 펼친다. 열거되지 않는 `errors`(`AggregateError`)·`cause`(`new Error(m, { cause })`)도 넣는다.
- `BigInt`는 10진 문자열이다.
- 깊이 상한은 없다. 순환만 막는다.
- 그 밖의 값은 `JSON.stringify()`와 같은 문자열이다(키 순서·`toJSON()`·`undefined`/함수 생략).
- 절대 던지지 않는다. 실패하면 `String(value)`, 그것도 실패하면 `'[Unserializable]'`이다.

적용한 곳:

| 파일 | 위치 | 전 | 후 |
| --- | --- | --- | --- |
| `src/common/test-helper.ts` | `GETERR()` 비-`Error` 객체 | `JSON.stringify(e)` | `safeStringify(e)` |
| `src/common/test-helper.ts` | `asErrorPayload()` `_msg` | `JSON.stringify(m)` | `safeStringify(m)` |
| `src/common/test-helper.ts` | `asErrorPayload()` `_pack` | `JSON.stringify(e)` | `safeStringify(e)` |
| `src/cores/aws/aws-sns-service.ts` | `publish()` 로그·`Message.default` | `$U.json(payload)` + `JSON.stringify(payload)` | `safeStringify(payload)` 한 번 |
| `src/engine/engine.ts` | `doReportError()` `$message` | `$U.json(m)` | `safeStringify(m)` |
| `src/engine/engine.ts` | `do_parallel()` 오류 감싸기 2곳 | `JSON.stringify(e)` | `safeStringify(e)` |

`$U.json()`은 바꾸지 않았다. 공개·고빈도 로깅 경로라 범위 밖이다. 선택지: `$U.json()`도 `safeStringify()`로 바꾸면 순환 객체 로그가 던지지 않는다. 대신 `$U.json()`의 예외에 기대는 호출자 동작이 바뀐다. 별도 결정이 필요하다.

## 검증

- `src/lib/safe-json.spec.ts`(새, 6건): 일반 값 11종 + `space`가 `JSON.stringify()`와 같은 문자열, 공유 참조 유지, 순환 객체·자기 참조·순환 배열 → `'[Circular]'`, `Error` + `errors: [순환]`·`cause: 순환`·`AggregateError`·객체 속 `Error` → `message` 보존, `BigInt`, 던지는 getter·`toJSON()`·null-prototype 폴백.
- `src/common/test-helper.spec.ts`(+1건): `asErrorPayload(순환, data)`가 던지지 않고 `message: 'Bad'`·`error`에 `[Circular]`를 담는다. `Error.errors = [순환]`, 순환 `message`, `GETERR(순환)`도 확인한다. 수정 전 코드에서는 실패한다.
- `src/engine/engine.spec.ts`(+2건): `message`·`statusMessage` 없는 순환 객체로 `doReportError()`가 `try` 안 단계(`getHelloArn()`)까지 간다. 수정 전 코드에서는 `Converting circular structure to JSON`으로 reject해 실패한다(되돌려 확인). `do_parallel()`이 순환 reject를 `Error`로 감싼다.
- `npx vitest run` (safe-json·engine·test-helper·aws-sns-service spec): 4 files, 36 passed. `test-helper.spec`의 기존 `environ('LS')` 단언은 셸에 env `LS`가 없으면 실패한다(이번 변경과 무관, `LS=1`로 통과).
- `npx tsc --noEmit` 오류 0. 바꾼 `.ts`의 `npx eslint` 오류 0(기존 경고 5건). `npx prettier --check`는 `engine.ts`의 기존 줄(`getHelloArn()` 안 `arn` 계산) 1곳만 걸린다. 이번 변경 줄은 통과한다.

## 영향

- 순환 구조가 든 오류도 SNS 보고가 나간다. payload 문자열에 `'[Circular]'`가 들어갈 수 있다.
- 비-`Error` 객체 속 `Error`는 `{}` 대신 `{ name, message, stack, … }`로 찍힌다. `asErrorPayload()`의 `error`·`GETERR()` 결과가 그만큼 길어진다.
- 순환·`Error`·`BigInt`가 없는 값은 결과 문자열이 전과 같다.
- `publish()`는 payload를 한 번만 직렬화한다. 로그 문자열과 `Message.default`가 같다.
- `$U.json()`은 그대로다. 순환 객체를 넘기면 여전히 던진다.
