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

const CosmosClient = require('@azure/cosmos').CosmosClient

const config = require('./config')
const url = require('url')

const endpoint = config.endpoint
const key = config.key

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
   * export to test..
   */
  public static normalize = normalize;

 
  /**
   * Read the database definition
   */
  public readDatabase() {
    const { resource: databaseDefinition } =  client
      .database(databaseId)
      .read()
    console.log(`Reading database:\n${databaseDefinition.id}\n`)
  }


  /**
   * Read the container definition
   */
  public readContainer() {
    const { resource: containerDefinition } =  client
      .database(databaseId)
      .container(containerId)
      .read()
    console.log(`Reading container:\n${containerDefinition.id}\n`)
  }

  /**
   * Scale a container
   * You can scale the throughput (RU/s) of your container up and down to meet the needs of the workload. Learn more: https://aka.ms/cosmos-request-units
   */
  public scaleContainer() {
    const { resource: containerDefinition } =  client
      .database(databaseId)
      .container(containerId)
      .read();
    
    try
    {
        const {resources: offers} =  client.offers.readAll().fetchAll();
    
        const newRups = 500;
        for (var offer of offers) {
          if (containerDefinition._rid !== offer.offerResourceId)
          {
              continue;
          }
          offer.content.offerThroughput = newRups;
          const offerToReplace = client.offer(offer.id);
           offerToReplace.replace(offer);
          console.log(`Updated offer to ${newRups} RU/s\n`);
          break;
        }
    }
    catch(err)
    {
        if (err.code == 400)
        {
            console.log(`Cannot read container throuthput.\n`);
            console.log(err.body.message);
        }
        else 
        {
            throw err;
        }
    }
  }

  
}