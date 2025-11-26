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
import $cores, {
    CacheService,
    CoreModel,
    Elastic6Service,
    LambdaDynamoStreamHandler,
    NextContext,
    SearchBody,
} from '../cores/';
import { expect2, GETERR } from '../common/test-helper';
import { $U } from '../engine';
import request from 'request';
import { sigV4Client } from './libs/sig-v4';
import { $info, $protocol, $slack } from '../helpers';
import {
    $ES6,
    _ES6,
    asIdentityId,
    AbstractProxy,
    CoreManager,
    CoreService,
    Elastic6Instance,
    Elastic6SearchParams,
    Elastic6Synchronizer,
    ManagerProxy,
    filterFields,
    sourceToItem,
} from './abstract-service';
import { asyncCredentials } from '../tools';

jest.mock('request', () => {
    return jest.fn();
});

jest.mock('./libs/sig-v4', () => {
    const actual = jest.requireActual('./libs/sig-v4');
    return {
        ...actual,
        sigV4Client: jest.fn(() => ({
            signRequest: jest.fn(({ path }) => ({
                headers: { Authorization: `signed${path || ''}` },
                url: `https://signed${path || ''}`,
            })),
        })),
    };
});

jest.mock('../helpers', () => {
    const actual = jest.requireActual('../helpers');
    return {
        ...actual,
        $info: jest.fn(() => ({ service: 'lemon-core' })),
        $slack: jest.fn(() => Promise.reject(new Error('slack-failure'))),
        $protocol: jest.fn(() => ({
            execute: jest.fn(async () => ({ identityId: 'mock', Account: { id: 'acct' } })),
        })),
    };
});

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

    const requestMock = request as unknown as jest.Mock;
    const sigV4ClientMock = sigV4Client as unknown as jest.Mock;
    const slackMock = $slack as unknown as jest.Mock;
    const protocolFactoryMock = $protocol as unknown as jest.Mock;
    const infoMock = $info as unknown as jest.Mock;
    const requestQueue: Array<(options: any, callback: (error: any, response: any, body: any) => void) => void> = [];
    const enqueueRequest = (
        handler: (options: any, callback: (error: any, response: any, body: any) => void) => void,
    ) => requestQueue.push(handler);

    beforeEach(() => {
        requestQueue.length = 0;
        requestMock.mockImplementation((options: any, callback: (error: any, response: any, body: any) => void) => {
            const handler = requestQueue.shift();
            if (handler) return handler(options, callback);
            callback(null, { statusCode: 200, statusMessage: 'OK' }, { ok: true });
        });
        sigV4ClientMock.mockReset();
        sigV4ClientMock.mockImplementation(() => ({
            signRequest: jest.fn(({ path }: { path: string }) => ({
                headers: { Authorization: `signed${path || ''}` },
                url: `https://signed${path || ''}`,
            })),
        }));
        slackMock.mockReset();
        slackMock.mockRejectedValue(new Error('slack-failure'));
        protocolFactoryMock.mockReset();
        protocolFactoryMock.mockImplementation(() => ({
            execute: jest.fn(async () => ({ identityId: 'mock', Account: { id: 'acct' } })),
        }));
        infoMock.mockReset();
        infoMock.mockReturnValue({ service: 'lemon-core' });
    });

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
        const defaultService = new BackendService(undefined, undefined);
        expect2(() => defaultService.dynamoOptions).toEqual({ idName: '_id', tableName: 'Test' });
        expect2(() => service.$test.hello()).toEqual(service.$test.storage.hello());
        const typed = service.makeStorageService('test', TEST_FIELDS, service.$test as any);
        expect2(() => typed.hello()).toEqual(service.$test.storage.hello());

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

    //* check of createHttpSearchProxy()
    it('should pass $ES6.$X.createHttpSearchProxy()', async () => {
        const $X = $ES6.$X;
        expect2(() => $X.createHttpSearchProxy('' as any)).toEqual(
            '@endpoint (url) is required - createHttpSearchProxy()',
        );

        const endpoint = `https://mock.execute-api.ap-northeast-2.amazonaws.com/dev/search/0/proxy`;
        const proxy = $X.createHttpSearchProxy(endpoint, {
            headers: { Authorization: 'base-token' },
            encoder: (name, value) => `${name}-${value}`,
            relayHeaderKey: 'x-relay-',
            resultKey: 'data',
        });

        //* success case with relay headers and resultKey
        enqueueRequest((options, callback) => {
            expect2(() => options.uri).toEqual(`${endpoint}/host-target/path-command?limit=1`);
            expect2(() => options.headers['x-relay-Authorization']).toEqual('base-token');
            callback(null, { statusCode: 200, statusMessage: 'OK' }, JSON.stringify({ data: { ok: true } }));
        });
        expect2(await proxy.doProxy('GET', 'target', 'command', { limit: 1 }, { body: true })).toEqual({ ok: true });

        //* error handling with signed request
        const proxyWithSig = $X.createHttpSearchProxy(endpoint, {
            credentials: { accessKeyId: 'key', secretAccessKey: 'secret' } as any,
            region: 'ap-northeast-2',
        });
        enqueueRequest((options, callback) => {
            expect2(() => options.headers.Authorization).toEqual('signed');
            callback(null, { statusCode: 400, statusMessage: 'Bad Request' }, 'invalid');
        });
        expect2(await proxyWithSig.doProxy('POST').catch(GETERR)).toEqual('400 BAD REQUEST - invalid');

        //* non-400 failure case
        enqueueRequest((options, callback) => {
            callback(null, { statusCode: 500, statusMessage: 'Server Error' }, 'boom');
        });
        expect2(await proxyWithSig.doProxy('GET').catch(GETERR)).toEqual('500 Server Error - boom');

        //* request level error
        enqueueRequest((options, callback) => {
            callback(new Error('net-fail'), null, null);
        });
        expect2(await proxyWithSig.doProxy('GET', undefined, undefined, undefined, 'raw').catch(GETERR)).toEqual(
            'net-fail',
        );

        enqueueRequest((options, callback) => {
            callback(null, { statusCode: 200, statusMessage: 'OK' }, JSON.stringify([{ ok: true }]));
        });
        expect2(await proxy.doProxy('GET', 'array', 'case')).toEqual([{ ok: true }]);

        enqueueRequest((options, callback) => {
            callback(null, { statusCode: 200, statusMessage: 'OK' }, '{"invalid": }');
        });
        expect2(await proxy.doProxy('GET', 'invalid', 'case')).toEqual('{"invalid": }');

        const plainProxy = $X.createHttpSearchProxy(endpoint);
        enqueueRequest((options, callback) => {
            callback(null, { statusCode: 200, statusMessage: 'OK' }, { ok: 'plain' });
        });
        expect2(await plainProxy.doProxy('GET', 'plain-host', 'plain-cmd')).toEqual({ ok: 'plain' });
        expect2(() => plainProxy.hello()).toEqual('http-search-proxy:');
        const methodErr = await Promise.resolve()
            .then(() => plainProxy.doProxy(null as any))
            .catch(GETERR);
        expect2(methodErr).toEqual('@method is required - createHttpSearchProxy()');

        expect2(sigV4ClientMock.mock.calls.length).toEqual(1);
    });

    //* check of _ES6
    it('should pass _ES6 factory', async () => {
        const prevDocType = process.env.ES6_DOCTYPE;
        process.env.ES6_DOCTYPE = '_doc';
        const endpoint = `https://ag1qbtayhj.execute-api.ap-northeast-2.amazonaws.com/dev/search/echo/query`;
        const param: Elastic6SearchParams = { searchType: 'query_then_fetch' };
        const body: SearchBody = { size: 1, query: null };

        const proxyAgent = _ES6({
            endpoint,
            indexName: 'test-v1',
            useProxy: true,
            credentials: { accessKeyId: 'key', secretAccessKey: 'secret' } as any,
        });

        enqueueRequest((options, callback) => {
            callback(null, { statusCode: 200, statusMessage: 'OK' }, { list: [{ id: '1' }], total: 1 });
        });
        expect2(await proxyAgent.search(body, param)).toEqual({ list: [{ id: '1' }], total: 1 });

        (proxyAgent as any).proxy = null;
        (proxyAgent as any).elastic = {
            search: jest.fn(async () => ({ list: [], total: 0, last: undefined })),
            options: { indexName: 'test-v1', docType: '_doc' },
        };
        expect2(await proxyAgent.search({}, {})).toEqual({ list: [], total: 0, last: undefined });

        const directAgent = _ES6({
            endpoint: 'https://vpc-xyz.ap-northeast-2.es.amazonaws.com',
            indexName: 'direct-test',
            useProxy: false,
        });
        expect2(() => directAgent.hello()).toEqual('Elastic6Instance');

        process.env.ES6_IS_PROXY = '';
        const autoAgent = _ES6({
            endpoint: 'https://auto.execute-api.ap-northeast-2.amazonaws.com/proxy',
            indexName: 'auto-test',
        });
        expect2(() => autoAgent.hello()).toEqual('Elastic6Proxy');
        const prevProxyFlag = process.env.ES6_IS_PROXY;
        process.env.ES6_IS_PROXY = '1';
        const forcedAgent = _ES6({
            endpoint: 'https://forced.execute-api.ap-northeast-2.amazonaws.com/proxy',
            indexName: 'forced-index',
        });
        expect2(() => forcedAgent.hello()).toEqual('Elastic6Proxy');
        process.env.ES6_IS_PROXY = prevProxyFlag;
        process.env.ES6_DOCTYPE = prevDocType;
    });

    it('should extract identity id safely', async () => {
        const context = { identity: { identityId: 'us-east-2:abc' } } as NextContext;
        expect2(() => asIdentityId(context)).toEqual('us-east-2:abc');
        expect2(() => asIdentityId({} as NextContext)).toEqual(undefined);
        expect2(() => asIdentityId(null as any)).toEqual(undefined);
    });

    it('should manage CoreManager unique flows', async () => {
        const { service } = instance();
        class UniqueManager extends CoreManager<TestModel, ModelType, BackendService> {
            public constructor(parent: BackendService) {
                super('test', parent, TEST_FIELDS, 'name');
            }
        }
        const mgr = new UniqueManager(service);
        const base = { name: 'unique-a', ns: 'TT', type: 'test' } as TestModel;

        expect2(await mgr.prepare('guard', undefined, false).catch(GETERR)).toEqual('404 NOT FOUND - test:guard');
        const prepared = await mgr.prepare('unique-a', base);
        expect2(() => prepared, 'id,name').toEqual({ id: 'unique-a', name: 'unique-a' });

        expect2(await mgr.find('missing')).toEqual(null);

        const originalRetrieve = mgr.retrieve.bind(mgr);
        mgr.retrieve = jest.fn(() => Promise.reject(new Error('fatal'))) as any;
        expect2(await mgr.find('fatal').catch(GETERR)).toEqual('fatal');
        mgr.retrieve = originalRetrieve;

        const readSpy = jest
            .spyOn(mgr.storage.storage, 'read')
            .mockRejectedValueOnce(new Error('404 NOT FOUND - _id:bad'));
        expect2(await mgr.findByKey('bad')).toEqual(null);
        readSpy.mockRestore();

        const readFatal = jest.spyOn(mgr.storage.storage, 'read').mockRejectedValueOnce(new Error('fatal-key'));
        expect2(await mgr.findByKey('fatal').catch(GETERR)).toEqual('fatal-key');
        readFatal.mockRestore();

        const unique404 = jest
            .spyOn(mgr.$unique, 'findOrCreate')
            .mockRejectedValueOnce(new Error('404 NOT FOUND - lookup'));
        expect2(await mgr.findByUniqueField('unknown')).toEqual(null);
        unique404.mockRestore();

        const uniqueFatal = jest.spyOn(mgr.$unique, 'findOrCreate').mockRejectedValueOnce(new Error('fatal-unique'));
        expect2(await mgr.findByUniqueField('boom').catch(GETERR)).toEqual('fatal-unique');
        uniqueFatal.mockRestore();

        const saved = await mgr.save('unique-a', { ...prepared, name: 'unique-b' });
        expect2(() => saved, 'name').toEqual({ name: 'unique-b' });
        await mgr.save('fresh', { name: 'fresh' } as TestModel);

        const updated = await mgr.update('unique-a', { name: 'unique-c' } as TestModel);
        expect2(() => updated, 'name').toEqual({ name: 'unique-c' });

        const upserted = await mgr.updateOrCreate('unique-new', { name: 'unique-new' } as TestModel);
        expect2(() => upserted, 'id,name').toEqual({ id: 'unique-new', name: 'unique-new' });

        const getByUnique = await mgr.getByUniqueField('unique-c');
        expect2(() => getByUnique, 'name').toEqual({ name: 'unique-c' });

        const deleteSpy = jest.spyOn(mgr.storage, 'delete');
        const deleted = await mgr.delete('unique-a');
        expect2(() => deleted, 'id').toEqual({ id: 'unique-a' });
        expect2(deleteSpy.mock.calls.length).toEqual(2);
        deleteSpy.mockRestore();
        await mgr.delete('unique-new');

        const nextSeqSpy = jest.spyOn(mgr.storage.storage as any, 'nextSeq').mockResolvedValueOnce('seq-1');
        const saveSpy = jest.spyOn(mgr, 'save').mockResolvedValueOnce({ id: 'seq-1', name: 'seq' } as TestModel);
        expect2(await mgr.insert({ name: 'seq' } as TestModel)).toEqual({ id: 'seq-1', name: 'seq' });
        saveSpy.mockRestore();
        nextSeqSpy.mockRestore();

        expect2(await mgr.save('', { name: 'guard' } as TestModel).catch(GETERR)).toEqual('@id is requird - save()');
        expect2(await mgr.update('', { name: 'guard' } as TestModel).catch(GETERR)).toEqual(
            '@id is requird - update()',
        );
        expect2(await mgr.updateOrCreate('', { name: 'guard' } as TestModel).catch(GETERR)).toEqual(
            '@id is requird - updateOrCreate()',
        );
        expect2(await mgr.delete('', true).catch(GETERR)).toEqual('@id is requird - delete()');

        const lookupSpy = jest.spyOn(mgr.$unique, 'updateLookup').mockResolvedValue(undefined as any);
        const deleteSpy2 = jest.spyOn(mgr.storage, 'delete').mockResolvedValue(undefined as any);
        await (mgr as any).updateLookup('lookup-id', { name: 'newer' } as TestModel, { name: 'older' } as TestModel);
        expect2(lookupSpy.mock.calls.length).toEqual(1);
        lookupSpy.mockRestore();
        deleteSpy2.mockRestore();
    });

    it('should cover ManagerProxy utilities', async () => {
        const { service } = instance();
        const proxy = service.buildProxy({}) as BackendProxy;
        const mgr = proxy.tests;
        expect2(() => mgr.org('unread')).toEqual(null);
        expect2(() => mgr.has('unread')).toEqual(false);
        expect2(() => mgr.storage.hello()).toEqual(service.$test.storage.hello());

        const normalized = mgr.normal({ _meta: 'off', $id: 'skip', visible: null } as any);
        expect2(() => normalized).toEqual({ visible: '' });
        expect2(() => mgr.normal(null as any)).toEqual({});

        await mgr.get('proxy-a', { name: 'proxy-a' } as TestModel);
        const clone = mgr.org('proxy-a');
        expect2(() => clone.name).toEqual('proxy-a');
        expect2(() => mgr.org('proxy-a', true).name).toEqual('proxy-a');
        expect2(() => mgr.has('proxy-a')).toEqual(true);

        expect2(await mgr.get('proxy-miss').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:proxy-miss');
        expect2(await mgr.get('proxy-miss').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:proxy-miss');
        expect2(await mgr.get('proxy-miss', false)).toEqual(null);

        expect2(await mgr.set('proxy-a', null as any).catch(GETERR)).toEqual(
            '@model (object) is required - proxy/test/id:proxy-a!',
        );
        expect2(await mgr.set('proxy-a', undefined as any).catch(GETERR)).toEqual(
            '@model (object) is required - proxy/test/id:proxy-a!',
        );

        expect2(await mgr.inc('proxy-a', { flag: 'x' } as any).catch(GETERR)).toEqual(
            '@model (object) is empty to inc() - proxy/test/id:proxy-a!',
        );
        expect2(await mgr.inc('proxy-a', null as any).catch(GETERR)).toEqual(
            '@model (object) is required - proxy/test/id:proxy-a!',
        );

        const inc = (await mgr.inc('proxy-a', { score: 1 } as any)) as any;
        expect2(() => inc, 'score').toEqual({ score: inc.score });

        await mgr.set('proxy-a', { name: 'updated' } as TestModel);
        const diff = mgr.alls();
        expect2(() => diff['proxy-a'], 'name').toEqual({ name: 'updated' });

        const snapshot = mgr.alls(false, false);
        expect2(() => snapshot['proxy-a'], 'name').toEqual({ name: 'updated' });

        await proxy.saveAllUpdates();
    });

    it('should cover AbstractProxy reporting and identity cache', async () => {
        const cacheEnv = process.env.CACHE_ENDPOINT;
        process.env.CACHE_ENDPOINT = 'redis://127.0.0.1:6379';
        const cacheSpy = jest.spyOn(CacheService, 'create').mockReturnValue({} as CacheService);

        class TestableProxy extends BackendProxy {
            public exposeFetch(identityId?: string, domain?: string) {
                return this.fetchIdentityAccess(identityId, domain);
            }
        }

        const { service } = instance();
        const context = { domain: 'lemon', identity: { identityId: 'ap-northeast-2:ctx' } } as NextContext;
        const proxy = new TestableProxy(context, service);
        expect2(cacheSpy.mock.calls.length).toEqual(1);

        expect2(await proxy.report('title', { ok: true })).toEqual('ERR:slack-failure');
        expect2(await proxy.exposeFetch(null as any, 'lemon').catch(GETERR)).toEqual(
            '.identityId (string) is required - fetchAccess(lemon)',
        );

        const fetched = await proxy.exposeFetch('abc', 'lemon');
        expect2(() => fetched.identityId).toEqual('abc');

        const identity = (await proxy.getIdentity$('abc')) as any;
        expect2(() => identity.identityId).toEqual('mock');
        expect2(await proxy.getIdentity$('abc')).toEqual(identity);
        await proxy.getIdentity$('abc', true);
        expect2(await proxy.getIdentity$(null as any)).toEqual(null);

        const currentIdentity = (await proxy.getCurrentIdentity$()) as any;
        expect2(() => currentIdentity.identityId).toEqual('mock');
        const currentId = await proxy.getCurrentIdentityId();
        expect2(() => currentId).toEqual('ap-northeast-2:ctx');

        const noIdentityProxy = new TestableProxy({} as NextContext, service);
        expect2(await noIdentityProxy.getCurrentIdentityId().catch(GETERR)).toEqual(
            '400 NOT ALLOWED - getCurrentIdentity()',
        );
        expect2(await noIdentityProxy.getCurrentIdentityId(false)).toEqual('');
        expect2(await noIdentityProxy.getCurrentIdentity$(false)).toEqual(null);

        cacheSpy.mockRestore();
        process.env.CACHE_ENDPOINT = cacheEnv;
    });

    it('should configure Elastic6Synchronizer with handlers', async () => {
        expect2(() => new Elastic6Synchronizer(null as any, { tableName: 'Test' })).toEqual(
            '@elastic (elastic-service) is required!',
        );
        expect2(() => new Elastic6Synchronizer({} as Elastic6Service, null as any)).toEqual(
            '@dynamoOptions (object) is required!',
        );

        let capturedFilter: any;
        let capturedBefore: any;
        let capturedAfter: any;
        const createSpy = jest
            .spyOn(LambdaDynamoStreamHandler, 'createSyncToElastic6')
            .mockImplementation((_opt, _elastic, filter, before, after) => {
                capturedFilter = filter;
                capturedBefore = before;
                capturedAfter = after;
                return jest.fn();
            });
        const addListenerSpy = jest
            .spyOn($cores.lambda.dynamos, 'addListener')
            .mockImplementation(listener => listener);

        const sync = new Elastic6Synchronizer({} as Elastic6Service, { tableName: 'Test' });
        sync.enableSynchronization('test');
        expect2(await capturedFilter('id', { type: 'test', stereo: 'std' } as CoreModel<string>)).toEqual(true);
        expect2(await capturedFilter('id', { type: '#skip', stereo: '#s' } as CoreModel<string>)).toEqual(false);

        const handler = {
            filter: jest.fn(() => true),
            onBeforeSync: jest.fn(async () => undefined),
            onAfterSync: jest.fn(async () => undefined),
        };
        sync.enableSynchronization('custom', handler);
        expect2(await capturedFilter('id', { type: 'custom', stereo: 'std', st: 'ok' } as any)).toEqual(true);
        await capturedBefore('id', 'MODIFY', { type: 'custom' } as any, ['name'], null);
        await capturedAfter('id', 'MODIFY', { type: 'custom' } as any, ['name'], null);
        expect2(handler.onBeforeSync.mock.calls.length).toEqual(1);
        expect2(handler.onAfterSync.mock.calls.length).toEqual(1);

        createSpy.mockRestore();
        addListenerSpy.mockRestore();
    });

    it('should operate Elastic6Instance helpers', async () => {
        const agent = new Elastic6Instance({
            endpoint: '',
            indexName: '',
            esVersion: '6.8',
            esDocType: '_doc',
            tableName: 'Test',
        });
        const stubClient = {
            mget: jest.fn(async () => ({
                body: { docs: [{ found: true, _source: { $id: '1', name: 'one' } }, { found: false }] },
            })),
        };
        const stubElastic: any = {
            options: { docType: '_doc', idName: '$id', indexName: 'test-index', version: '6.8' },
            createIndex: jest.fn(async settings => ({ ok: true, settings })),
            destroyIndex: jest.fn(async () => 'destroyed'),
            describe: jest.fn(async () => ({ state: 'desc' })),
            search: jest.fn(async () => ({ list: [{ id: '1' }], total: 1, last: undefined })),
        };
        (agent as any).elastic = stubElastic;
        (agent as any).client = stubClient;

        const prepareSpy = jest
            .spyOn(Elastic6Service, 'prepareSettings')
            .mockReturnValueOnce({ mappings: { _doc: {} } });
        const created = await agent.createIndex();
        expect2(() => created.ok).toEqual(true);
        stubElastic.options.version = '7.2';
        prepareSpy.mockReturnValueOnce({ mappings: {} });
        await agent.createIndex();

        expect2(await agent.destroyIndex()).toEqual('destroyed');
        expect2(await agent.describeIndex()).toEqual({ state: 'desc' });

        const mgetRes = await agent.mget(['1', '2']);
        expect2(() => mgetRes[0], '_id,name').toEqual({ _id: '1', name: 'one' });

        const searchRes = await agent.search({});
        expect2(() => searchRes.total).toEqual(1);

        const searchSpy = jest
            .spyOn(agent, 'search')
            .mockResolvedValueOnce({ list: [{ id: '1' }], last: ['cursor'], total: 1 })
            .mockResolvedValueOnce({ list: [{ id: '2' }], last: undefined, total: 1 });
        const generator = agent.generateSearchResult({});
        const first = await generator.next();
        const firstList = (first.value || []) as any[];
        expect2(() => firstList[0].id).toEqual('1');
        const second = await generator.next();
        const secondList = (second.value || []) as any[];
        expect2(() => secondList[0].id).toEqual('2');
        const done = await generator.next();
        expect2(() => done.done).toEqual(true);
        searchSpy.mockRestore();
        prepareSpy.mockRestore();

        const emptyAgent = new Elastic6Instance({
            endpoint: '',
            indexName: '',
            esVersion: '6.8',
            esDocType: '_doc',
            tableName: 'Test',
        });
        expect2(await emptyAgent.createIndex()).toEqual(null);
        expect2(await emptyAgent.search({}).catch(GETERR)).toEqual(
            'Could not read Elasticsearch endpoint or index setting.',
        );
    });

    it('should convert elastic source to dynamo item', async () => {
        expect2(() => sourceToItem({ $id: '1', name: 'one' })).toEqual({ _id: '1', name: 'one' });
    });
});
