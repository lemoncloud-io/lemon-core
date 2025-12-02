/**
 * `model-manager.spec.js`
 * - specification file for `model-manager`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-06-08 initial import
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { CoreModel } from 'lemon-model';
import {
    CoreModelFilterable,
    GeneralKeyMaker,
    ProxyStorageService,
    StorageMakeable,
    TypedStorageService,
} from './proxy-storage-service';
import { AbstractManager } from './model-manager';
import { expect2, GETERR } from '../../common/test-helper';

//* internal definitions
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

//* create service instance.
export const instance = (table?: string, time?: number) => {
    table = `${table || ''}` || 'dummy-user-data.yml';
    time = time || Date.now();

    const parent = new DummyStorageMaker(table);
    const manager = new UserManager(parent, time);
    return { manager, current: time, table };
};

//! main test body.
describe('ModelManager', () => {
    //* test w/ service
    it('should pass identity and basic functions', async () => {
        const { manager, current, table } = instance();

        expect2(() => table).toBe('dummy-user-data.yml');
        expect2(manager.hello()).toEqual(
            'typed-storage-service:user/proxy-storage-service:dummy-storage-service:dummy-user-data/id',
        );
        expect2(manager.parent.hello()).toEqual('dummy-storage-maker:TT/dummy-user-data.yml');
        expect2(manager.type).toBe('user');
        expect2(manager.current).toBe(current);
    });

    it('should pass read existing model(s)', async () => {
        const { manager } = instance();
        const expected = {
            ns: 'TT',
            type: 'user',
            id: '1',
            uid: 'U0001',
            name: '홍길동',
            age: 32,
            contact: '010-1234-4321',
            active: 1,
        };
        // read from dummy file
        expect2(await manager.retrieve('1').catch(GETERR)).toEqual(expected);
    });

    it('should pass prepare existing and new model(s)', async () => {
        const { manager, current } = instance();
        const expected = {
            ns: 'TT',
            type: 'user',
            id: '1',
            uid: 'U0001',
            name: '홍길동',
            age: 32,
            contact: '010-1234-4321',
            active: 1,
        };
        // prepare existing model
        expect2(await manager.prepare('1', {}, false).catch(GETERR), '!_id').toEqual(expected);
        expect2(await manager.prepare('1', {}, true).catch(GETERR), '!_id').toEqual(expected);
        // prepare new model (default value should be set)
        expect2(await manager.prepare('2', {}, false).catch(GETERR), '!_id').toEqual('404 NOT FOUND - user:2');
        expect2(await manager.prepare('2', {}, true).catch(GETERR), '!_id').toEqual({
            ns: 'TT',
            type: 'user',
            id: '2',
            active: 1,
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });
    });

    it('should pass inserting new model(s)', async () => {
        const { manager, current } = instance();
        // model validation failed (in onBeforeSave())
        expect2(await manager.insert({}).catch(GETERR)).toEqual('.uid is required!');
        expect2(await manager.insert({ uid: 'U0002' }).catch(GETERR)).toEqual('.name is required!');
        // success
        expect2(await manager.insert({ uid: 'U0002', name: '임꺽정' }).catch(GETERR), '!_id,!id').toEqual({
            ns: 'TT',
            type: 'user',
            uid: 'U0002',
            name: '임꺽정',
            active: 1,
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });
        expect2(await manager.insert({ uid: 'U0003', name: '전봉준', active: 0 }).catch(GETERR), '!_id,!id').toEqual({
            ns: 'TT',
            type: 'user',
            uid: 'U0003',
            name: '전봉준',
            active: 0,
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });
    });

    it('should pass updating existing model(s)', async () => {
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
        expect2(await manager.update('1', null, { name: '오함마' }).catch(GETERR), 'name').toBe(
            `.name (오함마) should be number!`,
        );
        // not existing model
        expect2(await manager.retrieve('2').catch(GETERR)).toBe('404 NOT FOUND - user:2');
        expect2(await manager.update('2', { active: 1 }).catch(GETERR)).toBe('404 NOT FOUND - user:2');
    });

    it('should pass updating or inserting model(s)', async () => {
        const { manager, current } = instance();
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 32, active: 1 });
        // update field
        expect2(await manager.updateOrCreate('1', { active: 0 }), 'age,active').toEqual({ age: 32, active: 0 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 32, active: 0 });
        // increment field
        expect2(await manager.updateOrCreate('1', null, { age: 1 }), 'age,active').toEqual({ age: 33, active: 0 });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 33, active: 0 });
        // both update and increment
        expect2(await manager.updateOrCreate('1', { active: 1 }, { age: 1 }), 'age,active').toEqual({
            age: 34,
            active: 1,
        });
        expect2(await manager.retrieve('1').catch(GETERR), 'age,active').toEqual({ age: 34, active: 1 });
        // wrong increment field
        expect2(await manager.update('1', null, { name: '오함마' }).catch(GETERR), 'name').toBe(
            `.name (오함마) should be number!`,
        );
        // not existing model
        const expected = {
            ns: 'TT',
            type: 'user',
            uid: 'U0002',
            name: '오함마',
            active: 0,
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        };
        expect2(await manager.retrieve('2').catch(GETERR)).toBe('404 NOT FOUND - user:2');
        expect2(
            await manager.updateOrCreate('2', { uid: 'U0002', name: '오함마', active: 0 }).catch(GETERR),
            '!_id,!id',
        ).toEqual(expected);
        expect2(await manager.retrieve('2').catch(GETERR), '!_id,!id').toEqual(expected);
    });

    it('should pass deleting existing model(s)', async () => {
        const { manager, current } = instance();
        // hard-delete
        expect2(await manager.insert({ uid: 'U0002', name: '김두한' }).catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000001',
            deletedAt: 0,
        });
        expect2(await manager.retrieve('1000001').catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000001',
            deletedAt: 0,
        });
        expect2(await manager.delete('1000001', true).catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000001',
            deletedAt: 0,
        });
        expect2(await manager.retrieve('1000001').catch(GETERR), 'id, deletedAt').toEqual(
            '404 NOT FOUND - user:1000001',
        );
        // soft-delete
        expect2(await manager.insert({ uid: 'U0003', name: '이만기' }).catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000002',
            deletedAt: 0,
        });
        expect2(await manager.retrieve('1000002').catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000002',
            deletedAt: 0,
        });
        expect2(await manager.delete('1000002', false).catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000002',
            deletedAt: current,
        });
        expect2(await manager.retrieve('1000002').catch(GETERR), 'id,deletedAt').toEqual({
            id: '1000002',
            deletedAt: current,
        });
        // not existing model
        expect2(await manager.delete('1000003').catch(GETERR)).toEqual('404 NOT FOUND - user:1000003');
    });

    //* Test constructor with custom namespace
    it('should pass constructor with custom namespace', async () => {
        class UserManagerWithNS extends AbstractManager<User, DummyStorageMaker, UserType> {
            public constructor(parent: DummyStorageMaker, current?: number) {
                super('user', parent, null, 'uid', 'CUSTOM-NS');
                this.storage.storage.setTimer(() => current || Date.now());
            }

            protected prepareDefault($def: User): User {
                return { active: 1, ...$def };
            }
        }

        const parent = new DummyStorageMaker('dummy-user-data.yml');
        const manager = new UserManagerWithNS(parent, Date.now());
        expect2(manager.NS).toEqual('CUSTOM-NS');
    });

    //* Test constructor without uniqueField
    it('should pass constructor without uniqueField', async () => {
        class UserManagerNoUnique extends AbstractManager<User, DummyStorageMaker, UserType> {
            public constructor(parent: DummyStorageMaker, current?: number) {
                super('user', parent, null, undefined);
                this.storage.storage.setTimer(() => current || Date.now());
            }

            protected prepareDefault($def: User): User {
                return { active: 1, ...$def };
            }
        }

        const parent = new DummyStorageMaker('dummy-user-data.yml');
        const manager = new UserManagerNoUnique(parent, Date.now());
        expect2(manager.$unique).toEqual(null);
    });

    //* Test constructor with null namespace
    it('should pass constructor with null namespace', async () => {
        class UserManagerNullNS extends AbstractManager<User, DummyStorageMaker, UserType> {
            public constructor(parent: DummyStorageMaker, current?: number) {
                super('user', parent, null, 'uid', null);
                this.storage.storage.setTimer(() => current || Date.now());
            }

            protected prepareDefault($def: User): User {
                return { active: 1, ...$def };
            }
        }

        const parent = new DummyStorageMaker('dummy-user-data.yml');
        const manager = new UserManagerNullNS(parent, Date.now());
        expect2(manager.NS).toEqual(null);
    });

    //* Test prepare with empty id
    it('should throw error for empty id in prepare', async () => {
        const { manager } = instance();
        expect2(await manager.prepare('').catch(GETERR)).toEqual('404 NOT FOUND - id is not valid!');
        expect2(await manager.prepare(null).catch(GETERR)).toEqual('404 NOT FOUND - id is not valid!');
        expect2(await manager.prepare(undefined).catch(GETERR)).toEqual('404 NOT FOUND - id is not valid!');
    });

    //* Test insert with null model
    it('should throw error for null model in insert', async () => {
        const { manager } = instance();
        expect2(await manager.insert(null).catch(GETERR)).toEqual('@model (user-model) is required!');
        expect2(await manager.insert(undefined).catch(GETERR)).toEqual('@model (user-model) is required!');
    });

    //* Test retrieve with empty id
    it('should throw error for empty id in retrieve', async () => {
        const { manager } = instance();
        expect2(await manager.retrieve('').catch(GETERR)).toEqual('@id is required - retrieve(user/)');
        expect2(await manager.retrieve(null).catch(GETERR)).toEqual('@id is required - retrieve(user/null)');
        expect2(await manager.retrieve(undefined).catch(GETERR)).toEqual('@id is required - retrieve(user/undefined)');
    });

    //* Test delete with empty id
    it('should throw error for empty id in delete', async () => {
        const { manager } = instance();
        expect2(await manager.delete('').catch(GETERR)).toEqual('@id is required - delete(user/)');
        expect2(await manager.delete(null).catch(GETERR)).toEqual('@id is required - delete(user/null)');
        expect2(await manager.delete(undefined).catch(GETERR)).toEqual('@id is required - delete(user/undefined)');
    });

    //* Test update with empty id
    it('should throw error for empty id in update', async () => {
        const { manager } = instance();
        expect2(await manager.update('', { active: 1 }).catch(GETERR)).toEqual('@id is required - updateModel(user/)');
        expect2(await manager.update(null, { active: 1 }).catch(GETERR)).toEqual(
            '@id is required - updateModel(user/null)',
        );
        expect2(await manager.update(undefined, { active: 1 }).catch(GETERR)).toEqual(
            '@id is required - updateModel(user/undefined)',
        );
    });

    //* Test updateOrCreate with empty id
    it('should throw error for empty id in updateOrCreate', async () => {
        const { manager } = instance();
        expect2(await manager.updateOrCreate('', { uid: 'U0001', name: 'test' }).catch(GETERR)).toEqual(
            '@id is required - updateModel(user/)',
        );
        expect2(await manager.updateOrCreate(null, { uid: 'U0001', name: 'test' }).catch(GETERR)).toEqual(
            '@id is required - updateModel(user/null)',
        );
        expect2(await manager.updateOrCreate(undefined, { uid: 'U0001', name: 'test' }).catch(GETERR)).toEqual(
            '@id is required - updateModel(user/undefined)',
        );
    });

    //* Test insert when storage.insert returns null or no id
    it('should throw error when insert fails to return id', async () => {
        const { manager } = instance();

        // Mock storage.insert to return model without id
        const originalInsert = manager.storage.insert.bind(manager.storage);
        manager.storage.insert = jest.fn().mockResolvedValue({ ns: 'TT', type: 'user' });

        expect2(await manager.insert({ uid: 'U0001', name: 'test' }).catch(GETERR)).toEqual(
            '.id (string) is missing - insert() failed!',
        );

        // Restore
        manager.storage.insert = originalInsert;
    });

    //* Test insert when storage.insert returns null
    it('should throw error when insert returns null', async () => {
        const { manager } = instance();

        // Mock storage.insert to return null
        const originalInsert = manager.storage.insert.bind(manager.storage);
        manager.storage.insert = jest.fn().mockResolvedValue(null);

        expect2(await manager.insert({ uid: 'U0001', name: 'test' }).catch(GETERR)).toEqual(
            '.id (string) is missing - insert() failed!',
        );

        // Restore
        manager.storage.insert = originalInsert;
    });

    //* Test onBeforeSave default implementation
    it('should pass onBeforeSave default implementation', async () => {
        class UserManagerTestSave extends AbstractManager<User, DummyStorageMaker, UserType> {
            public constructor(parent: DummyStorageMaker, current?: number) {
                super('user', parent, null, 'uid');
                this.storage.storage.setTimer(() => current || Date.now());
            }

            protected prepareDefault($def: User): User {
                return { active: 1, ...$def };
            }

            // Don't override onBeforeSave - test default implementation
            public testOnBeforeSave(model: User, origin?: User): User {
                return this.onBeforeSave(model, origin);
            }
        }

        const parent = new DummyStorageMaker('dummy-user-data.yml');
        const manager = new UserManagerTestSave(parent, Date.now());
        const model = { uid: 'U0001', name: 'test' };
        const result = manager.testOnBeforeSave(model);
        expect2(result).toEqual(model);
    });
});
