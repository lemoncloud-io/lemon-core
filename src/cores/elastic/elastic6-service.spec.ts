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
import { loadProfile } from '../../environ';
import { GETERR, expect2, _it, waited, loadJsonSync } from '../..';
import { GeneralItem, SearchBody } from 'lemon-model';
import { Elastic6Service, DummyElastic6Service, Elastic6Option, $ERROR } from './elastic6-service';
import { ApiResponse } from '@elastic/elasticsearch';

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
export const instance = (version: VERSIONS = '6.2', useAutoComplete = false, indexName?: string) => {
    //NOTE - use tunneling to elastic6 endpoint.
    const endpoint = ENDPOINTS[version];
    if (!endpoint) throw new Error(`@version[${version}] is not supported!`);
    // const indexName = `test-v${version}`;
    indexName = indexName ?? `test-v${version}`;
    const idName = '$id'; //! global unique id-name in same index.
    const docType = '_doc'; //! must be `_doc`.
    const autocompleteFields = useAutoComplete ? ['title', 'name'] : null;
    const options: Elastic6Option = { endpoint, indexName, idName, docType, autocompleteFields, version };
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
    })();
    const dummy: Elastic6Service<GeneralItem> = new DummyElastic6Service<MyModel>('dummy-elastic6-data.yml', options);
    return { version, service, dummy, options };
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
    expect2(() => service.parseVersion('1.2.3a')).toEqual('@version[1.2.3a] is invalid - fail to parse');
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

    //* destroy index
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
    expect2(
        await service
            .describe()
            .then(R => {
                const { settings, mappings } = R;
                const commonData = {
                    index: {
                        number_of_replicas: settings.index.number_of_replicas,
                        number_of_shards: settings.index.number_of_shards,
                        provided_name: settings.index.provided_name,
                        analysis: settings.index.analysis,
                    },
                    properties: mappings._doc ? mappings._doc.properties : mappings.properties,
                    dynamic_templates: mappings._doc ? mappings._doc.dynamic_templates : mappings.dynamic_templates,
                };
                return commonData;
            })
            .catch(PASS),
    ).toEqual({
        index: {
            number_of_replicas: '1',
            number_of_shards: '4',
            provided_name: `${indexName}`,
            analysis: {
                analyzer: {
                    autocomplete_case_insensitive: {
                        filter: ['lowercase'],
                        tokenizer: 'edge_30grams',
                        type: 'custom',
                    },
                    autocomplete_case_sensitive: {
                        filter: service.isOldES6 ? ['standard'] : [],
                        tokenizer: 'edge_30grams',
                        type: 'custom',
                    },
                    hangul: {
                        filter: ['lowercase'],
                        tokenizer: 'hangul',
                        type: 'custom',
                    },
                },
                tokenizer: {
                    edge_30grams: {
                        max_gram: '30',
                        min_gram: '1',
                        token_chars: ['letter', 'digit', 'punctuation', 'symbol'],
                        type: 'edge_ngram',
                    },
                    hangul: {
                        decompound: 'true',
                        deinflect: 'true',
                        index_eojeol: 'true',
                        pos_tagging: 'false',
                        type: 'seunjeon_tokenizer',
                    },
                },
            },
        },
        properties: {
            '@version': {
                index: false,
                type: 'keyword',
            },
            created_at: {
                type: 'date',
                ...(service.isLatestOS2 ? { format: 'strict_date_optional_time||epoch_millis' } : {}),
            },
            deleted_at: {
                type: 'date',
                ...(service.isLatestOS2 ? { format: 'strict_date_optional_time||epoch_millis' } : {}),
            },
            updated_at: {
                type: 'date',
                ...(service.isLatestOS2 ? { format: 'strict_date_optional_time||epoch_millis' } : {}),
            },
        },
        dynamic_templates: [
            {
                autocomplete: {
                    mapping: {
                        analyzer: 'autocomplete_case_insensitive',
                        search_analyzer: 'standard',
                        type: 'text',
                    },
                    path_match: '_decomposed.*',
                },
            },
            {
                autocomplete_qwerty: {
                    mapping: {
                        analyzer: 'autocomplete_case_sensitive',
                        search_analyzer: 'whitespace',
                        type: 'text',
                    },
                    path_match: '_qwerty.*',
                },
            },
            {
                string_id: {
                    mapping: {
                        ignore_above: 256,
                        type: 'keyword',
                    },
                    match: '$id',
                    match_mapping_type: 'string',
                },
            },
            {
                strings: {
                    mapping: {
                        analyzer: 'hangul',
                        fields: {
                            keyword: {
                                ignore_above: 256,
                                type: 'keyword',
                            },
                        },
                        search_analyzer: 'hangul',
                        type: 'text',
                    },
                    match_mapping_type: 'string',
                },
            },
        ],
    });

    //* flush index
    const result = await service.flushIndex().catch(PASS);
    expect2(result).toHaveProperty('_shards.failed');
    expect2(result).toHaveProperty('_shards.successful');
    expect2(result).toHaveProperty('_shards.total');
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
        //* unable to access to elastic6 endpoint
        if (GETERR(e).endsWith('unknown error')) return false;
        //* index does not exist
        if (GETERR(e).startsWith('404 NOT FOUND')) return false;
        console.error('! err =', e);

        //* rethrow
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
    expect2(await service.updateItem('A0', {}).catch(GETERR)).toEqual('404 NOT FOUND - id:A0');

    //* create new item
    const A0 = { type: '', name: 'a0' };
    expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, $id: 'A0', _id: 'A0', _version: 2 });
    expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, _id: 'A0', _version: 2 });

    //* try to update fields.
    expect2(await service.updateItem('A0', { type: 'test' }, { count: 1 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 3,
        type: 'test',
    });

    expect2(await service.updateItem('A0', { type: 'test' }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 4,
        type: 'test',
    });

    //* try to increment fields
    expect2(await service.updateItem('A0', null, { count: 0 }).catch(GETERR)).toEqual({ _id: 'A0', _version: 5 });
    expect2(await service.updateItem('A0', { count: 0 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 6,
        count: 0,
    });
    expect2(await service.updateItem('A0', null, { count: 0 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 7,
    });
    expect2(await service.updateItem('A0', { type: 'test' }, { a: 1, b: 2 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 8,
        type: 'test',
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 8,
        a: 1,
        b: 2,
        count: 0,
        name: 'a0',
        type: 'test',
    });
    expect2(await service.updateItem('A0', { type: 'test' }, { a: 1, b: 2 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 9,
        type: 'test',
    });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 9,
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
    const indexName = service.options.indexName;
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
    expect2(await service.searchRaw($search).catch(GETERR), '!took').toEqual({
        _shards: { failed: 0, skipped: 0, successful: 4, total: 4 },
        hits: {
            hits: [
                {
                    _id: 'A0',
                    _index: indexName,
                    _score: null,
                    _source: { $id: 'A0', a: 2, b: 4, name: 'a0', type: 'test', count: 0 },
                    ...(service.isLatestOS2 ? {} : { _type: '_doc' }),
                    sort: [0],
                },
            ],
            max_score: null,
            total: service.isOldES6 ? 2 : { relation: 'eq', value: 2 },
        },
        aggregations: {
            test: {
                buckets: [
                    {
                        doc_count: 1,
                        key: 0,
                    },
                    {
                        doc_count: 1,
                        key: 1,
                    },
                ],
                doc_count_error_upper_bound: 0,
                sum_other_doc_count: 0,
            },
        },
        timed_out: false,
    });
    expect2(await service.search($search).catch(GETERR)).toEqual({
        total: 2,
        list: [{ _id: 'A0', _score: null, a: 2, b: 4, $id: 'A0', count: 0, name: 'a0', type: 'test' }],
        aggregations: {
            test: {
                buckets: [
                    { doc_count: 1, key: 0 },
                    { doc_count: 1, key: 1 },
                ],
                doc_count_error_upper_bound: 0,
                sum_other_doc_count: 0,
            },
        },
        last: [0],
    });
};

/**
 * perform detailed CRUD tests.
 * @param service - Elasticsearch service instance.
 */
export const detailedCRUDTest = async (service: Elastic6Service<any>): Promise<void> => {
    //* make sure deleted.
    await service.deleteItem('A0').catch(GETERR);
    await service.deleteItem('A1').catch(GETERR);

    //* make sure empty index.
    expect2(await service.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
    expect2(await service.readItem('A1').catch(GETERR)).toEqual('404 NOT FOUND - id:A1');

    //* save to A0
    expect2(await service.saveItem('A0', { type: '', name: 'a0' }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        $id: 'A0',
        type: '',
        name: 'a0',
    });
    expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        $id: 'A0',
        type: '',
        name: 'a0',
    }); // `._version` is incremented.
    // expect2(await service.pushItem({ name:'push-01' }).catch(GETERR), '').toEqual({ _id:'EHYvom4Bk-QqXBefOceC', _version:1, name:'push-01' }); // `._id` is auto-gen.
    expect2(await service.pushItem({ name: 'push-01' }).catch(GETERR), '!_id').toEqual({
        _version: 1,
        name: 'push-01',
    }); // `._id` is auto-gen.

    const data0 = await service.readItem('A0');
    expect2(await service.updateItem('A0', { name: 'b0' }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        name: 'b0',
    });
    expect2(await service.updateItem('A0', { nick: 'bb' }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        nick: 'bb',
    });
    expect2(await service.readItem('A0').catch(GETERR), '').toEqual({
        _id: 'A0',
        $id: 'A0',
        _version: Number(data0._version) + 2,
        type: '',
        name: 'b0',
        nick: 'bb',
    }); // `._version` is incremented.

    expect2(await service.updateItem('A0', null, { count: 2 }).catch(GETERR), '!_version').toEqual({ _id: 'A0' });

    //TODO - 1안) ????
    //TODO - 주의) 동시에 여러건의 호출이 있었을경우 -> increments이 누적이 보장되어야함. 원자성 보장

    expect2(await service.updateItem('A0', { count: 10 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 15,
        count: 10,
    });
    expect2(await service.updateItem('A0', null, { count: 2 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 16,
    });

    //* try to overwrite, and update
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 16,
        count: 12,
        name: 'b0',
        nick: 'bb',
        type: '',
    }); // support number, string, null type.

    //save empty ''
    expect2(
        await service.saveItem('A0', { count: '', nick: '', name: '', empty: '' }).catch(GETERR),
        '!_version',
    ).toEqual({ _id: 'A0', count: '', empty: '', name: '', nick: '' });
    expect2(await service.readItem('A0').catch(GETERR)).toEqual({
        $id: 'A0',
        _id: 'A0',
        _version: 17,
        count: '',
        empty: '',
        name: '',
        nick: '',
        type: '',
    });

    /**
     * 테스트: 내부 객체에 데이터 변경하기
     */
    // 1) inner-object update w/ null support
    expect2(await service.saveItem('A4', { extra: { a: 1 } }).catch(GETERR), '!_version').toEqual({
        $id: 'A4',
        _id: 'A4',
        extra: { a: 1 },
    });
    expect2(await service.updateItem('A4', { extra: { b: 2 } }).catch(GETERR), '!_version').toEqual({
        _id: 'A4',
        extra: { b: 2 },
    });
    expect2(await service.updateItem('A4', { extra: { a: null } }).catch(GETERR), '!_version').toEqual({
        _id: 'A4',
        extra: { a: null },
    });
    expect2(await service.updateItem('A4', { extra: { a: '' } }).catch(GETERR), '!_version').toEqual({
        _id: 'A4',
        extra: { a: '' },
    });
    expect2(await service.updateItem('A4', { extra: '' }).catch(GETERR), '!_version').toEqual(
        '400 MAPPER PARSING - object mapping for [extra] tried to parse field [extra] as object, but found a concrete value',
    );

    //* overwrite whole docs by indexItem
    expect2(await service.updateItem('A0', { a: 1, b: 2 }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        a: 1,
        b: 2,
    });
    expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
        $id: 'A0',
        _id: 'A0',
        a: 1,
        b: 2,
        count: '',
        empty: '',
        name: '',
        nick: '',
        type: '',
    });

    //* overwrite inner-object by indexItem
    expect2(await service.updateItem('A4', { extra: { a: 1, b: 2 } }).catch(GETERR), '!_version').toEqual({
        _id: 'A4',
        extra: { a: 1, b: 2 },
    });
    expect2(await service.readItem('A4').catch(GETERR), '!_version').toEqual({
        $id: 'A4',
        _id: 'A4',
        extra: { a: 1, b: 2 },
    });

    //* delete
    expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual({ _id: 'A0' });
    expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual('404 NOT FOUND - id:A0');

    //* try to update A1 (which does not exist)
    expect2(await service.updateItem('A0', { name: 'b0' }).catch(GETERR), '!_version').toEqual('404 NOT FOUND - id:A0');
};

/**
 * test data mismatch errors
 * - update fields to null
 * - update fields with mismatched types
 * @param service - Elasticsearch service instance.
 */
export const mismatchedTypeTest = async (service: Elastic6Service<any>): Promise<void> => {
    //* 테스트를 위한 agent 생성
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
        object_field: { sub_field: 'string' },
        nested_field: [{ sub1_field: 'string1' }, { sub2_field: 'string2' }],
        array_field: ['string1', 'string2', 'string3'],
    });

    //* verify the mapping condition. (`_mapping`)
    const mapping = await service.getIndexMapping();

    // get '@@_field'
    function getFieldTypes(properties: any, parentKey: string = ''): { [key: string]: string } {
        return Object.keys(properties).reduce((acc, key) => {
            const fullKey = parentKey ? `${parentKey}.${key}` : key;
            if (fullKey.includes('_field') && properties[key].type) {
                acc[fullKey] = properties[key].type;
            }
            if (properties[key].properties) {
                Object.assign(acc, getFieldTypes(properties[key].properties, fullKey));
            }
            return acc;
        }, {} as { [key: string]: string });
    }

    // formatting mappings
    const properties = service.isOldES6 ? mapping?._doc?.properties : mapping?.properties;
    const fieldsWithTypes = getFieldTypes(properties);

    // verify mapping types
    const expectedMapping = {
        array_field: 'text',
        string_field: 'text',
        boolean_field: 'boolean',
        date_field: 'date',
        float_field: 'float',
        long_field: 'long',
        'object_field.sub_field': 'text', // 하위 속성을 포함한 object_field
        'nested_field.sub1_field': 'text', // 하위 속성을 포함한 nested_field
        'nested_field.sub2_field': 'text', // 하위 속성을 포함한 nested_field
    };

    expect2(fieldsWithTypes).toEqual(expectedMapping);

    //* test w/mismatched types
    /**
     * string_field
     * string -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ string_field: null })).toEqual({
        string_field: null,
    });
    expect2(await agent().update({ string_field: '' })).toEqual({
        string_field: '',
    });
    expect2(await agent().update({ string_field: 123 })).toEqual({
        string_field: 123,
    });
    expect2(await agent().update({ string_field: 1.23 })).toEqual({
        string_field: 1.23,
    });
    expect2(await agent().update({ string_field: [] })).toEqual({
        string_field: [],
    });
    expect2(await agent().update({ string_field: [1, 2, 3] })).toEqual({
        string_field: [1, 2, 3],
    });
    expect2(await agent().update({ string_field: false })).toEqual({
        string_field: false,
    });
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
    expect2(await agent().update({ long_field: null })).toEqual({
        long_field: null,
    });
    expect2(await agent().update({ long_field: '' })).toEqual({
        long_field: '',
    });
    expect2(await agent().update({ long_field: '1234567890123' })).toEqual({
        long_field: '1234567890123',
    });
    expect2(await agent().update({ long_field: 1.234567890123 })).toEqual({
        long_field: 1.234567890123,
    });
    expect2(await agent().update({ long_field: [] })).toEqual({
        long_field: [],
    });
    expect2(await agent().update({ long_field: [1, 2, 3] }), '!_version').toEqual({
        long_field: [1, 2, 3],
    });
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
    expect2(await agent().update({ float_field: null })).toEqual({
        float_field: null,
    });
    expect2(await agent().update({ float_field: '' })).toEqual({
        float_field: '',
    });
    expect2(await agent().update({ float_field: '123.45' })).toEqual({
        float_field: '123.45',
    });
    expect2(await agent().update({ float_field: 123456789 })).toEqual({
        float_field: 123456789,
    });
    expect2(await agent().update({ float_field: [] })).toEqual({
        float_field: [],
    });
    expect2(await agent().update({ float_field: [1, 2, 3] })).toEqual({
        float_field: [1, 2, 3],
    });
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
    expect2(await agent().update({ date_field: null })).toEqual({
        date_field: null,
    });
    expect2(await agent().update({ date_field: 1234567890 })).toEqual({
        date_field: 1234567890,
    });
    expect2(await agent().update({ date_field: [] })).toEqual({
        date_field: [],
    });
    expect2(await agent().update({ date_field: [1, 2, 3] })).toEqual({
        date_field: [1, 2, 3],
    });
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
     * boolean -> number로 업데이트시 오류 발생
     * boolean -> {}로 업데이트시 오류 발생
     * boolean -> [1, 2, 3]으로 업데이트시 오류 발생. []는 오류 발생하지 않음.
     * */
    expect2(await agent().update({ boolean_field: null })).toEqual({
        boolean_field: null,
    });
    expect2(await agent().update({ boolean_field: '' })).toEqual({
        boolean_field: '',
    });
    expect2(await agent().update({ boolean_field: 'true' })).toEqual({
        boolean_field: 'true',
    });
    expect2(await agent().update({ boolean_field: [] })).toEqual({
        boolean_field: [],
    });
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
    expect2(await agent().update({ object_field: null })).toEqual({
        object_field: null,
    });
    expect2(await agent().update({ object_field: [] })).toEqual({
        object_field: [],
    });
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
    expect2(await agent().update({ nested_field: null })).toEqual({
        nested_field: null,
    });
    expect2(await agent().update({ nested_field: { sub1_field: 'string' } })).toEqual({
        nested_field: { sub1_field: 'string' },
    });
    expect2(await agent().update({ nested_field: [] })).toEqual({
        nested_field: [],
    });
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
    expect2(await agent().update({ array_field: null })).toEqual({
        array_field: null,
    });
    expect2(await agent().update({ array_field: '' })).toEqual({
        array_field: '',
    });
    expect2(await agent().update({ array_field: 'string' })).toEqual({
        array_field: 'string',
    });
    expect2(await agent().update({ array_field: 123 })).toEqual({
        array_field: 123,
    });
    expect2(await agent().update({ array_field: 1.23456789 })).toEqual({
        array_field: 1.23456789,
    });
    expect2(await agent().update({ array_field: false })).toEqual({
        array_field: false,
    });
    expect2(await agent().update({ array_field: {} })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [array_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'. Preview of field's value: '{}'",
    );

    // array_field 내부 요소 타입 변경 테스트
    expect2(await agent().update({ array_field: [] })).toEqual({
        array_field: [],
    });
    expect2(await agent().update({ array_field: ['a'] })).toEqual({
        array_field: ['a'],
    });
    expect2(await agent().update({ array_field: ['a', 1] })).toEqual({
        array_field: ['a', 1],
    });
    expect2(await agent().update({ array_field: [null] })).toEqual({
        array_field: [null],
    });
    expect2(await agent().update({ array_field: [''] })).toEqual({
        array_field: [''],
    });
    expect2(await agent().update({ array_field: [1.1] })).toEqual({
        array_field: [1.1],
    });
    expect2(await agent().update({ array_field: [{ b: 'a' }] })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [array_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'. Preview of field's value: '{b=a}'",
    );

    // nested_field 내부 요소 타입 변경 테스트
    expect2(await agent().update({ nested_field: [{ sub1_field: 'string' }] })).toEqual({
        nested_field: [{ sub1_field: 'string' }],
    });
    expect2(await agent().update({ nested_field: [{ sub1_field: 123 }] })).toEqual({
        nested_field: [{ sub1_field: 123 }],
    });
    expect2(await agent().update({ nested_field: [{ sub1_field: 1.23 }] })).toEqual({
        nested_field: [{ sub1_field: 1.23 }],
    });
    expect2(await agent().update({ nested_field: [{ sub1_field: false }] })).toEqual({
        nested_field: [{ sub1_field: false }],
    });
    expect2(await agent().update({ nested_field: [{ sub1_field: null }] })).toEqual({
        nested_field: [{ sub1_field: null }],
    });
    expect2(await agent().update({ nested_field: [{ sub1_field: '' }] })).toEqual({
        nested_field: [{ sub1_field: '' }],
    });
    expect2(await agent().update({ nested_field: [{ sub1_field: { inner: 'object' } }] })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [nested_field.sub1_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [nested_field.sub1_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [nested_field.sub1_field] of type [text] in document with id 'A0'. Preview of field's value: '{inner=object}'",
    );

    // object_field 내부 요소 타입 변경 테스트
    expect2(await agent().update({ object_field: { sub_field: 'string' } })).toEqual({
        object_field: { sub_field: 'string' },
    });
    expect2(await agent().update({ object_field: { sub_field: 123 } })).toEqual({
        object_field: { sub_field: 123 },
    });
    expect2(await agent().update({ object_field: { sub_field: 1.23 } })).toEqual({
        object_field: { sub_field: 1.23 },
    });
    expect2(await agent().update({ object_field: { sub_field: false } })).toEqual({
        object_field: { sub_field: false },
    });
    expect2(await agent().update({ object_field: { sub_field: null } })).toEqual({
        object_field: { sub_field: null },
    });
    expect2(await agent().update({ object_field: { sub_field: '' } })).toEqual({
        object_field: { sub_field: '' },
    });
    expect2(await agent().update({ object_field: { sub_field: { inner: 'object' } } })).toEqual(
        service.isOldES6
            ? '400 MAPPER PARSING - failed to parse [object_field.sub_field]'
            : service.isOldES71
            ? "400 MAPPER PARSING - failed to parse field [object_field.sub_field] of type [text] in document with id 'A0'"
            : "400 MAPPER PARSING - failed to parse field [object_field.sub_field] of type [text] in document with id 'A0'. Preview of field's value: '{inner=object}'",
    );

    //* verify the mapping condition doesn't change. (`_mapping`)
    const mapping2 = await service.getIndexMapping();

    // formatting mappings
    const properties2 = service.isOldES6 ? mapping2?._doc?.properties : mapping2?.properties;
    const fieldsWithTypes2 = getFieldTypes(properties2);

    // verify mapping types
    expect2(fieldsWithTypes2).toEqual(expectedMapping);
};

/**
 * perform auto-indexing tests
 * @param service - Elasticsearch service instance.
 */

export const autoIndexingTest = async (service: Elastic6Service<any>): Promise<void> => {
    //* auto-indexing w/ tokenizer. keyword (basic), hangul
    expect2(
        await service.saveItem('A7', { name: 'A7 for auto indexing test', count: 10 }).catch(GETERR),
        '!_version',
    ).toEqual({
        _id: 'A7',
        $id: 'A7',
        name: 'A7 for auto indexing test',
        count: 10,
    });

    expect2(await service.saveItem('A8', { name: '한글 테스트', count: 20 }).catch(GETERR), '!_version').toEqual({
        _id: 'A8',
        $id: 'A8',
        name: '한글 테스트',
        count: 20,
    });
    expect2(
        await service.saveItem('A9', { name: 'A9 for auto indexing test', count: 30 }).catch(GETERR),
        '!_version',
    ).toEqual({
        _id: 'A9',
        $id: 'A9',
        name: 'A9 for auto indexing test',
        count: 30,
    });

    expect2(await service.saveItem('A10', { name: 'A10 한글 테스트', count: 40 }).catch(GETERR), '!_version').toEqual({
        _id: 'A10',
        $id: 'A10',
        name: 'A10 한글 테스트',
        count: 40,
    });

    // refresh index
    await service.refreshIndex();

    // test for keyword(auto-indexing)
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

    expect2(await service.search($search).catch(GETERR)).toEqual({
        aggregations: {
            indexing: {
                buckets: [
                    { doc_count: 1, key: 10 },
                    { doc_count: 1, key: 30 },
                ],
                doc_count_error_upper_bound: 0,
                sum_other_doc_count: 0,
            },
        },
        last: [0, 30],
        list: [
            {
                $id: 'A7',
                _id: 'A7',
                _score: 0,
                count: 10,
                name: 'A7 for auto indexing test',
            },
            {
                $id: 'A9',
                _id: 'A9',
                _score: 0,
                count: 30,
                name: 'A9 for auto indexing test',
            },
        ],
        total: 2,
    });
    // test for hangul(auto-indexing)
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

    expect2(await service.search($search2).catch(GETERR)).toEqual({
        aggregations: {
            indexing: {
                buckets: [
                    { doc_count: 1, key: 20 },
                    { doc_count: 1, key: 40 },
                ],
                doc_count_error_upper_bound: 0,
                sum_other_doc_count: 0,
            },
        },
        last: [0, 40],
        list: [
            {
                $id: 'A8',
                _id: 'A8',
                _score: 0,
                count: 20,
                name: '한글 테스트',
            },
            {
                $id: 'A10',
                _id: 'A10',
                _score: 0,
                count: 40,
                name: 'A10 한글 테스트',
            },
        ],
        total: 2,
    });
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
        const bulkResponse: ApiResponse<BulkResponseBody, any> = await service.client
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

interface TestList {
    _id: string;
    id: string;
    _score: number;
    name: string;
    count: number;
    company: string;
    department: string;
    salary: number;
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

    const res = await bulkDummyData(service, 3, 5000);
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
    const expectedSearchResults: Array<TestList> = [
        {
            id: 'employee 1',
            name: 'Jordan Parker Reed',
            department: 'HR',
            salary: 5000,
            count: 1,
            company: 'B',
            _id: 'employee 1',
            _score: 0,
        },
        {
            id: 'employee 10',
            name: 'Casey Blake Cameron',
            department: 'Admin',
            salary: 16000,
            count: 0,
            company: 'B',
            _id: 'employee 10',
            _score: 0,
        },
        {
            id: 'employee 100',
            name: 'Morgan Blake Bailey',
            department: 'Admin',
            salary: 16000,
            count: 0,
            company: 'B',
            _id: 'employee 100',
            _score: 0,
        },
    ];
    expect2(() => searchAggregation.aggregations).toEqual({
        indexing: {
            buckets: [
                { doc_count: 2000, key: 0 },
                { doc_count: 2000, key: 1 },
                { doc_count: 2000, key: 2 },
                { doc_count: 2000, key: 3 },
                { doc_count: 2000, key: 4 },
                { doc_count: 2000, key: 5 },
                { doc_count: 2000, key: 6 },
                { doc_count: 2000, key: 7 },
                { doc_count: 2000, key: 8 },
                { doc_count: 2000, key: 9 },
            ],
            doc_count_error_upper_bound: 0,
            sum_other_doc_count: 0,
        },
    });
    expect2(() => searchAggregation.list).toEqual(expectedSearchResults);
    expect2(() => searchAggregation.last).toEqual([0, `${expectedSearchResults[expectedSearchResults.length - 1].id}`]);

    // //* test scanAll with 20,000 data
    // const allResults = await service
    //     .searchAll($search, { retryOptions: { do: true, t: 10000, maxRetries: 100 } })
    //     .catch(GETERR);
    // expect2(() => allResults.length).toEqual(20000);
    // const allResultsSlice = allResults.slice(0, expectedSearchResults.length);
    // expect2(() => allResultsSlice).toEqual(searchAggregation.list);
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

    const byCompanyResult: SearchResponse = await service.search($companyAggregation);
    const expectedTermsAggregation = {
        employees_per_company: {
            buckets: [
                { doc_count: 6667, key: 'B' },
                { doc_count: 6667, key: 'C' },
                { doc_count: 6666, key: 'A' },
            ],
            doc_count_error_upper_bound: 0,
            sum_other_doc_count: 0,
        },
    };

    expect2(() => byCompanyResult.aggregations).toEqual(expectedTermsAggregation);

    const byCompanyDepartmentResult: SearchResponse = await service.search($companyDepartmentAggregation);
    const expectedTerms2Aggregation = {
        employees_per_company: {
            buckets: [
                {
                    doc_count: 6667,
                    employees_per_department: {
                        buckets: [
                            { doc_count: 667, key: 'Admin' },
                            { doc_count: 667, key: 'HR' },
                            { doc_count: 667, key: 'Logistics' },
                            { doc_count: 667, key: 'Marketing' },
                            { doc_count: 667, key: 'Production' },
                            { doc_count: 667, key: 'R&D' },
                            { doc_count: 667, key: 'Sales' },
                            { doc_count: 666, key: 'Finance' },
                            { doc_count: 666, key: 'IT' },
                            { doc_count: 666, key: 'Support' },
                        ],
                        doc_count_error_upper_bound: 0,
                        sum_other_doc_count: 0,
                    },
                    key: 'B',
                },
                {
                    doc_count: 6667,
                    employees_per_department: {
                        buckets: [
                            { doc_count: 667, key: 'Admin' },
                            { doc_count: 667, key: 'Finance' },
                            { doc_count: 667, key: 'HR' },
                            { doc_count: 667, key: 'IT' },
                            { doc_count: 667, key: 'Production' },
                            { doc_count: 667, key: 'Sales' },
                            { doc_count: 667, key: 'Support' },
                            { doc_count: 666, key: 'Logistics' },
                            { doc_count: 666, key: 'Marketing' },
                            { doc_count: 666, key: 'R&D' },
                        ],
                        doc_count_error_upper_bound: 0,
                        sum_other_doc_count: 0,
                    },
                    key: 'C',
                },
                {
                    doc_count: 6666,
                    employees_per_department: {
                        buckets: [
                            { doc_count: 667, key: 'Finance' },
                            { doc_count: 667, key: 'IT' },
                            { doc_count: 667, key: 'Logistics' },
                            { doc_count: 667, key: 'Marketing' },
                            { doc_count: 667, key: 'R&D' },
                            { doc_count: 667, key: 'Support' },
                            { doc_count: 666, key: 'Admin' },
                            { doc_count: 666, key: 'HR' },
                            { doc_count: 666, key: 'Production' },
                            { doc_count: 666, key: 'Sales' },
                        ],
                        doc_count_error_upper_bound: 0,
                        sum_other_doc_count: 0,
                    },
                    key: 'A',
                },
            ],
            doc_count_error_upper_bound: 0,
            sum_other_doc_count: 0,
        },
    };
    expect2(byCompanyDepartmentResult.aggregations).toEqual(expectedTerms2Aggregation);
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

    const expectedKeywordAggregation = {
        employees_with_name_Jordan_per_company: {
            buckets: [
                { doc_count: 834, key: 'B' },
                { doc_count: 833, key: 'A' },
                { doc_count: 833, key: 'C' },
            ],
            doc_count_error_upper_bound: 0,
            sum_other_doc_count: 0,
        },
    };
    const expectedKeywordList: Array<TestList> = [
        {
            _id: 'employee 1',
            _score: 0,
            company: 'B',
            count: 1,
            department: 'HR',
            id: 'employee 1',
            name: 'Jordan Parker Reed',
            salary: 5000,
        },
        {
            _id: 'employee 10001',
            _score: 0,
            company: 'C',
            count: 1,
            department: 'HR',
            id: 'employee 10001',
            name: 'Jordan Hayden Gray',
            salary: 20000,
        },
        {
            _id: 'employee 10009',
            _score: 0,
            company: 'B',
            count: 9,
            department: 'Logistics',
            id: 'employee 10009',
            name: 'Jordan Parker Mason',
            salary: 5000,
        },
    ];

    const keywordSearchResult: SearchResponse = await service.search($keywordSearch);
    expect2(() => keywordSearchResult.aggregations).toEqual(expectedKeywordAggregation);
    expect2(() => keywordSearchResult.list).toEqual(expectedKeywordList);
    expect2(() => keywordSearchResult.last).toEqual([0, `${expectedKeywordList[expectedKeywordList.length - 1].id}`]);
    expect2(() => keywordSearchResult.total).toEqual(2500);

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
    const expectedMatchList: Array<TestList> = [
        {
            _id: 'employee 1001',
            _score: 2.0919745,
            company: 'C',
            count: 1,
            department: 'HR',
            id: 'employee 1001',
            name: 'Jordan Hayden Harper',
            salary: 20000,
        },
        {
            _id: 'employee 10041',
            _score: 2.0919745,
            company: 'A',
            count: 1,
            department: 'HR',
            id: 'employee 10041',
            name: 'Jordan Reese Cameron',
            salary: 11500,
        },
        {
            _id: 'employee 10073',
            _score: 2.0919745,
            company: 'C',
            count: 3,
            department: 'Marketing',
            id: 'employee 10073',
            name: 'Jordan Hayden Harper',
            salary: 20000,
        },
    ];
    const expectedMatchList6: Array<TestList> = [
        {
            _id: 'employee 10033',
            _score: 2.0947309,
            company: 'B',
            count: 3,
            department: 'Marketing',
            id: 'employee 10033',
            name: 'Jordan Parker Bailey',
            salary: 5000,
        },
        {
            _id: 'employee 10089',
            _score: 2.0947309,
            company: 'A',
            count: 9,
            department: 'Logistics',
            id: 'employee 10089',
            name: 'Jordan Reese Bailey',
            salary: 11500,
        },
        {
            _id: 'employee 10121',
            _score: 2.0947309,
            company: 'C',
            count: 1,
            department: 'HR',
            id: 'employee 10121',
            name: 'Jordan Hayden Mason',
            salary: 20000,
        },
    ];

    const matchSearchResult: SearchResponse = await service.search($matchSearch);
    expect2(() => matchSearchResult.aggregations).toEqual(expectedKeywordAggregation);
    if (service.isOldES6) {
        /* sorted by the _score calculated using the TF-IDF algorithm */
        expect2(() => matchSearchResult.list).toEqual(expectedMatchList6);
        expect2(() => matchSearchResult.last).toEqual([
            expectedMatchList6[expectedMatchList6.length - 1]._score,
            `${expectedMatchList6[expectedMatchList6.length - 1].id}`,
        ]);
    } else {
        /* sorted by the _score calculated using the BM25 algorithm */
        expect2(() => matchSearchResult.list).toEqual(expectedMatchList);
        expect2(() => matchSearchResult.last).toEqual([
            expectedMatchList[expectedMatchList.length - 1]._score,
            `${expectedMatchList[expectedMatchList.length - 1].id}`,
        ]);
    }
    expect2(() => matchSearchResult.total).toEqual(keywordSearchResult.total);

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
    const expectedRangeAggregation = {
        employees_in_salary_range_per_company: {
            buckets: [
                { doc_count: 3333, key: 'A' },
                { doc_count: 3333, key: 'B' },
                { doc_count: 3333, key: 'C' },
            ],
            doc_count_error_upper_bound: 0,
            sum_other_doc_count: 0,
        },
    };
    const expectedRangeList: Array<TestList> = [
        {
            _id: 'employee 10005',
            _score: 0,
            company: 'A',
            count: 5,
            department: 'IT',
            id: 'employee 10005',
            name: 'Quinn Reese Bailey',
            salary: 11500,
        },
        {
            _id: 'employee 10011',
            _score: 0,
            company: 'A',
            count: 1,
            department: 'HR',
            id: 'employee 10011',
            name: 'Riley Reese Reed',
            salary: 11500,
        },
        {
            _id: 'employee 10017',
            _score: 0,
            company: 'A',
            count: 7,
            department: 'Production',
            id: 'employee 10017',
            name: 'Jordan Reese Harper',
            salary: 11500,
        },
    ];
    const rangeSearchResult: SearchResponse = await service.search($rangeSearch);
    expect2(() => rangeSearchResult.aggregations).toEqual(expectedRangeAggregation);
    expect2(() => rangeSearchResult.list).toEqual(expectedRangeList);
    expect2(() => rangeSearchResult.last).toEqual([
        0,
        expectedRangeList[expectedRangeList.length - 1].salary,
        `${expectedRangeList[expectedRangeList.length - 1].id}`,
    ]);
    expect2(() => rangeSearchResult.total).toEqual(9999);

    //* 3. Test 'exists; field(mapping관련, null, '', [], {}), keyword'
    await service.saveItem('empty 1', {
        id: 'empty 1',
        name: null,
        company: null,
        department: null,
        salary: null,
    });

    await service.saveItem('empty 2', { id: 'empty 2' });

    await service.saveItem('empty 3', {
        id: 'empty 3',
        name: '',
        company: '',
        department: '',
        salary: '',
    });
    await service.saveItem('empty 4', {
        id: 'empty 4',
        name: [],
        company: [],
        department: [],
        salary: [],
    });

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

    expect2(await service.search($nullFieldTest).catch(GETERR)).toEqual({
        aggregations: {
            employees_with_empty_field: {
                buckets: [
                    { doc_count: 1, key: 'empty 1' },
                    { doc_count: 1, key: 'empty 2' },
                    { doc_count: 1, key: 'empty 3' },
                    { doc_count: 1, key: 'empty 4' },
                ],
                doc_count_error_upper_bound: 0,
                sum_other_doc_count: 0,
            },
        },
        last: undefined,
        list: [
            {
                $id: 'empty 1',
                _id: 'empty 1',
                _score: 0,
                company: null,
                department: null,
                id: 'empty 1',
                name: null,
                salary: null,
            },
            { $id: 'empty 2', _id: 'empty 2', _score: 0, id: 'empty 2' },
            {
                $id: 'empty 3',
                _id: 'empty 3',
                _score: 0,
                company: '',
                department: '',
                id: 'empty 3',
                name: '',
                salary: '',
            },
            {
                $id: 'empty 4',
                _id: 'empty 4',
                _score: 0,
                company: [],
                department: [],
                id: 'empty 4',
                name: [],
                salary: [],
            },
        ],
        total: 4,
    });

    //* check mapping
    const mapping = await service.getIndexMapping();
    expect2(() => (mapping?._doc ? mapping?._doc.properties : mapping?.properties)).toEqual({
        $id: { type: 'keyword', ignore_above: 256 },
        '@version': { type: 'keyword', index: false },
        company: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } }, analyzer: 'hangul' },
        count: { type: 'long' },
        created_at: {
            type: 'date',
            ...(service.isLatestOS2 ? { format: 'strict_date_optional_time||epoch_millis' } : {}),
        },
        deleted_at: {
            type: 'date',
            ...(service.isLatestOS2 ? { format: 'strict_date_optional_time||epoch_millis' } : {}),
        },
        department: {
            type: 'text',
            fields: { keyword: { type: 'keyword', ignore_above: 256 } },
            analyzer: 'hangul',
        },
        id: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } }, analyzer: 'hangul' },
        name: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } }, analyzer: 'hangul' },
        salary: { type: 'long' },
        updated_at: {
            type: 'date',
            ...(service.isLatestOS2 ? { format: 'strict_date_optional_time||epoch_millis' } : {}),
        },
    });
};
////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('Elastic6Service', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    PROFILE && console.info(`! PROFILE =`, PROFILE);

    //! dummy storage service.
    it('should pass basic CRUD w/ dummy', async () => {
        /* eslint-disable prettier/prettier */
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
        expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), '$id,type').toEqual({ $id: 'A0', type: '' });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: '' });
        expect2(await dummy.updateItem('A0', { type: 'account' }).catch(GETERR)).toEqual({ id: 'A0', _version: 1, type: 'account' });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', _version: 1, type: 'account' });
        /* eslint-enable prettier/prettier */
    });

    //! $ERROR parser
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

    //! $ERROR parser
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

    //! test with real server
    it('should pass basic CRUD w/ real server (6.2)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        jest.setTimeout(1200000);

        //* load dummy storage service.
        const { service } = await initService('6.2');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 6, minor: 2, patch: 3 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: true,
            optionVersion: { engine: 'es', major: 6, minor: 2, patch: 0 },
            rootVersion: { engine: 'es', major: 6, minor: 2, patch: 3 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.1)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('7.1');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 1, patch: 1 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: true,
            optionVersion: { engine: 'es', major: 7, minor: 1, patch: 0 },
            rootVersion: { engine: 'es', major: 7, minor: 1, patch: 1 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.2)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('7.2');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 4, patch: 2 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: false,
            optionVersion: { engine: 'es', major: 7, minor: 2, patch: 0 },
            rootVersion: { engine: 'es', major: 7, minor: 4, patch: 2 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.10)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('7.10');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: true,
            optionVersion: { engine: 'es', major: 7, minor: 10, patch: 0 },
            rootVersion: { engine: 'es', major: 7, minor: 10, patch: 2 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ open-search server(1.1)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('1.1');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: false,
            optionVersion: { engine: 'os', major: 1, minor: 1, patch: 0 },
            rootVersion: { engine: 'es', major: 7, minor: 10, patch: 2 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ open-search server(1.2)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service } = await initService('1.2');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: false,
            optionVersion: { engine: 'os', major: 1, minor: 2, patch: 0 },
            rootVersion: { engine: 'es', major: 7, minor: 10, patch: 2 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ open-search server(2.13)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        jest.setTimeout(1200000);
        //* load dummy storage service.
        const { service } = await initService('2.13');

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        //* version check w/root
        expect2(() => service.getVersion()).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });
        expect2(() => service.executeSelfTest()).toEqual({
            isEqual: false,
            optionVersion: { engine: 'os', major: 2, minor: 13, patch: 0 },
            rootVersion: { engine: 'es', major: 7, minor: 10, patch: 2 },
        });

        await setupIndex(service);

        await basicCRUDTest(service);

        await basicSearchTest(service);

        await autoIndexingTest(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummaryTest(service);

        await aggregationTest(service);

        await searchFilterTest(service);
    });
});
