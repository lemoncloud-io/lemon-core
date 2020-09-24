/**
 * `api-servcie.spec.js`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-04 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { loadProfile } from '../environ';
import $engine, { $U } from '../engine';
import { GETERR, expect2 } from '../common/test-helper';
import { APIService, APIServiceClient, APIHeaders, ApiHttpProxy, MocksAPIService } from './api-service';
import { loadJsonSync } from '../tools';

//! api with `lemon-hello-api` in prod @lemon.
const TYPE = 'hello';
const HOST = 'hg9errxv25.execute-api.ap-northeast-2.amazonaws.com';
const ENDPOINT = `https://${HOST}/prod`;

//! build instance
const instance = (client?: APIServiceClient, headers?: APIHeaders, proxy?: ApiHttpProxy, type?: string) => {
    type = type || `${TYPE || 'hello'}`;
    const endpoint = ENDPOINT || '';
    const service = new APIService(type, endpoint, headers, client, proxy);
    return { service };
};

//! main test body.
describe('APIService', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    PROFILE && console.info(`! PROFILE =`, PROFILE);
    jest.setTimeout(10000);

    //! via direct request.
    it('should pass API w/ direct request', async done => {
        //! create direct client.
        const client: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, null, '');
        const { service } = instance(client);

        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${HOST}-${TYPE}`);
        expect2(await service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');

        //! check recording....... @191212
        const baseDir = `./logs`;
        const recorder = service.buildRecorder(baseDir);

        expect2(await recorder.doGet('0')).toEqual({ name: 'lemon' });
        const ts = $U.ts().substring(0, '1999-01-01'.length).replace(/\-/ig, '');
        const file = `${baseDir}/R${ts}/D00001.json`
        expect2(loadJsonSync(file), 'param').toEqual({ param:{ method:'GET', endpoint:ENDPOINT, id:'0' }})
        expect2(loadJsonSync(file), 'data').toEqual({ data:{ name:'lemon' }})
        expect2(loadJsonSync(file), 'error').toEqual({ error:'' })

        /* eslint-enable prettier/prettier */
        done();
    });

    //! via direct request.
    it('should pass API (SubTyped) w/ direct request', async done => {
        //! create direct client w/ sub-type.
        const type0 = ENDPOINT.substring(ENDPOINT.lastIndexOf('/') + 1);
        const endpoint = ENDPOINT.substring(0, ENDPOINT.lastIndexOf('/'));
        const client: APIServiceClient = APIService.buildClient(type0, endpoint, null, '');
        const { service: service0 } = instance(client);
        const service = service0.buildSubTypeClient(TYPE);

        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual(`sub-typed:api-service:api-client:http-web-proxy:API:${HOST}-${type0}`);
        expect2(await service.doGet(' 1').catch(GETERR)).toEqual('@id (string) is not valid format.');      // NOT ALLOWED STRING

        //! check sub-typed request.
        expect2(await service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! via direct request.
    it('should pass API (null + SubTyped) w/ direct request', async done => {
        //! create direct client w/ sub-type.
        const $api = new APIService(null, ENDPOINT);
        const service = $api.buildSubTypeClient('hello');

        /* eslint-disable prettier/prettier */
        //! check sub-typed request.
        expect2(() => service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(() => service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(() => service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(() => service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! via direct request /w header
    it('should pass API w/ direct request w/ header', async done => {
        //! create direct client.
        const TYPE = 'echo';
        const ENDPOINT = 'http://localhost:8888';
        const HEADERS: APIHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

        const client0: APIServiceClient = APIService.buildClient(null, ENDPOINT, null, '');
        const client1: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, null, '');
        const client2: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, HEADERS, '');
        const { service: service1 } = instance(client1);
        const { service: service2 } = instance(client2);

        /* eslint-disable prettier/prettier */
        expect2(client0.hello()).toEqual(`api-client:http-web-proxy:API:localhost:8888-`);
        const ERRCON = await client0.doGet(null).catch(GETERR);
        if (ERRCON.indexOf('"ECONNREFUSED"') >= 0) return done();        //! ignore test.
        expect2(await client0.doGet(null).catch(GETERR)).toEqual('lemon-hello-api/2.2.1');  //! required to run `lemon-hello-api` as `$ npm run express`

        //! request with `application/json`
        expect2(service1.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${'localhost:8888'}-${TYPE}`);
        expect2(await service1.doPost(''), 'method,param,body').toEqual({ method:'POST', param:{}, body:{} });
        expect2(await service1.doPost(''), 'headers').toEqual({ headers:{ host:'localhost:8888', 'content-length':'0', accept:'application/json', connection:'close'} });
        expect2(await service1.doPost('', undefined, null, { a:1 }), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:1 } });

        //! request with `application/x-www-form-urlencoded`
        expect2(service2.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${'localhost:8888'}-${TYPE}`);
        expect2(await service2.doPost(''), 'method,param,body').toEqual({ method:'POST', param:{}, body:{} });
        expect2(await service2.doPost(''), 'headers').toEqual({ headers:{ host:'localhost:8888', 'content-length':'0', accept:'application/json', connection:'close', 'content-type':'application/x-www-form-urlencoded'} });
        // expect2(await service2.doPost('echo', null, undefined, { a:1 }), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } }); //WARN - do not pass object as body if 'content-type' is not json.

        expect2(await service2.doPost('', undefined, null, "a=1"), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } });
        expect2(await service2.doPost('', undefined, null, "a=1"), 'headers').toEqual({ headers:{ host:'localhost:8888', 'content-length':'3', connection:'close', 'content-type':'application/x-www-form-urlencoded'} });
        expect2(await service2.doPost('', null, undefined, "a=1"), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } });
        expect2(await service2.doPost('', null, { b:1 }, "a=1"), 'method,param,body').toEqual({ method:'POST', param:{ b:'1' }, body:{ a:"1" } });
        expect2(await service2.doPost('', null, "b=1", "a=1"), 'method,param,body').toEqual({ method:'POST', param:{ b:'1' }, body:{ a:"1" } });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! via backbone's web-proxy.
    it('should pass API w/ backbone proxy', async done => {
        //! create proxy client.
        const BACKBONE = $engine.environ('BACKBONE_API', 'http://localhost:8081') as string;
        const client: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, null, BACKBONE);
        const { service } = instance(client);

        // validate connection, or break.
        const first = await service.doGet(undefined).catch(GETERR);
        if (`${first}`.startsWith('connect ECONNREFUSED ')) return done();

        /* eslint-disable prettier/prettier */
        if (BACKBONE){
            expect2(service.hello()).toEqual('api-service:api-client:http-web-proxy:WEB:hg9errxv25.execute-api.ap-northeast-2.amazonaws.com-hello');
        } else {
            expect2(service.hello()).toEqual('api-service:api-client:http-web-proxy:API:hg9errxv25.execute-api.ap-northeast-2.amazonaws.com-hello');
        }
        expect2(await service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! use envion
    it('should pass API w/ default env', async done => {
        //! create direct client.
        const BACKBONE = $engine.environ('BACKBONE_API', 'http://localhost:8081') as string;
        BACKBONE && console.info(`> BACKBONE =`, BACKBONE);
        const { service } = instance();
        /* eslint-disable prettier/prettier */
        if (BACKBONE){
            expect2(service.hello()).toEqual(`api-service:api-client:http-web-proxy:WEB:${HOST}-${TYPE}`);
            const first = await service.doGet(undefined).catch(GETERR);
            if (`${first}`.startsWith('connect ECONNREFUSED ')) {
                console.info(`WARN! ignore err:${first}`);
                return done();
            }
        } else {
            expect2(service.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${HOST}-${TYPE}`);
        }
        expect2(await service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! mocks data w/ `hello`
    it('should pass mocks-api-service w/ mocks(hello) data', async done => {
        //! prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('hello', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('hello', 'https://api.lemoncloud.io/hello');
        const { service } = instance(null, null, proxy);

        /* eslint-disable prettier/prettier */
        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/hello`);
        expect2(service.hello()).toEqual(`api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/hello`);

        expect2(await client.doGet(undefined).catch(GETERR)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await client.doGet('1').catch(GETERR)).toEqual({ name: 'cloud' });

        expect2(await proxy.doProxy('GET', undefined).catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello');
        expect2(await proxy.doProxy('GET', 'hello', '1')).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1');
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/0');
        expect2(await service.doGet('1')).toEqual({ name: 'cloud' });
        expect2(await service.doGet('1','hi').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/1/hi');
        expect2(await service.doGet('/1','').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/');
        expect2(await service.doGet('/1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1');
        expect2(await service.doGet('/1','h/i').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/h/i');
        /* eslint-enable prettier/prettier */

        done();
    });

    //! mocks data w/ `mocks(world) + service(hello)`
    it('should pass mocks-api-service w/ mocks(world) + service(hello)', async done => {
        //! prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const { service } = instance(null, null, proxy, 'hello');

        /* eslint-disable prettier/prettier */
        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/world`);
        expect2(service.hello()).toEqual(`api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/world`);

        expect2(await client.doGet(undefined).catch(GETERR), '!path').toEqual({ list: [{ name: 'lemon' }, { name: 'world' }], name: 'world' });
        expect2(await client.doGet('1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await proxy.doProxy('GET', undefined).catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello');
        expect2(await proxy.doProxy('GET', 'hello', '1'), '!path').toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1');
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await service.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/0');
        expect2(await service.doGet('1')).toEqual({ name: 'cloud' });
        expect2(await service.doGet('1','hi').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/1/hi');
        expect2(await service.doGet('/1','').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/');
        expect2(await service.doGet('/1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1');
        expect2(await service.doGet('/1','h/i').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/h/i');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! mocks data w/ `mocks(world) + service(world)`
    it('should pass mocks-api-service w/ mocks(world) + service(world)', async done => {
        //! prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const { service } = instance(null, null, proxy, 'world');

        /* eslint-disable prettier/prettier */
        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/world`);
        expect2(service.hello()).toEqual(`api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/world`);

        expect2(await client.doGet(undefined).catch(GETERR), '!path').toEqual({ list: [{ name: 'lemon' }, { name: 'world' }], name: 'world' });
        expect2(await client.doGet('1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await proxy.doProxy('GET', undefined).catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello');
        expect2(await proxy.doProxy('GET', 'hello', '1'), '!path').toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1');
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await service.doGet(undefined), '!path').toEqual({ list: [{ name: 'lemon' }, { name: 'world' }], name: 'world' });
        expect2(await service.doGet(''), '!path').toEqual({ list: [{ name: 'lemon' }, { name: 'world' }], name: 'world' });
        expect2(await service.doGet('0').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });
        expect2(await service.doGet('1'), '!path').toEqual({ name: 'world' });
        expect2(await service.doGet('1','hi').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/1/hi');
        expect2(await service.doGet('/1','').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/%2F1/');
        expect2(await service.doGet('/1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/%2F1');
        expect2(await service.doGet('/1','h/i').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/%2F1/h/i');

        //! check query + hash path.
        expect2(await service.doGet('0').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });
        expect2(await service.doGet('0', null, { a:1 }).catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0?a=1' });
        expect2(await service.doGet('0', null, { b:null }).catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0?b' });
        expect2(await service.doGet('0', null, { c:null }).catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });   //! it will use default `/hello/world/0`

        expect2(await service.doGet('0', null, { a:1 }, null).catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0?a=1' });
        expect2(await service.doGet('0', null, { b:null }, null).catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0?b' });
        expect2(await service.doGet('0', null, { c:null }, null).catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });

        expect2(await service.doGet(null, null, null, null, 'a').catch(GETERR), 'path').toEqual({ path:'GET /hello/world#a' });
        expect2(await service.doGet('', null, null, null, 'a').catch(GETERR), 'path').toEqual({ path:'GET /hello/world#a' });

        expect2(await service.doGet('0', null, { a:1 }, null, 'a').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0?a=1#a' });
        expect2(await service.doGet('0', null, { a:2 }, null, 'a').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });           // use default
        expect2(await service.doGet('0', null, { a:3 }, null, 'a').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });           // use default
        expect2(await service.doGet('X', null, { a:3 }, null, 'a').catch(GETERR), 'path').toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/X?a=3#a');

        expect2(await service.doGet('0', null, { a:1 }, null, 'b').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0?a=1#b' });
        expect2(await service.doGet('0', null, { a:2 }, null, 'b').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });           // use default
        expect2(await service.doGet('0', null, { a:3 }, null, 'b').catch(GETERR), 'path').toEqual({ path:'GET /hello/world/0' });           // use default
        expect2(await service.doGet('X', null, { a:3 }, null, 'b').catch(GETERR), 'path').toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/X?a=3#b');

        /* eslint-enable prettier/prettier */
        done();
    });
});
