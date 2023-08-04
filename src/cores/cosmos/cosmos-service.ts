/**
 * `cosmos-service.ts`
 * - common service for cosmos
 *
 * @author      
 * @date        
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../../engine';
import { GeneralItem, Incrementable } from 'lemon-model';
import { loadDataYml } from '../../tools';
import { IncludeExecutionData } from 'aws-sdk/clients/stepfunctions';
import 'dotenv/config'
const CosmosClient = require('@azure/cosmos').CosmosClient

const config = require('./config')
const url = require('url')

const endpoint = process.env.AZURE_ENDPOINT ;
const key = process.env.AZURE_KEY;

const databaseId = config.database.id
const containerId = config.container.id
const partitionKey = { kind: 'Hash', paths: ['/partitionKey'] }

const options = {
      endpoint: endpoint,
      key: key,
      userAgentSuffix: 'CosmosDBJavascriptQuickstart'
    };

const client = new CosmosClient(options)

const NS = $U.NS('DYNA', 'green'); // NAMESPACE TO BE PRINTED.

export type KEY_TYPE_for_cosmos = 'number' | 'string';

export interface CosmosOption {
    tableName: string;
    idName: string;
    sortName?: string;
    idType?: KEY_TYPE_for_cosmos;
    sortType?: KEY_TYPE_for_cosmos;
    // //TODO - do improve cosmos support.
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


//! normalize cosmos properties.
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
 * class: `CosmosService`
 * - basic CRUD service for AZURE CosmosDB.
 */
export class CosmosService<T extends GeneralItem>  {

  protected options: CosmosOption;
  public constructor(options: CosmosOption) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `CosmosService(${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;
    }

  /**
   * say hello of identity.
   */
  public hello = () => `cosmos-service:${this.options.tableName}`;


  /**
  * simple instance maker.
  * @param region    
  */
  public static instance(region?: string) {
    region = `${region || 'korea-central'}`;
    const config = { region };
    
    return { client };
  }
  /**
   * export to test..
   */
  public static normalize = normalize;


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
  
  public async saveItem(id: string, item: T){
    const { tableName, idName, sortName } = this.options;
    // _log(NS, `saveItem(${id})...`);
    const payload = this.prepareSaveItem(id, item);
    const { client_item } = await client
      .database(databaseId)
      .container(containerId)
      .items.upsert(payload)
  } 
  
  /**
     * prepare `Key` by id + sort key.
     *
     * @param id            partition-key
     * @param sort          sort-key
     */
  public prepareItemKey(id: string, sort: any) {
    const { tableName, idName, sortName } = this.options;
    if (!id) throw new Error(`@id is required - prepareItemKey(${tableName}/${idName})`);
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
     * read-item
     * - read whole data of item.
     *
     * @param id
     * @param sort
     */
  public async readItem(id: string, sort?: string | number){
    const { tableName, idName, sortName } = this.options;
    // _log(NS, `readItem(${id})...`);
    const itemKey = this.prepareItemKey(id, sort);
    const querySpec = {
      query: `SELECT * FROM c WHERE c.TableName = @tableName AND c.Item.no = @id`,
      parameters: [
          {
              name: "@id",
              value: id
          },
          {
              name: "@tableName",
              value: tableName
          }
      ]
    };

    const { resources: results } = await client
      .database(databaseId)
      .container(containerId)
      .items.query(querySpec)
      .fetchAll();
  
      console.log(results[0].Item)
      return results[0].Item
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

    //! prepare payload.
    let payload = Object.entries($update).reduce(
        (memo: any, [key, value]: any[]) => {
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
    ){

    const { idName } = this.options;
    // _log(NS, `updateItem(${id})...`);

    const payload = this.prepareUpdateItem(id, sort, updates, increments);

    const { item } = await client
        .database(databaseId)
        .container(containerId)
        .items(id) 
        .replace(payload); 
        
    
  }
  
}

