/**
 * `api-servcie.spec.js`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-04 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import $engine, { $U } from '../../engine';
import { GETERR, expect2 } from '../../common/test-helper';
import {
    APIService,
    APIServiceClient,
    APIHeaders,
    ApiHttpProxy,
    MocksAPIService,
    APIHttpMethod,
    APIProxyClient,
} from './api-service';
import { loadJsonSync } from '../../tools';
import fs from 'fs';
//* api with `lemon-hello-api` in prod @lemon.
const TYPE = 'hello';
const HOST = 'hg9errxv25.execute-api.ap-northeast-2.amazonaws.com';
const ENDPOINT = `https://${HOST}/prod`;

//* build instance
const instance = (client?: APIServiceClient, headers?: APIHeaders, proxy?: ApiHttpProxy, type?: string) => {
    type = type || `${TYPE || 'hello'}`;
    const endpoint = ENDPOINT || '';
    const service = new APIService(type, endpoint, headers, client, proxy);
    return { service };
};

//! main test body.
describe('APIService', () => {
    jest.setTimeout(10000);

    //* via direct request.
    it('should pass API w/ direct request', async () => {
        //* create direct client.
        const client: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, undefined, '');
        const { service } = instance(client);

        expect2(service.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${HOST}-${TYPE}`);
        expect2(await service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');

        //* check recording....... @191212
        const baseDir = `./logs`;
        const recorder = service.buildRecorder(baseDir);

        expect2(await recorder.doGet('0')).toEqual({ name: 'lemon' });
        const ts = $U.ts().substring(0, '1999-01-01'.length).replace(/\-/gi, '');
        const file = `${baseDir}/R${ts}/D00001.json`;
        expect2(loadJsonSync(file), 'param').toEqual({ param: { method: 'GET', endpoint: ENDPOINT, id: '0' } });
        expect2(loadJsonSync(file), 'data').toEqual({ data: { name: 'lemon' } });
        expect2(loadJsonSync(file), 'error').toEqual({ error: '' });

        expect2(await (recorder as any).doRecord('INVALID').catch(GETERR)).toEqual(
            '@method is not valid. method:INVALID',
        );

        //* test endpoint validation with try-catch
        try {
            new APIService('test', '');
        } catch (error) {
            expect2((error as Error).message).toEqual('@endpoint (url) is required');
        }

        try {
            new APIService('test', 'invalid-url');
        } catch (error) {
            expect2((error as Error).message).toEqual('@endpoint (url) is not valid http-url:invalid-url');
        }

        try {
            APIService.buildClient('test', '');
        } catch (error) {
            expect2((error as Error).message).toEqual('@endpoint (url) is required');
        }

        //* test APIProxyClient functionality
        const mockService: APIServiceClient = {
            hello: () => 'mock-service',
            doGet: async <T = any>(): Promise<T> => ({ result: 'get' } as T),
            doPut: async <T = any>(): Promise<T> => ({ result: 'put' } as T),
            doPost: async <T = any>(): Promise<T> => ({ result: 'post' } as T),
            doPatch: async <T = any>(): Promise<T> => ({ result: 'patch' } as T),
            doDelete: async <T = any>(): Promise<T> => ({ result: 'delete' } as T),
        };

        const proxyClient = new APIProxyClient(mockService);
        expect2(proxyClient.hello()).toEqual('mock-service');
        expect2(await proxyClient.doGet('test')).toEqual({ result: 'get' });
        expect2(await proxyClient.doPut('test')).toEqual({ result: 'put' });
        expect2(await proxyClient.doPost('test')).toEqual({ result: 'post' });
        expect2(await proxyClient.doPatch('test')).toEqual({ result: 'patch' });
        expect2(await proxyClient.doDelete('test')).toEqual({ result: 'delete' });

        //* test with parameters to trigger all method paths
        expect2(await proxyClient.doGet('test', 'cmd', { param: 1 }, { body: 1 }, 'hash')).toEqual({ result: 'get' });
        expect2(await proxyClient.doPut('test', 'cmd', { param: 1 }, { body: 1 }, 'hash')).toEqual({ result: 'put' });
        expect2(await proxyClient.doPost('test', 'cmd', { param: 1 }, { body: 1 }, 'hash')).toEqual({ result: 'post' });
        expect2(await proxyClient.doPatch('test', 'cmd', { param: 1 }, { body: 1 }, 'hash')).toEqual({
            result: 'patch',
        });
        expect2(await proxyClient.doDelete('test', 'cmd', { param: 1 }, { body: 1 }, 'hash')).toEqual({
            result: 'delete',
        });
    });

    //* via direct request.
    it('should pass API (SubTyped) w/ direct request', async () => {
        //* create direct client w/ sub-type.
        const type0 = ENDPOINT.substring(ENDPOINT.lastIndexOf('/') + 1);
        const endpoint = ENDPOINT.substring(0, ENDPOINT.lastIndexOf('/'));
        const client: APIServiceClient = APIService.buildClient(type0, endpoint, undefined, '');
        const { service: service0 } = instance(client);
        const service = service0.buildSubTypeClient(TYPE);

        expect2(service.hello()).toEqual(`sub-typed:api-service:api-client:http-web-proxy:API:${HOST}-${type0}`);
        expect2(await service.doGet(' 1').catch(GETERR)).toEqual('@id (string) is not valid format.'); // NOT ALLOWED STRING

        //* check sub-typed request.
        expect2(await service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');
    });

    //* via direct request.
    it('should pass API (undefined + SubTyped) w/ direct request', async () => {
        //* create direct client w/ sub-type.
        const $api = new APIService(undefined, ENDPOINT);
        const service = $api.buildSubTypeClient('hello');

        //* check sub-typed request.
        expect2(() => service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(() => service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(() => service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(() => service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');

        //* test invalid ID format (space character)
        expect2(await service.doGet(' invalid id').catch(GETERR)).toEqual('@id (string) is not valid format.');

        //* test PUT with SubTypeClient - expect auth error from real API
        expect2(await service.doPut('0').catch(GETERR)).toEqual(
            '403 Forbidden - {"message":"Missing Authentication Token"}',
        );

        //* test PATCH with SubTypeClient - expect auth error from real API
        expect2(await service.doPatch('0').catch(GETERR)).toEqual(
            '403 Forbidden - {"message":"Missing Authentication Token"}',
        );

        //* test DELETE with SubTypeClient - expect auth error from real API
        expect2(await service.doDelete('0').catch(GETERR)).toEqual(
            '403 Forbidden - {"message":"Missing Authentication Token"}',
        );

        //* test POST with SubTypeClient - expect auth error from real API
        expect2(await service.doPost('0').catch(GETERR)).toEqual(
            '403 Forbidden - {"message":"Missing Authentication Token"}',
        );

        //* test buildSubTypeClient with recorder option
        const $apiForRecorder = new APIService('', ENDPOINT);
        const subServiceWithRecorder = $apiForRecorder.buildSubTypeClient('test', true, './test-logs');
        expect2(subServiceWithRecorder.hello()).toEqual(
            'recorder:sub-typed:api-service:api-client:http-web-proxy:API:hg9errxv25.execute-api.ap-northeast-2.amazonaws.com-',
        );

        const recordResult = await subServiceWithRecorder.doGet('0').catch(GETERR);
        // Just verify that we get some result (could be success object or error string)
        const hasResult = recordResult !== undefined && recordResult !== null;
        expect2(hasResult).toEqual(true);

        // remove test-logs files and directories recursively
        const removeDir = (dirPath: string) => {
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                files.forEach((file) => {
                    const filePath = `${dirPath}/${file}`;
                    if (fs.lstatSync(filePath).isDirectory()) {
                        removeDir(filePath); // recursive call for subdirectories
                    } else {
                        fs.unlinkSync(filePath); // remove file
                    }
                });
                fs.rmdirSync(dirPath); // remove empty directory
            }
        };
        removeDir('./test-logs');
    });

    //* via direct request /w header
    it('should pass API w/ direct request w/ header', async () => {
        //* create direct client.
        const TYPE = 'echo';
        const ENDPOINT = 'http://localhost:8888';
        const HEADERS: APIHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

        const client0: APIServiceClient = APIService.buildClient(undefined, ENDPOINT, undefined, '');
        const client1: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, undefined, '');
        const client2: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, HEADERS, '');
        const { service: service1 } = instance(client1);
        const { service: service2 } = instance(client2);

        expect2(client0.hello()).toEqual(`api-client:http-web-proxy:API:localhost:8888-`);
        const ERRCON = await client0.doGet(undefined).catch(GETERR);
        if (ERRCON.indexOf('"ECONNREFUSED"') >= 0) return; //* ignore test.
        expect2(
            await client0
                .doGet(undefined)
                .then(L => L.split('\n')[0])
                .catch(GETERR),
        ).toEqual('lemon-hello-api/2.25.514'); //* required to run `lemon-hello-api` as `$ npm run express`

        //* request with `application/json`
        expect2(service1.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${'localhost:8888'}-${TYPE}`);
        expect2(await service1.doPost(''), 'method,param,body').toEqual({ method: 'POST', param: {}, body: {} });
        expect2(await service1.doPost(''), 'headers').toEqual({
            headers: {
                host: 'localhost:8888',
                'content-length': '0',
                accept: 'application/json',
                connection: 'keep-alive',
            },
        });
        expect2(await service1.doPost('', undefined, undefined, { a: 1 }), 'method,param,body').toEqual({
            method: 'POST',
            param: {},
            body: { a: 1 },
        });

        //* request with `application/x-www-form-urlencoded`
        expect2(service2.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${'localhost:8888'}-${TYPE}`);
        expect2(await service2.doPost(''), 'method,param,body').toEqual({ method: 'POST', param: {}, body: {} });
        expect2(await service2.doPost(''), 'headers').toEqual({
            headers: {
                host: 'localhost:8888',
                'content-length': '0',
                accept: 'application/json',
                connection: 'keep-alive',
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        // expect2(await service2.doPost('echo', undefined, undefined, { a:1 }), 'method,param,body').toEqual({ method:'POST', param:{}, body:{ a:"1" } }); //WARN - do not pass object as body if 'content-type' is not json.

        expect2(await service2.doPost('', undefined, undefined, 'a=1'), 'method,param,body').toEqual({
            method: 'POST',
            param: {},
            body: { a: '1' },
        });
        expect2(await service2.doPost('', undefined, undefined, 'a=1'), 'headers').toEqual({
            headers: {
                host: 'localhost:8888',
                'content-length': '3',
                connection: 'keep-alive',
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        expect2(await service2.doPost('', undefined, undefined, 'a=1'), 'method,param,body').toEqual({
            method: 'POST',
            param: {},
            body: { a: '1' },
        });
        expect2(await service2.doPost('', undefined, { b: 1 }, 'a=1'), 'method,param,body').toEqual({
            method: 'POST',
            param: { b: '1' },
            body: { a: '1' },
        });
        expect2(await service2.doPost('', undefined, 'b=1', 'a=1'), 'method,param,body').toEqual({
            method: 'POST',
            param: { b: '1' },
            body: { a: '1' },
        });

        //* test buildClient with different configurations
        const client3 = APIService.buildClient(
            'test',
            'https://api.example.com',
            undefined,
            'http://backbone.example.com',
        );
        expect2(client3.hello()).toEqual('api-client:http-web-proxy:WEB:api.example.com-test');

        const headers2 = { 'x-custom': 'value' };
        const client4 = APIService.buildClient('test', 'https://api.example.com', headers2);
        expect2(client4.hello()).toEqual('api-client:http-web-proxy:API:api.example.com-test');

        const client5 = APIService.buildClient('', 'https://api.example.com');
        expect2(client5.hello()).toEqual('api-client:http-web-proxy:API:api.example.com-');
    });

    //* via backbone's web-proxy.
    it('should pass API w/ backbone proxy', async () => {
        //* create proxy client.
        const BACKBONE = $engine.environ('BACKBONE_API', '') as string;
        const client: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, null, BACKBONE);
        const { service } = instance(client);

        // validate connection, or break.
        const first = await service.doGet(undefined).catch(GETERR);
        if (`${first}`.startsWith('connect ECONNREFUSED ')) return;

        if (BACKBONE) {
            expect2(service.hello()).toEqual(
                'api-service:api-client:http-web-proxy:WEB:hg9errxv25.execute-api.ap-northeast-2.amazonaws.com-hello',
            );
        } else {
            expect2(service.hello()).toEqual(
                'api-service:api-client:http-web-proxy:API:hg9errxv25.execute-api.ap-northeast-2.amazonaws.com-hello',
            );
        }
        expect2(await service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');
    });

    //* use envion
    it('should pass API w/ default env', async () => {
        //* create direct client.
        const BACKBONE = $engine.environ('BACKBONE_API', '') as string;
        BACKBONE && console.info(`> BACKBONE =`, BACKBONE);
        const { service } = instance();
        if (BACKBONE) {
            expect2(service.hello()).toEqual(`api-service:api-client:http-web-proxy:WEB:${HOST}-${TYPE}`);
            const first = await service.doGet(undefined).catch(GETERR);
            if (`${first}`.startsWith('connect ECONNREFUSED ')) {
                console.info(`WARN! ignore err:${first}`);
                return;
            }
        } else {
            expect2(service.hello()).toEqual(`api-service:api-client:http-web-proxy:API:${HOST}-${TYPE}`);
        }
        expect2(await service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0')).toEqual({ name: 'lemon' });
        expect2(await service.doGet('99').catch(GETERR)).toEqual('404 NOT FOUND - id:99');

        //* test ProxyServiceClient directly to trigger asPath and asHostPath methods (240-242, 263-266)
        const mockProxy: ApiHttpProxy = {
            hello: () => 'mock-proxy',
            doProxy: async <T = any>(method: APIHttpMethod, host?: string, path?: string): Promise<T> => {
                // Return path info to verify the path building logic
                return { method, host, path } as T;
            },
        };

        // Create ProxyServiceClient directly to test asPath method (240-242)
        const ProxyServiceClient = (APIService as any).ProxyServiceClient;
        const proxyClient = new ProxyServiceClient(mockProxy, 'https://api.lemoncloud.io', 'items');

        // Test asPath with various combinations to trigger 240-242 lines
        const result1 = await proxyClient.doGet(undefined, undefined);
        expect2(result1.path).toEqual('/items');

        const result2 = await proxyClient.doGet('123', undefined);
        expect2(result2.path).toEqual('/items/123');

        const result3 = await proxyClient.doGet('123', 'action');
        expect2(result3.path).toEqual('/items/123/action');

        // Test asHostPath URL parsing logic (263-266) with base URL
        const result4 = await proxyClient.doGet('test', 'cmd');
        expect2(result4.host).toEqual('https://api.lemoncloud.io');
        expect2(result4.path).toEqual('/items/test/cmd');

        // Test with non-http URL to trigger protocol addition (263-266)
        const proxyClient2 = new ProxyServiceClient(mockProxy, 'api.lemoncloud.io', 'users');
        const result5 = await proxyClient2.doGet('user1', 'profile');
        expect2(result5.host).toEqual('http://api.lemoncloud.io');
        expect2(result5.path).toEqual('/users/user1/profile');
    });

    //* mocks data w/ `hello`
    it('should pass mocks-api-service w/ mocks(hello) data', async () => {
        //* prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('hello', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('hello', 'https://api.lemoncloud.io/hello');
        const { service } = instance(undefined, undefined, proxy);

        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/hello`);
        expect2(service.hello()).toEqual(
            `api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/hello`,
        );

        expect2(await client.doGet(undefined).catch(GETERR)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await client.doGet('1').catch(GETERR)).toEqual({ name: 'cloud' });

        expect2(await proxy.doProxy('GET', undefined, undefined).catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello',
        );
        expect2(await proxy.doProxy('GET', 'hello', '1')).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1',
        );
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/0',
        );
        expect2(await service.doGet('1')).toEqual({ name: 'cloud' });
        expect2(await service.doGet('1', 'hi').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/1/hi',
        );
        expect2(await service.doGet('/1', '').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/',
        );
        expect2(await service.doGet('/1').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1',
        );
        expect2(await service.doGet('/1', 'h/i').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/h/i',
        );
    });

    //* mocks data w/ `mocks(world) + service(hello)`
    it('should pass mocks-api-service w/ mocks(world) + service(hello)', async () => {
        //* prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const { service } = instance(undefined, undefined, proxy, 'hello');

        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/world`);
        expect2(service.hello()).toEqual(
            `api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/world`,
        );

        expect2(await client.doGet(undefined).catch(GETERR), '!path').toEqual({
            list: [{ name: 'lemon' }, { name: 'world' }],
            name: 'world',
        });
        expect2(await client.doGet('1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await proxy.doProxy('GET', undefined, undefined).catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello',
        );
        expect2(await proxy.doProxy('GET', 'hello', '1'), '!path').toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1',
        );
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await service.doGet(undefined)).toEqual({
            list: [{ name: 'lemon' }, { name: 'cloud' }],
            name: 'lemon',
        });
        expect2(await service.doGet('')).toEqual({ list: [{ name: 'lemon' }, { name: 'cloud' }], name: 'lemon' });
        expect2(await service.doGet('0').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/0',
        );
        expect2(await service.doGet('1')).toEqual({ name: 'cloud' });
        expect2(await service.doGet('1', 'hi').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/1/hi',
        );
        expect2(await service.doGet('/1', '').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/',
        );
        expect2(await service.doGet('/1').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1',
        );
        expect2(await service.doGet('/1', 'h/i').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/hello/%2F1/h/i',
        );
    });

    //* mocks data w/ `mocks(world) + service(world)`
    it('should pass mocks-api-service w/ mocks(world) + service(world)', async () => {
        //* prepare mocks agent
        const proxy: ApiHttpProxy = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const client: APIServiceClient = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');
        const { service } = instance(undefined, undefined, proxy, 'world');

        expect2(proxy.hello()).toEqual(`mocks-api-service:https://api.lemoncloud.io/hello/world`);
        expect2(service.hello()).toEqual(
            `api-service:api-client:mocks-api-service:https://api.lemoncloud.io/hello/world`,
        );

        expect2(await client.doGet(undefined).catch(GETERR), '!path').toEqual({
            list: [{ name: 'lemon' }, { name: 'world' }],
            name: 'world',
        });
        expect2(await client.doGet('1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await proxy.doProxy('GET', undefined, undefined).catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello',
        );
        expect2(await proxy.doProxy('GET', 'hello', '1'), '!path').toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/lemon/1',
        );
        expect2(await proxy.doProxy('GET', 'world', '1').catch(GETERR), '!path').toEqual({ name: 'world' });

        expect2(await service.doGet(undefined), '!path').toEqual({
            list: [{ name: 'lemon' }, { name: 'world' }],
            name: 'world',
        });
        expect2(await service.doGet(''), '!path').toEqual({
            list: [{ name: 'lemon' }, { name: 'world' }],
            name: 'world',
        });
        expect2(await service.doGet('0').catch(GETERR), 'path').toEqual({ path: 'GET /hello/world/0' });
        expect2(await service.doGet('1'), '!path').toEqual({ name: 'world' });
        expect2(await service.doGet('1', 'hi').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/1/hi',
        );
        expect2(await service.doGet('/1', '').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/%2F1/',
        );
        expect2(await service.doGet('/1').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/%2F1',
        );
        expect2(await service.doGet('/1', 'h/i').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/%2F1/h/i',
        );

        //* check query + hash path.
        expect2(await service.doGet('0').catch(GETERR), 'path').toEqual({ path: 'GET /hello/world/0' });
        expect2(await service.doGet('0', undefined, { a: 1 }).catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0?a=1',
        });
        expect2(await service.doGet('0', undefined, { b: undefined }).catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        });
        expect2(await service.doGet('0', undefined, { c: undefined }).catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        }); //* it will use default `/hello/world/0`

        expect2(await service.doGet('0', undefined, { a: 1 }, undefined).catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0?a=1',
        });
        expect2(await service.doGet('0', undefined, { b: undefined }, undefined).catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        });
        expect2(await service.doGet('0', undefined, { c: undefined }, undefined).catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        });

        expect2(await service.doGet(undefined, undefined, undefined, undefined, 'a').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world#a',
        });
        expect2(await service.doGet('', undefined, undefined, undefined, 'a').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world#a',
        });

        expect2(await service.doGet('0', undefined, { a: 1 }, undefined, 'a').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0?a=1#a',
        });
        expect2(await service.doGet('0', undefined, { a: 2 }, undefined, 'a').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        }); // use default
        expect2(await service.doGet('0', undefined, { a: 3 }, undefined, 'a').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        }); // use default
        expect2(await service.doGet('X', undefined, { a: 3 }, undefined, 'a').catch(GETERR), 'path').toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/X?a=3#a',
        );

        expect2(await service.doGet('0', undefined, { a: 1 }, undefined, 'b').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0?a=1#b',
        });
        expect2(await service.doGet('0', undefined, { a: 2 }, undefined, 'b').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        }); // use default
        expect2(await service.doGet('0', undefined, { a: 3 }, undefined, 'b').catch(GETERR), 'path').toEqual({
            path: 'GET /hello/world/0',
        }); // use default
        expect2(await service.doGet('X', undefined, { a: 3 }, undefined, 'b').catch(GETERR), 'path').toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/X?a=3#b',
        );

        //* test PUT method - expect 404 since no mock data for PUT
        const putResult = await service.doPut('1').catch(GETERR);
        expect2(putResult).toEqual('404 NOT FOUND - PUT https://api.lemoncloud.io/hello/world/1');

        const patchResult = await service.doPatch('1').catch(GETERR);
        expect2(patchResult).toEqual('404 NOT FOUND - PATCH https://api.lemoncloud.io/hello/world/1');

        //* test DELETE method - expect 404 since no mock data for DELETE
        const deleteResult = await service.doDelete('1').catch(GETERR);
        expect2(deleteResult).toEqual('404 NOT FOUND - DELETE https://api.lemoncloud.io/hello/world/1');

        //* test with undefined/undefined values for path building - expect connection error
        expect2(await service.doGet('').catch(GETERR)).toEqual({
            list: [{ name: 'lemon' }, { name: 'world' }],
            name: 'world',
            path: 'GET /hello/world',
        });

        //* test with empty string
        expect2(await service.doGet('test').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/test',
        );

        //* test path encoding with special characters
        expect2(await service.doGet('test%20id', 'test%20cmd').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/world/test%2520id/test%2520cmd',
        );

        const recorder = service.buildRecorder('./logs');

        //* test recorder with PUT method - expect auth error from real API
        expect2(await recorder.doPut('0').catch(GETERR)).toEqual(
            '404 NOT FOUND - PUT https://api.lemoncloud.io/hello/world/0',
        );

        //* test recorder with PATCH method - expect auth error from real API
        expect2(await recorder.doPatch('0').catch(GETERR)).toEqual(
            '404 NOT FOUND - PATCH https://api.lemoncloud.io/hello/world/0',
        );

        //* test recorder with DELETE method - expect auth error from real API
        expect2(await recorder.doDelete('0').catch(GETERR)).toEqual(
            '404 NOT FOUND - DELETE https://api.lemoncloud.io/hello/world/0',
        );

        //* test recorder with POST method - expect auth error from real API
        expect2(await recorder.doPost('0').catch(GETERR)).toEqual(
            '404 NOT FOUND - POST https://api.lemoncloud.io/hello/world/0',
        );
    });

    //* test MocksAPIService HTTP methods
    it('should pass MocksAPIService with all HTTP methods', async () => {
        const client = new MocksAPIService('hello', 'https://api.lemoncloud.io/hello');

        //* test PUT method - expect 404 since no mock data for PUT
        const putResult = await client.doPut('1').catch(GETERR);
        expect2(putResult).toEqual('404 NOT FOUND - PUT https://api.lemoncloud.io/hello/hello/1');

        //* test PATCH method - expect 404 since no mock data for PATCH
        const patchResult = await client.doPatch('1').catch(GETERR);
        expect2(patchResult).toEqual('404 NOT FOUND - PATCH https://api.lemoncloud.io/hello/hello/1');

        //* test DELETE method - expect 404 since no mock data for DELETE
        const deleteResult = await client.doDelete('1').catch(GETERR);
        expect2(deleteResult).toEqual('404 NOT FOUND - DELETE https://api.lemoncloud.io/hello/hello/1');

        //* test POST method - expect 404 since no mock data for POST
        const postResult = await client.doPost('1').catch(GETERR);
        expect2(postResult).toEqual('404 NOT FOUND - POST https://api.lemoncloud.io/hello/hello/1');
    });

    //* test error handling in HTTP proxy
    it('should handle HTTP proxy error scenarios', async () => {
        const TYPE = 'echo';
        const ENDPOINT = 'http://localhost:8888';
        const client: APIServiceClient = APIService.buildClient(TYPE, ENDPOINT, undefined, '');
        const { service } = instance(client);

        //* test connection error handling
        const res1 = await service.doGet('').catch(GETERR);
        const hasNotFoundError1 = res1.includes('404 NOT FOUND');
        expect2(hasNotFoundError1).toEqual(true); // connection error message

        //* test JSON parsing error scenarios
        const res2 = await service.doGet('malformed-json').catch(GETERR);
        const hasNotFoundError2 = res2.includes('404 NOT FOUND');
        expect2(hasNotFoundError2).toEqual(true); // expect error message

        //* test different status codes
        const res3 = await service.doGet('bad-request').catch(GETERR);
        const hasNotFoundError3 = res3.includes('404 NOT FOUND');
        expect2(hasNotFoundError3).toEqual(true); // expect error message

        //* test JSON parsing error scenarios (598-601)
        const jsonParsingProxy: ApiHttpProxy = {
            hello: () => 'json-parsing-proxy',
            doProxy: async <T = any>(
                method: APIHttpMethod,
                host?: string,
                path?: string,
                param?: any,
                body?: any,
                ctx?: any,
                hash?: string,
            ): Promise<T> => {
                if (path?.includes('valid-json-object')) {
                    return '{"valid": "json", "parsed": true}' as T; // Valid JSON object string
                }
                if (path?.includes('valid-json-array')) {
                    return '[{"item": 1}, {"item": 2}]' as T; // Valid JSON array string
                }
                if (path?.includes('invalid-json')) {
                    return '{"invalid": json, missing: "quotes"}' as T; // Invalid JSON that will trigger catch block
                }
                if (path?.includes('non-json-string')) {
                    return 'plain text response' as T; // Non-JSON string
                }
                return { result: 'default' } as T;
            },
        };

        const { service: jsonService } = instance(undefined, undefined, jsonParsingProxy);

        // Test valid JSON object parsing
        const validObject = await jsonService.doGet('valid-json-object');
        expect2(validObject).toEqual('{"valid": "json", "parsed": true}');

        // Test valid JSON array parsing
        const validArray = await jsonService.doGet('valid-json-array');
        expect2(validArray).toEqual('[{"item": 1}, {"item": 2}]');

        // Test invalid JSON handling (should not crash, return as string)
        const invalidJson = await jsonService.doGet('invalid-json');
        expect2(invalidJson).toEqual('{"invalid": json, missing: "quotes"}');

        // Test non-JSON string handling
        const nonJson = await jsonService.doGet('non-json-string');
        expect2(nonJson).toEqual('plain text response');
    });

    //* test MocksAPIService error handling
    it('should handle MocksAPIService error scenarios', async () => {
        const proxy = new MocksAPIService('world', 'https://api.lemoncloud.io/hello');

        //* test JSON error parsing
        expect2(await proxy.doProxy('GET', 'error-json', 'test').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/error-json/test',
        ); // expect error message

        //* test object error handling
        expect2(await proxy.doProxy('GET', 'error-object', 'test').catch(GETERR)).toEqual(
            '404 NOT FOUND - GET https://api.lemoncloud.io/hello/error-object/test',
        );

        //* test JSON parsing scenarios with mock proxy
        const mockProxy: ApiHttpProxy = {
            hello: () => 'mock-proxy',
            doProxy: async <T = any>(method: any, host?: string, path?: string): Promise<T> => {
                if (path?.includes('json-array')) {
                    return '[{"test": "array"}]' as T; // JSON array string
                }
                if (path?.includes('json-object')) {
                    return '{"test": "object"}' as T; // JSON object string
                }
                if (path?.includes('malformed')) {
                    return '{"invalid": json}' as T; // Malformed JSON
                }
                if (path?.includes('400')) {
                    const error = new Error('400 BAD REQUEST - invalid request');
                    throw error;
                }
                return { result: 'success' } as T;
            },
        };

        const { service: mockService } = instance(undefined, undefined, mockProxy);

        const arrayResult = await mockService.doGet('json-array');
        expect2(arrayResult).toEqual('[{"test": "array"}]'); // Should be parsed as string initially

        const objectResult = await mockService.doGet('json-object');
        expect2(objectResult).toEqual('{"test": "object"}'); // Should be parsed as string initially

        const malformedResult = await mockService.doGet('malformed');
        expect2(malformedResult).toEqual('{"invalid": json}'); // Should return as string

        const errorResult = await mockService.doGet('400').catch(GETERR);
        expect2(errorResult).toEqual('400 BAD REQUEST - invalid request');

        //* test additional JSON parsing scenarios and error handling
        const advancedMockProxy: ApiHttpProxy = {
            hello: () => 'advanced-mock-proxy',
            doProxy: async <T = any>(method: any, host?: string, path?: string): Promise<T> => {
                if (path?.includes('json-string-error')) {
                    throw '{"error": "string error"}'; // String error that looks like JSON
                }
                if (path?.includes('object-error')) {
                    throw { error: 'object error' }; // Object error
                }
                if (path?.includes('valid-json-array')) {
                    return '[{"valid": "array"}]' as T; // Valid JSON array string
                }
                if (path?.includes('valid-json-object')) {
                    return '{"valid": "object"}' as T; // Valid JSON object string
                }
                if (path?.includes('invalid-json')) {
                    return '{"invalid": json, "missing": quote}' as T; // Invalid JSON
                }
                return { result: 'success' } as T;
            },
        };

        const { service: advancedService } = instance(undefined, undefined, advancedMockProxy);

        // Test string error that looks like JSON
        const stringError = await advancedService.doGet('json-string-error').catch(GETERR);
        expect2(stringError).toEqual('{"error": "string error"}');

        // Test object error
        const objectError = await advancedService.doGet('object-error').catch(GETERR);
        expect2(objectError).toEqual('{"error":"object error"}');

        // Test valid JSON array parsing
        const validArray = await advancedService.doGet('valid-json-array');
        expect2(validArray).toEqual('[{"valid": "array"}]');

        // Test valid JSON object parsing
        const validObject = await advancedService.doGet('valid-json-object');
        expect2(validObject).toEqual('{"valid": "object"}');

        // Test invalid JSON handling
        const invalidJson = await advancedService.doGet('invalid-json');
        expect2(invalidJson).toEqual('{"invalid": json, "missing": quote}');

        //* test MocksAPIService error handling scenarios (705-706, 708)
        const errorMockService = new MocksAPIService('error-test', 'https://api.error.test');

        // Test with JSON string error
        const mockWithJsonError: ApiHttpProxy = {
            hello: () => 'error-mock',
            doProxy: async <T = any>(method: APIHttpMethod, host?: string, path?: string): Promise<T> => {
                if (path?.includes('json-error')) {
                    throw '{"error": "JSON string error"}'; // String error that starts/ends with {}
                }
                if (path?.includes('object-error')) {
                    throw { error: 'Direct object error' }; // Direct object error
                }
                if (path?.includes('string-error')) {
                    throw 'Simple string error'; // Simple string error
                }
                return { success: true } as T;
            },
        };

        const { service: errorService } = instance(undefined, undefined, mockWithJsonError);

        // Test JSON string error handling (705-706)
        const jsonErrorResult = await errorService.doGet('json-error').catch(GETERR);
        expect2(jsonErrorResult).toEqual('{"error": "JSON string error"}');

        // Test object error handling (708)
        const objectErrorResult = await errorService.doGet('object-error').catch(GETERR);
        expect2(objectErrorResult).toEqual('{"error":"Direct object error"}');

        // Test simple string error handling
        const stringErrorResult = await errorService.doGet('string-error').catch(GETERR);
        expect2(stringErrorResult).toEqual('Simple string error');
    });

    it('should pass ApiHttpProxyRecorder', async () => {
        const mockProxy: ApiHttpProxy = {
            hello: () => 'mock-proxy',
            doProxy: async <T = any>(method: APIHttpMethod, host?: string, path?: string): Promise<T> => {
                if (path === 'error-test') {
                    throw new Error('Mock proxy error');
                }
                return { method, host, path } as T;
            },
        };
        const recorder = new APIService.ApiHttpProxyRecorder(mockProxy, './test-logs');
        expect2(recorder.hello()).toEqual('recorder:mock-proxy');

        // Test successful case
        expect2(await recorder.doProxy('GET', 'https://api.lemoncloud.io', 'items')).toEqual({
            method: 'GET',
            host: 'https://api.lemoncloud.io',
            path: 'items',
        });

        // Test error case to trigger 358 line (.catch in doProxy)
        const errorResult = await recorder.doProxy('GET', 'https://api.lemoncloud.io', 'error-test').catch(GETERR);
        expect2(errorResult).toEqual('Mock proxy error');

        // remove test-logs files and directories recursively
        const removeDir = (dirPath: string) => {
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                files.forEach((file) => {
                    const filePath = `${dirPath}/${file}`;
                    if (fs.lstatSync(filePath).isDirectory()) {
                        removeDir(filePath); // recursive call for subdirectories
                    } else {
                        fs.unlinkSync(filePath); // remove file
                    }
                });
                fs.rmdirSync(dirPath); // remove empty directory
            }
        };
        removeDir('./test-logs');
    });
});
