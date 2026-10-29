/**
 * `cores/protocol/protocol-sign.ts`
 * - v5 B5: HMAC-SHA256 signature of the internal protocol calls (K10, SPEC § 6.2).
 * - web: header `x-protocol-signature` over the context header string and the body.
 * - SNS/SQS: message attribute `signature` over the message string.
 * - value `v1.<ts>.<sig>`: `ts` = epoch seconds, `sig` = base64url(HMAC-SHA256(key, canonical)).
 * - NOTE: deep module only (`./dist/cores/protocol/protocol-sign`). not re-exported by the root.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (v5 B5)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import crypto from 'crypto';
import { $U, _inf } from '../../engine/';
import $conf from '../config/';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.

/** env name of the install-wide signing key (`*<base64>` is KMS-decrypted by the config service) */
export const PROTOCOL_SIGN_KEY = 'PROTOCOL_SIGN_KEY';
/** env name of the verify mode (`off` | `warn` | `enforce`) */
export const PROTOCOL_VERIFY = 'PROTOCOL_VERIFY';
/** header name of the web signature */
export const HEADER_PROTOCOL_SIGNATURE = 'x-protocol-signature';
/**
 * header name to exchange `next-context`, ONLY for internal communication.
 * - v5 B10-3: defined here (was `protocol-service.ts`, which re-exports it) so that `lambda-handler.ts` reads it without an import cycle.
 */
export const HEADER_PROTOCOL_CONTEXT = $U.env('HEADER_PROTOCOL_CONTEXT', 'x-protocol-context');
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
];
/** message attribute name of the SNS/SQS signature */
export const ATTR_PROTOCOL_SIGNATURE = 'signature';
/** web freshness window (seconds). SNS/SQS have none (queue delay, retry and DLQ redrive exceed any window) */
export const WEB_FRESHNESS_SEC = 300;

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
}

//* module cache of the key (filled on the first non-empty read).
let $signKey: string = null;
//* the "key not set" line is printed once.
let $keyLogged = false;

/** read a config value via the config service (KMS-decrypted). before `init()`, a plain (not `*`) env value is used */
const readConfig = (name: string): string => {
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
    if (key && !key.startsWith('ERROR - ')) $signKey = key;
    return $signKey || '';
};

/** reset the module cache (for tests that toggle the env) */
export const resetProtocolSign = (): void => {
    $signKey = null;
    $keyLogged = false;
};

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

/** canonical string of a web call: `v1\n<ts>\n<contextJson>\n<sha256hex(body ?? '')>` */
export const canonicalWeb = (ts: number, contextJson: string, body?: string | null): string =>
    `v1\n${ts}\n${contextJson ?? ''}\n${sha256hex(body ?? '')}`;

/** canonical string of a SNS/SQS message: `v1\n<ts>\n<sha256hex(message)>` */
export const canonicalMessage = (ts: number, message: string): string => `v1\n${ts}\n${sha256hex(message ?? '')}`;

/** current epoch seconds */
const nowSec = (): number => Math.floor(Date.now() / 1000);

/** parse `v1.<ts>.<sig>` (null if malformed) */
const parseSignature = (signature: string): { ts: number; sig: string } => {
    const parts = typeof signature === 'string' ? signature.split('.') : [];
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    if (!/^[0-9]{1,12}$/.test(parts[1]) || !parts[2]) return null;
    return { ts: Number(parts[1]), sig: parts[2] };
};

/** constant-time compare of two base64url strings */
const sameSig = (a: string, b: string): boolean => {
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * sign a web call. returns `v1.<ts>.<sig>`, or '' if no key.
 * @param contextJson   the exact header string (`x-protocol-context`)
 * @param body          the exact event body string (or null)
 */
export const signContext = (contextJson: string, body?: string | null, options?: { key?: string; now?: number }) => {
    const key = options?.key ?? readSignKey();
    if (!key) return '';
    const ts = options?.now ?? nowSec();
    return `v1.${ts}.${hmac(key, canonicalWeb(ts, contextJson, body))}`;
};

/**
 * verify a web call (freshness 300 s). compares the raw header string, never a re-serialized one.
 */
export const verifyContext = (
    signature: string,
    contextJson: string,
    body?: string | null,
    options?: { key?: string; now?: number },
): ProtocolVerifyResult => {
    const key = options?.key ?? readSignKey();
    if (!key) return { ok: false, reason: 'no-key' };
    if (!signature) return { ok: false, reason: 'missing' };
    const $sig = parseSignature(signature);
    if (!$sig) return { ok: false, reason: 'format' };
    //* freshness: |now - ts| <= 300 s.
    const now = options?.now ?? nowSec();
    if (Math.abs(now - $sig.ts) > WEB_FRESHNESS_SEC) return { ok: false, reason: 'stale', ts: $sig.ts };
    const ok = sameSig($sig.sig, hmac(key, canonicalWeb($sig.ts, contextJson, body)));
    return ok ? { ok, ts: $sig.ts } : { ok, reason: 'mismatch', ts: $sig.ts };
};

/**
 * sign a SNS/SQS message (the exact string the receiver gets). returns `v1.<ts>.<sig>`, or '' if no key.
 */
export const signMessage = (message: string, options?: { key?: string; now?: number }) => {
    const key = options?.key ?? readSignKey();
    if (!key) return '';
    const ts = options?.now ?? nowSec();
    return `v1.${ts}.${hmac(key, canonicalMessage(ts, message))}`;
};

/**
 * verify a SNS/SQS message (no freshness window).
 */
export const verifyMessage = (signature: string, message: string, options?: { key?: string }): ProtocolVerifyResult => {
    const key = options?.key ?? readSignKey();
    if (!key) return { ok: false, reason: 'no-key' };
    if (!signature) return { ok: false, reason: 'missing' };
    const $sig = parseSignature(signature);
    if (!$sig) return { ok: false, reason: 'format' };
    const ok = sameSig($sig.sig, hmac(key, canonicalMessage($sig.ts, message)));
    return ok ? { ok, ts: $sig.ts } : { ok, reason: 'mismatch', ts: $sig.ts };
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
