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
 * @date        2026-10-30 v5 B13: default data-access policy cases (SPEC § 14, T-01..T-27, T-34..T-36).
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
import { AccessPolicy, DEFAULT_ACCESS_POLICY } from './abstract-services'; //* v5 B13: default data-access policy.
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
const $envB5 = {
    LOCAL_MODE: process.env.LOCAL_MODE,
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
    SID_LEGACY_ACCESS: process.env.SID_LEGACY_ACCESS, //* v5: `canDo` mode for `sid`-less records (owner 2026-10-28).
};
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
        restoreEnvB5('SID_LEGACY_ACCESS');
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

    //* v5: env `SID_LEGACY_ACCESS` (admin | open | deny) for update/delete of a `sid`-less record (B5 § 6.4).
    it('should pass canDo() with env SID_LEGACY_ACCESS', async () => {
        const { service, context } = instance('session');
        const proxy = service.createProxy(context);
        //* a context with the identity overridden.
        const _ctx = (N: NextIdentity): NextContext<NextIdentity> => {
            const $ctx = proxy.context as NextContext<NextIdentity>;
            return { ...$ctx, identity: { ...$ctx?.identity, ...N } };
        };
        const $user0 = _ctx({ roles: ['user'] });
        const $admin = _ctx({ roles: ['admin'] });
        const $guest = _ctx({ roles: [] });
        const legacy: Model = { id: '1000001', uid: '1000001' }; // no `sid`.
        const owned: Model = { id: '1000001', sid: '1000000', uid: '1000001' };
        //* the 5 actions as `{ action: allowed }`, `throwable: false`.
        const _all = ($ctx: NextContext<NextIdentity>, M: Model) =>
            (['list', 'read', 'create', 'update', 'delete'] as CanDoActionType[]).reduce(
                (N, A) => ({ ...N, [A]: proxy.tests.canDo(A, M, { context: $ctx, throwable: false }) }),
                {} as Record<string, boolean>,
            );
        const OPEN = { list: true, read: true, create: true, update: true, delete: true };
        const READ = { list: true, read: true, create: true, update: false, delete: false };
        const NONE = { list: false, read: false, create: false, update: false, delete: false };

        //* unset (default) and an unknown value → `admin`.
        for (const val of [undefined, 'admin', 'ADMIN', 'unknown', '']) {
            if (val === undefined) delete process.env.SID_LEGACY_ACCESS;
            else process.env.SID_LEGACY_ACCESS = val;
            expect2(() => $U.sidLegacyAccess()).toEqual('admin');
            expect2(() => _all($user0, legacy)).toEqual(READ);
            expect2(() => _all($admin, legacy)).toEqual(OPEN);
            expect2(() => _all($guest, legacy)).toEqual(NONE);
            expect2(() => _all($user0, owned)).toEqual(OPEN);
        }

        //* `open` → the v4 rule: a role holder may update/delete.
        process.env.SID_LEGACY_ACCESS = 'open';
        expect2(() => $U.sidLegacyAccess()).toEqual('open');
        expect2(() => _all($user0, legacy)).toEqual(OPEN);
        expect2(() => _all($admin, legacy)).toEqual(OPEN);
        expect2(() => _all($guest, legacy)).toEqual(NONE);
        expect2(() => _all($user0, owned)).toEqual(OPEN);

        //* `deny` → nobody may update/delete, not even admin; read/list stay open.
        process.env.SID_LEGACY_ACCESS = 'deny';
        expect2(() => $U.sidLegacyAccess()).toEqual('deny');
        expect2(() => _all($user0, legacy)).toEqual(READ);
        expect2(() => _all($admin, legacy)).toEqual(READ);
        expect2(() => _all($guest, legacy)).toEqual(NONE);
        expect2(() => _all($user0, owned)).toEqual(OPEN);
        expect2(() => _all($admin, owned)).toEqual(OPEN);
        expect2(() => proxy.tests.canDo('delete', legacy, { context: $admin, throwable: true })).toEqual(
            '403 NOT ALLOWED - action[delete] is invalid @canDo(delete:test/1000001)',
        );
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

//* v5 B13: `canDo()` and `packSearchParam()` with the session on, per SPEC § 14.2 (default policy) and § 14.6.
describe('abstract-services B13 access policy', () => {
    //* restore the toggled env and spies.
    afterEach(() => {
        restoreEnvB5('LOCAL_MODE');
        restoreEnvB5('AWS_LAMBDA_FUNCTION_NAME');
        restoreEnvB5('SID_LEGACY_ACCESS');
        vi.restoreAllMocks();
    });
    loadProfile(process); // override process.env (same profile as above).

    const ACTS: CanDoActionType[] = ['list', 'read', 'create', 'update', 'delete'];
    const ALL = { list: true, read: true, create: true, update: true, delete: true };
    const NONE = { list: false, read: false, create: false, update: false, delete: false };
    //* the stored row of OWN (site 1000000, user 1000001).
    const ROW: Model = { type: 'test', id: '1000001', sid: '1000000', uid: '1000001' };

    //* the fixture: session sample (sid 1000000, uid 1000001, roles user) + the caller states of § 14.2.
    const _setup = () => {
        const { service, context } = instance('session');
        const proxy = service.createProxy(context);
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
        //* one action with the session on (`throwable: false` unless given).
        const _can = (ctx: NextContext, action: any, M?: Model, opts?: any) =>
            proxy.tests.canDo(action, M, { context: ctx, useSession: true, throwable: false, ...opts });
        //* the 5 actions as `{ action: allowed }`.
        const _all = (ctx: NextContext, M?: Model, opts?: any) =>
            ACTS.reduce((N, A) => ({ ...N, [A]: _can(ctx, A, M, opts) }), {} as Record<string, boolean>);
        //* `packSearchParam()` on a proxy of `ctx`, session on → `$param`.
        const _pack = (ctx: NextContext, param: any, opts?: any) =>
            service.createProxy(ctx).tests.packSearchParam(param, undefined, { useSession: true, ...opts }).$param;
        //* the error message (or the value), cut before the context dump.
        const _msg = (fn: () => any) => {
            try {
                return fn();
            } catch (e) {
                return `${e?.message ?? e}`.split(' - context:')[0];
            }
        };
        //* the row as created by the caller of `ctx` (session stamp).
        const _mine = (ctx: NextContext): Model => ({
            ...ROW,
            sid: (ctx.identity as any)?.sid,
            uid: (ctx.identity as any)?.uid,
        });
        return { service, proxy, $, _can, _all, _pack, _msg, _mine };
    };

    it('B13 § 14.1 DEFAULT_ACCESS_POLICY and effectivePolicy()', async () => {
        const { proxy } = _setup();
        expect2(() => DEFAULT_ACCESS_POLICY).toEqual({
            list: 'site',
            read: 'owner',
            create: 'owner',
            update: 'owner',
            delete: 'owner',
        });
        expect2(() => Object.isFrozen(DEFAULT_ACCESS_POLICY)).toEqual(true);
        expect2(() => proxy.tests.accessPolicy()).toEqual(DEFAULT_ACCESS_POLICY);
        expect2(() => proxy.tests.effectivePolicy({ read: 'site', list: undefined })).toEqual({
            ...DEFAULT_ACCESS_POLICY,
            read: 'site',
        });
    });

    it('B13 T-01 ADM list: all sites, `?sid=` optional, else own site', async () => {
        const { $, _can, _pack } = _setup();
        expect2(() => _can($.admin, 'list')).toEqual(true);
        expect2(() => _pack($.admin, {})).toEqual({ sid: '999' });
        expect2(() => _pack($.admin, { sid: '1000000' })).toEqual({ sid: '1000000' });
        expect2(() => _pack($.admin, { sid: '0', uid: '0' })).toEqual({ sid: '999', uid: '9009' });
    });

    it('B13 T-02 ADM read of another site row', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.admin, 'read', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-03 ADM create', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.admin, 'create', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-04 ADM update of another site row', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.admin, 'update', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-05 ADM delete of another site row', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.admin, 'delete', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-06 IAM SigV4 caller (no session) and `roles: [admin]` claim pass as admin', async () => {
        const { $, _all, _pack } = _setup();
        //* admin is decided before the session fetch (was: `403 IDENTITY-TOKEN`).
        expect2(() => _all($.signed, ROW, { throwable: true })).toEqual(ALL);
        expect2(() => _all($.signed, undefined, { throwable: true }), 'list').toEqual({ list: true });
        expect2(() => _all($.claim, ROW, { throwable: true })).toEqual(ALL);
        //* no session → no site filter (`null`), `?sid=` as given.
        expect2(() => _pack($.signed, {})).toEqual({ sid: null });
        expect2(() => _pack($.signed, { sid: '1000000' })).toEqual({ sid: '1000000' });
    });

    it('B13 T-07 OWN list pinned to own site', async () => {
        const { $, _can, _pack } = _setup();
        expect2(() => _can($.own, 'list')).toEqual(true);
        expect2(() => _can($.own, 'list', ROW)).toEqual(true);
        expect2(() => _pack($.own, {})).toEqual({ sid: '1000000' });
    });

    it('B13 T-08 OWN read', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.own, 'read', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-09 create of the session-stamped row (OWN, SITE, OTHER) and the `gid` stamp', async () => {
        const { service, $, _can, _mine } = _setup();
        expect2(() => _can($.own, 'create', _mine($.own), { throwable: true })).toEqual(true);
        expect2(() => _can($.site, 'create', _mine($.site), { throwable: true })).toEqual(true);
        expect2(() => _can($.other, 'create', _mine($.other), { throwable: true })).toEqual(true);
        //* `makeModelBase()` stamps the session `gid` (new), only when non-empty and the model has none.
        const _base = (N: any, model: any, parent?: any) =>
            service
                .createProxy({ ...$.own, identity: { ...$.own.identity, ...N } })
                .makeModelBase(model, { useSession: true, parent });
        expect2(await _base({ gid: 'g1' }, { type: 'test' })).toEqual({
            type: 'test',
            sid: '1000000',
            uid: '1000001',
            gid: 'g1',
        });
        expect2(await _base({ gid: 'g1' }, { type: 'test', gid: 'g0' }), 'gid').toEqual({ gid: 'g0' });
        expect2(await _base({ gid: null }, { type: 'test' }).then(N => 'gid' in N)).toEqual(false);
        expect2(await _base({ gid: null }, { type: 'test' }, { gid: 'p1' }), 'gid').toEqual({ gid: 'p1' });
    });

    it('B13 T-10 OWN update', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.own, 'update', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-11 OWN delete', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.own, 'delete', ROW, { throwable: true })).toEqual(true);
    });

    it('B13 T-12 SITE list pinned to own site, `?uid=` narrows', async () => {
        const { $, _can, _pack } = _setup();
        expect2(() => _can($.site, 'list')).toEqual(true);
        expect2(() => _can($.site, 'list', ROW)).toEqual(true);
        expect2(() => _pack($.site, {})).toEqual({ sid: '1000000' });
        expect2(() => _pack($.site, { uid: '1000001' })).toEqual({ sid: '1000000', uid: '1000001' });
        expect2(() => _pack($.site, { uid: '0' })).toEqual({ sid: '1000000', uid: '2002' });
    });

    it('B13 T-13 SITE read → 403', async () => {
        const { $, _can, _msg } = _setup();
        expect2(() => _can($.site, 'read', ROW)).toEqual(false);
        expect2(() => _msg(() => _can($.site, 'read', ROW, { throwable: true }))).toEqual(
            '403 NOT ALLOWED - action[read] is invalid @canDo(read:test/1000001)',
        );
    });

    it('B13 T-14 SITE update → 403', async () => {
        const { $, _can, _msg } = _setup();
        expect2(() => _can($.site, 'update', ROW)).toEqual(false);
        expect2(() => _msg(() => _can($.site, 'update', ROW, { throwable: true }))).toEqual(
            '403 NOT ALLOWED - action[update] is invalid @canDo(update:test/1000001)',
        );
    });

    it('B13 T-15 SITE delete → 403', async () => {
        const { $, _can, _msg } = _setup();
        expect2(() => _can($.site, 'delete', ROW)).toEqual(false);
        expect2(() => _msg(() => _can($.site, 'delete', ROW, { throwable: true, errScope: 'x' }))).toEqual(
            '403 NOT ALLOWED - action[delete] is invalid @x',
        );
    });

    it('B13 T-16 OTHER list: own site only, `?sid=` ignored', async () => {
        const { $, _can, _pack } = _setup();
        expect2(() => _can($.other, 'list')).toEqual(true);
        expect2(() => _can($.other, 'list', ROW)).toEqual(false); // a row of another site is not in its list.
        expect2(() => _pack($.other, { sid: '1000000' })).toEqual({ sid: '999' });
    });

    it('B13 T-17 OTHER read → 403', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.other, 'read', ROW)).toEqual(false);
    });

    it('B13 T-18 OTHER update → 403', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.other, 'update', ROW)).toEqual(false);
    });

    it('B13 T-19 OTHER delete → 403', async () => {
        const { $, _can } = _setup();
        expect2(() => _can($.other, 'delete', ROW)).toEqual(false);
    });

    it('B13 T-20 NOUID (empty or `#` uid) → 403 for every action', async () => {
        const { $, _all, _can, _msg } = _setup();
        expect2(() => _all($.nouid, ROW)).toEqual(NONE);
        expect2(() => _all($.hashUid, ROW)).toEqual(NONE);
        expect2(() => _all($.hashUid, { ...ROW, uid: '' })).toEqual(NONE); // empty never matches empty.
        expect2(() => _can($.hashUid, 'list')).toEqual(false);
        expect2(() => _msg(() => _can($.nouid, 'read', ROW, { throwable: true }))).toEqual(
            '403 IDENTITY-TOKEN - .uid (user-id) is required!',
        );
        expect2(() => _msg(() => _can($.hashUid, 'list', undefined, { throwable: true }))).toEqual(
            '403 NOT ALLOWED - action[list] is invalid @canDo(list:test/-)',
        );
    });

    it('B13 T-21 NOSID (offsite `#` or empty sid) → 403 for every action, list too', async () => {
        const { $, _all, _can, _pack, _msg } = _setup();
        expect2(() => _all($.nosid, ROW)).toEqual(NONE);
        expect2(() => _all($.nosid, { ...ROW, sid: '' })).toEqual(NONE);
        expect2(() => _can($.nosid, 'list')).toEqual(false);
        //* was: an unfiltered list.
        expect2(() => _msg(() => _pack($.nosid, {}))).toEqual(
            '403 NOT ALLOWED - list[site] needs session .sid @packSearchParam(test)',
        );
        expect2(() => _msg(() => _can($.nosid, 'read', ROW, { throwable: true }))).toEqual(
            '403 NOT ALLOWED - action[read] is invalid @canDo(read:test/1000001)',
        );
    });

    it('B13 T-22 GUEST (empty roles) → 403 for every action', async () => {
        const { $, _all, _can, _msg } = _setup();
        expect2(() => _all($.guest, ROW)).toEqual(NONE);
        expect2(() => _can($.guest, 'list')).toEqual(false);
        expect2(() => _msg(() => _can($.guest, 'read', ROW, { throwable: true }))).toEqual(
            '403 NOT ALLOWED - action[read] is invalid @canDo(read:test/1000001)',
        );
    });

    it('B13 T-23 NOSESS (no session in Lambda) → 403 IDENTITY-TOKEN', async () => {
        const { $, _all, _can, _msg } = _setup();
        for (const A of ACTS) {
            expect2(() => _msg(() => _can($.nosess, A, ROW, { throwable: true }))).toEqual(
                '403 IDENTITY-TOKEN - .identity (IdentityToken) is required',
            );
        }
        expect2(() => _msg(() => _can($.nosess, 'list', undefined, { throwable: true }))).toEqual(
            '403 IDENTITY-TOKEN - .identity (IdentityToken) is required',
        );
        expect2(() => _all($.nosess, ROW)).toEqual(NONE);
    });

    it('B13 T-24 a row with an empty uid → read/update/delete admin only', async () => {
        const { $, _can } = _setup();
        const row: Model = { ...ROW, uid: '' };
        for (const A of ['read', 'update', 'delete'] as CanDoActionType[]) {
            expect2(() => _can($.own, A, row)).toEqual(false);
            expect2(() => _can($.admin, A, row)).toEqual(true);
        }
    });

    it('B13 T-25 a `sid`-less row, SID_LEGACY_ACCESS=admin (default) → admin only, read too', async () => {
        const { $, _all } = _setup();
        delete process.env.SID_LEGACY_ACCESS;
        const legacy: Model = { type: 'test', id: '1000001', uid: '1000001' };
        //* was: list/read/create open (B5 § 6.4).
        expect2(() => _all($.own, legacy)).toEqual(NONE);
        expect2(() => _all($.admin, legacy)).toEqual(ALL);
        process.env.SID_LEGACY_ACCESS = 'unknown';
        expect2(() => _all($.own, legacy)).toEqual(NONE);
    });

    it('B13 T-26 a `sid`-less row, SID_LEGACY_ACCESS=open → every role holder (v4)', async () => {
        const { $, _all } = _setup();
        process.env.SID_LEGACY_ACCESS = 'open';
        const legacy: Model = { type: 'test', id: '1000001', uid: '1000001' };
        expect2(() => _all($.own, legacy)).toEqual(ALL);
        expect2(() => _all($.other, legacy)).toEqual(ALL);
        expect2(() => _all($.guest, legacy)).toEqual(NONE);
    });

    it('B13 T-27 a `sid`-less row, SID_LEGACY_ACCESS=deny → write 403 before admin, read as `admin`', async () => {
        const { $, _all, _can, _msg } = _setup();
        process.env.SID_LEGACY_ACCESS = 'deny';
        const legacy: Model = { type: 'test', id: '1000001', uid: '1000001' };
        expect2(() => _all($.admin, legacy)).toEqual({ ...ALL, update: false, delete: false });
        expect2(() => _all($.signed, legacy)).toEqual({ ...ALL, update: false, delete: false });
        expect2(() => _all($.own, legacy)).toEqual(NONE);
        expect2(() => _msg(() => _can($.admin, 'delete', legacy, { throwable: true }))).toEqual(
            '403 NOT ALLOWED - action[delete] is invalid @canDo(delete:test/1000001)',
        );
    });

    it('B13 § 14.1 scopes `group`, `any`, `owner` for canDo and packSearchParam', async () => {
        const { $, _can, _pack, _msg } = _setup();
        const $g1 = { ...$.site, identity: { ...$.site.identity, gid: 'g1' } } as NextContext;
        const group = { policy: { read: 'group' } };
        expect2(() => _can($g1, 'read', { ...ROW, gid: 'g1' }, group)).toEqual(true);
        expect2(() => _can($g1, 'read', { ...ROW, gid: 'g2' }, group)).toEqual(false);
        expect2(() => _can($.site, 'read', { ...ROW, gid: '' }, group)).toEqual(false); // empty never matches.
        expect2(() => _can($.other, 'read', ROW, { policy: { read: 'any' } })).toEqual(true);
        expect2(() => _can($.site, 'read', ROW, { policy: { read: 'site' } })).toEqual(true);
        expect2(() => _can($.site, 'read', ROW, { policy: { read: 'bogus' } })).toEqual(false);
        //* pins per scope.
        expect2(() => _pack($.site, { uid: '1' }, { scope: 'owner' })).toEqual({ sid: '1000000', uid: '2002' });
        expect2(() => _pack($g1, { uid: '1' }, { scope: 'group' })).toEqual({ sid: '1000000', uid: '1', gid: 'g1' });
        expect2(() => _msg(() => _pack($.site, {}, { scope: 'group' }))).toEqual(
            '403 NOT ALLOWED - list[group] needs session .gid @packSearchParam(test)',
        );
        expect2(() => _pack($.other, { sid: '1000000', uid: '0' }, { scope: 'any' })).toEqual({
            sid: '1000000',
            uid: '2002',
        });
        expect2(() => _pack($.other, {}, { scope: 'any' })).toEqual({});
    });

    it('B13 T-34 `accessPolicy()` override per model type, `policy` option over it', async () => {
        const { service, $ } = _setup();
        //* a type whose default reads and lists by site / owner.
        class SiteReadTests extends MyManagerProxy<MyTestModel, TestModelManager, BackendService, ModelType> {
            public accessPolicy(): AccessPolicy {
                return { ...super.accessPolicy(), read: 'site', list: 'owner' };
            }
        }
        //* a proxy that registers only this manager proxy.
        const _proxy = (ctx: NextContext) => {
            const P = new (class extends MyCoreProxy<ModelType, BackendService> {})(ctx, service);
            return { P, tests: new SiteReadTests(P, service.$test) };
        };
        const { P, tests } = _proxy($.site);
        const _opt = (N?: any) => ({ context: $.site, useSession: true, throwable: false, ...N });
        expect2(() => P.canDo('read', ROW, _opt())).toEqual(true);
        expect2(() => P.canDo('update', ROW, _opt())).toEqual(false);
        expect2(() => P.canDo('read', ROW, _opt({ policy: { read: 'owner' } }))).toEqual(false);
        expect2(() => tests.effectivePolicy(), 'list,read').toEqual({ list: 'owner', read: 'site' });
        expect2(() => tests.packSearchParam({}, undefined, { useSession: true }).$param).toEqual({
            sid: '1000000',
            uid: '2002',
        });
    });

    it('B13 T-35 useSession=false → v5 § 6.4 rules unchanged, policy ignored', async () => {
        const { service, proxy, $ } = _setup();
        const _off = (ctx: NextContext, A: CanDoActionType, M?: Model, N?: any) =>
            proxy.tests.canDo(A, M, { context: ctx, useSession: false, throwable: false, ...N });
        //* same site → list/read/create (any uid); update/delete need the uid; other site → none.
        expect2(() => ACTS.map(A => _off($.site, A, ROW))).toEqual([true, true, true, false, false]);
        expect2(() => ACTS.map(A => _off($.other, A, ROW))).toEqual([false, false, false, false, false]);
        expect2(() => ACTS.map(A => _off($.own, A, { ...ROW, sid: '' }))).toEqual([true, true, true, false, false]);
        expect2(() => ACTS.map(A => _off($.guest, A, ROW))).toEqual([false, false, false, false, false]);
        expect2(() => _off($.other, 'read', ROW, { policy: { read: 'any' } })).toEqual(false);
        //* the env default (`USE_SESSION` off in this profile) takes the same path.
        expect2(() => service.isUseSession()).toEqual(false);
        expect2(() => proxy.tests.canDo('read', ROW, { context: $.site, throwable: false })).toEqual(true);
        //* no pin: `?sid=` as given.
        expect2(() => _setup()._pack($.other, { sid: 'x' }, { useSession: false })).toEqual({ sid: 'x' });
    });

    it('B13 T-36 local mode → admin for all, no pin (unchanged)', async () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const { $, _all, _pack } = _setup();
        expect2(() => _all($.other, ROW)).toEqual(ALL);
        expect2(() => _all($.guest, ROW)).toEqual(ALL);
        expect2(() => _pack($.other, { sid: 'a' })).toEqual({ sid: 'a' });
        expect2(() => _pack($.nosid, {})).toEqual({});
    });
});
