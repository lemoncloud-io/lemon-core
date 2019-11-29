/**
 * `engine/index.tx`
 * - engine bootloader
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { EngineOption, EngineLogger, EngineConsole, LemonEngine, GeneralFuntion, EngineModule } from './types';
import { Utilities } from './utilities';
import _ from 'lodash';
//WARN! - ------------------------------------------------------
//WARN! - DO NOT IMPORT ANY DEPENDENCY IN HERE EXCEPT TYPES.
//WARN! - ------------------------------------------------------

//! build environment getter
const build_environ = (options: EngineOption) => (name: string, defVal: any) => {
    // as default, load from proces.env.
    const env = options.env || (process && process.env) || {};
    const val = env[name];
    // throw Error if value is not set.
    if (defVal && defVal instanceof Error && val === undefined) throw defVal;
    // returns default.
    return val === undefined ? defVal : val;
};

// build timestamp like 2016-12-08 13:30:44
const build_ts = () => (date?: undefined | number | Date, timeZone?: number) => {
    return Utilities.timestamp(date, timeZone);
};

const LEVEL_LOG = '-';
const LEVEL_INF = 'I';
const LEVEL_ERR = 'E';

const RED = '\x1b[31m';
const BLUE = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/* eslint-disable @typescript-eslint/indent */
const build_log = ($console: EngineConsole): EngineLogger =>
    function() {
        const _ts = build_ts();
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            args.unshift(RESET),
                ($console.auto_ts && args.unshift(_ts(), LEVEL_LOG)) || args.unshift(LEVEL_LOG),
                args.unshift(BLUE);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_LOG);
        return $console.log.apply($console.thiz, args);
    };
const build_inf = ($console: EngineConsole): EngineLogger =>
    function() {
        const _ts = build_ts();
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            args.unshift(''),
                args.push(RESET),
                ($console.auto_ts && args.unshift(_ts(), LEVEL_INF)) || args.unshift(LEVEL_INF),
                args.unshift(YELLOW);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_INF);
        return $console.log.apply($console.thiz, args);
    };
const build_err = ($console: EngineConsole): EngineLogger =>
    function() {
        const _ts = build_ts();
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            args.unshift(''),
                args.push(RESET),
                ($console.auto_ts && args.unshift(_ts(), LEVEL_ERR)) || args.unshift(LEVEL_ERR),
                args.unshift(RED);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_ERR);
        return $console.error.apply($console.thiz, args);
    };
/* eslint-enable @typescript-eslint/indent */

/** ****************************************************************************************************************
 *  Common functions.
 ** ****************************************************************************************************************/
/**
 * parrallel actions in list (in batch-size = 10)
 *
 * @param list          any list
 * @param callback      (item)=>any | Promise<any>
 * @param size          (optional) size
 * @param pos           (optional) current pos
 * @param result        (optional) result set.
 */
const do_serialize = <T, U>(
    param: T[],
    callback: (node: T, index: number) => U,
    size?: number,
    pos?: number,
    result?: (U | Error)[],
): Promise<(U | Error)[]> => {
    size = size === undefined ? 1 : size;
    pos = pos === undefined ? 0 : pos;
    result = result === undefined ? [] : result;
    const list = param;
    const list2 = list.slice(pos, pos + size);
    const actions = list2.map((node, i): any => {
        const index = pos + i;
        try {
            const R = callback(node, index);
            return R instanceof Promise ? R : Promise.resolve(R);
        } catch (e) {
            return Promise.reject(e);
        }
    });
    return Promise.all(actions).then(_ => {
        result = result.concat(_);
        if (!_.length) return Promise.resolve(result);
        return do_serialize(param, callback, size, pos + size, result);
    });
};

/**
 * initialize as EngineInterface
 *
 * ```ts
 * import engine from 'lemon-engine';
 * const $engine = engine(global, { env: process.env });
 * ```
 *
 * @param scope         main scope like global, browser, ...
 * @param options       configuration.
 */
export const buildEngine = (
    scope: { _$?: LemonEngine; [key: string]: any } = null,
    options: EngineOption = {},
): LemonEngine => {
    scope = scope || {};

    //! load configuration.
    const ROOT_NAME = options.name || 'lemon';
    const _environ = build_environ(options);
    const STAGE = _environ('STAGE', '');
    const LS = _environ('LS', '0') === '1'; // LOG SILENT (NO PRINT LOG)
    const TS = _environ('TS', '1') === '1'; // PRINT TIME-STAMP.
    const LC = _environ('LC', STAGE === 'local' || STAGE === 'express' ? '1' : '') === '1'; // COLORIZE LOG

    //! common function for logging.
    const silent = () => {};
    const $console: EngineConsole = {
        thiz: console,
        log: LS ? silent : console.log,
        error: LS ? silent : console.error,
        auto_ts: TS,
        auto_color: LC,
    };
    const _log = build_log($console);
    const _inf = build_inf($console);
    const _err = build_err($console);

    //! create root instance to manage global objects.
    const createEngine = (): LemonEngine => {
        //! create basic LemonEngine..
        const $engine: LemonEngine = new (class implements LemonEngine {
            private mods: EngineModule[] = [];
            private inited: boolean = false;
            public constructor() {
                this.U = new Utilities(this);
            }
            public readonly STAGE: string = STAGE;
            public readonly id: string = ROOT_NAME;
            public readonly log: GeneralFuntion = _log;
            public readonly inf: GeneralFuntion = _inf;
            public readonly err: GeneralFuntion = _err;
            public readonly U: Utilities;
            public readonly _: any = _;
            public readonly $console: EngineConsole = $console;
            public ts: (date?: number | Date, timeZone?: number) => string = build_ts();
            public dt: (time?: string | number | Date, timeZone?: number) => Date = Utilities.datetime;
            public environ: (
                name: string,
                defValue?: string | number | boolean,
            ) => string | number | boolean = _environ;
            public toString = () => `engine: ${ROOT_NAME}`;
            public register(mod: EngineModule) {
                this.mods.push(mod);
            }
            public module(name: string) {
                const mods = this.mods.filter(_ => _.getModuleName() == name);
                return mods && mods[0];
            }
            public async initialize(force?: boolean, getLevels?: boolean) {
                if (!force && this.inited) return;
                this.inited = true;
                //! setup init level per each module.
                const mods = await Promise.all(
                    this.mods.map(async mod => {
                        const level = await mod.initModule(0);
                        return { level, mod };
                    }),
                );
                //! build map by level => Module.
                const maps: { [key: number]: EngineModule[] } = _.reduce(
                    mods,
                    (M: any, inf) => {
                        if (M[inf.level]) {
                            M[inf.level].push(inf.mod);
                        } else {
                            M[inf.level] = [inf.mod];
                        }
                        return M;
                    },
                    {},
                );
                // eslint-disable-next-line prettier/prettier
                const levels: number[] = Object.keys(maps).map(_ => Number(_)).sort();
                if (getLevels) return levels;
                //! do serialize per each level.
                const res = await do_serialize(levels, level =>
                    Promise.all(
                        maps[level].map(
                            mod =>
                                mod &&
                                mod
                                    .initModule(level)
                                    .then(() => mod.getModuleName())
                                    .catch(e => `ERR[${mod.getModuleName()}] ${e.message}`),
                        ),
                    ),
                );
                return res;
            }
        })();
        //! start initialization only if making $engine.
        STAGE && _inf('#STAGE =', STAGE);
        _inf(`! engine[${ROOT_NAME}] service is ready!`);
        return $engine;
    };

    //! reuse via scope or build new.
    const $engine: LemonEngine = scope._$ || createEngine(); //NOTE - reuse instance.

    //! register as global instances.
    scope._log = scope._log || _log;
    scope._inf = scope._inf || _inf;
    scope._err = scope._err || _err;
    scope._$ = $engine;

    //! returns finally.
    return $engine;
};

//! export default.
export default buildEngine;
