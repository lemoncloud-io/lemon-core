/**
 * `abstract-service.b18.spec.ts`
 * - v5 B18-c: `CoreManager`/`ManagerProxy`/`AbstractProxy`/`OS2Synchronizer` over the dummy storage.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoreModel, NextContext } from 'lemon-model';
import $cores, { OS2CoreService } from '../cores/';
import { OS2Instance } from './cores/abstract-services';
import {
    AbstractProxy,
    CoreManager,
    CoreService,
    ManagerProxy,
    OS2Synchronizer,
    asIdentityId,
} from './abstract-service';
import { AbstractOS2Instance } from './abstract-service';

type ModelType = 'item';
type Model = CoreModel<ModelType> & { name?: string; code?: string; count?: number; tags?: string[] };
const FIELDS = ['id', 'name', 'code', 'count', 'tags', 'ns', 'type', 'stereo', 'sid', 'uid', 'lock', 'next', 'meta'];
const FIELDS2 = [...FIELDS, 'createdAt', 'updatedAt', 'deletedAt', 'error'];

//* manager with a unique field (`code`), or none.
class ItemManager extends CoreManager<Model, ModelType, ItemService> {
    public constructor(parent: ItemService, unique?: string) {
        super('item', parent, FIELDS2, unique);
    }
}
//* service on the dummy file (in memory).
class ItemService extends CoreService<Model, ModelType> {
    public readonly $item: ItemManager;
    public constructor(unique?: string) {
        super('dummy-data.yml', 'TT');
        this.$item = new ItemManager(this, unique);
    }
}
//* proxy with one manager proxy.
class ItemProxy extends AbstractProxy<ModelType, ItemService> {
    public readonly items: ManagerProxy<Model, ItemManager, ModelType>;
    public constructor(context: NextContext, service: ItemService) {
        super(context, service, 2);
        this.items = new ManagerProxy(this, service.$item);
    }
}

describe('abstract-service B18', () => {
    const KEYS = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME'];
    const $env: Record<string, string> = KEYS.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
    afterEach(() => {
        vi.restoreAllMocks();
        KEYS.forEach(k => ($env[k] === undefined ? delete process.env[k] : (process.env[k] = $env[k])));
    });

    it('B18 CoreManager CRUD with a unique field', async () => {
        const $mgr = new ItemService('code').$item;
        expect(asIdentityId({ identity: { identityId: 'i1' } as any })).toEqual('i1');

        //* argument errors.
        await expect($mgr.save('', {})).rejects.toThrow('@id is requird - save()');
        await expect($mgr.update('', {})).rejects.toThrow('@id is requird - update()');
        await expect($mgr.updateOrCreate('', {})).rejects.toThrow('@id is requird - updateOrCreate()');
        await expect($mgr.delete('')).rejects.toThrow('@id is requird - delete()');
        await expect($mgr.prepare('b18-none', undefined)).rejects.toThrow('404 NOT FOUND - item:b18-none');
        await expect($mgr.prepare('b18-none', {}, false)).rejects.toThrow('404 NOT FOUND - item:b18-none');

        //* prepare/save/update keep the lookup of `code`.
        const $p = await $mgr.prepare('b18-1', { name: 'one', code: 'C1' });
        expect($p).toMatchObject({ id: 'b18-1', name: 'one', code: 'C1' });
        expect(await $mgr.getByUniqueField('C1')).toMatchObject({ id: 'b18-1' });
        expect(await $mgr.findByUniqueField('C1')).toMatchObject({ id: 'b18-1' });
        expect(await $mgr.findByUniqueField('C-none')).toEqual(null);
        expect(await $mgr.save('b18-1', { name: 'one', code: 'C2' })).toMatchObject({ code: 'C2' });
        expect(await $mgr.findByUniqueField('C1')).toEqual(null);
        expect(await $mgr.update('b18-1', { code: 'C3' }, { count: 1 })).toMatchObject({ code: 'C3', count: 1 });
        expect(await $mgr.updateOrCreate('b18-2', { code: 'C4' }, { count: 2 })).toMatchObject({
            id: 'b18-2',
            count: 2,
        });
        expect(await $mgr.updateOrCreate('b18-2', { name: 'two' })).toMatchObject({ name: 'two', code: 'C4' });

        //* insert with the next sequence.
        const $ins = await $mgr.insert({ name: 'seq' }, 1000);
        expect(Number($ins.id) >= 1000).toEqual(true);

        //* delete removes the lookup too.
        expect(await $mgr.delete('b18-2', true)).toMatchObject({ id: 'b18-2', code: 'C4' });
        expect(await $mgr.findByUniqueField('C4')).toEqual(null);
    });

    it('B18 CoreManager find/findByKey rethrow other errors', async () => {
        const $mgr = new ItemService().$item;
        vi.spyOn($mgr as any, 'retrieve').mockRejectedValue(new Error('500 B18'));
        await expect($mgr.find('a')).rejects.toThrow('500 B18');
        vi.spyOn($mgr.storage.storage, 'read').mockRejectedValue(new Error('500 B18 KEY'));
        await expect($mgr.findByKey('a')).rejects.toThrow('500 B18 KEY');
        vi.spyOn($mgr, 'getByUniqueField').mockRejectedValue(new Error('500 B18 U'));
        await expect($mgr.findByUniqueField('a')).rejects.toThrow('500 B18 U');
    });

    it('B18 ManagerProxy get/set/mget/mset/inc', async () => {
        const service = new ItemService();
        await service.$item.save('b18-a', { name: 'A' });
        await service.$item.save('b18-b', { name: 'B' });
        const proxy = new ItemProxy({}, service);
        const $items = proxy.items;
        expect($items.storage).toBe(service.$item.storage);
        expect($items.has('b18-a')).toEqual(false);

        //* a 404 is cached as `null`.
        await expect($items.get('b18-x')).rejects.toThrow('404 NOT FOUND - proxy/item/id:b18-x');
        await expect($items.get('b18-x')).rejects.toThrow('404 NOT FOUND - proxy/item/id:b18-x');
        expect(await $items.get('b18-x', false)).toEqual(null);

        //* base `mget()` (with the cache, a fetched pair and a missing id).
        const ids = ['b18-a', 'b18-b', 'b18-a', 'b18-y'];
        await expect($items.mget(ids)).rejects.toThrow('404 NOT FOUND - proxy/item/id:b18-y');
        expect(await $items.mget([])).toEqual([]);
        await expect($items.mget(['b18-x'])).rejects.toThrow('404 NOT FOUND - proxy/item/id:b18-x');
        const list = await new ItemProxy({}, service).items.mget(ids, false);
        expect(list.map(N => N?.name ?? null)).toEqual(['A', 'B', 'A', null]);
        expect(await $items.mget(['b18-x', 'b18-a'], false)).toEqual([null, expect.objectContaining({ name: 'A' })]);
        expect($items.has('b18-a')).toEqual(true);

        //* set/mset/inc argument errors and updates.
        await expect($items.set('b18-a', null)).rejects.toThrow('@model (object) is required - proxy/item/id:b18-a!');
        await expect($items.inc('b18-a', null)).rejects.toThrow('@model (object) is required - proxy/item/id:b18-a!');
        await expect($items.inc('b18-a', { name: 'x' })).rejects.toThrow('@model (object) is empty to inc()');
        expect(await $items.mset([])).toEqual([]);
        await expect($items.mset([{ name: 'x' } as any])).rejects.toThrow('@id is required - proxy/item/mset()!');
        const sets = await $items.mset([
            { id: 'b18-a', name: 'A2' },
            { id: 'b18-b', name: 'B2' },
        ]);
        expect(sets.map(N => N.name)).toEqual(['A2', 'B2']);
    });

    it('B18 saveAllUpdates() batch mode and update errors', async () => {
        const service = new ItemService();
        await service.$item.save('b18-c', { name: 'C' });
        await service.$item.save('b18-d', { name: 'D' });
        const proxy = new ItemProxy({}, service);
        (await proxy.items.get('b18-c')).name = 'C2';
        (await proxy.items.get('b18-d')).name = 'D2';
        const saved = await proxy.saveAllUpdates({ useBatch: true });
        expect(saved.map((N: any) => N.name).sort()).toEqual(['C2', 'D2']);
        expect((await service.$item.find('b18-c')).name).toEqual('C2');

        //* the legacy updater wraps a storage error.
        const proxy2 = new ItemProxy({}, service);
        (await proxy2.items.get('b18-c')).name = 'C3';
        vi.spyOn(service.$item.storage, 'update').mockRejectedValueOnce(new Error('500 B18'));
        await expect(proxy2.saveAllUpdates()).rejects.toThrow(
            'Failed to update item/b18-c: 500 B18 @saveAllUpdates(2)',
        );
        const proxy3 = new ItemProxy({}, service);
        (await proxy3.items.get('b18-c')).name = 'C4';
        vi.spyOn(service.$item.storage, 'update').mockImplementationOnce(() => {
            throw new Error('B18 SYNC');
        });
        await expect(proxy3.saveAllUpdates()).rejects.toThrow('Failed to update item/b18-c: B18 SYNC');
    });

    it('B18 AbstractProxy report, identity access and identity-id', async () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const service = new ItemService();
        const proxy = new ItemProxy({ domain: 'b18.invalid', identity: { identityId: 'i-1' } as any }, service);
        //* local mode: the slack report is ignored.
        expect(await proxy.report('B18', { a: 1 })).toEqual('!ignore');

        //* v5 B18: the accounts call is stubbed (no send).
        const execute = vi
            .spyOn($cores.protocol.service, 'execute')
            .mockImplementation(
                async (p: any) => (p?.body?.identityId === 'i-404' ? null : { id: p?.body?.identityId }) as any,
            );
        expect(await proxy.getIdentity$('')).toEqual(null);
        expect(await proxy.getIdentity$('i-1')).toEqual({ id: 'i-1' });
        expect(await proxy.getIdentity$('i-1')).toEqual({ id: 'i-1' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0]).toMatchObject({
            mode: 'POST',
            body: { domain: 'b18.invalid', identityId: 'i-1' },
        });
        expect(await proxy.getIdentity$('i-1', true)).toEqual({ id: 'i-1' });
        expect(await proxy.getIdentity$('i-404')).toEqual(null);
        await expect((proxy as any).fetchIdentityAccess('')).rejects.toThrow(
            '.identityId (string) is required - fetchAccess(b18.invalid)',
        );
        expect(await proxy.getCurrentIdentityId()).toEqual('i-1');
        const anon = new ItemProxy({}, service);
        await expect(anon.getCurrentIdentityId()).rejects.toThrow('400 NOT ALLOWED - getCurrentIdentity()');
        expect(await anon.getCurrentIdentityId(false)).toEqual('');
    });

    it('B18 OS2Synchronizer filter and sync callbacks', async () => {
        //* v5 B18: no elastic; only the handler map is used.
        const $sync = new OS2Synchronizer();
        const filter = (id: string, item: any) => ($sync as any).filter(id, item);
        expect(filter('a', { type: 'item' })).toEqual(false);
        $sync.enableSynchronization('item');
        expect(filter('a', { type: 'item' })).toEqual(true);
        expect(filter('a', { type: 'item', stereo: '#x' })).toEqual(false);
        const calls: string[] = [];
        $sync.enableSynchronization('other', {
            onBeforeSync: async id => void calls.push(`before:${id}`),
            onAfterSync: async id => void calls.push(`after:${id}`),
        });
        expect(filter('b', { type: 'other' })).toEqual(true);
        await ($sync as any).onBeforeSync('b', 'INSERT', { type: 'other' });
        await ($sync as any).onAfterSync('b', 'INSERT', { type: 'other' });
        await ($sync as any).onBeforeSync('c', 'INSERT', { type: 'none' });
        await ($sync as any).onAfterSync('c', 'INSERT', { type: 'item' });
        expect(calls).toEqual(['before:b', 'after:b']);
    });
    it('B18 AbstractOS2Instance index calls, mget, search and generator', async () => {
        const $os2 = new OS2Instance({ endpoint: 'https://b18.invalid', indexName: 'b18-i', tableName: '' });
        //* v5 B18: the index admin and search calls are stubbed on the core service (no OpenSearch).
        const create = vi.spyOn(OS2CoreService.prototype, 'createIndex').mockResolvedValue({ created: 1 } as any);
        vi.spyOn(OS2CoreService.prototype, 'destroyIndex').mockResolvedValue({ deleted: 1 } as any);
        vi.spyOn(OS2CoreService.prototype, 'describe').mockResolvedValue({ described: 1 } as any);
        const pages = [
            { total: 3, list: [{ id: 1 }, { id: 2 }], last: ['k2'] },
            { total: 3, list: [{ id: 3 }], last: undefined as any },
        ];
        const search = vi
            .spyOn(OS2CoreService.prototype, 'search')
            .mockImplementation(async () => pages.shift() as any);
        expect(await $os2.createIndex()).toEqual({ created: 1 });
        expect(create.mock.calls[0][0]).toBeDefined();
        expect(await $os2.destroyIndex()).toEqual({ deleted: 1 });
        expect(await $os2.describeIndex()).toEqual({ described: 1 });
        //* base `search()`: another index -> a new core service with the same options.
        //* v5 B22: `OS2Instance.search()` honours `indexName` too (see `abstract-services.b18.spec.ts`).
        const base = AbstractOS2Instance.prototype.search.call($os2, { size: 2 }, { indexName: 'b18-other' });
        expect(await base).toMatchObject({ total: 3 });
        expect((search.mock.contexts[0] as any).options.indexName).toEqual('b18-other');
        pages.unshift({ total: 3, list: [{ id: 1 }, { id: 2 }], last: ['k2'] });
        const lists: any[] = [];
        for await (const L of $os2.generateSearchResult<any>({ size: 2 })) lists.push(L);
        expect(lists).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);

        //* mget on a fake client.
        const mget = vi.fn(async () => ({
            body: { docs: [{ found: true, _source: { $id: 'a', n: 1 } }, { found: false }] },
        }));
        ($os2.elastic as any)._client = { mget }; //* v5 B18: no OpenSearch connection.
        expect(await $os2.mget(['a', 'b'])).toEqual([{ _id: 'a', n: 1 }, null]);
        expect(mget).toHaveBeenCalledWith({ index: 'b18-i', body: { docs: [{ _id: 'a' }, { _id: 'b' }] } });

        //* no elastic -> null / undefined.
        const $none = new OS2Instance({} as any);
        expect(await $none.createIndex()).toEqual(null);
        expect(await $none.destroyIndex()).toEqual(undefined);
        expect(await $none.describeIndex()).toEqual(undefined);
        expect($none.client).toEqual(undefined);
    });

    it('B18 CoreManager getMulti$ skips empty and duplicate ids', async () => {
        const service = new ItemService();
        await service.$item.save('b18-m', { name: 'M' });
        expect(Object.keys(await service.$item.getMulti$(['b18-m', '', 'b18-m']))).toEqual(['b18-m']);
        expect(await service.$item.getMulti([])).toEqual([]);
    });
});
