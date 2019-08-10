/**
 * `test.environ.ts`
 * - test runnder for `environ.ts`
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-08 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import loadEnviron from '../src/environ';

const safe = (f: () => {}) => {
    try {
        return f();
    } catch (e) {
        return e;
    }
};

const $environ = (env: any): any => {
    //! convert all string.
    env = Object.keys(env).reduce((O: any, k) => {
        O[k] = `${env[k]}`;
        return O;
    }, {});
    const proc = { env };
    return safe(() => loadEnviron(proc));
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
        expect($conf.message).toEqual('FILE NOT FOUND:./env/anony.yml');
    });

    test('check override', () => {
        const $conf = $environ({ LS: 1, ENV: 'lemon', NAME: 'hello', STAGE: 'prod' });
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
