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
import { EngineOption, EngineLogger, EngineConsole, LemonEngine, GeneralFuntion } from './types';
import { Utilities } from './utilities';
import _ from 'lodash';

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
export default function buildEngine(
    scope: { _$?: LemonEngine; [key: string]: any } = null,
    options: EngineOption = {},
): LemonEngine {
    scope = scope || {};

    //! load configuration.
    const ROOT_NAME = options.name || 'lemon';
    const STAGE = _environ('STAGE', '');
    const LS = _environ('LS', '0') === '1'; // LOG SILENT (NO PRINT LOG)
    const TS = _environ('TS', '1') === '1'; // PRINT TIME-STAMP.
    const LC = _environ('LC', STAGE === 'local' || STAGE === 'express' ? '1' : '') === '1'; // COLORIZE LOG
    // console.log('!!!!!!! LS,TS,LC =', LS, TS, LC);

    const LEVEL_LOG = '-';
    const LEVEL_INF = 'I';
    const LEVEL_ERR = 'E';

    const RED = '\x1b[31m';
    const BLUE = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const RESET = '\x1b[0m';

    function _environ(name: string, defVal: any) {
        // as default, load from proces.env.
        const env = options.env || (process && process.env) || {};
        const val = env[name];
        // throw Error if value is not set.
        if (defVal && defVal instanceof Error && val === undefined) throw defVal;
        // returns default.
        return val === undefined ? defVal : val;
    }

    // timestamp like 2016-12-08 13:30:44
    function _ts(date?: undefined | number | Date, timeZone?: number) {
        return Utilities.timestamp(date, timeZone);
    }

    //! common function for logging.
    const silent = () => {};
    const $console: EngineConsole = {
        thiz: console,
        log: LS ? silent : console.log,
        error: LS ? silent : console.error,
        auto_ts: TS,
        auto_color: LC,
    };
    /* eslint-disable @typescript-eslint/indent */
    const _log: EngineLogger = function() {
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            args.unshift(RESET),
                ($console.auto_ts && args.unshift(_ts(), LEVEL_LOG)) || args.unshift(LEVEL_LOG),
                args.unshift(BLUE);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_LOG);
        return $console.log.apply($console.thiz, args);
    };
    const _inf: EngineLogger = function() {
        let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
        if ($console.auto_color)
            args.unshift(''),
                args.push(RESET),
                ($console.auto_ts && args.unshift(_ts(), LEVEL_INF)) || args.unshift(LEVEL_INF),
                args.unshift(YELLOW);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_INF);
        return $console.log.apply($console.thiz, args);
    };
    const _err: EngineLogger = function() {
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

    //! create root instance to manage global objects.
    const createEngine = (): LemonEngine => {
        //! avoid type check error.
        const $engine: LemonEngine = new (class implements LemonEngine {
            public readonly STAGE: string = STAGE;
            public readonly id: string = ROOT_NAME;
            public readonly log: GeneralFuntion = _log;
            public readonly inf: GeneralFuntion = _inf;
            public readonly err: GeneralFuntion = _err;
            public readonly U: Utilities;
            public readonly _: any = _;
            public readonly $console: EngineConsole = $console;
            public ts: (date?: number | Date, timeZone?: number) => string = _ts;
            public dt: (time?: string | number | Date, timeZone?: number) => Date = Utilities.datetime;
            public environ: (
                name: string,
                defValue?: string | number | boolean,
            ) => string | number | boolean = _environ;
            public toString = () => `${ROOT_NAME}`;
            public constructor() {
                this.U = new Utilities(this);
            }
        })();
        //! start initialization only if making $engine.
        STAGE && _inf('#STAGE =', STAGE);

        //! load common services....
        _inf(`! engine[${ROOT_NAME}] service ready !`);

        //! returns.
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
}
