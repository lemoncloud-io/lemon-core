/**
 * `storage-service.spec.js`
 * - unit test for `storage-service`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-26 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../environ';
import { GETERR, expect2 } from '../common/test-helper';
import { DynamoStorageService, DummyStorageService, HttpStorageService, StorageModel } from './storage-service';

interface AccountModel extends StorageModel {
    slot?: number;
    balance?: number;
    name?: string;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('StorageService', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`

    //! dummy storage service.
    it('should pass dummy storage-service', async done => {
        //! load dummy storage service.
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory', 'id');
        const $account = $storage as DummyStorageService<AccountModel>;
        /* eslint-disable prettier/prettier */
        expect2(() => $account.hello()).toEqual('dummy-storage-service:memory/id');

        expect(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'account' });
        expect(await $account.save('A00000', { type:'account', name:'ho' })).toEqual({ id:'A00000', type:'account', name:'ho' });
        expect(await $account.update('A00000', { stereo:'lemon' })).toEqual({ id: 'A00000', stereo:'lemon' });
        expect(await $account.increment('A00000', { slot:1 })).toEqual({ id: 'A00000', slot:1 });
        expect(await $account.increment('A00000', { slot:-2 })).toEqual({ id: 'A00000', slot:-1 });
        expect(await $account.increment('A00000', { slot:null }).catch(GETERR)).toEqual('.slot (null) should be number!');
        expect(await $account.increment('A00000', { stereo:null }).catch(GETERR)).toEqual({ id: 'A00000', stereo: null});
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        expect(await $account.update('A00000', { type:'test', balance:1 })).toEqual({ id:'A00000', type:'test', balance:1 });  // it should make new entry.
        expect(await $account.update('A00000', { balance:22 })).toEqual({ id:'A00000', balance:22 });                          //! it should update
        expect(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', balance:22 });                               //! it should have latest value.
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        expect(await $account.increment('A00000', { type:'test', slot:1 })).toEqual({ id:'A00000', type:'test', slot:1 });     //! it should make new entry also.
        expect(await $account.increment('A00000', { type:'test', slot:0 })).toEqual({ id:'A00000', type:'test', slot:1 });     //! it should return last slot#
        expect(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', slot:1 });                                   //! it should return last slot#

        //! increment w/ $update
        expect2(await $account.increment('A00000', { slot:0 }, { balance:1000 })).toEqual({ id:'A00000', slot:1, balance:1000 });
        expect2(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', slot:1, balance:1000 });

        //! update with increments
        expect2(await $account.update('A00000', {}, { balance: 100 })).toEqual({ id:'A00000', balance:1100 });
        expect2(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', slot:1, balance:1100 });
        expect2(await $account.update('A00000', { slot:2 }, { balance: -500 })).toEqual({ id:'A00000', slot:2, balance:600 });
        expect2(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', slot:2, balance:600 });

        //! check delete()
        expect2(await $account.delete('A00000'), 'id').toEqual({ id:'A00000' });
        expect2(await $account.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - id:A00000');
        expect2(await $account.readOrCreate('A00000', { type:'auto', slot:2 })).toEqual({ id:'A00000', type:'auto', slot:2 });  //! it should create with model.

        //! error cases.
        expect2(() => $account.increment('', { type:'test', slot:1 })).toEqual('@id is required!');
        expect2(() => $account.increment(' ', { type:'test', slot:1 })).toEqual('@id (string) is required!');
        expect2(() => $account.increment('B00001', null)).toEqual('@item is required!');
        expect2(await $account.increment('B00001', { type:'test', slot:1 })).toEqual({ id:'B00001', type:'test', slot:1 });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! dummy storage service.
    it('should pass dummy storage-service w/ _id', async done => {
        //! load dummy storage service.
        const $storage = new DummyStorageService('ticketing-dummy-data', 'memory2', '_id');
        const $account = $storage as DummyStorageService<AccountModel>;
        /* eslint-disable prettier/prettier */
        expect2(() => $account.hello()).toEqual('dummy-storage-service:memory2/_id');

        expect(await $account.read('A00000')).toEqual({ _id: 'A00000', id: 'A00000', type: 'account' });
        expect(await $account.save('A00000', { type:'account', name:'ho' })).toEqual({ _id:'A00000', type:'account', name:'ho' });
        expect(await $account.update('A00000', { stereo:'lemon' })).toEqual({ _id: 'A00000', stereo:'lemon' });
        expect(await $account.increment('A00000', { slot:1 })).toEqual({ _id: 'A00000', slot:1 });
        expect(await $account.increment('A00000', { slot:-2 })).toEqual({ _id: 'A00000', slot:-1 });
        expect(await $account.increment('A00000', { slot:null }).catch(GETERR)).toEqual('.slot (null) should be number!');
        expect(await $account.increment('A00000', { stereo:null }).catch(GETERR)).toEqual({ _id: 'A00000', stereo: null});
        expect((await $account.delete('A00000'))._id).toEqual('A00000');
        expect(await $account.update('A00000', { type:'test', balance:1 })).toEqual({ _id:'A00000', type:'test', balance:1 });  // it should make new entry.
        expect(await $account.update('A00000', { balance:22 })).toEqual({ _id:'A00000', balance:22 });                          //! it should update
        expect(await $account.read('A00000')).toEqual({ _id:'A00000', type:'test', balance:22 });                               //! it should have latest value.
        expect((await $account.delete('A00000'))._id).toEqual('A00000');
        expect(await $account.increment('A00000', { type:'test', slot:1 })).toEqual({ _id:'A00000', type:'test', slot:1 });     //! it should make new entry also.
        expect(await $account.increment('A00000', { type:'test', slot:0 })).toEqual({ _id:'A00000', type:'test', slot:1 });     //! it should return last slot#
        expect(await $account.read('A00000')).toEqual({ _id:'A00000', type:'test', slot:1 });                                   //! it should return last slot#

        //! increment w/ $update
        expect2(await $account.increment('A00000', { slot:0 }, { balance:1000 })).toEqual({ _id:'A00000', slot:1, balance:1000 });
        expect2(await $account.read('A00000')).toEqual({ _id:'A00000', type:'test', slot:1, balance:1000 });

        //! update with increments
        expect2(await $account.update('A00000', {}, { balance: 100 })).toEqual({ _id:'A00000', balance:1100 });
        expect2(await $account.read('A00000')).toEqual({ _id:'A00000', type:'test', slot:1, balance:1100 });
        expect2(await $account.update('A00000', { slot:2 }, { balance: -500 })).toEqual({ _id:'A00000', slot:2, balance:600 });
        expect2(await $account.read('A00000')).toEqual({ _id:'A00000', type:'test', slot:2, balance:600 });

        //! check delete()
        expect2(await $account.delete('A00000'), '_id').toEqual({ _id:'A00000' });
        expect2(await $account.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - _id:A00000');
        expect2(await $account.readOrCreate('A00000', { type:'auto', slot:2 })).toEqual({ _id:'A00000', type:'auto', slot:2 });  //! it should create with model.

        //! error cases.
        expect2(() => $account.increment('', { type:'test', slot:1 })).toEqual('@id is required!');
        expect2(() => $account.increment(' ', { type:'test', slot:1 })).toEqual('@id (string) is required!');
        expect2(() => $account.increment('B00001', null)).toEqual('@item is required!');
        expect2(await $account.increment('B00001', { type:'test', slot:1 })).toEqual({ _id:'B00001', type:'test', slot:1 });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! dynamo storage service. (should be equivalent with `dummy-storage-server`)
    it(`should pass dynamo[${PROFILE}] storage-service`, async done => {
        /* eslint-disable prettier/prettier */
        //! load dynamo storage service.
        expect2(() => new DynamoStorageService<AccountModel>('', [], 'no')).toEqual(`@table (table-name) is required!`);
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name','slot','balance'], 'no');
        expect2(() => $dynamo.hello()).toEqual('dynamo-storage-service:TestTable/no/8');
        expect2(() => $dynamo.fields()).toEqual('balance,id,meta,name,no,slot,stereo,type'.split(','));                         //! must be sorted w/o duplicated

        //! ignore if no profile.
        if (!PROFILE) return done(); //! ignore if no profile.

        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        expect(await $dynamo.save('A00000', { type:'account', ha:'ho' } as AccountModel)).toEqual({ no:'A00000', type:'account' });//! init with property filtering.
        expect(await $dynamo.update('A00000', { stereo:'lemon'})).toEqual({ no:'A00000', stereo:'lemon' });                        //! it will have ONLY update-set.
        expect(await $dynamo.increment('A00000', { slot:1})).toEqual({ no:'A00000', slot:1 });                                     //! auto update for un-defined attribute.
        expect(await $dynamo.increment('A00000', { slot:-2})).toEqual({ no:'A00000', slot:-1 });                                   //! accumulated incremental result.
        expect(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'account', stereo:'lemon', slot: -1 })
        expect(await $dynamo.increment('A00000', { slot:null}).catch(GETERR)).toEqual('.slot (null) should be number!');
        expect(await $dynamo.increment('A00000', { stereo:null}).catch(GETERR)).toEqual({ no: 'A00000', stereo: null});
        expect(await $dynamo.delete('A00000')).toEqual({ no:'A00000', type:'account', stereo:null, slot: -1 });
        expect(await $dynamo.update('A00000', { type:'test' })).toEqual({ no:'A00000', type:'test' });                              //! it should make new entry.
        expect(await $dynamo.delete('A00000')).toEqual({ no:'A00000', type:'test' });
        expect(await $dynamo.increment('A00000', { type:'test', slot:1 })).toEqual({ no:'A00000', type:'test', slot:1 });           //! it should make new entry also.
        expect(await $dynamo.increment('A00000', { type:'test', slot:0 })).toEqual({ no:'A00000', type:'test', slot:1 });           //! it should return last slot#
        expect(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'test', slot:1 });                                         //! it should return last slot#

        //! increment w/ $update
        expect(await $dynamo.increment('A00000', { slot:0 }, { balance:1000 })).toEqual({ no:'A00000', slot:1, balance:1000 });
        expect(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'test', slot:1, balance:1000 });

        //! update with increments
        expect2(await $dynamo.update('A00000', {}, { balance: 100 })).toEqual({ no:'A00000', balance:1100 });
        expect2(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'test', slot:1, balance:1100 });
        expect2(await $dynamo.update('A00000', { slot:2 }, { balance: -500 })).toEqual({ no:'A00000', slot:2, balance:600 });
        expect2(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'test', slot:2, balance:600 });

        //! check delete()
        expect2(await $dynamo.delete('A00000'), 'no').toEqual({ no:'A00000' });
        expect2(await $dynamo.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - no:A00000');
        expect2(await $dynamo.readOrCreate('A00000', { type:'auto', slot:2 })).toEqual({ no:'A00000', type:'auto', slot:2 });        //! it should create with model.
        /* eslint-enable prettier/prettier */
        done();
    });

    //! http storage service.
    it('should pass http storage-service w/ _id', async done => {
        //! load http storage service.
        const endpoint = 'http://localhost:8113'; // [kwonsun]ssocioliving-admin-web
        const type = 'accounts';
        const $storage = new HttpStorageService(endpoint, type);
        const $http = $storage as HttpStorageService<AccountModel>;

        /* eslint-disable prettier/prettier */
        expect2(() => $http.hello()).toEqual(`http-storage-service:${endpoint}/id`);

        //! bypass test if ECONNREFUSED
        // expect2(await $http.read('0').catch(GETERR)).toEqual($U.json({ errno:'ECONNREFUSED', code:'ECONNREFUSED',syscall:'connect',address:'127.0.0.1', port:8113}));
        const ERRCON = await $http.read('0').catch(GETERR);
        if (typeof ERRCON == 'string' && ERRCON.indexOf('"ECONNREFUSED"') >= 0) return done();

        //! make sure deleted.
        await $http.delete('A00000').catch(GETERR);
        await $http.delete('B00001').catch(GETERR);

        expect2(await $http.save('A00000', { type:'account' })).toEqual({ id:'A00000', type:'account' });
        expect2(await $http.save('A00000', { type:'account', name:'ho' })).toEqual({ id:'A00000', type:'account', name:'ho' }); //! it will have ONLY update-set.
        expect2(await $http.update('A00000', { stereo:'lemon' })).toEqual({ id: 'A00000', stereo:'lemon' });
        expect2(await $http.increment('A00000', { slot:1 })).toEqual({ id: 'A00000', slot:1 });
        expect2(await $http.increment('A00000', { slot:-2 })).toEqual({ id: 'A00000', slot:-1 });
        expect2(await $http.increment('A00000', { slot:null }).catch(GETERR)).toEqual('.slot (null) should be number!');
        expect2(await $http.increment('A00000', { stereo:null }).catch(GETERR)).toEqual({ id: 'A00000', stereo: null});
        expect2((await $http.delete('A00000'))).toEqual('A00000');

        expect2(await $http.update('A00000', { type:'test', balance:1 })).toEqual({ id:'A00000', type:'test', balance:1 });  // it should make new entry.
        expect2(await $http.update('A00000', { balance:22 })).toEqual({ id:'A00000', balance:22 });                          //! it should update
        expect2(await $http.read('A00000'), 'id,type,balance').toEqual({ id:'A00000', type:'test', balance:22 });            //! it should have latest value.
        expect2(await $http.delete('A00000')).toEqual('A00000');
        expect2(await $http.increment('A00000', { type:'test', slot:1 })).toEqual({ id:'A00000', type:'test', slot:1 });     //! it should make new entry also.
        expect2(await $http.increment('A00000', { type:'test', slot:0 })).toEqual({ id:'A00000', type:'test', slot:1 });     //! it should return last slot#
        expect2(await $http.read('A00000'),'id,type,slot').toEqual({ id:'A00000', type:'test', slot:1 });                                   //! it should return last slot#

        //! increment w/ $update
        expect2(await $http.increment('A00000', { slot:0 }, { balance:1000 })).toEqual({ id:'A00000', slot:1, balance:1000 });
        expect2(await $http.read('A00000'),'id,type,slot,balance').toEqual({ id:'A00000', type:'test', slot:1, balance:1000 });

        //! update with increments
        expect2(await $http.update('A00000', {}, { balance: 100 })).toEqual({ id:'A00000', balance:1100 });
        expect2(await $http.read('A00000'),'id,type,slot,balance').toEqual({ id:'A00000', type:'test', slot:1, balance:1100 });
        expect2(await $http.update('A00000', { slot:2 }, { balance: -500 })).toEqual({ id:'A00000', slot:2, balance:600 });
        expect2(await $http.read('A00000'),'id,type,slot,balance').toEqual({ id:'A00000', type:'test', slot:2, balance:600 });
        expect2(await $http.update('A00000', { balance:800 }, { balance: -500 })).toEqual({ id:'A00000', balance:100 }); //! priority inc
        expect2(await $http.read('A00000'),'id,type,slot,balance').toEqual({ id:'A00000', type:'test', slot:2, balance:100 });

        //! check delete()
        expect2(await $http.delete('A00000')).toEqual('A00000');
        expect2(await $http.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - id:A00000');
        expect2(await $http.readOrCreate('A00000', { type:'auto', slot:2 })).toEqual({ id:'A00000', type:'auto', slot:2 });  //! it should create with model.

        //! error cases.
        expect2(await $http.increment('', { type:'test', slot:1 }).catch(GETERR)).toEqual('@id is required!');
        expect2(await $http.increment(' ', { type:'test', slot:1 }).catch(GETERR)).toEqual('@id (string) is required!');
        expect2(await $http.increment('B00001', null).catch(GETERR)).toEqual('@item is required!');
        expect2(await $http.increment('B00001', { type:'test', slot:1 }).catch(GETERR)).toEqual({ id:'B00001', type:'test', slot:1 });
        /* eslint-enable prettier/prettier */
        done();
    });
});
