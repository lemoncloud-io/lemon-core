/**
 * `browser-cache.spec.ts`
 * - 브라우저 HTTP 캐시 응답 헤더와 조건부 GET 테스트
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect2, it } from './commons.spec';
import type { WEBEvent, WEBResult } from 'lemon-core/dist/cores/lambda/lambda-handler';
import { withBrowserCache } from './browser-cache';

const event = (headers: WEBEvent['headers'] = { 'x-api-key': 'test-key' }, httpMethod = 'GET'): WEBEvent =>
    ({ httpMethod, headers, requestContext: { identity: {} } } as WEBEvent);

describe('browser-cache', () => {
    it('should pass browser cache response test', () => {
        const $result: WEBResult = {
            statusCode: 200,
            headers: { Vary: 'Origin' },
            body: '{"ok":true}',
        };

        //* success cases
        const $cached = withBrowserCache(event(), $result);
        expect2($cached, 'statusCode,body,headers').toEqual({
            statusCode: 200,
            body: '{"ok":true}',
            headers: {
                Vary: 'Origin, X-Api-Key',
                'Cache-Control': 'private, no-cache',
                ETag: '"QGLtr3UPuAdOfoPgyQKMlOMkaKi28WFHdDKO8EUVD5M"',
            },
        });

        //* conditional GET
        const $notModified = withBrowserCache(
            event({
                'x-api-key': 'test-key',
                'If-None-Match': $cached.headers?.ETag as string,
            }),
            $result,
        );
        expect2($notModified, 'statusCode,body,isBase64Encoded').toEqual({
            statusCode: 304,
            body: '',
            isBase64Encoded: false,
        });

        //* edge cases
        const $errorResult = { ...$result, statusCode: 500 };
        expect2(() => withBrowserCache(event({}, 'GET'), $result) === $result).toEqual(true);
        expect2(() => withBrowserCache(event({ 'x-api-key': 'test-key' }, 'POST'), $result) === $result).toEqual(true);
        expect2(() => withBrowserCache(event(), $errorResult) === $errorResult).toEqual(true);
        expect2(withBrowserCache(event(), $errorResult), 'statusCode,headers').toEqual({
            statusCode: 500,
            headers: { Vary: 'Origin' },
        });
    });
});
