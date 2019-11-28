/**
 * file: `cores/protocol-service.ts`
 * - inter communication protocol services
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-27 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, doReportError } from '../engine/';
import { ProtocolService, ProtocolParam, ProtocolTransformer, STAGE, NextMode, NextContext } from './core-types';
import { APIGatewayProxyEvent, SNSEvent, SQSEvent, APIGatewayEventRequestContext } from 'aws-lambda';
import { ConfigService, MyConfigService } from './config-service';
import AWS, { Lambda, SQS } from 'aws-sdk';
import { LambdaHandler } from './lambda-handler';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.
import URL, { Url } from 'url';

/**
 * class: `MyConfigService`
 * - main implementation for `protocol-service`
 * - support protocol via `API(WEB)` + `SNS` + `SQS`
 */
export class MyProtocolService implements ProtocolService {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    //! transformers
    public readonly web: WEBProtocolTransformer = new WEBProtocolTransformer(this);
    public readonly sns: SNSProtocolTransformer = new SNSProtocolTransformer(this);
    public readonly sqs: SQSProtocolTransformer = new SQSProtocolTransformer(this);

    // config-service to use.
    protected $config: Promise<ConfigService>;

    // self service name
    protected selfService: string;

    // self type name.
    protected selfType: string;

    /**
     * default constructor.
     */
    public constructor(service?: string, type?: string, config?: ConfigService) {
        _log(NS, `MyProtocolService()..`);
        this.$config = config ? Promise.resolve(config) : MyConfigService.factory();
        this.selfService = service || '';
        this.selfType = type || '';
    }

    //! determine path part
    public asPath = (type: string, id?: string, cmd?: string): string => {
        const buf = [''];
        //! add type by default
        buf.push(`${type || ''}`);
        if (id !== undefined && id !== null) {
            buf.push(`${id}`);
            if (cmd) {
                buf.push(`${cmd}`);
            }
        } else if (cmd) {
            buf.push('');
            buf.push(`${cmd}`);
        }
        const path = buf.map(encodeURIComponent).join('/');
        return path && path != '/' ? path : '';
    };

    /**
     * convert param to protocol URI.
     * - URI: `<protocol>://<accountId?>@<service-name>`
     *
     * **NOTE**
     * MUST USE STANDARD NAME FORMAT OF PACKAGE.NAME (ex: `lemon-hello-api`)
     *
     * example:
     *  - web://lemon-hello-api, web://lemon-hello-api-dev
     *  - sns://lemon-hello-sns, sns://lemon-hello-sns-dev
     *  - sqs://lemon-hello-sqs, sqs://lemon-hello-sqs-dev
     *
     * @param param     protocol param.
     * @param config    config-service to use.
     */
    public asProtocolURI(protocol: 'web' | 'sns' | 'sqs', param: ProtocolParam, config: ConfigService): string {
        const service = !param.service || param.service == 'self' ? this.selfService : param.service;
        const type = param.type ? param.type : this.selfType;
        const stage: STAGE = param.stage || config.getStage();

        //! determin host name by service
        const _enc = (s: string): string => encodeURIComponent(s);
        const _host = (service: string): string => {
            const isStandard = service.endsWith('-api');
            const name = isStandard ? service.substring(0, service.length - '-api'.length) : service;
            const type = protocol == 'web' ? 'api' : protocol;
            switch (stage) {
                case 'local':
                case 'dev':
                    return isStandard ? `${name}-${type}-dev` : `${name}-dev`;
                case 'prod':
                    return isStandard ? `${name}-${type}` : `${name}`;
            }
            return service;
        };
        //NOTE - functionName should be like `lemon-hello-api-prod-hello`, `lemon-metrics-api-dev-lambda`
        const _postfix = (func?: string): string => {
            func = func || 'lambda';
            if (protocol == 'web') {
                if (stage == 'prod') return `-prod-${func}`;
                return `-${func}`;
            }
            return '';
        };

        //! extract accountId from context.
        const user = (param.context && param.context.accountId) || '';
        const host = _enc(_host(service) + _postfix());
        const path = this.asPath(param.type, param.id, param.cmd);
        return `${protocol}://${user}${user ? '@' : ''}${host}${path}`;
    }

    /**
     * transform param to EventParam
     *
     * @param uri
     * @param param
     */
    public transformEvent(uri: string | Url, param: ProtocolParam) {
        // const url = URL.parse(uri);
        // const url = typeof uri == 'string' ? new URL(uri) : uri;
        const url = typeof uri == 'string' ? URL.parse(uri) : uri;
        const protocol = url.protocol;
        switch (protocol) {
            case 'web:':
                return this.web.transformToEvent(param);
            case 'sns:':
                return this.sns.transformToEvent(param);
            case 'sqs:':
                return this.sqs.transformToEvent(param);
        }
        throw new Error(`400 INVALID PROTOCOL - protocol:${protocol}`);
    }

    /**
     * internal safe report-error.
     */
    protected async doReportError<T>(e: Error, context?: any, event?: any, data?: any): Promise<T> {
        if (!MyProtocolService.REPORT_ERROR) throw e;
        _err(NS, `! err@report =`, e);
        return doReportError(e, context, event, data)
            .catch(() => {})
            .then(() => {
                throw e;
            });
    }

    /**
     * synchronized call to target function via `Lambda`
     *
     * @param param     the calling param
     */
    public async execute<T>(param: ProtocolParam, config?: ConfigService): Promise<T> {
        // const _log = console.info;
        config = config ? config : await this.$config;
        _log(NS, `execute(${param.service || ''})..`);
        const uri = this.asProtocolURI('web', param, config);
        // const url = new URL(uri);
        const url = URL.parse(uri);
        _log(NS, `> url =`, $U.json(url));
        const payload = this.transformEvent(url, param);
        // _log(NS, `> payload =`, $U.json(payload));

        //! prepare lambda payload.
        const params: Lambda.Types.InvocationRequest = {
            FunctionName: url.hostname,
            Payload: payload ? $U.json(payload) : '',
            ClientContext: null,
            // InvocationType: 'Event',
        };
        // _log(NS, `> params =`, $U.json(params));

        //! call lambda.
        const region = 'ap-northeast-2';
        const lambda = new AWS.Lambda({ region });
        const response = await lambda
            .invoke(params)
            .promise()
            .catch((e: Error) => this.doReportError(e, param.context, null, { protocol: uri, param }))
            .then((data: Lambda.Types.InvocationResponse) => {
                // _log(NS, `> data =`, $U.json(data));
                const payload = data.Payload ? JSON.parse(`${data.Payload}`) : {};
                const statusCode = payload.statusCode || data.StatusCode || 200;
                _log(NS, `> Lambda[${params.FunctionName}].StatusCode :=`, statusCode);
                //! safe parse payload.body.
                const body = (() => {
                    try {
                        if (payload.text && typeof payload.text == 'string') return payload.text;
                        return payload.body && typeof payload.body == 'string'
                            ? JSON.parse(payload.body)
                            : payload.body;
                    } catch (e) {
                        _log(NS, `> WARN! payload.body =`, $U.json(payload.body));
                        return payload.body;
                    }
                })();
                if (statusCode == 400 || statusCode == 404) return Promise.reject(new Error(body || '404 NOT FOUND'));
                if (statusCode !== 200) {
                    if (typeof body == 'string' && body.startsWith('404 NOT FOUND')) throw new Error(body);
                    throw new Error(body || 'Lambda Error. status:' + statusCode);
                }
                return body;
            });
        const res: T = response as T;
        return res;
    }

    /**
     * Asynchronized call to target function via `SNS`
     *
     * @param param     the calling param
     * @param callback  the return target
     */
    public async notify(param: ProtocolParam, callback?: ProtocolParam): Promise<string> {
        const res: string = null;
        return res;
    }

    /**
     * Asynchronized call to target function via `SQS`
     *
     * @param param     the calling param
     * @param callback  the return target
     */
    public async enqueue(param: ProtocolParam, callback?: ProtocolParam): Promise<string> {
        const res: string = null;
        return res;
    }
}

/**
 * class: `WEBProtocolTransformer`
 * - transformer for `WEB` Handler
 */
export class WEBProtocolTransformer implements ProtocolTransformer<APIGatewayProxyEvent, APIGatewayProxyEvent> {
    private service: MyProtocolService;
    public constructor(service: MyProtocolService) {
        this.service = service;
    }
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(param: ProtocolParam): APIGatewayProxyEvent {
        const mode: NextMode = `${param.mode || ''}` as NextMode;
        const httpMethod = mode == 'LIST' ? 'GET' : mode || 'GET';
        const id = mode == 'LIST' ? null : `${param.id || ''}`;
        const cmd = mode == 'LIST' ? null : `${param.cmd || ''}`;
        const path = this.service.asPath(param.type, id, cmd);
        const stage = `${param.stage || ''}`;

        //NOTE - must validate request with `requestId` + `accountId`.
        const context = param.context || {};
        const requestId = (context && context.requestId) || '';
        const accountId = (context && context.accountId) || '';

        //! build http parameter
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        const base: APIGatewayProxyEvent = {} as APIGatewayProxyEvent;
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        const $ctx: APIGatewayEventRequestContext = {} as APIGatewayEventRequestContext;
        const event: APIGatewayProxyEvent = {
            ...base,
            headers: {
                'x-protocol-context': $U.json(context),
            },
            path,
            httpMethod,
            pathParameters: { id, cmd },
            queryStringParameters: param.param,
            requestContext: {
                ...$ctx,
                path,
                httpMethod,
                identity: null, // must be 'null' due to not compartible with AWS auth.
                stage,
                accountId,
                requestId,
            },
            body: param.body ? $U.json(param.body) : null,
        };
        const res: APIGatewayProxyEvent = event;
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: APIGatewayProxyEvent): ProtocolParam {
        const headers = event.headers;
        if (!headers) throw new Error('.headers is required');
        const requestContext = event.requestContext;
        if (!requestContext) throw new Error('.requestContext is required');

        //! extract part
        const { path, httpMethod } = event;
        const $path = event.pathParameters;
        const param = event.queryStringParameters;
        const body = typeof event.body == 'string' && event.body.startsWith('{') ? JSON.parse(event.body) : event.body;
        if (!headers['x-protocol-context']) throw new Error(".headers['x-protocol-context'] is required");
        const context: NextContext = JSON.parse(headers['x-protocol-context']);

        const service = '';
        const stage: STAGE = `${requestContext.stage || ''}` as STAGE;
        const type = `${path || ''}`.split('/')[1] || '';
        const mode = httpMethod == 'GET' && !$path.id && !$path.cmd ? 'LIST' : 'GET';

        //! validate values.
        if (requestContext.accountId != context.accountId)
            throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId}`);
        if (requestContext.requestId != context.requestId)
            throw new Error(`400 INVALID CONTEXT - requestId:${context.requestId}`);

        //! prepare result.
        const res: ProtocolParam = {
            service,
            stage,
            type,
            mode,
            id: $path.id,
            cmd: $path.cmd,
            param,
            body,
            context,
        };
        return res;
    }
}

/**
 * class: `SNSProtocolTransformer`
 * - transformer for `SNS` Handler
 */
export class SNSProtocolTransformer implements ProtocolTransformer<SNSEvent, SNSEvent> {
    private service: MyProtocolService;
    public constructor(service: MyProtocolService) {
        this.service = service;
    }
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(param: ProtocolParam): SNSEvent {
        const res: SNSEvent = null;
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SNSEvent): ProtocolParam {
        const res: ProtocolParam = null;
        return res;
    }
}

/**
 * class: `SQSProtocolTransformer`
 * - transformer for `SQS` Handler
 */
export class SQSProtocolTransformer implements ProtocolTransformer<SQSEvent, SQSEvent> {
    private service: MyProtocolService;
    public constructor(service: MyProtocolService) {
        this.service = service;
    }
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(param: ProtocolParam): SQSEvent {
        const res: SQSEvent = null;
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SQSEvent): ProtocolParam {
        const res: ProtocolParam = null;
        return res;
    }
}

/**
 * class: `MyProtocolServiceMain`
 * - default instance.
 */
class MyProtocolServiceMain extends MyProtocolService {
    public constructor() {
        super();
    }
}

//! create instance & export as default.
const $instance: MyProtocolService = new MyProtocolServiceMain();
export default $instance;
