/**
 * `core-types.ts`
 * - common types for core service
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */

/**
 * class: `Incrementable`
 * - properties to support atomic increments
 */
export interface Incrementable {
    [key: string]: number;
}

/**
 * class: `GeneralItem`
 * - general simple item model
 */
export interface GeneralItem {
    [key: string]: string | string[] | number | number[];
}

/** ********************************************************************************************************************
 *  COMMON Interfaces
 ** ********************************************************************************************************************/
/**
 * type: `NextMode`
 * - compartible with REST API Method.
 */
export type NextMode = 'LIST' | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * class: `NextIdentity`
 * - the context parameter for each next-handler `fx(id, param, body, context)`
 * - possible to query user's detail via OAuth Resource Server.
 */
export interface NextIdentity {
    sid: string; // site-id (like domain group)
    uid: string; // user-id (user unique-id)
    gid: string; // group-id (group id)
    roles: string[]; // roles  (like `user`, `admin`, `super`)
}

/**
 * class: `NextIdentityCognito`
 * - extended infor w/ cognito
 */
export interface NextIdentityCognito extends NextIdentity {
    accountId: string;
    cognitoId: string;
    cognitoPoolId: string;
}

/**
 * class: `NextContext`
 * - information of caller's context.
 *
 * //TODO - define more in order to pass calling flow.
 */
export interface NextContext<T extends NextIdentity = NextIdentity> {
    identity?: T; // user identity after authentication.
    source?: string; // origin event source. can be 'express' if `npm run express.local`.
    clientIp?: string; // ip-address of source client.
    requestId?: string; // id of request to keep track of timing infor w/ `metrics`
    accountId?: string; // id of account of initial request. (ex: `085403634746` for lemon profile)
    depth?: number; // calling depth for every handler. ( automatically increased from lambda-handler )
}

/**
 * type: `NextHandler`
 * - basic form of next handler of contollers (as API)
 * - RestAPI 요청을 처리하는 콘트롤 함수.
 */
export type NextHandler<TParam = any, TResult = any, TBody = any> = (
    id?: string,
    param?: TParam,
    body?: TBody,
    $ctx?: NextContext,
) => Promise<TResult>;

/**
 * Decode `NextHandler` by mode + id + cmd.
 */
export type NextDecoder<TMode = NextMode> = (mode: TMode, id?: string, cmd?: string) => NextHandler;

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
