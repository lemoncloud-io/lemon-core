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
import { _log, _inf, _err, $U, $_ } from '../../engine/';
const NS = $U.NS('HWEB', 'yellow'); // NAMESPACE TO BE PRINTED.
import { doReportError } from '../../engine/';

import {
    NextDecoder,
    NextHandler,
    NextContext,
    NextMode,
    NextIdentityCognito,
    ProtocolParam,
    CoreConfigService,
} from './../core-services';
import { APIGatewayProxyResult, APIGatewayEventRequestContext, APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaHandler, WEBHandler, Context, LambdaSubHandler } from './lambda-handler';
import { loadJsonSync } from '../../tools/shared';
import $protocol from '../protocol/';

export type ConfigService = CoreConfigService;

/**
 * class: `WEBController`
 * - common controller interface.
 */
export interface CoreWEBController {
    hello(): string;
    type(): string;
    decode: NextDecoder;
}

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

export const redirect = (location: any, status?: number) => {
    const res = buildResponse(status === undefined ? 300 : status, '');
    res.headers['Location'] = location; // set location.
    return res;
};

/** ********************************************************************************************************************
 *  COMMON Constants
 ** ********************************************************************************************************************/
interface ModeMap {
    [key: string]: NextMode;
}
//! constants config
const HEADER_LEMON_IDENTITY = 'x-lemon-identity';

/** ********************************************************************************************************************
 *  Main Class
 ** ********************************************************************************************************************/
/**
 * class: LambdaWEBHandler
 * - default WEB Handler w/ event-listeners.
 */
export class LambdaWEBHandler extends LambdaSubHandler<WEBHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    //! handlers map.
    private _handlers: { [key: string]: NextDecoder | CoreWEBController } = {};

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'web' : undefined);
        _log(NS, `LambdaWEBHandler()..`);
    }

    /**
     * add web-handlers by `NextDecoder`.
     *
     * @param type      type of WEB(API)
     * @param decoder   next decorder
     */
    public setHandler(type: string, decoder: NextDecoder) {
        if (typeof type !== 'string') throw new Error(`@type (string) is required!`);
        this._handlers[type] = decoder;
    }

    /**
     * check if there is handler for type.
     * @param type      type of WEB(API)
     */
    public hasHandler(type: string): boolean {
        return typeof this._handlers[type] != 'undefined';
    }

    /**
     * registr web-controller.
     * @param controller the web-controller.
     */
    public addController(controller: CoreWEBController) {
        if (typeof controller !== 'object') throw new Error(`@controller (object) is required!`);
        const type = controller.type();
        _log(NS, `> web-controller[${type}] =`, controller.hello());
        this._handlers[type] = controller;
    }

    /**
     * get all decoders.
     */
    public getHandlerDecoders(): { [key: string]: NextDecoder } {
        //! copy
        // return { ...this._handlers };
        const map: any = $_.reduce(
            this._handlers,
            (M: any, val: any, key: string) => {
                if (typeof val == 'function') M[key] = val;
                else M[key] = (m: any, i: any, c: any) => (val as CoreWEBController).decode(m, i, c);
                return M;
            },
            {},
        );
        return map;
    }

    /**
     * Default WEB Handler.
     */
    public handle: WEBHandler = async (event, $ctx) => {
        //! API parameters.
        _log(NS, `handle()....`);
        // _log(NS, '! event =', $U.json(event));
        // _log(NS, '! headers =', $U.json(event.headers));
        const $path = event.pathParameters || {};
        const $param = event.queryStringParameters || {};
        _log(NS, '! path =', event.path);
        _log(NS, '! $path =', $U.json($path));
        _log(NS, '! $param =', $U.json($param));

        //! prevent error via transform.
        if (event.headers && !event.headers['x-protocol-context']) event.headers['x-protocol-context'] = $U.json($ctx);
        const param: ProtocolParam = $protocol.service.asTransformer('web').transformToParam(event);
        _log(NS, '! protocol-param =', $U.json(param));
        const TYPE = param.type;
        const MODE = param.mode;
        const ID = param.id;
        const CMD = param.cmd;

        //! call next.. (it will return result or promised)
        return this.handleProtocol(param, event)
            .then(_ => {
                return success(_);
            })
            .catch((e: any) => {
                _err(NS, `! ${MODE}[/${TYPE}/${ID}/${CMD}].err =`, e instanceof Error ? e : $U.json(e));
                const message = `${e.message || e.reason || $U.json(e)}`;
                _err(NS, `! ${MODE}[/${TYPE}/${ID}/${CMD}].msg =`, message);
                if (message.startsWith('404 NOT FOUND')) {
                    return notfound(message);
                }

                //! report error.
                if (LambdaHandler.REPORT_ERROR) {
                    return doReportError(e, $ctx, event).then(() => {
                        return failure(e instanceof Error ? message : e);
                    });
                }

                //! common format of error.
                if (typeof message == 'string' && /^[1-9][0-9]{2} [A-Z ]+/.test(message)) {
                    const status = $U.N(message.substring(0, 3), 0);
                    //! handle for 302/301 redirect. format: 303 REDIRECT - http://~~~
                    if ((status == 301 || status == 302) && message.indexOf(' - ') > 0) {
                        const loc = message.substring(message.indexOf(' - ') + 3).trim();
                        if (loc) return redirect(loc, status);
                    }
                    return failure(message, status);
                }

                //! send failure.
                return failure(e instanceof Error ? message : e);
            });
    };

    /**
     * handle param via protocol-service.
     *
     * @param param protocol parameters
     * @param event (optional) origin event object.
     */
    public async handleProtocol<TResult = any>(param: ProtocolParam, event?: APIGatewayProxyEvent): Promise<TResult> {
        const TYPE = `${param.type || ''}`;
        const MODE: NextMode = `${param.mode || 'GET'}` as NextMode;
        const ID = `${param.id || ''}`;
        const CMD = `${param.cmd || ''}`;
        const $param = param.param;
        const $body = param.body;
        const context = param.context;

        //! debug print body.
        if (!$body) {
            _log(NS, `#${MODE}:${CMD} (${TYPE}/${ID})....`);
        } else {
            _log(NS, `#${MODE}:${CMD} (${TYPE}/${ID}).... body.len=`, $body ? $U.json($body).length : -1);
        }

        //! find target next function
        // const decoder: NextDecoder | CoreWEBController = this._handlers[TYPE];
        const next: NextHandler<any, TResult, any> = ((decoder: any) => {
            //! as default handler '/', say the current version.
            if (MODE === 'LIST' && TYPE === '' && ID === '' && CMD === '') {
                return async () => {
                    const $pack = loadJsonSync('package.json');
                    const name = ($pack && $pack.name) || 'LEMON API';
                    const version = ($pack && $pack.version) || '0.0.0';
                    return `${name}/${version}`;
                };
            }

            //! error if no decoder.
            if (!decoder) return null;

            //! use decoder() to find target.
            if (typeof decoder == 'function') return decoder(MODE, ID, CMD);
            else if (typeof decoder == 'object') {
                const func = (decoder as CoreWEBController).decode(MODE, ID, CMD);
                if (!func) return null; // avoid 'null' error.
                const next: NextHandler = (i, p, b, c) => func.call(decoder, i, p, b, c);
                return next;
            }
            return null;
        })(this._handlers[TYPE]);

        //! if no next, then report error.
        if (!next) {
            _err(NS, `! WARN ! MISSING NEXT-HANDLER. event=`, $U.json(event));
            throw new Error(`404 NOT FOUND - ${MODE} /${TYPE}/${ID}${CMD ? `/${CMD}` : ''}`);
        }

        //! call next.. (it will return result or promised)
        return (() => {
            try {
                const R = next(ID, $param, $body, context);
                return R instanceof Promise ? R : Promise.resolve(R);
            } catch (e) {
                return Promise.reject(e);
            }
        })();
    }

    /**
     * pack the request context for Http request.
     *
     * @param event     origin Event.
     * @param $ctx      lambda.Context
     */
    public async packContext(event: APIGatewayProxyEvent, $ctx: Context): Promise<NextContext> {
        //! prepare chain object.
        const reqContext: APIGatewayEventRequestContext = event && event.requestContext;
        if (!event) return null;
        _log(NS, `packContext()..`);

        //! prepare the next-context.
        const res: NextContext = { identity: null };

        // STEP.1 support lambda call JWT Token authentication.
        //! if it is protocol request via lambda, then returns valid context.
        const headers = event.headers || {};
        if (headers['x-protocol-context']) {
            const $param = $protocol.service.asTransformer('web').transformToParam(event);
            return $param.context;
        }

        //TODO - support internal JWT Token authentication.

        // STEP.3 use internal identity json data via python lambda call.
        //! `x-lemon-identity` 정보로부터, 계정 정보를 얻음 (for direct call via lambda)
        //  - http 호출시 해더에 x-lemon-identity = '{"ns": "SS", "sid": "SS000002", "uid": "", "gid": "", "role": "guest"}'
        //  - lambda 호출시 requestContext.identity = {"ns": "SS", "sid": "SS000002", "uid": "", "gid": "", "role": "guest"}
        // _log(NS,'headers['+HEADER_LEMON_IDENTITY+']=', event.headers[HEADER_LEMON_IDENTITY]);
        const identity: NextIdentityCognito = await (async val => {
            if (!val) return {};
            return typeof val === 'string' && val.startsWith('{') && val.endsWith('}')
                ? JSON.parse(val)
                : { name: val };
        })(headers[HEADER_LEMON_IDENTITY] || '').catch(e => {
            _err(NS, '!WARN! parse.err =', e);
            return {};
        });

        //TODO - translate cognito authentication to NextIdentity
        if (reqContext.identity && !reqContext.identity.cognitoIdentityPoolId) {
            const $id = reqContext.identity;
            _inf(NS, '! identity.cognito :=', JSON.stringify(identity));
            identity.cognitoId = $id.cognitoIdentityId;
            identity.accountId = $id.accountId;
            identity.cognitoPoolId = $id.cognitoIdentityPoolId;
        }

        //! - extract original request infor.
        const clientIp = reqContext.identity && reqContext.identity.sourceIp;
        const requestId = reqContext.requestId;
        const accountId = reqContext.accountId;
        const domain = reqContext.domainName || event.headers['Host'] || event.headers['host'];

        //! save into headers and returns.
        const context: NextContext = { ...res, identity, clientIp, requestId, accountId, domain };
        context.source = $protocol.service.myProtocolURI(context); // self service-uri as source
        return context;
    }
}
