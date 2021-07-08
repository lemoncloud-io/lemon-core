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
import { _log, _inf, _err, $U, doReportError, getHelloArn } from '../../engine/';
import { NextMode, NextContext } from './../core-types';
import {
    STAGE,
    ProtocolService,
    ProtocolParam,
    ProtocolTransformer,
    ProtocolBody,
    CallbackParam,
} from './../core-services';
import AWS, { Lambda, SQS, SNS } from 'aws-sdk';
import { APIGatewayProxyEvent, APIGatewayEventRequestContext, SNSMessage, SQSRecord } from 'aws-lambda';
import { ConfigService } from './../config/config-service';
import { LambdaHandler } from './../lambda/lambda-handler';

const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.

import URL from 'url';
import $conf from '../config/'; // load config-module.
import $aws from '../aws/'; // load config-module.
// import queryString from 'query-string';
import queryString from 'qs';

/**
 * type: MyProtocolType
 * - supportable type of protocol
 */
export type MyProtocolType = 'web' | 'sns' | 'sqs' | 'api';

/**
 * type: MySNSEventParam
 */
export type MySNSEventParam = AWS.SNS.Types.PublishInput;

/**
 * type of ProtocolParam w/ callback
 * - only valid from transformer.
 */
export interface MyProtocolParam extends ProtocolParam {
    callback?: string; // (optional) callback uri if applicable.
}

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
    public config: ConfigService;

    // self service name
    protected selfService: string;

    /**
     * default constructor.
     *
     * @param   service     default current service (for debug)
     * @param   config      config-service to use (for debug)
     */
    public constructor(service?: string, config?: ConfigService) {
        // _log(NS, `MyProtocolService()..`);
        this.selfService = `${service || ''}`;
        this.config = config ? config : $conf.config; // use default config-service.
    }

    /**
     * say hello() of this service
     */
    public hello = (): string => `protocol-service:${this.selfService || ''}`;

    //! determine path part
    public static asPath = (type: string, id?: string, cmd?: string): string => {
        const buf = [''];
        const enc = (_: string) => encodeURIComponent(_);
        const esc = (_: string) => encodeURI(_);
        //! add type by default
        buf.push(enc(`${type || ''}`));
        if (id !== undefined && id !== null) {
            buf.push(enc(`${id}`));
            if (cmd) {
                buf.push(esc(`${cmd}`));
            }
        } else if (cmd) {
            buf.push('');
            buf.push(esc(`${cmd}`));
        }
        const path = buf.join('/');
        return path && path != '/' ? path : '';
    };

    /**
     * load transformer
     */
    public asTransformer(name: 'web' | 'sns' | 'sqs'): ProtocolTransformer {
        if (name == 'web') return this.web;
        else if (name == 'sns') return this.sns;
        else if (name == 'sqs') return this.sqs;
        else return null;
    }

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
    public asProtocolURI(protocol: MyProtocolType, param: ProtocolParam, config?: ConfigService): string {
        config = config ? config : this.config;
        const context = param && param.context;
        const service = !param.service || param.service == 'self' ? this.selfService || 'self' : param.service;
        const stage: STAGE = param.stage || (config && config.getStage()) || 'local';

        // eslint-disable-next-line prettier/prettier
        const uri = MyProtocolService.buildProtocolURI(config, context, protocol, service, stage, param.type, param.id, param.cmd);
        _log(NS, `! url[${protocol}/${service}] = ${param.mode || ''}`, uri);
        return uri.split('#')[0];
    }

    /**
     * get the current service's protocol uri
     *
     * @param context   the current context.
     * @param type      (optional) resource type
     * @param id        (optional) resource id
     * @param cmd       (optional) action command
     */
    public myProtocolURI(context: NextContext, type?: string, id?: string, cmd?: string) {
        return MyProtocolService.buildProtocolURI(this.config, context, 'api', 'self', '', `${type || ''}`, id, cmd);
    }

    /**
     * helper to build protocol-uri from the current config.
     */
    public static buildProtocolURI(
        config: ConfigService,
        context: NextContext,
        protocol: MyProtocolType,
        service: 'self' | string,
        stage: '' | STAGE,
        type: string,
        id?: string,
        cmd?: string,
    ): string {
        if (!service) throw new Error('@service (string) is required!');
        // if (!stage) throw new Error('@stage (string) is required!');
        // if (!type) throw new Error('@type (string) is required!');
        // config = config ? config : $conf && $conf.config;

        const currService = `${(config && config.getService()) || ''}`;
        const currVersion = `${(config && config.getVersion()) || ''}`;
        const currStage = `${(config && config.getStage()) || ''}` as STAGE;
        const accountId = `${(context && context.accountId) || ''}`;

        service = service == 'self' ? currService : service;
        stage = !stage ? currStage : stage;

        //! determin host name by service
        const _host = (protocol: MyProtocolType, svc: string): string => {
            const isStandard = svc.endsWith('-api');
            const name = isStandard ? svc.substring(0, svc.length - '-api'.length) : svc;
            const type = protocol == 'api' || protocol == 'web' ? 'api' : protocol;
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
        const _postfix = (protocol: MyProtocolType, func?: string): string => {
            func = func || 'lambda';
            if (protocol == 'web') {
                if (stage == 'prod') return `-prod-${func}`;
                return `-${func}`;
            }
            return '';
        };

        //! extract accountId from context.
        const host = _host(protocol, service) + _postfix(protocol);
        const path = this.asPath(type, id, cmd);
        return `${protocol}://${accountId}${accountId ? '@' : ''}${host}${path}#${currVersion}`;
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
                throw e instanceof Error ? e : new Error(typeof e == 'string' ? e : $U.json(e));
            });
    }

    /**
     * from string url, transform to protocol-param.
     * *mode* is dependent on body condition.
     * - if body is undefined, then mode will be 'GET'
     * - if body is not undefined, then mode will be 'POST'.
     *
     * @param context   the current execute context via controller.
     * @param url       url string must start with 'lemon://' like `lemon://lemon-hello-api/hello/0`, or 'api://'
     * @param param     query parameter (optional)
     * @param body      post body (optional)
     */
    public fromURL(context: NextContext, url: string, param?: ProtocolBody, body?: ProtocolBody): ProtocolParam {
        if (!url) throw new Error('@url (lemon-protocol) is required!');
        if (!url.startsWith('lemon://') && !url.startsWith('api://'))
            throw new Error(`@url - protocol not supportable (${url.split(':')[0]}://)`);
        const config = this.config;
        const isApi = url.startsWith('api://') ? true : false;
        const uri = URL.parse(url);
        const host = isApi ? `${uri.host}`.split('-api', 2)[0] + '-api' : `${uri.host}`;
        const path = uri.pathname;
        const paths = path.split('/', 4); // '/a/b/c/d/e' => ['', a, b, c]
        const type = `${paths[1] || ''}`;
        const id = paths.length > 2 ? paths[2] : null;
        const cmd = paths.length > 3 ? path.substring(['', type, id].join('/').length + 1) : null;
        const stage =
            isApi && `${uri.host}`.endsWith('-dev') ? 'dev' : (`${(config && config.getStage()) || 'prod'}` as STAGE);
        //! override query string.
        const qs = uri.query;
        if (qs) {
            const qs2 = $U.qs.parse(qs);
            param = { ...qs2, ...param };
        }
        //! prepare protocol-param.
        const proto: ProtocolParam = {
            mode: body === undefined ? 'GET' : 'POST',
            service: host,
            type,
            stage,
            id: id ? decodeURIComponent(id) : id,
            cmd: cmd ? decodeURI(cmd) : cmd,
            context: { ...context },
        };
        if (param !== undefined) proto.param = param;
        if (body !== undefined) proto.body = body;
        if (uri.auth && context) proto.context.accountId = uri.auth;
        return proto;
    }

    /**
     * build callback uri of self's type/id/cmd
     */
    public asCallbackURI(context: NextContext, param: CallbackParam): string {
        const selfUri = this.myProtocolURI(context, param.type, param.id, param.cmd);
        const qs = param.param ? $U.qs.stringify(param.param) : '';
        const [a, b] = selfUri.split('#', 2);
        return qs ? `${a}?${qs}${b ? '#' : ''}${b || ''}` : `${a}${b ? '#' : ''}${b || ''}`;
    }

    /**
     * synchronized call to target function via `Lambda`
     *
     * @param param     the calling param
     * @param config    config service (for debug)
     * @param uri       (optional) if useing custom uri.
     */
    public async execute<T>(param: ProtocolParam, config?: ConfigService, uri?: string): Promise<T> {
        // const _log = console.info;
        config = config || this.config;
        _log(NS, `execute(${param.service || ''})..`);

        //! execute via lambda call.
        uri = uri || this.asProtocolURI('web', param, config);
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
        const region = 'ap-northeast-2'; //TODO - optimize of aws region....
        const lambda = new AWS.Lambda({ region });
        const response = await lambda
            .invoke(params)
            .promise()
            .catch((e: Error) => {
                _err(NS, `! execute[${param.service || ''}].err =`, typeof e, e);
                // return this.doReportError(e, param.context, null, { protocol: uri, param });
                throw e;
            })
            .then((data: Lambda.Types.InvocationResponse) => {
                _log(NS, `! execute[${param.service || ''}].res =`, $U.S(data, 320, 64, ' .... '));
                const payload = data && data.Payload ? JSON.parse(`${data.Payload}`) : {};
                const statusCode = $U.N(payload.statusCode || (data && data.StatusCode), 200);
                _log(NS, `> Lambda[${params.FunctionName}].StatusCode :=`, statusCode);
                [200, 201].includes(statusCode) || _inf(NS, `> WARN! status[${statusCode}] data =`, $U.S(data)); // print whole data if not 200.
                //! safe parse payload.body.
                const body = (() => {
                    try {
                        if (payload.text && typeof payload.text == 'string') return payload.text;
                        return payload.body && typeof payload.body == 'string'
                            ? JSON.parse(payload.body)
                            : payload.body;
                    } catch (e) {
                        _log(NS, `> WARN! payload.body =`, $U.S(payload.body));
                        return payload.body;
                    }
                })();
                //! returns
                if (statusCode == 400 || statusCode == 404)
                    return Promise.reject(new Error($U.S(body) || '404 NOT FOUND'));
                else if (statusCode != 200 && statusCode != 201) {
                    if (typeof body == 'string' && body.startsWith('404 NOT FOUND')) throw new Error(body);
                    throw new Error($U.S(body) || `Lambda Error. status:${statusCode}`);
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
     * @param config    config service (for debug)
     */
    public async notify(param: ProtocolParam, callback?: CallbackParam, config?: ConfigService): Promise<string> {
        // const _log = console.info;
        config = config || this.config;
        const service = `${param.service || config.getService() || ''}`;
        _log(NS, `notify(${service})..`);
        const uri = this.asProtocolURI('sns', param, config);
        _inf(NS, `> uri[${service}] =`, uri);

        const cbUrl = callback ? this.asCallbackURI(param.context, callback) : null;
        const params: SNS.Types.PublishInput = this.sns.transformToEvent(uri, param, cbUrl);
        const arn = params.TopicArn; // "arn:aws:sns:ap-northeast-2:796730245826:lemon-metrics-sns-dev"
        // _inf(NS, `> arn[${service}] =`, arn);
        _inf(NS, `> payload[${arn}] =`, $U.json(params));

        //! call sns
        const region = arn.split(':')[3] || 'ap-northeast-2';
        const sns = new AWS.SNS({ region });
        const res = await sns
            .publish(params)
            .promise()
            .catch((e: Error) => {
                _err(NS, `! notify[${param.service || ''}].err =`, typeof e, e);
                return this.doReportError(e, param.context, null, { protocol: uri, param });
            })
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
     * @param delaySeconds the delayed seconds
     * @param config    config service (for debug)
     */
    public async enqueue(
        param: ProtocolParam,
        callback?: CallbackParam,
        delaySeconds?: number,
        config?: ConfigService,
    ): Promise<string> {
        // const _log = console.info;
        config = config || this.config;
        const service = `${param.service || config.getService() || ''}`;
        const stage = `${param.stage || config.getStage() || ''}`;
        _log(NS, `enqueue(${service}-${stage})..`);
        const uri = this.asProtocolURI('sqs', param, config);
        _inf(NS, `> uri[${service}] =`, uri);
        delaySeconds = $U.N(delaySeconds, 10);
        if (delaySeconds < 0) throw new Error(`@delaySeconds (number) should be >= 0. but ${delaySeconds}`);

        const cbUrl = callback ? this.asCallbackURI(param.context, callback) : null;
        _inf(NS, `> callback[${service}] =`, cbUrl);
        const params = this.sqs.transformToEvent(uri, param, cbUrl);
        params.DelaySeconds = delaySeconds;
        const endpoint = params.QueueUrl; // https://sqs.${arr[3]}.amazonaws.com
        // _inf(NS, `> endpoint[${service}] =`, endpoint);
        _inf(NS, `> payload[${endpoint}] =`, $U.json(params));

        //! call sns
        const region = endpoint.split('.')[1] || 'ap-northeast-2';
        const sqs = new AWS.SQS({ region });
        const res = await sqs
            .sendMessage(params)
            .promise()
            .catch((e: Error) => {
                _err(NS, `! enqueue[${param.service || ''}].err =`, typeof e, e);
                return this.doReportError(e, param.context, null, { protocol: uri, param });
            })
            .then((data: SQS.Types.SendMessageResult) => {
                _log(NS, `> res[${endpoint}] =`, $U.json(data));
                return data.MessageId;
            });
        return res;
    }

    /**
     * broadcast body message via shared `SNS` Subscritions. (see `NotificationHandler`)
     * - `.service` will be self url like `api://lemon-hello-api#1.2.3`
     *
     * @param context   the current execute context. (`.identity` will be relayed).
     * @param endpoint  the SNS endpoint like `lemon-hello-out`, or full ARN.
     * @param body      the message body to broadcast.
     * @returns         the message-id if applicable.
     */
    public async broadcast(context: NextContext, endpoint: string, body: ProtocolBody): Promise<string> {
        const service = this.myProtocolURI(context);
        _log(NS, `broadcast(${service})..`);
        _log(NS, `> body[${service}] =`, $U.json(body));

        const arn = await $aws.sns.endpoint(endpoint);
        _inf(NS, `> arn[${endpoint}] =`, arn);

        const accountId = `${(context && context.accountId) || ''}`;
        const requestId = `${(context && context.requestId) || ''}`;
        const params: SNS.Types.PublishInput = {
            TopicArn: arn,
            Subject: `x-protocol-service/broadcast`, //NOTE! - can be no 'Subject' if subscribed as HTTP SNS.
            Message: JSON.stringify({ default: $U.json(body) }), //NOTE! - only body data is required.
            // Message: JSON.stringify({ default: param }),
            MessageAttributes: {
                // accountId: { DataType: 'String', StringValue: accountId },
                // requestId: { DataType: 'String', StringValue: requestId },
            },
            MessageStructure: 'json',
        };
        if (accountId) params.MessageAttributes['accountId'] = { DataType: 'String', StringValue: accountId };
        if (requestId) params.MessageAttributes['requestId'] = { DataType: 'String', StringValue: requestId };

        //! call sns
        const region = arn.split(':')[3] || 'ap-northeast-2';
        const sns = new AWS.SNS({ region });
        const res = await sns
            .publish(params)
            .promise()
            .catch((e: Error) => {
                _err(NS, `! broadcast[${service || ''}].err =`, typeof e, e);
                return this.doReportError(e, context, null, { endpoint, body });
            })
            .then((data: SNS.Types.PublishResponse) => {
                _log(NS, `> res[${service}] =`, $U.json(data));
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
        const type = `${param.type || ''}`;
        const id = mode == 'LIST' ? null : `${param.id || ''}`;
        const cmd = mode == 'LIST' ? null : `${param.cmd || ''}`;
        const path = MyProtocolService.asPath(type, id, cmd);
        const stage = `${param.stage || ''}`;

        //NOTE - must validate request with `requestId` + `accountId`.
        const context = param.context || {};
        const requestId = `${(context && context.requestId) || ''}`;
        const accountId = `${(context && context.accountId) || ''}`;

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
            pathParameters: { type, id, cmd },
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
        if (!event) throw new Error('@event (API Event) is required!'); // avoid null exception.
        const headers = event.headers;
        if (!headers) throw new Error('.headers is required');
        const requestContext = event.requestContext;
        if (!requestContext) throw new Error('.requestContext is required');

        //! extract part
        const { resource, path, httpMethod } = event; // in case of resource: '/session/{id}/{cmd}', path: '/ses-v1/session/t001/test-es6'
        const contType = `${headers['content-type'] || headers['Content-Type'] || ''}`.toLowerCase();
        _log(NS, `content-type =`, contType);
        //! the path format should be `/{type}/{id}/{cmd}`
        const $path: { type?: string; id?: string; cmd?: string } = event.pathParameters || {};
        const param = event.queryStringParameters;
        const body = ((body: any, type: string): any => {
            const isText = body && typeof body == 'string';
            const isJson = type.startsWith('application/json');
            const isForm = type.startsWith('application/x-www-form-urlencoded');
            if (isText && isJson) return JSON.parse(body);
            if (isText && body.startsWith('{') && body.endsWith('}')) return JSON.parse(body);
            if (isText && body.startsWith('[') && body.endsWith(']')) return JSON.parse(body);
            // if (isText && isForm) return queryString.parse(body, { arrayFormat: 'bracket' });
            if (isText && isForm) return queryString.parse(body);
            return body;
        })(event.body, contType);

        //! decode context (can be null)
        if (typeof headers['x-protocol-context'] == 'undefined')
            throw new Error(".headers['x-protocol-context'] is required");
        const context: NextContext = headers['x-protocol-context'] ? JSON.parse(headers['x-protocol-context']) : null;

        //! determine execute mode.
        const service = '';
        const stage: STAGE = `${requestContext.stage || ''}` as STAGE;
        const type = $path.type || `${resource || path || ''}`.split('/')[1] || ''; // 1st path param will be type of resource.
        const mode: NextMode =
            httpMethod == 'GET' && !$path.id && !$path.cmd ? 'LIST' : (`${httpMethod}`.toUpperCase() as NextMode);

        //! validate values.
        if (context && context.accountId && requestContext.accountId != context.accountId)
            throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId || ''}`);
        if (context && context.requestId && requestContext.requestId != context.requestId)
            throw new Error(`400 INVALID CONTEXT - requestId:${context.requestId || ''}`);

        //! pack as protocol-param.
        const res: ProtocolParam = { service, stage, type, mode, id: $path.id, cmd: $path.cmd, param, body, context };
        return res;
    }
}

/**
 * class: `SNSProtocolTransformer`
 * - transformer for `SNS` Handler
 */
export class SNSProtocolTransformer implements ProtocolTransformer<MySNSEventParam, SNSMessage> {
    private service: MyProtocolService;
    public constructor(service: MyProtocolService) {
        this.service = service;
    }
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(uri: string, param: ProtocolParam, callback?: string): MySNSEventParam {
        // const uri = this.service.asProtocolURI('sns', param);
        const context = param.context || {};
        const arn = getHelloArn(param.context); // "arn:aws:sns:ap-northeast-2:796730245826:lemon-metrics-sns-dev"
        //! build TopicArn via url.
        const url = URL.parse(uri);
        const end = url.host || url.hostname;
        const arr = arn.split(':');
        arr[5] = end;
        const TopicArn: string = arr.join(':');
        const accountId = `${context.accountId || ''}`;
        const requestId = `${context.requestId || ''}`;
        _log(NS, `> TopicArn =`, TopicArn);
        const res: MySNSEventParam = {
            TopicArn,
            Subject: `x-protocol-service`,
            Message: JSON.stringify({ default: $U.json(param) }),
            // Message: JSON.stringify({ default: param }),
            MessageAttributes: {
                // accountId: { DataType: 'String', StringValue: accountId },
                // requestId: { DataType: 'String', StringValue: requestId },
            },
            MessageStructure: 'json',
        };
        //! StringValue can not be empty
        if (accountId) res.MessageAttributes['accountId'] = { DataType: 'String', StringValue: accountId };
        if (requestId) res.MessageAttributes['requestId'] = { DataType: 'String', StringValue: requestId };
        //! append callback-url in attributes (WARN! string length limit)
        if (callback) res.MessageAttributes['callback'] = { DataType: 'String', StringValue: callback };
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SNSMessage): MyProtocolParam {
        const { Subject, Message, MessageAttributes } = event;

        //! extract message.
        const param: ProtocolParam = JSON.parse(Message);
        const context = (param && param.context) || {};

        //! validate message
        if (Subject != 'x-protocol-service') throw new Error(`.Subject[${Subject}] is not valid protocol.`);
        const _str = (name: string): string =>
            MessageAttributes ? `${(MessageAttributes[name] && MessageAttributes[name].Value) || ''}` : '';
        const accountId: string = _str('accountId');
        const requestId: string = _str('requestId');
        const callback: string = _str('callback');

        //! validate values.
        if (accountId != `${context.accountId || ''}`)
            throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId}`);
        if (requestId != `${context.requestId || ''}`)
            throw new Error(`400 INVALID CONTEXT - requestId:${context.requestId}`);

        //! returns.
        const res: MyProtocolParam = param;
        if (callback) res.callback = callback;
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
    public transformToEvent(uri: string, param: ProtocolParam, callback?: string): SQSEventParam {
        // const uri = this.service.asProtocolURI('sns', param);
        const context = param.context || {};
        const arn = getHelloArn(param.context); // "arn:aws:sns:ap-northeast-2:796730245826:lemon-metrics-sns-dev"
        //! build TopicArn via url.
        const url = URL.parse(uri);
        const arr = arn.split(':');
        const QueueUrl = `https://sqs.${arr[3]}.amazonaws.com/${arr[4]}/${url.hostname}`;
        const accountId = `${context.accountId || ''}`;
        const requestId = `${context.requestId || ''}`;
        const res: SQSEventParam = {
            // DelaySeconds: 10, //NOTE - use SQS's configuration.
            QueueUrl,
            MessageBody: $U.json(param),
            MessageAttributes: {
                Subject: { DataType: 'String', StringValue: 'x-protocol-service' }, //NOTE! - should use 'Subject' in here.
                // accountId: { DataType: 'String', StringValue: accountId },
                // requestId: { DataType: 'String', StringValue: requestId },
            },
        };
        //! StringValue can not be empty
        if (accountId) res.MessageAttributes['accountId'] = { DataType: 'String', StringValue: accountId };
        if (requestId) res.MessageAttributes['requestId'] = { DataType: 'String', StringValue: requestId };
        //! append callback-url in attributes (WARN! string length limit)
        if (callback) res.MessageAttributes['callback'] = { DataType: 'String', StringValue: callback };
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SQSRecord): MyProtocolParam {
        const { body, messageAttributes } = event;
        const $body = JSON.parse(body);

        //! extract message.
        const subject = messageAttributes['Subject'] && messageAttributes['Subject'].stringValue;
        const param: ProtocolParam = $body;
        const context = param && param.context;

        //! validate message
        if (subject != 'x-protocol-service') throw new Error(`.subject[${subject}] is not valid protocol.`);
        const _str = (name: string): string =>
            messageAttributes ? `${(messageAttributes[name] && messageAttributes[name].stringValue) || ''}` : '';
        const accountId = _str('accountId');
        const requestId = _str('requestId');
        const callback = _str('callback');

        //! validate values.
        if (context && accountId != `${context.accountId || ''}`)
            throw new Error(`400 INVALID CONTEXT - accountId:${context.accountId}`);
        if (context && requestId != `${context.requestId || ''}`)
            throw new Error(`400 INVALID CONTEXT - requestId:${context.requestId}`);

        //! returns.
        const res: MyProtocolParam = param;
        if (callback) res.callback = callback;
        return res;
    }
}
