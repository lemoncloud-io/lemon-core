/**
 * `environ.spec.ts`
 * - test runnder for `tools/environ.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 initial unit test for environ.
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import loadEnviron, { credentials, loadProfile } from './environ';
import { expect2, GETERR } from './common/test-helper';

//! main test body.
describe('environ', () => {
    const ENV = process?.env?.ENV ?? '';

    it(`should pass loadProfile(${ENV})`, async () => {
        const PROFILE = await loadProfile().catch(GETERR);
        PROFILE && console.info(`! PROFILE @environ =`, PROFILE);

        if (!ENV) {
            //* for `npm run test`
            expect2(() => PROFILE).toEqual('');
        } else {
            //* for `npm run test.lemon`
            expect2(() => PROFILE).toEqual(ENV);
        }
    });

    it(`should pass credentials(${ENV})`, async () => {
        expect2(() => credentials(null)).toEqual();
        expect2(() => credentials('')).toEqual();
        expect2(() => credentials('lemon')).toEqual(
            'WARN! credentials() is deprecated. use `asyncCredentials()` instead!',
        );
    });

    it(`should pass loadEnviron(${ENV})`, async () => {
        //* check `env/<ENV>.yml`
        const _load = (ENV?: string) => loadEnviron(null, { ENV });
        expect2(() => _load(null), 'NAME').toEqual({ NAME: '' });
        expect2(() => _load(''), 'NAME').toEqual({ NAME: '' });
        expect2(() => _load('none'), 'NAME').toEqual({ NAME: '' });
        expect2(() => _load('lemon'), 'NAME').toEqual({ NAME: 'test-lemon' });
        expect2(() => _load('test'), 'NAME').toEqual('FILE NOT FOUND:./env/test.yml');
    });
});
