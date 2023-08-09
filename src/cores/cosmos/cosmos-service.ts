/**
 * `cosmos-service.ts`
 * - common service for cosmos
 *
 * @author    Ian Kim <ian@lemoncloud.io>  
 * @date      2023-08-02 initial version
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../../engine';
import { GeneralItem, Incrementable } from 'lemon-model';
import { loadDataYml } from '../../tools';
import { IncludeExecutionData } from 'aws-sdk/clients/stepfunctions';
import 'dotenv/config'
import { Items } from '@azure/cosmos';
const CosmosClient = require('@azure/cosmos').CosmosClient

const config = require('./config')
const url = require('url')

const endpoint = process.env.AZURE_ENDPOINT ;
const key = process.env.AZURE_KEY;

const databaseId = config.database.id

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

  public async saveItem(id: string, item: T){
    const { tableName, idName } = this.options;
    const key = Object.keys(item)[0]
    const value = Object.values(item)[0]

    const payload = {
        [idName]:id,                          
        [key]:value                         
        
    };
    
    const { saveDoc } = await client
      .database(databaseId)
      .container(tableName)
      .items.upsert(payload)
  } 
  
  /**
   * read-item
   * - read whole data of item.
   *
   * @param id
   * @param sort
   */
  public async readItem(id: string, sort?: string | number){
    const { tableName, idName } = this.options;
    
    const querySpec = {
        query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
        parameters: [
            {
                name: "@id",
                value: id
            },
            {
                name: "@idName",
                value: idName
            }
        ]
    };

    const { resources: readDoc } = await client
      .database(databaseId)
      .container(tableName)
      .items.query(querySpec)
      .fetchAll();
      
    
    const { id: documentId, ...rest } = readDoc[0];
    return rest
  }

  /**
  * delete-item
  *  - destroy whole data of item.
  * 
  * @param id
  * @param sort
  */
  public async deleteItem(id: string, sort?: string | number) {
    const { tableName, idName } = this.options;
    const querySpec = {
        query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
        parameters: [
            {
                name: "@id",
                value: id
            },
            {
                name: "@idName",
                value: idName
            }
        ]
    };
    
    const { resources: readDoc } = await client
      .database(databaseId)
      .container(tableName)
      .items.query(querySpec)
      .fetchAll()

      const { resource: deleteDoc } = await client
      .database(databaseId)
      .container(tableName)
      .item(readDoc[0].id)
      .delete()
      
    const { id: documentId, ...rest } = readDoc[0];
    return rest
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

  let TYPE = ''
  
  const { tableName, idName } = this.options;
  let key
  let value
  if (updates){
    key = Object.keys(updates)[0]
    value = Object.values(updates)[0]
  }
  if (increments){
    key = Object.keys(increments)[0]
    value = Object.values(increments)[0]
  }
  const querySpec = {
    query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
        parameters: [
            {
                name: "@id",
                value: id
            },
            {
                name: "@idName",
                value: idName
            }
        ]
  };
  
  const { resources: readDoc } = await client
    .database(databaseId)
    .container(tableName)
    .items.query(querySpec)
    .fetchAll()

  let payload
  let {slot, ...rest } = readDoc[0]
  
  if (slot == undefined || slot == null){
    slot = 0
  }

  if (updates){
    payload = {  
        ...readDoc[0],     
        [key]:value            
      };
  }

  let new_slot = slot + value
  if (increments){
    payload = {    
        ...readDoc[0],   
        [key]:new_slot      
      };
  }
  
  const { resource: updateDoc } = await client
      .database(databaseId)
      .container(tableName)
      .item(readDoc[0].id).replace(payload)

      return {
        no: updateDoc.no,
        [key]: updateDoc[key]
      }
}
}

