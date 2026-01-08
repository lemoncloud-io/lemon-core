/**
 * `storage-service.spec.js`
 * - unit test for `storage-service`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-26 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { GETERR, expect2 } from '../../common/test-helper';
import { DynamoStorageService, DummyStorageService, StorageModel } from './storage-service';
import { HttpStorageService } from './http-storage-service';

interface AccountModel extends StorageModel {
    slot?: number;
    balance?: number;
    name?: string;
    no?: string; // for DynamoStorageService with 'no' as idName
}

//! main test body.
describe('StorageService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    // Track test data for cleanup
    const testDataIds = new Set<string>();

    //* dummy storage service - mread tests
    it('should pass dummy storage-service mread operations', async () => {
        //* load dummy storage service
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* mread test
        // 1. validate ids parameter test
        // - null ids
        const nullResult = await $account.mread(null as any);
        expect2(nullResult).toEqual({ success: [], failed: [], total: 0 });

        // - undefined ids
        const undefinedResult = await $account.mread(undefined as any);
        expect2(undefinedResult).toEqual({ success: [], failed: [], total: 0 });

        // - empty array
        const emptyResult = await $account.mread([]);
        expect2(emptyResult).toEqual({ success: [], failed: [], total: 0 });

        // 2. match error cases
        // - invalid id (empty string) in array
        expect2(await $account.mread(['', 'A00000']).catch(GETERR)).toEqual('@id (string) is required!');

        // - invalid id (whitespace only) in array
        expect2(await $account.mread(['  ', 'A00000']).catch(GETERR)).toEqual('@id (string) is required!');

        // 3. success cases
        // - setup test data
        await $account.save('M00001', { type: 'account', name: 'user1', balance: 100 });
        await $account.save('M00002', { type: 'account', name: 'user2', balance: 200 });
        await $account.save('M00003', { type: 'account', name: 'user3', balance: 300 });

        // - read single existing id
        const single = await $account.mread(['M00001']);
        expect2(single.total).toEqual(1);
        expect2(single.success.length).toEqual(1);
        expect2(single.failed.length).toEqual(0);
        expect2(() => single.success[0], 'id,name,balance').toEqual({ id: 'M00001', name: 'user1', balance: 100 });

        // - read multiple existing ids
        const multiple = await $account.mread(['M00001', 'M00002', 'M00003']);
        expect2(multiple.total).toEqual(3);
        expect2(multiple.success.length).toEqual(3);
        expect2(multiple.failed.length).toEqual(0);
        expect2(() => multiple.success[0], 'id,name').toEqual({ id: 'M00001', name: 'user1' });
        expect2(() => multiple.success[1], 'id,name').toEqual({ id: 'M00002', name: 'user2' });
        expect2(() => multiple.success[2], 'id,name').toEqual({ id: 'M00003', name: 'user3' });

        // - read mixed (existing and non-existing ids)
        const mixed = await $account.mread(['M00001', 'NOTFOUND1', 'M00002', 'NOTFOUND2']);
        expect2(mixed.total).toEqual(4);
        expect2(mixed.success.length).toEqual(2);
        expect2(mixed.failed.length).toEqual(2);
        expect2(() => mixed.success[0], 'id,name').toEqual({ id: 'M00001', name: 'user1' });
        expect2(() => mixed.success[1], 'id,name').toEqual({ id: 'M00002', name: 'user2' });
        expect2(() => mixed.failed[0], 'id').toEqual({ id: 'NOTFOUND1' });
        expect2(() => mixed.failed[1], 'id').toEqual({ id: 'NOTFOUND2' });

        // - read all non-existing ids
        const allFailed = await $account.mread(['NOTFOUND1', 'NOTFOUND2', 'NOTFOUND3']);
        expect2(allFailed.total).toEqual(3);
        expect2(allFailed.success.length).toEqual(0);
        expect2(allFailed.failed.length).toEqual(3);

        // - cleanup
        await $account.delete('M00001');
        await $account.delete('M00002');
        await $account.delete('M00003');
    });

    //* dummy storage service - mupdate tests
    it('should pass dummy storage-service mupdate operations', async () => {
        //* load dummy storage service
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* mupdate test
        // 1. validate list parameter test
        // - null list
        const nullResult = await $account.mupdate(null as any);
        expect2(nullResult).toEqual({ success: [], failed: [], total: 0 });

        // - undefined list
        const undefinedResult = await $account.mupdate(undefined as any);
        expect2(undefinedResult).toEqual({ success: [], failed: [], total: 0 });

        // - empty array
        const emptyResult = await $account.mupdate([]);
        expect2(emptyResult).toEqual({ success: [], failed: [], total: 0 });

        // 2. match error cases
        // - missing id in item
        expect2(await $account.mupdate([{ type: 'account', name: 'test' } as any]).catch(GETERR)).toEqual(
            '@id is required!',
        );

        // - item without id field
        expect2(
            await $account.mupdate([{ type: 'account', balance: 100 }, { type: 'account' }] as any).catch(GETERR),
        ).toEqual('@id is required!');

        // 3. success cases
        // - update single item (create new)
        const single = await $account.mupdate([{ id: 'U00001', type: 'account', name: 'test1', balance: 100 }]);
        expect2(single.total).toEqual(1);
        expect2(single.success.length).toEqual(1);
        expect2(single.failed.length).toEqual(0);
        expect2(() => single.success[0], 'id,name,balance').toEqual({ id: 'U00001', name: 'test1', balance: 100 });

        // - verify saved
        const verified1 = await $account.read('U00001');
        expect2(() => verified1, 'id,name,balance').toEqual({ id: 'U00001', name: 'test1', balance: 100 });

        // - update multiple items
        const multiple = await $account.mupdate([
            { id: 'U00002', type: 'account', name: 'test2', balance: 200 },
            { id: 'U00003', type: 'account', name: 'test3', balance: 300 },
            { id: 'U00004', type: 'account', name: 'test4', balance: 400 },
        ]);
        expect2(multiple.total).toEqual(3);
        expect2(multiple.success.length).toEqual(3);
        expect2(multiple.failed.length).toEqual(0);
        expect2(() => multiple.success[0], 'id,name').toEqual({ id: 'U00002', name: 'test2' });
        expect2(() => multiple.success[1], 'id,name').toEqual({ id: 'U00003', name: 'test3' });
        expect2(() => multiple.success[2], 'id,name').toEqual({ id: 'U00004', name: 'test4' });

        // - update existing items (modify)
        const updated = await $account.mupdate([
            { id: 'U00001', name: 'updated1', balance: 150 },
            { id: 'U00002', name: 'updated2', balance: 250 },
        ]);
        expect2(updated.total).toEqual(2);
        expect2(updated.success.length).toEqual(2);
        expect2(() => updated.success[0], 'id,name,balance').toEqual({ id: 'U00001', name: 'updated1', balance: 150 });
        expect2(() => updated.success[1], 'id,name,balance').toEqual({ id: 'U00002', name: 'updated2', balance: 250 });

        // - verify updates
        const verified2 = await $account.read('U00001');
        expect2(() => verified2, 'id,name,balance').toEqual({ id: 'U00001', name: 'updated1', balance: 150 });

        const verified3 = await $account.read('U00002');
        expect2(() => verified3, 'id,name,balance').toEqual({ id: 'U00002', name: 'updated2', balance: 250 });

        // - cleanup
        await $account.delete('U00001');
        await $account.delete('U00002');
        await $account.delete('U00003');
        await $account.delete('U00004');
    });

    //* LAYER EQUIVALENCE: batch vs legacy methods for DummyStorageService
    it('should have equivalent results for read/mread and update/mupdate in dummy storage', async () => {
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* test of mread vs read
        const readItems = [
            { id: 'equiv-read-1', type: 'equiv-test', name: 'Equiv Read 1', balance: 100 },
            { id: 'equiv-read-2', type: 'equiv-test', name: 'Equiv Read 2', balance: 200 },
            { id: 'equiv-read-3', type: 'equiv-test', name: 'Equiv Read 3', balance: 300 },
        ];

        // Setup test data
        await $account.save('equiv-read-1', readItems[0] as AccountModel);
        await $account.save('equiv-read-2', readItems[1] as AccountModel);
        await $account.save('equiv-read-3', readItems[2] as AccountModel);

        // Legacy: multiple read calls
        const dummyLegacy1 = await $account.read('equiv-read-1');
        const dummyLegacy2 = await $account.read('equiv-read-2');
        const dummyLegacy3 = await $account.read('equiv-read-3');

        // Batch: single mread call
        const dummyBatchRead = await $account.mread(['equiv-read-1', 'equiv-read-2', 'equiv-read-3']);

        // Verify equivalence
        expect2(() => dummyBatchRead.success.length).toEqual(3);
        expect2(() => dummyBatchRead.success[0]).toEqual(dummyLegacy1);
        expect2(() => dummyBatchRead.success[1]).toEqual(dummyLegacy2);
        expect2(() => dummyBatchRead.success[2]).toEqual(dummyLegacy3);

        //* test of mupdate vs update
        const initialItems = [
            { id: 'equiv-update-1', type: 'equiv-test', name: 'Initial 1', balance: 100 },
            { id: 'equiv-update-2', type: 'equiv-test', name: 'Initial 2', balance: 200 },
            { id: 'equiv-update-3', type: 'equiv-test', name: 'Initial 3', balance: 300 },
        ];

        // Setup test data
        await $account.save('equiv-update-1', initialItems[0] as AccountModel);
        await $account.save('equiv-update-2', initialItems[1] as AccountModel);
        await $account.save('equiv-update-3', initialItems[2] as AccountModel);

        // Legacy: multiple update calls
        const dummyLegacyUpdate1 = await $account.update('equiv-update-1', { type: 'equiv-updated', name: 'Updated 1', balance: 200 });
        const dummyLegacyUpdate2 = await $account.update('equiv-update-2', { type: 'equiv-updated', name: 'Updated 2', balance: 400 });
        const dummyLegacyUpdate3 = await $account.update('equiv-update-3', { type: 'equiv-updated', name: 'Updated 3', balance: 600 });

        // Reset data for batch test
        await $account.save('equiv-update-1', initialItems[0] as AccountModel);
        await $account.save('equiv-update-2', initialItems[1] as AccountModel);
        await $account.save('equiv-update-3', initialItems[2] as AccountModel);

        // Batch: single mupdate call
        const updateItems = [
            { id: 'equiv-update-1', type: 'equiv-updated', name: 'Updated 1', balance: 200 },
            { id: 'equiv-update-2', type: 'equiv-updated', name: 'Updated 2', balance: 400 },
            { id: 'equiv-update-3', type: 'equiv-updated', name: 'Updated 3', balance: 600 },
        ];
        const dummyBatchUpdate = await $account.mupdate(updateItems as AccountModel[]);

        // Verify equivalence
        expect2(() => dummyBatchUpdate.success.length).toEqual(3);
        expect2(() => dummyBatchUpdate.success[0]).toEqual(dummyLegacyUpdate1);
        expect2(() => dummyBatchUpdate.success[1]).toEqual(dummyLegacyUpdate2);
        expect2(() => dummyBatchUpdate.success[2]).toEqual(dummyLegacyUpdate3);

        // Cleanup
        await $account.delete('equiv-read-1');
        await $account.delete('equiv-read-2');
        await $account.delete('equiv-read-3');
        await $account.delete('equiv-update-1');
        await $account.delete('equiv-update-2');
        await $account.delete('equiv-update-3');

        // Verify items are deleted
        expect2(await $account.read('equiv-read-1').catch(GETERR)).toEqual('404 NOT FOUND - id:equiv-read-1');
        expect2(await $account.read('equiv-read-2').catch(GETERR)).toEqual('404 NOT FOUND - id:equiv-read-2');
        expect2(await $account.read('equiv-read-3').catch(GETERR)).toEqual('404 NOT FOUND - id:equiv-read-3');
        expect2(await $account.read('equiv-update-1').catch(GETERR)).toEqual('404 NOT FOUND - id:equiv-update-1');
        expect2(await $account.read('equiv-update-2').catch(GETERR)).toEqual('404 NOT FOUND - id:equiv-update-2');
        expect2(await $account.read('equiv-update-3').catch(GETERR)).toEqual('404 NOT FOUND - id:equiv-update-3');
    });

    //* dummy storage service.
    it('should pass dummy storage-service', async () => {
        //* load dummy storage service.
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;
        expect2(() => $account.hello()).toEqual('dummy-storage-service:memory/id');

        expect(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'account' });
        expect(await $account.save('A00000', { type: 'account', name: 'ho' })).toEqual({
            id: 'A00000',
            type: 'account',
            name: 'ho',
        });
        expect(await $account.update('A00000', { stereo: 'lemon' })).toEqual({ id: 'A00000', stereo: 'lemon' });
        expect(await $account.increment('A00000', { slot: 1 })).toEqual({ id: 'A00000', slot: 1 });
        expect(await $account.increment('A00000', { slot: -2 })).toEqual({ id: 'A00000', slot: -1 });
        expect(await $account.increment('A00000', { slot: null }).catch(GETERR)).toEqual(
            '.slot (null) should be number!',
        );
        expect(await $account.increment('A00000', { stereo: null }).catch(GETERR)).toEqual({
            id: 'A00000',
            stereo: null,
        });
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        // it should make new entry.
        expect(await $account.update('A00000', { type: 'test', balance: 1 })).toEqual({
            id: 'A00000',
            type: 'test',
            balance: 1,
        });
        expect(await $account.update('A00000', { balance: 22 })).toEqual({ id: 'A00000', balance: 22 }); //* it should update
        expect(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'test', balance: 22 }); //* it should have latest value.
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        //* it should make new entry also.
        expect(await $account.increment('A00000', { type: 'test', slot: 1 })).toEqual({
            id: 'A00000',
            type: 'test',
            slot: 1,
        });
        //* it should return last slot#
        expect(await $account.increment('A00000', { type: 'test', slot: 0 })).toEqual({
            id: 'A00000',
            type: 'test',
            slot: 1,
        });
        expect(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'test', slot: 1 }); //* it should return last slot#

        //* increment w/ $update
        expect2(await $account.increment('A00000', { slot: 0 }, { balance: 1000 })).toEqual({
            id: 'A00000',
            slot: 1,
            balance: 1000,
        });
        expect2(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'test', slot: 1, balance: 1000 });

        //* update with increments
        expect2(await $account.update('A00000', {}, { balance: 100 })).toEqual({ id: 'A00000', balance: 1100 });
        expect2(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'test', slot: 1, balance: 1100 });
        expect2(await $account.update('A00000', { slot: 2 }, { balance: -500 })).toEqual({
            id: 'A00000',
            slot: 2,
            balance: 600,
        });
        expect2(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'test', slot: 2, balance: 600 });

        //* check delete()
        expect2(await $account.delete('A00000'), 'id').toEqual({ id: 'A00000' });
        expect2(await $account.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - id:A00000');
        //* it should create with model.
        expect2(await $account.readOrCreate('A00000', { type: 'auto', slot: 2 })).toEqual({
            id: 'A00000',
            type: 'auto',
            slot: 2,
        });

        //* error cases.
        expect2(() => $account.increment('', { type: 'test', slot: 1 })).toEqual('@id is required!');
        expect2(() => $account.increment(' ', { type: 'test', slot: 1 })).toEqual('@id (string) is required!');
        expect2(() => $account.increment('B00001', null)).toEqual('@item is required!');
        expect2(await $account.increment('B00001', { type: 'test', slot: 1 })).toEqual({
            id: 'B00001',
            type: 'test',
            slot: 1,
        });
    });

    //* dummy storage service.
    it('should pass dummy storage-service w/ _id', async () => {
        //* load dummy storage service.
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory2', '_id');
        const $account = $storage as DummyStorageService<AccountModel>;
        expect2(() => $account.hello()).toEqual('dummy-storage-service:memory2/_id');

        expect(await $account.read('A00000')).toEqual({ _id: 'A00000', id: 'A00000', type: 'account' });
        expect(await $account.save('A00000', { type: 'account', name: 'ho' })).toEqual({
            _id: 'A00000',
            type: 'account',
            name: 'ho',
        });
        expect(await $account.update('A00000', { stereo: 'lemon' })).toEqual({ _id: 'A00000', stereo: 'lemon' });
        expect(await $account.increment('A00000', { slot: 1 })).toEqual({ _id: 'A00000', slot: 1 });
        expect(await $account.increment('A00000', { slot: -2 })).toEqual({ _id: 'A00000', slot: -1 });
        expect(await $account.increment('A00000', { slot: null }).catch(GETERR)).toEqual(
            '.slot (null) should be number!',
        );
        expect(await $account.increment('A00000', { stereo: null }).catch(GETERR)).toEqual({
            _id: 'A00000',
            stereo: null,
        });
        expect((await $account.delete('A00000'))._id).toEqual('A00000');
        expect(await $account.update('A00000', { type: 'test', balance: 1 })).toEqual({
            _id: 'A00000',
            type: 'test',
            balance: 1,
        }); // it should make new entry.
        expect(await $account.update('A00000', { balance: 22 })).toEqual({ _id: 'A00000', balance: 22 }); //* it should update
        expect(await $account.read('A00000')).toEqual({ _id: 'A00000', type: 'test', balance: 22 }); //* it should have latest value.
        expect((await $account.delete('A00000'))._id).toEqual('A00000');
        //* it should make new entry also.
        expect(await $account.increment('A00000', { type: 'test', slot: 1 })).toEqual({
            _id: 'A00000',
            type: 'test',
            slot: 1,
        });
        //* it should return last slot#
        expect(await $account.increment('A00000', { type: 'test', slot: 0 })).toEqual({
            _id: 'A00000',
            type: 'test',
            slot: 1,
        });
        expect(await $account.read('A00000')).toEqual({ _id: 'A00000', type: 'test', slot: 1 }); //* it should return last slot#

        //* increment w/ $update
        expect2(await $account.increment('A00000', { slot: 0 }, { balance: 1000 })).toEqual({
            _id: 'A00000',
            slot: 1,
            balance: 1000,
        });
        expect2(await $account.read('A00000')).toEqual({ _id: 'A00000', type: 'test', slot: 1, balance: 1000 });

        //* update with increments
        expect2(await $account.update('A00000', {}, { balance: 100 })).toEqual({ _id: 'A00000', balance: 1100 });
        expect2(await $account.read('A00000')).toEqual({ _id: 'A00000', type: 'test', slot: 1, balance: 1100 });
        expect2(await $account.update('A00000', { slot: 2 }, { balance: -500 })).toEqual({
            _id: 'A00000',
            slot: 2,
            balance: 600,
        });
        expect2(await $account.read('A00000')).toEqual({ _id: 'A00000', type: 'test', slot: 2, balance: 600 });

        //* check delete()
        expect2(await $account.delete('A00000'), '_id').toEqual({ _id: 'A00000' });
        expect2(await $account.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - _id:A00000');
        //* it should create with model.
        expect2(await $account.readOrCreate('A00000', { type: 'auto', slot: 2 })).toEqual({
            _id: 'A00000',
            type: 'auto',
            slot: 2,
        });

        //* error cases.
        expect2(() => $account.increment('', { type: 'test', slot: 1 })).toEqual('@id is required!');
        expect2(() => $account.increment(' ', { type: 'test', slot: 1 })).toEqual('@id (string) is required!');
        expect2(() => $account.increment('B00001', null)).toEqual('@item is required!');
        expect2(await $account.increment('B00001', { type: 'test', slot: 1 })).toEqual({
            _id: 'B00001',
            type: 'test',
            slot: 1,
        });
    });

    //* dynamo storage service - mread tests
    it('should pass dynamo storage-service mread operations', async () => {
        //* load dynamo storage service
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'no');

        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        //* mread test
        // 1. validate ids parameter test
        // - null ids
        const nullResult = await $dynamo.mread(null as any);
        expect2(nullResult).toEqual({ success: [], failed: [], total: 0 });

        // - undefined ids
        const undefinedResult = await $dynamo.mread(undefined as any);
        expect2(undefinedResult).toEqual({ success: [], failed: [], total: 0 });

        // - empty array
        const emptyResult = await $dynamo.mread([]);
        expect2(emptyResult).toEqual({ success: [], failed: [], total: 0 });

        // 2. success cases
        // - setup test data
        await $dynamo.save('DM00001', { type: 'account', name: 'user1', balance: 100 });
        testDataIds.add('DM00001');
        await $dynamo.save('DM00002', { type: 'account', name: 'user2', balance: 200 });
        testDataIds.add('DM00002');
        await $dynamo.save('DM00003', { type: 'account', name: 'user3', balance: 300 });
        testDataIds.add('DM00003');

        // - read single existing id
        const single = await $dynamo.mread(['DM00001']);
        expect2(single.total).toEqual(1);
        expect2(single.success.length).toEqual(1);
        expect2(single.failed.length).toEqual(0);
        expect2(() => single.success[0], 'no,name,balance').toEqual({ no: 'DM00001', name: 'user1', balance: 100 });

        // - read multiple existing ids
        const multiple = await $dynamo.mread(['DM00001', 'DM00002', 'DM00003']);
        expect2(multiple.total).toEqual(3);
        expect2(multiple.success.length).toEqual(3);
        expect2(multiple.failed.length).toEqual(0);
        expect2(() => multiple.success[0], 'no,name').toEqual({ no: 'DM00001', name: 'user1' });
        expect2(() => multiple.success[1], 'no,name').toEqual({ no: 'DM00002', name: 'user2' });
        expect2(() => multiple.success[2], 'no,name').toEqual({ no: 'DM00003', name: 'user3' });

        // - read mixed (existing and non-existing ids)
        const mixed = await $dynamo.mread(['DM00001', 'NOTFOUND1', 'DM00002', 'NOTFOUND2']);
        expect2(mixed.total).toEqual(4);
        expect2(mixed.success.length).toEqual(2);
        expect2(mixed.failed.length).toEqual(2);
        expect2(() => mixed.success[0], 'no,name').toEqual({ no: 'DM00001', name: 'user1' });
        expect2(() => mixed.success[1], 'no,name').toEqual({ no: 'DM00002', name: 'user2' });
        expect2(() => mixed.failed[0], 'no').toEqual({ no: 'NOTFOUND1' });
        expect2(() => mixed.failed[1], 'no').toEqual({ no: 'NOTFOUND2' });

        // - read all non-existing ids
        const allFailed = await $dynamo.mread(['NOTFOUND1', 'NOTFOUND2', 'NOTFOUND3']);
        expect2(allFailed.total).toEqual(3);
        expect2(allFailed.success.length).toEqual(0);
        expect2(allFailed.failed.length).toEqual(3);
    });

    //* dynamo storage service - mupdate tests
    it('should pass dynamo storage-service mupdate operations', async () => {
        //* load dynamo storage service
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'no');

        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        //* mupdate test
        // 1. validate list parameter test
        // - null list
        const nullResult = await $dynamo.mupdate(null as any);
        expect2(nullResult).toEqual({ success: [], failed: [], total: 0 });

        // - undefined list
        const undefinedResult = await $dynamo.mupdate(undefined as any);
        expect2(undefinedResult).toEqual({ success: [], failed: [], total: 0 });

        // - empty array
        const emptyResult = await $dynamo.mupdate([]);
        expect2(emptyResult).toEqual({ success: [], failed: [], total: 0 });

        // 2. match error cases
        // - missing id in item (using 'no' as idName)
        expect2(await $dynamo.mupdate([{ type: 'account', name: 'test' } as any]).catch(GETERR)).toEqual(
            '@id is required!',
        );

        // - item without id field
        expect2(
            await $dynamo.mupdate([{ type: 'account', balance: 100 }, { type: 'account' }] as any).catch(GETERR),
        ).toEqual('@id is required!');

        // 3. success cases
        // - update single item (create new)
        const single = await $dynamo.mupdate([{ no: 'DU00001', type: 'account', name: 'test1', balance: 100 } as any]);
        testDataIds.add('DU00001');
        expect2(single.total).toEqual(1);
        expect2(single.success.length).toEqual(1);
        expect2(single.failed.length).toEqual(0);
        expect2(() => single.success[0], 'no,name,balance').toEqual({ no: 'DU00001', name: 'test1', balance: 100 });

        // - verify saved
        const verified1 = await $dynamo.read('DU00001');
        expect2(() => verified1, 'no,name,balance').toEqual({ no: 'DU00001', name: 'test1', balance: 100 });

        // - update multiple items
        const multiple = await $dynamo.mupdate([
            { no: 'DU00002', type: 'account', name: 'test2', balance: 200 } as any,
            { no: 'DU00003', type: 'account', name: 'test3', balance: 300 } as any,
            { no: 'DU00004', type: 'account', name: 'test4', balance: 400 } as any,
        ]);
        testDataIds.add('DU00002');
        testDataIds.add('DU00003');
        testDataIds.add('DU00004');
        expect2(multiple.total).toEqual(3);
        expect2(multiple.success.length).toEqual(3);
        expect2(multiple.failed.length).toEqual(0);
        expect2(() => multiple.success[0], 'no,name').toEqual({ no: 'DU00002', name: 'test2' });
        expect2(() => multiple.success[1], 'no,name').toEqual({ no: 'DU00003', name: 'test3' });
        expect2(() => multiple.success[2], 'no,name').toEqual({ no: 'DU00004', name: 'test4' });

        // - update existing items (modify)
        const updated = await $dynamo.mupdate([
            { no: 'DU00001', name: 'updated1', balance: 150 } as any,
            { no: 'DU00002', name: 'updated2', balance: 250 } as any,
        ]);
        expect2(updated.total).toEqual(2);
        expect2(updated.success.length).toEqual(2);
        expect2(() => updated.success[0], 'no,name,balance').toEqual({ no: 'DU00001', name: 'updated1', balance: 150 });
        expect2(() => updated.success[1], 'no,name,balance').toEqual({ no: 'DU00002', name: 'updated2', balance: 250 });

        // - verify updates
        const verified2 = await $dynamo.read('DU00001');
        expect2(() => verified2, 'no,name,balance').toEqual({ no: 'DU00001', name: 'updated1', balance: 150 });

        const verified3 = await $dynamo.read('DU00002');
        expect2(() => verified3, 'no,name,balance').toEqual({ no: 'DU00002', name: 'updated2', balance: 250 });
    });

    //* LAYER EQUIVALENCE: batch vs legacy methods for DynamoStorageService
    it('should have equivalent results for read/mread and update/mupdate in dynamo storage', async () => {
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'no');

        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        //* test of mread vs read
        const readItems = [
            { no: 'dynamo-equiv-read-1', type: 'equiv-test', name: 'Dynamo Equiv Read 1', balance: 100 },
            { no: 'dynamo-equiv-read-2', type: 'equiv-test', name: 'Dynamo Equiv Read 2', balance: 200 },
            { no: 'dynamo-equiv-read-3', type: 'equiv-test', name: 'Dynamo Equiv Read 3', balance: 300 },
        ];

        // Setup test data
        await $dynamo.save('dynamo-equiv-read-1', readItems[0] as any);
        testDataIds.add('dynamo-equiv-read-1');
        await $dynamo.save('dynamo-equiv-read-2', readItems[1] as any);
        testDataIds.add('dynamo-equiv-read-2');
        await $dynamo.save('dynamo-equiv-read-3', readItems[2] as any);
        testDataIds.add('dynamo-equiv-read-3');

        // Legacy: multiple read calls
        const dynamoLegacy1 = await $dynamo.read('dynamo-equiv-read-1');
        const dynamoLegacy2 = await $dynamo.read('dynamo-equiv-read-2');
        const dynamoLegacy3 = await $dynamo.read('dynamo-equiv-read-3');

        // Batch: single mread call
        const dynamoBatchRead = await $dynamo.mread(['dynamo-equiv-read-1', 'dynamo-equiv-read-2', 'dynamo-equiv-read-3']);

        // Verify equivalence
        expect2(() => dynamoBatchRead.success.length).toEqual(3);
        expect2(() => dynamoBatchRead.success[0]).toEqual(dynamoLegacy1);
        expect2(() => dynamoBatchRead.success[1]).toEqual(dynamoLegacy2);
        expect2(() => dynamoBatchRead.success[2]).toEqual(dynamoLegacy3);

        //* test of mupdate vs update
        const initialItems = [
            { no: 'dynamo-equiv-update-1', type: 'equiv-test', name: 'Initial 1', balance: 100 },
            { no: 'dynamo-equiv-update-2', type: 'equiv-test', name: 'Initial 2', balance: 200 },
            { no: 'dynamo-equiv-update-3', type: 'equiv-test', name: 'Initial 3', balance: 300 },
        ];

        // Setup test data
        await $dynamo.save('dynamo-equiv-update-1', initialItems[0] as any);
        testDataIds.add('dynamo-equiv-update-1');
        await $dynamo.save('dynamo-equiv-update-2', initialItems[1] as any);
        testDataIds.add('dynamo-equiv-update-2');
        await $dynamo.save('dynamo-equiv-update-3', initialItems[2] as any);
        testDataIds.add('dynamo-equiv-update-3');

        // Legacy: multiple update calls
        const dynamoLegacyUpdate1 = await $dynamo.update('dynamo-equiv-update-1', { type: 'equiv-updated', name: 'Updated 1', balance: 200 });
        const dynamoLegacyUpdate2 = await $dynamo.update('dynamo-equiv-update-2', { type: 'equiv-updated', name: 'Updated 2', balance: 400 });
        const dynamoLegacyUpdate3 = await $dynamo.update('dynamo-equiv-update-3', { type: 'equiv-updated', name: 'Updated 3', balance: 600 });

        // Reset data for batch test
        await $dynamo.save('dynamo-equiv-update-1', initialItems[0] as any);
        await $dynamo.save('dynamo-equiv-update-2', initialItems[1] as any);
        await $dynamo.save('dynamo-equiv-update-3', initialItems[2] as any);

        // Batch: single mupdate call
        const updateItems = [
            { no: 'dynamo-equiv-update-1', type: 'equiv-updated', name: 'Updated 1', balance: 200 },
            { no: 'dynamo-equiv-update-2', type: 'equiv-updated', name: 'Updated 2', balance: 400 },
            { no: 'dynamo-equiv-update-3', type: 'equiv-updated', name: 'Updated 3', balance: 600 },
        ];
        const dynamoBatchUpdate = await $dynamo.mupdate(updateItems as any[]);

        // Verify equivalence
        expect2(() => dynamoBatchUpdate.success.length).toEqual(3);
        expect2(() => dynamoBatchUpdate.success[0]).toEqual(dynamoLegacyUpdate1);
        expect2(() => dynamoBatchUpdate.success[1]).toEqual(dynamoLegacyUpdate2);
        expect2(() => dynamoBatchUpdate.success[2]).toEqual(dynamoLegacyUpdate3);

        // Cleanup and verify deletion
        await $dynamo.delete('dynamo-equiv-read-1');
        await $dynamo.delete('dynamo-equiv-read-2');
        await $dynamo.delete('dynamo-equiv-read-3');
        await $dynamo.delete('dynamo-equiv-update-1');
        await $dynamo.delete('dynamo-equiv-update-2');
        await $dynamo.delete('dynamo-equiv-update-3');

        // Verify items are deleted
        expect2(await $dynamo.read('dynamo-equiv-read-1').catch(GETERR)).toEqual('404 NOT FOUND - no:dynamo-equiv-read-1');
        expect2(await $dynamo.read('dynamo-equiv-read-2').catch(GETERR)).toEqual('404 NOT FOUND - no:dynamo-equiv-read-2');
        expect2(await $dynamo.read('dynamo-equiv-read-3').catch(GETERR)).toEqual('404 NOT FOUND - no:dynamo-equiv-read-3');
        expect2(await $dynamo.read('dynamo-equiv-update-1').catch(GETERR)).toEqual('404 NOT FOUND - no:dynamo-equiv-update-1');
        expect2(await $dynamo.read('dynamo-equiv-update-2').catch(GETERR)).toEqual('404 NOT FOUND - no:dynamo-equiv-update-2');
        expect2(await $dynamo.read('dynamo-equiv-update-3').catch(GETERR)).toEqual('404 NOT FOUND - no:dynamo-equiv-update-3');

        // Remove from testDataIds since we already cleaned up
        testDataIds.delete('dynamo-equiv-read-1');
        testDataIds.delete('dynamo-equiv-read-2');
        testDataIds.delete('dynamo-equiv-read-3');
        testDataIds.delete('dynamo-equiv-update-1');
        testDataIds.delete('dynamo-equiv-update-2');
        testDataIds.delete('dynamo-equiv-update-3');
    });

    //* dynamo storage service. (should be equivalent with `dummy-storage-server`)
    it(`should pass dynamo(real) storage-service`, async () => {
        //* load dynamo storage service.
        expect2(() => new DynamoStorageService<AccountModel>('', [], 'no')).toEqual(`@table (table-name) is required!`);
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'no');
        expect2(() => $dynamo.hello()).toEqual('dynamo-storage-service:TestTable/no/8');
        expect2(() => $dynamo.fields()).toEqual('balance,id,meta,name,no,slot,stereo,type'.split(',')); //* must be sorted w/o duplicated

        //* ignore if no profile.
        if (!PROFILE) return; //* ignore if no profile.

        //* init with property filtering.
        expect(await $dynamo.save('A00000', { type: 'account', ha: 'ho' } as AccountModel)).toEqual({
            no: 'A00000',
            type: 'account',
        });
        expect(await $dynamo.update('A00000', { stereo: 'lemon' })).toEqual({ no: 'A00000', stereo: 'lemon' }); //* it will have ONLY update-set.
        expect(await $dynamo.increment('A00000', { slot: 1 })).toEqual({ no: 'A00000', slot: 1 }); //* auto update for un-defined attribute.
        expect(await $dynamo.increment('A00000', { slot: -2 })).toEqual({ no: 'A00000', slot: -1 }); //* accumulated incremental result.
        expect(await $dynamo.read('A00000')).toEqual({ no: 'A00000', type: 'account', stereo: 'lemon', slot: -1 });
        expect(await $dynamo.increment('A00000', { slot: null }).catch(GETERR)).toEqual(
            '.slot (null) should be number!',
        );
        expect(await $dynamo.increment('A00000', { stereo: null }).catch(GETERR)).toEqual({
            no: 'A00000',
            stereo: null,
        });
        expect(await $dynamo.delete('A00000')).toEqual({ no: 'A00000', type: 'account', stereo: null, slot: -1 });
        expect(await $dynamo.update('A00000', { type: 'test' })).toEqual({ no: 'A00000', type: 'test' }); //* it should make new entry.
        expect(await $dynamo.delete('A00000')).toEqual({ no: 'A00000', type: 'test' });
        //* it should make new entry also.
        expect(await $dynamo.increment('A00000', { type: 'test', slot: 1 })).toEqual({
            no: 'A00000',
            type: 'test',
            slot: 1,
        });
        //* it should return last slot#
        expect(await $dynamo.increment('A00000', { type: 'test', slot: 0 })).toEqual({
            no: 'A00000',
            type: 'test',
            slot: 1,
        });
        expect(await $dynamo.read('A00000')).toEqual({ no: 'A00000', type: 'test', slot: 1 }); //* it should return last slot#

        //* increment w/ $update
        expect(await $dynamo.increment('A00000', { slot: 0 }, { balance: 1000 })).toEqual({
            no: 'A00000',
            slot: 1,
            balance: 1000,
        });
        expect(await $dynamo.read('A00000')).toEqual({ no: 'A00000', type: 'test', slot: 1, balance: 1000 });

        //* update with increments
        expect2(await $dynamo.update('A00000', {}, { balance: 100 })).toEqual({ no: 'A00000', balance: 1100 });
        expect2(await $dynamo.read('A00000')).toEqual({ no: 'A00000', type: 'test', slot: 1, balance: 1100 });
        expect2(await $dynamo.update('A00000', { slot: 2 }, { balance: -500 })).toEqual({
            no: 'A00000',
            slot: 2,
            balance: 600,
        });
        expect2(await $dynamo.read('A00000')).toEqual({ no: 'A00000', type: 'test', slot: 2, balance: 600 });

        //* check delete()
        expect2(await $dynamo.delete('A00000'), 'no').toEqual({ no: 'A00000' });
        expect2(await $dynamo.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - no:A00000');
        //* it should create with model.
        expect2(await $dynamo.readOrCreate('A00000', { type: 'auto', slot: 2 })).toEqual({
            no: 'A00000',
            type: 'auto',
            slot: 2,
        });
    });

    //* http storage service.
    it('should pass http storage-service w/ _id', async () => {
        //* load http storage service.
        const endpoint = 'http://localhost:8113'; // [kwonsun]ssocioliving-admin-web
        const type = 'accounts';
        const $storage = new HttpStorageService(endpoint, type);
        const $http = $storage as HttpStorageService<AccountModel>;

        expect2(() => $http.hello()).toEqual(`http-storage-service:${endpoint}/id`);

        //* bypass test if ECONNREFUSED
        // expect2(await $http.read('0').catch(GETERR)).toEqual($U.json({ errno:'ECONNREFUSED', code:'ECONNREFUSED',syscall:'connect',address:'127.0.0.1', port:8113}));
        const ERRCON = await $http.read('0').catch(GETERR);
        if (typeof ERRCON == 'string' && ERRCON.indexOf('"ECONNREFUSED"') >= 0) return;

        //* make sure deleted.
        await $http.delete('A00000').catch(GETERR);
        await $http.delete('B00001').catch(GETERR);

        expect2(await $http.save('A00000', { type: 'account' })).toEqual({ id: 'A00000', type: 'account' });
        //* it will have ONLY update-set.
        expect2(await $http.save('A00000', { type: 'account', name: 'ho' })).toEqual({
            id: 'A00000',
            type: 'account',
            name: 'ho',
        });
        expect2(await $http.update('A00000', { stereo: 'lemon' })).toEqual({ id: 'A00000', stereo: 'lemon' });
        expect2(await $http.increment('A00000', { slot: 1 })).toEqual({ id: 'A00000', slot: 1 });
        expect2(await $http.increment('A00000', { slot: -2 })).toEqual({ id: 'A00000', slot: -1 });
        expect2(await $http.increment('A00000', { slot: null }).catch(GETERR)).toEqual(
            '.slot (null) should be number!',
        );
        expect2(await $http.increment('A00000', { stereo: null }).catch(GETERR)).toEqual({
            id: 'A00000',
            stereo: null,
        });
        expect2(await $http.delete('A00000')).toEqual('A00000');

        expect2(await $http.update('A00000', { type: 'test', balance: 1 })).toEqual({
            id: 'A00000',
            type: 'test',
            balance: 1,
        }); // it should make new entry.
        expect2(await $http.update('A00000', { balance: 22 })).toEqual({ id: 'A00000', balance: 22 }); //* it should update
        expect2(await $http.read('A00000'), 'id,type,balance').toEqual({ id: 'A00000', type: 'test', balance: 22 }); //* it should have latest value.
        expect2(await $http.delete('A00000')).toEqual('A00000');
        //* it should make new entry also.
        expect2(await $http.increment('A00000', { type: 'test', slot: 1 })).toEqual({
            id: 'A00000',
            type: 'test',
            slot: 1,
        });
        //* it should return last slot#
        expect2(await $http.increment('A00000', { type: 'test', slot: 0 })).toEqual({
            id: 'A00000',
            type: 'test',
            slot: 1,
        });
        expect2(await $http.read('A00000'), 'id,type,slot').toEqual({ id: 'A00000', type: 'test', slot: 1 }); //* it should return last slot#

        //* increment w/ $update
        expect2(await $http.increment('A00000', { slot: 0 }, { balance: 1000 })).toEqual({
            id: 'A00000',
            slot: 1,
            balance: 1000,
        });
        expect2(await $http.read('A00000'), 'id,type,slot,balance').toEqual({
            id: 'A00000',
            type: 'test',
            slot: 1,
            balance: 1000,
        });

        //* update with increments
        expect2(await $http.update('A00000', {}, { balance: 100 })).toEqual({ id: 'A00000', balance: 1100 });
        expect2(await $http.read('A00000'), 'id,type,slot,balance').toEqual({
            id: 'A00000',
            type: 'test',
            slot: 1,
            balance: 1100,
        });
        expect2(await $http.update('A00000', { slot: 2 }, { balance: -500 })).toEqual({
            id: 'A00000',
            slot: 2,
            balance: 600,
        });
        expect2(await $http.read('A00000'), 'id,type,slot,balance').toEqual({
            id: 'A00000',
            type: 'test',
            slot: 2,
            balance: 600,
        });
        //* priority inc
        expect2(await $http.update('A00000', { balance: 800 }, { balance: -500 })).toEqual({
            id: 'A00000',
            balance: 100,
        });
        expect2(await $http.read('A00000'), 'id,type,slot,balance').toEqual({
            id: 'A00000',
            type: 'test',
            slot: 2,
            balance: 100,
        });

        //* check delete()
        expect2(await $http.delete('A00000')).toEqual('A00000');
        expect2(await $http.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - id:A00000');
        //* it should create with model.
        expect2(await $http.readOrCreate('A00000', { type: 'auto', slot: 2 })).toEqual({
            id: 'A00000',
            type: 'auto',
            slot: 2,
        });

        //* error cases.
        expect2(await $http.increment('', { type: 'test', slot: 1 }).catch(GETERR)).toEqual('@id is required!');
        expect2(await $http.increment(' ', { type: 'test', slot: 1 }).catch(GETERR)).toEqual(
            '@id (string) is required!',
        );
        expect2(await $http.increment('B00001', null).catch(GETERR)).toEqual('@item is required!');
        expect2(await $http.increment('B00001', { type: 'test', slot: 1 }).catch(GETERR)).toEqual({
            id: 'B00001',
            type: 'test',
            slot: 1,
        });
    });

    afterAll(async () => {
        if (PROFILE !== 'lemon') return;

        // Cleanup the table - delete all test data
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'no');
        await Promise.all([...testDataIds].map(id => $dynamo.delete(id).catch(() => {})));
    });
});
