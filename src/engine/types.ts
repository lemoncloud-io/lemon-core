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
 * class: `EngineModules`
 * - manager EngineModules.
 */
export interface EngineModules {
    /**
     * register module
     * @param mod       module instance.
     */
    register(mod: EngineModule): void;

    /**
     * get module by name
     * @param name      module name.
     */
    module<T extends EngineModule>(name: string): T;

    /**
     * asynced initializer.
     * @param force     (optional) force to init after already initialized.
     */
    initialize(force?: boolean): Promise<any>;
}

/**
 * class: `LemonEngine`
 * - core part of lemon-engine.
 */
export interface LemonEngine extends EngineCore, EngineModules {
    // (name: string, opts: any): any;
    STAGE: string;
    id: string;
    ts: (date?: undefined | number | Date, timeZone?: number) => string;
    dt: (time?: string | number | Date, timeZone?: number) => Date;
    $console: EngineConsole;
}

/**
 * the key of $engine in scope.
 */
export const ENGINE_KEY_IN_SCOPE = `_$`;

/**
 * class: `EngineScope`
 * - engine
 */
export interface EngineScope {
    [ENGINE_KEY_IN_SCOPE]?: LemonEngine;
    [key: string]: any;
}

/**
 * class: `EngineOption`
 * - creation options
 */
export interface EngineOption {
    name?: string;
    env?: { [key: string]: string };
    console?: EngineConsole;
}

export type EngineLogger = GeneralFuntion;

/**
 * class: `EngineConsole`
 * - general console.
 */
export interface EngineConsole {
    thiz: any;
    ts?: GeneralFuntion; // get timestamp like '2019-11-29 22:38:20'
    log: EngineLogger; // for _log()
    info?: EngineLogger; // for _inf()
    error?: EngineLogger; // for _err()
    auto_ts: boolean;
    auto_color: boolean;
}

/**
 * class: `EngineModule`
 * - override this to register as module.
 */
export interface EngineModule {
    /**
     * returns module name
     */
    getModuleName(): string;

    /**
     * initialize module with async
     * - use `level` to determine the required level if level === undefined.
     * - start init if level is matched.
     *
     * @param level     the level of init. (starts 0)
     * @return          the required level if !level.
     */
    initModule(level?: number): Promise<number>;
}
