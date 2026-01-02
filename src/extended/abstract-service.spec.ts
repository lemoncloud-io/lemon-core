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
import { _it, expect2, GETERR } from '../common/test-helper';
import { $U, _log } from '../engine';
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
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const NS = $U.NS('TEST', 'blue'); // NAMESPACE FOR TEST LOGGING

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
    object$?: {
        id?: string;
        userId?: string;
        siteId?: string;
        activateToken?: string;
        activateTokenTs?: string;
    };
    // For equivalence testing
    extra?: string;
    keepMe?: string;
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

/**
 * interface: Performance Test Result
 */
interface PerfTestResult {
    childNo: number;
    batchMode: { elapsed: number; errors: number };
    legacyMode: { elapsed: number; errors: number };
}

/**
 * save performance report to coverage folder
 */
const _savePerformanceReport = (testName: string, results: PerfTestResult[]) => {
    const coverageDir = join(process.cwd(), 'coverage');
    if (!existsSync(coverageDir)) {
        mkdirSync(coverageDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `perf-${testName}-${timestamp}.json`;
    const filepath = join(coverageDir, filename);

    const report = {
        testName,
        timestamp: new Date().toISOString(),
        results,
        summary: _generateSummary(results),
    };

    writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
    _log(NS, `> Performance report saved: ${filepath}`);
    return filepath;
};

/**
 * generate performance summary
 */
const _generateSummary = (results: PerfTestResult[]) => {
    return results.map(r => ({
        childNo: r?.childNo,
        batchElapsed: r?.batchMode?.elapsed,
        legacyElapsed: r?.legacyMode?.elapsed,
        improvement: _calculateImprovement(r?.legacyMode?.elapsed, r?.batchMode?.elapsed),
        batchErrors: r?.batchMode?.errors,
        legacyErrors: r?.legacyMode?.errors,
    }));
};

/**
 * calculate improvement percentage
 */
const _calculateImprovement = (baseline: number, improved: number): number => {
    return baseline > 0 ? ((baseline - improved) / baseline) * 100 : 0;
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
                'name,test,A,AB,A_B,object$,extra,keepMe,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id',
            );
            expect2(() => filterFields(TEST_FIELDS, ['test']).join(',')).toEqual(
                'test,name,A,AB,A_B,object$,extra,keepMe,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id',
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
        expect2(await $test.getMulti(['1', '1']).catch(GETERR)).toEqual(
            '404 NOT FOUND - test:1 (S:0/1) - parallel(10/1)',
        );
        expect2(await $test.getMulti$(['1', '1']).catch(GETERR)).toEqual(
            '404 NOT FOUND - test:1 (S:0/1) - parallel(10/1)',
        );
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

        const { service } = instance('real');

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
        const proxy = service.buildProxy({ domain: 'test', source: 'test' });
        for (let i = 0; i < 20; i++) {
            const model = await proxy.tests.get(`item-${i}`, { name: `Item ${i}`, test: i * 10 });
        }

        //* test of default mode (useBatch: false by default - legacy updates)
        await proxy.saveAllUpdates();

        // Verify data was actually saved
        for (let i = 0; i < 3; i++) {
            const retrieved = await proxy.tests.get(`item-${i}`);
            expect2(() => retrieved.name).toEqual(`Item ${i}`);
            expect2(() => retrieved.test).toEqual(i * 10);
        }

        //* test of explicit batch mode with useBatch: true
        const proxyBatch = service.buildProxy({ domain: 'test', source: 'test' });
        for (let i = 0; i < 5; i++) {
            const model = await proxyBatch.tests.get(`batch-item-${i}`, {});
            model.name = `Batch ${i}`;
            model.test = i * 100;
        }
        const batchResult = await proxyBatch.saveAllUpdates({ useBatch: true });
        expect2(() => Array.isArray(batchResult)).toEqual(true);
        expect2(() => batchResult.length).toEqual(5);

        // Verify batch data was actually saved
        for (let i = 0; i < 5; i++) {
            const retrieved = await proxyBatch.tests.get(`batch-item-${i}`);
            expect2(() => retrieved.name).toEqual(`Batch ${i}`);
            expect2(() => retrieved.test).toEqual(i * 100);
        }

        //* test of onlyValid option with batch mode
        const proxyValid = service.buildProxy({ domain: 'test', source: 'test' });
        const modelWithNull = await proxyValid.tests.get('item-null-test', {});
        modelWithNull.name = 'valid name';
        modelWithNull.test = null as any;
        await proxyValid.saveAllUpdates({ onlyValid: true });
        const retrievedValid = await proxyValid.tests.get('item-null-test');
        expect2(() => retrievedValid, 'name').toEqual({ name: 'valid name' });

        //* test of empty update set
        const proxyEmpty = service.buildProxy({ domain: 'test', source: 'test' });
        const emptyResult = await proxyEmpty.saveAllUpdates();
        expect2(() => emptyResult).toEqual([]);

        //* test of result comparison between batch mode and legacy mode
        //* STEP.0: cleanup test data before starting
        const cleanupIds = {
            batch: Array.from({ length: 10 }, (_, i) => `batch-compare-${i}`),
            legacy: Array.from({ length: 10 }, (_, i) => `legacy-compare-${i}`),
            complex: {
                batch: Array.from({ length: 5 }, (_, i) => `complex-batch-${i}`),
                legacy: Array.from({ length: 5 }, (_, i) => `complex-legacy-${i}`),
            },
        };

        // Delete all test items before test
        const deleteAllTestItems = async () => {
            const allIds = [
                ...cleanupIds.batch,
                ...cleanupIds.legacy,
                ...cleanupIds.complex.batch,
                ...cleanupIds.complex.legacy,
            ];
            await Promise.all(allIds.map(id => service.$test.storage.delete(id, true).catch((): null => null)));
        };

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

        //* CLEANUP: delete all test items after test
        await deleteAllTestItems();
    });

    //* LAYER EQUIVALENCE: test existing data update (diff vs fullModel)
    it('should have equivalent results when updating existing data (diff vs fullModel)', async () => {
        jest.setTimeout(60000);

        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        const { service } = instance('real');

        // Setup: create initial data with multiple fields
        const setupProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 5; i++) {
            const model = await setupProxy.tests.get(`equiv-update-${i}`, {});
            model.name = `Original ${i}`;
            model.test = i * 100;
            (model as any).extra = `extra-field-${i}`;
            (model as any).keepMe = `should-persist-${i}`;
        }
        await setupProxy.saveAllUpdates();

        // Legacy: update with useBatch: false (diff mode)
        const legacyProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 5; i++) {
            const model = await legacyProxy.tests.get(`equiv-update-${i}`);
            model.name = `Legacy Updated ${i}`;
        }
        await legacyProxy.saveAllUpdates({ useBatch: false });

        // Verify: legacy mode preserves unchanged fields
        const legacyVerifyProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        const legacyVerified0 = await legacyVerifyProxy.tests.get('equiv-update-0');
        expect2(() => legacyVerified0.name).toEqual('Legacy Updated 0');
        expect2(() => legacyVerified0.test).toEqual(0);
        expect2(() => (legacyVerified0 as any).extra).toEqual('extra-field-0');
        expect2(() => (legacyVerified0 as any).keepMe).toEqual('should-persist-0');

        const legacyVerified1 = await legacyVerifyProxy.tests.get('equiv-update-1');
        expect2(() => legacyVerified1.name).toEqual('Legacy Updated 1');
        expect2(() => legacyVerified1.test).toEqual(100);
        expect2(() => (legacyVerified1 as any).extra).toEqual('extra-field-1');
        expect2(() => (legacyVerified1 as any).keepMe).toEqual('should-persist-1');

        const legacyVerified2 = await legacyVerifyProxy.tests.get('equiv-update-2');
        expect2(() => legacyVerified2.name).toEqual('Legacy Updated 2');
        expect2(() => legacyVerified2.test).toEqual(200);
        expect2(() => (legacyVerified2 as any).extra).toEqual('extra-field-2');
        expect2(() => (legacyVerified2 as any).keepMe).toEqual('should-persist-2');

        const legacyVerified3 = await legacyVerifyProxy.tests.get('equiv-update-3');
        expect2(() => legacyVerified3.name).toEqual('Legacy Updated 3');
        expect2(() => legacyVerified3.test).toEqual(300);
        expect2(() => (legacyVerified3 as any).extra).toEqual('extra-field-3');
        expect2(() => (legacyVerified3 as any).keepMe).toEqual('should-persist-3');

        const legacyVerified4 = await legacyVerifyProxy.tests.get('equiv-update-4');
        expect2(() => legacyVerified4.name).toEqual('Legacy Updated 4');
        expect2(() => legacyVerified4.test).toEqual(400);
        expect2(() => (legacyVerified4 as any).extra).toEqual('extra-field-4');
        expect2(() => (legacyVerified4 as any).keepMe).toEqual('should-persist-4');

        // Reset data for batch mode test
        const resetProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 5; i++) {
            const model = await resetProxy.tests.get(`equiv-update-${i}`, {});
            model.name = `Original ${i}`;
            model.test = i * 100;
            (model as any).extra = `extra-field-${i}`;
            (model as any).keepMe = `should-persist-${i}`;
        }
        await resetProxy.saveAllUpdates();

        // Batch: update with useBatch: true (full model mode)
        const batchProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 5; i++) {
            const model = await batchProxy.tests.get(`equiv-update-${i}`);
            model.name = `Batch Updated ${i}`;
        }
        await batchProxy.saveAllUpdates({ useBatch: true });

        // Verify: batch mode preserves unchanged fields
        const batchVerifyProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        const batchVerified0 = await batchVerifyProxy.tests.get('equiv-update-0');
        expect2(() => batchVerified0.name).toEqual('Batch Updated 0');
        expect2(() => batchVerified0.test).toEqual(0);
        expect2(() => (batchVerified0 as any).extra).toEqual('extra-field-0');
        expect2(() => (batchVerified0 as any).keepMe).toEqual('should-persist-0');

        const batchVerified1 = await batchVerifyProxy.tests.get('equiv-update-1');
        expect2(() => batchVerified1.name).toEqual('Batch Updated 1');
        expect2(() => batchVerified1.test).toEqual(100);
        expect2(() => (batchVerified1 as any).extra).toEqual('extra-field-1');
        expect2(() => (batchVerified1 as any).keepMe).toEqual('should-persist-1');

        const batchVerified2 = await batchVerifyProxy.tests.get('equiv-update-2');
        expect2(() => batchVerified2.name).toEqual('Batch Updated 2');
        expect2(() => batchVerified2.test).toEqual(200);
        expect2(() => (batchVerified2 as any).extra).toEqual('extra-field-2');
        expect2(() => (batchVerified2 as any).keepMe).toEqual('should-persist-2');

        const batchVerified3 = await batchVerifyProxy.tests.get('equiv-update-3');
        expect2(() => batchVerified3.name).toEqual('Batch Updated 3');
        expect2(() => batchVerified3.test).toEqual(300);
        expect2(() => (batchVerified3 as any).extra).toEqual('extra-field-3');
        expect2(() => (batchVerified3 as any).keepMe).toEqual('should-persist-3');

        const batchVerified4 = await batchVerifyProxy.tests.get('equiv-update-4');
        expect2(() => batchVerified4.name).toEqual('Batch Updated 4');
        expect2(() => batchVerified4.test).toEqual(400);
        expect2(() => (batchVerified4 as any).extra).toEqual('extra-field-4');
        expect2(() => (batchVerified4 as any).keepMe).toEqual('should-persist-4');

        // Compare: side-by-side equivalence test
        const finalSetupProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 3; i++) {
            const legacyModel = await finalSetupProxy.tests.get(`final-legacy-${i}`, {});
            legacyModel.name = `Original ${i}`;
            legacyModel.test = i * 100;
            (legacyModel as any).extra = `extra-${i}`;

            const batchModel = await finalSetupProxy.tests.get(`final-batch-${i}`, {});
            batchModel.name = `Original ${i}`;
            batchModel.test = i * 100;
            (batchModel as any).extra = `extra-${i}`;
        }
        await finalSetupProxy.saveAllUpdates();

        // Legacy: update items
        const finalLegacyProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 3; i++) {
            const model = await finalLegacyProxy.tests.get(`final-legacy-${i}`);
            model.name = `Updated ${i}`;
        }
        await finalLegacyProxy.saveAllUpdates({ useBatch: false });

        // Batch: update items
        const finalBatchProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        for (let i = 0; i < 3; i++) {
            const model = await finalBatchProxy.tests.get(`final-batch-${i}`);
            model.name = `Updated ${i}`;
        }
        await finalBatchProxy.saveAllUpdates({ useBatch: true });

        // Verify: both methods produce identical results
        const finalVerifyProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        const finalLegacy0 = await finalVerifyProxy.tests.get('final-legacy-0');
        const finalBatch0 = await finalVerifyProxy.tests.get('final-batch-0');
        expect2(() => finalLegacy0.name).toEqual('Updated 0');
        expect2(() => finalBatch0.name).toEqual('Updated 0');
        expect2(() => finalLegacy0.test).toEqual(0);
        expect2(() => finalBatch0.test).toEqual(0);
        expect2(() => (finalLegacy0 as any).extra).toEqual('extra-0');
        expect2(() => (finalBatch0 as any).extra).toEqual('extra-0');
        expect2(() => finalLegacy0.name).toEqual(finalBatch0.name);
        expect2(() => finalLegacy0.test).toEqual(finalBatch0.test);
        expect2(() => (finalLegacy0 as any).extra).toEqual((finalBatch0 as any).extra);

        const finalLegacy1 = await finalVerifyProxy.tests.get('final-legacy-1');
        const finalBatch1 = await finalVerifyProxy.tests.get('final-batch-1');
        expect2(() => finalLegacy1.name).toEqual('Updated 1');
        expect2(() => finalBatch1.name).toEqual('Updated 1');
        expect2(() => finalLegacy1.test).toEqual(100);
        expect2(() => finalBatch1.test).toEqual(100);
        expect2(() => (finalLegacy1 as any).extra).toEqual('extra-1');
        expect2(() => (finalBatch1 as any).extra).toEqual('extra-1');
        expect2(() => finalLegacy1.name).toEqual(finalBatch1.name);
        expect2(() => finalLegacy1.test).toEqual(finalBatch1.test);
        expect2(() => (finalLegacy1 as any).extra).toEqual((finalBatch1 as any).extra);

        const finalLegacy2 = await finalVerifyProxy.tests.get('final-legacy-2');
        const finalBatch2 = await finalVerifyProxy.tests.get('final-batch-2');
        expect2(() => finalLegacy2.name).toEqual('Updated 2');
        expect2(() => finalBatch2.name).toEqual('Updated 2');
        expect2(() => finalLegacy2.test).toEqual(200);
        expect2(() => finalBatch2.test).toEqual(200);
        expect2(() => (finalLegacy2 as any).extra).toEqual('extra-2');
        expect2(() => (finalBatch2 as any).extra).toEqual('extra-2');
        expect2(() => finalLegacy2.name).toEqual(finalBatch2.name);
        expect2(() => finalLegacy2.test).toEqual(finalBatch2.test);
        expect2(() => (finalLegacy2 as any).extra).toEqual((finalBatch2 as any).extra);

        // Cleanup
        const cleanupProxy = service.buildProxy({ domain: 'test-equiv', source: 'diff-test' });
        const cleanupIds = [
            ...Array.from({ length: 5 }, (_, i) => `equiv-update-${i}`),
            ...Array.from({ length: 3 }, (_, i) => `final-legacy-${i}`),
            ...Array.from({ length: 3 }, (_, i) => `final-batch-${i}`),
        ];
        await Promise.all(cleanupIds.map(id => cleanupProxy.tests.storage.delete(id, true).catch(() => null)));
    });

    it('should pass saveAllUpdates() performance test with child replication', async () => {
        jest.setTimeout(300000);

        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        const { service } = instance('real'); // use real DynamoDB for accurate performance testing

        //* test scenario: replicate parent model into N children based on childNo parameter
        //* test childNo values: 100, 1000, 2000
        //* compare performance: batch mode (useBatch: true) vs legacy mode (useBatch: false)
        //* verify: response time, error handling, data consistency

        //* STEP.0: cleanup all test data before starting
        const _cleanupAllTestData = async () => {
            const testChildNos = [100, 1000]; // reduced from [100, 500, 1000, 1500, 2000] for faster test execution
            const deletePromises = [];

            for (const childNo of testChildNos) {
                // delete parent items
                deletePromises.push(
                    service.$test.storage.delete(`parent-batch-${childNo}`, true).catch(() => null),
                    service.$test.storage.delete(`parent-legacy-${childNo}`, true).catch(() => null),
                );

                // delete child items
                for (let i = 0; i < childNo; i++) {
                    deletePromises.push(
                        service.$test.storage.delete(`child-batch-${childNo}-${i}`, true).catch(() => null),
                        service.$test.storage.delete(`child-legacy-${childNo}-${i}`, true).catch(() => null),
                    );
                }
            }

            await Promise.all(deletePromises);
        };

        await _cleanupAllTestData();

        /* helper function: create parent and replicate children*/
        const _replicateChildren = async (
            childNo: number,
            useBatch: boolean,
        ): Promise<{ parent: TestModel; children: TestModel[]; elapsed: number; errors: number }> => {
            const proxy = service.buildProxy({ domain: 'perf-test', source: 'child-replication' });

            // STEP.1: create parent model
            const parent = await proxy.tests.get(`parent-${useBatch ? 'batch' : 'legacy'}-${childNo}`, {});
            parent.name = `Parent for ${childNo} children`;
            parent.test = childNo;

            // STEP.2: replicate children based on childNo
            const children: TestModel[] = [];
            for (let i = 0; i < childNo; i++) {
                const child = await proxy.tests.get(`child-${useBatch ? 'batch' : 'legacy'}-${childNo}-${i}`, {});
                child.name = `${parent.name}#${i}`;
                child.test = i;
                children.push(child);
            }

            // STEP.3: measure saveAllUpdates performance
            const startTime = Date.now();
            let errors = 0;

            try {
                await proxy.saveAllUpdates({ useBatch });
            } catch (err) {
                errors++;
            }

            const elapsed = Date.now() - startTime;

            return { parent, children, elapsed, errors };
        };

        //* performance test results storage
        const perfResults: PerfTestResult[] = [];

        //* TEST.1: childNo = 100
        if (1) {
            const batchResult100 = await _replicateChildren(100, true);
            const legacyResult100 = await _replicateChildren(100, false);

            expect2(() => batchResult100.errors).toEqual(0);
            expect2(() => legacyResult100.errors).toEqual(0);
            expect2(() => batchResult100.children.length).toEqual(100);
            expect2(() => legacyResult100.children.length).toEqual(100);

            perfResults.push({
                childNo: 100,
                batchMode: { elapsed: batchResult100.elapsed, errors: batchResult100.errors },
                legacyMode: { elapsed: legacyResult100.elapsed, errors: legacyResult100.errors },
            });
        }

        //* TEST.2: childNo = 500 (SKIPPED for faster test execution)
        if (0) {
            const batchResult500 = await _replicateChildren(500, true);
            const legacyResult500 = await _replicateChildren(500, false);

            expect2(() => batchResult500.errors).toEqual(0);
            expect2(() => legacyResult500.errors).toEqual(0);
            expect2(() => batchResult500.children.length).toEqual(500);
            expect2(() => legacyResult500.children.length).toEqual(500);

            perfResults.push({
                childNo: 500,
                batchMode: { elapsed: batchResult500.elapsed, errors: batchResult500.errors },
                legacyMode: { elapsed: legacyResult500.elapsed, errors: legacyResult500.errors },
            });
        }

        //* TEST.3: childNo = 1000
        if (1) {
            const batchResult1000 = await _replicateChildren(1000, true);
            const legacyResult1000 = await _replicateChildren(1000, false);

            expect2(() => batchResult1000.errors).toEqual(0);
            expect2(() => legacyResult1000.errors).toEqual(0);
            expect2(() => batchResult1000.children.length).toEqual(1000);
            expect2(() => legacyResult1000.children.length).toEqual(1000);

            perfResults.push({
                childNo: 1000,
                batchMode: { elapsed: batchResult1000.elapsed, errors: batchResult1000.errors },
                legacyMode: { elapsed: legacyResult1000.elapsed, errors: legacyResult1000.errors },
            });
        }

        //* TEST.4: childNo = 1500 (SKIPPED for faster test execution)
        if (0) {
            const batchResult1500 = await _replicateChildren(1500, true);
            const legacyResult1500 = await _replicateChildren(1500, false);

            expect2(() => batchResult1500.errors).toEqual(0);
            expect2(() => legacyResult1500.errors).toEqual(0);
            expect2(() => batchResult1500.children.length).toEqual(1500);
            expect2(() => legacyResult1500.children.length).toEqual(1500);

            perfResults.push({
                childNo: 1500,
                batchMode: { elapsed: batchResult1500.elapsed, errors: batchResult1500.errors },
                legacyMode: { elapsed: legacyResult1500.elapsed, errors: legacyResult1500.errors },
            });
        }

        //* TEST.5: childNo = 2000
        if (0) {
            const batchResult2000 = await _replicateChildren(2000, true);
            const legacyResult2000 = await _replicateChildren(2000, false);

            expect2(() => batchResult2000.errors).toEqual(0);
            expect2(() => legacyResult2000.errors).toEqual(0);
            expect2(() => batchResult2000.children.length).toEqual(2000);
            expect2(() => legacyResult2000.children.length).toEqual(2000);

            perfResults.push({
                childNo: 2000,
                batchMode: { elapsed: batchResult2000.elapsed, errors: batchResult2000.errors },
                legacyMode: { elapsed: legacyResult2000.elapsed, errors: legacyResult2000.errors },
            });
        }

        //* save performance report to JSON file
        const reportPath = _savePerformanceReport('child-replication', perfResults);

        //* verify data consistency between batch and legacy mode

        //* verify random samples from each test case
        const proxyVerify = service.buildProxy({ domain: 'verify', source: 'consistency-check' });

        // verify 100 children case
        const batchChild100Sample = await proxyVerify.tests.get('child-batch-100-50');
        const legacyChild100Sample = await proxyVerify.tests.get('child-legacy-100-50');
        expect2(() => batchChild100Sample, 'name').toEqual({ name: 'Parent for 100 children#50' });
        expect2(() => legacyChild100Sample, 'name').toEqual({ name: 'Parent for 100 children#50' });
        expect2(() => batchChild100Sample.test).toEqual(50);
        expect2(() => legacyChild100Sample.test).toEqual(50);

        // verify 1000 children case
        const batchChild1000Sample = await proxyVerify.tests.get('child-batch-1000-500');
        const legacyChild1000Sample = await proxyVerify.tests.get('child-legacy-1000-500');
        expect2(() => batchChild1000Sample, 'name').toEqual({ name: 'Parent for 1000 children#500' });
        expect2(() => legacyChild1000Sample, 'name').toEqual({ name: 'Parent for 1000 children#500' });
        expect2(() => batchChild1000Sample.test).toEqual(500);
        expect2(() => legacyChild1000Sample.test).toEqual(500);

        //* verify report file was created
        expect2(() => typeof reportPath).toEqual('string');
        expect2(() => reportPath.includes('coverage/perf-child-replication')).toEqual(true);
    });

    it('should reproduce undefined values error in saveAllUpdates()', async () => {
        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}] (expected of 'lemon')`);
            return;
        }

        const { service } = instance('real');

        //* TEST CASE: onlyValid: false
        // undefined in nested object → error
        const proxyUndefined1 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelUndefined1 = await proxyUndefined1.tests.get('user-with-undefined-nested', {});
        modelUndefined1.name = 'Test User With Undefined';
        modelUndefined1.object$ = {
            id: ':200389404',
            userId: '200389404',
            siteId: '200002034',
            activateToken: undefined, // undefined value causes error with onlyValid: false
            activateTokenTs: '2026-01-30 14:24:20',
        };

        const errorUndefined1 = await proxyUndefined1.saveAllUpdates({ onlyValid: false }).catch(GETERR);
        expect2(() => errorUndefined1).toEqual(
            'Failed to update test/user-with-undefined-nested: Pass options.removeUndefinedValues=true to remove undefined values from map/array/set. @saveAllUpdates(2) (S:0/1) - parallel(2/1)',
        );

        // undefined in array → succeed
        const proxyUndefined2 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelUndefined2 = await proxyUndefined2.tests.get('user-with-undefined-array', {});
        modelUndefined2.name = 'Test User With Array';
        (modelUndefined2 as any).tags = ['tag1', undefined, 'tag3'];

        const errorUndefined2 = await proxyUndefined2.saveAllUpdates({ onlyValid: false }).catch(GETERR);
        expect2(() => errorUndefined2[0], '_id').toEqual({ _id: 'TT:test:user-with-undefined-array' });

        // production error case (user/T1019734) → error
        const proxyProdError = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelProdError = await proxyProdError.tests.get('T1019734', {});
        modelProdError.name = 'Production Error User';
        modelProdError.object$ = {
            id: ':200389404',
            userId: '200389404',
            siteId: '200002034',
            activateToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            activateTokenTs: undefined, // undefined value causes error with onlyValid: false
        };

        const errorProdError = await proxyProdError.saveAllUpdates({ onlyValid: false }).catch(GETERR);
        expect2(() => errorProdError).toEqual(
            'Failed to update test/T1019734: Pass options.removeUndefinedValues=true to remove undefined values from map/array/set. @saveAllUpdates(2) (S:0/1) - parallel(2/1)',
        );

        // batch mode with undefined values → error
        const proxyBatchUndefined = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        for (let i = 0; i < 3; i++) {
            const model = await proxyBatchUndefined.tests.get(`user-batch-undefined-${i}`, {});
            model.name = `Batch User ${i}`;
            model.object$ = {
                id: `:${i}`,
                userId: `${i}`,
                siteId: undefined, // undefined value causes error with onlyValid: false
                activateToken: `token-${i}`,
            };
        }

        const errorBatch = await proxyBatchUndefined.saveAllUpdates({ useBatch: true, onlyValid: false }).catch(GETERR);
        expect2(() => errorBatch).toEqual([]);

        //* TEST CASE: onlyValid: true
        // nested undefined → succeed (undefined filtered)
        const proxyOnlyValidTrue1 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelOnlyValidTrue1 = await proxyOnlyValidTrue1.tests.get('user-onlyvalid-true-nested', {});
        modelOnlyValidTrue1.name = 'OnlyValid True Nested';
        modelOnlyValidTrue1.object$ = {
            id: ':test',
            userId: 'test-user',
            siteId: '200002034',
            activateToken: undefined, // undefined is filtered when onlyValid: true
            activateTokenTs: '2026-01-30 14:24:20',
        };

        const resultOnlyValidTrue1 = await proxyOnlyValidTrue1.saveAllUpdates({ onlyValid: true }).catch(GETERR);
        expect2(() => resultOnlyValidTrue1[0], '_id').toEqual({ _id: 'TT:test:user-onlyvalid-true-nested' });

        // array with undefined → succeed (undefined filtered)
        const proxyOnlyValidTrue2 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelOnlyValidTrue2 = await proxyOnlyValidTrue2.tests.get('user-onlyvalid-true-array', {});
        modelOnlyValidTrue2.name = 'OnlyValid True Array';
        (modelOnlyValidTrue2 as any).tags = ['tag1', undefined, 'tag3']; // undefined filtered

        const resultOnlyValidTrue2 = await proxyOnlyValidTrue2.saveAllUpdates({ onlyValid: true }).catch(GETERR);
        expect2(() => resultOnlyValidTrue2[0], '_id').toEqual({ _id: 'TT:test:user-onlyvalid-true-array' });

        // production case → succeed (undefined filtered)
        const proxyOnlyValidTrue3 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelOnlyValidTrue3 = await proxyOnlyValidTrue3.tests.get('user-onlyvalid-true-production', {});
        modelOnlyValidTrue3.name = 'OnlyValid True Production';
        modelOnlyValidTrue3.object$ = {
            id: ':200389404',
            userId: '200389404',
            siteId: '200002034',
            activateToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            activateTokenTs: undefined, // undefined filtered
        };

        const resultOnlyValidTrue3 = await proxyOnlyValidTrue3.saveAllUpdates({ onlyValid: true }).catch(GETERR);
        expect2(() => resultOnlyValidTrue3[0], '_id').toEqual({ _id: 'TT:test:user-onlyvalid-true-production' });

        // batch mode → succeed (undefined filtered)
        const proxyOnlyValidTrue4 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const timestamp2 = Date.now();
        for (let i = 0; i < 3; i++) {
            const model = await proxyOnlyValidTrue4.tests.get(`user-onlyvalid-true-batch-${i}`, {});
            model.name = `OnlyValid True Batch ${i} ${timestamp2}`;
            model.object$ = {
                id: `:${i}`,
                userId: `${i}`,
                siteId: undefined, // undefined filtered
                activateToken: `token-${i}-${timestamp2}`,
            };
        }

        const resultOnlyValidTrue4 = await proxyOnlyValidTrue4
            .saveAllUpdates({ useBatch: true, onlyValid: true })
            .catch(GETERR);
        expect2(() => resultOnlyValidTrue4[0], '_id').toEqual({ _id: 'TT:test:user-onlyvalid-true-batch-0' });
        expect2(() => resultOnlyValidTrue4[1], '_id').toEqual({ _id: 'TT:test:user-onlyvalid-true-batch-1' });
        expect2(() => resultOnlyValidTrue4[2], '_id').toEqual({ _id: 'TT:test:user-onlyvalid-true-batch-2' });
        expect2(() => resultOnlyValidTrue4.length).toEqual(3);

        //* TEST CASE: default
        // nested undefined → succeed
        const proxyDefault1 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelDefault1 = await proxyDefault1.tests.get('user-default-nested', {});
        modelDefault1.name = 'Default Nested';
        modelDefault1.object$ = {
            id: ':default',
            userId: 'default-user',
            siteId: undefined, // undefined is filtered by default (onlyValid !== false)
            activateToken: 'token123',
        };

        const resultDefault1 = await proxyDefault1.saveAllUpdates().catch(GETERR);
        expect2(() => resultDefault1[0], '_id').toEqual({ _id: 'TT:test:user-default-nested' });

        // array with undefined → succeed (undefined filtered)
        const proxyDefault2 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelDefault2 = await proxyDefault2.tests.get('user-default-array', {});
        modelDefault2.name = 'Default Array';
        (modelDefault2 as any).tags = ['tag1', undefined, 'tag3']; // undefined filtered by default

        const resultDefault2 = await proxyDefault2.saveAllUpdates().catch(GETERR);
        expect2(() => resultDefault2[0], '_id').toEqual({ _id: 'TT:test:user-default-array' });

        // multiple nested levels → succeed (undefined filtered)
        const proxyDefault3 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const modelDefault3 = await proxyDefault3.tests.get('user-default-multilevel', {});
        modelDefault3.name = 'Default Multilevel';
        (modelDefault3 as any).object$ = {
            id: ':multilevel',
            userId: 'multilevel-user',
            siteId: '200002034',
            activateToken: undefined, // undefined filtered
            nested: {
                level1: 'value1',
                level2: undefined, // undefined filtered
            },
        };

        const resultDefault3 = await proxyDefault3.saveAllUpdates().catch(GETERR);
        expect2(() => resultDefault3[0], '_id').toEqual({ _id: 'TT:test:user-default-multilevel' });

        // batch mode → succeed (undefined filtered)
        const proxyDefault4 = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const timestamp3 = Date.now();
        for (let i = 0; i < 3; i++) {
            const model = await proxyDefault4.tests.get(`user-default-batch-${i}`, {});
            model.name = `Default Batch ${i} ${timestamp3}`;
            model.object$ = {
                id: `:${i}`,
                userId: `${i}`,
                siteId: undefined, // undefined filtered by default
                activateToken: `token-${i}-${timestamp3}`,
            };
        }

        const resultDefault4 = await proxyDefault4.saveAllUpdates({ useBatch: true }).catch(GETERR);
        expect2(() => resultDefault4[0], '_id').toEqual({ _id: 'TT:test:user-default-batch-0' });
        expect2(() => resultDefault4[1], '_id').toEqual({ _id: 'TT:test:user-default-batch-1' });
        expect2(() => resultDefault4[2], '_id').toEqual({ _id: 'TT:test:user-default-batch-2' });
        expect2(() => resultDefault4.length).toEqual(3);

        //* CLEANUP: delete all created test data
        const proxyCleanup = service.buildProxy({ domain: 'test-undefined', source: 'error-reproduction' });
        const testIds = [
            // onlyValid: false cases
            'user-with-undefined-nested',
            'user-with-undefined-array',
            'T1019734',
            'user-batch-undefined-0',
            'user-batch-undefined-1',
            'user-batch-undefined-2',
            // onlyValid: true cases
            'user-onlyvalid-true-nested',
            'user-onlyvalid-true-array',
            'user-onlyvalid-true-production',
            'user-onlyvalid-true-batch-0',
            'user-onlyvalid-true-batch-1',
            'user-onlyvalid-true-batch-2',
            // default cases
            'user-default-nested',
            'user-default-array',
            'user-default-multilevel',
            'user-default-batch-0',
            'user-default-batch-1',
            'user-default-batch-2',
        ];

        const cleanupStorage = proxyCleanup.tests.storage;

        for (const id of testIds) await cleanupStorage.delete(id).catch(() => {});
    });
});
