/**
 * `storage-service.js`
 * - common service for `storage`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-26 initial version
 * @date        2019-10-01 moved from ticket-data-service to storage-service.
 * @date        2019-12-01 migrated to storage-service.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine/';
const NS = $U.NS('STRS', 'green'); // NAMESPACE TO BE PRINTED.

export * from './http-storage-service';

/**
 * only for type information for internal partition-key.
 */
export interface InternalKey {
    _id?: string; // default partition-key name.
}

/**
 * use shared `NoSQL` data storage. (ex: DynamoDB, MongoDB, ...)
 * - use `key-value` simple storage service.
 * - `no-search`: need to support 'search' function. (but scan)
 */
export interface StorageModel extends InternalKey {
    id?: string; // unique id value.
    type?: string; // type of data.
    stereo?: string; // stereo of type.
    meta?: string | any; // json formated string (or parsed object).
}

/**
 * Abstract Concept of `StorageService`
 * - simplified `storage-service` for `NoSQL` data.
 */
export interface StorageService<T extends StorageModel> {
    /**
     * say hello(name)
     *
     * @returns     simple service name like `storage-service:${name}`
     */
    hello(): string;

    /**
     * read (or error `404 NOT FOUND - id:...`)
     *
     * @param id        unique-id
     */
    read(id: string): Promise<T>;

    /**
     * read or create if not-found.
     *
     * @param id        unique-id
     * @param model     auto creation if not-found.
     */
    readOrCreate(id: string, model: T): Promise<T>;

    /**
     * save (or create) of model.
     * - WARN! overwrite if exists
     *
     * @param id        unique-id
     * @param model     data.
     */
    save(id: string, model: T): Promise<T>;

    /**
     * update some attributes of model
     * - NOTE! it will create if not exist.
     *
     * @param id        unique-id
     * @param model     data
     * @param incrementals (optional) incrementals like `count = count + 1`
     */
    update(id: string, model: T, incrementals?: T): Promise<T>;

    /**
     * increment number attribute (or overwrite string field)
     * - NOTE! increments only number type.
     *
     * @param id        unique-id
     * @param model     data (ONLY number is supportable)
     * @param $update   (optional) update-set.
     */
    increment(id: string, model: T, $update?: T): Promise<T>;

    /**
     * delete item by id
     *
     * @param id        unique-id
     */
    delete(id: string): Promise<T>;
}

/** ****************************************************************************************************************
 *  Data Storage Service
 ** ****************************************************************************************************************/
import { GeneralItem, Incrementable } from './core-types';
import { DynamoService, KEY_TYPE } from './dynamo-service';
import { loadDataYml } from '../tools/shared';

interface MyGeneral extends GeneralItem, StorageModel {}

const clearDuplicated = (arr: string[]) =>
    arr.sort().reduce((L, val) => {
        if (L.indexOf(val) < 0) L.push(val);
        return L;
    }, []);

/**
 * class: `DynamoStorageService`
 * - service via DynamoDB with id + json data.
 */
export class DynamoStorageService<T extends StorageModel> implements StorageService<T> {
    private _table: string; // target table-name
    private _idName: string; // target table-name
    private _fields: string[]; // fields set.
    private $dynamo: DynamoService<MyGeneral>;

    public constructor(table: string, fields: string[], idName: string = 'id', idType: KEY_TYPE = 'string') {
        if (!table) throw new Error(`@table (table-name) is required!`);
        this._table = table;
        this._idName = idName;
        this._fields = clearDuplicated(['id', 'type', 'stereo', 'meta', idName].concat(fields));
        this.$dynamo = new DynamoService({ tableName: this._table, idName, idType });
    }

    /**
     * say hello()
     * @param name  (optional) given name
     */
    public hello = () => `dynamo-storage-service:${this._table}/${this._idName}/${this._fields.length}`;

    /**
     * (extended) get copy of fields.
     */
    public fields = () => [...this._fields];

    /**
     * Read whole model via database.
     *
     * @param id        id
     */
    public async read(id: string): Promise<T> {
        const data = await this.$dynamo.readItem(id);
        const fields = this._fields || [];
        const item = fields.reduce((N: any, key) => {
            const val = (data as any)[key];
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
        return item;
    }

    /**
     * auto-create if not found.
     *
     * @param id
     * @param model
     */
    public async readOrCreate(id: string, model: T): Promise<T> {
        return this.read(id).catch((e: Error) => {
            if (`${e.message}`.startsWith('404 NOT FOUND')) return this.update(id, model);
            throw e;
        });
    }

    /**
     * simply save(or overwrite) all model
     *
     * @param id        id
     * @param model     whole object.
     */
    public async save(id: string, model: T): Promise<T> {
        const fields = this._fields || [];
        const data: MyGeneral = fields.reduce((N: any, key) => {
            const val = (model as any)[key];
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
        await this.$dynamo.saveItem(id, data); // must be `{}`
        const item: T = (Object.assign({ [this._idName]: id }, data) as unknown) as T;
        return item;
    }

    /**
     * update some attributes
     *
     * @param id        id
     * @param model     attributes to update
     * @param incrementals (optional) attributes to increment
     */
    public async update(id: string, model: T, incrementals?: T): Promise<T> {
        const fields = this._fields || [];
        const $U: MyGeneral = fields.reduce((N: any, key) => {
            const val = (model as any)[key];
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
        /* eslint-disable prettier/prettier */
        const $I: Incrementable = !incrementals ? null : Object.keys(incrementals).reduce((M: Incrementable, key) => {
            const val = (incrementals as any)[key];
            if (typeof val !== 'number') throw new Error(`.${key} (${val}) should be number!`);
            M[key] = val;
            return M;
        }, {});
        /* eslint-enable prettier/prettier */
        const ret: any = await this.$dynamo.updateItem(id, undefined, $U, $I);
        return ret as T;
    }

    /**
     * increment number attribute (or overwrite string field)
     * - if not exists, then just update property with base zero 0.
     *
     * @param id        id
     * @param model     attributes of number.
     * @param $update   (optional) update-set.
     */
    public async increment(id: string, model: T, $update?: T): Promise<T> {
        if (!model && !$update) throw new Error('@item is required!');
        const $org: any = await this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) return { id };
            throw e;
        });
        const fields = this._fields || [];
        const $U: MyGeneral = fields.reduce((N: any, key) => {
            const val = $update ? ($update as any)[key] : undefined;
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
        const $I: Incrementable = fields.reduce((N: any, key) => {
            const val = (model as any)[key];
            if (val !== undefined) {
                const org = ($org as any)[key];
                //! check type matched!
                if (org !== undefined && typeof org === 'number' && typeof val !== 'number')
                    throw new Error(`.${key} (${val}) should be number!`);
                //! if not exists, update it.
                if (org === undefined && typeof val === 'number') N[key] = val;
                else if (typeof val !== 'number' && !Array.isArray(val)) $U[key] = val;
                else N[key] = val;
            }
            return N;
        }, {});
        const ret: any = await this.$dynamo.updateItem(id, undefined, $U, $I);
        return ret as T;
    }

    /**
     * delete set.
     * - if not exists, then just update property with base zero 0.
     *
     * @param id        id
     */
    public async delete(id: string): Promise<T> {
        const $org = await this.read(id);
        await this.$dynamo.deleteItem(id);
        return $org;
    }
}

/** ****************************************************************************************************************
 *  Dummy Data Service
 ** ****************************************************************************************************************/
/**
 * class: `DummyStorageService`
 * - service in-memory dummy data
 *
 * **NOTE**
 * - this dummy service should be replaceable with real service `DynamoStorageService`
 */
export class DummyStorageService<T extends StorageModel> implements StorageService<T> {
    private name: string;
    private idName: string;
    public constructor(dataFile: string, name: string = 'memory', idName?: string) {
        _log(NS, `DummyStorageService(${dataFile || ''})...`);
        if (!dataFile) throw new Error('@dataFile(string) is required!');
        this.name = `${name || ''}`;
        this.idName = `${idName || 'id'}`;
        // const loadDataYml = require('../express').loadDataYml;
        const dummy: any = loadDataYml(dataFile);
        this.load(dummy.data as any);
    }

    private buffer: { [id: string]: StorageModel } = {};
    public load(data: StorageModel[]) {
        if (!data || !Array.isArray(data)) throw new Error('@data should be array!');
        data.map(item => {
            const id = item.id || '';
            this.buffer[id] = item;
        });
    }

    /**
     * say hello()
     * @param name  (optional) given name
     */
    public hello = () => `dummy-storage-service:${this.name}/${this.idName}`;

    public async read(id: string): Promise<T> {
        if (!id.trim()) throw new Error('@id (string) is required!');
        const item = this.buffer[id];
        if (!item) throw new Error(`404 NOT FOUND - ${this.idName}:${id}`);
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        return { ...item, [this.idName]: id } as T;
    }

    protected async readSafe(id: string): Promise<T> {
        return this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) {
                // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
                const $org: T = ({ [this.idName]: id } as unknown) as T;
                return $org;
            }
            throw e;
        });
    }

    public async readOrCreate(id: string, model: T): Promise<T> {
        return this.read(id).catch((e: Error) => {
            if (`${e.message}`.startsWith('404 NOT FOUND')) return this.update(id, model);
            throw e;
        });
    }

    public async save(id: string, item: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!item) throw new Error('@item is required!');
        if (item && typeof (item as any).lock == 'number') this.$locks[id] = (item as any).lock;
        this.buffer[id] = item;
        return Object.assign({ [this.idName]: id }, item);
    }

    private $locks: any = {}; //! only for lock.
    public async update(id: string, item: T, $inc?: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!item) throw new Error('@item is required!');
        //! atomic operation for `.lock`
        const lock = (() => {
            let lock = 0;
            if (item && typeof (item as any).lock == 'number') this.$locks[id] = lock = (item as any).lock;
            if ($inc && typeof ($inc as any).lock == 'number')
                this.$locks[id] = lock = ($inc as any).lock + $U.N(this.$locks[id], 0);
            return lock;
        })();
        const $org = await this.readSafe(id);
        const $new = Object.assign($org, item);
        /* eslint-disable prettier/prettier */
        const incremented: Incrementable = !$inc ? null : Object.keys($inc).reduce((M: Incrementable, key) => {
            const val = ($inc as any)[key];
            if (typeof val !== 'number')
                throw new Error(`.${key} (${val}) should be number!`);
            if (key == 'lock') {
                M[key] = lock;
            } else {
                M[key] = $U.N(($new as any)[key], 0) + val;
            }
            return M;
        }, {});
        if (incremented) Object.assign($new, incremented);
        /* eslint-enable prettier/prettier */
        await this.save(id, $new);
        const $set = { ...item, ...incremented };
        if (typeof $set.lock == 'number') ($set as any).lock = lock;
        return Object.assign({ [this.idName]: id }, $set);
    }

    public async increment(id: string, $inc: T, $upt?: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!$inc && !$upt) throw new Error('@item is required!');
        //! atomic operation for `.lock`
        const lock = (() => {
            let lock = 0;
            if ($upt && typeof ($upt as any).lock == 'number') this.$locks[id] = lock = ($upt as any).lock;
            if ($inc && typeof ($inc as any).lock == 'number')
                this.$locks[id] = lock = ($inc as any).lock + $U.N(this.$locks[id], 0);
            return lock;
        })();
        const $org: any = await this.readSafe(id);
        const $set = Object.keys($inc)
            .concat(Object.keys($upt || {}))
            .reduce((N: any, key: string) => {
                const val = $inc ? ($inc as any)[key] : undefined;
                const upt = $upt ? ($upt as any)[key] : undefined;
                const org = $org[key];
                if (upt !== undefined) {
                    N[key] = upt;
                } else if (val !== undefined) {
                    if (org !== undefined && typeof org === 'number' && typeof val !== 'number')
                        throw new Error(`.${key} (${val}) should be number!`);
                    if (typeof val !== 'number') {
                        N[key] = val;
                    } else if (key == 'lock') {
                        N[key] = lock;
                        $org[key] = lock;
                    } else {
                        N[key] = (org === undefined ? 0 : org) + val;
                        $org[key] = (org === undefined ? 0 : org) + val;
                    }
                }
                return N;
            }, {});
        if (typeof $set.lock == 'number') $set.lock = lock;
        await this.save(id, Object.assign($org, $set));
        return Object.assign({ [this.idName]: id }, $set);
    }

    public async delete(id: string): Promise<T> {
        const $org = await this.read(id);
        delete this.buffer[id];
        delete this.$locks[id];
        return $org;
    }
}
