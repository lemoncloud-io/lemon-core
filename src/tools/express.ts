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
 * @date        2026-10-31 v5 B20: a local API Gateway (REST v1) emulator in lemon-core (no `lemon-devkit`).
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import http from 'http';
import { GETERR } from '../common/test-helper';
import { LemonEngine } from '../engine/types';
import { LambdaWEBHandler } from '../cores/lambda/lambda-web-handler';
import { loadJsonSync } from './tools';
import { loadRouteTable } from './local-gateway/routes';
import { createLocalGateway, readFrontBody } from './local-gateway/gateway';
import { errorReply, sendReply } from './local-gateway/response';
import { PayloadTooLargeError } from './local-gateway/event';

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
    /** prefix as ROUTE_PREFIX (v5 B20: ignored — the routes come from `serverless.yml`) */
    prefix?: string;
    /** request-id generator (default uuid) */
    genRequestId?: () => string;
    /** (optional) loader of module (used for `express`) */
    loadModule?: <T = any>(mod: string) => T;
    /** (optional) v5 B20: path of `serverless.yml` from `process.cwd()` (default `serverless.yml`) */
    serverlessFile?: string;
    /** (optional) v5 B20: more binary media types (added to `provider.apiGateway.binaryMediaTypes`) */
    binaryMediaTypes?: string[];
    /** (optional) v5 B20: `requestContext.stage` (default env `STAGE`, else `local`) */
    stage?: string;
}

//* v5 B20: value of `-<name> <value>` / `--<name> <value>` in argv (number if the default is a number).
const runParam = (name: string, defval: number, argv: string[]): number => {
    const i = [`-${name}`, name, `--${name}`].map(k => argv.indexOf(k)).find(i => i >= 0);
    if (i === undefined || argv[i + 1] === undefined) return defval;
    const n = Math.round(Number(argv[i + 1]));
    return Number.isFinite(n) ? n : defval;
};

/**
 * create Server Instance.
 * - v5 B20: a local API Gateway (REST v1) emulator: routes of `serverless.yml` (`{param}`, `{proxy+}`, `ANY`),
 *   REST v1 events, binary bodies by `binaryMediaTypes`, CORS preflight, API Gateway errors (403/413/502).
 * - `express` is an optional peer (`npm i -D express`); routes added to `app` later still win over the gateway.
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

    // STEP.1 load the `express` module (optional peer).
    const _load = (mod: string) => {
        if (options?.loadModule) return options.loadModule(mod);
        try {
            return require(mod);
        } catch (e) {
            const error = `${e?.message ?? GETERR(e)}`.toLowerCase();
            if (error.includes('cannot find module')) return null;
            throw e;
        }
    };
    const $mod = _load('express');
    //* v5 B20: `express` (CJS function, or an ESM namespace with `default`).
    const express: () => any = typeof $mod === 'function' ? $mod : $mod?.default;
    if (typeof express !== 'function') throw new Error(`express(module) is required (npm i -D express) - ${errScope}`);

    // STEP.2 the route table and the gateway.
    const $U = $engine.U;
    const NS = $U.NS('EXPR', 'cyan');
    const table = loadRouteTable({
        serverlessFile: options?.serverlessFile,
        binaryMediaTypes: options?.binaryMediaTypes,
    });
    if (table.warning) $engine.inf(NS, table.warning);
    else
        $engine.inf(
            NS,
            `! local-gateway: ${table.routes.length} routes (binary: ${table.binaryMediaTypes.join(',') || '-'})`,
        );
    const stage = `${options?.stage || $engine.environ('STAGE', '') || 'local'}`;
    const gateway = createLocalGateway($engine, $web, { table, stage, genRequestId: options?.genRequestId });

    // STEP.3 the app: a front body reader first, the gateway kept as the last layer.
    const app: any = express();
    //* v5 B20: no `X-Powered-By` (API Gateway does not send it).
    app.disable?.('x-powered-by');
    //* v5 B20: the gateway as express middleware (catch-all, no path pattern → works with Express 4 and 5).
    const gatewayLayer = (req: any, res: any) => {
        gateway(req, res);
    };
    //* v5 B20: the router stack of Express 4 (`_router`) or 5 (`router`).
    const stackOf = (): any[] => {
        if (app._router?.stack) return app._router.stack;
        try {
            return app.router?.stack;
        } catch (e) {
            return undefined;
        }
    };
    //* v5 B20: keep the gateway as the last layer, so routes added after `buildExpress()` (e.g. `/echo`) win.
    let mounted = false;
    const ensureLast = () => {
        if (!mounted) {
            mounted = true;
            app.use(gatewayLayer);
            return;
        }
        //* move it to the end only when the stack is known (the layer is always after this front reader).
        const stack = stackOf();
        const idx = stack ? stack.findIndex((l: any) => l?.handle === gatewayLayer) : -1;
        if (idx >= 0 && idx !== stack.length - 1) stack.push(stack.splice(idx, 1)[0]);
    };
    app.use((req: any, res: any, next: any) => {
        ensureLast();
        readFrontBody(req)
            .then(() => next())
            .catch((e: any) => {
                if (e instanceof PayloadTooLargeError) return sendReply(res, errorReply(413, 'Request Too Long'));
                next(e);
            });
    });

    // STEP.4 the server.
    const $pack: any = loadJsonSync('package.json');
    const argv = options?.argv || process?.argv || [];
    const PORT = runParam('port', $U.N($pack.port, 8081), argv);
    const createServer = () => {
        const name = $pack.name || 'LEMON API';
        const version = $pack.version || '0.0.0';
        const server = http
            .createServer(app)
            .listen(PORT, () => {
                $engine.inf(NS, `###### express[${name}@${$U.NS(version, 'cyan')}] ######`);
            })
            .on('listening', () => {
                const addr: any = server.address();
                $engine.log(NS, `Server[${process.env.NAME}:${process.env.STAGE}] is listening on Port:${addr?.port}`);
                $engine.initialize();
            })
            .on('error', (e: any) => {
                $engine.inf(NS, '!ERR - listen.err = ', e);
            });
        return server;
    };

    return { express, app, createServer };
};
