/**
 * `abstract-controllers.ts`
 * - pre-coded Model basic CRUD with backend-service and backend-proxy on GeneralWEBController.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2022-06-24 fixed some failures.
 * @date        2022-06-28 supports `doGetList` w/ search-id.
 * @date        2022-08-02 use `nextId()` w/ `manager.initialNo`.
 * @date        2022-08-03 improved `transformer` w/ helpers.
 * @date        2022-08-09 opt w/ `session-token` in CRUD.
 * @date        2022-09-21 optimized the model management.
 * @date        2022-11-09 param `isCreate` in `bodyToModel`, and support `GET /<type>/<cmd>/admin`
 * @date        2022-11-11 cleanup and optimized names.
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2023-02-09 optimized `doPutBulk()`, and `doPostBulk()`
 * @date        2023-02-13 optimized `doList()` to support `stereo` filter.
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2023-05-31 optimized to use `cores` in `modelAsView()` & `makeModelBase()`
 * @date        2023-09-15 optimized to use `hasCores` in `modelAsView()`
 * @date        2023-09-27 optimized `doList()` to parse param.
 * @date        2023-11-06 optimized `onAfterSave()` for post-processing.
 * @date        2025-04-10 optimized `errScope` per each handler.
 * @date        2025-08-01 optimized `canDo()` for better security.
 * @date        2025-09-03 optimized `makeModelBase()` to have `type` default.
 * @date        2026-02-03 optimized `modelAsView()` to show cores in local.
 * @date        2026-04-09 optimized `types` to fix `ModelType` cast error.
 * @date        2026-10-28 v5 B4: `GET /<type>/fields/admin` reports the field lists (local or direct invoke only).
 * @date        2026-10-30 v5 B14: the `fields/admin` gate reads `context.channel` (not `domain`).
 * @date        2026-10-28 v5 B4: `fields/admin` self-check uses the shared `checkFieldsAdmin()`.
 * @date        2026-10-30 v5 B13: handlers pass `{ useSession, policy }` to `canDo`, `doList` checks `list`, bulk in 2 phases.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err } from '../../engine/';
import { my_sequence, my_parrallel } from '../../helpers/';
import { $T } from './commons';
import { onlyDefined } from '../../common/test-helper';
import { loadDataYml, loadJsonSync } from '../../tools/';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GeneralWEBController } from '../../controllers/';
import { CoreModel, AbstractTransformer, View, Body, NextContext, NextHandler, SimpleSet } from 'lemon-model';
import { fieldsOf } from 'lemon-model'; //* v5 B4: L2 core fields, re-derived (the services' `CORE_FIELDS` is module-local).
import { BulkBody, ListResult, PaginatedListResult, PaginateParam } from './types';
import { MyCoreManager, MyCoreService, MyCoreProxy, AccessPolicy, CanDoOptions } from './abstract-services';
import { checkFieldsAdmin, FieldsAdminReport } from './fields-admin';
export { CoreModel, AbstractTransformer, GeneralWEBController };

/**
 * convert as id string.
 */
const _id = (id: any): string => (id === '' || id === 0 ? '' : $T.S2(id));

/**
 * v5 B4: the installed `lemon-core` version for `fields/admin` → `runtime.lemonCore`.
 * - reads lemon-core's own `package.json` (three levels up from `dist/extended/cores/` or `src/extended/cores/`).
 * - fallback: the service's declared dependency with a leading `^`/`~` stripped, else `null`.
 */
const _coreVersion = (): string => {
    try {
        const own = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
        if (own?.name === 'lemon-core' && own?.version) return `${own.version}`;
    } catch {
        //* not installed as a package (ex: bundled) - fall through.
    }
    const dep: string = loadJsonSync('package.json')?.dependencies?.['lemon-core'];
    return typeof dep === 'string' ? dep.replace(/^[\^~]/, '') : null;
};

/**
 * type: `CRUDCreationOptions`
 * - options for cunstructor.
 */
interface CRUDCreationOptions {
    /**
     * (optional) flag to use `identity-token` (known as session) in CRUD
     * - initialize this as `true` if required to use `identity-token`
     *
     * @see proxy.getCurrentSession()
     */
    useSession?: boolean;
    /**
     * (optional) flag to use `throwable` in `getCurrentSession()`
     * - default might be `true`
     *
     * @see proxy.makeModelBase()
     */
    throwable?: boolean;
    /**
     * (optional) v5 B13: access scopes for the 7 CRUD handlers of this controller (session on only).
     * - merged over the manager-proxy `accessPolicy()`; ex: `{ read: 'site' }` restores the v5 § 6.4 read rule.
     *
     * @see MyManagerProxy.canDo()
     */
    policy?: Partial<AccessPolicy>;
}

/**
 * class: `AbstractCRUDController`
 * - abstract high level class not to create directly.
 */
export abstract class AbstractCRUDController<
    ModelType extends string,
    MyModel extends CoreModel<ModelType>,
    MyView extends View,
    MyBody extends Body,
    MyService extends MyCoreService<MyModel, any, MyCoreProxy<any, any>>,
    MyManager extends MyCoreManager<MyModel, any, MyCoreService<MyModel, any, any>>,
    MyTransformer extends AbstractTransformer<MyModel, MyView, MyBody>,
> extends GeneralWEBController {
    /**
     * service instances
     */
    protected readonly service: MyService;

    /**
     * namespace for log(print)
     */
    protected readonly logNS: string;

    /**
     * my model manager
     */
    protected readonly manager: MyManager;

    /**
     * transformer between model and view.
     */
    protected readonly transformer: MyTransformer;

    /** options in creation */
    protected readonly options?: CRUDCreationOptions;

    /**
     * public constructor
     *
     * @param type - api controller's type name (ex: tests for `/tests`)
     * @param service - backend service
     * @param manager - my model manager in backend-service
     * @param transformer - GeneralCRUDWEBControllerOptions
     */
    public constructor(
        type: string,
        service: MyService,
        manager: MyManager,
        transformer: MyTransformer,
        options?: CRUDCreationOptions,
    ) {
        super(type);
        this.logNS = $U.NS(type, 'yellow');
        _log(this.logNS, `AbstractCRUDController(${type})...`);
        this.service = service;
        this.manager = manager;
        this.transformer = transformer;
        this.options = options;
    }

    /**
     * get the manager's type (= model-type)
     */
    public get modelType() {
        return this.manager.type;
    }

    /**
     * get config of using session.
     */
    public get confUseSession(): boolean {
        //* v5: local mode (`LOCAL_MODE=1` off Lambda) disables session, not `STAGE` (B5 § 6.3).
        if ($U.isLocalMode()) return false;
        const useSession = this.options?.useSession ?? this.service.isUseSession();
        return useSession;
    }

    /**
     * get config of using session.
     */
    public get confThrowable(): boolean {
        return this.options?.throwable ?? true;
    }

    /**
     * v5 B13: access scopes of this controller (override this getter to compute them).
     */
    protected get confPolicy(): Partial<AccessPolicy> | undefined {
        return this.options?.policy;
    }

    /**
     * v5 B13: the `canDo()` options of the CRUD handlers - session switch and policy of this controller.
     */
    protected canDoOptions(errScope: string, options?: CanDoOptions): CanDoOptions {
        return { errScope, useSession: this.confUseSession, policy: this.confPolicy, ...options };
    }

    /**
     * model transformer from model to view
     */
    public modelAsView(model: MyModel, options?: { useOnlyDefined?: boolean; hasCores?: boolean }): MyView {
        const isLocal = $U.isLocalMode(); //* v5: runtime local mode, never from request (B5 § 6.3).
        const useOnlyDefined = options?.useOnlyDefined ?? true;
        const hasCores = options?.hasCores ?? (isLocal ? true : this.confUseSession); // show cores in local always.

        // show `cores` model { sid, gid uid } if using session.
        const view = this.transformer.modelAsView(model, hasCores);
        return useOnlyDefined ? this.transformer.onlyDefined(view) : view;
    }
    /**
     * model transformer from body to body
     */
    public bodyToModel(body: MyBody, isCreate?: boolean): MyModel {
        return this.transformer.bodyToModel(body, isCreate);
    }

    /**
     * from `identity-token`, make base of model { sid, uid }
     * @param proxy the current proxy.
     * @returns base model
     */
    protected async makeModelBase(
        proxy: MyCoreProxy<ModelType, any>,
        options?: {
            /** use this parent to prepare base-model. (hiher than session) */
            parent?: CoreModel;
            /** flag to use session (default as confUseSession) */
            useSession?: boolean;
            /** flag to throw error (default true) */
            throwable?: boolean;
        },
    ): Promise<MyModel> {
        const parent = options?.parent ?? null;
        const useSession = options?.useSession ?? this.confUseSession;
        //* v5 B13: an admin without a session (IAM SigV4, `roles: ['admin']` claim) creates without `403 IDENTITY-TOKEN`.
        const throwable = options?.throwable ?? (this.confThrowable && !(useSession && proxy.hasAdminRole()));
        const $model = onlyDefined<CoreModel<ModelType>>({
            type: this.manager.type,
        });
        return proxy.makeModelBase<MyModel>($model as MyModel, { parent, useSession, throwable });
    }

    /** load yml as model list */
    public async loadMockData<T extends object>(name: string, base: string = null): Promise<T[]> {
        const file = base ? `${base}/${name}.yml` : `${name}.yml`;
        const $ret = await this.loadFromFile(file);
        const list = $ret?.list.map(N => ({ ...N } as T));
        return list;
    }

    /**
     * load mock-model from `.yml` file.
     */
    public async loadFromFile(file: string) {
        if (!file) throw new Error(`@file (string) is required!`);
        const isObjKey = (k: string) => /^[A-Z]+/.test(k);
        const { conf, data } = loadDataYml(file);
        const $id: { [key: string]: number } = {
            '': $T.N(conf?.$id, 1000), // global starting seq of id
        };
        const _num = (v: unknown, def = 0): number =>
            typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? $T.N(v, def) : def;
        const _id = (type: string, id = 0, auto = false): string => {
            if ($id[type] === undefined) {
                $id[type] = $id['']; // each starts of `type`.
                $id[''] += 10000; // shift by 10k.
            }
            const no = $id[type] + (auto ? 1 : id) - (auto ? 0 : $id[type] % 10000);
            $id[type] = Math.max($id[type], no); // save the last
            return `${no}`;
        };
        const _mock = (data: any, type: string, i?: number) =>
            Object.entries(data).reduce<any>(
                (M, [k, N]) => {
                    if (k === 'id') {
                        M[k] = _id(M.type, _num(N, 0) || i || 0, N === 0 ? true : false);
                    } else if (isObjKey(k)) {
                        const type = k.charAt(0).toLowerCase() + k.substring(1, k.length - 1);
                        const inner = Array.isArray(N) ? N.map((N, i) => _mock(N, N.type || type, i)) : _mock(N, type);
                        M[k] = inner;
                    } else if (/^[_]+/.test(k)) {
                        const type = k.substring(1);
                        const refId = _id(type, _num(N, 0));
                        M[`${type}Id`] = refId;
                    } else {
                        M[k] = N;
                    }
                    return M;
                },
                { type: type as ModelType },
            );
        //! load as list of mock-model.
        const mock = Array.isArray(data) ? data.map((N, i) => _mock(N, N.type || 'root', i)) : _mock(data, 'root');
        const list: any[] = Array.isArray(mock) ? mock : [mock];
        //! returns as mock-model.
        const result: MyModel = $U.copy_node(conf);
        return { ...result, list };
    }

    /**
     * say hello
     */
    public hello = () => `api:${this.type()}/${this.manager.hello()}`;

    /**
     * GET /<typeName>
     * - list types
     *
     * ```sh
     * $ http ':8888/<typeName>'
     */
    public doList: NextHandler<PaginateParam & SimpleSet, PaginatedListResult<MyView>> = async (
        id,
        param,
        body,
        $ctx,
    ) => {
        const errScope = `doList(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));

        // request search
        return this.service.guardProxy($ctx, async proxy => {
            //WARN - has no internal properties like `sid`, `uid`
            //TODO - `stereo` 같은 경우가 모델 생성시 필수값일때, 쿼리와 겹침. (not-exists) 개선필요함 @230926
            const model = param ? this.bodyToModel(param as any, true) : null; // could have all
            const useSession = this.confUseSession;

            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            //* v5 B13: the caller may list at all (guest, no session, empty `sid`/`uid` → 403), session on only.
            if (useSession && !$prxy.canDo('list', undefined, this.canDoOptions(errScope)))
                throw new Error(`403 NOT ALLOWED - action[list] is invalid @${errScope}`);
            //* v5 B13: pin the rows per the effective `list` scope (the same merge as `canDo`).
            const scope = useSession ? $prxy.effectivePolicy(this.confPolicy).list : undefined;
            const { $page, $param } = $prxy.packSearchParam(param, model, { useSession, scope, errScope });
            _log(this.logNS, `>> $param =`, $U.json($param));

            //* search from manager.
            const $res = await this.manager.list($page, $param);

            //* for internal test, list can be `SearchBody`
            const list = Array.isArray($res.list) ? $res.list.map(model => this.modelAsView(model)) : $res.list;
            const total = $res?.total ?? list.length;

            // return as view
            return { total, limit: $page.limit, page: $page.page, list };
        });
    };

    /**
     * list types by id
     * - id means the search(query) id to use.
     *
     * ```sh
     * $ http ':8888/<typeName>/<id>/list'
     */
    public doGetList: NextHandler<PaginateParam & SimpleSet, PaginatedListResult<MyView>> = async (
        id,
        param,
        body,
        $ctx,
    ) => {
        const errScope = `doGetList(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate paramters.
        if (id) throw new Error(`@id[${id ?? ''}](string) is invalid - ${errScope}`);

        // redirect to list()
        return this.doList(id, param, body, $ctx);
    };

    /**
     * internal admin command
     * - `GET /<type>/fields/admin`: the field lists (v5 B4) - see `doGetAdminFields()`, gated by channel not role.
     */
    public doGetAdmin: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doGetAdmin(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        $ctx && _log(this.logNS, `> context =`, $U.json($ctx));

        //* v5 B4: `fields` runs before the admin-role check - a direct invoke may carry no identity.
        if (id === 'fields') return this.doGetAdminFields($ctx, errScope);

        const save = $T.B(param?.save, param?.save === '' ? 1 : 0);
        const clear = $T.B(param?.clear, param?.clear === '' ? 1 : 0);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            const hasAdmin = proxy.hasAdminRole();
            if (!hasAdmin && id) throw new Error(`403 NOT ALLOWED - only for admin @${errScope}`);
            const hello = this.hello();

            //* initialize models w/ running environment.
            if (id === 'initialize') {
                //$ http ':8888/<type>/initialize/admin?clear'
                const list0 = await this.loadMockData<any>(this.manager.type, 'initial');
                const list1 = list0.map(N => this.bodyToModel(N, true));
                const list2 = await my_parrallel(list1, async N => {
                    if (save) return this.manager.prepare(N.id, N, true);
                    else if (clear) return this.manager.delete(N.id, true);
                    return N;
                });
                const list3 = list2.map(N => this.modelAsView(N));
                return { id, list: list3 };
            } else if (id) {
                const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
                const model = await $prxy.get(id);
                return this.modelAsView(model);
            }

            // returns default.
            return { id, hello, param, body, context: { clientIp: $ctx.clientIp } };
        });
    };

    /**
     * v5 B4: report the manager's field list (`GET /<type>/fields/admin`) to verify it in Lambda too.
     * - v5 B14: allowed only when `$ctx.channel !== 'external'` (set once by the entry: `local` for the local
     *   express, `internal` for a host-less invoke or a protocol call). `domain` is information only, never the gate.
     * - no admin role is required: a direct invoke is already gated by IAM `lambda:InvokeFunction`.
     */
    protected async doGetAdminFields($ctx: NextContext, errScope: string) {
        const local = $U.isLocalMode();
        //* `runtime.external` keeps reporting the request domain (information, unchanged).
        const external = !!`${$ctx?.domain ?? ''}`.trim();
        if ($ctx?.channel === 'external')
            throw new Error(`403 NOT ALLOWED - fields/admin is local or direct-invoke only @${errScope}`);

        //* the lists: L2 core (16), the manager's full list, and the model-specific rest.
        const core: string[] = fieldsOf(CoreModel);
        const fields: string[] = [...(this.manager.FIELDS ?? [])];
        const extra = fields.filter(k => !core.includes(k));
        const source = this.manager.fieldsSource;

        //* runtime, to tell the local harness from the deployed Lambda.
        const runtime = {
            local,
            external,
            lambda: process.env.AWS_LAMBDA_FUNCTION_NAME ?? null,
            node: process.version,
            lemonCore: _coreVersion(),
        };
        const counts = { core: core.length, fields: fields.length, extra: extra.length };
        const report: FieldsAdminReport = {
            id: 'fields',
            type: this.type(),
            model: this.modelType,
            core,
            fields,
            extra,
            counts,
            source,
            ok: true,
            issues: [],
            runtime,
        };
        //* self-check w/ the shared verifier (the same one every test or harness runs).
        const { ok, issues } = checkFieldsAdmin(report);
        return { ...report, ok, issues };
    }

    /**
     * read a `MyModel`
     *
     * ```sh
     * $ http ':8888/<typeName>/1'
     */
    public doGet: NextHandler<any, MyView> = async (id, param, body, $ctx) => {
        const errScope = `doGet(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        // body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required - ${errScope}`);

        //* runs in guarded prxy.
        return this.service.guardProxy($ctx, async proxy => {
            // STEP.1 read model.
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const model = await $prxy.get(id, false);
            if (!model?.id) throw new Error(`404 NOT FOUND - not found @${errScope}`);
            //* v5 B13: session switch and policy of this controller.
            if (!proxy.canDo('read', model, this.canDoOptions(errScope))) return null; // no permission to read.
            // STEP.2 returns as view.
            if (model?.deletedAt > 0)
                throw new Error(`404 NOT FOUND - deleted at ${$U.ts(model.deletedAt)} @${errScope}`);
            return this.modelAsView(model);
        });
    };

    /**
     * create(or insert) a `MyModel`
     * - `id` must be empty (or '0')
     *
     * ```sh
     * $ http POST ':8888/<typeName>/0' "key"="modelValue"
     */
    public async doPost(id: string, param: any, body: MyBody, $ctx?: NextContext): Promise<MyView> {
        const errScope = `doPost(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();
        const isLocal = $U.isLocalMode(); //* v5: custom `id` only in local mode, not from `$ctx.domain` (B5 § 6.3).

        // STEP.0 validate paramters.
        if (id && !isLocal) throw new Error(`@id (string) is invalid - ${errScope}`);
        if (body && Array.isArray(body)) return this.doPostBulk(id, param, body, $ctx) as any; //! route to `/bulk`

        // STEP.1 (TODO) validate user, and transform to model.
        const toCreate = this.bodyToModel(body, true);
        if (!toCreate) throw new Error(`@body is required - ${errScope}`);
        if (id) toCreate.id = id;

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $base = await this.makeModelBase(proxy);
            if (!$base.type) throw new Error(`.type (ModelType) is missing - ${errScope}`); // confirm type explicitly.
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const $valid = await $prxy.validateModel(toCreate, null);
            //* v5 B13: session switch and policy of this controller.
            if (!proxy.canDo('create', { ...$valid, ...$base }, this.canDoOptions(errScope))) return null; // no permission to create.
            const $saves = await $prxy.onBeforeSave($valid, null);
            const $saved = await $prxy.makeModel({ ...$saves, ...$base }, false); //WARN! - already validated.
            const $final = await $prxy.onAfterSave($saved, null);
            return this.modelAsView($final);
        });
    }

    /**
     * create(or insert) multi `MyModel`
     * - `id` must be empty (or '0')
     *
     * ```sh
     * $ http POST ':8888/<typeName>/0/bulk' "key"="modelValue"
     */
    public doPostBulk: NextHandler<any, MyView[], BulkBody<MyBody> | MyBody[]> = async (id, param, body, $ctx) => {
        const errScope = `doPostBulk(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        // STEP.0 validate paramters.
        if (id) throw new Error(`@id (string) is invalid - ${errScope}`);
        const list = Array.isArray(body) ? body : body?.list;
        if (!list || !Array.isArray(list)) throw new Error(`@body (array) is required - ${errScope}`);

        // STEP.1 transform to models.
        const models = list.map(N => ({
            ...this.bodyToModel(N, true),
            id: _id(N?.id),
        }));

        // STEP.2 run main...
        return this.service.guardProxy($ctx, async proxy => {
            const $base = await this.makeModelBase(proxy);
            if (!$base.type) throw new Error(`.type (ModelType) is missing - ${errScope}`); // confirm type explicitly.
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            //* v5 B13 phase 1: validate every item and collect the denied ones (`false` counts as denied), no write.
            const $valid = await Promise.all(models.map(N => $prxy.validateModel(N, null)));
            const $opts = this.canDoOptions(errScope, { throwable: false });
            const denied = $valid.reduce<string[]>((L, N, i) => {
                if (!proxy.canDo('create', { ...N, ...$base }, $opts)) L.push(N?.id ? `${N.id}` : `#${i}`);
                return L;
            }, []);
            if (denied.length)
                throw new Error(`403 NOT ALLOWED - bulk[create] denied ids[${denied.join(',')}] @${errScope}`);
            //* v5 B13 phase 2: every item passed, so write them all.
            const filtered = await my_sequence($valid, async validated => {
                const filtered = await $prxy.onBeforeSave(validated, null);
                const created = await $prxy.makeModel({ ...filtered, ...$base }, false); //WARN! - already validated.
                return $prxy.onAfterSave(created, null);
            });
            return filtered.map(created => this.modelAsView(created));
        });
    };

    /**
     * update a `MyModel`
     *
     * ```sh
     * $ http PUT ':8888/<typeName>/1000002' name="test-update"
     */
    public doPut: NextHandler<any, MyView, MyBody> = async (id, param, body, $ctx) => {
        const errScope = `doPut(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required - ${errScope}`);

        // STEP.1 (TODO) validate user, and transform to model.
        const toUpdate = this.bodyToModel({ ...body, id });
        if (!toUpdate) throw new Error(`@body is required - ${errScope}`);

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const $org = await $prxy.get(id, false);
            if (!$org?.id) throw new Error(`404 NOT FOUND - not found @${errScope}`);
            if ($org?.deletedAt) throw new Error(`404 NOT FOUND - deleted @${errScope}`);
            //* v5 B13: session switch and policy of this controller.
            if (!proxy.canDo('update', $org, this.canDoOptions(errScope))) return null; // no permission to update.

            // STEP.3 validate and update.
            const $valid = await $prxy.validateModel(toUpdate, id);
            const $saves = await $prxy.onBeforeSave($valid, $org);
            const $saved = await $prxy.set(id, $saves);
            const $final = await $prxy.onAfterSave($saved, $org);
            return this.modelAsView($final);
        });
    };

    /**
     * bulk update a `TypeModel`
     *
     * ```sh
     * $ http PUT ':8888/types/0/bulk'
     */
    public doPutBulk: NextHandler<any, ListResult<MyView>, BulkBody<MyBody> | MyBody[]> = async (
        id,
        param,
        body,
        $ctx,
    ) => {
        const errScope = `doPutBulk(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        const parrallel = $T.N(param?.parrallel, 10);
        const list = Array.isArray(body) ? body : body?.list;
        if (!list || !Array.isArray(list)) throw new Error(`@body.list (array) is required - ${errScope}`);

        // transform to models
        const models = list.map<MyModel>(N => ({
            ...this.bodyToModel(N),
            id: _id(N?.id),
        }));

        // runs in guarded proxy.
        const $res = await this.service.guardProxy($ctx, async proxy => {
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            if (!$prxy) throw new Error(`.model-type[${this.modelType}] is required - ${errScope}`);

            //* v5 B13: a session-less non-admin caller keeps the `403 IDENTITY-TOKEN` message (as the single handlers).
            if (this.confUseSession && !proxy.hasAdminRole())
                proxy.getCurrentSession({ throwable: this.confThrowable });

            //* v5 B13 phase 1: load every stored row (404 first, current messages) and check it, no write.
            const _can = async (N: MyModel, i?: number) => {
                const errScope = `doPutBulk(${this.type()}:${i}/${N?.id ?? ''})`;
                const model = N?.id ? await $prxy.get(N?.id, false) : null;
                if (!model?.id) throw new Error(`404 NOT FOUND - not found @${errScope}`);
                if (model?.deletedAt) throw new Error(`404 NOT FOUND - deleted @${errScope}`);
                const allowed = proxy.canDo('update', model, this.canDoOptions(errScope, { throwable: false }));
                return { N, allowed }; // 업데이트할 새 데이터를 반환 (기존 model이 아님)
            };
            const checked = await Promise.all(models.map((N, i) => _can(N, i)));
            //* v5 B13: one denied row → 403 with every denied id, before any write.
            const denied = checked.filter(C => !C.allowed).map(C => `${C.N?.id ?? ''}`);
            if (denied.length)
                throw new Error(`403 NOT ALLOWED - bulk[update] denied ids[${denied.join(',')}] @${errScope}`);
            //* v5 B13 phase 2: every row passed, so write them all.
            const list = checked.map(C => C.N);

            //* validate and update.
            const $res = await my_parrallel(
                list,
                async (model: MyModel, i) => {
                    if (!model?.id) throw new Error(`.id (string) is required at idx[${i}] - ${errScope}`);
                    const $org = await $prxy.get(model.id);
                    const $valid = await $prxy.validateModel(model, model.id);
                    const $saves = await $prxy.onBeforeSave($valid, $org);
                    const $saved = await $prxy.set(model.id, $saves);
                    return $prxy.onAfterSave($saved, $org);
                },
                parrallel,
            );
            // returns.
            return $res;
        });

        // prepare the response.
        const views = $res.map((N: MyModel) => this.modelAsView(N));
        const length = views.length;

        // FINAL. convert to view
        return { total: length, limit: length, list: views };
    };

    /**
     * delete a `MyModel`
     *
     * ```sh
     * $ http DELETE ':8888/<typeName>/1000003'
     */
    public doDelete: NextHandler<any, MyView> = async (id, param, body, $ctx) => {
        const errScope = `doDelete(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();
        const isLocal = $U.isLocalMode(); //* v5: `?destroy` only in local mode, not from `$ctx.domain` (B5 § 6.3).
        const destroy = !!$T.B(param?.destroy, param?.destroy === '' ? 1 : 0);

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required - ${errScope}`);

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const model = await $prxy.get(id, false);
            if (!model?.id) throw new Error(`404 NOT FOUND - not found @${errScope}`);
            if (!destroy && model?.deletedAt) throw new Error(`404 NOT FOUND - deleted @${errScope}`);
            //* v5 B13: session switch and policy of this controller.
            if (!proxy.canDo('delete', model, this.canDoOptions(errScope))) return null; // no permission to delete.

            const deleted = await $prxy.$mgr.delete(id, isLocal && destroy);
            const $final = await $prxy.onAfterSave(null, deleted);
            return this.modelAsView($final || deleted);
        });
    };
}

//WARN! - do not export as default.
// default export
// export default AbstractCRUDController;
