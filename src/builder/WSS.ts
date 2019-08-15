/**
 * Common WebSocket Server
 * - Proxy request to internal API handler.
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
import { executeServiceApi, $api, $agw } from '../core/engine';

//! custom definitions.
import AWS from 'aws-sdk';

export const success = (body?: any) => {
    return buildResponse(200, body);
};

export const notfound = (body?: any) => {
    return buildResponse(404, body);
};

export const failure = (body?: any) => {
    return buildResponse(503, body);
};

export const buildResponse = (statusCode: number, body?: any): WebResult => {
    return {
        statusCode: statusCode,
        body: body === undefined ? undefined : typeof body == 'string' ? body : JSON.stringify(body),
    };
};

export interface WebServerHandler extends CoreHandler<any> {
    sendMessageToClient?: any;
    postMessageToClient?: any;
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
    NS = NS || $U.NS(`WSS`, 'yellow'); // NAMESPACE TO BE PRINTED.
    params = params || {};

    //! load default-handler type.
    const DEFAULT_TYPE = $engine.environ('DEFAULT_TYPE', defType) as string;

    //! waits map.
    //TODO - maybe in serverless. it would not persist memory. so need to improve. @190510
    //WARN - IT SEEMS NOT WORK IN LAMBDA DUE TO ROUTE CONFIG: clusters vs WSS. (different handler instance) @190510
    const $waits: any = { next: 0 };

    const WSC_REQID_KEY = '$wsc-request-id'; // Client Request ID
    const WSS_REQID_KEY = '$wss-request-id'; // Server Request ID
    const MAX_TIMEOUT = 15 * 1000; // Max Wait Timeout (ms)

    /**
     * Send JSON message to client.
     *
     * @param {*} url               API Gateway URL
     * @param {*} connectionId      Unique connection-id per connection
     * @param {*} payload           Data to send
     */
    const sendMessageToClientAws = (url: string, connectionId: string, payload: any) =>
        new Promise((resolve, reject) => {
            _log(NS, `sendMessageToClientAws(${url}, ${connectionId})...`);
            _log(NS, '> payload=', payload);

            //TODO - it would NOT work in VPC lambda. so move to backbone service.
            const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({ apiVersion: '2029', endpoint: url });
            apigatewaymanagementapi.postToConnection(
                {
                    ConnectionId: connectionId, // connectionId of the receiving ws-client
                    Data: JSON.stringify(payload),
                },
                (err, data) => {
                    if (err) {
                        _err(NS, '> err=', err);
                        return reject(err);
                    }
                    _log(NS, '> res=', data);
                    resolve(data);
                },
            );
        });

    /**
     * Send JSON message to client (Sync call w/ response)
     * - use $AG service.
     *
     * @param {*} url
     * @param {*} connectionId
     * @param {*} payload
     */
    const sendMessageToClient = (url: string, connectionId: string, payload: any) =>
        new Promise((resolve, reject) => {
            _log(NS, `sendMessageToClient(${url}, ${connectionId})...`);
            // _log(NS, '> payload['+connectionId+']=', payload);
            if (!payload || typeof payload != 'object') throw new Error('payload object is required!');
            const next = (++$waits.next % 100) + 100;
            const reqId = `WSS${next}${connectionId}`;
            const now = $U.current_time_ms();

            payload[WSS_REQID_KEY] = reqId;
            $waits[reqId] = {
                resolve,
                reject,
                sent: now,
                timeout: setTimeout(() => {
                    const waits = $waits[reqId];
                    if (waits) {
                        waits.reject(new Error('500 TIMEOUNT - ID:' + reqId));
                        delete $waits[reqId];
                    }
                }, MAX_TIMEOUT),
            };

            //! Select proper function to send.
            const $AG = $agw(true);
            // if (!$AG) return Promise.reject(new Error('$AG(agw-proxy) is required!'));
            return (() => {
                if (!$AG) return sendMessageToClientAws(url, connectionId, payload);
                return $AG.postToConnection(url, connectionId, payload);
            })().catch((e: Error) => {
                _err(NS, '> error to send. =', e);
                delete $waits[reqId];
                reject(e);
            });
        });

    /**
     * Post JSON message to client (Aync call w/o response).
     * - use $AG service.
     *
     * @param {*} url
     * @param {*} connectionId
     * @param {*} payload
     */
    const postMessageToClient = async (url: string, connectionId: string, payload: any) => {
        _log(NS, `postMessageToClient(${url}, ${connectionId})...`);
        // _log(NS, '> payload['+connectionId+']=', payload);
        if (!payload || typeof payload != 'object') throw new Error('payload object is required!');

        //! Select proper function to send.
        const $AG = $agw(true);
        // if (!$AG) return Promise.reject(new Error('$AG(agw-proxy) is required!'));
        if (!$AG) return sendMessageToClientAws(url, connectionId, payload);
        return $AG.postToConnection(url, connectionId, payload);
    };

    /**
     * Common WSS Handler for AWS API Gateway
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
    const WSS: WebServerHandler = async (event, context) => {
        //! forward to http handler for executing remote client in same context.
        if (context && event.pathParameters) {
            return $api(DEFAULT_TYPE).do(event, context);
        }

        //! handle for web-socket as default.
        // _log(NS, '! event =', event);
        // _log(NS, '! context=', context);
        _log(NS, '! event.headers =', $U.json(event.headers));

        const $req = event.requestContext || {};
        const $ctx = Object.assign({}, context || {}); // copy origin context.
        const EVENT_TYPE = $req.eventType || '';
        const ROUTE_KEY = $req.routeKey || '';

        const X_FORWARD_FOR = (event.headers && event.headers['X-Forwarded-For']) || ''; // source ip address.
        const X_LEMON_AGENT = (event.headers && event.headers['X-Lemon-Agent']) || ''; // custom header.
        _log(NS, `> route(${ROUTE_KEY}/${EVENT_TYPE}) =`, X_LEMON_AGENT, X_FORWARD_FOR);
        if (X_LEMON_AGENT && $ctx) $ctx.xLemonAgent = X_LEMON_AGENT; //TODO - improve! save lemon-agent for later use.
        if (X_FORWARD_FOR && $ctx) $ctx.xForwardFor = X_FORWARD_FOR; //TODO - improve! save lemon-agent for later use.
        // _log(NS, `> ${ROUTE_KEY}/${EVENT_TYPE} context=`, $ctx);

        try {
            let res = null;

            const stage = $req.stage;
            const domain = $req.domainName;
            const connectionId = $req.connectionId;
            const callbackUrlForAWS = `https://${domain}/${stage}`;

            //! execute-api.
            const call = (method: string, data?: any): Promise<{ statusCode: number; body: any }> => {
                _log(NS, `call(${method})...`);
                const param = Object.assign(data || {}, {
                    method: method,
                    type: (data && data.type) || DEFAULT_TYPE,
                    context: $ctx,
                    requestContext: $req,
                    headers: event.headers,
                });
                return executeServiceApi(param)
                    .then(body => {
                        _log(NS, '> execute-api.body =', $U.json(body));
                        return { statusCode: 200, body };
                    })
                    .catch((e: Error) => {
                        _err(NS, '> execute-api.error =', e);
                        const message = `${e.message || e}`;
                        const isNotFound = message.indexOf('404 NOT FOUND') >= 0;
                        return { statusCode: isNotFound ? 404 : 503, body: message };
                    });
            };

            //! decode event-type.
            if (EVENT_TYPE === 'CONNECT') {
                res = await call('CONNECT');
                res = res.statusCode == 200 ? success() : res;
            } else if (EVENT_TYPE === 'DISCONNECT') {
                res = await call('DISCONNECT');
                res = res.statusCode == 200 ? success() : res;
            } else if (EVENT_TYPE === 'MESSAGE' && ROUTE_KEY === 'echo') {
                // handler for 'echo' action. see route config.
                await sendMessageToClient(callbackUrlForAWS, connectionId, event);
                res = success();
            } else if (EVENT_TYPE === 'MESSAGE') {
                const body = event.body;
                const data =
                    typeof body === 'string' && body.startsWith('{') && body.endsWith('}') ? JSON.parse(body) : body;
                _log(NS, '> data =', $U.json(data));
                //! handle by request-id.
                const serverReqId = (data && data[WSS_REQID_KEY]) || '';
                const clientReqId = (data && data[WSC_REQID_KEY]) || '';
                serverReqId && _inf(NS, `> data[${WSS_REQID_KEY}]=`, serverReqId);
                clientReqId && _inf(NS, `> data[${WSC_REQID_KEY}]=`, clientReqId);

                //NOTE - in connected state, send result via web-socket with success
                const message: any = await (async () => {
                    if (data && typeof data === 'object') {
                        data.type = data.type || DEFAULT_TYPE;
                        data.context = $ctx; //NOTE - Never use context from client.
                        data.requestContext = $req;
                        if (serverReqId) {
                            const waits = $waits[serverReqId];
                            const statusCode = data.statusCode || 500;
                            const body =
                                typeof data.body === 'string' && data.body.startsWith('{') && data.body.endsWith('}')
                                    ? JSON.parse(data.body)
                                    : data.body;
                            _log(NS, `>> waits[${serverReqId}] ${statusCode} =`, waits);
                            if (waits) {
                                if (statusCode == 200) waits.resolve(body);
                                else waits.reject(new Error(`${body || statusCode}`));
                            }
                            delete $waits[serverReqId];
                            return null; //NO RESPONSE.
                        }
                        //! proxy the request
                        const { statusCode, body } = await call('MESSAGE', data);
                        return { statusCode, body };
                    }
                    return failure('body should be JSON object. but type:' + typeof data);
                })();

                //! ignore if no message or via WSC.
                if (!message || !clientReqId) return success();

                //! keep server's request-id, then response.
                if (clientReqId) message[WSC_REQID_KEY] = clientReqId;

                //! now post response.
                await sendMessageToClient(callbackUrlForAWS, connectionId, message);

                //! returns
                res = success();
            }

            //! returns result or failure.
            return res || failure(`Invalid ${ROUTE_KEY}/${EVENT_TYPE}`);
        } catch (e) {
            _err(NS, '! error =', e);
            const msg = `${e.message || e}`;
            return msg.startsWith('404 NOT FOUND') ? notfound(msg) : failure(msg);
        }
    };

    //! attach.
    WSS.sendMessageToClient = sendMessageToClient;
    WSS.postMessageToClient = postMessageToClient;

    //! returns main SNS handler.
    return WSS;
};

//! export default.
export default builder;
