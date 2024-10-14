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
import { GeneralItem, Incrementable, SearchBody } from 'lemon-model';
import { Elastic6Service, DummyElastic6Service, Elastic6Option, $ERROR, Elastic6Item } from './elastic6-service';
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
    //* NOTE - use tunneling to elastic6 endpoint.
    const endpoint = ENDPOINTS[version];
    if (!endpoint) throw new Error(`@version[${version}] is not supported!`);

    // const indexName = `test-v${version}`;
    indexName = indexName ?? `test-v${version}`;
    const idName = '$id'; //! global unique id-name in same index.
    const docType = '_doc'; //! must be `_doc`.
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
    })();

    // dummy for testing Elasticsearch with buffer.
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
        //* unable to access to elastic6 endpoint
        if (GETERR(e).endsWith('unknown error')) return false;
        //* index does not exist
        if (GETERR(e).startsWith('404 NOT FOUND')) return false;
        // console.error('! err =', e);

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
        '400 ILLEGAL ARGUMENT - failed to execute script',
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
        '400 ILLEGAL ARGUMENT - failed to execute script',
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
    //TODO - `_version: _ver()` use lambda to make next version number.

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
        expect2(await dummy.updateItem('A0', null, { stringArr : ['a'], numberArr: [1], count: 3 }).catch(GETERR)).toEqual({ id: 'A0', _version: 2 });
        expect2(await dummy.updateItem('A0', null, { stringArr : ['b'], numberArr : [2], count: 1 }).catch(GETERR)).toEqual({ "_version": 3, "id": "A0" });
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({"_version": 3, "count": 4, "id": "A0", "numberArr": [1, 2], "stringArr": ["a", "b"], "type": "account"});
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(true);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 6, minor: 2, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 6, minor: 2, patch: 3 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(true);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 7, minor: 1, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 1, patch: 1 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 7, minor: 2, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 4, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(true);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'os', major: 1, minor: 1, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'os', major: 1, minor: 2, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
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

        const selfTest = await service.executeSelfTest();
        expect2(() => selfTest.isEqual).toEqual(false);
        expect2(() => selfTest.optionVersion).toEqual({ engine: 'os', major: 2, minor: 13, patch: 0 });
        expect2(() => selfTest.rootVersion).toEqual({ engine: 'es', major: 7, minor: 10, patch: 2 });

        //* run Elastic6Service tests sequentially.
        expect2(await doTest(service).catch(GETERR)).toEqual('pass');
    });
});
