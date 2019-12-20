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
import {
    EngineOption,
    EngineLogger,
    EngineConsole,
    LemonEngine,
    GeneralFuntion,
    EngineModule,
    EngineModules,
    EngineScope,
    ENGINE_KEY_IN_SCOPE,
} from './types';
import { Utilities } from './utilities';
import _ from 'lodash';
//WARN! - ------------------------------------------------------
//WARN! - DO NOT IMPORT ANY DEPENDENCY IN HERE EXCEPT TYPES.
//WARN! - ------------------------------------------------------

//! build environment getter
export const build_environ = (options: EngineOption) => (name: string, defVal: any) => {
    // as default, load from proces.env.
    const env = options.env || (process && process.env) || {};
    const val = env[name];
    // throw Error if value is not set.
    if (defVal && defVal instanceof Error && val === undefined) throw defVal;
    // returns default.
    return val === undefined ? defVal : val;
};

// build timestamp like 2016-12-08 13:30:44
export const build_ts = (options?: EngineOption) => {
    const $console = options && options.console;
    const _ts = $console && typeof $console.ts == 'function' ? $console.ts : Utilities.timestamp;
    return (date?: undefined | number | Date, timeZone?: number) => _ts(date, timeZone);
};

const LEVEL_LOG = '-';
const LEVEL_INF = 'I';
const LEVEL_ERR = 'E';

export const RED = '\x1b[31m';
export const BLUE = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RESET = '\x1b[0m';

/* eslint-disable @typescript-eslint/indent */
export const build_log = ($console: EngineConsole): EngineLogger =>
    function() {
        const _ts = build_ts({ console: $console });
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            ($console.auto_ts && args.unshift(_ts(), LEVEL_LOG + RESET)) || args.unshift(LEVEL_LOG + RESET),
                args.unshift(BLUE);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_LOG);
        return $console.log.apply($console.thiz, args);
    };
export const build_inf = ($console: EngineConsole): EngineLogger =>
    function() {
        const _ts = build_ts({ console: $console });
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            ($console.auto_ts && args.unshift(_ts(), LEVEL_INF + RESET)) || args.unshift(LEVEL_INF + RESET),
                args.unshift(YELLOW);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_INF);
        return $console.log.apply($console.thiz, args);
    };
export const build_err = ($console: EngineConsole): EngineLogger =>
    function() {
        const _ts = build_ts({ console: $console });
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            ($console.auto_ts && args.unshift(_ts(), LEVEL_ERR + RESET)) || args.unshift(LEVEL_ERR + RESET),
                args.unshift(RED);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_ERR);
        return $console.log.apply($console.thiz, args);
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
export const do_serialize = <T, U>(
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
 * class: `MyEngineModules`
 * - local implementation of EngineModules
 */
class MyEngineModules implements EngineModules {
    private mods: EngineModule[] = [];
    private inited: boolean = false;
    public constructor() {}
    public register(mod: EngineModule) {
        // console.info(`! mod.reg(${mod.getModuleName()})..`);
        this.mods.push(mod);
    }
    public module<T extends EngineModule>(name: string) {
        const mods = this.mods.filter(_ => _.getModuleName() == name);
        const res: T = (mods && mods[0]) as T;
        return res;
    }
    public async initialize(force?: boolean, getLevels?: boolean) {
        if (!force && this.inited) return;
        // console.info(`! EngineModules.init()..`);
        this.inited = true;
        //! setup init level per each module.
        const mods = await Promise.all(
            this.mods.map(async mod => {
                const level = await mod.initModule();
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
        const catchModError = (e: Error, mod: EngineModule) => {
            // console.error(`! mod[${mod.getModuleName()}].err =`, e);
            return `ERR[${mod.getModuleName()}] ${e.message}`;
        };
        //! do serialize per each level.
        const res = await do_serialize(levels, level =>
            Promise.all(
                maps[level].map(
                    mod =>
                        mod &&
                        mod
                            .initModule(level)
                            .then(() => mod.getModuleName())
                            .catch(e => catchModError(e, mod)),
                ),
            ),
        );
        // console.info(`! engine[${res.length}].inited =`, res);
        return res;
    }
}

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
export const buildEngine = (scope?: EngineScope, options?: EngineOption): LemonEngine => {
    scope = scope || {};
    options = options || {};

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
        ...options.console, // override with options
    };
    const _log = build_log($console);
    const _inf = build_inf($console);
    const _err = build_err($console);

    //! create root instance to manage global objects.
    const createEngine = (): LemonEngine => {
        const $engine: LemonEngine = new (class extends MyEngineModules implements LemonEngine {
            public constructor() {
                super();
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
            public ts: (date?: number | Date, timeZone?: number) => string = build_ts({ console: $console });
            public dt: (time?: string | number | Date, timeZone?: number) => Date = Utilities.datetime;
            public environ: (
                name: string,
                defValue?: string | number | boolean,
            ) => string | number | boolean = _environ;
            public toString = () => `engine: ${ROOT_NAME}`;
        })();
        //! start initialization only if making $engine.
        STAGE && _inf('#STAGE =', STAGE);
        _inf(`! engine[${ROOT_NAME}] service is ready!`);
        return $engine;
    };

    //! reuse via scope or build new.
    const $engine: LemonEngine = scope[ENGINE_KEY_IN_SCOPE] || createEngine(); //NOTE - reuse instance.

    //! register as global instances.
    scope._log = $engine.log || _log;
    scope._inf = $engine.inf || _inf;
    scope._err = $engine.err || _err;
    scope[ENGINE_KEY_IN_SCOPE] = $engine;

    //! returns finally.
    return $engine;
};

//! export default.
export default buildEngine;
