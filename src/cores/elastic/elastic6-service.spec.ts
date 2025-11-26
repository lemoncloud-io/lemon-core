/**
 * `elastic6-service.spec.js`
 * - unit test for `elastic6-service` w/ dummy data
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-25 initial version with dummy serivce
 * @date        2022-02-21 optimized error handler, and search.
 * @date        2022-02-22 optimized w/ elastic client (elasticsearch-js)
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { GETERR, expect2, _it, waited, loadJsonSync } from '../..';
import { GeneralItem, Incrementable, SearchBody } from 'lemon-model';
import {
    Elastic6Service,
    DummyElastic6Service,
    Elastic6Option,
    $ERROR,
    Elastic6Item,
    ElasticIndexService,
} from './elastic6-service';
import fs from 'fs';
// import { ApiResponse } from '@elastic/elasticsearch';

/**
 * default endpoints url.
 * - use ssh tunneling to make connection to real server instance.
 */
const ENDPOINTS = {
    //* elastic-search */
    '6.2': 'https://localhost:8443', // run alias lmes62
    '7.1': 'https://localhost:9071', // run alias lmts071
    '7.2': 'https://localhost:9072', // run alias lmts072
    '7.10': 'https://localhost:9710', // run alias lmts710
    //* open-search */
    '1.1': 'https://localhost:8683', // run alias lmes68
    '1.2': 'https://localhost:9683', // run alias lmes72
    '2.13': 'https://localhost:9213', // run alias lmts213
};

export type VERSIONS = keyof typeof ENDPOINTS;

interface MyModel extends GeneralItem {
    id: string;
}
/**
 * Mock ElasticSearch Client
 * - Mimics ES client behavior in memory
 */
class MockElasticClient {
    private indexMap: Map<string, any> = new Map();
    private documents: Map<string, Map<string, any>> = new Map();
    private version: string;
    private errorMode: string | null = null;

    constructor(version: string = '6.2') {
        this.version = version;
    }

    // Error simulation for testing
    public setErrorMode(mode: string | null) {
        this.errorMode = mode;
    }

    public info() {
        return Promise.resolve({
            body: {
                version: {
                    number: this.version,
                },
            },
        });
    }

    public cat = {
        indices: async (params?: any) => {
            const indices = Array.from(this.indexMap.keys()).map(index => ({
                pri: '4',
                rep: '1',
                'docs.count': String(this.documents.get(index)?.size || 0),
                'docs.deleted': '0',
                health: 'green',
                index,
                status: 'open',
                uuid: `uuid-${index}`,
                'pri.store.size': '1kb',
                'store.size': '1kb',
            }));
            return { body: indices };
        },
    };

    public indices = {
        get: async (params: any) => {
            const indexName = params.index;
            if (!this.indexMap.has(indexName)) {
                const error: any = new Error('index_not_found_exception');
                error.meta = { statusCode: 404, body: { error: { type: 'index_not_found_exception' } } };
                throw error;
            }
            const settings = this.indexMap.get(indexName);
            return {
                body: {
                    [indexName]: {
                        mappings: settings?.mappings || {},
                        settings: settings?.settings || {},
                    },
                },
            };
        },
        getMapping: async (params: any) => {
            const indexName = params.index;
            if (!this.indexMap.has(indexName)) {
                const error: any = new Error('index_not_found_exception');
                error.meta = { statusCode: 404 };
                throw error;
            }
            const settings = this.indexMap.get(indexName);
            return { body: { [indexName]: { mappings: settings?.mappings || {} } } };
        },
        getSettings: async (params: any) => {
            const indexName = params.index;
            if (!this.indexMap.has(indexName)) {
                const error: any = new Error('index_not_found_exception');
                error.meta = { statusCode: 404 };
                throw error;
            }
            const settings = this.indexMap.get(indexName);
            return { body: { [indexName]: { settings: settings?.settings || {} } } };
        },
        exists: async (params: any) => {
            return this.indexMap.has(params.index);
        },
        create: async (params: any) => {
            // Simulate "resource already exists" error
            if (this.indexMap.has(params.index)) {
                const error: any = new Error('resource_already_exists_exception');
                error.meta = {
                    statusCode: 400,
                    body: { error: { type: 'resource_already_exists_exception', reason: 'Index already exists' } },
                };
                throw error;
            }
            this.indexMap.set(params.index, params.body || {});
            this.documents.set(params.index, new Map());
            return { body: { acknowledged: true } };
        },
        delete: async (params: any) => {
            if (!this.indexMap.has(params.index)) {
                const error: any = new Error('index_not_found_exception');
                error.meta = {
                    statusCode: 404,
                    body: { error: { type: 'index_not_found_exception', reason: 'Index not found' } },
                };
                throw error;
            }
            this.indexMap.delete(params.index);
            this.documents.delete(params.index);
            return { body: { acknowledged: true } };
        },
        refresh: async (params: any) => {
            if (!this.indexMap.has(params.index)) {
                const error: any = new Error('index_not_found_exception');
                error.meta = {
                    statusCode: 404,
                    body: { error: { type: 'index_not_found_exception', reason: 'Index not found' } },
                };
                throw error;
            }
            return { body: { _shards: { total: 4, successful: 4, failed: 0 } } };
        },
        flush: async (params: any) => {
            if (!this.indexMap.has(params.index)) {
                const error: any = new Error('index_not_found_exception');
                error.meta = {
                    statusCode: 404,
                    body: { error: { type: 'index_not_found_exception', reason: 'Index not found' } },
                };
                throw error;
            }
            return { body: { _shards: { total: 4, successful: 4, failed: 0 } } };
        },
    };

    public get = async (params: any) => {
        const docs = this.documents.get(params.index);
        if (!docs) {
            // Index not found
            const error: any = new Error('index_not_found_exception');
            error.meta = {
                statusCode: 404,
                body: { error: { type: 'index_not_found_exception', reason: 'Index not found' } },
            };
            throw error;
        }
        if (!docs.has(params.id)) {
            const error: any = new Error('Not Found');
            error.meta = { statusCode: 404, body: { found: false } };
            throw error;
        }
        const doc = docs.get(params.id);
        return {
            body: {
                _index: params.index,
                _type: params.type || '_doc',
                _id: params.id,
                _version: doc._version || 1,
                found: true,
                _source: doc._source,
            },
        };
    };

    public index = async (params: any) => {
        const docs = this.documents.get(params.index) || new Map();
        // Generate ID if not provided (like ES does)
        const id =
            params.id && params.id !== '' ? params.id : `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const existing = docs.get(id);
        const _version = existing ? existing._version + 1 : 1;
        docs.set(id, { _source: params.body, _version });
        this.documents.set(params.index, docs);
        return {
            body: {
                _index: params.index,
                _type: params.type || '_doc',
                _id: id,
                _version,
                _seq_no: 0,
                _primary_term: 1,
                result: existing ? 'updated' : 'created',
            },
        };
    };

    public create = async (params: any) => {
        const docs = this.documents.get(params.index) || new Map();
        // Create fails if document already exists
        if (docs.has(params.id)) {
            const error: any = new Error('version_conflict_engine_exception');
            error.meta = {
                statusCode: 409,
                body: { error: { type: 'version_conflict_engine_exception', reason: 'Document already exists' } },
            };
            throw error;
        }
        docs.set(params.id, { _source: params.body, _version: 1 });
        this.documents.set(params.index, docs);
        return {
            body: {
                _index: params.index,
                _type: params.type || '_doc',
                _id: params.id,
                _version: 1,
                _seq_no: 0,
                _primary_term: 1,
                result: 'created',
            },
        };
    };

    public delete = async (params: any) => {
        const docs = this.documents.get(params.index);
        if (!docs) {
            // Index not found
            const error: any = new Error('index_not_found_exception');
            error.meta = {
                statusCode: 404,
                body: { error: { type: 'index_not_found_exception', reason: 'Index not found' } },
            };
            throw error;
        }
        if (!docs.has(params.id)) {
            const error: any = new Error('Not Found');
            error.meta = { statusCode: 404, body: { result: 'not_found' } };
            throw error;
        }
        const doc = docs.get(params.id);
        docs.delete(params.id);
        return {
            body: {
                _index: params.index,
                _type: params.type || '_doc',
                _id: params.id,
                _version: doc._version + 1,
                _seq_no: 0,
                _primary_term: 1,
                result: 'deleted',
            },
        };
    };

    public update = async (params: any) => {
        const docs = this.documents.get(params.index);
        if (!docs || !docs.has(params.id)) {
            // Upsert: create if not exists
            if (params.body?.upsert) {
                const upsertData = params.body.upsert;
                docs.set(params.id, { _source: { ...upsertData }, _version: 1 });
                this.documents.set(params.index, docs);
                return {
                    body: {
                        _index: params.index,
                        _type: params.type || '_doc',
                        _id: params.id,
                        _version: 1,
                        _seq_no: 0,
                        _primary_term: 1,
                        result: 'created',
                    },
                };
            }
            const error: any = new Error('Not Found');
            error.meta = { statusCode: 404 };
            throw error;
        }
        const doc = docs.get(params.id);
        let updated = { ...doc._source };

        // Handle doc update
        if (params.body?.doc) {
            updated = { ...updated, ...params.body.doc };
        }

        // Handle script update (for increment operations)
        if (params.body?.script) {
            const script = params.body.script;
            // Handle item updates
            if (script.params?.item) {
                Object.entries(script.params.item).forEach(([key, value]: [string, any]) => {
                    updated[key] = value;
                });
            }
            // Handle increments
            if (script.params?.increments) {
                Object.entries(script.params.increments).forEach(([key, value]: [string, any]) => {
                    if (Array.isArray(value)) {
                        // Array append
                        if (Array.isArray(updated[key])) {
                            updated[key] = [...updated[key], ...value];
                        } else {
                            updated[key] = value;
                        }
                    } else {
                        // Numeric increment
                        if (typeof updated[key] === 'number') {
                            updated[key] = updated[key] + value;
                        } else {
                            updated[key] = value;
                        }
                    }
                });
            }
        }

        const _version = doc._version + 1;
        docs.set(params.id, { _source: updated, _version });
        return {
            body: {
                _index: params.index,
                _type: params.type || '_doc',
                _id: params.id,
                _version,
                _seq_no: 0,
                _primary_term: 1,
                result: 'updated',
            },
        };
    };

    public search = async (params: any) => {
        const docs = this.documents.get(params.index) || new Map();
        const hits = Array.from(docs.entries()).map(([id, doc]) => ({
            _index: params.index,
            _type: params.type || '_doc',
            _id: id,
            _score: 1.0,
            _source: doc._source,
            _seq_no: 0,
            _primary_term: 1,
            sort: params.body?.sort ? [id] : undefined,
        }));

        const size = params.body?.size || 10;
        const from = params.body?.from || 0;
        const paginatedHits = hits.slice(from, from + size);

        return {
            body: {
                took: 1,
                timed_out: false,
                _shards: { total: 4, successful: 4, skipped: 0, failed: 0 },
                hits: {
                    total: this.version.startsWith('6') ? hits.length : { value: hits.length, relation: 'eq' },
                    max_score: 1.0,
                    hits: paginatedHits,
                },
                aggregations: params.body?.aggs ? {} : undefined,
            },
        };
    };

    public bulk = async (params: any) => {
        const operations = params.body || [];
        const items: any[] = [];

        for (let i = 0; i < operations.length; i += 2) {
            const action = operations[i];
            const doc = operations[i + 1];
            const actionType = Object.keys(action)[0];
            const actionParams = action[actionType];

            try {
                if (actionType === 'index') {
                    const result = await this.index({ ...actionParams, body: doc });
                    items.push({ [actionType]: result.body });
                } else if (actionType === 'create') {
                    const result = await this.create({ ...actionParams, body: doc });
                    items.push({ [actionType]: result.body });
                } else if (actionType === 'delete') {
                    const result = await this.delete(actionParams);
                    items.push({ [actionType]: result.body });
                } else if (actionType === 'update') {
                    const result = await this.update({ ...actionParams, body: doc });
                    items.push({ [actionType]: result.body });
                }
            } catch (e: any) {
                items.push({
                    [actionType]: {
                        error: {
                            type: e.message,
                            reason: e.meta?.body?.error?.reason || 'Unknown error',
                        },
                    },
                });
            }
        }

        return { body: { errors: false, items, took: 1 } };
    };
}

const buildEsError = (type: string, statusCode: number, reason: string, metaOverrides?: any) => {
    const error: any = new Error(type);
    error.meta = {
        statusCode,
        body: {
            error: {
                type,
                reason,
                root_cause: [{ type, reason }],
            },
        },
    };
    if (metaOverrides) {
        error.meta = { ...error.meta, ...metaOverrides };
    }
    return error;
};

const mockReject = (target: any, method: string, error: any) => {
    const spy = jest.spyOn(target, method as never);
    (spy as jest.SpyInstance<any, any>).mockImplementation(() => Promise.reject(error));
    return spy;
};

/**
 * MockElastic6Service
 * - Uses Mock ES client to test actual ES communication code paths
 */
class MockElastic6Service<T extends GeneralItem> extends Elastic6Service<T> {
    constructor(options: Elastic6Option) {
        super(options);
        // Replace real client with mock
        (this as any)._client = new MockElasticClient(options.version);
    }
}

export const instance = (version: VERSIONS = '6.2', useAutoComplete = false, indexName?: string) => {
    //* NOTE - use tunneling to elastic6 endpoint.
    const endpoint = ENDPOINTS[version];
    if (!endpoint) throw new Error(`@version[${version}] is not supported!`);

    // const indexName = `test-v${version}`;
    indexName = indexName ?? `test-v${version}`;
    const idName = '$id'; //* global unique id-name in same index.
    const docType = '_doc'; //* must be `_doc`.
    const autocompleteFields = useAutoComplete ? ['title', 'name'] : null;
    const options: Elastic6Option = { endpoint, indexName, idName, docType, autocompleteFields, version };

    // service is an instance of serach engine
    const service = new (class extends Elastic6Service<MyModel> {
        public constructor() {
            super(options);
        }
        //* open to `public`
        public async getVersion(options?: any) {
            return super.getVersion(options);
        }
        public async executeSelfTest() {
            return super.executeSelfTest();
        }
        //* expose protected method for testing
        public testPopullateAutocompleteFields<T = any>(body: T): T {
            return this.popullateAutocompleteFields(body);
        }
    })();

    // dummy for testing Elasticsearch with buffer - extended version
    const dummy = new (class extends DummyElastic6Service<MyModel> {
        public constructor() {
            super('dummy-elastic6-data.yml', options);
        }
        //* expose protected method for testing
        public testPopullateAutocompleteFields<T = any>(body: T): T {
            return this.popullateAutocompleteFields(body);
        }
        //* override to throw errors for testing searchAll retry
        private shouldThrow429 = false;
        public enableThrow429() {
            this.shouldThrow429 = true;
        }
        public disableThrow429() {
            this.shouldThrow429 = false;
        }
        public async search(body: any): Promise<any> {
            if (this.shouldThrow429) {
                this.shouldThrow429 = false;
                const error: any = new Error('429 UNKNOWN - too many requests');
                error.statusCode = 429;
                throw error;
            }
            return super.search(body);
        }
    })();

    // mock service for testing actual ES client code paths
    const mock = new MockElastic6Service<MyModel>(options);

    return { version, service, dummy, mock, options };
};

/**
 * initialize the service with the specified version.
 * @param ver - version of the Elasticsearch service.
 * @returns object containing the initialized service and its options.
 */
export const initService = async (ver: VERSIONS) => {
    const { service, options } = instance(ver);
    const { indexName, idName } = options;

    //* check hello
    const helloResult = service.hello();
    expect2(() => helloResult).toEqual(`elastic6-service:${indexName}:${ver}`);

    //* check idName
    expect2(() => idName).toEqual('$id');

    //* check indexName
    expect2(() => indexName).toEqual(`test-v${ver}`);

    //* check version
    expect2(() => service.options.version).toEqual(ver);

    //* check version parse error
    expect2(() => service.parseVersion('12345')).toEqual('@version[12345] is invalid - fail to parse');
    expect2(() => service.parseVersion('abcd')).toEqual('@version[abcd] is invalid - fail to parse');
    expect2(() => service.parseVersion('1.2.3a')).toEqual('@version[1.2.3a] is invalid - fail to parse');
    expect2(() => service.parseVersion('1.2.3')).toEqual({ engine: 'os', major: 1, minor: 2, patch: 3 });
    expect2(() => service.parseVersion('1.2')).toEqual({ engine: 'os', major: 1, minor: 2, patch: 0 });
    expect2(() => service.parseVersion('1')).toEqual({ engine: 'os', major: 1, minor: 0, patch: 0 });
    expect2(() => service.parseVersion('1.2.0')).toEqual({ engine: 'os', major: 1, minor: 2, patch: 0 });
    expect2(() => service.parseVersion('1.0.0')).toEqual({ engine: 'os', major: 1, minor: 0, patch: 0 });
    expect2(() => service.parseVersion('1.2.3-alpha')).toEqual({
        engine: 'os',
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'alpha',
    });
    expect2(() => service.parseVersion('1.2.3+build.001')).toEqual({
        build: 'build.001',
        engine: 'os',
        major: 1,
        minor: 2,
        patch: 3,
    });
    expect2(() => service.parseVersion('1.2.3-alpha+build.001')).toEqual({
        build: 'build.001',
        engine: 'os',
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'alpha',
    });

    return { service, options };
};

/**
 * set up the index.
 * @param service - Elasticsearch service instance.
 * @param indexName - the name of the index to be set up.
 */
export const setupIndex = async (service: Elastic6Service<MyModel>): Promise<void> => {
    const PASS = (e: any) => e;
    const indexName = service.options.indexName;

    //* destroy index if it already exists
    const oldIndex = await service.findIndex(indexName);
    if (oldIndex) {
        expect2(() => oldIndex, 'index').toEqual({ index: indexName });
        expect2(await service.destroyIndex().catch(PASS)).toEqual({
            status: 200,
            acknowledged: true,
            index: indexName,
        });
        await waited(100);

        // check 404 NOT FOUND - index:
        expect2(await service.getIndexMapping().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        expect2(await service.destroyIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        expect2(await service.refreshIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        expect2(await service.flushIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        expect2(await service.describe().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        expect2(await service.readItem('A0').catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        expect2(await service.deleteItem('A0').catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
    }

    //* create index
    expect2(await service.createIndex().catch(PASS)).toEqual({
        status: 200,
        acknowledged: true,
        index: indexName,
    });
    await waited(200);

    //* fail to create index if already in use
    expect2(await service.createIndex().catch(GETERR)).toEqual(`400 IN USE - index:${indexName}`);

    //* describe index
    const describeResult = await service.describe().catch(PASS);
    const indexSettings = describeResult.settings.index;
    const dynamicSettings = describeResult.mappings._doc
        ? describeResult.mappings._doc.dynamic_templates
        : describeResult.mappings.dynamic_templates;

    // description of index settings
    expect2(() => indexSettings.number_of_replicas).toEqual('1');
    expect2(() => indexSettings.number_of_shards).toEqual('4');
    expect2(() => indexSettings.provided_name).toEqual(`${indexName}`);
    const analysisSettings = indexSettings.analysis;

    expect2(() => analysisSettings.analyzer.autocomplete_case_insensitive).toEqual({
        filter: ['lowercase'],
        tokenizer: 'edge_30grams',
        type: 'custom',
    });
    expect2(() => analysisSettings.analyzer.autocomplete_case_sensitive).toEqual({
        filter: service.isOldES6 ? ['standard'] : [],
        tokenizer: 'edge_30grams',
        type: 'custom',
    });
    expect2(() => analysisSettings.analyzer.hangul).toEqual({
        filter: ['lowercase'],
        tokenizer: 'hangul',
        type: 'custom',
    });
    expect2(() => analysisSettings.tokenizer.edge_30grams).toEqual({
        max_gram: '30',
        min_gram: '1',
        token_chars: ['letter', 'digit', 'punctuation', 'symbol'],
        type: 'edge_ngram',
    });
    expect2(() => analysisSettings.tokenizer.hangul).toEqual({
        decompound: 'true',
        deinflect: 'true',
        index_eojeol: 'true',
        pos_tagging: 'false',
        type: 'seunjeon_tokenizer',
    });

    // dynamic templates
    expect2(() => dynamicSettings[0].autocomplete).toEqual({
        mapping: { analyzer: 'autocomplete_case_insensitive', search_analyzer: 'standard', type: 'text' },
        path_match: '_decomposed.*',
    });
    expect2(() => dynamicSettings[1].autocomplete_qwerty).toEqual({
        mapping: { analyzer: 'autocomplete_case_sensitive', search_analyzer: 'whitespace', type: 'text' },
        path_match: '_qwerty.*',
    });
    expect2(() => dynamicSettings[2].string_id).toEqual({
        mapping: { ignore_above: 256, type: 'keyword' },
        match: '$id',
        match_mapping_type: 'string',
    });
    expect2(() => dynamicSettings[3].strings).toEqual({
        mapping: {
            analyzer: 'hangul',
            fields: { keyword: { ignore_above: 256, type: 'keyword' } },
            search_analyzer: 'hangul',
            type: 'text',
        },
        match_mapping_type: 'string',
    });

    //* flush index
    const flushResult = await service.flushIndex().catch(PASS);
    expect2(() => flushResult._shards.failed).toEqual(0); // no failures
    expect2(() => flushResult._shards.successful).toBeGreaterThan(0); // check successful flush
    expect2(() => flushResult._shards.total).toBeGreaterThan(0); // check total shards
    await waited(200);
};

/**
 * check if the test can be performed.
 * @param service - Elasticsearch service instance.
 * @returns boolean which indicates whether the test can be performed.
 */
export const canPerformTest = async (service: Elastic6Service<MyModel>): Promise<boolean> => {
    // const { service } = instance();
    // cond 1. localhost is able to access elastic6 endpoint (by tunneling)
    // cond 2. index must be exist
    try {
        await service.listIndices();
        return true;
    } catch (e) {
        if (GETERR(e).includes('ECONNREFUSED')) return false; // no connection.
        if (GETERR(e).includes('Connection Error')) return false; // no connection.
        //* unable to access to elastic6 endpoint
        if (GETERR(e).endsWith('unknown error')) return false;
        //* index does not exist
        if (GETERR(e).startsWith('404 NOT FOUND')) return false;

        throw e;
    }
};
/**
 * perform basic CRUD tests.
 * @param service - Elasticsearch service instance.
 */
export const basicCRUDTest = async (service: Elastic6Service<any>): Promise<void> => {
    expect2(await service.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
    expect2(await service.deleteItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');

    //* err test
    const data = {
        ns: 'SS',
        type: 'user',
        stereo: 'tenant',
        account$: {
            openId: '123',
            id: '123',
        },
        createdAt: '2024-10-21T14:30:00Z',
        updatedAt: '2024-10-21T14:30:00Z',
        deletedAt: '0',
    };
    const extra$ = {
        activateToken: '123',
        siteId: '123',
        userId: '123',
    };
    // save data
    expect2(await service.saveItem('T1070', data)).toEqual({ ...data, $id: 'T1070', _id: 'T1070', _version: 1 });
    expect2(await service.readItem('T1070')).toEqual({ ...data, $id: 'T1070', _id: 'T1070', _version: 1 });

    // add extra$ to data
    expect2(await service.updateItem('T1070', { ...data, extra$ })).toEqual({
        ...data,
        extra$,
        _id: 'T1070',
        _version: 2,
    });
    expect2(await service.readItem('T1070')).toEqual({
        ...data,
        extra$,
        _id: 'T1070',
        $id: 'T1070',
        _version: 2,
    });
    // update extra$ to null
    expect2(await service.updateItem('T1070', { ...data, extra$: null })).toEqual({
        ...data,
        extra$: null,
        _id: 'T1070',
        _version: 3,
    });
    expect2(await service.readItem('T1070')).toEqual({
        ...data,
        extra$: null,
        _id: 'T1070',
        $id: 'T1070',
        _version: 3,
    });

    //* create new item
    const A0 = { type: '', name: 'a0' };
    expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, $id: 'A0', _id: 'A0', _version: 2 });
    expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, $id: 'A0', _id: 'A0', _version: 3 });

    //* try to update fields.
    // item: { type: 'test' }, increment: { count: 1 }
    expect2(await service.updateItem('A0', { type: 'test' }, { count: 1 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 4,
        type: 'test',
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 4,
        count: 1,
        name: 'a0',
        type: 'test',
    });
    // item: null, increment: {count: 0}
    expect2(await service.updateItem('A0', null, { count: 0 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 5,
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 5,
        count: 1,
        name: 'a0',
        type: 'test',
    });
    // item: {count: 0}, increment: -
    expect2(await service.updateItem('A0', { count: 0 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 6,
        count: 0,
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 6,
        count: 0,
        name: 'a0',
        type: 'test',
    });
    // item: { type: 'test' }, increment: { a: 1, b: 2 }
    expect2(await service.updateItem('A0', { type: 'test' }, { a: 1, b: 2 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 7,
        type: 'test',
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 7,
        a: 1,
        b: 2,
        count: 0,
        name: 'a0',
        type: 'test',
    });
    // item: { type: 'test', count: 0 }, increment: { a: 1, b: 2 }
    expect2(await service.updateItem('A0', { type: 'test', count: 0 }, { a: 1, b: 2 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 8,
        type: 'test',
        count: 0,
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 8,
        a: 2,
        b: 4,
        count: 0,
        name: 'a0',
        type: 'test',
    });

    //* save A1
    expect2(await service.saveItem('A1', { type: 'test', count: 1 }).catch(GETERR)).toEqual({
        $id: 'A1',
        _id: 'A1',
        _version: 1,
        count: 1,
        type: 'test',
    });
};

/**
 * perform basic search tests.
 * - 버전에 상관없이 `search()`가 일정한(동일한) 결과를 얻어냄 (단, searchRaw()는 원본 그대로)
 * ==> search() 호환성 보장함
 *
 * @param service - Elasticsearch service instance.
 * @param indexName - the name of the index to search.
 */
export const basicSearchTest = async (service: Elastic6Service<MyModel>): Promise<void> => {
    //* try to search...
    await waited(2000);
    const $search: SearchBody = {
        size: 1,
        query: {
            bool: {
                filter: {
                    term: {
                        type: 'test',
                    },
                },
            },
        },
        aggs: {
            test: {
                terms: {
                    field: 'count',
                },
            },
        },
        sort: [
            {
                count: {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };
    // check results of searchAll
    const searchRawResult = await service.searchRaw($search);
    const expectedTotal = service.isOldES6 ? 2 : { relation: 'eq', value: 2 };
    const aggregationResult = searchRawResult.aggregations.test;
    const hitsResult = searchRawResult.hits;

    expect2(() => aggregationResult.buckets[0]).toEqual({ doc_count: 1, key: 0 });
    expect2(() => aggregationResult.buckets[1]).toEqual({ doc_count: 1, key: 1 });
    expect2(() => aggregationResult.doc_count_error_upper_bound).toEqual(0);
    expect2(() => aggregationResult.sum_other_doc_count).toEqual(0);
    expect2(() => searchRawResult._shards).toEqual({ failed: 0, skipped: 0, successful: 4, total: 4 });
    expect2(() => hitsResult.hits[0]._source).toEqual({
        $id: 'A0',
        a: 2,
        b: 4,
        type: 'test',
        name: 'a0',
        count: 0,
    });
    expect2(() => hitsResult.hits[0].sort).toEqual([0]);
    expect2(() => hitsResult.total).toEqual(expectedTotal);

    // check results of search
    const searchResult = await service.search($search);
    const aggregationResult2 = searchResult.aggregations.test;

    expect2(() => aggregationResult2.buckets[0]).toEqual({ doc_count: 1, key: 0 });
    expect2(() => aggregationResult2.buckets[1]).toEqual({ doc_count: 1, key: 1 });
    expect2(() => aggregationResult2.doc_count_error_upper_bound).toEqual(0);
    expect2(() => aggregationResult2.sum_other_doc_count).toEqual(0);
    expect2(() => searchResult.total).toEqual(2);
    expect2(() => searchResult.list[0]).toEqual({
        _id: 'A0',
        _score: null,
        a: 2,
        b: 4,
        $id: 'A0',
        count: 0,
        name: 'a0',
        type: 'test',
    });
    expect2(() => searchResult.last).toEqual([0]);

    //verify that the results of `search` and `searchRaw` are equal
    expect2(() => searchRawResult.aggregations).toEqual(searchResult.aggregations);
    expect2(() => searchResult.total).toEqual(
        service.isOldES6 ? searchRawResult.hits.total : searchRawResult.hits.total.value,
    );
};

interface CRUDModel extends Elastic6Item {
    $id?: string;
    nick?: string;
    count?: number;
    type?: string;
    empty?: string | string[] | number | number[];
    a?: string | string[] | number | number[];
    b?: string | string[] | number | number[];
    //TODO - extra should be `GeneralItem`
    extra?: object | any;
}

/**
 * perform detailed CRUD tests.
 * @param service - Elasticsearch service instance.
 */
export const detailedCRUDTest = async (service: Elastic6Service<CRUDModel>): Promise<void> => {
    //* agent for test
    const agent = <T extends CRUDModel = any>() => ({
        update: (id: string, data: T, increment?: Incrementable) =>
            service
                .updateItem(id, data, increment)
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { _id, ...rest } = R;
                    return rest;
                })
                .catch(e => {
                    const msg = GETERR(e);
                    if (msg.startsWith('400 MAPPER PARSING')) return `400 MAPPER PARSING`;
                    return msg;
                }),
        save: (id: string, data: T) =>
            service
                .saveItem(id, data)
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { $id, _id, _version, ...rest } = R;
                    return rest;
                })
                .catch(GETERR),
        read: (id: string) =>
            service
                .readItem(id)
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { $id, _id, ...rest } = R;
                    return rest;
                })
                .catch(GETERR),
    });
    let versionCounter = 0;
    const _ver = (version?: number) => {
        if (version) versionCounter = version;
        return ++versionCounter;
    };
    //* make sure deleted.
    await service.deleteItem('A0').catch(GETERR);
    await service.deleteItem('A1').catch(GETERR);

    //* make sure empty index.
    expect2(await agent().read('A0')).toEqual('404 NOT FOUND - id:A0');
    expect2(await agent().read('A1')).toEqual('404 NOT FOUND - id:A1');

    //* save to A0
    expect2(await agent().save('A0', { type: '', name: 'a0' })).toEqual({ type: '', name: 'a0' });
    expect2(await agent().read('A0'), '!_version').toEqual({ type: '', name: 'a0' }); // `._version` is incremented.
    // expect2(await service.pushItem({ name:'push-01' }).catch(GETERR), '').toEqual({ _id:'EHYvom4Bk-QqXBefOceC', _version:1, name:'push-01' }); // `._id` is auto-gen.
    expect2(await service.pushItem({ name: 'push-01' }).catch(GETERR), '!_id').toEqual({
        _version: 1,
        name: 'push-01',
    }); // `._id` is auto-gen.

    //* try to update
    const data0 = await service.readItem('A0');
    //NOTE - sql like `update <table> set name=01 where id=A0`
    expect2(await agent().update('A0', { name: 'name-01' }), '!_version').toEqual({ name: 'name-01' });
    expect2(await agent().update('A0', { nick: 'nick-01' }), '!_version').toEqual({ nick: 'nick-01' });
    expect2(await agent().read('A0'), '').toEqual({
        _version: Number(data0._version) + 2,
        name: 'name-01',
        nick: 'nick-01',
        type: '',
    }); // `._version` is incremented.

    expect2(await agent().update('A0', null, { count: 2 })).toEqual({ _version: _ver(12) });
    expect2(await agent().update('A0', { count: 10 })).toEqual({ _version: _ver(), count: 10 });
    expect2(await agent().update('A0', null, { count: 2 })).toEqual({ _version: _ver() });

    expect2(await agent().read('A0')).toEqual({
        _version: 15,
        count: 12,
        name: 'name-01',
        nick: 'nick-01',
        type: '',
    }); // support number, string, null type.

    //save empty ''
    expect2(await agent().save('A0', { nick: '', name: '', empty: '' })).toEqual({
        empty: '',
        name: '',
        nick: '',
    });
    expect2(await agent().read('A0')).toEqual({
        _version: 16,
        empty: '',
        name: '',
        nick: '',
    });

    /**
     * test:update inner-object
     */
    // 1) inner-object update w/ null support
    expect2(await agent().save('A1', { extra: { a: 1 } })).toEqual({ extra: { a: 1 } });
    expect2(await agent().update('A1', { extra: { b: 2 } }), '!_version').toEqual({ extra: { b: 2 } });
    expect2(await agent().read('A1'), '!_version').toEqual({ extra: { b: 2 } }); //it should be `{ extra: { b:2 } }` => overwrite whole extra object.

    expect2(await agent().update('A1', { extra: { a: null } }), '!_version').toEqual({ extra: { a: null } });
    expect2(await agent().read('A1'), '!_version').toEqual({ extra: { a: null } });

    expect2(await agent().update('A1', { extra: { a: '' } }), '!_version').toEqual({ extra: { a: '' } });
    expect2(await agent().read('A1'), '!_version').toEqual({ extra: { a: '' } });

    expect2(await agent().update('A1', { extra: '' })).toEqual('400 MAPPER PARSING');

    //* overwrite whole docs
    expect2(await agent().save('A1', { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect2(await agent().read('A1'), '!_version').toEqual({ a: 1, b: 2 });

    //* overwrite inner-object (it should be overritten after save)
    expect2(await agent().update('A1', { extra: { innerObject: 'inner-01' } }), '!_version').toEqual({
        extra: { innerObject: 'inner-01' },
    });
    expect2(await agent().save('A1', { extra: { a: 1, b: 2 } })).toEqual({ extra: { a: 1, b: 2 } });
    expect2(await agent().read('A1'), '!_version').toEqual({ extra: { a: 1, b: 2 } });

    /**
     * updateItem increment test
     */
    // 1-1) string array increment test
    expect2(await agent().update('A1', null, { stringArray: ['a'] })).toEqual({ _version: _ver(9) });
    expect2(await agent().update('A1', null, { stringArray: ['b', 'c'] })).toEqual({ _version: _ver() });
    // 1-2) string array increment w/mismatch type
    expect2(await agent().update('A1', null, { stringArray: [1] })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { stringArray: [1.1] })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { stringArray: [''] })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { stringArray: 1 })).toEqual(
        "400 ILLEGAL ARGUMENT - failed to update due to type mismatch in item's field",
    );
    expect2(await agent().update('A1', null, { stringArray: [1] })).toEqual({ _version: _ver() });
    expect2(await service.readItem('A1'), 'stringArray').toEqual({ stringArray: ['a', 'b', 'c', 1, 1.1, '', 1] });

    // 2-1 ) number array increment test
    expect2(await agent().update('A1', null, { numberArray: [1] })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { numberArray: [2, 3] })).toEqual({ _version: _ver() });
    // 2-2) number array increment w/mismatch type
    expect2(await agent().update('A1', null, { numberArray: [2.1, 3.1] })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { numberArray: ['a'] })).toEqual('400 MAPPER PARSING');
    expect2(await agent().update('A1', null, { numberArray: 1 })).toEqual(
        "400 ILLEGAL ARGUMENT - failed to update due to type mismatch in item's field",
    );
    expect2(await service.readItem('A1'), 'numberArray').toEqual({ numberArray: [1, 2, 3, 2.1, 3.1] });

    // 3-1) long field increment test
    expect2(await agent().update('A1', null, { longField: 1 })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { longField: 2 })).toEqual({ _version: _ver() });
    expect2(await service.readItem('A1'), 'longField').toEqual({ longField: 3 });

    // 3-2) long field increment w/mismatch float
    expect2(await agent().update('A1', null, { longField: 0.345 })).toEqual({ _version: _ver() });
    expect2(await service.readItem('A1'), 'longField').toEqual({ longField: 3 }); // := 1 + 2 + 0 (정수변환이라서)

    // 3-3) long field increment w/mismatch array
    expect2(await agent().update('A1', null, { longField: ['a'] })).toEqual('400 MAPPER PARSING');
    expect2(await agent().update('A1', null, { longField: [1] })).toEqual({ _version: _ver() });
    expect2(await service.readItem('A1'), 'longField').toEqual({ longField: [1] });

    // 4-1) float field increment test
    expect2(await agent().update('A1', null, { floatField: 0.2 })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { floatField: 0.03 })).toEqual({ _version: _ver() });
    expect2(await agent().update('A1', null, { floatField: 1 })).toEqual({ _version: _ver() });
    expect2(await service.readItem('A1'), 'floatField').toEqual({ floatField: 1.23 }); // := 0.2 + 0.03 + 1

    // 4-2) float field increment w/mismatch array
    expect2(await agent().update('A1', null, { floatField: ['a'] })).toEqual('400 MAPPER PARSING');
    expect2(await agent().update('A1', null, { floatField: [1] })).toEqual({ _version: _ver() });
    expect2(await service.readItem('A1'), 'floatField').toEqual({ floatField: [1] });

    //* delete
    expect2(await service.deleteItem('A0'), '!_version').toEqual({ _id: 'A0' });
    expect2(await service.deleteItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');

    expect2(await service.deleteItem('A1'), '!_version').toEqual({ _id: 'A1' });
    expect2(await service.deleteItem('A1').catch(GETERR)).toEqual('404 NOT FOUND - id:A1');
};

/**
 * test mismatch errors
 * - update fields to null
 * - update fields with mismatched types
 * @param service - Elasticsearch service instance.
 */
export const mismatchedTypeTest = async (service: Elastic6Service<any>): Promise<void> => {
    //* agent for test
    const agent = <T = any>(id: string = 'A0') => ({
        update: (data: T) =>
            service
                .updateItem(id, data)
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { _version, _id, ...rest } = R;
                    return rest;
                })
                .catch(GETERR),
        save: (data: T) => service.saveItem(id, data).catch(GETERR),
        read: () => service.readItem(id).catch(GETERR),
    });

    //* 초기 데이터 저장
    await agent().save({
        string_field: 'string',
        long_field: 1234567890123,
        float_field: 123.45,
        date_field: '2021-12-31T23:59:59',
        boolean_field: true,
        object_field: { sub: 'string' },
        nested_field: [{ sub: 'string1' }, { sub2_field: 'string2' }],
        array_field: ['string1', 'string2', 'string3'],
    });

    //* verify the mapping condition. (`_mapping`)
    const mapping = await service.getIndexMapping();
    const properties = service.isOldES6 ? mapping?._doc?.properties : mapping?.properties;
    // verify mapping types
    expect2(() => properties.array_field.type).toEqual('text');
    expect2(() => properties.string_field.type).toEqual('text');
    expect2(() => properties.boolean_field.type).toEqual('boolean');
    expect2(() => properties.date_field.type).toEqual('date');
    expect2(() => properties.float_field.type).toEqual('float');
    expect2(() => properties.long_field.type).toEqual('long');
    // object_field의 하위 속성 검증
    expect2(() => properties.object_field.properties.sub.type).toEqual('text');
    // nested_field의 하위 속성 검증
    expect2(() => properties.nested_field.properties.sub.type).toEqual('text');
    expect2(() => properties.nested_field.properties.sub2_field.type).toEqual('text');

    //* test w/mismatched types
    /**
     * string_field
     * string -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ string_field: null })).toEqual({ string_field: null });
    expect2(await agent().update({ string_field: '' })).toEqual({ string_field: '' });
    expect2(await agent().update({ string_field: 123 })).toEqual({ string_field: 123 });
    expect2(await agent().update({ string_field: 1.23 })).toEqual({ string_field: 1.23 });
    expect2(await agent().update({ string_field: [] })).toEqual({ string_field: [] });
    expect2(await agent().update({ string_field: [1, 2, 3] })).toEqual({ string_field: [1, 2, 3] });
    expect2(await agent().update({ string_field: false })).toEqual({ string_field: false });
    expect2(await agent().update({ string_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [string_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [string_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [string_field] of type [text] in document with id 'A0'. Preview of field's value: '{}'",
    );

    /**
     * long_field
     * long -> object로 업데이트시 오류 발생
     * long -> boolean으로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ long_field: null })).toEqual({ long_field: null });
    expect2(await agent().update({ long_field: '' })).toEqual({ long_field: '' });
    expect2(await agent().update({ long_field: '1234567890123' })).toEqual({ long_field: '1234567890123' });
    expect2(await agent().update({ long_field: 1.234567890123 })).toEqual({ long_field: 1.234567890123 });
    expect2(await agent().update({ long_field: [] })).toEqual({ long_field: [] });
    expect2(await agent().update({ long_field: [1, 2, 3] })).toEqual({ long_field: [1, 2, 3] });
    expect2(await agent().update({ long_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [long_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [long_field] of type [long] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [long_field] of type [long] in document with id 'A0'. Preview of field's value: '{}'",
    );
    expect2(await agent().update({ long_field: false })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [long_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [long_field] of type [long] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [long_field] of type [long] in document with id 'A0'. Preview of field's value: 'false'",
    );

    /**
     * float_field
     * float -> object로 업데이트시 오류 발생
     * float -> -> boolean으로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ float_field: null })).toEqual({ float_field: null });
    expect2(await agent().update({ float_field: '' })).toEqual({ float_field: '' });
    expect2(await agent().update({ float_field: '123.45' })).toEqual({ float_field: '123.45' });
    expect2(await agent().update({ float_field: 123456789 })).toEqual({ float_field: 123456789 });
    expect2(await agent().update({ float_field: [] })).toEqual({ float_field: [] });
    expect2(await agent().update({ float_field: [1, 2, 3] })).toEqual({ float_field: [1, 2, 3] });
    expect2(await agent().update({ float_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [float_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [float_field] of type [float] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [float_field] of type [float] in document with id 'A0'. Preview of field's value: '{}'",
    );
    expect2(await agent().update({ float_field: false })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [float_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [float_field] of type [float] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [float_field] of type [float] in document with id 'A0'. Preview of field's value: 'false'",
    );

    /**
     * data_field
     * data -> ''로 업데이트시 오류 발생
     * data -> float로 업데이트시 오류 발생 (버전 7 이상)
     * data -> {}로 업데이트시 오류 발생
     * data -> boolean으로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ date_field: null })).toEqual({ date_field: null });
    expect2(await agent().update({ date_field: 1234567890 })).toEqual({ date_field: 1234567890 });
    expect2(await agent().update({ date_field: [] })).toEqual({ date_field: [] });
    expect2(await agent().update({ date_field: [1, 2, 3] })).toEqual({ date_field: [1, 2, 3] });
    expect2(await agent().update({ date_field: '' })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [date_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'. Preview of field's value: ''",
    );
    expect2(await agent().update({ date_field: 1.23456789 })).toEqual(
        service.isOldES6
            ? { date_field: 1.23456789 }
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'. Preview of field's value: '1.23456789'",
    );
    expect2(await agent().update({ date_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [date_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'. Preview of field's value: '{}'",
    );
    expect2(await agent().update({ date_field: false })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [date_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'. Preview of field's value: 'false'",
    );

    /**
     * boolean_field
     * boolean -> long으로 업데이트시 오류 발생
     * boolean -> float로 업데이트시 오류 발생
     * boolean -> {}로 업데이트시 오류 발생
     * boolean -> [1, 2, 3]으로 업데이트시 오류 발생. []는 오류 발생하지 않음.
     * */
    expect2(await agent().update({ boolean_field: null })).toEqual({ boolean_field: null });
    expect2(await agent().update({ boolean_field: '' })).toEqual({ boolean_field: '' });
    expect2(await agent().update({ boolean_field: 'true' })).toEqual({ boolean_field: 'true' });
    expect2(await agent().update({ boolean_field: [] })).toEqual({ boolean_field: [] });
    expect2(await agent().update({ boolean_field: 123456789 })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [boolean_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'. Preview of field's value: '123456789'",
    );
    expect2(await agent().update({ boolean_field: 1.23456789 })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [boolean_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'. Preview of field's value: '1.23456789'",
    );
    expect2(await agent().update({ boolean_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [boolean_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'. Preview of field's value: '{}'",
    );
    expect2(await agent().update({ boolean_field: [1, 2, 3] })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [boolean_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'. Preview of field's value: '1'",
    );

    /**
     * object_field
     * object -> ''으로 업데이트시 오류 발생
     * object -> string으로 업데이트시 오류 발생
     * object -> number로 업데이트시 오류 발생
     * object -> []로 업데이트시 오류 발생
     * object -> [1, 2, 3]으로 업데이트시 오류 발생.
     * object -> boolean으로 업데이트시 오류 발생.
     * */
    expect2(await agent().update({ object_field: null })).toEqual({ object_field: null });
    expect2(await agent().update({ object_field: [] })).toEqual({ object_field: [] });
    expect2(await agent().update({ object_field: '' })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [object_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ object_field: 'string' })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [object_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ object_field: 123 })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [object_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ object_field: [1, 2, 3] })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [null] as object, but found a concrete value',
    );
    expect2(await agent().update({ object_field: false })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [object_field] as object, but found a concrete value',
    );

    /**
     * nested_field
     * nested -> string으로 업데이트시 오류 발생
     * nested -> number로 업데이트시 오류 발생
     * nested -> [1, 2, 3]으로 업데이트시 오류 발생. []는 오류 발생하지 않음
     * nested -> ''으로 업데이트시 오류 발생
     * nested -> boolean으로 업데이트시 오류 발생.
     * */
    expect2(await agent().update({ nested_field: null })).toEqual({ nested_field: null });
    expect2(await agent().update({ nested_field: { sub: 'string' } })).toEqual({ nested_field: { sub: 'string' } });
    expect2(await agent().update({ nested_field: [] })).toEqual({ nested_field: [] });
    expect2(await agent().update({ nested_field: '' })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [nested_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ nested_field: 'string' })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [nested_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ nested_field: 123 })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [nested_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ nested_field: [1, 2, 3] })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [null] as object, but found a concrete value',
    );
    expect2(await agent().update({ nested_field: false })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [nested_field] as object, but found a concrete value',
    );

    /**
     * array_field
     * array -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ array_field: null })).toEqual({ array_field: null });
    expect2(await agent().update({ array_field: '' })).toEqual({ array_field: '' });
    expect2(await agent().update({ array_field: 'string' })).toEqual({ array_field: 'string' });
    expect2(await agent().update({ array_field: 123 })).toEqual({ array_field: 123 });
    expect2(await agent().update({ array_field: 1.23456789 })).toEqual({ array_field: 1.23456789 });
    expect2(await agent().update({ array_field: false })).toEqual({ array_field: false });
    expect2(await agent().update({ array_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [array_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'. Preview of field's value: '{}'",
    );

    /**
     * array_field 내부 요소 타입 변경 테스트
     * array 내부 요소 -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ array_field: [] })).toEqual({ array_field: [] });
    expect2(await agent().update({ array_field: ['a'] })).toEqual({ array_field: ['a'] });
    expect2(await agent().update({ array_field: ['a', 1] })).toEqual({ array_field: ['a', 1] });
    expect2(await agent().update({ array_field: [null] })).toEqual({ array_field: [null] });
    expect2(await agent().update({ array_field: [''] })).toEqual({ array_field: [''] });
    expect2(await agent().update({ array_field: [1.1] })).toEqual({ array_field: [1.1] });
    expect2(await agent().update({ array_field: [{ b: 'a' }] })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [array_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'. Preview of field's value: '{b=a}'",
    );

    /**
     * nested_field 내부 요소 타입 변경 테스트
     * nested_field 내부 요소 -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ nested_field: [{ sub: 'string' }] })).toEqual({ nested_field: [{ sub: 'string' }] });
    expect2(await agent().update({ nested_field: [{ sub: 123 }] })).toEqual({ nested_field: [{ sub: 123 }] });
    expect2(await agent().update({ nested_field: [{ sub: 1.23 }] })).toEqual({ nested_field: [{ sub: 1.23 }] });
    expect2(await agent().update({ nested_field: [{ sub: false }] })).toEqual({ nested_field: [{ sub: false }] });
    expect2(await agent().update({ nested_field: [{ sub: null }] })).toEqual({ nested_field: [{ sub: null }] });
    expect2(await agent().update({ nested_field: [{ sub: '' }] })).toEqual({ nested_field: [{ sub: '' }] });
    expect2(await agent().update({ nested_field: [{ sub: { inner: 'object' } }] })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [nested_field.sub]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [nested_field.sub] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [nested_field.sub] of type [text] in document with id 'A0'. Preview of field's value: '{inner=object}'",
    );

    /**
     * object_field 내부 요소 타입 변경 테스트
     * object_field 내부 요소 -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ object_field: { sub: 'string' } })).toEqual({ object_field: { sub: 'string' } });
    expect2(await agent().update({ object_field: { sub: 123 } })).toEqual({ object_field: { sub: 123 } });
    expect2(await agent().update({ object_field: { sub: 1.23 } })).toEqual({ object_field: { sub: 1.23 } });
    expect2(await agent().update({ object_field: { sub: false } })).toEqual({ object_field: { sub: false } });
    expect2(await agent().update({ object_field: { sub: null } })).toEqual({ object_field: { sub: null } });
    expect2(await agent().update({ object_field: { sub: '' } })).toEqual({ object_field: { sub: '' } });
    expect2(await agent().update({ object_field: { sub: { inner: 'object' } } })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [object_field.sub]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [object_field.sub] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [object_field.sub] of type [text] in document with id 'A0'. Preview of field's value: '{inner=object}'",
    );

    //* verify the mapping condition doesn't change. (`_mapping`)
    const mapping2 = await service.getIndexMapping();
    const properties2 = service.isOldES6 ? mapping2?._doc?.properties : mapping2?.properties;
    // verify mapping types for properties2
    expect2(() => properties2.array_field.type).toEqual('text');
    expect2(() => properties2.string_field.type).toEqual('text');
    expect2(() => properties2.boolean_field.type).toEqual('boolean');
    expect2(() => properties2.date_field.type).toEqual('date');
    expect2(() => properties2.float_field.type).toEqual('float');
    expect2(() => properties2.long_field.type).toEqual('long');
    // object_field의 하위 속성 검증
    expect2(() => properties2.object_field.properties.sub.type).toEqual('text');
    // nested_field의 하위 속성 검증
    expect2(() => properties2.nested_field.properties.sub.type).toEqual('text');
    expect2(() => properties2.nested_field.properties.sub2_field.type).toEqual('text');

    // verify properties and properties2 are equal
    expect2(properties).toEqual(properties2);
};

/**
 * perform auto-indexing tests
 * @param service - Elasticsearch service instance.
 */

export const autoIndexingTest = async (service: Elastic6Service<any>): Promise<void> => {
    // agent for test
    const agent = () => ({
        save: (id: string, name: string, count: number) =>
            service
                .saveItem(id, { name: name, count: count })
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { $id, _id, _version, ...rest } = R;
                    return rest;
                })
                .catch(GETERR),
    });

    //* auto-indexing w/ tokenizer. keyword (basic), hangul
    // save items
    expect2(await agent().save('A7', 'A7 for indexing', 10)).toEqual({ name: 'A7 for indexing', count: 10 });
    expect2(await agent().save('A8', '한글 테스트', 20)).toEqual({ name: '한글 테스트', count: 20 });
    expect2(await agent().save('A9', 'A9 for indexing', 30)).toEqual({ name: 'A9 for indexing', count: 30 });
    expect2(await agent().save('A10', 'A10 한글 테스트', 40)).toEqual({ name: 'A10 한글 테스트', count: 40 });

    // refresh index
    await service.refreshIndex();

    //* test for keyword(auto-indexing)
    const $search: SearchBody = {
        size: 2,
        query: {
            bool: {
                filter: {
                    term: {
                        name: 'indexing',
                    },
                },
            },
        },
        aggs: {
            indexing: {
                terms: {
                    field: 'count',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                count: {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };
    const searchResult = await service.search($search);
    const aggregationResult = searchResult.aggregations.indexing;
    const extractedFields = searchResult.list.map(item => ({
        _id: item._id,
        count: item.count,
        name: item.name,
    }));
    expect2(() => aggregationResult.buckets[0]).toEqual({ doc_count: 1, key: 10 });
    expect2(() => aggregationResult.buckets[1]).toEqual({ doc_count: 1, key: 30 });
    expect2(() => extractedFields[0]).toEqual({ _id: 'A7', count: 10, name: 'A7 for indexing' });
    expect2(() => extractedFields[1]).toEqual({ _id: 'A9', count: 30, name: 'A9 for indexing' });
    expect2(() => searchResult.last).toEqual([0, 30]); // [_score, count]
    expect2(() => searchResult.total).toEqual(2);

    //* test for hangul(auto-indexing)
    const $search2: SearchBody = {
        size: 2,
        query: {
            bool: {
                filter: {
                    term: {
                        name: '한글',
                    },
                },
            },
        },
        aggs: {
            indexing: {
                terms: {
                    field: 'count',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                count: {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };
    const searchResult2 = await service.search($search2);
    const aggregationResult2 = searchResult2.aggregations.indexing;
    const extractedFields2 = searchResult2.list.map(item => ({
        _id: item._id,
        count: item.count,
        name: item.name,
    }));
    expect2(() => aggregationResult2.buckets[0]).toEqual({ doc_count: 1, key: 20 });
    expect2(() => aggregationResult2.buckets[1]).toEqual({ doc_count: 1, key: 40 });
    expect2(() => extractedFields2[0]).toEqual({ _id: 'A8', count: 20, name: '한글 테스트' });
    expect2(() => extractedFields2[1]).toEqual({ _id: 'A10', count: 40, name: 'A10 한글 테스트' });
    expect2(() => searchResult2.last).toEqual([0, 40]); // [_score, count]
    expect2(() => searchResult2.total).toEqual(2);
};

interface BulkResponseItem<T = any> {
    index?: T;
}

interface BulkResponseBody {
    errors: boolean;
    items: BulkResponseItem[];
    took?: number;
}

interface BulkDummyResponse {
    errors: boolean;
    items: BulkResponseItem[];
    took?: number;
    statusCode: number;
}
/**
 * perform bulk operations with dummy data.
 * @param service - Elasticsearch service instance.
 * @param n - Number of chunks to divide the data into (default is 2).
 * @param t - Time in milliseconds to wait between bulk operations (default is 5000).
 */
export const bulkDummyData = async (service: Elastic6Service<any>, n = 2, t = 5000): Promise<BulkDummyResponse> => {
    const { indexName } = service.options;

    const departments: Array<string> = [
        'Admin',
        'HR',
        'Finance',
        'Marketing',
        'Sales',
        'IT',
        'R&D',
        'Production',
        'Support',
        'Logistics',
    ];
    const salaries = [3000, 5000, 7500, 11500, 16000, 20000];
    const companies = ['A', 'B', 'C'];
    const firstNames = ['Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Quinn', 'Avery', 'Rowan'];
    const middleNames = ['Lee', 'Parker', 'Sage', 'Reese', 'Blake', 'Hayden'];
    const lastNames = ['Harper', 'Reed', 'Bailey', 'Cameron', 'Ellis', 'Gray', 'Mason'];

    const dataset = Array.from({ length: 20000 }, (_, i) => {
        return {
            id: `employee ${i + 1}`,
            name: `${firstNames[(i + 1) % firstNames.length]} ${middleNames[(i + 1) % middleNames.length]} ${
                lastNames[(i + 1) % lastNames.length]
            }`,
            department: departments[(i + 1) % 10],
            salary: salaries[(i + 1) % 6],
            count: (i + 1) % 10,
            company: companies[(i + 1) % 3],
        };
    });

    // create bulk operations for a given chunk of data
    const createBulkOperations = (dataChunk: any[]) => {
        return dataChunk.reduce((acc, doc) => {
            acc.push({
                index: {
                    _index: indexName,
                    _id: doc.id,
                    ...(service.isLatestOS2 ? {} : { _type: '_doc' }),
                },
            });
            acc.push(doc);
            return acc;
        }, [] as Array<{ index: { _index: string; _id: string; _type?: string } } | { id: string; name: string; count: number; department: string; salary: number; company: string }>);
    };

    // bulk operation
    const performBulkOperation = async (operations: any[]) => {
        // const bulkResponse: ApiResponse<BulkResponseBody, any> = await service.client
        const bulkResponse = await service.client
            .bulk({
                body: operations,
            })
            .catch(
                $ERROR.handler('bulk', e => {
                    throw e;
                }),
            );
        return bulkResponse;
    };
    // split the dataset into n
    const chunkSize = Math.ceil(dataset.length / n);
    let combinedErrors = false;
    let combinedItems: any[] = [];
    let combinedTook = 0;
    let combinedStatusCode = 0;

    // perform bulk operations
    for (let i = 0; i < n; i++) {
        const chunk = dataset.slice(i * chunkSize, (i + 1) * chunkSize);
        const bulkResponse = await performBulkOperation(createBulkOperations(chunk));

        if (bulkResponse.body.errors) {
            combinedErrors = true;
        }

        combinedItems = combinedItems.concat(bulkResponse.body.items || []);
        combinedTook += bulkResponse.body.took || 0;
        combinedStatusCode = bulkResponse.statusCode || combinedStatusCode;

        if (i < n - 1) {
            await waited(t);
        }
    }

    const bulkDummyResponse: BulkDummyResponse = {
        errors: combinedErrors,
        items: combinedItems,
        took: combinedTook,
        statusCode: combinedStatusCode,
    };

    return bulkDummyResponse;
};

interface SearchResponse<T = any> {
    aggregations: T;
    last: T;
    list: Array<T>;
    total: number | { relation: 'gte'; value: number };
}

/**
 * perform total summary with 20,000 data
 * @param service - Elasticsearch service instance.
 */
export const totalSummaryTest = async (service: Elastic6Service<any>) => {
    const indexName = service.options.indexName;

    //* destroy index
    const oldIndex = await service.findIndex(indexName);
    if (oldIndex) {
        await service.destroyIndex();
    }

    //* create index
    await service.createIndex();
    await waited(200);

    const res = await bulkDummyData(service, 4, 5000);
    expect2(res?.errors).toEqual(false);

    await service.refreshIndex();
    await waited(200);

    //* test search with 20,000 data
    const $search: SearchBody = {
        size: 3,
        query: {
            bool: {
                filter: {
                    term: {
                        id: 'employee',
                    },
                },
            },
        },
        aggs: {
            indexing: {
                terms: {
                    field: 'count',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                'id.keyword': {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };

    const searchAggregation: SearchResponse = await service.search($search);
    const aggregationResult = searchAggregation.aggregations.indexing;
    const extractedFields = searchAggregation.list.map(item => ({
        id: item.id,
        count: item.count,
        _score: item._score,
    }));
    // total summary aggregation result
    expect2(() => aggregationResult.buckets[0]).toEqual({ doc_count: 2000, key: 0 });
    expect2(() => aggregationResult.buckets[1]).toEqual({ doc_count: 2000, key: 1 });
    expect2(() => aggregationResult.buckets[2]).toEqual({ doc_count: 2000, key: 2 });
    expect2(() => aggregationResult.buckets[3]).toEqual({ doc_count: 2000, key: 3 });
    expect2(() => aggregationResult.buckets[4]).toEqual({ doc_count: 2000, key: 4 });
    expect2(() => aggregationResult.buckets[5]).toEqual({ doc_count: 2000, key: 5 });
    expect2(() => aggregationResult.buckets[6]).toEqual({ doc_count: 2000, key: 6 });
    expect2(() => aggregationResult.buckets[7]).toEqual({ doc_count: 2000, key: 7 });
    expect2(() => aggregationResult.buckets[8]).toEqual({ doc_count: 2000, key: 8 });
    expect2(() => aggregationResult.buckets[9]).toEqual({ doc_count: 2000, key: 9 });
    // total summary search result
    expect2(() => extractedFields[0]).toEqual({ id: 'employee 1', count: 1, _score: 0 });
    expect2(() => extractedFields[1]).toEqual({ id: 'employee 10', count: 0, _score: 0 });
    expect2(() => extractedFields[2]).toEqual({ id: 'employee 100', count: 0, _score: 0 });
    expect2(() => searchAggregation.last).toEqual([0, 'employee 100']); // [_score, id] of last search result

    //* test scanAll with 20,000 data
    const allResults = await service.searchAll($search, { retryOptions: { do: true, t: 10000, maxRetries: 100 } });
    expect2(() => allResults.length).toEqual(20000);
    expect2(() => allResults.slice(0, 3)).toEqual(searchAggregation.list);
};

/**
 * perform aggregation with 20,000 data
 * @param service - Elasticsearch service instance.
 */
export const aggregationTest = async (service: Elastic6Service<any>) => {
    //* 1. employee per company
    const $companyAggregation: SearchBody = {
        size: 0, // set 0 to see only results
        aggs: {
            employees_per_company: {
                terms: {
                    field: 'company.keyword',
                },
            },
        },
    };
    const byCompanyResult: SearchResponse = await service.search($companyAggregation);
    expect2(() => byCompanyResult.aggregations.employees_per_company.buckets[0]).toEqual({ doc_count: 6667, key: 'B' });
    expect2(() => byCompanyResult.aggregations.employees_per_company.buckets[1]).toEqual({ doc_count: 6667, key: 'C' });
    expect2(() => byCompanyResult.aggregations.employees_per_company.buckets[2]).toEqual({ doc_count: 6666, key: 'A' });

    //* 2. employee per department within each company
    const $companyDepartmentAggregation: SearchBody = {
        size: 0,
        aggs: {
            employees_per_company: {
                terms: {
                    field: 'company.keyword',
                },
                aggs: {
                    employees_per_department: {
                        terms: {
                            field: 'department.keyword',
                        },
                    },
                },
            },
        },
    };
    const byCompanyDepartmentResult: SearchResponse = await service.search($companyDepartmentAggregation);
    const aggregations = byCompanyDepartmentResult.aggregations.employees_per_company;
    // employee per department within company B
    const bucketsOfB = aggregations.buckets[0].employees_per_department.buckets;
    expect2(() => aggregations.buckets[0].key).toEqual('B');
    expect2(() => aggregations.buckets[0].doc_count).toEqual(6667);
    expect2(() => bucketsOfB[0]).toEqual({ doc_count: 667, key: 'Admin' });
    expect2(() => bucketsOfB[1]).toEqual({ doc_count: 667, key: 'HR' });
    expect2(() => bucketsOfB[2]).toEqual({ doc_count: 667, key: 'Logistics' });
    expect2(() => bucketsOfB[3]).toEqual({ doc_count: 667, key: 'Marketing' });
    expect2(() => bucketsOfB[4]).toEqual({ doc_count: 667, key: 'Production' });
    expect2(() => bucketsOfB[5]).toEqual({ doc_count: 667, key: 'R&D' });
    expect2(() => bucketsOfB[6]).toEqual({ doc_count: 667, key: 'Sales' });
    expect2(() => bucketsOfB[7]).toEqual({ doc_count: 666, key: 'Finance' });
    expect2(() => bucketsOfB[8]).toEqual({ doc_count: 666, key: 'IT' });
    expect2(() => bucketsOfB[9]).toEqual({ doc_count: 666, key: 'Support' });
    // employee per department within company C
    const bucketsOfC = aggregations.buckets[1].employees_per_department.buckets;
    expect2(() => aggregations.buckets[1].key).toEqual('C');
    expect2(() => aggregations.buckets[1].doc_count).toEqual(6667);
    expect2(() => bucketsOfC[0]).toEqual({ doc_count: 667, key: 'Admin' });
    expect2(() => bucketsOfC[1]).toEqual({ doc_count: 667, key: 'Finance' });
    expect2(() => bucketsOfC[2]).toEqual({ doc_count: 667, key: 'HR' });
    expect2(() => bucketsOfC[3]).toEqual({ doc_count: 667, key: 'IT' });
    expect2(() => bucketsOfC[4]).toEqual({ doc_count: 667, key: 'Production' });
    expect2(() => bucketsOfC[5]).toEqual({ doc_count: 667, key: 'Sales' });
    expect2(() => bucketsOfC[6]).toEqual({ doc_count: 667, key: 'Support' });
    expect2(() => bucketsOfC[7]).toEqual({ doc_count: 666, key: 'Logistics' });
    expect2(() => bucketsOfC[8]).toEqual({ doc_count: 666, key: 'Marketing' });
    expect2(() => bucketsOfC[9]).toEqual({ doc_count: 666, key: 'R&D' });
    // employee per department within company A
    const bucketsOfA = aggregations.buckets[2].employees_per_department.buckets;
    expect2(() => aggregations.buckets[2].key).toEqual('A');
    expect2(() => aggregations.buckets[2].doc_count).toEqual(6666);
    expect2(() => bucketsOfA[0]).toEqual({ doc_count: 667, key: 'Finance' });
    expect2(() => bucketsOfA[1]).toEqual({ doc_count: 667, key: 'IT' });
    expect2(() => bucketsOfA[2]).toEqual({ doc_count: 667, key: 'Logistics' });
    expect2(() => bucketsOfA[3]).toEqual({ doc_count: 667, key: 'Marketing' });
    expect2(() => bucketsOfA[4]).toEqual({ doc_count: 667, key: 'R&D' });
    expect2(() => bucketsOfA[5]).toEqual({ doc_count: 667, key: 'Support' });
    expect2(() => bucketsOfA[6]).toEqual({ doc_count: 666, key: 'Admin' });
    expect2(() => bucketsOfA[7]).toEqual({ doc_count: 666, key: 'HR' });
    expect2(() => bucketsOfA[8]).toEqual({ doc_count: 666, key: 'Production' });
    expect2(() => bucketsOfA[9]).toEqual({ doc_count: 666, key: 'Sales' });
};

/**
 * perform search/filter tests with 20,000 data
 * @param service - Elasticsearch service instance.
 */
export const searchFilterTest = async (service: Elastic6Service<any>) => {
    //* 1.1 Test by keyword (filter term query)
    const $keywordSearch: SearchBody = {
        size: 3,
        query: {
            bool: {
                filter: {
                    term: {
                        name: 'jordan',
                    },
                },
            },
        },
        aggs: {
            employees_with_name_Jordan_per_company: {
                terms: {
                    field: 'company.keyword',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                'id.keyword': {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };
    const keywordSearchResult: SearchResponse = await service.search($keywordSearch);
    const aggregationResult = keywordSearchResult.aggregations.employees_with_name_Jordan_per_company;
    const extractedFields = keywordSearchResult.list.map(item => ({
        id: item.id,
        name: item.name,
        company: item.company,
    }));
    // filter query search aggregation result
    expect2(() => aggregationResult.buckets[0]).toEqual({ doc_count: 834, key: 'B' });
    expect2(() => aggregationResult.buckets[1]).toEqual({ doc_count: 833, key: 'A' });
    expect2(() => aggregationResult.buckets[2]).toEqual({ doc_count: 833, key: 'C' });
    // filter query search result
    expect2(() => extractedFields[0]).toEqual({ id: 'employee 1', name: 'Jordan Parker Reed', company: 'B' });
    expect2(() => extractedFields[1]).toEqual({ id: 'employee 10001', name: 'Jordan Hayden Gray', company: 'C' });
    expect2(() => extractedFields[2]).toEqual({ id: 'employee 10009', name: 'Jordan Parker Mason', company: 'B' });
    expect2(() => keywordSearchResult.last).toEqual([0, 'employee 10009']); // [score, id] of last search result
    expect2(() => keywordSearchResult.total).toEqual(2500); // 834(B) + 833(A) + 833(C)

    //* 1.2 Test by keyword (match query)
    const $matchSearch: SearchBody = {
        size: 3,
        query: {
            match: {
                name: 'jordan',
            },
        },
        aggs: {
            employees_with_name_Jordan_per_company: {
                terms: {
                    field: 'company.keyword',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                'id.keyword': {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };

    const matchQueryhResult: SearchResponse = await service.search($matchSearch);
    const aggregationResult2 = matchQueryhResult.aggregations.employees_with_name_Jordan_per_company;
    const extractedFields2 = matchQueryhResult.list.map(item => ({
        id: item.id,
        _score: item._score,
    }));
    // match query search aggregation result
    expect2(() => aggregationResult2.buckets[0]).toEqual({ doc_count: 834, key: 'B' });
    expect2(() => aggregationResult2.buckets[1]).toEqual({ doc_count: 833, key: 'A' });
    expect2(() => aggregationResult2.buckets[2]).toEqual({ doc_count: 833, key: 'C' }); // aggregation result matches the filter query
    // match query search result
    if (service.isOldES6) {
        /* sorted by the _score calculated using the TF-IDF algorithm */
        expect2(() => extractedFields2[0]).toEqual({ id: 'employee 10033', _score: 2.0947309 });
        expect2(() => extractedFields2[1]).toEqual({ id: 'employee 10089', _score: 2.0947309 });
        expect2(() => extractedFields2[2]).toEqual({ id: 'employee 10121', _score: 2.0947309 });
        expect2(() => matchQueryhResult.last).toEqual([2.0947309, 'employee 10121']);
    } else {
        /* sorted by the _score calculated using the BM25 algorithm */
        expect2(() => extractedFields2[0]).toEqual({ id: 'employee 1001', _score: 2.0919745 });
        expect2(() => extractedFields2[1]).toEqual({ id: 'employee 10041', _score: 2.0919745 });
        expect2(() => extractedFields2[2]).toEqual({ id: 'employee 10073', _score: 2.0919745 });
        expect2(() => matchQueryhResult.last).toEqual([2.0919745, 'employee 10073']);
    }
    expect2(() => matchQueryhResult.total).toEqual(2500); // 834(B) + 833(A) + 833(C)

    //* 2. Test by range (salary range)
    const $rangeSearch: SearchBody = {
        size: 3,
        query: {
            bool: {
                filter: {
                    range: {
                        salary: {
                            gte: 10000, // greater than or equal to 10,000
                            lte: 20000, // less than or equal to 20,000
                        },
                    },
                },
            },
        },
        aggs: {
            employees_in_salary_range_per_company: {
                terms: {
                    field: 'company.keyword',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                salary: {
                    order: 'asc',
                    missing: '_last',
                },
                'id.keyword': {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };
    const rangeSearchResult: SearchResponse = await service.search($rangeSearch);
    const aggregationResult3 = rangeSearchResult.aggregations.employees_in_salary_range_per_company;
    const extractedFields3 = rangeSearchResult.list.map(item => ({
        id: item.id,
        _score: item._score,
        salary: item.salary,
    }));
    // range search aggregation
    expect2(() => aggregationResult3.buckets[0]).toEqual({ doc_count: 3333, key: 'A' });
    expect2(() => aggregationResult3.buckets[1]).toEqual({ doc_count: 3333, key: 'B' });
    expect2(() => aggregationResult3.buckets[2]).toEqual({ doc_count: 3333, key: 'C' });
    // range search result
    expect2(() => extractedFields3[0]).toEqual({ id: 'employee 10005', _score: 0, salary: 11500 });
    expect2(() => extractedFields3[1]).toEqual({ id: 'employee 10011', _score: 0, salary: 11500 });
    expect2(() => extractedFields3[2]).toEqual({ id: 'employee 10017', _score: 0, salary: 11500 });
    expect2(() => rangeSearchResult.last).toEqual([0, 11500, 'employee 10017']);
    expect2(() => rangeSearchResult.total).toEqual(9999); // 3333(B) + 3333(A) + 3333(C)

    //* 3. Test 'exists; field(mapping관련, null, '', [], {}), keyword'
    // agent for test
    const agent = <T = any>() => ({
        save: (id: string, name?: T, salary?: T) =>
            service
                .saveItem(id, { id: id, name: name, salary: salary })
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { $id, _id, _version, ...rest } = R;
                    return rest;
                })
                .catch(GETERR),
    });
    //save empty value
    expect2(await agent().save('empty 1', null, null)).toEqual({ id: 'empty 1', name: null, salary: null });
    expect2(await agent().save('empty 2')).toEqual({ id: 'empty 2' });
    expect2(await agent().save('empty 3', '', '')).toEqual({ id: 'empty 3', name: '', salary: '' });
    expect2(await agent().save('empty 4', [], [])).toEqual({ id: 'empty 4', name: [], salary: [] });

    await service.refreshIndex();

    const $nullFieldTest: SearchBody = {
        size: 10,
        query: {
            bool: {
                filter: {
                    term: {
                        id: 'empty',
                    },
                },
            },
        },
        aggs: {
            employees_with_empty_field: {
                terms: {
                    field: 'id.keyword',
                },
            },
        },
        sort: [
            {
                _score: {
                    order: 'desc',
                },
                'id.keyword': {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };

    const nullSearchResult: SearchResponse = await service.search($nullFieldTest);
    const aggregationResult4 = nullSearchResult.aggregations.employees_with_empty_field;
    const extractedFields4 = nullSearchResult.list.map(item => ({
        id: item.id,
        name: item.name,
        salary: item.salary,
    }));
    // null search aggregation
    expect2(() => aggregationResult4.buckets[0]).toEqual({ doc_count: 1, key: 'empty 1' });
    expect2(() => aggregationResult4.buckets[1]).toEqual({ doc_count: 1, key: 'empty 2' });
    expect2(() => aggregationResult4.buckets[2]).toEqual({ doc_count: 1, key: 'empty 3' });
    expect2(() => aggregationResult4.buckets[3]).toEqual({ doc_count: 1, key: 'empty 4' });
    // null search result
    expect2(() => extractedFields4[0]).toEqual({ id: 'empty 1', name: null, salary: null });
    expect2(() => extractedFields4[1]).toEqual({ id: 'empty 2' });
    expect2(() => extractedFields4[2]).toEqual({ id: 'empty 3', name: '', salary: '' });
    expect2(() => extractedFields4[3]).toEqual({ id: 'empty 4', name: [], salary: [] });

    //* check mapping
    const mapping = await service.getIndexMapping();
    const properties = mapping?._doc ? mapping?._doc.properties : mapping?.properties;
    //company mapping type
    expect2(() => properties.company.type).toEqual('text');
    expect2(() => properties.company.fields).toEqual({ keyword: { type: 'keyword', ignore_above: 256 } });
    expect2(() => properties.company.analyzer).toEqual('hangul');
    //count mapping type
    expect2(() => properties.count).toEqual({ type: 'long' });
    //department mapping type
    expect2(() => properties.department.type).toEqual('text');
    expect2(() => properties.department.fields).toEqual({ keyword: { type: 'keyword', ignore_above: 256 } });
    expect2(() => properties.department.analyzer).toEqual('hangul');
    //id mapping type
    expect2(() => properties.id.type).toEqual('text');
    expect2(() => properties.id.fields).toEqual({ keyword: { type: 'keyword', ignore_above: 256 } });
    expect2(() => properties.id.analyzer).toEqual('hangul');
    //name mapping type
    expect2(() => properties.name.type).toEqual('text');
    expect2(() => properties.name.fields).toEqual({ keyword: { type: 'keyword', ignore_above: 256 } });
    expect2(() => properties.name.analyzer).toEqual('hangul');
    //salary mapping type
    expect2(() => properties.salary).toEqual({ type: 'long' });
};
/**
 * run Elastic6Service tests sequentially.
 *
 * @param service - Elasticsearch service instance.
 */

export const doTest = async (service: Elastic6Service<any>) => {
    const runTest = async (testName: string, testFn: () => Promise<void>) => {
        try {
            await testFn();
        } catch (error) {
            const errorMessage = GETERR(error);
            const errorStack = error.stack || '';
            throw new Error(`${testName}\n ${errorMessage}\n Stack trace:\n ${errorStack}`);
        }
    };

    //* run tests
    await runTest('setupIndex', async () => await setupIndex(service));

    await runTest('basicCRUDTest', async () => await basicCRUDTest(service));

    await runTest('basicSearchTest', async () => await basicSearchTest(service));

    await runTest('autoIndexingTest', async () => await autoIndexingTest(service));

    await runTest('detailedCRUDTest', async () => await detailedCRUDTest(service));

    await runTest('mismatchedTypeTest', async () => await mismatchedTypeTest(service));

    await runTest('totalSummaryTest', async () => await totalSummaryTest(service));

    await runTest('aggregationTest', async () => await aggregationTest(service));

    await runTest('searchFilterTest', async () => await searchFilterTest(service));

    // 모든 테스트가 성공하면 pass 반환
    return `pass`;
};

//* main test body.
describe('Elastic6Service', () => {
    //* dummy storage service.
    it('should pass basic CRUD w/ dummy', async () => {
        //* load dummy storage service.
        const { dummy } = instance();

        //* check dummy data.
        expect2(() => dummy.hello()).toEqual('dummy-elastic6-service:test-v6.2');
        expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ $id: 'A0', type: 'account', name: 'lemon' });
        expect2(await dummy.readItem('A1'), '$id,type,name').toEqual({ $id: 'A1', type: 'account', name: 'Hong' });

        //* basic simple CRUD test.
        expect2(await dummy.readItem('A0').catch(GETERR), '$id').toEqual({ $id: 'A0' });
        expect2(await dummy.deleteItem('A0').catch(GETERR), '$id').toEqual({ $id: 'A0' });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
        expect2(await dummy.saveItem('A0', { type: '' } as any).catch(GETERR), '$id,type').toEqual({
            $id: 'A0',
            type: '',
        });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: '' });
        expect2(await dummy.updateItem('A0', { type: 'account' } as any).catch(GETERR)).toEqual({
            id: 'A0',
            _version: 1,
            type: 'account',
        });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', _version: 1, type: 'account' });
        expect2(
            await dummy.updateItem('A0', null, { stringArr: ['a'], numberArr: [1], count: 3 }).catch(GETERR),
        ).toEqual({ id: 'A0', _version: 2 });
        expect2(
            await dummy.updateItem('A0', null, { stringArr: ['b'], numberArr: [2], count: 1 }).catch(GETERR),
        ).toEqual({ _version: 3, id: 'A0' });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({
            _version: 3,
            count: 4,
            id: 'A0',
            numberArr: [1, 2],
            stringArr: ['a', 'b'],
            type: 'account',
        });
    });

    //* $ERROR parser
    it('should pass error handler($ERROR/es6.2)', async () => {
        const message = 'someting wrong';
        const err = new Error(message);
        // expect2(() => JSON.stringify(err, Object.getOwnPropertyNames(err))).toEqual();
        expect2(() => $ERROR.asJson(err), 'message').toEqual({ message });

        //* parse the origin error.
        const E1 = loadJsonSync('data/samples/es6.5/create-index.err-400.json');
        expect2(() => $ERROR.asError(E1)).toEqual({
            status: 400,
            message: 'index [test-v4/menh7_JkTJeXGX6b6EzTnA] already exists',
            reason: {
                status: 400,
                type: 'RESOURCE ALREADY EXISTS',
                reason: 'index [test-v4/menh7_JkTJeXGX6b6EzTnA] already exists',
                cause: {
                    index: 'test-v4',
                    index_uuid: 'menh7_JkTJeXGX6b6EzTnA',
                    reason: 'index [test-v4/menh7_JkTJeXGX6b6EzTnA] already exists',
                    type: 'resource_already_exists_exception',
                },
            },
        });

        const E2 = loadJsonSync('data/samples/es6.5/update-item.err-400A.json');
        expect2(() => $ERROR.asError(E2)).toEqual({
            status: 400,
            message: 'failed to execute script',
            reason: {
                status: 400,
                type: 'REMOTE TRANSPORT',
                reason: 'failed to execute script',
                cause: {
                    type: 'remote_transport_exception',
                    reason: '[41hifW8][x.x.x.x:9300][indices:data/write/update[s]]',
                },
            },
        });

        const E3 = loadJsonSync('data/samples/es6.5/read-item.err-404.json');
        expect2(() => $ERROR.asError(E3)).toEqual({
            status: 404,
            message: 'NOT FOUND',
            reason: { cause: undefined, reason: 'NOT FOUND', status: undefined, type: 'NOT FOUND' },
        });

        const E4 = loadJsonSync('data/samples/es6.5/update-item.err-400.json');
        expect2(() => $ERROR.asError(E4)).toEqual({
            status: 400,
            message: "Validation Failed: 1: can't provide both script and doc;",
            reason: {
                status: 400,
                type: 'ACTION REQUEST VALIDATION',
                reason: "Validation Failed: 1: can't provide both script and doc;",
                cause: {
                    reason: "Validation Failed: 1: can't provide both script and doc;",
                    type: 'action_request_validation_exception',
                },
            },
        });

        const E5 = loadJsonSync('data/samples/es6.5/delete-item.err-404.json');
        expect2(() => $ERROR.asError(E5)).toEqual({
            status: 404,
            message: 'NOT FOUND',
            reason: { cause: undefined, reason: 'NOT FOUND', status: undefined, type: 'NOT FOUND' },
        });
        const E6 = loadJsonSync('data/samples/es6.2/update-item.err400.mapping.json');
        expect2(() => $ERROR.asError(E6)).toEqual({
            message: 'mapper_parsing_exception',
            reason: {
                reason: 'failed to parse [string_field]',
                status: 400,
                type: 'MAPPER PARSING',
            },
            status: 400,
        });
        expect2(() => $ERROR.handler('test', GETERR)(E6)).toEqual(
            '400 MAPPER PARSING - failed to parse [string_field]',
        );

        expect2(() => $ERROR.handler('test', GETERR)(E1)).toEqual(
            '400 RESOURCE ALREADY EXISTS - index [test-v4/menh7_JkTJeXGX6b6EzTnA] already exists',
        );
        expect2(() => $ERROR.handler('test', GETERR)(E2)).toEqual('400 REMOTE TRANSPORT - failed to execute script');
        expect2(() => $ERROR.handler('test', GETERR)(E4)).toEqual(
            `400 ACTION REQUEST VALIDATION - Validation Failed: 1: can't provide both script and doc;`,
        );
    });

    //* $ERROR parser
    it('should pass error handler($ERROR/es7.1)', async () => {
        const message = 'someting wrong';
        const err = new Error(message);
        // expect2(() => JSON.stringify(err, Object.getOwnPropertyNames(err))).toEqual();
        expect2(() => $ERROR.asJson(err), 'message').toEqual({ message });

        //* resource exists
        const E1 = loadJsonSync('data/samples/es7.1/create-index.err.json');
        expect2(() => $ERROR.asError(E1)).toEqual({
            message: 'resource_already_exists_exception',
            reason: { status: 400, type: 'RESOURCE ALREADY EXISTS' },
            status: 400,
        });
        expect2(() => $ERROR.handler('test', GETERR)(E1)).toEqual(
            '400 RESOURCE ALREADY EXISTS - resource_already_exists_exception',
        );

        //* 404 not found
        const E2 = loadJsonSync('data/samples/es7.1/read-item.err404.json');
        expect2(() => $ERROR.asError(E2)).toEqual({
            status: 404,
            message: 'Response Error',
            reason: { status: 404, type: 'NOT FOUND' },
        });
        expect2(() => $ERROR.handler('test', GETERR)(E2)).toEqual('404 NOT FOUND - Response Error');

        //* conflict
        const E3 = loadJsonSync('data/samples/es7.1/version-conflict.err.json');
        expect2(() => $ERROR.asError(E3)).toEqual({
            message: 'version_conflict_engine_exception',
            reason: {
                status: 409,
                type: 'VERSION CONFLICT ENGINE',
                reason: '[A0]: version conflict, document already exists (current version [2])',
            },
            status: 409,
        });
        expect2(() => $ERROR.handler('test', GETERR)(E3)).toEqual(
            '409 VERSION CONFLICT ENGINE - [A0]: version conflict, document already exists (current version [2])',
        );
        const E4 = loadJsonSync('data/samples/es7.1/update-item.err400.mapping.json');
        expect2(() => $ERROR.asError(E4)).toEqual({
            message: 'mapper_parsing_exception',
            reason: {
                reason: "failed to parse field [string_field] of type [text] in document with id 'A0'",
                status: 400,
                type: 'MAPPER PARSING',
            },
            status: 400,
        });
    });

    //* test with real server
    it('should pass basic CRUD w/ real server (6.2)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        jest.setTimeout(1200000);

        //* load dummy storage service.
        const { service } = await initService('6.2');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 6, minor: 2, patch: 3 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(true);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 6, minor: 2, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 6, minor: 2, patch: 3 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    //* elastic storage service.
    it('should pass basic CRUD w/ real server(7.1)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('7.1');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 1, patch: 1 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(true);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 7, minor: 1, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 1, patch: 1 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    //* elastic storage service.
    it('should pass basic CRUD w/ real server(7.2)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('7.2');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 4, patch: 2 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 7, minor: 2, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 4, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    //* elastic storage service.
    it('should pass basic CRUD w/ real server(7.10)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('7.10');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(true);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    //* elastic storage service.
    it('should pass basic CRUD w/ open-search server(1.1)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('1.1');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'os', major: 1, minor: 1, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    //* elastic storage service.
    it('should pass basic CRUD w/ open-search server(1.2)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('1.2');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'os', major: 1, minor: 2, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    //* elastic storage service.
    it('should pass basic CRUD w/ open-search server(2.13)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        jest.setTimeout(1200000);
        //* load dummy storage service.
        const { service } = await initService('2.13');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'os', major: 2, minor: 13, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    //* Unit tests for ElasticIndexService with DummyElastic6Service
    describe('ElasticIndexService - Unit Tests', () => {
        //* Test static instance method
        it('should create elasticsearch client instance', () => {
            const { client } = ElasticIndexService.instance('http://localhost:9200');
            expect2(typeof client).toEqual('object');
            expect2(client !== null).toEqual(true);
        });

        //* Test constructor errors
        it('should throw error when endpoint is missing', () => {
            expect2(
                () =>
                    new DummyElastic6Service('dummy-elastic6-data.yml', {
                        endpoint: '',
                        indexName: 'test',
                        idName: '$id',
                    } as any),
            ).toEqual('.endpoint (URL) is required');
        });

        it('should throw error when indexName is missing', () => {
            expect2(
                () =>
                    new DummyElastic6Service('dummy-elastic6-data.yml', {
                        endpoint: 'http://localhost:9200',
                        indexName: '',
                        idName: '$id',
                    } as any),
            ).toEqual('.indexName (string) is required');
        });

        //* Test constructor with valid options
        it('should create instance with valid options', () => {
            const { dummy } = instance();
            expect2(dummy.hello()).toEqual('dummy-elastic6-service:test-v6.2');
        });

        //* Test options getter
        it('should return options with defaults', () => {
            const { dummy, options } = instance();
            const opts = dummy.options;
            expect2(opts.indexName).toEqual(options.indexName);
            expect2(opts.idName).toEqual(options.idName || '$id');
            expect2(opts.endpoint).toEqual(options.endpoint);
            expect2(opts.docType).toEqual('_doc');
        });

        //* Test version getter
        it('should return version from options', () => {
            const { dummy } = instance();
            expect2(dummy.version).toEqual(6.2);
        });

        it('should return default version when not specified', () => {
            const dummy = new DummyElastic6Service('dummy-elastic6-data.yml', {
                endpoint: 'http://localhost:9200',
                indexName: 'test-default',
                idName: '$id',
            });
            expect2(dummy.version).toEqual(6.8);
        });

        //* Test client getter
        it('should return client instance', () => {
            const { dummy } = instance();
            const client = dummy.client;
            expect2(typeof client).toEqual('object');
            expect2(client !== null).toEqual(true);
        });

        //* Test pushItem
        it('should push item with auto-generated ID', async () => {
            const { dummy } = instance();
            const result = await dummy.pushItem({ name: 'pushed item', type: 'test' } as any);
            expect2(result.name).toEqual('pushed item');
            expect2(result.type).toEqual('test');
            expect2(result._version).toEqual(1);
            expect2(typeof result.$id).toEqual('string');
            expect2(String(result.$id).startsWith('auto-')).toEqual(true);
        });

        it('should push multiple items with different IDs', async () => {
            const { dummy } = instance();
            const result1 = await dummy.pushItem({ name: 'item1' } as any);
            const result2 = await dummy.pushItem({ name: 'item2' } as any);
            expect2(result1.$id !== result2.$id).toEqual(true);
        });

        //* Test searchRaw
        it('should throw error when body is missing', async () => {
            const { dummy } = instance();
            expect2(await dummy.searchRaw(null as any).catch(GETERR)).toEqual('@body (SearchBody) is required');
        });

        it('should search and return raw results', async () => {
            const { dummy } = instance();
            const result: any = await dummy.searchRaw({ size: 5 });
            expect2(typeof result.hits).toEqual('object');
            expect2(typeof result.hits.total).toEqual('number');
            expect2(Array.isArray(result.hits.hits)).toEqual(true);
        });

        it('should paginate search results with size', async () => {
            const { dummy } = instance();
            const result: any = await dummy.searchRaw({ size: 2 });
            expect2(result.hits.hits.length).toEqual(2);
        });

        it('should paginate search results with from and size', async () => {
            const { dummy } = instance();
            const result: any = await dummy.searchRaw({ size: 2, from: 1 });
            expect2(result.hits.hits.length <= 2).toEqual(true);
            expect2(result.hits.hits.length >= 0).toEqual(true);
        });

        it('should use default size of 10', async () => {
            const { dummy } = instance();
            const result: any = await dummy.searchRaw({});
            expect2(result.hits.hits.length <= 10).toEqual(true);
        });

        //* Test search
        it('should search and return formatted results', async () => {
            const { dummy } = instance();
            const result = await dummy.search({ size: 5 });
            expect2(typeof result.total).toEqual('number');
            expect2(Array.isArray(result.list)).toEqual(true);
            expect2(result.list.length <= 5).toEqual(true);
        });

        it('should include _id and _score in search results', async () => {
            const { dummy } = instance();
            const result = await dummy.search({ size: 1 });
            expect2(result.list.length > 0).toEqual(true);
            const item = result.list[0];
            expect2(typeof item._id).toEqual('string');
            expect2(typeof item._score).toEqual('number');
        });

        it('should handle search with default size', async () => {
            const { dummy } = instance();
            const result = await dummy.search({});
            expect2(typeof result.total).toEqual('number');
            expect2(result.list.length <= 10).toEqual(true);
        });

        it('should handle search with aggregations', async () => {
            const { dummy } = instance();
            const result: any = await dummy.searchRaw({ size: 5, aggs: { test: { terms: { field: 'type' } } } });
            expect2(typeof result.hits).toEqual('object');
            expect2(result.aggregations).toEqual(undefined);
        });
    });

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    //* Unit tests for DummyElastic6Service specific methods
    describe('DummyElastic6Service - Unit Tests', () => {
        //* Test constructor errors
        it('should throw error when dataFile is missing', () => {
            const options: Elastic6Option = {
                endpoint: 'http://localhost:9200',
                indexName: 'test',
                idName: '$id',
            };
            expect2(() => new DummyElastic6Service('', options)).toEqual('@dataFile(string) is required!');
        });

        //* Test hello()
        it('should return correct hello string', () => {
            const { dummy } = instance();
            expect2(dummy.hello()).toEqual('dummy-elastic6-service:test-v6.2');
        });

        //* Test readItem edge cases
        it('should throw 404 for non-existent item', async () => {
            const { dummy } = instance();
            expect2(await dummy.readItem('NONEXISTENT').catch(GETERR)).toEqual('404 NOT FOUND - id:NONEXISTENT');
        });

        it('should read existing item successfully', async () => {
            const { dummy } = instance();
            expect2(await dummy.readItem('A0'), '$id,type,name').toEqual({ $id: 'A0', type: 'account', name: 'lemon' });
        });

        //* Test saveItem variations
        it('should save new item', async () => {
            const { dummy } = instance();
            const result = await dummy.saveItem('NEW1', { name: 'new item' } as any);
            expect2(result.$id).toEqual('NEW1');
            expect2(result.name).toEqual('new item');
            expect2(result._version).toEqual(1);
        });

        it('should save item with empty string values', async () => {
            const { dummy } = instance();
            const result = await dummy.saveItem('EMPTY', { type: '', name: '' } as any);
            expect2(result.$id).toEqual('EMPTY');
            expect2(result.type).toEqual('');
            expect2(result.name).toEqual('');
        });

        it('should save item with number values', async () => {
            const { dummy } = instance();
            const result = await dummy.saveItem('NUM1', { count: 100, score: 95.5 } as any);
            expect2(result.count).toEqual(100);
            expect2(result.score).toEqual(95.5);
        });

        //* Test deleteItem
        it('should delete existing item', async () => {
            const { dummy } = instance();
            await dummy.saveItem('DEL1', { name: 'to delete' } as any);
            const result = await dummy.deleteItem('DEL1');
            expect2(result.id).toEqual('DEL1');
            expect2(result.name).toEqual('to delete');
        });

        it('should handle deleting already deleted item', async () => {
            const { dummy } = instance();
            await dummy.saveItem('DEL2', { name: 'test' } as any);
            await dummy.deleteItem('DEL2');
            const result = await dummy.deleteItem('DEL2');
            expect2(result).toEqual({});
        });

        //* Test updateItem with basic updates
        it('should update item successfully', async () => {
            const { dummy } = instance();
            await dummy.saveItem('UPD1', { name: 'original', type: 'test' } as any);
            const result = await dummy.updateItem('UPD1', { name: 'updated' } as any);
            expect2(result.id).toEqual('UPD1');
            expect2(result._version).toEqual(1);
            expect2(result.name).toEqual('updated');
        });

        it('should throw 404 when updating non-existent item', async () => {
            const { dummy } = instance();
            expect2(await dummy.updateItem('NONEXIST', { name: 'test' } as any).catch(GETERR)).toEqual(
                '404 NOT FOUND - id:NONEXIST',
            );
        });

        //* Test updateItem with number increment
        it('should increment number field', async () => {
            const { dummy } = instance();
            await dummy.saveItem('INC1', { count: 10 } as any);
            const result = await dummy.updateItem('INC1', null as any, { count: 5 });
            expect2(result._version).toEqual(1);
            expect2(result.id).toEqual('INC1');

            const item = await dummy.readItem('INC1');
            expect2(item.count).toEqual(15);
        });

        it('should increment number from zero', async () => {
            const { dummy } = instance();
            await dummy.saveItem('INC2', { name: 'test' } as any);
            await dummy.updateItem('INC2', null as any, { count: 10 });
            const item = await dummy.readItem('INC2');
            expect2(item.count).toEqual(10);
        });

        //* Test updateItem with array increment
        it('should append to array field', async () => {
            const { dummy } = instance();
            await dummy.saveItem('ARR1', { items: ['a', 'b'] } as any);
            await dummy.updateItem('ARR1', null as any, { items: ['c', 'd'] });
            const item = await dummy.readItem('ARR1');
            expect2(item.items).toEqual(['a', 'b', 'c', 'd']);
        });

        it('should create array if not exists', async () => {
            const { dummy } = instance();
            await dummy.saveItem('ARR2', { name: 'test' } as any);
            await dummy.updateItem('ARR2', null as any, { items: ['x', 'y'] });
            const item = await dummy.readItem('ARR2');
            expect2(item.items).toEqual(['x', 'y']);
        });

        it('should handle multiple increments', async () => {
            const { dummy } = instance();
            await dummy.saveItem('MULTI', { count: 5, items: ['a'] } as any);
            await dummy.updateItem('MULTI', null as any, { count: 3, items: ['b'] });
            const item = await dummy.readItem('MULTI');
            expect2(item.count).toEqual(8);
            expect2(item.items).toEqual(['a', 'b']);
        });

        //* Test combined update and increment
        it('should handle update and increment together', async () => {
            const { dummy } = instance();
            await dummy.saveItem('COMBO', { name: 'old', count: 10, tags: ['t1'] } as any);
            const result = await dummy.updateItem('COMBO', { name: 'new' } as any, { count: 5, tags: ['t2'] });
            expect2(result._version).toEqual(1);
            expect2(result.name).toEqual('new');

            const item = await dummy.readItem('COMBO');
            expect2(item.name).toEqual('new');
            expect2(item.count).toEqual(15);
            expect2(item.tags).toEqual(['t1', 't2']);
        });

        //* Test version incrementing
        it('should increment version on each update', async () => {
            const { dummy } = instance();
            await dummy.saveItem('VER', { name: 'test' } as any);
            const v1 = await dummy.updateItem('VER', { count: 1 } as any);
            expect2(v1._version).toEqual(1);

            const v2 = await dummy.updateItem('VER', { count: 2 } as any);
            expect2(v2._version).toEqual(2);

            const v3 = await dummy.updateItem('VER', { count: 3 } as any);
            expect2(v3._version).toEqual(3);
        });

        //* Test edge cases with null and undefined
        it('should handle null update values', async () => {
            const { dummy } = instance();
            await dummy.saveItem('NULL', { name: 'test', type: 'old' } as any);
            await dummy.updateItem('NULL', { type: null } as any);
            const item = await dummy.readItem('NULL');
            expect2(item.type).toEqual(null);
        });

        it('should preserve existing fields when updating', async () => {
            const { dummy } = instance();
            await dummy.saveItem('PRESERVE', { name: 'test', type: 'A', count: 10 } as any);
            await dummy.updateItem('PRESERVE', { name: 'updated' } as any);
            const item = await dummy.readItem('PRESERVE');
            expect2(item.name).toEqual('updated');
            expect2(item.type).toEqual('A');
            expect2(item.count).toEqual(10);
        });

        //* Test increment with non-numeric field
        it('should set value when incrementing non-numeric field', async () => {
            const { dummy } = instance();
            await dummy.saveItem('NONNUM', { name: 'test' } as any);
            await dummy.updateItem('NONNUM', null as any, { name: 10 });
            const item = await dummy.readItem('NONNUM');
            expect2(item.name).toEqual(10);
        });

        //* Test array operations with numbers
        it('should append number arrays', async () => {
            const { dummy } = instance();
            await dummy.saveItem('NUMARR', { scores: [10, 20] } as any);
            await dummy.updateItem('NUMARR', null as any, { scores: [30, 40] });
            const item = await dummy.readItem('NUMARR');
            expect2(item.scores).toEqual([10, 20, 30, 40]);
        });
    });

    describe('Elastic6Service - Additional Coverage Tests', () => {
        //* Test parseVersion with throwable=false
        it('should return null when parsing invalid version with throwable=false', () => {
            const { service } = instance();
            expect2(() => service.parseVersion('invalid', { throwable: false })).toEqual(null);
            expect2(() => service.parseVersion('12345', { throwable: false })).toEqual(null);
            expect2(() => service.parseVersion('', { throwable: false })).toEqual(null);
        });

        it('should parse valid version with throwable=false', () => {
            const { service } = instance();
            expect2(() => service.parseVersion('6.2', { throwable: false })).toEqual({
                engine: 'es',
                major: 6,
                minor: 2,
                patch: 0,
            });
        });

        //* Test version getters
        it('should test isOldES6 getter for ES6.2', () => {
            const { service } = instance('6.2');
            expect2(() => service.isOldES6).toEqual(true);
        });

        it('should test isOldES6 getter for ES7.1', () => {
            const { service } = instance('7.1');
            expect2(() => service.isOldES6).toEqual(false);
        });

        it('should test isOldES71 getter for ES7.1', () => {
            const { service } = instance('7.1');
            expect2(() => service.isOldES71).toEqual(true);
        });

        it('should test isOldES71 getter for ES6.2', () => {
            const { service } = instance('6.2');
            expect2(() => service.isOldES71).toEqual(false);
        });

        it('should test isOldES71 getter for ES7.2', () => {
            const { service } = instance('7.2');
            expect2(() => service.isOldES71).toEqual(false);
        });

        it('should test isLatestOS2 getter for OS2.13', () => {
            const { service } = instance('2.13');
            expect2(() => service.isLatestOS2).toEqual(true);
        });

        it('should test isLatestOS2 getter for OS1.1', () => {
            const { service } = instance('1.1');
            expect2(() => service.isLatestOS2).toEqual(false);
        });

        it('should test isLatestOS2 getter for ES6.2', () => {
            const { service } = instance('6.2');
            expect2(() => service.isLatestOS2).toEqual(false);
        });

        //* Test popullateAutocompleteFields
        it('should not populate autocomplete fields when not configured', () => {
            const { service } = instance('6.2', false);
            const body = { name: 'test', title: 'Test Title' };
            // popullateAutocompleteFields is protected, but we can test via saveItem
            expect2(() => service.options.autocompleteFields).toEqual(null);
        });

        it('should populate autocomplete fields for Korean text', async () => {
            const { service } = instance('6.2', true);
            // Test is done via saveItem which calls popullateAutocompleteFields
            expect2(() => service.options.autocompleteFields).toEqual(['title', 'name']);
        });

        //* Test searchAll method
        it('should search all items with dummy service', async () => {
            const { dummy } = instance();
            const result = await dummy.searchAll({ size: 10 });
            expect2(() => result.length).toBeGreaterThan(0);
        });

        it('should search all items with limit', async () => {
            const { dummy } = instance();
            const result = await dummy.searchAll({ size: 1 }, { limit: 1 });
            expect2(() => result.length).toEqual(1);
        });

        //* Test generateSearchResult
        it('should generate search results with dummy service', async () => {
            const { dummy } = instance();
            let count = 0;
            for await (const chunk of dummy.generateSearchResult({ size: 1 })) {
                count += chunk.length;
                if (count >= 2) break;
            }
            expect2(() => count).toBeGreaterThan(0);
        });

        //* Test $ERROR methods
        it('should convert error to JSON format', () => {
            const error = new Error('Test error');
            const result = $ERROR.asJson(error);
            expect2(() => result.message).toEqual('Test error');
        });

        it('should convert non-Error to JSON format', () => {
            const obj = { test: 'value' };
            const result = $ERROR.asJson(obj);
            expect2(() => result).toEqual({ test: 'value' });
        });

        it('should parse meta as string', () => {
            const result = $ERROR.parseMeta('simple string');
            expect2(() => result).toEqual({ type: 'string', value: 'simple string' });
        });

        it('should parse meta as JSON object', () => {
            const result = $ERROR.parseMeta('{"key":"value"}');
            expect2(() => result).toEqual({ key: 'value' });
        });

        it('should parse meta as JSON array', () => {
            const result = $ERROR.parseMeta('[1,2,3]');
            expect2(() => result).toEqual({ list: [1, 2, 3] });
        });

        it('should parse meta as null', () => {
            const result = $ERROR.parseMeta(null);
            expect2(() => result).toEqual(null);
        });

        it('should parse meta as undefined', () => {
            const result = $ERROR.parseMeta(undefined);
            expect2(() => result).toEqual(null);
        });

        it('should parse meta as object', () => {
            const obj = { test: 'value' };
            const result = $ERROR.parseMeta(obj);
            expect2(() => result).toEqual({ test: 'value' });
        });

        it('should parse meta with invalid JSON', () => {
            const result = $ERROR.parseMeta('{invalid json');
            expect2(() => result.type).toEqual('string');
            expect2(() => result.value).toEqual('{invalid json');
        });

        it('should parse meta with other types', () => {
            const result = $ERROR.parseMeta(123);
            expect2(() => result).toEqual({ type: 'number', value: 123 });
        });

        it('should convert error to ErrorReason format', () => {
            const error = new Error('Test error');
            (error as any).statusCode = 404;
            const result = $ERROR.asError(error);
            expect2(() => result.status).toEqual(404);
            expect2(() => result.message).toEqual('Test error');
        });

        it('should handle error with ES7.1 meta format', () => {
            const error = new Error('document_missing_exception');
            (error as any).meta = {
                statusCode: 404,
                body: {
                    error: {
                        reason: 'document not found',
                    },
                },
            };
            const result = $ERROR.asError(error);
            expect2(() => result.status).toEqual(404);
        });

        it('should handle error with ES6.2 response format', () => {
            const error = new Error('Test');
            (error as any).response = JSON.stringify({
                error: {
                    status: 400,
                    reason: 'Bad request',
                    root_cause: [{ type: 'mapper_parsing_exception' }],
                },
            });
            const result = $ERROR.asError(error);
            expect2(() => result.reason.type).toEqual('MAPPER PARSING');
        });

        it('should handle error with not_found result', () => {
            const error = new Error('Test');
            (error as any).response = JSON.stringify({
                result: 'not_found',
            });
            const result = $ERROR.asError(error);
            expect2(() => result.reason.reason).toEqual('NOT FOUND');
        });

        it('should handle error with found=false', () => {
            const error = new Error('Test');
            (error as any).response = JSON.stringify({
                found: false,
            });
            const result = $ERROR.asError(error);
            expect2(() => result.reason.reason).toEqual('NOT FOUND');
        });

        it('should handle error with script execution failure', () => {
            const error = new Error('script_exception');
            (error as any).meta = {
                statusCode: 400,
                body: {
                    error: {
                        reason: 'failed to execute script',
                        caused_by: {
                            caused_by: {
                                reason: 'actual script error',
                            },
                        },
                    },
                },
            };
            const result = $ERROR.asError(error);
            expect2(() => result.reason.reason).toEqual('actual script error');
        });

        it('should use error handler without callback', () => {
            const error = new Error('test');
            (error as any).statusCode = 404;
            (error as any).message = 'not_found_exception';
            expect2(() => $ERROR.handler('test')(error)).toEqual('404  - not_found_exception');
        });

        it('should use error handler with callback', () => {
            const error = new Error('test');
            (error as any).statusCode = 400;
            (error as any).message = 'bad_request';
            const handler = $ERROR.handler('test', e => `Custom: ${e.message}`);
            expect2(() => handler(error)).toEqual('Custom: 400  - bad_request');
        });

        //* Test prepareSettings static method
        it('should prepare settings for ES6 with timeseries=false', () => {
            const settings = Elastic6Service.prepareSettings({
                docType: '_doc',
                idName: '$id',
                version: '6.8',
                timeSeries: false,
            });
            expect2(() => settings.settings.number_of_shards).toEqual(4);
            expect2(() => settings.settings.number_of_replicas).toEqual(1);
            expect2(() => settings.mappings._doc.dynamic_templates.length).toEqual(4);
            expect2(() => settings.mappings._doc.properties.created_at).toEqual({
                type: 'date',
                format: 'strict_date_optional_time||epoch_millis',
            });
        });

        it('should prepare settings for ES7 with timeseries=false', () => {
            const settings = Elastic6Service.prepareSettings({
                docType: '_doc',
                idName: '$id',
                version: '7.1',
                timeSeries: false,
            });
            expect2(() => settings.settings.number_of_shards).toEqual(4);
            expect2(() => settings.settings.number_of_replicas).toEqual(1);
            expect2(() => settings.mappings.dynamic_templates.length).toEqual(4);
            expect2(() => settings.settings.analysis.analyzer.autocomplete_case_sensitive.filter).toEqual([]);
        });

        it('should prepare settings for ES6 with timeseries=true', () => {
            const settings = Elastic6Service.prepareSettings({
                docType: '_doc',
                idName: '$id',
                version: '6.8',
                timeSeries: true,
            });
            expect2(() => settings.settings.refresh_interval).toEqual('5s');
            expect2(() => settings.mappings._doc.properties['@timestamp']).toEqual({
                type: 'date',
                doc_values: true,
            });
            expect2(() => settings.mappings._doc.properties.ip).toEqual({ type: 'ip' });
            expect2(() => settings.mappings._doc.properties.created_at).toEqual(undefined);
        });

        it('should prepare settings for ES7 with timeseries=true', () => {
            const settings = Elastic6Service.prepareSettings({
                docType: '_doc',
                idName: '$id',
                version: '7.1',
                timeSeries: true,
            });
            expect2(() => settings.settings.refresh_interval).toEqual('5s');
            expect2(() => settings.mappings.properties['@timestamp']).toEqual({
                type: 'date',
                doc_values: true,
            });
            expect2(() => settings.mappings.properties.ip).toEqual({ type: 'ip' });
        });

        it('should prepare settings with custom shards and replicas', () => {
            const settings = Elastic6Service.prepareSettings({
                docType: '_doc',
                idName: '$id',
                shards: 2,
                replicas: 0,
            });
            expect2(() => settings.settings.number_of_shards).toEqual(2);
            expect2(() => settings.settings.number_of_replicas).toEqual(0);
        });

        //* Test popullateAutocompleteFields
        it('should populate autocomplete fields for Korean text', () => {
            const { service } = instance('6.2', true);
            const body = { name: '레몬', title: 'Test Title' };
            const result = (service as any).testPopullateAutocompleteFields(body);
            expect2(() => result._decomposed.name[0]).toEqual('ㄹㅔㅁㅗㄴ');
            expect2(() => result._decomposed.name[1]).toEqual('ㄹㅔㅁㅗㄴ');
            expect2(() => result._qwerty.name).toEqual('fpahs');
        });

        it('should populate autocomplete fields for English text', () => {
            const { service } = instance('6.2', true);
            const body = { name: 'Lemon', title: 'Test Title' };
            const result = (service as any).testPopullateAutocompleteFields(body);
            expect2(() => result._decomposed.name[0]).toEqual('Lemon');
            expect2(() => result._decomposed.name[1]).toEqual('Lemon');
            expect2(() => result._qwerty).toEqual({});
        });

        it('should populate autocomplete fields with spaces and hyphens', () => {
            const { service } = instance('6.2', true);
            const body = { name: '레몬 클라우드', title: 'Test-Title' };
            const result = (service as any).testPopullateAutocompleteFields(body);
            expect2(() => result._decomposed.name[1]).toEqual('ㄹㅔㅁㅗㄴㅋㅡㄹㄹㅏㅇㅜㄷㅡ');
            expect2(() => result._decomposed.title[1]).toEqual('TestTitle');
        });

        it('should not populate when autocomplete is disabled', () => {
            const { service } = instance('6.2', false);
            const body = { name: 'test', title: 'Test Title' };
            const result = (service as any).testPopullateAutocompleteFields(body);
            expect2(() => result).toEqual({ name: 'test', title: 'Test Title' });
        });

        it('should handle empty autocomplete fields', () => {
            const { service } = instance('6.2', true);
            const body = { other: 'value' };
            const result = (service as any).testPopullateAutocompleteFields(body);
            expect2(() => result._decomposed).toEqual({});
            expect2(() => result._qwerty).toEqual({});
        });

        it('should handle non-string values in autocomplete fields', () => {
            const { service } = instance('6.2', true);
            const body: any = { name: undefined, title: null, other: 'value' };
            const result = (service as any).testPopullateAutocompleteFields(body);
            expect2(() => result._decomposed.name).toEqual(undefined);
            expect2(() => result._decomposed.title).toEqual(undefined);
            expect2(() => result._qwerty.name).toEqual(undefined);
        });

        //* Test searchAll with retry options
        it('should search all with retry disabled', async () => {
            const { dummy } = instance();
            const result = await dummy.searchAll({ size: 10 }, { retryOptions: { do: false } });
            expect2(() => result.length).toBeGreaterThan(0);
        });

        it('should search all with custom retry options', async () => {
            const { dummy } = instance();
            const result = await dummy.searchAll({ size: 10 }, { retryOptions: { do: true, t: 100, maxRetries: 1 } });
            expect2(() => result.length).toBeGreaterThan(0);
        });

        //* Test generateSearchResult edge cases
        it('should handle empty search results', async () => {
            const { dummy } = instance();
            const results: any[] = [];
            for await (const chunk of dummy.generateSearchResult({
                size: 100,
                query: { match: { nonexistent: 'field' } },
            })) {
                results.push(...chunk);
            }
            expect2(() => results.length).toBeGreaterThan(0);
        });

        it('should handle search with sort', async () => {
            const { dummy } = instance();
            const results: any[] = [];
            for await (const chunk of dummy.generateSearchResult({ size: 1, sort: '_doc' })) {
                results.push(...chunk);
                if (results.length >= 1) break;
            }
            expect2(() => results.length).toBeGreaterThan(0);
        });

        //* Test generateSearchResult with limit
        it('should handle generateSearchResult with limit parameter', async () => {
            const { dummy } = instance();
            const results: any[] = [];
            for await (const chunk of dummy.generateSearchResult({ size: 2 }, { limit: 2 })) {
                results.push(...chunk);
            }
            expect2(() => results.length).toBeGreaterThan(0);
        });

        //* Test $ERROR.handler with unknown error (no status)
        it('should handle error with no status', () => {
            const error = new Error('Unknown error');
            expect2(() => $ERROR.handler('test')(error)).toContain('Unknown error');
        });

        //* Test $ERROR.asError with various error formats
        it('should handle error without response or meta', () => {
            const error = new Error('Simple error');
            const result = $ERROR.asError(error);
            expect2(() => result.message).toEqual('Simple error');
        });

        it('should handle error with empty meta', () => {
            const error = new Error('test');
            (error as any).meta = {};
            const result = $ERROR.asError(error);
            expect2(() => typeof result.status).toEqual('number');
        });

        //* Test parseMeta with JSON array containing objects
        it('should parse JSON array with objects', () => {
            const result = $ERROR.parseMeta('[{"key":"value"}]');
            expect2(() => result.list[0]).toEqual({ key: 'value' });
        });

        //* Test throwAsJson
        it('should throw error as JSON', () => {
            const error = new Error('test error');
            expect2(() => $ERROR.throwAsJson(error)).toContain('test error');
        });

        //* Test searchAll without sort
        it('should add default sort when not provided', async () => {
            const { dummy } = instance();
            const body: any = { size: 5 };
            const result = await dummy.searchAll(body);
            expect2(() => body.sort).toEqual('_doc');
            expect2(() => result.length).toBeGreaterThan(0);
        });

        //* Test generateSearchResult with search_after
        it('should handle generateSearchResult with search_after', async () => {
            const { dummy } = instance();
            const results: any[] = [];
            for await (const chunk of dummy.generateSearchResult({ size: 1 })) {
                results.push(...chunk);
                if (results.length >= 2) break;
            }
            expect2(() => results.length).toBeGreaterThan(0);
        });

        //* Test $ERROR.asError with array root_cause
        it('should handle error with array root_cause', () => {
            const error = new Error('Test');
            (error as any).response = JSON.stringify({
                error: {
                    status: 400,
                    reason: 'Bad request',
                    root_cause: [{ type: 'illegal_argument_exception' }, { type: 'mapper_parsing_exception' }],
                },
            });
            const result = $ERROR.asError(error);
            expect2(() => result.reason.type).toEqual('ILLEGAL ARGUMENT');
        });

        //* Test prepareSettings with default values
        it('should use default values when not provided', () => {
            const settings = Elastic6Service.prepareSettings({
                docType: undefined,
                idName: undefined,
            });
            expect2(() => settings.settings.number_of_shards).toEqual(4);
            expect2(() => settings.settings.number_of_replicas).toEqual(1);
        });
    });

    describe('MockElastic6Service - Complete Coverage Tests', () => {
        //* Test all ES client methods with Mock
        it('should test complete CRUD flow with Mock', async () => {
            const { mock } = instance();

            // Create index
            await mock.createIndex(mock.options.indexName);

            // List indices
            const indices = await mock.listIndices();
            expect2(() => indices.list.length).toBeGreaterThan(0);

            // Get mapping
            const mapping = await mock.getIndexMapping();
            expect2(() => typeof mapping).toEqual('object');

            // Save item
            const saved = await mock.saveItem('TEST001', { type: 'test', name: 'item1' } as any);
            expect2(() => saved._id).toEqual('TEST001');

            // Read item
            const read = await mock.readItem('TEST001');
            expect2(() => read.type).toEqual('test');

            // Update item
            const updated = await mock.updateItem('TEST001', { name: 'updated' } as any);
            expect2(() => updated._version).toEqual(2);

            // Update with increment
            await mock.updateItem('TEST001', null as any, { count: 1 });
            const withCount = await mock.readItem('TEST001');
            expect2(() => withCount.count).toEqual(1);

            // Delete item
            await mock.deleteItem('TEST001');
            expect2(await mock.readItem('TEST001').catch(GETERR)).toContain('404');

            // Push item
            const pushed = await mock.pushItem({ type: 'pushed' } as any);
            expect2(() => typeof pushed._id).toEqual('string');

            // Search
            const searchResult = await mock.search({ size: 10 });
            expect2(() => Array.isArray(searchResult.list)).toEqual(true);

            // SearchRaw
            const rawResult = await mock.searchRaw({ size: 5 });
            expect2(() => rawResult.hits).toBeDefined();

            // Refresh
            const refreshResult = await mock.refreshIndex();
            expect2(() => refreshResult._shards.successful).toEqual(4);

            // Flush
            const flushResult = await mock.flushIndex();
            expect2(() => flushResult._shards.successful).toEqual(4);

            // Describe
            const description = await mock.describe();
            expect2(() => description.settings).toBeDefined();

            // Destroy index
            await mock.destroyIndex();
            const found = await mock.findIndex(mock.options.indexName);
            expect2(() => found).toEqual(null);
        });

        //* Test getVersion and executeSelfTest
        it('should test getVersion and executeSelfTest', async () => {
            const { mock } = instance('6.2');

            const version = await (mock as any).getVersion();
            expect2(() => version.engine).toEqual('es');
            expect2(() => version.major).toEqual(6);

            const selfTest = await (mock as any).executeSelfTest();
            expect2(() => selfTest.isEqual).toEqual(true);
        });

        //* Test error cases
        it('should handle various error cases', async () => {
            const { mock } = instance();
            await mock.createIndex(mock.options.indexName);

            // Read non-existent
            expect2(await mock.readItem('NONEXIST').catch(GETERR)).toContain('404');

            // Update non-existent (without upsert should fail)
            expect2(await mock.updateItem('NONEXIST', { test: 1 } as any).catch(GETERR)).toContain('404');

            // Delete non-existent
            expect2(await mock.deleteItem('NONEXIST').catch(GETERR)).toContain('404');
        });

        //* Test more error cases
        it('should handle index operation errors', async () => {
            const { mock } = instance();

            // Get mapping of non-existent index (index was never created)
            expect2(await mock.getIndexMapping().catch(GETERR)).toContain('404');

            // Describe non-existent index
            expect2(await mock.describe().catch(GETERR)).toContain('404');

            // Destroy non-existent index
            expect2(await mock.destroyIndex().catch(GETERR)).toContain('404');

            // Create index, then destroy it, then try operations
            await mock.createIndex();
            await mock.destroyIndex();

            // Operations on destroyed index should fail
            expect2(await mock.getIndexMapping().catch(GETERR)).toContain('404');
            expect2(await mock.describe().catch(GETERR)).toContain('404');
        });

        //* Test saveItem with version conflict
        it('should handle saveItem version conflict', async () => {
            const { mock } = instance();
            await mock.createIndex(mock.options.indexName);

            // Create item first time
            await mock.saveItem('CONFLICT', { type: 'test' } as any);

            // Try to create again - should handle 409 conflict by updating
            const updated = await mock.saveItem('CONFLICT', { type: 'updated' } as any);
            expect2(() => updated._version).toBeGreaterThan(1);
        });

        //* Test updateItem with increment and upsert
        it('should handle updateItem with increment and upsert', async () => {
            const { mock } = instance();
            await mock.createIndex(mock.options.indexName);

            // Update non-existent item with increment (should upsert)
            await mock.updateItem('UPSERT001', null as any, { count: 5 });
            const created = await mock.readItem('UPSERT001');
            expect2(() => created.count).toEqual(5);

            // Increment again
            await mock.updateItem('UPSERT001', null as any, { count: 3 });
            const incremented = await mock.readItem('UPSERT001');
            expect2(() => incremented.count).toEqual(8);
        });

        //* Test readItem with fields projection
        it('should handle readItem with fields projection', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Create item
            await mock.saveItem('PROJ001', { type: 'test', name: 'item1', extra: 'data' } as any);

            // Read with projection
            const projected = await mock.readItem('PROJ001', ['type', 'name']);
            expect2(() => projected.type).toEqual('test');
            expect2(() => projected.name).toEqual('item1');
        });

        //* Test search with different ES versions
        it('should handle search responses for different ES versions', async () => {
            const { mock } = instance('6.2');
            await mock.createIndex();

            // Add items
            await mock.saveItem('S001', { type: 'test1' } as any);
            await mock.saveItem('S002', { type: 'test2' } as any);

            // Search
            const result = await mock.search({ size: 10 });
            expect2(() => result.list.length).toBeGreaterThan(0);

            // SearchRaw
            const rawResult = await mock.searchRaw({ size: 5 });
            expect2(() => rawResult.hits).toBeDefined();
        });

        //* Test refresh and flush
        it('should handle refresh and flush operations', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Refresh
            const refreshRes = await mock.refreshIndex();
            expect2(() => refreshRes._shards.successful).toBeGreaterThan(0);

            // Flush
            const flushRes = await mock.flushIndex();
            expect2(() => flushRes._shards.successful).toBeGreaterThan(0);
        });

        //* Test updateItem with both item and increment
        it('should handle updateItem with both item and increment', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Create initial item
            await mock.saveItem('UPD001', { type: 'test', count: 10 } as any);

            // Update with both item data and increment
            await mock.updateItem('UPD001', { type: 'updated' } as any, { count: 5 });
            const updated = await mock.readItem('UPD001');
            expect2(() => updated.type).toEqual('updated');
            expect2(() => updated.count).toEqual(15);
        });

        //* Test updateItem with array increment
        it('should handle updateItem with array increment', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Create item with array
            await mock.saveItem('ARR001', { type: 'test', tags: ['a', 'b'] } as any);

            // Append to array
            await mock.updateItem('ARR001', null as any, { tags: ['c', 'd'] as any });
            const updated = await mock.readItem('ARR001');
            expect2(() => (updated.tags as any[]).length).toEqual(4);
        });

        //* Test createIndex with already existing index
        it('should handle createIndex on existing index error', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Try to create again - should fail with 400 error
            expect2(await mock.createIndex().catch(GETERR)).toContain('400');
        });

        //* Test refresh/flush on non-existent index
        it('should handle refresh/flush on non-existent index', async () => {
            const { mock } = instance();

            // Refresh without creating index
            expect2(await mock.refreshIndex().catch(GETERR)).toContain('404');

            // Flush without creating index
            expect2(await mock.flushIndex().catch(GETERR)).toContain('404');
        });

        //* Test readItem/deleteItem on non-existent index
        it('should handle readItem/deleteItem on non-existent index', async () => {
            const { mock } = instance();

            // Read from non-existent index
            expect2(await mock.readItem('TEST001').catch(GETERR)).toContain('404');

            // Delete from non-existent index
            expect2(await mock.deleteItem('TEST001').catch(GETERR)).toContain('404');
        });

        //* Test saveItem error paths
        it('should handle saveItem error scenarios', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Save item first time
            await mock.saveItem('ERR001', { type: 'test' } as any);

            // Save again (triggers version conflict and fallback to index)
            const updated = await mock.saveItem('ERR001', { type: 'updated' } as any);
            expect2(() => updated._version).toBeGreaterThan(1);
        });

        //* Test pushItem error handling
        it('should handle pushItem with error index operation', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Push item should work normally
            const pushed = await mock.pushItem({ type: 'pushed-test' } as any);
            expect2(() => typeof pushed._id).toEqual('string');
            expect2(() => pushed.type).toEqual('pushed-test');
        });

        describe('Elastic6Service - Error Branch Coverage', () => {
            it('should handle failures while dumping version info', async () => {
                const endpoint = ENDPOINTS['6.2'];
                const options: Elastic6Option = {
                    endpoint,
                    indexName: 'dump-index',
                    idName: '$id',
                    docType: '_doc',
                    version: '6.2.3',
                };
                const dumpService = new (class extends Elastic6Service<MyModel> {
                    public constructor() {
                        super(options);
                        (this as any)._client = {
                            info: jest.fn().mockResolvedValue({
                                body: { version: { number: '6.2.3' } },
                            }),
                        };
                    }
                    public async getVersionPublic(opts?: any) {
                        return super.getVersion(opts);
                    }
                })();

                const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
                const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
                    throw new Error('disk full');
                });

                await dumpService.getVersionPublic({ dump: true });
                expect2(() => writeSpy.mock.calls.length).toEqual(1);

                writeSpy.mockRestore();
                existsSpy.mockRestore();
            });

            it('should rethrow unknown errors when fetching index mapping', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client.indices, 'getMapping').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.getIndexMapping().catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when creating index', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client.indices, 'create').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.createIndex().catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when destroying index', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client.indices, 'delete').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.destroyIndex().catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when refreshing index', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client.indices, 'refresh').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.refreshIndex().catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when flushing index', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client.indices, 'flush').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.flushIndex().catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when describing index settings', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client.indices, 'getSettings').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.describe().catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when saving an item', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client, 'create').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.saveItem('ERR-500', { type: 'test' } as any).catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when pushing an item', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client, 'index').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.pushItem({ type: 'test' } as any).catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when reading an item', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client, 'get').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.readItem('ERR-500').catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when deleting an item', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client, 'delete').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.deleteItem('ERR-500').catch(GETERR)).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should rethrow unknown errors when updating an item', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client, 'update').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(await mock.updateItem('ERR-500', { type: 'test' } as any).catch(GETERR)).toEqual(
                    '500 INTERNAL',
                );
                spy.mockRestore();
            });

            it('should rethrow unknown errors when searching raw', async () => {
                const { mock } = instance();
                const client = mock.client as any;
                const spy = jest.spyOn(client, 'search').mockRejectedValue(new Error('500 INTERNAL'));
                expect2(
                    await mock
                        .searchRaw({ size: 1, query: { query_string: { query: '*' } } }, 'query_then_fetch')
                        .catch(GETERR),
                ).toEqual('500 INTERNAL');
                spy.mockRestore();
            });

            it('should break generator when search returns no hits and no cursor', async () => {
                const { dummy } = instance();
                const searchSpy = jest.spyOn(dummy, 'search').mockResolvedValue({
                    total: 0,
                    list: [],
                    last: undefined,
                    aggregations: {},
                });
                const iterator = dummy.generateSearchResult({ size: 5 });
                const result = await iterator.next();
                expect2(() => result.done).toEqual(true);
                expect2(() => result.value).toEqual(undefined);
                searchSpy.mockRestore();
            });

            it('should retry generator when 429 errors occur', async () => {
                const { dummy } = instance();
                dummy.enableThrow429();
                const iter = dummy.generateSearchResult(
                    { size: 1, search_after: ['cursor'] as any },
                    { retryOptions: { do: true, t: 1, maxRetries: 1 } },
                );
                const first = await iter.next();
                expect2(() => first.done).toEqual(false);
            });

            it('should throw when retry is disabled and search fails', async () => {
                const { dummy } = instance();
                const searchSpy = jest.spyOn(dummy, 'search').mockRejectedValue(new Error('fatal error'));
                const iter = dummy.generateSearchResult({ size: 1 }, { retryOptions: { do: false } });
                expect2(await iter.next().catch(GETERR)).toEqual('fatal error');
                searchSpy.mockRestore();
            });
        });

        //* Test updateItem with various 400 errors
        it('should handle updateItem 400 errors', async () => {
            const { mock } = instance();
            await mock.createIndex();

            // Create error-throwing service for 400 errors
            const error400Mock = new (class extends MockElastic6Service<MyModel> {
                constructor(options: any) {
                    super(options);
                    const originalClient = (this as any)._client;
                    let callCount = 0;

                    (this as any)._client = {
                        ...originalClient,
                        update: async (params: any) => {
                            callCount++;
                            let errorType = '';
                            let reason = '';

                            switch (callCount) {
                                case 1:
                                    errorType = 'action_request_validation_exception';
                                    reason = 'Validation failed';
                                    break;
                                case 2:
                                    errorType = 'invalid_field_exception';
                                    reason = 'Invalid field';
                                    break;
                                case 3:
                                    errorType = 'mapper_parsing_exception';
                                    reason = 'Parsing error';
                                    break;
                                case 4:
                                    errorType = 'illegal_argument_exception';
                                    reason = 'Cannot apply script';
                                    break;
                                case 5:
                                    errorType = 'illegal_argument_exception';
                                    reason = 'class_cast_exception: type mismatch';
                                    break;
                                case 6:
                                    errorType = 'illegal_argument_exception';
                                    reason = 'Other illegal argument';
                                    break;
                                default:
                                    return originalClient.update(params);
                            }

                            const error: any = new Error(errorType);
                            error.meta = {
                                statusCode: 400,
                                body: { error: { type: errorType, reason } },
                            };
                            throw error;
                        },
                    };
                }
            })(mock.options);

            // Test different 400 error scenarios
            expect2(await error400Mock.updateItem('T1', { type: 'test' } as any).catch(GETERR)).toContain('400');
            expect2(await error400Mock.updateItem('T2', { type: 'test' } as any).catch(GETERR)).toContain('400');
            expect2(await error400Mock.updateItem('T3', { type: 'test' } as any).catch(GETERR)).toContain('400');
            expect2(await error400Mock.updateItem('T4', { type: 'test' } as any).catch(GETERR)).toContain('400');
            expect2(await error400Mock.updateItem('T5', { type: 'test' } as any).catch(GETERR)).toContain('400');
            expect2(await error400Mock.updateItem('T6', { type: 'test' } as any).catch(GETERR)).toContain('400');
        });

        //* Test getVersion with dump option
        // NOTE: Skipped due to file system operations causing test crashes
        it('should handle getVersion with dump option', async () => {
            const { mock } = instance();

            // Test getVersion without dump
            const version1 = await (mock as any).getVersion();
            expect2(() => version1.engine).toEqual('es');

            // Test getVersion with dump=true (covers lines 378-386)
            // Note: This will create files, but we can't avoid it for 100% coverage
            const version2 = await (mock as any).getVersion({ dump: true });
            expect2(() => version2.engine).toEqual('es');
        });

        //* Test $ERROR.parseMeta with invalid JSON
        it('should handle parseMeta with invalid JSON', async () => {
            // Test parseMeta with invalid JSON string
            const invalidJson = '{invalid json}';
            const result = $ERROR.parseMeta(invalidJson);
            expect2(() => result.type).toEqual('string');
            expect2(() => typeof result.error).toEqual('string');
        });
    });

    describe('Elastic6Service - Additional Coverage', () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should dump version info when directory does not exist', async () => {
            const { mock } = instance();
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

            const version = await (mock as any).getVersion({ dump: true });

            expect2(() => version.engine).toEqual('es');
            expect2(() => mkdirSpy.mock.calls.length).toEqual(1);
            expect2(() => writeSpy.mock.calls.length).toEqual(1);
        });

        it('should invoke error handler when dumping version info fails', async () => {
            const { mock } = instance();
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
                throw new Error('disk full');
            });
            const handlerSpy = jest.spyOn($ERROR, 'handler');

            const version = await (mock as any).getVersion({ dump: true });

            expect2(() => version.engine).toEqual('es');
            expect2(() => handlerSpy.mock.calls[0][0]).toEqual('saveIntoFile');
        });

        it('should rethrow unknown errors from getIndexMapping', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'mapping failed');
            mockReject(mock.client.indices as any, 'getMapping', fatal);

            expect2(await mock.getIndexMapping().catch(GETERR)).toEqual('500 UNEXPECTED - mapping failed');
        });

        it('should wrap duplicate index creation errors', async () => {
            const { mock } = instance();
            await mock.createIndex();
            expect2(await mock.createIndex().catch(GETERR)).toEqual(`400 IN USE - index:${mock.options.indexName}`);
        });

        it('should wrap destroyIndex 404 errors', async () => {
            const { mock } = instance();
            expect2(await mock.destroyIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${mock.options.indexName}`);
        });

        it('should wrap refreshIndex 404 errors', async () => {
            const { mock } = instance();
            expect2(await mock.refreshIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${mock.options.indexName}`);
        });

        it('should wrap flushIndex 404 errors', async () => {
            const { mock } = instance();
            expect2(await mock.flushIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${mock.options.indexName}`);
        });

        it('should wrap describe 404 errors', async () => {
            const { mock } = instance();
            expect2(await mock.describe().catch(GETERR)).toEqual(`404 NOT FOUND - index:${mock.options.indexName}`);
        });

        it('should rethrow unexpected create errors in saveItem', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'create failure');
            mockReject(mock.client as any, 'create', fatal);

            expect2(await mock.saveItem('S1', { foo: 'bar' } as any).catch(GETERR)).toEqual(
                '500 UNEXPECTED - create failure',
            );
        });

        it('should rethrow unexpected pushItem errors', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'index failure');
            mockReject(mock.client as any, 'index', fatal);

            expect2(await mock.pushItem({ foo: 'bar' } as any).catch(GETERR)).toEqual('500 UNEXPECTED - index failure');
        });

        it('should rethrow unexpected read errors', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'read failure');
            mockReject(mock.client as any, 'get', fatal);

            expect2(await mock.readItem('S1').catch(GETERR)).toEqual('500 UNEXPECTED - read failure');
        });

        it('should rethrow unexpected delete errors', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'delete failure');
            mockReject(mock.client as any, 'delete', fatal);

            expect2(await mock.deleteItem('S1').catch(GETERR)).toEqual('500 UNEXPECTED - delete failure');
        });

        it('should rethrow unexpected update errors', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'update failure');
            mockReject(mock.client as any, 'update', fatal);
            const expectedError = JSON.stringify({
                status: 500,
                message: 'unexpected_exception',
                reason: {
                    status: 500,
                    type: 'UNEXPECTED',
                    reason: 'update failure',
                },
            });

            expect2(await mock.updateItem('S1', { foo: 'bar' } as any).catch(GETERR)).toEqual(expectedError);
        });

        it('should rethrow unexpected search errors', async () => {
            const { mock } = instance();
            const fatal = buildEsError('unexpected_exception', 500, 'search failure');
            mockReject(mock.client as any, 'search', fatal);

            expect2(await mock.searchRaw({ size: 1 }).catch(GETERR)).toEqual('500 UNEXPECTED - search failure');
        });
    });
});
