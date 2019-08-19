/* eslint-disable @typescript-eslint/no-var-requires */
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
 * @author  Steve Jung <steve@lemoncloud.io>
 * @date    2019-07-31 support ECMA 2016.
 * @date    2019-08-01a auto register api with pattern. `/^[a-z][a-z0-9\-_]+$/`
 * @date    2019-08-07 ignore `engine.dt` function.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { LemonEngine, EnginePluggable } from 'lemon-engine';
import { loadJsonSync, getRunParam } from './shared';
import $WSC from '../builder/WSC';

import AWS from 'aws-sdk';
import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import http from 'http';

//! create Server Instance.
export const buildExpress = ($engine: LemonEngine, options: any = null) => {
    if (!$engine) throw new Error('$engine is required!');
    options = options || {};
    /** ****************************************************************************************************************
     *  Common Constants
     ** ****************************************************************************************************************/
    //! re-use core modules.
    const $U = $engine.U;
    const $_ = $engine._;
    if (!$U) throw new Error('$U(utilities) is required!');
    if (!$_) throw new Error('$_(lodash) is required!');

    //! load common(log) functions
    const _log = $engine.log;
    const _inf = $engine.inf;
    const _err = $engine.err;

    const NS = $U.NS('EXPR', 'cyan');
    const $pack = loadJsonSync('package.json');
    const argv = options.argv || process.argv || [];

    const NAME = $pack.name || 'LEMON API';
    const VERS = $pack.version || '0.0.0';
    const PORT = getRunParam('-port', $U.N($pack.port, 8081), argv); // default server port.
    const IS_WSC = getRunParam('-wsc', false, argv); // default server port.
    _inf(NS, `###### express[${NAME}@${$U.NS(VERS, 'cyan')}] ######`);
    IS_WSC && _inf(NS, `! IS_WSC=`, IS_WSC);

    //! dynamic loading credentials by profile. (search PROFILE -> NAME)
    (() => {
        const NAME = $engine.environ('NAME', '') as string;
        const profile = $engine.environ('PROFILE', NAME) as string;
        const credentials = new AWS.SharedIniFileCredentials({ profile });
        AWS.config.credentials = credentials;
    })();

    /** ****************************************************************************************************************
     *  Initialize Express
     ** ****************************************************************************************************************/
    //! create express app.
    const app = express();
    const uploader = multer({ dest: '../tmp/' });
    app.use(bodyParser.json({ limit: '10mb' })); //default limit 100kb

    //! middle ware
    const middle = (req: any, res: any, next: any) => {
        //! prepare event
        const event = {
            queryStringParameters: req.query || {},
            pathParameters: req.params,
            httpMethod: req.method,
            connection: req.connection,
            url: req.url,
            headers: req.headers,
            body: req.body,
        };
        const context = { source: 'express' };
        const callback = (err: any, data: any) => {
            if (data.headers) {
                Object.keys(data.headers).map(k => res.setHeader(k, data.headers[k]));
            }
            res.setHeader('Content-Type', 'application/json');
            res.status(data.statusCode || 200).send(data.body);
        };

        //! attach to req.
        req.$event = event;
        req.$context = context;
        req.$callback = callback;

        //! use json parser or multer.
        const method = req.method || '';
        const ctype = (req.headers && req.headers['content-type']) || '';
        // _log(NS, '!',method,':', url,' - ', ctype);

        if (ctype.indexOf('multipart/') >= 0) {
            const parser = uploader.single('file');
            parser(req, res, () => {
                // _inf(NS, '> body =', req.body);
                event.body = req.body || {};
                event.body.file = req.file;
                next();
            });
        } else if (method === 'POST' || method === 'PUT') {
            const parser = bodyParser.json({ limit: '10mb' });
            parser(req, res, () => {
                // _inf(NS, '> body =', req.body);
                event.body = req.body;
                next();
            });
        } else {
            next();
        }
    };

    /** ********************************************************************************************************************
     *  ROUTE SETTING
     ** *******************************************************************************************************************/
    //! default app.
    app.get('', (req: any, res: any) => {
        res.status(200).send(NAME);
    });

    //! get target handler.
    const API = (type: string) => {
        return $engine(type) || ((x: any) => x[type])($engine);
    };

    //! handler map.
    const handlers = (() => {
        //! register automatically endpont.
        const RESERVES = 'id,log,inf,err,extend,ts,dt,environ'.split(',');
        const isValidName = (name: string) => /^[a-z][a-z0-9\-_]+$/.test(name) && RESERVES.indexOf(name) < 0;
        const keys = Object.keys($engine);
        //TODO - optimize to config.
        const $conf: any = $engine;
        const ROUTE_PREFIX = `${$conf.ROUTE_PREFIX || ''}`;
        // _inf(NS, '! express.keys =', keys);
        return keys
            .filter(isValidName)
            .filter(_ => typeof API(_) === 'function')
            .map(name => {
                // must be valid name && function.
                const main = API(name);
                const type = `${name}`.split('_').join('-'); // change '_' to '-'.
                if (typeof main !== 'function') throw new Error(`.${name} should be function. but:` + typeof main);
                //! handle request to handler.
                const handle_express = (req: any, res: any) => main(req.$event, req.$context, req.$callback);

                //! route pattern with `/<service>/<id>/<cmd>`
                app.get(`/${ROUTE_PREFIX}${type}`, middle, handle_express);
                app.get(`/${ROUTE_PREFIX}${type}/:id`, middle, handle_express);
                app.get(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, handle_express);
                app.put(`/${ROUTE_PREFIX}${type}/:id`, middle, handle_express);
                app.post(`/${ROUTE_PREFIX}${type}/:id`, middle, handle_express);
                app.post(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, handle_express);
                app.delete(`/${ROUTE_PREFIX}${type}/:id`, middle, handle_express);

                _inf(NS, `! api[${$U.NS(name, 'yellow')}] is routed as ${$U.NS(`/${ROUTE_PREFIX}${type}`, 'cyan')}`);
                return { name, type, main };
            })
            .reduce((M: any, N) => {
                M[N.name] = N;
                return M;
            }, {});
    })();
    // _inf(NS, '! express.handlers =', Object.keys(handlers).join(', '));
    _inf(NS, '! express.handlers.size =', Object.keys(handlers).length);

    //! create server by port.
    const createServer = () => {
        const server = http
            .createServer(app)
            .listen(PORT, () => {
                const addr: any = server.address();
                _inf(NS, 'Server Listen on Port =', addr && addr.port);
            })
            .on('listening', () => {
                if (IS_WSC) startWSClient();
            })
            .on('error', (e: any) => {
                _inf(NS, '!ERR - listen.err = ', e);
            });

        return server;
    };

    //! WSC: start WS Client on server ready.
    const startWSClient = (defType?: string, NS?: string) => {
        _inf(NS, 'startWSClient()...');
        //! start WebSocket Client.
        const WSC: any = $WSC(defType, NS, {
            name: $pack.name,
            version: $pack.version,
            start: 1, // auto start client.
            headers: {
                'X-Lemon-Agent': `WSC/${$pack.name}/${$pack.version}`, //TODO - header.name should be in env.
            },
        });
        const wsc = new (class implements EnginePluggable {
            public client = WSC.client;
            public name(): string {
                return 'WSC';
            }
        })();
        //! register this.
        $engine('WSC', wsc);
        return WSC;
    };

    //! export
    return { express, app, createServer, startWSClient };
};
