/* eslint-disable prettier/prettier */
/** ********************************************************************************************************************
 *  boot loading for global instance manager
 ** *******************************************************************************************************************/
/**
 * main creation function of lemon instance pool (LIP)
 *
 *
 * options : {
 *     name : string    - name of module.
 *     env : object     - environment settings.
 * }
 *
 * @param scope         main scope like global, browser, ...
 * @param options       configuration.
 */
import { EnginePluggable, EngineOption, EngineLogger, EngineConsole, LemonEngine } from './common/types'
import { Utilities } from './core/utilities';
import * as _ from "lodash";
export * from './common/types';

//! load common services....
import buildModel, { LemonEngineModel } from './core/lemon-engine-model';

import httpProxy, { HttpProxy } from './plugins/http-proxy';
import webProxy, { WebProxy } from './plugins/web-proxy';
import mysql, { MysqlProxy } from './plugins/mysql-proxy';
import dynamo, { DynamoProxy } from './plugins/dynamo-proxy';
import redis, { RedisProxy } from './plugins/redis-proxy';
import elastic6, { Elastic6Proxy } from './plugins/elastic6-proxy';
import s3, { S3Proxy } from './plugins/s3-proxy';
import sqs, { SQSProxy } from './plugins/sqs-proxy';
import sns, { SNSProxy } from './plugins/sns-proxy';
import ses, { SESProxy } from './plugins/ses-proxy';
import cognito, { CognitoProxy } from './plugins/cognito-proxy';
import lambda, { LambdaProxy } from './plugins/lambda-proxy';
import protocol, { ProtocolProxy } from './plugins/protocol-proxy';
import cron, { CronProxy } from './plugins/cron-proxy';
import agw, { AGWProxy } from './plugins/agw-proxy';

export { LemonEngineModel, MysqlProxy, DynamoProxy, RedisProxy, Elastic6Proxy }
export { HttpProxy, WebProxy, S3Proxy, SQSProxy, SNSProxy, SESProxy }
export { CognitoProxy, LambdaProxy, ProtocolProxy, CronProxy, AGWProxy }

/**
 * initialize as EngineInterface
 *
 * ```ts
 * import engine from 'lemon-engine';
 * const $engine = engine(global, { env: process.env });
 * ```
 *
 * @param scope         main scope like global, browser, ...
 * @param options       configuration.
 */
export default function initiate(scope: {_$?: LemonEngine; [key: string]: any } = null, options: EngineOption = {}): LemonEngine {
    scope = scope || {};

    //! load configuration.
    const ROOT_NAME = options.name || 'lemon';
    const STAGE = _environ('STAGE', '');
    const LS = (_environ('LS', '0') === '1');                                                   // LOG SILENT (NO PRINT LOG)
    const TS = (_environ('TS', '1') === '1');                                                   // PRINT TIME-STAMP.
    const LC = (_environ('LC', STAGE === 'local' || STAGE === 'express' ? '1' : '') === '1');   // COLORIZE LOG
    // console.log('!!!!!!! LS,TS,LC =', LS, TS, LC);

    const LEVEL_LOG = '-';
    const LEVEL_INF = 'I';
    const LEVEL_ERR = 'E';

    const RED = "\x1b[31m";
    const BLUE = "\x1b[32m";
    const YELLOW = "\x1b[33m";
    const RESET = "\x1b[0m";

    function _environ(name: string, defVal: any){
        // as default, load from proces.env.
        const env =  options.env || (process && process.env) || {};
        const val = env[name];
        // throw Error if value is not set.
        if (defVal && defVal instanceof Error && val === undefined) throw defVal;
        // returns default.
        return val === undefined ? defVal : val;
    }

    // timestamp like 2016-12-08 13:30:44
    function _ts(date?: undefined | number | Date, timeZone?: number) {
        return Utilities.timestamp(date, timeZone);
    }

    //! common function for logging.
    const silent = () => {};
    const $console: EngineConsole = {
        thiz: console,
        log: LS ? silent : console.log,
        error: LS ? silent : console.error,
        auto_ts: TS,
        auto_color: LC
    };
    const _log: EngineLogger = function (...arg: any[]) {
        let args = !Array.isArray(arguments) && Array.prototype.slice.call(arguments) || arguments;
        if ($console.auto_color) args.unshift(RESET), $console.auto_ts && args.unshift(_ts(), LEVEL_LOG) || args.unshift(LEVEL_LOG), args.unshift(BLUE);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_LOG);
        return $console.log.apply($console.thiz, args)
    }
    const _inf: EngineLogger = function (...arg: any[]) {
        let args = !Array.isArray(arguments) && Array.prototype.slice.call(arguments) || arguments;
        if ($console.auto_color) args.unshift(""), args.push(RESET), $console.auto_ts && args.unshift(_ts(), LEVEL_INF) || args.unshift(LEVEL_INF), args.unshift(YELLOW);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_INF);
        return $console.log.apply($console.thiz, args)
    }
    const _err: EngineLogger = function (...arg: any[]) {
        let args = !Array.isArray(arguments) && Array.prototype.slice.call(arguments) || arguments;
        if ($console.auto_color) args.unshift(""), args.push(RESET), $console.auto_ts && args.unshift(_ts(), LEVEL_ERR) || args.unshift(LEVEL_ERR), args.unshift(RED);
        else $console.auto_ts && args.unshift(_ts(), LEVEL_ERR);
        return $console.error.apply($console.thiz, args)
    }
    const _extend = (opt: any, opts: any) => {      // simple object extender.
        for (let k in opts) {
            let v = opts[k];
            if (v === undefined) delete opt[k];
            else opt[k] = v;
        }
        return opt;
    }

    //! create root instance to manage global objects.
    const $engineBuilder = (): LemonEngine =>{
        //! engine base function.
        const $engineBase = function(name: string, service: EnginePluggable): EnginePluggable {                                // global identifier.
            if (!name) return;
            const thiz: any = $engine;
            let org = typeof thiz.$plugins[name] !== 'undefined' ? thiz.$plugins[name] : undefined;
            if (!service) return org;
            if (org === undefined) {
                _log(`INFO! service[${name}] registered`);
                thiz.$plugins[name] = service;
                return service;
            } else if (true) {
                //! ignore if duplicated >2.2.3
                // _log(`WARN! service[${name}] duplicated!`);
                return org;
            } else {
                //! extends options.
                _inf(`WARN! service[${name}] extended.`);
                org = _extend(org, service);
                thiz.$plugins[name] = org;
                return org;
            }
        };

        //! avoid type check error.
        const $engine: LemonEngine = $engineBase as LemonEngine;

        //! register into _$(global instance manager).
        $engine.STAGE = STAGE;
        $engine.id = ROOT_NAME;
        $engine.log = _log;
        $engine.inf = _inf;
        $engine.err = _err;
        $engine.extend = _extend;
        $engine.ts = _ts;
        $engine.dt = Utilities.datetime;
        $engine._ = _;
        $engine.environ = _environ;
        $engine.$console = $console; // '$' means object. (change this in order to override log/error message handler)
        $engine.$plugins = {};
        $engine.toString = () => `${ROOT_NAME}`;

        const $U = new Utilities($engine);
        $engine.U = $U;

        //! make http-proxy.
        $engine.createHttpProxy = (name, options) => {
            return httpProxy($engine, name, options);
        };

        //! make web-proxy
        $engine.createWebProxy = (name: string, options?: {headers: any}) => {
            return webProxy($engine, name, options);
        }

        //! model builder.
        $engine.createModel = (name: string, option: any) => {
            return buildModel($engine, name, option);
        }

        //! start initialization only if making $engine.
        STAGE && _inf('#STAGE =', STAGE);

        //! use base BACKBONE endpoint.
        const BACKBONE = $engine.environ('BACKBONE_API', $engine.environ('BACKBONE-API', ''));
        BACKBONE && _inf('#BACKBONE =', BACKBONE);
        const ep = (name: string)=> (BACKBONE && `${BACKBONE}/${name}`) || '';

        //! load common services....
        mysql($engine, 'MS', ep('mysql'));           // load service, and register as 'MS'
        dynamo($engine, 'DS', ep('dynamo'));         // load service, and register as 'DS'
        redis($engine, 'RS', ep('redis'));           // load service, and register as 'RS'
        elastic6($engine, 'ES6', ep('elastic6'));    // load service, and register as 'ES6'
        s3($engine, 'S3', ep('s3'));                 // load service, and register as 'S3'
        sqs($engine, 'SS', ep('sqs'));               // load service, and register as 'SS'
        sns($engine, 'SN', ep('sns'));               // load service, and register as 'SN'
        ses($engine, 'SE', ep('ses'));               // load service, and register as 'SE'
        webProxy($engine, 'WS', ep('web'));          // load service, and register as 'WS'
        cognito($engine, 'CS', ep('cognito'));       // load service, and register as 'CS'
        lambda($engine, 'LS', ep('lambda'));         // load service, and register as 'LS'
        protocol($engine, 'PR', ep('protocol'));     // load service, and register as 'PR'
        cron($engine, 'CR', ep('cron'));             // load service, and register as 'CR'
        agw($engine, 'AG', ep('agw'));               // load service, and register as 'AG'
        _inf(`! engine[${ROOT_NAME}] service ready !`);

        //! returns.
        return $engine;
    }

    //! reuse via scope or build new.
    const $engine: LemonEngine = scope._$ || $engineBuilder();

    //! register as global instances.
    scope._log = scope._log || _log;
    scope._inf = scope._inf || _inf;
    scope._err = scope._err || _err;
    scope._$ = $engine;

    //! returns finally.
    return $engine;
}
