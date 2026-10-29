# v5 B11 — `npm audit --omit=dev` 0건, `query-string`→`qs` 통일, `uuid` 제거

상태: 2026-10-29 `feat/v5-b11-deps-audit`에 구현 (기준 `v5` @ `f8216b8e`, lemon-core 5.0.3). 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 14.

## 배경

기준 커밋의 `npm audit --omit=dev`는 23건(critical 1·moderate 22)이었다. 원인은 셋이다.

| # | 패키지 | 심각도 | 경로 | 비파괴 fix |
| --- | --- | --- | --- | --- |
| 1 | `fast-xml-parser` ≤ 5.6.0 | critical | `@aws-sdk/client-dynamodb`·`lib-dynamodb` → `@aws-sdk/core` ≤ 3.972.0 → `@aws-sdk/xml-builder` ≤ 3.972.18 | 있음 (SDK 상향) |
| 2 | `decode-uri-component` | moderate | `query-string` 7.1.3 (dependencies) | 없음 (`query-string` ≥ 8은 ESM 전용) |
| 3 | `uuid` < 11.1.1 | moderate | `uuid` ^9.0.1 (dependencies) | 없음 (`uuid` 14는 ESM 전용) |

lemon-core는 CJS+ESM 듀얼 빌드다. ESM 전용 패키지로 올리는 길은 CJS 빌드와 맞지 않는다. 그래서 2·3은 의존성을 없앤다.

## 변경

### AWS SDK

- `@aws-sdk/*` 10종을 같은 범위 `^3.1159.0`으로 올렸다: dependencies 2(`client-dynamodb`·`lib-dynamodb`), peerDependencies 하한 8, devDependencies의 같은 8. `package.json` 항목 18개.
- 3.1159.0은 2026-10-28 배포된 최신 3.x다. 이 판의 `@aws-sdk/core` 3.978.7 → `@aws-sdk/xml-builder` 3.972.42는 `fast-xml-parser`에 의존하지 않는다. lock에서 `fast-xml-parser`가 모두 빠졌다(기준: 13벌, 5.2.5·5.7.2).
- `@smithy/*`는 직접 바꾸지 않았다. lock 안의 `@aws-sdk/core`는 1벌(3.978.7)이다.

### `query-string` → `qs`

- 새 내부 모듈 `src/lib/qs-compat.ts`: `qsParse()`·`qsStringify()`. `qs` 옵션과 보정을 한곳에 모았다. `lib/index.ts`에서 내보내지 않는다(`http-fetch.ts`와 같은 규칙). 공개 이름은 그대로 299개다.
- 바꾼 곳: `src/engine/utilities.ts` `qs_parse()`·`qs_stringify()`(`$U.qs`), `src/helpers/helpers.ts` `$protocol()` 콜백 파싱·`createSigV4Proxy()` 쿼리, `src/cores/api/api-service.ts` `createHttpWebProxy()` 쿼리.
- `$U.qs_parse()`의 후처리(`null`→`''`, `/^[1-9][0-9]*$/` → 숫자)는 그대로다. `protocol-service.ts`의 폼 바디 파싱(`qs` 기본 옵션)은 바꾸지 않았다.
- `qs`만으로 `query-string` 7과 다른 부분은 이렇게 맞췄다.

| `query-string` 7 동작 | 맞춘 방법 |
| --- | --- |
| 앞뒤 공백 제거, 맨 앞 `?`·`#`·`&` 하나 제거 | `qsParse()`가 `trim()` 후 `/^[?#&]/` 제거 |
| `a[b]=1` → 키 `'a[b]'` 그대로 | `depth: 0` |
| `a`(값 없음) → `null` | `strictNullHandling: true` |
| 결과 객체에 prototype 없음 | `plainObjects: true` |
| 파라미터 수·중복 키 수 제한 없음 | `parameterLimit: Infinity`, `arrayLimit: Infinity` |
| 결과 키 정렬 | `qsParse()`가 정렬해 새 객체에 복사 |
| 잘못된 `%` 이스케이프가 섞여도 유효한 `%XX` 묶음은 디코드 | `decoder` — 전체 실패 시 `%XX` 묶음마다 UTF-8 바이트로 디코드(잘못된 바이트는 U+FFFD, 선형) |
| stringify: 키 기본 `.sort()` 순서, 배열 `a=1&a=2`, `null` → `a`, `!'()*`도 `%XX` | `sort`, `arrayFormat: 'repeat'`, `strictNullHandling`, `format: 'RFC3986'` |
| stringify: 값은 `String(value)` (객체 → `[object Object]`, 날짜 → `Date.toString()`) | `qsStringify()`가 값(배열 원소 포함)을 먼저 문자열로 바꾼다. `qs`의 중첩·ISO 날짜를 막는다 |

- `package.json` `qs` 하한을 `^6.15.1` → `^6.16.2`로 올렸다. `qs` ≤ 6.15.4는 audit 대상이다(lock은 이미 6.16.2).

### `uuid` → `crypto.randomUUID()`

- `src/engine/utilities.ts` `$U.uuid()`, `src/cores/aws/aws-s3-service.ts` 자동 S3 키. 둘 다 Node 내장 `crypto.randomUUID()`를 쓴다(Node ≥ 24). 출력 꼴(소문자 36자 v4)은 같다.
- `package.json`에서 `query-string`·`uuid`·`@types/uuid`를 뺐다.

## 검증

- 골든 테스트 `src/engine/utilities.qs.spec.ts`: 42건(파일 실행 수 47은 `builder.spec` import로 함께 도는 5건 포함). 기대값은 바꾸기 전 `query-string` 7 코드의 실행 결과다(`x=a%C2b%20c` 1건은 query-string 7.1.3과 따로 1회 대조). 지금 42/42 통과.
  - `$U.qs.parse` 23건(값·키 순서·prototype 없음), 개수 제한 1건, `$U.qs.stringify` 15건, `$protocol()` 콜백 1건, `createSigV4Proxy()`·`createHttpWebProxy()` URL 각 1건.
  - 아래 3건은 의도된 변경으로 새 값을 채택했다(케이스 위 주석).

| 입력 (`$U.qs.parse`) | `query-string` 7 | `qs` |
| --- | --- | --- |
| `constructor=y&hasOwnProperty=z&__proto__=x` | `__proto__` 키 있음 (`'x'`) | `__proto__` 키 없음 (`qs`가 항상 버림, 채택) |
| `a.b=1&x=%E0%A4%A` | `x: '%E0%A4%A'` | `x: '�%A'` (채택) |
| `x=%E0%A4%A%41&y=%FF%41%ED%95%9C` | `x: '%E0%A4%AA'`, `y: '%FFA한'` | `x: '�%AA'`, `y: '�A한'` (채택) |

- `utilities.spec.ts` `check uuid()`: v4 정규식 단언과 두 호출 값이 다른지 단언을 더했다.
- `npm audit --omit=dev`: `found 0 vulnerabilities`. `npm audit`(dev 포함): 9건(critical 2·moderate 7). 모두 dev 경로다(`lemon-devkit` → `request`·`form-data`·`tough-cookie`·`qs`·`uuid`, `vitest`·`@vitest/coverage-v8`·`@vitest/mocker`).
- `npx tsc --noEmit` 0. `npm run build` 성공. `npm run esm:smoke` ok. `npm run api:check` not-allowed 0(current 299).

## 영향

- 소비 repo가 `query-string`·`uuid`를 lemon-core를 통해 간접으로만 받았다면 깨진다. 자기 `package.json`에 직접 넣는다.
- AWS SDK peer 하한이 `^3.1159.0`이다. 소비 repo의 `@aws-sdk/*`가 낮으면 npm이 peer 경고를 낸다. 같은 판으로 올리면 `@aws-sdk/core`가 한 벌이 된다.
- `$U.qs`의 관측 동작은 위 표의 입력을 빼고 같다. 모두 잘못된·위험한 입력이다.
- 의도된 차이 1: `__proto__=…` 쌍은 결과에서 빠진다(qs의 prototype 오염 방지). `constructor`·`hasOwnProperty` 키는 그대로 남는다.
- 의도된 차이 2: 잘못된 바이트는 전부 U+FFFD(query-string 7은 `%XX` 원문 유지, `%C2`만 U+FFFD). `TextDecoder`로 run마다 선형 시간에 디코드한다.
