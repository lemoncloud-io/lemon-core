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

import { EngineModule, EngineOption, EngineScope, EngineConsole } from './types';
import { buildEngine, BLUE, RESET, YELLOW, RED } from './builder';

export const instance = (scope?: EngineScope, options?: EngineOption) => {
    const $engine = buildEngine(scope, options);
    return { $engine };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe(`core/builder.ts`, () => {
    //! test Module Manager
    test('check buildEngine() w/ Modules', async done => {
        const { $engine } = instance();

        const mod1 = new (class implements EngineModule {
            public getModuleName = () => 'mod1';
            public initModule = async () => 1;
        })();
        const mod2 = new (class implements EngineModule {
            public getModuleName = () => 'mod2';
            public initModule = async () => 2;
        })();
        const mod22 = new (class implements EngineModule {
            public getModuleName = () => 'mod22';
            public initModule = async (level?: number) => {
                if (level === undefined) return 2;
                throw new Error('mod2');
            };
        })();
        const mod4 = new (class implements EngineModule {
            public getModuleName = () => 'mod4';
            public initModule = async () => {
                // eslint-disable-next-line prettier/prettier
                return $engine.module('mod2').initModule().then(_ => _ + 2);   // +2 more than mod2
            };
        })();

        //! register reverse
        $engine.register(mod4);
        $engine.register(mod2);
        $engine.register(mod22);

        expect2(mod1.getModuleName()).toEqual('mod1');
        expect2(mod2.getModuleName()).toEqual('mod2');
        expect2(mod4.getModuleName()).toEqual('mod4');

        expect2($engine.module('mod1')).toEqual(undefined);
        expect2($engine.module('mod2').getModuleName()).toEqual('mod2');
        expect2($engine.module('mod4').initModule()).toEqual(4);

        //! initialize.
        expect2(await ($engine as any).initialize(true, true)).toEqual([2, 4]);
        expect2(await $engine.initialize().catch(GETERR)).toEqual(undefined); // must be marked inited.
        expect2(await $engine.initialize(true)).toEqual([['mod2', 'ERR[mod22] mod2'], ['mod4']]);

        //! register mod1
        $engine.register(mod1);
        expect2(await ($engine as any).initialize(true, true)).toEqual([1, 2, 4]);
        expect2(await $engine.initialize().catch(GETERR)).toEqual(undefined); // must be marked inited.
        expect2(await $engine.initialize(true)).toEqual([['mod1'], ['mod2', 'ERR[mod22] mod2'], ['mod4']]);

        done();
    });

    //! test Console w/o color
    test('check buildEngine() of Console', async done => {
        const console = new (class implements EngineConsole {
            public constructor() {
                this.thiz = this;
            }
            public thiz: any;
            public auto_ts: boolean = true;
            public auto_color: boolean = false;
            public log = function() {
                const args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
                return args.join(' ');
            };
            public error: any = null; // mark null.
            public ts = () => '2019-11-29 22:44:24';
        })();
        const { $engine } = instance({}, { console });

        expect2($engine.log('NS', 'LOG')).toEqual('2019-11-29 22:44:24 - NS LOG');
        expect2($engine.inf('NS', 'INF')).toEqual('2019-11-29 22:44:24 I NS INF');
        expect2($engine.err('NS', 'ERR')).toEqual('2019-11-29 22:44:24 E NS ERR');

        done();
    });

    //! test Console w/ color
    test('check buildEngine() of Console w/ color', async done => {
        const console = new (class implements EngineConsole {
            public constructor() {
                this.thiz = this;
            }
            public thiz: any;
            public auto_ts: boolean = true;
            public auto_color: boolean = true;
            public log = function() {
                const args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
                return args.join(' ');
            };
            public error: any = null; // mark null.
            public ts = () => '2019-11-29 22:44:24';
        })();
        const { $engine } = instance({}, { console });

        expect2($engine.log('NS', 'LOG')).toEqual(`${BLUE} 2019-11-29 22:44:24 -${RESET} NS LOG`);
        expect2($engine.inf('NS', 'INF')).toEqual(`${YELLOW} 2019-11-29 22:44:24 I${RESET} NS INF`);
        expect2($engine.err('NS', 'ERR')).toEqual(`${RED} 2019-11-29 22:44:24 E${RESET} NS ERR`);

        done();
    });

    //! test Console w/ color
    test('check buildEngine() of Console w/ color - timestamp', async done => {
        const console = new (class implements EngineConsole {
            public constructor() {
                this.thiz = this;
            }
            public thiz: any;
            public auto_ts: boolean = false;
            public auto_color: boolean = true;
            public log = function() {
                const args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
                return args.join(' ');
            };
            public error: any = null; // mark null.
            public ts = () => '2019-11-29 22:44:24';
        })();
        const { $engine } = instance({}, { console });

        expect2($engine.log('NS', 'LOG')).toEqual(`${BLUE} -${RESET} NS LOG`);
        expect2($engine.inf('NS', 'INF')).toEqual(`${YELLOW} I${RESET} NS INF`);
        expect2($engine.err('NS', 'ERR')).toEqual(`${RED} E${RESET} NS ERR`);

        done();
    });
});
