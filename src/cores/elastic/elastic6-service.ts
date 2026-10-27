/**
 * `elastic6-service.ts`
 * - common service for OpenSearch (file name kept; identifiers renamed in v5 B2-b)
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 * @date        2022-02-21 optimized error handler, and search.
 * @date        2022-02-22 optimized w/ elastic client (elasticsearch-js)
 * @date        2026-10-27 v5 B2-b: `@opensearch-project/opensearch` client, no doc `type`, no version detection.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../../engine/';
import { Incrementable, SearchBody } from 'lemon-model';
import type { Client, ApiResponse, ClientOptions } from '@opensearch-project/opensearch';
import $hangul from './hangul-service';
import { measure } from '../../lib/perf';
import { GETERR, waited } from '../../common/test-helper';
const NS = $U.NS('OS2', 'green'); // NAMESPACE TO BE PRINTED.

// export shared one
export { $hangul };
export type SearchType = 'query_then_fetch' | 'dfs_query_then_fetch';

// export type SearchResponse = elasticsearch.SearchResponse<any>;
export interface SearchResponse<T = any> {
    total: number;
    list: Array<T>;
    last: Array<T>;
    aggregations: T;
}

/**
 * options for construction.
 * - v5: the doc-type and version options are removed (typeless OpenSearch only).
 */
export interface OS2BaseOption {
    /**
     * endpoint url of OpenSearch
     */
    endpoint: string;
    /**
     * index-name
     */
    indexName: string;
    /**
     * id-name (optional if time-seriese)
     */
    idName?: string;
    /**
     * is TIMESERIES data?
     */
    timeSeries?: boolean;
    /**
     * fields to provide autocomplete(Search-as-You-Type) feature
     */
    autocompleteFields?: string[] | null;
}
/**
 * common type of item
 */
export interface OS2Item {
    _id?: string;
    _version?: number;
    _score?: number;
    /**
     * only has simple string or number (and in arrays)
     */
    [key: string]: string | string[] | number | number[] | undefined;
}

/**
 * options for retrying searchAll
 */
export interface RetryOptions {
    /** do retry? (default true) */
    do?: boolean;
    /** retry after t msec (default 5000ms) */
    t?: number;
    /** maximum Retries (default 3 times) */
    maxRetries?: number;
}

/**
 * parameters for searchAll
 */
interface ElasticSearchAllParams {
    /** search-type */
    searchType?: SearchType;
    /** limit (default -1) */
    limit?: number;
    /** options for retrying (default true)*/
    retryOptions?: RetryOptions;
}

/**
 * parameters for document operations (typeless: no `type`).
 *
 * @template T type of the body content.
 */
interface ElasticParams<T extends object = any> {
    /**
     * index name.
     */
    index: string;
    /**
     * document ID.
     */
    id: string;
    /**
     * body content.
     */
    body: T;
}
/**
 * parameters for search operations.
 * - the client sends every non-path key as-is in the query string, so the key is `search_type`.
 *
 * @template T type of the body content.
 */
interface ElasticSearchParams<T extends object = any> {
    /**
     * index name.
     */
    index: string;
    /**
     * search body content.
     */
    body: T;
    /**
     * search type
     * (e.g., 'query_then_fetch', 'dfs_query_then_fetch').
     */
    search_type?: SearchType;
}
/**
 * the client package, required on the first client creation (not at import: it loads ~546 files).
 * - `.Client` is read at call time, so a replaced `Client` on the cached module is honoured.
 */
let $opensearch: typeof import('@opensearch-project/opensearch') = null;
// memoized loader of `@opensearch-project/opensearch`.
const loadOpenSearch = (): typeof import('@opensearch-project/opensearch') => {
    //* first call only: `require` timed by one `PERF` line (D40).
    if (!$opensearch)
        $opensearch = measure(_inf, $U.NS('PERF', 'cyan'), 'lazy-load @opensearch-project/opensearch', () =>
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('@opensearch-project/opensearch'),
        );
    return $opensearch;
};
/**
 * convert to string.
 */
const _S = (v: any, def: string = '') =>
    typeof v === 'string' ? v : v === undefined || v === null ? def : typeof v === 'object' ? $U.json(v) : `${v}`;
/** ****************************************************************************************************************
 *  OS2 Client Service
 ** ****************************************************************************************************************/
/**
 * abstarct class: `OS2ClientService`
 * - holds the options and the OpenSearch client.
 * - the client is created on the first `client` access (not in the constructor).
 */
export abstract class OS2ClientService<T extends OS2Item = any> {
    protected _options: OS2BaseOption;
    /** the client, created on first access of `client` */
    protected _client?: Client;

    /**
     * default constuctor w/ options (no client is created here).
     * @param options { endpoint, indexName } is required.
     */
    public constructor(options: OS2BaseOption) {
        _inf(NS, `OS2ClientService(${options.indexName}/${options.idName})...`);
        if (!options.endpoint) throw new Error('.endpoint (URL) is required');
        if (!options.indexName) throw new Error('.indexName (string) is required');

        // default option values: idName='$id'
        this._options = { idName: '$id', ...options };
    }

    /**
     * build the client for `options.endpoint` (override to add `auth`).
     * @see https://opensearch.org/docs/latest/clients/javascript/index/
     */
    protected createClient(): Client {
        return this.newClient();
    }

    /**
     * build a client for `options.endpoint` with extra client options (e.g. `auth`); loads the package on first use.
     */
    protected newClient(extra?: Partial<ClientOptions>): Client {
        const { Client } = loadOpenSearch();
        //* `PERF > client OS2`: constructor time (at most once per instance, D40).
        return measure(
            _inf,
            $U.NS('PERF', 'cyan'),
            'client OS2',
            () =>
                new Client({
                    node: this.options.endpoint,
                    ssl: {
                        ca: process.env.elasticsearch_certificate,
                        rejectUnauthorized: false,
                    },
                    ...extra,
                }),
        );
    }

    /**
     * get the client instance (created once, on first access).
     */
    public get client(): Client {
        if (!this._client) this._client = this.createClient();
        return this._client;
    }
    /**
     * get the current options.
     */
    public get options(): OS2BaseOption {
        return this._options;
    }
    /**
     * say hello
     */
    public abstract hello(): string;
    /**
     * save an item
     * @param id - item id
     * @param item - item to save
     */
    public abstract saveItem(id: string, item: T): Promise<T>;

    /**
     * push item for time-series data
     * @param item - item to push
     */
    public abstract pushItem(item: T): Promise<T>;

    /**
     * read item with projections
     * @param id - item id
     * @param views - projections
     */
    public abstract readItem(id: string, views?: string[] | object): Promise<T>;

    /**
     * delete an item by id
     * @param id - item id
     */
    public abstract deleteItem(id: string): Promise<T>;
    /**
     * update an item
     * @param id - item id
     * @param item - item to update
     * @param increments - fields to increment
     */
    public abstract updateItem(
        id: string,
        item: T | null,
        increments?: any,
        options?: { maxRetries?: number },
    ): Promise<T>;

    /**
     * search raw results using a query body
     * @param body - search query
     * @param searchType - type of search
     */
    public abstract searchRaw<T extends object = any>(body: any, searchType?: string): Promise<T>;

    /**
     * search and return formatted response
     * @param body - search query
     * @param searchType - type of search
     */
    public abstract search(body: any, searchType?: string): Promise<any>;
}

/** ****************************************************************************************************************
 *  OS2CoreService
 ** ****************************************************************************************************************/
/**
 * class: `OS2CoreService`
 * - extends `OS2ClientService`: document CRUD, search and index management via the client.
 * - the parent of `OS2Service`.
 */
export class OS2CoreService<T extends OS2Item = any> extends OS2ClientService {
    // internal field name to store analyzed strings for autocomplete search
    public static readonly DECOMPOSED_FIELD = '_decomposed';
    public static readonly QWERTY_FIELD = '_qwerty';
    /**
     * default constuctor w/ options.
     * @param options { endpoint, indexName } is required.
     */
    constructor(options: OS2BaseOption) {
        super(options);
        _inf('OS2CoreService', `OS2CoreService(${options.indexName}/${options.idName})...`);
    }
    /**
     * say hello of identity.
     */
    public hello = () => `os2-core-service:${this.options.indexName}`;

    /**
     * list of index
     */
    public async listIndices() {
        _log(NS, `- listIndices()`);

        //* prepare client..
        const client = this.client;
        const res = await client.cat.indices({ format: 'json' });
        _log(NS, `> indices =`, $U.json(res));

        // eslint-disable-next-line prettier/prettier
            const list0: any[] = Array.isArray(res) ? (res as any[]) : res?.body && Array.isArray(res?.body) ? (res?.body as any[]) : null;
        if (!list0) throw new Error(`@result<${typeof res}> is invalid - ${$U.json(res)}!`);

        // {"docs.count": "84", "docs.deleted": "7", "health": "green", "index": "dev-eureka-alarms-v1", "pri": "5", "pri.store.size": "234.3kb", "rep": "1", "status": "open", "store.size": "468.6kb", "uuid": "xPp-Sx86SgmhAWxT3cGAFw"}
        const list = list0.map(N => ({
            pri: $U.N(N['pri']),
            rep: $U.N(N['rep']),
            docsCount: $U.N(N['docs.count']),
            docsDeleted: $U.N(N['docs.deleted']),
            health: _S(N['health']),
            index: _S(N['index']),
            status: _S(N['status']),
            uuid: _S(N['uuid']),
            priStoreSize: _S(N['pri.store.size']),
            storeSize: _S(N['store.size']),
        }));

        return { list };
    }
    /**
     * get mapping of an index
     * @param indexName - name of the index
     */
    public async getIndexMapping() {
        const client = this.client;
        const indexName = this.options.indexName;
        const res = await client.indices.getMapping({ index: indexName }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('getMapping', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );

        const mapping = res?.body ? res.body[indexName]?.mappings : null;

        if (!mapping) throw new Error(`@indexName[${indexName}] is not found - ${$U.json(res)}!`);

        return mapping;
    }

    /**
     * find the index by name
     * @param indexName - name of the index
     */
    public async findIndex(indexName?: string) {
        indexName = indexName || this.options.indexName;
        _log(NS, `- findIndex(${indexName})`);
        const { list } = await this.listIndices();
        const found = list.findIndex(N => N.index == indexName);
        return found >= 0 ? list[found] : null;
    }

    /**
     * create index by name
     * @param settings - creating settings
     */
    public async createIndex(settings?: any) {
        const { indexName, idName, timeSeries } = this.options;
        // default: the typeless settings (`mappings.properties`)
        settings = settings || OS2CoreService.prepareSettings({ idName, timeSeries });
        if (!indexName) new Error('@index is required!');
        _log(NS, `- createIndex(${indexName})`);

        //* prepare payload
        const payload = {
            settings: {
                number_of_shards: 5,
                number_of_replicas: 1,
            },
            ...settings,
        };
        _log(NS, `> settings[${indexName}] = `, $U.json(payload));

        //* call create index..
        const client = this.client;
        const res = await client.indices.create({ index: indexName, body: payload }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('create', e => {
                const msg = GETERR(e);
                if (msg.startsWith('400 RESOURCE ALREADY EXISTS')) throw new Error(`400 IN USE - index:${indexName}`);
                throw e;
            }),
        );
        // if (res) throw res;
        _log(NS, `> create[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        //* build result.
        return {
            status: res.statusCode,
            index: indexName,
            acknowledged: res.body.shards_acknowledged,
        };
    }

    /**
     * destroy search index
     */
    public async destroyIndex() {
        const { indexName } = this.options;
        if (!indexName) new Error('@index is required!');
        _log(NS, `- destroyIndex(${indexName})`);

        //* call destroy index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.delete({ index: indexName }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('destroy', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        // if (res) throw res;
        _log(NS, `> destroy[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        return {
            status: res.statusCode,
            index: indexName,
            acknowledged: res.body.acknowledged,
        };
    }

    /**
     * refresh search index - refresh index to make all items searchable
     */
    public async refreshIndex() {
        const { indexName } = this.options;
        if (!indexName) throw new Error('.indexName is required!');
        _log(NS, `- refreshIndex(${indexName})`);

        //* call refresh index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.refresh({ index: indexName }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('refresh', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> refresh[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        return res.body;
    }

    /**
     * flush search index - force store changes into search index immediately
     */
    public async flushIndex() {
        const { indexName } = this.options;
        if (!indexName) throw new Error('.indexName is required!');
        _log(NS, `- flushIndex(${indexName})`);

        //* call flush index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.flush({ index: indexName }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('flush', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> flush[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        return res.body;
    }

    /**
     * describe `settings` and `mappings` of index.
     */
    public async describe() {
        const { indexName } = this.options;
        //* call create index..
        _log(NS, `- describe(${indexName})`);

        //* read settings.
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.getSettings({ index: indexName }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('describe', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> settings[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        const settings = (res.body && res.body[indexName] && res.body[indexName].settings) || {};
        _log(NS, `> number_of_shards =`, settings.index && settings.index.number_of_shards); // 5
        _log(NS, `> number_of_replicas =`, settings.index && settings.index.number_of_replicas); // 1

        //* read mappings.
        const res2 = await client.indices.getMapping({ index: indexName });
        _log(NS, `> mappings[${indexName}] =`, $U.json(res2));
        const mappings: any = (res2.body && res2.body[indexName] && res2.body[indexName].mappings) || {};

        //* returns
        return { settings, mappings };
    }

    /**
     * save single item
     *
     * - typeless: no `type` param (v5).
     *
     * @param id - id
     * @param item - item to save
     */
    public async saveItem(id: string, item: T): Promise<T> {
        const { indexName, idName } = this.options;
        _log(NS, `- saveItem(${id})`);
        // const { client } = instance(endpoint);
        const client = this.client;

        // prepare item body and autocomplete fields
        const body: any = { ...item, [idName]: id };
        const body2 = this.popullateAutocompleteFields(body);

        const params: ElasticParams = { index: indexName, id, body: body2 };

        if (idName === '_id') delete params.body[idName]; //WARN! `_id` is reserved in ES6.
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        const res: ApiResponse = await client.create(params).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('save', e => {
                const msg = GETERR(e);
                //* try to overwrite document..
                if (msg.startsWith('409 VERSION CONFLICT ENGINE')) {
                    // delete body2[idName]; // do set id while update
                    // return this.updateItem(id, body2);
                    const param2: ElasticParams = { index: indexName, id, body: { ...body2 } };
                    return client.index(param2);
                }
                throw e;
            }),
        );
        _log(NS, `> create[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _version: number = $U.N(res.body?._version, 0);
        const _id: string = res.body?._id;
        const res2: T = { ...body, _id, _version };
        return res2;
    }

    /**
     * push item for time-series data.
     *
     * - typeless: no `type` param (v5).
     *
     * @param item - item to push
     */
    public async pushItem(item: T): Promise<T> {
        const { indexName } = this.options;
        const id = '';

        const body: any = { ...item };
        const body2 = this.popullateAutocompleteFields(body);

        _log(NS, `- pushItem(${id})`);
        const params = { index: indexName, body: body2 };
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.index(params).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('index', e => {
                _err(NS, `> index[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                throw e;
            }),
        );
        // {"_index":"test-v3","_type":"_doc","_id":"rTeHiW4BPb_liACrA9qa","_version":1,"result":"created","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":2,"_primary_term":1}
        _log(NS, `> create[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _id = res.body?._id;
        const _version = res.body?._version;
        const res2: T = { ...body, _id, _version };
        return res2;
    }

    /**
     * read item with projections (typeless `GET /{index}/_doc/{id}`)
     *
     * @param id - item-id
     * @param views - projections
     */
    public async readItem(id: string, views?: string[] | object): Promise<T> {
        const { indexName } = this.options;
        _log(NS, `- readItem(${id})`);

        const params: any = { index: indexName, id };
        if (views) {
            const fields: string[] = [];
            const keys: string[] = Array.isArray(views) ? views : Object.keys(views);
            keys.forEach((k: string) => {
                fields.push(k);
            });
            params._source = fields;
        }
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.get(params).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('read', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> read[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _id = res.body?._id;
        const _version = res.body?._version;
        const data: T = (res as any)?._source || res.body?._source || {};
        // delete internal (analyzed) field
        delete data[OS2CoreService.DECOMPOSED_FIELD];
        delete data[OS2CoreService.QWERTY_FIELD];

        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * delete item with projections (typeless `DELETE /{index}/_doc/{id}`)
     *
     * @param id - item-id
     */
    public async deleteItem(id: string): Promise<T> {
        const { indexName } = this.options;
        _log(NS, `- readItem(${id})`);

        const params = { index: indexName, id };
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.delete(params).catch(
            $ERROR.handler('read', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":3,"result":"deleted","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":4,"_primary_term":1}
        _log(NS, `> delete[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _id = res.body?._id;
        const _version = res.body?._version;
        const data: T = res.body?._source || res.body?._source || {};
        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * update item (throw if not exist)
     * `update table set a=1, b=b+2 where id='a1'`
     * 0. no of `a1` -> 1,2 (created)
     * 1. a,b := 10,20 -> 11,22
     * 2. a,b := 10,null -> 11,2 (upsert)
     * 3. a,b := null,20 -> 1,22
     *
     * @param id - item-id
     * @param item - item to update
     * @param increments - item to increase
     * @param options - (optional) request option of client.
     */
    public async updateItem(
        id: string,
        item: T | null,
        increments?: Incrementable,
        options?: { maxRetries?: number },
    ): Promise<T> {
        const { indexName, idName } = this.options;
        _log(NS, `- updateItem(${id})`);
        item = !item && increments ? undefined : item;

        //* prepare params.
        const params: ElasticParams = { index: indexName, id, body: {} };
        const scripts: string[] = [];
        if (increments) {
            //* it will create if not exists.
            params.body.upsert = { ...increments, [idName]: id };

            Object.entries(increments).forEach(([key, val]) => {
                if (Array.isArray(val)) {
                    // If the value is an array, append it to the existing array in the source
                    scripts.push(
                        `if (ctx._source['${key}'] != null && ctx._source['${key}'] instanceof List) {
                            ctx._source['${key}'].addAll(params.increments['${key}']);
                        } else {
                            ctx._source['${key}'] = params.increments['${key}'];
                        }`,
                    );
                } else {
                    // If the value is a number, increment the existing field
                    scripts.push(
                        `if (ctx._source['${key}'] != null) {
                            ctx._source['${key}'] += params.increments['${key}'];
                        } else {
                            ctx._source['${key}'] = params.increments['${key}'];
                        }`,
                    );
                }
            });
        }

        if (item) {
            // Handle item updates in the script
            Object.entries(item).forEach(([key]) => {
                scripts.push(`ctx._source['${key}'] = params.item['${key}'];`);
            });
        }

        params.body.script = {
            source: scripts.join(' '),
            lang: 'painless',
            params: { item, increments },
        };
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);
        const client = this.client;
        const res: ApiResponse = await client.update(params, options).catch(
            $ERROR.handler('update', (e, E) => {
                const msg = GETERR(e);
                //* id 아이템이 없을 경우 발생함.
                if (msg.startsWith('404 DOCUMENT MISSING')) throw new Error(`404 NOT FOUND - id:${id}`);
                //* 해당 속성이 없을때 업데이트 하려면 생길 수 있음.
                if (msg.startsWith('400 REMOTE TRANSPORT')) throw new Error(`400 INVALID FIELD - id:${id}`);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                if (msg.startsWith('400 ACTION REQUEST VALIDATION')) throw e;
                if (msg.startsWith('400 INVALID FIELD')) throw e; // at ES6.8
                if (msg.startsWith('400 MAPPER PARSING')) throw e;
                if (
                    msg.startsWith('400 ILLEGAL ARGUMENT - Cannot apply') ||
                    msg.startsWith('400 ILLEGAL ARGUMENT - class_cast_exception:')
                )
                    throw new Error(`400 ILLEGAL ARGUMENT - failed to update due to type mismatch in item's field`); // at ES7.1
                if (msg.startsWith('400 ILLEGAL ARGUMENT')) throw e; // at ES7.1

                throw E;
            }),
            // $ERROR.throwAsJson,
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":2,"result":"updated","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":8,"_primary_term":1}
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":2,"result":"noop","_shards":{"total":0,"successful":0,"failed":0}}
        _log(NS, `> update[${id}].res =`, $U.json({ ...res, meta: undefined }));
        const _id = res.body._id;
        const _version = res.body._version;
        const res2: T = { ...item, _id, _version };
        return res2;
    }

    /**
     * run search and get the raw response (`search_type` in the query string).
     * @param body - Elasticsearch Query DSL that defines the search request (e.g., size, query, filters).
     * @param searchType - type of search (e.g., 'query_then_fetch', 'dfs_query_then_fetch').
     */
    public async searchRaw<T extends object = any>(body: SearchBody, searchType?: SearchType): Promise<T> {
        if (!body) throw new Error('@body (SearchBody) is required');
        const { indexName } = this.options;
        _log(NS, `- search(${indexName}, ${searchType || ''})....`);
        _log(NS, `> body =`, $U.json(body));

        // `search_type` goes to the query string as-is (the client does not rename camelCase keys)
        const params: ElasticSearchParams = { index: indexName, body };
        if (searchType) params.search_type = searchType;
        _log(NS, `> params =`, $U.json({ ...params, body: undefined }));
        // const { client } = instance(endpoint);
        const client = this.client;
        const $res = await client.search(params).catch(
            $ERROR.handler('search', e => {
                _err(NS, `> search[${indexName}].err =`, e);
                throw e;
            }),
        );
        // {"took":6,"timed_out":false,"_shards":{"total":4,"successful":4,"skipped":0,"failed":0},"hits":{"total":1,"max_score":0.2876821,"hits":[{"_index":"test-v3","_type":"_doc","_id":"aaa","_score":0.2876821,"_source":{"name":"AAA","@id":"aaa","a":-3,"b":-2}}]}}
        // _log(NS, `> search[${id}].res =`, $U.json({ ...res, meta: undefined }));
        // _log(NS, `> search[${tmp}].took =`, $res.took);
        // _log(NS, `> search[${tmp}].hits.total =`, $res.hits?.total);
        // _log(NS, `> search[${tmp}].hits.max_score =`, $res.hits?.max_score);
        // _log(NS, `> search[${tmp}].hits.hits[0] =`, $res.hits && $U.json($res.hits.hits[0]));

        //* return raw results.
        return $res?.body as T;
    }

    /**
     * run search, and get the formatmted response.
     * @param body - Elasticsearch Query DSL that defines the search request (e.g., size, query, filters).
     * @param searchType - type of search (e.g., 'query_then_fetch', 'dfs_query_then_fetch').
     *
     */
    public async search(body: SearchBody, searchType?: SearchType): Promise<SearchResponse> {
        const size = $U.N(body.size, 0);
        const response = await this.searchRaw(body, searchType);
        // return w/ transformed id
        const hits = response.hits;
        if (typeof hits !== 'object') throw new Error(`.hits (object) is required - hits:${$U.json(hits)}`);
        //NOTE - ES6.8 w/ OS1.1
        return {
            total: typeof (hits.total as any)?.value === 'number' ? (hits.total as any)?.value : hits.total,
            list: hits.hits.map((hit: any) => ({
                ...(hit._source as any),
                _id: hit._id,
                _score: hit._score,
            })),
            last: hits.hits.length === size && size > 0 ? hits.hits[size - 1]?.sort : undefined,
            aggregations: response.aggregations,
        };
    }
    /**
     * search all until limit (-1 means no-limit)
     * @param body - Elasticsearch Query DSL that defines the search request (e.g., size, query, filters).
     * @param params - parameters including search type, limit, and retry options.
     */
    public async searchAll<T>(body: SearchBody, params?: ElasticSearchAllParams) {
        const list: T[] = [];
        for await (const chunk of this.generateSearchResult(body, params)) {
            chunk.forEach((N: T) => list.push(N));
        }
        return list;
    }

    /**
     * create async generator that yields items queried until last
     *
     * @param body - Elasticsearch Query DSL that defines the search request (e.g., size, query, filters).
     * @param params - parameters including search type, limit, and retry options.
     */
    public async *generateSearchResult(body: SearchBody, params?: ElasticSearchAllParams) {
        const doRetry = params?.retryOptions?.do ?? false;
        const t = params?.retryOptions?.t ?? 5000;
        const maxRetries = params?.retryOptions?.maxRetries ?? 3;
        let limit = params?.limit ?? -1;
        let retryCount = 0;

        if (!body.sort) body.sort = '_doc';

        do {
            try {
                const { list, last } = await this.search(body, params?.searchType);

                body.search_after = last;

                if (list.length === 0 && !body.search_after) {
                    break;
                }

                yield list;
            } catch (e) {
                const msg = GETERR(e);

                if (doRetry && msg.startsWith('429 UNKNOWN') && retryCount < maxRetries) {
                    retryCount++;
                    await waited(t);
                    continue;
                } else {
                    throw e;
                }
            }
        } while (body.search_after && (limit === -1 || --limit > 0));
    }
    /**
     * prepare default setting
     * - migrated from engine-v2.
     * - v5: always the typeless mapping (`mappings.properties`); no doc-type or version, no `standard` filter.
     *
     * @param idName        id-name
     * @param shards        number of shards (default 4)
     * @param replicas      number of replicas (default 1)
     * @param timeSeries    flag of TIMESERIES (default false)
     */
    public static prepareSettings(params: {
        idName: string;
        timeSeries?: boolean;
        shards?: number;
        replicas?: number;
    }) {
        const idName: string = params.idName === undefined ? '$id' : params.idName;
        const shards: number = params.shards === undefined ? 4 : params.shards;
        const replicas: number = params.replicas === undefined ? 1 : params.replicas;
        const timeSeries: boolean = params.timeSeries === undefined ? false : params.timeSeries;

        //* core config.
        const CONF_ID_NAME = idName;
        const CONF_ES_TIMESERIES = !!timeSeries;

        const ES_MAPPINGS = {
            // NOTE: the order of dynamic templates are important.
            dynamic_templates: [
                // 1. Search-as-You-Type (autocomplete search) - apply to '_decomposed.*' fields
                {
                    autocomplete: {
                        path_match: `${OS2CoreService.DECOMPOSED_FIELD}.*`,
                        mapping: {
                            type: 'text',
                            analyzer: 'autocomplete_case_insensitive',
                            search_analyzer: 'standard',
                        },
                    },
                },
                // 2. Search-as-You-Type (Korean to Alphabet sequence in QWERTY/2벌식 keyboard) - apply to '_qwerty.*' fields
                {
                    autocomplete_qwerty: {
                        path_match: `${OS2CoreService.QWERTY_FIELD}.*`,
                        mapping: {
                            type: 'text',
                            analyzer: 'autocomplete_case_sensitive',
                            search_analyzer: 'whitespace',
                        },
                    },
                },
                // 3. string type ID field
                {
                    string_id: {
                        match_mapping_type: 'string',
                        match: CONF_ID_NAME,
                        mapping: {
                            type: 'keyword',
                            ignore_above: 256,
                        },
                    },
                },
                // 4. any other string fields - use Hangul analyzer and create 'keyword' sub-field
                {
                    strings: {
                        match_mapping_type: 'string',
                        mapping: {
                            type: 'text',
                            analyzer: 'hangul',
                            search_analyzer: 'hangul',
                            fields: {
                                // keyword sub-field
                                // 문자열 타입에 대한 템플릿을 지정하지 않으면 기본으로 ES가 '.keyword' 서브필드를 생성하나
                                // 문자열 타입 템플릿 재정의 시 기본으로 생성되지 않으므로 명시적으로 선언함.
                                keyword: {
                                    type: 'keyword',
                                    ignore_above: 256,
                                },
                            },
                        },
                    },
                },
            ],
            properties: {
                '@version': {
                    type: 'keyword',
                    index: false,
                },
                created_at: {
                    type: 'date',
                    format: 'strict_date_optional_time||epoch_millis',
                },
                updated_at: {
                    type: 'date',
                    format: 'strict_date_optional_time||epoch_millis',
                },
                deleted_at: {
                    type: 'date',
                    format: 'strict_date_optional_time||epoch_millis',
                },
            },
        };

        //* default settings.
        const ES_SETTINGS: any = {
            settings: {
                number_of_shards: shards,
                number_of_replicas: replicas,
                analysis: {
                    tokenizer: {
                        hangul: {
                            type: 'seunjeon_tokenizer',
                            decompound: true, // 복합명사 분해
                            deinflect: true, // 활용어의 원형 추출
                            index_eojeol: true, // 어절 추출
                            pos_tagging: false, // 품사 태깅
                        },
                        edge_30grams: {
                            type: 'edge_ngram',
                            min_gram: 1,
                            max_gram: 30,
                            token_chars: ['letter', 'digit', 'punctuation', 'symbol'],
                        },
                    },
                    analyzer: {
                        hangul: {
                            type: 'custom',
                            tokenizer: 'hangul',
                            filter: ['lowercase'],
                        },
                        autocomplete_case_insensitive: {
                            type: 'custom',
                            tokenizer: 'edge_30grams',
                            filter: ['lowercase'],
                        },
                        autocomplete_case_sensitive: {
                            type: 'custom',
                            tokenizer: 'edge_30grams',
                            filter: [], //* the [standard] token filter has been removed since 7.x.
                        },
                    },
                },
            },
            //* typeless mapping (no doc-type key).
            mappings: ES_MAPPINGS,
        };

        //* timeseries 데이터로, 기본 timestamp 값을 넣어준다. (주의! save시 current-time 값 자동 저장)
        if (!!CONF_ES_TIMESERIES) {
            ES_SETTINGS.settings.refresh_interval = '5s';
            ES_SETTINGS.mappings.properties['@timestamp'] = { type: 'date', doc_values: true };
            ES_SETTINGS.mappings.properties['ip'] = { type: 'ip' };

            //* clear mappings. (fixed: v4 deleted from `ES_SETTINGS.properties`, which does not exist)
            const CLEANS = '@version,created_at,updated_at,deleted_at'.split(',');
            CLEANS.map(key => delete ES_SETTINGS.mappings.properties[key]);
        }

        //* returns settings.
        return ES_SETTINGS;
    }

    /**
     * generate autocomplete fields into the item body to be indexed
     * @param body  item body to be saved into ES6 index
     * @private
     */
    protected popullateAutocompleteFields<T = any>(body: T): T {
        const { autocompleteFields } = this.options;
        const isAutoComplete = autocompleteFields && Array.isArray(autocompleteFields) && autocompleteFields.length > 0;
        if (!isAutoComplete) return body;
        return autocompleteFields.reduce<T>(
            (N, field) => {
                const value = (body as any)[field] as string;
                if (typeof value == 'string' || value) {
                    // 한글의 경우 자모 분해 형태와 영자판 변형 형태를 제공하고, 영문의 경우 원본 텍스트만 제공한다.
                    // 다만 사용자가 공백/하이픈을 생략하고 입력하는 경우에 대응하기 위해 공백/하이픈을 제거한 형태를 공통으로 제공한다.
                    if ($hangul.isHangul(value, true)) {
                        // 자모 분해 (e.g. '레몬' -> 'ㄹㅔㅁㅗㄴ')
                        const decomposed = $hangul.asJamoSequence(value);
                        const recomposed = decomposed.replace(/[ -]/g, '');
                        (N as any)[OS2CoreService.DECOMPOSED_FIELD][field] = [decomposed, recomposed];
                        // 영자판 (e.g. '레몬' -> 'fpahs')
                        (N as any)[OS2CoreService.QWERTY_FIELD][field] = $hangul.asAlphabetKeyStokes(value);
                    } else {
                        const recomposed = value.replace(/[ -]/g, '');
                        (N as any)[OS2CoreService.DECOMPOSED_FIELD][field] = [value, recomposed];
                    }
                }
                return N;
            },
            { ...body, [OS2CoreService.DECOMPOSED_FIELD]: {}, [OS2CoreService.QWERTY_FIELD]: {} },
        );
    }
}

interface ErrorReasonDetail<T = any> {
    status: number;
    type: string;
    reason?: string;
    cause?: T;
}
interface ErrorReason {
    status: number;
    message: string;
    reason: ErrorReasonDetail;
}

/**
 * error samples
 */
export const $ERROR = {
    asJson: (e: any) => {
        const _pack = (o: any): any => JSON.parse(JSON.stringify(o, Object.getOwnPropertyNames(o)));
        if (e instanceof Error) {
            const err: any = e;
            const meta: any = err.meta && typeof err.meta === 'object' ? err.meta : undefined;
            const $err = _pack(err);
            return { ...$err, meta };
        }
        return e;
    },
    throwAsJson: (e: any) => {
        throw $ERROR.asJson(e);
    },
    parseMeta: <T extends { type?: string; value?: any; error?: string; list?: any[]; [key: string]: any }>(
        meta: any,
    ): T => {
        if (typeof meta === 'string' && meta) {
            try {
                if (meta.startsWith('[') && meta.endsWith(']')) {
                    const list: any[] = JSON.parse(meta);
                    const $ret: any = { list };
                    return $ret as T;
                } else if (meta.startsWith('{') && meta.endsWith('}')) {
                    return JSON.parse(meta) as T;
                } else {
                    const $ret: any = { type: 'string', value: meta };
                    return $ret;
                }
            } catch (e) {
                const $ret: any = { type: 'string', value: meta, error: GETERR(e) };
                return $ret;
            }
        } else if (meta === null || meta === undefined) {
            return null;
        } else if (typeof meta === 'object') {
            return meta as T;
        } else {
            const type = typeof meta;
            const $ret: any = { type, value: meta };
            return $ret;
        }
    },
    /**
     * parse a client error into `{ status, message, reason }`.
     * - `type` comes from `meta.body.error.type` (same in both clients); it falls back to `message` only
     *   when the body has no error type (e.g. a meta-only sample of elastic 7.x).
     * - output form is unchanged: `<TYPE upper, last token dropped, _ as space>` like `VERSION CONFLICT ENGINE`.
     * - errors without `meta` (FGAC `http-fetch`, network) give `reason = null` and are rethrown by `handler`.
     */
    asError: (e: any): ErrorReason => {
        const E = $ERROR.asJson(e);
        const status = `${E.statusCode || ''}`;
        const message = `${E.message || E.msg || ''}`;
        const reason = ((E: any): ErrorReasonDetail => {
            //* only client response errors carry `meta`.
            if (!(E.meta && typeof E.meta == 'object')) return null;
            const $res = $ERROR.parseMeta<any>(E.meta);
            const source = _S($res.body?.error?.type ?? E?.message);
            const type = source.toUpperCase().split('_').slice(0, -1).join(' ');
            const status = $U.N(E.meta?.statusCode, type.includes('NOT FOUND') ? 404 : 400);
            //* find the reason.
            const reason =
                $res.body?.error?.reason === 'failed to execute script'
                    ? $res.body?.error?.caused_by?.caused_by?.reason
                    : $res.body?.error?.reason;
            const result: ErrorReasonDetail = { status, type: type || (status === 404 ? 'NOT FOUND' : 'UNKNOWN') };
            if (typeof reason !== 'undefined') {
                result.reason = reason;
            }
            return result;
        })(E);

        //* FINAL. convert to error-object.
        return {
            status: $U.N(status, reason?.status || 0),
            message: message || reason?.reason,
            reason,
        };
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler:
        (name: string, cb?: (e: Error, E?: ErrorReason) => any) =>
        (e: any): any => {
            const E = $ERROR.asError(e);
            //* unknown error found..
            if (!E?.status) {
                _err(NS, `! err[${name}]@handler =`, e instanceof Error, $U.json(e));
                throw e;
            }
            const $e = new Error(`${E.status} ${E.reason?.type ?? ''} - ${E.reason?.reason ?? E.message ?? ''}`);
            if (cb) return cb($e, E);
            throw $e;
        },
};
