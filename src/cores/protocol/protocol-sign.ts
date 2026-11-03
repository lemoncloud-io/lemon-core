/**
 * `cores/protocol/protocol-sign.ts`
 * - v5 B5: HMAC-SHA256 signature of the internal protocol calls (K10, SPEC § 6.2).
 * - web: header `x-protocol-signature` over the context header string and the body.
 * - SNS/SQS: message attribute `signature` over the message string.
 * - value `v1.<ts>.<sig>`: `ts` = epoch seconds, `sig` = base64url(HMAC-SHA256(key, canonical)).
 * - value `v2.<ts>.<nonce>.<sig>`: + a random nonce per signature, mixed into the canonical (no nonce store yet:
 *   it makes every signature unique; replay rejection needs a store — next increment). Receivers take v1 and v2;
 *   senders write v2 only with `PROTOCOL_SIGN_VERSION=v2` (default v1 until every receiver runs this version).
 * - NOTE: deep module only (`./dist/cores/protocol/protocol-sign`). not re-exported by the root.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (v5 B5)
 * @date        2026-10-30 v5 B14: `HEADER_LEMON_RELAY` (masked in logs), `readConfig()` exported, `HEADER_PROTOCOL_CONTEXT` deprecated.
 * @date        2026-10-30 key rotation: dual keys A/B (`PROTOCOL_SIGN_KEY_PREV` + `_PREV_UNTIL`), keys registered for log screening.
 * @date        2026-10-30 key rotation: `v2` signature with a nonce (`PROTOCOL_SIGN_VERSION`), v1 still verified.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import crypto from 'crypto';
import { $U, _inf } from '../../engine/';
import $conf from '../config/';
import { registerSecret } from '../../lib/log-mask';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.

/** env name of the install-wide signing key (`*<base64>` is KMS-decrypted by the config service) */
export const PROTOCOL_SIGN_KEY = 'PROTOCOL_SIGN_KEY';
/** key rotation: env name of the previous key B (verify only, never signs) */
export const PROTOCOL_SIGN_KEY_PREV = `${PROTOCOL_SIGN_KEY}_PREV`;
/** key rotation: env name of the expiry of B (epoch seconds). B without it is never used (fail-closed) */
export const PROTOCOL_SIGN_KEY_PREV_UNTIL = `${PROTOCOL_SIGN_KEY}_PREV_UNTIL`;
/** env name of the signature version senders write (`v1` default | `v2` with a nonce) */
export const PROTOCOL_SIGN_VERSION = 'PROTOCOL_SIGN_VERSION';
/** env name of the verify mode (`off` | `warn` | `enforce`) */
export const PROTOCOL_VERIFY = 'PROTOCOL_VERIFY';
/** header name of the web signature */
export const HEADER_PROTOCOL_SIGNATURE = 'x-protocol-signature';
/**
 * header name to exchange `next-context`, ONLY for internal communication.
 * - v5 B10-3: defined here (was `protocol-service.ts`, which re-exports it) so that `lambda-handler.ts` reads it without an import cycle.
 *
 * @deprecated v5 B14: the full context is replaced by the relay (`HEADER_LEMON_RELAY`). v5 sends it only with
 *  `PROTOCOL_LEGACY_CONTEXT=send` and accepts it by `PROTOCOL_LEGACY_ACCEPT`. removal in v6.
 */
export const HEADER_PROTOCOL_CONTEXT = $U.env('HEADER_PROTOCOL_CONTEXT', 'x-protocol-context');
/**
 * v5 B14: header name of the relay envelope (`r1.<base64url(JSON)>`) of an internal web call (see `protocol-relay.ts`).
 * - defined here (no import cycle with `lambda-handler.ts`), re-exported by `protocol-relay.ts`.
 */
export const HEADER_LEMON_RELAY = 'x-lemon-relay';
/**
 * header name of the identity of an internal call (JSON) or a JWT.
 * - v5 B10-3: defined here (was a private const of `lambda-web-handler.ts`) for the same reason.
 */
export const HEADER_LEMON_IDENTITY = $U.env('HEADER_LEMON_IDENTITY', 'x-lemon-identity');
/** v5 B10-3: protocol header names whose values are masked in logs (`maskHeaders()` of `lib/log-mask.ts`) */
export const PROTOCOL_LOG_MASKED_HEADERS: readonly string[] = [
    HEADER_PROTOCOL_CONTEXT,
    HEADER_PROTOCOL_SIGNATURE,
    HEADER_LEMON_IDENTITY,
    HEADER_LEMON_RELAY, //* v5 B14: the relay carries identity ids like the context.
];
/** message attribute name of the SNS/SQS signature */
export const ATTR_PROTOCOL_SIGNATURE = 'signature';
/** web freshness window (seconds). SNS/SQS have none (queue delay, retry and DLQ redrive exceed any window) */
export const WEB_FRESHNESS_SEC = 300;

/** signature version */
export type ProtocolSignVersion = 'v1' | 'v2';
/** options of a signing (`key`, `now`, `version` and `nonce` override the defaults — tests and tools) */
export interface ProtocolSignOptions {
    key?: string;
    now?: number;
    /** default: `readSignVersion()` */
    version?: ProtocolSignVersion;
    /** v2 only. default: 16 random bytes, base64url */
    nonce?: string;
}

/** verify mode */
export type ProtocolVerifyMode = 'off' | 'warn' | 'enforce';

/** result of a verification */
export interface ProtocolVerifyResult {
    /** true if the signature is valid */
    ok: boolean;
    /** reason of a failure (`missing`, `format`, `stale`, `mismatch`, `no-key`) */
    reason?: string;
    /** signed time (epoch seconds) if parsed — for logs only */
    ts?: number;
    /** key rotation: true if the previous key B matched (A did not) */
    prev?: boolean;
}

/** key rotation: options of a verification (`key` alone keeps the single-key behaviour, `prevKey`/`prevUntil` override B) */
export interface ProtocolVerifyOptions {
    /** key A (default: `readSignKey()`). if given without `prevKey`, B is not used */
    key?: string;
    /** key B (default: `readPrevSignKey()`) */
    prevKey?: string;
    /** expiry of `prevKey` (epoch seconds) */
    prevUntil?: number;
    /** current epoch seconds */
    now?: number;
}

//* module cache of the key (filled on the first non-empty read).
let $signKey: string = null;
//* the "key not set" line is printed once.
let $keyLogged = false;
//* key rotation: module cache of the raw B and its expiry (filled on the first non-empty read, the window is checked per call).
const $prev = { key: null as string, until: 0 };

/** key rotation: true if a config value is a usable key (set, not a failed KMS decrypt `ERROR - …`) */
const isKey = (key?: string): boolean => !!key && !key.startsWith('ERROR - ');

/** key rotation: B if usable — set, `until` is a positive number and `now <= until`; else '' (fail-closed) */
export const validPrevKey = (key: string, until: number, now: number): string =>
    isKey(key) && Number.isFinite(until) && until > 0 && now <= until ? key : '';

/** key rotation: read the raw B (`<name>_PREV`) and its expiry (`<name>_PREV_UNTIL`) of a key env name. B is registered as a log secret */
export const readPrevRaw = (name: string): { key: string; until: number } => {
    const key = readConfig(`${name}_PREV`) ?? '';
    const until = Number(readConfig(`${name}_PREV_UNTIL`) ?? 0);
    if (isKey(key)) registerSecret(key);
    return { key, until: Number.isFinite(until) ? until : 0 };
};

/** read a config value via the config service (KMS-decrypted). before `init()`, a plain (not `*`) env value is used */
export const readConfig = (name: string): string => {
    const val = $conf?.config?.get(name);
    if (val !== undefined && val !== null) return `${val}`;
    //* config not initialized yet (ex: unit tests): never use an encrypted `*...` value as is.
    const raw = process?.env?.[name];
    return typeof raw === 'string' && !raw.startsWith('*') ? raw : undefined;
};

/** read the signing key (cached after the first non-empty read) */
export const readSignKey = (): string => {
    if ($signKey) return $signKey;
    const key = readConfig(PROTOCOL_SIGN_KEY);
    //* a failed KMS decrypt leaves `ERROR - …` in the config — treat as not set.
    if (isKey(key)) $signKey = key;
    //* key rotation: a key installed as a plain env is screened in logs too.
    if ($signKey) registerSecret($signKey);
    return $signKey || '';
};

/** key rotation: read the previous key B if valid at `now` (raw values cached like `readSignKey()`) */
export const readPrevSignKey = (now: number = nowSec()): string => {
    //* cache the raw B and its expiry once B is set.
    if (!$prev.key) {
        const raw = readPrevRaw(PROTOCOL_SIGN_KEY);
        if (isKey(raw.key)) Object.assign($prev, raw);
    }
    return validPrevKey($prev.key, $prev.until, now);
};

/** reset the module cache (for tests that toggle the env) */
export const resetProtocolSign = (): void => {
    $signKey = null;
    $keyLogged = false;
    //* key rotation: B cache too.
    Object.assign($prev, { key: null, until: 0 });
};

/** the signature version senders write: `v2` only when `PROTOCOL_SIGN_VERSION=v2`, else `v1` */
export const readSignVersion = (): ProtocolSignVersion =>
    `${readConfig(PROTOCOL_SIGN_VERSION) ?? ''}`.trim().toLowerCase() === 'v2' ? 'v2' : 'v1';

/** read the verify mode. default: `warn` if the key is set, else `off` */
export const readVerifyMode = (): ProtocolVerifyMode => {
    const mode = `${readConfig(PROTOCOL_VERIFY) ?? ''}`.trim().toLowerCase();
    if (mode === 'off' || mode === 'warn' || mode === 'enforce') return mode;
    return readSignKey() ? 'warn' : 'off';
};

/** print the init line once when no key is set (called from the protocol module init) */
export const logSignKeyState = (): void => {
    if ($keyLogged) return;
    $keyLogged = true;
    if (!readSignKey()) _inf(NS, `PROTOCOL sign key not set — contexts unsigned`);
};

/** sha256 hex of a string (`null`/`undefined` → empty string) */
export const sha256hex = (text?: string | null): string =>
    crypto
        .createHash('sha256')
        .update(text ?? '', 'utf8')
        .digest('hex');

/** base64url(HMAC-SHA256(key, canonical)) */
const hmac = (key: string, canonical: string): string =>
    crypto.createHmac('sha256', key).update(canonical, 'utf8').digest('base64url');

/** the canonical head: `v1\n<ts>`, or `v2\n<ts>\n<nonce>` when a nonce is given */
const headOf = (ts: number, nonce?: string): string => (nonce ? `v2\n${ts}\n${nonce}` : `v1\n${ts}`);

/** canonical string of a web call: `<head>\n<contextJson>\n<sha256hex(body ?? '')>` */
export const canonicalWeb = (ts: number, contextJson: string, body?: string | null, nonce?: string): string =>
    `${headOf(ts, nonce)}\n${contextJson ?? ''}\n${sha256hex(body ?? '')}`;

/** canonical string of a SNS/SQS message: `<head>\n<sha256hex(message)>` */
export const canonicalMessage = (ts: number, message: string, nonce?: string): string =>
    `${headOf(ts, nonce)}\n${sha256hex(message ?? '')}`;

/** a nonce: base64url, 16-64 chars (16 random bytes → 22 chars) */
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** current epoch seconds */
const nowSec = (): number => Math.floor(Date.now() / 1000);

/** a parsed signature (`nonce` only for v2) */
interface ParsedSig {
    version: ProtocolSignVersion;
    ts: number;
    nonce?: string;
    sig: string;
}

/** parse `v1.<ts>.<sig>` or `v2.<ts>.<nonce>.<sig>` (null if malformed) */
const parseSignature = (signature: string): ParsedSig => {
    const parts = typeof signature === 'string' ? signature.split('.') : [];
    const v1 = parts.length === 3 && parts[0] === 'v1';
    const v2 = parts.length === 4 && parts[0] === 'v2' && NONCE_RE.test(parts[2]);
    if (!(v1 || v2) || !/^[0-9]{1,12}$/.test(parts[1]) || !parts[parts.length - 1]) return null;
    return v2
        ? { version: 'v2', ts: Number(parts[1]), nonce: parts[2], sig: parts[3] }
        : { version: 'v1', ts: Number(parts[1]), sig: parts[2] };
};

/** the signature string of `ts` (+ a nonce for v2) over `canonicalOf(nonce)` */
const signWith = (key: string, options: ProtocolSignOptions, canonicalOf: (ts: number, nonce?: string) => string) => {
    const ts = options?.now ?? nowSec();
    if ((options?.version ?? readSignVersion()) !== 'v2') return `v1.${ts}.${hmac(key, canonicalOf(ts))}`;
    const nonce = options?.nonce ?? crypto.randomBytes(16).toString('base64url');
    return `v2.${ts}.${nonce}.${hmac(key, canonicalOf(ts, nonce))}`;
};

/** constant-time compare of two base64url strings (key rotation: exported for the JWT HS256 check, non-string → false) */
export const sameSig = (a: string, b: string): boolean => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** key rotation: B of a verification — `prevKey` override, none if only `key` is given, else `readPrevSignKey()` */
const prevKeyOf = (options: ProtocolVerifyOptions, now: number): string => {
    if (options?.prevKey !== undefined) return validPrevKey(options.prevKey, options.prevUntil ?? 0, now);
    return options?.key !== undefined ? '' : readPrevSignKey(now);
};

/** key rotation: compare with A first, then B (if valid). 1 HMAC for an A signature, 2 only for a B one */
const matchKeys = ($sig: ParsedSig, canonical: string, key: string, prevKey: string): ProtocolVerifyResult => {
    if (sameSig($sig.sig, hmac(key, canonical))) return { ok: true, ts: $sig.ts };
    if (prevKey && sameSig($sig.sig, hmac(prevKey, canonical))) return { ok: true, ts: $sig.ts, prev: true };
    return { ok: false, reason: 'mismatch', ts: $sig.ts };
};

/**
 * sign a web call. returns `v1.<ts>.<sig>` (or `v2.<ts>.<nonce>.<sig>`), or '' if no key.
 * @param contextJson   the exact header string (`x-protocol-context`)
 * @param body          the exact event body string (or null)
 */
export const signContext = (contextJson: string, body?: string | null, options?: ProtocolSignOptions) => {
    const key = options?.key ?? readSignKey();
    if (!key) return '';
    return signWith(key, options, (ts, nonce) => canonicalWeb(ts, contextJson, body, nonce));
};

/**
 * verify a web call (freshness 300 s). compares the raw header string, never a re-serialized one.
 */
export const verifyContext = (
    signature: string,
    contextJson: string,
    body?: string | null,
    options?: ProtocolVerifyOptions,
): ProtocolVerifyResult => {
    const key = options?.key ?? readSignKey();
    if (!key) return { ok: false, reason: 'no-key' };
    if (!signature) return { ok: false, reason: 'missing' };
    const $sig = parseSignature(signature);
    if (!$sig) return { ok: false, reason: 'format' };
    //* freshness: |now - ts| <= 300 s.
    const now = options?.now ?? nowSec();
    if (Math.abs(now - $sig.ts) > WEB_FRESHNESS_SEC) return { ok: false, reason: 'stale', ts: $sig.ts };
    return matchKeys($sig, canonicalWeb($sig.ts, contextJson, body, $sig.nonce), key, prevKeyOf(options, now));
};

/**
 * sign a SNS/SQS message (the exact string the receiver gets). returns `v1.<ts>.<sig>` (or v2), or '' if no key.
 */
export const signMessage = (message: string, options?: ProtocolSignOptions) => {
    const key = options?.key ?? readSignKey();
    if (!key) return '';
    return signWith(key, options, (ts, nonce) => canonicalMessage(ts, message, nonce));
};

/**
 * verify a SNS/SQS message (no freshness window).
 */
export const verifyMessage = (
    signature: string,
    message: string,
    options?: ProtocolVerifyOptions,
): ProtocolVerifyResult => {
    const key = options?.key ?? readSignKey();
    if (!key) return { ok: false, reason: 'no-key' };
    if (!signature) return { ok: false, reason: 'missing' };
    const $sig = parseSignature(signature);
    if (!$sig) return { ok: false, reason: 'format' };
    //* key rotation: `now` only decides whether B is still valid (no freshness window here).
    const now = options?.now ?? nowSec();
    return matchKeys($sig, canonicalMessage($sig.ts, message, $sig.nonce), key, prevKeyOf(options, now));
};

/**
 * apply the verify mode to a result.
 * - `off`: pass without checking. `warn`: pass, and log 1 line if not ok. `enforce`: throw `403` if not ok.
 *
 * @param source    `web` | `sns` | `sqs` (for the log line)
 * @param verify    lazy verification (not run in `off`)
 */
export const assertSigned = (source: string, verify: () => ProtocolVerifyResult, mode?: ProtocolVerifyMode) => {
    const $mode = mode ?? readVerifyMode();
    if ($mode === 'off') return true;
    const res = verify();
    if (res.ok) return true;
    //* `warn`: accept the v4 caller (unsigned or mismatched), 1 line through the existing logger.
    if ($mode === 'warn') {
        _inf(NS, `PROTOCOL unsigned ${source}`, `(${res.reason ?? ''})`);
        return false;
    }
    throw new Error(`403 NOT ALLOWED - unsigned protocol context`);
};
