/**
 * `environ.spec.ts`
 * - test runnder for `environ.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-08-08 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { expect2 } from './common/test-helper';
import loadEnviron from './environ';

const safe = (f: () => unknown) => {
    try {
        return f();
    } catch (e) {
        // console.error('! err =', e);
        return e;
    }
};

const $environ = (env?: { [key: string]: string }): any => {
    //! convert all string.
    env =
        (env &&
            Object.keys(env).reduce((O: any, k) => {
                O[k] = `${env[k]}`;
                return O;
            }, {})) ||
        env;
    const proc = { env };
    const opt = { ENV_PATH: 1 ? './env' : __dirname + '/../env' };
    return safe(() => loadEnviron(proc, opt));
};

describe(`test the 'environ.ts'`, () => {
    test('check basic environ()', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', NODE_ENV: 'prod' });
        expect2(() => $conf, 'NAME').toEqual({ NAME: 'lemon' });
        expect2(() => $conf, 'STAGE').toEqual({ STAGE: 'production' });
        expect2(() => $conf, 'TS').toEqual({ TS: '0' });
    });

    test('check file error', () => {
        const $conf = $environ({ LS: '1', ENV: 'anony' });
        expect2(() => $conf.message.split(':')[0]).toEqual('FILE NOT FOUND');
    });

    test('check default envion', () => {
        const $conf = $environ(null);
        expect2(() => $conf).toEqual({ LS: '0', LC: '1', NAME: 'none', STAGE: 'local', TS: '1', BACKBONE_API: '' });
    });

    test('check unknown envion.stage', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', STAGE: 'proxy' });
        expect2(() => $conf.STAGE).toEqual('proxy');
    });

    test('check override', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', NAME: 'hello', STAGE: 'prod' });
        expect2(() => $conf.NAME).toEqual('hello');
        expect2(() => $conf.STAGE).toEqual('prod');
    });

    test('check override', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', NAME: 'hello', STAGE: 'local' });
        expect2(() => $conf.NAME).toEqual('test-lemon');
        expect2(() => $conf.STAGE).toEqual('local');
        expect2(() => $conf.LIST).toEqual('a, b');
    });
});
