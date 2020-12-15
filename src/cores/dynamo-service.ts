/**
 * `dynamo-service.ts`
 * - common service for dynamo
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-28 initial version
 * @date        2019-10-16 cleanup and optimize log
 * @date        2019-11-19 optimize 404 error case, and normalize key.
 * @date        2019-12-10 support `DummyDynamoService.listItems()` for mocks
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_ } from '../engine/';
import { GeneralItem, Incrementable } from './core-types';
import { loadDataYml } from '../tools/';
import AWS from 'aws-sdk';
const NS = $U.NS('DYNA', 'green'); // NAMESPACE TO BE PRINTED.

export type KEY_TYPE = 'number' | 'string';

export interface DynamoOption {
    tableName: string;
    idName: string;
    sortName?: string;
    idType?: KEY_TYPE;
    sortType?: KEY_TYPE;
    // //TODO - do improve dynamo support.
    // timestamps?: boolean; // flag to use timestamp.
    // createdAt?: boolean | string; // flag (or overrided name).
    // updatedAt?: boolean | string; // flag (or overrided name).
    // deletedAt?: boolean | string; // flag (or overrided name).
}

/**
 * type `Updatable`: parameter for updateItem
 *  - update field
 *  - 'setIndex': array of [index, value] - replace elements in list field
 *  - 'removeIndex': array of indices - remove elements from list field
 */
export interface Updatable {
    [key: string]: GeneralItem['key'] | { setIndex: [number, string | number][] } | { removeIndex: number[] };
}

//! create(or get) instance.
const instance = () => {
    const region = 'ap-northeast-2';
    return DynamoService.instance(region);
};

//! normalize dynamo properties.
const normalize = (data: any): any => {
    if (data === '') return null;
    if (!data) return data;
    if (Array.isArray(data)) return data.map(normalize);
    if (typeof data == 'object') {
        return Object.keys(data).reduce((O: any, key) => {
            const val = data[key];
            O[key] = normalize(val);
            return O;
        }, {});
    }
    return data;
};

/**
 * class: `DynamoService`
 * - basic CRUD service for AWS DynamoDB.
 */
export class DynamoService<T extends GeneralItem> {
    protected options: DynamoOption;
    public constructor(options: DynamoOption) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `DynamoService(${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;
    }

    /**
     * say hello of identity.
     */
    public hello = () => `dynamo-service:${this.options.tableName}`;

    /**
     * simple instance maker.
     * @param region    (default as `ap-northeast-2`)
     */
    public static instance(region?: string) {
        region = `${region || 'ap-northeast-2'}`;
        const config = { region };
        const dynamo = new AWS.DynamoDB(config); // DynamoDB Main.
        const dynamodoc = new AWS.DynamoDB.DocumentClient(config); // DynamoDB Document.
        const dynamostr = new AWS.DynamoDBStreams(config); // DynamoDB Stream.
        return { dynamo, dynamostr, dynamodoc };
    }

    /**
     * export to test..
     */
    public static normalize = normalize;

    /**
     * prepare `CreateTable` payload.
     *
     * @param ReadCapacityUnits
     * @param WriteCapacityUnits
     * @param StreamEnabled
     */
    public prepareCreateTable(
        ReadCapacityUnits: number = 1,
        WriteCapacityUnits: number = 1,
        StreamEnabled: boolean = true,
    ) {
        const { tableName, idName, sortName, idType, sortType } = this.options;
        _log(NS, `prepareCreateTable(${tableName}, ${idName}, ${sortName || ''}, ${sortType || ''})...`);
        const keyType: any = (type: string = '') => {
            type = type || 'string';
            switch (type) {
                case 'number':
                    return 'N';
                case 'string':
                    return 'S';
                default:
                    break;
            }
            throw new Error(`invalid key-type:${type}`);
        };
        const StreamViewType = 'NEW_AND_OLD_IMAGES';
        //! prepare payload.
        const payload = {
            TableName: tableName,
            KeySchema: [
                {
                    AttributeName: idName,
                    KeyType: 'HASH',
                },
            ],
            AttributeDefinitions: [
                {
                    AttributeName: idName,
                    AttributeType: keyType(idType),
                },
            ],
            ProvisionedThroughput: { ReadCapacityUnits, WriteCapacityUnits },
            StreamSpecification: { StreamEnabled, StreamViewType },
        };
        //! set sort-key.
        if (sortName) {
            payload.KeySchema.push({
                AttributeName: sortName,
                KeyType: 'RANGE',
            });
            payload.AttributeDefinitions.push({
                AttributeName: sortName,
                AttributeType: keyType(sortType),
            });
        }

        //! returns.
        return payload;
    }

    /**
     * prepare `DeleteTable` payload.
     */
    public prepareDeleteTable() {
        const { tableName } = this.options;
        _log(NS, `prepareDeleteTable(${tableName})...`);
        return {
            TableName: tableName,
        };
    }

    /**
     * prepare `SaveItem` payload.
     *
     * @param id            partition-key
     * @param item
     */
    public prepareSaveItem(id: string, item: T) {
        const { tableName, idName, sortName } = this.options;
        // _log(NS, `prepareSaveItem(${tableName})...`);
        // item && _log(NS, '> item =', item);
        if (sortName && item[sortName] === undefined) throw new Error(`.${sortName} is required. ${idName}:${id}`);
        delete item[idName]; // clear the saved id.
        const node: T = Object.assign({ [idName]: id }, item); // copy
        const data = normalize(node);
        //! prepare payload.
        const payload = {
            TableName: tableName,
            Item: data,
        };
        return payload;
    }

    /**
     * prepare `Key` by id + sort key.
     *
     * @param id            partition-key
     * @param sort          sort-key
     */
    public prepareItemKey(id: string, sort: any) {
        const { tableName, idName, sortName } = this.options;
        if (!id) throw new Error('@id is required!');
        // _log(NS, `prepareItemKey(${tableName}/${id}/${sort || ''})...`);
        //! prepare payload.
        const payload = {
            TableName: tableName,
            Key: {
                [idName]: id,
            },
        };
        if (sortName) {
            if (sort === undefined) throw new Error(`@sort is required. ${idName}:${id}`);
            payload.Key[sortName] = sort;
        }
        return payload;
    }

    /**
     * prepare `UpdateItem` payload.
     *
     * @param id            partition-key
     * @param sort          sort-key
     * @param $update       update set
     * @param $increment    increment set.
     */
    public prepareUpdateItem(id: string, sort: any, $update: Updatable, $increment?: Incrementable) {
        const debug = 0 ? true : false;
        const { tableName, idName, sortName } = this.options;
        debug && _log(NS, `prepareUpdateItem(${tableName}/${id}/${sort || ''})...`);
        debug && $update && _log(NS, `> $update =`, $U.json($update));
        debug && $increment && _log(NS, `> $increment =`, $U.json($increment));
        const Key = this.prepareItemKey(id, sort).Key;
        const norm = (_: string) => `${_}`.replace(/[.\\:\/]/g, '_');

        //! prepare payload.
        const payload = $_.reduce(
            $update,
            (memo: any, value: any, key: string) => {
                //! ignore if key
                if (key === idName || key === sortName) return memo;
                const key2 = norm(key);
                value = normalize(value);
                if (value && Array.isArray(value.setIndex)) {
                    //! support set items in list
                    value.setIndex.forEach(([idx, value]: [number, string | number], seq: number) => {
                        if (idx !== undefined && value !== undefined) {
                            memo.ExpressionAttributeNames[`#${key2}`] = key;
                            memo.ExpressionAttributeValues[`:${key2}_${seq}_`] = value;
                            memo.UpdateExpression.SET.push(`#${key2}[${idx}] = :${key2}_${seq}_`);
                        }
                    });
                } else if (value && Array.isArray(value.removeIndex)) {
                    //! support removing items from list
                    value.removeIndex.forEach((idx: number) => {
                        if (idx !== undefined) {
                            memo.ExpressionAttributeNames[`#${key2}`] = key2;
                            memo.UpdateExpression.REMOVE.push(`#${key2}[${idx}]`);
                        }
                    });
                } else {
                    //! prepare update-expression.
                    memo.ExpressionAttributeNames[`#${key2}`] = key;
                    memo.ExpressionAttributeValues[`:${key2}`] = value === '' ? null : value;
                    memo.UpdateExpression.SET.push(`#${key2} = :${key2}`);
                    debug && _log(NS, '>> ' + `#${key} :=`, typeof value, $U.json(value));
                }
                return memo;
            },
            {
                TableName: tableName,
                Key,
                UpdateExpression: { SET: [], REMOVE: [], ADD: [], DELETE: [] },
                ExpressionAttributeNames: {},
                ExpressionAttributeValues: {},
                ConditionExpression: null, // "size(a) > :num "
                ReturnValues: 'UPDATED_NEW',
            },
        );
        //! prepare increment update.
        if ($increment) {
            //! increment field.
            $_.reduce(
                $increment,
                (memo: any, value: number | (string | number)[], key: string) => {
                    const key2 = norm(key);
                    if (!Array.isArray(value)) {
                        memo.ExpressionAttributeNames[`#${key2}`] = key;
                        memo.ExpressionAttributeValues[`:${key2}`] = value;
                        memo.UpdateExpression.ADD.push(`#${key2} :${key2}`);
                        debug && _log(NS, '>> ' + `#${key2} = #${key2} + :${value}`);
                    } else {
                        memo.ExpressionAttributeNames[`#${key2}`] = key; // target attribute name
                        memo.ExpressionAttributeValues[`:${key2}`] = value; // list to append like `[1,2,3]`
                        memo.ExpressionAttributeValues[`:${key2}_0`] = []; // empty array if not exists.
                        memo.UpdateExpression.SET.push(
                            `#${key2} = list_append(if_not_exists(#${key2}, :${key2}_0), :${key2})`,
                        );
                        debug && _log(NS, '>> ' + `#${key2} = #${key2} + ${value}`);
                    }
                    return memo;
                },
                payload,
            );
        }
        //! build final update expression.
        payload.UpdateExpression = Object.keys(payload.UpdateExpression) // ['SET', 'REMOVE', 'ADD', 'DELETE']
            .map(actionName => {
                const actions: string[] = payload.UpdateExpression[actionName];
                return actions.length > 0 ? `${actionName} ${actions.join(', ')}` : ''; // e.g 'SET #a = :a, #b = :b'
            })
            .filter(exp => exp.length > 0)
            .join(' ');
        _log(NS, `> UpdateExpression[${id}] =`, payload.UpdateExpression);
        return payload;
    }

    /**
     * create-table
     *
     * @param ReadCapacityUnits
     * @param WriteCapacityUnits
     */
    public async createTable(ReadCapacityUnits: number = 1, WriteCapacityUnits: number = 1) {
        _log(NS, `createTable(${ReadCapacityUnits}, ${WriteCapacityUnits})...`);
        const payload = this.prepareCreateTable(ReadCapacityUnits, WriteCapacityUnits);
        return instance()
            .dynamo.createTable(payload)
            .promise()
            .then(res => {
                _log(NS, '> createTable.res =', res);
                return res;
            });
    }

    /**
     * delete-table
     *
     */
    public async deleteTable() {
        _log(NS, `deleteTable()...`);
        const payload = this.prepareDeleteTable();
        return instance()
            .dynamo.deleteTable(payload)
            .promise()
            .then(res => {
                _log(NS, '> deleteTable.res =', res);
                return res;
            });
    }

    /**
     * read-item
     * - read whole data of item.
     *
     * @param id
     * @param sort
     */
    public async readItem(id: string, sort?: string | number): Promise<T> {
        const { tableName, idName, sortName } = this.options;
        // _log(NS, `readItem(${id})...`);
        const itemKey = this.prepareItemKey(id, sort);
        // _log(NS, `> pkey[${id}${sort ? '/' : ''}${sort || ''}] =`, $U.json(itemKey));
        return instance()
            .dynamodoc.get(itemKey)
            .promise()
            .then(res => {
                // _log(NS, '> readItem.res =', $U.json(res));
                if (!res.Item) throw new Error(`404 NOT FOUND - ${idName}:${id}${sort ? '/' : ''}${sort || ''}`);
                return res.Item as T;
            })
            .catch((e: Error) => {
                if (`${e.message}` == 'Requested resource not found')
                    throw new Error(`404 NOT FOUND - ${idName}:${id}`);
                throw e;
            });
    }

    /**
     * save-item
     * - save whole data with param (use update if partial save)
     *
     * **WARN** overwrited if exists.
     *
     * @param id
     * @param item
     */
    public async saveItem(id: string, item: T): Promise<T> {
        const { tableName, idName, sortName } = this.options;
        // _log(NS, `saveItem(${id})...`);
        const payload = this.prepareSaveItem(id, item);
        // _log(NS, '> payload :=', payload);
        return instance()
            .dynamodoc.put(payload)
            .promise()
            .then(res => {
                _log(NS, '> saveItem.res =', $U.json(res));
                return payload.Item;
            })
            .catch((e: Error) => {
                if (`${e.message}` == 'Requested resource not found')
                    throw new Error(`404 NOT FOUND - ${idName}:${id}`);
                throw e;
            });
    }

    /**
     * delete-item
     * - destroy whole data of item.
     *
     * @param id
     * @param sort
     */
    public async deleteItem(id: string, sort?: string | number): Promise<T> {
        // _log(NS, `deleteItem(${id})...`);
        const payload = this.prepareItemKey(id, sort);
        return instance()
            .dynamodoc.delete(payload)
            .promise()
            .then(res => {
                _log(NS, '> deleteItem.res =', $U.json(res));
                //TODO - improve the returned result
                return null;
            })
            .catch((e: Error) => {
                if (`${e.message}` == 'Requested resource not found') return {};
                throw e;
            });
    }

    /**
     * update-item (or increment-item)
     * - update or create if not exists.
     *
     * @param id
     * @param sort
     * @param updates
     * @param increments
     */
    public async updateItem(
        id: string,
        sort: string | number,
        updates: Updatable,
        increments?: Incrementable,
    ): Promise<T> {
        const { idName } = this.options;
        // _log(NS, `updateItem(${id})...`);
        const payload = this.prepareUpdateItem(id, sort, updates, increments);
        return instance()
            .dynamodoc.update(payload)
            .promise()
            .then(res => {
                _log(NS, `> updateItem[${id}].res =`, $U.json(res));
                const attr: any = res.Attributes;
                const $key = Object.assign({}, payload.Key);
                return Object.assign(attr, $key);
            })
            .catch((e: Error) => {
                if (`${e.message}` == 'Requested resource not found')
                    throw new Error(`404 NOT FOUND - ${idName}:${id}`);
                throw e;
            });
    }
}

/** ****************************************************************************************************************
 *  Dummy Dynamo Service
 ** ****************************************************************************************************************/
/**
 * class: `DummyDynamoService`
 * - service in-memory dummy data
 */
export class DummyDynamoService<T extends GeneralItem> extends DynamoService<T> {
    public constructor(dataFile: string, options: DynamoOption) {
        super(options);
        _log(NS, `DummyDynamoService(${dataFile || ''})...`);
        if (!dataFile) throw new Error('@dataFile(string) is required!');
        const dummy: any = loadDataYml(dataFile);
        this.load(dummy.data as any);
    }

    private buffer: { [id: string]: T } = {};
    public load(data: T[]) {
        const { idName } = this.options;
        if (!data || !Array.isArray(data)) throw new Error('@data should be array!');
        data.map(item => {
            const id = `${item[idName] || ''}`;
            this.buffer[id] = item;
        });
    }

    /**
     * say hello()
     */
    public hello = () => `dummy-dynamo-service:${this.options.tableName}`;

    /**
     * ONLY FOR DUMMY
     * - send list of data.
     *
     * @param page  page number starts from 1
     * @param limit limit of count.
     */
    public async listItems(page?: number, limit?: number) {
        page = $U.N(page, 1);
        limit = $U.N(limit, 2);
        const keys = Object.keys(this.buffer);
        const total = keys.length;
        const list = keys.slice((page - 1) * limit, page * limit).map(_ => this.buffer[_]);
        return { page, limit, total, list };
    }

    public async readItem(id: string, sort?: string | number): Promise<T> {
        const { idName } = this.options;
        const item: T = this.buffer[id];
        if (item === undefined) throw new Error(`404 NOT FOUND - ${idName}:${id}`);
        return { [idName]: id, ...item };
    }

    public async saveItem(id: string, item: T): Promise<T> {
        const { idName } = this.options;
        this.buffer[id] = normalize(item);
        return { [idName]: id, ...this.buffer[id] };
    }

    public async deleteItem(id: string, sort?: string | number): Promise<T> {
        delete this.buffer[id];
        return null;
    }

    public async updateItem(id: string, sort: string | number, updates: T, increments?: Incrementable): Promise<T> {
        const { idName } = this.options;
        const item: T = this.buffer[id];
        if (item === undefined) throw new Error(`404 NOT FOUND - ${idName}:${id}`);
        this.buffer[id] = { ...item, ...normalize(updates) };
        return { [idName]: id, ...this.buffer[id] };
    }
}
