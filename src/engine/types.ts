/**
 * `engine/types.ts`
 * - Simple Logger with timestamp + color
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { Utilities } from './utilities';

/**
 * class: `GeneralFuntion`
 * - general function
 */
export interface GeneralFuntion {
    (...arg: any[]): any;
}

/**
 * class: `EngineCore`
 * - core part of engine.
 */
export interface EngineCore {
    /**
     * print debug log
     */
    log: GeneralFuntion;
    /**
     * print info log
     */
    inf: GeneralFuntion;
    /**
     * print error log
     */
    err: GeneralFuntion;
    /**
     * helper utilities
     */
    U: Utilities;
    /**
     * lodash library
     */
    _: any; // = require('lodash/core')
    /**
     * get environment value.
     */
    environ: (name: string, defValue?: string | boolean | number | undefined) => string | boolean | number | undefined;
}

/**
 * class: `LemonEngine`
 * - core part of lemon-engine.
 */
export interface LemonEngine extends EngineCore {
    // (name: string, opts: any): any;
    STAGE: string;
    id: string;
    ts: (date?: undefined | number | Date, timeZone?: number) => string;
    dt: (time?: string | number | Date, timeZone?: number) => Date;
    $console: EngineConsole;
}

/**
 * class: `EngineOption`
 * - creation options
 */
export interface EngineOption {
    name?: string;
    env?: { [key: string]: string };
}

export type EngineLogger = GeneralFuntion;

/**
 * class: `EngineConsole`
 * - general console.
 */
export interface EngineConsole {
    thiz: any;
    log: EngineLogger;
    error: EngineLogger;
    auto_ts: boolean;
    auto_color: boolean;
}
