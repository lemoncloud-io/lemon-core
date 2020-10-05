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
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-05-24 initial version in `lemon-todaq-api`.
 * @date        2019-08-01 support `loadJsonSync()` + move common functions + export core services + '$web'
 * @date        2019-08-02 improved type helper with `lemon-engine#2.2.0` + fix $client() error.
 * @date        2019-08-06 improved type helper with `lemon-engine#2.2.3`
 * @date        2019-08-08 improved `$api().do(event, context, callback)`.
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $engine, $U, _log, _inf, _err } from './index';

//! import sub-modules.
import { SlackPostBody, MetricPostBody, CallbackData } from '../common/types';
import { loadJsonSync } from '../tools/shared';
import { AWSSNSService } from '../cores/aws/aws-sns-service';

import * as $lambda from 'aws-lambda';
import { NextContext } from '../cores/core-types';
type Context = $lambda.Context;
type RequestContext = $lambda.APIGatewayEventRequestContext;

//! create SNS Service
const $sns = (arn: string): AWSSNSService => new AWSSNSService(arn);

/**
 * find ARN('lemon-hello-sns') via context information or environment.
 *
 * @param context   the current running context
 * @param NS        namespace to log
 */
export const getHelloArn = (context?: Context | RequestContext | NextContext, NS?: string): string => {
    NS = NS || $U.NS('HELO');

    //! use pre-defined env via `serverless.yml`
    const arn = $engine.environ('REPORT_ERROR_ARN', '') as string;
    if (arn.startsWith('arn:aws:sns:')) return arn;
    if (!context) throw new Error(`@context (RequestContext) is required!`);
    if (true) {
        const target = 'lemon-hello-sns';
        const $ctx: Context = context as Context;
        const $req: RequestContext = context as RequestContext;
        const $ncx: NextContext = context as NextContext;
        //! build arn via context information.
        const invokedFunctionArn = `${$ctx.invokedFunctionArn || ''}`; // if called via lambda call ex: 'arn:aws:lambda:ap-northeast-2:085403634746:function:lemon-messages-api-prod-user'
        const accountId = `${$ncx.accountId || invokedFunctionArn.split(':')[4] || $req.accountId || ''}`;
        const region = invokedFunctionArn.split(':')[3] || `ap-northeast-2`;
        _inf(NS, '! accountId =', accountId);
        if (!accountId) {
            _err(NS, 'ERROR! missing accountId. context =', $U.json(context));
            throw new Error('.accountId is missing');
        }
        return `arn:aws:sns:${region}:${accountId}:${target}`;
    }
};

/**
 * report error via `lemon-hello-sns`.
 *
 * @param e             Error
 * @param context       Lambda Context
 * @param event         Origin Event Object.
 * @param data          Optinal Data(body).
 */
export const doReportError = async (e: Error, context?: any, event?: any, data?: any): Promise<string> => {
    //! ignore only if local express-run.
    if (context && context.source === 'express') return '!ignore';
    const NS = $U.NS('RPTE');
    //TODO - optimize message extractor.
    const $message = (e: any) => {
        const m = (e && (e.message || e.statusMessage)) || e;
        return typeof m == 'object' ? $U.json(m) : `${m}`;
    };
    _log(NS, `doReportError(${$message(e)})...`);

    //! dispatch invoke conditins.
    try {
        const message = $message(e);
        const $pack = (loadJsonSync && loadJsonSync('package.json')) || {};
        const name = (context && context.name) || process.env.NAME || '';
        const stage = (context && context.stage) || process.env.STAGE || '';
        const apiId = (context && context.apiId) || '';
        const domainPrefix = (context && context.domainPrefix) || '';
        const resourcePath = (context && context.resourcePath) || '';
        const identity = (context && context.identity) || {};
        const service = `api://${$pack.name || 'lemon-core'}/${name}-${stage}#${$pack.version || '0.0.0'}`;

        //! prepare payload to publish.
        const payload = {
            service,
            message,
            context: { ...context, stage, apiId, resourcePath, identity, domainPrefix, event },
            data,
        };

        //! find target arn.
        const arn = getHelloArn(context, NS);
        _log(NS, `> report-error.arn =`, arn);
        return $sns(arn)
            .reportError(e, payload, arn)
            .then((mid: string) => {
                _inf(NS, '> err.message-id =', mid);
                return `${mid}`;
            })
            .catch((e: Error) => {
                _err(NS, '! err.report =', e);
                return '';
            });
    } catch (e2) {
        _err(NS, '! err-ignored =', e2);
        return `!err - ${e2.message || e2}`;
    }
};

/**
 * send callback data via web-hook endpoint.
 *
 * TODO - improve function identity.!! @191212.
 *
 * @param data  payload
 */
export const doReportCallback = async (data: CallbackData, service?: string, context?: any): Promise<string> => {
    const NS = $U.NS('callback', 'cyan');
    try {
        const $pack = (loadJsonSync && loadJsonSync('package.json')) || {};
        const stage = `${$U.env('STAGE', 'local')}`.toLowerCase();
        const name = `${$U.env('NAME', '')}`.toLowerCase();
        service = service || `api://${$pack.name || 'lemon-core'}#${$pack.version || '0.0.0'}/${name}-${stage}`;
        const payload = { service, data };
        const arn = getHelloArn(context, NS);
        return $sns(arn)
            .publish('', 'callback', payload) // subject should be 'callback'
            .then((mid: string) => {
                _inf(NS, '> callback.res =', mid);
                return `${mid}`;
            })
            .catch((e: Error) => {
                _err(NS, '! callback.err =', e);
                return '';
            });
    } catch (e) {
        _err(NS, '> reportCallback.err =', e);
        return doReportError(e, context, null, data);
    }
};

/**
 * report slack message via `lemon-hello-sns`.
 *
 * @param channel       channel of slack
 * @param body          slack body
 * @param context       current running context.
 */
export const doReportSlack = async (channel: string, body: SlackPostBody, context?: any): Promise<string> => {
    const NS = $U.NS('RPTS');
    _log(NS, `doReportSlack()...`);
    //! dispatch invoke conditins.
    try {
        const $pack = (loadJsonSync && loadJsonSync('package.json')) || {};
        const service = `api://${$pack.name || 'lemon-core'}#${$pack.version || '0.0.0'}`;
        const stage = (context && context.stage) || '';
        const apiId = (context && context.apiId) || '';
        const domainPrefix = (context && context.domainPrefix) || '';
        const resourcePath = (context && context.resourcePath) || '';
        const identity = (context && context.identity) || {};
        const param = {};

        //! prepare payload to publish.
        const payload = {
            channel,
            service,
            param,
            body,
            context: { stage, apiId, resourcePath, identity, domainPrefix },
        };

        //! find target arn.
        const arn = getHelloArn(context, NS);
        _log(NS, `> report-slack.arn =`, arn);
        return $sns(arn)
            .publish(arn, 'slack', payload)
            .then((mid: string) => {
                _inf(NS, '> sns.message-id =', mid);
                return `${mid}`;
            })
            .catch((e: Error) => {
                _err(NS, '! err.slack =', e);
                return '';
            });
    } catch (e2) {
        _err(NS, '! err-ignored =', e2);
        return `!err - ${e2.message || e2}`;
    }
};

/**
 * report metric-data like chart/graph to record via `lemon-metrics-sns`.
 *
 * @param ns        namespace like `[a-zA-Z][a-zA-Z0-9]+`
 * @param id        id value like `[a-zA-Z0-9][a-zA-Z0-9_:\-]+`
 * @param body      any body data
 * @param context   current running context.
 */
export const doReportMetric = async (ns: string, id: string, body: MetricPostBody, context?: any): Promise<string> => {
    const NS = $U.NS('RPTM');
    //! validate parameters. (see `lemon-metrics-api`)
    const reNs = /^[a-zA-Z][a-zA-Z0-9]+$/;
    const reId = /^[a-zA-Z0-9][a-zA-Z0-9_:\-]+$/;
    if (!reNs.test(ns)) throw new Error('Invalid text-format @ns:' + ns);
    if (!reId.test(id)) throw new Error('Invalid text-format @id:' + id);

    _log(NS, `doReportMetric(${ns},${id})...`);
    //! dispatch invoke conditins.
    try {
        const $pack = (loadJsonSync && loadJsonSync('package.json')) || {};
        const service = `api://${$pack.name || 'lemon-core'}#${$pack.version || '0.0.0'}`;
        const stage = (context && context.stage) || '';
        const apiId = (context && context.apiId) || '';
        const domainPrefix = (context && context.domainPrefix) || '';
        const resourcePath = (context && context.resourcePath) || '';
        const identity = (context && context.identity) || {};
        const param = { ns, id };

        //! prepare payload: `POST /metrics/!/report`
        const payload = {
            service,
            type: 'metrics',
            method: 'post',
            id: '!',
            cmd: 'report',
            param,
            body,
            context: { stage, apiId, resourcePath, identity, domainPrefix },
        };

        //! find metric-arn via error-arn.
        const target = 'lemon-metrics-sns';
        const arn0 = getHelloArn(context, NS);
        // eslint-disable-next-line prettier/prettier
        const arn = arn0.startsWith('arn:aws:sns:') && arn0.split(':').length == 6 ? arn0.split(':').map((v,i)=>i==5?target:v).join(':') : arn0;
        _log(NS, `> report-metric.arn =`, arn);
        return $sns(arn)
            .publish(arn || target, 'metric', payload)
            .then((mid: string) => {
                _inf(NS, '> sns.message-id =', mid);
                return `${mid}`;
            })
            .catch((e: Error) => {
                _err(NS, '! err.metric =', e);
                return '';
            });
    } catch (e2) {
        _err(NS, '! err-ignored =', e2);
        return `!err - ${e2.message || e2}`;
    }
};

/** ****************************************************************************************************************
 *  Common functions.
 ** ****************************************************************************************************************/
export interface ParrallelParam<T> {
    list: T[];
    //! call context.
    context?: any;
    //! optional event
    event?: any;
    //! optional message.
    message?: string;
    //! flag to report error
    reportError?: boolean;
    //! flag to replace error to origin.
    ignoreError?: boolean;
}
export interface ParrallelCallback<T, U> {
    (node: T, index: number): U;
}
/**
 * parrallel actions in list (in batch-size = 10)
 *
 * **TODO** - improve return types by refering callback.
 *
 * @param list          any list
 * @param callback      (item)=>any | Promise<any>
 * @param size          (optional) size
 * @param pos           (optional) current pos
 * @param result        (optional) result set.
 */
export const do_parrallel = <T, U>(
    param: T[] | ParrallelParam<T>,
    callback: ParrallelCallback<T, U>,
    size = 10,
    pos = 0,
    result: (U | Error)[] = [],
): Promise<(U | Error)[]> => {
    size = size === undefined ? 10 : size;
    pos = pos === undefined ? 0 : pos;
    result = result === undefined ? [] : result;
    //! annonymous method of callback
    const safeCall = (n: T, i: number) => {
        try {
            return callback(n, i);
        } catch (e) {
            return Promise.reject(e);
        }
    };
    // _log(NS, `! parrallel(${pos}/${size})`)
    const list = Array.isArray(param) ? param : param.list;
    const list2 = list.slice(pos, pos + size);
    const actions = list2.map((node, i): any => {
        const index = pos + i;
        try {
            //! error proof.
            const R = safeCall(node, index);
            if (R && typeof R == 'object' && R instanceof Promise) {
                const R2: Promise<any> = R as Promise<any>; // avoid compile error.
                return R2.catch(e => {
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
    return Promise.all(actions)
        .then(res => {
            if (Array.isArray(param)) return res;
            const { ignoreError, reportError, event, context, message } = param;
            const errors = res.filter(i => i instanceof Error);
            if (!errors.length) return res;
            const data: any = { message, pos, size };
            data.errors = res.map((_, i) => {
                if (!(_ instanceof Error)) return '';
                return { error: (_ as Error).message, node: list2[i] };
            });
            return (reportError ? doReportError(errors[0], context, event, data) : Promise.resolve('')).then(() => {
                if (ignoreError) {
                    res = res.map((_, i) => (_ instanceof Error ? list2[i] : _));
                }
                return res;
            });
        })
        .then(_ => {
            result = result.concat(_);
            if (!_.length) return Promise.resolve(result);
            return do_parrallel(param, callback, size, pos + size, result);
        });
};

//! default time-zone for this api. (Asia/Seoul - 9 hours)
export const DEFAULT_TIME_ZONE = 9;

//! convert to date of input.
export const convDate = (dt: string | number | Date): Date => $U.dt(dt, DEFAULT_TIME_ZONE);

/**
 * Convert input to time value (in number)
 *
 * @param {*} dt    see `conv_date()`
 * @param {*} name  name of property
 */
export const convDateToTime = (dt: string | number | Date) => {
    if (dt === '' || dt === '0' || dt === 0) return 0; // 0 means null (not-set)
    const t = convDate(dt);
    return t.getTime();
};

/**
 * Convert input (Date) to time-stamp (YYYY-MM-DD hh:mm:ss)
 * - consider with current time-zone.
 *
 * @param {*} dt
 */
export const convDateToTS = (dt: string | number | Date) => {
    const t = convDate(dt);
    return $U.ts(t, DEFAULT_TIME_ZONE);
};
