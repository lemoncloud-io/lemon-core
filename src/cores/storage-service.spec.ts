/**
 * `storage-service.spec.js`
 * - unit test for `storage-service`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-26 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { GETERR, expect2, environ } from '../common/test-helper';
import { DynamoStorageService, DummyStorageService, StorageModel } from './storage-service';
import { credentials } from '../tools/';

interface AccountModel extends StorageModel {
    slot?: number;
    balance?: number;
    name?: string;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('StorageService', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    //! dummy storage service.
    it('should pass dummy storage-service', async done => {
        //! load dummy storage service.
        const $storage = new DummyStorageService('ticketing-dummy-data');
        const $account = $storage as DummyStorageService<AccountModel>;
        /* eslint-disable prettier/prettier */
        expect(await $account.hello()).toEqual('dummy-storage-service:memory');
        expect(await $account.read('A00000')).toEqual({ id: 'A00000', type: 'account' });
        expect(await $account.update('A00000', { stereo:'lemon' })).toEqual({ id: 'A00000', stereo:'lemon' });
        expect(await $account.increment('A00000', { slot:1 })).toEqual({ id: 'A00000', slot:1 });
        expect(await $account.increment('A00000', { slot:-2 })).toEqual({ id: 'A00000', slot:-1 });
        expect(await $account.increment('A00000', { slot:null }).catch(GETERR)).toEqual('number is required at key:slot');
        expect(await $account.increment('A00000', { stereo:null }).catch(GETERR)).toEqual({ id: 'A00000', stereo: null});
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        expect(await $account.update('A00000', { type:'test', balance:1 })).toEqual({ id:'A00000', type:'test', balance:1 });  // it should make new entry.
        expect(await $account.update('A00000', { balance:22 })).toEqual({ id:'A00000', balance:22 });                          //! it should update
        expect(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', balance:22 });                               //! it should have latest value.
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        expect(await $account.increment('A00000', { type:'test', slot:1 })).toEqual({ id:'A00000', type:'test', slot:1 });     //! it should make new entry also.
        expect(await $account.increment('A00000', { type:'test', slot:0 })).toEqual({ id:'A00000', type:'test', slot:1 });     //! it should return last slot#
        expect(await $account.read('A00000')).toEqual({ id:'A00000', type:'test', slot:1 });                                   //! it should return last slot#
        expect((await $account.delete('A00000')).id).toEqual('A00000');
        expect2(() => $account.read('A00000')).toEqual('404 NOT FOUND - id:A00000');
        expect(await $account.readOrCreate('A00000', { type:'auto', slot:2 })).toEqual({ id:'A00000', type:'auto', slot:2 });  //! it should create with model.

        //! error cases.
        expect2(() => $account.increment('', { type:'test', slot:1 })).toEqual('@id is required!');
        expect2(() => $account.increment(' ', { type:'test', slot:1 })).toEqual('@id(string) is required!');
        expect2(() => $account.increment('B00001', null)).toEqual('@item is required!');
        expect2(await $account.increment('B00001', { type:'test', slot:1 })).toEqual({ id:'B00001', type:'test', slot:1 });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! dynamo storage service. (should be equivalent with `dummy-storage-server`)
    it(`should pass dynamo[${PROFILE}] storage-service`, async done => {
        if (!PROFILE) return done(); //! ignore if no profile.
        //! load dynamo storage service.
        /* eslint-disable prettier/prettier */
        expect2(() => new DynamoStorageService<AccountModel>('', [], 'no')).toEqual(`@table (table-name) is required!`);
        const $dynamo = new DynamoStorageService<AccountModel>('TestTable', ['name','slot','balance'], 'no');
        expect(await $dynamo.hello()).toEqual('dynamo-storage-service:TestTable/no/7');
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        expect(await $dynamo.save('A00000', { type:'account', ha:'ho' } as AccountModel)).toEqual({ no:'A00000', type:'account' });//! init with property filtering.
        expect(await $dynamo.update('A00000', { stereo:'lemon'})).toEqual({ no:'A00000', stereo:'lemon' });                        //! it will have ONLY update-set.
        expect(await $dynamo.increment('A00000', { slot:1})).toEqual({ no:'A00000', slot:1 });                                     //! auto update for un-defined attribute.
        expect(await $dynamo.increment('A00000', { slot:-2})).toEqual({ no:'A00000', slot:-1 });                                   //! accumulated incremental result.
        expect(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'account', stereo:'lemon', slot: -1 })
        expect(await $dynamo.increment('A00000', { slot:null}).catch(GETERR)).toEqual('number is required at key:slot');
        expect(await $dynamo.increment('A00000', { stereo:null}).catch(GETERR)).toEqual({ no: 'A00000', stereo: null});
        expect(await $dynamo.delete('A00000')).toEqual({ no:'A00000', type:'account', stereo:null, slot: -1 });
        expect(await $dynamo.update('A00000', { type:'test' })).toEqual({ no:'A00000', type:'test' });                              //! it should make new entry.
        expect(await $dynamo.delete('A00000')).toEqual({ no:'A00000', type:'test' });
        expect(await $dynamo.increment('A00000', { type:'test', slot:1 })).toEqual({ no:'A00000', type:'test', slot:1 });           //! it should make new entry also.
        expect(await $dynamo.increment('A00000', { type:'test', slot:0 })).toEqual({ no:'A00000', type:'test', slot:1 });           //! it should return last slot#
        expect(await $dynamo.read('A00000')).toEqual({ no:'A00000', type:'test', slot:1 });                                         //! it should return last slot#
        expect(await $dynamo.delete('A00000')).toEqual({ no:'A00000', type:'test', slot:1 });
        expect2(() => $dynamo.read('A00000')).toEqual('404 NOT FOUND - no:A00000');
        expect(await $dynamo.readOrCreate('A00000', { type:'auto', slot:2 })).toEqual({ no:'A00000', type:'auto', slot:2 });        //! it should create with model.
        /* eslint-enable prettier/prettier */
        done();
    });
});