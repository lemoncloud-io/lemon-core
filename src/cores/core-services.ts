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
import { NextMode, NextContext } from './core-types';

/** ********************************************************************************************************************
 *  Core Services
 ** ********************************************************************************************************************/
export interface CoreKmsService {
    hello: () => { hello: string };
    encrypt: (message: string, keyId?: string) => Promise<string>;
    decrypt: (encryptedSecret: string) => Promise<string>;
}

/** ********************************************************************************************************************
 *  Protocol Services
 ** ********************************************************************************************************************/
export type STAGE = 'local' | 'dev' | 'prod';

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
     * synchronized call to target function.
     *
     * @param param     the calling param
     */
    execute<T>(param: ProtocolParam): Promise<T>;

    /**
     * Asynchronized call to target function.
     *
     * @param param     the calling param
     * @param callback  the return target
     */
    notify(param: ProtocolParam, callback?: ProtocolParam): Promise<string>;
}
