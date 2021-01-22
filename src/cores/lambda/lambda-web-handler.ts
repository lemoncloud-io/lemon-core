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
import { _log, _inf, _err, $U, $_, doReportError } from '../../engine/';
import {
    NextDecoder,
    NextHandler,
    NextContext,
    NextMode,
    NextIdentityCognito,
    ProtocolParam,
} from './../core-services';
import { APIGatewayProxyResult, APIGatewayEventRequestContext, APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaHandler, WEBHandler, Context, LambdaSubHandler, WEBEvent } from './lambda-handler';
import { loadJsonSync } from '../../tools/shared';
import { GETERR } from '../../common/test-helper';
import $protocol from '../protocol/';
const NS = $U.NS('HWEB', 'yellow'); // NAMESPACE TO BE PRINTED.

//! header names..
const HEADER_LEMON_LANGUAGE = $U.env('HEADER_LEMON_LANGUAGE', 'x-lemon-language');
const HEADER_LEMON_IDENTITY = $U.env('HEADER_LEMON_IDENTITY', 'x-lemon-identity');
const HEADER_COOKIE = 'cookie';
const FAVICON_ICO =
    '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';

/**
 * class: `WEBController`
 * - common controller interface.
 */
export interface CoreWEBController {
    hello(): string;
    type(): string;
    decode: NextDecoder;
}

interface ProxyParams {
    param: ProtocolParam;
    event: WEBEvent;
}

type ProxyResult = APIGatewayProxyResult;
type ProxyResponser = () => ProxyResult;
type ProxyChain = ProxyParams | ProxyResponser;

/** ********************************************************************************************************************
 *  COMMON Functions.
 ** ********************************************************************************************************************/
export const buildResponse = (statusCode: number, body: any, contentType?: string, origin?: string): ProxyResult => {
    const isBase64Encoded = contentType && !contentType.startsWith('text/') ? true : false;
    contentType =
        contentType ||
        (typeof body === 'string'
            ? body.startsWith('<') && body.endsWith('>')
                ? 'text/html; charset=utf-8'
                : 'text/plain; charset=utf-8'
            : 'application/json; charset=utf-8');
    // @0612 - body 가 string일 경우, 응답형식을 텍스트로 바꿔서 출력한다.
    return {
        statusCode,
        headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': `${origin || '*'}`, // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
            'Access-Control-Allow-Headers': `origin, ${HEADER_LEMON_LANGUAGE}`, // custom headers
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        isBase64Encoded,
    };
};

export const success = (body: any, contentType?: string, origin?: string) => {
    return buildResponse(200, body, contentType, origin);
};

export const notfound = (body: any) => {
    return buildResponse(404, body);
};

export const failure = (body: any, status?: number) => {
    return buildResponse(status || 503, body);
};

export const redirect = (location: any, status?: number) => {
    const res = buildResponse(status || 302, '');
    res.headers['Location'] = location; // set location.
    return res;
};

/**
 * start proxy-chain by event & context.
 * @param event     event
 * @param $ctx      context
 */
export const promised = async (event: WEBEvent, $ctx: NextContext): Promise<ProxyChain> => {
    // TO SERVE BINARY. `$ npm i -S serverless-apigw-binary serverless-apigwy-binary`. refer 'https://read.acloud.guru/serverless-image-optimization-and-delivery-510b6c311fe5'
    if (event && event.httpMethod == 'GET' && event.path == '/favicon.ico') {
        return () => success(FAVICON_ICO, 'image/x-icon');
    }

    //! transform to protocol-context.
    if (event && event.headers && !event.headers['x-protocol-context'])
        event.headers['x-protocol-context'] = $ctx ? $U.json($ctx) : null;
    const param: ProtocolParam = $protocol.service.asTransformer('web').transformToParam(event);
    _log(NS, '! protocol-param =', $U.json(param));

    //! returns object..
    return { event, param };
};

/**
 * builder for default handler
 */
export const mxNextHandler = (thiz: LambdaWEBHandler) => async (params: ProxyChain): Promise<ProxyResult> => {
    //! determine if param or func.
    const fx: ProxyResponser = typeof params == 'function' ? params : null;
    const $param: ProxyParams = params && typeof params == 'object' ? params : null;
    const { param, event } = $param || {};

    //! call the main handler()
    const R = $param ? await thiz.handleProtocol(param, event) : fx;

    //! - if like to override the full response, then return function.
    if (R && typeof R == 'function') return R();

    //! - override `Access-Control-Allow-Origin` to the current origin due to ajax credentials.
    const { httpMethod: method, headers } = event || {};
    if (method && method != 'GET') {
        const origin = `${(headers && headers['origin']) || ''}`;
        return success(R, null, origin);
    }

    //! returns response..
    return success(R);
};

/**
 * builder for failure promised.
 */
export const mxNextFailure = (event: WEBEvent, $ctx: NextContext) => (e: any) => {
    _err(NS, `! err =`, e instanceof Error ? e : $U.json(e));
    const message = `${e.message || e.reason || $U.json(e)}`;
    if (message.startsWith('404 NOT FOUND')) return notfound(message);
    _err(NS, `! err.msg =`, message);

    //! common format of error.
    if (typeof message == 'string' && /^[1-9][0-9]{2} [A-Z ]+/.test(message)) {
        const status = $U.N(message.substring(0, 3), 0);
        //! handle for 302/301 redirect. format: 303 REDIRECT - http://~~~
        if ((status == 301 || status == 302) && message.indexOf(' - ') > 0) {
            const loc = message.substring(message.indexOf(' - ') + 3).trim();
            if (loc) return redirect(loc, status);
        }
        //! handle for `400 SIGNATURE - fail to verify!`. ignore report-error.
        if (status == 400 && message.startsWith('400 SIGNATURE')) {
            return failure(message, status);
        }

        //! report error and returns
        if (LambdaHandler.REPORT_ERROR) doReportError(e, $ctx, event).catch(GETERR);
        return failure(message, status);
    } else if (typeof message == 'string' && /^\.[a-zA-Z0-9_\-]+/.test(message)) {
        //! handle for message `.name () is required!`
        //! report error and returns
        if (LambdaHandler.REPORT_ERROR) doReportError(e, $ctx, event).catch(GETERR);
        return failure(message, 400);
    } else if (typeof message == 'string' && /^\@[a-zA-Z0-9_\-]+/.test(message)) {
        //! handle for message `@name () is required!`
        //! report error and returns
        if (LambdaHandler.REPORT_ERROR) doReportError(e, $ctx, event).catch(GETERR);
        return failure(message, 400);
    }

    //! report error and returns
    if (LambdaHandler.REPORT_ERROR) doReportError(e, $ctx, event).catch(GETERR);
    return failure(e instanceof Error ? message : e);
};

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
        // _log(NS, `LambdaWEBHandler()..`);
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
        //! inspect API parameters.
        _log(NS, `handle()....`);
        const $path = event.pathParameters || {};
        const $param = event.queryStringParameters || {};
        _log(NS, '! path =', event.path);
        _log(NS, '! $path =', $U.json($path));
        _log(NS, '! $param =', $U.json($param));

        //! start promised..
        return promised(event, $ctx)
            .then(mxNextHandler(this))
            .catch(mxNextFailure(event, $ctx));
    };

    /**
     * handle param via protocol-service.
     *
     * @param param protocol parameters
     * @param event (optional) origin event object.
     */
    public async handleProtocol<TResult = any>(param: ProtocolParam, event?: APIGatewayProxyEvent): Promise<TResult> {
        if (!param) throw new Error(`@param (protocol-param) is required!`);
        const TYPE = `${param.type || ''}`;
        const MODE: NextMode = `${param.mode || 'GET'}` as NextMode;
        const ID = `${param.id || ''}`;
        const CMD = `${param.cmd || ''}`;
        const PATH = `${(event && event.path) || ''}`;
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
                    const modules = [`${name}/${version}`];
                    //! shows version of `lemon-core` via `dependencies`.
                    const coreVer = $pack && $pack.dependencies && $pack.dependencies['lemon-core'];
                    if (coreVer) modules.push(`lemon-core/${coreVer.startsWith('^') ? coreVer.substring(1) : coreVer}`);
                    return modules.join('\n');
                };
            }

            //! error if no decoder.
            if (!decoder) return null;

            //! use decoder() to find target.
            if (typeof decoder == 'function') return (decoder as NextDecoder)(MODE, ID, CMD, PATH);
            else if (typeof decoder == 'object') {
                const func = (decoder as CoreWEBController).decode(MODE, ID, CMD, PATH);
                if (!func) return null; // avoid 'null' error.
                const next: NextHandler = (i, p, b, c) => func.call(decoder, i, p, b, c);
                return next;
            }
            return null;
        })(this._handlers[TYPE]);

        //! if no next, then report error.
        if (!next || typeof next != 'function') {
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
     * @param $ctx      (optional) referenced lambda.Context
     */
    public async packContext(event: APIGatewayProxyEvent, $ctx: Context): Promise<NextContext> {
        //! prepare chain object.
        const reqContext: APIGatewayEventRequestContext = event && event.requestContext;
        if (!event) return null;
        _log(NS, `packContext()..`);
        _log(NS, `> reqContext=`, $U.S(reqContext, 256, 32));
        _log(NS, `> orgContext=`, $U.S($ctx, 256, 32));

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
        const _identity = async (val: string): Promise<NextIdentityCognito> => {
            val = `${val || ''}`.trim();
            try {
                if (val && val.startsWith('{') && val.endsWith('}')) return JSON.parse(val);
                _err(NS, '!WARN! identity =', val);
            } catch (e) {
                _err(NS, '!WARN! parse.err =', e);
                _err(NS, '!WARN! identity =', val);
            }
            // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
            const ret: any = val ? { meta: val } : {};
            return ret as NextIdentityCognito;
        };
        const identity: NextIdentityCognito = await _identity(headers[HEADER_LEMON_IDENTITY]);

        //! support prefered lanauge.
        if (headers[HEADER_LEMON_LANGUAGE]) identity.lang = `${headers[HEADER_LEMON_LANGUAGE]}`.trim();

        //! support cookie (string) to .cookie (object)
        const cookie = ((cookie: string): { [key: string]: string } => {
            cookie = `${cookie || ''}`.trim();
            if (!cookie) return undefined;
            const parseCookies = (str: string) => {
                let rx = /([^;=\s]*)=([^;]*)/g;
                let obj: { [key: string]: string } = {};
                for (let m; (m = rx.exec(str)); ) obj[m[1]] = decodeURIComponent(m[2]);
                return obj;
            };
            return parseCookies(cookie);
        })(headers[HEADER_COOKIE]);

        //! translate cognito authentication to NextIdentity.
        if (reqContext.identity && reqContext.identity.cognitoIdentityPoolId !== undefined) {
            const $id = reqContext.identity;
            _inf(NS, '! identity :=', $U.json(identity));
            identity.identityProvider = $id.cognitoAuthenticationProvider;
            identity.identityPoolId = $id.cognitoIdentityPoolId; // identity-pool-id like 'ap-northeast-2:618ce9d2-3ad6-49df-b3b3-e248ea51425e'
            identity.identityId = $id.cognitoIdentityId; // identity-id like 'ap-northeast-2:dbd95fb4-7423-48b8-8a04-56e5bc95e444'
            identity.accountId = $id.accountId; // account-id should be same as context.accountId
            identity.userAgent = $id.userAgent; // user-agent string.
            //TODO - transform to access identity via `lemon-accounts-api` service @200106
        }

        //! - extract original request infor.
        const clientIp = `${(reqContext.identity && reqContext.identity.sourceIp) || ''}`;
        const userAgent = `${(reqContext.identity && reqContext.identity.userAgent) || ''}`;
        const requestId = `${reqContext.requestId || ''}`;
        const accountId = `${reqContext.accountId || ''}`;
        const domain = `${reqContext.domainName || headers['Host'] || headers['host'] || ''}`; //! chore avoid null of headers

        //! save into headers and returns.
        const context: NextContext = { ...res, identity, userAgent, clientIp, requestId, accountId, domain, cookie };
        context.source = $protocol.service.myProtocolURI(context); // self service-uri as source
        return context;
    }
}
