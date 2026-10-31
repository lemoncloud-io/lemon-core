/**
 * `dynamo-service.b18.spec.ts`
 * - v5 B18-a: offline tests for `DynamoService` with the SDK clients stubbed at `send()` (no AWS, no network).
 * - asserts the command class and input the service builds, and how it maps responses and errors.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneralItem } from 'lemon-model';
import { DummyDynamoService, DynamoOption, DynamoService } from './dynamo-service';

interface MyModel extends GeneralItem {
    ID?: string;
    S?: number;
}

//* v5 B18: fake clients; `send()` is the only boundary the service uses.
const stubClients = () => {
    const low = { send: vi.fn() };
    const doc = { send: vi.fn() };
    vi.spyOn(DynamoService, 'instance').mockReturnValue({ dynamo: low, dynamodoc: async () => doc });
    return { low, doc };
};

//* v5 B18: the command class name and its input, from the n-th `send()` call.
const sent = (send: any, n = 0) => {
    const cmd = send.mock.calls[n][0];
    return { name: cmd.constructor.name, input: cmd.input };
};

//* v5 B18: run an async call while the fake clock drives the retry back-off timers.
const withTimers = async <R>(fn: () => Promise<R>): Promise<R> => {
    vi.useFakeTimers();
    const p = fn();
    await vi.runAllTimersAsync();
    return p;
};

const make = (opt: Partial<DynamoOption> = {}) =>
    new DynamoService<MyModel>({ tableName: 'T', idName: 'ID', ...opt } as DynamoOption);

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('DynamoService offline (B18)', () => {
    describe('instance() and payload builders', () => {
        it('B18 builds and caches the document client per region (no send)', async () => {
            const a = DynamoService.instance('b18-local-1');
            const b = DynamoService.instance('b18-local-1');
            expect(a.dynamo).toBe(b.dynamo);
            expect(a.dynamodoc).toBe(b.dynamodoc);
            const doc1 = await a.dynamodoc();
            const doc2 = await b.dynamodoc();
            expect(doc1).toBe(doc2);
            expect(typeof doc1.send).toBe('function');
            expect(DynamoService.instance().dynamo).toBe(DynamoService.instance('ap-northeast-2').dynamo);
        });

        it('B18 constructor needs tableName and idName', () => {
            expect(() => new DynamoService({ tableName: '', idName: 'ID' })).toThrow('.tableName is required');
            expect(() => new DynamoService({ tableName: 'T', idName: '' })).toThrow('.idName is required');
            expect(make().hello()).toEqual('dynamo-service:T');
        });

        it('B18 prepareCreateTable() and prepareDeleteTable()', () => {
            expect(make().prepareCreateTable()).toEqual({
                TableName: 'T',
                KeySchema: [{ AttributeName: 'ID', KeyType: 'HASH' }],
                AttributeDefinitions: [{ AttributeName: 'ID', AttributeType: 'S' }],
                ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
                StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
            });
            expect(
                make({ idType: 'number', sortName: 'S', sortType: 'number' }).prepareCreateTable(5, 6, false),
            ).toEqual({
                TableName: 'T',
                KeySchema: [
                    { AttributeName: 'ID', KeyType: 'HASH' },
                    { AttributeName: 'S', KeyType: 'RANGE' },
                ],
                AttributeDefinitions: [
                    { AttributeName: 'ID', AttributeType: 'N' },
                    { AttributeName: 'S', AttributeType: 'N' },
                ],
                ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 6 },
                StreamSpecification: { StreamEnabled: false, StreamViewType: 'NEW_AND_OLD_IMAGES' },
            });
            expect(() => make({ idType: 'bad' as any }).prepareCreateTable()).toThrow('invalid key-type:bad');
            expect(make().prepareDeleteTable()).toEqual({ TableName: 'T' });
        });

        it('B18 prepareSaveItem() sets the id and normalizes', () => {
            expect(make().prepareSaveItem('a', { ID: 'x', name: '', list: ['', 'b'] } as any)).toEqual({
                TableName: 'T',
                Item: { ID: 'a', name: null, list: [null, 'b'] },
            });
            expect(() => make({ sortName: 'S' }).prepareSaveItem('a', {})).toThrow(
                '.S is required - prepareSaveItem(ID:a)',
            );
        });

        it('B18 prepareItemKey() checks id and sort', () => {
            expect(make().prepareItemKey('a', undefined)).toEqual({ TableName: 'T', Key: { ID: 'a' } });
            expect(make({ sortName: 'S' }).prepareItemKey('a', 1)).toEqual({ TableName: 'T', Key: { ID: 'a', S: 1 } });
            expect(() => make().prepareItemKey(' ', undefined)).toThrow('@id (string) is required');
            expect(() => make({ sortName: 'S' }).prepareItemKey('a', undefined)).toThrow('@sort (any) is required');
        });

        it('B18 prepareUpdateItem() skips keys and normalizes names', () => {
            const payload = make({ sortName: 'S' }).prepareUpdateItem(
                'a',
                1,
                { ID: 'x', S: 2, 'a.b': 'v', c: '', l: { setIndex: [[0, 'z']] } } as any,
                { n: 1, arr: [1] } as any,
            );
            expect(payload).toEqual({
                TableName: 'T',
                Key: { ID: 'a', S: 1 },
                UpdateExpression:
                    'SET #a_b = :a_b, #c = :c, #l[0] = :l_0_, #arr = list_append(if_not_exists(#arr, :arr_0), :arr) ADD #n :n',
                ExpressionAttributeNames: { '#a_b': 'a.b', '#c': 'c', '#l': 'l', '#n': 'n', '#arr': 'arr' },
                ExpressionAttributeValues: {
                    ':a_b': 'v',
                    ':c': null,
                    ':l_0_': 'z',
                    ':n': 1,
                    ':arr': [1],
                    ':arr_0': [],
                },
                ConditionExpression: null,
                ReturnValues: 'UPDATED_NEW',
            });
        });
    });

    describe('table commands (low-level client)', () => {
        it('B18 createTable() sends CreateTableCommand', async () => {
            const { low } = stubClients();
            low.send.mockResolvedValue({ TableDescription: { TableName: 'T' } });
            const service = make();
            expect(await service.createTable(2, 3)).toEqual({ TableDescription: { TableName: 'T' } });
            expect(sent(low.send)).toEqual({ name: 'CreateTableCommand', input: service.prepareCreateTable(2, 3) });
        });

        it('B18 deleteTable() sends DeleteTableCommand', async () => {
            const { low } = stubClients();
            low.send.mockResolvedValue({ TableDescription: { TableStatus: 'DELETING' } });
            expect(await make().deleteTable()).toEqual({ TableDescription: { TableStatus: 'DELETING' } });
            expect(sent(low.send)).toEqual({ name: 'DeleteTableCommand', input: { TableName: 'T' } });
        });
    });

    describe('item commands (document client)', () => {
        it('B18 readItem() sends GetCommand and maps not-found', async () => {
            const { doc } = stubClients();
            const service = make({ sortName: 'S' });
            doc.send.mockResolvedValueOnce({ Item: { ID: 'a', S: 1, v: 2 } });
            expect(await service.readItem('a', 1)).toEqual({ ID: 'a', S: 1, v: 2 });
            expect(sent(doc.send)).toEqual({ name: 'GetCommand', input: { TableName: 'T', Key: { ID: 'a', S: 1 } } });

            doc.send.mockResolvedValueOnce({});
            await expect(service.readItem('a', 1)).rejects.toThrow('404 NOT FOUND - ID:a/1');
            doc.send.mockResolvedValueOnce({});
            await expect(make().readItem('a')).rejects.toThrow('404 NOT FOUND - ID:a');
            doc.send.mockRejectedValueOnce(new Error('Requested resource not found'));
            await expect(service.readItem('a', 1)).rejects.toThrow('404 NOT FOUND - ID:a');
            doc.send.mockRejectedValueOnce(new Error('ThrottlingException'));
            await expect(service.readItem('a', 1)).rejects.toThrow('ThrottlingException');
        });

        it('B18 saveItem() sends PutCommand and returns the item', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValueOnce({});
            expect(await make().saveItem('a', { name: 'n', e: '' } as any)).toEqual({ ID: 'a', name: 'n', e: null });
            expect(sent(doc.send)).toEqual({
                name: 'PutCommand',
                input: { TableName: 'T', Item: { ID: 'a', name: 'n', e: null } },
            });
            doc.send.mockRejectedValueOnce(new Error('Requested resource not found'));
            await expect(make().saveItem('a', {})).rejects.toThrow('404 NOT FOUND - ID:a');
            doc.send.mockRejectedValueOnce(new Error('ValidationException'));
            await expect(make().saveItem('a', {})).rejects.toThrow('ValidationException');
        });

        it('B18 deleteItem() sends DeleteCommand', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValueOnce({});
            expect(await make().deleteItem('a')).toBeNull();
            expect(sent(doc.send)).toEqual({ name: 'DeleteCommand', input: { TableName: 'T', Key: { ID: 'a' } } });
            doc.send.mockRejectedValueOnce(new Error('Requested resource not found'));
            expect(await make().deleteItem('a')).toEqual({});
            doc.send.mockRejectedValueOnce(new Error('AccessDenied'));
            await expect(make().deleteItem('a')).rejects.toThrow('AccessDenied');
        });

        it('B18 updateItem() sends UpdateCommand and merges the key', async () => {
            const { doc } = stubClients();
            const service = make({ sortName: 'S' });
            doc.send.mockResolvedValueOnce({ Attributes: { v: 2, n: 3 } });
            expect(await service.updateItem('a', 1, { v: 2 }, { n: 1 })).toEqual({ v: 2, n: 3, ID: 'a', S: 1 });
            expect(sent(doc.send)).toEqual({
                name: 'UpdateCommand',
                input: service.prepareUpdateItem('a', 1, { v: 2 }, { n: 1 }),
            });
            doc.send.mockRejectedValueOnce(new Error('Requested resource not found'));
            await expect(service.updateItem('a', 1, { v: 1 })).rejects.toThrow('404 NOT FOUND - ID:a');
            doc.send.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));
            await expect(service.updateItem('a', 1, { v: 1 })).rejects.toThrow('ConditionalCheckFailedException');
        });
    });

    describe('mreadItem() (BatchGetCommand)', () => {
        it('B18 returns early for an empty list', async () => {
            const { doc } = stubClients();
            expect(await make().mreadItem([])).toEqual({ success: [], failed: [], total: 0 });
            expect(await make().mreadItem(null)).toEqual({ success: [], failed: [], total: 0 });
            expect(doc.send).not.toHaveBeenCalled();
        });

        it('B18 keeps the input order and marks missing keys 404', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValueOnce({
                Responses: {
                    T: [
                        { ID: 'b', v: 2 },
                        { ID: 'a', v: 1 },
                    ],
                },
            });
            const res = await make().mreadItem([{ id: 'a' }, { id: 'c' }, { id: 'b' }]);
            expect(res).toEqual({
                success: [
                    { ID: 'a', v: 1 },
                    { ID: 'b', v: 2 },
                ],
                failed: [{ ID: 'c', error: '404 NOT FOUND - ID:c' }],
                total: 3,
            });
            expect(sent(doc.send)).toEqual({
                name: 'BatchGetCommand',
                input: { RequestItems: { T: { Keys: [{ ID: 'a' }, { ID: 'c' }, { ID: 'b' }] } } },
            });
        });

        it('B18 uses id/sort signatures with a sort key', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValueOnce({ Responses: { T: [{ ID: 'a', S: 2 }] } });
            const res = await make({ sortName: 'S' }).mreadItem([
                { id: 'a', sort: 1 },
                { id: 'a', sort: 2 },
            ]);
            expect(res.success).toEqual([{ ID: 'a', S: 2 }]);
            expect(res.failed).toEqual([{ ID: 'a', S: 1, error: '404 NOT FOUND - ID:a' }]);
        });

        it('B18 retries unprocessed keys with back-off, then succeeds', async () => {
            const { doc } = stubClients();
            doc.send
                .mockResolvedValueOnce({
                    Responses: { T: [{ ID: 'a' }] },
                    UnprocessedKeys: { T: { Keys: [{ ID: 'b' }] } },
                })
                .mockResolvedValueOnce({ Responses: { T: [{ ID: 'b' }] } });
            const res = await withTimers(() => make().mreadItem([{ id: 'a' }, { id: 'b' }]));
            expect(res).toEqual({ success: [{ ID: 'a' }, { ID: 'b' }], failed: [], total: 2 });
            expect(doc.send).toHaveBeenCalledTimes(2);
            expect(sent(doc.send, 1).input).toEqual({ RequestItems: { T: { Keys: [{ ID: 'b' }] } } });
        });

        it('B18 gives up after 3 attempts on unprocessed keys', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValue({ UnprocessedKeys: { T: { Keys: [{ ID: 'b' }] } } });
            const res = await withTimers(() => make().mreadItem([{ id: 'b' }]));
            expect(res).toEqual({ success: [], failed: [{ ID: 'b', error: 'UNPROCESSED after 3 retries' }], total: 1 });
            expect(doc.send).toHaveBeenCalledTimes(3);
        });

        it('B18 maps a batch error onto every key of the chunk', async () => {
            const { doc } = stubClients();
            doc.send.mockRejectedValueOnce(new Error('ResourceNotFoundException: no table'));
            const res = await make().mreadItem([{ id: 'a' }, { id: 'b' }]);
            expect(res.failed).toEqual([
                { ID: 'a', error: '404 NOT FOUND - table:T' },
                { ID: 'b', error: '404 NOT FOUND - table:T' },
            ]);
            doc.send.mockRejectedValueOnce('plain-string');
            expect((await make().mreadItem([{ id: 'a' }])).failed).toEqual([{ ID: 'a', error: 'plain-string' }]);
        });

        it('B18 splits more than 100 keys into chunks', async () => {
            const { doc } = stubClients();
            doc.send.mockImplementation(async (cmd: any) => ({ Responses: { T: cmd.input.RequestItems.T.Keys } }));
            const list = Array.from({ length: 101 }, (_, i) => ({ id: `k${i}` }));
            const res = await make().mreadItem(list);
            expect(res.success.length).toBe(101);
            expect(doc.send).toHaveBeenCalledTimes(2);
            expect(sent(doc.send, 1).input.RequestItems.T.Keys).toEqual([{ ID: 'k100' }]);
        });
    });

    describe('msaveItem() (BatchWriteCommand)', () => {
        it('B18 returns early for an empty list', async () => {
            const { doc } = stubClients();
            expect(await make().msaveItem([])).toEqual({ success: [], failed: [], total: 0 });
            expect(await make().msaveItem(undefined)).toEqual({ success: [], failed: [], total: 0 });
            expect(doc.send).not.toHaveBeenCalled();
        });

        it('B18 puts each item and returns them', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValueOnce({});
            const res = await make().msaveItem([
                { id: 'a', v: 1 },
                { id: 'b', v: '' },
            ] as any);
            expect(res).toEqual({
                success: [
                    { ID: 'a', v: 1 },
                    { ID: 'b', v: null },
                ],
                failed: [],
                total: 2,
            });
            expect(sent(doc.send)).toEqual({
                name: 'BatchWriteCommand',
                input: {
                    RequestItems: {
                        T: [
                            { PutRequest: { Item: { ID: 'a', v: 1 } } },
                            { PutRequest: { Item: { ID: 'b', v: null } } },
                        ],
                    },
                },
            });
        });

        it('B18 retries unprocessed items, then marks the rest failed', async () => {
            const { doc } = stubClients();
            const b = { PutRequest: { Item: { ID: 'b', v: 2 } } };
            doc.send
                .mockResolvedValueOnce({ UnprocessedItems: { T: [b, { DeleteRequest: { Key: { ID: 'z' } } }] } })
                .mockResolvedValue({ UnprocessedItems: { T: [b] } });
            const res = await withTimers(() =>
                make().msaveItem([
                    { id: 'a', v: 1 },
                    { id: 'b', v: 2 },
                ] as any),
            );
            expect(res).toEqual({
                success: [{ ID: 'a', v: 1 }],
                failed: [{ ID: 'b', v: 2, error: 'UNPROCESSED after 3 retries' }],
                total: 2,
            });
            expect(doc.send).toHaveBeenCalledTimes(3);
        });

        it('B18 ignores an unprocessed item that is not in the chunk', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValue({ UnprocessedItems: { T: [{ PutRequest: { Item: { ID: 'zz' } } }] } });
            const res = await withTimers(() => make().msaveItem([{ id: 'a' }] as any));
            expect(res).toEqual({ success: [{ ID: 'a' }], failed: [], total: 1 });
        });

        it('B18 maps a batch error onto every item of the chunk', async () => {
            const { doc } = stubClients();
            doc.send.mockRejectedValueOnce(new Error('ResourceNotFoundException'));
            const res = await make().msaveItem([{ id: 'a' }] as any);
            expect(res.failed).toEqual([{ ID: 'a', error: '404 NOT FOUND - table:T' }]);
            doc.send.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'));
            expect((await make().msaveItem([{ id: 'a' }] as any)).failed[0].error).toEqual(
                'ProvisionedThroughputExceeded',
            );
            doc.send.mockRejectedValueOnce(42);
            expect((await make().msaveItem([{ id: 'a' }] as any)).failed[0].error).toEqual('42');
        });

        it('B18 splits more than 25 items into chunks', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValue({});
            const list = Array.from({ length: 26 }, (_, i) => ({ id: `k${i}` }));
            const res = await make().msaveItem(list as any);
            expect(res.success.length).toBe(26);
            expect(doc.send).toHaveBeenCalledTimes(2);
        });
    });

    describe('mupdateItem() (BatchWriteCommand)', () => {
        it('B18 returns early for an empty list', async () => {
            const { doc } = stubClients();
            expect(await make().mupdateItem([])).toEqual({ success: [], failed: [], total: 0 });
            expect(await make().mupdateItem(null)).toEqual({ success: [], failed: [], total: 0 });
            expect(doc.send).not.toHaveBeenCalled();
        });

        it('B18 puts each item, preferring the partition-key field over id', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValueOnce({});
            const res = await make().mupdateItem([{ id: 'a', ID: 'A', v: 1 }, { id: 'b' }] as any);
            //* v5 B18: `prepareSaveItem()` drops `ID` from `rest`, and the item keeps the partition-key value.
            expect(res).toEqual({ success: [{ ID: 'A', v: 1 }, { ID: 'b' }], failed: [], total: 2 });
            expect(sent(doc.send).input).toEqual({
                RequestItems: {
                    T: [{ PutRequest: { Item: { ID: 'A', v: 1 } } }, { PutRequest: { Item: { ID: 'b' } } }],
                },
            });
        });

        it('B18 retries unprocessed items, then marks the rest failed', async () => {
            const { doc } = stubClients();
            doc.send
                .mockResolvedValueOnce({
                    UnprocessedItems: {
                        T: [{ PutRequest: { Item: { ID: 'b' } } }, { DeleteRequest: { Key: { ID: 'z' } } }],
                    },
                })
                .mockResolvedValue({
                    UnprocessedItems: {
                        T: [{ PutRequest: { Item: { ID: 'b' } } }, { PutRequest: { Item: { ID: 'zz' } } }],
                    },
                });
            const res = await withTimers(() => make().mupdateItem([{ id: 'a' }, { id: 'b' }] as any));
            expect(res).toEqual({
                success: [{ ID: 'a' }],
                failed: [{ ID: 'b', error: 'UNPROCESSED after 3 retries' }],
                total: 2,
            });
            expect(doc.send).toHaveBeenCalledTimes(3);
        });

        it('B18 maps a batch error onto every item of the chunk', async () => {
            const { doc } = stubClients();
            doc.send.mockRejectedValueOnce(new Error('ResourceNotFoundException'));
            expect((await make().mupdateItem([{ id: 'a' }] as any)).failed).toEqual([
                { ID: 'a', error: '404 NOT FOUND - table:T' },
            ]);
            doc.send.mockRejectedValueOnce(new Error('InternalServerError'));
            expect((await make().mupdateItem([{ id: 'a' }] as any)).failed[0].error).toEqual('InternalServerError');
            doc.send.mockRejectedValueOnce('oops');
            expect((await make().mupdateItem([{ id: 'a' }] as any)).failed[0].error).toEqual('oops');
        });

        it('B18 splits more than 25 items into chunks', async () => {
            const { doc } = stubClients();
            doc.send.mockResolvedValue({});
            const list = Array.from({ length: 30 }, (_, i) => ({ id: `k${i}` }));
            const res = await make().mupdateItem(list as any);
            expect(res.success.length).toBe(30);
            expect(doc.send).toHaveBeenCalledTimes(2);
        });
    });

    describe('DummyDynamoService', () => {
        const options: DynamoOption = { tableName: 'T', idName: 'ID' };

        it('B18 needs a data file and an array', () => {
            expect(() => new DummyDynamoService<MyModel>('', options)).toThrow('@dataFile(string) is required!');
            const dummy = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', options);
            expect(() => dummy.load(null)).toThrow('@data should be array!');
            expect(() => dummy.load({} as any)).toThrow('@data should be array!');
            expect(dummy.hello()).toEqual('dummy-dynamo-service:T');
        });

        it('B18 mreadItem() reports missing ids (with a sort key)', async () => {
            const dummy = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', { ...options, sortName: 'S' });
            dummy.load([{ ID: 'a', v: 1 } as any]);
            expect(await dummy.mreadItem([])).toEqual({ success: [], failed: [], total: 0 });
            const res = await dummy.mreadItem([
                { id: 'a', sort: 1 },
                { id: 'zz', sort: 2 },
            ]);
            expect(res.success).toEqual([{ ID: 'a', v: 1 }]);
            expect(res.failed).toEqual([{ ID: 'zz', S: 2, error: '404 NOT FOUND' }]);
        });

        it('B18 msaveItem() / mupdateItem() on empty lists', async () => {
            const dummy = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', options);
            expect(await dummy.msaveItem([])).toEqual({ success: [], failed: [], total: 0 });
            expect(await dummy.mupdateItem(null)).toEqual({ success: [], failed: [], total: 0 });
        });

        it('B18 updateItem() type checks for increments', async () => {
            const dummy = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', options);
            dummy.load([{ ID: 'a', n: 'x', l: 1 } as any]);
            await expect(dummy.updateItem('zz', null, {})).rejects.toThrow('404 NOT FOUND - ID:zz');
            await expect(dummy.updateItem('a', null, {}, { n: 1 })).rejects.toThrow('.n (1) should be number!');
            await expect(dummy.updateItem('a', null, {}, { l: [2] } as any)).rejects.toThrow('.l (2) should be array!');
            expect(await dummy.updateItem('a', null, {}, { m: 2, k: [1] } as any)).toEqual({
                ID: 'a',
                n: 'x',
                l: 1,
                m: 2,
                k: [1],
            });
        });
    });
});
