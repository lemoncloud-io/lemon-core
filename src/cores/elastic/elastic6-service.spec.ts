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
import { Elastic6Service, DummyElastic6Service, Elastic6Option, $ERROR, ParsedVersion } from './elastic6-service';
import { ApiResponse } from '@elastic/elasticsearch';

/**
 * default endpoints url.
 * - use ssh tunneling to make connection to real server instance.
 */
const ENDPOINTS = {
    //* elastic-search */
    '6.2': 'https://localhost:8443', // run alias lmes62
    '6.8': 'https://localhost:8683', // run alias lmes68
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
    const service: Elastic6Service<MyModel> = new Elastic6Service<MyModel>(options);
    const dummy: Elastic6Service<GeneralItem> = new DummyElastic6Service<MyModel>('dummy-elastic6-data.yml', options);
    return { version, service, dummy, options };
};

/**
 * initialize the service with the specified version.
 * @param ver - version of the Elasticsearch service.
 * @returns object containing the initialized service and its options.
 */
export const initService = async (
    ver: VERSIONS,
): Promise<{ service: Elastic6Service<MyModel>; options: Elastic6Option }> => {
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
    const parsedVersion: ParsedVersion = service.parseVersion('12345');
    expect(parsedVersion).toEqual({ error: '@version[12345] is invalid - fail to parse', major: 12345 });

    return { service, options };
};

/**
 * set up the index.
 * @param service - Elasticsearch service instance.
 * @param indexName - the name of the index to be set up.
 */
export const setupIndex = async (service: Elastic6Service<MyModel>, indexName: string): Promise<void> => {
    const PASS = (e: any) => e;

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
    // expect2(await service.saveItem('A0', A0).catch(PASS)).toEqual();
    expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, _id: 'A0', _version: 2 });

    //* try to update fields.
    expect2(await service.updateItem('A0', { type: 'test' }, { count: 1 }).catch(GETERR)).toEqual(
        `400 ACTION REQUEST VALIDATION - Validation Failed: 1: can't provide both script and doc;`,
    );

    expect2(await service.updateItem('A0', { type: 'test' }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 3,
        type: 'test',
    });

    //* try to increment fields
    expect2(await service.updateItem('A0', null, { count: 0 }).catch(GETERR)).toEqual(
        '400 ILLEGAL ARGUMENT - failed to execute script',
    );
    expect2(await service.updateItem('A0', { count: 0 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 4,
        count: 0,
    });
    expect2(await service.updateItem('A0', null, { count: 0 }).catch(GETERR)).toEqual({
        _id: 'A0',
        _version: 5,
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
 * @param service - Elasticsearch service instance.
 * @param indexName - the name of the index to search.
 */
export const basicSearchTest = async (service: Elastic6Service<MyModel>, indexName: string): Promise<void> => {
    const parsedVersion: ParsedVersion = service.parsedVersion;
    const version = parsedVersion.major;
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
                    _source: { $id: 'A0', name: 'a0', type: 'test', count: 0 },
                    ...(service.version >= 2 && service.isOpenSearch ? {} : { _type: '_doc' }),
                    sort: [0],
                },
            ],
            max_score: null,
            total: version < 7 ? 2 : { relation: 'eq', value: 2 },
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
        list: [{ _id: 'A0', _score: null, $id: 'A0', count: 0, name: 'a0', type: 'test' }],
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
 * clean up the test items
 * @param service - Elasticsearch service instance.
 */
export const cleanup = async (service: Elastic6Service<MyModel>): Promise<void> => {
    expect2(await service.deleteItem('A0').catch(GETERR)).toEqual({ _id: 'A0', _version: 6 });
    expect2(await service.deleteItem('A1').catch(GETERR)).toEqual({ _id: 'A1', _version: 2 });
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

    expect2(await service.updateItem('A0', null, { count: 2 }).catch(GETERR), '!_version').toEqual(
        // '400 INVALID FIELD - id:A0',
        '400 ILLEGAL ARGUMENT - failed to execute script',
    ); // no `.count` property.
    expect2(await service.updateItem('A0', { count: 10 }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        count: 10,
    });
    expect2(await service.updateItem('A0', null, { count: 2 }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
    });

    //* try to overwrite, and update
    expect2(await service.saveItem('A0', { count: 10, nick: null, name: 'dumm' }).catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        count: 10,
        name: 'dumm',
        nick: null,
    });
    expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
        _id: 'A0',
        $id: 'A0',
        count: 10,
        name: 'dumm',
        nick: null,
        type: '',
    }); // support number, string, null type.

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

    // //TODO - NOT WORKING OVERWRITE WHOLE DOC. SO IMPROVE THIS. >> client.update(param2); 이기 때문
    // expect2(await service.saveItem('A0', { nick: 'name', name: null }).catch(GETERR), '!_version').toEqual({
    //     _id: 'A0',
    //     nick: 'name',
    //     name: null,
    // });
    // expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
    //     _id: 'A0',
    //     $id: 'A0',
    //     nick: 'name',
    //     name: null,
    //     type: '',
    //     count: 10,
    // }); //* `count` should be cleared

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
    const parsedVersion: ParsedVersion = service.parsedVersion;
    const version = parsedVersion.major;
    //* 테스트를 위한 agent 생성
    const agent = <T = any>(id: string = 'A0') => ({
        update: (data: T) =>
            service
                .updateItem(id, data)
                .then(R => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { _version, _id, ...rest } = R;
                    return {
                        ...rest,
                    };
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
    const mapping = await service.getIndexMapping(service.options.indexName);

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
    const properties = version < 7 ? mapping?._doc?.properties : mapping?.properties;
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

    //verify getMapping error
    expect2(await service.getIndexMapping('abcd').catch(GETERR)).toEqual('404 NOT FOUND - index:abcd');

    //* test w/mismatched types
    /**
     * string_field
     * string -> {}로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ string_field: null })).toEqual({
        string_field: null,
    });
    expect2(await agent().update({ string_field: 123 })).toEqual({
        string_field: 123,
    });
    expect2(await agent().update({ string_field: 1.23 })).toEqual({
        string_field: 1.23,
    });
    expect2(await agent().update({ string_field: {} })).toEqual(
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ string_field: [] })).toEqual({
        string_field: [],
    });
    expect2(await agent().update({ string_field: [1, 2, 3] })).toEqual({
        string_field: [1, 2, 3],
    });
    expect2(await agent().update({ string_field: false })).toEqual({
        string_field: false,
    });

    /**
     * long_field
     * long -> object로 업데이트시 오류 발생
     * long -> boolean으로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ long_field: null })).toEqual({
        long_field: null,
    });
    expect2(await agent().update({ long_field: '1234567890123' })).toEqual({
        long_field: '1234567890123',
    });
    expect2(await agent().update({ long_field: 1.234567890123 })).toEqual({
        long_field: 1.234567890123,
    });
    expect2(await agent().update({ long_field: {} })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [long_field] of type [long] in document with id 'A0'. Preview of field's value: '{}'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ long_field: [] })).toEqual({
        long_field: [],
    });
    expect2(await agent().update({ long_field: [1, 2, 3] }), '!_version').toEqual({
        long_field: [1, 2, 3],
    });
    expect2(await agent().update({ long_field: false })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [long_field] of type [long] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );

    /**
     * float_field
     * float -> object로 업데이트시 오류 발생
     * float -> -> boolean으로 업데이트시 오류 발생
     * */
    expect2(await agent().update({ float_field: null })).toEqual({
        float_field: null,
    });
    expect2(await agent().update({ float_field: '123.45' })).toEqual({
        float_field: '123.45',
    });
    expect2(await agent().update({ float_field: 123456789 })).toEqual({
        float_field: 123456789,
    });
    expect2(await agent().update({ float_field: {} })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [float_field] of type [float] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ float_field: [] })).toEqual({
        float_field: [],
    });
    expect2(await agent().update({ float_field: [1, 2, 3] })).toEqual({
        float_field: [1, 2, 3],
    });
    expect2(await agent().update({ float_field: false })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [float_field] of type [float] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );

    /**
     * data_field
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
    if (version < 7) {
        expect2(await agent().update({ date_field: 1.23456789 })).toEqual({
            date_field: 1.23456789,
        });
    } else {
        expect2(await agent().update({ date_field: 1.23456789 })).toEqual(
            // "400 MAPPER PARSING - failed to parse field [date_field] of type [date] in document with id 'A0'",
            expect.stringContaining('400 MAPPER PARSING - failed to parse'),
        );
    }
    expect2(await agent().update({ date_field: {} })).toEqual(
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ date_field: [] })).toEqual({
        date_field: [],
    });
    expect2(await agent().update({ date_field: [1, 2, 3] })).toEqual({
        date_field: [1, 2, 3],
    });
    expect2(await agent().update({ date_field: false })).toEqual(
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
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
    expect2(await agent().update({ boolean_field: 'true' })).toEqual({
        boolean_field: 'true',
    });

    expect2(await agent().update({ boolean_field: 123456789 })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [boolean_field] of type [boolean] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ boolean_field: 1.23456789 })).toEqual(
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ boolean_field: {} })).toEqual(
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ boolean_field: [] })).toEqual({
        boolean_field: [],
    });
    expect2(await agent().update({ boolean_field: [1, 2, 3] })).toEqual(
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );

    /**
     * object_field
     * object -> string으로 업데이트시 오류 발생
     * object -> number로 업데이트시 오류 발생
     * object -> []로 업데이트시 오류 발생
     * object -> [1, 2, 3]으로 업데이트시 오류 발생.
     * object -> boolean으로 업데이트시 오류 발생.
     * */
    expect2(await agent().update({ object_field: null })).toEqual({
        object_field: null,
    });
    expect2(await agent().update({ object_field: 'string' })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [object_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ object_field: 123 })).toEqual(
        '400 MAPPER PARSING - object mapping for [object_field] tried to parse field [object_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ object_field: [] })).toEqual({
        object_field: [],
    });
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
     * nested -> boolean으로 업데이트시 오류 발생.
     * */
    expect2(await agent().update({ nested_field: null })).toEqual({
        nested_field: null,
    });
    expect2(await agent().update({ nested_field: { sub1_field: 'string' } })).toEqual({
        nested_field: { sub1_field: 'string' },
    });
    expect2(await agent().update({ nested_field: 'string' })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [nested_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ nested_field: 123 })).toEqual(
        '400 MAPPER PARSING - object mapping for [nested_field] tried to parse field [nested_field] as object, but found a concrete value',
    );
    expect2(await agent().update({ nested_field: [] })).toEqual({
        nested_field: [],
    });
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
    expect2(await agent().update({ array_field: 'string' })).toEqual({
        array_field: 'string',
    });
    expect2(await agent().update({ array_field: 123 })).toEqual({
        array_field: 123,
    });
    expect2(await agent().update({ array_field: 1.23456789 })).toEqual({
        array_field: 1.23456789,
    });
    expect2(await agent().update({ array_field: {} })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );
    expect2(await agent().update({ array_field: false })).toEqual({
        array_field: false,
    });

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
    expect2(await agent().update({ array_field: [1.1] })).toEqual({
        array_field: [1.1],
    });
    expect2(await agent().update({ array_field: [{ b: 'a' }] })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [array_field] of type [text] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
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
    expect2(await agent().update({ nested_field: [{ sub1_field: { inner: 'object' } }] })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [nested_field.sub1_field] of type [text] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
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
    expect2(await agent().update({ object_field: { sub_field: { inner: 'object' } } })).toEqual(
        // "400 MAPPER PARSING - failed to parse field [object_field.sub_field] of type [text] in document with id 'A0'",
        expect.stringContaining('400 MAPPER PARSING - failed to parse'),
    );

    //* verify the mapping condition doesn't change. (`_mapping`)
    const mapping2 = await service.getIndexMapping(service.options.indexName);

    // formatting mappings
    const properties2 = version < 7 ? mapping2?._doc?.properties : mapping2?.properties;
    const fieldsWithTypes2 = getFieldTypes(properties2);

    // verify mapping types
    expect2(fieldsWithTypes2).toEqual(expectedMapping);
};
/**
 * perform auto-indexing tests
 * @param service - Elasticsearch service instance.
 */

export const autoIndexingTest = async (service: Elastic6Service<any>): Promise<void> => {
    const parsedVersion: ParsedVersion = service.parsedVersion;
    const version = parsedVersion.major;
    const indexName = service.options.indexName;

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
                count: {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };

    expect2(await service.searchRaw($search).catch(GETERR), '!took').toEqual({
        _shards: {
            failed: 0,
            skipped: 0,
            successful: 4,
            total: 4,
        },
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
        hits: {
            hits: [
                {
                    _id: 'A7',
                    _index: indexName,
                    _score: null,
                    _source: {
                        $id: 'A7',
                        count: 10,
                        name: 'A7 for auto indexing test',
                    },
                    ...(service.version >= 2 && service.isOpenSearch ? {} : { _type: '_doc' }),
                    sort: [10],
                },
                {
                    _id: 'A9',
                    _index: indexName,
                    _score: null,
                    _source: {
                        $id: 'A9',
                        count: 30,
                        name: 'A9 for auto indexing test',
                    },
                    ...(service.version >= 2 && service.isOpenSearch ? {} : { _type: '_doc' }),
                    sort: [30],
                },
            ],
            max_score: null,
            total: version < 7 ? 2 : { relation: 'eq', value: 2 },
        },
        timed_out: false,
    });

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
        last: [30],
        list: [
            {
                $id: 'A7',
                _id: 'A7',
                _score: null,
                count: 10,
                name: 'A7 for auto indexing test',
            },
            {
                $id: 'A9',
                _id: 'A9',
                _score: null,
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
                count: {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };

    expect2(await service.searchRaw($search2).catch(GETERR), '!took').toEqual({
        _shards: {
            failed: 0,
            skipped: 0,
            successful: 4,
            total: 4,
        },
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
        hits: {
            hits: [
                {
                    _id: 'A8',
                    _index: indexName,
                    _score: null,
                    _source: {
                        $id: 'A8',
                        count: 20,
                        name: '한글 테스트',
                    },
                    ...(service.version >= 2 && service.isOpenSearch ? {} : { _type: '_doc' }),
                    sort: [20],
                },
                {
                    _id: 'A10',
                    _index: indexName,
                    _score: null,
                    _source: {
                        $id: 'A10',
                        count: 40,
                        name: 'A10 한글 테스트',
                    },
                    ...(service.version >= 2 && service.isOpenSearch ? {} : { _type: '_doc' }),
                    sort: [40],
                },
            ],
            max_score: null,
            total: version < 7 ? 2 : { relation: 'eq', value: 2 },
        },
        timed_out: false,
    });

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
        last: [40],
        list: [
            {
                $id: 'A8',
                _id: 'A8',
                _score: null,
                count: 20,
                name: '한글 테스트',
            },
            {
                $id: 'A10',
                _id: 'A10',
                _score: null,
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
 * perform bulk operations with dummy
 * @param service - Elasticsearch service instance.
 */
export const bulkDummyData = async (service: Elastic6Service<any>): Promise<BulkDummyResponse> => {
    const { indexName } = service.options;

    // create 20000 Items
    const dataset = Array.from({ length: 20000 }, (_, i) => ({
        id: `A${i + 1}`,
        name: `${(i + 1).toString()} 번째 data`,
        count: (i + 1) % 10,
    }));

    // create bulk operations
    const operations = dataset.reduce((acc, doc) => {
        acc.push({
            index: {
                _index: indexName,
                _id: doc.id,
                ...(service.version >= 2 && service.isOpenSearch ? {} : { _type: '_doc' }),
            },
        });
        acc.push(doc);
        return acc;
    }, [] as Array<{ index: { _index: string; _id: string; _type?: string } } | { id: string; name: string; count: number }>);

    // bulk
    const bulkResponse: ApiResponse<BulkResponseBody, any> = await service.client
        .bulk({
            refresh: true,
            body: operations,
        })
        .catch(
            $ERROR.handler('bulk', e => {
                throw e;
            }),
        );
    const bulkDummyResponse: BulkDummyResponse = {
        errors: bulkResponse?.body?.errors,
        items: bulkResponse?.body?.items,
        took: bulkResponse?.body?.took,
        statusCode: bulkResponse?.statusCode,
    };
    return bulkDummyResponse;
};
/**
 * perform total summary with 20,000 data
 * @param service - Elasticsearch service instance.
 */
export const totalSummary = async <T>(service: Elastic6Service<any>) => {
    const res = await bulkDummyData(service);
    expect2(res?.errors).toEqual(false);
    const version = service.parsedVersion?.major;
    //* test search with 20,000 data
    const $search: SearchBody = {
        size: 5,
        query: {
            bool: {
                filter: {
                    term: {
                        name: 'data',
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
                'id.keyword': {
                    order: 'asc',
                    missing: '_last',
                },
            },
        ],
    };
    expect2(await service.search($search).catch(GETERR), '!took').toEqual({
        aggregations: {
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
        },
        last: ['A10000'],
        list: [
            { _id: 'A1', _score: null, count: 1, id: 'A1', name: '1 번째 data' },
            { _id: 'A10', _score: null, count: 0, id: 'A10', name: '10 번째 data' },
            { _id: 'A100', _score: null, count: 0, id: 'A100', name: '100 번째 data' },
            { _id: 'A1000', _score: null, count: 0, id: 'A1000', name: '1000 번째 data' },
            { _id: 'A10000', _score: null, count: 0, id: 'A10000', name: '10000 번째 data' },
        ],
        total: version < 7 ? 20000 : 10000, // version < 7 ? total value is 20,000 : total value is greater than or equal to 10,000
    });
    const searchRawResult = await service.searchRaw($search).then(R => {
        const { _shards, aggregations, hits, timed_out } = R;
        const hitsCustomized = hits.hits.map(
            (hit: {
                _index: string;
                _score: number | null;
                _type?: string;
                _id: string;
                _source: T;
                sort: string[];
            }) => {
                const { _index, _score, _type, ...rest } = hit;
                return rest;
            },
        );
        return {
            _shards,
            aggregations,
            hits: {
                ...hits,
                hits: hitsCustomized,
            },
            timed_out,
        };
    });
    expect2(() => searchRawResult).toEqual({
        _shards: { failed: 0, skipped: 0, successful: 4, total: 4 },
        aggregations: {
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
        },
        hits: {
            hits: [
                { _id: 'A1', _source: { count: 1, id: 'A1', name: '1 번째 data' }, sort: ['A1'] },
                { _id: 'A10', _source: { count: 0, id: 'A10', name: '10 번째 data' }, sort: ['A10'] },
                { _id: 'A100', _source: { count: 0, id: 'A100', name: '100 번째 data' }, sort: ['A100'] },
                { _id: 'A1000', _source: { count: 0, id: 'A1000', name: '1000 번째 data' }, sort: ['A1000'] },
                { _id: 'A10000', _source: { count: 0, id: 'A10000', name: '10000 번째 data' }, sort: ['A10000'] },
            ],
            max_score: null,
            total: version < 7 ? 20000 : { relation: 'gte', value: 10000 }, // version < 7 ? total value is 20,000 : total value is greater than or equal to 10,000
        },
        timed_out: false,
    });
    //* test scanAll with 20,000 data
    const allResults = await service.searchAll($search);
    expect2(allResults.length).toEqual(20000);

    // verify allResults
    const expectedResults: Array<{ _id: string; id: string; _score: null; name: string; count: number }> = [
        { _id: 'A1', _score: null, count: 1, id: 'A1', name: '1 번째 data' },
        { _id: 'A10', _score: null, count: 0, id: 'A10', name: '10 번째 data' },
        { _id: 'A100', _score: null, count: 0, id: 'A100', name: '100 번째 data' },
        { _id: 'A1000', _score: null, count: 0, id: 'A1000', name: '1000 번째 data' },
        { _id: 'A10000', _score: null, count: 0, id: 'A10000', name: '10000 번째 data' },
    ];
    expect2(allResults.slice(0, 5)).toEqual(expectedResults);
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
        const { service, options } = await initService('6.2');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 6, minor: 2 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(6.8)', async () => {
        jest.setTimeout(1200000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service, options } = await initService('6.8');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 10 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.1)', async () => {
        jest.setTimeout(120000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service, options } = await initService('7.1');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 1 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });
    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.2)', async () => {
        jest.setTimeout(120000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service, options } = await initService('7.2');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 4 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.10)', async () => {
        jest.setTimeout(120000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service, options } = await initService('7.10');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 10 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ open-search server(1.1)', async () => {
        jest.setTimeout(12000000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service, options } = await initService('1.1');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 10 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ open-search server(1.2)', async () => {
        jest.setTimeout(12000000);
        // if (!PROFILE) return; // ignore w/o profile
        //* load dummy storage service.
        const { service, options } = await initService('1.2');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 10 });

        //* break if no live connection
        if (!(await canPerformTest(service))) return;

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ open-search server(2.13)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        jest.setTimeout(12000000);
        //* load dummy storage service.
        const { service, options } = await initService('2.13');
        const indexName = options.indexName;
        expect2(() => service.getVersion()).toEqual({ major: 7, minor: 10 });

        //* break if no live connection
        await canPerformTest(service);

        await setupIndex(service, indexName);

        await basicCRUDTest(service);

        await basicSearchTest(service, indexName);

        await autoIndexingTest(service);

        await cleanup(service);

        await detailedCRUDTest(service);

        await mismatchedTypeTest(service);

        await totalSummary(service);
    });
});
