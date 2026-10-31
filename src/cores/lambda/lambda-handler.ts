/**
 * `lambda-handler.ts`
 * - main lambda handler.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err, doReportError } from '../../engine/';
import {
    Handler,
    Callback,
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    DynamoDBStreamEvent,
    SNSEvent as AWSSNSEvent,
    SQSEvent as AWSSQSEvent,
    ALBEvent as AWSALBEvent,
    ALBResult as AWSALBResult,
    PreSignUpTriggerEvent,
} from 'aws-lambda';
import { NextContext } from 'lemon-model';
import { ProtocolParam, CoreConfigService } from './../core-services';
import { GETERR } from '../../common/test-helper';
import * as $lambda from 'aws-lambda';
import { maskHeaders } from '../../lib/log-mask';
import { PROTOCOL_LOG_MASKED_HEADERS } from '../protocol/protocol-sign';
const NS = $U.NS('LMDA', 'green'); // NAMESPACE TO BE PRINTED.

export type ConfigService = CoreConfigService;
export type Context = $lambda.Context;

/**
 * cron event
 *
 * ```yaml
 * # use input field to define cron.
 * - schedule:
 *     name: daily
 *     input:
 *       cron:
 *         name: keepalive
 *         action: tick
 * ```
 */
export interface CronEvent {
    cron: { name: string; action: string };
}
export type WEBEvent = APIGatewayProxyEvent;
export type WEBResult = APIGatewayProxyResult;
export type WSSEvent = APIGatewayProxyEvent;
export type DDSEvent = DynamoDBStreamEvent;
export type ALBEvent = AWSALBEvent;
export type SNSEvent = AWSSNSEvent;
export type SQSEvent = AWSSQSEvent;
export type WSSResult = any;
export type ALBResult = AWSALBResult;

//* define and export all types.
export type MyHandler<TEvent = any, TResult = any> = (event: TEvent, context: NextContext) => Promise<TResult>;

export type ALBHandler = MyHandler<ALBEvent, ALBResult>;
export type WEBHandler = MyHandler<WEBEvent, WEBResult>;
export type WSSHandler = MyHandler<WSSEvent, WSSResult>;
export type SNSHandler = MyHandler<SNSEvent, void>;
//* v5 B5: SQS/DDS handlers return the partial batch response (`ReportBatchItemFailures`).
export type SQSHandler = MyHandler<SQSEvent, { batchItemFailures: { itemIdentifier: string }[] }>;
export type CronHandler = MyHandler<CronEvent, void>;
export type CognitoHandler = MyHandler<PreSignUpTriggerEvent>;
export type DynamoStreamHandler = MyHandler<DynamoDBStreamEvent, { batchItemFailures: { itemIdentifier: string }[] }>;
export type NotificationHandler = MyHandler<WEBEvent, WEBResult>;

/**
 *
 */
const $handlerTypes = {
    alb: 'alb',
    web: 'web',
    sns: 'sns',
    sqs: 'sqs',
    wss: 'wss',
    dds: 'dds',
    cron: 'cron',
    cognito: 'cognito',
    'dynamo-stream': 'dynamo-stream',
    notification: 'notification',
};

export type HandlerType = keyof typeof $handlerTypes;

/**
 * class: `LambdaHandlerService`
 * - must override if need to customize packing contexxt.
 */
export interface LambdaHandlerService<T extends MyHandler = MyHandler> {
    /**
     * MUST override this hanle()
     */
    handle: T;

    /**
     * (optional) pack the origin context to application context.
     * - override this function if required!
     *
     * @param event     origin event
     * @param context   origin context of lambda
     */
    packContext?(event: any, context: Context): Promise<NextContext>;

    /**
     * (optional) handle Protocol Request.
     * - override this function if required!
     *
     * @param param     protocol param.
     */
    handleProtocol?<TResult = any>(param: ProtocolParam): Promise<TResult>;
}

interface HandlerMap {
    [key: string]: LambdaHandlerService | Handler;
}

export abstract class LambdaSubHandler<T extends MyHandler> implements LambdaHandlerService<T> {
    protected lambda: LambdaHandler;
    protected type: string;
    public constructor(lambda: LambdaHandler, type?: HandlerType) {
        if (!lambda) throw new Error('@lambda (lambda-handler) is required!');
        this.lambda = lambda;
        this.type = type;
        if (lambda && type) lambda.setHandler(type, this);
    }
    abstract handle: T;
}

/**
 * build reprot-error function in safe.
 *
 * @param isReport flag to report-error via sns
 * @return the last error message
 */
export const buildReportError =
    (isReport?: boolean) =>
    (e: Error, context?: any, event?: any, data?: any): Promise<string> => {
        return (isReport ? doReportError(e, context, event, data) : Promise.resolve(data))
            .then(() => GETERR(e))
            .catch(GETERR);
    };

/**
 * class: `LambdaHandler`
 * - general lambda handler so that routes to proper target handlers.
 */
export class LambdaHandler {
    //* shared config.
    public static REPORT_ERROR: boolean = $U.env('REPORT_ERROR', '1') == '1';

    //* handler map.
    protected _map: HandlerMap = {};

    public config: ConfigService;
    //* protected constructor.
    public constructor(config?: ConfigService) {
        this.config = config;
    }

    /**
     * set service lambda handler.
     * @param type      name of type
     * @param handler   handler of service
     */
    public setHandler(type: HandlerType, handler: LambdaHandlerService | Handler) {
        let key = `${type || ''}`.toLowerCase().trim();
        key = key === 'dynamo-stream' ? 'dds' : key;
        // console.info(`! set-handler[${type}] =`, typeof handler);
        if (key) this._map[key] = handler;
    }

    /**
     * get service lambda handler.
     * @param type      name of type
     */
    public getHandler(type: HandlerType): LambdaHandlerService {
        let key = `${type || ''}`.toLowerCase().trim();
        key = key === 'dynamo-stream' ? 'dds' : key;
        const handler = this._map[key];
        //* must be `LambdaHandlerService`.
        if (handler && typeof handler == 'object') return handler as LambdaHandlerService;
        return null;
    }

    //* Find Service By Event
    public findService(event: any): HandlerType {
        const headers = (event && event.headers) || {};
        //* v5 B10-3: log a masked copy only; the checks below read the original `headers`.
        _log(NS, `> headers =`, $U.json(maskHeaders(headers, PROTOCOL_LOG_MASKED_HEADERS)));
        //* check if AWS SNS Notification Subscription -> notification controller.
        if (
            event.requestContext &&
            headers['x-amz-sns-message-type'] &&
            headers['x-amz-sns-message-id'] &&
            headers['x-amz-sns-topic-arn']
        ) {
            //* via HTTP/HTTPS SNS
            return 'notification';
        } else if (event.requestContext && event.pathParameters !== undefined) {
            //* via ApiGateway
            return 'web';
        } else if (event.requestContext && event.requestContext.eventType !== undefined) {
            //* via WEB-SOCKET from ApiGateway
            return 'wss';
        } else if (event.requestContext?.elb && typeof event.requestContext.elb?.targetGroupArn === 'string') {
            //* via TargetGroup from ALB(Applicatin/Elastic Load Balancer)
            return 'alb';
        } else {
            if (event.cron) {
                //* via CloudWatch's cron.
                return 'cron';
            } else if (event.userPoolId) {
                //* via cognito event
                return 'cognito';
            } else if (event.Records) {
                //* decode `Records` to find target.
                const records = Array.isArray(event.Records) ? event.Records : [];
                const sns: any[] = records.filter((_: any) => (_.Sns ? true : false)); // via sns event.
                const sqs: any[] = records.filter((_: any) => _.eventSource == 'aws:sqs'); // via sqs data/
                const ddb: any[] = records.filter((_: any) => (_.dynamodb ? true : false)); // via dynamodb
                if (sns.length) return 'sns';
                if (sqs.length) return 'sqs';
                if (ddb.length) return 'dds';
            }
        }
    }

    /**
     * decode event to proper handler.
     * - NOTE! - returns promised results with `async`
     * - v5 B5: never rejects (D7). a failure is caught, reported, and resolved by `asFailure()`.
     *
     * @returns boolean
     */
    public async handle(event: any, context: Context): Promise<any> {
        try {
            if (!event) throw new Error('@event is required!');
            return await this.handleEvent(event, context);
        } catch (e) {
            return this.asFailure(e, event, context);
        }
    }

    /**
     * v5 B5: dispatch the event to the target handler (may reject — `handle()` catches).
     */
    protected async handleEvent(event: any, context: Context): Promise<any> {
        //* WARN! allows for using callbacks as finish/error-handlers
        if (context) context.callbackWaitsForEmptyEventLoop = false;

        //* Check API parameters.
        const main: Handler = (event: any, context: Context, callback: Callback<any>): Promise<any> | void => {
            const type = this.findService(event);
            _log(NS, `main(${type})...`);
            const handler = this._map[type];
            if (handler && typeof handler == 'function') {
                //* low level handler function.
                return handler(event, context, callback);
            } else if (handler && typeof handler == 'object') {
                //* must be `LambdaHandlerService`.
                const $svc: LambdaHandlerService = handler;
                const $ctx: Promise<NextContext> = $svc.packContext
                    ? $svc.packContext(event, context)
                    : this.packContext(event, context);
                if ($ctx && $ctx instanceof Promise) {
                    return $ctx.then(_ => $svc.handle(event, _));
                } else if ($ctx) {
                    return $svc.handle(event, $ctx as NextContext);
                }
                return $svc.handle(event, null);
            }
            //* raise error if not found.
            _inf(NS, `WARN! unknown[${type}].event =`, $U.json(event));
            callback && callback(new Error(`400 UNKNOWN EVENT - service:${type ?? ''}`));
        };

        //* call promised.
        const promise = (main: Handler, event: any, context: Context): Promise<any> =>
            new Promise((resolve, reject) => {
                try {
                    let resolved = false;
                    const R = main(event, context, (error?, result?: any) => {
                        error && _err(NS, '! err@cb =', error);
                        // !error && _inf(NS, '! res@cb =', result);
                        if (error) reject(error);
                        else if (!resolved) resolve(result);
                    });
                    if (R !== undefined) {
                        resolved = true;
                        resolve(R);
                    }
                } catch (e) {
                    return reject(e);
                }
            });

        //* call main.. (it will return result or promised)
        return promise(main, event, context).then(_ => {
            if (_ !== undefined) _log(NS, '! res =', $U.S(_, 320, 64, ' .... ')); //* cut result string.
            return _;
        });
    }

    /**
     * v5 B5: turn a caught failure into a resolved result (S-35, D7).
     * - report (if `REPORT_ERROR`), then by the event type:
     *   `web` → the HTTP failure response by the `mxNextFailure` rules (no 2nd report),
     *   `sqs`/`dds` → every record in `batchItemFailures`, `cognito` → rethrow, else → `{ error: <message> }`.
     */
    protected async asFailure(e: any, event: any, context: Context): Promise<any> {
        _err(NS, '! err =', e);
        //* report this error (safe call, resolves the message).
        const message = await buildReportError(LambdaHandler.REPORT_ERROR)(e, context, event);
        //* the event type (safe: a broken event is `undefined`).
        const type = ((): HandlerType => {
            try {
                return event ? this.findService(event) : undefined;
            } catch (_) {
                return undefined;
            }
        })();
        //* v5 B5: cognito's failure contract is the thrown error (message reaches the client) — rethrow after the report.
        if (type === 'cognito') throw e;
        const records: any[] = Array.isArray(event?.Records) ? event.Records : [];
        if (type === 'web') {
            //* lazy import: `lambda-web-handler` extends this module (no import cycle at load).
            const { asFailureResult } = await import('./lambda-web-handler');
            return asFailureResult(e).response;
        } else if (type === 'sqs') {
            return { batchItemFailures: records.map(r => ({ itemIdentifier: `${r?.messageId ?? ''}` })) };
        } else if (type === 'dds') {
            const toId = (r: any) => `${r?.dynamodb?.SequenceNumber ?? ''}`;
            return { batchItemFailures: records.map(r => ({ itemIdentifier: toId(r) })) };
        }
        return { error: message };
    }

    /**
     * handle param via protocol-service.
     * - sub-service could call this method() to bypass request.
     *
     * @param param protocol parameters
     */
    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        //* if valid API Request, then use $web's function.
        const $web: LambdaHandlerService = this._map['web'] as LambdaHandlerService;
        if (!$web || typeof $web != 'object') throw new Error(`500 NO WEB HANDLER - name:web`);
        return $web.handleProtocol(param);
    }

    /**
     * (default) pack the origin context to application context.
     * - override this function if required!
     *
     * @param event     origin event
     * @param $ctx   origin context of lambda
     */
    public async packContext(event: any, $ctx: Context): Promise<NextContext> {
        const context: NextContext = {};
        $ctx && _log(NS, `! context[${$ctx.functionName || ''}] =`, $U.json($ctx));
        return context;
    }
}
