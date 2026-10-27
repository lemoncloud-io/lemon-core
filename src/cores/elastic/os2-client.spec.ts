/**
 * `os2-client.spec.ts`
 * - v5 B2-b: the OpenSearch client paths against a local fake server (`http.createServer`, no external network).
 * - checks what reaches the wire: no doc `type`, `search_type` (not `searchType`), typeless mappings,
 *   `Authorization` only when the master uid/pwd are both in config, and the client built on first use.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version (v5 B2-b)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import $cores from '../';
import { OS2CoreService } from './elastic6-service';
import { GETERR } from '../../common/test-helper';
import { OS2Service, OS2FGACManager, _OS2 } from '../../extended/cores/abstract-services';

/** one request seen by the fake server */
interface Seen {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: any;
}

/** an OpenSearch-shaped error body */
const osError = (status: number, type: string, reason: string) => ({
    error: { root_cause: [{ type, reason }], type, reason },
    status,
});

/** canned OpenSearch replies by method + path (records nothing; see `seen`) */
const reply = (method: string, path: string): { status: number; body: any } => {
    const [, index, op, id] = path.split('/');
    if (method === 'GET' && path === '/') return { status: 200, body: { version: { number: '3.9.0' } } };
    if (path.startsWith('/_cat/indices')) return { status: 200, body: [] };
    if (op === '_doc' && method === 'GET') {
        if (id === 'NONE') return { status: 404, body: { _index: index, _id: id, found: false } };
        return { status: 200, body: { _index: index, _id: id, _version: 1, found: true, _source: { name: 'a' } } };
    }
    if (op === '_create') {
        if (id === 'DUP')
            return {
                status: 409,
                body: osError(409, 'version_conflict_engine_exception', `[${id}]: version conflict`),
            };
        return { status: 201, body: { _index: index, _id: id, _version: 1, result: 'created' } };
    }
    if (op === '_doc' && method === 'DELETE') return { status: 200, body: { _id: id, _version: 3, result: 'deleted' } };
    if (op === '_doc')
        return { status: 201, body: { _index: index, _id: id || 'auto-1', _version: 2, result: 'created' } };
    if (op === '_update') {
        if (id === 'BAD')
            return { status: 400, body: osError(400, 'illegal_argument_exception', 'Cannot apply [+] operation') };
        return { status: 200, body: { _id: id, _version: 4, result: 'updated' } };
    }
    if (op === '_settings')
        return { status: 200, body: { [index]: { settings: { index: { number_of_shards: '4' } } } } };
    if (op === '_mapping') return { status: 200, body: { [index]: { mappings: { properties: {} } } } };
    if (op === '_search') return { status: 200, body: { hits: { total: { value: 0, relation: 'eq' }, hits: [] } } };
    if (op === '_mget')
        return { status: 200, body: { docs: [{ _id: 'A0', found: true, _source: { $id: 'A0', name: 'a' } }] } };
    if (method === 'PUT' && index && !op)
        return { status: 200, body: { acknowledged: true, shards_acknowledged: true, index } };
    return { status: 400, body: osError(400, 'unknown_exception', `no route ${method} ${path}`) };
};

describe('OS2 client (local fake server)', () => {
    let server: http.Server;
    let endpoint = '';
    const seen: Seen[] = [];

    // start the fake server on a random local port.
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                // the bulk/ndjson body is not used here; parse json bodies only.
                const body = text ? JSON.parse(text) : undefined;
                seen.push({ method: req.method, url: req.url, headers: req.headers, body });
                const path = (req.url ?? '').split('?')[0];
                const { status, body: out } = reply(req.method, path);
                res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify(out));
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    // stop the server.
    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    // each test reads only its own requests.
    beforeEach(() => {
        seen.length = 0;
    });

    // the data calls send no doc `type`, and search sends `search_type`.
    it('should send no type/searchType on get/index/delete/mget/search', async () => {
        const svc = new OS2CoreService({ endpoint, indexName: 'test-os2' });
        expect(await svc.readItem('A0')).toEqual({ name: 'a', _id: 'A0', _version: 1 });
        expect(await svc.saveItem('A1', { name: 'b' } as any)).toEqual({
            name: 'b',
            $id: 'A1',
            _id: 'A1',
            _version: 1,
        });
        expect(await svc.pushItem({ name: 'c' } as any)).toEqual({ name: 'c', _id: 'auto-1', _version: 2 });
        expect(await svc.deleteItem('A1')).toEqual({ _id: 'A1', _version: 3 });
        expect(await svc.updateItem('A0', { name: 'd' } as any)).toEqual({ name: 'd', _id: 'A0', _version: 4 });
        expect(await svc.searchRaw({ size: 1 }, 'dfs_query_then_fetch')).toEqual({
            hits: { total: { value: 0, relation: 'eq' }, hits: [] },
        });
        const $os2 = _OS2({ endpoint, indexName: 'test-os2' });
        expect(await $os2.mget(['A0'])).toEqual([{ _id: 'A0', name: 'a' }]);

        const urls = seen.map(s => `${s.method} ${s.url}`);
        expect(urls).toEqual([
            'GET /test-os2/_doc/A0',
            'POST /test-os2/_create/A1',
            'POST /test-os2/_doc',
            'DELETE /test-os2/_doc/A1',
            'POST /test-os2/_update/A0',
            'POST /test-os2/_search?search_type=dfs_query_then_fetch',
            'POST /test-os2/_mget',
        ]);
        urls.forEach(u => expect(u).not.toMatch(/[?&]type=|searchType/));
        expect(seen[6].body).toEqual({ docs: [{ _id: 'A0' }] });
    });

    // `createIndex()` sends the typeless mapping (no doc-type key) via the instance and the service.
    it('should send typeless mappings on createIndex', async () => {
        const $os2 = _OS2({ endpoint, indexName: 'test-os2' });
        expect(await $os2.createIndex()).toEqual({ status: 200, index: 'test-os2', acknowledged: true });
        const svc = new OS2CoreService({ endpoint, indexName: 'test-ts', timeSeries: true });
        expect(await svc.createIndex()).toEqual({ status: 200, index: 'test-ts', acknowledged: true });

        expect(seen.map(s => `${s.method} ${s.url}`)).toEqual(['PUT /test-os2', 'PUT /test-ts']);
        const [m1, m2] = seen.map(s => s.body.mappings);
        expect(Object.keys(m1).sort()).toEqual(['dynamic_templates', 'properties']);
        expect(Object.keys(m1.properties).sort()).toEqual(['@version', 'created_at', 'deleted_at', 'updated_at']);
        expect(m1._doc).toBeUndefined();
        expect(seen[0].body.settings.analysis.analyzer.autocomplete_case_sensitive.filter).toEqual([]);
        expect(Object.keys(m2.properties).sort()).toEqual(['@timestamp', 'ip']);
    });

    // no `Authorization` without master uid/pwd; Basic auth when both are in config (read at first client use).
    it('should send Authorization only with both OS2_MASTER_UID and OS2_MASTER_PWD', async () => {
        const options = { endpoint, indexName: 'test-os2' };
        const fgac = new OS2FGACManager(options);

        // (a) plain service: never any auth.
        await new OS2CoreService(options).describe();
        // (b) master service, no config values.
        await new OS2Service(options, fgac).describe();
        // (c) master service, only the uid: still no auth.
        const config = $cores.config.config;
        const only = vi
            .spyOn(config, 'get')
            .mockImplementation((k: string) => (k === 'OS2_MASTER_UID' ? 'u1' : undefined));
        const svc3 = new OS2Service(options, fgac);
        await svc3.describe();
        only.mockRestore();

        // (d) both values: config is read when the client is first built, not at construction.
        const svc4 = new OS2Service(options, fgac);
        const both = vi
            .spyOn(config, 'get')
            .mockImplementation((k: string) =>
                k === 'OS2_MASTER_UID' ? 'u1' : k === 'OS2_MASTER_PWD' ? 'p1' : undefined,
            );
        await svc4.describe();
        both.mockRestore();

        // describe() = getSettings + getMapping = 2 requests each.
        const auth = seen.map(s => s.headers.authorization);
        expect(auth.length).toBe(8);
        expect(auth.slice(0, 6)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
        const basic = `Basic ${Buffer.from('u1:p1').toString('base64')}`;
        expect(auth.slice(6)).toEqual([basic, basic]);
    });

    // the client is built on the first call, once per service.
    it('should create the client on first use only', async () => {
        const created = vi.spyOn(OS2CoreService.prototype as any, 'createClient');
        const svc = new OS2CoreService({ endpoint, indexName: 'test-os2' });
        expect((svc as any)._client).toBeUndefined();
        expect(created).toHaveBeenCalledTimes(0);
        await svc.readItem('A0');
        expect(created).toHaveBeenCalledTimes(1);
        await svc.readItem('A0');
        expect(svc.client).toBe((svc as any)._client);
        expect(created).toHaveBeenCalledTimes(1);
        created.mockRestore();
    });

    // `$ERROR` keeps its message form with the OpenSearch error shape.
    it('should map OpenSearch errors in the v4 message form', async () => {
        const svc = new OS2CoreService({ endpoint, indexName: 'test-os2' });
        // 404 doc → `404 NOT FOUND - id:`
        expect(await svc.readItem('NONE').catch(GETERR)).toEqual('404 NOT FOUND - id:NONE');
        // 409 on create → overwrite with index
        expect(await svc.saveItem('DUP', { name: 'x' } as any)).toEqual({
            name: 'x',
            $id: 'DUP',
            _id: 'DUP',
            _version: 2,
        });
        // 400 illegal argument (Cannot apply) → the type-mismatch message
        expect(await svc.updateItem('BAD', null, { count: 1 }).catch(GETERR)).toEqual(
            `400 ILLEGAL ARGUMENT - failed to update due to type mismatch in item's field`,
        );
        expect(seen.map(s => `${s.method} ${s.url}`)).toEqual([
            'GET /test-os2/_doc/NONE',
            'POST /test-os2/_create/DUP',
            'PUT /test-os2/_doc/DUP',
            'POST /test-os2/_update/BAD',
        ]);
    });
});
