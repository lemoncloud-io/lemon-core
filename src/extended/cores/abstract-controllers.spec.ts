/**
 * `abstract-controllers.spec.ts`
 * - test script for `abstract-crud-controllers.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2022-07-27 support { initialNo, throwable }
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2023-10-12 optimized `doList()` w/o ES6.
 * @date        2026-10-28 v5 B4: `GET /<type>/fields/admin` (gate by channel, shape, `source`).
 * @date        2026-10-28 v5 B4: `checkFieldsAdmin()` on each report, and the in-process express route.
 * @date        2026-10-30 v5 B13: default data-access policy through the 7 handlers (SPEC § 14, T-01..T-36).
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from '../../environ';
import { describe, it, expect2 } from './commons.spec';
import { $U } from '../../engine/';
import { $T } from './commons';
import { $rand } from '../../helpers/';
import { GETERR, GETERR$ } from '../../common/test-helper';
import { NextContext } from 'lemon-model';
import { $ES6Routed as $ES6 } from './abstract-services'; // v5 B2-b: the L2 `$ES6` name is removed
import { AccessPolicy, CanDoActionType, CanDoOptions, MyCoreProxy, MyManagerProxy } from './abstract-services'; //* v5 B13
import { loadSample } from './contexts.spec';
import { AbstractCRUDController, AbstractTransformer } from './abstract-controllers';
import { View, Body } from './types';
import { loadJsonSync } from '../../tools/';
import { afterEach, vi } from 'vitest';
import { checkFieldsAdmin } from './fields-admin';
import { LambdaHandler, LambdaWEBHandler } from '../../cores/lambda';
import { buildEngine } from '../../engine';
import { buildExpress } from '../../tools';
import request from 'supertest';

//* project dependant
import { AuthType, ModelType, MyTestModel, TestModelManager, ClassFieldsManager } from './abstract-services.spec';
import * as $backend from './abstract-services.spec';

export interface MyView extends View, Partial<MyTestModel> {
    /**
     * text in korean
     */
    ko: string;
}
export interface MyBody extends Body, Partial<MyView> {}
export class MyTransformer extends AbstractTransformer<MyTestModel, MyView, MyBody> {
    public modelAsView(model: MyTestModel, hasCores?: boolean): MyView {
        const view = super.modelAsView(model, hasCores);
        return {
            ...view,
            ko: '',
            name: $T.S(model.name),
        };
    }
    public bodyToModel(body: MyBody, isCreate?: boolean): MyTestModel {
        const model = super.bodyToModel(body, isCreate);
        if (body?.name !== undefined) model.name = $T.S(body.name);
        if (body?.test !== undefined) model.test = $T.N(body.test);
        return model;
    }
}

//* create instance.
export const instance = (options?: {
    auth?: AuthType;
    session?: boolean;
    domain?: string;
    roles?: string[];
    /** (optional) v5 B13: controller `policy` option */
    policy?: Partial<AccessPolicy>;
}) => {
    const { service, current, context } = $backend.instance(options?.auth, {
        domain: options?.domain,
        roles: options?.roles,
    });
    const trans = new MyTransformer();
    const useSession = options?.session ?? true;
    // test about '/tests/' api

    // How to extends AbstractCRUDController
    // 1. extend AbstractCRUDController class
    // 2. set super(<apiPathType>, backend-service, my-ModelManager in backend-service, { <transformer> ...})
    // 3. if want to create method(POST), add make model method in backend-proxy.makeModel()

    const api = new (class extends AbstractCRUDController<
        ModelType,
        MyTestModel,
        MyView,
        MyBody,
        any,
        TestModelManager,
        MyTransformer
    > {
        public constructor() {
            super('tests', service, service.$test, trans, { useSession, policy: options?.policy });
        }
    })();
    return { api, current, service, trans, context };
};

//* main test body.
describe('AbstractCRUDController', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //* test transformer
    it('should pass basic transformer', async () => {
        const { trans } = instance();

        // 기본형
        expect2(() => trans.modelAsView({ sid: 'a', uid: 'b' })).toEqual({
            ko: '',
            name: '',
        });

        // `useCores` 활성화시.
        expect2(() => trans.modelAsView({ sid: 'a', uid: 'b' }, true)).toEqual({
            $: {
                sid: 'a',
                uid: 'b',
            },
            ko: '',
            name: '',
        });

        //* test asDate().
        expect2(() => trans.asDate(null as any)).toEqual('');
        expect2(() => trans.asDate('22-01-22')).toEqual('.date[22-01-22] is invalid format - asDate()');
        expect2(() => trans.asDate('2022-00-22')).toEqual('.date[2022-00-22] is invalid format - asDate()');
        expect2(() => trans.asDate('2022-01-00', 'some')).toEqual('.some[2022-01-00] is invalid format - asDate()');
        expect2(() => trans.asDate('2022-01-22')).toEqual('2022-01-22');
    });

    //* test doList(session)
    it('should pass doList(authed)', async () => {
        const { api, context, service, current } = instance({ auth: 'authed', session: true });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual('403 IDENTITY-TOKEN - check x-lemon-identity');

        expect2(await api.doList('', { test: '' }, null, context).catch(GETERR)).toEqual(
            '403 IDENTITY-TOKEN - check x-lemon-identity',
        );

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual(
            '403 IDENTITY-TOKEN - check x-lemon-identity',
        );
    });

    //* test doList(session)
    it('should pass doList(session)', async () => {
        const { api, context, service, current } = instance({ auth: 'session', session: true });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: '1000000', uid: '1000001', roles: ['user'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '1000000',
                uid: '1000001',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual();

        //* check if has no field like `hello`
        expect2(
            await api
                .doList('', { hello: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000000' } },
                    ],
                },
            },
        });

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000000' } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if test exists
        expect2(
            await api
                .doList('', { test: '!' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000000' } },
                    ],
                    must: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000000' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });

        //* check if test(number) eq 0
        expect2(await api.doList('', { test: '0' }, null, context).catch(GETERR)).toEqual({
            limit: 10,
            list: {
                from: 0,
                query: {
                    bool: {
                        filter: [
                            { term: { 'ns.keyword': 'TT' } },
                            { term: { 'type.keyword': 'test' } },
                            { term: { deletedAt: 0 } },
                            { term: { test: 0 } },
                            { term: { 'sid.keyword': '1000000' } },
                        ],
                    },
                },
                size: 10,
                aggs: {
                    stereo: { terms: { field: 'stereo.keyword', missing: 'N/A', order: { _key: 'asc' }, size: 10 } },
                },
                sort: { createdAt: { missing: '_last', order: 'desc' } },
            },
            page: 0,
            total: 0,
        });
        expect2(await api.doGetList('1000001', { sid: 'a' }, null, context).catch(GETERR)).toEqual({
            limit: 10,
            list: {
                aggs: {
                    stereo: { terms: { field: 'stereo.keyword', missing: 'N/A', order: { _key: 'asc' }, size: 10 } },
                },
                from: 0,
                query: {
                    bool: {
                        filter: [
                            { term: { 'ns.keyword': 'TT' } },
                            { term: { 'type.keyword': 'test' } },
                            { term: { deletedAt: 0 } },
                            { term: { 'sid.keyword': '1000000' } },
                        ],
                    },
                },
                size: 10,
                sort: { createdAt: { missing: '_last', order: 'desc' } },
            },
            page: 0,
            total: 0,
        });
    });

    //* test doList(admin)
    it('should pass doList(session/admin)', async () => {
        const { api, context, service, current } = instance({ auth: 'session', session: true, roles: ['admin'] });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: '1000000', uid: '1000001', roles: ['admin'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '1000000',
                uid: '1000001',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual();

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000000' } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': 'a' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });
        const result = await api.doGetAdmin('', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result.param).toEqual({ sid: 'a', uid: 'b' });
        expect2(() => result.context).toEqual({ clientIp: '203.0.113.2' });
        expect2(() => result.hello).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(await api.doGetAdmin('1000001', { sid: 'a', uid: 'b' }, null, context).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - only from local!',
        );
    });

    //* test doList(offsite/admin)
    it('should pass doList(offsite/admin)', async () => {
        const { api, context, service, current } = instance({ auth: 'offsite', session: true, roles: ['admin'] });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: null, uid: '1000001', roles: ['admin'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '',
                uid: '1000001',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        //* v5 B2-b: no doc-type/version in the options.
        expect2(() => $ES6.options).toEqual({
            autocompleteFields: [],
            endpoint: 'https://localhost:9710',
            idName: '$id',
            indexName: 'test-v7.10',
        });

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': 'a' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });
    });

    //* test doList(localhost)
    //* v5 B5: `domain: 'localhost'` is inert now (local mode = `LOCAL_MODE=1`); the session `sid` pin applies (see the ES part).
    it('should pass doList(session)', async () => {
        const { api, context, service, current } = instance({ auth: 'session', session: true, domain: 'localhost' });
        expect2(() => context?.identity, 'roles').toEqual({ roles: ['user'] });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: '1000000', uid: '1000001', roles: ['user'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '1000000',
                uid: '1000001',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual();

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        // { term: { 'sid.keyword': '1000000' } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': 'a' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });
        const result = await api.doGetAdmin('', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result.id).toEqual('');
        expect2(() => result.param).toEqual({ sid: 'a', uid: 'b' });
        expect2(() => result.context).toEqual({ clientIp: '203.0.113.2' });
        expect2(() => result.hello).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );

        const result2 = await api.doGetAdmin('1000001', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result2.id).toEqual('1000001');
        expect2(() => result2.createdAt).toEqual(current);
        expect2(() => result2.updatedAt).toEqual(current);
        expect2(() => result2.deletedAt).toEqual(0);
        expect2(() => result2.ns).toEqual('TT');
        expect2(() => result2.sid).toEqual('1000000');
        expect2(() => result2.uid).toEqual('1000001');
        expect2(() => result2.type).toEqual('test');

        const result3 = await api.doGetAdmin('initialize', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result3.id).toEqual('initialize');
        expect2(() => result3.list).toEqual([
            { $: {}, id: '10000', ko: '', name: '' },
            { $: {}, id: '10001', ko: '', name: 'Hong' },
        ]);
    });

    //* test `/hello` route
    it('should normal CRUD: tests/1', async () => {
        // const { api, current } = instance({ session: false });
        const { api, current, context } = instance({ auth: 'session', session: true });
        expect2(() => api.hello()).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(() => context?.identity, 'sid,uid').toEqual({ sid: '1000000', uid: '1000001' });
        const $guests: NextContext = { ...context, identity: { ...context?.identity, roles: [] } };
        const $others: NextContext = { ...context, identity: { ...context?.identity, sid: 'some' } };

        // timestamp
        const $ts = {
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        };
        // session core.
        const $ = {
            sid: '1000000',
            uid: '1000001',
        };

        // get not exist
        expect2(await api.doGet('').catch(GETERR)).toEqual('@id (string) is required - doGet(tests/)');
        expect2(await api.doGet('1').catch(GETERR)).toEqual('404 NOT FOUND - not found @doGet(tests/1)');
        expect2(await api.doGet(' 1').catch(GETERR)).toEqual('404 NOT FOUND - not found @doGet(tests/ 1)');
        expect2(await api.doGet(' 1 ').catch(GETERR)).toEqual('404 NOT FOUND - not found @doGet(tests/ 1 )');
        expect2(await api.doGet(' 1 1 ').catch(GETERR)).toEqual('404 NOT FOUND - not found @doGet(tests/ 1 1 )');

        // == post ======================================================
        expect2(await api.doPost('', null, { name: 'test', test: -1 }, context).catch(GETERR)).toEqual(
            '.test (number) is required (greater than 0)',
        );
        expect2(await api.doPost('1', null, { name: 'test', test: -1 }, context).catch(GETERR)).toEqual(
            '@id (string) is invalid - doPost(tests/1)',
        );
        const newPost = await api.doPost('', null, { name: 'test', test: 1 }, context).catch<MyTestModel>(GETERR$);
        expect2(() => newPost, 'id').toEqual({ id: '1000001' });
        //WARN - double checking of `validateModel` for `makeModel`.
        expect2(() => newPost).toEqual({ id: '1000001', ko: '', name: 'test', ...$ts, $ });

        const newPost2 = await api.doPostBulk('', null, [{ name: 'bulk1' }, { name: 'bulk2' }], context);
        expect2(() => newPost2, 'id').toEqual([{ id: '1000002' }, { id: '1000003' }]);

        // == get ======================================================
        // get newPost
        expect2(await api.doGet(newPost.id).catch(GETERR)).toEqual(
            '403 IDENTITY-TOKEN - .identity (IdentityToken) is required - context:',
        );
        expect2(await api.doGet(newPost.id, null, null, context).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test',
            ...$ts,
            $,
        });
        expect2(await api.doGet(newPost.id, null, null, $others).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - action[read] is invalid @doGet(tests/1000001)',
        );
        expect2(await api.doGet(newPost.id, null, null, $guests).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - action[read] is invalid @doGet(tests/1000001)',
        );

        // == update ======================================================
        // put newPost
        expect2(await api.doPut('0', null, { name: 'test2' }, context).catch(GETERR)).toEqual(
            '@id (string) is required - doPut(tests/0)',
        );
        expect2(await api.doPut(newPost.id, null, { name: 'test2' }, context).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
            $,
        });

        //- check doPutBulk()
        expect2(await api.doPutBulk('', null, null, context).catch(GETERR)).toEqual(
            '@body.list (array) is required - doPutBulk(tests/)',
        );
        expect2(await api.doPutBulk('', null, {} as any, context).catch(GETERR)).toEqual(
            '@body.list (array) is required - doPutBulk(tests/)',
        );
        expect2(
            await api
                .doPutBulk(
                    '',
                    null,
                    newPost2.map(N => ({ id: N.id, name: N.name + '2' })),
                    context,
                )
                .then(R => R.list)
                .catch(GETERR),
            'id,error',
        ).toEqual([{ id: '1000002' }, { id: '1000003' }]);

        // check updated newPost
        expect2(await api.doGet(newPost.id, null, null, context).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
            $,
        });

        // == delete======================================================
        // delete not exists
        expect2(await api.doDelete('not_exists', null, null, context).catch(GETERR)).toEqual(
            '404 NOT FOUND - not found @doDelete(tests/not_exists)',
        );
        // delete newPost
        expect2(await api.doDelete('0', null, null, context).catch(GETERR)).toEqual(
            '@id (string) is required - doDelete(tests/0)',
        );
        expect2(await api.doDelete(newPost.id, null, null, context).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
            $,
            deletedAt: current,
        });
        // check deleted newPost (soft delete)
        expect2(await api.doGet(newPost.id, null, null, context).catch(GETERR)).toEqual(
            `404 NOT FOUND - deleted at ${$U.ts(current)} @doGet(tests/1000001)`,
        );
        expect2(await api.doDelete(newPost.id, null, null, context).catch(GETERR)).toEqual(
            '404 NOT FOUND - deleted @doDelete(tests/1000001)',
        );
        expect2(await api.doDelete(newPost.id, { destroy: '' }, null, context).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
            $,
            deletedAt: current,
        });
    });

    //* test `findLookup$()` in manager
    it('should pass findLookup$()', async () => {
        const { api, current, service } = instance();
        expect2(() => api.hello()).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        const $ts = {
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        };

        //* define function.s
        const initialNo = 1000000;
        const fxLookup = (key: string, params?: any) =>
            service.$test.findLookup$(key, { useSha256: false, resetRate: 1, isUseMeta: true, initialNo, ...params });
        const fxSha256 = (key: string, params?: any) =>
            service.$test.findLookup$(key, { useSha256: true, resetRate: 1, isUseMeta: true, initialNo, ...params });

        expect2(await fxLookup('', { throwable: true }).catch(GETERR)).toEqual(
            `404 NOT FOUND - _id:TT:test:#811c9dc5.0`,
        );

        //NOTE - measured (2026-09-01, cores-migration P1): develop's DummyStorageService._incrementBody()
        //NOTE - now routes through DynamoService.normalize(), so `''` normalizes to `null` here.
        expect2(await fxLookup('').catch(GETERR)).toEqual({
            _id: 'TT:test:#811c9dc5.0',
            id: `#811c9dc5.0`,
            type: '#test',
            stereo: '#',
            meta: { hash: '811c9dc5', text: null },
            lock: 1,
            next: initialNo + 1,
            ...$ts,
        });
        //NOTE - measured (2026-09-01, cores-migration P1): same DynamoService.normalize() routing as above,
        //NOTE - `''` normalizes to `null` here too.
        expect2(await fxSha256('').catch(GETERR)).toEqual({
            _id: 'TT:test:#1B2M2Y8AsgTpgAmY7PhCfg==.0',
            id: '#1B2M2Y8AsgTpgAmY7PhCfg==.0',
            type: '#test',
            stereo: '#',
            meta: { hash: '1B2M2Y8AsgTpgAmY7PhCfg==', text: null },
            lock: 1,
            next: initialNo + 2,
            ...$ts,
        });

        //* check multiple calles.
        const tasks = $rand.range(10).map(() => fxLookup('1'));
        const results = await Promise.all(tasks);
        const expectId1 = initialNo + 3;
        expect2(() => results.map(N => ({ id: N.id, next: N.next }))).toEqual([
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
        ]);

        expect2(await fxLookup('1')).toEqual({
            _id: 'TT:test:#340ca71c.1',
            id: `#340ca71c.1`,
            type: '#test',
            stereo: '#',
            meta: { hash: '340ca71c', text: '1' },
            lock: 10,
            next: expectId1,
            ...$ts,
        });

        //* fail to initialize the lookup key
        service.$test.storage.increment = async () => {
            return { lock: 0 } as MyTestModel;
        };
        const result = await service.$test
            .findLookup$('test-depth', { resetRate: 0, isUseMeta: true })
            .catch(e => e.message);
        expect2(result).toEqual('@depth[101] is out of range - findLookup(test-depth)');
    });
});

//* v5 B4: a controller over the class-fed manager (`fieldsSource: 'class'`).
const classInstance = () => {
    const { service, context } = $backend.instance('authed');
    const $cls = new ClassFieldsManager(service);
    const api = new (class extends AbstractCRUDController<
        ModelType,
        MyTestModel,
        MyView,
        MyBody,
        any,
        ClassFieldsManager,
        MyTransformer
    > {
        public constructor() {
            super('tests', service, $cls, new MyTransformer());
        }
    })();
    return { api, context };
};

//* v5 B4: env names toggled by the `fields/admin` tests — restored after each test (B5 pattern).
const $envB5 = {
    LOCAL_MODE: process.env.LOCAL_MODE,
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
};
//* restore one env name (delete if it was unset).
const restoreEnvB5 = (name: keyof typeof $envB5) => {
    if ($envB5[name] === undefined) delete process.env[name];
    else process.env[name] = $envB5[name];
};

describe('AbstractCRUDController fields/admin (B4)', () => {
    //* v5 B5: restore the toggled env.
    afterEach(() => {
        restoreEnvB5('LOCAL_MODE');
        restoreEnvB5('AWS_LAMBDA_FUNCTION_NAME');
    });
    const L1 = 'ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error';
    const CORE = `$,${L1},id,_id`;
    const coreVersion = loadJsonSync('package.json').version;

    //* local express (`LOCAL_MODE=1`, not Lambda): allowed even with an external domain and no admin role.
    it('should pass fields/admin in local mode', async () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const { api, context } = instance({ auth: 'authed' });
        expect2(() => context.domain).toEqual('oauth.lemoncloud.io');
        const res: any = await api.doGetAdmin('fields', {}, null, context);
        expect2(() => res, 'id,type,model,source,ok,issues').toEqual({
            id: 'fields',
            type: 'tests',
            model: 'test',
            source: 'list',
            ok: true,
            issues: [],
        });
        expect2(() => res.core.join(',')).toEqual(CORE);
        expect2(() => res.fields.join(',')).toEqual(`${L1},id,name,test,extra`);
        expect2(() => res.extra.join(',')).toEqual('name,test,extra');
        expect2(() => res.counts).toEqual({ core: 16, fields: 17, extra: 3 });
        expect2(() => res.runtime).toEqual({
            local: true,
            external: true,
            lambda: null,
            node: process.version,
            lemonCore: coreVersion,
        });
        //* the shared verifier agrees, with the expectations of this case.
        const expect = {
            type: 'tests',
            source: 'list' as const,
            counts: { core: 16, fields: 17, extra: 3 },
            extra: ['name', 'test', 'extra'],
            runtime: { local: true, external: true, lambda: false },
        };
        expect2(() => checkFieldsAdmin(res, expect)).toEqual({ ok: true, issues: [] });
    });

    //* not local + a domain (API-GW, ALB, URL) → 403, before the admin-role check.
    it('should pass fields/admin 403 if external', async () => {
        delete process.env.LOCAL_MODE;
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const { api, context } = instance({ auth: 'authed', roles: ['admin'] });
        expect2(await api.doGetAdmin('fields', {}, null, context).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - fields/admin is local or direct-invoke only @doGetAdmin(tests/fields)',
        );
    });

    //* in Lambda (`LOCAL_MODE` is ignored there) + empty domain (direct invoke, no `host`) → allowed w/o identity.
    it('should pass fields/admin by direct invoke', async () => {
        process.env.LOCAL_MODE = '1';
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'lemon-core-spec';
        const { api } = instance({ auth: 'authed' });
        const context: NextContext = { domain: '' };
        const res: any = await api.doGetAdmin('fields', {}, null, context);
        expect2(() => res, 'id,source,ok,counts').toEqual({
            id: 'fields',
            source: 'list',
            ok: true,
            counts: { core: 16, fields: 17, extra: 3 },
        });
        expect2(() => res.runtime, 'local,external,lambda').toEqual({
            local: false,
            external: false,
            lambda: 'lemon-core-spec',
        });
        //* the shared verifier agrees: in Lambda, internal.
        const expect = {
            type: 'tests',
            source: 'list' as const,
            counts: { core: 16, fields: 17, extra: 3 },
            extra: ['name', 'test', 'extra'],
            runtime: { local: false, external: false, lambda: 'lemon-core-spec' },
        };
        expect2(() => checkFieldsAdmin(res, expect)).toEqual({ ok: true, issues: [] });
        expect2(() => checkFieldsAdmin(res, { runtime: { lambda: true } })).toEqual({ ok: true, issues: [] });
        //* no context at all reads as internal too.
        expect2(await api.doGetAdmin('fields', {}, null, undefined).then(R => R.ok)).toEqual(true);
        //* other admin commands keep the admin-role check.
        expect2(await api.doGetAdmin('initialize', {}, null, context).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - only for admin @doGetAdmin(tests/initialize)',
        );
    });

    //* a manager built from the annotated class reports `class` and keeps all 16 core names.
    it('should pass fields/admin source of class', async () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const { api, context } = classInstance();
        const res: any = await api.doGetAdmin('fields', {}, null, context);
        expect2(() => res, 'source,ok,issues,counts').toEqual({
            source: 'class',
            ok: true,
            issues: [],
            counts: { core: 16, fields: 19, extra: 3 },
        });
        expect2(() => res.fields.join(',')).toEqual(`${CORE},name,test,extra`);
        expect2(() => res.extra.join(',')).toEqual('name,test,extra');
        //* the shared verifier agrees, incl. the class rule (every core name in `fields`).
        const expect = {
            type: 'tests',
            source: 'class' as const,
            counts: { core: 16, fields: 19, extra: 3 },
            extra: ['name', 'test', 'extra'],
            runtime: { local: true, external: true, lambda: false },
        };
        expect2(() => checkFieldsAdmin(res, expect)).toEqual({ ok: true, issues: [] });
    });
});

//* v5 B4: an express app (in process) that routes `/tests/*` to the CRUD controller.
const expressInstance = () => {
    const { api } = instance({ auth: 'authed' });
    const $web = new LambdaWEBHandler(new LambdaHandler(), true);
    //* decoder: `GET /tests/fields/admin` → `doGetAdmin('fields', ...)`.
    $web.setHandler('tests', (mode, id, cmd) => api.decode(mode, id, cmd));
    const $engine = buildEngine({});
    const { app } = buildExpress($engine, $web);
    return { app };
};

describe('AbstractCRUDController fields/admin via express (B4)', () => {
    //* v5 B5: restore the toggled env.
    afterEach(() => {
        restoreEnvB5('LOCAL_MODE');
        restoreEnvB5('AWS_LAMBDA_FUNCTION_NAME');
    });

    //* local express (`LOCAL_MODE=1`, not Lambda): 200, and the shared verifier passes the body.
    it('should pass fields/admin over express in local mode', async () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const { app } = expressInstance();
        const res = await request(app).get('/tests/fields/admin');
        expect2(() => res.status).toEqual(200);
        const expect = {
            type: 'tests',
            model: 'test',
            source: 'list' as const,
            counts: { core: 16, fields: 17, extra: 3 },
            extra: ['name', 'test', 'extra'],
            lemonCore: loadJsonSync('package.json').version,
            runtime: { local: true, external: true, lambda: false },
        };
        expect2(() => checkFieldsAdmin(res.body, expect)).toEqual({ ok: true, issues: [] });
    });

    //* not local: the express request has a `host` (external) → 403.
    it('should pass fields/admin over express 403 if not local', async () => {
        delete process.env.LOCAL_MODE;
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const { app } = expressInstance();
        const res = await request(app).get('/tests/fields/admin');
        expect2(() => res, 'status,text').toEqual({
            status: 403,
            text: '403 NOT ALLOWED - fields/admin is local or direct-invoke only @doGetAdmin(tests/fields)',
        });
    });
});

//* v5 B13: a manager proxy that overrides `canDo` (DoU style) and the type policy (`accessPolicy()`).
class B13TestsProxy extends MyManagerProxy<MyTestModel, TestModelManager, $backend.BackendService, ModelType> {
    public constructor(
        proxy: MyCoreProxy<ModelType, $backend.BackendService>,
        mgr: TestModelManager,
        readonly typePolicy?: Partial<AccessPolicy>,
    ) {
        super(proxy, mgr);
    }
    //* the type default with `typePolicy` on top.
    public accessPolicy(): AccessPolicy {
        return { ...super.accessPolicy(), ...this.typePolicy };
    }
    //* a semi-public read of `public` rows and a silent refusal of `deny*` rows run before the default.
    public canDo<T extends MyTestModel>(action: CanDoActionType, model?: T, options?: CanDoOptions): boolean {
        if (action === 'read' && model?.name === 'public') return true;
        if (`${model?.name ?? ''}`.startsWith('deny')) return false;
        return super.canDo(action, model, options);
    }
}

//* v5 B13: a core proxy that registers only `B13TestsProxy` for the `test` type.
class B13Proxy extends MyCoreProxy<ModelType, $backend.BackendService> {
    public readonly tests: B13TestsProxy;
    public constructor(context: NextContext, service: $backend.BackendService, typePolicy?: Partial<AccessPolicy>) {
        super(context, service);
        this.tests = new B13TestsProxy(this, service.$test, typePolicy);
    }
}

//* v5 B13: one more controller over the same service (to read rows of another controller).
const _b13Ctrl = (service: any, trans: MyTransformer, options: { useSession?: boolean; policy?: any }) =>
    new (class extends AbstractCRUDController<
        ModelType,
        MyTestModel,
        MyView,
        MyBody,
        any,
        TestModelManager,
        MyTransformer
    > {
        public constructor() {
            super('tests', service, service.$test, trans, options);
        }
    })();

describe('AbstractCRUDController B13 access policy', () => {
    const $legacy0 = process.env.SID_LEGACY_ACCESS;
    //* restore the toggled env and spies.
    afterEach(() => {
        restoreEnvB5('LOCAL_MODE');
        restoreEnvB5('AWS_LAMBDA_FUNCTION_NAME');
        if ($legacy0 === undefined) delete process.env.SID_LEGACY_ACCESS;
        else process.env.SID_LEGACY_ACCESS = $legacy0;
        vi.restoreAllMocks();
    });
    loadProfile(process); // override process.env (same profile as above).

    //* the fixture: a session controller, the caller states of § 14.2, and rows A (OWN), B (SITE), C (OTHER).
    const _setup = async (options?: {
        session?: boolean;
        policy?: Partial<AccessPolicy>;
        override?: boolean;
        typePolicy?: Partial<AccessPolicy>;
    }) => {
        const session = options?.session ?? true;
        const { api, service, context, trans } = instance({ auth: 'session', session, policy: options?.policy });
        //* the DoU-style override proxy, when asked.
        if (options?.override)
            service.createProxy = (ctx: NextContext) => new B13Proxy(ctx, service, options?.typePolicy) as any;
        //* a context with the identity overridden.
        const _ctx = (N: any): NextContext => ({ ...context, identity: { ...context?.identity, ...N } });
        const $ = {
            own: _ctx({}),
            site: _ctx({ uid: '2002' }),
            other: _ctx({ sid: '999', uid: '2002' }),
            admin: _ctx({ roles: ['admin'], sid: '999', uid: '9009' }),
            guest: _ctx({ roles: [] }),
            nouid: _ctx({ uid: '' }),
            hashUid: _ctx({ uid: '#x' }),
            nosid: _ctx({ sid: '#' }),
            nosess: { identity: { lang: 'ko' } } as NextContext, // direct invoke, no headers
            signed: loadSample('signed').context as NextContext, // IAM SigV4 caller
            claim: { identity: { roles: ['admin'] } } as NextContext, // `roles: ['admin']` claim, no `userAgent`
        };
        //* rows created with the session on (a second controller when this one has it off).
        const $on = session ? api : _b13Ctrl(service, trans, { useSession: true });
        const A = await $on.doPost('', null, { name: 'own' }, $.own);
        const B = await $on.doPost('', null, { name: 'site' }, $.site);
        const C = await $on.doPost('', null, { name: 'other' }, $.other);
        //* capture `$param` of `manager.list()` (no search engine in this profile).
        const seen: any[] = [];
        vi.spyOn(service.$test, 'list').mockImplementation(async ($page: any, $param: any) => {
            seen.push({ ...$param });
            return { list: [], total: 0 } as any;
        });
        //* `doList()` → the `$param` it searched with (or the error).
        const _list = async (ctx: NextContext, param: any = {}, $api: any = api) => {
            seen.length = 0;
            const err = await $api.doList('', param, null, ctx).then(() => null, GETERR);
            return err ?? seen[0];
        };
        //* the error message (or the value), cut before the context dump.
        const _e = (P: Promise<any>) =>
            P.catch(GETERR).then(R => (typeof R === 'string' ? R.split(' - context:')[0] : R));
        //* the 5 handlers for one caller → the first 3 chars of each error, or `ok`.
        const _five = async (ctx: NextContext, id: string = A.id) => {
            const _h = (P: Promise<any>) => _e(P).then(R => (typeof R === 'string' ? R.substring(0, 3) : 'ok'));
            return [
                await _h(api.doList('', {}, null, ctx)),
                await _h(api.doGet(id, null, null, ctx)),
                await _h(api.doPost('', null, { name: 'new' }, ctx)),
                await _h(api.doPut(id, null, { name: 'put' }, ctx)),
                await _h(api.doDelete(id, null, null, ctx)),
            ];
        };
        return { api, service, trans, $, A, B, C, seen, _list, _e, _five };
    };
    const OK5 = ['ok', 'ok', 'ok', 'ok', 'ok'];
    const DENY5 = ['403', '403', '403', '403', '403'];

    it('B13 T-01 ADM doList: own site, `?sid=` picks any site', async () => {
        const { $, _list } = await _setup();
        expect2(await _list($.admin), 'sid,uid').toEqual({ sid: '999' });
        expect2(await _list($.admin, { sid: '1000000' }), 'sid,uid').toEqual({ sid: '1000000' });
    });

    it('B13 T-02 ADM doGet of other users and sites', async () => {
        const { api, $, A, C } = await _setup();
        expect2(await api.doGet(A.id, null, null, $.admin).catch(GETERR), 'id,name').toEqual({ id: A.id, name: 'own' });
        expect2(await api.doGet(C.id, null, null, $.admin).catch(GETERR), 'id').toEqual({ id: C.id });
    });

    it('B13 T-03 ADM doPost stamps the admin session', async () => {
        const { api, $ } = await _setup();
        expect2(await api.doPost('', null, { name: 'adm' }, $.admin).catch(GETERR), '$').toEqual({
            $: { sid: '999', uid: '9009' },
        });
    });

    it('B13 T-04 ADM doPut of another user row', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doPut(A.id, null, { name: 'adm' }, $.admin).catch(GETERR), 'name').toEqual({ name: 'adm' });
    });

    it('B13 T-05 ADM doDelete of another user row', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doDelete(A.id, null, null, $.admin).catch(GETERR), 'id').toEqual({ id: A.id });
    });

    it('B13 T-06 IAM SigV4 caller (no session) and `roles: [admin]` claim: all 5 handlers as admin', async () => {
        const { api, $, A, B, _list } = await _setup();
        //* list: no session site → no site filter.
        expect2(await _list($.signed), 'sid').toEqual({ sid: null });
        expect2(await _list($.signed, { sid: '1000000' }), 'sid').toEqual({ sid: '1000000' });
        expect2(await api.doGet(A.id, null, null, $.signed).catch(GETERR), 'id').toEqual({ id: A.id });
        //* create: no session → empty `sid`/`uid` (a `sid`-less row, admin only by default; was `403 IDENTITY-TOKEN`).
        const made = await api.doPost('', null, { name: 'iam' }, $.signed).catch(GETERR);
        expect2(() => made, 'name').toEqual({ name: 'iam' });
        expect2(() => made, '$').toEqual({ $: { sid: '', uid: '' } });
        expect2(await api.doPut(A.id, null, { name: 'iam' }, $.signed).catch(GETERR), 'name').toEqual({ name: 'iam' });
        expect2(await api.doDelete(A.id, null, null, $.signed).catch(GETERR), 'id').toEqual({ id: A.id });
        expect2(await api.doGet(B.id, null, null, $.claim).catch(GETERR), 'id').toEqual({ id: B.id });
        expect2(await _list($.claim), 'sid').toEqual({ sid: null });
    });

    it('B13 T-07 OWN doList pinned to own site', async () => {
        const { $, _list } = await _setup();
        expect2(await _list($.own), 'sid,uid').toEqual({ sid: '1000000' });
    });

    it('B13 T-08 OWN doGet', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doGet(A.id, null, null, $.own).catch(GETERR), 'id,name').toEqual({ id: A.id, name: 'own' });
    });

    it('B13 T-09 doPost stamps the session sid/uid/gid (OWN, SITE, OTHER)', async () => {
        const { api, $, A, B, C } = await _setup();
        expect2(() => [A, B, C].map(N => N.$)).toEqual([
            { sid: '1000000', uid: '1000001' },
            { sid: '1000000', uid: '2002' },
            { sid: '999', uid: '2002' },
        ]);
        //* `gid` from the session (new); the body cannot set the cores.
        const $g1 = { ...$.own, identity: { ...$.own.identity, gid: 'g1' } } as NextContext;
        const made = await api.doPost('', null, { name: 'g', sid: 'x', uid: 'y', gid: 'z' } as any, $g1);
        expect2(() => made.$).toEqual({ sid: '1000000', uid: '1000001', gid: 'g1' });
    });

    it('B13 T-10 OWN doPut', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doPut(A.id, null, { name: 'mine' }, $.own).catch(GETERR), 'name').toEqual({ name: 'mine' });
    });

    it('B13 T-11 OWN doDelete', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doDelete(A.id, null, null, $.own).catch(GETERR), 'id').toEqual({ id: A.id });
    });

    it('B13 T-12 SITE doList pinned to own site, `?uid=` narrows', async () => {
        const { $, _list } = await _setup();
        expect2(await _list($.site), 'sid,uid').toEqual({ sid: '1000000' });
        expect2(await _list($.site, { uid: '1000001' }), 'sid,uid').toEqual({ sid: '1000000', uid: '1000001' });
    });

    it('B13 T-13 SITE doGet of another user row → 403', async () => {
        const { api, $, A } = await _setup();
        // B13 § 14.2 T-13: was ✔ (same `sid`, any `uid`).
        expect2(await api.doGet(A.id, null, null, $.site).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${A.id})`,
        );
    });

    it('B13 T-14 SITE doPut of another user row → 403', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doPut(A.id, null, { name: 'x' }, $.site).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${A.id})`,
        );
    });

    it('B13 T-15 SITE doDelete of another user row → 403', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doDelete(A.id, null, null, $.site).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[delete] is invalid @doDelete(tests/${A.id})`,
        );
    });

    it('B13 T-16 OTHER doList: own site only, `?sid=` ignored', async () => {
        const { $, _list } = await _setup();
        expect2(await _list($.other, { sid: '1000000' }), 'sid,uid').toEqual({ sid: '999' });
    });

    it('B13 T-17 OTHER doGet → 403', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doGet(A.id, null, null, $.other).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${A.id})`,
        );
    });

    it('B13 T-18 OTHER doPut → 403', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doPut(A.id, null, { name: 'x' }, $.other).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${A.id})`,
        );
    });

    it('B13 T-19 OTHER doDelete → 403', async () => {
        const { api, $, A } = await _setup();
        expect2(await api.doDelete(A.id, null, null, $.other).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[delete] is invalid @doDelete(tests/${A.id})`,
        );
    });

    it('B13 T-20 NOUID (empty or `#` uid) → 403 on all 5 handlers', async () => {
        const { $, _five, _list } = await _setup();
        expect2(await _five($.nouid)).toEqual(DENY5);
        expect2(await _five($.hashUid)).toEqual(DENY5);
        expect2(await _list($.hashUid)).toEqual('403 NOT ALLOWED - action[list] is invalid @doList(tests/)');
    });

    it('B13 T-21 NOSID (offsite `#`) → 403 on all 5 handlers, list too', async () => {
        const { $, _five, _list } = await _setup();
        expect2(await _five($.nosid)).toEqual(DENY5);
        // B13 § 14.2 T-21: was an unfiltered list.
        expect2(await _list($.nosid)).toEqual('403 NOT ALLOWED - action[list] is invalid @doList(tests/)');
    });

    it('B13 T-22 GUEST (empty roles) → 403 on all 5 handlers', async () => {
        const { $, _five, _list } = await _setup();
        expect2(await _five($.guest)).toEqual(DENY5);
        expect2(await _list($.guest)).toEqual('403 NOT ALLOWED - action[list] is invalid @doList(tests/)');
    });

    it('B13 T-23 NOSESS (no session in Lambda) → 403 IDENTITY-TOKEN on all 5 handlers', async () => {
        const { api, $, A, _e } = await _setup();
        const MSG = '403 IDENTITY-TOKEN - .identity (IdentityToken) is required';
        expect2(await _e(api.doList('', {}, null, $.nosess))).toEqual(MSG);
        expect2(await _e(api.doGet(A.id, null, null, $.nosess))).toEqual(MSG);
        expect2(await _e(api.doPost('', null, { name: 'x' }, $.nosess))).toEqual(MSG);
        expect2(await _e(api.doPut(A.id, null, { name: 'x' }, $.nosess))).toEqual(MSG);
        expect2(await _e(api.doDelete(A.id, null, null, $.nosess))).toEqual(MSG);
        expect2(await _e(api.doPutBulk('', null, [{ id: A.id }], $.nosess))).toEqual(MSG);
    });

    it('B13 T-24 a row with an empty uid → admin only', async () => {
        const { api, $ } = await _setup();
        //* an admin with a `#` uid creates a row of site 1000000 without `uid`.
        const $adm = { ...$.own, identity: { ...$.own.identity, roles: ['admin'], uid: '#adm' } } as NextContext;
        const row = await api.doPost('', null, { name: 'nouid' }, $adm);
        expect2(() => row.$).toEqual({ sid: '1000000', uid: '' });
        expect2(await api.doGet(row.id, null, null, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${row.id})`,
        );
        expect2(await api.doPut(row.id, null, { name: 'x' }, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${row.id})`,
        );
        expect2(await api.doDelete(row.id, null, null, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[delete] is invalid @doDelete(tests/${row.id})`,
        );
        expect2(await api.doGet(row.id, null, null, $.admin).catch(GETERR), 'id').toEqual({ id: row.id });
    });

    //* a `sid`-less row: created by an offsite admin (`sid: '#'` → stored `''`).
    const _sidless = async (api: any, $: any) => {
        const $off = { ...$.own, identity: { ...$.own.identity, roles: ['admin'], sid: '#' } } as NextContext;
        return api.doPost('', null, { name: 'legacy' }, $off);
    };

    it('B13 T-25 a `sid`-less row, SID_LEGACY_ACCESS=admin (default) → read admin only', async () => {
        delete process.env.SID_LEGACY_ACCESS;
        const { api, $ } = await _setup();
        const row = await _sidless(api, $);
        expect2(() => row.$).toEqual({ sid: '', uid: '1000001' });
        // B13 § 14.2 T-25: read was ✔ for role holders (B5 § 6.4 read stayed open).
        expect2(await api.doGet(row.id, null, null, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${row.id})`,
        );
        expect2(await api.doPut(row.id, null, { name: 'x' }, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${row.id})`,
        );
        expect2(await api.doGet(row.id, null, null, $.admin).catch(GETERR), 'id').toEqual({ id: row.id });
    });

    it('B13 T-26 a `sid`-less row, SID_LEGACY_ACCESS=open → every role holder (v4)', async () => {
        process.env.SID_LEGACY_ACCESS = 'open';
        const { api, $ } = await _setup();
        const row = await _sidless(api, $);
        expect2(await api.doGet(row.id, null, null, $.other).catch(GETERR), 'id').toEqual({ id: row.id });
        expect2(await api.doPut(row.id, null, { name: 'v4' }, $.site).catch(GETERR), 'name').toEqual({ name: 'v4' });
        expect2(await api.doDelete(row.id, null, null, $.own).catch(GETERR), 'id').toEqual({ id: row.id });
        expect2(await api.doGet(row.id, null, null, $.guest).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${row.id})`,
        );
    });

    it('B13 T-27 a `sid`-less row, SID_LEGACY_ACCESS=deny → write 403 even for admin, read as `admin`', async () => {
        delete process.env.SID_LEGACY_ACCESS;
        const { api, $ } = await _setup();
        const row = await _sidless(api, $);
        process.env.SID_LEGACY_ACCESS = 'deny';
        expect2(await api.doPut(row.id, null, { name: 'x' }, $.admin).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${row.id})`,
        );
        expect2(await api.doDelete(row.id, null, null, $.signed).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[delete] is invalid @doDelete(tests/${row.id})`,
        );
        expect2(await api.doGet(row.id, null, null, $.admin).catch(GETERR), 'id').toEqual({ id: row.id });
        expect2(await api.doGet(row.id, null, null, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${row.id})`,
        );
    });

    it('B13 T-28 doPostBulk: denied items → 403 with every denied index, zero writes', async () => {
        const { api, $ } = await _setup({ override: true });
        const made = vi.spyOn(MyManagerProxy.prototype, 'makeModel');
        //* `deny*` rows are refused by the override with `false` (not thrown); a `false` counts as denied.
        expect2(
            await api.doPostBulk('', null, [{ name: 'ok' }, { name: 'deny1' }, { name: 'deny2' }], $.own).catch(GETERR),
        ).toEqual('403 NOT ALLOWED - bulk[create] denied ids[#1,#2] @doPostBulk(tests/)');
        expect2(() => made.mock.calls.length).toEqual(0);
        //* a `null` never reaches `makeModel()` (the v5.0 bug of the `throwable: false` path).
        expect2(await api.doPostBulk('', null, [{ name: 'deny' }], $.own).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - bulk[create] denied ids[#0] @doPostBulk(tests/)',
        );
        expect2(() => made.mock.calls.length).toEqual(0);
    });

    it('B13 T-29 doPostBulk: all allowed → all written', async () => {
        const { api, $ } = await _setup();
        const list = await api.doPostBulk('', null, [{ name: 'b1' }, { name: 'b2' }], $.own);
        expect2(() => list.map(N => N.$)).toEqual([
            { sid: '1000000', uid: '1000001' },
            { sid: '1000000', uid: '1000001' },
        ]);
        expect2(await api.doGet(list[1].id, null, null, $.own).catch(GETERR), 'name').toEqual({ name: 'b2' });
    });

    it('B13 T-30 doPutBulk: denied rows → 403 with every denied id, zero writes; 404 first', async () => {
        const { api, $, A, B, C } = await _setup();
        const body = [A, B, C].map(N => ({ id: N.id, name: 'bulk' }));
        expect2(await api.doPutBulk('', null, body, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - bulk[update] denied ids[${B.id},${C.id}] @doPutBulk(tests/)`,
        );
        //* zero writes: A (allowed) keeps its name.
        expect2(await api.doGet(A.id, null, null, $.own).catch(GETERR), 'name').toEqual({ name: 'own' });
        //* a missing id is a 404 in phase 1, before the denial.
        expect2(await api.doPutBulk('', null, [body[0], { id: 'nope' }, body[1]], $.own).catch(GETERR)).toEqual(
            '404 NOT FOUND - not found @doPutBulk(tests:1/nope)',
        );
    });

    it('B13 T-31 doPutBulk: all allowed → all written', async () => {
        const { api, $, A } = await _setup();
        const A2 = await api.doPost('', null, { name: 'own2' }, $.own);
        const res = await api.doPutBulk(
            '',
            null,
            [A, A2].map(N => ({ id: N.id, name: 'bulk' })),
            $.own,
        );
        expect2(() => res.list.map(N => N.name)).toEqual(['bulk', 'bulk']);
        expect2(await api.doGet(A2.id, null, null, $.own).catch(GETERR), 'name').toEqual({ name: 'bulk' });
    });

    it('B13 T-32 a `canDo` override runs before the default', async () => {
        const { api, $ } = await _setup({ override: true });
        const pub = await api.doPost('', null, { name: 'public' }, $.own);
        //* semi-public read for SITE and OTHER (the default would 403).
        expect2(await api.doGet(pub.id, null, null, $.site).catch(GETERR), 'id').toEqual({ id: pub.id });
        expect2(await api.doGet(pub.id, null, null, $.other).catch(GETERR), 'id').toEqual({ id: pub.id });
        //* the override falls back to the default for the rest.
        expect2(await api.doPut(pub.id, null, { name: 'x' }, $.site).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${pub.id})`,
        );
    });

    it('B13 T-33 controller `policy: { read: site }` restores the site-wide read', async () => {
        const { api, $, A, _list } = await _setup({ policy: { read: 'site' } });
        expect2(await api.doGet(A.id, null, null, $.site).catch(GETERR), 'id').toEqual({ id: A.id });
        expect2(await api.doGet(A.id, null, null, $.other).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${A.id})`,
        );
        expect2(await api.doPut(A.id, null, { name: 'x' }, $.site).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${A.id})`,
        );
        expect2(await _list($.site), 'sid,uid').toEqual({ sid: '1000000' });
        //* `{ list: 'owner' }` → own rows only (`?uid=` overridden).
        const { $: $2, _list: _list2 } = await _setup({ policy: { list: 'owner' } });
        expect2(await _list2($2.site, { uid: '1000001' }), 'sid,uid').toEqual({ sid: '1000000', uid: '2002' });
    });

    it('B13 T-34 `accessPolicy()` override per type; the controller `policy` wins', async () => {
        const { api, $, A, _list } = await _setup({ override: true, typePolicy: { read: 'site', list: 'owner' } });
        expect2(await api.doGet(A.id, null, null, $.site).catch(GETERR), 'id').toEqual({ id: A.id });
        expect2(await _list($.site), 'sid,uid').toEqual({ sid: '1000000', uid: '2002' });
        const {
            api: api2,
            $: $2,
            A: A2,
        } = await _setup({
            override: true,
            typePolicy: { read: 'site' },
            policy: { read: 'owner' },
        });
        expect2(await api2.doGet(A2.id, null, null, $2.site).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${A2.id})`,
        );
    });

    it('B13 T-35 useSession=false controller → v5 § 6.4 rules, no list check or pin', async () => {
        const { api, $, A, B, _list } = await _setup({ session: false, policy: { read: 'any' } });
        //* same site → read for any user; other site → 403; update needs the uid (§ 6.4).
        expect2(await api.doGet(A.id, null, null, $.site).catch(GETERR), 'id').toEqual({ id: A.id });
        expect2(await api.doGet(A.id, null, null, $.other).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[read] is invalid @doGet(tests/${A.id})`,
        );
        expect2(await api.doPut(B.id, null, { name: 'x' }, $.own).catch(GETERR)).toEqual(
            `403 NOT ALLOWED - action[update] is invalid @doPut(tests/${B.id})`,
        );
        //* list: no `canDo('list')` (a guest lists), `?sid=` as given.
        expect2(await _list($.guest, { sid: 'x' }), 'sid').toEqual({ sid: 'x' });
        expect2(await _list($.nosid), 'sid').toEqual({});
        //* create: no session stamp.
        expect2(await api.doPost('', null, { name: 'off' }, $.own).then(R => R.$)).toEqual(undefined);
    });

    it('B13 T-36 local mode → unchanged (admin for all, no pin)', async () => {
        const { api, $, A, _list } = await _setup();
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        expect2(await _five_local(api, $, A)).toEqual(OK5);
        expect2(await _list($.other, { sid: 'a' }), 'sid').toEqual({ sid: 'a' });
        expect2(await _list($.guest), 'sid').toEqual({});
    });
    //* the 5 handlers in local mode for OTHER and GUEST (both pass as admin).
    const _five_local = async (api: any, $: any, A: any) => {
        const _h = (P: Promise<any>) => P.then(() => 'ok', GETERR);
        return [
            await _h(api.doList('', {}, null, $.guest)),
            await _h(api.doGet(A.id, null, null, $.other)),
            await _h(api.doPost('', null, { name: 'loc' }, $.guest)),
            await _h(api.doPut(A.id, null, { name: 'loc' }, $.other)),
            await _h(api.doDelete(A.id, null, null, $.guest)),
        ];
    };
});
