# v5 B10 — `PROTOCOL_VERIFY=enforce` 전환 런북

상태: 2026-10-30 `feat/v5-b10-4-verify-enforce`에 작성 (기준 `v5` @ `96608d14` + #239 B10-3 위에 쌓음). 코드 변경 2(§ C1 — config 복호값 로그 마스킹, `protocol-service.ts` 주석의 계정 번호를 더미로). 검증 로직·모드·env 이름은 바꾸지 않았다. B10 묶음 항목 4 "람다 내/외부 호출 구분 — `PROTOCOL_VERIFY=enforce` 전환". 서명 형식·모드 정의는 `docs/v5/B5-trust-boundary.md` § 1. 서비스별 전환 단계는 `docs/v5/B6-dou-migration.md` § 6(Stage C). 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 13.4.

## 배경

B5(K10)는 내부 호출에 HMAC-SHA256 서명을 붙였다. 송신은 `protocol-service.ts`의 web·SNS·SQS 변환기다. 수신 검증은 세 곳이다.

| 수신 | 자리 | 검증 대상 |
| --- | --- | --- |
| web | `lambda-web-handler.ts` `packContext()` STEP.1 (`assertSigned('web', …)`) | `host` 헤더가 없는 이벤트 중 `x-protocol-context` 또는 JSON(`{…}`) `x-lemon-identity`가 있는 것 |
| SNS | `lambda-sns-handler.ts` (`assertSigned('sns', …)`) | `Subject`가 `x-protocol-service`인 레코드 |
| SQS | `lambda-sqs-handler.ts` (`assertSigned('sqs', …)`) | 메시지 속성 `Subject`가 `x-protocol-service`인 레코드 |

모드는 `readVerifyMode()`가 정한다. `PROTOCOL_VERIFY`가 `off`·`warn`·`enforce`이면 그 값이다. 값이 없으면 키(`PROTOCOL_SIGN_KEY`)가 있을 때 `warn`, 없을 때 `off`다.

지금 `warn`인 이유: v4 호출자는 서명하지 않는다. `warn`은 무서명·불일치 호출을 받아들이고 `PROTOCOL unsigned <web|sns|sqs> (<reason>)` 한 줄(`_inf`)만 남긴다. `enforce`는 같은 호출을 거부한다.

**enforce가 막는 것.** 외부 요청은 대상이 아니다. `host` 헤더가 있는 web 이벤트(API Gateway·ALB·Function URL)는 모든 모드에서 외부다. 외부 요청에 `x-protocol-context`를 붙여도 이미 버려진다(B5 § 1, `HOW_TO_UPGRADE_V5.md` § 11.2). enforce의 실제 대상은 "host 없는 이벤트 = 내부 경로(직접 Lambda invoke, SNS, SQS)로 들어온 무서명 또는 불일치 context"다. 이 경로에 들어오려면 이미 `lambda:InvokeFunction` 또는 주제·큐 게시 권한이 있어야 한다. 그래서 enforce는 "권한은 있지만 서명 키가 없는 호출자"를 막는다. 예: v4 서비스, 키를 받지 않은 서비스, 다른 언어로 JSON `x-lemon-identity`를 보내는 호출자, 손으로 만든 테스트 이벤트.

거부 사유(`reason`)와 뜻:

| reason | 뜻 |
| --- | --- |
| `missing` | 서명 없음. v4 호출자 또는 키 없는 v5 호출자 |
| `mismatch` | 서명은 있으나 값이 다름. 키가 다르거나 context·본문이 바뀜 |
| `stale` | web만. 서명 시각과 `abs(now - ts) > 300` 초 |
| `format` | `v1.<ts>.<sig>` 꼴이 아님 |
| `no-key` | 수신 함수에 키가 없음. 모드를 `warn`·`enforce`로 명시했을 때만 나온다 |

**중간 상태의 위험.**

- 호출자 중 하나라도 v4(무서명)이면 enforce는 그 호출을 끊는다. web은 403, SNS는 보고 후 처리하지 않음, SQS는 레코드 실패다.
- 수신 함수에 키가 없는데 `enforce`를 넣으면 모든 내부 호출이 `no-key`로 거부된다. 키 확인(C1)이 먼저다.
- 키가 없으면 모드는 `off`다. 이때 `PROTOCOL unsigned`는 늘 0이다. 0은 "서명이 맞음"이 아니라 "검사하지 않음"이다.

서명 v2(canonical에 method·path 추가, Q14)는 이 런북 범위 밖이다. 별건이다.

## 현황

### 다섯 DoU repo (2026-10-30, `origin/develop`, 읽기 전용)

| repo | `lemon-core` (`package.json`) | `src/cores/` 사본 | 마지막 커밋 | 서명 송신 |
| --- | --- | --- | --- | --- |
| `chatic-backend-api` | `^4.3.0` | 없음 | 2026-10-29 | 없음 |
| `chatic-pushes-api` | `^4.3.0` | 없음 | 2026-09-11 | 없음 |
| `chatic-sockets-api` | `^4.3.0` | 없음 | 2026-10-26 | 없음 |
| `chatic-socials-api` | `^4.3.0` | 없음 | 2026-10-20 | 없음 |
| `chatic-iap-api` | `^4.1.15` | 유지 | 2026-09-16 | 없음 |

- lemon-core 4.3.0은 2026-09-01에 게시된 v4 계열이다. `npm pack --dry-run` 파일 목록에 `protocol-sign`이 없다. 그래서 4.3.0 호출자는 서명을 보내지 않는다. 4.3.0 수신자는 검증도 하지 않는다.
- 네 repo는 사본을 지웠지만 v5가 아니라 4.3.0이다. iap는 사본이 있고 4.1.15다.
- 결론: **전제 미충족.** 다섯 repo 모두 B 단계(v5 + 사본 제거) 전이다.
- 다섯 repo의 `$protocol` 호출 종류(src, spec 제외, `origin/develop` grep): `execute`(web), `notify`(SNS), `enqueue`(SQS) 셋 다 쓴다. `useEvent`(비동기 invoke)는 0이다.
- iap를 뺀 네 repo의 `serverless.yml`에 1분 cron(`cron(0/1 * * * ? *)`)이 하나씩 있다. cron 이벤트 자체는 서명 검증 대상이 아니다. cron이 부르는 작업이 내부 호출을 낼 수는 있다.

호출 그래프(`docs/v5/B6-dou-migration.md` § 3). 화살표는 "호출자 → 수신자"다. 서명 짝은 8개다.

| 수신자 | 호출자 |
| --- | --- |
| `chatic-backend-api` | sockets, socials |
| `chatic-sockets-api` | backend, socials |
| `chatic-pushes-api` | backend, sockets |
| `chatic-socials-api` | backend, sockets |
| `chatic-iap-api` | backend |

내부 web 호출의 전송은 `invokeLambda`(직접 Lambda invoke, `protocol-service.ts` `execute()`)다. HTTP가 아니다. 그래서 내부 web 이벤트에는 `host`가 없다.

### v5 배포 함수: lemon-templates-api dev

v5를 쓰는 배포 함수는 `lemon-templates-api-dev-lambda` 하나다.

[코디네이터 실측] 2026-10-30, 로그 그룹 보존 14일 → 창은 14일:

| 항목 | 값 |
| --- | --- |
| `Environment.Variables.PROTOCOL_VERIFY` | 미설정(`null`) |
| env의 `PROTOCOL_SIGN_KEY` 이름 | 없음 |
| 실효 모드 | `off` (키 없음) |
| `PROTOCOL sign key not set — contexts unsigned` | 22줄 (콜드 기동마다 1줄) |
| `PROTOCOL unsigned` | 0줄 (source별: web 0, sns 0, sqs 0) |
| Invocations 합 | 143 |
| 로그 그룹 보존 | 14일 |

[코디네이터 실측] 해석: 키가 없으므로 모드는 `off`다. `unsigned` 0은 서명 짝이 맞아서가 아니라 검증하지 않아서다. C1(설치 키)이 dev에서도 아직 안 됐다.

## 전환 전제 체크리스트

한 함수에 enforce를 넣기 전에 아래 다섯 항목이 모두 참이어야 한다. C1~C4는 `docs/v5/B6-dou-migration.md` § 6의 번호와 같다. C5는 B6의 "enforce 전환" 직전에 보는 모드 확인이다.

**C1. 설치 키.** 설치 안의 모든 함수(templates-api + 다섯 DoU repo의 모든 함수)가 같은 `PROTOCOL_SIGN_KEY`를 갖는다.

- 키는 설치 config의 `*`(KMS 암호문) 값으로 넣는다. 평문 키를 env에 넣지 않는다.
- 근거: `protocol-sign.ts` `readConfig()`는 먼저 `$conf.config.get(name)`을 읽는다. config 서비스 `init()`이 `*`로 시작하는 값을 KMS로 복호화해 둔 값이다. config가 아직 없을 때만 `process.env`를 읽고, 이때 `*`로 시작하는 암호문은 쓰지 않는다.
- 값은 이 문서·PR·로그에 쓰지 않는다. 이름과 경로만 쓴다.
- 확인: 함수 env에 이름이 있다(아래 측정 1-b). 창 동안 `PROTOCOL sign key not set` 0줄(측정 3).
- 키 배포는 배포 레인(Steve) 일이다.
- **C1 전 수정(이 PR).** `config-service.ts` `init()`은 KMS로 복호화한 모든 값의 앞 12자를 `_log(NS, '> config[KEY] :=', …)`로 찍었다. 키를 `*` 값으로 넣으면 키 앞 12자가 CloudWatch에 남는다. 이제 값 대신 `[masked:<길이>]`(B10-3 `lib/log-mask.ts` `maskValue`)를 찍는다. 다른 `*` 값(토큰·비밀번호)도 같이 가려진다. 복호 실패 로그(`ERR@KEY`)는 그대로다.

**C2-a. 다섯 repo B 단계 완료.** repo마다 세 가지를 본다.

- `package.json`의 `lemon-core`가 `^5`다: `git show origin/develop:package.json | grep '"lemon-core"'`.
- `src/cores/`가 없다: `git ls-tree -d origin/develop src/cores` 출력이 비어 있다.
- 배포 함수의 Runtime이 `nodejs24.x`다(C4): 측정 1-c.
- 배포본의 lemon-core 버전을 보고 싶으면 templates-api의 `fields:admin --target lambda --name "$FN" --type <type>` 요약 줄 `lemon-core=<version>`을 본다. `bin/README.md` 기준이다. DoU 함수에 실행해 보지는 않았다.

**C2-b. 수신 함수마다 `PROTOCOL unsigned` 0인 창.**

- 전제: 그 함수의 실효 모드가 `warn`이다. C1이 끝나 `PROTOCOL_VERIFY`가 비어 있으면 `warn`이다. `sign key not set`이 0이어야 `unsigned` 집계가 의미 있다.
- 창 안에서 `PROTOCOL unsigned` 0줄(source·reason 모두, 측정 2).
- 창 안에서 그 함수로 들어오는 서명 짝마다 호출이 한 번 이상 있었다. `warn`에서 검증에 성공한 호출은 로그를 남기지 않는다. 그래서 0줄만으로는 "모두 서명됨"과 "호출 없음"을 구분하지 못한다. 호출자 쪽 `> uri = …` 줄로 짝마다 호출 수를 센다(측정 4). 0인 짝은 그 기능을 한 번 실행하거나 창을 늘린다.
- 창 길이 권고: **7일과 가장 긴 배치·cron 주기 중 긴 것.** 근거: 가장 드문 경로가 한 번 이상 지나가야 한다. DoU 경로마다 빈도를 재지 않았다. 사용자 행위로 생기는 호출은 요일 차이가 있어 7일이면 한 주기를 덮는다. 1분 cron 안에서 하루·주 단위로 도는 작업이 있으면 그 주기가 하한이다.
- 상한은 로그 그룹 보존 기간이다. templates-api dev는 14일이다. DoU 함수의 보존 기간: [코디네이터 실측 2026-10-30] 다섯 서비스의 dev·prod `lambda`·`backend`(sockets는 `socket` 포함) 로그 그룹 26개 모두 14일(측정 1-d). 같은 접두에 `chatic-archive-api`(dev·prod) 로그 그룹도 있다 — 호출 그래프 밖이라 이 런북은 다루지 않는다. 필요한 창이 보존보다 길면 보존 기간 안에서 여러 번 재고 집계값을 남긴다.
- 창의 시작은 "마지막 호출자가 v5로 배포된 시각"보다 뒤다.

**C3. SQS 실패가 보이는 자리와 남은 메시지.**

- SQS 이벤트 소스에 `ReportBatchItemFailures`가 있으면 enforce로 거부된 레코드는 재시도 후 DLQ로 간다. 없으면 `batchItemFailures`는 무시되고 메시지는 지워진다(v4와 같음). 어느 쪽인지 함수마다 적는다.
- 큐와 DLQ에 v4 시기(무서명) 메시지가 없다. DLQ에 남은 메시지는 창 동안 수신 함수에 오지 않으므로 C2-b가 잡지 못한다. enforce 뒤 redrive하면 거부된다. 확인: `aws sqs get-queue-attributes --queue-url "$QURL" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible`. 큐 URL에는 계정 번호가 있으니 문서에 쓰지 않는다.

**C4. Runtime `nodejs24.x`.** C2-a에서 함께 본다.

**C5. 현재 모드.** 전환할 함수의 `PROTOCOL_VERIFY`가 비어 있거나 `warn`이다(측정 1-a). `off`로 명시돼 있으면 C2-b 창이 무효다. `warn`으로 바꾸고 창을 다시 잰다.

## 측정 명령

변수:

```sh
FN="<service>-<stage>-<fn>"            # 예: lemon-templates-api-dev-lambda
START=$(( ($(date +%s) - 14*86400) * 1000 ))   # 창 시작(ms). 14 = 일 수, 보존 기간 이하
```

`--profile`·`--region`은 각자 환경에 맞게 붙인다. 계정 번호·ARN은 명령과 기록에 넣지 않는다.

**1. 함수 설정(값 하나씩).** env 전체를 찍지 않는다. env에는 다른 비밀 값·암호문·ARN이 함께 있어 터미널·로그·문서로 샌다.

```sh
# 1-a. 모드 (미설정이면 None)
aws lambda get-function-configuration --function-name "$FN" \
  --query 'Environment.Variables.PROTOCOL_VERIFY' --output text
# 1-b. 키 이름 유무만 (true/false, 값은 찍지 않음)
aws lambda get-function-configuration --function-name "$FN" \
  --query 'contains(keys(Environment.Variables), `PROTOCOL_SIGN_KEY`)' --output text
# 1-c. Runtime
aws lambda get-function-configuration --function-name "$FN" --query 'Runtime' --output text
# 1-d. 로그 보존 일수 (창의 상한)
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/$FN" \
  --query 'logGroups[].retentionInDays' --output text
```

**2. `PROTOCOL unsigned` source·reason별 건수.**

```sh
aws logs filter-log-events --log-group-name "/aws/lambda/$FN" --start-time "$START" \
  --filter-pattern '"PROTOCOL unsigned"' --query 'events[].[message]' --output text \
  | grep -oE 'PROTOCOL unsigned (web|sns|sqs) \([a-z-]*\)' | sort | uniq -c
```

- 출력이 없으면 0이다.
- `--query 'length(events)'`는 쓰지 않는다. CLI가 페이지마다 따로 적용해 숫자가 여러 개 나온다.
- `events[].message`(괄호 없음)에 `--output text`를 쓰면 한 페이지의 메시지가 탭으로 이어진 한 줄이 된다. 그래서 `grep -c .`는 페이지 수를 센다. `events[].[message]`는 이벤트마다 한 줄이다. 그래도 줄 수 대신 `grep -o`로 일치 건수를 센다.

**3. `PROTOCOL sign key not set` 0 확인.**

```sh
aws logs filter-log-events --log-group-name "/aws/lambda/$FN" --start-time "$START" \
  --filter-pattern '"PROTOCOL sign key not set"' --query 'events[].[message]' --output text \
  | grep -o 'PROTOCOL sign key not set' | wc -l
```

콜드 기동마다 1줄이다. 0이 아니면 C1 미완료이고, 그 창의 측정 2는 의미가 없다.

**4. 호출자 쪽 짝별 호출 수.** 호출자 함수에서 잰다. `execute()`는 `> uri = …`, `notify()`·`enqueue()`는 `> uri[<service>] = …`를 `_inf`로 남긴다. URI의 계정 부분은 지운다.

```sh
aws logs filter-log-events --log-group-name "/aws/lambda/$CALLER_FN" --start-time "$START" \
  --filter-pattern '"> uri"' --query 'events[].[message]' --output text \
  | grep -oE '(web|sns|sqs)://[^/ #?]+' | sed -E 's#://[0-9]+@#://#' | sort | uniq -c
```

`self`나 자기 서비스로 가는 줄은 짝이 아니다. 수신자 이름별 건수를 C2-b의 짝 표에 적는다.

**5. 호출 수(참고).**

```sh
aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations \
  --dimensions Name=FunctionName,Value="$FN" \
  --start-time "$(date -u -v-14d +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 1209600 --statistics Sum --query 'Datapoints[].Sum' --output text
```

`date -v`는 macOS 문법이다. GNU는 `date -u -d '14 days ago' …`다. 외부 호출도 포함된 수다.

**lemon-templates-api `bin/lambda-logs.mjs`로 보기.** `--filter`(서버 쪽 패턴)·`--since`·`--name`이 있다(`bin/README.md`). 예:

```sh
npm run lambda:logs -- --stage dev --since 14d --filter '"PROTOCOL unsigned"' \
  | grep -oE 'PROTOCOL unsigned (web|sns|sqs) \([a-z-]*\)' | sort | uniq -c
```

다른 함수는 `--name "$FN"`으로 지정한다. `dev`가 아닌 stage는 `--confirm-stage`가 필요하다.

## 전환 절차

1. **순서.** dev → prod. 한 stage 안에서는 templates-api를 먼저 한다. 그다음 DoU는 iap → pushes → socials → sockets → backend 순이다. 이것은 enforce 를 켜는 수신자 순서이고, DoU 의 v5 전환 순서(`docs/v5/B6-dou-migration.md`, 레인 § 8.2: pushes → sockets → backend → socials → iap)와는 다른 것이다. enforce 는 다섯이 모두 v5 가 된 뒤(C2-a)에만 시작한다. 근거: 호출자가 적고 밖으로 호출하지 않는 수신자(iap 1짝, pushes 2짝)부터 하고, 호출이 가장 많이 모이는 backend를 마지막에 한다. 한 단계에 한 서비스만 바꾼다. 서비스 안의 모든 함수(web 함수와 SNS·SQS 함수)에 같은 값을 넣는다.
2. **env 넣기.** 함수 env에 `PROTOCOL_VERIFY=enforce`를 넣는다. 배포 레인(serverless env, Steve)에서 한다. 이 레인은 `serverless.yml`을 바꾸지 않는다(D24). `aws lambda update-function-configuration`으로 함수 설정을 직접 쓰지 않는다. 그 명령은 env 전체를 바꾸고, 다음 배포가 되돌린다.
3. **전환 직후 확인 3가지.**
   - 기동 로그에 `PROTOCOL sign key not set`이 없다(측정 3, `START`는 배포 시각). 있으면 즉시 되돌린다. 모든 내부 호출이 `no-key`로 거부된다.
   - 403 프로브 1건. host 없는 web 이벤트에 무서명 JSON identity를 실어 보낸다. 기대값은 `http 403`, 본문 `403 NOT ALLOWED - unsigned protocol context`다.

     ```sh
     npm run lambda:invoke -- --stage dev --internal --identity '{}' --path /hello/0
     ```

     `--internal`은 `Host`를 지운다. `--identity '{}'`는 `x-lemon-identity: {}`를 보낸다. `packContext()`는 이를 내부 claim으로 보고 서명을 검사한다(`bin/README.md`, `lambda-web-handler.ts` STEP.1). `packContext()`는 라우팅 전에 돌므로 경로는 아무것이나 된다. 다른 함수는 `--name "$FN"`을 붙인다. 이 프로브는 enforce 뒤에만 보낸다. `warn`에서 보내면 `PROTOCOL unsigned web (missing)` 1줄이 생겨 C2-b 창을 더럽힌다. 403은 오류 보고(`doReportError`)로도 1건 간다.
   - 정상 내부 호출 1건. 서명 짝의 호출자에서 그 수신자를 부르는 기능을 한 번 실행한다. 호출자 로그에 `> uri = web://<수신자>…`가 있고, 응답이 403이 아니고, 수신자 로그에 거부·보고가 없으면 통과다. `lambda:invoke --internal`만 보내는 호출(context·identity 없음)은 서명 검사를 거치지 않으므로 이 확인이 아니다.
4. **SNS·SQS 거부가 보이는 자리.**
   - SNS: 레코드를 처리하지 않고 오류 보고 1건. 핸들러는 resolve하므로 재시도·DLQ가 없다. 메시지는 다시 오지 않는다.
   - SQS: 레코드가 `batchItemFailures`에 들어간다. `ReportBatchItemFailures`가 있으면 재시도 후 DLQ로 간다. 없으면 무시되고 메시지가 지워진다. 오류 보고 1건은 양쪽 다 있다.
5. **관찰.** 전환 뒤 첫 7일은 오류 보고에서 `unsigned protocol context`를 매일 본다.

## 되돌리기

- 함수 env의 `PROTOCOL_VERIFY`를 `warn`으로 바꾸거나 지운다. 지우면 키가 있을 때 `warn`이다. 배포 레인에서 재배포한다.
- 저장 데이터는 바뀌지 않는다. 설정만 바뀐다.
- enforce 동안 거부된 호출은 되살아나지 않는다. web은 호출자가 403을 받았다. SNS 메시지는 버려졌다. SQS는 `ReportBatchItemFailures`가 있을 때만 DLQ에 남는다. 오류 보고의 건을 보고 필요한 것만 다시 처리한다(SQS는 DLQ redrive).

## 영향

- 전환 전(`warn`): host 없는 무서명·불일치 호출을 받아들이고 1줄 로그를 남긴다. v4 호출자도 동작한다.
- 전환 후(`enforce`): 같은 호출을 거부한다. web 403, SNS 레코드 미처리, SQS 레코드 실패. 키가 같은 v5 호출자와 외부 요청(`host` 있음)은 바뀌지 않는다.
- B5의 `domain: 'localhost'` 같은 context claim은 서명이 있을 때만 들어온다. enforce가 그 경로를 닫는다.
