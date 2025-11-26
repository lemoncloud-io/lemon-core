/**
 * `tools/express.spec.ts`
d * - test runner for `tools/express.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-26 initial unit test.
 * @date        2025-05-20 cleanup `express` out of this module.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { expect2 } from '../common/test-helper';
import { buildEngine } from '../engine';
import { EnvironmentSet } from '../environ';
import { buildExpress, BuildExpressOptions } from './express';
import { loadJsonSync } from './tools';
import $cores, { NextDecoder, NextHandler } from '../cores/index';
import request from 'supertest';

const createEngine = () =>
    ({
        err: jest.fn(),
        inf: jest.fn(),
        log: jest.fn(),
    } as any);

const createWeb = () =>
    ({
        setHandler: jest.fn(),
    } as any);

const mockDevkitFactory = () => ({
    buildExpress: jest.fn(() => ({
        express: () => 'express-app',
        app: { name: 'mock-app' },
        createServer: jest.fn(),
    })),
});

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

const checkDevKit = (): boolean => {
    const $pack = loadJsonSync('package.json');
    const devkit = $pack.dependencies['lemon-devkit'] || $pack.devDependencies['lemon-devkit'];
    return !!devkit;
};

//! main test body.
describe('express', () => {
    it('should pass basic buildExpress', async () => {
        expect2(() => buildExpress(null, null)).toEqual('$engine(LemonEngine) is required - buildExpress()');
        expect2(() => buildExpress({} as any, null)).toEqual('$web(LambdaWEBHandler) is required - buildExpress()');
    });

    //* test w/o devkit
    it('should pass buildExpress w/o devkit', async () => {
        const hasDevkit = checkDevKit();
        if (hasDevkit) return; // ignore.

        const $pack = loadJsonSync('package.json');
        expect2(() => $pack.devDependencies['lemon-devkit']).toEqual();

        const { $express } = instance();
        expect2(() => $express()).toEqual('lemon-devkit(module) is required (npm i -D lemon-devkit) - buildExpress()');
    });

    //* test w/o devkit + loadModule
    it('should pass buildExpress w/o devkit', async () => {
        const hasDevkit = checkDevKit();
        if (hasDevkit) return; // ignore.

        const opts: BuildExpressOptions = {
            loadModule: (mod: string) => {
                throw new Error(`loadModule(${mod}) is not supported!`);
            },
        };
        const { $express } = instance(null, { LS: '1' }, opts);
        expect2(() => $express()).toEqual('loadModule(lemon-devkit) is not supported!');
    });

    //* test w/ devkit
    it('should pass buildExpress w/ devkit', async () => {
        const hasDevkit = checkDevKit();
        if (!hasDevkit) return; // ignore.

        const $pack = loadJsonSync('package.json');
        expect2(() => $pack.devDependencies['lemon-devkit']).toEqual('^0.0.6');

        const { $express } = instance();
        const $res = $express();
        expect2(() => Object.keys($res)).toEqual(['express', 'app', 'createServer']);

        const app = $res.app;
        const res: any = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`lemon-core/${$pack.version}`);
    });
});

describe('express', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should validate required parameters', () => {
        const options: BuildExpressOptions = {
            loadModule: (() => mockDevkitFactory()) as any,
        };
        expect2(() => buildExpress(null as any, null as any, options)).toEqual(
            '$engine(LemonEngine) is required - buildExpress()',
        );
        expect2(() => buildExpress({} as any, null as any, options)).toEqual(
            '$web(LambdaWEBHandler) is required - buildExpress()',
        );
    });

    it('should throw when devkit module is missing', () => {
        const options: BuildExpressOptions = {
            loadModule: () => {
                const err = new Error('lemon-devkit(module) is required (npm i -D lemon-devkit) - buildExpress()');
                throw err;
            },
        };
        expect2(() => buildExpress(createEngine(), createWeb(), options)).toEqual(
            'lemon-devkit(module) is required (npm i -D lemon-devkit) - buildExpress()',
        );
    });

    it('should rethrow unexpected module error', () => {
        const options: BuildExpressOptions = {
            loadModule: () => {
                throw new Error('unknown failure');
            },
        };
        expect2(() => buildExpress(createEngine(), createWeb(), options)).toEqual('unknown failure');
    });

    it('should throw when devkit factory is missing', () => {
        const options: BuildExpressOptions = {
            loadModule: () => ({} as any),
        };
        expect2(() => buildExpress(createEngine(), createWeb(), options)).toEqual(
            '@buildExpress (function) is required (invalid devkit) - buildExpress()',
        );
    });

    it('should throw when loadModule returns null', () => {
        const options: BuildExpressOptions = {
            loadModule: ((): any => null) as any,
        };
        expect2(() => buildExpress(createEngine(), createWeb(), options)).toEqual(
            'lemon-devkit(module) is required (npm i -D lemon-devkit) - buildExpress()',
        );
    });

    it('should propagate custom loadModule errors', () => {
        const options: BuildExpressOptions = {
            loadModule: () => {
                throw new Error('loadModule(lemon-devkit) failed');
            },
        };
        expect2(() => buildExpress(createEngine(), createWeb(), options)).toEqual('loadModule(lemon-devkit) failed');
    });

    it('should delegate to devkit buildExpress', () => {
        const mockDevkit = mockDevkitFactory();
        const options: BuildExpressOptions = {
            loadModule: (() => mockDevkit) as any,
        };
        const engine = createEngine();
        const web = createWeb();
        const genRequestId = jest.fn(() => 'req-1');
        const result = buildExpress(engine, web, { ...options, prefix: '/api', genRequestId });

        expect2(() => mockDevkit.buildExpress.mock.calls.length).toEqual(1);
        expect2(() => result.express()).toEqual('express-app');
        expect2(() => result.app.name).toEqual('mock-app');
        expect2(() => typeof result.createServer).toEqual('function');
    });
});
