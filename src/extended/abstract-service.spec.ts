/**
 * `backend-service.spec.ts`
 * - test for `backend-service`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-03-31 optimize test-spec
 *
 * @origin      see `lemon-accounts-api/src/service/core-service.spec.ts`
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../environ';
import { keys } from 'ts-transformer-keys';
import { CoreModel, NextContext } from '../cores/';
import { expect2, GETERR } from '../common/test-helper';
import { AbstractProxy, CoreManager, CoreService, filterFields, ManagerProxy } from './abstract-service';

/**
 * type: `Model`
 */
export type ModelType = 'test';
export type Model = CoreModel<ModelType>;
export interface TestModel extends Model {
    name?: string;
    test?: number;
    A?: string;
    AB?: string;
    A_B?: string;
    Model?: Model;
    $model?: Model;
}
const TEST_FIELDS = filterFields(typeof keys === 'function' ? keys<TestModel>() : []);

/**
 * class: `BackendService`
 */
export class BackendService extends CoreService<Model, ModelType> {
    public readonly $test: TestModelManager;
    public constructor(tableName?: string, ns?: string) {
        super(tableName, ns);
        this.$test = new TestModelManager(this);
    }
    public hello = (): string => `backend-service:${this.NS}/${this.tableName}`;
    public buildProxy = (context: NextContext) => new BackendProxy(context, this);
    public guardProxy = async <T>(context: NextContext, callback: (proxy: BackendProxy) => Promise<T>): Promise<T> => {
        const proxy = this.buildProxy(context);
        const result = await callback(proxy);
        await proxy.saveAllUpdates();
        return result;
    };
}

/**
 * class: `TestModelManager`
 */
export class TestModelManager extends CoreManager<TestModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('test', parent, TEST_FIELDS);
    }
}

/**
 * class: `BackendProxy`
 * - manager proxy to handle micro-transaction.
 */
export class BackendProxy extends AbstractProxy<ModelType, BackendService> {
    public readonly tests: ManagerProxy<TestModel, TestModelManager, ModelType>;
    public constructor(context: NextContext, service: BackendService, parrallel = 2) {
        super(context, service, parrallel, `carrot:${1 ? 'SS' : service.NS}:race`); //WARN! use prod's data.
        this.tests = new ManagerProxy(this, service.$test);
    }
}

//! create service instance.
export const instance = (type: string = 'dummy') => {
    const current = new Date().getTime();
    const service = new BackendService(type == 'dummy' ? 'dummy-data.yml' : '');
    service.setCurrent(current);
    return { service, current };
};

//! main test body.
describe('core-service', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

    //! basic function
    it('should pass basic function', async done => {
        const { service } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        //! test float number conversion.
        // expect2(() => _FQ(1.555555)).toEqual(1.556);
        // expect2(() => _F3(1.555555)).toEqual(1.556);
        // expect2(() => _F(1.555555)).toEqual(1.556);

        //! test filterFields()
        const isKeys = typeof keys === 'function';
        if (isKeys) {
            expect2(() => filterFields(TEST_FIELDS).join(',')).toEqual(
                'name,test,A,AB,A_B,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id',
            );
            expect2(() => filterFields(TEST_FIELDS, ['test']).join(',')).toEqual(
                'test,name,A,AB,A_B,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id',
            );
        } else {
            //NOTE - improve..
            //@see https://www.npmjs.com/package/ts-transformer-keys
            console.warn('check ts-transformer-keys!');
        }

        //! test CoreService()
        expect2(() => service.dynamoOptions).toEqual({ idName: '_id', tableName: 'dummy-data.yml' });

        //! test CoreManager();
        const { $test } = service;
        expect2(await $test.find('1')).toEqual(null);
        expect2(await $test.exists('1')).toEqual(false);
        expect2(await $test.findByKey('1')).toEqual(null);
        expect2(await $test.getMulti(['1', '1'])).toEqual([null, null]);
        expect2(await $test.getMulti$(['1', '1'])).toEqual({ '1': { id: '1', error: '404 NOT FOUND - test:1' } });

        done();
    });

    //! basic ManagerProxy()
    it('should pass ManagerProxy()', async done => {
        const { service, current } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        expect2(() => service.buildProxy(null).hello()).toEqual('manager-proxy:TT/dummy-data.yml');
        expect2(() => service.buildProxy({}).hello()).toEqual('manager-proxy:TT/dummy-data.yml');

        //! build base model.
        const _base = <T extends Model>(type: ModelType, N?: T): T => ({
            ns: 'TT',
            updatedAt: current,
            createdAt: current,
            deletedAt: 0,
            type,
            ...N,
        });

        //! get w/o default.
        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a');
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:a');
        expect2(await service.$test.find('a')).toEqual(null);

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', true);
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:a');
        expect2(await service.$test.find('a')).toEqual(null);

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', false);
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual(`Cannot set property 'name' of null`);
        expect2(await service.$test.find('a')).toEqual(null);

        //! get w/ default.
        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', {});
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual({
            ..._base('test'),
            id: 'a',
            name: 'hi a',
        });
        expect2(await service.$test.find('a')).toEqual({
            _id: 'TT:test:a',
            ..._base('test'),
            id: 'a',
            name: 'hi a',
        });

        done();
    });
});
