/**
 * `log-mask.ts`
 * - internal log helper, which hides secret header values (token, cookie, signature) before a log line.
 * - a masked value is `[masked:<length>]`. no character of the original value is kept (no prefix).
 * - log only: the request path still reads the original headers.
 * - used by `findService()` (`cores/lambda/lambda-handler.ts`), `packNotificationParamBody()` (`cores/lambda/lambda-notification-handler.ts`)
 *   and `parseIdentityHeader()`·`signToken()` (`cores/lambda/lambda-web-handler.ts`).
 * - the lemon protocol header names (`x-protocol-context`·`x-protocol-signature`·`x-lemon-identity`) come from the caller
 *   (`PROTOCOL_LOG_MASKED_HEADERS` in `cores/protocol/protocol-sign.ts`), so this module imports nothing but `safe-json`.
 * - key rotation: value-based screening — `registerSecret()` (config service, key readers) + `screenLogArgs()` (engine loggers).
 * - NOTE: internal only. do not export from `lib/index.ts` or any other barrel.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B10-3: secret header values in logs)
 * @date        2026-10-30 key rotation: value-based log screening.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { safeStringify } from './safe-json';

//* v5 B10-3: standard secret header names (lower case). the lemon protocol names are given by the caller.
export const SENSITIVE_HEADERS: readonly string[] = [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-amz-security-token',
];

//* v5 B10-3: mask one value as `[masked:<length>]` — the length of `String(v)`, no original character.
export const maskValue = (v: unknown): string => `[masked:${String(v).length}]`;

//* v5 B10-3: copy of `headers` with each secret value masked (key match is case-insensitive, input is not changed).
export const maskHeaders = <T extends Record<string, any>>(
    headers: T | null | undefined,
    extra: readonly string[] = [],
): Record<string, any> => {
    // null, undefined or a non-object → empty object.
    if (!headers || typeof headers !== 'object') return {};
    // lower-case set of the secret names (standard + caller names).
    const names = new Set([...SENSITIVE_HEADERS, ...extra].filter(s => !!s).map(s => `${s}`.toLowerCase()));
    const out: Record<string, any> = {};
    for (const key of Object.keys(headers)) {
        const val = headers[key];
        // keep a non-secret value as is.
        if (!names.has(key.toLowerCase())) out[key] = val;
        // `multiValueHeaders` form: mask each item.
        else if (Array.isArray(val)) out[key] = val.map(maskValue);
        // single value.
        else out[key] = maskValue(val);
    }
    return out;
};

//* key rotation: registry of installed secret values (decrypted config values, sign keys).
const $secrets = new Set<string>();

//* key rotation: shortest value to register — a shorter one collides with ordinary text.
export const SECRET_MIN_LENGTH = 8;

//* key rotation: register a secret value to screen in logs (non-string or shorter than 8 → ignored).
export const registerSecret = (v: unknown): void => {
    if (typeof v === 'string' && v.length >= SECRET_MIN_LENGTH) $secrets.add(v);
};

//* key rotation: clear the registry (for tests).
export const clearSecrets = (): void => $secrets.clear();

//* key rotation: replace every registered secret in `text` by `[masked:<len>]` (null if none found).
const maskSecrets = (text: string): string => {
    const hits = [...$secrets].filter(v => text.includes(v));
    if (!hits.length) return null;
    return hits.reduce((out, v) => out.split(v).join(maskValue(v)), text);
};

//* key rotation: text of a non-string arg to check — `stack || message` of an Error, else `safeStringify()`.
const textOf = (arg: unknown): string =>
    arg instanceof Error ? `${arg.stack || arg.message}` : safeStringify(arg) ?? '';

/**
 * key rotation: screen the args of one log line in place.
 * - a string arg keeps its text with each secret replaced by `[masked:<len>]`.
 * - an object or Error arg containing a secret is replaced by its masked text.
 * - empty registry → returns false at once (no cost).
 *
 * @returns true if any secret was found (the caller prints one error line).
 */
export const screenLogArgs = (args: any[]): boolean => {
    if (!$secrets.size || !args) return false;
    return args.reduce((hit: boolean, arg: unknown, i: number) => {
        // null, numbers, booleans: nothing to check.
        if (arg === null || (typeof arg !== 'string' && typeof arg !== 'object')) return hit;
        const masked = maskSecrets(typeof arg === 'string' ? arg : textOf(arg));
        if (masked === null) return hit;
        args[i] = masked;
        return true;
    }, false);
};
