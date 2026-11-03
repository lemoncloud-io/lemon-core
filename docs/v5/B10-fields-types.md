# v5 B10 — 필드 이름·타입 일관성 검사 `lemon-fields-types`

상태: 2026-10-30 `feat/v5-b10-5-fields-types`에 구현 (기준 `v5` @ `971ec7e1`, #240 머지 뒤). B10 묶음 항목 5 "한 인덱스 안에서 필드 이름 하나 = 타입 하나". 원 구현은 lemon-templates-api #44(`bin/fields-types.mjs`)다. 오너 결정으로 공용 도구는 모든 서비스가 의존하는 lemon-core에 둔다. 복사 템플릿(templates-api)에 두지 않는다. 업그레이드 안내는 `HOW_TO_UPGRADE_V5.md` § 13.5.

## 배경

lemon-core v5는 한 서비스의 모델을 OpenSearch 인덱스 하나로 동기화한다. 인덱스에는 동적 매핑(dynamic mapping)이 하나뿐이다. 필드 `x`를 처음 쓴 문서가 `x`의 타입을 정한다. 뒤에 다른 모델이 같은 이름 `x`를 다른 타입으로 쓰면 `400 mapper_parsing_exception`이 난다. 그 문서는 인덱스에 들어가지 않는다. 검색 결과에서 빠질 뿐 저장(DynamoDB)은 성공하므로 눈에 띄지 않는다.

그래서 한 인덱스에 쓰는 모델들은 같은 이름에 같은 타입을 써야 한다. 모델이 여러 개이고, CoreModel에서 상속한 필드(`error`, `meta` …)도 함께 들어가므로 손으로 대조하기 어렵다. 이 도구는 선언된 TypeScript 타입으로 그것을 대조한다.

## 도구

새 파일 3개와 fixture 1벌. `src/`는 바꾸지 않았다.

| 파일 | 역할 |
| --- | --- |
| `bin/lemon-fields-types.mjs` | CLI 진입점(`#!/usr/bin/env node`). `run(process.argv.slice(2))`의 반환값을 `process.exitCode`로 둔다 |
| `bin/lib/fields-types.mjs` | 로직 전부. `process.exit` 없음, 출력 함수 주입 가능 |
| `bin/lib/fields-types.spec.mjs` | vitest 22건(이식 16 + 해석 순서 6) |
| `bin/lib/fixtures/fields-types/` | 더미 모델 5개(+ 뷰 1개)와 `tsconfig.json`. 알려진 충돌 7건 |

읽는 것:

- `<root>/src/**/*.ts`. `*.spec.ts`·`*.test.ts`·`node_modules`는 파일 이름으로 뺀다.
- `<root>/tsconfig.json`의 컴파일러 옵션(없으면 기본값). `strictNullChecks`는 늘 켠다. emit·incremental·plugins는 끈다.
- 모델: `--models R`(기본)은 `$FIELD = { k: ... }` 객체 리터럴의 항목 안에 있는 `keys<T>()`·`fieldKeys.x<T>()`·`fieldsOf(Class)` 호출의 타입이다. 곧 저장 모델이다. `$FIELD`가 없는 repo는 `H`로 떨어진다. `RH`는 CoreModel 모양(`ns`, `sid`, `uid`, `lock`, `next`, `createdAt`)의 interface·class도 모두 넣는다(뷰·요청 본문 포함).
- 필드: 각 모델의 저장 최상위 이름(소문자 시작, 두 글자 이상, `_id`·`_*`·`$*` 아님). CoreModel 필드도 포함한다. 객체 필드의 멤버는 점 경로(`a.b.c`)로 `--deep`(기본 2)까지 편다.

컴파일하지 않고 실행하지 않는다. AWS·OpenSearch를 부르지 않는다.

정규화(선언 타입 → OpenSearch 동적 매핑 종류):

| 선언 타입 | 종류 |
| --- | --- |
| `string`, 문자열 리터럴과 그 union, 문자열 enum | `string` |
| `number`, `bigint`, 숫자 리터럴과 그 union(예: `0 \| 1`), 숫자 enum | `number` |
| `boolean` | `boolean` |
| `Date` | `date` |
| `T[]`, tuple | 원소의 종류 |
| `A \| null \| undefined` | `A`의 종류(nullish 제거). 종류가 둘 남으면 `mixed` |
| 객체, intersection, `object` | `object` (`--deep`까지 편다) |
| 인덱스 시그니처(`{ [k: string]: T }`, `Record<string, T>`) | `<path>.*` = `dynamic`, 비교하지 않음 |
| 타입 매개변수 | 그 제약(constraint) |
| `any`, `unknown`, `never` | `any`, 비교하지 않음 |

충돌: 한 필드 경로에 `string`·`number`·`boolean`·`date`·`object` 중 둘 이상의 종류가 있다. `any`·`mixed`는 세기만 하고 비교하지 않는다.

심각도. 로컬 OpenSearch 2.17 인덱스(동적 매핑)에서 첫 쓰기 → 같은 필드 두 번째 쓰기로 잰 결과다(templates-api #44 실측).

| 첫 쓰기 | 두 번째 쓰기 | 결과 |
| --- | --- | --- |
| `number` | `"abc"` | 400 |
| `number` | `"123"` | 200 (변환됨) |
| `string` | `123` | 200 |
| `boolean` | `number`, 그리고 `number` 뒤 `boolean` | 400 |
| `object` | 스칼라, 그리고 스칼라 뒤 `object` | 400 |
| `date`(ISO 날짜 문자열) | `"abc"` | 400 |

- `hard`: 양쪽 순서 모두 실패한다. `object` ↔ 스칼라 전부, `boolean` ↔ `number`, `boolean` ↔ `date`. 객체 매핑은 스칼라를 받지 못하고 스칼라 매핑은 객체를 받지 못한다. `boolean` 매핑은 숫자를 받지 않고, `long`·`date` 매핑은 `true`/`false`를 받지 않는다.
- `order`: 더 엄격한 종류가 먼저 매핑될 때만 실패한다. `string` ↔ `number`, `string` ↔ `boolean`, `string` ↔ `date`, `number` ↔ `date`. `text`/`keyword` 매핑은 숫자를 문자열로 받는다. 반대로 `long` 매핑은 숫자로 바꿀 수 없는 문자열을 거부한다. 어느 모델이 먼저 쓰는지가 결과를 정하므로 여전히 위험이다.

여러 종류가 섞인 경로는 종류 쌍 중 하나라도 `hard`이면 `hard`다.

## 사용법

lemon-core 5.0.5 이상을 설치하면 bin `lemon-fields-types`가 따라온다(`package.json` `bin`). 서비스 쪽 스크립트:

```json
"scripts": {
    "fields:types": "lemon-fields-types"
}
```

```sh
npm run fields:types                       # 이 repo
npm run fields:types -- --fail-on order    # order 충돌도 실패로
npx lemon-fields-types --root ../other-api # 다른 repo
```

| 옵션 | 기본값 | 뜻 |
| --- | --- | --- |
| `--root <dir>` | cwd | 검사할 repo. `<dir>/src/**/*.ts`와 `<dir>/tsconfig.json`을 읽는다 |
| `--deep <n>` | `2` | 객체 필드를 펴는 깊이(`a.b.c`가 2). `0`–`10` |
| `--models R\|RH` | `R` | `R`: `$FIELD` 모델(저장 모델). `RH`: CoreModel 모양 타입 전부 |
| `--fail-on <level>` | `hard` | `hard`, `order`, `none` |
| `--json` | | 전체 보고서를 JSON으로만 출력 |
| `--with <report.json>` | | 다른 repo의 `--json` 보고서를 같은 인덱스로 합쳐 검사. 반복 가능 |
| `--fallback <dir>` | | repo가 풀지 못하는 패키지(와 `typescript`)를 찾을 추가 `node_modules` 디렉터리. 반복 가능 |
| `--help` | | 도움말 |

종료 코드:

| 코드 | 뜻 |
| --- | --- |
| 0 | `--fail-on` 이상 충돌 없음(`--help` 포함) |
| 1 | `hard` 충돌(`--fail-on hard`) 또는 충돌 하나 이상(`--fail-on order`) |
| 2 | 잘못된 인자, `src/` 없음, 읽을 수 없는 tsconfig·`--with` 보고서, `typescript`를 찾지 못함, TS 프로그램 생성 실패 |

**한 인덱스를 함께 쓰는 여러 repo.** 각 repo의 보고서를 만든 뒤 합친다.

```sh
# 다른 repo (npm run은 JSON 앞에 배너를 붙이므로 bin을 직접 부른다)
npx lemon-fields-types --root ../other-api --json > other.json

# 이 repo + 다른 repo를 한 인덱스로
npm run fields:types -- --with other.json
```

**lemon-core 4.x에 남은 repo(임시).** 그 repo의 의존성을 바꾸지 않고 v5 bin만 빌려 쓴다(5.0.5 이상 게시 뒤).

```sh
npx -p lemon-core@5 lemon-fields-types --root .
```

repo에 `typescript`가 설치돼 있지 않으면 `--fallback <다른 checkout>/node_modules`를 붙이거나 `-p typescript@5`를 함께 준다(`npx -p lemon-core@5 -p typescript@5 lemon-fields-types --root .`). 이 두 `npx` 형태는 게시 전이라 실측하지 않았다.

## 출력 형식

요약 한 줄. 마지막 토큰 `ts=`는 이번 이식에서 붙였다(§ typescript 해석 순서).

```text
fields-types repo=<basename> models=<n> fields=<n> conflicts=<n> (hard=<n> order=<n>) any=<n> mixed=<n> unresolved=<n> ts=<version>
```

- `models`: 검사한 모델 수. `fields`: 서로 다른 필드 경로 수(점 경로 포함, `.*` 제외).
- `any`, `mixed`: 그 종류의 필드 선언 수(비교하지 않음). `unresolved`: TS 프로그램이 풀지 못한 패키지 수.
- `ts`: 이번 검사에 쓴 `typescript` 버전. `--with`로 합친 보고서는 첫 보고서(이 repo)의 값이다. 값이 없는 옛 보고서만 합치면 `ts=?`다.

그다음 충돌마다 한 줄. `hard` 먼저, 그다음 이름순이다.

```text
  - <hard|order> <name>: <kind>[<Model>(<file>:<line>), ...] vs <kind>[...]
```

- 패키지에서 상속한 필드는 `<package>:<file name>`으로 보인다(예: `lemon-model:core-storage.d.ts:115`).
- 한 종류에 모델이 셋보다 많으면 `, +<n>`으로 줄인다.
- 합친 보고서에서 모델은 `<repo>:<Model>`이다.

`--json` 모양:

```text
{
  repo, deep, rule,
  typescript: { version, from: 'root' | 'fallback' | 'self' },
  files, fieldEntries, modelsFound, fields,
  models:    [{ name, file, line, rules: ['R'|'H'], fields: [{ name, type, file, line }] }],
  conflicts: [{ name, severity: 'hard'|'order', decls: [{ model, type, file, line, repo? }] }],
  any, mixed, other,           // [{ name, model, type, file, line, repo? }]
  unresolved                   // [package name]
}
```

합친 보고서는 `repo`가 `a+b`이고 `repos: [a, b]`가 더해진다. `typescript`는 첫 보고서의 값(없으면 `null`)이다. `--with`는 `repo`(문자열)와 `models[].name`·`models[].fields`(배열)만 확인하므로 `typescript`가 없는 templates-api #44 형식 보고서도 받는다.

## typescript 해석 순서

원 구현은 `import ts from 'typescript'`로 도구 자신의 위치에서 `typescript`를 읽었다. lemon-core에 두면 그 위치는 lemon-core의 설치 자리다. lemon-core의 `typescript`는 devDependency라 서비스에는 설치되지 않는다. 그래서 정적 import를 해석기로 바꿨다.

순서(앞에서 찾으면 멈춘다):

1. `root`: `createRequire(<root>/package.json)` → `require.resolve('typescript')`. 검사하는 repo의 `typescript`(보통 devDependency)다. Node 해석 규칙대로 `<root>/node_modules`에서 시작해 상위 디렉터리로 올라간다.
2. `fallback`: `--fallback <dir>`마다 `createRequire(<dir>/../package.json)`. 곧 그 `node_modules`에서 시작한다.
3. `self`: `createRequire(import.meta.url)`. 도구 자신의 위치(서비스에서는 `node_modules/lemon-core/bin/lib/`, 위로 올라가 서비스의 `node_modules`).

찾은 모듈은 같은 `require`로 적재한다. 셋 다 실패하면 `ERROR: cannot resolve typescript from --root <root>, --fallback (<n> dirs), or lemon-core itself (...)` 한 줄을 남기고 종료 코드 2다. 쓴 쪽은 JSON의 `typescript.from`과 요약 줄의 `ts=`로 보인다.

`package.json`에는 `typescript`를 optional peer(`">=4.7"`, 상한 없음, `peerDependenciesMeta.typescript.optional`)로 둔다. AWS SDK 클라이언트와 같은 방식이다. `dependencies`에는 넣지 않는다. 런타임 라이브러리를 쓰는 서비스가 `typescript`를 설치하게 되지 않도록 하기 위해서다.

TS 4.7.4와 5.9.3에서 fixture 결과가 같다(§ 검증). 둘 다 `host.resolveModuleNames`·`checker.isArrayType`·`checker.isTupleType`을 지원한다.

## 한계

- 선언 타입만 본다. 런타임 값이 타입과 다르면(예: `string` 필드에 숫자 기록) 보지 못한다.
- `any`(예: `meta?: string | any`)와 union으로 섞인 필드(`mixed`)는 세기만 하고 비교하지 않는다. 인덱스 시그니처·`Record` 멤버(`.*`)도 비교하지 않는다.
- 풀리지 않은 패키지의 타입은 `any`가 되어 검사에서 빠진다. `unresolved=`를 보고 의존성을 설치하거나 `--fallback`을 준다.
- spec 모델은 빠진다. `*.spec.ts`·`*.test.ts`를 파일 이름으로 뺀다(tsconfig `include`·`exclude`는 파일 목록에 쓰지 않는다).
- 동기화 opt-in(`enableSync`)을 읽지 않는다. `$FIELD`의 모델은 동기화하지 않아도 검사한다.
- 필드 목록에 거는 코드 필터(`.filter(...)`)는 평가하지 않는다. 위의 고정 저장 이름 규칙만 적용한다.
- `--models RH`는 뷰·요청 본문도 본다. 저장되지 않으므로 거짓 양성이 될 수 있다(예: 모델의 `0 | 1` 플래그와 뷰의 `boolean`).

## 검증

- `npm test`: 59 files / 663 tests → 60 files / 685 tests. `bin/lib/fields-types.spec.mjs` 22건. `vitest.config.ts` `test.include`에 `'bin/**/*.spec.mjs'`를 더했다.
  - 이식 16건: 수집(R·RH), 알려진 충돌 7건(hard 3·order 4)과 순서, CoreModel 상속 필드 충돌, 정규화, `normalizeType`, `--deep 0`, `severityOf`, `findConflicts`의 `any`·`mixed`·`dynamic` 제외, `mergeReports`, 요약 줄 형식, `parseOptions`, `--help`, 종료 코드 1·0·2, `--json` → `--with` 왕복.
  - 해석 순서 6건: fixture 복사본(임시 디렉터리, 위에 `node_modules` 없음)에 `node_modules/typescript` 링크 → `root`; 링크 없음·`--fallback` 없음 → `self`; `--fallback`에만 있음 → `fallback`; 어디에도 없음 → `ArgError`(세 자리 이름); `--json`의 `typescript.version`; 요약 줄 마지막 토큰 `ts=<version>`(상세 줄에는 없음).
- fixture 동등성: TS 4.7.4(`--fallback`)와 TS 5.9.3(lemon-core)에서 요약·상세 줄이 `ts=` 토큰 말고 같다. `--models RH`도 같다(`models=6 conflicts=8 (hard=3 order=5)`).
- 실제 repo:
  - lemon-templates-api: `models=5 fields=55 conflicts=0 (hard=0 order=0) any=4 mixed=0 unresolved=0 ts=4.7.4`, `typescript.from=root`, 종료 0.
  - chatic-socials-api `origin/develop`(`src`·`tsconfig.json`만 `git archive`로 꺼냄, templates-api `node_modules`를 `--fallback`): `models=12 fields=140 conflicts=1 (hard=1 order=0) any=11 mixed=1 unresolved=4 ts=4.7.4`, `typescript.from=fallback`, 종료 1. 상세: `hard thumbnail: object[UploadModel] vs string[ChannelModel, UserModel, ProfileModel]`. templates-api #44의 원 도구와 같은 결과다.
  - lemon-core 자신: `$FIELD`가 없고 CoreModel 모양 선언도 없다. `models=0 fields=0 conflicts=0 … ts=5.9.3`, 종료 0.
- `npx prettier --check 'bin/**/*.mjs'`·`npx eslint bin --ext .mjs` 오류 0·경고 0. `.eslintrc.js`는 바꾸지 않았다(기존 `@typescript-eslint/parser`가 `.mjs`를 읽는다).
- `npm pack --dry-run`: `bin/lemon-fields-types.mjs`·`bin/lib/fields-types.mjs` 둘만 들어간다. spec·fixture는 없다.

## 영향

- lemon-core 패키지에 bin 하나와 파일 2개가 더해진다. 런타임 코드(`dist/`)와 공개 export는 그대로다.
- `typescript`는 optional peer다. 설치하지 않은 서비스는 그대로다. 상한을 두지 않은 이유: npm은 설치된 optional peer가 범위를 벗어나면 충돌(ERESOLVE)로 다루므로, TS 6.x 서비스가 lemon-core 설치에서 막히지 않게 한다. 도구가 쓰는 컴파일러 API(`createProgram`·`getTypeChecker`·`is*` 가드)는 4.7~5.9에서 같았고, 6.x는 실측하지 않았다.
- `.gitignore`의 VisualStudio 규칙 `[Bb]in/`이 루트 `bin/`을 숨겨서 `!/bin/`을 더했다.
- lemon-templates-api의 `bin/fields-types.mjs`(#44)를 어떻게 할지(지우고 lemon-core bin을 부를지)는 이 PR 범위 밖이다.
