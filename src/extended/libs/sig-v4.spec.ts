/**
 * `sig-v4.spec.ts`
 * - sig-v4 service
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2024-12-02 initial version
 *
 * @copyright (C) lemoncloud.io 2024 - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { asyncCredentials } from '../../tools/tools';
import { expect2, GETERR } from '../../common/test-helper';
import { createSigV4Proxy } from '../../helpers/helpers';
import { sigV4ClientConfig } from './sig-v4';

//! api with `lemon-hello-api` in prod @lemon.
const HOST = 'hg9errxv25.execute-api.ap-northeast-2.amazonaws.com';
const STAGE = 'prod';
const ENDPOINT = `https://${HOST}/${STAGE}`;

const loadSigConfig = async (profile: string): Promise<sigV4ClientConfig> => {
    const credentials = await asyncCredentials(profile);
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
    const proxy = createSigV4Proxy('TestProxy', ENDPOINT, sigConfig);
    return proxy;
};

//! main test body.
describe('createHttpWebProxy w/Sig4', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info(`! PROFILE =`, PROFILE);

    it('should pass API w/invalid AWS key', async () => {
        const proxy = await instance('lemon');
        if (!proxy) {
            console.info('! SKIP TEST - invalid AWS key[lemon]');
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
            console.info('! SKIP TEST - invalid AWS key');
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
