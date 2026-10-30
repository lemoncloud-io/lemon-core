/**
 * `abstract-services.b18.spec.ts`
 * - v5 B18-c: coverage of `abstract-services.ts` without infrastructure.
 * - FGAC/OS2 paths run against a fake `doProxy()`; dynamo scans against a stubbed `DynamoScanService.scan()`.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextContext, CoreModel } from 'lemon-model';
import { DynamoScanService } from '../../cores/';
import { AbstractOS2Instance } from '../abstract-service';
import { MyCoreManager, MyCoreService, MyCoreProxy, MyManagerProxy } from './abstract-services';
import { OS2FGACManager, OS2Instance, OS2Service, _OS2 } from './abstract-services';

type ModelType = 'test';
type Model = CoreModel<ModelType> & { name?: string; test?: number; hidden?: number; _id?: string };

//* plain field list (no decorators needed).
const FIELDS = ['id', 'name', 'test', 'hidden', 'ns', 'type', 'stereo', 'sid', 'uid', 'gid', 'lock', 'next'];
const FIELDS2 = [...FIELDS, 'meta', 'createdAt', 'updatedAt', 'deletedAt', 'error'];

//* manager under test.
class B18Manager extends MyCoreManager<Model, ModelType, B18Service> {
    public constructor(parent: B18Service, enableSync = false) {
        super('test', parent, FIELDS2, { enableSync });
    }
}

//* service with switchable search engine and dynamo table.
class B18Service extends MyCoreService<Model, ModelType, B18Proxy> {
    public readonly $test: B18Manager;
    public search = false;
    public table = 'dummy-data.yml';
    public lastBody: any = null;
    public constructor() {
        super('dummy-data.yml', 'TT');
        this.$test = new B18Manager(this);
    }
    public createProxy = (context: NextContext) => new B18Proxy(context, this);
    //* v5 B18: the scan paths read `dynamoOptions` only (storage stays on the dummy file).
    public get dynamoOptions() {
        return { tableName: this.table, idName: '_id' };
    }
    public hasSearchEngine() {
        return this.search;
    }
    public async doSearch<T>(body: any): Promise<any> {
        this.lastBody = body;
        return {
            total: 2,
            list: [{ id: 'a' }, { id: 'b' }] as unknown as T[],
            aggregations: { name: { buckets: [{ key: 'x', doc_count: 3 }, { key: 7 }] } },
        };
    }
}

//* proxy with one manager proxy.
class B18Proxy extends MyCoreProxy<ModelType, B18Service> {
    public readonly tests: MyManagerProxy<Model, B18Manager, B18Service, ModelType>;
    public constructor(context: NextContext, service: B18Service) {
        super(context, service);
        this.tests = new MyManagerProxy(this, service.$test);
    }
}

//* fake FGAC transport: records each call and answers from a handler.
const fakeProxy = (answer: (method: string, path1: string, path2: string, param: any, body: any) => any) => {
    const calls: any[] = [];
    const doProxy = vi.fn(async (method: string, path1?: string, path2?: string, param?: any, body?: any) => {
        calls.push({ method, path1, path2, param, body });
        return answer(method, path1, path2, param, body);
    });
    return { calls, proxy: { hello: () => 'fake', doProxy } };
};

//* client-like error object (with `meta`) as the OpenSearch client throws it.
const metaError = (statusCode: number, type: string, reason = 'b18') =>
    Object.assign(new Error(`${type}`), { statusCode, meta: { statusCode, body: { error: { type, reason } } } });

//* builds an OS2 instance whose FGAC transport is the fake.
const os2 = (answer: Parameters<typeof fakeProxy>[0], autocompleteFields?: string[]) => {
    const $os2 = new OS2Instance({
        endpoint: 'https://b18.invalid',
        indexName: 'b18-index',
        tableName: 'b18-table',
        autocompleteFields,
    });
    const fake = fakeProxy(answer);
    (($os2.fgac as any)._fgacProxy as any) = fake.proxy; //* v5 B18: skip the SigV4 proxy, no network.
    return { $os2, fake };
};

const ENV_KEYS = ['MY_DYNAMO_TABLE', 'OS2_JWT_TOKEN', 'OS2_MESSAGE'];
const $env: Record<string, string> = ENV_KEYS.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});

describe('abstract-services B18', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        ENV_KEYS.forEach(k => ($env[k] === undefined ? delete process.env[k] : (process.env[k] = $env[k])));
    });

    it('B18 OS2FGACManager proxy and FGAC calls', async () => {
        //* the real proxy is built once (no request is sent).
        process.env.OS2_JWT_TOKEN = 'b18-token';
        const fgac0 = new OS2FGACManager({ endpoint: 'https://b18.invalid', indexName: 'b18-index' });
        expect(fgac0.hello()).toEqual('FGACService');
        const p1 = fgac0.proxy;
        expect(p1.hello()).toEqual('http-web-proxy:fgac');
        expect(fgac0.proxy).toBe(p1);
        delete process.env.OS2_JWT_TOKEN;
        process.env.OS2_MESSAGE = 'b18-msg';
        expect(new OS2FGACManager({ endpoint: 'https://b18.invalid', indexName: 'x' }).proxy.hello()).toEqual(
            'http-web-proxy:fgac',
        );

        const { $os2, fake } = os2((method, path1, path2) => {
            if (path2 === '_settings') return { 'b18-index': { settings: { a: 1 } } };
            if (path2 === '_mapping') return { 'b18-index': { mappings: { b: 2 } } };
            return { method, path2 };
        });
        const fgac = $os2.fgac;
        expect(await fgac.doFgacSearch({ index: 'i', body: { size: 1 }, search_type: 'dfs_query_then_fetch' })).toEqual(
            { method: 'POST', path2: '_search' },
        );
        expect(fake.calls[0].param).toEqual({ search_type: 'dfs_query_then_fetch' });
        await fgac.doFgacSearch({} as any);
        expect(fake.calls[1]).toEqual({ method: 'POST', path1: '', path2: '_search', param: undefined, body: null });
        expect((await fgac.doFgacRead({ index: 'i', id: 'a/b' })).path2).toEqual('_doc/a%2Fb');
        expect((await fgac.doFgacRead({} as any)).path2).toEqual('_doc/');
        expect((await fgac.doFgacSave({ index: 'i', id: 'a', body: { x: 1, y: undefined } })).method).toEqual('PUT');
        expect((await fgac.doFgacSave({} as any)).path2).toEqual('_doc/');
        expect((await fgac.doFgacUpdate({ index: 'i', id: 'a', body: { x: 1 } })).path2).toEqual('_update/a');
        expect((await fgac.doFgacUpdate({} as any)).path2).toEqual('_update/');
        expect((await fgac.doFgacDelete({ index: 'i', id: 'a' })).method).toEqual('DELETE');
        expect((await fgac.doFgacDelete({} as any)).path2).toEqual('_doc/');
        expect((await fgac.doFgacCreate({ index: 'i', id: 'a', body: {} })).path2).toEqual('_doc/a');
        expect(fake.calls[fake.calls.length - 1].param).toEqual({ op_type: 'create' });
        expect((await fgac.doFgacCreate({} as any)).path2).toEqual('_doc/');
        expect((await fgac.doFgacDeleteIndex('i')).method).toEqual('DELETE');

        //* bulk: array body only; empty -> no call; JSONL content.
        expect(await fgac.doFgacBulk({ index: 'i', body: [] })).toEqual([]);
        expect(await fgac.doFgacBulk({} as any)).toEqual([]);
        await expect(fgac.doFgacBulk({ index: 'i', body: 'x' as any })).rejects.toThrow(
            '@body(array) is required - doFgacBulk(i)',
        );
        await fgac.doFgacBulk({ index: 'i', body: [{ index: { _id: 'a' } }, { a: 1 }] });
        expect(fake.calls[fake.calls.length - 1].body).toEqual('{"index":{"_id":"a"}}\n{"a":1}\n');

        //* index admin calls need the index name.
        const NAMES = [
            'doFgacDescribe',
            'doFgacGetSettings',
            'doFgacGetMapping',
            'doFgacCloseIndex',
            'doFgacOpenIndex',
        ];
        for (const name of NAMES) {
            await expect((fgac as any)[name]('')).rejects.toThrow(`.index(string) is required - ${name}()`);
        }
        await expect(fgac.doFgacPutSettings('', {})).rejects.toThrow('.index(string) is required');
        await expect(fgac.doFgacPutMapping('', {})).rejects.toThrow('.index(string) is required');
        expect(await fgac.doFgacDescribe('b18-index')).toEqual({ settings: { a: 1 }, mappings: { b: 2 } });
        expect(await fgac.doFgacDescribe('other')).toEqual({ settings: {}, mappings: {} });
        await fgac.doFgacPutSettings('i', { n: 1 });
        expect(fake.calls[fake.calls.length - 1].path2).toEqual('_settings');
        expect(fake.calls[fake.calls.length - 1].body).toEqual({ settings: { n: 1 } });
        await fgac.doFgacPutMapping('i', { p: 1 });
        expect(fake.calls[fake.calls.length - 1].body).toEqual({ p: 1 });
        expect((await fgac.doFgacCloseIndex('i')).path2).toEqual('_close');
        expect((await fgac.doFgacOpenIndex('i')).path2).toEqual('_open');
    });

    it('B18 OS2Service save/push/read/delete/update/search via FGAC', async () => {
        let mode = '';
        const { $os2, fake } = os2(
            (method, path1, path2, param) => {
                if (mode === 'conflict' && param?.op_type === 'create') throw new Error('409 Conflict - b18');
                if (mode === 'fail') throw new Error('500 FAIL - b18');
                if (mode === 'notfound') throw metaError(404, 'not_found_x');
                if (mode === 'noindex') throw metaError(404, 'index_not_found_exception');
                if (mode === 'other') throw metaError(400, 'bad_request_x');
                if (path2 === '_search')
                    return { hits: { total: { value: 1 }, hits: [{ _id: 'a', _score: 1, _source: { n: 1 } }] } };
                if (method === 'GET')
                    return { _id: 'a', _version: 3, _source: { n: 1, _decomposed: 'x', _qwerty: 'y' } };
                if (method === 'DELETE') return { _id: 'a', _version: 4 };
                return { _id: path2.split('/')[1], _version: 2 };
            },
            ['name'],
        );
        const elastic = $os2.elastic;
        expect($os2.hello()).toEqual('OS2Instance');
        expect($os2.options).toEqual({
            endpoint: 'https://b18.invalid',
            indexName: 'b18-index',
            autocompleteFields: ['name'],
            idName: '$id',
        });
        expect($os2.$X2).toBeDefined();

        //* saveItem: create, then overwrite on 409.
        const saved = await elastic.saveItem('a', { name: 'hi' } as any);
        expect(saved).toMatchObject({ $id: 'a', name: 'hi', _id: 'a', _version: 2 });
        mode = 'conflict';
        expect(await elastic.saveItem('b', { name: 'x' } as any)).toMatchObject({ _id: 'b', _version: 2 });
        expect(fake.calls[fake.calls.length - 1].param).toEqual(undefined);
        mode = 'fail';
        await expect(elastic.saveItem('c', {} as any)).rejects.toThrow('500 FAIL - b18');
        await expect(elastic.pushItem({ id: 'p' } as any)).rejects.toThrow('500 FAIL - b18');
        await expect(elastic.searchRaw({ size: 1 })).rejects.toThrow('500 FAIL - b18');

        //* pushItem: the FGAC result is the body itself.
        mode = '';
        expect(await elastic.pushItem({ id: 'p', name: 'n' } as any)).toMatchObject({ id: 'p', _id: 'p', _version: 2 });
        expect(await elastic.pushItem({ name: 'n' } as any)).toMatchObject({ _id: '', _version: 2 });

        //* readItem: views as list or object, internal fields dropped.
        expect(await elastic.readItem('a', ['n'])).toEqual({ n: 1, _id: 'a', _version: 3 });
        expect(fake.calls[fake.calls.length - 1].path2).toEqual('_doc/a');
        expect(await elastic.readItem('a', { n: 1 })).toEqual({ n: 1, _id: 'a', _version: 3 });
        expect(await elastic.readItem('a')).toEqual({ n: 1, _id: 'a', _version: 3 });
        expect(await elastic.deleteItem('a')).toEqual({ _id: 'a', _version: 4 });

        //* error mapping of read/delete.
        mode = 'notfound';
        await expect(elastic.readItem('z')).rejects.toThrow('404 NOT FOUND - id:z');
        await expect(elastic.deleteItem('z')).rejects.toThrow('404 NOT FOUND - id:z');
        mode = 'noindex';
        await expect(elastic.readItem('z')).rejects.toThrow('404 NOT FOUND - index:b18-index');
        await expect(elastic.deleteItem('z')).rejects.toThrow('404 NOT FOUND - index:b18-index');
        mode = 'other';
        await expect(elastic.readItem('z')).rejects.toThrow('400 BAD REQUEST - b18');
        await expect(elastic.deleteItem('z')).rejects.toThrow('400 BAD REQUEST - b18');

        //* updateItem never updates (tricky 404 for saveItem()).
        await expect(elastic.updateItem('a', {} as any, { n: 1 } as any)).rejects.toThrow(
            '400 NOT SUPPORTED - invalid increments[{"n":1}] @updateItem(a)',
        );
        await expect(elastic.updateItem('a', null)).rejects.toThrow('404 NOT FOUND - updateItem(a)');
        await expect(elastic.updateItem(undefined, null)).rejects.toThrow('404 NOT FOUND - updateItem()');

        //* search through the instance.
        mode = '';
        await expect(elastic.searchRaw(null)).rejects.toThrow('@body (SearchBody) is required');
        expect(await $os2.search({ size: 1 }, { searchType: 'query_then_fetch' })).toEqual({
            total: 1,
            list: [{ n: 1, _id: 'a', _score: 1 }],
            last: undefined,
            aggregations: undefined,
        });
        expect(fake.calls[fake.calls.length - 1].param).toEqual({ search_type: 'query_then_fetch' });
        await expect(new OS2Instance({} as any).search({})).rejects.toThrow('Could not read Elasticsearch endpoint');
        expect(new OS2Instance({} as any).options).toEqual(null);
    });

    it('B18 OS2Service bulkItems and deleteIndex', async () => {
        let mode = '';
        const { $os2, fake } = os2(() => {
            if (mode === 'fail') throw new Error('500 BULK - b18');
            return {
                items: [{ index: { _id: 'a' } }, { index: { _id: 'b', error: { reason: 'bad' } } }, { index: {} }],
            };
        });
        const elastic = $os2.elastic;
        await expect(elastic.bulkItems([])).rejects.toThrow('@items (array) is required - length=0');
        await expect(elastic.bulkItems(null)).rejects.toThrow('@items (array) is required - length=null');
        //* only invalid items -> no call.
        expect(await elastic.bulkItems([{ x: 1 } as any])).toEqual({
            success: 0,
            failed: 1,
            failedItems: [{ reason: '@_id is invalid - bulkItems(b18-index)', item: { x: 1 } }],
        });
        const res = await $os2.bulkItems([{ _id: 'a', n: 1 }, { _id: 'b' }, { _id: 'c' }, { n: 2 }]);
        expect(res.success).toEqual(1);
        expect(res.failed).toEqual(2);
        expect(res.failedItems.map(f => f.reason)).toEqual(['@_id is invalid - bulkItems(b18-index)', 'bad']);
        expect(fake.calls[0].body.split('\n')[0]).toEqual('{"index":{"_index":"b18-index","_id":"a"}}');
        //* custom id-name keeps the field.
        await elastic.bulkItems([{ id: 'k', n: 1 } as any], { idName: 'id' });
        expect(fake.calls[1].body.split('\n')[1]).toEqual('{"id":"k","n":1}');
        mode = 'fail';
        await expect(elastic.bulkItems([{ _id: 'a' } as any])).rejects.toThrow('500 BULK - b18');

        //* deleteIndex uses the master client: a fake client is set.
        const indices = {
            delete: vi.fn(async ({ index }: any) => {
                if (index === 'gone') throw metaError(404, 'index_not_found_exception');
                if (index === 'bad') throw metaError(400, 'bad_request_x');
                return { acknowledged: true };
            }),
        };
        (elastic as any)._client = { indices }; //* v5 B18: no OpenSearch connection.
        expect(await elastic.deleteIndex('b18-index')).toEqual({ acknowledged: true });
        await expect(elastic.deleteIndex('gone')).rejects.toThrow('404 NOT FOUND - index:gone');
        await expect(elastic.deleteIndex('bad')).rejects.toThrow('400 BAD REQUEST - b18');
        expect(elastic).toBeInstanceOf(OS2Service);
    });

    it('B18 OS2Instance synchronizeContents with a stubbed scan', async () => {
        process.env.MY_DYNAMO_TABLE = 'b18-table';
        const { $os2 } = os2((method, path1, path2, param, body: string) => {
            //* every second line is a document; fail the one named `bad`.
            const docs = body
                .trim()
                .split('\n')
                .filter((_, i) => i % 2 === 0)
                .map(L => JSON.parse(L).index);
            return { items: docs.map(d => ({ index: d._id === 'bad' ? { ...d, error: { reason: 'x' } } : d })) };
        });
        const pages = [
            { list: [{ _id: 'a', id: 'a' }, { _id: '#k', stereo: '#' }, { _id: 'bad' }], last: { _id: 'bad' } },
            { list: [{ _id: 'c' }], last: {} },
        ];
        const scan = vi.spyOn(DynamoScanService.prototype, 'scan').mockImplementation(async () => pages.shift() as any);
        const res = await $os2.synchronizeContents({ limit: 3 });
        expect(scan).toHaveBeenCalledTimes(2);
        expect(res.index).toEqual('b18-index');
        expect(res.total).toEqual(3);
        expect(res.failed).toEqual([{ _id: 'bad', error: 'x' }]);
    });

    it('B18 $X2.describeEndpointUrl and _OS2 options', async () => {
        const $os2 = _OS2({ endpoint: 'https://b18.invalid', indexName: 'b18-x', autocompleteFields: ['a'] });
        const { describeEndpointUrl } = $os2.$X2;
        expect(describeEndpointUrl('https://b18.invalid:9200/x')).toEqual({
            protocol: 'https',
            host: 'b18.invalid',
            port: 9200,
            region: undefined,
            isTunnel: false,
            isProxy: false,
        });
        expect(describeEndpointUrl('//abc.invalid')).toMatchObject({ protocol: 'https', port: 443 });
        expect(describeEndpointUrl('http://localhost')).toMatchObject({ isTunnel: true, port: 80 });
        expect(describeEndpointUrl('https://a1.execute-api.ap-northeast-2.amazonaws.com')).toMatchObject({
            isProxy: true,
            region: 'ap-northeast-2',
        });
        expect(() => describeEndpointUrl('')).toThrow('@url(string) is required - describeEndpointUrl()');
        expect(() => describeEndpointUrl('ftp://x', { errScope: 'b18' })).toThrow(
            '@url[ftp://x] is invalid (no http) - b18',
        );
        expect(() => describeEndpointUrl('ftp://x', { throwable: false })).not.toThrow();
        expect($os2.options).toMatchObject({ indexName: 'b18-x', autocompleteFields: ['a'] });
        //* idName `null` = unset here; the service then applies its own default.
        expect(
            new OS2Instance({ endpoint: 'https://b18.invalid', indexName: 'i', tableName: '', idName: null }).options,
        ).toEqual({ endpoint: 'https://b18.invalid', indexName: 'i', idName: '$id' });
    });

    it('B18 manager list() through the search engine and query helpers', async () => {
        const service = new B18Service();
        const $mgr = service.$test;
        service.search = true;
        const res = await $mgr.list({ limit: 2, page: 1 }, { name: 'x' } as any, { aggregation: 'name' });
        expect(res).toEqual({
            total: 2,
            list: [{ id: 'a' }, { id: 'b' }],
            aggr: [
                { key: 'x', count: 3 },
                { key: '7', count: 0 },
            ],
            limit: 2,
            page: 1,
        });
        expect(service.lastBody.aggs.name.terms.field).toEqual('name.keyword');
        //* no aggregation -> empty aggr; no buckets -> empty aggr.
        expect((await $mgr.list({ limit: 1 })).aggr).toEqual([]);
        expect((await $mgr.list({ limit: 1 }, {}, { aggregation: 'none' })).aggr).toEqual([]);

        //* hidden flag in query.
        const q1 = $mgr.buildQuery({ limit: 1 }, undefined, { hidden: 1 });
        expect(q1.query.bool.must).toEqual([{ term: { hidden: 1 } }]);
        const q0 = $mgr.buildQuery({ limit: 1 }, undefined, { hidden: false });
        expect(q0.query.bool.must_not).toEqual([{ term: { hidden: 1 } }]);

        //* addQueryTerm errors and empty query.
        expect(() => $mgr.addQueryTerm(null, 'filter', {} as any)).toThrow('@body (SearchBody) is required!');
        expect(() => $mgr.addQueryTerm({}, 'x' as any, {} as any)).toThrow('@term(x) is not supported!');
        expect($mgr.addQueryTerm({}, 'must', [{ a: 1 }] as any).query.bool).toEqual({
            filter: [],
            must: [{ a: 1 }],
            must_not: [],
        });

        //* sort terms.
        expect($mgr.addSortTerm({}, { sort: ':desc' }).sort).toEqual(undefined);
        expect($mgr.addSortTerm({}, { sort: 'order:desc' }).sort).toEqual({
            order: { order: 'desc', missing: '_last' },
        });
        expect($mgr.addSortTerm({}, { sort: 'order' }).sort).toEqual({ order: { order: 'asc', missing: '_first' } });

        //* scan filter rejects non-string values; projections unsorted.
        expect(() => $mgr.buildScanFilter({ test: 1 } as any)).toThrow('400 NOT SUPPORTED - filter param[{"test":1}]');
        expect($mgr.listProjections({ includes: ['id'], excludes: [], sorted: false })).toEqual([
            'id',
            'name',
            'test',
            'hidden',
        ]);
        expect(await $mgr.validateModel({} as any)).toEqual({});

        //* enableSync with the default (endpoint-less) `$OS2`: nothing to enable.
        expect(new B18Manager(service, true).type).toEqual('test');
    });

    it('B18 manager doScan/doScanLast with a stubbed scan', async () => {
        const service = new B18Service();
        const $mgr = service.$test;
        await expect($mgr.doScanLast({ limit: 1 } as any)).rejects.toThrow('400 NO DYNAMO - table:dummy-data.yml!');
        service.table = '';
        await expect($mgr.doScanLast({} as any)).rejects.toThrow('400 NO DYNAMO - table:!');
        service.table = 'b18-table';

        //* two pages, then end.
        const mk = () => [
            {
                list: [
                    { _id: '1', id: '1' },
                    { _id: '2', id: '2' },
                ],
                last: { _id: '2' },
            },
            { list: [{ _id: '3', id: '3' }], last: {} },
        ];
        let pages = mk();
        vi.spyOn(DynamoScanService.prototype, 'scan').mockImplementation(async () => pages.shift() as any);
        const r1 = await $mgr.doScan({ limit: 2, page: 1 });
        expect(r1).toEqual({ list: [{ id: '3' }], total: 3, limit: 2, aggr: [{ key: '#scan', count: 3 }] });
        pages = mk();
        expect((await $mgr.doScan({ limit: -1 })).list.length).toEqual(3);
        pages = mk();
        expect((await $mgr.doScan({ limit: 0 })).list).toEqual([]);
        pages = mk();
        expect((await $mgr.doScan(undefined)).limit).toEqual(10);

        //* scan-last: one page.
        pages = [{ list: [{ id: 'a' }], count: 1, last: { _id: 'a' } } as any];
        expect(await $mgr.doScanLast({ limit: 1 } as any)).toEqual({
            list: [{ id: 'a' }],
            total: 1,
            limit: 1,
            count: 1,
            last: { _id: 'a' },
        });
        pages = [{ list: [], count: 0, last: {} } as any];
        expect(await $mgr.doScanLast(undefined)).toEqual({ list: [], total: 0, limit: 2, count: 0 });
    });

    it('B18 manager doSyncScanLast with a fake bulk client', async () => {
        const service = new B18Service();
        service.table = 'b18-table';
        const $mgr = service.$test;
        let pages: any[] = [];
        vi.spyOn(DynamoScanService.prototype, 'scan').mockImplementation(async () => pages.shift());
        let mode = '';
        const bulk = vi.fn(async ({ body }: any) => {
            if (mode === 'fail') throw new Error('500 BULK - b18');
            const ids = body.filter((_: any, i: number) => i % 2 === 0).map((op: any) => op.index._id);
            if (mode === 'mismatch') ids.push('zz');
            return {
                body: {
                    errors: false,
                    items: ids.map((_id: string) => ({ index: { _id, _version: 1, status: 201 } })),
                },
            };
        });
        //* v5 B18: the default `$OS2` gets a fake client and an index name (no OpenSearch).
        vi.spyOn(AbstractOS2Instance.prototype, 'client', 'get').mockReturnValue({ bulk } as any);
        vi.spyOn(OS2Instance.prototype, 'options', 'get').mockReturnValue({ indexName: 'b18-index' } as any);

        const LIST = [{ _id: 'a', n: 1 }, { _id: 'b' }, { _id: 'c' }];
        pages = [{ list: LIST, count: 3, last: { _id: 'c' } }];
        const r1 = await $mgr.doSyncScanLast({ limit: 3 } as any, { size: 2 });
        expect(bulk).toHaveBeenCalledTimes(2);
        expect(bulk.mock.calls[0][0].body[0]).toEqual({ index: { _index: 'b18-index', _id: 'a' } });
        expect(bulk.mock.calls[0][0].body[1]).toEqual({ n: 1 });
        expect(r1.list.map(N => N._id)).toEqual(['a', 'b', 'c']);
        expect(r1.count).toEqual(3);
        expect(r1.last).toEqual({ _id: 'c' });
        expect(typeof r1.took).toEqual('number');

        mode = 'fail';
        pages = [{ list: LIST, count: 3, last: {} }];
        const r2 = await $mgr.doSyncScanLast({ limit: 3 } as any);
        expect(r2.list).toEqual([{ error: '500 BULK - b18' }]);

        mode = 'mismatch';
        pages = [{ list: LIST, count: 3, last: {} }];
        await expect($mgr.doSyncScanLast({ limit: 3 } as any)).rejects.toThrow('Mismatched list id found: zz');
    });

    it('B18 service doSearch via the default $OS2, guardProxy saveOnError', async () => {
        const service = new B18Service();
        const search = vi
            .spyOn(OS2Instance.prototype, 'search')
            .mockResolvedValue({ total: 1, list: [{ id: 'a' }] } as any);
        //* call the base `doSearch()` (the subclass overrides it).
        const res = await MyCoreService.prototype.doSearch.call(service, { size: 1 });
        expect(res).toEqual({ total: 1, list: [{ id: 'a' }] });
        expect(search).toHaveBeenCalledWith({ size: 1 });

        //* saveOnError: the updates are saved before rethrow.
        const saved = vi.spyOn(MyCoreProxy.prototype, 'saveAllUpdates').mockRejectedValueOnce(new Error('B18 SAVE'));
        const fail = service.guardProxy(
            {},
            async () => {
                throw new Error('B18 FAIL');
            },
            { saveOnError: true },
        );
        await expect(fail).rejects.toThrow('B18 FAIL');
        expect(saved).toHaveBeenCalledTimes(1);
        expect(service.createProxy({}).isMocks()).toEqual(false);
    });
    it('B18 OS2Service error handlers with client-like errors, `_id` id-name', async () => {
        let fail = false;
        const $os2 = new OS2Instance({
            endpoint: 'https://b18.invalid',
            indexName: 'b18-i',
            tableName: '',
            idName: '_id',
        });
        const fake = fakeProxy((method, path1, path2) => {
            if (fail) throw metaError(400, 'bad_request_x', 'meta');
            return { _id: path2.split('/')[1], _version: 1 };
        });
        ($os2.fgac as any)._fgacProxy = fake.proxy; //* v5 B18: fake FGAC transport.
        //* `_id` is reserved: not sent in the body.
        expect(await $os2.elastic.saveItem('a', { n: 1 } as any)).toMatchObject({ _id: 'a', n: 1, _version: 1 });
        expect(fake.calls[0].body).toEqual({ n: 1 });
        fail = true;
        await expect($os2.elastic.bulkItems([{ _id: 'a' } as any])).rejects.toThrow('400 BAD REQUEST - meta');
        await expect($os2.elastic.pushItem({ id: 'a' } as any)).rejects.toThrow('400 BAD REQUEST - meta');
        await expect($os2.elastic.searchRaw({ size: 1 })).rejects.toThrow('400 BAD REQUEST - meta');
    });

    describe('B18 MyCoreProxy session and context', () => {
        const ENV2 = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME', 'LOCAL_ACCOUNT', 'USE_SESSION'];
        const $env2: Record<string, string> = ENV2.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
        afterEach(() => {
            ENV2.forEach(k => ($env2[k] === undefined ? delete process.env[k] : (process.env[k] = $env2[k])));
        });
        //* local mode on (off Lambda).
        const local = () => {
            process.env.LOCAL_MODE = '1';
            delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        };
        //* unsigned JWT with the given payload (decode only, never verified here).
        const jwt = (payload: any) =>
            ['{"alg":"none","typ":"JWT"}', JSON.stringify(payload)]
                .map(s => Buffer.from(s).toString('base64url'))
                .join('.') + '.x';

        it('B18 duplicate manager proxy, fetchIdentityAccess', async () => {
            const service = new B18Service();
            const proxy = service.createProxy({});
            expect(() => new MyManagerProxy(proxy, service.$test)).toThrow(
                '@modelType[test] is invalid - already exists!',
            );
            await expect((proxy as any).fetchIdentityAccess('i', 'd')).rejects.toThrow(
                '400 NOT SUPPORTED - fetchIdentityAccess(i/d)',
            );
            await expect((proxy as any).fetchIdentityAccess()).rejects.toThrow('fetchIdentityAccess(/)');
        });

        it('B18 getCurrentSession() file, jwt and errors', async () => {
            delete process.env.LOCAL_MODE;
            const proxy = new B18Service().createProxy({ identity: { sid: '', uid: 'u' } as any });
            //* not local: an empty `sid` is refused.
            expect(() =>
                proxy.getCurrentSession({
                    useSession: false,
                    context: { identity: { userAgent: 'a', identityPoolId: 'p', sid: '', uid: 'u' } } as any,
                }),
            ).toThrow('403 IDENTITY-TOKEN - .sid (site-id) is required!');
            //* a session file given by name (missing file, then a json file without context).
            expect(() => proxy.getCurrentSession({ useSession: 'data/b18-missing.json', throwable: false })).toThrow(
                '@file[data/b18-missing.json] is invalid',
            );
            const $file = proxy.getCurrentSession({ useSession: 'package.json', throwable: false });
            expect(typeof $file).toEqual('object');

            //* local: `USE_SESSION=*.json` is loaded; `meta` (jwt) is decoded.
            local();
            expect(() => proxy.getCurrentSession({ USE_SESSION: 'data/b18-missing.json' })).toThrow(
                '@file[data/b18-missing.json]',
            );
            const meta = jwt({ sid: 's1', uid: '#u' });
            const $jwt = proxy.getCurrentSession({ context: { identity: { meta } } as any });
            expect($jwt).toMatchObject({ sid: 's1', uid: null });
            //* local + LOCAL_ACCOUNT, no identity-id.
            process.env.LOCAL_ACCOUNT = 'b18-acc';
            expect(proxy.asCurrentIdentityId({})).toEqual('b18-acc');
            process.env.LOCAL_ACCOUNT = '';
            expect(proxy.asCurrentIdentityId({})).toEqual(null);
        });

        it('B18 assertContext() throws per condition', async () => {
            delete process.env.LOCAL_MODE;
            const proxy = new B18Service().createProxy({ identity: { sid: 's', uid: 'u', roles: [] } as any });
            expect(() => proxy.assertContext({ isLocal: true }, { errScope: 'b18' })).toThrow(
                '403 NOT ALLOWED - invalid isLocal[true] @b18',
            );
            expect(() => proxy.assertContext({ hasRole: 'admin' })).toThrow(
                '403 NOT ALLOWED - invalid hasRole[admin] @assertContext()',
            );
            expect(proxy.assertContext({ hasRole: 'admin' }, { throwable: false })).toEqual(false);
        });

        it('B18 packSearchParam() page, empty filters, scopes', async () => {
            delete process.env.LOCAL_MODE;
            const S = { sid: 's1', uid: '', gid: '', roles: ['user'], userAgent: 'a', identityPoolId: 'p' };
            const proxy = new B18Service().createProxy({ identity: S } as any);
            const $tests = proxy.tests;
            expect(() => $tests.packSearchParam({ page: -1 })).toThrow('@page[-1] is invalid - packSearchParam(test)');
            const r1 = $tests.packSearchParam({ name: '', test: '!' }, { name: 'x' } as any);
            expect(r1.$param).toEqual({ name: '', test: '!' });
            expect(() =>
                $tests.packSearchParam({}, undefined, { useSession: true, scope: 'owner', throwable: false }),
            ).toThrow('403 NOT ALLOWED - list[owner] needs session .uid');
            expect(() =>
                $tests.packSearchParam({}, undefined, { useSession: true, scope: 'b18' as any, throwable: false }),
            ).toThrow('403 NOT ALLOWED - list[b18] is invalid @packSearchParam(test)');
            //* admin: `?uid=` as given, `0` = own uid.
            const admin = new B18Service().createProxy({ identity: { ...S, uid: 'u1', roles: ['admin'] } } as any);
            expect(admin.tests.packSearchParam({ uid: '0' }, undefined, { useSession: true }).$param).toEqual({
                sid: 's1',
                uid: 'u1',
            });
            expect(admin.tests.packSearchParam({ uid: 'u9' }, undefined, { useSession: true }).$param.uid).toEqual(
                'u9',
            );
        });

        it('B18 makeModel() and mget() of a known-missing id', async () => {
            local();
            const proxy = new B18Service().createProxy({});
            await expect(proxy.tests.makeModel(null)).rejects.toThrow(
                '@model (test-model) is required - makeModel(test/)',
            );
            //* a 404 read is cached as `null`; mget then throws (or gives null).
            expect(await proxy.tests.get('b18-none', false)).toEqual(null);
            await expect(proxy.tests.mget(['b18-none'])).rejects.toThrow('404 NOT FOUND - proxy/test/id:b18-none');
            expect(await proxy.tests.mget(['b18-none'], false)).toEqual([null]);
            expect(await proxy.tests.mget([])).toEqual([]);
        });
    });
});
