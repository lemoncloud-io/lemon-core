/**
 * Express Server Application.
 * - standalone http service with express.
 *
 *
 * ```bash
 * #run-server (use lemon.yml:local)
 * $ npm install -g nodemon
 * $ ENV=lemon STAGE=local nodemon express.js
 * ```
 *
 * [TODO]
 * - [ ] 190801 proper content type `text/plain`
 * - [x] 190801 change router underscore char like `loopers_front` -> `loopers-front`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-31 support ECMA 2016.
 * @date        2019-08-01a auto register api with pattern. `/^[a-z][a-z0-9\-_]+$/`
 * @date        2019-08-07 ignore `engine.dt` function.
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 * @date        2020-01-23 improve context information via headers.
 * @date        2025-05-20 cleanup `express` out of this module.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { GETERR } from '../common/test-helper';
import { LemonEngine } from '../engine/types';
import { LambdaWEBHandler } from '../cores/lambda/lambda-web-handler';

/**
 * type: `ExpressFactory`
 * - factory to create express server.
 */
export interface ExpressFactory {
    (
        $engine: LemonEngine,
        $web: LambdaWEBHandler,
        options?: { argv?: string[]; prefix?: string; genRequestId?: () => string },
    ): ExpressFactoryResult;
}

/**
 * type: `ExpressFactoryResult`
 * - result of factory.
 */
export interface ExpressFactoryResult {
    /** function of `express()` from `npm/express` */
    express: () => any;
    /** instance of `express()` */
    app: any;
    /** create server listener */
    createServer: (...args: any[]) => any;
}

/**
 * type: `BuildExpressOptions`
 * - options for `buildExpress()`
 */
export interface BuildExpressOptions {
    /** run arguments */
    argv?: string[];
    /** prefix as ROUTE_PREFIX */
    prefix?: string;
    /** request-id generator */
    genRequestId?: () => string;
    /** (optional) loader of module */
    loadModule?: <T = any>(mod: string) => T;
}

/**
 * create Server Instance.
 *
 * @param $engine - LemonEngine by `buildEngine()`
 * @param $web - LambdaWEBHandler in `$cores`
 */
export const buildExpress = (
    $engine: LemonEngine,
    $web: LambdaWEBHandler,
    options?: BuildExpressOptions,
): ExpressFactoryResult => {
    const errScope = `buildExpress()`;
    // STEP.0 validate parameters.
    if (!$engine) throw new Error(`$engine(LemonEngine) is required - ${errScope}`);
    if (!$web) throw new Error(`$web(LambdaWEBHandler) is required - ${errScope}`);

    // STEP.1 check the `lemon-devkit` module.
    const _load = (mod: string) => {
        if (options?.loadModule) return options.loadModule(mod);

        try {
            return require(mod);
        } catch (e) {
            $engine?.err?.(`! err =`, e);
            const error = `${e?.message ?? GETERR(e)}`.toLowerCase();
            if (error.includes('cannot find module')) return null;
            throw e;
        }
    };
    const devkit = _load('lemon-devkit');
    if (!devkit) throw new Error(`lemon-devkit(module) is required (npm i -D lemon-devkit) - ${errScope}`);

    const _factory: ExpressFactory = devkit?.buildExpress;
    if (!_factory) throw new Error(`@buildExpress (function) is required (invalid devkit) - ${errScope}`);
    return _factory($engine, $web, options);
};
