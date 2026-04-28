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
import { _log, _inf, _err, $U } from '../../engine/';
import { StorageModel, GeneralItem, Incrementable } from 'lemon-model';
export { StorageModel };
const NS = $U.NS('STRS', 'green'); // NAMESPACE TO BE PRINTED.

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
     * read multiple models.
     *
     * @param ids       ids
     */
    mread?(ids: string[]): Promise<BatchResult<T>>;

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
     * update multiple models.
     *
     * @param ids       ids
     */
    mupdate?(list: T[]): Promise<BatchResult<T>>;

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
import { DynamoService, KEY_TYPE, BatchResult, FailedItem } from '../dynamo/';
import { loadDataYml } from '../../tools/';

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
     * Read multiple models via database.
     *
     * @param ids       ids
     */
    public async mread(ids: string[]): Promise<BatchResult<T>> {
        const total = ids?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!ids || total === 0) return result;

        const list = ids.map(id => ({ id }));
        const res = await this.$dynamo.mreadItem(list);
        const fields = this._fields || [];
        const toModel = (data: MyGeneral): T =>
            fields.reduce((N: any, key) => {
                const val = (data as any)[key];
                if (val !== undefined) N[key] = val;
                return N;
            }, {});

        result.success = (res.success || []).map(toModel);
        result.failed = (res.failed || []).map(item => {
            const model = toModel(item);
            return { ...model, error: (item as any).error || 'Unknown error' } as FailedItem<T>;
        });
        return result;
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
        const item: T = Object.assign({ [this._idName]: id }, data) as unknown as T;
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
     * update multiple models
     *
     * @param list      list of models (should include id)
     */
    public async mupdate(list: T[]): Promise<BatchResult<T>> {
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        const fields = this._fields || [];
        const items = list.map((item: T) => {
            const _id = (item as any)[this._idName] || (item as any).id;
            if (!_id) throw new Error('@id is required!');
            const data: MyGeneral = fields.reduce((N: any, key) => {
                const val = (item as any)[key];
                if (val !== undefined) N[key] = val;
                return N;
            }, {});
            return { id: `${_id}`, ...data };
        });

        const res = await this.$dynamo.mupdateItem(items);
        result.success = (res.success as unknown as T[]) || [];
        result.failed = (res.failed as unknown as FailedItem<T>[]) || [];
        return result;
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
                //* check type matched!
                if (org !== undefined && typeof org === 'number' && typeof val !== 'number')
                    throw new Error(`.${key} (${val}) should be number!`);
                //* if not exists, update it.
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
    private _fields: string[] | null;
    public constructor(dataFile: string, name: string = 'memory', idName?: string, fields?: string[]) {
        _log(NS, `DummyStorageService(${dataFile || ''})...`);
        if (!dataFile) throw new Error('@dataFile(string) is required!');
        this.name = `${name || ''}`;
        this.idName = `${idName || 'id'}`;
        //* `undefined` keeps legacy "no filter" mode; `[]` opts into Dynamo's default whitelist.
        this._fields =
            fields === undefined ? null : clearDuplicated(['id', 'type', 'stereo', 'meta', this.idName].concat(fields));
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
     * apply Dynamo-style field whitelist when configured; otherwise return a shallow copy.
     */
    private pick<S extends object>(obj: S): Partial<S> {
        const source = DynamoService.normalize(obj);
        if (!this._fields) return { ...source };
        return this._fields.reduce((N: any, key) => {
            const val = (source as any)[key];
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
    }

    private pickRaw<S extends object>(obj: S): Partial<S> {
        if (!this._fields) return { ...obj };
        return this._fields.reduce((N: any, key) => {
            const val = (obj as any)[key];
            if (val !== undefined) N[key] = val;
            return N;
        }, {});
    }

    private applyDynamoAdd(key: string, org: any, val: any) {
        if (Array.isArray(val)) {
            if (org !== undefined && !Array.isArray(org))
                throw new Error(`.${key} (${val}) cannot append to non-list existing value`);
            return [...(Array.isArray(org) ? org : []), ...val];
        }
        if (typeof val === 'number') {
            if (org !== undefined && typeof org !== 'number')
                throw new Error(`.${key} (${val}) cannot ADD to non-number existing value`);
            return $U.N(org, 0) + val;
        }
        throw new Error(`.${key} (${val}) should be number!`);
    }

    /**
     * say hello()
     * @param name  (optional) given name
     */
    public hello = () =>
        this._fields
            ? `dummy-storage-service:${this.name}/${this.idName}/${this._fields.length}`
            : `dummy-storage-service:${this.name}/${this.idName}`;

    public async read(id: string): Promise<T> {
        //* disabled for DynamoStorage parity: whitespace id is a normal key.
        // //* note: dummy-only validation; Dynamo's read does not short-circuit whitespace ids.
        // if (!id.trim()) throw new Error('@id (string) is required!');
        const item = this.buffer[id];
        if (!item) throw new Error(`404 NOT FOUND - ${this.idName}:${id}`);
        return Object.assign(this.pick(item), { [this.idName]: id }) as unknown as T;
    }

    public async mread(ids: string[]): Promise<BatchResult<T>> {
        const total = ids?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!ids || total === 0) return result;

        for (const id of ids) {
            //* disabled for DynamoStorage parity: whitespace id is a normal key.
            // //* note: dummy-only validation; Dynamo's mread does not short-circuit whitespace ids.
            // if (!id || !`${id}`.trim()) throw new Error('@id (string) is required!');
            const item = this.buffer[id];
            if (!item) {
                result.failed.push({
                    [this.idName]: id,
                    error: `404 NOT FOUND - ${this.idName}:${id}`,
                } as unknown as FailedItem<T>);
            } else {
                result.success.push(Object.assign(this.pick(item), { [this.idName]: id }) as unknown as T);
            }
        }

        return result;
    }

    protected async readSafe(id: string): Promise<T> {
        return this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) {
                const $org: T = { [this.idName]: id } as unknown as T;
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
        if (typeof (item as any).lock == 'number') this.$locks[id] = (item as any).lock;
        const data = this.pick(item);
        this.buffer[id] = data as StorageModel;
        return Object.assign({ [this.idName]: id }, this.pickRaw(item)) as unknown as T;
    }

    private $locks: any = {}; //* only for lock.
    public async update(id: string, item: T, $inc?: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!item) throw new Error('@item is required!');
        //* atomic operation for `.lock` — dummy-only deviation; DynamoDB has no equivalent here.
        const lock = (() => {
            let lock = 0;
            if (item && typeof (item as any).lock == 'number') this.$locks[id] = lock = (item as any).lock;
            if ($inc && typeof ($inc as any).lock == 'number')
                this.$locks[id] = lock = ($inc as any).lock + $U.N(this.$locks[id], 0);
            return lock;
        })();
        const $org = await this.readSafe(id);
        //* whitelist `item` (matches Dynamo `update` $U); $inc is iterated by its own keys (matches Dynamo $I).
        const filtered = this.pick(item) as Partial<T>;
        const $new: any = Object.assign($org, filtered);
        /* eslint-disable prettier/prettier */
        const incremented: Incrementable = !$inc ? null : Object.keys($inc).reduce((M: Incrementable, key) => {
            const val = ($inc as any)[key];
            if (typeof val !== 'number') throw new Error(`.${key} (${val}) should be number!`);
            if (key == 'lock') {
                M[key] = lock;
            } else {
                M[key] = this.applyDynamoAdd(key, ($new as any)[key], val);
            }
            return M;
        }, {});
        if (incremented) Object.assign($new, incremented);
        /* eslint-enable prettier/prettier */
        await this.save(id, $new);
        const $set: any = { ...filtered, ...incremented };
        if (typeof $set.lock == 'number') $set.lock = lock;
        return Object.assign({ [this.idName]: id }, $set) as T;
    }

    public async mupdate(list: T[]): Promise<BatchResult<T>> {
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        //* Dynamo's mupdateItem is batch-PUT (overwrite, no merge). Mirror that here inline.
        for (const item of list) {
            const _id = (item as any)[this.idName] || (item as any).id;
            if (!_id) throw new Error('@id is required!');
            if (typeof (item as any).lock == 'number') this.$locks[_id] = (item as any).lock;
            const cleaned = this.idName !== 'id' ? (({ id: _drop, ...rest }) => rest)(item as any) : item;
            const data = this.pick(cleaned);
            this.buffer[_id] = data as StorageModel;
            result.success.push(Object.assign({ [this.idName]: _id }, data) as T);
        }

        return result;
    }

    public async increment(id: string, $inc: T, $upt?: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!$inc && !$upt) throw new Error('@item is required!');
        if (!$inc) throw new TypeError('Cannot convert undefined or null to object');
        //* atomic operation for `.lock` — dummy-only deviation; DynamoDB has no equivalent here.
        const lock = (() => {
            let lock = 0;
            if ($upt && typeof ($upt as any).lock == 'number') this.$locks[id] = lock = ($upt as any).lock;
            if ($inc && typeof ($inc as any).lock == 'number')
                this.$locks[id] = lock = ($inc as any).lock + $U.N(this.$locks[id], 0);
            return lock;
        })();
        const $org: any = await this.readSafe(id);
        //* null-guard: previously `Object.keys($inc)` threw when only $upt was provided.
        const inc: any = $inc ? DynamoService.normalize($inc) : {};
        const upt: any = $upt ? DynamoService.normalize($upt) : {};
        //* iterate over the whitelist when configured (parity with Dynamo at storage-service.ts:283-301);
        //* otherwise fall back to the union of provided keys (legacy unfiltered behavior).
        const keys: string[] = this._fields
            ? this._fields
            : Array.from(new Set([...Object.keys(inc), ...Object.keys(upt)]));
        const $set: any = {};
        for (const key of keys) {
            const uptVal = upt[key];
            const incVal = inc[key];
            const org = $org[key];
            if (uptVal !== undefined) {
                $set[key] = uptVal;
                $org[key] = uptVal;
            } else if (incVal !== undefined) {
                if (org !== undefined && typeof org === 'number' && typeof incVal !== 'number')
                    throw new Error(`.${key} (${incVal}) should be number!`);
                if (key === 'lock') {
                    $set[key] = lock;
                    $org[key] = lock;
                } else if (typeof incVal !== 'number' && !Array.isArray(incVal)) {
                    //* non-number SET, matching DynamoStorage.increment's SET path.
                    $set[key] = incVal;
                    $org[key] = incVal;
                } else {
                    const newVal = this.applyDynamoAdd(key, org, incVal);
                    $set[key] = newVal;
                    $org[key] = newVal;
                }
            }
        }
        if (typeof $set.lock == 'number') $set.lock = lock;
        await this.save(id, $org);
        return Object.assign({ [this.idName]: id }, $set) as T;
    }

    public async delete(id: string): Promise<T> {
        const $org = await this.read(id);
        delete this.buffer[id];
        delete this.$locks[id];
        return $org;
    }
}
