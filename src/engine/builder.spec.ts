/**
 * `core/builder.spec.ts`
 * - test runnder for `core/builder.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-28 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { GETERR, expect2 } from '../common/test-helper';

import { EngineModule } from './types';
import { buildEngine } from './builder';

export const instance = (scope?: any) => {
    scope = scope || {};
    const $engine = buildEngine(scope);
    return { $engine };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe(`core/builder.ts`, () => {
    test('check buildEngine()', async done => {
        const { $engine } = instance();

        const mod1 = new (class implements EngineModule {
            public getModuleName = () => 'mod1';
            public initModule = async () => 1;
        })();
        const mod2 = new (class implements EngineModule {
            public getModuleName = () => 'mod2';
            public initModule = async () => 2;
        })();
        const mod4 = new (class implements EngineModule {
            public getModuleName = () => 'mod4';
            public initModule = async (level?: number) => {
                // eslint-disable-next-line prettier/prettier
                return $engine.module('mod2').initModule(0).then(_ => _ + 2);   // +2 more than mod2
            };
        })();

        //! register reverse
        $engine.register(mod4);
        $engine.register(mod2);

        expect2(mod1.getModuleName()).toEqual('mod1');
        expect2(mod2.getModuleName()).toEqual('mod2');
        expect2(mod4.getModuleName()).toEqual('mod4');

        expect2($engine.module('mod1')).toEqual(undefined);
        expect2($engine.module('mod2').getModuleName()).toEqual('mod2');
        expect2($engine.module('mod4').initModule()).toEqual(4);

        //! initialize.
        expect2(await ($engine as any).initialize(true, true)).toEqual([2, 4]);
        expect2(await $engine.initialize().catch(GETERR)).toEqual(undefined); // must be marked inited.
        expect2(await $engine.initialize(true)).toEqual([['mod2'], ['mod4']]);

        //! register mod1
        $engine.register(mod1);
        expect2(await ($engine as any).initialize(true, true)).toEqual([1, 2, 4]);
        expect2(await $engine.initialize().catch(GETERR)).toEqual(undefined); // must be marked inited.
        expect2(await $engine.initialize(true)).toEqual([['mod1'], ['mod2'], ['mod4']]);

        done();
    });
});
