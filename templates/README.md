# templates — L2 템플릿 층의 정본

`templates/cores/`는 서비스 레포들이 `src/cores/`로 복사해 쓰는 템플릿 층의
**원본(canonical source)**이다. v4.3.0부터 이 폴더가 정본이고, 각 서비스 레포
(골든샘플 lemon-templates-api 포함)의 `src/cores/`는 복사본이다. 파일 상단의
`@origin` 헤더는 이 역전 이전의 역사 기록이다.

## 규칙

- **import 금지.** 이 폴더는 lemon-core의 배포물(dist)에 포함되지 않고 npm tarball에도
  실리지 않는다. lemon-core 소스에서도 이 폴더를 import하지 않는다. 문서화·복사 원본 전용이다.
- **소비는 복사.** 서비스 레포는 `templates/cores/*.ts`를 자신의 `src/cores/`로 복사한다.
  **복사 후 반드시 `npm run fields:gen`을 실행한다** — `abstract-services.ts`가 참조하는
  `fieldKeys.coreModel` 엔트리가 그 레포의 registry에 재생성돼야 빌드된다.
- **`browser-cache.ts`(+spec)는 옵션 파일이다.** `cores/index.ts`에서 export되지 않으며,
  spec이 `./commons.spec`에 의존하므로 단독 복사는 불가하다(cores 세트와 함께만).
- **spec 파일들은 타입체크 전용이다.** 이 레포의 `npm test`(vitest include: `src/**`)에서
  실행되지 않는다. `commons.spec.ts`가 테스트 헬퍼를 globalThis로 노출하므로 타입체크가
  검증하는 범위는 import 해결과 선언 수준이다.
- **`templates/generated/field-registry.ts`는 스텁이다.** 타입체크 전용이며 서비스 레포로
  복사하지 않는다.

## 검증 (릴리스 전 체크리스트)

- `npm run check:templates` — src 소스 기준 타입체크
- `npm run build && npm run check:templates:dist` — 배포 d.ts 기준(소비 레포 관점) 타입체크

## 문서화 범위

이 폴더의 앵커는 "레포 내 파일 + 이 README"다. typedoc(`doc:html`)은 `src/`만 대상으로
하므로 이 폴더는 API 문서에 포함되지 않는다.

## 향후

L2 층을 lemon-core에 정식 내재화(리팩토링·export)하는 시점에 이 폴더는 제거 대상이다.
