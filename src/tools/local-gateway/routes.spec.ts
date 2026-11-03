/**
 * `tools/local-gateway/routes.spec.ts`
 * - v5 B20: route table from `serverless.yml` (string/object events, tags, `${…}`, binary types, fallback).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CORS_HEADERS,
    loadRouteTable,
    normalizeCors,
    normalizePath,
    parseServerlessYaml,
    resolveSelf,
    routeOfHttpEvent,
} from './routes';

//* v5 B20: the fixture file (relative to the package root = `process.cwd()` of vitest).
const FIXTURE = 'src/tools/local-gateway/fixtures/serverless.gateway.yml';

//* v5 B20: write a temp `serverless.yml` and return its absolute path.
const tempYml = (text: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgw-b20-'));
    const file = path.join(dir, 'serverless.yml');
    fs.writeFileSync(file, text);
    return file;
};

describe('local-gateway routes (B20)', () => {
    //* v5 B20: every http event of the fixture, in file order, as `METHOD resource`.
    it('should read string and object http events of every function (B20)', () => {
        const t = loadRouteTable({ serverlessFile: FIXTURE });
        expect(t.source).toBe('serverless');
        expect(t.warning).toBeUndefined();
        expect(t.routes.map(r => `${r.fn} ${r.method} ${r.resource}`)).toEqual([
            'lambda GET /',
            'lambda GET /hello/{id}',
            'lambda GET /hello',
            'lambda GET /hello/world',
            'lambda ANY /hello/{id}/{cmd}',
            'lambda POST /files/{id}',
            'lambda GET /files/{id}',
            'lambda GET /assets/{proxy+}',
            'lambda ANY /{type}/{proxy+}',
        ]);
        expect(t.binaryMediaTypes).toEqual(['application/octet-stream', 'image/*', 'multipart/form-data']);
    });

    //* v5 B20: `${self:custom.cors, true}` resolves to the object; a missing self ref uses the fallback.
    it('should resolve ${self:…} cors and keep other variables as strings (B20)', () => {
        const t = loadRouteTable({ serverlessFile: FIXTURE });
        const by = (m: string, r: string) => t.routes.find(x => x.method === m && x.resource === r);
        expect(by('GET', '/hello').cors).toEqual({
            origins: ['http://localhost:3000'],
            headers: ['Content-Type', 'X-Lemon-Identity'],
            allowCredentials: true,
            maxAge: 600,
        });
        expect(by('POST', '/files/{id}').cors).toEqual({
            origins: ['*'],
            headers: DEFAULT_CORS_HEADERS,
            allowCredentials: false,
        });
        expect(by('GET', '/files/{id}').cors).toBe(null);
        //* non-self variables stay as text.
        const doc = parseServerlessYaml(fs.readFileSync(FIXTURE, 'utf8'));
        expect(doc.provider.stage).toBe("${opt:stage, 'dev'}");
        expect(resolveSelf("${opt:stage, 'dev'}", doc)).toBe("${opt:stage, 'dev'}");
        expect(resolveSelf('${self:custom.none}', doc)).toBe('${self:custom.none}');
        expect(resolveSelf("${self:custom.none, 'x'}", doc)).toBe('x');
        expect(resolveSelf('${self:custom.cors.maxAge}', doc)).toBe(600);
    });

    //* v5 B20: CloudFormation short tags parse as plain data (scalar → string).
    it('should tolerate CloudFormation tags (B20)', () => {
        const doc = parseServerlessYaml(fs.readFileSync(FIXTURE, 'utf8'));
        expect(doc.provider.environment).toEqual({ TABLE: 'MyTable', REGION_NAME: '${AWS::Region}-fixture' });
        expect(doc.functions.worker.events[0].sqs.arn).toEqual(['MyQueue', 'Arn']);
        expect(doc.resources.Resources.MyTable.Properties.TableName).toEqual(['-', ['fixture', 'table']]);
        expect(parseServerlessYaml('a: !If [c, !Ref x, !Ref y]\nb: !GetAtt X.Arn\nc: !Base64 { k: v }')).toEqual({
            a: ['c', 'x', 'y'],
            b: 'X.Arn',
            c: { k: 'v' },
        });
    });

    //* v5 B20: small helpers.
    it('should normalize paths, cors and string events (B20)', () => {
        expect(normalizePath('')).toBe('/');
        expect(normalizePath('hello//{id}/')).toBe('/hello/{id}');
        expect(routeOfHttpEvent('f', 'post  a/{b}', {})).toEqual({
            fn: 'f',
            method: 'POST',
            resource: '/a/{b}',
            cors: null,
        });
        expect(routeOfHttpEvent('f', 'GET', {})).toBe(null);
        expect(routeOfHttpEvent('f', { path: '/x' }, {})).toBe(null);
        expect(normalizeCors(false)).toBe(null);
        expect(normalizeCors('false')).toBe(null);
        expect(normalizeCors({ origins: ['http://localhost:1', 'http://localhost:2'], headers: 'A,B' })).toEqual({
            origins: ['http://localhost:1', 'http://localhost:2'],
            headers: ['A', 'B'],
            allowCredentials: false,
        });
    });

    //* v5 B20: `*~1*` (API Gateway's escaped form) and the option list are merged.
    it('should merge binaryMediaTypes of yml and option (B20)', () => {
        const file = tempYml(
            "provider:\n  apiGateway:\n    binaryMediaTypes: ['*~1*']\nfunctions:\n  f:\n    events:\n      - http: GET /a\n",
        );
        expect(loadRouteTable({ serverlessFile: file, binaryMediaTypes: ['image/png'] }).binaryMediaTypes).toEqual([
            '*/*',
            'image/png',
        ]);
    });

    //* v5 B20: missing file, bad yaml, or no http event → legacy routes + one warning line.
    it('should fall back to the legacy routes (B20)', () => {
        const legacy = ['ANY /{type}', 'ANY /{type}/{id}', 'ANY /{type}/{id}/{cmd}'];
        const list = (t: ReturnType<typeof loadRouteTable>) => t.routes.map(r => `${r.method} ${r.resource}`);
        const none = loadRouteTable({ serverlessFile: 'no-such-dir/serverless.yml', binaryMediaTypes: ['image/*'] });
        expect([none.source, list(none), none.binaryMediaTypes]).toEqual(['legacy', legacy, ['image/*']]);
        expect(none.warning).toBe('! local-gateway: no serverless.yml → legacy routes /{type}/{id}/{cmd}');
        const bad = loadRouteTable({ serverlessFile: tempYml('functions: [a\n  b: }') });
        expect([bad.source, list(bad)]).toEqual(['legacy', legacy]);
        expect(bad.warning.startsWith('! local-gateway: serverless.yml is not readable yaml (')).toBe(true);
        const noHttp = loadRouteTable({ serverlessFile: tempYml('functions:\n  f:\n    events:\n      - sqs: x\n') });
        expect([noHttp.source, noHttp.warning]).toEqual([
            'legacy',
            '! local-gateway: no http events in serverless.yml → legacy routes /{type}/{id}/{cmd}',
        ]);
    });
});
