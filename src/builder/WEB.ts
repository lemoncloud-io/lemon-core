/**
 * `builder/WEB.ts`
 * - common http web handler via `API-GATEWAY`
 *
 *
 * # Usage
 * - file: `item-api.js`
 * ```js
 * import builder from 'bootload';
 * const main = builder($engine, NS, decode_next_handler);
 * main.do_list_item = (id, cmd) => { ... };
 * ...
 * export default main;
 * ```
 *
 * - file: `other-api.js`
 * ```js
 * import $user from '../item-api';
 * ...
 * const res = $user().do_list_item(1, '');
 * ```
 *
 *
 * @author  Steve Jung <steve@lemoncloud.io>
 * @date    2019-08-09 initial version via latest `bootload.js`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $U, _log, _inf, _err } from '../core/engine';
import { $engine, doReportError } from '../core/engine';
import { MainBuilder, WebResult, CoreHandler, NextHanlder, NextCallback } from '../common/types';

/** ********************************************************************************************************************
 *  COMMON Constants
 ** ********************************************************************************************************************/
interface ModeMap {
    [key: string]: string;
}
//! constants config
const HEADER_LEMON_IDENTITY = 'x-lemon-identity';
const METHOD_MODE_MAP: ModeMap = 'LIST,GET,PUT,POST,DELETE,CONNECT,DISCONNECT,MESSAGE'
    .split(',')
    .reduce((N: ModeMap, K) => {
        N[K] = K;
        return N;
    }, {});

/** ********************************************************************************************************************
 *  COMMON Functions.
 ** ********************************************************************************************************************/
export const buildResponse = (statusCode: number, body: any): WebResult => {
    // @0612 - body 가 string일 경우, 응답형식을 텍스트로 바꿔서 출력한다.
    return {
        statusCode,
        headers: {
            'Content-Type':
                typeof body === 'string'
                    ? body.startsWith('<') && body.endsWith('>')
                        ? 'text/html; charset=utf-8'
                        : 'text/plain; charset=utf-8'
                    : 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*', // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
};

export const success = (body: any) => {
    return buildResponse(200, body);
};

export const notfound = (body: any) => {
    return buildResponse(404, body);
};

export const failure = (body: any) => {
    return buildResponse(503, body);
};

/** ********************************************************************************************************************
 *  MAIN EXPORTS
 ** ********************************************************************************************************************/
/**
 * basic handler function for lambda serverless
 *
 * @param {*} NS            name-space to print
 * @param {*} decode_next_handler  next handler.
 */
export const builder: MainBuilder<WebResult> = (NS, decode_next_handler) => {
    if (!$engine) throw new Error('_$(global instance pool) is required!');
    if (!NS) throw new Error('NS (name-space) is required!');
    if (!decode_next_handler) throw new Error('decode_next_handler is required!');
    if (typeof decode_next_handler !== 'function') throw new Error('decode_next_handler(function) is required!');

    /** ********************************************************************************************************************
     *  Main Function for API export.
     ** ********************************************************************************************************************/
    /**
     * basic handler function for lambda serverless
     *
     * @param {*} event         event object
     * @param {*} context       conext object
     * @param {*} callback      callback handler.
     */
    const main: CoreHandler<WebResult> = (event, context, callback) => {
        //! NOTE! for internal importing. return self if event is undefined @190731.
        if (event === undefined) return main;

        //! WARN! allows for using callbacks as finish/error-handlers
        if (context) context.callbackWaitsForEmptyEventLoop = false;

        //! API parameters.
        const $param = event.queryStringParameters || {};
        const $path = event.pathParameters || {};
        // _log(NS,'$path=', $path);
        // _log(NS,'headers=', event.headers);

        //! determine running mode.
        const TYPE = decodeURIComponent($path.type || ''); // type in path (0st parameter).
        const ID = decodeURIComponent($path.id || ''); // id in path (1st parameter).
        const METHOD = (!ID && event.httpMethod === 'GET' && 'LIST') || event.httpMethod || ''; // determine method.
        const CMD = decodeURIComponent($path.cmd || event.action || ''); // cmd in path (2nd parameter).

        //! decoding mode. ('!' means internal event handler not of http)
        const MODE =
            (METHOD && METHOD_MODE_MAP[METHOD]) ||
            (event.Records ? 'EVENT' : event.Sns ? 'SNS' : event.userPoolId ? '!COGNITO' : 'CALL');
        MODE.startsWith('!') && _log(NS, `! event[${MODE}] =`, event);
        MODE.startsWith('!') && _log(NS, `! context[${MODE}] =`, context);
        //! safe decode body if it has json format. (TODO - support url-encoded post body)
        const $body =
            (event.body &&
                (typeof event.body === 'string' && (event.body.startsWith('{') || event.body.startsWith('['))
                    ? JSON.parse(event.body)
                    : event.body)) ||
            (event.Records && { records: event.Records }) || // from dynamodb stream/sns/sqs.
            (event.userPoolId && event) || //! use event as body if cognito
            null;
        //! debug print body.
        if (!$body) {
            _log(NS, `#${MODE}:${CMD} (${METHOD}, ${TYPE}/${ID})....`);
        } else {
            _log(NS, `#${MODE}:${CMD} (${METHOD}, ${TYPE}/${ID}).... body.len=`, $body ? $U.json($body).length : -1);
        }

        //! prepare chain object.
        const that = {
            _id: ID,
            _mode: MODE,
            _cmd: CMD,
            _param: $param,
            _body: $body,
            _event: event,
            _ctx: context,
            _context: context, // save origin context out of _ctx.
            _next: null as NextHanlder,
        };
        that._ctx = (event && event.requestContext) || that._ctx || {}; // 180622 Override Context with event.requestContext.
        that._next = decode_next_handler(MODE, ID, CMD); // 190314 Save next-function.

        //! identity 정보를 얻음.
        //  - http 호출시 해더에 x-lemon-identity = '{"ns": "SS", "sid": "SS000002", "uid": "", "gid": "", "role": "guest"}'
        //  - lambda 호출시 requestContext.identity = {"ns": "SS", "sid": "SS000002", "uid": "", "gid": "", "role": "guest"}
        // _log(NS,'headers['+HEADER_LEMON_IDENTITY+']=', event.headers[HEADER_LEMON_IDENTITY]);
        const identity = (val => {
            try {
                if (!val) return undefined;
                return typeof val === 'string' && (val.startsWith('{') || val.endsWith('}')) ? JSON.parse(val) : val;
            } catch (e) {
                _err(NS, '!WARN! parse identity. err=', e);
                return undefined;
            }
        })((event.headers && event.headers[HEADER_LEMON_IDENTITY]) || that._ctx.identity || '');
        if (identity && !identity.cognitoIdentityPoolId) _inf(NS, '! identity :=', JSON.stringify(identity));
        that._ctx.identity = identity;

        //! do the promised task chain.
        asyncDoNext(that, callback);
    };

    //! 190314 - refactoring next handler function.
    const asyncDoNext = async (that: any, callback: NextCallback<WebResult>) => {
        //! decode parameter.
        const ID = that._id;
        const MODE = that._mode || '';
        const CMD = that._cmd || '';
        const $param = that._param;
        const $body = that._body;
        const $ctx = that._ctx;
        const context = that._context; // original context.
        const $event = that._event; // original event.
        const next = that._next;
        // if (!next) return Promise.reject(new Error(`404 NOT FOUND - mode:${MODE}${CMD ? `, cmd:${CMD}` : ''}`));
        if (!next) return callback(null, notfound(`404 NOT FOUND - mode:${MODE}${CMD ? `, cmd:${CMD}` : ''}`));

        //! call next.. (it will return result or promised)
        return (() => {
            try {
                const R = next(ID, $param, $body, $ctx);
                return R instanceof Promise ? R : Promise.resolve(R);
            } catch (e) {
                return Promise.reject(e);
            }
        })()
            .then(_ => {
                //! '!' means internal event handler not of http
                if (MODE.startsWith('!')) {
                    return ((context && context.done) || callback)(null, _);
                }
                if (_ && typeof _ === 'object') _ = $U.cleanup(_);
                callback(null, success(_));
                return true;
            })
            .catch(e => {
                //! '!' means internal event handler not of http
                if (MODE.startsWith('!')) {
                    _err(NS, '!!! callback err=', e);
                    return doReportError(e, context, $event).then(() => {
                        return ((context && context.done) || callback)(e, $event);
                    });
                }
                const message = `${e.message || e.reason || e}`;
                if (message.indexOf('404 NOT FOUND') >= 0) {
                    callback(null, notfound(message));
                } else {
                    _err(NS, '!!! callback err=', e);
                    //! report error via `lemon-hello-sns`.
                    // _inf(NS, '! context =', $U.json($ctx));
                    return doReportError(e, context, $event).then(() => {
                        callback(null, failure(e.message || e));
                        return false;
                    });
                }
                return false;
            });
    };

    //! returns main handler.
    return main;
};

//! default export.
export default builder;
