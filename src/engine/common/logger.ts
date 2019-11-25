/**
 * logger.ts
 * - Simple Logger with timestamp + color
 *
 * @author steve@lemoncloud.io
 * @date   2019-05-23
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const options = { env: {} as any };

//! load from environment.
const getEnviron = (name: string, defVal?: any) => {
    // as default, load from proces.env.
    const env = options.env || (process && process.env) || {};
    const val = (env && env[name]) || undefined;
    // throw Error if value is not set.
    if (defVal && defVal instanceof Error && val === undefined) throw defVal;
    // returns default.
    return val === undefined ? defVal : val;
};

//! timestamp like 2016-12-08 13:30:44
const timestamp = (d0?: Date) => {
    let dt = d0 || new Date();
    let [y, m, d, h, i, s] = [
        dt.getFullYear(),
        dt.getMonth() + 1,
        dt.getDate(),
        dt.getHours(),
        dt.getMinutes(),
        dt.getSeconds(),
    ];
    return (
        (y < 10 ? '0' : '') +
        y +
        '-' +
        (m < 10 ? '0' : '') +
        m +
        '-' +
        (d < 10 ? '0' : '') +
        d +
        ' ' +
        (h < 10 ? '0' : '') +
        h +
        ':' +
        (i < 10 ? '0' : '') +
        i +
        ':' +
        (s < 10 ? '0' : '') +
        s
    );
};

//! PRINT TIME-STAMP.
const TS = getEnviron('TS', '1') === '1';
//! COLORIZE LOG.
const LC = getEnviron('LC', '1') === '1';

const LEVEL_LOG = 'LOG';
const LEVEL_INF = 'INF';
const LEVEL_ERR = 'ERR';

//! COLOR CODE IN CONSOLE.
const RED = '\x1b[31m';
const BLUE = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

//! common function for logging.
const $console = { thiz: console, log: console.log, error: console.error || console.log, auto_ts: TS, auto_color: LC };

//! log normal
export const _log = function(...arg: any[]) {
    let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
    if ($console.auto_color) {
        args.unshift(RESET);
        ($console.auto_ts && args.unshift(timestamp(), LEVEL_LOG)) || args.unshift(LEVEL_LOG);
        args.unshift(BLUE);
    } else {
        $console.auto_ts && args.unshift(timestamp(), LEVEL_LOG);
    }
    return $console.log.apply($console.thiz, args);
};

//! inf with highlight
export const _inf = function(...arg: any[]) {
    let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
    if ($console.auto_color) {
        args.unshift('');
        args.push(RESET);
        ($console.auto_ts && args.unshift(timestamp(), LEVEL_INF)) || args.unshift(LEVEL_INF);
        args.unshift(YELLOW);
    } else {
        $console.auto_ts && args.unshift(timestamp(), LEVEL_INF);
    }
    return $console.log.apply($console.thiz, args);
};

//! err in warning.
export const _err = function(...arg: any[]) {
    let args = (!Array.isArray(arguments) && Array.prototype.slice.call(arguments)) || arguments;
    if ($console.auto_color) {
        args.unshift('');
        args.push(RESET);
        ($console.auto_ts && args.unshift(timestamp(), LEVEL_ERR)) || args.unshift(LEVEL_ERR);
        args.unshift(RED);
    } else {
        $console.auto_ts && args.unshift(timestamp(), LEVEL_ERR);
    }
    return $console.error.apply($console.thiz, args);
};
