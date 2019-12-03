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
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('STRS', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * use shared `NoSQL` data storage. (ex: DynamoDB, MongoDB, ...)
 * - use `key-value` simple storage service.
 * - `no-search`: need to support 'search' function. (but scan)
 */
export interface StorageModel {
    id?: string; // unique id value.
    type?: string; // type of data.
    stereo?: string; // stereo of type.
    meta?: string; // json formated string.
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
    hello(): Promise<string>;

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
     */
    update(id: string, model: T): Promise<T>;

    /**
     * increment number attribute (or overwrite string field)
     * - NOTE! increments only number type.
     *
     * @param id        unique-id
     * @param model     data (ONLY number is supportable)
     */
    increment(id: string, model: T): Promise<T>;

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
        this._fields = ['id', 'type', 'stereo', 'meta'].concat(fields);
        this._fields[0] = idName; // make sure that 1st field is 'idName'
        this.$dynamo = new DynamoService({ tableName: this._table, idName, idType });
    }

    /**
     * say hello()
     * @param name  (optional) given name
     */
    public async hello(): Promise<string> {
        return `dynamo-storage-service:${this._table}/${this._idName}/${this._fields.length}`;
    }

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
     */
    public async update(id: string, model: T): Promise<T> {
        const fields = this._fields || [];
        const data: MyGeneral = fields.reduce((N: any, key) => {
            const val = (model as any)[key];
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
        const ret: any = await this.$dynamo.updateItem(id, undefined, data, null);
        return ret as T;
    }

    /**
     * increment number attribute (or overwrite string field)
     * - if not exists, then just update property with base zero 0.
     *
     * @param id        id
     * @param model     attributes of number.
     */
    public async increment(id: string, model: T): Promise<T> {
        const $org: any = await this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) return { id };
            throw e;
        });
        const fields = this._fields || [];
        const $U: MyGeneral = {};
        const $I: Incrementable = fields.reduce((N: any, key) => {
            const val = (model as any)[key];
            // if (val !== undefined && typeof val !== 'number') throw new Error(`number is required at key:${key}`);
            if (val !== undefined) {
                const org = ($org as any)[key];
                //! check type matched!
                if (org !== undefined && typeof org === 'number' && typeof val !== 'number')
                    throw new Error('number is required at key:' + key);
                //! if not exists, update it.
                if (org === undefined) $U[key] = val;
                else if (typeof val !== 'number') $U[key] = val;
                else N[key] = val;
            }
            return N;
        }, {});
        const _KN = <T>(U: T) => (Object.keys(U) ? U : null);
        const ret: any = await this.$dynamo.updateItem(id, undefined, _KN($U), _KN($I));
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
    public constructor(dataFile: string, name: string = 'memory') {
        _log(NS, `DummyStorageService(${dataFile || ''})...`);
        if (!dataFile) throw new Error('@dataFile(string) is required!');
        this.name = name || '';
        // const loadDataYml = require('../express').loadDataYml;
        const dummy = loadDataYml(dataFile);
        this.load(dummy.data);
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
    public async hello(name?: string): Promise<string> {
        return `dummy-storage-service:${name || this.name}`;
    }

    public async read(id: string): Promise<T> {
        if (!id.trim()) throw new Error('@id(string) is required!');
        const item = this.buffer[id];
        if (!item) throw new Error(`404 NOT FOUND - id:${id}`);
        return item as T;
    }

    protected async readSafe(id: string): Promise<T> {
        return this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) {
                // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
                const $org: T = { id } as T;
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
        this.buffer[id] = item;
        return item;
    }

    public async update(id: string, item: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!item) throw new Error('@item is required!');
        const $org = await this.readSafe(id);
        const $new = Object.assign($org, item);
        await this.save(id, $new);
        return Object.assign({ id }, item);
    }

    public async increment(id: string, item: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!item) throw new Error('@item is required!');
        const $org: any = await this.readSafe(id);
        const $U = Object.keys(item).reduce((N: any, key: string) => {
            const val = (item as any)[key];
            const org = $org[key];
            if (val !== undefined) {
                if (org !== undefined && typeof org === 'number' && typeof val !== 'number')
                    throw new Error('number is required at key:' + key);
                if (typeof val !== 'number') {
                    N[key] = val;
                } else {
                    N[key] = (org === undefined ? 0 : org) + val;
                    $org[key] = (org === undefined ? 0 : org) + val;
                }
            }
            return N;
        }, {});
        await this.save(id, Object.assign($org, $U));
        return Object.assign({ id }, $U);
    }

    public async delete(id: string): Promise<T> {
        const $org = await this.read(id);
        delete this.buffer[id];
        return $org;
    }
}