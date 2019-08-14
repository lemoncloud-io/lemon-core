/**
 * `types.ts`
 * - main definitions of types
 *
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-09 initial commit
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */

/**
 * RestAPI 요청을 처리하는 콘트롤 함수.
 */
export interface NextHanlder {
    (id?: string, param?: any, body?: any, $ctx?: any): Promise<any>;
}

/**
 * 라우팅 디코더..
 */
export interface NextDecoder {
    (mode?: string, id?: string, cmd?: string): NextHanlder;
}

/**
 * 라우팅 디코더..
 */
export interface NextCallback<T> {
    (error?: Error, data?: T): void;
}

/**
 * Lambda Compartible Handler.
 * ```js
 * const main = (event, context, callback) => {}
 * ```
 */
export interface CoreHandler<T> {
    // basic lambda handler.
    (event: any, context: any, callback: NextCallback<T>): void;
    // helper method without callback.
    do?: (event: any, context: any) => Promise<T>;
}

/**
 * Builder of main() handler.
 */
export interface MainBuilder<T> {
    (NS: string, decode_next_handler: NextDecoder): CoreHandler<T>;
}

/**
 * Builder of event-broker() handler like `SNS` + `SQS`
 * - Transfer to `WebHandler` from origin event source.
 */
export interface BrokerBuilder<T> {
    (defaultType?: string, NS?: string, params?: any): CoreHandler<T>;
}

/**
 * common result of web-handler.
 */
export interface WebResult {
    statusCode: number;
    headers?: {
        [key: string]: string | boolean | number;
    };
    body: string;
}

/**
 * common Web handler.
 */
export interface WebHandler extends CoreHandler<WebResult> {}
