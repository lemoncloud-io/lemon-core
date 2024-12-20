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

//! create service instance.
export const instance = (type: string = 'dummy') => {
    const current = new Date().getTime();
    const service = new BackendService(type == 'dummy' ? 'dummy-data.yml' : '');
    service.setCurrent(current);
    return { service, current };
};

//! main test body.
describe('abstract-service', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

    //! basic function
    it('should pass basic function', async () => {
        const { service } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        //! test filterFields()
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

        //! test CoreService()
        expect2(() => service.dynamoOptions).toEqual({ idName: '_id', tableName: 'dummy-data.yml' });

        //! test CoreManager();
        const { $test } = service;
        expect2(await $test.find('1')).toEqual(null);
        expect2(await $test.exists('1')).toEqual(false);
        expect2(await $test.findByKey('1')).toEqual(null);
        expect2(await $test.getMulti(['1', '1'])).toEqual([null, null]);
        expect2(await $test.getMulti$(['1', '1'])).toEqual({ '1': { id: '1', error: '404 NOT FOUND - test:1' } });
    });

    //! basic ManagerProxy()
    it('should pass ManagerProxy()', async () => {
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
                    // must be null.
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual(`Cannot set properties of null (setting 'name')`);
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
    });

    //! check of `$ES6`
    it('should pass $ES6', async () => {
        const { service, current } = instance();

        expect2(() => $ES6.hello()).toEqual('Elastic6Instance');

        //* check environment
        expect2(() => $U.env('ES6_ENDPOINT', '')).toEqual('');
        expect2(() => $U.env('ES6_INDEX', '')).toEqual('');

        //* the search options.
        expect2(() => $ES6.options).toEqual(null);

        const $X = ($ES6 as any).$X;
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

        //* test of loadCredentials()
        if (!PROFILE) {
            expect2(() => $X.loadCredentials(), 'profile').toEqual({ profile: 'default' });
            expect2(() => $X.loadCredentials(''), 'profile').toEqual({ profile: 'default' });
            expect2(() => $X.loadCredentials('temp')).toEqual('@profile[temp] is invalid - loadCredentials(temp)');
            expect2(() => $X.loadCredentials('lemon'), 'profile').toEqual({ profile: 'lemon' });

            const cred = $X.loadCredentials('lemon');
            expect2(() => [typeof cred?.accessKeyId, cred?.accessKeyId?.length].join(':')).toEqual('string:20');
            expect2(() => [typeof cred?.secretAccessKey, cred?.secretAccessKey?.length].join(':')).toEqual('string:40');
        }
    });

    //* check of createHttpSearchProxy()
    it('should pass $ES6.$X.createHttpSearchProxy()', async () => {
        //* ignore if not in 'lemon'
        if (PROFILE !== 'lemon') {
            console.info(`! ignored by profile[${PROFILE}]`);
            return;
        }

        // use `lemon-hello-api` in prod.
        const endpoint = `https://hg9errxv25.execute-api.ap-northeast-2.amazonaws.com/prod`;
        const $X = $ES6.$X;
        const credentials = $X.loadCredentials(PROFILE);
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
            console.info(`! ignored by profile[${PROFILE}]`);
            return;
        }

        // use `lemon-templates-api` in dev.
        const endpoint = `https://ag1qbtayhj.execute-api.ap-northeast-2.amazonaws.com/dev/search/echo/query`;
        const $X = $ES6.$X;
        const credentials = $X.loadCredentials(PROFILE);
        const proxy = $X.createHttpSearchProxy(endpoint, { credentials });

        // GET method test
        const param: Elastic6SearchParams = { searchType: 'query_then_fetch' };
        const body: SearchBody = { size: 1, query: null };
        expect2(await proxy.doProxy('POST', null, null, param, { body }).catch(GETERR), '!context').toEqual({
            param,
            body: { body },
        });

        const agent = _ES6({ endpoint });
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
});
