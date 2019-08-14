/**
 * Common WebSocket Server
 * - Proxy request to internal API handler.
 *
 *
 * @author Steve Jung <steve@lemoncloud.io>
 * @origin See `lemon-clusters-api/WSS.js`
 *
 * Copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
module.exports = $engine => {
    'use strict';
    if (!$engine) throw new Error('$engine(lemon-engine) is required!');

    //! load core services (_$ defined in global)
    const $U = $engine.U; // re-use global instance (utils).
    if (!$U) throw new Error('$U(utilities) is required!');

    //! load common functions
    const _log = $engine.log;
    const _inf = $engine.inf;
    const _err = $engine.err;

    const NS = $U.NS('WSS', 'yellow'); // NAMESPACE TO BE PRINTED.
    const DEFAULT_TYPE = $engine.environ('DEFAULT_TYPE', 'clusters'); // default type of api-handler.

    const $api = function() {
        if (!$engine[DEFAULT_TYPE]) throw new Error('$' + DEFAULT_TYPE + ' is required!');
        return $engine[DEFAULT_TYPE];
    };

    //! waits map.
    //TODO - maybe in serverless. it would not persist memory. so need to improve. @190510
    //WARN - IT SEEMS NOT WORK IN LAMBDA DUE TO ROUTE CONFIG: clusters vs WSS. (different handler instance) @190510
    const $waits = { next: 0 };

    const WSC_REQID_KEY = '$wsc-request-id'; // Client Request ID
    const WSS_REQID_KEY = '$wss-request-id'; // Server Request ID
    const MAX_TIMEOUT = 15 * 1000; // Max Wait Timeout (ms)

    //! internal functions.
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

    /**
     * Send JSON message to client.
     *
     * @param {*} url               API Gateway URL
     * @param {*} connectionId      Unique connection-id per connection
     * @param {*} payload           Data to send
     */
    const sendMessageToClientAws = (url, connectionId, payload) =>
        new Promise((resolve, reject) => {
            _log(NS, `sendMessageToClientAws(${url}, ${connectionId})...`);
            _log(NS, '> payload=', payload);

            //TODO - it would NOT work in VPC lambda. so move to backbone service.
            const $aws = $engine.aws || require('aws-sdk');
            const apigatewaymanagementapi = new $aws.ApiGatewayManagementApi({ apiVersion: '2029', endpoint: url });
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
    const sendMessageToClient = (url, connectionId, payload) =>
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
            const $AG = $engine.AG;
            // if (!$AG) return Promise.reject(new Error('$AG(agw-proxy) is required!'));
            return (() => {
                if (!$AG) return sendMessageToClientAws(url, connectionId, payload);
                return $AG.postToConnection(url, connectionId, payload);
            })().catch(e => {
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
    const postMessageToClient = async (url, connectionId, payload) => {
        _log(NS, `postMessageToClient(${url}, ${connectionId})...`);
        // _log(NS, '> payload['+connectionId+']=', payload);
        if (!payload || typeof payload != 'object') throw new Error('payload object is required!');

        //! Select proper function to send.
        const $AG = $engine.AG;
        // if (!$AG) return Promise.reject(new Error('$AG(agw-proxy) is required!'));
        if (!$AG) return sendMessageToClientAws(url, connectionId, payload);
        return $AG.postToConnection(url, connectionId, payload);
    };

    /**
     * Proxy to API Handler.
     *
     * @param {*} method        event method
     * @param {*} type          type of api
     * @param {*} id            pathParamter.id
     * @param {*} cmd           pathParamter.cmd
     * @param {*} param         query
     * @param {*} body          body
     * @param {*} context       context
     * @param {*} headers       (optional) client headers
     */
    const executeServiceApi = (
        method,
        type = DEFAULT_TYPE,
        id = '',
        cmd = '',
        param = null,
        body = null,
        context = null,
        headers = null,
    ) =>
        new Promise((resolve, reject) => {
            _log(NS, `executeServiceApi(${method})...`);
            // if (!method) return reject(new Error('method is required!'));
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
                headers = data.headers;
            }
            method = `${method}`.toUpperCase();
            _log(NS, `> ${method} ${type}/${id}/${cmd} param=`, param);

            //! lookup target-api by name.
            const API = $engine(type);
            if (!API) new Error('404 NOT FOUND - API.type:' + type);

            //! transform to APIGatewayEvent;
            const event = {
                httpMethod: method,
                path: cmd ? `/${id}/${cmd}` : id !== undefined ? `/${id}` : `/`,
                headers: headers || {},
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
    const WSS = async (event, context) => {
        //! forward to http handler for executing remote client in same context.
        if (context && event.pathParameters) {
            return new Promise((resolve, reject) => {
                $api()(event, context, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
        }

        //! handle for web-socket as default.
        // _log(NS, '! event =', event);
        // _log(NS, '! context=', context);
        _log(NS, '! event.headers =', event.headers);

        const $ctx = event.requestContext || {};
        const EVENT_TYPE = $ctx.eventType || '';
        const ROUTE_KEY = $ctx.routeKey || '';

        const X_FORWARD_FOR = (event.headers && event.headers['X-Forwarded-For']) || ''; // source ip address.
        const X_LEMON_AGENT = (event.headers && event.headers['X-Lemon-Agent']) || ''; // custom header.
        _log(NS, `> ${ROUTE_KEY}/${EVENT_TYPE} .... `, X_LEMON_AGENT, X_FORWARD_FOR);
        if (X_LEMON_AGENT && $ctx) $ctx.xLemonAgent = X_LEMON_AGENT; //TODO - improve! save lemon-agent for later use.
        if (X_FORWARD_FOR && $ctx) $ctx.xForwardFor = X_FORWARD_FOR; //TODO - improve! save lemon-agent for later use.
        // _log(NS, `> ${ROUTE_KEY}/${EVENT_TYPE} context=`, $ctx);

        try {
            let res = null;

            const stage = $ctx.stage;
            const domain = $ctx.domainName;
            const connectionId = $ctx.connectionId;
            const callbackUrlForAWS = `https://${domain}/${stage}`;

            //! decode event-type.
            if (EVENT_TYPE === 'CONNECT') {
                res = await executeServiceApi({ method: 'CONNECT', context: $ctx, headers: event.headers });
            } else if (EVENT_TYPE === 'DISCONNECT') {
                res = await executeServiceApi({ method: 'DISCONNECT', context: $ctx });
            } else if (EVENT_TYPE === 'MESSAGE' && ROUTE_KEY === 'echo') {
                // handler for 'echo' action. see route config.
                await sendMessageToClient(callbackUrlForAWS, connectionId, event);
                res = success();
            } else if (EVENT_TYPE === 'MESSAGE') {
                const body = event.body;
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
                        data.context = $ctx; //NOTE - Never use context from client.
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
                        return await executeServiceApi(data);
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
