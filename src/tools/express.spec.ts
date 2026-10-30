/**
 * `tools/express.spec.ts`
 * - test runnder for `tools/express.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-26 initial unit test.
 * @date        2025-05-20 cleanup `express` out of this module.
 * @date        2026-10-31 v5 B20: no `lemon-devkit` — the local API Gateway in lemon-core (express as optional peer).
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import { expect2 } from '../common/test-helper';
import { buildEngine } from '../engine';
import { EnvironmentSet } from '../environ';
import { buildExpress, BuildExpressOptions } from './express';
import { loadJsonSync } from './tools';
import { AddressInfo } from 'net';
import $cores, { NextDecoder, NextHandler } from '../cores/index';
import request from 'supertest';

/**
 * local test instance
 */
export const instance = (scope = global, env?: EnvironmentSet, opts?: BuildExpressOptions) => {
    // STEP.1 - build basic engine
    const $engine = buildEngine(scope, { env: { ...env } });
    const genRequestId = () => 'express-test-request';

    // STEP.2 - build express factory.
    const $web = $cores.lambda.web;
    $web.setHandler('test', decode_next_handler);
    /** factory function to build express */
    const $express = () => buildExpress($engine, $web, { genRequestId, ...opts });
    return { $engine, $express };
};

//* router of `/test/:id/:cmd?`
const decode_next_handler: NextDecoder = (mode, id, cmd): NextHandler => {
    switch (mode) {
        case 'LIST':
        case 'GET':
            return async () => ({ hello: `${mode} /null/${id ?? '-'}/${cmd ?? '-'}` });
    }
    return;
};

//! main test body.
describe('express', () => {
    it('should pass basic buildExpress', async () => {
        expect2(() => buildExpress(null, null)).toEqual('$engine(LemonEngine) is required - buildExpress()');
        expect2(() => buildExpress({} as any, null)).toEqual('$web(LambdaWEBHandler) is required - buildExpress()');
    });

    //* v5 B20: `express` is an optional peer (+ devDependency here); no `lemon-devkit` is needed.
    it('should declare express as an optional peer (B20)', async () => {
        const $pack = loadJsonSync('package.json');
        expect2(() => $pack.peerDependencies['express']).toEqual('^4.21.2 || ^5.0.0');
        expect2(() => $pack.peerDependenciesMeta['express']).toEqual({ optional: true });
        expect2(() => !!$pack.devDependencies['express']).toEqual(true);
    });

    //* v5 B20: missing `express` → a clear message; a loader error is passed as is.
    it('should fail clearly w/o express (B20)', async () => {
        const missing: BuildExpressOptions = { loadModule: () => null };
        expect2(() => instance(null, {}, missing).$express()).toEqual(
            'express(module) is required (npm i -D express) - buildExpress()',
        );
        const opts: BuildExpressOptions = {
            loadModule: (mod: string) => {
                throw new Error(`loadModule(${mod}) is not supported!`);
            },
        };
        const { $express } = instance(null, { LS: '1' }, opts);
        expect2(() => $express()).toEqual('loadModule(express) is not supported!');
        //* an ESM namespace (`{ default: express }`) is accepted.
        const esm: BuildExpressOptions = { loadModule: <T>(mod: string) => ({ default: require(mod) } as T) };
        expect2(() => Object.keys(instance(null, {}, esm).$express())).toEqual(['express', 'app', 'createServer']);
    });

    //* v5 B20: the banner of `GET /` (no `serverless.yml` here → legacy routes) and a legacy route.
    it('should pass buildExpress w/ banner and legacy routes (B20)', async () => {
        const $pack = loadJsonSync('package.json');
        const { $express } = instance();
        const $res = $express();
        expect2(() => Object.keys($res)).toEqual(['express', 'app', 'createServer']);

        const app = $res.app;
        const res: any = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`lemon-core/${$pack.version}`);
        expect2(() => res.text.split('\n')[1]).toEqual(`lemon-core/`);

        const hello: any = await request(app).get('/test/a/b');
        expect2(() => hello.body).toEqual({ hello: 'GET /null/a/b' });
        const list: any = await request(app).get('/test');
        expect2(() => list.body).toEqual({ hello: 'LIST /null//' });
    });

    //* v5 B20: `createServer()` listens on `--port` (0 = any) and initializes the engine on listening.
    it('should listen on --port and initialize the engine (B20)', async () => {
        const { $engine, $express } = instance(global, {}, { argv: ['node', 'express', '--port', '0'] });
        const spy = vi.spyOn($engine, 'initialize');
        const server = $express().createServer();
        await new Promise<void>(resolve => server.on('listening', () => resolve()));
        const port = (server.address() as AddressInfo).port;
        expect2(() => port > 0).toEqual(true);
        expect2(() => spy.mock.calls.length).toEqual(1);
        const res: any = await request(`http://127.0.0.1:${port}`).get('/test/1');
        expect2(() => res.body).toEqual({ hello: 'GET /null/1/' });
        await new Promise(resolve => server.close(resolve));
    });
});
