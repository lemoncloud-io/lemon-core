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

export type STAGE = '' | 'local' | 'dev' | 'prod';

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
 * type: `ProtocolBody`
 */
export interface ProtocolBody {
    [key: string]: any;
}

/**
 * type: `CallbackParam`
 * - if async protocol has done, result data will be 'POST' to lambda.
 * - `param` will be attached.
 * - result data will be `filtered` with callback's result.
 */
export interface CallbackParam {
    type: string; // resource type
    id: string; // resource id
    cmd?: string; // (optional) action command
    param?: ProtocolBody; // param to be relayed
}

/**
 * class: `ProtocolParam`
 * - common protocol parameters.
 */
export interface ProtocolParam<TParam = ProtocolBody, TBody = ProtocolBody> {
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
     * @param callback  the callback URI like `api://lemon-hello-api-dev/hello`
     */
    transformToEvent(uri: string, param: ProtocolParam, callback?: string): TEventParam;

    /**
     * transform event data to param
     * @param event     the lambda compatible event data.
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
    fromURL(context: NextContext, url: string, param?: ProtocolBody, body?: ProtocolBody): ProtocolParam;

    /**
     * synchronized call to target function via 'Lambda'.
     *
     * @param param     the calling param
     * @param config    (optional) custom config
     * @param uri       (optional) custom uri to provide.
     */
    execute<T>(param: ProtocolParam, config?: CoreConfigService, uri?: string): Promise<T>;

    /**
     * asynchronous call to target function via 'SNS'.
     *
     * @param param     the calling param
     * @param callback  the return target
     */
    notify(param: ProtocolParam, callback?: CallbackParam): Promise<string>;

    /**
     * asynchronous call to target function via 'SQS' (queue).
     *
     * @param param     the calling param
     * @param callback  the return target
     * @param delaySeconds  (from AWS doc) The length of time, in seconds, for which to delay a specific message. Valid values: 0 to 900. Maximum: 15 minutes. Messages with a positive DelaySeconds value become available for processing after the delay period is finished. If you don't specify a value, the default value for the queue applies.   When you set FifoQueue, you can't set DelaySeconds per message. You can set this parameter only on a queue level.
     */
    enqueue(param: ProtocolParam, callback?: CallbackParam, delaySeconds?: number): Promise<string>;

    /**
     * broadcast body message via shared `SNS` subscriptions. (see `NotificationHandler`)
     * - `.service` will be self url like `api://lemon-hello-api#1.2.3`
     *
     * @param context   the current execute context. (`.identity` will be relayed).
     * @param endpoint  the SNS endpoint like `lemon-hello-out`, or full ARN.
     * @param body      the message body to broadcast.
     * @returns         the message-id if applicable.
     */
    broadcast(context: NextContext, endpoint: string, body: ProtocolBody): Promise<string>;

    /**
     * get `protocol-transformer` by name
     * @param name      name as 'web', 'sns', 'sqs'
     */
    asTransformer<TEventParam = any, TLambdaEvent = TEventParam>(
        name: 'web' | 'sns' | 'sqs',
    ): ProtocolTransformer<TEventParam, TLambdaEvent>;

    /**
     * get the current service's protocol uri
     *
     * @param context   the current context.
     * @param type      (optional) resource type
     * @param id        (optional) resource id
     * @param cmd       (optional) action command
     */
    myProtocolURI(context: NextContext, type?: string, id?: string, cmd?: string): string;
}
