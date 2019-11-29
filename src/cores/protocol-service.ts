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
import { $engine, _log, _inf, _err, $U, doReportError, getHelloArn } from '../engine/';
import { ProtocolService, ProtocolParam, ProtocolTransformer, STAGE, NextMode, NextContext } from './core-types';
import { APIGatewayProxyEvent, APIGatewayEventRequestContext, SNSMessage, SQSRecord } from 'aws-lambda';
import { ConfigService, MyConfigService } from './config-service';
import AWS, { Lambda, SQS, SNS } from 'aws-sdk';
import { LambdaHandler } from './lambda-handler';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.
import URL from 'url';

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

    /**
     * say hello() of this service
     */
    public hello = (): string => `protocol-service`;

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
    public asProtocolURI(protocol: 'web' | 'sns' | 'sqs', param: ProtocolParam, config?: ConfigService): string {
        const currService = (config && config.getService()) || '';
        const currVersion = (config && config.getVersion()) || '';
        const service = !param.service || param.service == 'self' ? this.selfService || currService : param.service;
        const type = param.type ? param.type : this.selfType;
        const stage: STAGE = param.stage || (config && config.getStage()) || 'local';
        // if (!service) throw new Error('.service is required!');

        //! determin host name by service
        const _enc = (s: string): string => encodeURIComponent(s);
        const _host = (svc: string): string => {
            const isStandard = svc.endsWith('-api');
            const name = isStandard ? svc.substring(0, svc.length - '-api'.length) : svc;
            const type = protocol == 'web' ? 'api' : protocol;
            switch (stage) {
                case 'prod':
                    return isStandard ? `${name}-${type}` : `${name}`;
                case 'local':
                case 'dev':
                default:
                    return isStandard ? `${name}-${type}-dev` : `${name}-dev`;
            }
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
    public transformEvent(uri: string, param: ProtocolParam) {
        const url = URL.parse(uri);
        const protocol = url.protocol;
        switch (protocol) {
            case 'web:':
                return this.web.transformToEvent(uri, param);
            case 'sns:':
                return this.sns.transformToEvent(uri, param);
            case 'sqs:':
                return this.sqs.transformToEvent(uri, param);
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
        _inf(NS, `> uri =`, uri);

        // const url = new URL(uri);
        const url = URL.parse(uri);
        const payload = this.transformEvent(uri, param);

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
    public async notify(param: ProtocolParam, callback?: ProtocolParam, config?: ConfigService): Promise<string> {
        // const _log = console.info;
        config = config ? config : await this.$config;
        const service = param.service || config.getService() || '';
        _log(NS, `notify(${service})..`);
        const uri = this.asProtocolURI('sns', param, config);
        _inf(NS, `> uri[${service}] =`, uri);

        const params: SNS.Types.PublishInput = this.sns.transformToEvent(uri, param);
        const arn = params.TopicArn; // "arn:aws:sns:ap-northeast-2:796730245826:lemon-metrics-sns-dev"
        _inf(NS, `> arn[${service}] =`, arn);

        //! call sns
        const region = arn.split(':')[3] || 'ap-northeast-2';
        const sns = new AWS.SNS({ region });
        const res = await sns
            .publish(params)
            .promise()
            .catch((e: Error) => this.doReportError(e, param.context, null, { protocol: uri, param }))
            .then((data: SNS.Types.PublishResponse) => {
                _log(NS, `> res[${service}] =`, $U.json(data));
                return data.MessageId;
            });
        return res;
    }

    /**
     * Asynchronized call to target function via `SQS`
     *
     * @param param     the calling param
     * @param callback  the return target
     */
    public async enqueue(param: ProtocolParam, callback?: ProtocolParam, config?: ConfigService): Promise<string> {
        // const _log = console.info;
        config = config ? config : await this.$config;
        const service = param.service || config.getService() || '';
        _log(NS, `enqueue(${service})..`);
        const uri = this.asProtocolURI('sqs', param, config);
        _inf(NS, `> uri[${service}] =`, uri);

        const params: SQS.Types.SendMessageRequest = this.sqs.transformToEvent(uri, param);
        params.DelaySeconds = 10;
        const endpoint = params.QueueUrl; // https://sqs.${arr[3]}.amazonaws.com
        _inf(NS, `> endpoint[${service}] =`, uri);

        //! call sns
        const region = endpoint.split('.')[1] || 'ap-northeast-2';
        const sns = new AWS.SQS({ region });
        const res = await sns
            .sendMessage(params)
            .promise()
            .catch((e: Error) => this.doReportError(e, param.context, null, { protocol: uri, param }))
            .then((data: SQS.Types.SendMessageResult) => {
                _log(NS, `> res[${endpoint}] =`, $U.json(data));
                return data.MessageId;
            });
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
    public transformToEvent(uri: string, param: ProtocolParam): APIGatewayProxyEvent {
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
        const body =
            typeof event.body == 'string' && event.body.startsWith('{') && event.body.endsWith('}')
                ? JSON.parse(event.body)
                : event.body;

        //! decode context (can be null)
        if (typeof headers['x-protocol-context'] == 'undefined')
            throw new Error(".headers['x-protocol-context'] is required");
        const context: NextContext = headers['x-protocol-context'] ? JSON.parse(headers['x-protocol-context']) : null;

        const service = '';
        const stage: STAGE = `${requestContext.stage || ''}` as STAGE;
        const type = `${path || ''}`.split('/')[1] || '';
        const mode = httpMethod == 'GET' && !$path.id && !$path.cmd ? 'LIST' : 'GET';

        //! validate values.
        if (context && requestContext.accountId != context.accountId)
            throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId}`);
        if (context && requestContext.requestId != context.requestId)
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

type SNSEventParam = AWS.SNS.Types.PublishInput;

/**
 * class: `SNSProtocolTransformer`
 * - transformer for `SNS` Handler
 */
export class SNSProtocolTransformer implements ProtocolTransformer<SNSEventParam, SNSMessage> {
    private service: MyProtocolService;
    public constructor(service: MyProtocolService) {
        this.service = service;
    }
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(uri: string, param: ProtocolParam): SNSEventParam {
        // const uri = this.service.asProtocolURI('sns', param);
        const context = param.context || {};
        const arn = getHelloArn(param.context); // "arn:aws:sns:ap-northeast-2:796730245826:lemon-metrics-sns-dev"
        //! build TopicArn via url.
        const url = URL.parse(uri);
        const end = url.host || url.hostname;
        const arr = arn.split(':');
        arr[5] = end;
        const TopicArn: string = arr.join(':');
        const accountId: string = context.accountId || '';
        const requestId: string = context.requestId || '';
        _log(NS, `> TopicArn =`, TopicArn);
        const res: SNSEventParam = {
            TopicArn,
            Subject: `x-protocol-service`,
            Message: JSON.stringify({ default: $U.json(param) }),
            // Message: JSON.stringify({ default: param }),
            MessageAttributes: {
                accountId: { DataType: 'String', StringValue: accountId },
                requestId: { DataType: 'String', StringValue: requestId },
            },
            MessageStructure: 'json',
        };
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SNSMessage): ProtocolParam {
        const { Subject, Message, MessageAttributes } = event;

        //! extract message.
        const param: ProtocolParam = JSON.parse(Message);
        const context = (param && param.context) || {};

        //! validate message
        if (Subject != 'x-protocol-service') throw new Error(`.Subject[${Subject}] is not valid protocol.`);
        const accountId: string = MessageAttributes['accountId'] && MessageAttributes['accountId'].Value;
        const requestId: string = MessageAttributes['requestId'] && MessageAttributes['requestId'].Value;

        //! validate values.
        if (accountId != context.accountId) throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId}`);
        if (requestId != context.requestId) throw new Error(`400 INVALID CONTEXT - requestId:${context.requestId}`);

        //! returns.
        const res: ProtocolParam = param;
        return res;
    }
}

type SQSEventParam = AWS.SQS.Types.SendMessageRequest;
/**
 * class: `SQSProtocolTransformer`
 * - transformer for `SQS` Handler
 */
export class SQSProtocolTransformer implements ProtocolTransformer<SQSEventParam, SQSRecord> {
    private service: MyProtocolService;
    public constructor(service: MyProtocolService) {
        this.service = service;
    }
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(uri: string, param: ProtocolParam): SQSEventParam {
        // const uri = this.service.asProtocolURI('sns', param);
        const context = param.context || {};
        const arn = getHelloArn(param.context); // "arn:aws:sns:ap-northeast-2:796730245826:lemon-metrics-sns-dev"
        //! build TopicArn via url.
        const url = URL.parse(uri);
        const arr = arn.split(':');
        const QueueUrl = `https://sqs.${arr[3]}.amazonaws.com/${arr[4]}/${url.hostname}`;
        const accountId: string = context.accountId || '';
        const requestId: string = context.requestId || '';
        const res: SQSEventParam = {
            // DelaySeconds: 10, //NOTE - use SQS's configuration.
            QueueUrl,
            MessageBody: $U.json(param),
            MessageAttributes: {
                Subject: { DataType: 'String', StringValue: 'x-protocol-service' }, //NOTE! - should use 'Subject' in here.
                accountId: { DataType: 'String', StringValue: accountId },
                requestId: { DataType: 'String', StringValue: requestId },
            },
        };
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SQSRecord): ProtocolParam {
        const { body, messageAttributes } = event;
        const $body = JSON.parse(body);

        //! extract message.
        const subject = messageAttributes['Subject'] && messageAttributes['Subject'].stringValue;
        const param: ProtocolParam = $body;
        const context = param && param.context;

        //! validate message
        if (subject != 'x-protocol-service') throw new Error(`.subject[${subject}] is not valid protocol.`);
        const accountId: string = messageAttributes['accountId'] && messageAttributes['accountId'].stringValue;
        const requestId: string = messageAttributes['requestId'] && messageAttributes['requestId'].stringValue;

        //! validate values.
        if (context && accountId != context.accountId)
            throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId}`);
        if (context && requestId != context.requestId)
            throw new Error(`400 INVALID CONTEXT - requestId:${context.requestId}`);

        //! returns.
        const res: ProtocolParam = param;
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
