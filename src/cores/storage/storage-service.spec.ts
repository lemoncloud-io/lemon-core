/**
 * `storage-service.spec.js`
 * - unit test for `storage-service`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-26 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../environ';
import { GETERR, expect2 } from '../../common/test-helper';
import { DynamoStorageService, DummyStorageService, StorageModel } from './storage-service';
import { HttpStorageService } from './http-storage-service';

interface AccountModel extends StorageModel {
    slot?: number;
    balance?: number;
    name?: string;
    tags?: string[];
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

        // - whitespace id is rejected by trim() validation.
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
        const dummyLegacyUpdate1 = await $account.update('equiv-update-1', {
            type: 'equiv-updated',
            name: 'Updated 1',
            balance: 200,
        });
        const dummyLegacyUpdate2 = await $account.update('equiv-update-2', {
            type: 'equiv-updated',
            name: 'Updated 2',
            balance: 400,
        });
        const dummyLegacyUpdate3 = await $account.update('equiv-update-3', {
            type: 'equiv-updated',
            name: 'Updated 3',
            balance: 600,
        });

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
        expect2(await $account.increment('', { type: 'test', slot: 1 }).catch(GETERR)).toEqual('@id is required!');
        expect2(await $account.increment(' ', { type: 'test', slot: 1 }).catch(GETERR)).toEqual(
            '@id (string) is required!',
        );
        expect2(await $account.delete(' ').catch(GETERR)).toEqual('@id (string) is required!');
        expect2(await $account.increment('B00001', null).catch(GETERR)).toEqual('@item is required!');
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
        expect2(await $account.increment('', { type: 'test', slot: 1 }).catch(GETERR)).toEqual('@id is required!');
        expect2(await $account.increment(' ', { type: 'test', slot: 1 }).catch(GETERR)).toEqual(
            '@id (string) is required!',
        );
        expect2(await $account.delete(' ').catch(GETERR)).toEqual('@id (string) is required!');
        expect2(await $account.increment('B00001', null).catch(GETERR)).toEqual('@item is required!');
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
        const dynamoBatchRead = await $dynamo.mread([
            'dynamo-equiv-read-1',
            'dynamo-equiv-read-2',
            'dynamo-equiv-read-3',
        ]);

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
        const dynamoLegacyUpdate1 = await $dynamo.update('dynamo-equiv-update-1', {
            type: 'equiv-updated',
            name: 'Updated 1',
            balance: 200,
        });
        const dynamoLegacyUpdate2 = await $dynamo.update('dynamo-equiv-update-2', {
            type: 'equiv-updated',
            name: 'Updated 2',
            balance: 400,
        });
        const dynamoLegacyUpdate3 = await $dynamo.update('dynamo-equiv-update-3', {
            type: 'equiv-updated',
            name: 'Updated 3',
            balance: 600,
        });

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
        expect2(await $dynamo.read('dynamo-equiv-read-1').catch(GETERR)).toEqual(
            '404 NOT FOUND - no:dynamo-equiv-read-1',
        );
        expect2(await $dynamo.read('dynamo-equiv-read-2').catch(GETERR)).toEqual(
            '404 NOT FOUND - no:dynamo-equiv-read-2',
        );
        expect2(await $dynamo.read('dynamo-equiv-read-3').catch(GETERR)).toEqual(
            '404 NOT FOUND - no:dynamo-equiv-read-3',
        );
        expect2(await $dynamo.read('dynamo-equiv-update-1').catch(GETERR)).toEqual(
            '404 NOT FOUND - no:dynamo-equiv-update-1',
        );
        expect2(await $dynamo.read('dynamo-equiv-update-2').catch(GETERR)).toEqual(
            '404 NOT FOUND - no:dynamo-equiv-update-2',
        );
        expect2(await $dynamo.read('dynamo-equiv-update-3').catch(GETERR)).toEqual(
            '404 NOT FOUND - no:dynamo-equiv-update-3',
        );

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
        if (typeof ERRCON == 'string' && ERRCON.indexOf('ECONNREFUSED') >= 0) return;

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

    //* dummy storage service - optional fields behavior
    it('should respect optional fields parameter on DummyStorageService', async () => {
        //* fields undefined: keep legacy no-filter mode.
        const $unfiltered = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory', 'id');
        await $unfiltered.save('FA0000', { type: 'account', name: 'kept', extra: 'kept' } as any);
        expect2(await $unfiltered.read('FA0000')).toEqual({
            id: 'FA0000',
            type: 'account',
            name: 'kept',
            extra: 'kept',
        });
        await $unfiltered.delete('FA0000');

        //* fields empty: use DynamoStorage default whitelist only.
        const $defaults = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory', 'no', []);
        expect2(() => $defaults.hello()).toEqual('dummy-storage-service:memory/no/5'); //* id,type,stereo,meta,no
        await $defaults.save('FB0000', { type: 'account', name: 'dropped', extra: 'dropped' } as any);
        expect2(await $defaults.read('FB0000')).toEqual({ no: 'FB0000', type: 'account' });
        await $defaults.delete('FB0000');

        //* fields named: keep whitelisted attrs and drop the rest.
        const $named = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory', 'no', ['name']);
        expect2(() => $named.hello()).toEqual('dummy-storage-service:memory/no/6');
        await $named.save('FC0000', { type: 'account', name: 'kept', extra: 'dropped' } as any);
        expect2(await $named.read('FC0000')).toEqual({ no: 'FC0000', type: 'account', name: 'kept' });
        await $named.delete('FC0000');
    });

    //* DummyStorageService vs DynamoStorageService parity
    //* - Dummy always runs; Dynamo comparison runs only on lemon profile.
    //* - This keeps CI useful while allowing real Dynamo parity checks locally.
    it('should match DynamoStorageService when DummyStorageService is configured with the same fields', async () => {
        const FIELDS = ['name', 'slot', 'balance', 'tags'];
        const $dummy = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory', 'no', FIELDS);
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', FIELDS, 'no');
        const useDynamo = PROFILE === 'lemon';

        //* hello() shape parity - no storage access.
        expect2(() => $dummy.hello()).toEqual('dummy-storage-service:memory/no/9');
        if (useDynamo) expect2(() => $dynamo.hello()).toEqual('dynamo-storage-service:TestTable/no/9');

        //* Run on Dummy; on lemon profile, require the same Dynamo result.
        const _compare = async <R>(label: string, runner: (svc: any) => Promise<R>): Promise<R> => {
            const dummyRes = await runner($dummy).catch(GETERR);
            if (useDynamo) {
                const dynamoRes = await runner($dynamo).catch(GETERR);
                expect2(() => dynamoRes, undefined as any).toEqual(dummyRes);
            }
            //* surface label on failures.
            if (typeof dummyRes === 'string' && (dummyRes as any).startsWith?.('Error')) {
                console.warn(`[parity:${label}] dummy error =`, dummyRes);
            }
            return dummyRes as R;
        };
        //* Check reject parity without matching DynamoDB error text.
        const _rejectBoth = async (label: string, runner: (svc: any) => Promise<any>) => {
            const dummyErr = await runner($dummy).catch(GETERR);
            expect(typeof dummyErr, `[parity:${label}] dummy should reject`).toEqual('string');
            if (useDynamo) {
                const dynamoErr = await runner($dynamo).catch(GETERR);
                expect(typeof dynamoErr, `[parity:${label}] dynamo should reject`).toEqual('string');
            }
        };

        const ID = 'PA0000';
        const trackId = (id: string) => testDataIds.add(id);

        //* save/read: non-whitelisted attrs are dropped.
        trackId(ID);
        await _compare('save', svc => svc.save(ID, { type: 'account', name: 'one', extra: 'drop' } as any));
        await _compare('read-after-save', svc => svc.read(ID));
        expect2(await $dummy.read(ID)).toEqual({ no: ID, type: 'account', name: 'one' });

        //* update: return only the idName and updated fields.
        await _compare('update-existing', svc => svc.update(ID, { name: 'two' }));
        expect2(await $dummy.read(ID)).toEqual({ no: ID, type: 'account', name: 'two' });

        //* update with numeric incrementals.
        await _compare('update+inc', svc => svc.update(ID, {}, { balance: 100 }));
        expect2(await $dummy.read(ID)).toEqual({ no: ID, type: 'account', name: 'two', balance: 100 });

        //* increment: additive updates accumulate.
        await _compare('inc-simple', svc => svc.increment(ID, { slot: 1 }));
        await _compare('inc-negative', svc => svc.increment(ID, { slot: -2 }));
        expect2(await $dummy.read(ID)).toEqual({
            no: ID,
            type: 'account',
            name: 'two',
            balance: 100,
            slot: -1,
        });

        //* increment with update-set on another field.
        await _compare('inc+upt', svc => svc.increment(ID, { slot: 0 }, { balance: 1000 }));
        expect2(await $dummy.read(ID)).toEqual({
            no: ID,
            type: 'account',
            name: 'two',
            balance: 1000,
            slot: -1,
        });

        //* increment: null increment model rejects.
        await _rejectBoth('inc-update-only-null-model', svc => svc.increment(ID, null as any, { name: 'update-only' }));

        //* increment: non-number on numeric attr rejects.
        await _compare('inc-non-number', svc => svc.increment(ID, { slot: null }));

        //* increment: null on string attr uses SET semantics.
        await _compare('inc-null-on-string', svc => svc.increment(ID, { type: null } as any));
        expect2(await $dummy.read(ID), 'no,type').toEqual({ no: ID, type: null });

        //* save/read: empty strings persist as null.
        const ID5 = 'PA0004';
        trackId(ID5);
        await _compare('save-empty-string-return', svc => svc.save(ID5, { type: 'account', name: '' } as any));
        expect2(await $dummy.read(ID5)).toEqual({ no: ID5, type: 'account', name: null });
        if (useDynamo) expect2(await $dynamo.read(ID5)).toEqual({ no: ID5, type: 'account', name: null });

        //* increment: array values append like Dynamo list_append.
        const ID6 = 'PA0005';
        trackId(ID6);
        await _compare('array-inc-create', svc => svc.increment(ID6, { tags: ['a', 'b'] } as any));
        await _compare('array-inc-append', svc => svc.increment(ID6, { tags: ['c'] } as any));
        expect2(await $dummy.read(ID6)).toEqual({ no: ID6, tags: ['a', 'b', 'c'] });
        await _rejectBoth('update-array-inc-rejects', svc => svc.update(ID6, {}, { tags: ['d'] } as any));

        //* increment: numeric ADD against string attr rejects.
        const ID7 = 'PA0006';
        trackId(ID7);
        await _compare('save-string-for-add-type-check', svc => svc.save(ID7, { type: 'account', name: 'not-number' }));
        await _rejectBoth('number-add-to-string', svc => svc.increment(ID7, { name: 5 } as any));

        //* mread: mixed hits and misses keep batch result shape.
        const MISSING_A = 'PA9999';
        const MISSING_B = 'PA9998';
        await _compare('mread-mixed', svc => svc.mread([ID, MISSING_A, MISSING_B]));

        //* mupdate: batch PUT overwrites instead of merging.
        const ID2 = 'PA0001';
        const ID3 = 'PA0002';
        trackId(ID2);
        trackId(ID3);
        await _compare('mupdate', svc =>
            svc.mupdate([
                { no: ID2, type: 'account', name: 'two', balance: 200 } as any,
                { no: ID3, type: 'account', name: 'three', balance: 300, extra: 'drop' } as any,
            ]),
        );
        expect2(await $dummy.read(ID3)).toEqual({ no: ID3, type: 'account', name: 'three', balance: 300 });

        //* mupdate: use only the logical idName field when idName differs.
        const ID8 = 'PA0007';
        trackId(ID8);
        await _compare('mupdate-idname-conflict', svc =>
            svc.mupdate([{ no: ID8, type: 'account', name: 'id-conflict' } as any]),
        );
        expect2(await $dummy.read(ID8)).toEqual({ no: ID8, type: 'account', name: 'id-conflict' });

        //* readOrCreate: missing id creates the model.
        const ID4 = 'PA0003';
        trackId(ID4);
        await _compare('readOrCreate-missing', svc => svc.readOrCreate(ID4, { type: 'auto', slot: 2 } as any));
        expect2(await $dummy.read(ID4)).toEqual({ no: ID4, type: 'auto', slot: 2 });

        //* delete: return old item and make subsequent read miss.
        await _compare('delete', svc => svc.delete(ID2));
        await _compare('read-after-delete', svc => svc.read(ID2));

        //* read: missing id returns the same 404 shape.
        await _compare('read-missing', svc => svc.read(MISSING_A));

        //* read: whitespace id rejected by Dummy trim() validation (Dynamo accepts; parity not asserted).
        expect2(await $dummy.read(' ').catch(GETERR)).toEqual('@id (string) is required!');

        //* cleanup remaining ids; ignore already-deleted misses.
        await $dummy.delete(ID).catch(() => {});
        await $dummy.delete(ID3).catch(() => {});
        await $dummy.delete(ID4).catch(() => {});
        await $dummy.delete(ID5).catch(() => {});
        await $dummy.delete(ID6).catch(() => {});
        await $dummy.delete(ID7).catch(() => {});
        await $dummy.delete(ID8).catch(() => {});
        if (useDynamo) {
            await $dynamo.delete(ID).catch(() => {});
            await $dynamo.delete(ID3).catch(() => {});
            await $dynamo.delete(ID4).catch(() => {});
            await $dynamo.delete(ID5).catch(() => {});
            await $dynamo.delete(ID6).catch(() => {});
            await $dynamo.delete(ID7).catch(() => {});
            await $dynamo.delete(ID8).catch(() => {});
        }
    });

    //* dummy storage service - idName=_id with fields
    it('should pass DummyStorageService with idName=_id and fields configured', async () => {
        const $dummy = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory2', '_id', [
            'name',
            'slot',
            'balance',
        ]);
        expect2(() => $dummy.hello()).toEqual('dummy-storage-service:memory2/_id/8');

        await $dummy.save('Z00001', { type: 'account', name: 'first', extra: 'drop' } as any);
        expect2(await $dummy.read('Z00001')).toEqual({ _id: 'Z00001', type: 'account', name: 'first' });

        const failed = await $dummy.mread(['Z00001', 'Z99999']);
        expect2(failed.success.length).toEqual(1);
        expect2(failed.failed.length).toEqual(1);
        expect2(failed.failed[0]).toEqual({ _id: 'Z99999', error: '404 NOT FOUND - _id:Z99999' });

        expect2(await $dummy.read('Z99999').catch(GETERR)).toEqual('404 NOT FOUND - _id:Z99999');
        await $dummy.delete('Z00001');
    });

    //* array increment and string overwrite.
    it('should support shape-driven array increment while keeping string overwrite', async () => {
        const FIELDS = ['name', 'slot', 'balance', 'tags'];
        const $dummy = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory', 'no', FIELDS);
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', FIELDS, 'no');
        const useDynamo = PROFILE === 'lemon';

        const _compare = async <R>(_label: string, runner: (svc: any) => Promise<R>): Promise<R> => {
            const dummyRes = await runner($dummy).catch(GETERR);
            if (useDynamo) {
                const dynamoRes = await runner($dynamo).catch(GETERR);
                expect2(() => dynamoRes, undefined as any).toEqual(dummyRes);
            }
            return dummyRes as R;
        };
        const _readBoth = async (id: string, expected: any) => {
            expect2(await $dummy.read(id)).toEqual(expected);
            if (useDynamo) expect2(await $dynamo.read(id)).toEqual(expected);
        };
        const _rejectBoth = async (label: string, runner: (svc: any) => Promise<any>, expectedDummy: string) => {
            const dummyErr = await runner($dummy).catch(GETERR);
            expect2(dummyErr).toEqual(expectedDummy);
            if (useDynamo) {
                const dynamoErr = await runner($dynamo).catch(GETERR);
                expect(typeof dynamoErr, `[shape-inc:${label}] dynamo should reject`).toEqual('string');
            }
        };

        //* create by increment.
        const T1 = 'TI0001';
        testDataIds.add(T1);
        expect2(
            await _compare('typed-inc-initial', svc =>
                svc.increment(T1, { name: 'a', slot: 1, tags: ['a', 'b'], extra: 'drop' } as any),
            ),
        ).toEqual({ no: T1, name: 'a', slot: 1, tags: ['a', 'b'] });
        await _readBoth(T1, { no: T1, name: 'a', slot: 1, tags: ['a', 'b'] });

        //* append arrays, add numbers, and overwrite strings in one increment call.
        const T2 = 'TI0002';
        testDataIds.add(T2);
        await _compare('typed-inc-seed', svc =>
            svc.save(T2, { type: 'account', name: 'b', slot: 7, balance: 100, tags: ['x'] } as any),
        );
        expect2(
            await _compare('typed-inc-append', svc =>
                svc.increment(T2, { name: 'a', slot: 3, balance: -25, tags: ['a', 'b'], extra: 'drop' } as any),
            ),
        ).toEqual({ no: T2, name: 'a', slot: 10, balance: 75, tags: ['x', 'a', 'b'] });
        await _readBoth(T2, {
            no: T2,
            type: 'account',
            name: 'a',
            slot: 10,
            balance: 75,
            tags: ['x', 'a', 'b'],
        });
        expect2(
            await _compare('typed-inc-append-again', svc => svc.increment(T2, { name: 'c', tags: ['c'] } as any)),
        ).toEqual({
            no: T2,
            name: 'c',
            tags: ['x', 'a', 'b', 'c'],
        });
        await _readBoth(T2, {
            no: T2,
            type: 'account',
            name: 'c',
            slot: 10,
            balance: 75,
            tags: ['x', 'a', 'b', 'c'],
        });

        //* $update can be combined with shape-driven increment on different fields.
        const T4 = 'TI0004';
        testDataIds.add(T4);
        await _compare('typed-inc-update-seed', svc =>
            svc.save(T4, { type: 'account', name: 'old', slot: 1, tags: ['seed'] } as any),
        );
        expect2(
            await _compare('typed-inc-with-update', svc =>
                svc.increment(
                    T4,
                    { name: 'inc-name', slot: 4, tags: ['inc'] } as any,
                    {
                        balance: 50,
                    } as any,
                ),
            ),
        ).toEqual({ no: T4, name: 'inc-name', slot: 5, balance: 50, tags: ['seed', 'inc'] });
        await _readBoth(T4, {
            no: T4,
            type: 'account',
            name: 'inc-name',
            slot: 5,
            balance: 50,
            tags: ['seed', 'inc'],
        });

        //* null/object/empty-array values are handled by shape in the same increment API.
        const T5 = 'TI0005';
        testDataIds.add(T5);
        await _compare('typed-inc-shape-seed', svc =>
            svc.save(T5, {
                type: 'account',
                name: 'seed',
                slot: 10,
                balance: 5,
                tags: ['root'],
                meta: { origin: true },
            } as any),
        );
        expect2(
            await _compare('typed-inc-shape-mixed', svc =>
                svc.increment(
                    T5,
                    {
                        name: '',
                        slot: -3,
                        balance: 0,
                        tags: [],
                        meta: { nested: { ok: true }, step: 1 },
                    } as any,
                    { stereo: 'from-update' } as any,
                ),
            ),
        ).toEqual({
            no: T5,
            name: null,
            slot: 7,
            balance: 5,
            tags: ['root'],
            meta: { nested: { ok: true }, step: 1 },
            stereo: 'from-update',
        });
        await _readBoth(T5, {
            no: T5,
            type: 'account',
            name: null,
            slot: 7,
            balance: 5,
            tags: ['root'],
            meta: { nested: { ok: true }, step: 1 },
            stereo: 'from-update',
        });
        expect2(
            await _compare('typed-inc-shape-null-object', svc =>
                svc.increment(T5, { name: 'restored', meta: null, tags: ['tail'] } as any),
            ),
        ).toEqual({
            no: T5,
            name: 'restored',
            tags: ['root', 'tail'],
            meta: null,
        });
        await _readBoth(T5, {
            no: T5,
            type: 'account',
            name: 'restored',
            slot: 7,
            balance: 5,
            tags: ['root', 'tail'],
            meta: null,
            stereo: 'from-update',
        });

        //* type mismatch.
        const T3 = 'TI0003';
        testDataIds.add(T3);
        await $dummy.save(T3, { type: 'account', name: 'foo', slot: 1, tags: ['a'] } as any);
        if (useDynamo) await $dynamo.save(T3, { type: 'account', name: 'foo', slot: 1, tags: ['a'] } as any);

        await _rejectBoth(
            'number-field-string',
            svc => svc.increment(T3, { slot: 'x' } as any),
            '.slot (x) should be number!',
        );
        await _readBoth(T3, { no: T3, type: 'account', name: 'foo', slot: 1, tags: ['a'] });
        await _rejectBoth(
            'string-field-number',
            svc => svc.increment(T3, { name: 1 } as any),
            '.name (1) should be string!',
        );
        await _rejectBoth(
            'array-field-string',
            svc => svc.increment(T3, { tags: 'b' } as any),
            '.tags (b) should be array!',
        );
        await _rejectBoth(
            'string-field-array',
            svc => svc.increment(T3, { name: ['x'] } as any),
            '.name (x) should be string!',
        );
        await _readBoth(T3, { no: T3, type: 'account', name: 'foo', slot: 1, tags: ['a'] });

        //* failed shape checks must not commit earlier valid fields from the same call.
        await _rejectBoth(
            'reject-keeps-state',
            svc => svc.increment(T3, { balance: 5, tags: 'bad' } as any),
            '.tags (bad) should be array!',
        );
        await _readBoth(T3, { no: T3, type: 'account', name: 'foo', slot: 1, tags: ['a'] });

        //* cleanup
        await $dummy.delete(T1).catch(() => {});
        await $dummy.delete(T2).catch(() => {});
        await $dummy.delete(T3).catch(() => {});
        await $dummy.delete(T4).catch(() => {});
        await $dummy.delete(T5).catch(() => {});
        if (useDynamo) {
            await $dynamo.delete(T1).catch(() => {});
            await $dynamo.delete(T2).catch(() => {});
            await $dynamo.delete(T3).catch(() => {});
            await $dynamo.delete(T4).catch(() => {});
            await $dynamo.delete(T5).catch(() => {});
        }
    });

    //* atomic additive operations with Promise.all.
    it('should preserve additive increment results under Promise.all concurrency', async () => {
        const FIELDS = ['name', 'slot', 'balance', 'tags'];
        const $dummy = new DummyStorageService<AccountModel>('ticketing-dummy-data', 'memory', 'no', FIELDS);
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', FIELDS, 'no');
        const useDynamo = PROFILE === 'lemon';

        const expectMixedAtomicResult = (node: any, id: string, size: number) => {
            expect2(node.no).toEqual(id);
            expect2(node.type).toEqual('account');
            expect2(node.slot).toEqual(size);
            expect2(node.balance).toEqual(size * 2);
            expect2(node.tags.length).toEqual(size);
            expect2(new Set(node.tags).size).toEqual(size);
            expect2([...node.tags].sort()).toEqual(Array.from({ length: size }, (_, i) => `tag-${i}`).sort());
            expect(node.name, 'final string overwrite should be one complete concurrent value').toMatch(
                /^inc-name-\d+$/,
            );
            expect2(node.meta?.kind).toEqual('inc');
            expect(typeof node.meta?.index).toEqual('number');
            expect(node.meta.index).toBeGreaterThanOrEqual(0);
            expect(node.meta.index).toBeLessThan(size);
        };

        //* number add.
        const A_DUMMY = 'AT0001';
        await Promise.all(Array.from({ length: 100 }, (_, i) => $dummy.increment(A_DUMMY, { slot: i + 1 } as any)));
        expect2((await $dummy.read(A_DUMMY)).slot).toEqual(5050);
        await $dummy.delete(A_DUMMY).catch(() => {});

        if (useDynamo) {
            const A_DYN = 'AT0001D';
            testDataIds.add(A_DYN);
            await Promise.all(Array.from({ length: 100 }, (_, i) => $dynamo.increment(A_DYN, { slot: i + 1 } as any)));
            expect2((await $dynamo.read(A_DYN)).slot).toEqual(5050);
            await $dynamo.delete(A_DYN).catch(() => {});
        }

        //* update(..., increments) shares the same per-id queue in Dummy.
        const U_DUMMY = 'AT0003';
        await Promise.all(Array.from({ length: 100 }, (_, i) => $dummy.update(U_DUMMY, {}, { slot: i + 1 } as any)));
        expect2((await $dummy.read(U_DUMMY)).slot).toEqual(5050);
        await $dummy.delete(U_DUMMY).catch(() => {});

        //* update(..., increments) and increment(...) should not lose additive writes when interleaved.
        const MIX_DUMMY = 'AT0004';
        await Promise.all(
            Array.from({ length: 100 }, (_, i) =>
                i % 2 === 0
                    ? $dummy.increment(MIX_DUMMY, { slot: i + 1 } as any)
                    : $dummy.update(MIX_DUMMY, {}, { slot: i + 1 } as any),
            ),
        );
        expect2((await $dummy.read(MIX_DUMMY)).slot).toEqual(5050);
        await $dummy.delete(MIX_DUMMY).catch(() => {});

        //* number add with array append.
        const B_DUMMY = 'AT0002';
        await Promise.all(
            Array.from({ length: 100 }, (_, i) =>
                $dummy.increment(B_DUMMY, { slot: i + 1, tags: [`${i + 1}`] } as any),
            ),
        );
        const dummyB: any = await $dummy.read(B_DUMMY);
        expect2(dummyB.slot).toEqual(5050);
        expect2(dummyB.tags.length).toEqual(100);
        expect2(new Set(dummyB.tags).size).toEqual(100);
        await $dummy.delete(B_DUMMY).catch(() => {});

        //* string[] append with exact membership.
        const C_DUMMY = 'AT0007';
        const elements = 'abcdefghijklmnopqrstuvwxyz';
        await Promise.all(elements.split('').map(s => $dummy.increment(C_DUMMY, { tags: [s] } as any)));
        const dummyC: any = await $dummy.read(C_DUMMY);
        expect2(dummyC.tags.sort().join('')).toEqual(elements);
        await $dummy.delete(C_DUMMY).catch(() => {});

        if (useDynamo) {
            const B_DYN = 'AT0002D';
            testDataIds.add(B_DYN);
            await Promise.all(
                Array.from({ length: 100 }, (_, i) =>
                    $dynamo.increment(B_DYN, { slot: i + 1, tags: [`${i + 1}`] } as any),
                ),
            );
            const dynB: any = await $dynamo.read(B_DYN);
            expect2(dynB.slot).toEqual(5050);
            expect2(dynB.tags.length).toEqual(100);
            expect2(new Set(dynB.tags).size).toEqual(100);
            await $dynamo.delete(B_DYN).catch(() => {});

            const C_DYN = 'AT0007D';
            testDataIds.add(C_DYN);
            await Promise.all(elements.split('').map(s => $dynamo.increment(C_DYN, { tags: [s] } as any)));
            const dynC: any = await $dynamo.read(C_DYN);
            expect2(dynC.tags.sort().join('')).toEqual(elements);
            await $dynamo.delete(C_DYN).catch(() => {});
        }

        //* increment() must remain atomic when number/string/array/object parameters are mixed.
        const MIXED_DUMMY = 'AT0005';
        const mixedSize = 80;
        await $dummy.save(MIXED_DUMMY, {
            type: 'account',
            name: 'seed',
            slot: 0,
            balance: 0,
            tags: [],
            meta: { kind: 'seed' },
        } as any);
        await Promise.all(
            Array.from({ length: mixedSize }, (_, i) =>
                $dummy.increment(MIXED_DUMMY, {
                    name: `inc-name-${i}`,
                    slot: 1,
                    balance: 2,
                    tags: [`tag-${i}`],
                    meta: { kind: 'inc', index: i },
                } as any),
            ),
        );
        expectMixedAtomicResult(await $dummy.read(MIXED_DUMMY), MIXED_DUMMY, mixedSize);
        await $dummy.delete(MIXED_DUMMY).catch(() => {});

        //* update(..., increments) and increment(...) share atomicity for numeric adds while strings/objects overwrite.
        const MIXED_UPDATE_DUMMY = 'AT0006';
        await $dummy.save(MIXED_UPDATE_DUMMY, {
            type: 'account',
            name: 'seed',
            slot: 0,
            balance: 0,
            tags: [],
            meta: { kind: 'seed' },
        } as any);
        await Promise.all(
            Array.from({ length: mixedSize }, (_, i) =>
                i % 2 === 0
                    ? $dummy.increment(MIXED_UPDATE_DUMMY, {
                          name: `inc-name-${i}`,
                          slot: 1,
                          balance: 2,
                          tags: [`tag-${i}`],
                          meta: { kind: 'inc', index: i },
                      } as any)
                    : $dummy.update(
                          MIXED_UPDATE_DUMMY,
                          { name: `update-name-${i}`, meta: { kind: 'update', index: i } } as any,
                          { slot: 1, balance: 2 } as any,
                      ),
            ),
        );
        const mixedUpdateDummy: any = await $dummy.read(MIXED_UPDATE_DUMMY);
        expect2(mixedUpdateDummy.no).toEqual(MIXED_UPDATE_DUMMY);
        expect2(mixedUpdateDummy.type).toEqual('account');
        expect2(mixedUpdateDummy.slot).toEqual(mixedSize);
        expect2(mixedUpdateDummy.balance).toEqual(mixedSize * 2);
        expect2(mixedUpdateDummy.tags.length).toEqual(mixedSize / 2);
        expect2(new Set(mixedUpdateDummy.tags).size).toEqual(mixedSize / 2);
        expect2([...mixedUpdateDummy.tags].sort()).toEqual(
            Array.from({ length: mixedSize / 2 }, (_, i) => `tag-${i * 2}`).sort(),
        );
        expect(mixedUpdateDummy.name).toMatch(/^(inc|update)-name-\d+$/);
        expect(['inc', 'update']).toContain(mixedUpdateDummy.meta?.kind);
        expect(typeof mixedUpdateDummy.meta?.index).toEqual('number');
        await $dummy.delete(MIXED_UPDATE_DUMMY).catch(() => {});

        if (useDynamo) {
            const MIXED_DYN = 'AT0005D';
            testDataIds.add(MIXED_DYN);
            await $dynamo.save(MIXED_DYN, {
                type: 'account',
                name: 'seed',
                slot: 0,
                balance: 0,
                tags: [],
                meta: { kind: 'seed' },
            } as any);
            await Promise.all(
                Array.from({ length: mixedSize }, (_, i) =>
                    $dynamo.increment(MIXED_DYN, {
                        name: `inc-name-${i}`,
                        slot: 1,
                        balance: 2,
                        tags: [`tag-${i}`],
                        meta: { kind: 'inc', index: i },
                    } as any),
                ),
            );
            expectMixedAtomicResult(await $dynamo.read(MIXED_DYN), MIXED_DYN, mixedSize);
            await $dynamo.delete(MIXED_DYN).catch(() => {});
        }
    }, 60_000);

    afterAll(async () => {
        if (PROFILE !== 'lemon') return;

        // Cleanup the table - delete all test data
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'no');
        await Promise.all([...testDataIds].map(id => $dynamo.delete(id).catch(() => {})));
    });
});
