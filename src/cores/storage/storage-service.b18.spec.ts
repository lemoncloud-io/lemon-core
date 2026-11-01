/**
 * `storage-service.b18.spec.ts`
 * - v5 B18: offline unit test of `DynamoStorageService` over a fake `DynamoService` (no DynamoDB),
 *   and the edge branches of the in-memory `DummyStorageService`.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { DynamoStorageService, DummyStorageService } from './storage-service';
import { GETERR } from '../../common/test-helper';

// a fake `DynamoService`: every API is a `vi.fn()`.
const fakeDynamo = () => ({
    readItem: vi.fn(),
    mreadItem: vi.fn(),
    saveItem: vi.fn(),
    updateItem: vi.fn(),
    mupdateItem: vi.fn(),
    deleteItem: vi.fn(),
});

// a storage with the fake dynamo in place (no table is touched).
const dynamoOf = (fields = ['name', 'count', 'tags', 'flag'], idName = 'id') => {
    const svc = new DynamoStorageService<any>('test-table', fields, idName);
    const $dynamo = fakeDynamo();
    //* v5 B18: inject the fake (the real one is built in the constructor and only used via these calls).
    (svc as any).$dynamo = $dynamo;
    return { svc, $dynamo };
};

describe('DynamoStorageService (B18 offline)', () => {
    it('B18 hello() and fields()', () => {
        const { svc } = dynamoOf(['name', 'name', 'id'], 'no');
        expect(svc.fields()).toEqual(['id', 'meta', 'name', 'no', 'stereo', 'type']);
        expect(svc.hello()).toBe('dynamo-storage-service:test-table/no/6');
    });

    it('B18 read() keeps only the fields', async () => {
        const { svc, $dynamo } = dynamoOf();
        $dynamo.readItem.mockResolvedValueOnce({ id: 'A1', name: 'a', other: 'x', count: undefined });
        expect(await svc.read('A1')).toEqual({ id: 'A1', name: 'a' });
        expect($dynamo.readItem).toHaveBeenCalledWith('A1');
    });

    it('B18 mread() maps success and failed', async () => {
        const { svc, $dynamo } = dynamoOf();
        expect(await svc.mread([])).toEqual({ success: [], failed: [], total: 0 });
        expect(await svc.mread(null)).toEqual({ success: [], failed: [], total: 0 });

        $dynamo.mreadItem.mockResolvedValueOnce({
            success: [{ id: 'A1', name: 'a', x: 1 }],
            failed: [{ id: 'A2', error: '404 NOT FOUND' }, { id: 'A3' }],
        });
        expect(await svc.mread(['A1', 'A2', 'A3'])).toEqual({
            success: [{ id: 'A1', name: 'a' }],
            failed: [
                { id: 'A2', error: '404 NOT FOUND' },
                { id: 'A3', error: 'Unknown error' },
            ],
            total: 3,
        });
        expect($dynamo.mreadItem).toHaveBeenCalledWith([{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }]);

        $dynamo.mreadItem.mockResolvedValueOnce({});
        expect(await svc.mread(['A1'])).toEqual({ success: [], failed: [], total: 1 });
    });

    it('B18 save() writes only the fields', async () => {
        const { svc, $dynamo } = dynamoOf(['name'], 'no');
        $dynamo.saveItem.mockResolvedValueOnce({});
        expect(await svc.save('A1', { name: 'a', other: 1, type: 't' })).toEqual({ no: 'A1', name: 'a', type: 't' });
        expect($dynamo.saveItem).toHaveBeenCalledWith('A1', { name: 'a', type: 't' });
    });

    it('B18 update() splits set and increments', async () => {
        const { svc, $dynamo } = dynamoOf();
        $dynamo.updateItem.mockResolvedValue({ id: 'A1', name: 'b', count: 3 });
        expect(await svc.update('A1', { name: 'b', other: 1 }, { count: 1, tags: ['t'] })).toEqual({
            id: 'A1',
            name: 'b',
            count: 3,
        });
        expect($dynamo.updateItem).toHaveBeenCalledWith('A1', undefined, { name: 'b' }, { count: 1, tags: ['t'] });
        await svc.update('A1', { name: 'c' });
        expect($dynamo.updateItem).toHaveBeenLastCalledWith('A1', undefined, { name: 'c' }, null);
        expect(await svc.update('A1', {}, { name: 'x' }).catch(GETERR)).toBe('.name (x) should be number or array!');
    });

    it('B18 readOrCreate() creates on 404 only', async () => {
        const { svc, $dynamo } = dynamoOf();
        $dynamo.readItem.mockRejectedValueOnce(new Error('404 NOT FOUND - id:A1'));
        $dynamo.updateItem.mockResolvedValueOnce({ id: 'A1', name: 'new' });
        expect(await svc.readOrCreate('A1', { name: 'new' })).toEqual({ id: 'A1', name: 'new' });
        $dynamo.readItem.mockResolvedValueOnce({ id: 'A1', name: 'old' });
        expect(await svc.readOrCreate('A1', { name: 'new' })).toEqual({ id: 'A1', name: 'old' });
        $dynamo.readItem.mockRejectedValueOnce(new Error('500 INTERNAL'));
        expect(await svc.readOrCreate('A1', { name: 'new' }).catch(GETERR)).toBe('500 INTERNAL');
    });

    it('B18 mupdate() puts the fields of each item', async () => {
        const { svc, $dynamo } = dynamoOf(['name'], 'no');
        expect(await svc.mupdate([])).toEqual({ success: [], failed: [], total: 0 });
        expect(await svc.mupdate(null)).toEqual({ success: [], failed: [], total: 0 });
        expect(await svc.mupdate([{ name: 'x' }]).catch(GETERR)).toBe('@id is required!');

        $dynamo.mupdateItem.mockResolvedValueOnce({ success: [{ id: 'A1' }], failed: [{ id: 'B1', error: 'e' }] });
        expect(
            await svc.mupdate([
                { no: 'A1', name: 'a', x: 1 },
                { id: 'B1', name: 'b' },
            ]),
        ).toEqual({
            success: [{ id: 'A1' }],
            failed: [{ id: 'B1', error: 'e' }],
            total: 2,
        });
        expect($dynamo.mupdateItem).toHaveBeenCalledWith([
            { id: 'A1', no: 'A1', name: 'a' },
            { id: 'B1', name: 'b' },
        ]);
        $dynamo.mupdateItem.mockResolvedValueOnce({});
        expect(await svc.mupdate([{ no: 7 }])).toEqual({ success: [], failed: [], total: 1 });
    });

    it('B18 increment() checks types against the current item', async () => {
        const { svc, $dynamo } = dynamoOf();
        expect(await svc.increment('A1', null, null).catch(GETERR)).toBe('@item is required!');

        //* not found: base `{ id }`; numbers/arrays increment, strings set; `$update` set.
        $dynamo.readItem.mockRejectedValueOnce(new Error('404 NOT FOUND - id:A1'));
        $dynamo.updateItem.mockResolvedValueOnce({ id: 'A1', count: 1 });
        expect(await svc.increment('A1', { count: 1, tags: ['t'], name: 'n' }, { flag: 'y' })).toEqual({
            id: 'A1',
            count: 1,
        });
        expect($dynamo.updateItem).toHaveBeenLastCalledWith(
            'A1',
            undefined,
            { name: 'n', flag: 'y' },
            { count: 1, tags: ['t'] },
        );

        //* other read errors are thrown.
        $dynamo.readItem.mockRejectedValueOnce(new Error('500 INTERNAL'));
        expect(await svc.increment('A1', { count: 1 }).catch(GETERR)).toBe('500 INTERNAL');

        //* type mismatch: table of current value + delta → error.
        const table: Array<[any, any, string]> = [
            [{ count: 1 }, { count: 'x' }, '.count (x) should be number!'],
            [{ name: 'a' }, { name: 1 }, '.name (1) should be string!'],
            [{ name: 'a' }, { name: ['b'] }, '.name (b) should be string!'],
            [{ tags: ['a'] }, { tags: 1 }, '.tags (1) should be array!'],
            [{ flag: true }, { flag: 1 }, '.flag (1) should be number!'],
            [{ flag: true }, { flag: ['x'] }, '.flag (x) should be array!'],
        ];
        for (const [org, model, expected] of table) {
            $dynamo.readItem.mockResolvedValueOnce({ id: 'A1', ...org });
            expect(await svc.increment('A1', model).catch(GETERR)).toBe(expected);
        }

        //* only `$update`.
        $dynamo.readItem.mockResolvedValueOnce({ id: 'A1' });
        $dynamo.updateItem.mockResolvedValueOnce({ id: 'A1', name: 'z' });
        await svc.increment('A1', {}, { name: 'z' });
        expect($dynamo.updateItem).toHaveBeenLastCalledWith('A1', undefined, { name: 'z' }, {});
    });

    it('B18 delete() returns the item read before', async () => {
        const { svc, $dynamo } = dynamoOf();
        $dynamo.readItem.mockResolvedValueOnce({ id: 'A1', name: 'a' });
        $dynamo.deleteItem.mockResolvedValueOnce({});
        expect(await svc.delete('A1')).toEqual({ id: 'A1', name: 'a' });
        expect($dynamo.deleteItem).toHaveBeenCalledWith('A1');
    });
});

describe('DummyStorageService (B18 edges)', () => {
    // a dummy storage over the shared test data file.
    const dummyOf = (fields?: string[]) => new DummyStorageService<any>('ticketing-dummy-data', 'b18', 'id', fields);

    it('B18 constructor and load() validate input', () => {
        expect(() => new DummyStorageService('')).toThrow('@dataFile(string) is required!');
        expect(() => dummyOf().load(null)).toThrow('@data should be array!');
        expect(dummyOf(['name']).hello()).toBe('dummy-storage-service:b18/id/5');
    });

    it('B18 save() and update() validate id and item', async () => {
        const $s = dummyOf();
        expect(await $s.save('', {}).catch(GETERR)).toBe('@id is required!');
        expect(await $s.save(' ', {}).catch(GETERR)).toBe('@id (string) is required!');
        expect(await $s.save('X1', null).catch(GETERR)).toBe('@item is required!');
        expect(await $s.update('', {}).catch(GETERR)).toBe('@id is required!');
        expect(await $s.update(' ', {}).catch(GETERR)).toBe('@id (string) is required!');
        expect(await $s.update('X1', null).catch(GETERR)).toBe('@item is required!');
        expect(await $s.mupdate([{ id: ' ' }]).catch(GETERR)).toBe('@id (string) is required!');
        expect(await $s.mupdate([{ name: 'x' }]).catch(GETERR)).toBe('@id is required!');
    });

    it('B18 update() add-type checks on the current value', async () => {
        const $s = dummyOf();
        await $s.save('X1', { id: 'X1', name: 'a', count: 1 });
        expect(await $s.update('X1', {}, { name: ['b'] }).catch(GETERR)).toBe('.name (b) should be array!');
        expect(await $s.update('X1', {}, { name: 1 }).catch(GETERR)).toBe('.name (1) should be number!');
    });

    it('B18 update() and increment() keep `.lock` atomic', async () => {
        const $s = dummyOf();
        //* `item.lock` sets, `$inc.lock` adds to the last lock.
        expect(await $s.update('L1', { lock: 2 })).toEqual({ id: 'L1', lock: 2 });
        expect(await $s.update('L1', {}, { lock: 3 })).toEqual({ id: 'L1', lock: 5 });
        expect(await $s.increment('L1', { lock: 1 })).toEqual({ id: 'L1', lock: 6 });
        expect(await $s.increment('L1', {}, { lock: 10 })).toEqual({ id: 'L1', lock: 10 });
        expect((await $s.read('L1')).lock).toBe(10);
        //* `mupdate()` also sets the lock.
        await $s.mupdate([{ id: 'L1', lock: 20 }]);
        expect(await $s.increment('L1', { lock: 1 })).toEqual({ id: 'L1', lock: 21 });
    });

    it('B18 a failed queued update does not block the next one', async () => {
        const $s = dummyOf();
        //* v5 B18: both calls queue on the same id; the first one rejects inside the lock.
        const [r1, r2] = await Promise.all([
            $s.update('Q1', {}, { n: 'x' }).catch(GETERR),
            $s.update('Q1', { name: 'ok' }),
        ]);
        expect(r1).toBe('.n (x) should be number or array!');
        expect(r2).toEqual({ id: 'Q1', name: 'ok' });
    });

    it('B18 non-404 read errors are thrown', async () => {
        const $s = dummyOf();
        const read = vi.spyOn($s, 'read').mockRejectedValue(new Error('500 INTERNAL'));
        expect(await $s.readOrCreate('A00001', {}).catch(GETERR)).toBe('500 INTERNAL');
        expect(await $s.update('A00001', { name: 'x' }).catch(GETERR)).toBe('500 INTERNAL');
        read.mockRestore();
    });
});
