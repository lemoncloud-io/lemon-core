/**
 * `core-types.ts`
 * - common types for core service
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version
 * @date        2020-01-03 support cognito-identity
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */

/**
 * class: `Incrementable`
 * - properties to support atomic increments
 */
export interface Incrementable {
    /**
     * fields to increment
     *  - number: increment number field
     *  - (string | number)[]: append to list(array) field
     */
    [key: string]: number | (string | number)[];
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
    /**
     * site-id (like domain group)
     */
    sid: string;
    /**
     * user-id (user unique-id)
     */
    uid: string;
    /**
     * group-id (group id)
     */
    gid: string;
    /**
     * roles  (like `user`, `admin`, `super`)
     */
    roles: string[];
    /**
     * prefered language (like 'ko')
     * - use `x-lemon-language` header, or in `x-lemon-identity`
     * @since ver2.2.3 2020/JUL/15
     */
    lang?: string;
    /**
     * something unknown.
     */
    meta?: any;
}

/**
 * class: `NextIdentityCognito`
 * - extended information w/ cognito identity.
 */
export interface NextIdentityCognito extends NextIdentity {
    /**
     * account-id of AWS Credential
     */
    accountId: string;
    /**
     * identity-id of cognito.
     */
    identityId: string;
    /**
     * identity-pool-id of cognito
     */
    identityPoolId: string;
    /**
     * authenticated provider of cognito like 'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:618ce9d2-1234-2345-4567-e248ea51425e:kakao_00000'
     */
    identityProvider?: string;
    /**
     * user-agent string like 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_4)'
     */
    userAgent?: string;
}

/**
 * class: `NextIdentityAcess`
 * - extended information w/ site + account access information.
 */
export interface NextIdentityAccess extends NextIdentity {
    /**
     * site-information for domain
     */
    Site?: {
        stereo?: string;
        name?: string;
        domain?: string;
    };
    /**
     * domain-information for current-access
     */
    Domain?: {
        stereo?: string;
        name?: string;
        domain?: string;
    };
    /**
     * user-information for active user.
     */
    User?: {
        name?: string;
        nick?: string;
        email?: string;
    };
    /**
     * group-information for groups.
     */
    Group?: {
        name?: string;
        roles?: string[];
    };
    /**
     * login account-information.
     */
    Account?: {
        id?: string;
        stereo?: string;
        socialId?: string;
        identityId?: string;
        loginId?: string;
    };
}

/**
 * class: `NextContext`
 * - information of caller's context.
 */
export interface NextContext<T extends NextIdentity = NextIdentity> {
    /**
     * user identity after authentication.
     */
    identity?: T;
    /**
     * origin event source. can be 'express' if `npm run express.local`.
     */
    source?: string;
    /**
     * ip-address of source client.
     */
    clientIp?: string;
    /**
     * user-agent of source client.
     */
    userAgent?: string;
    /**
     * id of request to keep track of timing infor w/ `metrics`
     */
    requestId?: string;
    /**
     * id of account of initial request. (ex: `085403634746` for lemon profile)
     */
    accountId?: string;
    /**
     * domain name of request.
     */
    domain?: string;
    /**
     * cookie string of origin request
     */
    cookie?: { [key: string]: string };
    /**
     * calling depth for every handler. ( automatically increased from lambda-handler )
     */
    depth?: number;
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
 * Decode `NextHandler` by mode + id + cmd (+ path)
 */
export type NextDecoder<TMode = NextMode> = (mode: TMode, id?: string, cmd?: string, path?: string) => NextHandler;

/** ********************************************************************************************************************
 *  Services Interfaces
 ** ********************************************************************************************************************/

/**
 * class: QueryResult
 * - result information of query.
 */
export interface QueryResult<T> {
    // list of data
    list: T[];
    // number of data
    total?: number;
    // current page
    page?: number;
    // limit of list.
    limit?: number;
    // terms aggregations
    aggregations?: any;
}
/**
 * class: `SimpleSearchParam`
 * - simplified search param with json object.
 */
export interface SimpleSearchParam extends GeneralItem {
    $query?: string | any; // low query object.
    $limit?: number; // limit
    $page?: number; // page
    $Q?: string; // simple inline query
    $A?: string; // aggregation.
    $O?: string; // ordering.
    $H?: string; // highlight.
    $source?: string; // returned source fields set. '*', 'obj.*', '!abc'
    $exist?: string; // check if exists
    $exists?: string; // check if exists
}

/**
 * class: `AutocompleteSearchParam`
 *  - Search-as-You-Type
 */
export interface AutocompleteSearchParam {
    /**
     * query object. key as field to search and value as string to match
     */
    $query: {
        [field: string]: string;
    };
    /**
     * additional filter object.
     */
    $filter?: {
        [field: string]: string;
    };
    /**
     * maximum results in a page (default: 10)
     */
    $limit?: number; // limit
    /**
     * 0-indexed page number (default: 0)
     */
    $page?: number; // page
    /**
     * highlighting
     *  - if boolean is given, turn on/off highlighting (default: false)
     *  - if string is given, replace default highlighting tags (default: 'em')
     */
    $highlight?: boolean | string;
}

/**
 * feature: `DynamoSimpleQueriable`
 * - simple query capable class.
 */
export interface Elastic6SimpleQueriable<T extends GeneralItem> {
    /**
     * simple range query by `partition-key` w/ limit.
     *
     * @param id        value of id
     */
    queryAll(id: string, limit?: number, isDesc?: boolean): Promise<QueryResult<T>>;

    /**
     * search in simplemode
     *
     * @param param     SimpleSearchParam
     */
    searchSimple(param: SimpleSearchParam): Promise<QueryResult<T>>;
}
