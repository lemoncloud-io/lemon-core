/**
 * `environ.spec.ts`
 * - test runnder for `environ.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-08-08 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import loadEnviron from './environ';

const safe = (f: () => {}) => {
    try {
        return f();
    } catch (e) {
        return e;
    }
};

const $environ = (env: any): any => {
    //! convert all string.
    env =
        (env &&
            Object.keys(env).reduce((O: any, k) => {
                O[k] = `${env[k]}`;
                return O;
            }, {})) ||
        env;
    const proc = { env };
    const opt = { ENV_PATH: 1 ? './data' : __dirname + '/../data' };
    return safe(() => loadEnviron(proc, opt));
};

describe(`test the 'environ.ts'`, () => {
    test('check basic environ()', () => {
        const $conf = $environ({ LS: 1, ENV: 'lemon', NODE_ENV: 'prod' });
        expect($conf.NAME).toEqual('lemon');
        expect($conf.STAGE).toEqual('production');
        expect($conf.TS).toEqual('0');
    });

    test('check file error', () => {
        const $conf = $environ({ LS: 1, ENV: 'anony' });
        expect($conf.message.split(':')[0]).toEqual('FILE NOT FOUND');
    });

    test('check default envion', () => {
        const $conf = $environ(null);
        expect($conf).toEqual({ LC: '1', LS: '0', NAME: 'none', STAGE: 'local', TS: '1' });
    });

    test('check unknown envion.stage', () => {
        const $conf = $environ({ LS: 1, ENV: 'lemon', STAGE: 'proxy' });
        expect($conf.STAGE).toEqual('proxy');
    });

    test('check override', () => {
        const $conf = $environ({ LS: 0, ENV: 'lemon', NAME: 'hello', STAGE: 'prod' });
        expect($conf.NAME).toEqual('hello');
        expect($conf.STAGE).toEqual('prod');
    });

    test('check override', () => {
        const $conf = $environ({ LS: 1, ENV: 'lemon', NAME: 'hello', STAGE: 'local' });
        expect($conf.NAME).toEqual('test-lemon');
        expect($conf.STAGE).toEqual('local');
        expect($conf.LIST).toEqual('a, b');
    });
});
