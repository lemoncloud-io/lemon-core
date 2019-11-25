/**
 * types.ts
 * - common types
 *
 * @author steve@lemoncloud.io
 * @date   2019-05-23
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { Utilities } from '../core/utilities';
import { HttpProxy } from '../plugins/http-proxy';
import { WebProxy } from '../plugins/web-proxy';
import { LemonEngineModel } from '../core/lemon-engine-model';

//! Indexable.
interface Indexable {
    [key: string]: any;
}

//! Interface with default member.
interface Animal {
    name: string;
    age: number;
    size?: number;
}

//! 생성자 인터페이스
interface AnimalConstructor {
    new (name: string, age: number): Animal;
}

export interface GeneralFuntion {
    (...arg: any[]): any;
}
export interface GeneralOptions {
    [key: string]: any;
}

export interface EnginePluggable {
    name(): string;
}
export type EnginePlugginOptions = string | GeneralOptions;

//! each plugin should implement this.
export interface EnginePluginBuilder<T extends EnginePluggable> {
    ($engine: EngineCore, name: string, options?: EnginePlugginOptions): T;
}

export interface EnginePluginBroker<T extends EnginePluggable> {
    (name: string, options?: EnginePlugginOptions): T;
}

export interface EngineCore {
    /**
     * get/set plugin by name.
     */
    <T extends EnginePluggable>(name: string, service?: T): T;
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

export interface LemonEngine extends EngineCore {
    // (name: string, opts: any): any;
    STAGE: string;
    id: string;
    extend: (a: any, b: any) => any;
    ts: (date?: undefined | number | Date, timeZone?: number) => string;
    dt: (time?: string | number | Date, timeZone?: number) => Date;
    $console: EngineConsole;
    createModel: EnginePluginBroker<LemonEngineModel>;
    createHttpProxy: EnginePluginBroker<HttpProxy>;
    createWebProxy: EnginePluginBroker<WebProxy>;
    $plugins: { [key: string]: EnginePluggable };
}

export interface EngineOption {
    name?: string;
    env?: { [key: string]: string };
}

export interface EngineLogger {
    (...arg: any[]): void;
}

export interface ServiceMaker {
    (name: string, options: any): any;
}

export interface EngineConsole {
    thiz: any;
    log: EngineLogger;
    error: EngineLogger;
    auto_ts: boolean;
    auto_color: boolean;
}

/**
 * Standard Method for handling API call.
 * - 표준화된 API 처리 핸들러 형식을 지정함.
 *
 * @author steve@lemoncloud.io
 * @copyright LemonCloud Co,. LTD 2019.
 */
export interface LemonStandardApi {
    (id: string, param: any, body: any, ctx: any): Promise<any>;
}
