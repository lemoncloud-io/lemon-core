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
}

//! main test body.
describe('StorageService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

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

    //* Test DummyStorageService with lock field
    it('should pass DummyStorageService with lock field handling', async () => {
        const $storage = new DummyStorageService('dummy-account-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* Test increment with lock in $inc
        await $account.save('LOCK01', { type: 'test', slot: 0 });
        expect2(await $account.increment('LOCK01', { lock: 1 } as any)).toEqual({ id: 'LOCK01', lock: 1 });
        expect2(await $account.read('LOCK01'), 'lock').toEqual({ lock: 1 });

        //* Test increment with lock in $inc (accumulate)
        expect2(await $account.increment('LOCK01', { lock: 2 } as any)).toEqual({ id: 'LOCK01', lock: 3 });
        expect2(await $account.read('LOCK01'), 'lock').toEqual({ lock: 3 });

        //* Test update with lock in item
        expect2(await $account.update('LOCK02', { lock: 5, type: 'test' } as any)).toEqual({
            id: 'LOCK02',
            lock: 5,
            type: 'test',
        });
        expect2(await $account.read('LOCK02'), 'lock').toEqual({ lock: 5 });

        //* Test increment with lock in $update
        expect2(await $account.increment('LOCK02', { slot: 1 }, { lock: 10 } as any)).toEqual({
            id: 'LOCK02',
            slot: 1,
            lock: 10,
        });
        expect2(await $account.read('LOCK02'), 'lock,slot').toEqual({ lock: 10, slot: 1 });

        //* Test save with lock
        expect2(await $account.save('LOCK03', { type: 'test', lock: 7 } as any)).toEqual({
            id: 'LOCK03',
            type: 'test',
            lock: 7,
        });
        expect2(await $account.read('LOCK03'), 'lock').toEqual({ lock: 7 });
    });

    //* Test DummyStorageService readOrCreate with non-404 error
    it('should pass DummyStorageService readOrCreate with non-404 error', async () => {
        const $storage = new DummyStorageService('dummy-account-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* Mock read to throw non-404 error
        const originalRead = $account.read.bind($account);
        $account.read = jest.fn().mockRejectedValue(new Error('Database connection error'));

        //* Should throw the error (not create)
        expect2(await $account.readOrCreate('TEST01', { type: 'test' }).catch(GETERR)).toEqual(
            'Database connection error',
        );

        //* Restore
        $account.read = originalRead;
    });

    //* Test DummyStorageService update with non-number increment
    it('should pass DummyStorageService update with non-number increment error', async () => {
        const $storage = new DummyStorageService('dummy-account-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* Create test record
        await $account.save('TEST02', { type: 'test', slot: 10 });

        //* Try to increment with non-number value
        expect2(await $account.update('TEST02', {}, { name: 'invalid' } as any).catch(GETERR)).toEqual(
            '.name (invalid) should be number!',
        );
    });

    //* Test DynamoStorageService with mocked methods
    it('should pass DynamoStorageService with mocked methods', async () => {
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'id');

        //* Mock readOrCreate with non-404 error
        const mockReadItem = jest.fn().mockRejectedValue(new Error('Connection timeout'));
        ($dynamo as any).$dynamo.readItem = mockReadItem;

        expect2(await $dynamo.readOrCreate('TEST01', { type: 'test' }).catch(GETERR)).toEqual('Connection timeout');

        //* Mock update with non-number increment error
        mockReadItem.mockResolvedValue({ id: 'TEST02', slot: 10 });
        expect2(await $dynamo.update('TEST02', {}, { name: 'text' } as any).catch(GETERR)).toEqual(
            '.name (text) should be number!',
        );

        //* Mock increment with non-404 error on read
        mockReadItem.mockRejectedValue(new Error('Internal server error'));
        expect2(await $dynamo.increment('TEST03', { slot: 5 }).catch(GETERR)).toEqual('Internal server error');

        //* Mock increment with type mismatch
        mockReadItem.mockResolvedValue({ id: 'TEST04', slot: 10 });
        expect2(await $dynamo.increment('TEST04', { slot: 'invalid' } as any).catch(GETERR)).toEqual(
            '.slot (invalid) should be number!',
        );

        //* Mock delete
        const mockDeleteItem = jest.fn().mockResolvedValue({ id: 'TEST05' });
        mockReadItem.mockResolvedValue({ id: 'TEST05', name: 'test' });
        ($dynamo as any).$dynamo.deleteItem = mockDeleteItem;
        expect2(await $dynamo.delete('TEST05'), 'id,name').toEqual({ id: 'TEST05', name: 'test' });
    });

    //* Test DynamoStorageService save and update with proper mocking
    it('should pass DynamoStorageService save and update methods', async () => {
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'id');

        //* Mock save
        const mockSaveItem = jest.fn().mockResolvedValue({ id: 'SAVE01' });
        ($dynamo as any).$dynamo.saveItem = mockSaveItem;

        expect2(await $dynamo.save('SAVE01', { name: 'test', slot: 10, balance: 100 })).toEqual({
            id: 'SAVE01',
            name: 'test',
            slot: 10,
            balance: 100,
        });

        //* Mock update with incrementals
        const mockUpdateItem = jest.fn().mockResolvedValue({ id: 'UPD01', slot: 15, balance: 150 });
        ($dynamo as any).$dynamo.updateItem = mockUpdateItem;

        expect2(await $dynamo.update('UPD01', { name: 'updated' }, { slot: 5 })).toEqual({
            id: 'UPD01',
            slot: 15,
            balance: 150,
        });
    });

    //* Test DynamoStorageService increment with various value types
    it('should pass DynamoStorageService increment with various value types', async () => {
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name', 'slot', 'balance'], 'id');

        //* Mock read to return 404 (not found case)
        const mockReadItem = jest.fn().mockRejectedValue(new Error('404 NOT FOUND - id:INC01'));
        const mockUpdateItem = jest.fn().mockResolvedValue({ id: 'INC01', slot: 5 });
        ($dynamo as any).$dynamo.readItem = mockReadItem;
        ($dynamo as any).$dynamo.updateItem = mockUpdateItem;

        //* Test increment when item doesn't exist (org === undefined, typeof val === 'number')
        expect2(await $dynamo.increment('INC01', { slot: 5 })).toEqual({ id: 'INC01', slot: 5 });

        //* Mock read to return existing item with string value
        mockReadItem.mockResolvedValue({ id: 'INC02', name: 'old' });
        mockUpdateItem.mockResolvedValue({ id: 'INC02', name: 'new' });

        //* Test increment with non-number, non-array value (typeof val !== 'number' && !Array.isArray(val))
        expect2(await $dynamo.increment('INC02', { name: 'new' })).toEqual({ id: 'INC02', name: 'new' });

        //* Mock read to return existing item with array
        mockReadItem.mockResolvedValue({ id: 'INC03', slot: 10 });
        mockUpdateItem.mockResolvedValue({ id: 'INC03', slot: 15 });

        //* Test increment with array or number value (else N[key] = val)
        expect2(await $dynamo.increment('INC03', { slot: 5 }, { balance: 100 })).toEqual({ id: 'INC03', slot: 15 });
    });

    //* Test DummyStorageService update with lock in item
    it('should pass DummyStorageService update with lock in item and $inc', async () => {
        const $storage = new DummyStorageService('dummy-account-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;

        //* Test update with lock in item (line 326)
        await $account.save('LOCK10', { type: 'test', slot: 0 });
        expect2(await $account.update('LOCK10', { lock: 15 } as any, { slot: 5 })).toEqual({
            id: 'LOCK10',
            lock: 15,
            slot: 5,
        });

        //* Verify lock was set correctly
        expect2(await $account.read('LOCK10'), 'lock,slot').toEqual({ lock: 15, slot: 5 });

        //* Test update with lock in $inc (line 328, 339)
        await $account.save('LOCK11', { type: 'test', slot: 10 });
        expect2(await $account.update('LOCK11', { type: 'updated' }, { lock: 20 } as any)).toEqual({
            id: 'LOCK11',
            type: 'updated',
            lock: 20,
        });

        //* Verify lock was set correctly from $inc
        expect2(await $account.read('LOCK11'), 'lock,type').toEqual({ lock: 20, type: 'updated' });

        //* Test update with lock in both item and $inc (should use $inc value + previous)
        await $account.save('LOCK12', { type: 'test', slot: 0 });
        await $account.update('LOCK12', { lock: 10 } as any); //* Set initial lock to 10
        expect2(await $account.update('LOCK12', { type: 'both' }, { lock: 5 } as any)).toEqual({
            id: 'LOCK12',
            type: 'both',
            lock: 15,
        });

        //* Verify accumulated lock value
        expect2(await $account.read('LOCK12'), 'lock').toEqual({ lock: 15 });
    });
});
