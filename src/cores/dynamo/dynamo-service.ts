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
import $engine, { $U, _log, _inf, _err } from '../../engine/';
import { GeneralItem, Incrementable } from 'lemon-model';
import { awsConfig, loadDataYml } from '../../tools/';
import { StreamViewType, KeySchemaElement } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    BatchGetCommand,
    PutCommand,
    DeleteCommand,
    UpdateCommand,
    BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';

const NS = $U.NS('DYNA', 'green'); // NAMESPACE TO BE PRINTED.

export type KEY_TYPE = 'number' | 'string';
type DynamoKey = Record<string, KEY_TYPE extends 'number' ? number : string>;
type DynamoItem = Record<string, string | number | string[] | number[] | null>;

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

/**
 * type: BatchWriteRequest for DynamoDB Document Client
 */
interface BatchWriteRequest {
    PutRequest?: { Item: DynamoItem };
    DeleteRequest?: { Key: DynamoKey };
}

/**
 * type: FailedItem - item with error message
 */
export type FailedItem<T> = T & { error?: string };

/**
 * type: BatchResult for batch operation results
 */
export interface BatchResult<T> {
    /** successfully saved items */
    success: T[];
    /** failed items (with error field) */
    failed: FailedItem<T>[];
    /** total number of items */
    total: number;
}

//* Batch operation constants
const BATCH_GET_CHUNK = 100; // DynamoDB BatchGetItem limit
const BATCH_WRITE_CHUNK = 25; // DynamoDB BatchWriteItem limit
const MAX_RETRIES = 3; // Maximum retry attempts for unprocessed items

//* create(or get) instance.
const instance = () => {
    const region = 'ap-northeast-2';
    return DynamoService.instance(region);
};

//* normalize dynamo properties.
const normalize = <T = any>(data?: T | null): T => {
    if (data === '') return null as T;
    if (!data) return data as T;
    if (Array.isArray(data)) return data.map(normalize) as T;
    if (typeof data == 'object') {
        return Object.keys(data).reduce((O: any, key) => {
            const val = (data as any)[key];
            O[key] = normalize(val);
            return O;
        }, {} as T);
    }
    return data as T;
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

    protected static _dynamo: Record<string, DynamoDBClient> = {};
    protected static _dynamostr: Record<string, DynamoDBStreamsClient> = {};
    //TODO [Steve] why to use promise here to make DynamoDBDocumentClient? @251212
    protected static _dynamodoc: Record<string, () => Promise<DynamoDBDocumentClient>> = {};

    /**
     * simple instance maker.
     * @param region    (default as `ap-northeast-2`)
     */
    public static instance(region?: string) {
        region = `${region || 'ap-northeast-2'}`;
        const $cfg = awsConfig($engine, region);
        const dynamo = DynamoService._dynamo[region] ?? new DynamoDBClient($cfg); // Low-level DynamoDB client
        const dynamostr = DynamoService._dynamostr[region] ?? new DynamoDBStreamsClient($cfg); // DynamoDB Streams client

        // Create memoized function for dynamodoc
        if (!DynamoService._dynamodoc[region]) {
            const cache: { client: DynamoDBDocumentClient | null } = { client: null };
            DynamoService._dynamodoc[region] = async (): Promise<DynamoDBDocumentClient> => {
                if (!cache.client) {
                    _log(NS, `! creating NEW DynamoDBDocumentClient for region[${region}]`);
                    const credentials = $cfg.credentials;
                    const dynamo = new DynamoDBClient({ ...$cfg, credentials });
                    cache.client = DynamoDBDocumentClient.from(dynamo);
                }
                return cache.client;
            };
        }

        const dynamodoc = DynamoService._dynamodoc[region]; // High-level Document client
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
        //* prepare payload.
        const payload = {
            TableName: tableName,
            KeySchema: [
                {
                    AttributeName: idName,
                    KeyType: 'HASH',
                },
            ] as KeySchemaElement[],
            AttributeDefinitions: [
                {
                    AttributeName: idName,
                    AttributeType: keyType(idType),
                },
            ],
            ProvisionedThroughput: { ReadCapacityUnits, WriteCapacityUnits },
            StreamSpecification: { StreamEnabled, StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES },
        };
        //* set sort-key.
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

        //* returns.
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
        const errScope = `prepareSaveItem(${idName}:${id})`;
        // _log(NS, `prepareSaveItem(${tableName})...`);
        // item && _log(NS, '> item =', item);
        if (sortName && item[sortName] === undefined) throw new Error(`.${sortName} is required - ${errScope}`);
        delete item[idName]; // clear the saved id.
        const node: T = Object.assign({ [idName]: id }, item); // copy
        const data = normalize(node);
        //TODO [Steve] check if how works for undefined | null in real dynamo?!
        // if (data === null) throw new Error(`@data[null] is invalid  - ${errScope}`);
        // if (data === undefined) throw new Error(`@data[null] is invalid  - ${errScope}`);
        //* prepare payload.
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
        const errScope = `prepareItemKey(${tableName}/${idName}/${id ?? ''})`;
        if (!id?.trim()) throw new Error(`@id (string) is required - ${errScope}`);
        // _log(NS, `prepareItemKey(${tableName}/${id}/${sort || ''})...`);
        //* prepare payload.
        const payload = {
            TableName: tableName,
            Key: {
                [idName]: id,
            },
        };
        if (sortName) {
            if (sort === undefined) throw new Error(`@sort (any) is required - ${errScope}`);
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
        const norm = (_: string) => `${_}`.replace(/[.\\:\/$]/g, '_');

        //* prepare payload.
        let payload = Object.entries($update).reduce(
            (memo: any, [key, value]: any[]) => {
                //* ignore if key
                if (key === idName || key === sortName) return memo;
                const key2 = norm(key);
                value = normalize(value);
                if (value && Array.isArray(value.setIndex)) {
                    //* support set items in list
                    value.setIndex.forEach(([idx, value]: [number, string | number], seq: number) => {
                        if (idx !== undefined && value !== undefined) {
                            memo.ExpressionAttributeNames[`#${key2}`] = key;
                            memo.ExpressionAttributeValues[`:${key2}_${seq}_`] = value;
                            memo.UpdateExpression.SET.push(`#${key2}[${idx}] = :${key2}_${seq}_`);
                        }
                    });
                } else if (value && Array.isArray(value.removeIndex)) {
                    //* support removing items from list
                    value.removeIndex.forEach((idx: number) => {
                        if (idx !== undefined) {
                            memo.ExpressionAttributeNames[`#${key2}`] = key2;
                            memo.UpdateExpression.REMOVE.push(`#${key2}[${idx}]`);
                        }
                    });
                } else {
                    //* prepare update-expression.
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
        //* prepare increment update.
        if ($increment) {
            //* increment field.
            payload = Object.entries($increment).reduce((memo: any, [key, value]) => {
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
            }, payload);
        }
        //* build final update expression.
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
            .dynamo.send(new CreateTableCommand(payload))
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
            .dynamo.send(new DeleteTableCommand(payload))
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
        const dynamodoc = await instance().dynamodoc();
        return dynamodoc
            .send(new GetCommand(itemKey))
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
     * multiple read-item
     * - chunks requests into groups of 100 (DynamoDB BatchGetItem limit)
     *
     * @param list array of items with { id, sort? }
     * @returns BatchResult with success/failed items
     */
    public async mreadItem(list: Array<{ id: string; sort?: string | number }>): Promise<BatchResult<T>> {
        const { tableName, idName, sortName } = this.options;
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        const dynamodoc = await DynamoService.instance().dynamodoc();

        const _convertKeyToSig = (key: DynamoKey) => {
            const id = key[idName] as string | number;
            const sort = sortName ? (key[sortName] as string | number) : undefined;
            return `${id}${sortName ? '/' + sort : ''}`;
        };
        const _convertItemToSig = (item: T) => {
            const id = item[idName] as string | number;
            const sort = sortName ? (item[sortName] as string | number) : undefined;
            return `${id}${sortName ? '/' + sort : ''}`;
        };

        //* Maps to preserve original order
        const successMap = new Map<string, T>();
        const failedMap = new Map<string, FailedItem<T>>();

        for (let i = 0; i < total; i += BATCH_GET_CHUNK) {
            const chunk = list?.slice(i, i + BATCH_GET_CHUNK) ?? [];
            const chunkKeyMap = new Map<string, DynamoKey>();

            const chunkKeys = chunk.map(item => {
                const key = this.prepareItemKey(item.id, item.sort).Key as DynamoKey;
                const sig = _convertKeyToSig(key);
                if (!chunkKeyMap.has(sig)) chunkKeyMap.set(sig, key);
                return key;
            });

            const _doBatchGet = async (
                keys: DynamoKey[],
                attempt: number,
                acc: T[],
            ): Promise<{ items: T[]; unprocessed: DynamoKey[] }> => {
                const response = await dynamodoc
                    .send(new BatchGetCommand({ RequestItems: { [tableName]: { Keys: keys } } }))
                    .catch((e: Error) => {
                        if (`${e.message}`.includes('ResourceNotFoundException'))
                            throw new Error(`404 NOT FOUND - table:${tableName}`);
                        throw e;
                    });

                const items = (response.Responses?.[tableName] ?? []) as T[];
                if (items.length > 0) acc.push(...items);

                const unprocessed = (response.UnprocessedKeys?.[tableName]?.Keys ?? []) as DynamoKey[];
                if (unprocessed.length > 0) {
                    if (attempt >= MAX_RETRIES) return { items: acc, unprocessed };
                    //* exponential backoff
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                    return _doBatchGet(unprocessed, attempt + 1, acc);
                }
                return { items: acc, unprocessed: [] };
            };

            try {
                const { items, unprocessed } = await _doBatchGet(chunkKeys, 1, []);
                items.forEach(item => {
                    const sig = _convertItemToSig(item);
                    successMap.set(sig, item);
                });

                //* Handle unprocessed items (failed after retries)
                if (unprocessed.length > 0) {
                    const error = `UNPROCESSED after ${MAX_RETRIES} retries`;
                    _err(NS, `! mreadItem unprocessed:`, { count: unprocessed.length, error });
                    unprocessed.forEach(key => {
                        const sig = _convertKeyToSig(key);
                        const failedItem = { ...key, error } as FailedItem<T>;
                        failedMap.set(sig, failedItem);
                    });
                }

                //* Identify items not found (404)
                const received = new Set(items.map(item => _convertItemToSig(item)));
                const unprocessedSigs = new Set(unprocessed.map(key => _convertKeyToSig(key)));
                Array.from(chunkKeyMap.entries())
                    .filter(([sig]) => !received.has(sig) && !unprocessedSigs.has(sig))
                    .forEach(([sig, key]) => {
                        const failedItem = {
                            ...key,
                            error: `404 NOT FOUND - ${idName}:${key[idName]}`,
                        } as FailedItem<T>;
                        failedMap.set(sig, failedItem);
                    });
            } catch (e) {
                const error = e instanceof Error ? e.message : `${e}`;
                _err(NS, `! mreadItem batch failed:`, error);
                Array.from(chunkKeyMap.entries()).forEach(([sig, key]) => {
                    const failedItem = { ...key, error } as FailedItem<T>;
                    failedMap.set(sig, failedItem);
                });
            }
        }

        //* Preserve original order
        list.forEach(item => {
            const key = this.prepareItemKey(item.id, item.sort).Key as DynamoKey;
            const sig = _convertKeyToSig(key);
            const successItem = successMap.get(sig);
            const failedItem = failedMap.get(sig);
            if (successItem) {
                result.success.push(successItem);
            } else if (failedItem) {
                result.failed.push(failedItem);
            }
        });

        if (result.failed.length > 0) {
            _err(NS, `! mreadItem.failed =`, {
                failed: result.failed.length,
                sample_failed: result.failed.slice(0, 3).map((item: any) => ({
                    id: item?._id ?? item?.id,
                    error: item?.error,
                })),
            });
        }
        _log(NS, `> mreadItem.res =`, {
            success: result.success.length,
            failed: result.failed.length,
            total: result.total,
        });
        return result;
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
        const dynamodoc = await DynamoService.instance().dynamodoc();
        return dynamodoc
            .send(new PutCommand(payload))
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
     * multiple save-item
     * - chunks requests into groups of 25 (DynamoDB BatchWriteItem limit)
     * - NOTE: This overwrites entire items (no partial update or increment support)
     *
     * @param list array of items with { id, sort?, ...model }
     * @returns BatchResult with success/failed items
     */
    public async msaveItem(list: Array<T & { id: string; sort?: string | number }>): Promise<BatchResult<T>> {
        const { tableName } = this.options;
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        const dynamodoc = await DynamoService.instance().dynamodoc();

        for (let i = 0; i < total; i += BATCH_WRITE_CHUNK) {
            const chunk = list?.slice(i, i + BATCH_WRITE_CHUNK) ?? [];
            const chunkItems: T[] = [];

            //* prepare batch write requests
            const putRequests: BatchWriteRequest[] = chunk.map(item => {
                const { id, ...rest } = item;
                const payload = this.prepareSaveItem(id, rest as T);
                chunkItems.push(payload.Item);
                return {
                    PutRequest: {
                        Item: payload.Item,
                    },
                };
            });

            //* execute batch write with retry for unprocessed items
            const _doBatchWrite = async (
                requests: BatchWriteRequest[],
                attempt: number,
            ): Promise<BatchWriteRequest[]> => {
                const response = await dynamodoc
                    .send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }))
                    .catch((e: Error) => {
                        if (`${e.message}`.includes('ResourceNotFoundException'))
                            throw new Error(`404 NOT FOUND - table:${tableName}`);
                        throw e;
                    });

                //* check for unprocessed items
                const unprocessed: any = response.UnprocessedItems?.[tableName];
                if (unprocessed && unprocessed?.length > 0) {
                    if (attempt >= MAX_RETRIES) {
                        return unprocessed;
                    }
                    //* exponential backoff
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                    return _doBatchWrite(unprocessed, attempt + 1);
                }
                return [];
            };

            try {
                const unprocessed = await _doBatchWrite(putRequests, 1);

                //* Handle unprocessed items (failed after retries)
                const unprocessedIds = new Set<string>();
                if (unprocessed?.length > 0) {
                    const error = `UNPROCESSED after ${MAX_RETRIES} retries`;
                    _err(NS, `! msaveItem unprocessed:`, { count: unprocessed.length, error });
                    unprocessed.forEach(req => {
                        const item = req.PutRequest?.Item;
                        if (item) {
                            const itemId = String((item as any)[this.options.idName] || (item as any).id);
                            unprocessedIds.add(itemId);
                            const chunkItem = chunkItems.find(ci => {
                                const chunkItemId = String((ci as any)[this.options.idName] || (ci as any).id);
                                return chunkItemId === itemId;
                            });
                            if (chunkItem) {
                                const failedItem = { ...chunkItem, error };
                                result.failed.push(failedItem);
                            }
                        }
                    });
                }

                //* Add successfully written items
                chunkItems.forEach(item => {
                    const itemId = String((item as any)[this.options.idName] || (item as any).id);
                    if (!unprocessedIds.has(itemId)) {
                        result.success.push(item);
                    }
                });
            } catch (e) {
                //* Handle complete batch failure
                const error = e instanceof Error ? e.message : `${e}`;
                _err(NS, `! msaveItem batch failed:`, error);
                chunkItems.forEach(item => {
                    const failedItem = { ...item, error };
                    result.failed.push(failedItem);
                });
            }
        }

        if (result.failed.length > 0) {
            _err(NS, `! msaveItem.failed =`, {
                failed: result.failed.length,
                sample_failed: result.failed.slice(0, 3).map((item: any) => ({
                    id: item?._id ?? item?.id,
                    error: item?.error,
                })),
            });
        }
        _log(NS, `> msaveItem.res =`, {
            success: result.success.length,
            failed: result.failed.length,
            total: result.total,
        });
        return result;
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
        const dynamodoc = await DynamoService.instance().dynamodoc();
        return dynamodoc
            .send(new DeleteCommand(payload))
            .then(res => {
                _log(NS, '> deleteItem.res =', $U.json(res));
                return null as any;
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
        const dynamodoc = await DynamoService.instance().dynamodoc();
        return dynamodoc
            .send(new UpdateCommand(payload))
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

    /**
     * multiple update-item
     * - chunks requests into groups of 25 (DynamoDB BatchWriteItem limit)
     * - NOTE: This overwrites entire items (no partial update or increment support)
     *
     * @param list array of items with { id, sort?, ...model }
     * @returns BatchResult with success/failed items
     */
    public async mupdateItem(list: Array<T & { id: string; sort?: string | number }>): Promise<BatchResult<T>> {
        const { tableName, idName } = this.options;
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        const dynamodoc = await DynamoService.instance().dynamodoc();

        //* Maps to preserve original order
        const successMap = new Map<string, T>();
        const failedMap = new Map<string, FailedItem<T>>();

        for (let i = 0; i < total; i += BATCH_WRITE_CHUNK) {
            const chunk = list?.slice(i, i + BATCH_WRITE_CHUNK) ?? [];
            const chunkItemMap = new Map<string, T>();

            //* prepare batch write requests
            const putRequests = chunk.map(item => {
                const { id, ...rest } = item;
                //* Use partition key field if available, otherwise use id
                const actualId = (rest as any)[this.options.idName] || id;
                const payload = this.prepareSaveItem(actualId, rest as unknown as T);
                chunkItemMap.set(id, payload.Item as T);
                return {
                    PutRequest: {
                        Item: payload.Item,
                    },
                };
            });

            //* execute batch write with retry for unprocessed items
            const _doBatchWrite = async (
                requests: BatchWriteRequest[],
                attempt: number,
            ): Promise<BatchWriteRequest[]> => {
                const response = await dynamodoc
                    .send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }))
                    .catch((e: Error) => {
                        if (`${e.message}`.includes('ResourceNotFoundException'))
                            throw new Error(`404 NOT FOUND - table:${tableName}`);
                        throw e;
                    });

                //* check for unprocessed items
                const unprocessed: any = response.UnprocessedItems?.[tableName];
                if (unprocessed && unprocessed?.length > 0) {
                    if (attempt >= MAX_RETRIES) {
                        return unprocessed;
                    }
                    //* exponential backoff
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                    return _doBatchWrite(unprocessed, attempt + 1);
                }
                return [];
            };

            try {
                const unprocessed = await _doBatchWrite(putRequests, 1);

                //* Handle unprocessed items (failed after retries)
                const unprocessedIds = new Set<string>();
                if (unprocessed?.length > 0) {
                    const error = `UNPROCESSED after ${MAX_RETRIES} retries`;
                    _err(NS, `! mupdateItem unprocessed:`, { count: unprocessed.length, error });
                    unprocessed.forEach(req => {
                        const item = req.PutRequest?.Item;
                        if (item) {
                            const itemId = String((item as any)[this.options.idName] || (item as any).id);
                            for (const [id, chunkItem] of chunkItemMap.entries()) {
                                const chunkItemId = String(
                                    (chunkItem as any)[this.options.idName] || (chunkItem as any).id,
                                );
                                if (chunkItemId === itemId) {
                                    unprocessedIds.add(id);
                                    const failedItem = { ...chunkItem, error };
                                    failedMap.set(id, failedItem);
                                    break;
                                }
                            }
                        }
                    });
                }

                //* Add successfully written items
                chunkItemMap.forEach((item, id) => {
                    if (!unprocessedIds.has(id)) {
                        successMap.set(id, item);
                    }
                });
            } catch (e) {
                //* Handle complete batch failure
                const error = e instanceof Error ? e.message : `${e}`;
                _err(NS, `! mupdateItem batch failed:`, error);
                chunkItemMap.forEach((item, id) => {
                    const failedItem = { ...item, error };
                    failedMap.set(id, failedItem);
                });
            }
        }

        //* Preserve original order
        list.forEach(item => {
            const id = item.id;
            const successItem = successMap.get(id);
            const failedItem = failedMap.get(id);
            if (successItem) {
                result.success.push(successItem);
            } else if (failedItem) {
                result.failed.push(failedItem);
            }
        });

        if (result.failed.length > 0) {
            _err(NS, `! mupdateItem.failed =`, {
                failed: result.failed.length,
                sample_failed: result.failed.slice(0, 3).map((item: any) => ({
                    id: item?._id ?? item?.id,
                    error: item?.error,
                })),
            });
        }
        _log(NS, `> mupdateItem.res =`, {
            success: result.success.length,
            failed: result.failed.length,
            total: result.total,
        });
        return result;
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

    private buffer: { [id: string]: T | null } = {};
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
        const item = this.buffer[id];
        if (item === undefined) throw new Error(`404 NOT FOUND - ${idName}:${id}`);
        return { [idName]: id, ...item } as T;
    }

    public async mreadItem(list: Array<{ id: string; sort?: string | number }>): Promise<BatchResult<T>> {
        const { idName, sortName } = this.options;
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        for (const item of list) {
            const data = this.buffer[item.id];
            if (data === undefined) {
                const failedItem = (
                    sortName
                        ? { [idName]: item.id, [sortName]: item.sort, error: '404 NOT FOUND' }
                        : { [idName]: item.id, error: '404 NOT FOUND' }
                ) as FailedItem<T>;
                result.failed.push(failedItem);
                continue;
            }
            result.success.push({ [idName]: item.id, ...data } as T);
        }

        if (result.failed.length > 0) {
            _err(NS, `! mreadItem.failed =`, {
                failed: result.failed.length,
                sample_failed: result.failed.slice(0, 3).map((item: any) => ({
                    id: item?._id ?? item?.id ?? item?.[idName],
                    error: item?.error,
                })),
            });
        }
        _log(NS, `> mreadItem.res =`, {
            success: result.success.length,
            failed: result.failed.length,
            total: result.total,
        });
        return result;
    }

    public async saveItem(id: string, item: T): Promise<T> {
        const { idName } = this.options;
        this.buffer[id] = normalize(item);
        return { [idName]: id, ...this.buffer[id] } as T;
    }

    public async msaveItem(list: Array<T & { id: string; sort?: string | number }>): Promise<BatchResult<T>> {
        const { idName } = this.options;
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        //* process all saves using the in-memory buffer (overwrites entire items)
        for (const item of list) {
            try {
                const { id, ...rest } = item;
                this.buffer[id] = normalize(rest as T);
                result.success.push({ [idName]: id, ...this.buffer[id] } as T);
            } catch (e) {
                const error = e instanceof Error ? e.message : `${e}`;
                _err(NS, `! msaveItem failed for id=${item?.id}:`, error);
                const failedItem = { ...item, error };
                result.failed.push(failedItem);
            }
        }

        if (result.failed.length > 0) {
            _err(NS, `! msaveItem.failed =`, {
                failed: result.failed.length,
                sample_failed: result.failed.slice(0, 3).map((item: any) => ({
                    id: item?._id ?? item?.id ?? item?.[idName],
                    error: item?.error,
                })),
            });
        }
        _log(NS, `> msaveItem.res =`, {
            success: result.success.length,
            failed: result.failed.length,
            total: result.total,
        });
        return result;
    }

    public async deleteItem(id: string, sort?: string | number): Promise<T> {
        delete this.buffer[id];
        return null as any;
    }

    public async updateItem(id: string, sort: string | number, updates: T, increments?: Incrementable): Promise<T> {
        const { idName } = this.options;
        const item = this.buffer[id];
        if (item === undefined) throw new Error(`404 NOT FOUND - ${idName}:${id}`);
        this.buffer[id] = { ...item, ...normalize(updates) } as T;
        return { [idName]: id, ...this.buffer[id] };
    }

    public async mupdateItem(list: Array<T & { id: string; sort?: string | number }>): Promise<BatchResult<T>> {
        const { idName } = this.options;
        const total = list?.length ?? 0;
        const result: BatchResult<T> = { success: [], failed: [], total };
        if (!list || total === 0) return result;

        //* process all updates using the in-memory buffer (overwrites entire items)
        for (const item of list) {
            try {
                const { id, ...rest } = item;
                //* overwrite entire item (same as PutItem behavior)
                this.buffer[id] = normalize(rest as any);
                result.success.push({ [idName]: id, ...this.buffer[id] } as any);
            } catch (e) {
                const error = e instanceof Error ? e.message : `${e}`;
                _err(NS, `! mupdateItem failed for id=${item?.id}:`, error);
                const failedItem = { [idName]: item.id, error } as FailedItem<T>;
                result.failed.push(failedItem);
            }
        }

        if (result.failed.length > 0) {
            _err(NS, `! mupdateItem.failed =`, {
                failed: result.failed.length,
                sample_failed: result.failed.slice(0, 3).map((item: any) => ({
                    id: item?._id ?? item?.id ?? item?.[idName],
                    error: item?.error,
                })),
            });
        }
        _log(NS, `> mupdateItem.res =`, {
            success: result.success.length,
            failed: result.failed.length,
            total: result.total,
        });
        return result;
    }
}
