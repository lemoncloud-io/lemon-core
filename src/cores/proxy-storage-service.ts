/**
 * `proxy-storage-service.js`
 * - common service for `accounts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-27 initial service skeleton.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine/';
import { StorageService, StorageModel } from './storage-service';
import { DummyStorageService, DynamoStorageService } from './storage-service';
import { NUL404 } from '../common/test-helper';
import { Elastic6SimpleQueriable } from './core-types';
import { GeneralAPIController } from '../controllers/general-api-controller';
const NS = $U.NS('PSTR', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * class: `CoreKey`
 * - to represent internal partition-key and model-id.
 */
export interface CoreKey<ModelType extends string> {
    /**
     * defualt internal partition-key
     */
    _id?: string;
    /**
     * namespace
     */
    ns?: string;
    /**
     * model-id
     */
    id: string;
    /**
     * model-type
     */
    type: ModelType;
}

/**
 * class: `CoreKeyMakeable`
 * - make internal key by type + id.
 */
export interface CoreKeyMakeable<ModelType extends string> {
    /**
     * get key object w/ internal partition-key (default as _id).
     *
     * @param type  type of model
     * @param id    id of model in type
     */
    asKey$(type: ModelType, id: string): CoreKey<ModelType>;

    /**
     * get key-string to use for query. (USED FOR CUSTOM ID NAME);
     *
     * @param type  type of model
     * @param id    id of model in type
     */
    asKey?(type: ModelType, id: string): string;
}

/**
 * class: `InternalModel`
 * - common internal properties. (ONLY FOR INTERNAL PROCESSING)
 */
export interface InternalModel<T> {
    /**
     * internal unique partition-key (valid if using default idName )
     */
    _id?: string;
}

/**
 * class: `CoreModel`
 * - general model out of base Model to support the common usage
 */
export interface CoreModel<ModelType extends string> extends StorageModel, InternalModel<CoreModel<ModelType>> {
    /**
     * namespace
     */
    ns?: string;
    /**
     * type of model
     */
    type?: ModelType;
    /**
     * stereo: stereo-type in common type.
     */
    stereo?: string;
    /**
     * site-id
     */
    sid?: string;
    /**
     * user-id
     */
    uid?: string;
    /**
     *  group-id
     */
    gid?: string;
    /**
     * lock count to secure sync
     */
    lock?: number;
    /**
     * next sequence number (use `nextSeq()`)
     */
    next?: number;
    /**
     * meta the json stringified string.
     */
    meta?: string | any;
    /**
     * created timestamp
     */
    createdAt?: number;
    /**
     * updated timestamp
     */
    updatedAt?: number;
    /**
     * deleted timestamp
     */
    deletedAt?: number;
    /**
     * error message will be set if error occurred
     */
    error?: string;
}

//NOTE! - BE WARE TO USE `ts-transformer-keys` DUE TO MISSING `ttypescript`
// export const CORE_FIELDS: string[] = keys<CoreModel>().filter(_ => !_.startsWith('_'));
// _inf(NS, '! CORE_FIELDS =', CORE_FIELDS.join(', ')); // for debugging.
export const CORE_FIELDS: string[] = 'ns,type,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt'.split(',');

/**
 * type: ModelFilter
 *
 * @param model     the new model to update
 * @param origin    the old model (or 2nd model)
 * @return          the updated model.
 */
export type CoreModelFilter<T> = (model: T, origin?: T) => T;

/**
 * class: `CoreModelFilterable`
 * - support filters.
 */
export interface CoreModelFilterable<T> {
    afterRead: CoreModelFilter<T>;
    beforeSave: CoreModelFilter<T>;
    afterSave: CoreModelFilter<T>;
    beforeUpdate: CoreModelFilter<T>;
    afterUpdate: CoreModelFilter<T>;
}

/**
 * class: `StorageMakeable`
 * - makeable of `TypedStorageService`
 */
export interface StorageMakeable<T extends CoreModel<ModelType>, ModelType extends string> {
    /**
     * create storage-service w/ fields list.
     * @param type      type of model
     * @param fields    list of field (properties)
     * @param filter    filter of model.
     */
    makeStorageService(
        type: ModelType,
        fields: string[],
        filter: CoreModelFilterable<T>,
    ): TypedStorageService<T, ModelType>;
}

/**
 * class: `GeneralKeyMaker`
 * - use ':' as delimiter to join [ns, type, id]
 */
export class GeneralKeyMaker<ModelType extends string> implements CoreKeyMakeable<ModelType> {
    public readonly NS: string;
    public readonly DELIMITER: string;
    public constructor(ns: string = '', delimiter: string = ':') {
        this.NS = ns;
        this.DELIMITER = delimiter;
    }
    public asKey$(type: ModelType, id: string) {
        if (!id) throw new Error('@id (model-id) is required!');
        const ns = `${this.NS || ''}`;
        const _id = [ns, `${type || ''}`, id].map(_ => _.replace(/[:]/gi, '-')).join(this.DELIMITER);
        const res = { ns, id, type, _id };
        return res;
    }
}

/**
 * class: `GeneralModelFilter`
 * - general model-filter with differential update.
 * - to customize, override this class.
 */
// eslint-disable-next-line prettier/prettier
export class GeneralModelFilter<T extends CoreModel<ModelType>, ModelType extends string> implements CoreModelFilterable<T> {
    public readonly FIELDS: string[];
    /**
     * default constructor
     */
    public constructor(fields: string[]) {
        this.FIELDS = fields;
    }

    /**
     * parse `.meta` to json
     * @param model     the current model
     * @param origin    the origin model
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public afterRead(model: T, origin?: T): T {
        // _log(NS, `filter.afterRead(${model._id || ''})....`);
        if (!model.meta) return model;
        const meta = model.meta;
        model.meta = meta && typeof meta == 'string' && meta.startsWith('{') ? JSON.parse(meta) : meta;
        return model;
    }

    /**
     * filter for before saving.
     * - make sure data conversion
     * - move the unknown fields to `.meta`.
     *
     * @param model     the current model
     * @param origin    the origin model
     */
    public beforeSave(model: T, origin?: T): T {
        // _log(NS, `filter.beforeSave(${model._id})....`);
        origin = origin || ({} as any);
        const FIELDS: string[] = this.FIELDS && this.FIELDS.length ? this.FIELDS : null;

        //! call service.onBeforeSave().
        model = this.onBeforeSave(model, origin);

        //TODO - accept only primitive types of field @191228.

        //NOTE! - should not update the core field in save()
        delete model.lock;
        delete model.next;

        //! load the meta data...
        const $meta = (() => {
            if (model.meta !== undefined && !model.meta) return {};
            const meta = model.meta || origin.meta || {}; // 만일, 파라미터에 meta 가 있다면, 클라이언트에서 직접 처리함.
            return meta && typeof meta == 'string' ? JSON.parse(meta) : meta;
        })();

        //! move all fields to meta which is not defined in FIELDS.
        model = Object.keys(model).reduce((N: any, key) => {
            if (key.startsWith('_') || key.startsWith('$')) return N;
            if (key == 'createdAt' || key == 'updatedAt' || key == 'deletedAt') return N;
            if (/^[A-Z][A-Za-z0-9]*$/.test(key) && !/^[A-Z_]+$/.test(key)) return N; // ABC_DE 는 상수이며 OK, 다만, AbcDe 는 내부 오브젝트 이므로 무시!!!
            if (key == 'meta') return N; // meta itself.
            if (FIELDS && FIELDS.indexOf(key) < 0 && FIELDS.indexOf('*' + key) < 0) {
                $meta[key] = (model as any)[key];
            } else {
                N[key] = (model as any)[key];
            }
            return N;
        }, {});
        model.meta = Object.keys($meta).length ? $U.json($meta) : '';

        //! handle for meta.
        if (model.meta === '') model.meta = null;
        else if (typeof origin.meta == 'string' && model.meta == origin.meta) delete model.meta;
        else if (typeof origin.meta == 'object' && model.meta == $U.json(origin.meta)) delete model.meta;
        else if (!origin.meta && !model.meta) model.meta = origin.meta;

        //! filter out only the updated fields.
        const res = Object.keys(model).reduce((N: any, key) => {
            if (key.startsWith('_') || key.startsWith('$')) return N; // ignore.
            const org = (origin as any)[key];
            const val = N[key];
            if (!org && val) return N;
            else if (org && !val) return N;
            else if (org && typeof org === 'object') {
                const org2 = $U.json(org);
                const val2 = typeof val === 'object' ? $U.json(val) : val;
                if (org2 == val2) {
                    delete N[key];
                }
            } else if ((val === '' || val === null) && (org === null || org === undefined)) {
                //NOTE! - dynamo saves null for '' string.
                delete N[key];
            } else if (val === org) {
                delete N[key];
            }
            return N;
        }, model);

        //! if nothing to update, then returns null.
        const keys = Object.keys(model).filter(_ => !_.startsWith('_') && !_.startsWith('$'));
        if (keys.length <= 0) return null;

        //! returns the filtered node.
        return res as T;
    }

    /**
     * called after saving the model.
     * - parse `.meta` back to json object.
     *
     * @param model     the saved model
     * @param origin    the origin model.
     */
    public afterSave(model: T, origin?: T) {
        return this.afterRead(model, origin);
    }

    /**
     * called before updating the model.
     * @param model         the updated model
     * @param incrementals  (optional) incremental fields.
     */
    public beforeUpdate(model: T, incrementals?: T) {
        return model;
    }

    /**
     * called after updating the model.
     * @param model     the updated model
     */
    public afterUpdate(model: T) {
        return this.afterRead(model, null);
    }

    /**
     * override this `onBeforeSave()` in sub-class.
     * @param model     the current model
     * @param origin    (optional) the origin model
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onBeforeSave(model: T, origin?: T): T {
        //TODO - override this function.
        //! conversion data-type.
        // if (model.count !== undefined) model.count = $U.N(model.count, 0);
        return model;
    }
}

/**
 * class: `ProxyStorageService`
 * - support `nextSeq()`, `doLock()`, `doRelease()`
 * - proxed storage-service to wrap the parent storage-service w/ more features.
 * - table is supposed to have internal-key as `_id` string.
 *
 * **Usage**
 * ```js
 * type MyType = '' | 'test';
 * interface MyModel extends CoreModel<MyType>{
 *  name?: string;
 * }
 * const storage = new ProxyStorageService<MyModel, MyType>(this, 'TestTable', ['id','name']);
 * const $test = storage.makeTypedStorageService('test');
 * ```
 */
// eslint-disable-next-line prettier/prettier
export class ProxyStorageService<T extends CoreModel<ModelType>, ModelType extends string> implements StorageService<T> {
    public static readonly AUTO_SEQUENCE = 1000000;
    public static readonly TYPE_SEQUENCE = 'sequence';

    public readonly idName: string;
    public readonly service: CoreKeyMakeable<ModelType>;
    public readonly storage: StorageService<T>;
    public readonly filters: CoreModelFilterable<T>;

    /**
     * create proxed storage-service.
     *
     * @param service   service to support `CoreKeyMakeable`
     * @param storage   table-name or the parent storage-service
     * @param fields    list of fields.
     * @param filters   filters of `CoreModelFilterable`
     * @param idName    (optional) internal partition-key (default as '_id')
     */
    public constructor(
        service: CoreKeyMakeable<ModelType>,
        storage: StorageService<T> | string,
        fields: string[],
        filters?: CoreModelFilterable<T>,
        idName?: string,
    ) {
        this.idName = idName === undefined ? '_id' : `${idName || ''}`;
        this.service = service;
        this.storage =
            typeof storage == 'string' ? ProxyStorageService.makeStorageService(storage, fields, idName) : storage;
        this.filters = filters || new GeneralModelFilter<T, ModelType>(fields);
    }

    /**
     * factory function to create this `proxy-storage-service`
     * @param service   key-makeable
     * @param table     table-name
     * @param fields    list of fields.
     * @param filters   model filter.
     * @param idName    (optional) internal partition-key (default as '_id')
     */
    public static create<T extends CoreModel<ModelType>, ModelType extends string>(
        service: CoreKeyMakeable<ModelType>,
        table: string,
        fields?: string[],
        filters?: CoreModelFilterable<T>,
        idName?: string,
    ) {
        const storage = ProxyStorageService.makeStorageService(table, fields, idName);
        const res: ProxyStorageService<T, ModelType> = new ProxyStorageService<T, ModelType>(
            service,
            storage as any,
            fields,
            filters,
            idName,
        );
        return res;
    }

    /**
     * say hello()
     */
    public hello = () => `proxy-storage-service:${this.storage.hello()}`;

    /**
     * read by _id
     */
    public read = (_id: string): Promise<T> => this.storage.read(_id) as Promise<T>;

    /**
     * read or create by _id
     */
    public readOrCreate = (_id: string, model: T): Promise<T> => this.storage.readOrCreate(_id, model) as Promise<T>;

    /**
     * save by _id
     */
    public save = (_id: string, model: T): Promise<T> => this.storage.save(_id, model) as Promise<T>;

    /**
     * update by _id
     */
    public update = (_id: string, model: T, incrementals?: T): Promise<T> =>
        this.storage.update(_id, model, incrementals) as Promise<T>;

    /**
     * increment by _id
     */
    public increment = (_id: string, model: T, $update?: T): Promise<T> =>
        this.storage.increment(_id, model, $update) as Promise<T>;

    /**
     * delete by _id
     */
    public delete = (_id: string): Promise<T> => this.storage.delete(_id) as Promise<T>;

    /**
     * get key-id by type+id
     */
    public asKey = (type: ModelType, id: string | number): string => {
        if (typeof this.service.asKey == 'function') {
            return this.service.asKey(type, `${id}`);
        }
        const $key = this.service.asKey$(type, `${id}`);
        return ($key as any)[this.idName];
    };

    /**
     * get next auto-sequence number.
     *
     * @param type      type of seqeunce.
     * @param initNext  initial next value if not exist.
     */
    public async nextSeq(type: ModelType, initNext?: number): Promise<number> {
        _log(NS, `nextSeq(${type})..`);
        const { createdAt, updatedAt } = this.asTime();
        const _id = this.asKey(ProxyStorageService.TYPE_SEQUENCE as ModelType, `${type}`);
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        let res = await this.storage.increment(_id, { next: 1 } as T, { updatedAt } as T); // it will create new row if not exists. (like upset)
        if (res.next == 1) {
            const $key = this.service.asKey$(ProxyStorageService.TYPE_SEQUENCE as ModelType, `${type}`);
            initNext = initNext === undefined ? ProxyStorageService.AUTO_SEQUENCE : initNext;
            // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
            const $upd: T = { next: initNext } as T;
            // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
            const $inc: T = { ...$key, createdAt, updatedAt } as T;
            res = await this.storage.increment(_id, $upd, $inc); //! increment w/ update-set
        }
        return res.next;
    }

    /**
     * get uuid by type.
     * @param type
     */
    public async nextUuid(type?: ModelType): Promise<string> {
        _log(NS, `nextUuid(${type})..`);
        return $U.uuid();
    }

    /**
     * timer to generate the current-time (msec)
     */
    private $timer: () => number = null;
    public setTimer = (timer: () => number) => {
        const previous = this.$timer;
        this.$timer = timer;
        return previous;
    };
    public getTime = (): number => {
        if (this.$timer) return this.$timer();
        return new Date().getTime();
    };

    /**
     * get time-stamp as now.
     */
    public asTime(currentTime?: number) {
        currentTime = currentTime || this.getTime();
        const createdAt = currentTime;
        const updatedAt = currentTime;
        const deletedAt = currentTime;
        return { createdAt, updatedAt, deletedAt };
    }

    /**
     * delete sequence-key.
     * @param type      type of seqeunce.
     */
    public async clearSeq(type: ModelType): Promise<void> {
        _log(NS, `nextSeq(${type})..`);
        const _id = this.asKey(ProxyStorageService.TYPE_SEQUENCE as ModelType, `${type}`);
        await this.storage.delete(_id);
    }

    /**
     * read model by key + id with optional auto creation.
     *
     * @param type      model-type
     * @param id        node-id
     * @param $create   (optional) initial model if not exist. (or throw 404 error)
     */
    public async doRead(type: ModelType, id: string, $create?: T): Promise<T> {
        const $key = this.service.asKey$(type, id);
        const _id = this.asKey(type, id);
        const model = await this.storage.read(_id).catch((e: Error) => {
            if (`${e.message}`.startsWith('404 NOT FOUND') && $create) {
                const { createdAt, updatedAt } = this.asTime();
                return this.storage.update(_id, { ...$create, ...$key, createdAt, updatedAt, deletedAt: 0 });
            }
            throw e;
        });
        //! make sure it has `_id`
        (model as any)[this.idName] = _id;
        const res = this.filters.afterRead(model);
        return res;
    }

    /**
     * delete model by id.
     *
     * @param type      model-type
     * @param id        node-id
     * @param destroy   flag to destroy (real delete)
     */
    public async doDelete(type: ModelType, id: string, destroy: boolean = true) {
        const _id = this.asKey(type, id);
        if (destroy === undefined || destroy === true) return this.storage.delete(_id);
        const { createdAt, updatedAt, deletedAt } = this.asTime();
        const $up: CoreModel<ModelType> = { updatedAt, deletedAt };
        const $org = await this.read(_id); //! it will make 404 if not found.
        if (!$org.createdAt) $up.createdAt = createdAt;
        return this.update(_id, $up as T);
    }

    /**
     * update model (or it will create automatically)
     *
     * @param type      model-type
     * @param id        node-id
     * @param node      model
     * @param incrementals (optional) fields to increment
     */
    public async doUpdate(type: ModelType, id: string, node: T, incrementals?: T) {
        const $inc: T = { ...incrementals }; //! make copy.
        const _id = this.asKey(type, id);
        // const $key = this.service.asKey$(type, id);
        const node2 = this.filters.beforeUpdate({ ...node, [this.idName]: _id }, $inc);
        delete node2['_id'];
        const { updatedAt } = this.asTime();
        const model = await this.update(_id, { ...node2, updatedAt }, $inc);
        //! make sure it has `_id`
        (model as any)[this.idName] = _id;
        return this.filters.afterUpdate(model);
    }

    /**
     * update model (or it will create automatically)
     *
     * @param type      model-type
     * @param id        node-id
     */
    public async doIncrement(type: ModelType, id: string, $inc: T, $up: T) {
        const _id = this.asKey(type, id);
        const { updatedAt } = this.asTime();
        const model = await this.increment(_id, { ...$inc }, { ...$up, updatedAt });
        //! make sure it has `_id`
        (model as any)[this.idName] = _id;
        return this.filters.afterUpdate(model);
    }

    /**
     * save model by checking origin node.
     * - use `doSave()` rather than `doUpdate()` for both create & update.
     * - if `$create` is null, throw 404 error it if not found.
     *
     * @param type      model-type
     * @param id        node-id
     * @param node      node to save (or update)
     * @param $create   (optional) initial creation model if not found.
     */
    public async doSave(type: ModelType, id: string, node: T, $create?: T) {
        //! read origin model w/o error.
        const $org: T = (await this.doRead(type, id, null).catch(e => {
            if (`${e.message}`.startsWith('404 NOT FOUND')) return null; // mark null to create later.
            throw e;
        })) as T;

        //! if `$create` is undefined, create it with default $key.
        const _id = this.asKey(type, id);
        const model: T = { ...node }; // copy from param.
        (model as any)[this.idName] = _id; //! make sure the internal id

        //! apply filter.
        const $ups = this.filters.beforeSave(model, $org); //! `$org` should be null if create.
        _log(NS, `> ${type}[${id}].update =`, $U.json($ups));

        //! if null, then nothing to update.
        if (!$ups) {
            const res: T = { [this.idName]: _id } as any;
            return res;
        }

        //! determine of create or update.
        const { createdAt, updatedAt } = this.asTime();
        if ($org) {
            const $save = { ...$ups, updatedAt };
            const res = await this.doUpdate(type, id, $save);
            return this.filters.afterSave(res, $org); //! `$org` should be valid if update.
        } else {
            const $key: T = this.service.asKey$(type, id) as T;
            const $save = { ...$ups, ...$create, ...$key, createdAt, updatedAt: createdAt, deletedAt: 0 };
            const res = await this.storage.save(_id, $save);
            return this.filters.afterSave(res, null); //! `$org` should be null if create.
        }
    }

    /**
     * lock data-entry by type+id w/ limited time tick
     * - WARN! must release lock by `doRelease()`
     *
     * `total-waited-time = tick * interval (msec)`
     *
     * @param type      model-type
     * @param id        model-id
     * @param tick      tick count to wait.
     * @param interval  timeout interval per each tick (in msec, default 1000 = 1sec)
     */
    public async doLock(type: ModelType, id: string, tick?: number, interval?: number): Promise<boolean> {
        tick = $U.N(tick, 30);
        interval = $U.N(interval, 1000);
        if (typeof tick != 'number' || tick < 0) throw new Error(`@tick (${tick}) is not valid!`);
        if (typeof interval != 'number' || interval < 1) throw new Error(`@interval (${interval}) is not valid!`);
        const _id = this.asKey(type, id);
        //! WARN! DO NOT MAKE ANY MODEL CREATION IN HERE.
        // const $org = await this.storage.readOrCreate(_id, { lock: 0, ...$key } as any);
        // _log(NS, `> $org[${type}/${id}].lock =`, $org.lock);
        const thiz = this;
        //! wait some time.
        const wait = async (timeout: number) =>
            new Promise(resolve => {
                setTimeout(() => {
                    resolve(timeout);
                }, timeout);
            });
        const incLock = async (_id: string, lock: number): Promise<number> => {
            const $up = {};
            const $in = { lock };
            return thiz.storage.update(_id, $up as T, $in as T).then($t2 => {
                return $U.N($t2.lock, 1);
            });
        };
        //! recursive to wait lock()
        const waitLock = async (_id: string, ttl: number, int: number): Promise<boolean> => {
            //! try to check the current value.....
            const lock = await incLock(_id, 0).then(n => {
                if (n > 1) return n;
                //! then, try to increment the lock
                return incLock(_id, ttl > 0 ? 1 : 0);
            });
            _log(NS, `! waitLock(${_id}, ${ttl}). lock =`, lock);
            if (lock == 1 || lock == 0) {
                return true;
            } else if (ttl > 0 && lock > 1) {
                return wait(int).then(() => waitLock(_id, ttl - 1, int));
            } else {
                throw new Error(`400 TIMEOUT - model[${_id}].lock = ${lock}`);
            }
        };
        return waitLock(_id, tick, interval);
    }

    /**
     * release lock by resetting lock = 0.
     *
     * @param type  model-type
     * @param id    model-id
     */
    public async doRelease(type: ModelType, id: string): Promise<boolean> {
        _log(NS, `doRelease(${type}, ${id})... `);
        const _id = this.asKey(type, id);
        const $up = { lock: 0 };
        const node = await this.storage.update(_id, $up as T).catch(() => ({ lock: 0 }));
        const lock = $U.N(node.lock, 1);
        return lock === 0 ? true : false;
    }

    /**
     * create storage-service w/ fields list.
     * - idName should be `_id`
     *
     * @param table     table-name or dummy file name (ex: `dummy-data.yml`).
     * @param fields    required for dynamo table.
     * @param idName    internal partition-key name (default '_id')
     */
    public static makeStorageService<T>(table: string, fields?: string[], idName?: string): StorageService<T> {
        if (!table) throw new Error(`@table (table-name) is required!`);
        idName = idName === undefined ? '_id' : `${idName || ''}`;
        //! clear the duplicated string
        const clearDuplicated = (arr: string[]) =>
            arr.sort().reduce((L, val) => {
                if (val && L.indexOf(val) < 0) L.push(val);
                return L;
            }, []);

        //! make internal storage-service by table
        if (table.endsWith('.yml')) {
            return new DummyStorageService<T>(table, table.split('.')[0], idName);
        } else {
            if (!fields) throw new Error(`@fields (list of field) is required!`);
            fields = clearDuplicated(CORE_FIELDS.concat(fields));
            return new DynamoStorageService<T>(table, fields, idName);
        }
    }

    /**
     * create proxy-storage-service by type
     * @param type      model-type
     */
    public makeTypedStorageService<U extends T>(type: ModelType): TypedStorageService<U, ModelType> {
        if (!type) throw new Error(`@type (model-type) is required!`);
        // if (!fields) throw new Error(`@fields[${type}] (list of field) is required!`);
        const res = new TypedStorageService<U, ModelType>(this as any, type);
        return res;
    }
}

/**
 * class: `TypedStorageService`
 * - wrap id with type + id.
 */
// eslint-disable-next-line prettier/prettier
export class TypedStorageService<T extends CoreModel<ModelType>, ModelType extends string> implements StorageService<T> {
    public readonly type: ModelType;
    public readonly storage: ProxyStorageService<T, ModelType>;
    public constructor(service: ProxyStorageService<T, ModelType>, type: ModelType) {
        this.storage = service;
        this.type = type;
    }

    /**
     * show self service name
     */
    public hello = () => `typed-storage-service:${this.type}/${this.storage.hello()}`;

    /**
     * get next auto-sequence id in number like `1000003`.
     */
    public nextId = (): Promise<number> => this.storage.nextSeq(this.type);

    /**
     * get uuid like `d01764cd-9ef2-41e2-9e88-68e79555c979`
     */
    public nextUuid = (): Promise<string> => this.storage.nextUuid(this.type);

    /**
     * read model by key + id with optional auto creation.
     * - throws '404 NOT FOUND' if not found.
     *
     * @param id        node-id
     */
    public read = (id: string | number): Promise<T> => this.storage.doRead(this.type, `${id || ''}`);

    /**
     * read model by key + id with optional auto creation.
     *
     * @param id        node-id
     * @param model     initial model if not exist. (or throw 404 error)
     */
    public readOrCreate = (id: string | number, model: T): Promise<T> =>
        this.storage.doRead(this.type, `${id || ''}`, model);

    /**
     * update model (or it will create automatically)
     *
     * @param id        node-id
     * @param model     model to update
     * @param incrementals (optional) fields to increment.
     */
    public update = (id: string | number, model: T, incrementals?: T): Promise<T> =>
        this.storage.doUpdate(this.type, `${id || ''}`, model, incrementals) as Promise<T>;

    /**
     * insert model w/ auto generated id
     *
     * @param model     model to insert
     */
    public insert = async (node: T): Promise<T> => {
        return this.nextId().then(_ => {
            const id = `${_}`;
            _log(NS, `> next-id[${this.type}] =`, id);
            return this.readOrCreate(id, { ...node, id }) as Promise<T>;
        });
    };

    /**
     * update model (or it will create automatically)
     *
     * ```ts
     * //before: { count: 1 };
     * const res = await storage.increment(1, { count: 2 }, { total: 2 });
     * //after : { count: 3, total: 2 }
     * ```
     *
     * @param id            node-id
     * @param $increments   model only with numbers
     */
    public increment = (id: string | number, $increments: T, $update?: T): Promise<T> =>
        this.storage.doIncrement(this.type, `${id || ''}`, $increments, $update);

    /**
     * delete model by id.
     *
     * @param id        node-id
     * @param destroy   flag to destroy (real delete)
     */
    public delete = (id: string | number, destroy?: boolean): Promise<T> =>
        this.storage.doDelete(this.type, `${id || ''}`, destroy === undefined ? true : destroy) as Promise<T>;

    /**
     * save model by checking origin node.
     * - use `doSave()` rather than `doUpdate()` for both create & update.
     * - if `$create` is null, throw 404 error it if not found.
     *
     * @param id        node-id
     * @param node      node to save (or update)
     * @param $create   (optional) initial creation model.
     */
    public save = (id: string | number, model: T, $create?: T): Promise<T> =>
        this.storage.doSave(this.type, `${id || ''}`, model, $create);

    /**
     * lock data-entry by type+id w/ limited time tick
     * - WARN! must release lock by `release(id)`
     *
     * `total-waited-time = tick * interval (msec)`
     *
     * **[UPDATES]**
     * 1. read original node (or, throw 404 error)
     * 2. use internal lock.
     *
     * @param id        model-id to lock
     * @param tick      tick count to wait.
     * @param interval  timeout interval per each tick (in msec, default 1000 = 1sec)
     */
    public lock = (id: string | number, tick?: number, interval?: number) =>
        this.storage
            .doRead(this.type, `${id || ''}`, null)
            .then(node => this.storage.doLock(this.type, node.id, tick, interval));

    /**
     * release lock by resetting lock = 0.
     * @param id    model-id
     */
    public release = (id: string | number) => this.storage.doRelease(this.type, `${id || ''}`);

    /**
     * using `lock()`, guard func with auto lock & release.
     *
     * ```ts
     * const res = await storage.guard(async ()=>{
     *  return 'abc';
     * });
     * // res === 'abc'
     * ```
     */
    public guard = async <T>(id: string | number, handler: () => Promise<T> | T, tick?: number, interval?: number) => {
        let locked = false;
        return this.lock(id, tick, interval)
            .then((_: boolean) => {
                locked = _;
                try {
                    return handler();
                } catch (e) {
                    return Promise.reject(e);
                }
            })
            .then((_: any) => {
                if (locked) return this.release(id).then(() => _);
                return _;
            })
            .catch((e: Error) => {
                if (locked) return this.release(id).then(() => Promise.reject(e));
                // throw e;
                return Promise.reject(e);
            });
    };

    /**
     * make `UniqueFieldManager` for field.
     */
    public makeUniqueFieldManager = (field: string): UniqueFieldManager<T, ModelType> =>
        new UniqueFieldManager(this, field);

    /**
     * make `GeneralAPIController` for REST API w/ supporting basic CRUD
     */
    public makeGeneralAPIController = (search?: Elastic6SimpleQueriable<any>, uniqueField?: string) =>
        new GeneralAPIController(this.type, this, search, uniqueField);
}

/**
 * class: `ModelUtil`
 * - Helper functions for model.
 */
export class ModelUtil {
    public static selfRead = <T>(self: any, key: string, defValue?: T): T => {
        const value = self[key];
        return value === undefined ? defValue : value;
    };
    public static selfPop = <T>(self: any, key: string, defValue?: T): T => {
        const value = ModelUtil.selfRead(self, key, defValue);
        delete (self as any)[key];
        return value;
    };
    /**
     * attach `.pop()` method to object.
     *
     * ```js
     * const data = CoreModelUtil.buildPop({'a':1});
     * assert( 1 === data.pop('a) );
     * const final = data.pop();
     * assert( final == data );
     */
    public static buildPop = (thiz: any, popName: string = 'pop') => {
        if (!thiz) throw new Error('@thiz (object) is required!');
        if (typeof thiz[popName] != 'undefined') throw new Error(`.[${popName}] is duplicated!`);
        thiz[popName] = function<T>(key: string, defValue?: T): T {
            if (!key) {
                //! clear pop() if key is null.
                delete (this as any)[popName];
                return this;
            } else {
                return ModelUtil.selfPop(this, key, defValue);
            }
        };
        return thiz;
    };
}

/**
 * class: `UniqueFieldManager`
 * - support `.{field}` is unique in typed-storage-service.
 * - make lookup data entry to save the reverse mapping to origin id.
 * - set `.stereo` as '#' to mark as lookup. (to filter out from Elastic.search())
 * - set `.id` as `#{field}/{name}` or `#{name}`.
 * - set `.meta` as origin id.
 */
export class UniqueFieldManager<T extends CoreModel<ModelType>, ModelType extends string> {
    public readonly type: ModelType;
    public readonly field: string;
    public readonly storage: TypedStorageService<T, ModelType>;
    public constructor(storage: TypedStorageService<T, ModelType>, field: string = 'name') {
        this.type = storage.type;
        this.storage = storage;
        this.field = field;
    }

    public hello = (): string => `unique-field-manager:${this.type}/${this.field}:${this.storage.hello()}`;

    /**
     * validate value format
     * - just check empty string.
     * @param value unique value in same type+field.
     */
    public validate(value: string): boolean {
        const name2 = `${value || ''}`.trim();
        return name2 && value == name2 ? true : false;
    }

    /**
     * convert to internal id by value
     * @param value unique value in same type group.
     */
    public asLookupId(value: string): string {
        return `#${this.field || ''}/${value || ''}`;
    }

    /**
     * lookup model by value
     * - use `.meta` property to link with the origin.
     * - mark `.stereo` as to '#' to distinguish normal.
     *
     * @param value unique value in same type group.
     * @param $creates (optional) create-set if not found.
     */
    public async findOrCreate(value: string, $creates?: T): Promise<T> {
        if (!value || typeof value != 'string') throw new Error(`@${this.field} (string) is required!`);
        if (!this.validate(value)) throw new Error(`@${this.field} (${value || ''}) is not valid!`);
        const ID = this.asLookupId(value);
        const field = `${this.field}`;
        if (!$creates) {
            // STEP.1 read the origin name map
            const $map: T = await this.storage.read(ID).catch(NUL404);
            const rid = $map && $map.meta;
            if (!rid) throw new Error(`404 NOT FOUND - ${this.type}:${field}/${value}`);

            // STEP.2 read the target node by stereo key.
            const model: T = await this.storage.read(rid);
            return model as T;
        } else {
            // STEP.0 validate if value is same
            const $any: any = $creates || {};
            if ($any[field] !== undefined && $any[field] !== value)
                throw new Error(`@${this.field} (${value}) is not same as (${$any[field]})!`);

            // STEP.1 read the origin value map
            const $new: CoreModel<string> = { stereo: '#', meta: `${$creates.id || ''}`, [field]: value };
            const $map: T = await this.storage.readOrCreate(ID, $new as T);
            const rid = ($map && $map.meta) || $creates.id;
            //! check if already saved, and id is differ.
            if ($any['id'] && $any['id'] != rid) throw new Error(`@id (${rid}) is not same as (${$any['id']})`);

            // STEP.2 read the target node or create.
            const $temp: T = { ...$creates, [field]: value };
            const model: T = rid ? await this.storage.readOrCreate(rid, $temp) : await this.storage.insert($temp);
            (model as any)[field] = value;

            // STEP.3 update lookup key.
            const newId = `${rid || model.id || ''}`;
            if ($map.meta != newId) {
                const $upt: CoreModel<string> = { meta: newId };
                await this.storage.update(ID, $upt as T);
                $map.meta = newId;
            }

            //! returns.
            return model as T;
        }
    }

    /**
     * update lookup table (or create)
     *
     * @param model target model
     * @param value (optional) new value of model.
     */
    public async updateLookup(model: T, value?: string): Promise<T> {
        value = value || (model as any)[this.field];
        if (!this.validate(value)) throw new Error(`@${this.field} (${value || ''}) is not valid!`);
        const ID = this.asLookupId(value);
        const field = `${this.field}`;
        // STEP.0 validate if value has changed
        const $any: any = model;
        if ($any[field] && $any[field] !== value)
            throw new Error(`@${this.field} (${value}) is not same as (${$any[field]})!`);

        // STEP.1 check if value is duplicated.
        const $org: T = await this.storage.read(ID).catch(NUL404);
        const rid = $org && $org.meta;
        if ($org && rid != model.id)
            throw new Error(`400 DUPLICATED NAME - ${field}[${value}] is duplicated to ${this.type}[${rid}]`);

        // STEP.2 save the name mapping.
        const $new: T = { ...model, [field]: value, id: model.id };
        return await this.findOrCreate(value, $new as T);
    }
}
