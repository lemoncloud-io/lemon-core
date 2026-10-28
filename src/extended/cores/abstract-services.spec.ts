/**
 * `abstract-services.spec.spec.ts`
 * - test script for `abstract-services.spec.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-15 initial version
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2026-10-27 v5 B2-b: lazy `$OS2` test (listener and client counts).
 * @date        2026-10-28 v5 B4: `MyTestModel` is a class with `@field()`; a manager built from the class; L2 `CORE_FIELDS`.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from '../../environ';
import { describe, it, expect2, expect } from './commons.spec';
import { $U } from '../../engine/';
import { $T } from './commons';
import { GETERR } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { SearchResult, filterFields } from '../abstract-service';
import { NextContext, NextIdentity, SearchBody, SimpleSet, CoreModel, CORE_FIELDS } from 'lemon-model';
//* v5 B4: field annotations come from lemon-model (not on the lemon-core root).
import { field, fieldsOf } from 'lemon-model';
import { CanDoActionType, MyCoreManager, MyCoreProxy, MyCoreService, MyManagerProxy } from './abstract-services';
import { $OS2, $ES6Routed, _OS2, OS2Instance, OS2Service } from './abstract-services';
import { lazyInstance } from '../../lib/lazy';
import $cores from '../../cores/';
import { vi, afterEach } from 'vitest';
import { PaginateParam } from './types';
import { loadSample } from './contexts.spec';

export type ModelType = 'test';
export type Model = CoreModel<ModelType>;

/**
 * `test`: internal test model.
 */
//* v5 B4: a class over `CoreModel` - stored fields carry `@field()`, view fields (`Model`, `$identity`) do not.
export class MyTestModel extends CoreModel<ModelType> {
    /** name of model */
    @field()
    name?: string;
    /** test count */
    @field()
    test?: number;

    /** (optional) extra */
    @field()
    extra?: SimpleSet;

    /**
     * (optional) inner Object.
     */
    readonly Model?: Model;

    /**
     * (view) Access Infor.
     */
    readonly $identity?: NextIdentity;
}

export const $FIELD = {
    test: filterFields(fieldsOf(MyTestModel)),
};

/**
 * class: `TestModelManager`
 */
export class TestModelManager extends MyCoreManager<MyTestModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('test', parent, $FIELD.test);
    }

    /**
     * @override validate
     */
    public async validateModel(model: MyTestModel, $org?: MyTestModel) {
        if (model.test && model.test <= 0) throw Error('.test (number) is required (greater than 0)');
        return model;
    }
}

/**
 * class: `ClassFieldsManager`
 * - v5 B4: the same model, but the manager gets the model class (`resolveFields()` -> `fieldsOf(MyTestModel)`).
 */
export class ClassFieldsManager extends MyCoreManager<MyTestModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('test', parent, MyTestModel, { enableSync: false });
    }
}

/**
 * class: `BackendService`
 */
export class BackendService extends MyCoreService<Model, ModelType, BackendProxy> {
    public readonly $test: TestModelManager;
    public constructor(tableName?: string, ns?: string) {
        super(tableName, ns);
        this.$test = new TestModelManager(this);
    }

    /**
     * say hello()
     */
    public hello = (): string => `backend-service:${this.NS}/${this.tableName}`;

    /**
     * make proxy instance w/ this service.
     */
    public createProxy = (context: NextContext) => {
        const proxy = new BackendProxy(context, this);
        return proxy;
    };
}

/**
 * class: `BackendProxy`
 */
export class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    public readonly tests: MyManagerProxy<MyTestModel, TestModelManager, BackendService, ModelType>;
    public constructor(context: NextContext, service: BackendService) {
        super(context, service);
        this.tests = new MyManagerProxy(this, service.$test);
    }
}

/**
 * 각 인증 결과에 따른 예제
 *
 * @see `./contexts.spec.ts/$context[<type>]`
 */
export type AuthType = 'public' | 'authed' | 'session' | 'offsite' | 'signed';
export interface ServiceParams {
    /** the expected current timestamp */
    current?: number;
    /** flag of using dummy data (default true) */
    dummy?: boolean;
    /** overrided domain */
    domain?: string;
    /** override `roles` in identity */
    roles?: string[];
}

//* create service instance.
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
    const current = params?.current ?? $U.current_time_ms();
    const isDummy = params?.dummy ?? true;
    const { context, data } = loadSample(type);
    if (params?.domain && context) (context as NextContext).domain = params?.domain;
    if (params?.roles && context?.identity) (context.identity as any).roles = params?.roles;
    const service = new (class extends BackendService {
        public constructor() {
            super(isDummy ? 'dummy-data.yml' : '');
        }
        public async doSearch<T>(body: SearchBody): Promise<SearchResult<T, any>> {
            //* returns the body as object.
            return { total: 0, list: body as any };
        }
    })();
    service.setCurrent(current);
    return { service, current, context, data };
};

//* main test body.
//* v5 B5: env names toggled by the local-mode tests — restored after each test.
const $envB5 = { LOCAL_MODE: process.env.LOCAL_MODE, AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME };
//* restore one env name (delete if it was unset).
const restoreEnvB5 = (name: keyof typeof $envB5) => {
    if ($envB5[name] === undefined) delete process.env[name];
    else process.env[name] = $envB5[name];
};

describe('abstract-services', () => {
    //* v5 B5: restore the toggled env.
    afterEach(() => {
        restoreEnvB5('LOCAL_MODE');
        restoreEnvB5('AWS_LAMBDA_FUNCTION_NAME');
    });

    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //* basic test
    it('should pass basic functions', async () => {
        const { service } = instance();
        expect2(() => true).toEqual(true);

        const isKeys = true;
        if (isKeys) {
            //* v5 B4: compared as sets - `fieldsOf()` lists parent fields first (the generator listed own fields first).
            const sorted = (list: string[]) => [...list].sort().join(',');
            const EXPECTED =
                'name,test,extra,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id';
            expect2(() => sorted(filterFields($FIELD.test))).toEqual(sorted(EXPECTED.split(',')));
            expect2(() => sorted(filterFields($FIELD.test, ['test']))).toEqual(sorted(EXPECTED.split(',')));
            expect2(() => filterFields($FIELD.test, ['test'])[0]).toEqual('test');
        } else {
            console.warn('check ts-transformer-keys!');
        }
        // test CoreService
        expect2(() => service.dynamoOptions).toEqual({ idName: '_id', tableName: 'dummy-data.yml' });

        // test CoreManager
        const { $test } = service;
        expect2($test.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(await $test.find('A')).toEqual(null);
        expect2(await $test.exists('A')).toEqual(false);
        expect2(await $test.findByKey('A')).toEqual(null);
        expect2(await $test.getMulti(['A', 'A']).catch(GETERR)).toEqual(
            '404 NOT FOUND - test:A (S:0/1) - parallel(10/1)',
        );

        const $A = await $test.save('A', { name: 'AAA', test: 1 });
        expect2(() => $A, 'id').toEqual({ id: 'A' });

        expect2(await $test.getMulti(['A', 'A']).catch(GETERR), 'id').toEqual([{ id: 'A' }, { id: 'A' }]);
        expect2(await $test.getMulti$(['A', 'A']).catch(GETERR)).toEqual({ A: { ...$A } });
    });

    //* v5 B4: fields from the model class (`resolveFields()` through MyCoreManager -> CoreManager -> AbstractManager).
    it('should pass manager fields from a model class (B4)', async () => {
        const { service } = instance();
        const $cls = new ClassFieldsManager(service);
        const L1 = CORE_FIELDS.join(',');
        // L1 (lemon-model) stays 14; the L2 core list is `fieldsOf(CoreModel)` = L1 + `id`, `_id` (16).
        expect2(() => CORE_FIELDS.length).toEqual(14);
        expect2(() => fieldsOf(CoreModel).join(',')).toEqual(`${L1},id,_id`);
        // the class is resolved into its annotated fields (parent first), view fields excluded.
        expect2(() => $cls.FIELDS.join(',')).toEqual(`${L1},id,_id,name,test,extra`);
        expect2(() => $cls.FIELDS.includes('Model') || $cls.FIELDS.includes('$identity')).toEqual(false);
        // after `filterFields()` the class list equals the `string[]` list as a set.
        expect2(() => [...filterFields($cls.FIELDS)].sort()).toEqual([...$FIELD.test].sort());
        // `listProjections()` drops the 16 L2 core fields (incl. `$`, `id`, `_id`) from the class list.
        expect2(() => $cls.listProjections({ includes: [], excludes: [] })).toEqual(['extra', 'name', 'test']);
        // a `string[]` is kept as is.
        expect2(() => service.$test.FIELDS).toEqual($FIELD.test);
    });

    it('should pass ManagerProxy', async () => {
        const { service, current, context } = instance('session');
        const proxy = service.createProxy(context);

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => proxy.hello()).toEqual('manager-proxy:TT/dummy-data.yml');
        expect2(() => service.createProxy({}).hello()).toEqual('manager-proxy:TT/dummy-data.yml');

        const _base = <T extends Model>(type: ModelType, N?: T): Model => ({
            ns: 'TT',
            updatedAt: current,
            createdAt: current,
            deletedAt: 0,
            type,
            ...N,
        });

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a');
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:a');
        expect2(await service.$test.find('a')).toEqual(null);

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', true);
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:a');
        expect2(await service.$test.find('a')).toEqual(null);

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', false);
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual("Cannot set properties of null (setting 'name')");
        expect2(await service.$test.find('a')).toEqual(null);

        //* get w/ default.
        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', {});
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual({
            ..._base('test'),
            id: 'a',
            name: 'hi a',
        });
        expect2(await service.$test.find('a')).toEqual({
            _id: 'TT:test:a',
            ..._base('test'),
            id: 'a',
            name: 'hi a',
        });

        //* test of sample session.
        expect2(() => loadJsonSync(`./src/cores/context-session.json`)).toEqual({
            error: "ENOENT: no such file or directory, open './src/cores/context-session.json'",
        });

        expect2(() => context?.identity, 'sid,uid').toEqual({ sid: '1000000', uid: '1000001' });
        const identity = context?.identity;

        const $noCtx = service.createProxy(null as any);
        expect2(() => $noCtx.getCurrentSession({ throwable: true })).toEqual(
            '403 IDENTITY-TOKEN - .identity (IdentityToken) is required - context:',
        );
        expect2(() => proxy.getCurrentSession({ throwable: true }), 'sid,uid').toEqual({
            sid: '1000000',
            uid: '1000001',
        });

        const getCurrentSession = (options: {
            /** (default false for test) */
            throwable?: boolean;
            /** (default true) */
            useSession?: string | boolean;
            /** (optional) env.USE_SESSION */
            USE_SESSION?: string;
        }) => {
            options.throwable = options.throwable === undefined ? false : options.throwable;
            return $noCtx.getCurrentSession(options);
        };

        //! test with sample session.
        //NOTE - check with `context-session.json` local file (ONLY in templates-api)
        const $pack = loadJsonSync('package.json');
        if ($pack?.name == 'lemon-templates-api') {
            const dir = `sample/context-session.json`;
            const $ctx = loadSample('session')?.context?.identity;
            // const $ctx = loadJsonSync(dir)?.context?.identity;
            expect2(() => getCurrentSession({ useSession: false })).toEqual(null);
            expect2(() => getCurrentSession({ useSession: true, USE_SESSION: dir }), 'sid,uid').toEqual({
                sid: expect.any(String),
                uid: expect.any(String),
            });
            expect2(() => getCurrentSession({ useSession: true, USE_SESSION: dir }), 'sid,uid').toEqual({
                sid: $ctx?.sid,
                uid: $ctx?.uid,
            });
            expect2(() => getCurrentSession({ useSession: true })).toEqual(null);
            expect2(() => getCurrentSession({ useSession: '1', USE_SESSION: dir }), 'sid,uid').toEqual({
                sid: $ctx?.sid,
                uid: $ctx?.uid,
            });
            expect2(() => getCurrentSession({ useSession: '1' })).toEqual(null);
            expect2(() => getCurrentSession({ useSession: dir }), 'sid,uid').toEqual({
                sid: $ctx?.sid,
                uid: $ctx?.uid,
            });

            expect2(() => getCurrentSession({ useSession: 'wrongPath' })).toEqual(
                "@file[wrongPath] is invalid, ENOENT: no such file or directory, open './wrongPath'",
            );
            expect2(() => getCurrentSession({ useSession: '1', USE_SESSION: 'wrongPath' })).toEqual(null);
            expect2(() => getCurrentSession({ USE_SESSION: 'wrongPath' })).toEqual(null);

            expect2(() => proxy.asCurrentIdentityId(context)).toEqual(identity.identityId);
        }

        const parent: CoreModel = {
            sid: '0000008',
            uid: '0000007',
        };
        const model1: Model = {
            id: '1000001',
            sid: '1000000',
            uid: '1000001',
        };
        const model2: Model = {
            id: '1000001',
        };
        expect2(await proxy.makeModelBase(model1)).toEqual(model1);
        expect2(await proxy.makeModelBase(model1, { parent: parent })).toEqual(model1);
        expect2(await proxy.makeModelBase(model1, { useSession: true })).toEqual(model1);
        expect2(await proxy.makeModelBase(model2)).toEqual(model2);
        expect2(await proxy.makeModelBase(model2, { parent: parent })).toEqual({
            id: '1000001',
            sid: '0000008',
            uid: '0000007',
        });

        //* test of canDo() w/o session.
        const _ctx = (N: NextIdentity, domain?: string): NextContext<NextIdentity> => {
            const $ctx = proxy.context as NextContext<NextIdentity>;
            domain = domain ?? $ctx?.domain;
            return { ...$ctx, identity: { ...$ctx?.identity, ...N }, domain };
        };
        const _can = (action?: any, M?: Model, opts?: any) => proxy.tests.canDo(action, M, opts);
        const $user0 = _ctx({ roles: ['user'] }); // normal user.
        const $user1 = _ctx({ roles: ['user'], uid: '2002' }); // diff uid.
        const $user2 = _ctx({ roles: ['user'], uid: '2002', sid: '999' }); // idff uid & sid.
        const $admin = _ctx({ roles: ['admin'] }); // admin for all.
        const $other = _ctx({ roles: ['other'] });

        // test of basic canDo in core-proxy.
        if (1) {
            expect2(() => proxy.canDo(null, null)).toEqual('400 INVALID - @model.type (string) is required!');
            expect2(() => proxy.canDo(null, {})).toEqual('400 INVALID - @model.type (string) is required!');
            expect2(() => proxy.canDo(null, { type: '' as any })).toEqual(false);
            expect2(() => proxy.canDo(null, { type: 'test' })).toEqual(
                '400 INVALID - action[] is invalid @canDo(:test/-)',
            );
        }

        // test of basic canDo in manager-proxy.
        if (1) {
            expect2(() => _can()).toEqual('400 INVALID - action[] is invalid @canDo(:test/-)');
            expect2(() => _can(null, null, { errScope: 'xxx' })).toEqual('400 INVALID - action[] is invalid @xxx');
            expect2(() => _can('', null, { errScope: 'xxx' })).toEqual('400 INVALID - action[] is invalid @xxx');
            expect2(() => _can(1, null, { errScope: 'xxx' })).toEqual('400 INVALID - action[1] is invalid @xxx');
            expect2(() => _can('s', null, { errScope: 'xxx' })).toEqual('400 INVALID - action[s] is invalid @xxx');
            expect2(() => _can('s', null)).toEqual('400 INVALID - action[s] is invalid @canDo(s:test/-)');

            expect2(() => $user0, 'domain').toEqual({ domain: 'api.lemoncloud.io' });
            expect2(() => $user0?.identity, 'sid,uid,roles').toEqual({
                sid: '1000000',
                uid: '1000001',
                roles: ['user'],
            });
            expect2(() => $admin?.identity, 'sid,uid,roles').toEqual({
                sid: '1000000',
                uid: '1000001',
                roles: ['admin'],
            });
            expect2(() => $other?.identity, 'sid,uid,roles').toEqual({
                sid: '1000000',
                uid: '1000001',
                roles: ['other'],
            });

            const $opts = { context: $user0, throwable: false };
            expect2(() => proxy.assertContext({ isLocal: true }, $opts)).toEqual(false);
            expect2(() => proxy.assertContext({ isSigned: true, isAuthed: false }, $opts)).toEqual(false);
            expect2(() => proxy.assertContext({ isAuthed: true, hasRole: 'admin' }, $opts)).toEqual(false);

            expect2(() => $T.S2(undefined, 'admin')).toEqual('admin');
            expect2(() => $T.S2(null, 'admin')).toEqual('admin');
            expect2(() => $T.S2('', 'admin')).toEqual('');

            expect2(() => proxy.hasAdminRole(null, { context: $user0 })).toEqual(false);
            expect2(() => proxy.hasAdminRole('user', { context: $user0 })).toEqual(true);
            expect2(() => proxy.hasAdminRole(null, { context: $admin })).toEqual(true);
            expect2(() => proxy.hasAdminRole(null, { context: $other })).toEqual(false);
        }

        //* test of canDo() w/ session(user0).
        if (1) {
            const _can2 = (action?: CanDoActionType | string, M = model1) =>
                _can(action, M, { context: $user0, throwable: false });
            expect2(() => _can2()).toEqual('400 INVALID - action[] is invalid @canDo(:test/1000001)');
            expect2(() => _can2('list')).toEqual(true);
            expect2(() => _can2('read')).toEqual(true);
            expect2(() => _can2('create')).toEqual(true);
            expect2(() => _can2('update')).toEqual(true);
            expect2(() => _can2('delete')).toEqual(true);
            expect2(() => _can2('some')).toEqual('400 INVALID - action[some] is invalid @canDo(some:test/1000001)');

            //* test with other sid.
            const _sid = (sid?: string) => ({ ...model1, sid });
            expect2(() => _can2('read', _sid())).toEqual(true);
            expect2(() => _can2('read', _sid(''))).toEqual(true);
            expect2(() => _can2('read', _sid('1'))).toEqual(false);

            //* v5 B5: a `sid`-less record — list/read/create open, update/delete admin-only (S-37, SPEC § 6.4).
            expect2(() => _can2('list', _sid(''))).toEqual(true);
            expect2(() => _can2('create', _sid(''))).toEqual(true);
            expect2(() => _can2('update', _sid(''))).toEqual(false);
            expect2(() => _can2('delete', _sid(''))).toEqual(false);
            expect2(() => _can2('update', _sid())).toEqual(false);
            const _canAdm = (action: CanDoActionType) => _can(action, _sid(''), { context: $admin, throwable: false });
            expect2(() => _canAdm('update')).toEqual(true);
            expect2(() => _canAdm('delete')).toEqual(true);
        }
        //* test of canDo() w/ session(user1).
        if (1) {
            const _can2 = (action?: CanDoActionType | string) =>
                _can(action, model1, { context: $user1, throwable: false });
            expect2(() => _can2()).toEqual('400 INVALID - action[] is invalid @canDo(:test/1000001)');
            expect2(() => _can2('list')).toEqual(true);
            expect2(() => _can2('read')).toEqual(true);
            expect2(() => _can2('create')).toEqual(true);
            expect2(() => _can2('update')).toEqual(false);
            expect2(() => _can2('delete')).toEqual(false);
            expect2(() => _can2('some')).toEqual('400 INVALID - action[some] is invalid @canDo(some:test/1000001)');
        }
        //* test of canDo() w/ session(user1) + throwable.
        if (1) {
            const _can2 = (action?: CanDoActionType | string) =>
                _can(action, model1, { context: $user1, throwable: true });
            expect2(() => _can2()).toEqual('400 INVALID - action[] is invalid @canDo(:test/1000001)');
            expect2(() => _can2('list')).toEqual(true);
            expect2(() => _can2('read')).toEqual(true);
            expect2(() => _can2('create')).toEqual(true);
            expect2(() => _can2('update')).toEqual(
                '403 NOT ALLOWED - action[update] is invalid @canDo(update:test/1000001)',
            );
            expect2(() => _can2('delete')).toEqual(
                '403 NOT ALLOWED - action[delete] is invalid @canDo(delete:test/1000001)',
            );
            expect2(() => _can2('some')).toEqual('400 INVALID - action[some] is invalid @canDo(some:test/1000001)');
        }

        //* test of canDo() w/ session(user2).
        if (1) {
            const _can2 = (action?: CanDoActionType | string, throwable: boolean = false) =>
                _can(action, model1, { context: $user2, throwable });
            expect2(() => _can2()).toEqual('400 INVALID - action[] is invalid @canDo(:test/1000001)');
            expect2(() => _can2('list')).toEqual(false);
            expect2(() => _can2('read')).toEqual(false);
            expect2(() => _can2('create')).toEqual(false);
            expect2(() => _can2('update')).toEqual(false);
            expect2(() => _can2('delete')).toEqual(false);
            expect2(() => _can2('some')).toEqual('400 INVALID - action[some] is invalid @canDo(some:test/1000001)');

            expect2(() => _can2('delete', true)).toEqual(
                '403 NOT ALLOWED - action[delete] is invalid @canDo(delete:test/1000001)',
            );
        }
        //* test of canDo() w/ session(admin).
        if (1) {
            const _can2 = (action?: CanDoActionType | string) =>
                _can(action, model1, { context: $admin, throwable: false });
            expect2(() => _can2()).toEqual('400 INVALID - action[] is invalid @canDo(:test/1000001)');
            expect2(() => _can2('list')).toEqual(true);
            expect2(() => _can2('read')).toEqual(true);
            expect2(() => _can2('create')).toEqual(true);
            expect2(() => _can2('update')).toEqual(true);
            expect2(() => _can2('delete')).toEqual(true);
            expect2(() => _can2('some')).toEqual('400 INVALID - action[some] is invalid @canDo(some:test/1000001)');
        }
        //* test of canDo() w/ session(other).
        if (1) {
            const _can2 = (action?: CanDoActionType | string) =>
                _can(action, model1, { context: $other, throwable: false });
            expect2(() => _can2()).toEqual('400 INVALID - action[] is invalid @canDo(:test/1000001)');
            expect2(() => _can2('list')).toEqual(true);
            expect2(() => _can2('read')).toEqual(true);
            expect2(() => _can2('create')).toEqual(true);
            expect2(() => _can2('update')).toEqual(true);
            expect2(() => _can2('delete')).toEqual(true);
            expect2(() => _can2('some')).toEqual('400 INVALID - action[some] is invalid @canDo(some:test/1000001)');
        }
    });

    it('should pass packSearchParam(session)', async () => {
        const { service, context } = instance('session');

        expect2(await service.guardProxy(context, async proxy => proxy.tests.packSearchParam({}))).toEqual({
            $page: { limit: 10, page: 0, sort: '' },
            $param: {},
        });

        expect2(await service.guardProxy(context, async proxy => proxy.tests.packSearchParam({ page: '1' }))).toEqual({
            $page: { limit: 10, page: 1, sort: '' },
            $param: {},
        });

        expect2(
            await service
                .guardProxy(context, async proxy =>
                    proxy.tests.packSearchParam(
                        { page: '1', offset: '2', limit: '3' },
                        { name: '' },
                        { useSession: true },
                    ),
                )
                // .then(N => $U.json(N))
                .catch(GETERR),
        ).toEqual({
            $page: {
                page: 1,
                limit: 3,
                offset: 2,
                sort: '',
            },
            $param: {
                sid: '1000000',
                name: '',
            },
        });
    });

    it('should pass buildQuery for ES', async () => {
        const { service } = instance();

        const param: PaginateParam = {
            limit: 30,
            page: 1,
        };

        const baseExpected = {
            from: 30,
            size: 30,
            sort: { createdAt: { missing: '_last', order: 'desc' } },
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                },
            },
            aggs: { stereo: { terms: { field: 'stereo.keyword', missing: 'N/A', order: { _key: 'asc' }, size: 12 } } },
        };

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        expect2(() => service.$test.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );

        //* validate param option
        expect2(() => service.$test.buildQuery({})).toEqual('.limit(number) is required - buildQuery(test)');
        expect2(() => service.$test.buildQuery({ limit: '30' as any })).toEqual(
            '.limit(number) is required - buildQuery(test)',
        );
        expect2(() => service.$test.buildQuery({ limit: '30' as any, page: 10 })).toEqual(
            '.limit(number) is required - buildQuery(test)',
        );
        // expect2(() => service.$test.buildQuery({ limit: 30 })).toEqual('.page(number) is required - buildQuery(test)');
        expect2(() => service.$test.buildQuery({ limit: 30, page: '10' as any })).toEqual(
            '.page(number) is required - buildQuery(test)',
        );
        expect2(() => service.$test.buildQuery({ limit: 30, page: 0, offset: '10' as any })).toEqual(
            '.offset(number) is required - buildQuery(test)',
        );

        //* validate filter by attributes
        expect2(() => service.$test.buildQuery(param)).toEqual({
            ...baseExpected,
        });
        expect2(() => service.$test.buildQuery({ ...param, offset: 1 })).toEqual({
            ...baseExpected,
            from: baseExpected.from + 1,
        });
        expect2(() => service.$test.buildQuery(param, { _idx: 0 })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { _idx: 0 } },
                    ],
                },
            },
        });
        expect2(() => service.$test.buildQuery(param, { _date: '2023-02-08' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { '_date.keyword': '2023-02-08' } },
                    ],
                },
            },
        });
        expect2(() => service.$test.buildQuery(param, { name: 'lemon' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'name.keyword': 'lemon' } },
                    ],
                },
            },
        });
        expect2(() => service.$test.buildQuery(param, { _idx: 0, _date: '2023-02-08', name: 'lemon' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { _idx: 0 } },
                        { term: { '_date.keyword': '2023-02-08' } },
                        { term: { 'name.keyword': 'lemon' } },
                    ],
                },
            },
        });

        //* validate add must
        expect2(() => service.$test.buildQuery(param, { name: '!' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must: [{ exists: { field: 'name' } }],
                },
            },
        });

        //* validate add must_not
        expect2(() => service.$test.buildQuery(param, { name: '' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must_not: [{ exists: { field: 'name' } }],
                },
            },
        });
        //* validate default filter.
        expect2(() => service.$test.buildQuery(param, { stereo: null as any }), 'query').toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must_not: [{ term: { 'stereo.keyword': '#' } }],
                },
            },
        });

        //* validate filter by attributes.
        expect2(() => service.$test.buildQuery(param, { extra: ['a', 'b'] as any }), 'query').toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must: [
                        {
                            bool: {
                                minimum_should_match: 1,
                                should: [{ term: { 'extra.keyword': 'a' } }, { term: { 'extra.keyword': 'b' } }],
                            },
                        },
                    ],
                },
            },
        });

        //* validate addSortTerm
        const $searchBody: SearchBody = {
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                },
            },
            size: 0,
        };
        const addSortTermAgent = (sortString: string, searchBody?: SearchBody, parameter?: any) => {
            searchBody = searchBody ?? $searchBody;
            parameter = parameter ?? param;
            const { sort } = service.$test.addSortTerm($searchBody, { ...parameter, sort: sortString });
            return sort;
        };
        expect2(() => addSortTermAgent('id')).toEqual({ 'id.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('name')).toEqual({ 'name.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('brand')).toEqual({ 'brand.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('color')).toEqual({ 'color.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('createdAt')).toEqual({ createdAt: { missing: '_first', order: 'asc' } });
        expect2(() => addSortTermAgent('updatedAt')).toEqual({ updatedAt: { missing: '_first', order: 'asc' } });
        expect2(() => addSortTermAgent('a')).toEqual({ 'a.keyword': { missing: '_first', order: 'asc' } });

        //* validate buildSearchAll
        const result = service.$test.buildSearchAll();
        expect2(() => result._source).toEqual(['id', 'error', 'createdAt', 'name', 'test']);
        expect2(() => result.query).toEqual({
            bool: {
                filter: [{ term: { 'ns.keyword': 'TT' } }, { term: { 'type.keyword': 'test' } }],
                must: [
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                { range: { deletedAt: { lte: 0 } } },
                                {
                                    bool: {
                                        must_not: {
                                            exists: {
                                                field: 'deletedAt',
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
                must_not: [{ term: { stereo: '#' } }, { term: { 'stereo.keyword': '#' } }],
            },
        });
        expect2(() => result.size).toEqual(500);
        expect2(() => result.sort).toEqual({ createdAt: { missing: '_last', order: 'asc' } });
    });

    it('should pass ManagerProxy(authed)', async () => {
        const { service, context } = instance('authed');
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '0008540000',
            identityId: 'ap-northeast-2:00000000-1111-1111-1111-mocks-user',
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(
            '403 NOT ALLOWED - invalid isSigned[true] @assertContext()',
        );
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(true);

        expect2(() => proxy.hasAdminRole()).toEqual(false);
        expect2(() => proxy.hasAdminRole('user')).toEqual(false);
    });

    it('should pass ManagerProxy(signed)', async () => {
        const { service, context } = instance('signed');
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '444455556666',
            identityId: null,
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(true);
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(
            '403 NOT ALLOWED - invalid isAuthed[true] @assertContext()',
        );

        expect2(() => proxy.hasAdminRole()).toEqual(true);
        expect2(() => proxy.hasAdminRole('user')).toEqual(true);
    });

    it('should pass ManagerProxy(session)', async () => {
        const { service, context } = instance('session');
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '111122223333',
            identityId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(true);
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(true);

        expect2(() => proxy.hasAdminRole()).toEqual(false);
        expect2(() => proxy.hasAdminRole('user')).toEqual(true);
    });

    it('should pass ManagerProxy(session + local)', async () => {
        const { service, context } = instance('session', { domain: 'localhost' });
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '111122223333',
            identityId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
        });
        //* v5 B5: `domain: 'localhost'` grants nothing without local mode (flipped from v4 true).
        delete process.env.LOCAL_MODE;
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.hasAdminRole()).toEqual(false);

        //* v5 B5: local mode is the runtime setting `LOCAL_MODE=1` (off Lambda).
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        expect2(() => $U.isLocalMode()).toEqual(true);
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(true);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(true);
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(true);

        expect2(() => proxy.hasAdminRole()).toEqual(true);
        expect2(() => proxy.hasAdminRole('user')).toEqual(true);

        //* v5 B5: never in Lambda, whatever the env says.
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'any-function';
        expect2(() => $U.isLocalMode()).toEqual(false);
        expect2(() => proxy.hasAdminRole()).toEqual(false);
    });

    it('should pass doScanLast(real)', async () => {
        if (PROFILE !== 'lemon') return; // ignore this.
        const { service } = instance('authed', { dummy: false });

        //TODO - should comfirm the initial data set.
        const result = await service.$test.doScanLast({ limit: 3 });

        //* 1. doScanLast with { limit }
        expect2(() => result.count).toEqual(3);
        expect2(() => result.limit).toEqual(3);
        expect2(() => result.total).toEqual(3);
        expect2(() => result.list?.map(N => N.id)).toEqual([
            expect.any(String),
            expect.any(String),
            expect.any(String),
        ]);

        expect2(() => result.last).toEqual({ _id: 'TT:test:1000243' });
        expect2(() => result.list).toEqual([
            {
                _id: 'TT:test:1000078',
                age: 2,
                createdAt: 1718688801255,
                deletedAt: 0,
                id: '1000078',
                name: '1718688801037',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718688801255,
            },
            {
                _id: 'TT:#query:1000017',
                createdAt: 1734325286081,
                deletedAt: 0,
                id: '1000017',
                name: '#',
                ns: 'TT',
                query: '{"query":{"query":{"bool":{"filter":{"term":{"type":"test"}}}},"aggs":{"test":{"terms":{"field":"count"}}},"sort":[{"count":{"order":"asc","missing":"_last"}}]}}',
                type: '#query',
                updatedAt: 1734325286131,
            },
            {
                _id: 'TT:test:1000243',
                age: 1,
                createdAt: 1718703832286,
                deletedAt: 0,
                id: '1000243',
                name: '1718703832078',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718703832286,
            },
        ]);
        //* 2. doScanLast with { limit, last }
        const resultWithLast = await service.$test.doScanLast({ limit: 3, last: { _id: 'TT:test:1000243' } });
        expect2(() => resultWithLast.count).toEqual(3);
        expect2(() => resultWithLast.limit).toEqual(3);
        expect2(() => resultWithLast.total).toEqual(3);
        expect2(() => resultWithLast.last).toEqual({ _id: 'TT:test:1000159' });
        expect2(() => resultWithLast.list).toEqual([
            {
                _id: 'TT:test:1000004',
                createdAt: 1711679260356,
                deletedAt: 0,
                id: '1000004',
                name: 'lemon',
                ns: 'TT',
                type: 'test',
                updatedAt: 1711679260356,
            },
            {
                _id: 'TT:test:1000212',
                age: 1,
                createdAt: 1718701431833,
                deletedAt: 0,
                id: '1000212',
                name: '1718701431689',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718701431833,
            },
            {
                _id: 'TT:test:1000159',
                age: 1,
                createdAt: 1718697350728,
                deletedAt: 0,
                id: '1000159',
                name: '1718697350582',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718697350728,
            },
        ]);

        //* 2.1 check whether $params works well
        const resultForVerification = await service.$test.doScanLast({ limit: 6 });

        expect2(() => resultForVerification.count).toEqual(6);
        expect2(() => resultForVerification.limit).toEqual(6);
        expect2(() => resultForVerification.total).toEqual(6);
        // expectedLast should be the last of doScanLast with { limit, last }
        const expectedLast = resultWithLast.last;
        expect2(() => resultForVerification.last).toEqual(expectedLast);
        // expectedList should be the list results of test step 1 & 2
        const expectedList = result.list.concat(resultWithLast.list);
        expect2(() => resultForVerification.list).toEqual(expectedList);

        //* 3. doScanLast with { limit, filter }
        const resultWithFilter = await service.$test.doScanLast({
            limit: 3,
            filter: { key: 'type', operator: 'contains', value: 'test' },
        });
        expect2(() => resultWithFilter.count).toEqual(2);
        expect2(() => resultWithFilter.limit).toEqual(3);
        expect2(() => resultWithFilter.total).toEqual(2);
        expect2(() => resultWithFilter.last).toEqual({ _id: 'TT:test:1000243' });
        expect2(() => resultWithFilter.list).toEqual([
            {
                _id: 'TT:test:1000078',
                age: 2,
                createdAt: 1718688801255,
                deletedAt: 0,
                id: '1000078',
                name: '1718688801037',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718688801255,
            },
            {
                _id: 'TT:test:1000243',
                age: 1,
                createdAt: 1718703832286,
                deletedAt: 0,
                id: '1000243',
                name: '1718703832078',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718703832286,
            },
        ]);

        //* 4. doScanLast with last _id
        const checkLast = await service.$test.doScanLast({ limit: 20, last: { _id: 'TT:test:1000216' } });
        expect2(() => checkLast).toEqual();
        expect2(() => checkLast.count).toEqual(0);
        expect2(() => checkLast.limit).toEqual(20);
        expect2(() => checkLast.total).toEqual(0);
        expect2(() => checkLast.last).toEqual();
        expect2(() => checkLast.list).toEqual([]);
    });

    it('should pass migrate search-index', async () => {
        const { service } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        if (service.hello()?.endsWith('.yml')) return; // ignore this test.

        const result = await service.$test.doSyncScanLast({ limit: 10 });
        expect2(() => result.last).toEqual({ _id: 'TT:test:1000246' });
        expect2(() => result.count).toEqual(10);
        // expect2(() => result.took).toEqual(0.1);
        expect2(() => result.list[0], '!_version').toEqual({ _id: 'TT:test:1000078', error: undefined, status: 200 });
        expect2(() => result.list[1], '!_version').toEqual({ _id: 'TT:#query:1000017', error: undefined, status: 200 });
        expect2(() => result.list[2], '!_version').toEqual({ _id: 'TT:test:1000243', error: undefined, status: 200 });

        //* doSyncScanLast with last _id
        const checkLast = await service.$test.doSyncScanLast({ limit: 20, last: { _id: 'TT:test:1000216' } });
        expect2(() => checkLast.last).toEqual();
        expect2(() => checkLast.count).toEqual(0);
        // expect2(() => checkLast.took).toEqual(0.1);
        expect2(() => checkLast.list[0], '!_version').toEqual();
    });

    it('should pass mget() - batch get', async () => {
        const { service, current, context } = instance('session');

        const _base = <T extends Model>(type: ModelType, N?: T): Model => ({
            ns: 'TT',
            updatedAt: current,
            createdAt: current,
            deletedAt: 0,
            type,
            ...N,
        });

        //* STEP.1 empty list
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget([]);
            }),
        ).toEqual([]);

        //* STEP.2 single id - not found (throwable)
        expect2(
            await service
                .guardProxy(context, async proxy => {
                    return proxy.tests.mget(['3001']);
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:3001');

        //* STEP.3 single id - not found (non-throwable)
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget(['3001'], false);
            }),
        ).toEqual([null]);

        //* STEP.4 create test data
        const $a = await service.guardProxy(context, async proxy => {
            const a = await proxy.tests.get('a', {});
            a.name = 'test-a';
            return a;
        });
        const $b = await service.guardProxy(context, async proxy => {
            const b = await proxy.tests.get('b', {});
            b.name = 'test-b';
            return b;
        });

        //* STEP.5 batch get - found
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget(['a', 'b']);
            }),
        ).toEqual([
            { ..._base('test'), id: 'a', name: 'test-a' },
            { ..._base('test'), id: 'b', name: 'test-b' },
        ]);

        //* STEP.6 batch get - mixed (found + not found)
        expect2(
            await service
                .guardProxy(context, async proxy => {
                    return proxy.tests.mget(['a', '3002', 'b']);
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:3002');

        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget(['a', '3002', 'b'], false);
            }),
        ).toEqual([{ ..._base('test'), id: 'a', name: 'test-a' }, null, { ..._base('test'), id: 'b', name: 'test-b' }]);

        //* STEP.7 duplicate ids
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget(['a', 'a', 'b']);
            }),
        ).toEqual([
            { ..._base('test'), id: 'a', name: 'test-a' },
            { ..._base('test'), id: 'a', name: 'test-a' },
            { ..._base('test'), id: 'b', name: 'test-b' },
        ]);

        //* STEP.8 cache test - modify and get again
        expect2(
            await service.guardProxy(context, async proxy => {
                const [a1] = await proxy.tests.mget(['a']);
                a1.name = 'modified-a';
                const [a2] = await proxy.tests.mget(['a']);
                return { a1: a1.name, a2: a2.name };
            }),
        ).toEqual({ a1: 'modified-a', a2: 'modified-a' });
    });

    it('should pass mset() - batch update', async () => {
        const { service, current, context } = instance('session');

        const _base = <T extends Model>(type: ModelType, N?: T): Model => ({
            ns: 'TT',
            updatedAt: current,
            createdAt: current,
            deletedAt: 0,
            type,
            ...N,
        });

        //* STEP.1 empty list
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mset([]);
            }),
        ).toEqual([]);

        //* STEP.2 create test data
        const $a = await service.guardProxy(context, async proxy => {
            const a = await proxy.tests.get('a', {});
            a.name = 'test-a';
            a.test = 10;
            return a;
        });

        const $b = await service.guardProxy(context, async proxy => {
            const b = await proxy.tests.get('b', {});
            b.name = 'test-b';
            b.test = 20;
            return b;
        });

        //* STEP.3 single update
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mset([{ id: 'a', name: 'updated-a' }]);
            }),
        ).toEqual([{ ..._base('test'), id: 'a', name: 'updated-a', test: 10 }]);

        //* STEP.4 batch update - multiple models
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mset([
                    { id: 'a', name: 'batch-a', test: 15 },
                    { id: 'b', name: 'batch-b', test: 25 },
                ]);
            }),
        ).toEqual([
            { ..._base('test'), id: 'a', name: 'batch-a', test: 15 },
            { ..._base('test'), id: 'b', name: 'batch-b', test: 25 },
        ]);

        //* STEP.5 update without id - should throw error
        expect2(
            await service
                .guardProxy(context, async proxy => {
                    return proxy.tests.mset([{ name: 'no-id' } as any]);
                })
                .catch(GETERR),
        ).toEqual('@id is required - proxy/test/mset()!');

        //* STEP.6 update with non-existent id - should throw error
        expect2(
            await service
                .guardProxy(context, async proxy => {
                    return proxy.tests.mset([{ id: 'non-existent', name: 'test' }]);
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:non-existent');

        //* STEP.7 batch update - mixed (valid + invalid)
        expect2(
            await service
                .guardProxy(context, async proxy => {
                    return proxy.tests.mset([
                        { id: 'a', name: 'valid-a' },
                        { id: 'invalid-id', name: 'invalid' },
                    ]);
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:invalid-id');

        //* STEP.8 verify final state after updates
        //* v5 B5: `guardProxy` no longer saves on exception (default) → 'valid-a' is NOT saved (v4 saved it).
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget(['a', 'b']);
            }),
        ).toEqual([
            { ..._base('test'), id: 'a', name: 'batch-a', test: 15 },
            { ..._base('test'), id: 'b', name: 'batch-b', test: 25 },
        ]);

        //* STEP.8-b v5 B5: the same mixed update with `saveOnError: true` keeps the v4 behaviour (saved, then rethrown).
        expect2(
            await service
                .guardProxy(
                    context,
                    async proxy => {
                        return proxy.tests.mset([
                            { id: 'a', name: 'valid-a' },
                            { id: 'invalid-id', name: 'invalid' },
                        ]);
                    },
                    { saveOnError: true },
                )
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:invalid-id');
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mget(['a', 'b']);
            }),
        ).toEqual([
            { ..._base('test'), id: 'a', name: 'valid-a', test: 15 },
            { ..._base('test'), id: 'b', name: 'batch-b', test: 25 },
        ]);

        //* STEP.9 partial update - only specified fields
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mset([{ id: 'a', test: 100 }]);
            }),
        ).toEqual([{ ..._base('test'), id: 'a', name: 'valid-a', test: 100 }]);

        //* STEP.10 duplicate ids in updates
        expect2(
            await service.guardProxy(context, async proxy => {
                return proxy.tests.mset([
                    { id: 'a', name: 'first-update' },
                    { id: 'a', name: 'second-update' },
                ]);
            }),
        ).toEqual([
            { ..._base('test'), id: 'a', name: 'second-update', test: 100 },
            { ..._base('test'), id: 'a', name: 'second-update', test: 100 },
        ]);
    });

    //* v5 B2-b: `$OS2` is one lazy object; a lazy instance builds 1 listener on first touch and 1 client on first use.
    it('should pass lazy $OS2', async () => {
        expect2(() => $OS2 === $ES6Routed).toEqual(true);
        expect2(() => $OS2 instanceof OS2Instance).toEqual(true);

        // listeners on the global dynamo-stream registry (protected field, read for the test).
        const listeners = () => ((($cores.lambda.dynamos as any).listeners as any[]) ?? []).length;
        const created = vi.spyOn(OS2Service.prototype as any, 'createClient');
        try {
            const n0 = listeners();
            const $lazy = lazyInstance(() => _OS2({ endpoint: 'https://127.0.0.1:9', indexName: 'test-lazy' }));
            expect2(() => listeners() - n0).toEqual(0); // nothing built yet.
            expect2(() => $lazy.hello()).toEqual('OS2Instance');
            expect2(() => listeners() - n0).toEqual(1); // one synchronizer.
            expect2(() => created.mock.calls.length).toEqual(0); // no client yet.
            expect2(() => !!$lazy.elastic.client).toEqual(true);
            expect2(() => created.mock.calls.length).toEqual(1); // the master client, once.
            expect2(() => !!$lazy.client).toEqual(true);
            expect2(() => created.mock.calls.length).toEqual(1);
        } finally {
            created.mockRestore();
        }
    });
});
