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

import { EngineModule, EngineOption, EngineScope, EngineConsole, ENGINE_KEY_IN_SCOPE } from './types';
import {
    buildEngine,
    build_environ,
    build_ts,
    build_log,
    build_inf,
    build_err,
    do_serialize,
    BLUE,
    RESET,
    YELLOW,
    RED,
} from './builder';
import { Utilities } from './utilities';

export const instance = (scope?: EngineScope, options?: EngineOption) => {
    const $engine = buildEngine(scope, options);
    return { $engine };
};

//! main test body.
describe(`core/builder.ts`, () => {
    //* test Module Manager
    test('check buildEngine() w/ Modules', async () => {
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
                return $engine
                    .module('mod2')
                    .initModule()
                    .then(_ => _ + 2); // +2 more than mod2
            };
        })();

        //* register reverse
        $engine.register(mod4);
        $engine.register(mod2);
        $engine.register(mod22);

        expect2(mod1.getModuleName()).toEqual('mod1');
        expect2(mod2.getModuleName()).toEqual('mod2');
        expect2(mod4.getModuleName()).toEqual('mod4');

        expect2($engine.module('mod1')).toEqual(undefined);
        expect2($engine.module('mod2').getModuleName()).toEqual('mod2');
        expect2($engine.module('mod4').initModule()).toEqual(4);

        //* initialize.
        expect2(await ($engine as any).initialize(true, true)).toEqual([2, 4]);
        expect2(await $engine.initialize().catch(GETERR)).toEqual(undefined); // must be marked inited.
        expect2(await $engine.initialize(true)).toEqual([['mod2', 'ERR[mod22] mod2'], ['mod4']]);

        //* register mod1
        $engine.register(mod1);
        expect2(await ($engine as any).initialize(true, true)).toEqual([1, 2, 4]);
        expect2(await $engine.initialize().catch(GETERR)).toEqual(undefined); // must be marked inited.
        expect2(await $engine.initialize(true)).toEqual([['mod1'], ['mod2', 'ERR[mod22] mod2'], ['mod4']]);
    });

    //* test Console w/o color
    test('check buildEngine() of Console', async () => {
        const console = new (class implements EngineConsole {
            public constructor() {
                this.thiz = this;
            }
            public thiz: any;
            public auto_ts: boolean = true;
            public auto_color: boolean = false;
            public log = function () {
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
    });

    //* test Console w/ color
    test('check buildEngine() of Console w/ color', async () => {
        const console = new (class implements EngineConsole {
            public constructor() {
                this.thiz = this;
            }
            public thiz: any;
            public auto_ts: boolean = true;
            public auto_color: boolean = true;
            public log = function () {
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
    });

    //* test Console w/ color
    test('check buildEngine() of Console w/ color - timestamp', async () => {
        const console = new (class implements EngineConsole {
            public constructor() {
                this.thiz = this;
            }
            public thiz: any;
            public auto_ts: boolean = false;
            public auto_color: boolean = true;
            public log = function () {
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
    });

    //* test build_environ()
    test('check build_environ()', () => {
        const options: EngineOption = { env: { STAGE: 'unit', READY: 'true' } };
        const getter = build_environ(options);

        expect2(getter('READY', 'false')).toEqual('true');
        expect2(getter('UNKNOWN', 'fallback')).toEqual('fallback');
        expect2(() => getter('NEEDED', new Error('missing env:NEEDED'))).toEqual('missing env:NEEDED');
    });

    //* test build_environ() fallback
    test('check build_environ() fallback to process.env', () => {
        const key = 'BUILDER_SPEC_ENV_KEY';
        const prev = process.env[key];
        process.env[key] = 'from-process-env';

        const getter = build_environ({} as EngineOption);

        expect2(getter(key, 'default')).toEqual('from-process-env');

        const restore = prev === undefined ? () => delete process.env[key] : () => (process.env[key] = prev);
        restore();
    });

    //* test build_ts() fallback
    test('check build_ts() fallback to Utilities', () => {
        const spy = jest.spyOn(Utilities, 'timestamp').mockReturnValue('2024-02-02 02:02:02');
        const ts = build_ts();
        const stamp = ts();
        const callCount = spy.mock.calls.length;
        spy.mockRestore();

        expect2(stamp).toEqual('2024-02-02 02:02:02');
        expect2(callCount).toEqual(1);
    });

    //* test do_serialize()
    test('check do_serialize() in batches', async () => {
        const list = [1, 2, 3, 4];
        const res = await do_serialize(
            list,
            (node, index) => {
                const value = node * 10 + index;
                return index % 2 === 0 ? value : Promise.resolve(value);
            },
            2,
        );

        expect2(res).toEqual([10, 21, 32, 43]);
    });

    //* test do_serialize() error handling
    test('check do_serialize() error handling', async () => {
        const error = await do_serialize([1, 2, 3], node => {
            if (node === 2) throw new Error('seq-error');
            return node;
        }).catch(GETERR);

        expect2(error).toEqual('seq-error');
    });

    //* test build_log()/inf()/err()
    test('check build_log(), build_inf(), build_err()', () => {
        const logs: string[] = [];
        const console: EngineConsole = {
            thiz: {},
            auto_ts: false,
            auto_color: false,
            log: function () {
                const args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
                const line = args.join(' ');
                logs.push(line);
                return line;
            },
            error: function () {
                const args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
                const line = args.join(' ');
                logs.push(line);
                return line;
            },
        };

        const logger = build_log(console);
        const informer = build_inf(console);
        const errorLogger = build_err(console);

        expect2(logger('LOG', 'TEST')).toEqual('LOG TEST');
        expect2(informer('INF', 'TEST')).toEqual('INF TEST');
        expect2(errorLogger('ERR', 'TEST')).toEqual('ERR TEST');
        expect2(logs.length).toEqual(3);
    });

    //* test buildEngine() scope reuse
    test('check buildEngine() of environment + scope reuse', () => {
        const scope: EngineScope = {};
        const env = { STAGE: 'test', LS: '1', TS: '0', LC: '1', CUSTOM: 'value' };
        const $engine = buildEngine(scope, { name: 'unit-engine', env });

        expect2($engine.id).toEqual('unit-engine');
        expect2($engine.STAGE).toEqual('test');
        expect2($engine.environ('CUSTOM')).toEqual('value');
        expect2($engine.$console.auto_ts).toEqual(false);
        expect2($engine.$console.auto_color).toEqual(true);
        expect2($engine.log('NS', 'LOG')).toEqual(undefined);
        expect2(scope._log === $engine.log).toEqual(true);
        expect2(scope[ENGINE_KEY_IN_SCOPE] === $engine).toEqual(true);
        expect2($engine.toString()).toEqual('engine: unit-engine');

        const reused = buildEngine(scope, { name: 'another', env: { STAGE: 'prod' } });
        expect2(reused === $engine).toEqual(true);
    });

    //* test buildEngine() default LC
    test('check buildEngine() default LC for local stage', () => {
        const scope: EngineScope = {};
        const $engine = buildEngine(scope, { env: { STAGE: 'local' } });

        expect2($engine.$console.auto_color).toEqual(true);
        expect2(scope._inf === $engine.inf).toEqual(true);
        expect2(scope._err === $engine.err).toEqual(true);
    });
});
