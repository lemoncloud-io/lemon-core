/**
 * `api-service.ts`
 * - common external rest-api service.
 * - support http-proxy with backbone to overcome VPC restriction.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-05-23 initial version
 * @date        2019-12-03 refactoring for `lemon-core#2.0.0`
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('APIS', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * API headers.
 */
export interface APIHeaders {
    [key: string]: string;
}

/**
 * General API Endpoint.
 */
export interface APIServiceClient {
    hello(): string; // say this agent's name.
    doGet<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T>;
    doPut<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T>;
    doPost<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T>;
    doPatch<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T>;
    doDelete<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T>;
}

/**
 * possible method.
 */
export type APIHttpMethod = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';

/**
 * http proxy service.
 */
export interface ApiHttpProxy {
    /**
     * say this service name.
     */
    hello(): string;

    /**
     * call http request via proxy server.
     *
     * url := `<host>/<path?>?<param>`
     *
     * @param method    http method
     * @param host      host name (or https://~)
     * @param path      object id
     * @param param     query paramters
     * @param body      body
     * @param ctx       context
     */
    doProxy<T = any>(
        method: APIHttpMethod,
        host: string,
        path?: string,
        param?: any,
        body?: any,
        ctx?: any,
    ): Promise<T>;
}

/**
 * class: API
 * - use internal http-proxy service due to restriction internet-face in VPC lambda.
 */
export class APIService implements APIServiceClient {
    protected type: string;
    protected endpoint: string;
    protected headers: APIHeaders;
    protected client: APIServiceClient;

    /**
     * create API service.
     *
     * ```js
     * const api = new API('web', 'http://localhost:8081', {});
     * api.doGet('');
     * ```
     *
     * @param type      type in endpoint
     * @param endpoint  base endpoint (support ONLY http, https)
     * @param headers   common headers.
     * @param client    api-service client to use (or create later)
     */
    public constructor(type: string, endpoint: string, headers?: APIHeaders, client?: APIServiceClient) {
        if (!endpoint) throw new Error('@endpoint (url) is required');
        if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://'))
            throw new Error(`@endpoint (url) is not valid http-url:${endpoint}`);
        this.type = type;
        this.endpoint = endpoint;
        this.headers = headers;
        if (client) {
            this.client = client;
        } else {
            //! use default `env.BACKBONE_API` to detect proxy-server.
            const BACKBONE = $engine.environ('BACKBONE_API', 'http://localhost:8081') as string;
            this.client = APIService.buildClient(this.type, this.endpoint, this.headers, BACKBONE);
        }
    }

    //! relay hello.
    public hello = () => `api-service:${this.client.hello()}`;

    /**
     * make client
     *
     * @param backbone  backbone address like 'http://localhost:8081'
     */
    public static buildClient(
        type: string,
        endpoint: string,
        headers?: APIHeaders,
        backbone?: string,
    ): APIServiceClient {
        _log(NS, `makeClient()...`);
        type = `${type || ''}`;
        const host = `${endpoint || ''}`.split('/')[2];
        const base = backbone ? `${endpoint || ''}` : undefined;
        // const BACKBONE = $engine.environ('BACKBONE_API', 'http://localhost:8081') as string;
        const proxy: ApiHttpProxy = (() => {
            if (backbone) {
                //! use web-proxy configuration.
                const NAME = `WEB:${host}-${type}`;
                const encoder = (name: string, path: string) => encodeURIComponent(path);
                const relayHeaderKey = 'x-lemon-';
                const resultKey = 'result';
                return createHttpWebProxy(NAME, `${backbone}/web`, headers, encoder, relayHeaderKey, resultKey); // use default web-proxy service
            } else {
                //!
                const NAME = `API:${host}-${type}`;
                return createHttpWebProxy(NAME, endpoint, headers, (n, s) => s, ''); // use default web-proxy service
            }
        })();

        //! create inner APIService()
        const client = new (class implements APIServiceClient {
            protected asPath = (type?: string, id?: string, cmd?: string) => {
                return (
                    '' +
                    (type === undefined ? '' : '/' + encodeURIComponent(type)) +
                    (type === undefined || id === undefined ? '' : '/' + encodeURIComponent(id)) +
                    (type === undefined || id === undefined || cmd === undefined ? '' : '/' + encodeURI(cmd)) + //NOTE - cmd could have additional '/' char.
                    ''
                );
            };
            protected asHostPath = (base?: string, type?: string, id?: string, cmd?: string) => {
                let host = base ? base : undefined;
                let path = this.asPath(type, id, cmd);
                if (host) {
                    const url = (!host.startsWith('http') ? 'http://' : '') + `${host}${path || ''}`;
                    const $url = URL.parse(url);
                    host = `${$url.protocol || 'http'}//${$url.hostname}`;
                    path = `${$url.path}`;
                }
                return { host, path };
            };
            public hello = () => `api-client:${proxy.hello()}`;
            public doGet(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(base, type, id, cmd);
                return proxy.doProxy('GET', host, path, param, body, ctx);
            }
            public doPut(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(base, type, id, cmd);
                return proxy.doProxy('PUT', host, path, param, body, ctx);
            }
            public doPost(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(base, type, id, cmd);
                return proxy.doProxy('POST', host, path, param, body, ctx);
            }
            public doPatch(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(base, type, id, cmd);
                return proxy.doProxy('PATCH', host, path, param, body, ctx);
            }
            public doDelete(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(base, type, id, cmd);
                return proxy.doProxy('DELETE', host, path, param, body, ctx);
            }
        })();
        return client;
    }

    /**
     * GET HOST/PATH?$param
     */
    public doGet = async (id: string, cmd?: string, $param?: any, $body?: any) => {
        return this.client.doGet(id, cmd, $param, $body);
    };

    /**
     * PUT HOST/PATH?$param
     */
    public doPut = async (id: string, cmd?: string, $param?: any, $body?: any) => {
        return this.client.doPut(id, cmd, $param, $body);
    };

    /**
     * POST HOST/PATH?$param
     */
    public doPost = async (id: string, cmd?: string, $param?: any, $body?: any) => {
        return this.client.doPost(id, cmd, $param, $body);
    };

    /**
     * PATCH HOST/PATH?$param
     */
    public doPatch = async (id: string, cmd?: string, $param?: any, $body?: any) => {
        return this.client.doPatch(id, cmd, $param, $body);
    };

    /**
     * DELETE HOST/PATH?$param
     */
    public doDelete = async (id: string, cmd?: string, $param?: any, $body?: any) => {
        return this.client.doDelete(id, cmd, $param, $body);
    };
}

/** ********************************************************************************************************************
 *  BODY IMPLEMENTATION.
 ** ********************************************************************************************************************/
import URL from 'url';
import REQUEST from 'request';
import queryString from 'query-string';

/**
 * create http-proxy client
 * @param name      client-name
 * @param endpoint  service url (or backbone proxy-url)
 * @param headers   headers
 * @param encoder   path encoder (default encodeURIComponent)
 * @param relayHeaderKey   relay-key in headers for proxy.
 * @param resultKey   resultKey in response
 */
export const createHttpWebProxy = (
    name: string,
    endpoint: string,
    headers?: APIHeaders,
    encoder?: (name: string, path: string) => string,
    relayHeaderKey?: string,
    resultKey?: string,
): ApiHttpProxy => {
    if (!endpoint) throw new Error('@endpoint (url) is required!');
    const NS = $U.NS(`X${name}`, 'magenta'); // NAMESPACE TO BE PRINTED.
    encoder = encoder !== undefined ? encoder : (name, path) => path;
    relayHeaderKey = relayHeaderKey || '';

    /**
     * class: `ApiHttpProxy`
     * - http proxy client via backbone's web.
     */
    return new (class implements ApiHttpProxy {
        public hello = () => `http-web-proxy:${name}`;
        public doProxy<T = any>(
            method: APIHttpMethod,
            host: string,
            path?: string,
            $param?: any,
            $body?: any,
            ctx?: any,
        ): Promise<T> {
            if (!method) throw new Error('@method is required!');
            _log(NS, `doProxy(${method})..`);
            host && _log(NS, `> host =`, host);
            path && _log(NS, `> path =`, path);

            //! prepare request parameters
            const query_string = $param ? queryString.stringify($param) : '';
            const url =
                endpoint +
                (host === undefined ? '' : `/${encoder('host', host)}`) +
                (host === undefined && path === undefined ? '' : `/${encoder('path', path)}`) +
                (!query_string ? '' : '?' + query_string);
            const request = REQUEST;
            const options: any = {
                method,
                uri: url,
                headers: {},
                body: $body === null ? undefined : $body,
                json: typeof $body === 'string' ? false : true,
            };

            //! relay HEADERS to `WEB-API`
            if (headers) {
                options.headers = Object.keys(headers).reduce((H: any, key: string) => {
                    const val = headers[key];
                    const name = `${relayHeaderKey}${key}`;
                    const text = `${val}`;
                    H[name] = text;
                    return H;
                }, options.headers);
            }
            _log(NS, ' url :=', options.method, url);
            _log(NS, '*', options.method, url, options.json ? 'json' : 'plain');
            _log(NS, '> options =', $U.json(options));

            //! returns promise
            return new Promise((resolve, reject) => {
                //! start request..
                request(options, function(error: any, response: any, body: any) {
                    error && _err(NS, '>>>>> requested! err=', error);
                    if (error) return reject(error);
                    //! detecte trouble.
                    const statusCode = response.statusCode;
                    const statusMessage = response.statusMessage;
                    if (statusCode !== 200) {
                        //! handle for not-found.
                        if (statusCode === 400 || statusCode === 404) {
                            const msg = `${body || '404 NOT FOUND'}`;
                            return reject(new Error(msg.startsWith('404 NOT FOUND') ? msg : `404 NOT FOUND - ${msg}`));
                        }
                        statusMessage && _log(NS, `> statusMessage[${statusCode}] =`, statusMessage);
                        body && _log(NS, `> body[${statusCode}] =`, body);
                        body = body || statusMessage;
                        return reject(typeof body === 'string' ? new Error(body) : body);
                    }
                    //! try to parse body.
                    try {
                        if (body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')) {
                            body = JSON.parse(body);
                        } else if (body && typeof body == 'string' && body.startsWith('[') && body.endsWith(']')) {
                            body = JSON.parse(body);
                        }
                    } catch (e) {
                        _err(NS, '!WARN! parse(body) =', e);
                    }
                    //! ok! successed.
                    resolve(body);
                });
            }).then((res: any) => {
                if (resultKey && res && res[resultKey] !== undefined) return res[resultKey];
                return res;
            });
        }
    })();
};