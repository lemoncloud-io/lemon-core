/**
 * `core/builder.spec.ts`
 * - test runnder for `core/builder.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-28 initial unit test.
 * @date        2026-10-30 key rotation: log screening of the engine loggers.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi, test } from 'vitest';
import { GETERR, expect2 } from '../common/test-helper';

import { EngineModule, EngineOption, EngineScope, EngineConsole } from './types';
import { buildEngine, BLUE, RESET, YELLOW, RED } from './builder';
import { registerSecret, clearSecrets } from '../lib/log-mask';

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
        expect2(await $engine.module('mod4').initModule()).toEqual(4);

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

    //* same module name registered twice -> keep the first one (v5 B1)
    test('check register() ignores the same module name', async () => {
        const logs: string[] = [];
        const console: EngineConsole = {
            thiz: null,
            auto_ts: false,
            auto_color: false,
            log: (...args: any[]) => logs.push(args.join(' ')),
            error: (...args: any[]) => logs.push(args.join(' ')),
        };
        const { $engine } = instance({}, { console });
        const make = (level: number) =>
            new (class implements EngineModule {
                public getModuleName = () => 'dup';
                public initModule = async () => level;
            })();
        const first = make(1);
        const second = make(2);

        $engine.register(first);
        const before = (($engine as any).mods as EngineModule[]).length;
        logs.length = 0;
        $engine.register(second);

        expect2(($engine as any).mods.length).toEqual(before);
        expect2((($engine as any).mods as EngineModule[]).filter(_ => _.getModuleName() == 'dup').length).toEqual(1);
        expect2($engine.module('dup') === first).toEqual(true);
        expect2(await ($engine as any).initialize(true, true)).toEqual([1]);
        expect2(logs).toEqual([`! mod.reg(dup) is already registered - ignored`]);
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

    //* key rotation: `_log`/`_inf`/`_err` mask a registered secret and add 1 error line (no value).
    test('check log screening of a registered secret', async () => {
        const SECRET = 'fake-installed-secret-0002';
        const lines: string[] = [];
        const console: EngineConsole = {
            thiz: null,
            auto_ts: true,
            auto_color: false,
            log: (...args: any[]) => lines.push(args.join(' ')),
            error: (...args: any[]) => lines.push(args.join(' ')),
            ts: () => 'T',
        };
        const { $engine } = instance({}, { console });
        lines.length = 0; //* drop the engine ready line.
        try {
            //* empty registry → printed as is.
            $engine.log('NS', `k=${SECRET}`);
            expect2(lines).toEqual([`T - NS k=${SECRET}`]);
            lines.length = 0;

            registerSecret(SECRET);
            const mask = `[masked:${SECRET.length}]`;
            $engine.log('NS', `k=${SECRET}`);
            $engine.inf('NS', { k: SECRET });
            $engine.err('NS', new Error(`e=${SECRET}`));
            $engine.inf('NS', 'clean');
            expect2(lines.length).toEqual(7);
            expect2(lines.join('\n').includes(SECRET)).toEqual(false);
            expect2(lines[0]).toEqual(`T - NS k=${mask}`);
            expect2(lines[1]).toEqual('T E !SECRET in log — masked');
            expect2(lines[2]).toEqual(`T I NS {"k":"${mask}"}`);
            expect2(lines[3]).toEqual('T E !SECRET in log — masked');
            expect2(lines[4].startsWith(`T E NS Error: e=${mask}`)).toEqual(true);
            expect2(lines[5]).toEqual('T E !SECRET in log — masked');
            expect2(lines[6]).toEqual('T I NS clean');
        } finally {
            clearSecrets();
        }
    });

    //* key rotation: `LS=1` (silent console) → nothing printed, args are not even stringified for screening.
    test('check no log screening when LS=1', async () => {
        const SECRET = 'fake-installed-secret-0003';
        const { $engine } = instance({}, { env: { LS: '1' } });
        registerSecret(SECRET);
        try {
            const toJSON = vi.fn(() => SECRET);
            $engine.log('NS', { toJSON });
            $engine.inf('NS', { toJSON });
            $engine.err('NS', { toJSON });
            expect2(toJSON.mock.calls.length).toEqual(0);
        } finally {
            clearSecrets();
        }
    });
});
