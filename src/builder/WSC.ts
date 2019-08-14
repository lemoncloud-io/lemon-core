/**
 * Common WebSocket Client (WSC)
 * - Proxy request to internal API handler.
 *
 *
 * ```sh
 * # install the required modules.
 * $ npm install --save ws
 *
 * # run in express for local test.
 * $ npm run express.lemon
 * ```
 *
 *
 * @author Steve Jung <steve@lemoncloud.io>
 * @origin See `lemon-clusters-api/WSC.js`
 *
 * Copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! custom definitions.
// const WebSocket = require('ws');
import * as WebSocket from 'ws';

//! main exports
module.exports = ($engine, params) => {
    'use strict';
    if (!$engine) throw new Error('$engine(lemon-engine) is required!');

    //! load core services (_$ defined in global)
    const $U = $engine.U; // re-use global instance (utils).
    if (!$U) throw new Error('$U(utilities) is required!');

    //! load common functions
    const _log = $engine.log;
    const _inf = $engine.inf;
    const _err = $engine.err;

    //! local constant
    const NS = $U.NS('WSC', 'yellow'); // NAMESPACE TO BE PRINTED.
    const DEFAULT_TYPE = $engine.environ('DEFAULT_TYPE', 'clusters');
    const WSS_ENDPOINT = $engine.environ('WSS_ENDPOINT', params.url || '');
    if (!WSS_ENDPOINT) throw new Error('env:WSS_ENDPOINT is required!');
    _inf(NS, `! WSS_ENDPOINT[${DEFAULT_TYPE}] =`, WSS_ENDPOINT);

    function success(body) {
        return buildResponse(200, body);
    }

    function notfound(body) {
        return buildResponse(404, body);
    }

    function failure(body) {
        return buildResponse(503, body);
    }

    function buildResponse(statusCode, body) {
        return {
            statusCode: statusCode,
            body: body === undefined ? undefined : typeof body == 'string' ? body : JSON.stringify(body),
        };
    }

    //! chain for HTTP type.
    const executeServiceApi = (
        method,
        type = DEFAULT_TYPE,
        id = '',
        cmd = '',
        param = null,
        body = null,
        context = null,
    ) =>
        new Promise((resolve, reject) => {
            if (!method) throw new Error('method is required!');
            if (method && typeof method === 'object') {
                const data = method;
                type = '' + (type || DEFAULT_TYPE); //MUST BE STRING!
                method = '' + (data.method || 'get'); //MUST BE STRING!
                id = '' + (data.id || id); //MUST BE STRING!
                cmd = '' + (data.cmd || cmd); //MUST BE STRING!
                param = data.param;
                body = data.body;
                context = data.context;
            }
            method = `${method}`.toUpperCase();
            _log(NS, `executeServiceApi(${method}, ${type}, ${id}, ${cmd})...`);
            // _log(NS, `> ${method} ${type}/${id}/${cmd} param=`, param);

            //! lookup target-api by name.
            const API = $engine(type);
            if (!API) new Error('404 NOT FOUND - API.type:' + type);

            //! transform to APIGatewayEvent;
            const event = {
                httpMethod: method,
                path: cmd ? `/${id}/${cmd}` : id !== undefined ? `/${id}` : `/`,
                headers: {},
                pathParameters: {},
                queryStringParameters: {},
                body: '',
                isBase64Encoded: false,
                stageVariables: null,
                requestContext: context || {},
                resource: '',
            };
            if (id !== undefined) event.pathParameters.id = id;
            if (cmd !== undefined) event.pathParameters.cmd = cmd;
            if (param) event.queryStringParameters = param;
            if (body) event.body = body;

            //! basic handler type. (see bootload.main)
            API(event, {}, (err, res) => {
                err && reject(err);
                !err && resolve(res);
            });
        });

    /**
     * create websocket client.
     */
    const client = (url => {
        const AUTO_RECONNECT_INTERVAL = 2.5 * 1000; // Reconnect Retry (ms)
        const MAX_TIMEOUT = 30 * 1000; // Max Wait Timeout (ms)
        const WSC_REQID_KEY = '$wsc-request-id'; // Client Request ID
        const WSS_REQID_KEY = '$wss-request-id'; // Server Request ID

        //! prepare thiz internal.
        const thiz = {
            _instance: null,
            _waits: {},
        };

        //! open socket with server.
        const open = () => {
            _log(NS, '> open()...');
            if (thiz._instance) throw new Error('already connected!');
            const instance = new WebSocket(url, {
                headers: params.headers || {},
                // agent: params.agent||`wsc/${DEFAULT_TYPE}`,
                perMessageDeflate: false, // see: https://github.com/websockets/ws#websocket-compression
            });
            //! attach event.
            instance.on('open', on_open);
            instance.on('message', on_message);
            instance.on('close', on_close);
            instance.on('error', on_error);
            thiz._instance = instance;
        };

        //! close socket.
        const close = () => {
            _log(NS, '> close()...');
            if (thiz._instance) {
                thiz._instance.removeAllListeners();
            }
            thiz._instance = null;
        };

        //! generate next-id.
        const next_id = () => {
            const generator = require('nanoid/generate');
            const ID_CHARS = '1234567890abcdefghjkmnpqrstuvwxyz';
            const id = generator(ID_CHARS, 12);
            return `WSC${id}`;
        };

        //! post message without wait
        const post = (data, options) => {
            _log(NS, '! post()...');
            if (!thiz._instance) throw new Error('404 NOT CONNECTED');
            const payload = data && typeof data == 'object' ? JSON.stringify(data) : `${data}`;
            _log(NS, '> payload =', payload);
            thiz._instance.send(payload, options);
        };

        //! send message and get response
        const send = (data, options) =>
            new Promise((resolve, reject) => {
                _log(NS, '! send()...');
                if (!thiz._instance) throw new Error('404 NOT CONNECTED');
                //! prepare rquest-id.
                const reqId = next_id();
                const now = $U.current_time_ms();
                data[WSC_REQID_KEY] = reqId;
                thiz._waits[reqId] = {
                    resolve,
                    reject,
                    sent: now,
                    timeout: setTimeout(() => {
                        const waits = thiz._waits[reqId];
                        if (waits) {
                            waits.reject(new Error('500 TIMEOUNT - ID:' + reqId));
                            delete thiz._waits[reqId];
                        }
                    }, MAX_TIMEOUT),
                };
                _log(NS, '> sent =', data);
                //! send with data as text.
                thiz._instance.send(data && typeof data == 'object' ? JSON.stringify(data) : `${data}`, options);
            });

        //! handle message via server.
        const on_message = async (body, flags) => {
            _log(NS, '! on.message()...');
            _log(NS, '> body =', typeof body, body);
            _log(NS, '> flags =', typeof flags, flags);
            try {
                const data =
                    typeof body === 'string' && body.startsWith('{') && body.endsWith('}') ? JSON.parse(body) : body;
                _log(NS, '> data =', data);
                //! handle by request-id.
                const serverReqId = data[WSS_REQID_KEY];
                const clientReqId = data[WSC_REQID_KEY];
                serverReqId && _inf(NS, `> data[${WSS_REQID_KEY}]=`, serverReqId);
                clientReqId && _inf(NS, `> data[${WSC_REQID_KEY}]=`, clientReqId);

                //NOTE - in connected state, send result via web-socket with success
                const message = await (async () => {
                    if (data && typeof data === 'object') {
                        data.context = null; //TODO - Set proper context.
                        if (clientReqId) {
                            const waits = thiz._waits[clientReqId];
                            const statusCode = data.statusCode || 500;
                            const body =
                                typeof data.body === 'string' && data.body.startsWith('{') && data.body.endsWith('}')
                                    ? JSON.parse(data.body)
                                    : data.body;
                            if (waits) {
                                if (statusCode == 200) waits.resolve(data.body);
                                else waits.reject(new Error(`${body || statusCode}`));
                            }
                            delete thiz._waits[clientReqId];
                            return null; //NO RESPONSE.
                        }
                        //! proxy the request
                        return await executeServiceApi(data);
                    }
                    return failure('body should be JSON object. but type:' + typeof data);
                })();
                //! ignore if no message or via WSC.
                if (!message || !serverReqId) return;

                //! keep server's request-id, then response.
                if (serverReqId) message[WSS_REQID_KEY] = serverReqId;

                //! now post response.
                post(message);
            } catch (e) {
                _err(NS, '! on_message.error =', e);
            }
        };

        //! reconnect in some interval.
        const reconnect = e => {
            _log(NS, '> reconnect()... e=', e);
            close();
            setTimeout(() => {
                open();
            }, AUTO_RECONNECT_INTERVAL);
        };

        const on_open = () => {
            _log(NS, '! on.open()...');
            executeServiceApi({ method: 'CONNECT', context: null, headers: params.headers });
        };

        const on_close = e => {
            _log(NS, '! on.close()... e=', e);
            executeServiceApi({ method: 'DISCONNECT', context: null });
            switch (e) {
                case 1000: // CLOSE_NORMAL
                    _log(NS, '! closed');
                    break;
                default:
                    // Abnormal closure
                    reconnect(e);
                    break;
            }
        };

        const on_error = e => {
            _err(NS, '! on.error =', e);
            switch (e.code) {
                case 'ECONNREFUSED':
                    reconnect(e);
                    break;
                default:
                    break;
            }
        };

        //! attach
        Object.assign(thiz, { start: open, stop: close, post, send, reconnect });

        //! retruns instance.
        return thiz;
    })(WSS_ENDPOINT);

    /**
     * Common WSC Handler
     *
     * example:
     * ```js
     * $ npm install -g wscat
     * $ wscat -c wss://j4s5hkkrll.execute-api.ap-northeast-2.amazonaws.com/prod
     * > {"action":"echo"}
     * > {"id":"","cmd":""}
     * ```
     *
     * @param {*} event
     * @param {*} context
     */
    const WSC = async (event, context) => {
        // context.callbackWaitsForEmptyEventLoop = false;
        // _log(NS, '! event =', event);
        // _log(NS, '! context=', context);
        _log(NS, '! event.headers =', event.headers);
    };

    //! send message.
    WSC.client = client;

    //! returns main SNS handler.
    return WSC;
};
