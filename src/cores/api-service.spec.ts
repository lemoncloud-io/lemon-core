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
import { GETERR, GETERR$, expect2, marshal, Filter, _it } from '../common/test-helper';
import { APIService, APIServiceClient, APIHeaders, ApiHttpProxy, MocksAPIService } from './api-service';
import $engine from '../engine';
import environ from '../environ';

const TYPE = 'hello';
const HOST = 'hg9errxv25.execute-api.ap-northeast-2.amazonaws.com';
const ENDPOINT = `https://${HOST}/prod`;

//! api with `lemon-hello-api` in prod @lemon.
const instance = (client?: APIServiceClient, headers?: APIHeaders, proxy?: ApiHttpProxy) => {
    const type = TYPE || 'hello';
    const endpoint = ENDPOINT || 'https://hg9errxv25.execute-api.ap-northeast-2.amazonaws.com/prod';
    const service = new APIService(type, endpoint, headers, client, proxy);
    return { service };
};

//! main test body.
describe('APIService', () => {
    //! load env via `/env/<ENV>.yml`.
    const $env = environ(process);
    console.info(`! BACKBONE =`, $env['BACKBONE']);

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
        /* eslint-enable prettier/prettier */
        done();
    });

    //! via direct request /w header
    it('should pass API w/ direct request w/ header', async done => {
        //! create direct client.
        const TYPE = 'hello';
        const ENDPOINT = 'http://localhost:7101';
        const HEADERS: APIHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

        const client0: APIServiceClient = APIService.buildClient(null, ENDPOINT, null, '');
        const client1: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, null, '');
        const client2: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, HEADERS, '');
        const { service: service1 } = instance(client1);
        const { service: service2 } = instance(client2);

        /* eslint-disable prettier/prettier */
        expect2(client0.hello()).toEqual(`api-client:http-web-proxy:API:localhost:7101-`);
        const ERRCON = await client0.doGet(null).catch(GETERR);
        if (ERRCON.startsWith('connect ECONNREFUSED 127.0.0.1:7101')) return done();        //! ignore test.
        expect2(await client0.doGet(null).catch(GETERR)).toEqual('lemon-hello-api');

        //! request with `application/json`
        expect2(service1.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${'localhost:7101'}-${TYPE}`);
        expect2(await service1.doPost('echo'), 'method,param,body').toEqual({ method:'POST', param:{}, body:{} });
        expect2(await service1.doPost('echo'), 'headers').toEqual({ headers:{ host:'localhost:7101', 'content-length':'0', accept:'application/json', connection:'close'} });
        expect2(await service1.doPost('echo', undefined, null, { a:1 }), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:1 } });

        //! request with `application/x-www-form-urlencoded`
        expect2(service2.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${'localhost:7101'}-${TYPE}`);
        expect2(await service2.doPost('echo'), 'method,param,body').toEqual({ method:'POST', param:{}, body:{} });
        expect2(await service2.doPost('echo'), 'headers').toEqual({ headers:{ host:'localhost:7101', 'content-length':'0', accept:'application/json', connection:'close', 'content-type':'application/x-www-form-urlencoded'} });
        // expect2(await service2.doPost('echo', null, undefined, { a:1 }), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } }); //WARN - do not pass object as body if 'content-type' is not json.

        expect2(await service2.doPost('echo', undefined, null, "a=1"), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } });
        expect2(await service2.doPost('echo', undefined, null, "a=1"), 'headers').toEqual({ headers:{ host:'localhost:7101', 'content-length':'3', connection:'close', 'content-type':'application/x-www-form-urlencoded'} });
        expect2(await service2.doPost('echo', null, undefined, "a=1"), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } });
        expect2(await service2.doPost('echo', null, { b:1 }, "a=1"), 'method,param,body').toEqual({ method:'POST', param:{ b:'1' }, body:{ a:"1" } });
        expect2(await service2.doPost('echo', null, "b=1", "a=1"), 'method,param,body').toEqual({ method:'POST', param:{ b:'1' }, body:{ a:"1" } });

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
        console.info(`> BACKBONE =`, BACKBONE);
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

        expect2(await client.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await client.doGet('1')).toEqual({ name: 'cloud' });

        expect2(await proxy.doProxy('GET', undefined).catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/');
        expect2(await proxy.doProxy('GET', 'hello', '1')).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1');
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR)).toEqual({ name: 'world' });

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

    //! mocks data w/ `world`
    it('should pass mocks-api-service w/ mocks(world) data', async done => {
        //! prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const { service } = instance(null, null, proxy);

        /* eslint-disable prettier/prettier */
        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/world`);
        expect2(service.hello()).toEqual(`api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/world`);

        expect2(await client.doGet(undefined)).toEqual({ list: [{ name: 'lemon' }, { name: 'world' }], name: 'lemon' });
        expect2(await client.doGet('1')).toEqual({ name: 'world' });

        expect2(await proxy.doProxy('GET', undefined).catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/');
        expect2(await proxy.doProxy('GET', 'hello', '1')).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual('404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1');
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR)).toEqual({ name: 'world' });

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
});
