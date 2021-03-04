/**
 * `model-manager.spec.js`
 * - specification file for `model-manager`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-06-08 initial import
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR } from '../common/test-helper';
import {
    CoreModel,
    CoreModelFilterable,
    GeneralKeyMaker,
    ProxyStorageService,
    StorageMakeable,
    TypedStorageService,
} from './proxy-storage-service';
import { AbstractManager } from './model-manager';

//-------------------------
//! internal definitions
type UserType = 'user';
interface User extends CoreModel<UserType> {
    id?: string;
    uid?: string;
    name?: string;
    age?: number;
    contact?: string;
    active?: 0 | 1;
}
export const UserFields: string[] = ['id', 'uid', 'name', 'age', 'contact', 'active'];

class DummyStorageMaker extends GeneralKeyMaker<UserType> implements StorageMakeable<User, UserType> {
    protected readonly tableName: string;

    public constructor(tableName?: string) {
        super('TT');
        this.tableName = `${tableName || ''}`;
    }

    public hello() {
        return `dummy-storage-maker:${this.NS}/${this.tableName}`;
    }

    public makeStorageService(
        type: UserType,
        fields: string[],
        filter: CoreModelFilterable<User>,
    ): TypedStorageService<User, UserType> {
        const storage = new ProxyStorageService<User, UserType>(this, this.tableName, UserFields, filter, 'id');
        return storage.makeTypedStorageService(type);
    }
}

class UserManager extends AbstractManager<User, DummyStorageMaker, UserType> {
    public constructor(parent: DummyStorageMaker, current?: number) {
        super('user', parent, null, 'uid');
        this.storage.storage.setTimer(() => current || Date.now());
    }

    protected prepareDefault($def: User): User {
        return { active: 1, ...$def };
    }

    public onBeforeSave(model: User, origin?: User): User {
        if (!model.uid && !origin.uid) throw new Error(`.uid is required!`);
        if (!model.name && !origin.name) throw new Error(`.name is required!`);
        return super.onBeforeSave(model, origin);
    }

    public get current(): number {
        return this.storage.storage.getTime();
    }
}

//-------------------------
//! create service instance.
export const instance = (table?: string, time?: number) => {
    table = `${table || ''}` || 'dummy-user-data.yml';
    time = time || Date.now();

    const parent = new DummyStorageMaker(table);
    const manager = new UserManager(parent, time);
    return { manager, current: time };
};

//! main test body.
describe('ModelManager', () => {
    //! test w/ service
    it('should pass identity and basic functions', async done => {
        const { manager, current } = instance();

        /* eslint-disable prettier/prettier */
        expect2(manager.hello()).toEqual('typed-storage-service:user/proxy-storage-service:dummy-storage-service:dummy-user-data/id');
        expect2(manager.parent.hello()).toEqual('dummy-storage-maker:TT/dummy-user-data.yml');
        expect2(manager.type).toBe('user');
        expect2(manager.current).toBe(current);

        done();
    });

    it('should pass read existing model(s)', async done => {
        const { manager } = instance();
        const expected = { ns: 'TT', type: 'user', id: '1', uid: 'U0001', name: '홍길동', age: 32, contact: '010-1234-4321', active: 1 };
        // read from dummy file
        expect2(await manager.retrieve('1').catch(GETERR)).toEqual(expected);
        done();
    });

    it('should pass prepare existing and new model(s)', async done => {
        const { manager, current } = instance();
        const expected = { ns: 'TT', type: 'user', id: '1', uid: 'U0001', name: '홍길동', age: 32, contact: '010-1234-4321', active: 1 };
        // prepare existing model
        expect2(await manager.prepare('1', {}, false).catch(GETERR), '!_id').toEqual(expected);
        expect2(await manager.prepare('1', {}, true).catch(GETERR), '!_id').toEqual(expected);
        // prepare new model (default value should be set)
        expect2(await manager.prepare('2', {}, false).catch(GETERR), '!_id').toEqual('404 NOT FOUND - user:2');
        expect2(await manager.prepare('2', {}, true).catch(GETERR), '!_id').toEqual({ ns: 'TT', type: 'user', id: '2', active: 1, createdAt: current, updatedAt: current, deletedAt: 0 });
        done();
    });

    it('should pass inserting new model(s)', async done => {
        const { manager, current } = instance();
        // model validation failed (in onBeforeSave())
        expect2(await manager.insert({}).catch(GETERR)).toEqual('.uid is required!');
        expect2(await manager.insert({ uid: 'U0002' }).catch(GETERR)).toEqual('.name is required!');
        // success
        expect2(await manager.insert({ uid: 'U0002', name: '임꺽정' }).catch(GETERR), '!_id,!id').toEqual({ ns: 'TT', type: 'user', uid: 'U0002', name: '임꺽정', active: 1, createdAt: current, updatedAt: current, deletedAt: 0 });
        expect2(await manager.insert({ uid: 'U0003', name: '전봉준', active: 0 }).catch(GETERR), '!_id,!id').toEqual({ ns: 'TT', type: 'user', uid: 'U0003', name: '전봉준', active: 0, createdAt: current, updatedAt: current, deletedAt: 0 });
        done();
    });

    it('should pass updating existing model(s)', async done => {
        const { manager } = instance();
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 32, active: 1 });
        // update field
        expect2(await manager.update('1', { active: 0 }), 'age,active').toEqual({ age: 32, active: 0 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 32, active: 0 });
        // increment field
        expect2(await manager.update('1', null, { age: 1 }), 'age,active').toEqual({ age: 33, active: 0 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 33, active: 0 });
        // both update and increment
        expect2(await manager.update('1', { active: 1 }, { age: 1 }), 'age,active').toEqual({ age: 34, active: 1 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 34, active: 1 });
        // wrong increment field
        expect2(await manager.update('1', null, { name: '오함마' }).catch(GETERR), 'name').toBe(`.name (오함마) should be number!`);
        // not existing model
        expect2(await manager.retrieve('2').catch(GETERR)).toBe('404 NOT FOUND - user:2');
        expect2(await manager.update('2', { active: 1 }).catch(GETERR)).toBe('404 NOT FOUND - user:2');
        done();
    });

    it('should pass updating or inserting model(s)', async done => {
        const { manager, current } = instance();
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 32, active: 1 });
        // update field
        expect2(await manager.updateOrCreate('1', { active: 0 }), 'age,active').toEqual({ age: 32, active: 0 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 32, active: 0 });
        // increment field
        expect2(await manager.updateOrCreate('1', null, { age: 1 }), 'age,active').toEqual({ age: 33, active: 0 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 33, active: 0 });
        // both update and increment
        expect2(await manager.updateOrCreate('1', { active: 1 }, { age: 1 }), 'age,active').toEqual({ age: 34, active: 1 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 34, active: 1 });
        // wrong increment field
        expect2(await manager.update('1', null, { name: '오함마' }).catch(GETERR), 'name').toBe(`.name (오함마) should be number!`);
        // not existing model
        const expected = { ns: 'TT', type: 'user', uid: 'U0002', name: '오함마', active: 0, createdAt: current, updatedAt: current, deletedAt: 0 };
        expect2(await manager.retrieve('2').catch(GETERR)).toBe('404 NOT FOUND - user:2');
        expect2(await manager.updateOrCreate('2', { uid: 'U0002', name: '오함마', active: 0 }).catch(GETERR), '!_id,!id').toEqual(expected);
        expect2(await manager.retrieve('2').catch(GETERR), '!_id,!id').toEqual(expected);
        done();
    });

    it('should pass deleting existing model(s)', async done => {
        const { manager, current } = instance();
        // hard-delete
        expect2(await manager.insert({ uid: 'U0002', name: '김두한' }).catch(GETERR), 'id,deletedAt').toEqual({ id: '1000001', deletedAt: 0 });
        expect2(await manager.retrieve('1000001').catch(GETERR), 'id,deletedAt').toEqual({ id: '1000001', deletedAt: 0 });
        expect2(await manager.delete('1000001', true).catch(GETERR), 'id,deletedAt').toEqual({ id: '1000001', deletedAt: 0 });
        expect2(await manager.retrieve('1000001').catch(GETERR), 'id, deletedAt').toEqual('404 NOT FOUND - user:1000001');
        // soft-delete
        expect2(await manager.insert({ uid: 'U0003', name: '이만기' }).catch(GETERR), 'id,deletedAt').toEqual({ id: '1000002', deletedAt: 0 });
        expect2(await manager.retrieve('1000002').catch(GETERR), 'id,deletedAt').toEqual({ id: '1000002', deletedAt: 0 });
        expect2(await manager.delete('1000002', false).catch(GETERR), 'id,deletedAt').toEqual({ id: '1000002', deletedAt: current });
        expect2(await manager.retrieve('1000002').catch(GETERR), 'id,deletedAt').toEqual({ id: '1000002', deletedAt: current });
        // not existing model
        expect2(await manager.delete('1000003').catch(GETERR)).toEqual('404 NOT FOUND - user:1000003');
        done();
    });
});
