/**
 * `os2-service.b18.spec.ts`
 * - v5 B18: offline unit test of `OS2CoreService` over a fake client (no OpenSearch, no network).
 * - checks the request params each method sends, the response mapping, and the error branches
 *   (`$ERROR.handler` messages like `404 INDEX NOT FOUND`, `409 VERSION CONFLICT ENGINE`).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { OS2CoreService, $ERROR } from './os2-service';
import $hangul from './hangul-service';
import { GETERR } from '../../common/test-helper';

const INDEX = 'test-index';

//* v5 B18: an OpenSearch client response error (the shape `$ERROR.asError()` reads: `meta.statusCode`, `meta.body.error`).
const osErr = (status: number, type: string, reason = 'test reason') =>
    Object.assign(new Error(type), { meta: { statusCode: status, body: { error: { type, reason } } } });

// a fake client: every API is a `vi.fn()`.
const fakeClient = () => ({
    cat: { indices: vi.fn() },
    indices: {
        getMapping: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        refresh: vi.fn(),
        flush: vi.fn(),
        getSettings: vi.fn(),
    },
    create: vi.fn(),
    index: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    search: vi.fn(),
});

// a service with the fake client in place (the client is otherwise built on first access).
const serviceOf = (options: any = {}) => {
    const svc = new OS2CoreService({ endpoint: 'http://localhost:9200', indexName: INDEX, ...options });
    const client = fakeClient();
    //* v5 B18: inject the fake client (the `client` getter returns `_client` once set).
    (svc as any)._client = client;
    return { svc, client };
};

describe('OS2CoreService (B18 offline)', () => {
    it('B18 constructor validates options', () => {
        expect(() => new OS2CoreService({ endpoint: '', indexName: INDEX })).toThrow('.endpoint (URL) is required');
        expect(() => new OS2CoreService({ endpoint: 'http://localhost:9200', indexName: '' })).toThrow(
            '.indexName (string) is required',
        );
        const { svc } = serviceOf();
        expect(svc.options.idName).toBe('$id');
        expect(svc.hello()).toBe(`os2-core-service:${INDEX}`);
    });

    it('B18 listIndices() and findIndex() map the cat result', async () => {
        const { svc, client } = serviceOf();
        const row = {
            'docs.count': '84',
            'docs.deleted': '7',
            health: 'green',
            index: INDEX,
            pri: '5',
            'pri.store.size': '234.3kb',
            rep: '1',
            status: 'open',
            'store.size': '468.6kb',
            uuid: 'u-1',
        };
        //* body as an array (client response).
        client.cat.indices.mockResolvedValue({ body: [row, { index: 'other', health: null, uuid: { a: 1 } }] });
        const { list } = await svc.listIndices();
        expect(client.cat.indices).toHaveBeenCalledWith({ format: 'json' });
        expect(list[0]).toEqual({
            pri: 5,
            rep: 1,
            docsCount: 84,
            docsDeleted: 7,
            health: 'green',
            index: INDEX,
            status: 'open',
            uuid: 'u-1',
            priStoreSize: '234.3kb',
            storeSize: '468.6kb',
        });
        expect([list[1].health, list[1].uuid, list[1].status]).toEqual(['', '{"a":1}', '']);

        expect(await svc.findIndex()).toMatchObject({ index: INDEX });
        expect(await svc.findIndex('none')).toBeNull();

        //* a plain array is also accepted; an object is invalid.
        client.cat.indices.mockResolvedValueOnce([row]);
        expect((await svc.listIndices()).list.length).toBe(1);
        client.cat.indices.mockResolvedValueOnce({ body: { a: 1 } });
        expect(await svc.listIndices().catch(GETERR)).toMatch(/^@result<object> is invalid/);
    });

    it('B18 getIndexMapping() maps 404 INDEX NOT FOUND', async () => {
        const { svc, client } = serviceOf();
        client.indices.getMapping.mockResolvedValueOnce({ body: { [INDEX]: { mappings: { properties: {} } } } });
        expect(await svc.getIndexMapping()).toEqual({ properties: {} });
        expect(client.indices.getMapping).toHaveBeenCalledWith({ index: INDEX });

        client.indices.getMapping.mockRejectedValueOnce(osErr(404, 'index_not_found_exception'));
        expect(await svc.getIndexMapping().catch(GETERR)).toBe(`404 NOT FOUND - index:${INDEX}`);
        client.indices.getMapping.mockRejectedValueOnce(osErr(403, 'security_exception', 'no permission'));
        expect(await svc.getIndexMapping().catch(GETERR)).toBe('403 SECURITY - no permission');
        client.indices.getMapping.mockResolvedValueOnce({ body: {} });
        expect(await svc.getIndexMapping().catch(GETERR)).toMatch(new RegExp(`^@indexName\\[${INDEX}\\] is not found`));
    });

    it('B18 createIndex() sends the default typeless settings', async () => {
        const { svc, client } = serviceOf({ idName: 'id' });
        client.indices.create.mockResolvedValueOnce({ statusCode: 200, body: { shards_acknowledged: true } });
        expect(await svc.createIndex()).toEqual({ status: 200, index: INDEX, acknowledged: true });
        const { index, body } = client.indices.create.mock.calls[0][0];
        expect(index).toBe(INDEX);
        expect(body.settings.number_of_shards).toBe(4);
        expect(body.mappings.dynamic_templates[2].string_id.match).toBe('id');

        //* given settings are merged over the default shards.
        client.indices.create.mockResolvedValueOnce({ statusCode: 200, body: {} });
        await svc.createIndex({ mappings: { properties: {} } });
        expect(client.indices.create.mock.calls[1][0].body).toEqual({
            settings: { number_of_shards: 5, number_of_replicas: 1 },
            mappings: { properties: {} },
        });

        client.indices.create.mockRejectedValueOnce(osErr(400, 'resource_already_exists_exception'));
        expect(await svc.createIndex().catch(GETERR)).toBe(`400 IN USE - index:${INDEX}`);
        client.indices.create.mockRejectedValueOnce(osErr(400, 'mapper_parsing_exception', 'bad mapping'));
        expect(await svc.createIndex().catch(GETERR)).toBe('400 MAPPER PARSING - bad mapping');
    });

    it('B18 destroyIndex(), refreshIndex(), flushIndex() map the result and 404', async () => {
        const { svc, client } = serviceOf();
        client.indices.delete.mockResolvedValueOnce({ statusCode: 200, body: { acknowledged: true } });
        expect(await svc.destroyIndex()).toEqual({ status: 200, index: INDEX, acknowledged: true });
        client.indices.refresh.mockResolvedValueOnce({ body: { _shards: { total: 2 } } });
        expect(await svc.refreshIndex()).toEqual({ _shards: { total: 2 } });
        client.indices.flush.mockResolvedValueOnce({ body: { _shards: { total: 3 } } });
        expect(await svc.flushIndex()).toEqual({ _shards: { total: 3 } });
        expect(client.indices.delete).toHaveBeenCalledWith({ index: INDEX });
        expect(client.indices.refresh).toHaveBeenCalledWith({ index: INDEX });
        expect(client.indices.flush).toHaveBeenCalledWith({ index: INDEX });

        //* refresh/flush check `indexName` at call time.
        const { svc: svc0 } = serviceOf();
        (svc0 as any)._options.indexName = '';
        expect(await svc0.refreshIndex().catch(GETERR)).toBe('.indexName is required!');
        expect(await svc0.flushIndex().catch(GETERR)).toBe('.indexName is required!');

        //* each one: 404 index → `404 NOT FOUND`, other errors as `<status> <TYPE> - <reason>`.
        const api = [
            [client.indices.delete, () => svc.destroyIndex()],
            [client.indices.refresh, () => svc.refreshIndex()],
            [client.indices.flush, () => svc.flushIndex()],
        ] as const;
        for (const [fn, call] of api) {
            fn.mockRejectedValueOnce(osErr(404, 'index_not_found_exception'));
            expect(await call().catch(GETERR)).toBe(`404 NOT FOUND - index:${INDEX}`);
            fn.mockRejectedValueOnce(osErr(500, 'cluster_block_exception', 'read-only'));
            expect(await call().catch(GETERR)).toBe('500 CLUSTER BLOCK - read-only');
        }
    });

    it('B18 describe() reads settings and mappings', async () => {
        const { svc, client } = serviceOf();
        client.indices.getSettings.mockResolvedValueOnce({
            body: { [INDEX]: { settings: { index: { number_of_shards: '4', number_of_replicas: '1' } } } },
        });
        client.indices.getMapping.mockResolvedValueOnce({ body: { [INDEX]: { mappings: { properties: { a: 1 } } } } });
        expect(await svc.describe()).toEqual({
            settings: { index: { number_of_shards: '4', number_of_replicas: '1' } },
            mappings: { properties: { a: 1 } },
        });

        //* empty bodies give `{}`.
        client.indices.getSettings.mockResolvedValueOnce({ body: {} });
        client.indices.getMapping.mockResolvedValueOnce({});
        expect(await svc.describe()).toEqual({ settings: {}, mappings: {} });

        client.indices.getSettings.mockRejectedValueOnce(osErr(404, 'index_not_found_exception'));
        expect(await svc.describe().catch(GETERR)).toBe(`404 NOT FOUND - index:${INDEX}`);
        client.indices.getSettings.mockRejectedValueOnce(osErr(401, 'security_exception', 'auth'));
        expect(await svc.describe().catch(GETERR)).toBe('401 SECURITY - auth');
    });

    it('B18 saveItem() creates, and overwrites on 409 VERSION CONFLICT', async () => {
        const { svc, client } = serviceOf({ autocompleteFields: ['name'] });
        client.create.mockResolvedValueOnce({ body: { _id: 'A1', _version: 1 } });
        expect(await svc.saveItem('A1', { name: 'lemon' })).toEqual({
            name: 'lemon',
            $id: 'A1',
            _id: 'A1',
            _version: 1,
        });
        const params = client.create.mock.calls[0][0];
        expect(params.index).toBe(INDEX);
        expect(params.id).toBe('A1');
        expect(params.body).toMatchObject({ name: 'lemon', $id: 'A1', _decomposed: { name: ['lemon', 'lemon'] } });

        //* conflict → `index()` with the same body.
        client.create.mockRejectedValueOnce(osErr(409, 'version_conflict_engine_exception'));
        client.index.mockResolvedValueOnce({ body: { _id: 'A1', _version: 2 } });
        expect((await svc.saveItem('A1', { name: 'b' }))._version).toBe(2);
        expect(client.index.mock.calls[0][0]).toMatchObject({ index: INDEX, id: 'A1', body: { name: 'b' } });

        //* other errors; and no version in the body.
        client.create.mockRejectedValueOnce(osErr(400, 'mapper_parsing_exception', 'bad'));
        expect(await svc.saveItem('A1', {}).catch(GETERR)).toBe('400 MAPPER PARSING - bad');
        client.create.mockResolvedValueOnce({});
        expect(await svc.saveItem('A2', {})).toEqual({ $id: 'A2', _id: undefined, _version: 0 });

        //* idName `_id` is not sent in the body.
        const { svc: svc2, client: c2 } = serviceOf({ idName: '_id' });
        c2.create.mockResolvedValueOnce({ body: { _id: 'B1', _version: 1 } });
        await svc2.saveItem('B1', { a: 1 });
        expect(c2.create.mock.calls[0][0].body).toEqual({ a: 1 });
    });

    it('B18 pushItem() indexes without id', async () => {
        const { svc, client } = serviceOf({ timeSeries: true });
        client.index.mockResolvedValueOnce({ body: { _id: 'auto-1', _version: 1 } });
        expect(await svc.pushItem({ a: 1 })).toEqual({ a: 1, _id: 'auto-1', _version: 1 });
        expect(client.index).toHaveBeenCalledWith({ index: INDEX, body: { a: 1 } });

        client.index.mockRejectedValueOnce(osErr(400, 'illegal_argument_exception', 'bad'));
        expect(await svc.pushItem({ a: 1 }).catch(GETERR)).toBe('400 ILLEGAL ARGUMENT - bad');
    });

    it('B18 readItem() sends _source projections and maps 404', async () => {
        const { svc, client } = serviceOf();
        client.get.mockResolvedValue({
            body: { _id: 'A1', _version: 3, _source: { a: 1, _decomposed: {}, _qwerty: {} } },
        });
        expect(await svc.readItem('A1')).toEqual({ a: 1, _id: 'A1', _version: 3 });
        expect(client.get.mock.calls[0][0]).toEqual({ index: INDEX, id: 'A1' });
        await svc.readItem('A1', ['a', 'b']);
        expect(client.get.mock.calls[1][0]._source).toEqual(['a', 'b']);
        await svc.readItem('A1', { c: 1 });
        expect(client.get.mock.calls[2][0]._source).toEqual(['c']);

        //* no source.
        client.get.mockResolvedValueOnce({});
        expect(await svc.readItem('A2')).toEqual({ _id: undefined, _version: undefined });

        client.get.mockRejectedValueOnce(osErr(404, 'not_found_exception'));
        expect(await svc.readItem('NONE').catch(GETERR)).toBe('404 NOT FOUND - id:NONE');
        client.get.mockRejectedValueOnce(osErr(404, 'index_not_found_exception'));
        expect(await svc.readItem('NONE').catch(GETERR)).toBe(`404 NOT FOUND - index:${INDEX}`);
        client.get.mockRejectedValueOnce(osErr(403, 'security_exception', 'denied'));
        expect(await svc.readItem('A1').catch(GETERR)).toBe('403 SECURITY - denied');
    });

    it('B18 deleteItem() maps the result and 404', async () => {
        const { svc, client } = serviceOf();
        client.delete.mockResolvedValueOnce({ body: { _id: 'A1', _version: 4 } });
        expect(await svc.deleteItem('A1')).toEqual({ _id: 'A1', _version: 4 });
        expect(client.delete).toHaveBeenCalledWith({ index: INDEX, id: 'A1' });

        client.delete.mockRejectedValueOnce(osErr(404, 'not_found_exception'));
        expect(await svc.deleteItem('NONE').catch(GETERR)).toBe('404 NOT FOUND - id:NONE');
        client.delete.mockRejectedValueOnce(osErr(404, 'index_not_found_exception'));
        expect(await svc.deleteItem('NONE').catch(GETERR)).toBe(`404 NOT FOUND - index:${INDEX}`);
        client.delete.mockRejectedValueOnce(osErr(409, 'version_conflict_engine_exception', 'busy'));
        expect(await svc.deleteItem('A1').catch(GETERR)).toBe('409 VERSION CONFLICT ENGINE - busy');
    });

    it('B18 updateItem() builds the painless script and upsert', async () => {
        const { svc, client } = serviceOf();
        client.update.mockResolvedValue({ body: { _id: 'A1', _version: 5 } });
        expect(await svc.updateItem('A1', { name: 'x' }, { count: 2, tags: ['t'] } as any, { maxRetries: 1 })).toEqual({
            name: 'x',
            _id: 'A1',
            _version: 5,
        });
        const [params, options] = client.update.mock.calls[0];
        expect(options).toEqual({ maxRetries: 1 });
        expect(params.index).toBe(INDEX);
        expect(params.id).toBe('A1');
        expect(params.body.upsert).toEqual({ count: 2, tags: ['t'], $id: 'A1' });
        expect(params.body.script.lang).toBe('painless');
        expect(params.body.script.params).toEqual({ item: { name: 'x' }, increments: { count: 2, tags: ['t'] } });
        const src: string = params.body.script.source;
        expect(src).toContain(`ctx._source['count'] += params.increments['count'];`);
        expect(src).toContain(`ctx._source['tags'].addAll(params.increments['tags']);`);
        expect(src).toContain(`ctx._source['name'] = params.item['name'];`);

        //* increments only: item is dropped (undefined), no upsert without increments.
        await svc.updateItem('A1', null, { n: 1 } as any);
        expect(client.update.mock.calls[1][0].body.script.params.item).toBeUndefined();
        await svc.updateItem('A1', { a: 1 });
        expect(client.update.mock.calls[2][0].body.upsert).toBeUndefined();
    });

    //* table: update error → message.
    const updateErrors: Array<[any, string]> = [
        [osErr(404, 'document_missing_exception'), '404 NOT FOUND - id:A1'],
        [osErr(400, 'remote_transport_exception'), '400 INVALID FIELD - id:A1'],
        [osErr(404, 'not_found_exception'), '404 NOT FOUND - id:A1'],
        [osErr(400, 'action_request_validation_exception', 'v'), '400 ACTION REQUEST VALIDATION - v'],
        [osErr(400, 'invalid_field_exception', 'f'), '400 INVALID FIELD - f'],
        [osErr(400, 'mapper_parsing_exception', 'm'), '400 MAPPER PARSING - m'],
        [
            osErr(400, 'illegal_argument_exception', 'Cannot apply [+] operation'),
            "400 ILLEGAL ARGUMENT - failed to update due to type mismatch in item's field",
        ],
        [
            osErr(400, 'illegal_argument_exception', 'class_cast_exception: x'),
            "400 ILLEGAL ARGUMENT - failed to update due to type mismatch in item's field",
        ],
        [osErr(400, 'illegal_argument_exception', 'other'), '400 ILLEGAL ARGUMENT - other'],
    ];
    it.each(updateErrors)('B18 updateItem() error %#', async (err, expected) => {
        const { svc, client } = serviceOf();
        client.update.mockRejectedValueOnce(err);
        expect(await svc.updateItem('A1', { a: 1 }).catch(GETERR)).toBe(expected);
    });

    it('B18 updateItem() rethrows an unknown typed error as the parsed reason', async () => {
        const { svc, client } = serviceOf();
        client.update.mockRejectedValueOnce(osErr(500, 'engine_closed_exception', 'closed'));
        const E: any = await svc.updateItem('A1', { a: 1 }).catch(e => e);
        expect(E).toEqual({
            status: 500,
            message: 'engine_closed_exception',
            reason: { status: 500, type: 'ENGINE CLOSED', reason: 'closed' },
        });
        //* an error without `meta` (network) is rethrown as is.
        const net = new Error('ECONNREFUSED');
        client.update.mockRejectedValueOnce(net);
        expect(await svc.updateItem('A1', { a: 1 }).catch(e => e)).toBe(net);
    });

    it('B18 searchRaw() and search() map hits', async () => {
        const { svc, client } = serviceOf();
        expect(await svc.searchRaw(null).catch(GETERR)).toBe('@body (SearchBody) is required');

        const body = {
            hits: {
                total: { value: 2 },
                hits: [
                    { _id: 'a', _score: 1, _source: { n: 1 }, sort: [1] },
                    { _id: 'b', _score: 2, _source: { n: 2 }, sort: [2] },
                ],
            },
            aggregations: { x: 1 },
        };
        client.search.mockResolvedValue({ body });
        expect(await svc.searchRaw({ size: 1 })).toBe(body);
        expect(client.search.mock.calls[0][0]).toEqual({ index: INDEX, body: { size: 1 } });
        await svc.searchRaw({}, 'dfs_query_then_fetch');
        expect(client.search.mock.calls[1][0].search_type).toBe('dfs_query_then_fetch');

        expect(await svc.search({ size: 2 })).toEqual({
            total: 2,
            list: [
                { n: 1, _id: 'a', _score: 1 },
                { n: 2, _id: 'b', _score: 2 },
            ],
            last: [2],
            aggregations: { x: 1 },
        });
        //* no size: no `last`; total as number.
        client.search.mockResolvedValueOnce({ body: { hits: { total: 5, hits: [] } } });
        expect(await svc.search({})).toMatchObject({ total: 5, list: [], last: undefined });

        client.search.mockResolvedValueOnce({ body: {} });
        expect(await svc.search({}).catch(GETERR)).toMatch(/^\.hits \(object\) is required/);
        client.search.mockRejectedValueOnce(osErr(400, 'parsing_exception', 'bad query'));
        expect(await svc.search({}).catch(GETERR)).toBe('400 PARSING - bad query');
    });

    it('B18 searchAll() pages with search_after, until limit', async () => {
        const { svc, client } = serviceOf();
        const page = (ids: string[]) => ({
            body: {
                hits: {
                    total: 3,
                    hits: ids.map(id => ({ _id: id, _score: 1, _source: {}, sort: [id] })),
                },
            },
        });
        //* size 2: full page has `last`, the short page ends it.
        client.search
            .mockResolvedValueOnce(page(['a', 'b']))
            .mockResolvedValueOnce(page(['c']))
            .mockResolvedValueOnce(page([]));
        const body: any = { size: 2 };
        const list = await svc.searchAll<any>(body);
        expect(list.map(_ => _._id)).toEqual(['a', 'b', 'c']);
        expect(client.search.mock.calls[0][0].body.sort).toBe('_doc');
        expect(client.search).toHaveBeenCalledTimes(2);

        //* limit 1: one page only.
        client.search.mockReset();
        client.search.mockResolvedValue(page(['a', 'b']));
        const list2 = await svc.searchAll<any>({ size: 2, sort: [{ a: 'asc' }] }, { limit: 1 });
        expect(list2.length).toBe(2);
        expect(client.search).toHaveBeenCalledTimes(1);

        //* empty first page.
        client.search.mockReset();
        client.search.mockResolvedValueOnce(page([]));
        expect(await svc.searchAll({ size: 2 })).toEqual([]);
    });

    it('B18 generateSearchResult() retries 429, and throws other errors', async () => {
        const { svc, client } = serviceOf();
        const full = { body: { hits: { total: 2, hits: [{ _id: 'a', _source: {}, sort: ['a'] }] } } };
        const empty = { body: { hits: { total: 2, hits: [] as any[] } } };
        const e429 = Object.assign(new Error('Throttled'), { meta: { statusCode: 429, body: {} } });
        //* v5 B22: 429 on page 2 (page 1 is covered by the B22 case below).
        //* v5 B18: retry wait is 1 ms so the case stays fast and deterministic.
        client.search.mockResolvedValueOnce(full).mockRejectedValueOnce(e429).mockResolvedValueOnce(empty);
        const list = await svc.searchAll<any>(
            { size: 1 },
            { retryOptions: { do: true, t: 1, maxRetries: 1 }, searchType: 'query_then_fetch' },
        );
        expect(list.map(_ => _._id)).toEqual(['a']);
        expect(client.search).toHaveBeenCalledTimes(3);
        expect(client.search.mock.calls[0][0].search_type).toBe('query_then_fetch');

        //* no retry by default.
        client.search.mockReset();
        client.search.mockRejectedValueOnce(e429);
        expect(await svc.searchAll({ size: 1 }).catch(GETERR)).toBe('429 UNKNOWN - Throttled');
        //* retries exhausted.
        client.search.mockReset();
        client.search.mockResolvedValueOnce(full).mockRejectedValueOnce(e429).mockRejectedValueOnce(e429);
        expect(
            await svc.searchAll({ size: 1 }, { retryOptions: { do: true, t: 1, maxRetries: 1 } }).catch(GETERR),
        ).toBe('429 UNKNOWN - Throttled');
        //* other errors are not retried.
        client.search.mockReset();
        client.search.mockResolvedValueOnce(full).mockRejectedValueOnce(osErr(400, 'parsing_exception', 'q'));
        expect(await svc.searchAll({ size: 1 }, { retryOptions: { do: true, t: 1 } }).catch(GETERR)).toBe(
            '400 PARSING - q',
        );
    });

    //* v5 B22: a 429 on the first page (no `search_after` yet) retries that page instead of ending with `[]`.
    it('B22 generateSearchResult() retries a 429 on page 1', async () => {
        const { svc, client } = serviceOf();
        const page = (ids: string[]) => ({
            body: { hits: { total: 3, hits: ids.map(id => ({ _id: id, _score: 1, _source: {}, sort: [id] })) } },
        });
        const e429 = Object.assign(new Error('Throttled'), { meta: { statusCode: 429, body: {} } });
        client.search
            .mockRejectedValueOnce(e429)
            .mockResolvedValueOnce(page(['a', 'b']))
            .mockResolvedValueOnce(page(['c']));
        const list = await svc.searchAll<any>({ size: 2 }, { retryOptions: { do: true, t: 1, maxRetries: 1 } });
        expect(list.map(_ => _._id)).toEqual(['a', 'b', 'c']);
        expect(client.search).toHaveBeenCalledTimes(3);

        //* a retry does not count against `limit`: limit 1 still returns the first page.
        client.search.mockReset();
        client.search.mockRejectedValueOnce(e429).mockResolvedValueOnce(page(['a', 'b']));
        const list2 = await svc.searchAll<any>(
            { size: 2 },
            { limit: 1, retryOptions: { do: true, t: 1, maxRetries: 1 } },
        );
        expect(list2.map(_ => _._id)).toEqual(['a', 'b']);
        expect(client.search).toHaveBeenCalledTimes(2);

        //* retries exhausted on page 1.
        client.search.mockReset();
        client.search.mockRejectedValueOnce(e429).mockRejectedValueOnce(e429);
        expect(
            await svc.searchAll({ size: 2 }, { retryOptions: { do: true, t: 1, maxRetries: 1 } }).catch(GETERR),
        ).toBe('429 UNKNOWN - Throttled');
    });

    it('B18 popullateAutocompleteFields() adds jamo and qwerty forms', async () => {
        const { svc, client } = serviceOf({ autocompleteFields: ['name', 'title', 'none'] });
        client.create.mockResolvedValue({ body: { _id: 'A1', _version: 1 } });
        await svc.saveItem('A1', { name: '레몬 클라우드', title: 'Hello-World' });
        const body = client.create.mock.calls[0][0].body;
        const jamo = $hangul.asJamoSequence('레몬 클라우드');
        expect(body._decomposed).toEqual({
            name: [jamo, jamo.replace(/[ -]/g, '')],
            title: ['Hello-World', 'HelloWorld'],
        });
        expect(body._qwerty).toEqual({ name: $hangul.asAlphabetKeyStokes('레몬 클라우드') });
    });

    it('B18 prepareSettings() timeSeries mapping', () => {
        const S = OS2CoreService.prepareSettings({ idName: undefined, timeSeries: true, shards: 2, replicas: 0 });
        expect(S.settings).toMatchObject({ number_of_shards: 2, number_of_replicas: 0, refresh_interval: '5s' });
        expect(S.mappings.properties).toEqual({ '@timestamp': { type: 'date', doc_values: true }, ip: { type: 'ip' } });
        expect(S.mappings.dynamic_templates[2].string_id.match).toBe('$id');
    });
});

describe('$ERROR (B18)', () => {
    it('B18 parseMeta() handles string/object/other', () => {
        expect($ERROR.parseMeta('[1,2]')).toEqual({ list: [1, 2] });
        expect($ERROR.parseMeta('{"a":1}')).toEqual({ a: 1 });
        expect($ERROR.parseMeta('text')).toEqual({ type: 'string', value: 'text' });
        const bad: any = $ERROR.parseMeta('{bad}');
        expect([bad.type, bad.value, typeof bad.error]).toEqual(['string', '{bad}', 'string']);
        expect($ERROR.parseMeta(null)).toBeNull();
        expect($ERROR.parseMeta(undefined)).toBeNull();
        const obj = { b: 2 };
        expect($ERROR.parseMeta(obj)).toBe(obj);
        expect($ERROR.parseMeta(3)).toEqual({ type: 'number', value: 3 });
    });

    it('B18 throwAsJson() and handler() without callback', () => {
        // the value thrown by `fn`.
        const caught = (fn: () => any) => {
            try {
                fn();
            } catch (e) {
                return e;
            }
            return undefined;
        };
        expect(caught(() => $ERROR.throwAsJson('plain'))).toBe('plain');
        const json: any = caught(() => $ERROR.throwAsJson(new Error('boom')));
        expect(json.message).toBe('boom');
        expect(json instanceof Error).toBe(false);
        //* no callback: the built error is thrown.
        expect(GETERR(caught(() => $ERROR.handler('x')(osErr(404, 'index_not_found_exception', 'r'))))).toBe(
            '404 INDEX NOT FOUND - r',
        );
        //* a value without status is rethrown as is.
        expect(caught(() => $ERROR.handler('x')('weird'))).toBe('weird');
    });
});
