/**
 * `core-services.ts`
 * - common types for core service
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */
export * from './core-types';

import { NextMode, NextContext } from './core-types';

export type STAGE = 'local' | 'dev' | 'prod';

/** ********************************************************************************************************************
 *  Core Services
 ** ********************************************************************************************************************/
/**
 * class: `CoreServices`
 * - common service super class.
 */
export interface CoreServices {
    hello(): string;
}

/**
 * class: `CoreConfigService`
 * - general interface to provide config
 */
export interface CoreConfigService extends CoreServices {
    /**
     * get config value.
     *
     * @param key key name
     */
    get(key: string): string;

    /**
     * get the current service name of `package.json#name`
     */
    getService(): string;

    /**
     * get the current service name of `package.son#version`
     */
    getVersion(): string;

    /**
     * get the current stage stage via `env.STAGE`
     */
    getStage(): STAGE;
}

/**
 * class: `CoreKmsService`
 * - support encrypt/decrypt message.
 */
export interface CoreKmsService extends CoreServices {
    encrypt: (message: string, keyId?: string) => Promise<string>;
    decrypt: (encryptedSecret: string, keyId?: string) => Promise<string>;
}

/**
 * class: `CoreSnsService`
 * - support encrypt/decrypt message.
 */
export interface CoreSnsService extends CoreServices {
    publish: (target: string, subject: string, payload: any) => Promise<string>;
    reportError: (e: Error, data?: any, target?: string) => Promise<string>;
}

/** ********************************************************************************************************************
 *  Protocol Services
 ** ********************************************************************************************************************/
/**
 * class: `ProtocolParam`
 * - common protocol parameters.
 */
export interface ProtocolParam<TParam = { [key: string]: any }, TBody = { [key: string]: any }> {
    service?: 'self' | string; // target service name like `lemon-hello-api` (default package.name)
    stage?: STAGE; // target stage (default env.STAGE)
    type: string; // handler type in `lambda-web-handler`
    mode?: NextMode; // method of event (default `GET`)
    id?: string; // id of resource
    cmd?: string; // command.
    param?: TParam; // command paramter
    body?: TBody; // body of json
    context: NextContext; // the current context
}

/**
 * class: `ProtocolTransformer`
 * - transform param to event, or vise versa.
 */
export interface ProtocolTransformer<TEventParam = any, TLambdaEvent = TEventParam> {
    /**
     * transform param to event
     * @param uri       uri from `asProtocolURI()`
     * @param param     the calling param.
     */
    transformToEvent(uri: string, param: ProtocolParam): TEventParam;

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    transformToParam(event: TLambdaEvent): ProtocolParam;
}

/**
 * class: `ProtocolService`
 * - support inter communication (sync or async) between micro-services.
 */
export interface ProtocolService {
    /**
     * from string url, transform to protocol-param.
     * *mode* is dependent on body condition.
     * - if body is undefined, then mode will be 'GET'
     * - if body is not undefined, then mode will be 'POST'.
     *
     * @param context   the current execute context via controller.
     * @param url       url string must start with 'lemon://' like `lemon://lemon-hello-api/hello/0`
     * @param param     query parameter (optional)
     * @param body      post body (optional)
     */
    fromURL(context: NextContext, url: string, param?: any, body?: any): ProtocolParam;

    /**
     * synchronized call to target function via 'Lambda'.
     * @param param     the calling param
     */
    execute<T>(param: ProtocolParam): Promise<T>;

    /**
     * asynchronized call to target function via 'SNS'.
     * @param param     the calling param
     * @param callback  the return target
     */
    notify(param: ProtocolParam, callback?: ProtocolParam): Promise<string>;

    /**
     * asynchronized call to target function via 'SNS'.
     * @param param     the calling param
     * @param callback  the return target
     */
    enqueue(param: ProtocolParam, callback?: ProtocolParam): Promise<string>;
}
