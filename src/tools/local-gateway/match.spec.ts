/**
 * `tools/local-gateway/match.spec.ts`
 * - v5 B20: API Gateway route precedence (literal > `{param}` > `{proxy+}`, method exact > `ANY`).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import { matchRoute } from './match';
import { GatewayRoute, loadRouteTable } from './routes';

//* v5 B20: the fixture routes.
const routes = loadRouteTable({ serverlessFile: 'src/tools/local-gateway/fixtures/serverless.gateway.yml' }).routes;

//* v5 B20: a match as one line `status resource params`.
const line = (method: string, p: string, list: GatewayRoute[] = routes): string => {
    const m = matchRoute(list, method, p);
    return [m.status, m.resource ?? '-', m.pathParameters ? JSON.stringify(m.pathParameters) : 'null'].join(' ');
};

describe('local-gateway match (B20)', () => {
    //* v5 B20: the precedence table over the fixture.
    it('should pick the most specific resource, then the method (B20)', () => {
        const table: [string, string, string][] = [
            ['GET', '/', 'matched / null'],
            ['GET', '/hello', 'matched /hello null'],
            ['GET', '/hello/world', 'matched /hello/world null'], // literal > param
            ['GET', '/hello/world/', 'matched /hello/world null'], // trailing slash
            ['GET', '/hello/abc', 'matched /hello/{id} {"id":"abc"}'],
            ['GET', '/hello/a%20b', 'matched /hello/{id} {"id":"a%20b"}'], // raw (API Gateway does not decode)
            ['POST', '/hello/abc', 'method /hello/{id} {"id":"abc"}'], // resource first: no fallback to /{type}/{proxy+}
            ['DELETE', '/hello/a/b', 'matched /hello/{id}/{cmd} {"id":"a","cmd":"b"}'], // ANY
            ['GET', '/hello/a/b/c', 'matched /{type}/{proxy+} {"type":"hello","proxy":"a/b/c"}'],
            ['GET', '/assets/x/y.png', 'matched /assets/{proxy+} {"proxy":"x/y.png"}'], // literal 1st segment
            ['POST', '/assets/x', 'method /assets/{proxy+} {"proxy":"x"}'],
            ['PUT', '/mocks/a%2Fb/c', 'matched /{type}/{proxy+} {"type":"mocks","proxy":"a%2Fb/c"}'], // raw
            ['GET', '/assets', 'none - null'], // `{proxy+}` needs ≥ 1 segment
            ['GET', '/x', 'none - null'],
            ['PUT', '/files/1', 'method /files/{id} {"id":"1"}'],
            ['POST', '/files/1', 'matched /files/{id} {"id":"1"}'],
        ];
        expect(table.map(([m, p]) => [m, p, line(m, p)])).toEqual(table);
    });

    //* v5 B20: an exact method wins over `ANY` on the same resource.
    it('should prefer the exact method over ANY (B20)', () => {
        const list: GatewayRoute[] = [
            { fn: 'any', method: 'ANY', resource: '/a/{id}', cors: null },
            { fn: 'get', method: 'GET', resource: '/a/{id}', cors: null },
        ];
        expect(matchRoute(list, 'GET', '/a/1').route.fn).toBe('get');
        expect(matchRoute(list, 'patch', '/a/1').route.fn).toBe('any');
        expect(matchRoute(list, 'GET', '/a/1').routes.length).toBe(2);
    });

    //* v5 B20: `{proxy+}` only greedy as the last segment; `/{proxy+}` does not match `/`.
    it('should treat {proxy+} as greedy last segment only (B20)', () => {
        const list: GatewayRoute[] = [
            { fn: 'p', method: 'ANY', resource: '/{proxy+}', cors: null },
            { fn: 'bad', method: 'ANY', resource: '/{proxy+}/x', cors: null },
        ];
        expect(line('GET', '/', list)).toBe('none - null');
        expect(line('GET', '/a/b/x', list)).toBe('matched /{proxy+} {"proxy":"a/b/x"}');
    });

    //* v5 B20: raw values like API Gateway (measured 2026-11-04): no decode, inner empty segments kept,
    //* one trailing `/` dropped from the greedy value.
    it('should deliver raw path parameters like API Gateway (B20)', () => {
        const list: GatewayRoute[] = [
            { fn: 'id', method: 'ANY', resource: '/hello/{id}', cors: null },
            { fn: 'x', method: 'ANY', resource: '/x/{proxy+}', cors: null },
        ];
        const table: [string, string][] = [
            ['/hello/a%20b', 'matched /hello/{id} {"id":"a%20b"}'],
            ['/hello/%ED%95%9C%EA%B8%80', 'matched /hello/{id} {"id":"%ED%95%9C%EA%B8%80"}'],
            ['/hello/a+b', 'matched /hello/{id} {"id":"a+b"}'],
            ['/hello/%zz', 'matched /hello/{id} {"id":"%zz"}'],
            ['/x/a//b', 'matched /x/{proxy+} {"proxy":"a//b"}'], // empty segment kept
            ['/x/a/b/', 'matched /x/{proxy+} {"proxy":"a/b"}'], // trailing `/` not in the greedy value
            ['/x/a%2Fb/%2523', 'matched /x/{proxy+} {"proxy":"a%2Fb/%2523"}'],
            ['/x/', 'none - null'], // `{proxy+}` does not match an empty rest
            ['/hello//', 'none - null'], // `{id}` never takes an empty segment
            ['/h%65llo/a', 'none - null'], // literals are compared raw
        ];
        expect(table.map(([p]) => [p, line('GET', p, list)])).toEqual(table);
    });
});
