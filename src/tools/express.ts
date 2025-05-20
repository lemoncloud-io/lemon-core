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

//* create Server Instance.
//NOTE - avoid external reference of type.
export const buildExpress = (
    $engine: LemonEngine,
    $web: LambdaWEBHandler,
    options?: { argv?: string[]; prefix?: string; genRequestId?: () => string },
): { express: () => any; app: any; createServer: () => any } => {
    const errScope = `buildExpress()`;
    if (!$engine) throw new Error(`$engine(LemonEngine) is required - ${errScope}`);
    if (!$web) throw new Error(`$web(LambdaWEBHandler) is required - ${errScope}`);
    options = options || {};

    const _factory = (options: any): ExpressFactory => {
        return null;
    };
    const $factory = _factory(options);
    return $factory($engine, $web, options);
};
