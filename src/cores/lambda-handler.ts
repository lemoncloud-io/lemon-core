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
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('LMDA', 'green'); // NAMESPACE TO BE PRINTED.
import { doReportError } from '../engine/';

import {
    Handler,
    Callback,
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    CognitoUserPoolTriggerEvent,
    DynamoDBStreamEvent,
    SNSEvent,
    SQSEvent,
} from 'aws-lambda';
import * as $lambda from 'aws-lambda';
import { NextContext } from './core-types';

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
export type WSSEvent = APIGatewayProxyEvent;

//! define and export all types.
export type MyHandler<TEvent = any, TResult = any> = (event: TEvent, context: NextContext) => Promise<TResult>;

export type WEBHandler = MyHandler<APIGatewayProxyEvent, APIGatewayProxyResult>;
export type SNSHandler = MyHandler<SNSEvent, void>;
export type SQSHandler = MyHandler<SQSEvent, void>;
export type WSSHandler = MyHandler<APIGatewayProxyEvent, any>;
export type CronHandler = MyHandler<CronEvent, void>;
export type CognitoHandler = MyHandler<CognitoUserPoolTriggerEvent>;
export type DynamoStreamHandler = MyHandler<DynamoDBStreamEvent, void>;

export type HandlerType = 'web' | 'sns' | 'sqs' | 'wss' | 'cron' | 'cognito' | 'dynamo-stream';

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
}

interface HandlerMap {
    [key: string]: LambdaHandlerService | Handler;
}

/**
 * class: `LambdaHandler`
 * - general lambda handler so that routes to proper target handlers.
 */
export class LambdaHandler {
    //! shared config.
    public static REPORT_ERROR: boolean = false;

    //! handler map.
    protected _map: HandlerMap = {};

    //! protected constructor.
    protected constructor() {}

    /**
     * set service lambda handler.
     * @param type      name of type
     * @param handler   handler of service
     */
    public setHandler(type: HandlerType, handler: LambdaHandlerService | Handler) {
        this._map[type] = handler;
    }

    //! Find Service By Event
    public findService = (event: any): HandlerType => {
        if (event.requestContext && event.pathParameters !== undefined) {
            //! via AgiGateway
            return 'web';
        } else if (event.requestContext && event.requestContext.eventType !== undefined) {
            return 'wss';
        } else {
            if (event.cron) {
                //! via CloudWatch's cron.
                return 'cron';
            } else if (event.userPoolId) {
                //! via cognito event
                return 'cognito';
            } else if (event.Records) {
                //! decode `Records` to find target.
                const records = Array.isArray(event.Records) ? event.Records : [];
                const sns: any[] = records.filter((_: any) => (_.Sns ? true : false)); // via sns event.
                const sqs: any[] = records.filter((_: any) => _.eventSource == 'aws:sqs'); // via sqs data/
                const ddb: any[] = records.filter((_: any) => (_.dynamodb ? true : false)); // via dynamodb
                if (sns.length) return 'sns';
                if (sqs.length) return 'sqs';
                if (ddb.length) return 'dynamo-stream';
            }
        }
    };

    /**
     * decode event to proper handler.
     * - NOTE! - returns promised results with `async`
     *
     * @returns boolean
     */
    public handle = async (event: any, context: Context): Promise<any> => {
        if (!event) throw new Error('@event is required!');

        //! WARN! allows for using callbacks as finish/error-handlers
        if (context) context.callbackWaitsForEmptyEventLoop = false;

        //! Check API parameters.
        const main: Handler = (event: any, context: Context, callback: Callback<any>): Promise<any> | void => {
            const type = this.findService(event);
            const handler = this._map[type];
            if (handler && typeof handler == 'function') {
                //! low level handler function.
                return handler(event, context, callback);
            } else if (handler && typeof handler == 'object') {
                //! must be `LambdaHandlerService`.
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
            //! raise error if not found.
            _inf(NS, `WARN! unknown[${type}].event =`, $U.json(event));
            callback && callback(new Error(`400 UNKNOWN - service:${type}`));
        };

        //! call promised.
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

        //! call main.. (it will return result or promised)
        return promise(main, event, context)
            .then(_ => {
                if (_ !== undefined) _log(NS, '! res =', $U.json(_));
                // ((context && context.done) || callback)(null, _);
                // return true;
                return _;
            })
            .catch(e => {
                _err(NS, '! err =', e);
                if (!LambdaHandler.REPORT_ERROR) {
                    // ((context && context.done) || callback)(e, null);
                    // return false;
                    throw e;
                }
                //! report this error.
                return doReportError(e, context, event)
                    .catch(_ => _) // safe call w/o error.
                    .then(() => {
                        // ((context && context.done) || callback)(e, null);
                        // return false;
                        throw e;
                    });
            });
    };

    /**
     * (default) pack the origin context to application context.
     * - override this function if required!
     *
     * @param event     origin event
     * @param context   origin context of lambda
     */
    public async packContext(event: any, context: Context): Promise<NextContext> {
        const $ctx: NextContext = {};
        if (event.requestContext) {
            const funcName = context.functionName || '';
            _log(NS, `! context[${funcName}].request =`, $U.json(event.requestContext));

            // //! load identity...
            // const event2: APIGatewayProxyEvent = event;
            // const $id = event2.requestContext.identity;
            // const sourceIp = $id && $id.sourceIp;
            // const accountId = $id && $id.accountId;
            // _log(NS, `! sourceIp[${funcName}] =`, sourceIp);
            // _log(NS, `! accountId[${funcName}] =`, accountId);
        } else {
            context && _log(NS, `! context[${context.functionName || ''}] =`, $U.json(context));
        }
        //NOTE - do nothing in here, by default.
        return $ctx;
    }
}

/**
 * class: `LambdaHandlerMain`
 * - local implementations.
 */
class LambdaHandlerMain extends LambdaHandler {
    public constructor() {
        super();
    }
}

//! create instance & export as default.
const $instance: LambdaHandler = new LambdaHandlerMain();
export default $instance;