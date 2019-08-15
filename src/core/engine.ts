/**
 * `core/engine.ts`
 * - shared core engine's export.
 *
 * **NOTE**
 * - override `process.env` before use(or import) this.
 *
 * ```js
 * //! import core engine like this.
 * import { $engine, _log, _inf, _err, $U, $_ } from '../core/engine';
 * const NS = $U.NS(name, 'yellow');
 * _inf(NS, `! model[${name}] is ready..`);
 * ```
 *
 * @author steve@lemoncloud.io
 * @date   2019-05-24 initial version in `lemon-todaq-api`.
 * @date   2019-08-01 support `loadJsonSync()` + move common functions + export core services + '$web'
 * @date   2019-08-02 improved type helper with `lemon-engine#2.2.0` + fix $client() error.
 * @date   2019-08-06 improved type helper with `lemon-engine#2.2.3`
 * @date   2019-08-08 improved `$api().do(event, context, callback)`.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//! import core engine.
import engine, { LemonEngine } from 'lemon-engine';
import { WebHandler, WebResult } from '../common/types';

//! create engine in global scope.
console.log(`###### load engine. STAGE=${process.env.NAME || ''}#${process.env.STAGE || ''}`);
export const $engine: LemonEngine = engine(global, { env: process.env });
console.log(`====== done engine. STAGE=${process.env.NAME || ''}#${process.env.STAGE || ''}`);

//! re-use core modules.
export const $U = $engine.U;
export const $_ = $engine._;
if (!$U) throw new Error('$U(utilities) is required!');
if (!$_) throw new Error('$_(lodash) is required!');

//! export common(log) functions
export const _log = $engine.log;
export const _inf = $engine.inf;
export const _err = $engine.err;

/** ****************************************************************************************************************
 *  Lookup API services.
 ** ****************************************************************************************************************/
//! get WebHandler by type(= name).
//! throw error not success.
export const $api = (type: string): WebHandler => {
    const API: WebHandler = $engine(type) || ((x: any) => x[type])($engine);
    if (!API) throw new Error(`404 NOT FOUND - API.type:${type}`);
    //! attach do() function.
    API.do = async (event: any, context: any): Promise<any> =>
        new Promise((resolve, reject) => {
            API(event, context, (err, res) => {
                err && reject(err);
                !err && resolve(res);
            });
        }).then((res: WebResult) => {
            const statusCode = res.statusCode || 200;
            if (statusCode !== 200) return Promise.reject(new Error(`${statusCode} - ${res.body}`));
            const body =
                typeof res.body === 'string' && (res.body.startsWith('{') && res.body.endsWith('}'))
                    ? JSON.parse(res.body)
                    : res.body;
            return body;
        });
    //! returns finally.
    return API;
};

//! report error via `lemon-hello-sns`.
export const doReportError = async (e: Error, ctx: any, data: any): Promise<string> => {
    //! ignore only if local express-run.
    if (ctx && ctx.source === 'express') return '!ignore';
    const NS = $U.NS('RPTE');
    _log(NS, `doReportError(${(e && e.message) || e})...`);

    //! find ARN('lemon-hello-sns') via context information.
    const TARGET = 'lemon-hello-sns';
    const helloArn = () => {
        const invokedFunctionArn = (ctx && ctx.invokedFunctionArn) || ''; // if called via lambda call.
        const accountId = (invokedFunctionArn && invokedFunctionArn.split(':')[4]) || (ctx && ctx.accountId) || '';
        const REGION = (invokedFunctionArn && invokedFunctionArn.split(':')[3]) || `ap-northeast-2`; //TODO - detecting region.
        _inf(NS, '! accountId =', accountId);
        if (!accountId) {
            _err(NS, 'WARN! account-id is empty.');
            _inf(NS, '! current ctx =', ctx);
            throw new Error('.accountId is missing');
        }
        return `arn:aws:sns:${REGION}:${accountId}:${TARGET}`;
    };

    //! dispatch invoke conditins.
    try {
        const stage = (ctx && ctx.stage) || '';
        const apiId = (ctx && ctx.apiId) || '';
        const domainPrefix = (ctx && ctx.domainPrefix) || '';
        const resourcePath = (ctx && ctx.resourcePath) || '';
        const identity = (ctx && ctx.identity) || {};

        //! load `sns-service` with log-silence.
        process.env['LS'] = '1';
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const $engine = require('lemon-hello-api').engine(); // require `lemon-hello-api:>1.3.1'
        const $sns = $engine.$sns;
        _log(NS, '! $sns =', $sns);
        if (!$sns) throw new Error(`.$sns(sns-service) is required! - need 'lemon-hello-api:>1.3.1'`);

        //! prepare payload to publish.
        const payload = {
            message: `${e.message}`,
            context: { stage, apiId, resourcePath, identity, domainPrefix, event: data },
        };

        //! update arn, and call.
        const arn = helloArn();
        _log(NS, `> sns[${TARGET}].arn =`, arn);
        return $sns.arn(arn).then(() => {
            return $sns.reportError(e, payload).then((mid: string) => {
                _inf(NS, '> sns.message-id =', mid);
                return `${mid}`;
            });
        });
    } catch (e2) {
        _err(NS, '! err-ignored =', e2);
        return `!err - ${e2.message || e2}`;
    }
};

//! chain for HTTP type.
export interface ApiParam {
    method: string;
    type?: string;
    id?: string;
    NS?: string;
    cmd?: string;
    headers?: { [key: string]: string };
    param?: { [key: string]: any };
    body?: { [key: string]: any };
    context?: any;
    requestContext?: any;
    callback?: string;
}
//! execute target API registered in $engine.
export const executeServiceApi = (args: ApiParam): Promise<any> => {
    const NS = args.NS || $U.NS('API', 'yellow');
    const method = args.method || '';
    const type = args.type || '';
    const id = args.id || '';
    const cmd = args.cmd || '';
    const param = args.param;
    const body = args.body;
    const headers = args.headers;
    const context = args.context;
    const requestContext = args.requestContext;
    const callback = args.callback || '';

    //! extract parameters....
    const TYPE = `${type}`;
    const METHOD = `${method || 'get'}`.toUpperCase();
    _log(NS, `executeServiceApi(${METHOD}, ${TYPE}, ${id}, ${cmd})...`);

    //! transform to APIGatewayEvent;
    const event = {
        httpMethod: METHOD,
        path: cmd ? `/${id}/${cmd}` : id !== undefined ? `/${id}` : `/`,
        headers: headers || {},
        pathParameters: { id, cmd },
        queryStringParameters: param,
        body: body,
        isBase64Encoded: false,
        stageVariables: null as any,
        requestContext: requestContext,
        resource: '',
    };

    //! execute web-handler. then call callback if required.
    return $api(TYPE)
        .do(event, context)
        .then((body: WebResult) => {
            if (!callback) return body; // ignore
            //! filtering via remote web-hook!.
            return $protocol()
                .do_post_execute(callback, body)
                .then((_: any) => {
                    _log(NS, `! CALLBACK[${callback}] =`, typeof _, $U.json(_));
                    return _;
                })
                .catch((e: any) => {
                    _err(NS, `! ERR@CALLBACK[${callback}] =`, e);
                    //NOTE! - report error in here.
                    return doReportError(e, context, { callback, body }).then(() => Promise.reject(e));
                });
        });
};

/** ****************************************************************************************************************
 *  Shared Core Services via `lemon-engine` + `backbone`
 ** ****************************************************************************************************************/
import { MysqlProxy, DynamoProxy, RedisProxy, Elastic6Proxy } from 'lemon-engine';
import { HttpProxy, WebProxy, S3Proxy, SQSProxy, SNSProxy, SESProxy } from 'lemon-engine';
import { CognitoProxy, LambdaProxy, ProtocolProxy, CronProxy, AGWProxy } from 'lemon-engine';

export const $mysql = (): MysqlProxy => {
    if (!$engine('MS')) throw new Error('$MS(mysql-service) is required!');
    return $engine('MS');
};

export const $dynamo = (): DynamoProxy => {
    if (!$engine('DS')) throw new Error('$DS(dynamo-service) is required!');
    return $engine('DS');
};

export const $redis = (): RedisProxy => {
    if (!$engine('RS')) throw new Error('$RS(redis-service) is required!');
    return $engine('RS');
};

export const $elasti6 = (): Elastic6Proxy => {
    if (!$engine('ES6')) throw new Error('$ES(elastic6-service) is required!');
    return $engine('ES6');
};

export const $protocol = (): ProtocolProxy => {
    if (!$engine('PR')) throw new Error('$PR(protocol-service) is required!');
    return $engine('PR');
};

export const $cognito = (): CognitoProxy => {
    if (!$engine('CS')) throw new Error('$CS(cognito-service) is required.');
    return $engine('CS');
};

export const $sns = (): SNSProxy => {
    if (!$engine('SN')) throw new Error('$SN(sns-service) is required!');
    return $engine('SN');
};

export const $sqs = (): SQSProxy => {
    if (!$engine('SS')) throw new Error('$SS(sqs-service) is required!');
    return $engine('SS');
};

export const $ses = (): SESProxy => {
    if (!$engine('SE')) throw new Error('$SE(ses-service) is required!');
    return $engine('SE');
};

export const $s3 = (): S3Proxy => {
    if (!$engine('S3')) throw new Error('$S3(s3-service) is required!');
    return $engine('S3');
};

export const $lambda = (): LambdaProxy => {
    if (!$engine('LS')) throw new Error('$LS(lambda-service) is required!');
    return $engine('LS');
};

export const $cron = (): CronProxy => {
    if (!$engine('CR')) throw new Error('$CR(cron-service) is required!');
    return $engine('CR');
};

export const $agw = (isNullable?: boolean): AGWProxy => {
    if (!isNullable && !$engine('AG')) throw new Error('$AG(api-gateway-service) is required!');
    return $engine('AG');
};

export const $web = (): WebProxy => {
    if (!$engine('WS')) throw new Error('$WS(web-service) is required!');
    return $engine('WS');
};

/** ****************************************************************************************************************
 *  Proxy Agent Builder
 ** ****************************************************************************************************************/
export interface APIEndpoint extends HttpProxy {
    doGet(id: string, cmd?: string, $param?: any, $body?: any): Promise<any>;
    doPut(id: string, cmd?: string, $param?: any, $body?: any): Promise<any>;
    doPost(id: string, cmd?: string, $param?: any, $body?: any): Promise<any>;
    doPatch(id: string, cmd?: string, $param?: any, $body?: any): Promise<any>;
    doDelete(id: string, cmd?: string, $param?: any, $body?: any): Promise<any>;
}

/**
 * build http-proxy client by name + endpoint.
 *
 * ```js
 * //! build proxy agent.
 * const $proxy = () => $client(NAME, 'BOT_PROXY_API'); // by env[BOT_PROXY_API]
 * const $proxy = () => $client(NAME, 'http://domain'); // by arg.
 *
 * //! make call.
 * export const do_read_task = (ID, $param, $body, $ctx) => $proxy().doGet(ID, undefined, $param, $body, $ctx);
 * ```
 *
 * @param NAME
 * @param PROXY_ENDPOINT
 */
export const $client = (NAME: string, PROXY_ENDPOINT: string, headers?: { [key: string]: any }): APIEndpoint => {
    const name = 'X' + NAME; // service name.
    const $svc: APIEndpoint = $engine(name, null as APIEndpoint);
    if ($svc) return $svc;

    //! make instance.
    const PROXY = { type: '', host: '', endpoint: '' };
    const createHttpProxy = $engine.createHttpProxy;
    if (!createHttpProxy) throw new Error('$engine.createHttpProxy() is required!');

    //! load endpoint via argument or via environ.
    const ENDPOINT =
        PROXY_ENDPOINT.startsWith('http://') || PROXY_ENDPOINT.startsWith('https://')
            ? PROXY_ENDPOINT
            : $U.env(PROXY_ENDPOINT);
    if (!ENDPOINT) throw new Error(`env:${PROXY_ENDPOINT} is required!`);

    //! split 'http://localhost:8080/bots'
    const aa = ENDPOINT.split('/');
    PROXY.type = aa.pop();
    PROXY.host = aa.join('/');
    PROXY.endpoint = ENDPOINT.substring(0, ENDPOINT.length - PROXY.type.length - 1);

    //! create agent and register for later re-use.
    _inf(`! proxy:${NAME} config. host=${PROXY.host}, type=${PROXY.type}, ep=${PROXY.endpoint}`);
    const $proxy = createHttpProxy(`_${NAME}`, { endpoint: PROXY.endpoint, headers }); //! create as internal instance.
    const $agent = new (class implements APIEndpoint {
        private type = PROXY.type;
        public name = () => $proxy.name();
        public endpoint = () => PROXY.endpoint;
        public doGet = (id: string, cmd?: string, $param?: any, $body?: any) =>
            $proxy.do_get(this.type, id, cmd, $param, $body);
        public doPut = (id: string, cmd?: string, $param?: any, $body?: any) =>
            $proxy.do_put(this.type, id, cmd, $param, $body);
        public doPost = (id: string, cmd?: string, $param?: any, $body?: any) =>
            $proxy.do_post(this.type, id, cmd, $param, $body);
        public doPatch = (id: string, cmd?: string, $param?: any, $body?: any) =>
            $proxy.do_patch(this.type, id, cmd, $param, $body);
        public doDelete = (id: string, cmd?: string, $param?: any, $body?: any) =>
            $proxy.do_delete(this.type, id, cmd, $param, $body);
        public do_get = (type: string, id?: string, cmd?: string, $param?: any, $body?: any, $ctx?: any) =>
            $proxy.do_get(type, id, cmd, $param, $body, $ctx);
        public do_put = (type: string, id?: string, cmd?: string, $param?: any, $body?: any, $ctx?: any) =>
            $proxy.do_put(type, id, cmd, $param, $body, $ctx);
        public do_post = (type: string, id?: string, cmd?: string, $param?: any, $body?: any, $ctx?: any) =>
            $proxy.do_post(type, id, cmd, $param, $body, $ctx);
        public do_patch = (type: string, id?: string, cmd?: string, $param?: any, $body?: any, $ctx?: any) =>
            $proxy.do_patch(type, id, cmd, $param, $body, $ctx);
        public do_delete = (type: string, id?: string, cmd?: string, $param?: any, $body?: any, $ctx?: any) =>
            $proxy.do_delete(type, id, cmd, $param, $body, $ctx);
    })();

    //! register & returns.
    return $engine(name, $agent);
};

/** ****************************************************************************************************************
 *  Common functions.
 ** ****************************************************************************************************************/
//! parrallel actions in list (in batch-size = 10)
//TODO - improve return types by refering callback.
export const do_parrallel = <T, U>(
    list: T[],
    callback: (node: T, index: number) => U,
    size = 10,
    pos = 0,
    result: (U | Error)[] = [],
): Promise<(U | Error)[]> => {
    size = size === undefined ? 10 : size;
    pos = pos === undefined ? 0 : pos;
    result = result === undefined ? [] : result;
    // _log(NS, `! parrallel(${pos}/${size})`)
    const list2 = list.slice(pos, pos + size);
    const actions = list2.map((node, i): any => {
        const index = pos + i;
        try {
            //! update this._index.
            const R = (() => {
                try {
                    return callback(node, index);
                } catch (e) {
                    return Promise.reject(e);
                }
            })();
            if (R instanceof Promise) {
                return R.catch(e => {
                    _err(`!ERR@1 node[${index}] =`, e);
                    //! make sure error instance.
                    return e instanceof Error ? e : new Error(typeof e == 'string' ? e : JSON.stringify(e));
                });
            }
            return R;
        } catch (e) {
            _err(`!ERR@2 node[${index}] =`, e);
            //! make sure error instance.
            return e instanceof Error ? e : new Error(typeof e == 'string' ? e : JSON.stringify(e));
        }
    });
    //! do parrallel.
    return Promise.all(actions).then(_ => {
        result = result.concat(_);
        if (!_.length) return Promise.resolve(result);
        return do_parrallel(list, callback, size, pos + size, result);
    });
};

//! default time-zone for this api. (Asia/Seoul - 9 hours)
export const DEFAULT_TIME_ZONE = 9;

//! convert to date of input.
export const conv_date = (dt: string | number | Date): Date => $U.dt(dt, DEFAULT_TIME_ZONE);

/**
 * Convert input to time value (in number)
 *
 * @param {*} dt    see `conv_date()`
 * @param {*} name  name of property
 */
export const conv_date2time = (dt: string | number | Date) => {
    if (dt === '' || dt === '0' || dt === 0) return 0; // 0 means null (not-set)
    const t = conv_date(dt);
    return t.getTime();
};

/**
 * Convert input (Date) to time-stamp (YYYY-MM-DD hh:mm:ss)
 * - consider with current time-zone.
 *
 * @param {*} dt
 */
export const conv_date2ts = (dt: string | number | Date) => {
    const t = conv_date(dt);
    return $U.ts(t, DEFAULT_TIME_ZONE);
};
