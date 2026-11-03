# v5 B10 — `doReportError()`의 SNS 계정 번호 고르기

상태: 2026-10-29 `feat/v5-b10-6-report-account`에 구현 (기준 `v5` @ `dcd52684`, lemon-core 5.0.4). B10 묶음 항목 6. 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 13.1.

## 배경

로컬 express 실행기(lemon-devkit)는 `requestContext.accountId`에 OS 사용자명(env `USER`, 없으면 `LOGNAME`)을 넣는다. `prepareContext()`는 이 값을 `NextContext.accountId`로 옮긴다. `getHelloArn()`은 `NextContext.accountId`를 1순위로 썼다. 그래서 `arn:aws:sns:<region>:<사용자명>:lemon-hello-sns` 같은 잘못된 ARN이 나왔다.

- `invokedFunctionArn`이 있어도 context 값이 이겼다.
- 이 context는 `x-protocol-context`로 하류 람다에 전파된다. 하류에서도 같은 잘못된 ARN이 나왔다.
- `doReportError()`의 무시 조건 `context.source === 'express'`는 실제로 맞지 않았다. `packContext()`가 `source`를 protocol URI로 덮어쓰기 때문이다(B10 항목 1 이후도 같다).

## 변경

`src/engine/engine.ts`만 바꿨다. 공개 export 이름과 `getHelloArn()` 시그니처는 그대로다.

- `getHelloArn()`
  - env `REPORT_ERROR_ARN`이 `arn:aws:sns:`로 시작하면 그 값을 쓴다(변경 없음).
  - 계정 번호 후보 순서: ① `invokedFunctionArn`의 5번째 칸 → ② `NextContext.accountId` → ③ `RequestContext.accountId`.
  - 각 후보는 12자리 숫자(`/^\d{12}$/`)일 때만 받는다.
  - 전부 탈락하면 `.accountId[] is missing - getHelloArn(<NS>)`를 던진다. 탈락한 값은 오류 메시지에 넣지 않는다. 오류 로그의 context 덤프에서도 `accountId`를 뺀다.
  - region은 지금처럼 `invokedFunctionArn`의 4번째 칸이고, 없으면 `ap-northeast-2`다.
- `doReportError()`·`doReportSlack()`: 무시 조건에 `$U.isLocalMode()`를 더했다. 로컬 모드(`LOCAL_MODE=1`이고 `AWS_LAMBDA_FUNCTION_NAME` 없음)에서는 `_err`로 내용만 찍고 `'!ignore'`를 돌려준다. 기존 조건(`source === 'express'`, `accountId === ''`)은 그대로다.

| 입력 | v4·5.0.4 | 이번 변경 |
| --- | --- | --- |
| Lambda 안, context `accountId` = 다른 계정 | context 계정 | `invokedFunctionArn` 계정(자기 계정) |
| context `accountId` = OS 사용자명, `invokedFunctionArn` 있음 | 사용자명으로 ARN | `invokedFunctionArn` 계정 |
| context `accountId` = OS 사용자명, `invokedFunctionArn` 없음 | 사용자명으로 ARN | 오류(값은 메시지에 없음) |
| context `accountId` = 12자리, `invokedFunctionArn` 없음 | 그 값 | 그 값 |
| 로컬 모드에서 `doReportError()` | SNS 발행 시도 | `'!ignore'` |

이유: Lambda 안에서는 `invokedFunctionArn`이 항상 있고 자기 계정이 확실하다. 호출자 context의 `accountId`는 교차 계정 호출이면 남의 계정이다.

## 검증

- `src/engine/engine.spec.ts`: 새 케이스 5건(12자리 아님·사용자명 거부와 메시지 비노출, `invokedFunctionArn` 우선, 12자리 context 값, 로컬 모드 `'!ignore'`). 기존 `doReportError() - account id` 단언은 고치지 않고 통과한다.
- `npx vitest run` (engine·lambda-web-handler·aws-sns-service spec): 3 files, 43 passed. engine spec 17 passed.
- `npx tsc --noEmit` 오류 0. 바꾼 `.ts`의 `npx eslint` 오류 0(기존 경고 1건), `npx prettier --check` 통과.

## 영향

- Lambda 안에서는 SNS 대상이 항상 자기 계정이다. 교차 계정 호출을 받은 하류 람다도 자기 계정의 `lemon-hello-sns`로 보낸다.
- 로컬에서 `doReportError()`·`doReportSlack()`이 SNS에 닿기를 기대했다면 이제 `'!ignore'`다. 로컬에서 발행을 시험하려면 `LOCAL_MODE`를 끄고 `REPORT_ERROR_ARN`을 준다.
- `doReportCallback()`은 무시 조건이 없다. `getHelloArn()`의 새 후보 순서만 적용된다.
- `MyHttpHeaderTool.getAccountId()`는 `getHelloArn(null)`을 부른다. env `REPORT_ERROR_ARN`이 없으면 지금처럼 STS로 넘어간다(변경 없음).
- protocol SNS·SQS 변환기(`protocol-service.ts` `SNSProtocolTransformer`·`SQSProtocolTransformer`)도 `getHelloArn(param.context)`으로 TopicArn·QueueUrl의 region·계정을 뽑는다. 운영 context의 `accountId`는 12자리(API Gateway·`invokedFunctionArn`)라 바뀌는 것이 없다. 로컬 실행기(OS 사용자명)에서는 전에도 잘못된 URL로 AWS 호출이 실패했고, 이제는 `.accountId[] is missing`으로 더 일찍 실패한다. `REPORT_ERROR_ARN`을 주면 그 ARN의 region·계정을 쓴다(전과 같음). spec 픽스처 `protocol-sign.spec` `accountId: 'acc-1'` → 12자리 더미.
- 로컬 실행기가 `accountId`에 OS 사용자명을 넣는 동작은 lemon-devkit 쪽 후속이다.
