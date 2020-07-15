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
import { loadJsonSync } from '../tools/shared';
import { GETERR } from '../common/test-helper';
import fs from 'fs';
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
    doGet<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T>;
    doPut<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T>;
    doPost<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T>;
    doPatch<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T>;
    doDelete<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T>;
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
     * @param hash      (optional) hash value (valid only for client-side).
     */
    doProxy<T = any>(
        method: APIHttpMethod,
        host: string,
        path?: string,
        param?: any,
        body?: any,
        ctx?: any,
        hash?: string,
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
    public doGet<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        return this.service.doGet(id, cmd, param, body, hash);
    }
    public doPut<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        return this.service.doPut(id, cmd, param, body, hash);
    }
    public doPost<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        return this.service.doPost(id, cmd, param, body, hash);
    }
    public doPatch<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        return this.service.doPatch(id, cmd, param, body, hash);
    }
    public doDelete<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        return this.service.doDelete(id, cmd, param, body, hash);
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
     * // via python
     * const api = new API('residents', 'http://localhost:8113', {});
     * api.doGet('123');    // http GET :8113/residents/123
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
     * @param proxy     proxy-service to use if there is no client (or use backbone server)
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
        _log(NS, `buildClient(${type || ''})...`);
        if (!endpoint) throw new Error('@endpoint (url) is required');
        const host = `${endpoint || ''}`.split('/')[2];
        //! if using backbone, need host+path for full-url. or need only `type` + `id/cmd` pair for direct http agent.
        const base = !proxy && backbone ? `${endpoint || ''}` : undefined;
        //! make the default proxy-client if not in.
        if (proxy) {
            proxy = proxy;
        } else if (backbone) {
            //! use web-proxy configuration.
            const NAME = `WEB:${host}-${type || ''}`;
            const encoder = (name: string, path: string) => encodeURIComponent(path);
            const relayHeaderKey = 'x-lemon-';
            const resultKey = 'result';
            //! use default backbone's web-proxy service.
            proxy = createHttpWebProxy(NAME, `${backbone}/web`, headers, encoder, relayHeaderKey, resultKey);
        } else {
            //! use direct web request.. (only read `type` + `id/cmd` later)
            const NAME = `API:${host}-${type || ''}`;
            proxy = createHttpWebProxy(NAME, endpoint, headers, (n, s) => s, '');
        }
        /**
         * create internal client to translate of full url path with `host`+`path`
         */
        return new APIService.ProxyServiceClient(proxy, base, type);
    }

    /**
     * make a client for sub-typed endpoint.
     * @param type      sub-type path.
     */
    public buildSubTypeClient(type: string, useRecord?: boolean, folder?: string): APIServiceClient {
        const client = new APIService.SubTypeClient(this, type);
        return useRecord ? new APIService.APIServiceClientRecorder(client, `${this.endpoint}/${type}`, folder) : client;
    }

    /**
     * make api recorder of this service.
     * @param folder    base folder (default `./logs`)
     */
    public buildRecorder(folder?: string): APIServiceClient {
        return new APIService.APIServiceClientRecorder(this, this.endpoint, folder);
    }

    /**
     * class: `TypedEndpoint`
     * - by using common proxy, extends endpoint by type.
     * - endpoint := base+'/'+type.
     */
    private static ProxyServiceClient = class implements APIServiceClient {
        public readonly proxy: ApiHttpProxy;
        public readonly base: string;
        public readonly type: string;
        public constructor(proxy?: ApiHttpProxy, base?: string, type?: string) {
            this.proxy = proxy;
            this.base = base;
            this.type = type;
        }
        protected asPath = (id?: string, cmd?: string) => {
            const type = this.type;
            const _isNa = (a: any) => a === undefined || a === null;
            return (
                '' +
                (_isNa(type) ? '' : '/' + encodeURIComponent(type)) +
                (_isNa(type) || _isNa(id) ? '' : '/' + encodeURIComponent(id)) +
                (_isNa(type) || _isNa(id) || _isNa(cmd) ? '' : '/' + encodeURI(cmd)) + //NOTE - cmd could have additional '/' char.
                ''
            );
        };
        protected asPath2 = (id?: string, cmd?: string) => {
            const _isNa = (a: any) => a === undefined || a === null;
            return (
                '' +
                (_isNa(id) ? '' : encodeURIComponent(id)) +
                (_isNa(id) || _isNa(cmd) ? '' : '/' + encodeURI(cmd)) + //NOTE - cmd could have additional '/' char.
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
                // console.info(`! asHostPath(${id}, ${cmd})@1 => `, { host, path });
            } else {
                // console.info(`! asHostPath(${id}, ${cmd})@2 => `, { host, path });
            }
            return { host, path };
        };
        public hello = () => `api-client:${this.proxy.hello()}`;
        public async doGet(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            const { host, path } = this.asHostPath(id, cmd);
            return this.proxy.doProxy('GET', host, path, param, body, null, hash);
        }
        public async doPut(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            const { host, path } = this.asHostPath(id, cmd);
            return this.proxy.doProxy('PUT', host, path, param, body, null, hash);
        }
        public async doPost(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            const { host, path } = this.asHostPath(id, cmd);
            return this.proxy.doProxy('POST', host, path, param, body, null, hash);
        }
        public async doPatch(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            const { host, path } = this.asHostPath(id, cmd);
            return this.proxy.doProxy('PATCH', host, path, param, body, null, hash);
        }
        public async doDelete(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            const { host, path } = this.asHostPath(id, cmd);
            return this.proxy.doProxy('DELETE', host, path, param, body, null, hash);
        }
    };

    /**
     * use sub-typed endpoint.
     * - extends as endpoint := parent.endpoint + '/' + type
     */
    public static SubTypeClient = class implements APIServiceClient {
        public readonly parent: APIServiceClient;
        public readonly type: string;
        public constructor(parent: APIServiceClient, type: string) {
            this.parent = parent;
            this.type = `${type || ''}`;
        }
        public hello = () => `sub-typed:${this.parent.hello()}`;
        public asCmd = (id: string, cmd?: string) => {
            if (id === undefined || id === null) return '';
            if (id != encodeURI(id)) throw new Error(`@id (string) is not valid format.`);
            return cmd !== undefined && cmd !== null ? `${id || ''}/${cmd}` : `${id || ''}`;
        };
        public async doGet(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.parent.doGet(this.type, this.asCmd(id, cmd), param, body, hash);
        }
        public async doPut(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.parent.doPut(this.type, this.asCmd(id, cmd), param, body, hash);
        }
        public async doPost(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.parent.doPost(this.type, this.asCmd(id, cmd), param, body, hash);
        }
        public async doPatch(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.parent.doPatch(this.type, this.asCmd(id, cmd), param, body, hash);
        }
        public async doDelete(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.parent.doDelete(this.type, this.asCmd(id, cmd), param, body, hash);
        }
    };

    /**
     * recorder of api-http-proxy client.
     */
    public static ApiHttpProxyRecorder = class implements ApiHttpProxy {
        public readonly target: ApiHttpProxy;
        public readonly folder: string;
        public static next: number = 1;
        public constructor(target: ApiHttpProxy, folder?: string) {
            this.target = target;
            this.folder = `${folder || './logs'}`;
        }
        public hello = () => `recorder:${this.target.hello()}`;
        public async doProxy<T = any>(
            method: APIHttpMethod,
            host: string,
            path?: string,
            param?: any,
            body?: any,
            context?: any,
            hash?: string,
        ): Promise<T> {
            const endpoint =
                host.startsWith('http://') || host.startsWith('https://') ? `${host}${path}` : `http://${host}${path}`;
            const index = APIService.ApiHttpProxyRecorder.next++;
            const load = { method, endpoint, param, body, context };
            return this.target
                .doProxy(method, host, path, param, body, context, hash)
                .then((data: any) => ({ index, load, data, error: null }))
                .catch((error: any) => ({ index, load, data: null, error }))
                .then(({ index, load, data, error }) => {
                    const baseDir = (() => {
                        // eslint-disable-next-line prettier/prettier
                        const ts = $U.ts().substring(0, '1999-01-01'.length).replace(/\-/ig, '');
                        const fn = `${this.folder}/R${ts}`;
                        if (index <= 1 && !fs.existsSync(`${this.folder}`)) fs.mkdirSync(`${this.folder}`);
                        if (index <= 1 && !fs.existsSync(fn)) fs.mkdirSync(fn);
                        return fn;
                    })();
                    // eslint-disable-next-line prettier/prettier
                    const message = error instanceof Error ? `${error.message}` : typeof error != 'object' ? `${error}` : error ? JSON.stringify(error) : '';
                    const fn = (n: number): string => {
                        const [S, s] = ['00000', `${n}`];
                        return n > 0 ? `${S.substring(s.length)}${s}` : s.startsWith('-') ? `N${s.substring(1)}` : s;
                    };
                    const file = `${baseDir}/P${fn(index)}.json`;
                    fs.writeFileSync(file, JSON.stringify({ param: load, data, error: message }, null, '  '), 'utf8');
                    if (error) throw error;
                    else return data;
                });
        }
    };

    /**
     * recorder of api-service client.
     */
    public static APIServiceClientRecorder = class implements APIServiceClient {
        public readonly target: APIServiceClient;
        public readonly endpoint: string;
        public readonly folder: string;
        public static next: number = 1;
        public constructor(target: APIServiceClient, endpoint: string, folder?: string) {
            this.target = target;
            this.endpoint = `${endpoint || ''}`;
            this.folder = `${folder || './logs'}`;
        }
        public hello = () => `recorder:${this.target.hello()}`;
        public async doRecord(method: APIHttpMethod, id: string, cmd?: string, param?: any, body?: any, hash?: string) {
            const index = APIService.APIServiceClientRecorder.next++;
            const load = { method, endpoint: `${this.endpoint || ''}`, id, cmd, param, body };
            const call = async (method: APIHttpMethod) => {
                if (method == 'GET') return this.target.doGet(id, cmd, param, body, hash);
                if (method == 'PUT') return this.target.doPut(id, cmd, param, body, hash);
                if (method == 'POST') return this.target.doPost(id, cmd, param, body, hash);
                if (method == 'PATCH') return this.target.doPatch(id, cmd, param, body, hash);
                if (method == 'DELETE') return this.target.doDelete(id, cmd, param, body, hash);
                throw new Error(`@method is not valid. method:${method}`);
            };
            return call(method)
                .then((data: any) => ({ index, load, data, error: null }))
                .catch((error: any) => ({ index, load, data: null, error }))
                .then(({ index, load, data, error }) => {
                    const baseDir = (() => {
                        // eslint-disable-next-line prettier/prettier
                        const ts = $U.ts().substring(0, '1999-01-01'.length).replace(/\-/ig, '');
                        const fn = `${this.folder}/R${ts}`;
                        if (index <= 1 && !fs.existsSync(`${this.folder}`)) fs.mkdirSync(`${this.folder}`);
                        if (index <= 1 && !fs.existsSync(fn)) fs.mkdirSync(fn);
                        return fn;
                    })();
                    // eslint-disable-next-line prettier/prettier
                    const message = error instanceof Error ? `${error.message}` : typeof error != 'object' ? `${error}` : error ? JSON.stringify(error) : '';
                    const fn = (n: number): string => {
                        const [S, s] = ['00000', `${n}`];
                        return n > 0 ? `${S.substring(s.length)}${s}` : s.startsWith('-') ? `N${s.substring(1)}` : s;
                    };
                    const file = `${baseDir}/D${fn(index)}.json`;
                    fs.writeFileSync(file, JSON.stringify({ param: load, data, error: message }, null, '  '), 'utf8');
                    if (error) throw error;
                    else return data;
                });
        }
        public async doGet(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.doRecord('GET', id, cmd, param, body, hash);
        }
        public async doPut(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.doRecord('PUT', id, cmd, param, body, hash);
        }
        public async doPost(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.doRecord('POST', id, cmd, param, body, hash);
        }
        public async doPatch(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.doRecord('PATCH', id, cmd, param, body, hash);
        }
        public async doDelete(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<any> {
            return this.doRecord('DELETE', id, cmd, param, body, hash);
        }
    };

    /**
     * GET HOST/PATH?$param
     */
    public doGet = async (id: string, cmd?: string, $param?: any, $body?: any, hash?: string) => {
        return this.client.doGet(id, cmd, $param, $body, hash);
    };

    /**
     * PUT HOST/PATH?$param
     */
    public doPut = async (id: string, cmd?: string, $param?: any, $body?: any, hash?: string) => {
        return this.client.doPut(id, cmd, $param, $body, hash);
    };

    /**
     * POST HOST/PATH?$param
     */
    public doPost = async (id: string, cmd?: string, $param?: any, $body?: any, hash?: string) => {
        return this.client.doPost(id, cmd, $param, $body, hash);
    };

    /**
     * PATCH HOST/PATH?$param
     */
    public doPatch = async (id: string, cmd?: string, $param?: any, $body?: any, hash?: string) => {
        return this.client.doPatch(id, cmd, $param, $body, hash);
    };

    /**
     * DELETE HOST/PATH?$param
     */
    public doDelete = async (id: string, cmd?: string, $param?: any, $body?: any, hash?: string) => {
        return this.client.doDelete(id, cmd, $param, $body, hash);
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
            // const _log = console.info;
            if (!method) throw new Error('@method is required!');
            _log(NS, `doProxy(${method})..`);
            const _isNa = (a: any) => a === undefined || a === null;
            _log(NS, '> endpoint =', endpoint);
            _isNa(path1) && _log(NS, `> host(id) =`, typeof path1, path1);
            _isNa(path2) && _log(NS, `> path(cmd) =`, typeof path2, path2);

            //! prepare request parameters
            // eslint-disable-next-line prettier/prettier
            const query_string = _isNa($param) ? '' : (typeof $param == 'object' ? queryString.stringify($param) : `${$param}`);
            const url =
                endpoint +
                (_isNa(path1) ? '' : `/${encoder('host', path1)}`) +
                (_isNa(path1) && _isNa(path2) ? '' : `/${encoder('path', path2)}`) +
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
                    if (error) return reject(error instanceof Error ? error : new Error(GETERR(error)));
                    //! detecte trouble.
                    const statusCode = response.statusCode;
                    const statusMessage = response.statusMessage;
                    //! if not in success
                    if (statusCode !== 200 && statusCode !== 201) {
                        const msg = body ? GETERR(body) : `${statusMessage || ''}`;
                        if (statusCode === 400 || statusCode === 404) {
                            const title = `${(statusCode == 404 ? '' : statusMessage) || 'NOT FOUND'}`.toUpperCase();
                            const message = msg.startsWith('404 NOT FOUND') ? msg : `${statusCode} ${title} - ${msg}`;
                            return reject(new Error(message));
                        }
                        statusMessage && _log(NS, `> statusMessage[${statusCode}] =`, statusMessage);
                        body && _log(NS, `> body[${statusCode}] =`, $U.json(body));
                        return reject(new Error(`${statusCode} ${statusMessage || 'FAILURE'} - ${msg}`));
                    }
                    //! try to parse body.
                    try {
                        if (body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')) {
                            body = JSON.parse(body);
                        } else if (body && typeof body == 'string' && body.startsWith('[') && body.endsWith(']')) {
                            body = JSON.parse(body);
                        }
                    } catch (e) {
                        _err(NS, '!WARN! parse(body) =', e instanceof Error ? e : $U.json(e));
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
/**
 * class: `MocksAPIService`
 * - use <mock>.json file in `./data/mocks/` instead of real http request.
 * - it redirect to url like `endpoint/type/id/cmd`
 *
 * ```ts
 * // json format
 * {
 *    param: {          // input format
 *      method: string;
 *      endpoint: string;
 *      id?: string;
 *      cmd?: string;
 *    },
 *    data: {           // response data
 *      ...
 *    },
 *    error?: string;   // in case of error.
 * }
 * ```
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
                const { method, endpoint: endpoint0, id, cmd, param: $qs } = param;
                const has = (a: any) => a !== undefined && a !== null;
                const [endpoint, hash] = `${endpoint0}`.split('#', 2);
                const qs = $qs ? $U.qs.stringify($qs) : '';
                const url = `${endpoint}` + (has(id) ? `/${id}` : '') + (has(id) && has(cmd) ? `/${cmd}` : '');
                const key = `${method} ${url}`;
                const key2 = qs ? `${key}${key.indexOf('?') > 0 ? '&' : '?'}${qs}` : key;
                const key3 = hash ? `${key2}${hash ? '#' : ''}${hash || ''}` : key2;
                // if (file.indexOf('#') > 0) console.info(`! file[${file}] =`, key3);
                //! save by file & key.
                M[file] = data;
                M[key3] = data;
                return M;
            }, {});
        // console.log(NS, '> $map =', $map);
        this.$map = $map;
    }

    protected asPath = (id?: string, cmd?: string) => {
        const _isNa = (a: any) => a === undefined || a === null;
        return (_isNa(id) ? '' : encodeURIComponent(id)) + (_isNa(id) || !cmd ? '' : '/' + encodeURI(cmd));
    };

    public async doProxy<T = any>(
        method: APIHttpMethod,
        type: string,
        path: string,
        param?: any,
        body?: any,
        ctx?: any,
        hash?: string,
    ): Promise<T> {
        // console.info(`! mocks.proxy(${method},${type},${path})...`);
        this.loadSync();
        const file = path && path.endsWith('.json') ? path.split('/').pop() : '';
        // eslint-disable-next-line prettier/prettier
        const key = `${method} ${this.endpoint}${this.na(type, '', '/')}${type || ''}${!path || path.startsWith('/') ? '' : '/'}${path || ''}`;
        const qs = param ? $U.qs.stringify(param) : '';
        const key2 = qs ? `${key}${path.indexOf('?') > 0 ? '&' : '?'}${qs}` : key;
        const key3 = hash ? `${key2}${hash.startsWith('#') ? '' : '#'}${hash}` : key2;
        // if (param) console.info('!key[] =', [key3, key2, key]);
        // if (hash) console.info(`! hash[${hash}].keys =`, [key3, key2, key]);
        const data: any = this.$map[file] || this.$map[key3] || this.$map[key2] || this.$map[key];
        if (!data) throw new Error(`404 NOT FOUND - ${key3}`);
        const err = data.error;
        if (err && typeof err == 'string') {
            if (err.startsWith('{') && err.endsWith('}')) throw JSON.parse(err);
            else throw new Error(err);
        } else if (err) {
            throw err;
        }
        //! returns data.
        return data.data ? JSON.parse($U.json(data.data)) : data.data;
    }

    protected na = (a: any, x: string, y: string) => (a === undefined || a === null ? x : y);
    public hello = () => `mocks-api-service:${this.endpoint}${this.na(this.type, '', '/')}${this.type || ''}`;
    public doGet<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        const path = this.asPath(id, cmd); // use mocks.type infor
        return this.doProxy<T>('GET', this.type, path, param, body, null, hash);
    }
    public doPut<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        const path = this.asPath(id, cmd); // use mocks.type infor
        return this.doProxy<T>('PUT', this.type, path, param, body, null, hash);
    }
    public doPost<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        const path = this.asPath(id, cmd); // use mocks.type infor
        return this.doProxy<T>('POST', this.type, path, param, body, null, hash);
    }
    public doPatch<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        const path = this.asPath(id, cmd); // use mocks.type infor
        return this.doProxy<T>('PATCH', this.type, path, param, body, null, hash);
    }
    public doDelete<T = any>(id: string, cmd?: string, param?: any, body?: any, hash?: string): Promise<T> {
        const path = this.asPath(id, cmd); // use mocks.type infor
        return this.doProxy<T>('DELETE', this.type, path, param, body, null, hash);
    }
}
