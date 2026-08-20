/**
 * `abstract-services.ts`
 * - common services used in `/cores`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-15 initial version
 * @date        2022-06-24 fixed some failures.
 * @date        2022-07-27 support { initialNo, throwable }
 * @date        2022-08-04 opt `list()` w/ sort by createdAt:desc
 * @date        2022-08-09 use `SessionToken` from context
 * @date        2022-11-04 filter of `not exists` if param==''
 * @date        2022-11-15 use `buildQuery()` to build search-body.
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-13 optimized `makeModel()`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2023-01-31 fixed null error of `model[key]`
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2023-09-15 optimized `getCurrentSession()` w/ USE_SESSION + normalize option.
 * @date        2023-10-08 optimized `buildQuery()` w/ sort + offset.
 * @date        2023-10-11 optimized `doScan()` w/ dynamo-scan-filter.
 * @date        2024-11-01 optimized `nextId()` of manager-proxy
 * @date        2023-11-06 optimized `onAfterSave()` for post-processing.
 * @date        2024-11-14 renamed to `IdentityToken` from `SessionToken`
 * @date        2024-11-28 optimized `assertContext()` and `isAdminRole()` w/ `lemon-core@3.2.11`.
 * @date        2025-01-03 optimized `buildQuery()` w/ sort + offset.
 * @date        2025-03-24 optimized `OS2Instance` with `lemon-core@3.2.13`
 * @date        2025-07-17 optimized `onAfterSave` with `lemon-core@4.0.4`
 * @date        2025-07-23 optimized `buildQuery()` with `hidden` + `aggregation` option.
 * @date        2025-08-01 optimized `canDo()` for better security w/ session.
 * @date        2025-08-11 optimized `OS2FGACManager` for latest features.
 * @date        2025-08-14 optimized `OS2.deleteIndex()` for latest features.
 * @date        2025-09-05 optimized `OS2FGACManager` environment variables.
 * @date        2025-10-31 optimized `session` with `lemon-devkit@0.0.8`.
 * @date        2025-12-01 optimized `makeModel()` w/ T.
 * @date        2025-12-15 optimized `getCurrentSession()` with local meta info.
 * @date        2026-01-05 optimized `hasAdminRole()` and `getCurrentSession()`.
 * @date        2026-02-11 optimized `proxy.mget()` with `throwable` options.
 * @date        2026-04-09 optimized `types` to fix `ModelType` cast error.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import $cores, { $U, _log, _inf, _err, NUL404, GETERR, asyncCredentials, ConfigModule, $engine } from 'lemon-core';
import { my_parrallel, SearchType, _ES6, createSigV4Proxy, my_sequence } from 'lemon-core';
import { Elastic6Service, Elastic6Option, Elastic6QueryService, Elastic6Synchronizer } from 'lemon-core';
import { $ERROR, Incrementable, GETERR$, CoreManager, CoreModel, CoreService } from 'lemon-core';
import { SearchBody, SearchQuery, SearchResult, ManagerProxy, AbstractProxy, loadJsonSync } from 'lemon-core';
import { NextContext, NextIdentity, NextIdentityCognito, getIdentityId, waited, SortTerm, SimpleSet } from 'lemon-core';
import { DynamoScanService, DynamoScanFilter, DynamoScanResult, GeneralItem, Elastic6Instance } from 'lemon-core';
import { ApiHttpProxy, APIHeaders, elasticsearch, SearchResponse, DynamoOption, Elastic6Item } from 'lemon-core';
import { BulkItemsResult, IdentityToken, ListResult, PaginateParam } from './types';
import { $T, onlyDefined, parsePaginateParam } from './commons';
import { CrendentialForAWS } from 'lemon-core/dist/environ';
import { fieldKeys } from '../generated/field-registry';

const NAME = $U.env('NAME', 'lemon');
const NS = $U.NS('HDBS', 'green');
/**
 * fields in core model.
 */
const CORE_FIELDS: string[] = fieldKeys.coreModel<CoreModel>();

export type SearchParam<T> = T & { [key: string]: string | number };

/**
 * lookup table for common types.
 */
const $LUT = {
    /**
     * type: `CanDoAction`
     */
    CanDoAction: {
        list: 'list',
        read: 'read',
        create: 'create',
        update: 'update',
        delete: 'delete',
    },
};

/**
 * type: `CanDoActionType`
 */
export type CanDoActionType = keyof typeof $LUT.CanDoAction;

/**
 * Optional parameters for `canDo()`
 */
export interface CanDoOptions {
    /** error scope to print */
    errScope?: string;
    /** flag to throw error if not allowed (default false) */
    throwable?: boolean;
    /** flag to use session (default true) */
    useSession?: boolean;
    /** current context to override */
    context?: NextContext;
}

/**
 * type: `ScanLastParams`
 */
export interface ScanLastParams<T = any> {
    /** last cursor during scan */
    last?: T;
    /** (optional) limit to 1x scan */
    limit?: number;
    /** filter to scan */
    filter?: DynamoScanFilter;
}

/**
 * type: `ScanLastResult`
 */
export interface ScanLastResult<T = any> extends ListResult<T> {
    /** count of scan */
    count?: number;
    /** (optinoal) last of scan if there are more */
    last?: any;
}
/**
 * type: `doSyncScanLastResult`
 *
 * @param .list can be BulkResponseItem[]
 */
export interface DoSyncScanLastResult<T = any> extends ListResult<T> {
    /** count of scan */
    count?: number;
    /** (optinoal) last of scan if there are more */
    last?: any;
    /** errors of saveBulk */
    errors?: boolean[];
    /** statusCodes of saveBulk */
    statusCodes?: number[];
}

/**
 * class: `MyCoreService`
 * - CoreService의 공통 부분을 채워넣는다.
 */
export abstract class MyCoreService<
    Model extends CoreModel<ModelType>,
    ModelType extends string,
    Proxy extends MyCoreProxy<ModelType, any>,
> extends CoreService<Model, ModelType> {
    public constructor(tableName?: string, ns?: string) {
        super(tableName, ns);
    }

    /**
     * make proxy instance w/ this service.
     */
    abstract createProxy(context: NextContext): Proxy;

    /**
     * make proxy, and use callback to handle.
     * - it will save automatically.
     */
    public guardProxy = async <T>(context: NextContext, callback: (proxy: Proxy) => Promise<T>): Promise<T> => {
        const proxy = this.createProxy(context);
        try {
            const result = await callback(proxy);
            const saved = await proxy.saveAllUpdates();
            _log(`> saved[${saved?.length}] =`, $U.json(saved));
            return result;
        } catch (e) {
            //WARN! force to save models even for exception @240613
            const saved = await proxy.saveAllUpdates().catch(e => GETERR$(e));
            _log(`> saved =`, $U.json(saved));
            throw e;
        }
    };

    /**
     * run search
     * - override this to hide `$ES6`
     */
    public async doSearch<T>(body: SearchBody): Promise<SearchResult<T>> {
        _log(`doSearch()`);
        _log(`> list.query =`, $U.json(body));
        const result = await $ES6.search<T>(body);
        _log(`> list.res =`, $U.json({ ...result, list: [result?.list?.[0]] }));
        return result;
    }

    /**
     * check if using useSession from environ.
     */
    public isUseSssion(): boolean {
        const USE_SESSION = $T.S($U.env('USE_SESSION', '')).toLowerCase();
        return USE_SESSION && USE_SESSION != '0' && USE_SESSION != 'false' ? true : false;
    }

    /**
     * check if search-engine is supportable
     * @returns
     */
    public hasSearchEngine(): boolean {
        const useSearch = !!$ES6.options?.indexName;
        return useSearch;
    }
}

/**
 * class: `CoreManager`
 * - shared core manager for all model
 *
 * @abstract
 */
export abstract class MyCoreManager<
    Model extends CoreModel<ModelType>,
    ModelType extends string,
    Service extends MyCoreService<Model, ModelType, any>,
> extends CoreManager<Model, ModelType, Service> {
    /**
     * namespace for log(print)
     */
    protected readonly logNS: string;

    /**
     * constructor
     * @protected
     */
    protected constructor(
        type: ModelType,
        parent: Service,
        fields: string[],
        public readonly options?: {
            /** enable to sync with es6 (default true) */
            enableSync?: boolean;
            /** unique field */
            uniqueField?: string;
            /** initial next-id number of auto-seq (default 1000000) */
            initialNo?: number;
        },
    ) {
        super(type, parent, fields, options?.uniqueField);
        const enableSync = options?.enableSync ?? true;
        if (enableSync) $ES6.synchronizer?.enableSynchronization(this.type);
        this.logNS = $U.NS(type, 'yellow');
    }

    /**
     * get the next sequenced no from `initialNo` (default 1000000)
     *
     * @param step (optional) next-step (>= 0)
     * @returns next seq-no
     */
    public async nextId(step?: number): Promise<number> {
        return this.storage.storage.nextSeq(this.storage.type, this.options?.initialNo, step);
    }

    /**
     * build default model for creation.
     */
    public buildDefault(id: string): Model {
        //WARN! do not include { last, balance } (avoid conflict)
        const $def = this.prepareDefault({ id } as Model);
        const $key = this.parent.asKey$(this.type, id);
        return onlyDefined({ ...$def, ...$key, _id: undefined });
    }

    /**
     * validate the request's model before saving.
     * - `$org`에 따라서, 신규 생성인지 업데이트인지 구분 가능함.
     *
     * @param model request's model
     * @param $org (optional) the origin model (valid ONLY if 업데이트)
     * @returns validatated model.
     */
    public async validateModel(model: Model, $org?: Model): Promise<Model> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const isCreate = !$org; // flag to indicate new creation.
        return model;
    }

    /**
     * find lookup-model (improved @2022)
     * - lookup to `auto-id` by key.
     * - if not exits, make the new id (auto-seq) and store the key.
     * - type should be like `#<type>`.
     *
     * NOTE! must to support race condition.
     *
     * @param key any string
     */
    public async findLookup$(
        key: string | number,
        params?: {
            /** rate to reset lock (default 0.9) */
            resetRate?: number;
            /** flag to use sha256 for hash (default true) */
            useSha256?: boolean;
            /** use meta to save lookup info (default false) */
            isUseMeta?: boolean;
            /** throw if lookup is not found (default false) - useful to check if exists of key */
            throwable?: boolean;
        },
    ): Promise<Model> {
        //! valida parameters...
        const resetRate = params?.resetRate ?? 0.9; // upper rate to reset lock
        const useSha256 = params?.useSha256 ?? true; // flag to use sha256 algorithm.
        const isUseMeta = params?.isUseMeta ?? false; // flag to use meta

        //! build hash...
        const text = typeof key === 'number' ? `${key}` : `${key || ''}`;
        const hash = useSha256 ? $U.md5(text, 'base64') : $U.hash(text);
        const keyId = `#${hash}.${text.length}`;

        //! recursive func to repeat
        const asyncAuto = async ($base: Model, depth = 0): Promise<Model> => {
            const keyId = $base.id;
            //NOTE - it will throw if no lookup exists.
            const $org = await this.storage.read(keyId).catch(e => {
                if (params?.throwable) throw e;
                return NUL404(e);
            });
            //! try to initialize the lookup key.......
            if (!$org || !$org?.next) {
                const $inc = { lock: 1 } as Model;
                const $ups = { stereo: $base.stereo, meta: $base.meta } as Model;
                const $lock = await this.storage.increment(keyId, $inc, $ups);
                if ($lock.lock === 1) {
                    // const nextId = await this.storage.storage.nextSeq(this.storage.type, params?.initialNo);
                    const nextId = await this.nextId();
                    const $ups = {
                        id: keyId,
                        type: `#${this.type}`,
                        next: nextId,
                        createdAt: $lock.createdAt ?? $lock.updatedAt,
                        deletedAt: 0,
                    } as Model;
                    const $updated = await this.storage.update(keyId, $ups);
                    return { ...$lock, ...$updated };
                } else if (depth > 100) {
                    throw new Error(`@depth[${depth}] is out of range - findLookup(${$base?.meta?.text})`);
                }
                //! in some rate, try to reset lock.
                const rate = Math.random();
                const wait = Math.round(rate * 10);
                return waited(wait)
                    .then(() => (rate > resetRate ? this.storage.update(keyId, { lock: 0 } as Model) : null))
                    .then(() => asyncAuto($base, depth + 1));
            }
            return $org;
        };
        //! make base model, and start loop.
        const meta: any = isUseMeta ? { hash, text } : undefined;
        const stereo: string = isUseMeta ? '#' : `#${text}`;
        return asyncAuto({ id: keyId, meta, stereo } as Model);
    }

    /**
     * build search query from filters
     */
    public buildQuery<T extends Model>(
        param: PaginateParam,
        model?: SearchParam<T>,
        options?: { errScope?: string; hidden?: boolean | number; aggregation?: string; aggrLimit?: number },
    ): SearchBody {
        const errScope = options?.errScope ?? `buildQuery(${this.type})`;
        if (typeof param?.limit !== 'number') throw new Error(`.limit(number) is required - ${errScope}`);
        if (param?.page && typeof param?.page !== 'number') throw new Error(`.page(number) is required - ${errScope}`);
        if (param?.offset && typeof param?.offset !== 'number')
            throw new Error(`.offset(number) is required - ${errScope}`);
        const aggregation = options?.aggregation ?? 'stereo'; // default aggregation
        const aggrLimit = options?.aggrLimit ?? 12; // default aggregation limit

        // STEP.0 validate parameters.
        const { limit } = param;
        const page = $T.N(param?.page, 0);
        const offset = $T.N(param?.offset, 0);

        // 1. build search request body
        const body: SearchBody = {
            size: limit,
            from: limit * page + offset,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': this.parent.NS } },
                        { term: { 'type.keyword': this.type } },
                        { term: { deletedAt: 0 } },
                    ],
                },
            },
        };

        //* apply aggregation if needed.
        if (aggregation && typeof aggregation === 'string' && aggregation.length > 0) {
            body.aggs = {
                [aggregation]: {
                    terms: {
                        field: `${aggregation}.keyword`,
                        missing: 'N/A',
                        order: { _key: 'asc' },
                        size: aggrLimit,
                    },
                },
            };
        }

        // 1-0. default filter.
        if (model?.stereo === null) {
            // _add_must_not({ term: { [`stereo.keyword`]: '#' } });
            this.addQueryTerm(body, 'must_not', { term: { [`stereo.keyword`]: '#' } });
        }
        // 1-1. support `hidden` flag.
        if (options?.hidden !== undefined) {
            const hidden = Boolean(options?.hidden);
            if (hidden) {
                this.addQueryTerm(body, 'must', { term: { hidden: 1 } });
            } else {
                this.addQueryTerm(body, 'must_not', { term: { hidden: 1 } });
            }
        }

        // 1-2. filter by attributes.
        if (model && Object.keys(model).length > 0) {
            _inf(this.logNS, `> filters =`, $U.json(model));
            Object.entries(model).forEach(([key, val]) => {
                if (typeof val === 'string') {
                    if (val === '') {
                        this.addQueryTerm(body, 'must_not', { exists: { field: `${key}` } });
                    } else if (val === '!') {
                        this.addQueryTerm(body, 'must', { exists: { field: `${key}` } });
                    } else {
                        this.addQueryTerm(body, 'filter', { term: { [`${key}.keyword`]: val } });
                    }
                } else if (val === null) {
                    // ignore
                } else if (typeof val === 'number') {
                    this.addQueryTerm(body, 'filter', { term: { [`${key}`]: val } });
                } else if (typeof val === 'object' && Array.isArray(val)) {
                    this.addQueryTerm(body, 'must', {
                        bool: {
                            should: (val as any[]).map(n => ({
                                term: {
                                    [`${key}.keyword`]: n,
                                },
                            })),
                            minimum_should_match: 1,
                        },
                    });
                }
            });
        }

        // add sort term by `param.sort`
        return this.addSortTerm(body, param);
    }

    /**
     * Query 기준 추가하기.
     */
    public addQueryTerm(body: SearchBody, term: 'filter' | 'must' | 'must_not', query: SearchQuery | SearchQuery[]) {
        if (!body) throw new Error(`@body (SearchBody) is required!`);
        if (!body.query || !body.query.bool) {
            body.query = { bool: { filter: [], must: [], must_not: [] } };
        }

        //* helper function.
        const _add_filter = (query: SearchQuery | SearchQuery[]) => {
            const filter = [...((body.query.bool.filter as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.filter = filter;
        };
        const _add_must = (query: SearchQuery | SearchQuery[]) => {
            const must = [...((body.query.bool.must as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.must = must;
        };
        const _add_must_not = (query: SearchQuery | SearchQuery[]) => {
            const must_not = [
                ...((body.query.bool.must_not as any[]) || []),
                ...(Array.isArray(query) ? query : [query]),
            ];
            body.query.bool.must_not = must_not;
        };

        if (term === 'filter') {
            _add_filter(query);
        } else if (term === 'must') {
            _add_must(query);
        } else if (term === 'must_not') {
            _add_must_not(query);
        } else {
            throw new Error(`@term(${term}) is not supported!`);
        }
        return body;
    }

    /**
     * sort 기준 추가하기.
     */
    public addSortTerm(body: SearchBody, param?: PaginateParam) {
        if (!body.sort) body.sort = { createdAt: { order: 'desc', missing: '_last' } };
        if (param?.sort) {
            const [sort, asc] = $T.S(param?.sort).split(':', 2);
            const order: 'asc' | 'desc' = `${asc || 'asc'}` as any;
            const missing: '_last' | '_first' = order == 'desc' ? '_last' : '_first';
            if (!sort) body.sort = undefined;
            else if (sort === 'id') body.sort = { 'id.keyword': { order, missing: '_last' } };
            else if (sort === 'name') body.sort = { 'name.keyword': { order, missing: '_last' } };
            else if (sort === 'brand') body.sort = { 'brand.keyword': { order, missing: '_last' } };
            else if (sort === 'color') body.sort = { 'color.keyword': { order, missing: '_last' } };
            else if (sort === 'order') body.sort = { order: { order, missing } };
            else if (sort === 'createdAt') body.sort = { createdAt: { order, missing } };
            else if (sort === 'updatedAt') body.sort = { updatedAt: { order, missing } };
            else if (sort) body.sort = { [`${sort}.keyword`]: { order, missing } };
        }
        return body;
    }

    /**
     * build filter for scan.
     * @returns DynamoScanFilter
     */
    public buildScanFilter(params?: SearchParam<Model>): DynamoScanFilter {
        const filter: DynamoScanFilter = [
            { key: 'ns', comparator: '=', value: this.parent.NS },
            { key: 'type', comparator: '=', value: this.type },
            { not: { key: 'stereo', operator: 'begins_with', value: '#' } },
            { key: 'deletedAt', comparator: '=', value: 0 },
        ];

        // filter by params
        if (params) {
            Object.entries(params).forEach(([key, val]) => {
                if (val === undefined || val === null) {
                    // ignore.
                } else if (typeof val === 'string') {
                    filter.push({ key, comparator: '=', value: val });
                } else {
                    throw new Error(`400 NOT SUPPORTED - filter param[${$U.json(params)}]`);
                }
            });
        }

        return filter;
    }

    /**
     * execute scan with filter.
     *
     * @param $page
     * @param filter
     * @returns
     */
    public async doScan<R = { key: string; count: number }>(
        $page: PaginateParam,
        filter?: DynamoScanFilter,
    ): Promise<ListResult<Model, R>> {
        const options = this.parent.dynamoOptions;
        const idName = options.idName || '_id';
        //* check if dummy table
        if (!options?.tableName || options?.tableName?.endsWith('.yml'))
            throw new Error(`400 NO DYNAMO - table:${options?.tableName ?? ''}!`);
        const $scan = new DynamoScanService(options);

        //* scan all items with basic filter.
        const list0: Model[] = [];
        let $res: DynamoScanResult<GeneralItem>;
        while (true) {
            $res = await $scan.scan(-1, $res?.last, filter);
            $res.list?.forEach(N => {
                delete N[idName];
                list0.push(N as unknown as Model);
            });
            if (!$res?.last[idName]) break;
        }

        //TODO - sort by some.

        //* check if in unlimited. (or cut-off by page)
        const limit = $page?.limit ?? 10;
        const page = $page?.page ?? 0;
        const unLimited = limit === -1 ? true : false;
        const total = list0?.length || 0;
        const _page = (list: Model[], page: number, limit: number) => {
            if (!unLimited && limit === 0) return [];
            else if (unLimited) return list;
            return list.slice(page * limit, (page + 1) * limit);
        };
        const list = _page(list0, page, limit);

        //* returns.
        const aggr = [{ key: '#scan', count: total } as unknown as R];
        return { list, total, limit, aggr };
    }

    /**
     * execute scan-last with filter.
     *
     * @param $param ScanLastParams
     * @returns
     */
    public async doScanLast($param: ScanLastParams): Promise<ScanLastResult<Model>> {
        const options = this.parent.dynamoOptions;
        const limit = $param?.limit ?? 2;
        const last = $param?.last;
        const filter = $param?.filter;

        if (!options?.tableName || options?.tableName?.endsWith('.yml')) {
            throw new Error(`400 NO DYNAMO - table:${options?.tableName ?? ''}!`);
        }

        const $scan = new DynamoScanService(options);
        const $res = await $scan.scan(limit, last, filter);

        const list: Model[] = $res.list as unknown as Model[];

        const total = $U.N(list?.length || 0);
        return onlyDefined({
            list,
            total,
            limit: limit,
            count: $res?.count,
            last: Object.keys($res?.last || {}).length === 0 ? undefined : $res?.last,
        });
    }

    /**
     * basic ElasticSearch Query.
     * you can override this method for customization.
     *
     * @param limit pagination limit (default 10)
     * @param page page number (starts from 0)
     * @param filters model filters
     * @param param (optional) addtion params
     */
    public async list<R = { key: string; count: number }>(
        $page: PaginateParam,
        $param?: SearchParam<Model>,
        options?: { hidden?: boolean | number; aggregation?: string },
    ): Promise<ListResult<Model, R>> {
        _log(this.logNS, `list(${$page?.limit ?? ''}, ${$page?.page ?? ''})..`);
        const aggregation = options?.aggregation ?? 'stereo'; // default aggregation

        //* use dynamo-scan if no search configuration.
        if (!this.parent.hasSearchEngine()) {
            const filter = this.buildScanFilter($param);
            return this.doScan($page, filter);
        }

        // 1. build search request body
        const body = this.buildQuery($page, $param, options);

        // 2. search w/ query
        const result = await this.parent.doSearch<Model>(body);

        // 3. extract names only
        const _aggr = (): R[] => {
            if (!aggregation) return [];
            const buckets = result?.aggregations?.[aggregation]?.buckets;
            buckets && _log(this.logNS, `> buckets =`, $U.json(buckets));
            if (!buckets || !Array.isArray(buckets)) return [];
            return (buckets as { key: string; doc_count: number }[])?.reduce<R[]>((L: R[], bucket) => {
                const key = $T.S(bucket.key);
                const count = $T.N(bucket.doc_count, 0);
                L.push({ key, count } as unknown as R);
                return L;
            }, []);
        };

        // returns.
        return { total: result.total, list: result.list, aggr: _aggr(), limit: $page?.limit, page: $page?.page };
    }

    /**
     * list of projection fields
     * - ONLY fields defined in `goods-model`
     * - 모델별 추가 필드목록만 추림
     */
    public listProjections(params?: { includes?: string[]; excludes?: string[]; sorted?: boolean }) {
        const includes = params?.includes ?? ['id', 'error', 'createdAt'];
        const excludes = params?.excludes ?? ['extra', 'desc'];
        const isSorted = params?.sorted ?? true;
        const _notIn = (list: string[], $ref?: string[]) =>
            list.filter(s => !excludes?.includes(s) && !includes?.includes(s) && !$ref?.includes(s));
        const list = _notIn(this.FIELDS, CORE_FIELDS);
        if (isSorted) return [...includes, ...list.sort()];
        return [...includes, ...list];
    }

    /**
     * fetch all list of goods for filtering.
     *
     * @override if required.
     */
    public buildSearchAll(params?: { size?: number }, sort?: SortTerm): SearchBody {
        sort = sort ?? { createdAt: { order: 'asc', missing: '_last' } };
        const [ns, type] = [this.parent.NS, this.type];
        const size = params?.size ?? 500;
        const _source = this.listProjections({ excludes: ['extra', 'meta'] });
        const body: SearchBody = {
            size,
            query: {
                bool: {
                    filter: [{ term: { 'ns.keyword': ns } }, { term: { 'type.keyword': type } }],
                },
            },
            _source,
        };
        if (sort) body.sort = sort;
        const _add_filter = (query: SearchQuery | SearchQuery[]) => {
            const filter = [...((body.query.bool.filter as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.filter = filter;
        };
        const _add_must = (query: SearchQuery | SearchQuery[]) => {
            const must = [...((body.query.bool.must as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.must = must;
        };
        const _add_must_not = (query: SearchQuery | SearchQuery[]) => {
            const must_not = [
                ...((body.query.bool.must_not as any[]) || []),
                ...(Array.isArray(query) ? query : [query]),
            ];
            body.query.bool.must_not = must_not;
        };
        _add_must({
            bool: {
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
                minimum_should_match: 1,
            },
        });
        _add_must_not({ term: { stereo: '#' } });
        _add_must_not({ term: { 'stereo.keyword': '#' } });
        return body;
    }

    /**
     * sync by scan with last record.
     *
     * **[좋은코드]**
     * 1. 보기 좋아야함; 변수이름, 로직도 잘보이고, 함수의 목적
     * 2. 테스트 가능한 코드 (또는 테스트가된 코드)
     *  - Unit Test: 테스트 가능한 최소단위 (함수.. 블럭)
     *  - Integrated Test: Group of Units (ex: my_sequence)
     *
     * @param $param
     * @param options
     * @returns
     */
    public async doSyncScanLast(
        $param: ScanLastParams,
        options?: {
            /** chunk-size of bulk (default: 10) */
            size?: number;
        },
    ): Promise<DoSyncScanLastResult> {
        //* 1. doScanLast(w/filter by type); scan-size = 100
        const $perf = $T.perf();
        const { list, last, count } = await this.doScanLast($param);

        //* inner type.
        type Chunks<T = any> = {
            id: string;
            error?: string | null;
            chunk: T[];
        };
        type BulkResponseBody = {
            errors: boolean;
            items: { index: ItemList }[];
            took?: number;
        };
        type ItemList = {
            _id?: string;
            // _index?: string;
            // _primary_term?: number;
            // _seq_no?: number;
            // _shards?: { failed: number; successful: number; total: number };
            // _type?: string;
            _version?: number;
            error?: string;
            // result?: string;
            status?: number;
        };
        type BulkChunkResult<T = any> = Chunks<T> & {
            list?: ItemList[];
        };

        //* 2. chunk the list into smaller parts
        const _makeChucks = <T = any>(list: T[], chunkSize: number) => {
            const result: T[][] = [];
            for (let i = 0; i < list.length; i += chunkSize) {
                result.push(list.slice(i, i + chunkSize));
            }
            return result;
        };

        const _saveBulk = async <T = any>(operations: T[]) => {
            const elastic = $ES6.client;
            const $res = await elastic.bulk({ body: operations }).catch(e => {
                _err(this.NS, `>> err=`, e);
                throw e;
            });
            const list =
                ($res.body as BulkResponseBody)?.items?.map<ItemList>(item => ({
                    _id: item.index._id,
                    _version: item.index._version,
                    error: item.index.error,
                    status: item.index.status,
                })) ?? [];
            return { list, error: null as string | null };
        };

        const chunkSize = options?.size ?? 10;
        const chunks = _makeChucks(list, chunkSize);

        //* 3. use my_sequence to bulk each chunk sequentially
        const chunkList = chunks.map(
            (chunk, index): Chunks => ({
                id: `${index}`,
                error: null,
                chunk,
            }),
        );

        const _transformBulkOperations = (dataChunk: Model[]) => {
            return dataChunk.flatMap(doc => {
                const { _id, ...items } = doc;
                return [{ index: { _index: $ES6.options?.indexName, _id: doc._id } }, items as Model];
            });
        };

        const results = await my_sequence<Chunks<Model>, BulkChunkResult<Model>>(chunkList, async N => {
            const operations = _transformBulkOperations(N.chunk);
            const bulk = await _saveBulk(operations).catch(e => ({ list: [] as ItemList[], error: GETERR(e) }));
            return { ...N, ...bulk };
        });
        // _log(this.logNS, `> results =`, $U.json(results));

        // validate input and output _id
        const _validateIds = (inputList: Model[], outputList: ItemList[]) => {
            const mismatchedIds = outputList.filter(item => !inputList.some(input => input._id === item._id));

            if (mismatchedIds.length > 0) {
                const mismatchedIdsList = mismatchedIds.map(item => item._id);
                return { isValid: false, mismatchedIds: mismatchedIdsList };
            }
            return { isValid: true, mismatchedIds: [] };
        };

        //TODO - 초기 입력의 목록과 출력의 목록의 쌍이 서로 맞아야함.... @241230/steve
        const itemList = results.reduce<ItemList[]>((L, N) => {
            if (typeof N?.error == 'string') L.push({ error: N.error });
            if (N?.list) {
                const validation = _validateIds(list, N?.list);
                if (!validation.isValid) throw new Error(`Mismatched list id found: ${validation.mismatchedIds}`);
                L.push(...N.list);
            }
            return L;
        }, []);

        //* returns
        const took = $perf.took();
        return onlyDefined<DoSyncScanLastResult>({ last: last, count: count, took, list: itemList });
    }
}

/**
 * class: `MyCoreProxy`
 * - common parent of proxy.
 */
export class MyCoreProxy<
    U extends string,
    MyService extends MyCoreService<CoreModel<any>, any, any>,
> extends AbstractProxy<any, MyService> {
    public readonly managerProxies: { [propKey: string]: MyManagerProxy<any, any, MyService> } = {};
    public constructor(context: NextContext, service: MyService, cacheScope?: string) {
        super(context, service, 2, cacheScope ?? `${NAME}:${service.NS}:`); //! use `env.NAME` as default cache scope.
    }

    /**
     * check if in mocks mode.
     * - override this to set mocks.
     *
     * @returns boolean
     */
    public isMocks(): boolean {
        return false;
    }

    /**
     * register this.
     */
    public register(mgr: MyManagerProxy<any, any, MyService>) {
        const res = super.register(mgr);
        // also add into proxy lookup.
        this.addManagerProxy(mgr.$mgr.type, mgr);
        return res;
    }

    /**
     * add into proxy lookup.
     */
    protected addManagerProxy(modelType: U, proxy: MyManagerProxy<any, any, MyService>) {
        if (this.managerProxies[modelType]) {
            throw Error(`@modelType[${modelType}] is invalid - already exists!`);
        } else {
            this.managerProxies[modelType] = proxy;
        }
    }

    /**
     * get from lookup table.
     */
    public getManagerProxy<Model, ModelManager extends MyCoreManager<Model, any, MyService>>(
        modelType: U,
    ): MyManagerProxy<Model, ModelManager, MyService> {
        return this.managerProxies[modelType];
    }

    /**
     * @override fetchIdentityAccess
     * @deprecated not supported.
     */
    protected async fetchIdentityAccess(identityId: string, domain?: string): Promise<any> {
        const errScope = `fetchIdentityAccess(${identityId ?? ''}/${domain ?? ''})`;
        throw new Error(`400 NOT SUPPORTED - ${errScope}`);
    }

    /**
     * get the `identity-token` (as session) from current req-context.
     * - 1차 호출(front에서) 에서는 이 세션이 꼭 필요함.
     * - 2차 호출(protocol이용) 에서는 선택사항으로, 조절가능해야함! (#TODO - 이걸 어떻게 구불할것인가?)
     * - 로컬) 로컬 개발에서는 시뮬레이션 방법은 #TODO
     *
     * @param options.throwable flag to throw (default true)
     */
    public getCurrentSession(options?: {
        /** (default true) */
        throwable?: boolean;
        /** (default true) */
        normalize?: boolean;
        /** (default true) */
        useSession?: string | boolean;
        /** (optional) env.LOCAL_ACCOUNT */
        LOCAL_ACCOUNT?: string;
        /** (optional) env.USE_SESSION */
        USE_SESSION?: string;
        /** (optional) next context to override */
        context?: NextContext;
    }): IdentityToken {
        // const useSession = !$U.env('LOCAL_ACCOUNT') ? $U.env('USE_SESSION') : null;
        const throwable = options?.throwable ?? true;
        const normalize = options?.normalize ?? true;
        const useSession = options?.useSession ?? true;
        const LOCAL_ACCOUNT = $T.S(options?.LOCAL_ACCOUNT ?? $U.env('LOCAL_ACCOUNT'));
        const USE_SESSION = $T.S(options?.USE_SESSION ?? $U.env('USE_SESSION'));
        LOCAL_ACCOUNT && _inf(this.service.NS, `> LOCAL_ACCOUNT =`, LOCAL_ACCOUNT);
        USE_SESSION && _inf(this.service.NS, `> use-session =`, useSession, USE_SESSION);

        const context = (options?.context ?? this.context) as unknown as NextContext<IdentityToken>;
        //* WARN - in case of local, no need to throw error.
        const isLocal = context?.domain === 'localhost';

        // load the `identity-token` from json file.
        const _load = (file: string): IdentityToken => {
            const data = loadJsonSync(file);
            if (typeof data?.error === 'string') throw new Error(`@file[${file}] is invalid, ${data.error}`);
            if (data?.context?.identity) return data?.context?.identity as IdentityToken;
            return data;
        };
        const _default = (): IdentityToken | null => {
            //INFO - `userAgent`가 있다면, identity 생성 프로세스가 제대로 실행된것으로 판단해도됨! @240620.
            if (typeof (context?.identity as any)?.userAgent == 'string') return context?.identity;
            //TODO - 아래 코드는 개선의 여지가 있음(문제점???) @241210
            // if (typeof (context?.identity as any)?.identityId == 'string') return context?.identity;
            return null;
        };

        //* load the `identity-token` from context or local json file.
        const _session = (): IdentityToken => {
            //INFO - `userAgent`가 있다면, identity 생성 프로세스가 제대로 실행된것으로 판단해도됨! @240620.
            const $idt = context?.identity as unknown as NextIdentityCognito;
            //* Local 이면서 meta 정보가 있다면, 그걸로 identity 재구성함 @251212.
            if (isLocal && typeof $idt?.meta === 'string' && $idt?.meta.length > 0) {
                const $jwt = $U.jwt('');
                return $jwt.decode(context?.identity?.meta, { complete: false }) as IdentityToken;
            }
            if (typeof $idt?.userAgent == 'string') {
                //NOTE - `express` 에서 넘어온 경우 `identityPoolId=null`으로 가능함. (but apiKey should be empty) @251031
                const fromExpress = typeof $idt?.identityPoolId === 'undefined' || $idt?.identityPoolId === null;
                if (!fromExpress || typeof $idt?.apiKey === 'string') {
                    return context?.identity;
                }
            }

            //TODO - 아래 코드는 개선의 여지가 있음(문제점???) @241210
            if (LOCAL_ACCOUNT) return _default();
            if (useSession) {
                // _inf(this.service.NS, `> use-session =`, useSession, USE_SESSION);
                if (useSession === true || useSession === 'true' || useSession === '1') {
                    if (USE_SESSION?.endsWith('.json')) {
                        const $sess = _load(USE_SESSION);
                        _inf(this.service.NS, `> use-session-json =`, $U.json($sess));
                        return $sess;
                    }
                    return _default();
                } else if (typeof useSession === 'string' || useSession) {
                    return _load(useSession);
                }
                return _default();
            }
            return _default();
        };
        const $sess = _session();
        // _inf(this.service.NS, `> use-session =`, $U.json($ses));
        if (throwable && !isLocal) {
            const eCode = `403 IDENTITY-TOKEN`;
            const err = $sess?.error
                ? `error:${$sess?.error}`
                : $sess?.meta
                ? `meta:${typeof $sess?.meta == 'string' ? $sess?.meta : $U.json($sess?.meta)}`
                : 'check x-lemon-identity';
            //* validate conditions..
            if (!$sess)
                throw new Error(`${eCode} - .identity (IdentityToken) is required - context:${$U.json(context)}`);
            if ($sess?.sid === undefined) throw new Error(`${eCode} - ${err}`);
            if (!$sess?.sid) throw new Error(`${eCode} - .sid (site-id) is required!`);
            if (!$sess?.uid) throw new Error(`${eCode} - .uid (user-id) is required!`);
        }

        //* normalize for the internal.
        const sid = normalize && $sess?.sid?.startsWith('#') ? null : $T.S2($sess?.sid);
        const uid = normalize && $sess?.uid?.startsWith('#') ? null : $T.S2($sess?.uid);

        //* returns.
        return $sess ? { ...$sess, sid, uid } : null;
    }

    /**
     * find the current identity-id from context.
     * - or, use env[LOCAL_ACCOUNT]
     */
    public asCurrentIdentityId = (context?: NextContext): string | null => {
        context = context ?? this.context;
        if (context?.domain === 'localhost' && !(context as any)?.identity?.identityId) {
            const LOCAL_ACCOUNT = $U.env('LOCAL_ACCOUNT', '');
            return LOCAL_ACCOUNT ? LOCAL_ACCOUNT : null;
        }
        return context && getIdentityId(context);
    };

    /**
     * assert context condition.
     */
    public assertContext(
        params?: {
            /** call in local */
            isLocal?: boolean;
            /** authed by cognito identity-provider */
            isAuthed?: boolean;
            /** signed call with access-key */
            isSigned?: boolean;
            /** check if session has role */
            hasRole?: string;
        },
        /** (optional) */
        options?: {
            /** (optional) throwable to throw error if error */
            throwable?: boolean;
            /** (optional) errScope to override in error */
            errScope?: string;
            /** (optional) next context to override */
            context?: NextContext;
        },
    ) {
        const context = options?.context ?? this.context;
        const throwable = options?.throwable ?? true;
        const errScope = options?.errScope ?? `assertContext()`;
        const $idt = context?.identity as NextIdentityCognito;
        const isS = (s: string) => typeof s === 'string' && s?.length > 0;
        //* call in local
        const isLocal = context?.domain === 'localhost';
        //* signed call with access-key
        const isSigned = isS($idt?.accessKey);
        //* authed by cognito provider.
        const isAuthed = isS($idt?.identityProvider) && isS($idt?.identityId) && isS($idt?.identityPoolId);
        //* check if has role
        const _hasRole = (role: string): boolean => {
            const $sess = this.getCurrentSession({ throwable: false, context });
            return $sess?.roles?.includes(role);
        };

        const errCode = `403 NOT ALLOWED`;
        if (typeof params?.isLocal == 'boolean' && params?.isLocal != isLocal) {
            if (throwable) throw new Error(`${errCode} - invalid isLocal[${params?.isLocal}] @${errScope}`);
            return false;
        }
        if (typeof params?.isSigned == 'boolean' && params?.isSigned != isSigned) {
            if (throwable) throw new Error(`${errCode} - invalid isSigned[${params?.isSigned}] @${errScope}`);
            return false;
        }
        if (typeof params?.isAuthed == 'boolean' && params?.isAuthed != isAuthed) {
            if (throwable) throw new Error(`${errCode} - invalid isAuthed[${params?.isAuthed}] @${errScope}`);
            return false;
        }
        if (typeof params?.hasRole == 'string' && !_hasRole(params?.hasRole)) {
            if (throwable) throw new Error(`${errCode} - invalid hasRole[${params?.hasRole}] @${errScope}`);
            return false;
        }

        return true;
    }

    /**
     * check if current context has `admin` access
     * 1. run in local environ (or internal protocol with domin='localhost')
     * 2. access via signed access-key
     * 3. authorized cognito and has `admin` role in identity-token.
     *
     * @param role (default) admin
     * @param options optionals
     * @returns boolean
     */
    public hasAdminRole(role?: string, options?: { errScope?: string; context?: NextContext }) {
        role = $T.S2(role, 'admin');
        const context: NextContext<IdentityToken> = (options?.context ?? this.context) as any;
        const $option = { ...options, throwable: false };
        if (this.assertContext({ isLocal: true }, $option)) return true;
        if (this.assertContext({ isSigned: true, isAuthed: false }, $option)) return true;
        if (this.assertContext({ isAuthed: true, hasRole: role }, $option)) return true;
        //TODO 아래는 임시로 role에서 바로 체크하도록함! @251212/steve (샘픔의 session-dev.json를 이용할경우 admin 체크가 잘 안됨)
        if (context?.identity?.roles?.includes(role)) return true;
        return false;
    }

    /**
     * prepare `next-context` w/ the customized { domain, userAgent }
     *
     * @param identityId the target identity-id
     * @param options additional options.
     */
    public asNextContext<T extends NextIdentity>(
        identityId?: string,
        options?: {
            /** (optional) domain to override */
            domain?: string;
            /** (optional) userAgent to override */
            userAgent?: string;
            /** (optional) identity(object) to override */
            identity?: T;
            /** (optional) session(object) to override */
            session?: IdentityToken;
        },
    ) {
        const $ctx = this.context;
        identityId = identityId ?? this.asCurrentIdentityId($ctx);
        const identity = options?.identity ?? ($ctx.identity as T);
        const session = options?.session ?? this.getCurrentSession({ throwable: false });
        const $ctx2: NextContext<any> = {
            ...$ctx,
            domain: options?.domain ?? $ctx.domain,
            userAgent: options?.userAgent ?? $ctx.userAgent,
            identity: {
                ...session,
                ...identity,
                identityId,
            },
        };
        return $ctx2 as NextContext<T>;
    }

    /**
     * from `identity-token`, make base of model { sid, uid }
     *
     * @param proxy the current proxy.
     * @returns base model
     */
    public async makeModelBase<M extends CoreModel<U>>(
        model: M,
        options?: {
            /** use this parent to prepare base-model. (hiher than session) */
            parent?: CoreModel;
            /** flag to use session (default as confUseSession) */
            useSession?: boolean;
            /** flag to throw error (default true) */
            throwable?: boolean;
        },
    ): Promise<M> {
        const useSession = options?.useSession ?? false;
        const throwable = options?.throwable ?? false;
        const base = model ?? ({} as any);
        // STEP.0 populate with current parent.
        if (options?.parent) {
            const parent = options.parent;
            base['sid'] = base['sid'] ?? parent?.sid;
            base['uid'] = base['uid'] ?? parent?.uid;
        }
        // STEP.1 use session if applicable
        if (useSession) {
            const parent = this.getCurrentSession({ throwable });
            base['sid'] = base['sid'] ?? parent?.sid;
            base['uid'] = base['uid'] ?? parent?.uid;
        }
        return base;
    }

    /**
     * Check if the user can perform a specific action on a model.
     * - override this method to implement custom logic.
     *
     * @param action The action to check.
     * @param model The model to check against. (.type is used to find the manager-proxy)
     * @param options Optional parameters for the check.
     * @returns True if the action is allowed, false otherwise.
     */
    public canDo<M extends CoreModel<U>>(action: CanDoActionType, model?: M, options?: CanDoOptions): boolean {
        const type = model?.type;
        if (typeof type !== 'string') throw new Error(`400 INVALID - @model.type (string) is required!`);
        const $prx = this.getManagerProxy<M, MyCoreManager<M, U, MyService>>(type);
        if (!$prx) return false;
        return $prx.canDo(action, model, options);
    }
}

/**
 * class: `MyProxy`
 * - common parent of manager-proxy.
 */
export class MyManagerProxy<
    MyModel extends CoreModel<ModelType>,
    MyManager extends MyCoreManager<MyModel, ModelType, MyService>,
    MyService extends MyCoreService<MyModel, ModelType, any>,
    ModelType extends string = string,
> extends ManagerProxy<MyModel, MyManager, ModelType> {
    public constructor(readonly proxy: MyCoreProxy<ModelType, MyService>, mgr: MyManager) {
        super(proxy, mgr);
    }

    /**
     * @override the default `normal()` to support _name.
     */
    public normal = (N: MyModel): MyModel =>
        Object.keys(N || {}).reduce<MyModel>((M, k) => {
            //NOTE - imporved of basic `normal()` in core not to ignore `_` properties.
            if (k == '_id' || !this.$mgr.FIELDS.includes(k)) return M;
            const v = N[k as keyof MyModel];
            //! `null` 은 DynamoDB에서 비어있는 문자임.
            (M as any)[k] = v === null ? '' : v;
            return M;
        }, {} as any);

    /**
     * pack the query parameter for list
     * - `param` has the string values only including '', '!'
     * - `model` has the valid data type. (number | string | ... )
     *
     * ```ts
     * let model = bodyToModel(param)
     * ```
     *
     * @param param the original query parameter.
     * @param model the transformed model from `param`.
     * @param options (optional)
     * @returns
     */
    public packSearchParam(
        param: SimpleSet,
        model?: MyModel,
        options?: {
            /** flag to use identity-token (default false) */
            useSession?: boolean;
            /** flag to throw error (default true) */
            throwable?: boolean;
            /** default limit (default 10) */
            limit?: number;
            /** (optional) error scope to use */
            errScope?: string;
        },
    ) {
        const $ctx = this.proxy.context;
        const type = this.$mgr.type;
        const useSession = options?.useSession ?? false;
        const throwable = options?.throwable ?? true;
        const errScope = options?.errScope ?? `packSearchParam(${type})`;
        const isLocal = $ctx?.domain === 'localhost';
        const session = useSession ? this.proxy.getCurrentSession({ throwable }) : null;

        const _has = (name: string): boolean =>
            param && (typeof param[name] === 'string' || typeof param[name] === 'number');
        const _val = (name: string): string => (param ? $T.S2(param[name]) : undefined);
        const _hasAdm = () => this.proxy.hasAdminRole('admin');

        // parse params
        const sort = _has('sort') ? $T.S2(param?.sort, '') : undefined;
        const $page = parsePaginateParam({ ...param, sort }, { limit: options?.limit ?? 10, page: 0 });
        if ($page.page < 0) throw new Error(`@page[${$page.page}] is invalid - ${errScope}`);

        // extract filtering by properties.
        // WARN - has no internal properties like { sid, gid, uid }
        const $param: SearchParam<MyModel> = this.$mgr.FIELDS.reduce((M: SearchParam<MyModel>, k: string) => {
            const key = k as keyof MyModel;
            const val = model && model[key];
            const qry = param && param[k];
            //* high priorty to param for not transformed field.
            if (qry === '' || qry === '!') (M as any)[key] = qry;
            else if (val !== undefined) (M as any)[key] = val;
            return M;
        }, {} as SearchParam<MyModel>);

        // use w/ `identity-token` (known as session)
        if (useSession && !isLocal) {
            if (_hasAdm()) {
                $param['sid'] = _has('sid') ? (_val('sid') === '0' ? session?.sid : _val('sid')) : session?.sid;
            } else {
                $param['sid'] = session?.sid;
            }
            //* use the current session's uid.
            if (_has('uid')) $param['uid'] = _val('uid') === '0' ? session?.uid : _val('uid');
        } else {
            if (_has('sid')) $param['sid'] = _val('sid');
            if (_has('uid')) $param['uid'] = _val('uid') === '0' ? session?.uid : _val('uid');
        }

        //* returns params.
        return { $page, $param };
    }

    /**
     * override this to validate request'body.
     * @param model model from request.
     * @param modelId (optional) modelId if to update the target model.
     * @return validated model to save.
     */
    public async validateModel<T extends MyModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const validated = await this.$mgr.validateModel(model, $org);
        return validated as T;
    }

    /**
     * callback before saving model.
     * - could change field before saving.
     *
     * @param model the last model to save.
     * @param $org (optional) original model (null if creating)
     */
    public async onBeforeSave<T extends MyModel>(model: T, $org?: T): Promise<T> {
        return model;
    }

    /**
     * callback after saving model.
     * - could trigger the next step if created.
     *
     * @param model the saved model (null if deleted)
     * @param $org (optional) original model (null if new created)
     */
    public async onAfterSave<T extends MyModel>(model: T, $org?: T): Promise<T> {
        return model;
    }

    /**
     * generate the next id
     */
    public async nextId(step?: number): Promise<string> {
        return this.$mgr.nextId(step).then(n => $T.S2(n));
    }

    /**
     * create new model
     * - use `.id` or `nextId()` for model-id
     * - validate model in seperate way before using this.
     *
     * @param model creation model
     * @param validate (optional) flag to validate (default is true)
     */
    public async makeModel<T extends MyModel>(model: T, validate?: boolean): Promise<T> {
        const errScope = `makeModel(${this.$mgr.type}/${model?.id ?? ''})`;
        if (!model) throw new Error(`@model (${this.$mgr.type}-model) is required - ${errScope}`);
        validate = validate ?? true;

        // use the custome id or new generated id.
        const hasId = !!model.id;
        const modelId = hasId ? $T.S2(model.id) : await this.nextId();

        // make default model as base.
        const $def0 = this.$mgr.buildDefault(modelId);
        const $def2 = this.override($def0, model); //! 초기생성(INSERT)에 대부분의 필드값 채워주기.
        const $def3 = validate ? await this.validateModel({ ...$def2, id: modelId }, null) : $def2;

        // overwrite (or update) the model.
        const $org = await this.get(modelId, { ...$def3 });
        if ($org?.id !== modelId) throw new Error(`.id[${model?.id}] is invalid (mismatched ${modelId}) - ${errScope}`);
        const $res = hasId ? this.override($org, $def3) : $org;
        return $res as T; //! return the model with id.
    }

    /**
     * Check if the current user can perform the specified action on the given model.
     * - override this method to implement custom logic.
     *
     * @param action The action to check.
     * @param model The model to check against.
     * @param options Additional options for the check.
     * @returns True if the action is allowed, false otherwise.
     */
    public canDo<T extends MyModel>(action: CanDoActionType, model?: T, options?: CanDoOptions): boolean {
        const errScope = options?.errScope ?? `canDo(${action ?? ''}:${this.$mgr.type}/${model?.id ?? '-'})`;
        const useSession = options?.useSession ?? this.proxy.service.isUseSssion();
        const throwable = options?.throwable ?? true;
        const context = options?.context;

        // STEP.0 validate parameters.
        const _act = $T.asLut(action, $LUT.CanDoAction, { throwable: false, default: null });
        if (!_act || typeof _act !== 'string')
            throw new Error(`400 INVALID - action[${action ?? ''}] is invalid @${errScope}`);

        // no session but required.
        const $sess = this.proxy.getCurrentSession({ throwable, useSession, context });
        if (useSession && !$sess) return false;

        // admin can do anything.
        const isAdmin = this.proxy.hasAdminRole(null, { errScope, context });
        const hasRole = $sess?.roles?.length > 0 ? true : false; // guest if empty.
        if (isAdmin) return true;

        // session & model information.
        const S = { sid: $T.S2($sess?.sid), uid: $T.S2($sess?.uid) };
        const M = { sid: $T.S2(model?.sid), uid: $T.S2(model?.uid) };

        // check action.
        if (hasRole) {
            switch (_act) {
                case 'list':
                case 'read':
                case 'create':
                    // (default) action is allowed if sid matches or no sid.
                    if (!M.sid) return true;
                    if (S.sid === M.sid) return true;
                    break;
                case 'update':
                case 'delete':
                    // (default) action is allowed if sid&uid matches or no sid.
                    if (!M.sid) return true;
                    if (S.sid === M.sid && S.uid === M.uid) return true;
                    break;
                default:
                    throw new Error(`400 INVALID - action[${_act}] is invalid @${errScope}`);
            }
        }

        // not allowed.
        if (throwable) throw new Error(`403 NOT ALLOWED - action[${_act}] is invalid @${errScope}`);
        return false;
    }

    /**
     * read multiple nodes.
     * @param ids list of object-ids
     * @param throwable (optional) flag to throw error if not found
     */
    public async mget<T extends MyModel = MyModel>(
        ids: string[],
        options?: { throwable?: boolean } | boolean,
    ): Promise<T[]> {
        const throwable = typeof options === 'boolean' ? options : options?.throwable ?? true;
        if (!ids || ids.length === 0) return [];

        const result: (T | null)[] = [];
        const toFetch: string[] = [];
        const indexMap: { [key: string]: number[] } = {};

        //* STEP.1 check cached items
        ids.forEach((id, index) => {
            const err404 = `404 NOT FOUND - proxy/${this.$mgr.type}/id:${id}`;
            //* already marked as null (404)
            if (this._org[id] === null) {
                if (throwable) throw new Error(err404);
                result[index] = null;
                return;
            }
            //* found in _new
            const N = this._new[id];
            if (N !== undefined) {
                (result as any)[index] = N;
                return;
            }
            //* need to fetch
            if (!indexMap[id]) {
                indexMap[id] = [];
                toFetch.push(id);
            }
            indexMap[id].push(index);
        });

        //* STEP.2 batch read from storage
        if (toFetch.length > 0) {
            const context = this.proxy.asNextContext();
            //TODO [Steve] 여기서 갑자기 storage 에서 읽어오는부분을 proxy 에서 하도록 개선 필요해 보임 @260608.
            const $res = await this.$mgr.storage.storage.doReadMulti(this.$mgr.type, toFetch, { throwable, context });
            const successMap: { [key: string]: T } = {};
            ($res?.success || []).forEach(model => {
                const id = (model as CoreModel).id;
                if (id) successMap[id] = model as T;
            });

            //* STEP.3 save to cache and build result
            toFetch.forEach(id => {
                const M = successMap[id];
                if (M) {
                    const M2 = this.normal(M);
                    this._org[id] = M2;
                    const M3 = JSON.parse($U.json(M2)) as T;
                    this._new[id] = M3;
                    indexMap[id].forEach(index => {
                        result[index] = M3;
                    });
                } else {
                    this._org[id] = null;
                    const err404 = `404 NOT FOUND - proxy/${this.$mgr.type}/id:${id}`;
                    indexMap[id].forEach(index => {
                        if (throwable) throw new Error(err404);
                        result[index] = null;
                    });
                }
            });
        }

        return result;
    }

    /**
     * update multiple nodes.
     * @param updates list of models (should include id)
     */
    public async mset<T extends MyModel>(updates: Array<T>): Promise<T[]> {
        if (!updates || updates.length === 0) return [];

        const result: T[] = [];
        for (const model of updates) {
            const id = model.id;
            if (!id) throw new Error(`@id is required - proxy/${this.$mgr.type}/mset()!`);
            const O = await this.get(id);
            result.push(this.override(O, model) as T);
        }
        return result;
    }
}

/**
 * parameters for Elasticsearch operations.
 *
 * @template T type of the body content.
 */
interface ElasticParams<T extends object = any> {
    /**
     * index name.
     */
    index: string;
    /**
     * document ID.
     */
    id?: string;
    /**
     * body content.
     */
    body: T;
    /**
     * document type (optional).
     */
    type?: string;
}
/**
 * parameters for Elasticsearch search operations.
 *
 * @template T type of the body content.
 */
interface ElasticSearchParams<T extends object = any> {
    /**
     * index name.
     */
    index: string;
    /**
     * search body content.
     */
    body: T;
    /**
     * document type (optional).
     */
    type?: string;
    /**
     * search type
     * (e.g., 'query_then_fetch', 'dfs_query_then_fetch').
     */
    searchType: SearchType;
}

/**
 * class: `OS2Service`
 * - Master 권한 전용 Elasticsearch 관리 서비스
 * - elasticsearch service for OS2.
 */
export class OS2Service<T extends Elastic6Item = any> extends Elastic6Service<any> {
    protected _options: Elastic6Option;
    public readonly _client: elasticsearch.Client;
    public readonly $fgac: OS2FGACManager;

    public static override instance(endpoint: string) {
        const _config = (n: string) => $cores.cores.config.config.get(n);
        const masterUser = _config('OS2_MASTER_UID');
        const masterPass = _config('OS2_MASTER_PWD');
        // if (!masterUser || !masterPass) throw new Error('400 NO MASTER - OS2_MASTER_UID/OS2_MASTER_PWD is required!');

        const client = new elasticsearch.Client({
            node: endpoint,
            ssl: {
                ca: process.env.elasticsearch_certificate,
                rejectUnauthorized: false,
            },
            auth: {
                username: masterUser,
                password: masterPass,
            },
        });
        return { client };
    }

    public constructor(options: Elastic6Option, fgac: OS2FGACManager) {
        super(options);
        if (!options.endpoint) throw new Error('.endpoint (URL) is required');
        if (!options.indexName) throw new Error('.indexName (string) is required');

        const { client } = OS2Service.instance(options.endpoint);
        this._options = { docType: '_doc', idName: '$id', version: '6.8', ...options };
        this._client = client;
        this.$fgac = fgac;
    }

    public get client(): elasticsearch.Client {
        return this._client;
    }

    public get options(): Elastic6Option {
        return this._options;
    }

    /**
     * describe `settings` and `mappings` of index.
     */
    public async describe() {
        const { indexName } = this.options;
        //* call create index..
        _log(NS, `- describe(${indexName})`);

        //* read settings.
        // const { client } = instance(endpoint);
        const client = this.client;
        const res = await client.indices.getSettings({ index: indexName }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('describe', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> settings[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        const settings = (res.body && res.body[indexName] && res.body[indexName].settings) || {};
        _log(NS, `> number_of_shards =`, settings.index && settings.index.number_of_shards); // 5
        _log(NS, `> number_of_replicas =`, settings.index && settings.index.number_of_replicas); // 1

        //* read mappings.
        const res2 = await client.indices.getMapping({ index: indexName });
        _log(NS, `> mappings[${indexName}] =`, $U.json(res2));
        const mappings: any = (res2.body && res2.body[indexName] && res2.body[indexName].mappings) || {};

        //* returns
        return { settings, mappings };
    }

    /**
     * create index by name
     * @param settings - creating settings
     */
    public async createIndex(settings?: any) {
        const { indexName, docType, idName, timeSeries, version } = this.options;
        settings = settings || Elastic6Service.prepareSettings({ docType, idName, timeSeries, version });
        if (!indexName) new Error('@index is required!');
        _log(NS, `- createIndex(${indexName})`);

        //* prepare payload
        const payload = {
            settings: {
                number_of_shards: 5,
                number_of_replicas: 1,
            },
            ...settings,
        };
        _log(NS, `> settings[${indexName}] = `, $U.json(payload));

        //* call create index..
        const client = this.client;
        const res = await client.indices.create({ index: indexName, body: payload }).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('create', e => {
                const msg = GETERR(e);
                if (msg.startsWith('400 RESOURCE ALREADY EXISTS')) throw new Error(`400 IN USE - index:${indexName}`);
                throw e;
            }),
        );
        // if (res) throw res;
        _log(NS, `> create[${indexName}] =`, $U.json({ ...res, meta: undefined }));

        //* build result.
        return {
            status: res.statusCode,
            index: indexName,
            acknowledged: res.body.shards_acknowledged,
        };
    }

    /**
     * delete index by name
     */
    public async deleteIndex(indexName: string): Promise<any> {
        _log(NS, `- deleteIndex(${indexName})`);
        const client = this.client;
        const res = await client.indices.delete({ index: indexName }).catch(
            $ERROR.handler('delete', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        return res;
    }

    /**
     * save single item
     *
     * @param id - id
     * @param item - item to save
     * @param type - document type (default: doc-type given at construction time)
     */
    public async saveItem(id: string, item: T): Promise<T> {
        const { indexName, idName } = this.options;
        _log(NS, `- saveItem(${id})`);
        // const { client } = instance(endpoint);

        // prepare item body and autocomplete fields
        const body: any = { ...item, [idName]: id };
        const body2 = this.popullateAutocompleteFields(body);

        const params: ElasticParams = { index: indexName, id, body: body2 };

        if (idName === '_id') delete params.body[idName]; //WARN! `_id` is reserved in ES6.
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        const res = await this.$fgac.doFgacCreate(params).catch(e => {
            const msg = GETERR(e);

            if (msg.startsWith('409 VERSION CONFLICT ENGINE') || msg.startsWith('409 Conflict')) {
                const param2: ElasticParams = { index: indexName, id, body: { ...body2 } };

                return this.$fgac.doFgacSave(param2);
            }
            throw e;
        });

        _log(NS, `> create[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _version: number = $U.N(res?._version, 0);
        const _id: string = res?._id;
        const res2: T = { ...body, _id, _version };

        return res2;
    }

    /**
     * bulk save multiple items using elasticsearch client
     *
     * @param items - array of items to save
     */
    public async bulkItems(items: T[], options?: { idName?: string }): Promise<BulkItemsResult> {
        const errScope = `bulkItems(${this.options.indexName})`;
        const { indexName } = this.options;
        const client = this.client;
        const idName = options?.idName ?? '_id';

        if (!Array.isArray(items) || items.length === 0)
            throw new Error(`@items (array) is required - length=${items?.length ?? 'null'} - ${errScope}`);

        const { failedItems, bulkBody } = items.reduce(
            (acc, item) => {
                const id = (item as any)[idName];
                if (!id) {
                    acc.failedItems.push({
                        reason: `@${idName} is invalid - ${errScope}`,
                        item,
                    });
                    return acc;
                }

                const body: any = { ...item, [idName]: id };
                const body2 = this.popullateAutocompleteFields(body);

                if (idName === '_id') delete body2['_id']; // Remove reserved _id field

                acc.bulkBody.push({ index: { _index: indexName, _id: id } });
                acc.bulkBody.push(body2);

                return acc;
            },
            {
                failedItems: [] as { reason: string; item: any }[],
                bulkBody: [] as any[],
            },
        );

        if (bulkBody.length === 0) return { success: 0, failed: failedItems.length, failedItems };

        const res = await this.$fgac.doFgacBulk({ index: indexName, body: bulkBody }).catch(
            $ERROR.handler('bulk', e => {
                _err(NS, `> bulkItems[${indexName}].err =`, e);
                throw e;
            }),
        );
        // const res = await client.bulk({ body: bulkBody }).catch(
        //     $ERROR.handler('bulk', e => {
        //         _err(NS, `> bulkItems[${indexName}].err =`, e);
        //         throw e;
        //     }),
        // );

        const itemsRes = res?.items ?? [];
        const failedFromBulk = itemsRes
            .filter((r: { index: { error?: any } }) => r.index?.error)
            .map((r: { index: { error?: any } }) => ({
                reason: r.index.error?.reason || 'unknown error',
                item: r.index,
            }));

        failedItems.push(...failedFromBulk);

        const failed = failedItems.length;
        const success = itemsRes.length - failed;

        _log(NS, `> bulkItems done: success=${success}, failed=${failed},`);

        return { success, failed, failedItems };
    }

    /**
     * push item for time-series data.
     *
     * @param item - item to push
     * @param type - document type (default: doc-type given at construction time)
     */
    public async pushItem(item: T, type?: string): Promise<T> {
        const { indexName, docType } = this.options;
        const id = (item.id as string) ?? '';

        type = `${type || docType}`;
        const body: any = { ...item };
        const body2 = this.popullateAutocompleteFields(body);

        _log(NS, `- pushItem(${id})`);
        const params = { index: indexName, type, body: body2, id };
        _log(NS, `> params[${id}] =`, $U.json(params));

        //NOTE - use npm `elasticsearch#13.2.0` for avoiding error.
        // const { client } = instance(endpoint);

        const res = await this.$fgac.doFgacSave(params).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('index', e => {
                _err(NS, `> index[${indexName}].err =`, e instanceof Error ? e : $U.json(e));
                throw e;
            }),
        );
        // {"_index":"test-v3","_type":"_doc","_id":"rTeHiW4BPb_liACrA9qa","_version":1,"result":"created","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":2,"_primary_term":1}
        _log(NS, `> create[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _id = res.body?._id;
        const _version = res.body?._version;
        const res2: T = { ...body, _id, _version };
        return res2;
    }

    /**
     * read item with projections
     *
     * @param id - item-id
     * @param views - projections
     */
    public async readItem(id: string, views?: string[] | object): Promise<T> {
        const { indexName, docType } = this.options;
        const type = `${docType}`;
        _log(NS, `- readItem(${id})`);

        const params: any = { index: indexName, type, id };
        if (views) {
            const fields: string[] = [];
            const keys: string[] = Array.isArray(views) ? views : Object.keys(views);
            keys.forEach((k: string) => {
                fields.push(k);
            });
            params._source = fields;
        }
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);

        const res = await this.$fgac.doFgacRead(params).catch(
            // $ERROR.throwAsJson,
            $ERROR.handler('read', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
        );
        _log(NS, `> read[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _id = res._id;
        const _version = res._version;
        const data: T = (res as any)?._source || res._source || {};
        // delete internal (analyzed) field
        delete data[Elastic6Service.DECOMPOSED_FIELD];
        delete data[Elastic6Service.QWERTY_FIELD];

        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * delete item with projections
     *
     * @param id - item-id
     */
    public async deleteItem(id: string): Promise<T> {
        const { indexName, docType } = this.options;
        const type = `${docType}`;
        _log(NS, `- deleteItem(${id})`);

        const params: ElasticParams = { index: indexName, type, id, body: {} };
        _log(NS, `> params[${id}] =`, $U.json(params));
        // const { client } = instance(endpoint);

        const res = await this.$fgac.doFgacDelete(params).catch(
            $ERROR.handler('delete', e => {
                const msg = GETERR(e);
                if (msg.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - id:${id}`);
                if (msg.startsWith('404 INDEX NOT FOUND')) throw new Error(`404 NOT FOUND - index:${indexName}`);
                throw e;
            }),
            // $ERROR.throwAsJson,
        );
        _log(NS, `> delete[${id}].res =`, $U.json({ ...res, meta: undefined }));

        const _id = res._id;
        const _version = res._version;
        const data: T = res._source || res._source || {};
        const res2: T = { ...data, _id, _version };
        return res2;
    }

    /**
     * update item (throw if not exist)
     * `update table set a=1, b=b+2 where id='a1'`
     * 0. no of `a1` -> 1,2 (created)
     * 1. a,b := 10,20 -> 11,22
     * 2. a,b := 10,null -> 11,2 (upsert)
     * 3. a,b := null,20 -> 1,22
     *
     * @param id - item-id
     * @param item - item to update
     * @param increments - item to increase
     * @param options - (optional) request option of client.
     */
    public async updateItem(
        id: string,
        item: T | null,
        increments?: Incrementable,
        options?: { maxRetries?: number },
    ): Promise<T> {
        const errScope = `updateItem(${id ?? ''})`;
        if (increments) throw new Error(`400 NOT SUPPORTED - invalid increments[${$U.json(increments)}] @${errScope}`);
        // return this.saveItem(id, item);
        //NOTE - 이후 saveItem() 호출을 위한 tricky solution.
        throw new Error(`404 NOT FOUND - ${errScope}`);
    }
    /**
     * run search and get the raw response.
     * @param body - Elasticsearch Query DSL that defines the search request (e.g., size, query, filters).
     * @param searchType - type of search (e.g., 'query_then_fetch', 'dfs_query_then_fetch').
     */
    public async searchRaw<T extends object = any>(body: SearchBody, searchType?: SearchType): Promise<T> {
        if (!body) throw new Error('@body (SearchBody) is required');
        const { indexName, docType } = this.options;
        _log(NS, `- search(${indexName}, ${searchType || ''})....`);
        _log(NS, `> body =`, $U.json(body));

        const tmp = docType ? docType : '';
        const params: ElasticSearchParams = { index: indexName, body, searchType };

        // check version to include 'type' in params
        _log(NS, `> params[${tmp}] =`, $U.json({ ...params, body: undefined }));
        const $res = await this.$fgac.doFgacSearch(params).catch(
            $ERROR.handler('search', e => {
                _err(NS, `> search[${indexName}].err =`, e);
                throw e;
            }),
        );

        //* return raw results.
        return $res;
    }

    /**
     * run search, and get the formatmted response.
     * @param body - Elasticsearch Query DSL that defines the search request (e.g., size, query, filters).
     * @param searchType - type of search (e.g., 'query_then_fetch', 'dfs_query_then_fetch').
     *
     */
    public async search(body: SearchBody, searchType?: SearchType): Promise<SearchResponse> {
        const size = $U.N(body.size, 0);
        const response = await this.searchRaw(body, searchType);
        // return w/ transformed id
        const hits = response.hits;
        if (typeof hits !== 'object') throw new Error(`.hits (object) is required - hits:${$U.json(hits)}`);
        //NOTE - ES6.8 w/ OS1.1
        return {
            total: typeof (hits.total as any)?.value === 'number' ? (hits.total as any)?.value : hits.total,
            list: hits.hits.map((hit: any) => ({
                ...(hit._source as any),
                _id: hit._id,
                _score: hit._score,
            })),
            last: hits.hits.length === size && size > 0 ? hits.hits[size - 1]?.sort : undefined,
            aggregations: response.aggregations,
        };
    }
}

/**
 * type: `OS2FGACManager`
 * - FGAC(Fine Grained Access Controll) Proxy for OS2
 */
export class OS2FGACManager {
    private _fgacProxy: ApiHttpProxy;
    public readonly options: Elastic6Option;

    public constructor(options: Elastic6Option) {
        this.options = options;
    }

    public hello = () => `FGACService`;

    public get proxy(): ApiHttpProxy {
        const errScope = `OS2FGACManager(${this.options?.indexName ?? ''})`;

        if (!this._fgacProxy) {
            const endpoint = this.options.endpoint;
            const host = endpoint.split('://')[1];
            const $config = $engine.module('config');

            const OS2_JWT_TOKEN = $U.env('OS2_JWT_TOKEN', '');
            const message = $U.env('OS2_MESSAGE', '');
            const signature = ($config as ConfigModule)?.config?.get('OS2_SIGNATURE') as string;

            const jwtToken = OS2_JWT_TOKEN !== '' ? OS2_JWT_TOKEN : `${message}.${signature}`; // if OS2_JWT_TOKEN is provided, use it

            const sigConfig = {
                accessKey: '**',
                secretKey: '**',
                region: 'ap-northeast-2',
                serviceName: 'es',
                host,
            };
            _log(NS, `> sigConfig =`, $U.json({ ...sigConfig, secretKey: `${sigConfig?.secretKey ? '***' : ''}` }));

            const headers: APIHeaders = {
                Authorization: `Bearer ${jwtToken}`,
                'Content-Type': 'application/json',
            };

            this._fgacProxy = createSigV4Proxy('fgac', endpoint, sigConfig, { headers });
        }

        return this._fgacProxy;
    }

    /** FGAC 기반 검색 */
    public async doFgacSearch<R = any>(params: ElasticSearchParams): Promise<R> {
        const index = params?.index ?? '';
        const body = onlyDefined(params?.body ?? undefined);
        const queryParams = params?.searchType ? { search_type: params?.searchType } : undefined;
        return this.proxy.doProxy('POST', index, `_search`, queryParams, body);
    }

    /** FGAC 기반 읽기: client.get() 대응 */
    public async doFgacRead<R = any>(params: ElasticParams): Promise<R> {
        const index = params?.index ?? '';
        const id = encodeURIComponent(params?.id ?? '');
        const body = onlyDefined(params?.body ?? undefined);
        return this.proxy.doProxy('GET', index, `_doc/${id}`, undefined, body);
    }

    /** FGAC 기반 저장: client.index() 대응 */
    public async doFgacSave<R = any>(params: ElasticParams): Promise<R> {
        const index = params?.index ?? '';
        const id = encodeURIComponent(params?.id ?? '');
        const body = onlyDefined(params?.body ?? undefined);
        return this.proxy.doProxy('PUT', index, `_doc/${id}`, undefined, body);
    }

    /** FGAC 기반 저장: client.index() 대응 */
    public async doFgacBulk(bulk: ElasticParams<any[]>): Promise<any[]> {
        const index = bulk?.index ?? '';
        const body = bulk?.body ?? [];
        const errScope = `doFgacBulk(${index})`;

        if (!Array.isArray(body)) throw new Error(`@body(array) is required - ${errScope}`);
        if (body.length === 0) return [];

        // 사전 포맷된 bulkBody를 JSONL 문자열로 변환
        const content = body.map(line => $U.json(line)).join('\n') + '\n';
        return this.proxy.doProxy('POST', index, `_bulk`, undefined, content);
    }

    /** FGAC 기반 업데이트: client.update() 대응 */
    public async doFgacUpdate<R = any>(params: ElasticParams): Promise<R> {
        const index = params?.index ?? '';
        const id = encodeURIComponent(params?.id ?? '');
        const body = onlyDefined(params?.body ?? undefined);
        return this.proxy.doProxy('POST', index, `_update/${id}`, undefined, body);
    }

    /** FGAC 기반 삭제: client.delete() 대응 */
    public async doFgacDelete<R = any>(params: ElasticParams): Promise<R> {
        const index = params?.index ?? '';
        const id = encodeURIComponent(params?.id ?? '');
        return this.proxy.doProxy('DELETE', index, `_doc/${id}`);
    }

    /** FGAC 기반 Create (Strict - 존재하면 실패): client.create() 대응 */
    public async doFgacCreate<R = any>(params: ElasticParams): Promise<R> {
        const index = params?.index ?? '';
        const id = encodeURIComponent(params?.id ?? '');
        const body = onlyDefined(params?.body ?? undefined);
        return this.proxy.doProxy('PUT', index, `_doc/${id}`, { op_type: 'create' }, body);
    }

    /** FGAC 기반 인덱스 삭제: client.indices.delete() 대응 */
    public async doFgacDeleteIndex<R = any>(index: string): Promise<R> {
        return this.proxy.doProxy('DELETE', index, '');
    }

    /**
     * FGAC 기반 인덱스 설명: client.indices.describe() 대응
     */
    public async doFgacDescribe<R = any>(index: string): Promise<{ settings: R; mappings: R }> {
        const errScope = `doFgacDescribe(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);

        // 1) 설정 조회
        const resSettings = await this.doFgacGetSettings(index);
        //    resSettings.body 안에 { [index]: { settings: { … } } } 형태로 들어옴

        // 2) 매핑 조회
        const resMappings = await this.doFgacGetMapping(index);
        //    resMappings.body 안에 { [index]: { mappings: { … } } } 형태로 들어옴

        return {
            settings: resSettings[index]?.settings || {},
            mappings: resMappings[index]?.mappings || {},
        };
    }

    /**
     * FGAC 기반 인덱스 Settings 변경: client.indices.putSettings() 대응
     */
    public async doFgacPutSettings<R = any>(index: string, settings: Record<string, any>): Promise<R> {
        const errScope = `doFgacPutSettings(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);
        return this.proxy.doProxy('PUT', index, `_settings`, undefined, { settings });
    }
    /**
     * FGAC 기반 인덱스 Settings 조회: client.indices.getSettings() 대응
     */
    public async doFgacGetSettings<R = any>(index: string): Promise<R> {
        const errScope = `doFgacGetSettings(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);

        return this.proxy.doProxy('GET', index, `_settings`);
    }
    /**
     * FGAC 기반 인덱스 Mapping 조회: client.indices.getMapping() 대응
     */
    public async doFgacGetMapping<R = any>(index: string): Promise<R> {
        const errScope = `doFgacGetMapping(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);

        return this.proxy.doProxy('GET', index, `_mapping`);
    }
    /**
     * FGAC 기반 인덱스 Mapping 변경: client.indices.putMapping() 대응
     */
    public async doFgacPutMapping<R = any>(index: string, mapping: Record<string, any>): Promise<R> {
        const errScope = `doFgacPutMapping(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);

        return this.proxy.doProxy('PUT', index, `_mapping`, undefined, mapping);
    }
    /**
     * FGAC 기반 인덱스 닫기: client.indices.close() 대응
     */
    public async doFgacCloseIndex<R = any>(index: string): Promise<R> {
        const errScope = `doFgacCloseIndex(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);

        return this.proxy.doProxy('POST', index, `_close`);
    }
    /**
     * FGAC 기반 인덱스 열기: client.indices.open() 대응
     */
    public async doFgacOpenIndex<R = any>(index: string): Promise<R> {
        const errScope = `doFgacOpenIndex(${index})`;
        if (!index) throw new Error(`.index(string) is required - ${errScope}`);

        return this.proxy.doProxy('POST', index, `_open`);
    }
}

/** extended option for `OS2Instance` */
export interface OS2Option extends Elastic6Option {
    /** (optional) role-name in FGAC */
    roleName?: string;
    /** (optional) user-name in FGAC */
    userName?: string;
}

/**
 * OS2 인스턴스
 * - describeIndex(), destroyIndex(), search() with elastic initialized by master-key
 */
export class OS2Instance extends Elastic6Instance {
    public readonly client?: elasticsearch.Client;
    public readonly elastic?: OS2Service;
    public readonly query?: Elastic6QueryService<any>;
    public readonly synchronizer?: Elastic6Synchronizer;
    public readonly fgac?: OS2FGACManager;

    public constructor({
        endpoint,
        indexName,
        idName,
        esVersion,
        esDocType,
        tableName,
        autocompleteFields,
        roleName,
        userName,
    }: {
        endpoint: string;
        indexName: string;
        idName?: string;
        esVersion: string;
        esDocType: string;
        tableName: string;
        autocompleteFields: string[];
        roleName?: string;
        userName?: string;
    }) {
        super({ endpoint, indexName, esVersion, esDocType, tableName, autocompleteFields });
        const options: OS2Option = onlyDefined<OS2Option>({
            endpoint,
            indexName,
            version: esVersion,
            autocompleteFields,
            roleName,
            userName,
            idName: idName === null ? undefined : idName ?? '$id',
        });
        if (endpoint && indexName) {
            if (esDocType) options.docType = esDocType;

            this.fgac = new OS2FGACManager(options);
            this.elastic = new OS2Service(options, this.fgac);
            this.client = this.elastic.client;
            this.query = new Elastic6QueryService<any>(this.elastic);
            this.synchronizer = new Elastic6Synchronizer(this.elastic, { tableName });
        }
    }

    public hello = () => `OS2Instance`;

    public get options(): OS2Option {
        if (!this.elastic) return null;
        return this.elastic.options;
    }

    public get $X2(): typeof $X2 {
        return $X2;
    }

    /**
     * display index settings and mappings
     */
    public async describeIndex(): Promise<any> {
        return this.elastic && (await this.elastic.describe());
    }

    /**
     * create Elasticsearch index with ES7+ mapping structure
     */
    public async createIndex(): Promise<any> {
        if (!this.elastic) return null;

        const { docType, idName, version = '2.10' } = this.options;
        const settings = Elastic6Service.prepareSettings({ docType, idName, version });

        // _doc 제거 및 properties 병합
        if (settings.mappings?._doc) {
            const { dynamic_templates, properties: docProperties } = settings.mappings._doc;

            settings.mappings = {
                ...settings.mappings,
                ...(dynamic_templates ? { dynamic_templates } : {}),
                properties: {
                    ...(docProperties || {}),
                    ...(settings.mappings.properties || {}),
                },
            };

            delete settings.mappings._doc;
        }

        return this.elastic.createIndex(settings);
    }

    /**
     * search
     */
    public async search<T>(
        body: SearchBody,
        params?: {
            indexName?: string;
            searchType?: 'query_then_fetch' | 'dfs_query_then_fetch';
        },
    ): Promise<SearchResult<T>> {
        if (!this.elastic) throw new Error(`Could not read Elasticsearch endpoint or index setting.`);
        const searchType = params?.searchType;
        const elastic = this.elastic;
        return elastic.search(body, searchType);
    }

    /** synchronize dynamo contents to os2  */
    public async synchronizeContents(options?: { stopOnError?: boolean } & PaginateParam): Promise<{
        index: string;
        total: number;
        failed: (CoreModel<any> & GeneralItem)[];
        list?: (CoreModel<any> & GeneralItem)[];
    }> {
        type Model = CoreModel<any> & GeneralItem;
        type _KEY_ = { id?: string; _id?: string; stereo?: string };
        const stopOnError = options?.stopOnError ?? false;
        const filter: DynamoScanFilter = null;
        // STEP 1. get source items
        const dynamoOptions: DynamoOption = {
            tableName: $U.env('MY_DYNAMO_TABLE', ''),
            idName: '_id',
        };

        const $scan = new DynamoScanService<Model>(dynamoOptions);
        const { limit } = parsePaginateParam(options);

        // STEP 2. get role model
        const indexName = this.options.indexName;

        //* runs in parallel
        const _parrallel = async <T extends _KEY_>(list: T[], $res?: DynamoScanResult<Model>) => {
            const items = await my_parrallel(list, async (N): Promise<Model> => {
                const id = N._id ?? N.id;
                try {
                    const stereo = $T.S2(N?.stereo);
                    if (!stereo || !stereo?.startsWith('#')) {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { _id, ...rest } = N;
                        await this.fgac.doFgacSave({ index: indexName, id, body: rest });
                        return { id, error: null };
                    }
                    return { id };
                } catch (error) {
                    if (stopOnError && $res) {
                        _err(NS, `> error[${id}] =`, error);
                        $res.last = null;
                    }
                    return { id, error: GETERR(error) };
                }
            });
            return items;
        };

        // runs with bulk
        const _bulks = async <T extends _KEY_>(list: T[], $res?: DynamoScanResult<Model>) => {
            const body = list
                .map(N => {
                    const _id = N._id ?? N.id;
                    const stereo = $T.S2(N?.stereo);
                    if (!stereo || !stereo?.startsWith('#')) {
                        return { ...N, _id };
                    }
                    return null;
                })
                .filter(N => !!N);
            // not supported autocomplete options
            const items = await this.fgac.doFgacBulk({ index: indexName, body });
            return items?.map((N: any) => N?.index ?? N?.create);
        };

        // STEP 3. migrate items using doFgacSave
        let last: Model = null;
        const results: Model[] = [];

        const _preprocessItems = <T extends Record<string, any>>(items: T[]): Record<string, any>[] => {
            return items.filter(item => {
                const stereo = $T.S2(item?.stereo);
                return !(stereo && stereo.startsWith('#'));
            });
        };

        while (true) {
            if (last) _inf(NS, `> last =`, $U.json(last));
            const $res = await $scan.scan(limit, last, filter);
            const list = _preprocessItems($res?.list) ?? [];

            // const items = await _parrallel(list, $res);
            const res = await this.bulkItems(list, { idName: '_id' });
            const failedItems = res?.failedItems ?? [];
            _log(NS, `>> len =`, failedItems?.length ?? '-');

            // 실패 ID + 메시지를 Map으로 생성
            const failedMap = failedItems.reduce((map, f) => {
                const id = f.item?._id || f.item?.id;
                const reason = f.reason || f.item?.error?.reason || 'Unknown error';
                if (id) {
                    map.set(id, reason);
                }
                return map;
            }, new Map<string, string>());

            // error 정보가 있는 경우 item에 추가
            const itemsWithError = list.map(item => {
                const id = item._id ?? item.id;
                const error = id && failedMap.has(id) ? failedMap.get(id) : undefined;
                return error ? { ...item, error } : item;
            });

            results.push(...itemsWithError);

            if (!$res?.last?._id) break;
            last = $res?.last;
        }
        const total = results.length;
        const failed = results.filter(N => !!N.error);
        return { index: indexName, total, failed };
    }

    /** bulk items with auto-complete options */
    public async bulkItems(items: any[], options?: { idName?: string }): Promise<BulkItemsResult> {
        return this.elastic.bulkItems(items, options);
    }
}

export function sourceToItem<T>(_source: T, idName = '$id'): T {
    const item: any = { ..._source };
    if (idName in item) {
        item._id = item[idName];
        delete item[idName];
    }
    return item;
}

/**
 * internal tools
 */
const $X2 = {
    /** describe endpoint-url into component */
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
        const isProxy = host.endsWith('.amazonaws.com') && hosts[hosts.length - 4] == 'execute-api';
        const region = isProxy ? hosts[hosts.length - 3] : undefined;

        return {
            protocol,
            host,
            port,
            region,
            isTunnel,
            isProxy,
        };
    },
    /** load local credentials (for dev) */
    loadCredentials: async (profile?: string): Promise<CrendentialForAWS> => {
        const errScope = `loadCredentials(${profile ?? ''})`;
        const _profile = (name: string) => {
            if (typeof name === 'string') return name ? name : null;
            const NAME = $U.env('NAME', '');
            return NAME && NAME !== 'none' ? NAME : null;
        };
        profile = _profile(profile);
        const credentials = await asyncCredentials(profile);
        if (!credentials?.accessKeyId) throw new Error(`@profile[${profile ?? ''}] is invalid - ${errScope}`);
        return credentials;
    },
};

/**
 * factory of `OS2Instance`
 */
export const _OS2 = (options?: OS2Option): OS2Instance => {
    return new (class extends OS2Instance {
        public constructor() {
            // 0. load from env configuration.
            const endpoint = options?.endpoint ?? $U.env('OS2_ENDPOINT', '');
            const indexName = options?.indexName ?? $U.env('OS2_INDEX', 'test-x1');
            const esVersion = options?.version ?? $U.env('OS2_VERSION', '2.10');
            const esDocType = options?.docType ?? $U.env('OS2_DOCTYPE', '');
            const tableName = $U.env('MY_DYNAMO_TABLE', '');
            const autocompleteFields = options?.autocompleteFields ?? $T.SS($U.env('OS2_AUTOCOMPLETE_FIELDS', ''));

            const roleName = options?.roleName;
            const userName = options?.userName;

            // 1. initialize instance.
            super({
                endpoint,
                indexName,
                esVersion,
                esDocType,
                tableName,
                autocompleteFields,
                roleName,
                userName,
            });
        }

        /**
         * expose the internal helpers. (ONLY for debugging)
         */
        get $X2() {
            return $X2;
        }
    })();
};

/** dynamically load the OS2 instance if `OS2_ENDPOINT` is set */
const hasOS2 = $U.env('OS2_ENDPOINT', '').startsWith('https://');
export const $OS2 = _OS2();
export const $ES6 = hasOS2 ? _OS2() : _ES6();
