/**
 * `lambda-web-handler.ts`
 * - lambda handler to process WEB(API) event.
 * - replace the legacy web-builder `WEB.ts`
 *
 *
 * ```js
 * const a = '';
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('HWEB', 'yellow'); // NAMESPACE TO BE PRINTED.
import { doReportError } from '../engine/';

import { NextDecoder, NextHandler, NextContext } from './core-types';
import { APIGatewayProxyResult, APIGatewayEventRequestContext } from 'aws-lambda';
import $lambda, { LambdaHandler, WEBHandler, LambdaHandlerService, Context } from './lambda-handler';

/** ********************************************************************************************************************
 *  COMMON Functions.
 ** ********************************************************************************************************************/
export const buildResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
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
 *  COMMON Constants
 ** ********************************************************************************************************************/
interface ModeMap {
    [key: string]: string;
}
//! constants config
const HEADER_LEMON_IDENTITY = 'x-lemon-identity';
const METHOD_MODE_MAP: ModeMap = 'LIST,GET,PUT,POST,DELETE'.split(',').reduce((N: ModeMap, K) => {
    N[K] = K;
    return N;
}, {});

/** ********************************************************************************************************************
 *  Main Class
 ** ********************************************************************************************************************/
/**
 * class: LambdaWEBHandler
 * - default WEB Handler w/ event-listeners.
 */
export class LambdaWEBHandler implements LambdaHandlerService<WEBHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    //! handlers map.
    private _handlers: { [key: string]: NextDecoder } = {};

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaWEBHandler()..`);
        if (register) {
            lambda.setHandler('web', this);
        }
    }

    public addHandler(type: string, decoder: NextDecoder) {
        this._handlers[type] = decoder;
    }

    /**
     * Default SQS Handler.
     */
    public handle: WEBHandler = async (event, context) => {
        //! API parameters.
        _log(NS, `handle()....`);
        // _log(NS, '! event =', $U.json(event));
        // _log(NS, '! headers =', $U.json(event.headers));
        const $path = event.pathParameters || {};
        const $param = event.queryStringParameters || {};
        _log(NS, '! path =', event.path);
        _log(NS, '! $path =', $U.json($path));
        _log(NS, '! $param =', $U.json($param));

        //! determine running mode.
        const TYPE = decodeURIComponent($path.type || `${event.path || ''}`.split('/')[1] || ''); // type in path (0st parameter).
        const ID = decodeURIComponent($path.id || ''); // {id} in path paramter.
        const METHOD = (!ID && event.httpMethod === 'GET' && 'LIST') || event.httpMethod || ''; // determine method.
        const CMD = decodeURIComponent($path.cmd || ''); // {cmd} in path paramter.
        const MODE = (METHOD && METHOD_MODE_MAP[METHOD]) || '';

        //! safe decode body if it has json format. (TODO - support url-encoded post body)
        const $body =
            (event.body &&
                (typeof event.body === 'string' && (event.body.startsWith('{') || event.body.startsWith('['))
                    ? JSON.parse(event.body)
                    : event.body)) ||
            null;
        //! debug print body.
        if (!$body) {
            _log(NS, `#${MODE}:${CMD} (${METHOD}, ${TYPE}/${ID})....`);
        } else {
            _log(NS, `#${MODE}:${CMD} (${METHOD}, ${TYPE}/${ID}).... body.len=`, $body ? $U.json($body).length : -1);
        }

        //! find target next function
        const decoder: NextDecoder = this._handlers[TYPE];
        const next: NextHandler = decoder && decoder(MODE, ID, CMD); // 190314 Save next-function.
        if (!next) return notfound(`404 NOT FOUND - ${MODE} /${TYPE}/${ID}${CMD ? `/${CMD}` : ''}`);

        //! call next.. (it will return result or promised)
        return (() => {
            try {
                const R = next(ID, $param, $body, context);
                return R instanceof Promise ? R : Promise.resolve(R);
            } catch (e) {
                return Promise.reject(e);
            }
        })()
            .then(_ => {
                return success(_);
            })
            .catch((e: any) => {
                _err(NS, `! err[${MODE} /${TYPE}/${ID}/${CMD}] =`, typeof e, e);
                const message = `${e.message || e.reason || $U.json(e)}`;
                if (message.startsWith('404 NOT FOUND')) {
                    return notfound(message);
                }
                //! report error.
                if (LambdaHandler.REPORT_ERROR) {
                    return doReportError(e, context, event).then(() => {
                        return failure(e instanceof Error ? message : e);
                    });
                }
                //! send failure.
                return failure(e instanceof Error ? message : e);
            });
    };

    /**
     * pack the request context for Http request.
     *
     * @param event
     * @param context
     */
    public async packContext(event: any, context: Context): Promise<NextContext> {
        //! prepare chain object.
        const $ctx: APIGatewayEventRequestContext = event && event.requestContext;
        if (!event) return null;
        _log(NS, `packContext()..`);

        //TODO - support cognito authentication.
        //TODO - support internal JWT Token authentication.
        //TODO - support lambda call JWT Token authentication.

        //! `x-lemon-identity` 정보로부터, 계정 정보를 얻음 (for direct call via lambda)
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
        })((event.headers && event.headers[HEADER_LEMON_IDENTITY]) || ($ctx && $ctx.identity) || '');
        if (identity && !identity.cognitoIdentityPoolId) _inf(NS, '! identity :=', JSON.stringify(identity));
        const source = $ctx.accountId;

        //! prepare next-context
        const res: NextContext = { identity, source };
        return res;
    }
}

/**
 * class: `LambdaWEBHandlerMain`
 * - default implementations.
 */
class LambdaWEBHandlerMain extends LambdaWEBHandler {
    public constructor() {
        super($lambda, true);
    }
}

//! create instance & export as default.
const $instance: LambdaWEBHandler = new LambdaWEBHandlerMain();
export default $instance;
