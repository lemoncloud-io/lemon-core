/**
 * `lambda-handler.ts`
 * - main lambda handler.
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-10-30 initial version
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, doReportError } from '../../engine';
import { NextContext } from 'lemon-model';
import { ProtocolParam, CoreConfigService } from '../core-services';
import { GETERR } from '../../common/test-helper';

const NS = $U.NS('FUNC', 'green'); // NAMESPACE TO BE PRINTED.

// export type ConfigService = CoreConfigService;

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
interface CronEvent {
    cron: { name: string; action: string };
}
type WEBEvent = any;
type WEBResult = any;
type WSSEvent = any;
type DDSEvent = any;
type SNSEvent = any;
type SQSEvent = any;
type WSSResult = any;

//! define and export all types.
type MyHandler<TEvent = any, TResult = any> = (ctx: any, req: any) => Promise<TResult>;

type WEBHandler = MyHandler<WEBEvent, WEBResult>;
type WSSHandler = MyHandler<WSSEvent, WSSResult>;
type SNSHandler = MyHandler<SNSEvent, void>;
type SQSHandler = MyHandler<SQSEvent, void>;
type CronHandler = MyHandler<CronEvent, void>;

type NotificationHandler = MyHandler<WEBEvent, WEBResult>;

type HandlerType = 'web' | 'sns' | 'sqs' | 'wss' | 'dds' | 'cron' | 'cognito' | 'notification' | 'dynamo-stream';

/**
 * class: `LambdaHandlerService`
 * - must override if need to customize packing contexxt.
 */
interface LambdaHandlerService<T extends MyHandler = MyHandler> {
    /**
     * MUST override this hanle()
     */
    handle: T;

    /**
     * (optional) pack the origin context to application context.
     * - override this function if required!
     *
     * @param ctx     event context
     * @param req     http request
     */
    packContext?(ctx: any, req: any): Promise<NextContext>;

    /**
     * (optional) handle Protocol Request.
     * - override this function if required!
     *
     * @param param     protocol param.
     */
    handleProtocol?<TResult = any>(param: ProtocolParam): Promise<TResult>;
}

interface HandlerMap {
    [key: string]: LambdaHandlerService | any;
}

export abstract class FunctionSubHandler<T extends MyHandler> implements LambdaHandlerService<T> {
    protected functions: FunctionHandler;
    protected type: string;
    public constructor(functions: FunctionHandler, type?: HandlerType) {
        if (!functions) throw new Error('@functions (functions-handler) is required!');
        this.functions = functions;
        this.type = type;
        if (functions && type) functions.setHandler(type, this);
    }
    abstract handle: T;
}

/**
 * build reprot-error function in safe.
 *
 * @param isReport flag to report-error via sns
 * @return the last error message
 */
const buildReportError =
    (isReport?: boolean) =>
        (e: Error, ctx?: any, req?: any, data?: any): Promise<string> => {
            return (isReport ? doReportError(e, ctx, req, data) : Promise.resolve(data))
                .then(() => GETERR(e))
                .catch(GETERR);
        };

/**
 * class: `LambdaHandler`
 * - general lambda handler so that routes to proper target handlers.
 */
export class FunctionHandler {
    //! shared config.
    public static REPORT_ERROR: boolean = $U.env('REPORT_ERROR', '1') == '1';

    //! handler map.
    protected _map: HandlerMap = {};

    public config: CoreConfigService;
    //! protected constructor.
    public constructor(config?: CoreConfigService) {
        this.config = config;
    }

    /**
     * set service lambda handler.
     * @param type      name of type
     * @param handler   handler of service
     */
    public setHandler(type: HandlerType, handler: LambdaHandlerService | any) {
        let key = `${type || ''}`.toLowerCase().trim();
        key = key === 'dynamo-stream' ? 'dds' : key;
        // console.info(`! set-handler[${type}] =`, typeof handler);
        if (key) this._map[key] = handler;
    }

    //! Find Service By Event
    public findService = (ctx: any): HandlerType => {
        const headers = (ctx && ctx.headers) || {};
        _log(NS, `> headers =`, $U.json(headers));
        //! check if AZURE SB TOPICS Notification Subscription -> notification controller.
        if (ctx.invocationId) {
            for (const binding of ctx.bindingDefinitions) {
                if (binding.type === 'httpTrigger') {
                    return 'web';
                } else {
                    if (binding.type === 'serviceBusTrigger' && binding.name === 'queue') {
                        return 'sqs';
                    }
                    if (binding.type === 'serviceBusTrigger' && binding.name === 'topic') {
                        return 'sns';
                    }
                }
            }
        } else {
            if (ctx.requestContext && ctx.pathParameters !== undefined) {
                return 'web';
            }
        }
    };
    /**
     * decode event to proper handler.
     * - NOTE! - returns promised results with `async`
     *
     * @returns boolean
     */
    public async handle(ctx: any, req: any): Promise<any> {
        if (!ctx) throw new Error('@ctx is required!');

        //! Check API parameters.
        const main: any = (ctx: any, req: any, callback: any): Promise<any> | void => {
            const type = this.findService(ctx);
            _log(NS, `main(${type})...`);
            const handler = this._map[type];
            if (handler && typeof handler == 'function') {
                //! low level handler function.
                return handler(ctx, req, callback);
            } else if (handler && typeof handler == 'object') {
                //! must be `LambdaHandlerService`.
                const $svc: LambdaHandlerService = handler;
                return $svc.handle(ctx, req);
            }
            //! raise error if not found.
            _inf(NS, `WARN! unknown[${type}].event =`, $U.json(event));
            callback && callback(new Error(`400 UNKNOWN - service:${type}`));
        };

        //! call promised.
        const promise = (main: any, ctx: any, req: any): Promise<any> =>
            new Promise((resolve, reject) => {
                try {
                    let resolved = false;
                    const R = main(ctx, req, (error?: any, result?: any) => {
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
        return promise(main, ctx, req)
            .then(_ => {
                // if (_ !== undefined) _log(NS, '! res =', $U.json(_));
                if (_ !== undefined) _log(NS, '! res =', $U.S(_, 320, 64, ' .... ')); //! cut result string.
                // ((context && context.done) || callback)(null, _);
                // return true;
                try {
                    ctx.res = {
                        status: _.statusCode,
                        body: _.body,
                        headers: _.headers
                    };
                } catch (error) {
                    ctx.res = {
                        status: 500,
                        body: error,
                        headers: _.headers
                    };
                }
                return _;
            })
            .catch(e => {
                _err(NS, '! err =', e);
                if (!FunctionHandler.REPORT_ERROR) {
                    // ((context && context.done) || callback)(e, null);
                    // return false;
                    throw e;
                }
                //! report this error.
                return doReportError(e, ctx, req)
                    .catch(_ => _) // safe call w/o error.
                    .then(() => {
                        // ((context && context.done) || callback)(e, null);
                        // return false;
                        throw e;
                    });
            });
    }

    /**
     * handle param via protocol-service.
     * - sub-service could call this method() to bypass request.
     *
     * @param param protocol parameters
     */
    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        //! if valid API Request, then use $web's function.
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
    public async packContext($ctx: any, req: any): Promise<NextContext> {
        const context: NextContext = {};
        $ctx && _log(NS, `! context[${$ctx || ''}] =`, $U.json($ctx));
        return context;
    }
}
