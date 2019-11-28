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

import { NextDecoder, NextHandler, NextContext, NextMode } from './core-types';
import { APIGatewayProxyResult, APIGatewayEventRequestContext } from 'aws-lambda';
import $lambda, { LambdaHandler, WEBHandler, LambdaHandlerService, Context } from './lambda-handler';
import $protocol from './protocol-service';

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

export const failure = (body: any, status?: number) => {
    return buildResponse(status === undefined ? 503 : status, body);
};

/** ********************************************************************************************************************
 *  COMMON Constants
 ** ********************************************************************************************************************/
interface ModeMap {
    [key: string]: NextMode;
}
//! constants config
const HEADER_LEMON_IDENTITY = 'x-lemon-identity';
const METHOD_MODE_MAP: ModeMap = {
    LIST: 'LIST',
    GET: 'GET',
    PUT: 'PUT',
    POST: 'POST',
    DELETE: 'DELETE',
};

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

    /**
     * add web-handlers by `NextDecoder`.
     *
     * @param type      type of WEB(API)
     * @param decoder   next decorder
     */
    public setHandler(type: string, decoder: NextDecoder) {
        this._handlers[type] = decoder;
    }

    /**
     * get all decoders.
     */
    public getHandlerDecoders(): { [key: string]: NextDecoder } {
        //! copy
        return { ...this._handlers };
    }

    /**
     * Default SQS Handler.
     */
    public handle: WEBHandler = async (event, context) => {
        // const _log = console.log;
        // const _err = console.error;
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
        const MODE = METHOD ? METHOD_MODE_MAP[METHOD] : 'GET';

        //! safe decode body if it has json format. (TODO - support url-encoded post body)
        const $body =
            (event.body &&
                (typeof event.body === 'string' && event.body.startsWith('{') && event.body.endsWith('}')
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
                _err(NS, `! ${MODE}[/${TYPE}/${ID}/${CMD}].err =`, typeof e, e);
                const message = `${e.message || e.reason || $U.json(e)}`;
                _err(NS, `! ${MODE}[/${TYPE}/${ID}/${CMD}].msg =`, message);
                if (message.startsWith('404 NOT FOUND')) {
                    return notfound(message);
                }
                //! report error.
                if (LambdaHandler.REPORT_ERROR) {
                    return doReportError(e, context, event).then(() => {
                        return failure(e instanceof Error ? message : e);
                    });
                }
                //! common format of error.
                if (typeof message == 'string' && /^[1-9][0-9]{2} [A-Z ]+/.test(message)) {
                    const status = $U.N(message.substring(0, 3), 0);
                    return failure(message, status);
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

        const headers = event.headers || {};

        const res: NextContext = { identity: null };
        //TODO - support cognito authentication.
        //TODO - support internal JWT Token authentication.

        // STEP.1 support lambda call JWT Token authentication.
        //! if it is protocol request via lambda, then returns valid context.
        if (headers['x-protocol-context']) {
            const $param = $protocol.web.transformToParam(event);
            return $param.context;
        }

        // STEP.3 use internal identity json data via python lambda call.
        //! `x-lemon-identity` 정보로부터, 계정 정보를 얻음 (for direct call via lambda)
        //  - http 호출시 해더에 x-lemon-identity = '{"ns": "SS", "sid": "SS000002", "uid": "", "gid": "", "role": "guest"}'
        //  - lambda 호출시 requestContext.identity = {"ns": "SS", "sid": "SS000002", "uid": "", "gid": "", "role": "guest"}
        // _log(NS,'headers['+HEADER_LEMON_IDENTITY+']=', event.headers[HEADER_LEMON_IDENTITY]);
        const identity = (val => {
            try {
                if (!val) return undefined;
                return typeof val === 'string' && val.startsWith('{') && val.endsWith('}') ? JSON.parse(val) : val;
            } catch (e) {
                _err(NS, '!WARN! parse identity. err=', e);
                return undefined;
            }
        })(headers[HEADER_LEMON_IDENTITY] || ($ctx && $ctx.identity) || '');
        if (identity && !identity.cognitoIdentityPoolId) _inf(NS, '! identity :=', JSON.stringify(identity));

        //TODO - build initial source information like protocol-url of self.
        const service = 'lemon-core';
        const version = '0.0.0';
        const stage = $ctx.stage || '';
        const source = `web://${$ctx.accountId}@${service}-${stage}/${event.path}#${version}`;
        const requestId = $ctx.requestId;
        const accountId = $ctx.accountId;

        //! retruns
        return { ...res, identity, source, requestId, accountId };
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
