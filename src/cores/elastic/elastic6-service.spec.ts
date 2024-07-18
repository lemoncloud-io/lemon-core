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

/**
 * default endpoints url.
 * - use ssh tunneling to make connection to real server instance.
 */
const ENDPOINTS = {
    '6.2': 'https://localhost:8443', // run alias `lmes62`
    '6.8': 'https://localhost:8683', // run alias `lmes68`
    '7.2': 'https://localhost:9072', //run alias 'lmts072'
    '7.1': 'https://localhost:9710', //run alias 'lmts072'
    '0': 'https://localhost:9213', //run alias 'lmts072'
};
export type VERSIONS = keyof typeof ENDPOINTS;

interface MyModel extends GeneralItem {
    id?: string;
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
    const dummy: Elastic6Service<MyModel> = new DummyElastic6Service<MyModel>('dummy-elastic6-data.yml', options);
    return { version, service, dummy, options };
};

export const canPerformTest = async (service: Elastic6Service<MyModel>): Promise<boolean> => {
    // const { service } = instance();
    // cond 1. localhost is able to access elastic6 endpoint (by tunneling)
    // cond 2. index must be exist
    try {
        await service.listIndices();
        return true;
    } catch (e) {
        if (GETERR(e).includes('ECONNREFUSED')) return false; // no connection.
        // unable to access to elastic6 endpoint
        if (GETERR(e).endsWith('unknown error')) return false;
        // index does not exist
        if (GETERR(e).startsWith('404 NOT FOUND')) return false;
        console.error('! err =', GETERR(e));

        // rethrow
        throw e;
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('Elastic6Service', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    PROFILE && console.info(`! PROFILE =`, PROFILE);

    //! dummy storage service.
    it('should pass basic CRUD w/ dummy', async () => {
        /* eslint-disable prettier/prettier */
        //! load dummy storage service.
        const { dummy } = instance();

        //! check dummy data.
        expect2(() => dummy.hello()).toEqual('dummy-elastic6-service:test-v6.2');
        expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ $id: 'A0', type: 'account', name: 'lemon' });
        expect2(await dummy.readItem('A1'), '$id,type,name').toEqual({ $id: 'A1', type: 'account', name: 'Hong' });

        // //! basic simple CRUD test.
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

        //! parse the origin error.
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

        //! parse the
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

        //! resource exists
        const E1 = loadJsonSync('data/samples/es7.1/create-index.err.json');
        expect2(() => $ERROR.asError(E1)).toEqual({
            message: 'resource_already_exists_exception',
            reason: { status: 400, type: 'RESOURCE ALREADY EXISTS' },
            status: 400,
        });
        expect2(() => $ERROR.handler('test', GETERR)(E1)).toEqual(
            '400 RESOURCE ALREADY EXISTS - resource_already_exists_exception',
        );

        //! 404 not found
        const E2 = loadJsonSync('data/samples/es7.1/read-item.err404.json');
        expect2(() => $ERROR.asError(E2)).toEqual({
            status: 404,
            message: 'Response Error',
            reason: { status: 404, type: 'NOT FOUND' },
        });
        expect2(() => $ERROR.handler('test', GETERR)(E2)).toEqual('404 NOT FOUND - Response Error');

        //! conflict
        const E3 = loadJsonSync('data/samples/es7.1/version-conflict.err.json');
        expect2(() => $ERROR.asError(E3)).toEqual({
            message: 'version_conflict_engine_exception',
            reason: { status: 409, type: 'VERSION CONFLICT ENGINE' },
            status: 409,
        });
        expect2(() => $ERROR.handler('test', GETERR)(E3)).toEqual(
            '409 VERSION CONFLICT ENGINE - version_conflict_engine_exception',
        );
    });

    //! test with real server
    it('should pass basic CRUD w/ real server (ES6.2~7.x)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        jest.setTimeout(12000);
        const PASS = (e: any) => e;

        //! load dummy storage service.
        const ver = ['6.2', '6.8', '7.1', '7.2', '0'][3] as VERSIONS;
        const { service, options } = instance(ver);
        const { indexName, idName } = options;

        expect2(() => service.hello()).toEqual(`elastic6-service:${indexName}:${ver}`);
        expect2(() => idName).toEqual('$id');
        expect2(() => indexName).toEqual(`test-v${ver}`);
        expect2(() => service.version).toEqual(parseFloat(ver));

        //! break if no live connection
        if (!(await canPerformTest(service))) return;

        // const expectedDesc = loadJsonSync('data/samples/es7.1/describe-ok.json');
        // expect2(await service.describe().catch(PASS)).toEqual(expectedDesc);

        //! make sure the index destroyed.
        const $old = await service.findIndex(indexName);
        if ($old) {
            expect2(() => $old, 'index').toEqual({ index: indexName });
            expect2(await service.destroyIndex().catch(PASS)).toEqual({
                status: 200,
                acknowledged: true,
                index: indexName,
            });
            await waited(50);
        }

        // expect2(await service.destroyIndex().catch(PASS)).toEqual();
        // expect2(await service.refreshIndex().catch(PASS)).toEqual();
        // expect2(await service.flushIndex().catch(PASS)).toEqual();
        // expect2(await service.describe().catch(PASS)).toEqual();

        // expect2(await service.destroyIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        // expect2(await service.refreshIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        // expect2(await service.flushIndex().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);
        // expect2(await service.describe().catch(GETERR)).toEqual(`404 NOT FOUND - index:${indexName}`);

        //! make sure the index created
        expect2(await service.createIndex().catch(PASS)).toEqual({ status: 200, acknowledged: true, index: indexName });
        await waited(200);
        // expect2(await service.createIndex().catch(PASS)).toEqual(`400 IN USE - index:${indexName}`);
        expect2(await service.createIndex().catch(GETERR)).toEqual(`400 IN USE - index:${indexName}`);

        //! for debugging.
        // expect2(await service.readItem('A0').catch(PASS)).toEqual();
        // expect2(await service.deleteItem('A0').catch(PASS)).toEqual();
        // expect2(await service.updateItem('A0', {}).catch(PASS)).toEqual();

        expect2(await service.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
        expect2(await service.deleteItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
        expect2(await service.updateItem('A0', {}).catch(GETERR)).toEqual('404 NOT FOUND - id:A0');

        //! create new item
        const A0 = { type: '', name: 'a0' };
        expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, $id: 'A0', _id: 'A0', _version: 2 });
        // expect2(await service.saveItem('A0', A0).catch(PASS)).toEqual();
        expect2(await service.saveItem('A0', A0).catch(GETERR)).toEqual({ ...A0, _id: 'A0', _version: 2 });

        //! try to update fields.
        expect2(await service.updateItem('A0', { type: 'test' }, { count: 1 }).catch(GETERR)).toEqual(
            `400 ACTION REQUEST VALIDATION - action_request_validation_exception`,
        );

        expect2(await service.updateItem('A0', { type: 'test' }).catch(GETERR)).toEqual({
            _id: 'A0',
            _version: 3,
            type: 'test',
        });

        //! try to increment fields
        //claire[6.2]: 버전이 7이하임에도 '400 ILLEGAL ARGUMENT - illegal_argument_exception'
        expect2(await service.updateItem('A0', null, { count: 0 }).catch(GETERR)).toEqual(
            service.version < 7 ? '400 INVALID FIELD - id:A0' : '400 ILLEGAL ARGUMENT - illegal_argument_exception',
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

        //! save A1
        expect2(await service.saveItem('A1', { type: 'test', count: 1 }).catch(GETERR)).toEqual({
            $id: 'A1',
            _id: 'A1',
            _version: 1,
            count: 1,
            type: 'test',
        });

        ///////////////////////////
        //! try to search...
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
                        _type: '_doc',
                        sort: [0],
                    },
                ],
                max_score: null,
                total: service.version < 7 ? 2 : { relation: 'eq', value: 2 },
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

        ///////////////////////////
        //! try to delete(cleanup).
        expect2(await service.deleteItem('A0').catch(GETERR)).toEqual({ _id: 'A0', _version: 6 });
        expect2(await service.deleteItem('A1').catch(GETERR)).toEqual({ _id: 'A1', _version: 2 });
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(6.2)', async () => {
        // if (!PROFILE) return; // ignore w/o profile
        //! load dummy storage service.
        const { service, version } = instance('6.2');

        //! check service identity
        expect2(() => service.hello()).toEqual(`elastic6-service:test-v${version}:${version}`);

        // skip test if some prerequisites are not satisfied
        // 1. localhost is able to access elastic6 endpoint (by tunneling)
        // 2. index must be exist
        if (!(await canPerformTest(service))) return;

        //! make sure deleted.
        await service.deleteItem('A0').catch(GETERR);
        await service.deleteItem('A1').catch(GETERR);

        //! make sure empty index.
        expect2(await service.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
        expect2(await service.readItem('A1').catch(GETERR)).toEqual('404 NOT FOUND - id:A1');

        //! save to A0
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
            '400 ILLEGAL ARGUMENT - illegal_argument_exception',
        ); // no `.count` property.
        expect2(await service.updateItem('A0', { count: 10 }).catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            count: 10,
        });
        expect2(await service.updateItem('A0', null, { count: 2 }).catch(GETERR), '!_version').toEqual({
            _id: 'A0',
        });

        //! try to overwrite, and update
        expect2(
            await service.saveItem('A0', { count: 10, nick: null, name: 'dumm' }).catch(GETERR),
            '!_version',
        ).toEqual({ _id: 'A0', count: 10, name: 'dumm', nick: null });
        expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            $id: 'A0',
            count: 10,
            name: 'dumm',
            nick: null,
            type: '',
        }); // support number, string, null type.

        expect2(await service.updateItem('A0', { nick: 'dumm', name: null }).catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            nick: 'dumm',
            name: null,
        });
        expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            $id: 'A0',
            count: 10,
            nick: 'dumm',
            name: null,
            type: '',
        }); //! count should be remained

        //TODO - NOT WORKING OVERWRITE WHOLE DOC. SO IMPROVE THIS.
        // expect2(await service.saveItem('A0', { nick:'name', name:null }).catch(GETERR), '!_version').toEqual({ _id:'A0', nick:'name', name: null });
        // expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({ _id:'A0', id:'A0', nick:'name', name:null, type:'' });               //! `count` should be cleared

        //! delete
        expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual({ _id: 'A0' });
        expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual('404 NOT FOUND - id:A0');

        //! try to update A1 (which does not exist)
        expect2(await service.updateItem('A1', { name: 'b0' }).catch(GETERR), '!_version').toEqual(
            '404 NOT FOUND - id:A1',
        );
    });

    //! elastic storage service.
    it('should pass basic CRUD w/ real server(7.1)', async () => {
        if (!PROFILE) return; // ignore w/o profile
        //! load dummy storage service.
        const { service, version } = instance('7.1');

        //! check service identity
        expect2(() => service.hello()).toEqual(`elastic6-service:test-v${version}:${version}`);

        // skip test if some prerequisites are not satisfied
        // 1. localhost is able to access elastic6 endpoint (by tunneling)
        // 2. index must be exist
        if (!(await canPerformTest(service))) return;

        //! make sure deleted.
        await service.deleteItem('A0').catch(GETERR);
        await service.deleteItem('A1').catch(GETERR);

        //! make sure empty index.
        expect2(await service.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
        expect2(await service.readItem('A1').catch(GETERR)).toEqual('404 NOT FOUND - id:A1');

        //! save to A0
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
            '400 ILLEGAL ARGUMENT - illegal_argument_exception',
        ); // no `.count` property.
        expect2(await service.updateItem('A0', { count: 10 }).catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            count: 10,
        });
        expect2(await service.updateItem('A0', null, { count: 2 }).catch(GETERR), '!_version').toEqual({
            _id: 'A0',
        });

        //! try to overwrite, and update
        expect2(
            await service.saveItem('A0', { count: 10, nick: null, name: 'dumm' }).catch(GETERR),
            '!_version',
        ).toEqual({ _id: 'A0', count: 10, name: 'dumm', nick: null });
        expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            $id: 'A0',
            count: 10,
            name: 'dumm',
            nick: null,
            type: '',
        }); // support number, string, null type.

        expect2(await service.updateItem('A0', { nick: 'dumm', name: null }).catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            nick: 'dumm',
            name: null,
        });
        expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({
            _id: 'A0',
            $id: 'A0',
            count: 10,
            nick: 'dumm',
            name: null,
            type: '',
        }); //! count should be remained

        //TODO - NOT WORKING OVERWRITE WHOLE DOC. SO IMPROVE THIS.
        // expect2(await service.saveItem('A0', { nick:'name', name:null }).catch(GETERR), '!_version').toEqual({ _id:'A0', nick:'name', name: null });
        // expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({ _id:'A0', id:'A0', nick:'name', name:null, type:'' });               //! `count` should be cleared

        //! delete
        expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual({ _id: 'A0' });
        expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual('404 NOT FOUND - id:A0');

        //! try to update A1 (which does not exist)
        expect2(await service.updateItem('A1', { name: 'b0' }).catch(GETERR), '!_version').toEqual(
            '404 NOT FOUND - id:A1',
        );
    });
});
