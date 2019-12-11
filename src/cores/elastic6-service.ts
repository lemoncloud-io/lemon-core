/**
 * `elastic6-service.ts`
 * - common service for elastic-search v6
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('ES6', 'green'); // NAMESPACE TO BE PRINTED.

/** ****************************************************************************************************************
 *  Service Main
 ** ****************************************************************************************************************/
import { GeneralItem, Incrementable } from './core-types';
import elasticsearch, {
    CreateDocumentParams,
    IndexDocumentParams,
    GetParams,
    DeleteDocumentParams,
    UpdateDocumentParams,
} from 'elasticsearch';
import { loadDataYml } from '../tools/shared';

/**
 * types of key
 */
export type KEY_TYPE = 'number' | 'string';

/**
 * options for construction.
 */
export interface Elastic6Option {
    endpoint: string; // endpoint url of ES6
    indexName: string; // index-name
    idName?: string; // id-name (optional if time-seriese)
    idType?: KEY_TYPE; // id-type
    docType?: string; // document type (default as `_doc` in ES6)
    timeSeries?: boolean; // is TIMESERIES?
}

export interface Elastic6Item extends GeneralItem {
    _id?: string;
    _version?: number;
}

//! create(or get) instance.
export const instance = (endpoint: string) => {
    const client = new elasticsearch.Client({ host: endpoint });
    return { client };
};

/**
 * class: `Elastic6Service`
 * - basic CRUD service for Elastic Search 6
 */
export class Elastic6Service<T extends Elastic6Item> {
    protected options: Elastic6Option;
    public constructor(options: Elastic6Option) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `Elastic6Service(${options.indexName}/${options.idName})...`);
        if (!options.endpoint) throw new Error('.endpoint (URL) is required');
        if (!options.indexName) throw new Error('.indexName (string) is required');
        // if (!options.idName) throw new Error('.idName (string) is required');
        this.options = { docType: '_doc', ...options };
    }

    /**
     * say hello of identity.
     */
    public hello = async () => `elastic6-service:${this.options.indexName}`;

    /**
     * create index by name
     *
     * @param settings      creating settings
     */
    public async createIndex(settings?: any) {
        const { endpoint, indexName, idName, idType, timeSeries } = this.options;
        settings = settings || Elastic6Service.prepareSettings(indexName, idName, idType, timeSeries);
        if (!indexName) new Error('@index is required!');
        _log(NS, `- createIndex(${indexName})`);
        settings = settings || {};

        //! prepare payload
        const payload = {
            settings: {
                index: {
                    number_of_shards: 5,
                    number_of_replicas: 1,
                },
            },
            ...settings,
        };
        _log(NS, `> settings[${indexName}] = `, $U.json(payload));

        //! call create index..
        const { client } = instance(endpoint);
        const res = await client.indices.create({ index: indexName, body: payload }).catch(
            $ERROR.handler('create', e => {
                _err(NS, `> create[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                if (`${e.message}`.startsWith('400 resource_already_exists_exception'))
                    throw new Error(`400 IN USE - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> create[${indexName}] =`, $U.json(res));
        _log(NS, `> create[${indexName}].acknowledged =`, res.acknowledged); // true
        _log(NS, `> create[${indexName}].index =`, res.index); // index
        _log(NS, `> create[${indexName}].shards_acknowledged =`, res.shards_acknowledged); // true
        return res;
    }

    /**
     * destroy search index
     */
    public async destroyIndex() {
        const { endpoint, indexName } = this.options;
        if (!indexName) new Error('@index is required!');
        _log(NS, `- destroyIndex(${indexName})`);

        //! call create index..
        const { client } = instance(endpoint);
        const res = await client.indices.delete({ index: indexName }).catch(
            $ERROR.handler('destroy', e => {
                _err(NS, `> destory[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                if (`${e.message}`.startsWith('404 index_not_found_exception'))
                    throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> destroy[${indexName}] =`, $U.json(res));
        _log(NS, `> destroy[${indexName}].acknowledged =`, res.acknowledged); // true

        return res;
    }

    /**
     * desceibe `settings` and `mappings` of index.
     */
    public async describe() {
        const { endpoint, indexName } = this.options;
        //! call create index..
        const { client } = instance(endpoint);
        _log(NS, `- describe(${indexName})`);

        //! read settings.
        const res = await client.indices.getSettings({ index: indexName }).catch(
            $ERROR.handler('describe', e => {
                _err(NS, `> describe[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                if (`${e.message}`.startsWith('404 index_not_found_exception'))
                    throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
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
     */
    public async saveItem(id: string, item: T, type?: string): Promise<T> {
        const { endpoint, indexName, idName, docType } = this.options;
        const { client } = instance(endpoint);
        // const _log = console.info;
        _log(NS, `- saveItem(${id})`);

        type = `${type || docType}`;
        const params: CreateDocumentParams = {
            index: indexName,
            type,
            id,
            body: { ...item, [idName]: id },
            // versionType: 'force',
        };
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        const res = await client.create(params).catch(
            $ERROR.handler('save', e => {
                _log(NS, `> save[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                if (`${e.message}`.startsWith('409 version_conflict_engine_exception')) {
                    //! try to update document...
                    const params = { index: indexName, type, id, body: { doc: item } };
                    return client.update(params);
                }
                throw e;
            }),
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":1,"result":"created","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":0,"_primary_term":1}
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":1,"result":"noop","_shards":{"total":0,"successful":0,"failed":0}}
        _log(NS, `> create[${id}].res =`, $U.json(res));
        _log(NS, `> create[${id}].result =`, res.result); // 'created','noop','updated'
        _log(NS, `> create[${id}]._version =`, res._version); // 1
        // return res;

        const _version: number = $U.N(res._version, 0);
        const _id: string = res._id;
        const res2: T = { ...item, _id, _version };
        return res2;
    }

    /**
     * push item for time-series data.
     *
     * @param item  item to push
     */
    public async pushItem(item: T, type?: string): Promise<T> {
        const { endpoint, indexName, docType } = this.options;
        const { client } = instance(endpoint);
        const id = '';

        type = `${type || docType}`;
        _log(NS, `- pushItem(${id})`);
        const params: IndexDocumentParams<any> = {
            index: indexName,
            type,
            body: item,
        };
        _log(NS, `> params[${id}] =`, $U.json(params));
        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
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
        const { endpoint, indexName, docType } = this.options;
        const { client } = instance(endpoint);
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
        const res = await client.get(params).catch(
            $ERROR.handler('read', e => {
                _err(NS, `> read[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                if (`${e.message}`.startsWith('404 Not Found')) throw new Error(`404 NOT FOUND - id:${id}`);
                throw e;
            }),
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":2,"found":true,"_source":{"name":"haha"}}
        _log(NS, `> read[${id}].res =`, $U.json(res));
        _log(NS, `> create[${id}].found =`, res.found); // true
        _log(NS, `> create[${id}]._version =`, res._version); // 2

        const _id = res._id;
        const _version = res._version;
        const data: T = (res && res._source) || {};
        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * delete item with projections
     *
     * @param id        item-id
     */
    public async deleteItem(id: string): Promise<T> {
        const { endpoint, indexName, docType } = this.options;
        const { client } = instance(endpoint);
        const type = `${docType}`;
        _log(NS, `- readItem(${id})`);

        const params: DeleteDocumentParams = { index: indexName, type, id };
        _log(NS, `> params[${id}] =`, $U.json(params));
        const res = await client.delete(params).catch(
            $ERROR.handler('delete', e => {
                _err(NS, `> delete[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                if (`${e.message}`.startsWith('404 Not Found')) throw new Error(`404 NOT FOUND - id:${id}`);
                throw e;
            }),
        );
        // {"_index":"test-v3","_type":"_doc","_id":"aaa","_version":3,"result":"deleted","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":4,"_primary_term":1}
        _log(NS, `> delete[${id}].res =`, $U.json(res));
        _log(NS, `> delete[${id}].result =`, res.result); // true
        _log(NS, `> delete[${id}]._version =`, res._version); // 2

        const _id = res._id;
        const _version = res._version;
        const data: T = (res && res._source) || {};
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
        const { endpoint, indexName, docType } = this.options;
        const { client } = instance(endpoint);
        const type = `${docType}`;
        _log(NS, `- updateItem(${id})`);
        item = !item && increments ? undefined : item;

        //! prepare params.
        const params: UpdateDocumentParams = { index: indexName, type, id, body: { doc: item } };
        if (increments) {
            //! it will create if not exists.
            params.body.upsert = { ...increments, [indexName]: id };
            const scripts: string[] = $_.reduce(
                increments,
                (L: any, val: any, key: string) => {
                    L.push(`ctx._source.${key} += ${val}`);
                    return L;
                },
                [],
            );
            params.body.lang = 'painless';
            params.body.script = scripts.join('; ');
        }
        _log(NS, `> params[${id}] =`, $U.json(params));
        const res = await client.update(params).catch(
            $ERROR.handler('update', e => {
                _err(NS, `> update[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                //! id 아이템이 없을 경우 발생함.
                if (`${e.message}`.startsWith('404 document_missing_exception'))
                    throw new Error(`404 NOT FOUND - id:${id}`);
                //! 해당 속성이 없을때 업데이트 하려면 생길 수 있음.
                if (`${e.message}`.startsWith('400 remote_transport_exception'))
                    throw new Error(`400 INVALID FIELD - id:${id}`);
                if (`${e.message}`.startsWith('404 Not Found')) throw new Error(`404 NOT FOUND - id:${id}`);
                throw e;
            }),
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
     * prepare default setting
     * - migrated from engine-v2.
     *
     * @param indexName     index name
     * @param idName        id-name
     * @param idType        id-type
     * @param shards        number of shards (default 4)
     * @param replicas      number of replicas (default 1)
     * @param timeSeries    flag of TIMESERIES (default false)
     */
    public static prepareSettings(
        indexName: string,
        idName: string,
        idType: KEY_TYPE,
        timeSeries?: boolean,
        shards?: number,
        replicas?: number,
    ) {
        shards = shards === undefined ? 4 : shards;
        replicas = replicas === undefined ? 1 : replicas;
        timeSeries = timeSeries === undefined ? false : timeSeries;

        //! core config.
        const CONF_ES_INDEX = indexName;
        const CONF_ID_NAME = idName;
        const CONF_ES_TIMESERIES = !!timeSeries;
        const CONF_ES_VERSION = 6;

        //TODO - Use Dynamic Field Template!!!..
        //! see:https://www.elastic.co/guide/en/elasticsearch/reference/current/dynamic-templates.html
        //!INFO! optimized for ES6.0 @180520
        const ES_SETTINGS: any = {
            template: CONF_ES_INDEX,
            settings: {
                index: {
                    number_of_shards: shards,
                    number_of_replicas: replicas,
                    // refresh_interval: '5s',
                },
            },
            mappings: {
                //! deprecated in 7.x
                _default_: {
                    // "_all": {"enabled": true},   only for ES5 (see below)
                    dynamic_templates: [
                        {
                            string_fields: {
                                match: '*_multi',
                                match_mapping_type: 'string',
                                mapping: {
                                    type: 'multi_field',
                                    fields: {
                                        '{name}': {
                                            type: CONF_ES_VERSION >= 6 ? 'text' : 'string',
                                            index: 'analyzed',
                                            omit_norms: true,
                                            index_options: 'docs',
                                        },
                                        '{name}.raw': {
                                            type: CONF_ES_VERSION >= 6 ? 'text' : 'string',
                                            index: 'not_analyzed',
                                            ignore_above: 256,
                                        },
                                    },
                                },
                            },
                        },
                    ],
                    _source: { enabled: CONF_ES_VERSION >= 6 ? true : false },
                    properties: {
                        '@version': {
                            type: CONF_ES_VERSION >= 6 ? 'text' : 'string',
                            index: CONF_ES_VERSION >= 6 ? false : 'not_analyzed',
                        },
                        title: { type: CONF_ES_VERSION >= 6 ? 'text' : 'string' },
                        name: { type: CONF_ES_VERSION >= 6 ? 'text' : 'string' },
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
                },
            },
        };

        //! ES6 추가 구성...
        if (!(CONF_ES_VERSION >= 6)) {
            ES_SETTINGS.mappings._default_['all'] = { enabled: true };
        }

        //! ID가 문자열이면, 인덱스를 추가해 줌.
        if (CONF_ID_NAME && idType == 'string') {
            ES_SETTINGS.mappings._default_.properties[CONF_ID_NAME] = {
                type: CONF_ES_VERSION >= 6 ? 'text' : 'string',
                fields: {
                    keyword: { type: 'keyword', ignore_above: 256 },
                },
            };
        }

        //! timeseries 데이터로, 기본 timestamp 값을 넣어준다. (주위! save시 current-time 값 자동 저장)
        if (!!CONF_ES_TIMESERIES) {
            ES_SETTINGS.settings.index.refresh_interval = '5s';
            ES_SETTINGS.mappings._default_.properties['@timestamp'] = { type: 'date', doc_values: true };
            ES_SETTINGS.mappings._default_.properties['ip'] = { type: 'ip' };

            //! clear mappings.
            const CLEANS = '@version,title,created_at,updated_at,deleted_at'.split(',');
            CLEANS.map(key => delete ES_SETTINGS.mappings._default_.properties[key]);
        }

        //! returns settings.
        return ES_SETTINGS;
    }
}

/**
 * error samples
 */
export const $ERROR = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler: (name: string, cb?: (e: Error) => any) => (e: any) => {
        _err(NS, `! err[${name}]@a =`, e instanceof Error, $U.json(e));
        const status = `${e.statusCode || ''}`;
        const message = `${e.message || e.msg || ''}`;
        const error = ((e: any) => {
            if (!e) return {};
            if (e.body && e.body.error) {
                const error = e.body.error;
                if (error.root_cause && Array.isArray(error.root_cause)) return error.root_cause[0];
                else if (error.root_cause) return error.root_cause;
                return error;
            } else if (e.response) {
                const error =
                    typeof e.response == 'string' && e.response.startsWith('{') ? JSON.parse(e.response) : e.response;
                if (error.root_cause && Array.isArray(error.root_cause)) return error.root_cause[0];
                else if (error.root_cause) return error.root_cause;
                return error;
            } else {
                const type = e.statusCode || e.status || 0;
                const reason = e.displayName || e.msg;
                const path = e.path || '';
                return { type, reason, path, message };
            }
        })(e);
        error.status = error.status || status;
        error.message = error.message || message;
        //! print the unknown type exception
        if (!error || error.status) {
            // _err(NS, `! err[${name}]@b =`, e instanceof Error, $U.json(e));
            // _err(NS, `> err[${name}]@c =`, $U.json(error));
            // _err(NS, `> error[${name}].type =`, error.type);
            // _err(NS, `> error[${name}].reason =`, error.reason);
            // _err(NS, `> error[${name}].message =`, error.message);
        }
        //! build Error instance.
        const $e = new Error(
            `${error.status} ${error.type || error.reason || error.message} - ${error.reason || error.message}`,
        );
        if (cb) return cb($e);
        throw $e;
    },
    index_not_found_exception: {
        msg:
            '[index_not_found_exception] no such index, with { resource.type="index_or_alias" & resource.id="test-v2" & index_uuid="_na_" & index="test-v2" }',
        path: '/test-v2',
        query: {},
        statusCode: 404,
        response:
            '{"error":{"root_cause":[{"type":"index_not_found_exception","reason":"no such index","resource.type":"index_or_alias","resource.id":"test-v2","index_uuid":"_na_","index":"test-v2"}],"type":"index_not_found_exception","reason":"no such index","resource.type":"index_or_alias","resource.id":"test-v2","index_uuid":"_na_","index":"test-v2"},"status":404}',
    },
    resource_already_exists_exception: {
        msg:
            '[resource_already_exists_exception] index [test-v2/R_X1Daw7S0e8qIh_W3M-Fg] already exists, with { index_uuid="R_X1Daw7S0e8qIh_W3M-Fg" & index="test-v2" }',
        path: '/test-v2',
        query: {},
        body:
            '{"settings":{"index":{"number_of_shards":4,"number_of_replicas":1}},"template":"test-v2","mappings":{"_default_":{"dynamic_templates":[{"string_fields":{"match":"*_multi","match_mapping_type":"string","mapping":{"type":"multi_field","fields":{"{name}":{"type":"text","index":"analyzed","omit_norms":true,"index_options":"docs"},"{name}.raw":{"type":"text","index":"not_analyzed","ignore_above":256}}}}}],"_source":{"enabled":true},"properties":{"@version":{"type":"text","index":false},"title":{"type":"text"},"name":{"type":"text"},"created_at":{"type":"date","format":"strict_date_optional_time||epoch_millis"},"updated_at":{"type":"date","format":"strict_date_optional_time||epoch_millis"},"deleted_at":{"type":"date","format":"strict_date_optional_time||epoch_millis"},"@id":{"type":"text","fields":{"keyword":{"type":"keyword","ignore_above":256}}}}}}}',
        statusCode: 400,
        response:
            '{"error":{"root_cause":[{"type":"resource_already_exists_exception","reason":"index [test-v2/R_X1Daw7S0e8qIh_W3M-Fg] already exists","index_uuid":"R_X1Daw7S0e8qIh_W3M-Fg","index":"test-v2"}],"type":"resource_already_exists_exception","reason":"index [test-v2/R_X1Daw7S0e8qIh_W3M-Fg] already exists","index_uuid":"R_X1Daw7S0e8qIh_W3M-Fg","index":"test-v2"},"status":400}',
    },
    not_found: {
        msg: 'Not Found',
        path: '/test-v3/_doc/bbb',
        query: {},
        statusCode: 404,
        response: '{"_index":"test-v3","_type":"_doc","_id":"bbb","found":false}',
    },
    action_request_validation_exception: {
        msg: '[action_request_validation_exception] Validation Failed: 1: script or doc is missing;',
        path: '/test-v3/_doc/aaa/_update',
        query: {},
        statusCode: 400,
        response:
            '{"error":{"root_cause":[{"type":"action_request_validation_exception","reason":"Validation Failed: 1: script or doc is missing;"}],"type":"action_request_validation_exception","reason":"Validation Failed: 1: script or doc is missing;"},"status":400}',
    },
    remote_transport_exception: {
        msg: '[remote_transport_exception] [rt8LrQT][x.x.x.x:9300][indices:data/write/update[s]]',
        path: '/test-v3/_doc/aaa/_update',
        query: {},
        body: '{"upsert":{"count":2,"a":5},"script":"ctx._source.count += 2,ctx._source.a += 5"}',
        statusCode: 400,
        response:
            '{"error":{"root_cause":[{"type":"remote_transport_exception","reason":"[rt8LrQT][x.x.x.x:9300][indices:data/write/update[s]]"}],"type":"illegal_argument_exception","reason":"failed to execute script","caused_by":{"type":"script_exception","reason":"compile error","script_stack":["ctx._source.count += 2,ctx._source.a += 5","                      ^---- HERE"],"script":"ctx._source.count += 2,ctx._source.a += 5","lang":"painless","caused_by":{"type":"illegal_argument_exception","reason":"unexpected token [\',\'] was expecting one of [{<EOF>, \';\'}]."}}},"status":400}',
    },
    version_conflict_engine_exception: {
        '!': '가끔씩 update할때 나는것 같음! 개선 필요 @191121',
        msg:
            '[version_conflict_engine_exception] [item][TTDfu-tfwfoE0CFuQ=]: version conflict, current version [3] is different than the one provided [2], with { index_uuid="GxCGaNZoSZuoDFTmWfjqtg" & shard="4" & index="clusters-v1" }',
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
        const dummy = loadDataYml(dataFile);
        this.load(dummy.data);
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
    public hello = async () => `dummy-elastic6-service:${this.options.indexName}`;

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
        const item = { ...org, ...updates, _version: Number(org._version) + 1 };
        if (increments) {
            //TODO - support increments in dummy.
        }
        this.buffer[id] = item;
        return item;
    }
}
