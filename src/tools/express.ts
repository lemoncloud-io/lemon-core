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
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { LemonEngine } from '../engine/';
import { loadJsonSync, getRunParam } from './shared';
import { LambdaWEBHandler } from '../cores/lambda/lambda-web-handler';
import { NextContext } from '../cores';

import AWS from 'aws-sdk';
import express, { RequestHandler } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import http from 'http';
import fs from 'fs';

import * as requestIp from 'request-ip';

//! helper to catch header value w/o case-sensitive
export const buildHeaderGetter = (headers: any) => (name: string): string => {
    name = `${name || ''}`.toLowerCase();
    headers = headers || {};
    return Object.keys(headers).reduce((found: string, key: string) => {
        const val = headers[key];
        key = `${key || ''}`.toLowerCase();
        if (key == name) return val;
        return found;
    }, '');
};

//! create Server Instance.
//NOTE - avoid external reference of type.
export const buildExpress = (
    $engine: LemonEngine,
    $web: LambdaWEBHandler,
    options?: { argv?: string[]; prefix?: string; genRequestId?: () => string },
): { express: () => any; app: any; createServer: () => any } => {
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
    const useEngineLog = !!1; //NOTE - turn off to print log in jest test.
    const _log = useEngineLog ? $engine.log : console.log;
    const _inf = useEngineLog ? $engine.inf : console.info;
    const _err = useEngineLog ? $engine.err : console.error;

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
        //NOTE! - DO NOT CHANGE CONFIG IN LAMBDA ENV (USE ROLE CONFIG).
        const ALFN = $engine.environ('AWS_LAMBDA_FUNCTION_NAME', '') as string;
        if (ALFN) return;
        //NOTE! - OR, TRY TO LOAD CREDENTIALS BY PROFILE NAME.
        const NAME = $engine.environ('NAME', '') as string;
        const profile = $engine.environ('PROFILE', NAME) as string;
        const credentials = new AWS.SharedIniFileCredentials({ profile });
        if (profile) AWS.config.credentials = credentials;
    })();

    /** ****************************************************************************************************************
     *  Initialize Express
     ** ****************************************************************************************************************/
    //! create express app.
    const app: any = express();
    const uploader = multer({ dest: '../tmp/' });
    const genRequestId =
        options.genRequestId ||
        ((): string => {
            const msec = new Date().getMilliseconds() % 1000;
            return `${$U.ts()}.${msec < 10 ? '00' : msec < 100 ? '0' : ''}${msec}`;
        });

    app.use(cors());
    app.use(bodyParser.json({ limit: '10mb' })); // default limit 10mb
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());

    //! middle ware
    const middle: RequestHandler = (req: any, res: any, next: any) => {
        // _log(NS, `! req =`, req);
        // _log(NS, `! header =`, req.headers);
        const getHeader = buildHeaderGetter(req.headers || {});
        const host = getHeader('host').split(':')[0];
        const accountId = $engine.environ('USER', $engine.environ('LOGNAME', ''));
        const requestId = genRequestId();
        const clientIp = typeof req.clientIp == 'string' ? req.clientIp : ''; //NOTE! - use `request-ip`
        const sourceIp = clientIp || `${requestIp.getClientIp(req as any) || ''}`;
        const userAgent = getHeader('user-agent');

        //! prepare event compartible with API-Gateway Event.
        const event = {
            path: req.path,
            queryStringParameters: req.query || {},
            pathParameters: req.params,
            httpMethod: req.method,
            connection: 1 ? null : req.connection, //WARN! - DO NOT USE THIS DUE TO CIRCULAR STRUCTURE.
            url: req.url,
            headers: req.headers,
            body: req.body,
            requestContext: {
                source: 'express',
                domainName: host,
                accountId,
                requestId,
                stage: $engine.environ('STAGE', ''),
                identity: {
                    sourceIp,
                    userAgent,
                },
            },
        };
        _log(NS, `! req-ctx =`, $U.json(event.requestContext));

        //! prepare internal-context
        const context: NextContext = { source: 'express', domain: host };

        //! catch cookie
        if (req.headers) {
            Object.keys(req.headers).forEach(_key => {
                const val = req.headers[_key];
                const key = `${_key}`.toLowerCase();
                if (key == 'cookie') {
                    const parseCookies = (str: string) => {
                        let rx = /([^;=\s]*)=([^;]*)/g;
                        let obj: { [key: string]: string } = {};
                        for (let m; (m = rx.exec(str)); ) obj[m[1]] = decodeURIComponent(m[2]);
                        return obj;
                    };
                    context.cookie = parseCookies(`${Array.isArray(val) ? val.join('; ') : val || ''}`.trim());
                }
            });
        }
        if (req.cookies && typeof req.cookies == 'object') {
            context.cookie = Object.keys(req.cookies).reduce(
                (M: any, key: string) => {
                    const val = req.cookies[key];
                    M[key] = `${val || ''}`.trim();
                    return M;
                },
                { ...context.cookie },
            );
        }

        const callback = (err: any, data: any) => {
            err && _err(NS, '! err@callback =', err);
            data && _inf(NS, `! res@callback[${(data && data.statusCode) || 0}] =`, $U.S(data && data.body, 1024));
            let contentType = null;
            if (data.headers) {
                Object.keys(data.headers).map(k => {
                    if (`${k}`.toLowerCase() == 'content-type') {
                        contentType = data.headers[k];
                    } else {
                        res.setHeader(k, data.headers[k]);
                    }
                });
            }
            const statusCode: number = (data && data.statusCode) || (err ? 503 : 200);
            res.setHeader('Content-Type', contentType || 'application/json');
            res.status(statusCode).send(data.body);
        };

        //! attach to req.
        req.$event = event;
        req.$context = context; //! save the
        req.$callback = callback;

        //! use json parser or multer.
        const method = req.method || '';
        const ctype = getHeader('content-type');
        _log(NS, `! ${method} ${req.url} =`, ctype);

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
        //WARN! - must be matched with the `LambdaWEBHandler.handleProtocol()`.
        const $env = (process && process.env) || {};
        // const $pack = JSON.parse(fs.readFileSync('package.json', { encoding: 'utf8' }).toString());
        // _log(NS, `stat =`, $stat);
        // _log(NS, `pack =`, $pack);
        const $stat = fs.statSync('package.json');
        const modified = $U.ts($U.F($stat.ctimeMs, 0));
        const name = $pack.name || 'LEMON API';
        const version = $pack.version || '0.0.0';
        const core = $pack && $pack.dependencies && $pack.dependencies['lemon-core'];
        const msgs = [
            `${name}/${version}`,
            `lemon-core/${core || ''}`,
            `modified/${modified}`,
            `env/ENV=${$env.ENV || ''} NAME=${$env.NAME || ''} STAGE=${$env.STAGE || ''}`,
            `env/REPORT_ERROR_ARN=${$env.REPORT_ERROR_ARN || ''}`,
        ];
        res.status(200).send(msgs.join('\n'));
    });

    //! handler map.
    if (true) {
        //! route prefix
        const ROUTE_PREFIX = `${(options && options.prefix) || ''}`;

        //! handle request to handler.
        const next_middle = (type: string) => (req: any): Promise<void> => {
            const callback = req.$callback;
            req.$event.pathParameters = { type, ...req.$event.pathParameters }; // make sure `type`
            return $web
                .packContext(req.$event, req.$context)
                .then(context => $web.handle(req.$event, context))
                .then(_ => callback && callback(null, _))
                .catch(e => {
                    _err(NS, '! exp.err =', e);
                    callback && callback(e);
                });
        };

        //! register automatically endpont.
        const RESERVES = 'id,log,inf,err,extend,ts,dt,environ'.split(',');
        const isValidName = (name: string) => /^[a-z][a-z0-9\-_]+$/.test(name) && RESERVES.indexOf(name) < 0;
        const $map: any = $web.getHandlerDecoders();
        const keys = Object.keys($map);
        // _inf(NS, '! express.keys =', keys);
        const handlers = keys
            .filter(isValidName)
            .map(name => {
                //! check if valid name && function.
                const main = $map[name];
                const type = `${name}`.split('_').join('-'); // change '_' to '-'.
                if (typeof main !== 'function')
                    throw new Error(`.${name} should be function handler. but type=` + typeof main);

                //! route pattern with `/<type>/<id>/<cmd?>`
                app.get(`/${ROUTE_PREFIX}${type}`, middle, next_middle(type));
                app.get(`/${ROUTE_PREFIX}${type}/:id`, middle, next_middle(type));
                app.get(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, next_middle(type));
                app.put(`/${ROUTE_PREFIX}${type}/:id`, middle, next_middle(type));
                app.put(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, next_middle(type));
                app.patch(`/${ROUTE_PREFIX}${type}/:id`, middle, next_middle(type));
                app.patch(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, next_middle(type));
                app.post(`/${ROUTE_PREFIX}${type}/:id`, middle, next_middle(type));
                app.post(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, next_middle(type));
                app.delete(`/${ROUTE_PREFIX}${type}/:id`, middle, next_middle(type));
                app.delete(`/${ROUTE_PREFIX}${type}/:id/:cmd`, middle, next_middle(type));

                const _NS = (name: string, color?: any) => $U.NS(name, color, 4, '');
                _inf(NS, `! api[${_NS(name, 'yellow')}] is routed as ${_NS(`/${ROUTE_PREFIX}${type}`, 'cyan')}`);
                return { name, type, main };
            })
            .reduce((M: any, N) => {
                M[N.name] = N;
                return M;
            }, {});
        // _inf(NS, '! express.handlers =', Object.keys(handlers).join(', '));
        _inf(NS, '! express.handlers.len =', Object.keys(handlers).length);
    }

    //! create server by port.
    const createServer = () => {
        //! logging options.
        const NS = $U.NS('main', 'cyan');
        const $pack = loadJsonSync('package.json');
        const name = $pack.name || 'LEMON API';
        const version = $pack.version || '0.0.0';
        const server = http
            .createServer(app)
            .listen(PORT, () => {
                _inf(NS, `###### express[${name}@${$U.NS(version, 'cyan')}] ######`);
            })
            .on('listening', () => {
                const addr: any = server.address();
                const port = $U.NS(`${addr && addr.port}`, 'yellow').split(':')[0];
                _log(NS, `Server[${process.env.NAME}:${process.env.STAGE}] is listening on Port:${port}`);
                //TODO - improve way to initialize $engine.
                $engine.initialize();
            })
            .on('error', (e: any) => {
                _inf(NS, '!ERR - listen.err = ', e);
            });

        return server;
    };

    //! export
    return { express, app, createServer };
};
