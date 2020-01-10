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
const NS = $U.NS('PSTR', 'blue'); // NAMESPACE TO BE PRINTED.

import { StorageService, StorageModel } from './storage-service';
import { DummyStorageService, DynamoStorageService } from './storage-service';
import { NUL404 } from '../common/test-helper';

/**
 * class: `CoreKeyMakeable`
 * - make internal key by type + id.
 */
export interface CoreKeyMakeable<ModelType extends string> {
    /**
     * get key object w/ internal partition-key (as _id).
     *
     * @param type  type of model
     * @param id    id of model in type
     */
    asKey$(type: ModelType, id: string): { ns?: string; id: string; type: ModelType; _id: string };
}

/**
 * class: `InternalModel`
 * - common internal properties. (ONLY FOR INTERNAL PROCESSING)
 */
export interface InternalModel<T> {
    _id?: string; //! internal unique partition-key.
    // _node?: T; //! internal model instance.
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
}

//NOTE! - BE WARE TO USE `ts-transformer-keys` DUE TO MISSING `ttypescript`
// export const CORE_FIELDS: string[] = keys<CoreModel>().filter(_ => !_.startsWith('_'));
// _inf(NS, '! CORE_FIELDS =', CORE_FIELDS.join(', ')); // for debugging.
export const CORE_FIELDS: string[] = 'ns,type,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt'.split(',');

/**
 * type: ModelFilter
 *
 * @param model  the current mode to update
 * @param origin the origin model stored.
 * @return       the updated model.
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
     */
    public afterRead(model: T, origin?: T): T {
        _log(NS, `filter.afterRead(${model._id || ''})....`);
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
     * @param model
     * @param origin
     */
    public beforeSave(model: T, origin?: T): T {
        _log(NS, `filter.beforeSave(${model._id})....`);
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
     * called after updating the model.
     * - parse `.meta` back to json object.
     *
     * @param model
     * @param origin
     */
    public afterSave(model: T, origin?: T) {
        return this.afterRead(model, origin);
    }

    /**
     * override this `onBeforeSave()` in sub-class.
     */
    public onBeforeSave(model: T, origin: T): T {
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
     */
    public constructor(
        service: CoreKeyMakeable<ModelType>,
        storage: StorageService<T> | string,
        fields: string[],
        filters?: CoreModelFilterable<T>,
    ) {
        this.service = service;
        this.storage = typeof storage == 'string' ? ProxyStorageService.makeStorageService(storage, fields) : storage;
        this.filters = filters || new GeneralModelFilter<T, ModelType>(fields);
    }

    /**
     * factory function to create this `proxy-storage-service`
     * @param service   key-makeable
     * @param table     table-name
     * @param fields    list of fields.
     * @param filters   model filter.
     */
    public static create<T extends CoreModel<ModelType>, ModelType extends string>(
        service: CoreKeyMakeable<ModelType>,
        table: string,
        fields?: string[],
        filters?: CoreModelFilterable<T>,
    ) {
        const storage = ProxyStorageService.makeStorageService(table, fields);
        const res: ProxyStorageService<T, ModelType> = new ProxyStorageService<T, ModelType>(
            service,
            storage as any,
            fields,
            filters,
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
    public update = (_id: string, model: T): Promise<T> => this.storage.update(_id, model) as Promise<T>;

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
     * get next auto-sequence number.
     *
     * @param type      type of seqeunce.
     * @param initNext  initial next value if not exist.
     */
    public async nextSeq(type: ModelType, initNext?: number): Promise<number> {
        _log(NS, `nextSeq(${type})..`);
        const $key = this.service.asKey$(ProxyStorageService.TYPE_SEQUENCE as ModelType, `${type}`);
        const { createdAt, updatedAt } = this.asTime();
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        let res = await this.storage.increment($key._id, { next: 1 } as T, { updatedAt } as T); // it will create new row if not exists. (like upset)
        if (res.next == 1) {
            initNext = initNext === undefined ? ProxyStorageService.AUTO_SEQUENCE : initNext;
            // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
            const $upd: T = { next: initNext } as T;
            // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
            const $inc: T = { ...$key, createdAt, updatedAt } as T;
            res = await this.storage.increment($key._id, $upd, $inc); //! increment w/ update-set
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
     * get time-stamp as now.
     */
    public asTime(currentTime?: number) {
        currentTime = currentTime || new Date().getTime();
        const createdAt = currentTime;
        const updatedAt = currentTime;
        const deletedAt = currentTime;
        return { createdAt, updatedAt, deletedAt };
    }

    /**
     * get key-id by type+id
     */
    public asKey(type: ModelType, id: string | number): string {
        const $key = this.service.asKey$(type, `${id}`);
        return $key._id;
    }

    /**
     * delete sequence-key.
     * @param type      type of seqeunce.
     */
    public async clearSeq(type: ModelType): Promise<void> {
        _log(NS, `nextSeq(${type})..`);
        const $key = this.service.asKey$(ProxyStorageService.TYPE_SEQUENCE as ModelType, `${type}`);
        await this.storage.delete($key._id);
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
        const _id = $key._id;
        const model = await this.storage.read(_id).catch((e: Error) => {
            if (`${e.message}`.startsWith('404 NOT FOUND') && $create) {
                const { createdAt, updatedAt } = this.asTime();
                return this.storage.update(_id, { ...$create, ...$key, createdAt, updatedAt, deletedAt: 0 });
            }
            throw e;
        });
        //! make sure it has `_id`
        model._id = _id;
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
        const $key = this.service.asKey$(type, id);
        if (destroy === undefined || destroy === true) return this.storage.delete($key._id);
        const { updatedAt, deletedAt } = this.asTime();
        const $up = { updatedAt, deletedAt };
        return this.update($key._id, $up as T);
    }

    /**
     * update model (or it will create automatically)
     *
     * @param type      model-type
     * @param id        node-id
     */
    public async doUpdate(type: ModelType, id: string, node: T) {
        const $key = this.service.asKey$(type, id);
        const { updatedAt } = this.asTime();
        return this.update($key._id, { ...node, updatedAt });
    }

    /**
     * update model (or it will create automatically)
     *
     * @param type      model-type
     * @param id        node-id
     */
    public async doIncrement(type: ModelType, id: string, $inc: T, $up: T) {
        const $key = this.service.asKey$(type, id);
        const { updatedAt } = this.asTime();
        return this.increment($key._id, { ...$inc }, { ...$up, updatedAt });
    }

    /**
     * save model by checking origin node.
     * - use `doSave()` rather than `doUpdate()` for both create & update.
     * - if `$create` is null, throw 404 error it if not found.
     *
     * @param type      model-type
     * @param id        node-id
     * @param node      node to save (or update)
     * @param $create   (optional) initial creation model.
     */
    public async doSave(type: ModelType, id: string, node: T, $create?: T) {
        //! read origin with safe creation.
        const $org: T = (await this.doRead(type, id, null).catch(e => {
            if (`${e.message}`.startsWith('404 NOT FOUND') && $create === undefined) return null; // mark null to create later.
            throw e;
        })) as T;

        //! if `$create` is undefined, create it with default $key.
        const $key: T = this.service.asKey$(type, id) as T;
        $create = $create === undefined ? { ...$key } : $create;
        const model: T = { ...node }; // copy from param.
        model._id = $key._id; //! make sure the internal id

        //! apply filter.
        const $ups = this.filters.beforeSave(model, $org);
        _log(NS, `> updates[${type}/${id}] =`, $U.json($ups));

        //! if null, then nothing to update.
        if (!$ups) {
            const res = { _id: $key._id };
            return res as T;
        }

        //! determine of create or update.
        const { createdAt, updatedAt } = this.asTime();
        const $save =
            $org === null
                ? { ...$ups, ...$create, ...$key, createdAt, updatedAt: createdAt, deletedAt: 0 }
                : { ...$ups, updatedAt };
        const res: T = await this.storage.update($key._id, $save as T);
        return this.filters.afterSave(res, $org);
    }

    /**
     * lock data-entry by type+id w/ limited time tick
     * - WARN! must release lock by `doRelease()`
     *
     * @param type  model-type
     * @param id    model-id
     * @param tick  tick to wait (in seconds)
     */
    public async doLock(type: ModelType, id: string, tick: number = 30): Promise<boolean> {
        const _id = this.asKey(type, id);
        const thiz = this;
        //! wait some time.
        const wait = async (timeout: number) =>
            new Promise(resolve => {
                setTimeout(() => {
                    resolve(timeout);
                }, timeout);
            });
        //! recursive to wait lock()
        const waitLock = async (tick: number): Promise<boolean> => {
            const $up = { lock: 1 };
            const $t2 = await thiz.storage.increment(_id, $up as T);
            const lock = $U.N($t2.lock, 1);
            _log(NS, `! waitLock(${_id}, ${tick}). lock =`, lock);
            if (lock != 1 && tick > 0) {
                return wait(1000).then(() => waitLock(tick - 1));
            } else if (lock != 1) {
                throw new Error(`500 FAILED TO LOCK - model[${_id}].lock = ${lock}`);
            }
            return true;
        };
        return waitLock(tick);
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
     */
    public static makeStorageService<T>(table: string, fields?: string[]): StorageService<T> {
        if (!table) throw new Error(`@table (table-name) is required!`);
        //! clear the duplicated string
        const clearDuplicated = (arr: string[]) =>
            arr.sort().reduce((L, val) => {
                if (val && L.indexOf(val) < 0) L.push(val);
                return L;
            }, []);

        //! make internal storage-service by table
        if (table.endsWith('.yml')) {
            return new DummyStorageService<T>(table, table.split('.')[0], '_id');
        } else {
            if (!fields) throw new Error(`@fields (list of field) is required!`);
            fields = clearDuplicated(CORE_FIELDS.concat(fields));
            return new DynamoStorageService<T>(table, fields, '_id');
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
 * - wrap id with type + id automatically.
 */
// eslint-disable-next-line prettier/prettier
export class TypedStorageService<T extends CoreModel<ModelType>, ModelType extends string> implements StorageService<T> {
    public readonly type: ModelType;
    public readonly storage: ProxyStorageService<T, ModelType>;
    public constructor(service: ProxyStorageService<T, ModelType>, type: ModelType) {
        this.storage = service;
        this.type = type;
    }
    public hello = () => `typed-storage-service:${this.type}/${this.storage.hello()}`;
    public nextId = (): Promise<number> => this.storage.nextSeq(this.type);
    public nextUuid = (): Promise<string> => this.storage.nextUuid(this.type);
    public insert = async (node: T): Promise<T> => {
        return this.nextId().then(_ => {
            const id = `${_}`;
            _log(NS, `> next-id[${this.type}] =`, id);
            return this.readOrCreate(id, { ...node, id }) as Promise<T>;
        });
    };
    public readOrCreate = (id: string | number, model: T): Promise<T> =>
        this.storage.doRead(this.type, `${id || ''}`, model);
    public read = (id: string | number): Promise<T> => this.storage.doRead(this.type, `${id || ''}`);
    public update = (id: string | number, node: T): Promise<T> =>
        this.storage.doUpdate(this.type, `${id || ''}`, node) as Promise<T>;
    public increment = (id: string | number, model: T, $update?: T): Promise<T> =>
        this.storage.doIncrement(this.type, `${id || ''}`, model, $update);
    public delete = (id: string | number, destroy?: boolean): Promise<T> =>
        this.storage.doDelete(this.type, `${id || ''}`, destroy === undefined ? true : destroy) as Promise<T>;
    public save = (id: string | number, model: T): Promise<T> => this.storage.doSave(this.type, `${id || ''}`, model);
    public lock = (id: string | number, tick?: number) => this.storage.doLock(this.type, `${id || ''}`, tick);
    public release = (id: string | number) => this.storage.doRelease(this.type, `${id || ''}`);
}

/**
 * class: `UniqueFieldManager`
 * - support `.{field}` is unique in typed-storage-service.
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
        return `#${this.type || ''}/${value || ''}`;
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
        if ($any[field] !== undefined && $any[field] !== value)
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
