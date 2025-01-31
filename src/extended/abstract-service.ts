/**
 * `abstract-service.ts`
 * - common service design pattern to build micro-service backend.
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2021-02-23 initial version
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-02-18 optimized search w/ ES6.8
 * @date        2022-02-22 optimized w/ `lemon-core#3.0` and `@elastic/elasticsearch`
 * @date        2022-02-24 use `$id` in elastic-search as `_id` in dynamo-table.
 * @date        2022-03-15 optimized w/ `AbstractProxy`
 * @date        2022-03-17 optimized w/ `lemon-core#3.0.2` and use `env.ES6_DOCTYPE`
 * @date        2022-03-31 optimized w/ unit test spec.
 * @date        2022-05-19 optimized `CacheService` w/ typed key.
 *
 * @origin      see `lemon-accounts-api/src/service/core-service.ts`
 * @copyright   (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import $cores, {
    AbstractManager,
    APIHeaders,
    APIHttpMethod,
    ApiHttpProxy,
    CacheService,
    CoreModel,
    CoreModelFilterable,
    DynamoOption,
    DynamoStreamCallback,
    DynamoStreamEvent,
    DynamoStreamFilter,
    Elastic6Option,
    Elastic6QueryService,
    Elastic6Service,
    GeneralKeyMaker,
    LambdaDynamoStreamHandler,
    NextContext,
    NextIdentityAccess,
    NextIdentityCognito,
    ProxyStorageService,
    SearchBody,
    StorageMakeable,
} from '../cores/';
import { $U, _err, _log } from '../engine/';
import { GETERR, NUL404 } from '../common/test-helper';
import { $info, $protocol, $slack, $T, my_parrallel } from '../helpers';
import { sigV4Client, sigV4ClientConfig } from './libs/sig-v4';
import REQUEST from 'request';
import queryString from 'query-string';
import AWS from 'aws-sdk';
import elasticsearch from '@elastic/elasticsearch';
const NS = $U.NS('back', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * authentication helper - get identity-id from context
 * @param context the current request context.
 */
export function asIdentityId(context: NextContext): string | undefined {
    return (context?.identity as NextIdentityCognito)?.identityId;
}

/**
 * extract field names from models
 * - only fields start with lowercase, or all upper.
 */
export const filterFields = (fields: string[], base: string[] = []) =>
    fields
        .filter(field => /^[a-z]+/.test(field) || /^[A-Z_]+$/.test(field))
        .reduce<string[]>(
            (L, k) => {
                if (k && !L.includes(k)) L.push(k);
                return L;
            },
            [...base],
        );

/**
 * interface `ModelSynchronizer`
 */
export interface ModelSynchronizer<T extends CoreModel<string> = CoreModel<string>> {
    /**
     * callback for filtering items
     * @param id
     * @param item
     */
    filter?(id: string, item: T): boolean;

    /**
     * callback invoked before synchronization
     * @param id
     * @param eventName
     * @param item
     * @param diff
     * @param prev
     */
    onBeforeSync?(id: string, eventName: DynamoStreamEvent, item: T, diff?: string[], prev?: T): Promise<void>;

    /**
     * callback invoked after synchronization
     * @param id
     * @param eventName
     * @param item
     * @param diff
     * @param prev
     */
    onAfterSync?(id: string, eventName: DynamoStreamEvent, item: T, diff?: string[], prev?: T): Promise<void>;
}

/**
 * abstract class `CoreService`
 * - common abstract to build user service
 *
 * @abstract
 */
export abstract class CoreService<Model extends CoreModel<ModelType>, ModelType extends string>
    extends GeneralKeyMaker<ModelType>
    implements StorageMakeable<Model, ModelType>
{
    /** dynamo table name */
    public readonly tableName: string;
    /** global index name of elasticsearch */
    public readonly idName: string;
    /** (optional) current timestamp */
    protected current: number = 0; // for unit-test. set the current time-stamp.

    /**
     * constructor
     * @param tableName     target table-name (or .yml dummy file-name)
     * @param ns            namespace of dataset
     * @param idName        must be `_id` unless otherwise
     */
    protected constructor(tableName?: string, ns?: string, idName?: string) {
        super(ns || $U.env('NS', 'TT'));
        this.tableName = tableName || $U.env('MY_DYNAMO_TABLE', 'Test');
        this.idName = idName || '_id';
    }

    /**
     * override current time
     */
    public setCurrent = (current: number) => (this.current = current);

    /**
     * get the current dynamo-options.
     */
    public get dynamoOptions(): DynamoOption {
        return {
            tableName: this.tableName,
            idName: this.idName,
        };
    }

    /**
     * create storage-service w/ fields list.
     */
    public makeStorageService<T extends Model>(type: ModelType, fields: string[], filter: CoreModelFilterable<T>) {
        //! use proxy-storage-service for both dynamo-table and dummy-data.
        const storage = new ProxyStorageService<T, ModelType>(this, this.tableName, fields, filter, this.idName);
        storage.setTimer(() => (this.current ? this.current : new Date().getTime()));
        return storage.makeTypedStorageService(type);
    }
}

/**
 * class: `CoreManager`
 * - shared core manager for all model
 *
 * @abstract
 */
export abstract class CoreManager<
    Model extends CoreModel<ModelType>,
    ModelType extends string,
    Service extends CoreService<Model, ModelType>,
> extends AbstractManager<Model, Service, ModelType> {
    /**
     * constructor
     * @protected
     */
    protected constructor(type: ModelType, parent: Service, fields: string[], uniqueField?: string) {
        super(type, parent, fields, uniqueField);
    }

    /**
     * say hello()
     */
    public hello = () => `${this.storage.hello()}`;

    /**
     * get existence of model
     * @param id
     */
    public async exists(id: string): Promise<boolean> {
        return (await this.find(id)) !== null;
    }

    /**
     * find model - retrieve or null
     * @param id model-id
     */
    public async find(id: string): Promise<Model | null> {
        return this.retrieve(id).catch(e => {
            if (GETERR(e).startsWith('404 NOT FOUND')) return null as Model;
            throw e;
        });
    }

    /**
     * get model by key
     * @param key global id(like primary-key)
     */
    public async findByKey(key: string): Promise<Model | null> {
        return this.storage.storage.read(key).catch(e => {
            if (GETERR(e).startsWith('404 NOT FOUND')) return null as Model;
            throw e;
        });
    }

    /**
     * batch get models
     * - retrieve multi models per each id
     * - must be matched with idList in sequence order.
     *
     * @param idList list of id
     * @param parrallel (optional) in parrallel size
     */
    public async getMulti(idList: string[], parrallel?: number): Promise<(Model | null)[]> {
        const $map = await this.getMulti$(idList, 'id', parrallel);
        return idList.map(id => $map[id] ?? null).map(N => (N?.error?.startsWith('404 NOT FOUND') ? null : N));
    }

    /**
     * batch get models in map by idName
     */
    public async getMulti$(
        idList: string[],
        idName: string = 'id',
        parrallel?: number,
    ): Promise<{ [id: string]: Model }> {
        // 1. find items in unique
        const ids = idList.reduce<string[]>((L, id) => {
            if (id && !L.includes(id)) L.push(id);
            return L;
        }, []);
        // 2. find from storage.
        const list = await my_parrallel(
            ids.map(id => ({ id })),
            N => this.retrieve(N.id),
            parrallel,
        );
        // 3. convert to map
        return $T.asMap(list, idName);
    }

    /**
     * get by unique field value
     * @param uniqueValue
     */
    public async getByUniqueField(uniqueValue: string): Promise<Model> {
        return this.$unique.findOrCreate(uniqueValue);
    }

    /**
     * find model by unique field value - retrieve or null
     * @param uniqueValue
     */
    public async findByUniqueField(uniqueValue: string): Promise<Model | null> {
        return this.getByUniqueField(uniqueValue).catch(e => {
            if (GETERR(e).startsWith('404 NOT FOUND')) return null as Model;
            throw e;
        });
    }

    /**
     * prepare model
     *  - override `AbstractManager.prepare()`
     */
    public async prepare(id: string, $def?: Model, isCreate: boolean = true): Promise<Model> {
        const $org = await this.find(id);
        if ($org) return $org;
        if (!isCreate || $def === undefined) throw new Error(`404 NOT FOUND - ${this.type}:${id}`);
        const model = this.prepareDefault($def);
        // create or update lookup
        if (this.$unique) await this.updateLookup(id, model, $org);
        // save target model
        const $saved = await this.storage.save(id, { ...model, id });
        return { ...model, ...$saved, id };
    }

    /**
     * update model
     *  - override 'AbstractManager.insert()'
     *
     * @deprecated use `AbstractProxy`
     */
    public async insert(model: Model, initSeq?: number): Promise<Model> {
        const id = $T.S(await this.storage.storage.nextSeq(this.type, initSeq));
        return this.save(id, model);
    }

    /**
     * create or update model
     * @param id    model id
     * @param model model data
     */
    public async save(id: string, model: Model): Promise<Model> {
        if (!id) throw new Error(`@id is requird - save()`);
        const $org = await this.find(id);
        if (!$org) model = this.prepareDefault(model);
        // create or update lookup
        if (this.$unique) await this.updateLookup(id, model, $org);
        // save target model
        const $saved = await this.storage.save(id, model);
        return { ...$org, ...$saved, id };
    }

    /**
     * update model
     *  - override 'AbstractManager.update()'
     */
    public async update(id: string, model: Model, $inc?: Model): Promise<Model> {
        if (!id) throw new Error(`@id is requird - update()`);
        const $org = await this.retrieve(id);
        // update lookup
        if (this.$unique) await this.updateLookup(id, model, $org);
        // update target model
        model = this.beforeSave(model, $org);
        const $updated = await this.storage.update(id, model, $inc);
        return { ...$org, ...$updated, id };
    }

    /**
     * update or create model
     *  - override 'AbstractManager.updateOrCreate()'
     */
    public async updateOrCreate(id: string, model: Model, $inc?: Model): Promise<Model> {
        if (!id) throw new Error(`@id is requird - updateOrCreate()`);
        const $org = await this.prepare(id, model);
        // update lookup
        if (this.$unique) await this.updateLookup(id, model, $org);
        // update target model
        model = this.beforeSave(model, $org);
        const $updated = await this.storage.update(id, model, $inc);
        return { ...$org, ...$updated, id };
    }

    /**
     * delete model
     *  - override 'AbstractManager.delete()'
     */
    public async delete(id: string, destroy?: boolean): Promise<Model> {
        if (!id) throw new Error(`@id is requird - delete()`);
        // delete target model
        const $org = await super.delete(id, destroy);
        // delete lookup
        const uniqueField = this.$unique?.field as keyof Model;
        const uniqueValue = uniqueField && ($org[uniqueField] as unknown as string);
        if (uniqueValue) await this.storage.delete(this.$unique.asLookupId(uniqueValue));

        return $org;
    }

    /**
     * prepare default-model when creation
     * @param $def  base-model
     */
    protected prepareDefault($def: Model): Model {
        return { ...$def };
    }

    /**
     * update lookup and delete old one if exists
     */
    protected async updateLookup(id: string, model: Model, $org?: Model): Promise<void> {
        const uniqueField = this.$unique?.field as keyof Model;
        const newUniqueValue = uniqueField && (model[uniqueField] as unknown as string);
        const oldUniqueValue = uniqueField && ($org?.[uniqueField] as unknown as string);

        // update lookup.
        if (newUniqueValue && newUniqueValue !== oldUniqueValue) {
            await this.$unique.updateLookup({ id, ...model });
            // remove old lookup
            if (oldUniqueValue) {
                await this.storage.delete(this.$unique.asLookupId(oldUniqueValue));
            }
        }
    }
}

/**
 * proxy of manager
 * - save model internally, and update only if changed properties.
 * Model extends CoreModel<ModelType>, ModelType extends string
 */
// export class ManagerProxy<T, U extends CoreManager<T, any, any>> {
export class ManagerProxy<
    Model extends CoreModel<ModelType>,
    Manager extends CoreManager<Model, ModelType, CoreService<Model, ModelType>>,
    ModelType extends string = string,
> {
    public readonly $mgr: Manager;
    public constructor(proxy: AbstractProxy<string, CoreService<Model, ModelType>>, mgr: Manager) {
        this.$mgr = mgr;
        proxy.register(this);
    }
    /**
     * store the origin model.
     * - `null` means `404 not found`
     */
    protected readonly _org: { [key: string]: Model } = {};
    /**
     * store the updated one.
     */
    protected readonly _new: { [key: string]: Model } = {};

    /**
     * get storage linked.
     */
    public get storage() {
        return this.$mgr.storage;
    }

    /**
     * read the origin node (cloned not to change).
     */
    public org(id: string, raw = false): Model {
        const O = this._org[id];
        return O === undefined ? null : raw ? O : { ...O };
    }

    /**
     * check if already read.
     */
    public has(id: string): boolean {
        return this.org(id) ? true : false;
    }

    /**
     * read the node.
     * @param id object-id
     * @param defaultOrThrow (optional) create if not exists, or flag to throw error
     */
    public async get(id: string, defaultOrThrow?: Model | boolean) {
        const err404 = `404 NOT FOUND - proxy/${this.$mgr.type}/id:${id}`;
        const throwable = typeof defaultOrThrow === 'boolean' ? defaultOrThrow : true;
        const $def: Model = typeof defaultOrThrow === 'boolean' ? null : defaultOrThrow;
        // STEP.0 validate if null (404 error)
        if (this._org[id] === null && !$def) {
            if (throwable) throw new Error(err404);
            return null;
        }
        // STEP.1 find from `new`
        const N = this._new[id];
        if (N !== undefined) return N;
        // OR, READ (or CREATE) from storage.
        const M = !$def ? await this.$mgr.retrieve(id).catch(NUL404) : await this.$mgr.prepare(id, $def, true);
        if (M === null) {
            this._org[id] = null; //! null 로 저장해두고, 다음에 호출할때 에러 발생.
            if (throwable) throw new Error(err404);
            return null;
        }
        const M2 = this.normal(M);
        this._org[id] = M2; //! 원본 저장.
        // const M3 = { ...M2 }; //! 클론 생성.
        const M3 = JSON.parse($U.json(M2)) as Model; //! deep clone.
        this._new[id] = M3; //! 클론 저장.
        return M3;
    }

    /**
     * 객체 정규화 시킴.
     * - null 에 대해서는 특별히 처리.
     */
    public normal = (N: Model) =>
        Object.keys(N || {}).reduce<Model>((M: Model, k): Model => {
            if (k.startsWith('_') || k.startsWith('$')) return M;
            const v = (N as any)[k];
            //! `null` 은 DynamoDB에서 비어있는 문자임.
            (M as any)[k] = v === null ? '' : v;
            return M;
        }, {} as any);

    /**
     * override w/ model
     * @param $org the origin model by `.get(id)`
     * @param model the new model.
     */
    public override = ($org: Model, model: Model) => {
        const fields = this.$mgr.FIELDS;
        //! update(set) all properties.
        Object.entries(model).forEach(([key, val]) => {
            if (!fields || fields.includes(key)) {
                ($org as any)[key] = val;
            }
        });
        return $org;
    };

    /**
     * update the node.
     */
    public async set(id: string, model: Model) {
        if (!model) throw new Error(`@model (object) is required - proxy/${this.$mgr.type}/id:${id}!`);
        const O = await this.get(id);
        return this.override(O, model);
    }

    /**
     * increment the field of Object[id]
     * !WARN! this incremented properties should NOT be updated later.
     */
    public async inc(id: string, model: Model) {
        if (!model) throw new Error(`@model (object) is required - proxy/${this.$mgr.type}/id:${id}!`);
        const $inc = Object.entries(model).reduce<Model>((M, [k, v]) => {
            if (typeof v === 'number') M[k as keyof Model] = v as any;
            return M;
        }, {} as any as Model);
        const keys: string[] = Object.keys($inc);
        if (!keys.length) throw new Error(`@model (object) is empty to inc() - proxy/${this.$mgr.type}/id:${id}!`);
        //! try to increment, and update the latest to both org and new.
        const $res = await this.$mgr.storage.update(id, null, $inc);
        const $new = await this.get(id);
        const $org = this.org(id, true);
        return keys.reduce<Model>((N, k) => {
            const key = k as keyof Model;
            N[key] = $org[key] = $res[key];
            return N;
        }, $new);
    }

    /**
     * get all the updated node.
     *
     * @param onlyUpdated flag to return the only updated set. (useful to check whether to update really!)
     */
    public alls(onlyUpdated = true, onlyValid = true) {
        const ids = Object.keys(this._new).sort();
        return ids.reduce<{ [key: string]: Model }>((M, id) => {
            const O = this._org[id];
            const N = this._new[id];
            const N2 = this.$mgr.onBeforeSave({ ...N }, O);
            const N3 = onlyUpdated ? $T.diff(O, N2, onlyValid) : N2;
            M[id] = N3;
            return M;
        }, {});
    }
}

/**
 * class: `AbstractProxy`
 * - common abstract based class for Proxy
 */
export abstract class AbstractProxy<U extends string, T extends CoreService<CoreModel<U>, U>> {
    /** parrallel factor */
    public readonly parrallel: number;

    /** (internal) current context */
    public readonly context: NextContext;
    /** (internal) backend-service */
    public readonly service: T;
    /** (internal) cache service instance */
    public readonly cache?: CacheService;

    /**
     * constructor of proxy.
     * @param service user service instance
     * @param parrallel parrallel count (default 2)
     * @param cacheScope prefix of cache-key (like `lemon:SS:` or `lemon:SS:user`)
     */
    public constructor(context: NextContext, service: T, parrallel = 2, cacheScope?: string) {
        this.context = context;
        this.service = service;
        this.parrallel = parrallel;

        // create cache
        const endpoint = $U.env('CACHE_ENDPOINT', '');
        if (cacheScope && endpoint.startsWith('redis:')) {
            this.cache = CacheService.create({ type: 'redis', endpoint, ns: cacheScope });
        }
    }

    /**
     * say hello().
     */
    public hello = () => `manager-proxy:${this.service.NS}/${this.service.tableName}`;

    /**
     * list of manager-proxy
     */
    protected _proxies: ManagerProxy<any, any>[] = [];

    /**
     * get all proxies in list.
     */
    protected get allProxies() {
        return this._proxies;
    }

    /**
     * register this.
     *
     * @return size of proxies.
     */
    public register(mgr: ManagerProxy<any, any>) {
        this._proxies.push(mgr);
        return this._proxies.length;
    }

    /**
     * save all updates by each proxies.
     * - 업데이트할 항목을 모두 저장함
     *
     * @param options running parameters.
     */
    public async saveAllUpdates(options?: {
        /** (optional) the parrallel factor  */
        parrallel?: number;
        /** (optional) flag to use only valid value (not null) (default true) */
        onlyValid?: boolean;
    }) {
        const parrallel = $U.N(options?.parrallel, this.parrallel);
        type Model = CoreModel<U>;
        type TYPE = { id: string; N: Model; _: () => Promise<Model> };

        // STEP.1 prepare the list of updater.
        const list = this.allProxies.reduce((L: TYPE[], $p: ManagerProxy<any, CoreManager<any, any, any>>) => {
            const $set = $p.alls(true, options?.onlyValid);
            return Object.entries($set).reduce((L: TYPE[], [id, N]) => {
                const hasUpdate = Object.keys(N).length > 0;
                if (hasUpdate) {
                    _log(NS, `>> ${$p.$mgr.type}/${id} =`, $U.json(N));
                    const _ = () => $p.$mgr.storage.update(id, N);
                    L.push({ id, N, _ });
                }
                return L;
            }, L);
        }, []);

        // STEP.2 finally update storage.
        return my_parrallel(
            list,
            async (N: any) => {
                return typeof N._ === 'function' ? N._() : null;
            },
            parrallel,
        );
    }

    /**
     * report via slack.
     */
    public report = async (title: string, data: any) => {
        const context = this.context;
        return $slack(title, data, null, { context }).catch(e => `ERR:${GETERR(e)}`);
    };

    /**
     * featch identity-acess from `lemon-accounts-api`
     *
     * @deprecated useless anymore since 3.2.10
     */
    protected async fetchIdentityAccess(identityId: string, domain?: string) {
        domain = $T.S(domain, this.context.domain);
        if (!identityId) throw new Error(`.identityId (string) is required - fetchAccess(${domain})`);
        // 1. get user detail by invoking 'lemon-accounts-api/pack-context'
        const service = '//lemon-accounts-api/oauth/0/pack-context';
        const body = { domain, identityId };
        const $identity: NextIdentityAccess = await $protocol(this.context, service)
            .execute({}, body, 'POST')
            .catch(NUL404);
        _log(NS, `> identity[${domain}] =`, $U.json($identity));
        //WARN! - $identity can be null (or .Account can be null)
        // if (!$identity?.Account)
        //     throw new Error(`.Account(NextIdentityAccess) is invalid - fetchAccess(${domain}/${identityId})`);
        return { identityId, $identity };
    }

    /**
     * the cached identity model
     *
     * @deprecated useless anymore since 3.2.10
     */
    protected _identity: { [key: string]: NextIdentityAccess } = {};

    /**
     * fetch(or load) identity.
     *
     * @param identityId id to find
     * @param force (optional) force to reload if not available
     * @returns the cached identity-access
     *
     * @deprecated useless anymore since 3.2.10
     */
    public async getIdentity$(identityId: string, force?: boolean): Promise<NextIdentityAccess> {
        if (!identityId) return null;
        // STEP.1 check if in stock.
        const val = this._identity[identityId];
        if (val !== undefined && !force) return val;
        // STEP.2 fetch remotely, and save in cache.
        const { $identity } = await this.fetchIdentityAccess(identityId);
        this._identity[identityId] = $identity ? $identity : null; //! mark as 'null' not to fetch futher
        return $identity;
    }

    /**
     * get current identity-id
     */
    public async getCurrentIdentityId(throwable = true): Promise<string> {
        const identityId = asIdentityId(this.context) || '';
        if (!identityId && throwable) throw new Error(`400 NOT ALLOWED - getCurrentIdentity(${identityId || ''})`);
        return identityId;
    }

    /**
     * get the current identity object (or throw access-error)
     *
     * @deprecated useless anymore since 3.2.10
     */
    public async getCurrentIdentity$(throwable = true): Promise<NextIdentityAccess> {
        const identityId = await this.getCurrentIdentityId(throwable);
        if (!identityId && !throwable) return null;
        return this.getIdentity$(identityId);
    }
}

/**
 * type `SearchResult`
 */
export interface SearchResult<T, U = any> {
    /**
     * total count of items searched
     */
    total: number;
    /**
     * item list
     */
    list: T[];
    /**
     * pagination cursor
     */
    last?: string[];
    /**
     * aggregation result
     */
    aggregations?: U;
}

/**
 * class `Elastic6Synchronizer`
 * - listen DynamoDBStream events and index into Elasticsearch
 */
export class Elastic6Synchronizer {
    /**
     * model synchronizer map
     * @private
     */
    private readonly synchronizerMap: Map<string, ModelSynchronizer>;
    /**
     * default model synchronizer
     * @private
     */
    private readonly defModelSynchronizer: ModelSynchronizer;

    /**
     * constructor
     * @param elastic       elastic6-service instance
     * @param dynamoOptions dynamo options
     */
    public constructor(elastic: Elastic6Service, dynamoOptions: DynamoOption | { tableName: string }) {
        if (!elastic) throw new Error(`@elastic (elastic-service) is required!`);
        if (!dynamoOptions) throw new Error(`@dynamoOptions (object) is required!`);
        //! build dynamo-options as default.
        const options: DynamoOption = {
            ...dynamoOptions,
            idName: (dynamoOptions as DynamoOption).idName || '_id', // id (global) of dynamo-table. should be `_id`.
        };

        //! create sync-handler w/ this.
        const listener = LambdaDynamoStreamHandler.createSyncToElastic6<{ type?: string; stereo?: string }>(
            options,
            elastic,
            this.filter.bind(this),
            this.onBeforeSync.bind(this),
            this.onAfterSync.bind(this),
        );
        $cores.lambda.dynamos.addListener(listener); // register DynamoStream event listener

        //! prepare default synchro
        this.synchronizerMap = new Map();
        this.defModelSynchronizer = new (class implements ModelSynchronizer {
            public filter(id: string, item: CoreModel<string>): boolean {
                const type = `${item?.type || ''}`;
                const stereo = `${item?.stereo || ''}`;
                return !(type.startsWith('#') || stereo.startsWith('#')); // special purpose item. do not index.
            }
        })();
    }

    /**
     * set synchronizer for the model
     * @param type the model-type
     * @param handler (optional) custom synchronizer.
     */
    public enableSynchronization(type: string, handler?: ModelSynchronizer) {
        this.synchronizerMap.set(type, handler ?? this.defModelSynchronizer);
    }

    /**
     * internal callback for filtering
     * @private
     */
    private filter: DynamoStreamFilter<CoreModel<string>> = (id, item) => {
        const handler = this.synchronizerMap.get(item.type);
        if (handler) return handler.filter?.(id, item) ?? true; // 핸들러를 등록했다면 filter 메서드를 정의하지 않았더라도 sync 한다.
        return false; // 핸들러가 등록되지 않았다면 sync하지 않는다.
    };

    /**
     * internal callback on before synchronization
     * @private
     */
    private onBeforeSync: DynamoStreamCallback<CoreModel<string>> = async (id, eventName, item, diff, prev) => {
        const handler = this.synchronizerMap.get(item.type);
        if (handler) await handler.onBeforeSync?.(id, eventName, item, diff, prev);
    };

    /**
     * internal callback on after synchronization
     * @private
     */
    private onAfterSync: DynamoStreamCallback<CoreModel<string>> = async (id, eventName, item, diff, prev) => {
        const handler = this.synchronizerMap.get(item.type);
        if (handler) await handler.onAfterSync?.(id, eventName, item, diff, prev);
    };
}

/**
 * type: `Elastic6ContructParams`
 * - params for `new Elastic6Instance()`
 */
export interface Elastic6ContructParams {
    /** url endpoint */
    endpoint: string;
    /** name of index */
    indexName: string;
    /** ES engine version(6.2 ~ 7.x) */
    esVersion: string;
    /** doc-type (only valid under 6.2) */
    esDocType: string;
    /** dynamo table-name to synchronize */
    tableName: string;
    /** (optional) field to make auto-complele */
    autocompleteFields?: string[];
}

/**
 * type: `Elastic6SearchParams`
 */
export interface Elastic6SearchParams {
    /** index-name */
    indexName?: string;
    /** search-type */
    searchType?: 'query_then_fetch' | 'dfs_query_then_fetch';
    /** (optional) signature to check the request */
    signature?: string;
}

/**
 * class `AbstractElastic6Instance`
 * - to manipulate the shared Elasticsearch resources.
 */
export abstract class AbstractElastic6Instance {
    /**
     * Elasticsearch client
     */
    public readonly client?: elasticsearch.Client;
    /**
     * Elastic6Service instance
     */
    public readonly elastic?: Elastic6Service;
    /**
     * Elastic6QueryService instance
     */
    public readonly query?: Elastic6QueryService<any>;
    /**
     * Elastic6Synchronizer instance
     */
    public readonly synchronizer?: Elastic6Synchronizer;

    /**
     * default constructor
     */
    public constructor({
        endpoint,
        indexName,
        esVersion,
        esDocType,
        tableName,
        autocompleteFields,
    }: Elastic6ContructParams) {
        // initialize Elasticsearch only if there are valid endpoint & index
        if (endpoint && indexName) {
            const options: Elastic6Option = {
                endpoint,
                indexName,
                version: esVersion,
                autocompleteFields,
            };
            if (esDocType) options.docType = esDocType;
            this.elastic = new Elastic6Service<any>(options);
            this.client = this.elastic.client;
            this.query = new Elastic6QueryService<any>(this.elastic);
            this.synchronizer = new Elastic6Synchronizer(this.elastic, { tableName });
        }
    }

    /** say hello */
    public abstract hello(): string;

    /**
     * read the current elastic6-option.
     */
    public get options(): Elastic6Option {
        if (!this.elastic) return null;
        return this.elastic.options;
    }

    /**
     * create Elasticsearch index w/ custom settings
     */
    public async createIndex(): Promise<any> {
        if (this.elastic) {
            const { docType, idName } = this.options;
            const settings = Elastic6Service.prepareSettings({ docType, idName }); // default setting
            const { version } = this.elastic.options;

            // force set type of 'score_' field
            const ver = $U.F(version, 7.0);
            const $set = { score_: { type: 'half_float' } };
            if (ver < 7.0) {
                settings.mappings[docType].properties = {
                    ...(settings.mappings[docType]?.properties || {}),
                    ...$set,
                };
            } else {
                settings.mappings.properties = {
                    ...(settings.mappings?.properties || {}),
                    ...$set,
                };
            }

            return this.elastic.createIndex(settings);
        }

        return null;
    }

    /**
     * destroy Elasticsearch index
     */
    public async destroyIndex(): Promise<any> {
        return this.elastic && (await this.elastic.destroyIndex());
    }

    /**
     * display index settings and mappings
     */
    public async describeIndex(): Promise<any> {
        return this.elastic && (await this.elastic.describe());
    }

    /**
     * multi get
     * @param _ids  _id list
     */
    public async mget<T>(_ids: string[]): Promise<(T | null)[]> {
        const $res = await this.client.mget({
            index: this.options.indexName,
            type: this.options.docType,
            body: {
                docs: _ids.map(_id => ({ _id })),
            },
        });
        // _log(NS, `> res =`, $U.json({ ...$res, meta: undefined }));
        const { docs } = $res.body;

        const idName = this.options.idName;
        return docs.map((doc: any) => (doc.found ? sourceToItem<T>(doc._source, idName) : null));
    }

    /**
     * search raw query
     * @param body          Elasticsearch Query DSL
     * @param params        see 'search_type' in Elasticsearch documentation
     */
    public async search<T>(body: any, params?: Elastic6SearchParams): Promise<SearchResult<T>> {
        if (!this.elastic) throw new Error(`Could not read Elasticsearch endpoint or index setting.`);
        const searchType = params?.searchType;
        const elastic = params?.indexName
            ? new Elastic6Service<any>({ ...this.options, indexName: params.indexName })
            : this.elastic;
        return elastic.search(body, searchType);
    }

    /**
     * create async generator that yields items queried until last
     * @param body          Elasticsearch Query DSL
     * @param searchType    see 'search_type' in Elasticsearch documentation
     */
    public async *generateSearchResult<T>(body: any, searchType?: 'query_then_fetch' | 'dfs_query_then_fetch') {
        if (!body.sort) body.sort = '_doc';

        do {
            const { list, last } = await this.search<T>(body, { searchType });
            body.search_after = last;

            yield list;
        } while (body.search_after);
    }
}

/**
 * class: `Elastic6Instance`
 * - default agent to handle search.
 */
export class Elastic6Instance extends AbstractElastic6Instance {
    public constructor(params: Elastic6ContructParams) {
        super(params);
    }
    public hello(): string {
        return `Elastic6Instance`;
    }
    /**
     * expose the internal helpers. (ONLY for debugging)
     */
    get $X() {
        return $X;
    }
}

/**
 * (internal) class: `Elastic6Proxy`
 * - proxied agent to handle `search()`
 */
class Elastic6Proxy extends Elastic6Instance {
    public constructor(params: Elastic6ContructParams, protected readonly proxy: ApiHttpProxy) {
        super(params);
    }
    public hello(): string {
        return `Elastic6Proxy`;
    }

    /**
     * search raw query
     *
     * @override
     */
    public async search<T>(body: any, params?: Elastic6SearchParams): Promise<SearchResult<T>> {
        const _hmac = (s: string | string[], delim = ':', prefix = 'v1') =>
            [prefix, $U.hmac(Array.isArray(s) ? s.join(delim) : s, 'base64')].join(delim);
        //* use proxy if possible.
        if (this.proxy) {
            const service = $info()?.service;
            const indexName = params?.indexName ?? this.options?.indexName ?? '';
            const signature = params?.signature ?? _hmac([_hmac(service), indexName]);
            const $body: SearchProxyBody = { body, service, index: indexName, signature };
            return this.proxy.doProxy('POST', null, null, params, $body);
        }
        return super.search(body, params);
    }
}

/**
 * from Elasticsearch document to model item
 * - replace the elastic's `$id` field to `_id` of dynamo-table.
 *
 * @param _source from elastic-search
 * @param idName (optional) global id of elastic. (default is `$id`)
 */
export function sourceToItem<T>(_source: T, idName: string = '$id'): T {
    const item: any = { ..._source };
    if (idName in item) {
        item._id = item[idName];
        delete item[idName];
    }
    return item;
}

/**
 * internal helper function.
 */
const $X = {
    /**
     * describe (or parse) the endpoint url
     * - it detects if endpoint is the proxied search.
     * - it detects if endpoint needs the tunneling.
     *
     * @param url
     */
    describeEndpointUrl: (url: string, options?: { throwable?: boolean; errScope?: string }) => {
        const errScope = options?.errScope ?? `describeEndpointUrl()`;
        const throwable = options?.throwable ?? true;
        url = /^\/\/[a-z0-9]+/.test(url) ? `https:${url}` : url;
        if (throwable) {
            if (!url) throw new Error(`@url(string) is required - ${errScope}`);
            if (!(url?.startsWith('http://') || url?.startsWith('https://')))
                throw new Error(`@url[${url ?? ''}] is invalid (no http) - ${errScope}`);
        }

        const $url = new URL(url);

        const host = $U.S($url.hostname || $url.host);
        const isTunnel = $url.hostname === 'localhost';
        const protocol = $U.S($url.protocol).split(':')[0] ?? '';
        const port = $U.N($url.port, url?.startsWith('https') ? 443 : 80);
        const hosts = host.split('.');
        //* use `/search/0/proxy` working with deployed enpoint (requires access-key)
        const isProxy = host.endsWith('.amazonaws.com') && hosts[hosts.length - 4] == 'execute-api';
        const region = isProxy ? hosts[hosts.length - 3] : undefined;

        return {
            /** protocol */
            protocol,
            /** host name */
            host,
            /** port number */
            port,
            /** region in cloud */
            region,
            /** flag to use tunneling w/ ssh */
            isTunnel,
            /** flag to use proxy */
            isProxy,
        };
    },
    /**
     * load the local credential
     * - throws if not found.
     * @param profile (optional) target profile (default use `loadProfile()`, '' use the default);
     */
    loadCredentials: (profile?: string): AWS.Credentials => {
        const errScope = `loadCredentials(${profile ?? ''})`;
        // determine the final profile parameter.
        const _profile = (name: string) => {
            if (typeof name === 'string') return name ? name : null;
            const NAME = $U.env('NAME', '');
            return NAME && NAME !== 'none' ? NAME : null;
        };
        profile = _profile(profile);
        const credentials = new AWS.SharedIniFileCredentials({ profile });
        if (!credentials?.accessKeyId) throw new Error(`@profile[${profile ?? ''}] is invalid - ${errScope}`);
        return credentials;
    },
    /**
     * create http-web-proxy agent which using endpoint as proxy server.
     * - originally refer to `createHttpWebProxy()`
     *
     * # as cases.
     * as proxy agent: GET <endpoint>/<host?>/<path?>
     * as direct agent: GET <endpoint>/<id?>/<cmd?>
     *
     * @param endpoint  service url (ex: `https://xyz.execute-api.~/dev/search/0/proxy`)
     * @param options   optionals parameters.
     */
    createHttpSearchProxy: (
        endpoint: string,
        options?: {
            /** client-name (default `env.NAME`) */
            name?: string;
            /** headers */
            headers?: APIHeaders;
            /** path encoder (default encodeURIComponent) */
            encoder?: (name: string, path: string) => string;
            /** relay-key in headers for proxy. */
            relayHeaderKey?: string;
            /** resultKey in response */
            resultKey?: string;
            /** credentials to load */
            credentials?: AWS.Credentials;
            /** region */
            region?: string;
        },
    ): ApiHttpProxy => {
        const name = options?.name ?? $U.env('NAME');
        const errScope = `createHttpSearchProxy(${name ?? ''})`;
        if (!endpoint) throw new Error(`@endpoint (url) is required - ${errScope}`);
        const NS = $U.NS(`X${name}`, 'magenta'); // NAMESPACE TO BE PRINTED.
        const headers = options?.headers;
        const encoder = options?.encoder ?? ((name, path) => path);
        const relayHeaderKey = options?.relayHeaderKey || '';
        const resultKey = options?.resultKey ?? '';

        // initialize AWS SigV4 Client
        const _client = () => {
            if (!options?.credentials) return null;
            const $cred = options?.credentials;
            const $info = $X.describeEndpointUrl(endpoint, { throwable: false });
            const config: sigV4ClientConfig = {
                accessKey: $cred?.accessKeyId,
                secretKey: $cred?.secretAccessKey,
                serviceName: 'execute-api',
                host: $info?.host,
                region: options?.region ?? $info?.region,
                endpoint,
            };
            return sigV4Client(config);
        };
        const sigClient = _client();

        /**
         * class: `ApiHttpProxy`
         * - http proxy client via backbone's web.
         */
        return new (class implements ApiHttpProxy {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            public constructor() {}
            public hello = () => `http-search-proxy:${name}`;
            public doProxy<T = any>(
                method: APIHttpMethod,
                path1?: string,
                path2?: string,
                $param?: any,
                $body?: any,
                ctx?: any,
            ): Promise<T> {
                if (!method) throw new Error(`@method is required - ${errScope}`);
                _log(NS, `doProxy(${method})..`);
                const _isNa = (a: any) => a === undefined || a === null;
                _log(NS, '> endpoint =', endpoint);
                _isNa(path1) && _log(NS, `> host(id) =`, typeof path1, path1);
                _isNa(path2) && _log(NS, `> path(cmd) =`, typeof path2, path2);

                // eslint-disable-next-line prettier/prettier
                const query_string = _isNa($param) ? '' : (typeof $param == 'object' ? queryString.stringify($param) : `${$param}`);
                const url =
                    endpoint +
                    (_isNa(path1) ? '' : `/${encoder('host', path1)}`) +
                    (_isNa(path1) && _isNa(path2) ? '' : `/${encoder('path', path2)}`) +
                    (!query_string ? '' : '?' + query_string);
                const request = REQUEST;
                const options: any = {
                    method,
                    uri: url,
                    headers: { ...headers },
                    body: $body === null ? undefined : $body,
                    json: typeof $body === 'string' ? false : true,
                };

                //* build signed url
                if (sigClient) {
                    const signedRequest = sigClient.signRequest({
                        method,
                        path:
                            (_isNa(path1) ? '' : `/${encoder('host', path1)}`) +
                            (_isNa(path1) && _isNa(path2) ? '' : `/${encoder('path', path2)}`),
                        queryParams: $param,
                        headers: options.headers,
                        body: $body,
                    });
                    options.headers = { ...options.headers, ...signedRequest.headers };
                    options.uri = signedRequest.url;
                }

                //* relay HEADERS to `WEB-API`
                if (headers) {
                    options.headers = Object.keys(headers).reduce((H: any, key: string) => {
                        const val = headers[key];
                        const name = `${relayHeaderKey}${key}`;
                        const text = `${val ?? ''}`;
                        H[name] = text;
                        return H;
                    }, options.headers);
                }
                _log(NS, ' url :=', options.method, url);
                _log(NS, '*', options.method, url, options.json ? 'json' : 'plain');
                _log(NS, '> options =', $U.json(options));

                //* returns promise
                return new Promise((resolve, reject) => {
                    //* start request..
                    request(options, function (error: any, response: any, body: any) {
                        error && _err(NS, '>>>>> requested! err=', error);
                        if (error) return reject(error instanceof Error ? error : new Error(GETERR(error)));
                        //* detect trouble.
                        const statusCode = response.statusCode;
                        const statusMessage = response.statusMessage;
                        //* if not in success
                        if (statusCode !== 200 && statusCode !== 201) {
                            const msg = body ? GETERR(body) : `${statusMessage || ''}`;
                            if (statusCode === 400 || statusCode === 404) {
                                const title = `${
                                    (statusCode == 404 ? '' : statusMessage) || 'NOT FOUND'
                                }`.toUpperCase();
                                const message = msg.startsWith('404 NOT FOUND')
                                    ? msg
                                    : `${statusCode} ${title} - ${msg}`;
                                return reject(new Error(message));
                            }
                            statusMessage && _log(NS, `> statusMessage[${statusCode}] =`, statusMessage);
                            body && _log(NS, `> body[${statusCode}] =`, $U.json(body));
                            return reject(new Error(`${statusCode} ${statusMessage || 'FAILURE'} - ${msg}`));
                        }
                        //* try to parse body.
                        try {
                            if (body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')) {
                                body = JSON.parse(body);
                            } else if (body && typeof body == 'string' && body.startsWith('[') && body.endsWith(']')) {
                                body = JSON.parse(body);
                            }
                        } catch (e) {
                            _err(NS, '!WARN! parse(body) =', e instanceof Error ? e : $U.json(e));
                        }
                        //* ok! succeeded.
                        resolve(body);
                    });
                }).then((res: any) => {
                    if (resultKey && res && res[resultKey] !== undefined) return res[resultKey];
                    return res;
                });
            }
        })();
    },
};

/**
 * `SearchProxyBody`
 * - the body to `/search/0/proxy`
 */
export interface SearchProxyBody {
    /** the main search-body */
    body: SearchBody;

    /** service-name of request (ex: `lemon-sandbox-api`) */
    service?: string;
    /** index name to search via proxy (must be same as `env.ES6_INDEX`) */
    index?: string;
    /** (optional) signature to validate this request. */
    signature?: string;
}

/**
 * (internal) factory function for `$ES6`
 *
 * @param options (optional) for debugging
 */
export const _ES6 = (options?: {
    /** endpoint url */
    endpoint?: string;
    /** index-name */
    indexName?: string;
    /** flag to use search-proxy */
    useProxy?: boolean;
    /** aws:profile to use in proxy */
    profile?: string;
}): Elastic6Instance => {
    // 0. load from env configuration.
    const endpoint = options?.endpoint ?? $U.env('ES6_ENDPOINT', '');
    const indexName = options?.indexName ?? $U.env('ES6_INDEX', 'test-v1');
    const esVersion = $U.env('ES6_VERSION', '6.8'); //* version of elastic server (default 6.8)
    const esDocType = $U.env('ES6_DOCTYPE', ''); //* version of elastic server (default `_doc`)
    const tableName = $U.env('MY_DYNAMO_TABLE', 'Test');
    const autocompleteFields = $T.SS($U.env('ES6_AUTOCOMPLETE_FIELDS', ''));

    // use search-proxy by detectiong automatically.
    const _isProxy = (): boolean => {
        const isProxy = $U.env('ES6_IS_PROXY', '')?.toLowerCase();
        if (isProxy == '1' || isProxy == 'y' || isProxy == 'true') return true;
        if (endpoint) {
            const $res = $X.describeEndpointUrl(endpoint, { throwable: false });
            if ($res?.isProxy) return true;
        }
        return false;
    };
    const useProxy = options?.useProxy ?? _isProxy();
    const profile = options?.profile;

    // prepare constructor parameters.
    const params: Elastic6ContructParams = {
        endpoint,
        indexName,
        esVersion,
        esDocType,
        tableName,
        autocompleteFields,
    };

    //* use proxy.
    if (useProxy) {
        const credentials = $X.loadCredentials(profile);
        const proxy = $X.createHttpSearchProxy(endpoint, { credentials });
        return new Elastic6Proxy(params, proxy);
    }

    //* make a default instance.
    return new Elastic6Instance(params);
};

/**
 * const `$ES6`
 * - default instance as a singleton by env configuration.
 */
export const $ES6 = _ES6();
