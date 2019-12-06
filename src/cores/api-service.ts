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
 * class: `APIServiceClient`
 * - General API Request Client w/ url like `GET <endpoint>/<id>?/<cmd>?`
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
 * class: `ApiHttpProxy`
 * - http proxy service.
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
 * class: `APIProxyClient`
 * - proxed APIServiceClient
 */
export class APIProxyClient implements APIServiceClient {
    protected service: APIServiceClient;
    public constructor(service: APIServiceClient) {
        this.service = service;
    }
    public hello = () => this.service.hello();
    public doGet<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.service.doGet(id, cmd, param, body);
    }
    public doPut<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.service.doPut(id, cmd, param, body);
    }
    public doPost<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.service.doPost(id, cmd, param, body);
    }
    public doPatch<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.service.doPatch(id, cmd, param, body);
    }
    public doDelete<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.service.doDelete(id, cmd, param, body);
    }
}

/**
 * class: `APIService`
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
     * // basic
     * const api = new API('web', 'http://localhost:8081', {});
     * api.doGet('');
     *
     * // proxy server
     * const api = new API('web', 'http://localhost:8081', {}, null, proxy);
     * api.doGet('');
     * ```
     *
     * @param type      type in endpoint
     * @param endpoint  base endpoint (support ONLY http, https)
     * @param headers   common headers.
     * @param client    real api-client to use (or use proxy, or create default)
     * @param proxy     proxy-service to use if there is no client
     */
    public constructor(
        type: string,
        endpoint: string,
        headers?: APIHeaders,
        client?: APIServiceClient,
        proxy?: ApiHttpProxy,
    ) {
        if (!endpoint) throw new Error('@endpoint (url) is required');
        if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://'))
            throw new Error(`@endpoint (url) is not valid http-url:${endpoint}`);
        this.type = type;
        this.endpoint = endpoint;
        this.headers = headers;
        if (client) {
            this.client = client;
        } else if (proxy) {
            this.client = APIService.buildClient(this.type, this.endpoint, this.headers, null, proxy);
        } else {
            //! use default `env.BACKBONE_API` to detect proxy-server.
            const BACKBONE = $engine.environ('BACKBONE_API', 'http://localhost:8081') as string;
            this.client = APIService.buildClient(this.type, this.endpoint, this.headers, BACKBONE);
        }
    }

    //! relay hello.
    public hello = () => `api-service:${this.client.hello()}`;

    /**
     * helper to make http client
     *
     * @param backbone  backbone address like 'http://localhost:8081'
     */
    public static buildClient(
        type: string,
        endpoint: string,
        headers?: APIHeaders,
        backbone?: string,
        proxy?: ApiHttpProxy,
    ): APIServiceClient {
        _log(NS, `buildClient(${type})...`);
        if (!endpoint) throw new Error('@endpoint (url) is required');
        type = `${type || ''}`;
        const host = `${endpoint || ''}`.split('/')[2];
        //! if using backbone, need host+path for full-url. or need only `type` + `id/cmd` pair for direct http agent.
        const base = backbone ? `${endpoint || ''}` : undefined;
        //! make the default proxy-client if not in.
        if (proxy) {
            proxy = proxy;
        } else if (backbone) {
            //! use web-proxy configuration.
            const NAME = `WEB:${host}-${type}`;
            const encoder = (name: string, path: string) => encodeURIComponent(path);
            const relayHeaderKey = 'x-lemon-';
            const resultKey = 'result';
            //! use default backbone's web-proxy service.
            proxy = createHttpWebProxy(NAME, `${backbone}/web`, headers, encoder, relayHeaderKey, resultKey);
        } else {
            //! use direct web request.. (only read `type` + `id/cmd` later)
            const NAME = `API:${host}-${type}`;
            proxy = createHttpWebProxy(NAME, endpoint, headers, (n, s) => s, '');
        }

        /**
         * create internal client to translate of full url path with `host`+`path`
         */
        const client = new (class implements APIServiceClient {
            private proxy: ApiHttpProxy;
            private base: string;
            private type: string;
            public constructor(proxy?: ApiHttpProxy, base?: string, type?: string) {
                this.proxy = proxy;
                this.base = base;
                this.type = type;
            }
            protected asPath = (id?: string, cmd?: string) => {
                const type = this.type;
                return (
                    '' +
                    (type === undefined ? '' : '/' + encodeURIComponent(type)) +
                    (type === undefined || id === undefined ? '' : '/' + encodeURIComponent(id)) +
                    (type === undefined || id === undefined || cmd === undefined ? '' : '/' + encodeURI(cmd)) + //NOTE - cmd could have additional '/' char.
                    ''
                );
            };
            protected asPath2 = (id?: string, cmd?: string) => {
                return (
                    '' +
                    (id === undefined ? '' : encodeURIComponent(id)) +
                    (id === undefined || cmd === undefined ? '' : '/' + encodeURI(cmd)) + //NOTE - cmd could have additional '/' char.
                    ''
                );
            };
            protected asHostPath = (id?: string, cmd?: string) => {
                let host = this.base ? this.base : this.type;
                let path = this.base ? this.asPath(id, cmd) : this.asPath2(id, cmd);
                if (this.base) {
                    const url = (!host.startsWith('http') ? 'http://' : '') + `${host}${path || ''}`;
                    const $url = URL.parse(url);
                    host = `${$url.protocol || 'http'}//${$url.hostname}`;
                    path = `${$url.path}`;
                }
                // this.base || console.info(`! asHostPath(${id}, ${cmd}) => `, { host, path });
                return { host, path };
            };
            public hello = () => `api-client:${this.proxy.hello()}`;
            public doGet(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(id, cmd);
                return this.proxy.doProxy('GET', host, path, param, body, ctx);
            }
            public doPut(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(id, cmd);
                return this.proxy.doProxy('PUT', host, path, param, body, ctx);
            }
            public doPost(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(id, cmd);
                return this.proxy.doProxy('POST', host, path, param, body, ctx);
            }
            public doPatch(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(id, cmd);
                return this.proxy.doProxy('PATCH', host, path, param, body, ctx);
            }
            public doDelete(id: string, cmd?: string, param?: any, body?: any, ctx?: any): Promise<any> {
                const { host, path } = this.asHostPath(id, cmd);
                return this.proxy.doProxy('DELETE', host, path, param, body, ctx);
            }
        })(proxy, base, type);
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
 * create http-web-proxy agent which using endpoint as proxy server.
 *
 * # as cases.
 * as proxy agent: GET <endpoint>/<host?>/<path?>
 * as direct agent: GET <endpoint>/<id?>/<cmd?>
 *
 * @param name              client-name
 * @param endpoint          service url (or backbone proxy-url)
 * @param headers           headers
 * @param encoder           path encoder (default encodeURIComponent)
 * @param relayHeaderKey    relay-key in headers for proxy.
 * @param resultKey         resultKey in response
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
        public constructor() {}
        public hello = () => `http-web-proxy:${name}`;
        public doProxy<T = any>(
            method: APIHttpMethod,
            path1?: string,
            path2?: string,
            $param?: any,
            $body?: any,
            ctx?: any,
        ): Promise<T> {
            if (!method) throw new Error('@method is required!');
            _log(NS, `doProxy(${method})..`);
            path1 && _log(NS, `> host(id) =`, path1);
            path2 && _log(NS, `> path(cmd) =`, path2);

            //! prepare request parameters
            const query_string = $param ? queryString.stringify($param) : '';
            const url =
                endpoint +
                (path1 === undefined ? '' : `/${encoder('host', path1)}`) +
                (path1 === undefined && path2 === undefined ? '' : `/${encoder('path', path2)}`) +
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

/** ********************************************************************************************************************
 *  MOCKS API-SERVICE
 ** ********************************************************************************************************************/
import fs from 'fs';
import { loadJsonSync } from '../tools/shared';
// import { ApiHttpProxy, APIHttpMethod } from 'lemon-core/dist/cores/api-service';

/**
 * class: `MocksAPIService`
 * - use `mocks` data instead of real http request.
 * - it redirect to url like `endpoint/type/id/cmd`
 */
export class MocksAPIService implements ApiHttpProxy, APIServiceClient {
    private $map: any;
    private type: string;
    private endpoint: string;
    public constructor(type: string, endpoint: string) {
        this.type = type;
        this.endpoint = endpoint;
    }

    protected loadSync() {
        if (this.$map) return;
        const PATH = './data/mocks/';
        const files = fs.readdirSync(PATH);
        // console.log(NS, '> files =', files);
        const $map = files
            .sort()
            .map(file => ({ file, json: loadJsonSync(`${PATH}${file}`) }))
            .reduce((M: any, F) => {
                const file = F.file || '';
                const data = F.json;
                const param: any = data.param || {};
                const { method, endpoint, id, cmd } = param;
                const url = `${endpoint}` + (id ? `/${id}` : '') + (id && cmd ? `/${cmd}` : '');
                const key = `${method} ${url}`;
                //! save by file & key.
                M[file] = data;
                M[key] = data;
                return M;
            }, {});
        // console.log(NS, '> $map =', $map);
        this.$map = $map;
    }

    protected asPath = (type?: string, path?: string) => {
        return (
            '' +
            (type === undefined ? '' : '/' + encodeURIComponent(type)) +
            (type === undefined || !path ? '' : '/' + encodeURI(path)) +
            ''
        );
    };

    public async doProxy<T = any>(
        method: APIHttpMethod,
        type: string,
        path: string,
        param?: any,
        body?: any,
        ctx?: any,
    ): Promise<T> {
        // console.info(`! mocks.proxy(${method},${type},${path})...`);
        this.loadSync();
        const file = path && path.endsWith('.json') ? path.split('/').pop() : '';
        const key = `${method} ${this.endpoint}${this.asPath(this.type, path)}`;
        const data: any = this.$map[file] || this.$map[key];
        if (!data) throw new Error(`404 NOT FOUND - ${key}`);
        const err = data.error;
        if (err && typeof err == 'string') {
            if (err.startsWith('{') && err.endsWith('}')) throw JSON.parse(err);
            else throw new Error(err);
        } else if (err) {
            throw err;
        }
        return data.data ? JSON.parse($U.json(data.data)) : data.data;
    }
    public hello = () => `mocks-api-service:${this.endpoint}/${this.type}`;
    public doGet<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.doProxy<T>('GET', id, cmd, param, body);
    }
    public doPut<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.doProxy<T>('PUT', id, cmd, param, body);
    }
    public doPost<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.doProxy<T>('POST', id, cmd, param, body);
    }
    public doPatch<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.doProxy<T>('PATCH', id, cmd, param, body);
    }
    public doDelete<T = any>(id: string, cmd?: string, param?: any, body?: any): Promise<T> {
        return this.doProxy<T>('DELETE', id, cmd, param, body);
    }
}
