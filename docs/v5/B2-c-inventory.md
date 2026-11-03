# lemon-core v5 B2-c (AWS SDK soft coupling) — measured inventory

- Trees: `<lemon-core>` = the B2-c lemon-core worktree (branch `feat/v5-b2-c-aws-sdk`, v5 `c80f02c4`). `<templates-api>` = the B2-c templates-api worktree (v5 `15c2b6c9`).
- `<scratch>` = this session's scratchpad. Probe scripts and raw outputs are in `<scratch>/b2c/`.
- Tags: **[measured]** = a command was run and its output is quoted. **[code]** = read from source.
- No git commands were run. No file under `src/` was edited. See § 0 for the `field-registry.ts` restore.

## 0. Build and restore evidence [measured]

- `npm ci --ignore-scripts` logs: both end with `exit 0` (`<scratch>/b2c-lc-npm-ci.log`, `<scratch>/b2c-ta-npm-ci.log`).
- Saved the pristine file first: `cp src/generated/field-registry.ts <scratch>/b2c/field-registry.ts.pristine`.
- `npm run build` → `exit 0`. `gen-esm-wrapper: dist/esm/index.mjs <- dist/index.d.ts: 135 named + default`. The build changes `field-registry.ts`: `lemon-fields gen` reformats the array to one line (content unchanged, prettier vs non-prettier layout).
- Restore and sha256:

```
before build : 39adf249ad11ffce015b0d588c601a4053a19c8403bbc6793a11282ab03b347b  src/generated/field-registry.ts
after build  : bf38c1b4bfc9520fda3e48c3d7bff4fa5bf9eda4ae91f2ffb59f3b8579851c54  src/generated/field-registry.ts
after restore: 39adf249ad11ffce015b0d588c601a4053a19c8403bbc6793a11282ab03b347b  src/generated/field-registry.ts
pristine copy: 39adf249ad11ffce015b0d588c601a4053a19c8403bbc6793a11282ab03b347b  <scratch>/b2c/field-registry.ts.pristine
ls -la: -rw-r--r--  2102 bytes  Oct 27 23:03  src/generated/field-registry.ts
```

- `dist/` stays built (gitignored). The vitest runs in § 5 do not touch `field-registry.ts`.

## 1. Packages

### 1.1 `<lemon-core>/package.json` [measured: `npm ls --depth=0`, lockfile]

| package | section | declared | installed (top level) |
| --- | --- | --- | --- |
| `@aws-sdk/client-dynamodb` | dependencies | `^3.971.0` | 3.971.0 |
| `@aws-sdk/client-dynamodb-streams` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-iam` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-kms` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-lambda` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-s3` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-sns` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-sqs` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/client-sts` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/credential-providers` | dependencies | `^3.971.0` | 3.983.0 |
| `@aws-sdk/lib-dynamodb` | dependencies | `^3.971.0` | 3.971.0 |
| `@aws-sdk/types` | **devDependencies** | `^3.972.0` | 3.973.1 |
| `@smithy/util-stream` | **devDependencies** | `^3.3.4` | 3.3.4 |

- The 11 runtime packages match SPEC § 3.5 "11종".
- `@aws-sdk/types` is a devDependency. Its only use is the deep type import `tools/tools.ts:22`, and that import is emitted into `dist/tools/tools.d.ts:2` (§ 4).
- `@smithy/util-stream` is a devDependency with **0 references** in `src/` and `scripts/` [measured: `grep -rln -e util-stream -e sdkStreamMixin src scripts` → no match]. It is also a different major (3.3.4) from the copies the SDK uses (4.5.10/4.5.11, nested). It is a removal candidate.
- Version skew [measured]: the dynamo pair is at 3.971.0 and the other clients at 3.983.0. `client-dynamodb` nests its own `@aws-sdk/client-dynamodb@3.970.0` under `@aws-sdk/dynamodb-codec` (lock flag `peer`). Every SDK client resolves the same `@smithy/smithy-client` 4.11.2 (single copy, measured with `require.resolve` from each client).
- The lock holds 50 `@aws-sdk/*`, 51 `@smithy/*` and 7 `@aws-crypto/*` package names (`npm ls --all`).

### 1.2 Who else pulls `@aws-sdk` [measured: lockfile scan of every non-AWS package's deps/optional/peer]

| tree | non-AWS package → `@aws-sdk` dep | dev? |
| --- | --- | --- |
| `<lemon-core>` | `lemon-devkit@0.0.11` → `@aws-sdk/credential-providers ^3.812.0` | dev |
| `<templates-api>` | `lemon-core@4.3.0` (registry) → the same 11 packages, `^3.971.0` | runtime |
| `<templates-api>` | `lemon-devkit@0.2.0` → `@aws-sdk/credential-providers ^3.812.0` | dev |
| `<templates-api>` | `serverless` → `client-api-gateway`, `client-cognito-identity-provider`, `client-eventbridge`, `client-iam`, `client-lambda`, `client-s3`, `aws-sdk@2` | dev |
| `<templates-api>` | `@serverless/dashboard-plugin` → `client-cloudformation`, `client-sts` | dev |

- `@opensearch-project/opensearch` pulls no `@aws-sdk` in either tree.
- `npm ls @aws-sdk/client-sts` in `<lemon-core>` shows only the direct dependency. `npm ls @aws-sdk/credential-providers` shows the direct one plus `lemon-devkit` (deduped).

### 1.3 `<templates-api>` declares no AWS SDK itself [measured]

- `package.json`: no `@aws-sdk/*` or `@smithy/*` in any section. Related lines: `lemon-core ^4.3.0`, `lemon-model ^1.1.1`, dev `lemon-devkit ^0.2.0`, dev `serverless-aws-documentation ^0.8.0`.
- `src/`: 0 files import `@aws-sdk`, `@smithy` or `aws-sdk` (`grep -rln`).
- `node_modules/lemon-core` is currently the **registry 4.3.0 copy** (lock `resolved`, not a link). Its `node_modules/@aws-sdk/` holds the 11 packages because lemon-core 4.3.0 depends on them.
- **Consequence:** once v5 moves the 11 packages to optional peers, npm (v7+) will not install them for `<templates-api>`. `<templates-api>` must then declare the peers its runtime path needs (§ 6.3).

## 2. Construction and usage sites

Method: a TS-AST scan of every identifier imported from `@aws-sdk/*`, with the innermost enclosing function, the `async` flag and modifiers (`<scratch>/b2c/scan-aws.cjs` → `scan-aws.tsv`). A second call scan gives the enclosing chain for `awsConfig`/`instance` callers (`<scratch>/b2c/scan-calls.cjs`). [measured: scan output; line numbers are on the current tree]

**Import-time access [measured].** I loaded `dist/index` with every `@aws-sdk/*` request answered by a Proxy that records property reads. Result: `TOUCHED []`. No SDK export is read at import. Only the top-level `require` statements load the SDK. Example: `dist/cores/aws/aws-kms-service.js:23-24` `const client_kms_1 = require("@aws-sdk/client-kms")`.

Files that import `@aws-sdk` (non-spec): 11 under `src/` plus `tools/aws-lambda-helper.example.ts`, which is compiled into `dist/tools/` and shipped (`files: dist/**/*`), but no barrel loads it. One spec, `tools/tools.spec.ts:16` (`fromIni`), imports it too.

### 2.1 Site table

V = value import, T = type-only. "sync site" means it runs on a synchronous call path.

| file:line | package | symbol (kind) | enclosing function | sync/async | visibility | callers / notes |
| --- | --- | --- | --- | --- | --- | --- |
| cores/aws/aws-kms-service.ts:20-23 | client-kms | `KMSClient`, `SignCommand`, `GetPublicKeyCommand`, `EncryptCommand`, `DecryptCommand`, `VerifyCommand` (V); `SigningAlgorithmSpec`, 5× `*CommandInput` (T) | module top | load | — | static import → loads the package at import |
| aws-kms-service.ts:29 | client-kms | `SigningAlgorithmSpec` (T) | `type MySigningAlgorithm` | — | non-exported alias | leaks via exported `AWSKMSSignOption.algorithm` (:57) |
| aws-kms-service.ts:34-35 | client-kms | `awsConfig` + `new KMSClient` | module `instance()` (:33) | **sync** | module-private | only `AWSKMSService.instance()` :103 |
| aws-kms-service.ts:98 | client-kms | `KMSClient` (T) | `protected _instance` | — | protected field | d.ts leak |
| aws-kms-service.ts:102-105 | — | memo of the module `instance()` | `AWSKMSService.instance()` | **sync** | **public** | callers (all public async arrow props): `encrypt` :120, `decrypt` :138, `sign` :160, `verify` :188, `getPublicKey` :211. Outside the class: 0 in lemon-core, 0 in `<templates-api>` |
| aws-kms-service.ts:120,138,160,189,211 | client-kms | `new EncryptCommand`/`DecryptCommand`/`SignCommand`/`VerifyCommand`/`GetPublicKeyCommand` | `encrypt`/`decrypt`/`sign`/`verify`/`getPublicKey` | async | public | — |
| cores/aws/aws-s3-service.ts:19-23 | client-s3 | `S3Client`, 6 commands (V); `_Object`, `GetObjectCommandOutput`, `PutObjectCommandInput`, `ListObjectsV2CommandInput` (T) | module top | load | — | static import |
| aws-s3-service.ts:35 | client-s3 | `_Object` (T) | `export type S3Object` | — | exported, **not at root** | also `ListObjectResult.Contents: S3Object[]` (:116); reachable only via the deep path `dist/cores/aws/aws-s3-service` |
| aws-s3-service.ts:160-161 | client-s3 | `awsConfig` + `new S3Client` | module `instance()` (:159) | **sync** | module-private | **no cache**: a new client on every call |
| aws-s3-service.ts:196-198 | client-s3 | `S3Client` (T return) | `AWSS3Service.instance()` | **sync** | **protected** | callers (all public async arrow props): `headObject` :213, `putObject` :281, `getObject` :316, `getDecodedObject` :344, `getObjectTagging` :369, `deleteObject` :396, `listObjects` :442. Subclasses: 0 in lemon-core, 0 in `<templates-api>` |
| aws-s3-service.ts:215,283,318,346,371,398,449,466 | client-s3 | commands | the methods above | async | public | — |
| aws-s3-service.ts:508-513,567 | client-s3 | `PutObjectCommandInput` (T) | `S3PutObjectRequestBuilder` | sync | **class not exported** | no d.ts leak |
| cores/aws/aws-sns-service.ts:19-21 | client-sns, client-iam, client-sts | `SNSClient`, `PublishCommand`, `IAMClient`, `GetUserCommand`, `STSClient`, `GetCallerIdentityCommand` (V) | module top | load | — | **engine edge** (§ 3) |
| aws-sns-service.ts:106-117 | iam, sts | `awsConfig` :106, `new IAMClient` :107, `GetUserCommand` :108, `new STSClient` :115, `GetCallerIdentityCommand` :117 | Promise executor (sync callback) inside `accountID` (:104) | async method | public | `endpoint` :92 (async); `tools.spec` |
| aws-sns-service.ts:158-161 | client-sns | `awsConfig`, `new SNSClient`, `PublishCommand` | `publish` (:141) | async | public | `reportError` :190 ← engine `doReport*` (§ 3) |
| cores/aws/aws-sqs-service.ts:15,17 | client-sqs | `SQSClient`, 4 commands (V); 4× `*CommandInput` (T) | module top | load | — | — |
| aws-sqs-service.ts:127-128 / 156-157 / 198-199 / 217-218 | client-sqs | `awsConfig` + `new SQSClient` + command | `sendMessage` / `receiveMessage` / `deleteMessage` / `statistics` | async | public | new client per call |
| cores/dynamo/dynamo-service.ts:17-28 | client-dynamodb, lib-dynamodb, client-dynamodb-streams | `StreamViewType`, `CreateTableCommand`, `DeleteTableCommand`, `DynamoDBClient`, `DynamoDBDocumentClient`, `GetCommand`, `BatchGetCommand`, `PutCommand`, `DeleteCommand`, `UpdateCommand`, `BatchWriteCommand`, `DynamoDBStreamsClient` (V); `KeySchemaElement` (T) | module top | load | — | — |
| dynamo-service.ts:89-93 | — | `DynamoService.instance(<fixed region>)` | module `instance()` | **sync** | module-private | `createTable` :392, `deleteTable` :407, `readItem` :427 (all async) |
| dynamo-service.ts:129-132 | — | `_dynamo`, `_dynamostr` (T: SDK clients), `_dynamodoc` | static fields | — | protected static | `_dynamo`/`_dynamostr` are **read (:141-142) but never written** |
| dynamo-service.ts:140-142 | client-dynamodb, client-dynamodb-streams | `awsConfig` :140, `new DynamoDBClient` :141, `new DynamoDBStreamsClient` :142 | `DynamoService.instance(region?)` (:138-160) | **sync** | **public static** | callers (all async): module `instance()` :92; `mreadItem` :455, `saveItem` :593, `msaveItem` :621, `deleteItem` :735, `updateItem` :766, `mupdateItem` :796; `DynamoQueryService.queryRangeBy` (dynamo-query-service.ts:109); `DynamoScanService.scan` (dynamo-scan-service.ts:128). `<templates-api>`: 0 |
| dynamo-service.ts:145-156 | client-dynamodb, lib-dynamodb | `new DynamoDBClient` :151, `DynamoDBDocumentClient.from` :152 | async memo `_dynamodoc[region]` | async | — | this cache **is** written (:147) |
| dynamo-service.ts:201,209 | client-dynamodb | `KeySchemaElement` (T) :201; **`StreamViewType.NEW_AND_OLD_IMAGES` (V)** :209 | `prepareCreateTable` (:174) | **sync** | public | caller `createTable` :391 (async) |
| dynamo-service.ts:393,408,429,489,595,645,737,768,826 | client-dynamodb / lib-dynamodb | commands | `createTable`, `deleteTable`, `readItem`, `_doBatchGet`, `saveItem`, `_doBatchWrite` (×2), `deleteItem`, `updateItem` | async | public / private | — |
| cores/dynamo/dynamo-query-service.ts:15,110 | lib-dynamodb | `QueryCommand` (V) | `queryRangeBy` | async | public | — |
| cores/dynamo/dynamo-scan-service.ts:15,129 | lib-dynamodb | `ScanCommand` (V) | `scan` | async | public | — |
| cores/lambda/lambda-web-handler.ts:36 | client-sts | `STSClient`, `GetCallerIdentityCommand` (V) | module top | load | — | — |
| lambda-web-handler.ts:577-579 | client-sts | `awsConfig`, `new STSClient`, `GetCallerIdentityCommand` | async IIFE in `MyHttpHeaderTool.getAccountId` (:561) | async | protected | only after the `getHelloArn` path fails; the error is caught and falls back to a placeholder id |
| cores/protocol/aws-lambda-helper.ts:6 | client-lambda | `LambdaClient`, `InvokeCommand` (V); `InvocationRequest`, `InvokeCommandOutput` (T) | module top | load | — | — |
| aws-lambda-helper.ts:48,50 | client-lambda | `new LambdaClient`, `InvokeCommand` | `invokeLambda` (exported async function, :21; not at root) | async | export | `MyProtocolService.execute` :341 |
| cores/protocol/protocol-service.ts:23-24 | client-sns, client-sqs | `SNSClient`, `PublishCommand`, `SQSClient`, `SendMessageCommand` (V); `PublishCommandInput`, `PublishCommandOutput`, `SendMessageCommandInput`, `SendMessageCommandOutput` (T) | module top | load | — | — |
| protocol-service.ts:51 | client-sns | `export type MySNSEventParam = PublishCommandInput` (T) | — | — | exported, not at root | used by `SNSProtocolTransformer` :613/:622/:635 |
| protocol-service.ts:340 / 367-369 / 415-417 / 464-466 | sns, sqs | `awsConfig` (+ client + command) | `execute` / `notify` / `enqueue` / `broadcast` | async | public | — |
| protocol-service.ts:686 | client-sqs | `type SQSEventParam = SendMessageCommandInput` (T) | — | non-exported alias, emitted into d.ts | — | `SQSProtocolTransformer` |
| tools/tools.ts:20 | credential-providers | `fromIni` (V) | module top | load | — | **engine edge** (§ 3) |
| tools/tools.ts:22 | `@aws-sdk/types/dist-types/identity/AwsCredentialIdentity` (deep path) | `RuntimeConfigAwsCredentialIdentityProvider` (T) | module top | — | — | used by `AwsConfigParams.credentials` :81 and the `awsConfig` return :100/:127 |
| tools/tools.ts:65 | credential-providers | `fromIni` (V) | `asyncCredentials` (:64) | async | export (root) | `extended/cores/abstract-services.ts:2501` (async `loadCredentials`); `<templates-api>` `src/express.ts:40` |
| tools/tools.ts:131 | credential-providers | **`fromIni({ profile })` (V)** | `awsConfig` (:96-135) | **sync** | export (root) | 14 non-spec callers (§ 2.2) |
| tools/aws-lambda-helper.example.ts:16,156 | credential-providers | `fromIni` (V) | `buildConfig` (sync) | sync | example only | ships in dist; no barrel loads it |

### 2.2 `awsConfig()` callers [measured: AST call scan, non-spec]

There are **14 non-spec call sites**, not 16 (§ 8). Every one runs inside an async method, except the 3 module/static `instance()` builders:

| # | file:line | enclosing chain |
| --- | --- | --- |
| 1 | cores/aws/aws-kms-service.ts:34 | module `instance()` [sync] ← `AWSKMSService.instance()` [sync, public] |
| 2 | cores/aws/aws-s3-service.ts:160 | module `instance()` [sync] ← `AWSS3Service.instance()` [sync, protected] |
| 3 | cores/dynamo/dynamo-service.ts:140 | `DynamoService.instance()` [sync, public static] |
| 4 | cores/aws/aws-sns-service.ts:106 | Promise executor [sync] < `accountID` [async] |
| 5 | cores/aws/aws-sns-service.ts:158 | `publish` [async] |
| 6-9 | cores/aws/aws-sqs-service.ts:127, 156, 198, 217 | `sendMessage` / `receiveMessage` / `deleteMessage` / `statistics` [async] |
| 10 | cores/lambda/lambda-web-handler.ts:577 | IIFE [async] < `getAccountId` [async, protected] |
| 11-14 | cores/protocol/protocol-service.ts:340, 367, 415, 464 | `execute` / `notify` / `enqueue` / `broadcast` [async] |

- Spec uses: `tools/tools.spec.ts:46` (`_config` helper, called many times) and `:183`.
- `<templates-api>`: 0.

### 2.3 Facts the § 3.5 restructure depends on [code]

- `DynamoService.instance()` builds a new `DynamoDBClient` and a new `DynamoDBStreamsClient` on **every call**: the `??` reads `_dynamo[region]`/`_dynamostr[region]`, which are never assigned. That happens on every `mreadItem`/`saveItem`/`msaveItem`/`deleteItem`/`updateItem`/`mupdateItem`/query/scan.
- **`dynamostr` is never used** anywhere in `src/` [measured: `grep -rn dynamostr` → only :130/:142/:159]. `.dynamo` is used only by `createTable`/`deleteTable` (:393/:408). Every data path uses only `dynamodoc()`.
- `AWSS3Service.instance()` → module `instance()` has no cache (a new `S3Client` per S3 call). `AWSKMSService.instance()` caches in `_instance`.
- `awsConfig()` is sync. Its only SDK use is `fromIni(...)` at :131, which returns a provider function. Wrapping it as `async (id) => (await import('@aws-sdk/credential-providers')).fromIni({ profile })(id)` keeps `typeof cfg.credentials === 'function'`. `tools.spec.ts:74` asserts that.
- **Precedent from B2-b:** `cores/elastic/elastic6-service.ts:142-146` `loadOpenSearch()` is a **sync lazy `require()`** with a module cache. It is not `await import()`. It loads the package on first client use and keeps sync signatures. § 8 R2 covers the trade-off.

## 3. Engine edges and load measurements

### 3.1 What `engine/engine.ts` imports [code]

```
engine.ts:27  import { $engine, $U, _log, _inf, _err } from './index';        // cycle, safe (see § 9 d)
engine.ts:31  import { SlackPostBody, MetricPostBody, CallbackData } from '../common/types';   // types
engine.ts:32  import { loadJsonSync } from '../tools/';                       // EDGE 1
engine.ts:33  import { AWSSNSService } from '../cores/aws/aws-sns-service';   // EDGE 2
engine.ts:35  import * as $lambda from 'aws-lambda';                          // types only (elided)
engine.ts:40  const $sns = (arn) => new AWSSNSService(arn);
```

- Edge 1: `../tools/` (barrel = `tools/express.ts` + `tools/tools.ts`). `tools/tools.ts:20` statically requires `@aws-sdk/credential-providers`. `tools/express.ts` loads no AWS (its `lambda-web-handler` import is type-only and is elided [measured: not in `require.cache`]). engine.ts uses `loadJsonSync` at :102, :148, :190, :246.
- Edge 2: `aws-sns-service` statically requires `client-sns`, `client-iam`, `client-sts`. engine.ts uses `$sns(arn)` only inside the async `doReportError` :122, `doReportCallback` :154, `doReportSlack` :211, `doReportMetric` :273.
- Own modules in the engine closure [measured]: `engine/{index,builder,types,utilities,engine}`, `tools/{index,express,tools}`, `common/test-helper`, `cores/aws/aws-sns-service`. That is 10 files, and `lib/*` is not among them.
- `$U` is `$engine.U` from `dist/engine`, so "import `$U` only" equals `require('./dist/engine')`. `$T` is L2 `extended/cores/commons` at the root (it imports `helpers/` for L1 `$T`). `helpers/helpers.ts:14,22` import the whole `../cores/` barrel. So `$T` pulls in every AWS client.

### 3.2 Load measurements [measured]

Command (probe = `<scratch>/b2c/aws-probe.cjs`; it counts `require.cache` by the last `node_modules/<pkg>` owner, times with `hrtime` around `require`):

```sh
cd <lemon-core>; env -i PATH=$PATH HOME=$HOME node <scratch>/b2c/aws-probe.cjs dist/<entry>
```

No AWS env is set. The machine load average was 10–15 during these runs, so times are noisy. The first table is one run per entry; the time row below is 5 runs.

| entry | total modules | `@aws-sdk` files (owner / path-substr) | `@aws-sdk` pkgs | `client-*` | `@smithy` files (pkgs) | `@aws-crypto` | `credential-providers` files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dist/engine` (`$U`) | 338 | 113 / 137 | 23 | iam, sns, sts | 85 (38) | 0 | 16 |
| `dist/tools` | 137 | 34 / 52 | 12 | — | 71 (28) | 0 | 16 |
| `dist/tools/tools` | 135 | 34 / 52 | 12 | — | 71 (28) | 0 | 16 |
| `dist/cores/aws/aws-sns-service` | 338 | 113 / 137 | 23 | iam, sns, sts | 85 (38) | 0 | 16 |
| `dist/helpers` (L1 `$T`) | 721 | 288 / 377 | 44 | dynamodb, dynamodb-streams, iam, kms, lambda, s3, sns, sqs, sts | 144 (43) | 9 | 16 |
| `dist/extended/cores/commons` (root `$T`) | 722 | 288 / 377 | 44 | same 9 | 144 (43) | 9 | 16 |
| `dist/cores` | 712 | 288 / 377 | 44 | same 9 | 144 (43) | 9 | 16 |
| `dist/index` (`require('lemon-core')`) | **737** | **288 / 377** | **44** | same 9 | **144 (43)** | 9 | 16 |
| `dist/lib` | 3 | 0 | 0 | — | 0 | 0 | 0 |
| `dist/environ` | 3 | 0 | 0 | — | 0 | 0 | 0 |

Time, 5 runs each (ms): engine 142 145 163 166 149 · tools 62 78 57 45 47 · helpers 340 366 342 340 311 · index 356 339 368 364 372.

- `dist/index` total: B2-inventory § 6 had 1066 → now **737** (B2-a and B2-b removed request/ioredis/memcached/lodash/@elastic). The AWS part is unchanged: 288 / 377 / 44 / 9 / 144.
- Per-package `@aws-sdk` files for `dist/engine`: credential-providers 16, core 11, client-sts 11, xml-builder 9, client-sns 7, client-iam 7, middleware-recursion-detection 6, util-endpoints 6, region-config-resolver 6, credential-provider-http 5, credential-provider-env 4, credential-provider-node 4, credential-provider-web-identity 3, middleware-host-header 3, middleware-logger 3, middleware-user-agent 3, util-user-agent-node 3, and 1 each for credential-provider-{cognito-identity, ini, login, process, sso} and token-providers.
- **Non-scoped AWS transitive packages** also load with `dist/index` [measured]: `tslib` 14, `fast-xml-parser` 11, `mnemonist` 3, `obliterator` 2, `@aws/lambda-invoke-store` 1 (scope `@aws/`, not `@aws-sdk/`), and `@aws-crypto/*` 9. A gate that counts only `@aws-sdk`/`@smithy` misses them. Proposal: count `/@aws-sdk/`, `/@smithy/`, `/@aws-crypto/`, `/@aws/` by owner, and report the total module count too.

### 3.3 Projected post-B2-c closure [measured, approximation]

The probe `<scratch>/b2c/stub-probe.cjs` answers every `@aws-sdk/*`/`@smithy/*` require with an empty stub. That reproduces "nothing from the SDK loads at import". It is valid because § 2 shows no import-time SDK property access.

| entry | total modules (stubbed) | requests that were stubbed | time (1 run) |
| --- | --- | --- | --- |
| `dist/engine` | 131 | client-iam, client-sns, client-sts, credential-providers | 66 ms |
| `dist/tools` | 30 | credential-providers | 7 ms |
| `dist/helpers` | 249 | the 11 packages | 110 ms |
| `dist/index` | 265 | **exactly the 11 packages** — no other `@aws-sdk`/`@smithy` request comes from lemon-core code | 98 ms |

- `dist/index` 737 → about 265 modules (−472) once all 11 packages are deferred.
- No code path needs `@aws-sdk/types` or `@smithy/*` at runtime. Those references are type-only.

## 4. d.ts leaks after build [measured]

Command: `grep -rn -e "@aws-sdk" -e "@smithy" dist --include='*.d.ts'` gives 5 files and 11 lines.

```
dist/tools/tools.d.ts:2                import { RuntimeConfigAwsCredentialIdentityProvider } from '@aws-sdk/types/dist-types/identity/AwsCredentialIdentity';
dist/cores/dynamo/dynamo-service.d.ts:2  import { KeySchemaElement } from '@aws-sdk/client-dynamodb';
dist/cores/dynamo/dynamo-service.d.ts:3  import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
dist/cores/dynamo/dynamo-service.d.ts:4  import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
dist/cores/dynamo/dynamo-service.d.ts:5  import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
dist/cores/dynamo/dynamo-service.d.ts:137  createTable(...): Promise<import("@aws-sdk/client-dynamodb").CreateTableCommandOutput>;
dist/cores/dynamo/dynamo-service.d.ts:142  deleteTable(): Promise<import("@aws-sdk/client-dynamodb").DeleteTableCommandOutput>;
dist/cores/protocol/protocol-service.d.ts:3  import { PublishCommandInput } from '@aws-sdk/client-sns';
dist/cores/protocol/protocol-service.d.ts:4  import { SendMessageCommandInput } from '@aws-sdk/client-sqs';
dist/cores/aws/aws-s3-service.d.ts:1    import { S3Client, _Object } from '@aws-sdk/client-s3';
dist/cores/aws/aws-kms-service.d.ts:1   import { KMSClient, SigningAlgorithmSpec } from '@aws-sdk/client-kms';
```

Public names that carry SDK types. "Root" means the name is in `etc/api-names.v4.txt`. "Deep" means it is reachable only via the `./dist/*` export.

| name | where in d.ts | SDK type | root/deep | used in `<templates-api>/src` |
| --- | --- | --- | --- | --- |
| `AWSKMSService.instance()` / `protected _instance` | aws-kms-service.d.ts:51 / :47 | `KMSClient` | root (`AWSKMSService value+type`) | 0 |
| `AWSKMSSignOption.algorithm` (via non-exported `MySigningAlgorithm`) | aws-kms-service.d.ts:3, :20 | `SigningAlgorithmSpec` | deep | 0 |
| `AWSS3Service.instance()` (protected) | aws-s3-service.d.ts:131 | `S3Client` | root (`AWSS3Service`) | 0 |
| `S3Object`, and through it `ListObjectResult.Contents`, `CoreS3Service.listObjects` | aws-s3-service.d.ts:7 | `_Object` | deep | 0 |
| `DynamoService.instance()` return `{dynamo, dynamostr, dynamodoc}` and static `_dynamo`/`_dynamostr`/`_dynamodoc` | dynamo-service.d.ts:55-65 | `DynamoDBClient`, `DynamoDBStreamsClient`, `DynamoDBDocumentClient` | root (`DynamoService`, `DummyDynamoService`) | 0 |
| `DynamoService.prepareCreateTable()` return `.KeySchema` | dynamo-service.d.ts:80 | `KeySchemaElement[]` | root | 0 |
| `DynamoService.createTable()` / `deleteTable()` | dynamo-service.d.ts:137, :142 | `CreateTableCommandOutput` / `DeleteTableCommandOutput` | root | 0 |
| `MySNSEventParam`, `SNSProtocolTransformer.transformToEvent` | protocol-service.d.ts:20, :169, :176 | `PublishCommandInput` | deep | 0 |
| `SQSProtocolTransformer.transformToEvent` (non-exported `SQSEventParam`) | protocol-service.d.ts:183-195 | `SendMessageCommandInput` | deep | 0 |
| `MyProtocolService.transformEvent` | protocol-service.d.ts:91 | `PublishCommandInput \| SendMessageCommandInput` | deep (`MyProtocolService` is not at root; the `ProtocolService` interface does not declare `transformEvent`) | 0 |
| `AwsConfigParams.credentials`, `awsConfig()` return | tools.d.ts:34, :51 | `RuntimeConfigAwsCredentialIdentityProvider` (deep path, **undeclared runtime dep**) | root (`AwsConfigParams type`, `awsConfig value`) | 0 |
| `AWSSNSService.accountID($cfg?: AwsConfigParams)`, `invokeLambda(options.config: AwsConfigParams)` | — | via `AwsConfigParams` | root / deep | 0 |

- `<templates-api>/src` uses **none** of these names [measured: `grep -rn -w` over 19 names]. The only AWS-adjacent lemon-core name it uses is `$core.tools.asyncCredentials(profile)` (`src/express.ts:40`). That function is already async, and its signature does not carry SDK types.
- `<templates-api>/tsconfig.json` has **no `skipLibCheck`** [measured: `grep -n skipLibCheck tsconfig*.json` → none].
- `aws-lambda` types (`@types/aws-lambda`, a runtime `dependency`) also appear in d.ts. They are declared, so they are not a peer issue.
- Other remaining d.ts imports of non-AWS packages: `@opensearch-project/opensearch` (`import type`) in 3 files, a declared dependency. `ioredis` and `@elastic` are gone.

## 5. Specs touching AWS

### 5.1 Full-suite baseline on the untouched tree [measured]

- Run 1: `npm test -- --reporter=default --reporter=json --outputFile=<scratch>/b2c/test.json < /dev/null`.
  - Result: `Test Files 5 failed | 46 passed (51)`, `Tests 5 failed | 494 passed (499)`, 42.18 s.
  - Failures: the baseline 4 (`engine.spec doReportError() - account id`, and `encodeIdentityJWT and verifyToken tests` in lambda-sns-handler, lambda-sqs-handler and lambda-web-handler) **plus** `src/helpers/helpers.spec.ts › utils should pass my_sequence()`.
  - The extra failure is a timer flake: `expected 1793110105424 to be greater than 1793110105424.9`. The 100 ms `waited` fired at 99.x ms by `Date` resolution; load average was 10–15.
- Run 2 is the instrumented run below, with coverage off and an added setup file. Result: **499 total / 495 pass / 4 fail**, the same 4 baseline names. `my_sequence()` passed.
- **Result: the B2-b baseline (499 / 495 / 4, same 4 names) is confirmed.** `my_sequence()` is a known-flaky timing test to watch in the B2-c gate.

### 5.2 Which tests actually call the SDK with no AWS env [measured]

Method: a measurement-only vitest config (`<scratch>/b2c/vitest.spy.config.mjs`) spreads the repo config, sets coverage off, and adds `setupFiles: [<scratch>/b2c/sdk-send-spy.setup.cjs]`. The setup wraps the single `@smithy/smithy-client` `Client.prototype.send` and logs file, test, client, command and outcome to `sdk-send.jsonl`.

```sh
SDK_SPY_OUT=<scratch>/b2c/sdk-send.jsonl LS=1 npx vitest run --config <scratch>/b2c/vitest.spy.config.mjs --reporter=json --outputFile=<scratch>/b2c/test-spy.json < /dev/null
```

The run made 18 `send()` calls. All of them rejected with `CredentialsProviderError`. Every rejection is caught by product code or by the spec, and only tests already in the failing 4 fail.

| spec file › test | client / command | calls |
| --- | --- | --- |
| lambda-sns-handler › `LambdaWEBHandler should pass success POST / 400` | SNSClient / PublishCommand | 1 |
| lambda-sns-handler › `encodeIdentityJWT and verifyToken` (baseline fail; the STS error is caught, the test fails on the `.exp` timezone text) | STSClient / GetCallerIdentityCommand | 1 |
| lambda-sns-handler › `LambdaSNSHandler should pass handle protocol with web (default)` | SNSClient / PublishCommand | 1 |
| lambda-web-handler › `success POST / 400` | SNSClient / PublishCommand | 1 |
| lambda-web-handler › `encodeIdentityJWT and verifyToken` (baseline fail) | STSClient / GetCallerIdentityCommand | 1 |
| lambda-sqs-handler › `success POST / 400` | SNSClient / PublishCommand | 1 |
| lambda-sqs-handler › `encodeIdentityJWT and verifyToken` (baseline fail) | STSClient / GetCallerIdentityCommand | 1 |
| lambda-sqs-handler › `LambdaSQSHandler should pass handle protocol with web (default)` | SNSClient / PublishCommand | 1 |
| extended/cores/abstract-services › `mget() - batch get` | SNSClient / PublishCommand | 2 |
| extended/cores/abstract-controllers › `mget() - batch get` (re-registered from abstract-services.spec) | SNSClient / PublishCommand | 2 |
| controllers/general-api-controller › `basic CRUD ... as name unique` | SNSClient / PublishCommand | 4 |
| controllers/general-api-controller › `basic CRUD ... w/o unique` | SNSClient / PublishCommand | 1 |
| tools/tools.spec › `test awsConfig()` | IAMClient / GetUserCommand | 1 |

- The SNS publishes come from the engine error-report path (`doReport*` → `$sns(arn).reportError` → `publish`). That is engine edge 2: it stays live in tests and must keep working when lazy.
- STS comes from `MyHttpHeaderTool.getAccountId` (lambda-web-handler.ts:577-579).
- `aws-lambda-helper.spec.ts` (9 tests) replaces `@aws-sdk/client-lambda` with `vi.mock(...)` (:13-28). No real `send` happens, so it is absent from the log.

### 5.3 Per-file table [measured counts from `test-spy.json`; gating from code]

"Reported" counts include vitest re-registration of imported specs: lambda-sns/sqs-handler re-run the 21 lambda-web-handler tests.

| spec | reported (pass/fail) | gate | no-AWS-env outcome |
| --- | --- | --- | --- |
| cores/aws/aws-kms-service.spec.ts | 2 / 0 | `if (!PROFILE) return` (:52, :69) after local-only asserts | pass (AWS part skipped, no send) |
| cores/aws/aws-s3-service.spec.ts | 4 / 0 | `if (!PROFILE) return` (:50, :64, :204); test 1 is local only | pass (skipped part) |
| cores/aws/aws-sns-service.spec.ts | 1 / 0 | none; only `endpoint()` with an ARN-shaped env, `asPayload` | pass (no send) |
| cores/aws/aws-sqs-service.spec.ts | 2 / 0 | `ENDPOINTS[PROFILE]` undefined → skip (:39, :122) | pass (no send; the 3.6 s is `wait()`) |
| cores/config/config-service.spec.ts | 3 / 0 | `if (!PROFILE) return` (:74) | pass |
| cores/dynamo/dynamo-service.spec.ts | 6 / 0 | `DummyDynamoService` only; real paths gated by PROFILE | pass (no send) |
| cores/dynamo/dynamo-query-service.spec.ts | 1 / 0 | `if (!PROFILE) return` (:43, :88), `useReal = !!PROFILE` | pass |
| cores/dynamo/dynamo-scan-service.spec.ts | 3 / 0 | `if (!PROFILE) return` (:50, :71), `useScan = !!PROFILE` | pass |
| cores/protocol/aws-lambda-helper.spec.ts | 9 / 0 | **`vi.mock('@aws-sdk/client-lambda')`** | pass (mocked) |
| cores/protocol/protocol-service.spec.ts | 13 / 0 | `PROFILE == 'lemon'` (:213), `== 'comics'` (:255) for `execute` | pass (no send) |
| cores/lambda/lambda-web-handler.spec.ts | 20 / 1 | none on SNS/STS; errors are caught | pass except the baseline JWT test |
| cores/lambda/lambda-sns-handler.spec.ts | 22 / 1 | same | same |
| cores/lambda/lambda-sqs-handler.spec.ts | 22 / 1 | same | same |
| cores/storage/storage-service.spec.ts | 15 / 0 | `DummyStorageService` | pass |
| cores/storage/proxy-storage-service.spec.ts | 8 / 0 | PROFILE | pass |
| extended/cores/abstract-services.spec.ts | 18 / 0 | report path errors are caught | pass (2 SNS sends rejected) |
| extended/cores/abstract-controllers.spec.ts | 26 / 0 | same | pass (2 SNS sends rejected) |
| controllers/general-api-controller.spec.ts | 10 / 0 | same | pass (5 SNS sends rejected) |
| tools/tools.spec.ts | 4 / 0 | `useNone`/`isLemon` from `NAME` (:39-40) | pass. In `useNone` mode it asserts `credentials` is `undefined` and `accountID` rejects with `'Could not load credentials from any providers'` (one real IAM send) |
| extended/libs/sig-v4.spec.ts | 2 / 0 | `asyncCredentials(profile).catch(() => null)` → no sig config | pass (calls a public HTTPS endpoint, as before) |
| engine/engine.spec.ts | 10 / 1 | — | baseline fail `doReportError() - account id` (throws in `getHelloArn` before any send) |
| environ.spec.ts | 3 / 0 | — | pass |

### 5.4 Spec constraints on the B2-c mechanism [code]

- `aws-lambda-helper.spec.ts` relies on `vi.mock('@aws-sdk/client-lambda')`. Vitest mocks apply to static and dynamic `import()`. A plain CJS `require()` of an externalized dependency is **not** intercepted by `vi.mock`. If `invokeLambda` switched to a sync lazy `require` (the B2-b `loadOpenSearch` style), these 9 tests would reach the real SDK. `invokeLambda` is already async, so `await import()` is the natural choice there. This is not measured: no src edits were allowed.
- `tools.spec.ts:74-82` asserts `typeof cfg.credentials` is `'undefined'` with no profile and `'function'` with a profile. The `fromIni` wrapper must stay a function and must stay `undefined` when there is no profile.
- `tools.spec.ts:16` imports `fromIni` statically. That is fine for tests: the package stays a devDependency or peer in the repo.

## 6. Harness facts for gate 6 (server not run)

### 6.1 Boot path [code]

1. `npm run express.lemon` runs `ENV=lemon STAGE=local npm run start`. That builds, then runs nodemon (`nodemon-main.json`: `ts-node ... src/index.ts`).
2. `src/index.ts` (require.main) runs `express().createServer()`. `src/express.ts:20-24` loads `lemon-core/dist/environ` and replaces `process.env` **before** `import ... from 'lemon-core'` (:27).
3. Importing `lemon-core` builds the engine (`engine/index.ts:23`) and, at import, constructs `AWSModule` (`cores/aws/index.ts:31-34`, `new AWSKMSService/AWSSNSService/AWSSQSService/AWSS3Service` — no SDK client) and `ConfigModule` (`new MyConfigService()`). Both stay SDK-free [measured: import-time property access 0, § 2].
4. `src/engine.ts` registers controllers. `BackendService`/`SearchService` construct `DynamoService` (constructor only, no SDK) and `_OS2(...)`.
5. `buildExpress` (`lemon-core tools/express.ts:77-106`) delegates to `lemon-devkit` `buildExpress`. In `<templates-api>/node_modules/lemon-devkit/dist/tools/express.js:356-371`, `createServer()` → `listen` → on `'listening'` runs **`$engine.initialize()`** (:370, not awaited).
6. `initialize()` (`engine/builder.ts:155-199`) runs `ConfigModule.initModule(level)` (`cores/config/index.ts`). That sets `this.config.kms = $aws.kms` and runs `await this.config.init()`.
7. `MyConfigService.init()` (`cores/config/config-service.ts:156-204`) runs `this.kms.decrypt(...)` (:180) for each env value matching `^\*[A-Za-z0-9_/=+]+$`. In `AWSKMSService.decrypt`, `this.instance()` (:138, sync) → module `instance()` → `awsConfig($engine, region())` → `fromIni({ profile: env.NAME })` → `new KMSClient`.
8. Separately, `lemon-devkit` itself requires `@aws-sdk/credential-providers` at load (`node_modules/lemon-devkit/dist/environ.js:65`). Its `_loadCred()` (express.js:124-142) calls `asyncCredentials(profile)` on **every routed request** (:300).

### 6.2 Sync calls at boot that hit the restructured sites [code + measured]

- At import: **none.** The constructors above do not call `instance()`, `awsConfig()` or `prepareCreateTable()` [measured: Proxy-stub import of `dist/index` read 0 SDK properties].
- At `initialize()`: `AWSKMSService.instance()` and `awsConfig()` — both reached **from inside the async `decrypt`**. If § 3.5 makes `instance()` async, the change is `await this.instance()` at :120/:138/:160/:188/:211. No boot-time sync caller exists.
- At request time on the harness paths (`/hello`, `/mocks`, `/search`, CRUD): `DynamoService.instance()` from async storage methods; `awsConfig()` from async SNS/SQS/protocol/STS methods; `asyncCredentials()` from devkit per request. Again, no sync caller.
- `<templates-api>` call sites of `DynamoService.instance`, `AWSKMSService.instance`, `AWSS3Service.instance`, `awsConfig`: **0** [measured: grep]. `asyncCredentials`: 1 (`src/express.ts:40`, its own `credentials()` helper).

### 6.3 Peer packages `<templates-api>` will need [code]

| need | package | path |
| --- | --- | --- |
| KMS decrypt at boot | `@aws-sdk/client-kms` | config init (§ 6.1 step 7) |
| profile credentials | `@aws-sdk/credential-providers` | `awsConfig` / `asyncCredentials` (also present via dev `lemon-devkit`) |
| storage | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (and `client-dynamodb-streams` only while `DynamoService.instance()` still builds `dynamostr`) | `/mocks`, CRUD |
| error reports, JWT account id | `@aws-sdk/client-sns`, `client-iam`, `client-sts` | `doReport*`, `getAccountId` |
| protocol calls, if used | `client-lambda`, `client-sqs` | `$protocol` |

- **Link-mode masking risk:** the B0 harness links `<templates-api>/node_modules/lemon-core` to the `<lemon-core>` worktree. Node resolves `require('@aws-sdk/...')` from the realpath, which is `<lemon-core>/node_modules` (devDeps installed). TypeScript resolves d.ts imports the same way. So gate 6 passes under link **even if `<templates-api>` declares no peers.** Missing peers show up only with a registry or packed install (§ 8 R5).

## 7. ESM wrapper interaction and signature changes

### 7.1 ESM wrapper [measured + code]

- `scripts/gen-esm-wrapper.cjs` emits `export const X = cjs.X` for each value name in `dist/index.d.ts`. That snapshots the **binding values** (class objects and functions) at load.
- Current state [measured]: `npm run esm:smoke` → `esm-smoke: ok names=136 subpaths=4`. `gen-esm-wrapper --check` → `render-twice=same disk=same` for both outputs. `npm run api:check` → `base=304 current=294 added=11 removed=21 allow=32 not-allowed=0`.
- Under § 3.5, no exported value becomes a Promise. `AWSKMSService`, `AWSS3Service`, `DynamoService` and `DummyDynamoService` stay classes. Making `instance()` async changes a method on the class, not the exported binding. `awsConfig` stays a sync function, and only the type of `.credentials` changes. `esm-smoke` checks identity (`esm[k] === cjs[k]`) and module registration, so it does not see the change. The value-name count stays 136 unless a name is added or removed.
- No exported function changes arity under § 3.5.

### 7.2 Signature changes with unchanged names (`api:check` cannot see these)

| name (root?) | today | under § 3.5 |
| --- | --- | --- |
| `AWSKMSService.instance()` (root class) | `(): KMSClient`, sync, public | `(): Promise<KMS-like>`, async; `protected _instance` type becomes local |
| `AWSS3Service.instance()` (root class) | `protected (): S3Client`, sync | `protected (): Promise<S3-like>`; breaks subclasses that override or call it synchronously (0 known) |
| `DynamoService.instance(region?)` (root class, static) | sync, returns `{ dynamo: DynamoDBClient; dynamostr: DynamoDBStreamsClient; dynamodoc: () => Promise<DynamoDBDocumentClient> }` | async (Promise of the same shape with local structural types); `dynamostr` is a removal candidate (§ 2.3) |
| `DynamoService._dynamo` / `_dynamostr` / `_dynamodoc` (protected static) | SDK client record types | local types (and actually filled) |
| `DynamoService.createTable()` / `deleteTable()` | `Promise<CreateTableCommandOutput>` / `Promise<DeleteTableCommandOutput>` | local structural types |
| `DynamoService.prepareCreateTable()` | `KeySchema: KeySchemaElement[]`, `StreamViewType` enum member | local `KeySchemaElement`-shape; `StreamViewType: 'NEW_AND_OLD_IMAGES'` literal (the SDK v3 enum is a const object plus a string-literal union, so the runtime value is the same string) |
| `awsConfig()` (root value) | returns `T & { credentials?: RuntimeConfigAwsCredentialIdentityProvider }` | same shape; `credentials` typed by a local provider type; the runtime value is the async wrapper |
| `AwsConfigParams` (root type) | `credentials?: RuntimeConfigAwsCredentialIdentityProvider` | local provider type |
| `AWSKMSSignOption.algorithm` (deep) | `SigningAlgorithmSpec` | local literal union |
| `S3Object` / `ListObjectResult.Contents` (deep) | `_Object` | local structural type with the same name |
| `MySNSEventParam`, `SNSProtocolTransformer.transformToEvent` (deep) | `PublishCommandInput` | local structural type with the same name |
| `SQSProtocolTransformer.transformToEvent`, `MyProtocolService.transformEvent` (deep) | `SendMessageCommandInput` (and union) | local structural types |
| `AWSSNSService.accountID(engine?, $cfg?)`, `invokeLambda(..., { config })` | via `AwsConfigParams` | follows `AwsConfigParams` |

- Runtime behaviour changes (not in signatures): the first SDK use per package now pays the module-load cost (about 100–300 ms by § 3.2) inside the first request or the first `initialize()` decrypt, not at import. If a peer is missing, the error moves from import time (`Cannot find module`) to first use, as a rejected Promise.

## 8. Risks, contradictions, decisions

| # | finding | against |
| --- | --- | --- |
| R1 | `awsConfig()` has **14** non-spec callers on the current tree, not 16. The 16 may have counted spec or example sites. Line numbers in B2-inventory § 5.1 otherwise still match (kms :35/:102-105, s3 :161/:196-197, dynamo :138-160/:151-152/:209, tools :65/:96-134/:131, sns :104-117/:159-161). | B2-inventory § 5.1, § 7 item 6 |
| R2 | **Mechanism choice.** § 3.5 makes the 3 `instance()` getters async. The B2-b precedent (`elastic6-service.ts:142` `loadOpenSearch()`, sync lazy `require`) would keep every signature in § 7.2 except the type-only ones. Under `module: commonjs`, `await import()` also becomes a deferred `require` (B2-inventory § 5.3), so both are lazy at runtime. Differences: (a) `vi.mock` works with `import()` but not with `require` (§ 5.4, `aws-lambda-helper.spec`); (b) async getters change public signatures (§ 7.2) that DoU may call (DoU symbol census X1/B6 not done). Derivable recommendation: use `await import()` at the async sites (all commands, `invokeLambda`, SNS/SQS/STS/IAM), and decide for the 3 getters between "async, as § 3.5" (internal callers all async; `<templates-api>` 0) and "sync lazy require" (no K6 signature delta). This is a coordinator "how" choice. It is not an owner value decision unless DoU compatibility of `DynamoService.instance()` must be guaranteed. | SPEC § 3.5 |
| R3 | **Engine edge 2 does not need a dynamic import in engine.ts.** If `aws-sns-service.ts` defers its own SDK imports (into `publish`/`accountID`), the static `engine.ts:33` import costs 1 own module and 0 SDK files. Edge 1 is the same: deferring `fromIni` inside `tools.ts` is enough. The stub measurement (§ 3.3: engine 131 modules with the SDK stubbed) is that end state. | SPEC § 3.1 "SNS 정적 edge 끊기", § 3.5 |
| R4 | `$T` gate. Root `$T` and L1 `$T` load **all of `cores/`** (helpers.ts:14,22). "`$T` import만으로 0" therefore needs every one of the 11 packages deferred, not just the engine edges. That is equivalent to the `dist/index` gate. | SPEC § 3.1 완료 판정 |
| R5 | **Peer install is not proven by the linked harness** (§ 6.3). Gate 6 needs either `<templates-api>` declaring peers plus a non-link install check (`npm pack` → install the tarball in a scratch copy, then boot or `tsc`), or an explicit note that link mode cannot test it. `<templates-api>` declares 0 `@aws-sdk` today (§ 1.3). | SPEC § 3.5 게이트 |
| R6 | Gate counting: add `@aws-crypto/*` (9 files) and `@aws/lambda-invoke-store` (1), and report total modules (737 → about 265 projected). B2-inventory's "377" is the path-substring count; the owner count is 288. Both are unchanged since B2-inventory. | SPEC § 3.5 게이트 wording "`@aws-sdk`·`@smithy` 0" |
| R7 | `@aws-sdk/types` (deep path `dist-types/...`) is a devDependency, yet `tools.d.ts:2` needs it. After the § 3.5 local types it can stay dev-only. `@smithy/util-stream` (dev) is unused and is a removal candidate. | B2-inventory § 5.2 |
| R8 | `DynamoDBStreamsClient` is built on every `DynamoService.instance()` call and never used. Dropping `dynamostr` (or building it lazily) removes `@aws-sdk/client-dynamodb-streams` from every path. Peers would go 11 → 10 if `dynamostr` is removed from the public return. That is a K6-scope public-shape change; the coordinator can decide it under K6, and DoU usage is unknown. | SPEC § 3.5 "11종" |
| R9 | The caches `_dynamo`/`_dynamostr` are never written, so the "memo" in § 3.5 is a behaviour fix: from 2 clients per call to 1 per region. The S3 module `instance()` also has no cache (a new `S3Client` per call). § 3.5 does not mention that. | SPEC § 3.5 |
| R10 | Flaky baseline: `helpers.spec my_sequence()` failed once under load (§ 5.1). The B2-c `npm test` gate should name the 4 baseline failures and treat `my_sequence()` as a known timer flake (rerun). | SPEC § 3.5 "테스트 기준선 동일" |
| R11 | `config-service.ts:184` logs the first 12 characters of each **decrypted** config value at `_log` level (seen in an earlier harness boot log; values not copied here). Pre-existing. New checkpoint logs near the decrypt path must not widen this. It may deserve a B5 note. | — |
| R12 | `lemon-devkit` (dev) loads `@aws-sdk/credential-providers` at require time and calls `fromIni` on every routed request (§ 6.1 step 8). Harness boot will always show AWS loaded. Gate 6 measures behaviour (KMS decrypt + `GET /` 200), not load counts. | — |
| Owner | Only Q9 (Dynamo packages in `dependencies`, D21) remains an owner value decision, and it is already open (SPEC § 9). Everything else above follows from measurements or from K6. | — |

## 9. Logging points (for intermediate performance checkpoints)

### 9 (a) How LS / TS / LC are read; where `_log` / `_inf` / `_err` come from [code]

- `engine/builder.ts:219-223` reads env **once**, at `buildEngine()`, through `build_environ(options)` (`:31-39`, `options.env` = the `process.env` object passed by `engine/index.ts:23`):
  - `LS = environ('LS','0') === '1'` → `log`/`error` become no-ops (`:229-230`).
  - `TS = environ('TS','1') === '1'` → `auto_ts`.
  - `LC = environ('LC', STAGE==='local'||STAGE==='express' ? '1' : '') === '1'` → `auto_color` (level tag colouring).
- `build_log` / `build_inf` / `build_err` (`:58-87`) prepend `[COLOR,] ts, LEVEL[+RESET]` and call **`$console.log`** for all three levels. `_err` also goes to `console.log`, not `console.error`. Level letters: `-` log, `I` inf, `E` err (`:48-50`).
- `engine/index.ts:23-32` exports `$engine`, `$U = $engine.U`, `_log = $engine.log`, `_inf = $engine.inf`, `_err = $engine.err`. `builder.ts:270-272` also sets `global._log/_inf/_err`.
- `$U.NS(ns, color?, len=4, delim=':')` (`engine/utilities.ts:295-305`) left-pads `ns` with spaces to `len`, then adds `:`. It colours only if **`this.env('LC','0') === '1'`** (`:300`, through `get_env` → `$engine.environ`). Its default is `'0'`, unlike the builder's STAGE-based default. In the harness, `env/lemon.yml` sets `LC`, `TS`, `LS` explicitly (key names at lines 9–11), so both colour.
- Timestamps come from `Utilities.timestamp` (`utilities.ts:177-195`): `YYYY-MM-DD HH:MM:SS`, **seconds resolution, no milliseconds**. Checkpoints need their own elapsed-ms value in the message.
- `npm test` runs with `LS=1`, so no log line appears in tests.

### 9 (b) Log lines on today's boot path [code; format confirmed against an earlier harness boot log in `<scratch>`, values not copied]

| when | file:line | level | namespace string | message (shape) | timing? |
| --- | --- | --- | --- | --- | --- |
| engine build (import) | engine/builder.ts:261 | `_inf` | none (first arg is `'#STAGE ='`) | `#STAGE = <stage>` | no |
| engine build (import) | engine/builder.ts:262 | `_inf` | none | `! engine[lemon] service is ready!` | no |
| duplicate module (rare) | engine/builder.ts:145 | `_inf` (notice) | none | `! mod.reg(<name>) is already registered - ignored` | no |
| `AWSModule` construct (import) | cores/aws/aws-sqs-service.ts:83 | `_log` | `SQSS:` (`$U.NS('SQSS','blue')` :13) | `AWSSQSService(<endpoint>, <region>)...` | no |
| `ConfigModule` construct (import) | cores/config/config-service.ts:89 | `_log` | `CFGS:` (:23, red) | `ConfigService()...` | no |
| `$engine.initialize()` | engine/builder.ts:155-199 | — | — | **no log** (`console.info` lines at :157, :181, :197 are commented out) | no |
| config init, per encrypted value | cores/aws/aws-kms-service.ts:133 | `_inf` | `KMSS:` (:27, blue) | `decrypt(<first 12 chars of ciphertext>...)..` | no |
| KMS client creation | aws-kms-service.ts:33-36, :102-105 | — | — | **no log** | no |
| config init, decrypt error | config-service.ts:181 | `_log` | `CFGS:` | `ERR@<key> =`, error | no |
| config init, per decrypted value | config-service.ts:184 | `_log` | `CFGS:` | `> config[<key>] :=` + first 12 chars of plaintext (R11) | no |
| config init done | config-service.ts:200 | `_inf` | `CFGS:` | `>> inited... config.len= <n>` | no |
| `DynamoService` construct | cores/dynamo/dynamo-service.ts:118 | `_inf` | `DYNA:` (:30, green) | `DynamoService(<table>/<id>[/<sort>])...` | no |
| Dynamo client creation | dynamo-service.ts:141-142 | — | — | **no log** (2 clients per call) | no |
| DocumentClient creation (once per region) | dynamo-service.ts:149 | `_log` | `DYNA:` | `! creating NEW DynamoDBDocumentClient for region[<r>]` | no |
| `_OS2()` / `OS2ClientService` construct | cores/elastic/elastic6-service.ts:170 | `_inf` | ` OS2:` (:19, green, padded to 4) | `OS2ClientService(<index>/<id>)...` | no |
| `OS2CoreService` construct | elastic6-service.ts:289 | `_inf` | **raw string `'OS2CoreService'`** (not `$U.NS`: no padding, no colon) | `OS2CoreService(<index>/<id>)...` | no |
| OpenSearch client creation | elastic6-service.ts:188-199 (`newClient`), :204-207 (`get client`) | — | — | **no log** | no |
| `_OS2()` / `OS2Instance` | extended/cores/abstract-services.ts:2255-2300, :2511-2547 | — | — | **no log** | no |
| SNS publish (report path) | cores/aws/aws-sns-service.ts:142 / 145 / 163 / 167 | `_inf` / `_log` / `_log` / `_err` | `SNS:` (lazy `NS()` :14-17, blue) | `publish(<target>, <subject>)...`, `> payload[...]`, `> result[...]`, `! err=` | no |
| SNS/IAM/STS client creation | aws-sns-service.ts:107/115/159 | — | — | **no log** (errors only :122, :130) | no |
| STS account id fallback | cores/lambda/lambda-web-handler.ts:573, :582 | `_log` / `_err` | `HWEB:` (:40, yellow) | `! getHelloArn failed, fallback to STS` / `! err@jwt.accountId =` | no |
| SQS/S3 calls | aws-sqs-service.ts:125/129/153..., aws-s3-service.ts:216/275 | `_log` | `SQSS:` / `  S3:` | `> params[...]`, `> result =`, `> data =` | no |
| devkit server (not lemon-core) | lemon-devkit dist/tools/express.js:121, :343, :351, :363, :366 | `_inf`/`_log` (engine loggers) | `EXPR:`, `main:` | `###### express[<name>@<ver>] ######`, `! api[...] is routed as ...`, `Server[...] is listening on Port:...` | no |

- None of these lines prints elapsed time.
- In the earlier harness boot log, the 1-second timestamps show these gaps: about 4 s between engine ready and `SQSS`, and about 20 s between `CFGS: ConfigService()` and the first templates-api `BACK:` line (ts-node module load). This is read from the log, so it is not a measurement of B2-c.

### 9 (c) Existing elapsed-time helpers in non-spec src [measured: grep]

| file:line | what | logged? |
| --- | --- | --- |
| helpers/helpers.ts:26, :400-414 | `$T.perf()` → class with `t0 = performance.now()` and `took()` = seconds rounded to 0.01 | not logged by itself. Used at `extended/cores/abstract-services.ts:796` and `:901` (`took` returned in the `doSyncScan` result) |
| engine/utilities.ts:285-290 | `$U.current_time_ms(shift?)` = `new Date().getTime()` | building block only (used at utilities.ts:876, lambda-web-handler.ts:718/:776, helpers.ts:668) |
| tools/aws-lambda-helper.example.ts:181-189 | `Date.now()` delta → `console.info(NS, 'elapsed.ms =', ...)` | example only |

- No `process.hrtime` and no `console.time` in non-spec src.
- `$T.perf` lives in `helpers/`, which imports all of `cores/`. Using it from engine/tools/aws code would re-create a heavy edge. A checkpoint helper should live in `engine/` or `lib/`.

### 9 (d) Can `src/lib/*` import `_inf` / `$U` from `src/engine` without a cycle? [code + measured]

- `lib/` files and their imports: `lazy.ts` none; `http-fetch.ts` → `../common/test-helper` only; `dynamodb-value.ts` none. `lib/index.ts` re-exports only `dynamodb-value` (`lazy` is internal).
- Importers of `lib/*`: `index.ts:27` (barrel), `extended/cores/abstract-services.ts:64` (`lazy`), `helpers/helpers.ts:28` (`http-fetch`), `cores/api/api-service.ts:487` (`http-fetch`), `cores/lambda/lambda-dynamo-stream-handler.ts:16` (`dynamodb-value`).
- `engine/index.ts` imports `./builder` (→ `./types`, `./utilities`, which import no other own module), `./types` and `./engine`. `engine.ts` imports `./index` (an existing cycle), `../tools/` and `../cores/aws/aws-sns-service` (which imports `../../engine` — a second existing cycle).
- The engine closure (10 own modules, § 3.1) contains **no `lib/*` file** [measured]. So `lib/*` importing `../engine` today creates **no cycle**.
- If B2-c makes `tools/tools.ts` or `aws-sns-service.ts` (both inside the engine closure) import a `lib/*` helper that imports `../engine`, you get engine/index → engine.ts → tools/aws-sns → lib → engine/index. That is the same shape as the existing `aws-sns-service` cycle, and it is safe at runtime: `dist/engine/index.js` assigns `$engine`, `$U`, `_log`, `_inf`, `_err` (lines 19-28) **before** `require("./engine")` (line 31), and tsc emits live `engine_1._inf(...)` property reads.
- **Two cautions:**
  1. `tools/tools.ts:23` carries `// import $engine from '../engine'; #WARN! DO NOT LOAD $engine here due to global initialization.` A `lib` helper that imports engine, used from `tools.ts`, breaks that rule indirectly.
  2. `engine/builder.ts:26-28` forbids any non-type import.
- **Safest form:** keep `lib/*` engine-free and pass the logger in (for example `checkpoint(log, NS, label, t0)`), or put the helper in `engine/`.

### 9 (e) Exact format of an `_inf` line [code]

- With `TS=1`, `LC=0`: `console.log(ts, 'I', NS, ...args)` → `2026-10-27 13:47:01 I KMSS: decrypt(...)..`
- With `LC=1` (the harness): `console.log('\x1b[33m', ts, 'I\x1b[0m', NS, ...args)`. Console's space join gives `\x1b[33m 2026-10-27 13:47:01 I\x1b[0m \x1b[34mKMSS:\x1b[0m decrypt(...)..`. There is a leading space after the colour code. The NS is coloured only when env `LC=1`, through `$U.NS`.
- NS convention: `$U.NS('<ABCD>', '<color>')` is a 4-character tag. Shorter tags are left-padded (` OS2:`, `  S3:`) and a colon is appended.
- Message prefix conventions in this code base:
  - `name(args)...` for constructor or method entry (`DynamoService(...)...`, `ConfigService()...`, `decrypt(...)..`).
  - `> key =` or `> key :=` followed by a value, for an intermediate value.
  - `>> ...` for a summary at the end of a step (`>> inited... config.len=`).
  - `! ...` for a notable event (`! engine[lemon] service is ready!`, `! creating NEW ...`).
  - `!ERR` / `! err =` for errors.
- A checkpoint line that matches: `_inf(NS, '> took.ms =', ms, '@', label)` or `_inf(NS, \`>> <step> done... took.ms=\`, ms)` with an existing 4-character NS. Use `_inf` so it shows at the `I` level. Compute `ms` from `performance.now()` or `process.hrtime.bigint()`, because the timestamp has 1-second resolution.

## Artifacts in `<scratch>/b2c/`

`scan-aws.cjs`/`scan-aws.tsv` (AST site scan), `scan-calls.cjs` (caller chains), `aws-probe.cjs` + `probe1.json` (load counts), `stub-probe.cjs` (projected closure), `build.log`, `test.log`/`test.json` (plain `npm test`), `vitest.spy.config.mjs` + `sdk-send-spy.setup.cjs` + `sdk-send.jsonl` + `test-spy.json` (SDK send census), `field-registry.ts.pristine`/`.postbuild`, `lc-ls-all.txt`.
