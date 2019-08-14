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
 * @author  Steve Jung <steve@lemoncloud.io>
 * @date    2019-08-14 refactoring version via latest `WSC.js`
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $U, _log, _inf, _err } from '../core/engine';
import { $engine } from '../core/engine';
import { WebResult, BrokerBuilder, CoreHandler } from '../common/types';
import { executeServiceApi } from '../core/engine';

//! custom definitions.
// const WebSocket = require('ws');
import WebSocket from 'ws';
import generator from 'nanoid/generate';

export const success = (body: any) => {
    return buildResponse(200, body);
};

export const notfound = (body: any) => {
    return buildResponse(404, body);
};

export const failure = (body: any) => {
    return buildResponse(503, body);
};

export const buildResponse = (statusCode: number, body: any): WebResult => {
    return {
        statusCode: statusCode,
        body: body === undefined ? undefined : typeof body == 'string' ? body : JSON.stringify(body),
    };
};

export interface WebClientHandler extends CoreHandler<any> {
    client: any;
}

/**
 * build WSC() handler.
 *
 * @param {*} defType  default type of $api()
 * @param {*} NS       namespace to print
 * @param {*} params   namespace to print
 */
const builder: BrokerBuilder<any> = (defType, NS, params) => {
    defType = defType || 'hello';
    NS = NS || $U.NS(`WSC`, 'yellow'); // NAMESPACE TO BE PRINTED.
    params = params || {};

    //! load default-handler type.
    const DEFAULT_TYPE = $engine.environ('DEFAULT_TYPE', defType) as string;
    const WSS_ENDPOINT = $engine.environ('WSS_ENDPOINT', params.url || '') as string;
    if (!WSS_ENDPOINT) throw new Error('env:WSS_ENDPOINT is required!');
    _inf(NS, `! WSS_ENDPOINT[${DEFAULT_TYPE}] =`, WSS_ENDPOINT);
    const headers = params.headers || {};
    const isStart = $U.N(params.start, params.start === '' ? 1 : 0);

    /**
     * create websocket client.
     */
    const client = ((url: string) => {
        _log(NS, `client(${url})...`);
        const AUTO_RECONNECT_INTERVAL = 2.5 * 1000; // Reconnect Retry (ms)
        const MAX_TIMEOUT = 30 * 1000; // Max Wait Timeout (ms)
        const WSC_REQID_KEY = '$wsc-request-id'; // Client Request ID
        const WSS_REQID_KEY = '$wss-request-id'; // Server Request ID

        //! prepare thiz internal.
        const op = () => {};
        const thiz = {
            _instance: null as any,
            _waits: {} as any,
            start: op,
            stop: op,
            post: op,
            send: op,
            reconnect: op,
            next_id: op,
        };

        //! open socket with server.
        const open = () => {
            _log(NS, '> open()...');
            if (thiz._instance) throw new Error('already connected!');
            const instance = new WebSocket(url, {
                headers,
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
            const ID_CHARS = '1234567890abcdefghjkmnpqrstuvwxyz';
            const id = generator(ID_CHARS, 12);
            return `WSC${id}`;
        };

        //! post message without wait
        const post = (data: any, options?: any) => {
            _log(NS, '! post()...');
            if (!thiz._instance) throw new Error('404 NOT CONNECTED');
            const payload = data && typeof data == 'object' ? JSON.stringify(data) : `${data}`;
            _log(NS, '> payload =', payload);
            thiz._instance.send(payload, options);
        };

        //! send message and get response
        const send = (data: any, options?: any) =>
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
                thiz._instance.send(
                    data && typeof data == 'object' ? JSON.stringify(data) : `${data}`,
                    options,
                    (err: Error) => {
                        err && _err(NS, '! err.send =', err);
                        err && reject(err);
                    },
                );
            });

        //! handle message via server.
        const on_message = async (body: any, flags: any) => {
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
                const message: any = await (async () => {
                    if (data && typeof data === 'object') {
                        data.type = data.type || DEFAULT_TYPE;
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
                        const body = await executeServiceApi(data).catch(e => e);
                        if (body instanceof Error) {
                            const e: Error = body;
                            const message = `${e.message}`;
                            return { statusCode: message.indexOf('404 NOT FOUND') >= 0 ? 404 : 503, body: message };
                        }
                        return { statusCode: 200, body };
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
        const reconnect = (e: any) => {
            _log(NS, '> reconnect()... e=', e);
            close();
            setTimeout(() => {
                open();
            }, AUTO_RECONNECT_INTERVAL);
        };

        const on_open = () => {
            _log(NS, '! on.open()...');
            executeServiceApi({ method: 'CONNECT', type: DEFAULT_TYPE, context: null, headers: params.headers });
        };

        const on_close = (e: any) => {
            _log(NS, '! on.close()... e=', e);
            executeServiceApi({ method: 'DISCONNECT', type: DEFAULT_TYPE, context: null });
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

        const on_error = (e: any) => {
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
        Object.assign(thiz, { start: open, stop: close, post, send, reconnect, next_id });

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
    //! Common SNS Handler for lemon-protocol integration.
    const WSC: WebClientHandler = (event, context, callback) => {
        // context.callbackWaitsForEmptyEventLoop = false;
        // _log(NS, '! event =', event);
        // _log(NS, '! context=', context);
        _log(NS, '! event.headers =', $U.json(event.headers));
    };

    //! send message.
    WSC.client = client;
    if (isStart) client.start();

    //! returns main SNS handler.
    return WSC;
};

//! export default.
export default builder;
