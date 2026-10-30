# v5 — dual sign keys and value-based log screening

Status: implemented 2026-10-30 on `feat/v5-key-rotation` (base `v5` @ `da5de79b`, 5.0.11). A separate track from the v5 bundles (no bundle number). User-facing changes: `HOW_TO_UPGRADE_V5.md` § 18 (§ 17 is taken by #256, which merges first).

## Scope

- **Dual keys.** The protocol signing key (`PROTOCOL_SIGN_KEY`) and the JWT HS256 key (`JWT_SIGN_KEY`) each accept a previous key B for a bounded window, so a key can be replaced without rejecting calls signed just before the change. Signing always uses the current key A.
- **Signature format unchanged.** `v1.<ts>.<sig>` as in B5 § 1 — no `v2`, no key id. The receiver tries A, then B. No deploy order constraint on the wire format.
- **Log screening.** The engine loggers (`_log`, `_inf`, `_err`) mask any installed secret value found in a log line and print one error line. B10-3 masks by header **name**; this layer matches by **value**.
- **Two log paths fixed by hand.** `AWSKMSService.encrypt()` printed the first 10 plaintext characters and the full KMS result (key ARN); `parseIdentityJWT()` errors embedded the full token.

## Env contract

| Env | Meaning | Used for |
| --- | --- | --- |
| `PROTOCOL_SIGN_KEY` | A — current protocol key | sign (always), verify first |
| `PROTOCOL_SIGN_KEY_PREV` | B — previous protocol key | verify second, never signs |
| `PROTOCOL_SIGN_KEY_PREV_UNTIL` | expiry of B, epoch seconds | B is used only while `now <= UNTIL` |
| `JWT_SIGN_KEY` | A — current HS256 key (default `lemon` when unset) | `signToken()` HS256, local `api/<self>` verify first |
| `JWT_SIGN_KEY_PREV` | B — previous HS256 key | local verify second |
| `JWT_SIGN_KEY_PREV_UNTIL` | expiry of B, epoch seconds | as above |

- All six are read through the config service (`readConfig()`): a `*<base64>` value is KMS-decrypted at init; before init a plain env value is used and a `*…` value never is.
- B is **fail-closed**: B is ignored when it is unset, a failed decrypt (`ERROR - …`), or when `UNTIL` is missing, not a number, `<= 0`, or in the past.
- A has no expiry. Expiring A would break every signature.
- `JWT_SIGN_KEY` was read once at module load with `$U.env()`; it is now read per call. Unset → `lemon`, the same secret as before. A configured key that failed to decrypt (`ERROR - …`) throws `500 INVALID CONFIG - JWT_SIGN_KEY decrypt failed` — no fallback to the public default (signing fails, verification returns `valid: false`).
- `JWT_MAGIC_KEY` is unchanged.

## Verify order

Protocol (`verifyContext()` web, `verifyMessage()` SNS/SQS):

1. No A → `no-key`. No signature → `missing`. Not `v1.<ts>.<sig>` → `format`. Web only: `|now - ts| > 300` → `stale`. These are checked once, independent of the key.
2. HMAC with A matches → `{ ok: true, ts }`.
3. Else, B valid at `now` and HMAC with B matches → `{ ok: true, ts, prev: true }`.
4. Else → `mismatch` (same reason as before).

- Cost: one HMAC for an A-signed call (as before), two only for a B-signed one. Compare stays constant time (`crypto.timingSafeEqual`).
- `options.key` alone keeps the single-key behaviour (B is not read). `options.prevKey` / `options.prevUntil` / `options.now` override B for tests.
- SNS/SQS have no freshness window: `now` decides only whether B is still valid.

JWT HS256 (`verifyToken()`, issuer `api/<self>`): the secret of A is compared first, then the secret of B while valid. `buildJwtSecret(signKey?)` takes an optional key; without it A is used. Remote issuers (`api/<other>`) and `kms/*` are unchanged.

## Log screening

| Step | Where | What |
| --- | --- | --- |
| Register | `ConfigService.init()` | every successfully decrypted `*` value (not `ERROR - …`) |
| Register | `readSignKey()`, `readPrevRaw()` (`PROTOCOL_SIGN_KEY_PREV`, `JWT_SIGN_KEY_PREV`), `readJwtSignKey()` | the key they return — covers a key installed as a plain env |
| Screen | `build_log` / `build_inf` / `build_err` (`engine/builder.ts`) | before printing, each arg is checked |
| Report | same `$console` | one extra line `!SECRET in log — masked` at error level, with no value |

- Values shorter than 8 characters and non-strings are not registered (they collide with ordinary text). The default `lemon` is never registered.
- A string arg keeps its text with each secret replaced by `[masked:<len>]`.
- An `Error` arg is checked by `stack || message`; another object by the circular-safe stringify (`lib/safe-json.ts`). On a hit the arg is replaced by its masked text; the original object is not changed.
- Empty registry (no key installed) → no check at all.
- The process does not stop: a log line must not fail a request.

## Limits

- **Direct `console.log`** (or any logger that does not go through the engine loggers) is not screened.
- **`LS=1`** (log silent): the loggers print nothing, so screening is skipped — no stringify cost per log call.
- **SQS/SNS messages older than the B window**: a message signed by the old key and delivered after `UNTIL` (queue delay, retry, DLQ redrive) is `mismatch` — `warn` logs one line and processes it, `enforce` rejects it (SQS → record failure → DLQ). A service with SQS sets the B window at least as long as the queue retention.
- **Receivers on 5.0.7 or older** do not read B. Replace a key only after every receiver of the install runs this version.
- Screening finds an exact value only. A secret printed in another encoding (base64, split across args) is not found.
- The registry is per container; values decrypted elsewhere are unknown.

## Files

| File | Change |
| --- | --- |
| `src/cores/protocol/protocol-sign.ts` | `PROTOCOL_SIGN_KEY_PREV(_UNTIL)`, `readPrevSignKey()`, `readPrevRaw()`, `validPrevKey()`, `ProtocolVerifyOptions`, `ProtocolVerifyResult.prev`, A → B in `verifyContext`/`verifyMessage`, `sameSig` exported, keys registered for screening |
| `src/cores/lambda/lambda-web-handler.ts` | `readJwtSignKey()`, `readJwtPrevKey()`, `buildJwtSecret(signKey?)`, A → B constant-time HS256 verify, `parseIdentityJWT` errors mask the token |
| `src/lib/log-mask.ts` | `registerSecret()`, `clearSecrets()`, `screenLogArgs()`, `SECRET_MIN_LENGTH` |
| `src/engine/builder.ts` | loggers screen args and print the `!SECRET` line (shared `print_line`/`build_line`); skipped under `LS=1` |
| `src/cores/config/config-service.ts` | `init()` registers decrypted values |
| `src/cores/aws/aws-kms-service.ts` | `encrypt()` logs the plaintext length and the ciphertext length only |
| specs | `protocol-sign.spec.ts` (+4), `lambda-web-handler.spec.ts` (+1, 3 messages updated), `log-mask.spec.ts` (+3), `builder.spec.ts` (+1) |
| `HOW_TO_UPGRADE_V5.md` | § 18 and checklist |

No root export added (`src/index.ts` unchanged); the new names live on deep modules only.

## Gates (2026-10-30, local, on `da5de79b`)

| Gate | Result |
| --- | --- |
| `npm test` | 64 files, 898 passed (baseline 880/880, measured on `88502a04`; `da5de79b` adds no spec. The web spec also runs inside the SNS/SQS specs and the builder spec inside 3 utilities specs, so one new test can count more than once) |
| `npm run api:check` | `base=304 current=306 added=24 removed=22 allow=46 not-allowed=0` (unchanged) |
| `npm run api:names` | 306 names (unchanged) |
| `npm run esm:smoke` | `esm-smoke: ok names=141 subpaths=5` (unchanged) |
| `npx tsc --noEmit` / `eslint` / `prettier --check` on changed files | pass (3 pre-existing warnings in `lambda-web-handler.spec.ts:83`) |
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
