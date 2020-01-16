/**
 * `proxy-storage-service.spec.js`
 * - common service for `proxy-storage-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-03 migrated via origin accounts-service.js
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, do_parrallel } from '../engine';
import { expect2, GETERR, environ } from '../common/test-helper';
import { DynamoStorageService, DummyStorageService, StorageService } from './storage-service';
import {
    CoreModel,
    ProxyStorageService,
    GeneralKeyMaker,
    GeneralModelFilter,
    CORE_FIELDS,
    CoreKeyMakeable,
    CoreModelFilterable,
    UniqueFieldManager,
    ModelUtil,
} from './proxy-storage-service';
import { credentials } from '../tools/shared';

//-------------------------
//! internal definitions
export type MyType = '' | 'test';

export interface MyModel extends CoreModel<MyType> {
    name?: string;
    count?: number;
}
const FIELDS = 'name,count'.split(',');
class MyService extends GeneralKeyMaker<MyType> {
    public constructor() {
        super('TT', ':');
    }
    public hello = () => `my-test-service:${this.NS}`;
}

//! sample to filter model
class MyModelFilter extends GeneralModelFilter<MyModel, MyType> {
    public constructor() {
        super(FIELDS);
    }
    public onBeforeSave(model: MyModel, origin: MyModel): MyModel {
        model = super.onBeforeSave(model, origin);
        //! conversion data-type.
        if (model.count !== undefined) model.count = $U.N(model.count, 0);
        return model;
    }
}
//! override of ProxyStorageService to have constant asTime()
class MyStorage extends ProxyStorageService<MyModel, MyType> {
    public readonly NOW: number;
    public constructor(
        service: CoreKeyMakeable<MyType>,
        storage: StorageService<MyModel>,
        filters: CoreModelFilterable<MyModel>,
        current: number,
    ) {
        super(service, storage, FIELDS, filters);
        this.NOW = current;
    }
    public asTime(ts?: number) {
        if (ts !== undefined) return super.asTime(ts);
        const createdAt = this.NOW + 10;
        const updatedAt = this.NOW + 100;
        const deletedAt = this.NOW + 1000;
        return { createdAt, updatedAt, deletedAt };
    }
}

//-------------------------
//! create service instance.
export const instance = (table?: string, time?: number) => {
    const service = new MyService();
    const filters = new MyModelFilter();
    const current = time || new Date().getTime();
    const storage: ProxyStorageService<MyModel, MyType> = new MyStorage(
        service,
        ProxyStorageService.makeStorageService(table, FIELDS),
        filters,
        current,
    );
    const storage2: ProxyStorageService<MyModel, MyType> = ProxyStorageService.create(service, table, FIELDS);
    return { service, filters, storage, current, storage2 };
};

//! main test body.
describe('ProxyStorageService', () => {
    console.info('! env.PROFILE =', environ('PROFILE'));
    const PROFILE = credentials(environ('PROFILE'));

    //! test w/ service
    it('should pass basic service', async done => {
        const { service, current, storage, storage2 } = instance('dummy-account-data.yml');

        /* eslint-disable prettier/prettier */
        expect2(storage.hello()).toEqual('proxy-storage-service:dummy-storage-service:dummy-account-data/_id');
        expect2(storage2.hello()).toEqual('proxy-storage-service:dummy-storage-service:dummy-account-data/_id');

        expect2(service.asKey$('test', 'AAA')).toEqual({ ns:'TT', type:'test', id:'AAA', _id:'TT:test:AAA' });

        //! check basic functions
        expect2(service.asKey$('test','1:23:45'), '_id').toEqual({ _id:'TT:test:1-23-45' });
        expect2(service.asKey$('test','1:23:45'), '_id').toEqual({ _id:'TT:test:1-23-45' });
        expect2(service.asKey$('test','1:23:45')).toEqual({ ns:'TT', type:'test', id:'1:23:45', _id:'TT:test:1-23-45' });

        expect2(storage.asTime()).toEqual({ createdAt: current + 10, updatedAt: current + 100, deletedAt: current + 1000 });
        expect2(storage.asTime(current)).toEqual({ createdAt: current, updatedAt: current, deletedAt: current });

        //! check fields count.
        expect2(CORE_FIELDS.length).toEqual(11);
        expect2(FIELDS.length).toEqual(2);

        /* eslint-enable prettier/prettier */
        done();
    });

    //! builder to test main service by type
    const build_test_scenario_by_type = (type: 'dummy' | 'dynamo') => async (done: any) => {
        const { service, storage, current } = instance(type == 'dummy' ? 'dummy-account-data.yml' : 'TestCoreTable');

        /* eslint-disable prettier/prettier */
        //! check type of internal storage.
        expect2(storage.storage instanceof DummyStorageService).toEqual(type == 'dummy' ? true : false);
        expect2(storage.storage instanceof DynamoStorageService).toEqual(type == 'dummy' ? false : true);
        //! check common functions.
        expect2(storage.asKey('test','1:23:45')).toEqual('TT:test:1-23-45')

        //! check basic foot-print.
        expect2(service.asKey$('test', 'AAA')).toEqual({ ns:'TT', type:'test', id:'AAA', _id:'TT:test:AAA' });
        if (type == 'dummy'){
            expect2(storage.hello()).toEqual('proxy-storage-service:dummy-storage-service:dummy-account-data/_id');
        } else {
            //! check count of fields
            const FIELD_COUNT = 5 + CORE_FIELDS.length + FIELDS.length - 2; // `type,meta` is common w/ StorageModel.
            expect2(storage.hello()).toEqual(`proxy-storage-service:dynamo-storage-service:TestCoreTable/_id/${FIELD_COUNT}`);
            //! ignore if no profile loaded.
            if (!PROFILE) return done();
        }

        //! define constants to test..
        const createdAt = current + 10;
        const updatedAt = current + 100;
        const deletedAt = current + 1000;
        expect2(storage.asTime()).toEqual({ createdAt, updatedAt, deletedAt });

        //! delete old, and check next-seq
        await storage.clearSeq('test').catch(GETERR);
        expect2(await storage.doRead('sequence' as MyType, '').catch(GETERR)).toEqual('@id (model-id) is required!');
        expect2(await storage.doRead('sequence' as MyType, 'test').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:sequence:test');
        expect2(await storage.nextSeq('test')).toEqual(1000001);
        expect2(await storage.nextSeq('test')).toEqual(1000002);

        expect2((await storage.nextUuid()).length).toEqual('d01764cd-9ef2-41e2-9e88-68e79555c979'.length);
        expect2((await storage.nextUuid()).split('-').length).toEqual('d01764cd-9ef2-41e2-9e88-68e79555c979'.split('-').length);

        //! check auto create on read().
        await storage.doDelete('test', 'aaa').catch(GETERR);
        expect2(await storage.doRead('test', 'aaa').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:aaa');        // BE SURE 404
        expect2(await storage.doRead('test', 'aaa', { stereo: 'a' }), 'id,stereo').toEqual({ id:'aaa', stereo:'a' }); // AUTO CREATE
        expect2(await storage.doRead('test', 'aaa', { stereo: 'b' }), 'id,stereo').toEqual({ id:'aaa', stereo:'a' }); // DO NOT UPDATE
        expect2(await storage.doRead('test', 'aaa'), '_id,stereo').toEqual({ _id:'TT:test:aaa', stereo:'a' });        // READ BACK

        //! check auto create on update().
        await storage.doDelete('test', 'bbb').catch(GETERR);
        expect2(await storage.doUpdate('test', 'bbb', { stereo:'b' })).toEqual({ _id:'TT:test:bbb', stereo:'b', updatedAt });
        expect2(await storage.doRead('test', 'bbb')).toEqual({ _id:'TT:test:bbb', stereo:'b', updatedAt });

        //! use typed-model-service.
        const $test = storage.makeTypedStorageService('test');
        const $user = storage.makeTypedStorageService('user' as MyType);
        expect2(await $test.read('aaa'), '_id,stereo').toEqual({ _id:'TT:test:aaa', stereo:'a' });
        expect2(await $test.read('bbb'), '!updatedAt').toEqual({ _id:'TT:test:bbb', stereo:'b' });
        expect2(await $user.read('aaa').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:user:aaa');

        //! test storage-service
        if (1){
            const id = 'a01';
            const $key = service.asKey$('test', id);
            const _id = $key._id;
            await $test.delete(id).catch(GETERR);

            //! test base CRUD with typed-storage-service.
            expect2(await $test.read(id).catch(GETERR)).toEqual(`404 NOT FOUND - _id:${_id}`);        // BE SURE 404
            expect2(await $test.readOrCreate(id, { name:'bob' }).catch(GETERR)).toEqual({ _id, id, name:'bob', ns:'TT', type:'test', createdAt, updatedAt, deletedAt:0 });
            expect2(await $test.update(id, { count:2 })).toEqual({ _id, count: 2, updatedAt });
            expect2(await $test.update(id, { count:2 })).toEqual({ _id, count: 2, updatedAt });
            expect2(await $test.increment(id, { count:2 })).toEqual({ _id, count: 4, updatedAt });
            expect2(await $test.delete(id)).toEqual({ _id, id, name:'bob', ns:'TT', type:'test', count:4, createdAt, updatedAt, deletedAt:0 });
            expect2(await $test.insert({ name:'col' }), 'id,name').toEqual({ id:'1000003', name:'col' });

            //! test lock
            expect2(await $test.lock(0, 1).catch(GETERR)).toEqual('@id (model-id) is required!');
            expect2(await $test.lock(id, -1).catch(GETERR)).toEqual('@tick (-1) is not valid!');
            expect2(await $test.lock(id, 1, 0).catch(GETERR)).toEqual('@interval (0) is not valid!');
            expect2(await $test.lock(id, 1).catch(GETERR)).toEqual(true);
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:1, name:undefined });       // AUTO CREATED!!!
            expect2(await $test.release(id).catch(GETERR)).toEqual(true);
            expect2(await $test.release(0).catch(GETERR)).toEqual('@id (model-id) is required!');
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, name:undefined });       // lock := 0
            expect2(await $test.update(id, { lock: 2 }).catch(GETERR)).toEqual({ _id, lock:2, updatedAt });
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:2, updatedAt });
            expect2(await $test.lock(id, 1, 10).catch(GETERR)).toEqual('400 TIMEOUT - model[TT:test:a01].lock = 4'); // +2 cycle waiting.
            expect2(await $test.lock(id, 0, 10).catch(GETERR)).toEqual('400 TIMEOUT - model[TT:test:a01].lock = 5'); // +1 cycle waiting.
        }

        //! test guard() with async function.
        if (1) {
            const id = 'a01';
            const $key = service.asKey$('test', id);
            const _id = $key._id;
            expect2(await $test.update(id, { lock: 5 }).catch(GETERR)).toEqual({ _id, lock:5, updatedAt });                 // rest lock := 5
            const func = (i: number) => async () => {
                if (i <= 0) throw new Error(`@i (${i}) should be > 0!`)
                return { i }
            }
            expect2(await $test.guard(id, func(3), 0, 10).catch(GETERR)).toEqual('400 TIMEOUT - model[TT:test:a01].lock = 6'); // +1 cycle waiting.
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:6, updatedAt });
            expect2(await $test.update(id, { lock: 0 }).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });                 // reset lock
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });
            expect2(await $test.guard(id, func(3), 0, 10).catch(GETERR)).toEqual({ i: 3 });                                 // success
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });
            expect2(await $test.guard(id, func(-1), 0, 10).catch(GETERR)).toEqual('@i (-1) should be > 0!');                // error in func().
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });
        }

        //! test guard() with normal function.
        if (1) {
            const id = 'a01';
            const $key = service.asKey$('test', id);
            const _id = $key._id;
            expect2(await $test.update(id, { lock: 5 }).catch(GETERR)).toEqual({ _id, lock:5, updatedAt });                 // rest lock := 5
            const func = (i: number) => () => {
                if (i <= 0) throw new Error(`@i (${i}) should be > 0!`)
                return { i }
            }
            expect2(await $test.guard(id, func(3), 0, 10).catch(GETERR)).toEqual('400 TIMEOUT - model[TT:test:a01].lock = 6'); // +1 cycle waiting.
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:6, updatedAt });
            expect2(await $test.update(id, { lock: 0 }).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });                 // reset lock
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });
            expect2(await $test.guard(id, func(3), 0, 10).catch(GETERR)).toEqual({ i: 3 });                                 // success
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });
            expect2(await $test.guard(id, func(-1), 0, 10).catch(GETERR)).toEqual('@i (-1) should be > 0!');                // error in func().
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });

            //! in parrallel........
            const list = [1,-1,2,0,5,3];
            const expected = list.map(i => i <= 0 ? `@i (${i}) should be > 0!` : { i });
            expect2(await do_parrallel(list, (i) => $test.guard(id, func(i), 100, 10).catch(GETERR))).toEqual(expected);
            expect2(await $test.read(id).catch(GETERR)).toEqual({ _id, lock:0, updatedAt });
        }

        //! basic CRUD.
        if (1){
            const id = 'bbb';
            const $key = service.asKey$('test', id);
            const _id = $key._id;
            await $test.delete(id).catch(GETERR);
            expect2(await $test.read(id).catch(GETERR)).toEqual(`404 NOT FOUND - _id:${_id}`);        // BE SURE 404
            expect2(await $test.save('', { name:'bob' }).catch(GETERR)).toEqual('@id (model-id) is required!');
            expect2(await $test.save(id, { name:'bob' }).catch(GETERR)).toEqual({ _id, id, ns:'TT', type:'test', name:'bob', createdAt, updatedAt: createdAt, deletedAt:0 }); // created!
            expect2(await $test.read(id).catch(GETERR), 'id,name,createdAt,updatedAt').toEqual({ id, name:'bob', createdAt, updatedAt: createdAt });

            expect2(await $test.save(id, { name:'bob' }).catch(GETERR)).toEqual({ _id });                                   // nothing to save
            expect2(await $test.save(id, { name:'guk' }).catch(GETERR)).toEqual({ _id, name:'guk', updatedAt });            // updated.
            expect2(await $test.save(id, { count:'1' } as any).catch(GETERR)).toEqual({ _id, count:1, updatedAt });         // type conversion to number
            expect2(await $test.save(id, { tick:0 } as any).catch(GETERR)).toEqual({ _id, meta:{ tick:0 }, updatedAt });    // meta save.
            expect2(await $test.read(id).catch(GETERR), 'id,name,meta,createdAt,updatedAt').toEqual({ id, name:'guk', meta:{ tick:0 }, createdAt, updatedAt });

            //! overwrite meta.
            expect2(await $test.save(id, { meta:'' }).catch(GETERR)).toEqual({ _id, meta:null, updatedAt });                // clear meta
            expect2(await $test.read(id).catch(GETERR), 'id,name,meta,createdAt,updatedAt').toEqual({ id, name:'guk', meta:null, createdAt, updatedAt });

            //! test lock
            expect2(await $test.lock(id, 1).catch(GETERR)).toEqual(true);
            expect2(await $test.read(id).catch(GETERR), '_id,lock,name').toEqual({ _id, lock:1, name:'guk' });              // lock field is created
            expect2(await $test.release(id).catch(GETERR)).toEqual(true);
            expect2(await $test.read(id).catch(GETERR), '_id,lock,name').toEqual({ _id, lock:0, name:'guk' });

            //! internal fields
            expect2(await $test.save(id, { COUNT:'1' } as any).catch(GETERR)).toEqual({ _id, meta:{ COUNT:'1' }, updatedAt });// constant member
            expect2(await $test.save(id, { Count:'A' } as any).catch(GETERR)).toEqual({ _id });                               // ignore Object Name
            expect2(await $test.save(id, { createdAt:2 } as any).catch(GETERR)).toEqual({ _id });                             // ignore internal name
            expect2(await $test.save(id, { updatedAt:3 } as any).catch(GETERR)).toEqual({ _id });                             // ignore internal name
            expect2(await $test.save(id, { updatedAt:4 } as any).catch(GETERR)).toEqual({ _id });                             // ignore internal name
            expect2(await $test.save(id, { _key:4 } as any).catch(GETERR)).toEqual({ _id });                                  // ignore internal name
            expect2(await $test.save(id, { $key:5 } as any).catch(GETERR)).toEqual({ _id });                                  // ignore internal name

            //! not destroy
            expect2(await $test.delete(id, false).catch(GETERR)).toEqual({ _id, updatedAt, deletedAt });
            expect2(await $test.read(id).catch(GETERR), 'id,name,createdAt,updatedAt,deletedAt').toEqual({ id, name:'guk', createdAt, updatedAt,deletedAt });

            //! internal object
            expect2(await storage.save(_id, { name:{ a:1 }} as any).catch(GETERR)).toEqual({ _id:'TT:test:bbb', name:{ a:1 } });
            expect2(await storage.read(_id).catch(GETERR), '_id,name').toEqual({ _id, name:{ a:1 } });
            expect2(await $test.save(id, { name:{ a:1 }} as any).catch(GETERR)).toEqual({ _id });
        }

        /* eslint-enable prettier/prettier */
        done();
    };

    //! test w/ dummy storage.
    it('should pass service w/ dummy-storage', build_test_scenario_by_type('dummy'));

    //! test w/ dynamo service.
    it('should pass service w/ dynamo-storage', build_test_scenario_by_type('dynamo'));

    //! test ModelUtil.
    it('should pass ModelUtil functions', async done => {
        //! test pop();
        const data: any = { a: 1, c: '2' };
        expect2(() => Object.keys(data)).toEqual(['a', 'c']);
        expect2(() => data.pop('a')).toEqual('data.pop is not a function');

        const data2: any = ModelUtil.buildPop({ ...data }, '$pop');
        expect2(() => Object.keys(data2)).toEqual(['a', 'c', '$pop']);
        expect2(() => ModelUtil.buildPop(data2, '$pop')).toEqual('.[$pop] is duplicated!');
        expect2(() => data2.$pop('a')).toEqual(1);
        expect2(() => Object.keys(data2)).toEqual(['c', '$pop']);
        expect2(() => data2.$pop('c')).toEqual('2');
        expect2(() => data2.$pop('c')).toEqual(undefined);
        expect2(() => data2.$pop('c', 1)).toEqual(1);
        expect2(() => data2.$pop('c', 'x')).toEqual('x');
        expect2(() => Object.keys(data2)).toEqual(['$pop']);
        expect2(() => data2.$pop()).toEqual({});
        expect2(() => Object.keys(data2)).toEqual([]);
        expect2(() => data2.$pop()).toEqual('data2.$pop is not a function');

        const data3: any = ModelUtil.buildPop({ ...data }, 'pop');
        expect2(() => Object.keys(data3)).toEqual(['a', 'c', 'pop']);
        expect2(() => data3.$pop('a')).toEqual('data3.$pop is not a function');
        expect2(() => data3.pop('a')).toEqual(1);
        expect2(() => Object.keys(data3)).toEqual(['c', 'pop']);
        expect2(() => data3.pop('c')).toEqual('2');
        expect2(() => Object.keys(data3)).toEqual(['pop']);
        expect2(() => data3.pop()).toEqual({});
        expect2(() => Object.keys(data3)).toEqual([]);
        expect2(() => data3.pop()).toEqual('data3.pop is not a function');

        done();
    });

    //! dummy storage service.
    it('should pass UniqueFieldManager', async done => {
        //! make instance..
        const prepare = async (type: 'dummy' = 'dummy') => {
            /* eslint-disable prettier/prettier */
            const { service, storage: $storage } = instance(type == 'dummy' ? 'dummy-account-data.yml' : 'TestCoreTable');

            expect2(service.hello()).toEqual('my-test-service:TT');
            expect2($storage.hello()).toEqual('proxy-storage-service:dummy-storage-service:dummy-account-data/_id');

            const $test = $storage.makeTypedStorageService('test');
            expect2(await $test.read('A00000').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:A00000'); //TODO - imporove dummy-storage to support typed manager.

            const storage = $test;
            const $unique = new UniqueFieldManager($test);
            expect2($unique.hello()).toEqual('unique-field-manager:test/name:typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-account-data/_id');

            //! make 'aaa', no lookup
            expect2(await storage.save('aaa', { name:'AAA' }), '!_id,!createdAt,!updatedAt').toEqual({ ns:'TT', type:'test', id:'aaa', name:'AAA', deletedAt:0 });
            expect2(await storage.save('bbb', { name:'BBB' }), '!_id,!createdAt,!updatedAt').toEqual({ ns:'TT', type:'test', id:'bbb', name:'BBB', deletedAt:0 });
            expect2(await storage.read('aaa'),                 '!_id,!createdAt,!updatedAt').toEqual({ ns:'TT', type:'test', id:'aaa', name:'AAA', deletedAt:0 });
            expect2(await storage.read('bbb'),                 '!_id,!createdAt,!updatedAt').toEqual({ ns:'TT', type:'test', id:'bbb', name:'BBB', deletedAt:0 });

            const ID_AAA = $unique.asLookupId('aaa');
            const ID_BBB = $unique.asLookupId('bbb');
            expect2(await storage.read(ID_AAA).catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:#test/aaa');
            expect2(await storage.read(ID_BBB).catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:#test/bbb');
            return { service, storage, $unique };
            /* eslint-enable prettier/prettier */
        };

        /* eslint-disable prettier/prettier */
        if (1) {
            const { storage, $unique } = await prepare();

            //! findOrCreate() w/o $creates
            expect2(await $unique.findOrCreate('AAA').catch(GETERR)).toEqual('404 NOT FOUND - test:name/AAA');
            expect2(await $unique.findOrCreate('AAA', {}).catch(GETERR), 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' });
            expect2(await $unique.findOrCreate('AAA', {}).catch(GETERR), 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' });
            expect2(await storage.delete('1000001', true).catch(GETERR), 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' });
            expect2(await storage.delete('1000001', true).catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:1000001');
            expect2(await $unique.findOrCreate('AAA').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000001');

            //! findOrCreate() w/ $creates(id=XYZ)
            expect2(await $unique.findOrCreate('BBB').catch(GETERR)).toEqual('404 NOT FOUND - test:name/BBB');
            expect2(await $unique.findOrCreate('BBB', { id:'XYZ', name:'AAA' }).catch(GETERR), 'id,type,name').toEqual('@name (BBB) is not same as (AAA)!');
            expect2(await $unique.findOrCreate('BBB', { id:'XYZ', name:'BBB' }).catch(GETERR), 'id,type,name').toEqual({ id:'XYZ', type:'test', name:'BBB' });
            expect2(await $unique.findOrCreate('BBB', { id:'XYZ', name:'BBB' }).catch(GETERR), 'id,type,name').toEqual({ id:'XYZ', type:'test', name:'BBB' });
            expect2(await storage.delete('XYZ', true).catch(GETERR), 'id,type,name').toEqual({ id:'XYZ', type:'test', name:'BBB' });
            expect2(await storage.delete('XYZ', true).catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:XYZ');
            expect2(await $unique.findOrCreate('BBB', { id:'XYZ', name:'BBB' }).catch(GETERR), 'id,type,name').toEqual({ id:'XYZ', type:'test', name:'BBB' });

            //! findOrCreate() w/ $creates(id=)
            expect2(await $unique.findOrCreate('CCC').catch(GETERR)).toEqual('404 NOT FOUND - test:name/CCC');
            expect2(await $unique.findOrCreate('CCC', { id:'', name:'AAA' }).catch(GETERR), 'id,type,name').toEqual('@name (CCC) is not same as (AAA)!');
            expect2(await $unique.findOrCreate('CCC', { id:'', name:'CCC' }).catch(GETERR), 'id,type,name').toEqual({ id:'1000002', type:'test', name:'CCC' });
            expect2(await $unique.findOrCreate('CCC', { id:'', name:'CCC' }).catch(GETERR), 'id,type,name').toEqual({ id:'1000002', type:'test', name:'CCC' });
            expect2(await storage.delete('1000002', true).catch(GETERR), 'id,type,name').toEqual({ id:'1000002', type:'test', name:'CCC' });
            expect2(await storage.delete('1000002', true).catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:1000002');
            expect2(await $unique.findOrCreate('CCC', { id:'', name:'CCC' }).catch(GETERR), 'id,type,name').toEqual({ id:'1000002', type:'test', name:'CCC' });

            //! findOrCreate() w/ $creates()
            expect2(await $unique.findOrCreate('DDD').catch(GETERR)).toEqual('404 NOT FOUND - test:name/DDD');
            expect2(await $unique.findOrCreate('DDD', { name:'AAA' }).catch(GETERR), 'id,type,name').toEqual('@name (DDD) is not same as (AAA)!');
            expect2(await $unique.findOrCreate('DDD', { name:'DDD' }).catch(GETERR), 'id,type,name').toEqual({ id:'1000003', type:'test', name:'DDD' });
            expect2(await $unique.findOrCreate('DDD', { name:'DDD' }).catch(GETERR), 'id,type,name').toEqual({ id:'1000003', type:'test', name:'DDD' });
            expect2(await storage.delete('1000003', true).catch(GETERR), 'id,type,name').toEqual({ id:'1000003', type:'test', name:'DDD' });
            expect2(await storage.delete('1000003', true).catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:1000003');
            expect2(await $unique.findOrCreate('DDD', { name:'DDD' }).catch(GETERR), 'id,type,name').toEqual({ id:'1000003', type:'test', name:'DDD' });
        }

        if (1) {
            const { storage, $unique } = await prepare();

            const aaa = await storage.read('aaa');
            const bbb = await storage.read('bbb');

            //! updateLookup() w/o value
            expect2(await storage.read($unique.asLookupId('AAA')).catch(GETERR), 'id,type,stereo,meta').toEqual('404 NOT FOUND - _id:TT:test:#test/AAA');
            expect2(await $unique.updateLookup(aaa).catch(GETERR), 'id,type,name').toEqual({ id:'aaa', type:'test', name:'AAA' });
            expect2(await storage.read($unique.asLookupId('AAA')).catch(GETERR), 'id,type,stereo,meta').toEqual({ id:'#test/AAA', type:'test', stereo:'#', meta:'aaa' });

            //! try to change name to 'BBB'
            expect2(await $unique.updateLookup({ ...aaa }, 'BBB').catch(GETERR), 'id,type,name').toEqual('@name (BBB) is not same as (AAA)!');                              // change to 'BBB' w/o changing model.
            expect2(await $unique.updateLookup({ ...aaa, name:'BBB' }, 'BBB').catch(GETERR), 'id,type,name').toEqual({ id:'aaa', type:'test', name:'BBB' });                // change to 'BBB' w/o changing model.
            expect2(await storage.read($unique.asLookupId('AAA')).catch(GETERR), 'id,type,stereo,meta').toEqual({ id:'#test/AAA', type:'test', stereo:'#', meta:'aaa' });   // occupied
            expect2(await storage.read($unique.asLookupId('BBB')).catch(GETERR), 'id,type,stereo,meta').toEqual({ id:'#test/BBB', type:'test', stereo:'#', meta:'aaa' });   // newly created..

            //! try to update another to 'bbb'
            expect2(await $unique.updateLookup({ ...bbb }, 'BBB').catch(GETERR), 'id,type,name').toEqual('400 DUPLICATED NAME - name[BBB] is duplicated to test[aaa]');     // change to 'BBB' w/o changing model.
        }

        /* eslint-enable prettier/prettier */
        done();
    });
});
