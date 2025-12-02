/**
 * `sig-v4.spec.ts`
 * - sig-v4 service
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2024-12-02 initial version
 *
 * @copyright (C) lemoncloud.io 2024 - All Rights Reserved.
 */
import { asyncCredentials } from '../../tools/tools';
import { expect2, GETERR } from '../../common/test-helper';
import { createSigV4Proxy } from '../../helpers/helpers';
import { sigV4Client, sigV4ClientConfig } from './sig-v4';
import request from 'request';
import { loadProfile } from '../../environ';

jest.mock('request', () => jest.fn());

//! api with `lemon-hello-api` in prod @lemon.
const HOST = 'hg9errxv25.execute-api.ap-northeast-2.amazonaws.com';
const STAGE = 'prod';
const ENDPOINT = `https://${HOST}/${STAGE}`;

const loadSigConfig = async (profile: string): Promise<sigV4ClientConfig> => {
    const credentials = await asyncCredentials(profile).catch(() => null);
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) return null;
    const ACCESSKEY = credentials?.accessKeyId;
    const SECRETKEY = credentials?.secretAccessKey;
    return {
        accessKey: ACCESSKEY,
        secretKey: SECRETKEY,
        region: 'ap-northeast-2',
        serviceName: 'execute-api',
        host: HOST,
    };
};

const instance = async (profile: string) => {
    const sigConfig = await loadSigConfig(profile);
    if (!sigConfig) return null;

    const proxy = createSigV4Proxy('TestProxy', ENDPOINT, sigConfig);
    return proxy;
};

//! main test body.
describe('createHttpWebProxy w/Sig4', () => {
    jest.setTimeout(30000);
    const PROFILE = loadProfile(process); // override process.env.

    it('should pass API w/ invalid AWS key', async () => {
        if (PROFILE !== 'lemon') return; // skip unless using `lemon` profile.

        const proxy = await instance(PROFILE);
        if (!proxy) {
            console.info(`! SKIP TEST - invalid AWS key[${PROFILE}]`);
            return;
        }

        // GET method test
        expect2(
            await proxy
                .doProxy('GET')
                .then((r: string) => r.split('\n').map(s => s.split('/')[0]))
                .catch(GETERR),
        ).toEqual('lemon-hello-api,lemon-core'.split(','));

        expect2(await proxy.doProxy('GET', 'hello', '1').catch(GETERR)).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toEqual('404 NOT FOUND - GET /lemon/1');

        // POST method test
        expect2(await proxy.doProxy('POST', 'hello', '1', undefined, { name: 'lemon' }).catch(GETERR)).toEqual(
            '400 BAD REQUEST - @id[1] (number) is invalid!',
        );
    });

    it('should pass API w/ unauthorized AWS key', async () => {
        const proxy = await instance('temp');
        if (!proxy) {
            // console.info('! SKIP TEST - invalid AWS key');
            return;
        }

        // GET method test
        expect2(
            await proxy
                .doProxy('GET')
                .then((r: string) => r.split('\n').map(s => s.split('/')[0]))
                .catch(GETERR),
        ).toEqual('lemon-hello-api,lemon-core'.split(','));

        expect2(await proxy.doProxy('GET', 'hello', '1').catch(GETERR)).toEqual({ name: 'cloud' });
        expect2(await proxy.doProxy('GET', 'lemon', '1').catch(GETERR)).toContain('403 Forbidden');

        // POST method test
        expect2(await proxy.doProxy('POST', 'hello', '1', undefined, { name: 'lemon' }).catch(GETERR)).toContain(
            '403 Forbidden',
        );
    });
});

describe('sig-v4 client', () => {
    const requestMock = request as unknown as jest.Mock;
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
    });

    const baseConfig = (options?: Partial<sigV4ClientConfig>): sigV4ClientConfig => ({
        accessKey: 'AKIA123456789ABCDE',
        secretKey: 'SECRET1234567890',
        host: 'example.amazonaws.com',
        endpoint: 'https://example.amazonaws.com/dev',
        sessionToken: 'session-token',
        serviceName: 'execute-api',
        region: 'us-east-1',
        defaultAcceptType: 'text/plain',
        defaultContentType: 'application/xml',
        ...options,
    });

    it('should create canonical request for GET with special characters', async () => {
        const client = sigV4Client(baseConfig());
        const signed = client.signRequest({
            method: 'get',
            path: '/bucket/key!*()한',
            queryParams: { zebra: 'white space', alpha: '1' },
            headers: { Custom: 'Yes' },
        });

        expect2(() => signed.url).toEqual(
            'https://example.amazonaws.com/dev/bucket/key!*()한?alpha=1&zebra=white%20space',
        );
        expect2(() => signed.headers['Content-Type']).toEqual('application/xml');
        expect2(() => signed.headers['Accept']).toEqual('text/plain');
        expect2(() => signed.headers['x-amz-security-token']).toEqual('session-token');
        expect2(() => signed.headers['Authorization'].startsWith('AWS4-HMAC-SHA256')).toEqual(true);
        expect2(() => signed.headers.host).toEqual(undefined);
    });

    it('should sign POST payload while keeping explicit headers', async () => {
        const client = sigV4Client(
            baseConfig({
                defaultAcceptType: 'application/json',
                defaultContentType: 'application/json',
            }),
        );
        const signed = client.signRequest({
            method: 'POST',
            path: '/items',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: { hello: 'world' },
        });

        expect2(() => signed.url).toEqual('https://example.amazonaws.com/dev/items');
        expect2(() => signed.headers['Content-Type']).toEqual('application/json');
        expect2(() => signed.headers['Accept']).toEqual('application/json');
    });

    it('should skip client creation when credentials are missing', () => {
        const client = sigV4Client({ endpoint: 'https://dummy', host: 'dummy-host' });
        expect2(() => Object.keys(client).length).toEqual(0);
    });

    it('should integrate with createSigV4Proxy using mocked request', async () => {
        const proxy = createSigV4Proxy(
            'MockProxy',
            'https://proxy.example.com/base',
            {
                accessKey: 'AK',
                secretKey: 'SK',
                host: 'proxy.example.com',
                endpoint: 'https://proxy.example.com/base',
            },
            { resultKey: 'data' },
        );

        enqueueRequest((options, callback) => {
            expect2(() => typeof options.headers.Authorization).toEqual('string');
            callback(null, { statusCode: 200, statusMessage: 'OK' }, JSON.stringify({ data: { ok: true } }));
        });
        expect2(await proxy.doProxy('GET', 'host', 'path', { limit: 1 })).toEqual({ ok: true });

        enqueueRequest((options, callback) => {
            callback(null, { statusCode: 404, statusMessage: 'Not Found' }, 'missing');
        });
        expect2(await proxy.doProxy('GET', 'missing', 'item').catch(GETERR)).toEqual('404 NOT FOUND - missing');

        const methodErr = (() => {
            try {
                proxy.doProxy(null as any, null);
            } catch (e) {
                return GETERR(e);
            }
            return '';
        })();
        expect2(methodErr).toEqual('@method is required - createSigV4Proxy(MockProxy)');
    });
});
