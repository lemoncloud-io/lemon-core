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
//! create engine in global scope (WARN! should run top level)
import engine, { LemonEngine } from '../engine/index';
export const $engine: LemonEngine = engine(global, { env: process.env });

//! re-use core modules.
export const $U = $engine.U;
export const $_ = $engine._;
if (!$U) throw new Error('$U(utilities) is required!');
if (!$_) throw new Error('$_(lodash) is required!');

//! export common(log) functions
export const _log = $engine.log;
export const _inf = $engine.inf;
export const _err = $engine.err;

//! import sub-modules.
import { SlackPostBody, MetricPostBody } from '../common/types';
import { loadJsonSync } from '../tools/shared';
import { SNS } from '../service/sns-service';

//! find ARN('lemon-hello-sns') via context information or environment.
export const getHelloArn = async (context: any, NS: string) => {
    const target = 'lemon-hello-sns';
    //! use pre-defined env via `serverless.yml`
    const arn = $engine.environ('REPORT_ERROR_ARN', '') as string;
    if (arn.startsWith('arn:aws:sns:')) return arn;
    //! build arn via context information.
    const invokedFunctionArn = (context && context.invokedFunctionArn) || ''; // if called via lambda call.
    const accountId = (invokedFunctionArn && invokedFunctionArn.split(':')[4]) || (context && context.accountId) || '';
    const region = (invokedFunctionArn && invokedFunctionArn.split(':')[3]) || `ap-northeast-2`; //TODO - detecting region.
    _inf(NS, '! accountId =', accountId);
    if (!accountId) {
        _err(NS, 'WARN! account-id is empty.');
        _inf(NS, '! current ctx =', $U.json(context));
        throw new Error('.accountId is missing');
    }
    return `arn:aws:sns:${region}:${accountId}:${target}`;
};

/**
 * report error via `lemon-hello-sns`.
 *
 * @param e             Error
 * @param context       Lambda Context
 * @param event         Event Information
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
            context: { stage, apiId, resourcePath, identity, domainPrefix, event },
            data,
        };

        //! find target arn.
        const arn = await getHelloArn(context, NS).catch(() => '');
        _log(NS, `> report-error.arn =`, arn);
        if (!SNS) throw new Error(`.$sns(sns-service) is required!`);
        return SNS.reportError(e, payload, arn)
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

//! report slack body via `lemon-hello-sns`.
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
        const arn = await getHelloArn(context, NS).catch(() => '');
        _log(NS, `> report-slack.arn =`, arn);
        if (!SNS) throw new Error(`.$sns(sns-service) is required!`);
        return SNS.publish(arn, 'slack', payload)
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

//! report metric body via `lemon-metrics-sns`.
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
        const arn0 = await getHelloArn(context, NS).catch(() => '');
        // eslint-disable-next-line prettier/prettier
        const arn = arn0.startsWith('arn:aws:sns:') && arn0.split(':').length == 6 ? arn0.split(':').map((v,i)=>i==5?target:v).join(':') : arn0;
        _log(NS, `> report-metric.arn =`, arn);
        if (!SNS) throw new Error(`.$sns(sns-service) is required!`);
        return SNS.publish(arn || target, 'metric', payload)
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
    // _log(NS, `! parrallel(${pos}/${size})`)
    const list = Array.isArray(param) ? param : param.list;
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
