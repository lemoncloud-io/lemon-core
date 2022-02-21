/**
 * `elastic6-service.ts`
 * - common service for elastic-search v6
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 * @date        2022-02-21 optimized error handler, and search.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_ } from '../engine/';
import { GeneralItem, Incrementable, SearchBody } from './core-types';
import elasticsearch, {
    CreateDocumentParams,
    IndexDocumentParams,
    GetParams,
    DeleteDocumentParams,
    UpdateDocumentParams,
    SearchParams,
} from 'elasticsearch';
import $hangul from './hangul-service';
import { loadDataYml } from '../tools';
import { GETERR } from '../common/test-helper';
const NS = $U.NS('ES6', 'green'); // NAMESPACE TO BE PRINTED.

export type SearchType = 'query_then_fetch' | 'dfs_query_then_fetch';

/**
 * options for construction.
 */
export interface Elastic6Option {
    /**
     * endpoint url of ES6
     */
    endpoint: string;
    /**
     * index-name
     */
    indexName: string;
    /**
     * document type (default as `_doc` in ES6)
     * - it must be `_doc` since ES6.x
     */
    docType?: string;
    /**
     * id-name (optional if time-seriese)
     */
    idName?: string;
    /**
     * is TIMESERIES data?
     */
    timeSeries?: boolean;
    /**
     * (optional) version of engine.
     * - (default) 6.8
     */
    version?: string;
    /**
     * fields to provide autocomplete(Search-as-You-Type) feature
     */
    autocompleteFields?: string[];
}

/**
 * common type of item
 */
export interface Elastic6Item extends GeneralItem {
    _id?: string;
    _version?: number;
    _score?: number;
}

//! create(or get) instance.
const instance = (endpoint: string) => {
    return Elastic6Service.instance(endpoint);
};

const _S = (v: any, def: string = '') =>
    typeof v === 'string' ? v : v === undefined || v === null ? def : typeof v === 'object' ? $U.json(v) : `${v}`;

/**
 * class: `Elastic6Service`
 * - basic CRUD service for Elastic Search 6
 */
export class Elastic6Service<T extends Elastic6Item = any> {
    // internal field name to store analyzed strings for autocomplete search
    public static readonly DECOMPOSED_FIELD = '_decomposed';
    public static readonly QWERTY_FIELD = '_qwerty';

    protected options: Elastic6Option;
    public readonly _client: elasticsearch.Client;

    public constructor(options: Elastic6Option) {
        _inf(NS, `Elastic6Service(${options.indexName}/${options.idName})...`);
        if (!options.endpoint) throw new Error('.endpoint (URL) is required');
        if (!options.indexName) throw new Error('.indexName (string) is required');

        // default option values: docType='_doc', idName='$id'
        const { client } = Elastic6Service.instance(options.endpoint);
        this.options = { docType: '_doc', idName: '$id', version: '6.8', ...options };
        this._client = client;
    }

    /**
     * say hello of identity.
     */
    public hello = () => `elastic6-service:${this.options.indexName}:${this.version}`;

    /**
     * simple instance maker.
     * @param endpoint  service-url
     * @param version   Elasticsearch version (default: '6.8')
     * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/16.x/configuration.html
     */
    public static instance(endpoint: string) {
        const client = new elasticsearch.Client({ host: endpoint });
        return { client };
    }

    /**
     * get the client instance.
     */
    public get client(): elasticsearch.Client {
        return this._client;
    }

    public get version(): number {
        const ver = $U.F(this.options.version, 6.8);
        return ver;
    }

    /**
     * list of index
     */
    public async listIndices() {
        const { endpoint } = this.options;
        _log(NS, `- listIndices()`);

        //! call create index..
        const { client } = instance(endpoint);
        const res = await client.cat.indices({ format: 'json' });
        _log(NS, `> indices =`, $U.json(res));
        if (!Array.isArray(res)) throw new Error(`@result<${typeof res}> is invalid - expected: any[]!`);

        // {"docs.count": "84", "docs.deleted": "7", "health": "green", "index": "dev-eureka-alarms-v1", "pri": "5", "pri.store.size": "234.3kb", "rep": "1", "status": "open", "store.size": "468.6kb", "uuid": "xPp-Sx86SgmhAWxT3cGAFw"}
        const list = res.map(N => ({
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

        //! returns.
        return { list };
    }

    /**
     * find the index by name
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
     *
     * @param settings      creating settings
     */
    public async createIndex(settings?: any) {
        const { indexName, docType, idName, timeSeries, version } = this.options;
        settings = settings || Elastic6Service.prepareSettings({ docType, idName, timeSeries, version });
        if (!indexName) new Error('@index is required!');
        _log(NS, `- createIndex(${indexName})`);

        //! prepare payload
        const payload = {
            settings: {
                number_of_shards: 5,
                number_of_replicas: 1,
            },
            ...settings,
        };
        _log(NS, `> settings[${indexName}] = `, $U.json(payload));

        //! call create index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.create({ index: indexName, body: payload }).catch(
            $ERROR.handler('create', e => {
                const msg = GETERR(e);
                if (msg.startsWith('400 RESOURCE ALREADY EXISTS')) throw new Error(`400 IN USE - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        _log(NS, `> create[${indexName}] =`, $U.json(res));
        _log(NS, `> create[${indexName}].acknowledged =`, res.acknowledged); // true
        _log(NS, `> create[${indexName}].index =`, res.index); // index
        _log(NS, `> create[${indexName}].shards_acknowledged =`, res.shards_acknowledged); // true

        //! build result.
        return {
            index: res.index,
            acknowledged: res.acknowledged,
        };
    }

    /**
     * destroy search index
     */
    public async destroyIndex() {
        const { indexName } = this.options;
        if (!indexName) new Error('@index is required!');
        _log(NS, `- destroyIndex(${indexName})`);

        //! call create index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.delete({ index: indexName }).catch(
            $ERROR.handler('destroy', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        _log(NS, `> destroy[${indexName}] =`, $U.json(res));
        _log(NS, `> destroy[${indexName}].acknowledged =`, res.acknowledged); // true

        return {
            index: res.index || indexName,
            acknowledged: res.acknowledged,
        };
    }

    /**
     * refresh search index - refresh index to make all items searchable
     */
    public async refreshIndex() {
        const { indexName } = this.options;
        if (!indexName) throw new Error('.indexName is required!');
        _log(NS, `- refreshIndex(${indexName})`);

        //! call refresh index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.refresh({ index: indexName }).catch(
            $ERROR.handler('refresh', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        _log(NS, `> refresh[${indexName}] =`, $U.json(res));

        return res;
    }

    /**
     * flush search index - force store changes into search index immediately
     */
    public async flushIndex() {
        const { indexName } = this.options;
        if (!indexName) throw new Error('.indexName is required!');
        _log(NS, `- flushIndex(${indexName})`);

        //! call flush index..
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.flush({ index: indexName }).catch(
            $ERROR.handler('flush', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        _log(NS, `> flush[${indexName}] =`, $U.json(res));

        return res;
    }

    /**
     * describe `settings` and `mappings` of index.
     */
    public async describe() {
        const { indexName } = this.options;
        //! call create index..
        _log(NS, `- describe(${indexName})`);

        //! read settings.
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.getSettings({ index: indexName }).catch(
            $ERROR.handler('describe', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        _log(NS, `> settings[${indexName}] =`, $U.json(res));
        const settings: any = (res[indexName] && res[indexName].settings) || {};
        _log(NS, `> number_of_shards =`, settings.index && settings.index.number_of_shards); // 5
        _log(NS, `> number_of_replicas =`, settings.index && settings.index.number_of_replicas); // 1

        //! read mappings.
        const res2 = await client.indices.getMapping({ index: indexName });
        _log(NS, `> mappings[${indexName}] =`, $U.json(res2));
        const mappings: any = (res2[indexName] && res2[indexName].mappings) || {};

        //! returns
        return { settings, mappings };
    }

    /**
     * save single item
     *
     * @param id    id
     * @param item  item to save
     * @param type  document type (default: doc-type given at construction time)
     */
    public async saveItem(id: string, item: T, type?: string): Promise<T> {
        const { indexName, docType, idName } = this.options;
        _log(NS, `- saveItem(${id})`);
        // const { client } = instance(endpoint);
        const client = this.client;

        // prepare item body and autocomplete fields
        const body: any = { ...item, [idName]: id };
        this.prepareAutocompleteFields(body);

        type = `${type || docType}`;
        const params: CreateDocumentParams = { index: indexName, type, id, body };
        if (idName === '_id') delete params.body[idName]; //WARN! `_id` is reserved in ES6.
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        const res = await client.create(params).catch(
            $ERROR.handler('save', e => {
                const msg = GETERR(e);
                //! try to update document..
                if (msg.startsWith('409 VERSION CONFLICT ENGINE')) {
                    delete body[idName]; // do set id while update
                    return this.updateItem(id, item);
                }
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":1,"result":"created","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":0,"_primary_term":1}
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":1,"result":"noop","_shards":{"total":0,"successful":0,"failed":0}}
        _log(NS, `> create[${id}].res =`, $U.json(res));
        _log(NS, `> create[${id}].result =`, res.result); // 'created','noop','updated'
        _log(NS, `> create[${id}]._version =`, res._version); // 1
        // return res;

        const _version: number = $U.N(res._version, 0);
        const _id: string = res._id;
        const res2: T = { ...body, _id, _version };
        return res2;
    }

    /**
     * push item for time-series data.
     *
     * @param item  item to push
     */
    public async pushItem(item: T, type?: string): Promise<T> {
        const { indexName, docType } = this.options;
        const id = '';

        type = `${type || docType}`;
        const body: any = { ...item };
        this.prepareAutocompleteFields(body);

        _log(NS, `- pushItem(${id})`);
        const params: IndexDocumentParams<any> = { index: indexName, type, body };
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.index(params).catch(
            $ERROR.handler('index', e => {
                _err(NS, `> index[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                throw e;
            }),
        );
        // {"_index":"test-v3","_type":"_doc","_id":"rTeHiW4BPb_liACrA9qa","_version":1,"result":"created","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":2,"_primary_term":1}
        _log(NS, `> create[${id}].res =`, $U.json(res));
        _log(NS, `> create[${id}].result =`, res.result); // 'created','noop','updated'
        _log(NS, `> create[${id}]._version =`, res._version); // 1

        const _id = res._id;
        const _version = res._version;
        const res2: T = { ...item, _id, _version };
        return res2;
    }

    /**
     * read item with projections
     *
     * @param id        item-id
     * @param views     projections
     */
    public async readItem(id: string, views?: string[] | object): Promise<T> {
        const { indexName, docType } = this.options;
        const type = `${docType}`;
        _log(NS, `- readItem(${id})`);

        const params: GetParams = { index: indexName, type, id };
        if (views) {
            const fields: string[] = [];
            const is_array = Array.isArray(views);
            $_.each(views, (v: string, k: string) => {
                fields.push(is_array ? v : k);
            });
            params._source = fields;
        }
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.get(params).catch(
            $ERROR.handler('read', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":2,"found":true,"_source":{"name":"haha"}}
        _log(NS, `> read[${id}].res =`, $U.json(res));
        _log(NS, `> create[${id}].found =`, res.found); // true
        _log(NS, `> create[${id}]._version =`, res._version); // 2

        const _id = res._id;
        const _version = res._version;
        const data: T = (res as any)?._source || {};
        // delete internal (analyzed) field
        delete data[Elastic6Service.DECOMPOSED_FIELD];
        delete data[Elastic6Service.QWERTY_FIELD];

        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * delete item with projections
     *
     * @param id        item-id
     */
    public async deleteItem(id: string): Promise<T> {
        const { indexName, docType } = this.options;
        const type = `${docType}`;
        _log(NS, `- readItem(${id})`);

        const params: DeleteDocumentParams = { index: indexName, type, id };
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.delete(params).catch(
            $ERROR.handler('read', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":3,"result":"deleted","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":4,"_primary_term":1}
        _log(NS, `> delete[${id}].res =`, $U.json(res));
        _log(NS, `> delete[${id}].result =`, res.result); // true
        _log(NS, `> delete[${id}]._version =`, res._version); // 2

        const _id = res._id;
        const _version = res._version;
        const data: T = (res as any)?._source || {};
        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * update item
     *
     * @param id        item-id
     * @param item      item to update
     */
    public async updateItem(id: string, item: T, increments?: Incrementable): Promise<T> {
        const { indexName, docType, idName } = this.options;
        const type = `${docType}`;
        _log(NS, `- updateItem(${id})`);
        item = !item && increments ? undefined : item;

        //! prepare params.
        const params: UpdateDocumentParams = { index: indexName, type, id, body: { doc: item } };
        const version = this.version;
        if (increments) {
            //! it will create if not exists.
            params.body.upsert = { ...increments, [idName]: id };
            const scripts = Object.entries(increments).reduce<string[]>((L, [key, val]) => {
                L.push(`ctx._source.${key} += ${val}`);
                return L;
            }, []);
            if (version < 7.0) params.body.lang = 'painless';
            params.body.script = scripts.join('; ');
        }
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.update(params).catch(
            $ERROR.handler('update', (e, E) => {
                const msg = GETERR(e);
                //! id 아이템이 없을 경우 발생함.
                if (msg.startsWith('404 DOCUMENT MISSING')) throw new Error(`404 NOT FOUND - id:${id}`);
                //! 해당 속성이 없을때 업데이트 하려면 생길 수 있음.
                if (msg.startsWith('400 REMOTE TRANSPORT')) throw new Error(`400 INVALID FIELD - id:${id}`);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                if (msg.startsWith('400 ACTION REQUEST VALIDATION')) throw e;
                if (msg.startsWith('400 INVALID FIELD')) throw e; // at ES6.8
                if (msg.startsWith('400 ILLEGAL ARGUMENT')) throw e; // at ES7.1
                throw E;
            }),
            // $ERROR.throwAsJson,
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":2,"result":"updated","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":8,"_primary_term":1}
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":2,"result":"noop","_shards":{"total":0,"successful":0,"failed":0}}
        _log(NS, `> update[${id}].res =`, $U.json(res));
        _log(NS, `> update[${id}].result =`, res.result); // true
        _log(NS, `> update[${id}]._version =`, res._version); // 2

        const _id = res._id;
        const _version = res._version;
        const res2: T = { ...item, _id, _version };
        return res2;
    }

    /**
     * run search and get the raw response.
     */
    public async searchRaw(body: SearchBody, searchType?: SearchType) {
        if (!body) throw new Error('@body (SearchBody) is required');
        const { indexName, docType } = this.options;
        _log(NS, `- search(${indexName}, ${searchType || ''})....`);
        _log(NS, `> body =`, $U.json(body));

        const tmp = docType ? docType : '';
        const type: string = docType ? `${docType}` : undefined;
        const params: SearchParams = { index: indexName, type, body, searchType };
        _log(NS, `> params[${tmp}] =`, $U.json({ ...params, body: undefined }));
        // const { client } = instance(endpoint);
        const client = this.client;
        const $res = await client.search(params).catch(
            $ERROR.handler('search', e => {
                _err(NS, `> search[${indexName}].err =`, e);
                throw e;
            }),
        );
        // {"took":6,"timed_out":false,"_shards":{"total":4,"successful":4,"skipped":0,"failed":0},"hits":{"total":1,"max_score":0.2876821,"hits":[{"_index":"test-v3","_type":"_doc","_id":"aaa","_score":0.2876821,"_source":{"name":"AAA","@id":"aaa","a":-3,"b":-2}}]}}
        // _log(NS, `> search[${id}].res =`, $U.json(res));
        _log(NS, `> search[${tmp}].took =`, $res.took);
        _log(NS, `> search[${tmp}].hits.total =`, $res.hits?.total);
        _log(NS, `> search[${tmp}].hits.max_score =`, $res.hits?.max_score);
        _log(NS, `> search[${tmp}].hits.hits[0] =`, $res.hits && $U.json($res.hits.hits[0]));

        //! return raw results.
        return $res;
    }

    /**
     * run search, and get the formatmted response.
     */
    public async search(body: SearchBody, searchType?: SearchType) {
        const size = $U.N(body.size, 0);
        const response = await this.searchRaw(body, searchType);
        // return w/ transformed id
        const hits = response.hits;
        if (typeof hits !== 'object') throw new Error(`.hits (object) is required - hits:${$U.json(hits)}`);
        //NOTE - ES6.8 w/ OS1.1
        return {
            total: typeof (hits.total as any)?.value === 'number' ? (hits.total as any)?.value : hits.total,
            list: hits.hits.map(hit => ({
                ...(hit._source as any),
                _id: hit._id,
                _score: hit._score,
            })),
            last: hits.hits.length === size && size > 0 ? hits.hits[size - 1]?.sort : undefined,
            aggregations: response.aggregations,
        };
    }

    /**
     * prepare default setting
     * - migrated from engine-v2.
     *
     * @param docType       document type name
     * @param idName        id-name
     * @param shards        number of shards (default 4)
     * @param replicas      number of replicas (default 1)
     * @param timeSeries    flag of TIMESERIES (default false)
     */
    public static prepareSettings(params: {
        docType: string;
        idName: string;
        version?: string;
        timeSeries?: boolean;
        shards?: number;
        replicas?: number;
    }) {
        const docType: string = params.docType === undefined ? '_doc' : params.docType;
        const idName: string = params.idName === undefined ? '$id' : params.idName;
        const version: number = $U.F(params.version === undefined ? '6.8' : params.version);
        const shards: number = params.shards === undefined ? 4 : params.shards;
        const replicas: number = params.replicas === undefined ? 1 : params.replicas;
        const timeSeries: boolean = params.timeSeries === undefined ? false : params.timeSeries;

        //! core config.
        const CONF_ES_DOCTYPE = docType;
        const CONF_ID_NAME = idName;
        const CONF_ES_TIMESERIES = !!timeSeries;

        const ES_MAPPINGS = {
            // NOTE: the order of dynamic templates are important.
            dynamic_templates: [
                // 1. Search-as-You-Type (autocomplete search) - apply to '_decomposed.*' fields
                {
                    autocomplete: {
                        path_match: `${Elastic6Service.DECOMPOSED_FIELD}.*`,
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
                        path_match: `${Elastic6Service.QWERTY_FIELD}.*`,
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

        //! default settings.
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
                            filter: ['standard'],
                        },
                    },
                },
            },
            //! since 7.x. no mapping for types.
            mappings: version < 7.0 ? { [CONF_ES_DOCTYPE]: ES_MAPPINGS } : ES_MAPPINGS,
        };

        //! timeseries 데이터로, 기본 timestamp 값을 넣어준다. (주의! save시 current-time 값 자동 저장)
        if (!!CONF_ES_TIMESERIES) {
            ES_SETTINGS.settings.refresh_interval = '5s';
            if (version < 7.0) {
                ES_SETTINGS.mappings[CONF_ES_DOCTYPE].properties['@timestamp'] = { type: 'date', doc_values: true };
                ES_SETTINGS.mappings[CONF_ES_DOCTYPE].properties['ip'] = { type: 'ip' };

                //! clear mappings.
                const CLEANS = '@version,created_at,updated_at,deleted_at'.split(',');
                CLEANS.map(key => delete ES_SETTINGS.mappings[CONF_ES_DOCTYPE].properties[key]);
            } else {
                ES_SETTINGS.mappings.properties['@timestamp'] = { type: 'date', doc_values: true };
                ES_SETTINGS.mappings.properties['ip'] = { type: 'ip' };

                //! clear mappings.
                const CLEANS = '@version,created_at,updated_at,deleted_at'.split(',');
                CLEANS.map(key => delete ES_SETTINGS.properties[key]);
            }
        }

        //! returns settings.
        return ES_SETTINGS;
    }

    /**
     * generate autocomplete fields into the item body to be indexed
     * @param body  item body to be saved into ES6 index
     * @private
     */
    private prepareAutocompleteFields(body: any): void {
        const { autocompleteFields } = this.options;

        if (body && Array.isArray(autocompleteFields) && autocompleteFields.length > 0) {
            body[Elastic6Service.DECOMPOSED_FIELD] = {};
            body[Elastic6Service.QWERTY_FIELD] = {};

            autocompleteFields.forEach(field => {
                const value = body[field] as string;

                if (typeof value == 'string' || value) {
                    // 한글의 경우 자모 분해 형태와 영자판 변형 형태를 제공하고, 영문의 경우 원본 텍스트만 제공한다.
                    // 다만 사용자가 공백/하이픈을 생략하고 입력하는 경우에 대응하기 위해 공백/하이픈을 제거한 형태를 공통으로 제공한다.
                    if ($hangul.isHangul(value, true)) {
                        // 자모 분해 (e.g. '레몬' -> 'ㄹㅔㅁㅗㄴ')
                        const decomposed = $hangul.asJamoSequence(value);
                        const recomposed = decomposed.replace(/[ -]/g, '');
                        body[Elastic6Service.DECOMPOSED_FIELD][field] = [decomposed, recomposed];
                        // 영자판 (e.g. '레몬' -> 'fpahs')
                        body[Elastic6Service.QWERTY_FIELD][field] = $hangul.asAlphabetKeyStokes(value);
                    } else {
                        const recomposed = value.replace(/[ -]/g, '');
                        body[Elastic6Service.DECOMPOSED_FIELD][field] = [value, recomposed];
                    }
                }
            });
        }
    }
}

interface ErrorReason {
    status: number;
    message: string;
    reason: {
        status: number;
        type: string;
        reason: string;
        cause: any;
    };
}

/**
 * error samples
 */
export const $ERROR = {
    asJson: (e: any) => {
        if (e instanceof Error) {
            const err = e;
            const str = JSON.stringify(err, Object.getOwnPropertyNames(err));
            return JSON.parse(str);
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
    asError: (e: any): ErrorReason => {
        const E = $ERROR.asJson(e);
        const status = `${E.statusCode || ''}`;
        const message = `${E.message || E.msg || ''}`;
        const reason = ((E: any) => {
            // const body = $ERROR.parseMeta<any>(E.body); // it must be the body of request
            const $res = $ERROR.parseMeta<any>(E.response);

            //! find the root-cause.
            const pic1 = (N: any[] | any, i = 0) => (N && Array.isArray(N) ? N[i] : N);
            const cause: any = pic1($res?.error?.root_cause);
            const status = $U.N($res.error?.status || $res.status);
            const reason = _S(
                $res.error?.reason,
                $res.found === false || $res.result === 'not_found' ? 'NOT FOUND' : '',
            );
            const type = _S(cause?.type)
                .toUpperCase()
                .split('_')
                .slice(0, -1)
                .join(' ');
            return { status, reason, cause, type: type || reason };
        })(E);
        //! FINAL. convert to error-object.
        return {
            status: $U.N(status, reason.status),
            message: message || reason.reason,
            reason,
        };
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler: <T = any>(name: string, cb?: (e: Error, E?: ErrorReason) => T) => (e: any): T => {
        const E = $ERROR.asError(e);
        //! unknown error found..
        if (!E?.status) {
            _err(NS, `! err[${name}]@handler =`, e instanceof Error, $U.json(e));
            throw e;
        }
        const $e = new Error(`${E.status} ${E.reason.type} - ${E.message}`);
        if (cb) return cb($e, E);
        throw $e;
    },
};

/** ****************************************************************************************************************
 *  Dummy Elastic6 Service
 ** ****************************************************************************************************************/
/**
 * class: `DummyElastic6Service`
 * - service in-memory dummy data
 */
export class DummyElastic6Service<T extends GeneralItem> extends Elastic6Service<T> {
    public constructor(dataFile: string, options: Elastic6Option) {
        super(options);
        _log(NS, `DummyElastic6Service(${dataFile || ''})...`);
        if (!dataFile) throw new Error('@dataFile(string) is required!');
        const dummy: any = loadDataYml(dataFile);
        this.load(dummy.data as any);
    }

    private buffer: { [id: string]: T } = {};
    public load(data: T[]) {
        const { idName } = this.options;
        if (!data || !Array.isArray(data)) throw new Error('@data should be array!');
        data.map(item => {
            const id = `${item[idName] || ''}`;
            this.buffer[id] = item;
        });
    }

    /**
     * say hello()
     */
    public hello = () => `dummy-elastic6-service:${this.options.indexName}`;

    public async readItem(id: string): Promise<T> {
        const item: T = this.buffer[id];
        if (item === undefined) throw new Error(`404 NOT FOUND - id:${id}`);
        return item;
    }

    public async saveItem(id: string, item: T): Promise<T> {
        const { idName } = this.options;
        this.buffer[id] = { id, ...item };
        return { [idName]: id, ...item, _version: 1 };
    }

    public async deleteItem(id: string, sort?: string | number): Promise<T> {
        const org = this.buffer[id];
        delete this.buffer[id];
        return { ...org };
    }

    public async updateItem(id: string, updates: T, increments?: Incrementable): Promise<T> {
        const org = await this.readItem(id);
        const item = { ...org, ...updates, _version: Number(org._version || 0) + 1 };
        if (increments) {
            //TODO - support increments in dummy.
        }
        this.buffer[id] = item;
        return item;
    }
}
