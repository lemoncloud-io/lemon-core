/**
 * `abstract-service.spec.ts`
 * - test for `abstract-service`
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
import { CoreModel, NextContext, SearchBody } from '../cores/';
import { expect2, GETERR } from '../common/test-helper';
import { $U } from '../engine';
import {
    $ES6,
    _ES6,
    AbstractProxy,
    CoreManager,
    CoreService,
    Elastic6SearchParams,
    filterFields,
    ManagerProxy,
} from './abstract-service';
import { asyncCredentials } from '../tools';
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
const TEST_FIELDS = filterFields(keys<TestModel>());

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

//* create service instance.
export const instance = (type: string = 'dummy') => {
    const current = new Date().getTime();
    const service = new BackendService(type == 'dummy' ? 'dummy-data.yml' : '');
    service.setCurrent(current);
    return { service, current };
};

//! main test body.
describe('abstract-service', () => {
    //* use like `const PROFILE = await $PROFILE` in each test.
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* basic function
    it('should pass basic function', async () => {
        const { service } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        //* test filterFields()
        const isKeys = true;
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

        //* test CoreService()
        expect2(() => service.dynamoOptions).toEqual({ idName: '_id', tableName: 'dummy-data.yml' });

        //* test CoreManager();
        const { $test } = service;
        expect2(await $test.find('1')).toEqual(null);
        expect2(await $test.exists('1')).toEqual(false);
        expect2(await $test.findByKey('1')).toEqual(null);
        expect2(await $test.getMulti(['1', '1'])).toEqual([null, null]);
        expect2(await $test.getMulti$(['1', '1'])).toEqual({ '1': { id: '1', error: '404 NOT FOUND - test:1' } });
    });

    //* basic ManagerProxy()
    it('should pass ManagerProxy()', async () => {
        const { service, current } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        expect2(() => service.buildProxy(null).hello()).toEqual('manager-proxy:TT/dummy-data.yml');
        expect2(() => service.buildProxy({}).hello()).toEqual('manager-proxy:TT/dummy-data.yml');

        //* build base model.
        const _base = <T extends Model>(type: ModelType, N?: T): T => ({
            ns: 'TT',
            updatedAt: current,
            createdAt: current,
            deletedAt: 0,
            type,
            ...N,
        });

        //* get w/o default.
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
                    // must be null.
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual(`Cannot set properties of null (setting 'name')`);
        expect2(await service.$test.find('a')).toEqual(null);

        //* get w/ default.
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
    });

    //* check of `$ES6`
    it('should pass $ES6', async () => {
        expect2(() => $ES6.hello()).toEqual('Elastic6Instance');

        //* check environment
        expect2(() => $U.env('ES6_ENDPOINT', '')).toEqual('');
        expect2(() => $U.env('ES6_INDEX', '')).toEqual('');

        //* the search options.
        expect2(() => $ES6.options).toEqual(null);

        const $X = $ES6.$X;
        const describe = $X.describeEndpointUrl;

        expect2(() => describe(null, { errScope: 'test' })).toEqual('@url(string) is required - test');
        expect2(() => describe('/')).toEqual('@url[/] is invalid (no http) - describeEndpointUrl()');
        expect2(() => describe('/abc')).toEqual('@url[/abc] is invalid (no http) - describeEndpointUrl()');

        //* internal VPC
        if (1) {
            const url1 = `https://vpc-xyz.aos.ap-northeast-2.on.aws`;
            expect2(() => describe(url1), '!host').toEqual({
                protocol: 'https',
                port: 443,
                isTunnel: false,
                isProxy: false,
            });
        }
        //* public VPC
        if (1) {
            const url1 = `https://vpc-xyz.ap-northeast-2.es.amazonaws.com:444`;
            expect2(() => describe(url1)).toEqual({
                protocol: 'https',
                host: 'vpc-xyz.ap-northeast-2.es.amazonaws.com',
                port: 444,
                isTunnel: false,
                isProxy: false,
            });
        }
        //* public execute-api
        if (1) {
            const url1 = `http://xyz.execute-api.ap-northeast-2.amazonaws.com/dev`;
            expect2(() => describe(url1), '!host').toEqual({
                protocol: 'http',
                port: 80,
                isTunnel: false,
                isProxy: true,
                region: 'ap-northeast-2',
            });
        }
        //* some search-proxy
        if (1) {
            const url1 = `//zzz.execute-api.ap-northeast-2.amazonaws.com/dev/search/0/proxy`;
            expect2(() => describe(url1), '!host').toEqual({
                protocol: 'https',
                port: 443,
                isTunnel: false,
                isProxy: true,
                region: 'ap-northeast-2',
            });
        }
        //* tunneling (or local)
        if (1) {
            const url1 = `https://localhost:8683`;
            expect2(() => describe(url1)).toEqual({
                protocol: 'https',
                port: 8683,
                host: 'localhost',
                isTunnel: true,
                isProxy: false,
            });
        }
    });

    //* check of createHttpSearchProxy()
    it('should pass $ES6.$X.createHttpSearchProxy()', async () => {
        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        // use `lemon-hello-api` in prod.
        const endpoint = `https://hg9errxv25.execute-api.ap-northeast-2.amazonaws.com/prod`;
        const $X = $ES6.$X;
        const credentials = await asyncCredentials(PROFILE);
        const proxy = $X.createHttpSearchProxy(endpoint, { credentials });

        // GET method test
        expect2(
            await proxy
                .doProxy('GET', undefined)
                .then((s: string) => s.split('\n').map(s => s.split('/')[0]))
                .catch(GETERR),
        ).toEqual(['lemon-hello-api', 'lemon-core']);

        expect2(await proxy.doProxy('GET', 'hello', '1').catch(GETERR)).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('POST', 'hello', 'echo').catch(GETERR), 'id,cmd,param').toEqual({
            id: '!',
            cmd: 'echo',
            param: null,
        });
    });

    //* check of _ES6
    it('should pass _ES6 factory', async () => {
        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        // use `lemon-templates-api` in dev.
        const endpoint = `https://ag1qbtayhj.execute-api.ap-northeast-2.amazonaws.com/dev/search/echo/query`;
        const $X = $ES6.$X;
        const credentials = await asyncCredentials(PROFILE);
        const proxy = $X.createHttpSearchProxy(endpoint, { credentials });

        // GET method test
        const param: Elastic6SearchParams = { searchType: 'query_then_fetch' };
        const body: SearchBody = { size: 1, query: null };
        expect2(await proxy.doProxy('POST', null, null, param, { body }).catch(GETERR), '!context').toEqual({
            param,
            body: { body },
        });

        const agent = _ES6({ endpoint, useProxy: true, credentials });
        expect2(await agent.search(body, param).catch(GETERR), '!context').toEqual({
            param,
            body: {
                body,
                index: 'test-v1',
                service: 'lemon-core',
                signature: 'v1:84g6M+IU2X/yfcyYqUxNAgQPKYlnucbWrPhP+hFYXUE=',
            },
        });
    });
    it('should pass saveAllUpdates()', async () => {
        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        const { service } = instance();
        const proxy = service.buildProxy({ domain: 'test', source: 'test' });

        //* test of options parameter validation
        // undefined options (should use defaults)
        const proxy1 = service.buildProxy({ domain: 'test', source: 'test' });
        const model1 = await proxy1.tests.get('item-undefined-test', {});
        model1.name = 'undefined options';
        await proxy1.saveAllUpdates();
        const retrieved1 = await proxy1.tests.get('item-undefined-test');
        expect2(() => retrieved1, 'name').toEqual({ name: 'undefined options' });

        // empty options object
        const proxy2 = service.buildProxy({ domain: 'test', source: 'test' });
        const model2 = await proxy2.tests.get('item-empty-opts', {});
        model2.name = 'empty opts';
        await proxy2.saveAllUpdates({});
        const retrieved2 = await proxy2.tests.get('item-empty-opts');
        expect2(() => retrieved2, 'name').toEqual({ name: 'empty opts' });

        //* prepare 20 test items for batch mode test
        for (let i = 0; i < 20; i++) {
            const model = await proxy.tests.get(`item-${i}`, {});
            model.name = `Item ${i}`;
            model.test = i * 10;
        }

        //* mock storage methods to count calls
        let updateCallCount = 0;
        let batchCallCount = 0;
        const originalUpdate = proxy.tests.$mgr.storage.update.bind(proxy.tests.$mgr.storage);
        const originalDoUpdateMulti = proxy.tests.$mgr.storage.storage.doUpdateMulti.bind(
            proxy.tests.$mgr.storage.storage,
        );

        proxy.tests.$mgr.storage.update = async (id: string, model: any, inc?: any) => {
            updateCallCount++;
            return originalUpdate(id, model, inc);
        };

        proxy.tests.$mgr.storage.storage.doUpdateMulti = async (type: string, list: any[]) => {
            batchCallCount++;
            return originalDoUpdateMulti(type, list);
        };

        //* test of default mode (useBatch: true by default - batch updates)
        const batchResult = await proxy.saveAllUpdates();
        expect2(() => updateCallCount).toEqual(0);
        expect2(() => batchCallCount).toEqual(1);
        expect2(() => Array.isArray(batchResult)).toEqual(true);
        expect2(() => batchResult.length).toEqual(20);

        //* test of explicit batch mode with useBatch: true
        updateCallCount = 0;
        batchCallCount = 0;
        const proxyExplicit = service.buildProxy({ domain: 'test', source: 'test' });
        for (let i = 0; i < 5; i++) {
            const model = await proxyExplicit.tests.get(`item-explicit-${i}`, {});
            model.name = `Explicit ${i}`;
        }
        await proxyExplicit.saveAllUpdates({ useBatch: true });

        //* prepare 20 test items again for legacy test
        const proxyLegacy = service.buildProxy({ domain: 'test', source: 'test' });
        let legacyUpdateCount = 0;
        let legacyBatchCount = 0;
        const originalUpdateLegacy = proxyLegacy.tests.$mgr.storage.update.bind(proxyLegacy.tests.$mgr.storage);
        const originalDoUpdateMultiLegacy = proxyLegacy.tests.$mgr.storage.storage.doUpdateMulti.bind(
            proxyLegacy.tests.$mgr.storage.storage,
        );

        proxyLegacy.tests.$mgr.storage.update = async (id: string, model: any, inc?: any) => {
            legacyUpdateCount++;
            return originalUpdateLegacy(id, model, inc);
        };

        proxyLegacy.tests.$mgr.storage.storage.doUpdateMulti = async (type: string, list: any[]) => {
            legacyBatchCount++;
            return originalDoUpdateMultiLegacy(type, list);
        };

        for (let i = 0; i < 20; i++) {
            const model = await proxyLegacy.tests.get(`item-legacy-${i}`, {});
            model.name = `Item ${i} v2`;
            model.test = i * 100;
        }

        //* test of legacy mode (useBatch: false - individual updates)
        const legacyResult = await proxyLegacy.saveAllUpdates({ useBatch: false });
        expect2(() => legacyUpdateCount).toEqual(20);
        expect2(() => legacyBatchCount).toEqual(0);
        expect2(() => Array.isArray(legacyResult)).toEqual(true);

        //* test of onlyValid option with batch mode
        const proxyValid = service.buildProxy({ domain: 'test', source: 'test' });
        const modelWithNull = await proxyValid.tests.get('item-null-test', {});
        modelWithNull.name = 'valid name';
        modelWithNull.test = null as any;
        await proxyValid.saveAllUpdates({ onlyValid: true });
        const retrievedValid = await proxyValid.tests.get('item-null-test');
        expect2(() => retrievedValid, 'name').toEqual({ name: 'valid name' });

        //* test of parrallel option (legacy mode)
        const proxyParrallel = service.buildProxy({ domain: 'test', source: 'test' });
        let parallelUpdateCallCount = 0;
        const originalUpdateParrallel = proxyParrallel.tests.$mgr.storage.update.bind(
            proxyParrallel.tests.$mgr.storage,
        );
        proxyParrallel.tests.$mgr.storage.update = async (id: string, model: any, inc?: any) => {
            parallelUpdateCallCount++;
            return originalUpdateParrallel(id, model, inc);
        };

        for (let i = 0; i < 10; i++) {
            const model = await proxyParrallel.tests.get(`item-parrallel-${i}`, {});
            model.name = `Parrallel ${i}`;
        }
        await proxyParrallel.saveAllUpdates({ useBatch: false, parrallel: 5 });
        expect2(() => parallelUpdateCallCount).toEqual(10);

        //* test of empty update set
        const proxyEmpty = service.buildProxy({ domain: 'test', source: 'test' });
        const emptyResult = await proxyEmpty.saveAllUpdates();
        expect2(() => emptyResult).toEqual([]);

        //* test of single item update (batch mode)
        const proxySingle = service.buildProxy({ domain: 'test', source: 'test' });
        let singleBatchCount = 0;
        const originalDoUpdateMultiSingle = proxySingle.tests.$mgr.storage.storage.doUpdateMulti.bind(
            proxySingle.tests.$mgr.storage.storage,
        );
        proxySingle.tests.$mgr.storage.storage.doUpdateMulti = async (type: string, list: any[]) => {
            singleBatchCount++;
            return originalDoUpdateMultiSingle(type, list);
        };

        const singleModel = await proxySingle.tests.get('item-single', {});
        singleModel.name = 'single item';
        await proxySingle.saveAllUpdates({ useBatch: true });
        expect2(() => singleBatchCount).toEqual(1);

        //* test of result comparison between batch mode and legacy mode
        //* STEP.1: prepare test data for batch mode
        const proxyBatchCompare = service.buildProxy({ domain: 'test', source: 'test' });
        const batchTestItems = [];
        for (let i = 0; i < 10; i++) {
            const model = await proxyBatchCompare.tests.get(`batch-compare-${i}`, {});
            model.name = `Batch Item ${i}`;
            model.test = i * 100;
            batchTestItems.push({ id: `batch-compare-${i}`, name: `Batch Item ${i}`, test: i * 100 });
        }

        //* STEP.2: save with batch mode (useBatch: true)
        const batchModeResult = await proxyBatchCompare.saveAllUpdates({ useBatch: true });

        //* STEP.3: verify batch mode results
        expect2(() => Array.isArray(batchModeResult)).toEqual(true);
        expect2(() => batchModeResult.length).toEqual(10);

        //* STEP.4: retrieve and verify batch mode saved data
        const batchRetrievedItems = [];
        for (let i = 0; i < 10; i++) {
            const retrieved = await proxyBatchCompare.tests.get(`batch-compare-${i}`);
            batchRetrievedItems.push(retrieved);
        }

        //* STEP.5: prepare identical test data for legacy mode
        const proxyLegacyCompare = service.buildProxy({ domain: 'test', source: 'test' });
        const legacyTestItems = [];
        for (let i = 0; i < 10; i++) {
            const model = await proxyLegacyCompare.tests.get(`legacy-compare-${i}`, {});
            model.name = `Batch Item ${i}`;
            model.test = i * 100;
            legacyTestItems.push({ id: `legacy-compare-${i}`, name: `Batch Item ${i}`, test: i * 100 });
        }

        //* STEP.6: save with legacy mode (useBatch: false)
        const legacyModeResult = await proxyLegacyCompare.saveAllUpdates({ useBatch: false });

        //* STEP.7: verify legacy mode results
        expect2(() => Array.isArray(legacyModeResult)).toEqual(true);
        expect2(() => legacyModeResult.length).toEqual(10);

        //* STEP.8: retrieve and verify legacy mode saved data
        const legacyRetrievedItems = [];
        for (let i = 0; i < 10; i++) {
            const retrieved = await proxyLegacyCompare.tests.get(`legacy-compare-${i}`);
            legacyRetrievedItems.push(retrieved);
        }

        //* STEP.9: compare batch mode vs legacy mode results structure
        expect2(() => batchModeResult.length).toEqual(legacyModeResult.length);
        expect2(() => typeof batchModeResult).toEqual(typeof legacyModeResult);

        //* STEP.10: compare retrieved data field by field
        for (let i = 0; i < 10; i++) {
            const batchItem = batchRetrievedItems[i];
            const legacyItem = legacyRetrievedItems[i];

            // verify name field is identical
            expect2(() => batchItem, 'name').toEqual({ name: `Batch Item ${i}` });
            expect2(() => legacyItem, 'name').toEqual({ name: `Batch Item ${i}` });

            // verify test field is identical
            expect2(() => batchItem, 'test').toEqual({ test: i * 100 });
            expect2(() => legacyItem, 'test').toEqual({ test: i * 100 });

            // verify both have same structure
            expect2(() => typeof batchItem.name).toEqual('string');
            expect2(() => typeof legacyItem.name).toEqual('string');
            expect2(() => typeof batchItem.test).toEqual('number');
            expect2(() => typeof legacyItem.test).toEqual('number');
        }

        //* STEP.11: verify result return value comparison
        // both modes should return updated models with same field structure
        const batchFirstResult = batchModeResult[0];
        const legacyFirstResult = legacyModeResult[0];

        expect2(() => typeof batchFirstResult).toEqual('object');
        expect2(() => typeof legacyFirstResult).toEqual('object');
        expect2(() => batchFirstResult).toEqual(expect.objectContaining({ name: expect.any(String) }));
        expect2(() => legacyFirstResult).toEqual(expect.objectContaining({ name: expect.any(String) }));

        //* STEP.12: verify update count consistency
        // batch mode: 10 items saved in 1 call
        // legacy mode: 10 items saved in 10 calls
        // result: both should have 10 items saved successfully
        expect2(() => batchRetrievedItems.length).toEqual(10);
        expect2(() => legacyRetrievedItems.length).toEqual(10);
        expect2(() => batchRetrievedItems.length).toEqual(legacyRetrievedItems.length);

        //* STEP.13: test with complex data comparison
        const proxyBatchComplex = service.buildProxy({ domain: 'test', source: 'test' });
        const proxyLegacyComplex = service.buildProxy({ domain: 'test', source: 'test' });

        // prepare complex data with multiple fields
        for (let i = 0; i < 5; i++) {
            const batchModel = await proxyBatchComplex.tests.get(`complex-batch-${i}`, {});
            batchModel.name = `Complex ${i}`;
            batchModel.test = i * 50;

            const legacyModel = await proxyLegacyComplex.tests.get(`complex-legacy-${i}`, {});
            legacyModel.name = `Complex ${i}`;
            legacyModel.test = i * 50;
        }

        // save with both modes
        await proxyBatchComplex.saveAllUpdates({ useBatch: true });
        await proxyLegacyComplex.saveAllUpdates({ useBatch: false });

        // retrieve and compare
        for (let i = 0; i < 5; i++) {
            const batchComplex = await proxyBatchComplex.tests.get(`complex-batch-${i}`);
            const legacyComplex = await proxyLegacyComplex.tests.get(`complex-legacy-${i}`);

            // verify identical values
            expect2(() => batchComplex, 'name,test').toEqual({
                name: `Complex ${i}`,
                test: i * 50,
            });
            expect2(() => legacyComplex, 'name,test').toEqual({
                name: `Complex ${i}`,
                test: i * 50,
            });

            // verify both modes produce identical structure
            expect2(() => batchComplex.name).toEqual(legacyComplex.name);
            expect2(() => batchComplex.test).toEqual(legacyComplex.test);
        }
    });
});
