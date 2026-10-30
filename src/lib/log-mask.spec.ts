/**
 * `log-mask.spec.ts`
 * - unit test of `log-mask.ts` (v5 B10-3).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B10-3: secret header values in logs)
 * @date        2026-10-30 key rotation: value-based screening (`registerSecret()`, `screenLogArgs()`).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { maskHeaders, maskValue, SENSITIVE_HEADERS, registerSecret, clearSecrets, screenLogArgs } from './log-mask';

//* sample secrets (fake values).
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.fakeSignatureValue';
const COOKIE = 'sid=fake-session-0123456789';
const CONTEXT = '{"accountId":"000000000000","requestId":"req-fake"}';
const SIGNATURE = 'v1.1700000000.fakeBase64UrlSig';
//* the lemon protocol names, as the caller passes them.
const EXTRA = ['x-protocol-context', 'x-protocol-signature', 'x-lemon-identity'];

describe('log-mask', () => {
    //* `maskValue()`: length only, any type.
    it('should mask a value as [masked:<length>]', () => {
        expect(maskValue(TOKEN)).toEqual(`[masked:${TOKEN.length}]`);
        expect(maskValue('')).toEqual('[masked:0]');
        expect(maskValue(12345)).toEqual('[masked:5]');
        expect(maskValue(null)).toEqual('[masked:4]');
        expect(maskValue(undefined)).toEqual('[masked:9]');
        expect(maskValue(TOKEN)).not.toContain('Bearer');
    });

    //* the standard list is lower case.
    it('should keep the standard names in lower case', () => {
        expect(SENSITIVE_HEADERS.every(s => s === s.toLowerCase())).toEqual(true);
        expect([...SENSITIVE_HEADERS].sort()).toEqual(
            [
                'authorization',
                'cookie',
                'proxy-authorization',
                'set-cookie',
                'x-amz-security-token',
                'x-api-key',
            ].sort(),
        );
    });

    //* secret keys in any case are masked; other keys are kept.
    it('should mask secret keys case-insensitively and keep the others', () => {
        const headers = {
            Authorization: TOKEN,
            COOKIE: COOKIE,
            'X-Protocol-Context': CONTEXT,
            'x-protocol-signature': SIGNATURE,
            'X-Lemon-Identity': TOKEN,
            'X-Api-Key': 'fake-api-key',
            host: 'api.example.com',
            'content-type': 'application/json',
            'x-amz-sns-message-type': 'Notification',
        };
        const out = maskHeaders(headers, EXTRA);
        expect(out).toEqual({
            Authorization: `[masked:${TOKEN.length}]`,
            COOKIE: `[masked:${COOKIE.length}]`,
            'X-Protocol-Context': `[masked:${CONTEXT.length}]`,
            'x-protocol-signature': `[masked:${SIGNATURE.length}]`,
            'X-Lemon-Identity': `[masked:${TOKEN.length}]`,
            'X-Api-Key': '[masked:12]',
            host: 'api.example.com',
            'content-type': 'application/json',
            'x-amz-sns-message-type': 'Notification',
        });
        //* no part of a secret is left.
        const text = JSON.stringify(out);
        for (const secret of [TOKEN, 'eyJhbGciOiJIUzI1NiJ9', COOKIE, 'fake-session', CONTEXT, 'req-fake', SIGNATURE])
            expect(text).not.toContain(secret);
    });

    //* without the caller names, the protocol headers are not masked (standard list only).
    it('should mask only the standard names without extra', () => {
        const out = maskHeaders({ authorization: TOKEN, 'x-protocol-context': CONTEXT });
        expect(out).toEqual({ authorization: `[masked:${TOKEN.length}]`, 'x-protocol-context': CONTEXT });
    });

    //* `multiValueHeaders` form, non-string values and empty strings.
    it('should mask arrays item by item, non-strings and empty strings', () => {
        const out = maskHeaders(
            { Cookie: [COOKIE, 'b=2'], 'set-cookie': ['x=1'], authorization: '', 'x-api-key': 42, Accept: ['*/*'] },
            EXTRA,
        );
        expect(out).toEqual({
            Cookie: [`[masked:${COOKIE.length}]`, '[masked:3]'],
            'set-cookie': ['[masked:3]'],
            authorization: '[masked:0]',
            'x-api-key': '[masked:2]',
            Accept: ['*/*'],
        });
    });

    //* `null` / `undefined` / non-object → `{}`.
    it('should return {} for null or undefined', () => {
        expect(maskHeaders(null)).toEqual({});
        expect(maskHeaders(undefined)).toEqual({});
        expect(maskHeaders('x' as any)).toEqual({});
    });

    //* the input is not changed, and the result is a new object.
    it('should not change the input', () => {
        const headers = { Authorization: TOKEN, Cookie: [COOKIE], host: 'h' };
        const before = JSON.parse(JSON.stringify(headers));
        const out = maskHeaders(headers, EXTRA);
        expect(headers).toEqual(before);
        expect(out).not.toBe(headers);
        expect(out.Cookie).not.toBe(headers.Cookie);
    });

    //* key rotation: value-based screening.
    describe('screenLogArgs()', () => {
        //* a fake installed secret.
        const SECRET = 'fake-installed-secret-0001';
        afterEach(() => clearSecrets());

        //* empty registry → false, args untouched.
        it('should not touch args with an empty registry', () => {
            const args: any[] = [`x ${SECRET}`, { k: SECRET }];
            expect(screenLogArgs(args)).toBe(false);
            expect(args).toEqual([`x ${SECRET}`, { k: SECRET }]);
        });

        //* string, object and Error args are masked.
        it('should mask a registered secret in string, object and Error args', () => {
            registerSecret(SECRET);
            const err = new Error(`bad ${SECRET}`);
            const obj = { a: 1, k: SECRET };
            const args: any[] = ['NS', `key=${SECRET}, again ${SECRET}`, obj, err, 42, null, undefined, { ok: 1 }];
            expect(screenLogArgs(args)).toBe(true);
            const mask = `[masked:${SECRET.length}]`;
            expect(args[0]).toEqual('NS');
            expect(args[1]).toEqual(`key=${mask}, again ${mask}`);
            expect(args[2]).toEqual(`{"a":1,"k":"${mask}"}`);
            expect(typeof args[3]).toEqual('string');
            expect(args[3]).toContain(`bad ${mask}`);
            expect(args.slice(4)).toEqual([42, null, undefined, { ok: 1 }]);
            expect(args.join(' ')).not.toContain(SECRET);
            //* the original object is not changed.
            expect(obj.k).toEqual(SECRET);
        });

        //* non-strings and values shorter than 8 are ignored.
        it('should ignore short and non-string secrets', () => {
            registerSecret('short12');
            registerSecret(12345678 as any);
            registerSecret(null);
            const args: any[] = ['short12 12345678'];
            expect(screenLogArgs(args)).toBe(false);
            expect(args).toEqual(['short12 12345678']);
        });
    });
});
