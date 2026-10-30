/**
 * `abstract-controllers.b18.spec.ts`
 * - v5 B18-c: `AbstractCRUDController` mock loading, `doGetList`, `doGetAdmin` and error branches.
 * - storage is the dummy file; the search engine is a fake on the service; mock yml files are served from memory.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import { CoreModel, NextContext } from 'lemon-model';
import { $T } from './commons';
import { MyCoreManager, MyCoreService, MyCoreProxy, MyManagerProxy } from './abstract-services';
import { AbstractCRUDController, AbstractTransformer } from './abstract-controllers';

type ModelType = 'item';
type Model = CoreModel<ModelType> & { name?: string };
const FIELDS = ['id', 'name', 'ns', 'type', 'stereo', 'sid', 'uid', 'gid', 'lock', 'next', 'meta'];
const FIELDS2 = [...FIELDS, 'createdAt', 'updatedAt', 'deletedAt', 'error'];

//* manager, service (fake search) and proxy.
class ItemManager extends MyCoreManager<Model, ModelType, ItemService> {
    public constructor(parent: ItemService) {
        super('item', parent, FIELDS2);
    }
}
class ItemService extends MyCoreService<Model, ModelType, ItemProxy> {
    public readonly $item: ItemManager;
    public constructor() {
        super('dummy-data.yml', 'TT');
        this.$item = new ItemManager(this);
    }
    public createProxy = (context: NextContext) => new ItemProxy(context, this);
    public hasSearchEngine() {
        return true;
    }
    public async doSearch<T>(): Promise<any> {
        return { total: 1, list: [{ id: 's1', name: 'S' }] as unknown as T[] };
    }
}
class ItemProxy extends MyCoreProxy<ModelType, ItemService> {
    public readonly items: MyManagerProxy<Model, ItemManager, ItemService, ModelType>;
    public constructor(context: NextContext, service: ItemService) {
        super(context, service);
        this.items = new MyManagerProxy(this, service.$item);
    }
}
//* transformer with `name`.
class ItemTransformer extends AbstractTransformer<Model, any, any> {
    public modelAsView(model: Model, hasCores?: boolean): any {
        return { ...super.modelAsView(model, hasCores), name: model?.name };
    }
    public bodyToModel(body: any, isCreate?: boolean): Model {
        const model = super.bodyToModel(body, isCreate);
        if (body?.name !== undefined) model.name = $T.S(body.name);
        return model;
    }
}
//* controller (`/items`), session off.
const build = () => {
    const service = new ItemService();
    const api = new (class extends AbstractCRUDController<
        ModelType,
        Model,
        any,
        any,
        ItemService,
        ItemManager,
        ItemTransformer
    > {
        public constructor() {
            super('items', service, service.$item, new ItemTransformer(), { useSession: false });
        }
    })();
    return { service, api };
};

//* in-memory mock files (`./data/<file>`).
const FILES: Record<string, string> = {
    './data/b18/item.yml': [
        'conf:',
        '  $id: 5000',
        '  name: b18',
        '  _hidden: 1',
        'data:',
        '  - id: 0',
        '    name: auto',
        '  - id: 3',
        '    name: three',
        '    _user: 7',
        '    Tags:',
        '      - name: t1',
        '      - id: 2',
        '        type: tag',
        '    Owner:',
        '      name: o1',
        '  - name: noid',
    ].join('\n'),
    './data/b18/one.yml': ['conf:', '  name: one', 'data:', '  name: single'].join('\n'),
    './data/initial/item.yml': [
        'conf:',
        '  name: init',
        'data:',
        '  - id: 1',
        '    name: I1',
        '  - id: 2',
        '    name: I2',
    ].join('\n'),
};

describe('abstract-controllers B18', () => {
    const KEYS = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME'];
    const $env: Record<string, string> = KEYS.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
    beforeEach(() => {
        //* v5 B18: serve the mock files from memory, other paths unchanged.
        const exists = fs.existsSync;
        const read = fs.readFileSync;
        vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => (FILES[`${p}`] !== undefined ? true : exists(p)));
        vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, o: any) =>
            FILES[`${p}`] !== undefined ? FILES[`${p}`] : read(p, o)) as any);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        KEYS.forEach(k => ($env[k] === undefined ? delete process.env[k] : (process.env[k] = $env[k])));
    });
    //* local mode (admin, session off).
    const local = () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    };

    it('B18 loadFromFile() and loadMockData()', async () => {
        const { api } = build();
        await expect(api.loadFromFile('')).rejects.toThrow('@file (string) is required!');
        const res: any = await api.loadFromFile('b18/item.yml');
        expect(res.name).toEqual('b18');
        expect(res._hidden).toEqual(undefined);
        //* (observed) `id: 0` = next of the type; `_user` = a ref id per type (10k blocks); `Owner` -> type `owne`.
        expect(res.list).toEqual([
            { type: 'root', id: '5001', name: 'auto' },
            {
                type: 'root',
                id: '3',
                name: 'three',
                userId: '10007',
                Tags: [
                    { type: 'tag', name: 't1' },
                    { type: 'tag', id: '20002' },
                ],
                Owner: { type: 'owne', name: 'o1' },
            },
            { type: 'root', name: 'noid' },
        ]);
        //* a single object is a list of one.
        expect((await api.loadFromFile('b18/one.yml')).list).toEqual([{ type: 'root', name: 'single' }]);
        expect((await api.loadMockData<any>('item', 'b18')).length).toEqual(3);
        await expect(api.loadMockData<any>('b18/one')).resolves.toEqual([{ type: 'root', name: 'single' }]);
    });

    it('B18 doGetList() through the search engine', async () => {
        const { api } = build();
        await expect(api.doGetList('1', {}, null, {})).rejects.toThrow(
            '@id[1](string) is invalid - doGetList(items/1)',
        );
        const res = await api.doGetList('0', { limit: 5, view: 'mine' } as any, null, {});
        expect(res).toMatchObject({ total: 1, limit: 5, page: 0 });
        expect(res.list).toEqual([expect.objectContaining({ id: 's1', name: 'S' })]);
    });

    it('B18 doGetAdmin() hello, read and initialize', async () => {
        local();
        const { api, service } = build();
        await service.$item.save('b18-a', { name: 'A' });
        const hello: any = await api.doGetAdmin('', { a: 1 }, null, { clientIp: '127.0.0.1' });
        expect(hello).toMatchObject({ id: '', param: { a: 1 }, context: { clientIp: '127.0.0.1' } });
        expect(hello.hello.startsWith('api:items/')).toEqual(true);
        expect(await api.doGetAdmin('b18-a', {}, null, {})).toMatchObject({ id: 'b18-a', name: 'A' });

        //* `initialize` loads `initial/<type>.yml`: as is, `?save`, then `?clear`.
        const r0: any = await api.doGetAdmin('initialize', {}, null, {});
        expect(r0.list.map((N: any) => N.id)).toEqual(['1', '2']);
        const r1: any = await api.doGetAdmin('initialize', { save: '' }, null, {});
        expect(r1.list.map((N: any) => N.name)).toEqual(['I1', 'I2']);
        expect((await service.$item.find('1')).name).toEqual('I1');
        const r2: any = await api.doGetAdmin('initialize', { clear: 1 }, null, {});
        expect(r2.list.length).toEqual(2);
        expect(await service.$item.find('1')).toEqual(null);
    });

    it('B18 CRUD error branches', async () => {
        local();
        const { api, service } = build();
        await service.$item.save('b18-del', { name: 'D' });
        await service.$item.delete('b18-del'); //* soft delete: `deletedAt` is set.
        //* POST of an array goes to the bulk route; bulk checks its arguments.
        await expect(api.doPost('0', null, [] as any, {})).resolves.toEqual([]);
        await expect(api.doPostBulk('1', null, [], {})).rejects.toThrow(
            '@id (string) is invalid - doPostBulk(items/1)',
        );
        await expect(api.doPostBulk('', null, { list: 'x' } as any, {})).rejects.toThrow(
            '@body (array) is required - doPostBulk(items/)',
        );
        //* PUT of a missing or deleted model.
        await expect(api.doPut('b18-none', null, { name: 'x' }, {})).rejects.toThrow(
            '404 NOT FOUND - not found @doPut(items/b18-none)',
        );
        //* (observed) a soft-deleted row reads as missing through the proxy.
        await expect(api.doPut('b18-del', null, { name: 'x' }, {})).rejects.toThrow(
            '404 NOT FOUND - not found @doPut(items/b18-del)',
        );
    });
});
