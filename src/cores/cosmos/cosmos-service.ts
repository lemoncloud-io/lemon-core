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
import 'dotenv/config'

const CosmosClient = require('@azure/cosmos').CosmosClient
const config = require('./config')
const url = require('url')

const endpoint = process.env.AZURE_ENDPOINT;
const key = process.env.AZURE_KEY;
const databaseName = config.database.id
const partitionKey = { kind: 'Hash', paths: ['/partitionKey'] }

const options = {
    endpoint: endpoint,
    key: key,
    userAgentSuffix: 'CosmosDBJavascriptQuickstart'
};

const client = new CosmosClient(options)

const NS = $U.NS('DYNA', 'green'); // NAMESPACE TO BE PRINTED.

export interface CosmosOption {
    tableName: string;
    idName: string;
    sortName?: string;
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


    public async createTable() {
        const { tableName, idName } = this.options;
        const { database } = await client.databases.createIfNotExists({ id: databaseName }); // DynamoDB: Not applicable / CosmosDB: Database
        const { container } = await database.containers.createIfNotExists({ id: tableName });
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
    public async saveItem(id: string, item: T) {
        const { tableName, idName } = this.options;

        let key_list: string[] = [];
        let value_list: (string | number)[] = [];

        if (item !== null && item !== undefined) {
            for (const value of Object.values(item)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    value_list.push(value);
                }
            }
            key_list = Object.keys(item)
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
            .database(databaseName)
            .container(tableName)
            .items.query(querySpec)
            .fetchAll();

        let payload: any = {[idName]: id};

        for (let i = 0; i < key_list.length; i++) {
            const key = key_list[i];
            let value = value_list[i];
            if (value == undefined) {
                value = null
            }
            payload[key] = value;
        }

        if (readDoc.length === 0) {
            const { resources: saveDoc } = await client
                .database(databaseName)
                .container(tableName)
                .items.create(payload)
            return
        }

        const { id: documentId, _rid, _self, _etag, _attachments, _ts, ..._rest } = readDoc[0];
        const update_payload = {
            ...payload,
            documentId,
            _rid,
            _self,
            _etag,
            _attachments,
            _ts
        }

        const { resource: updateDoc } = await client
            .database(databaseName)
            .container(tableName)
            .item(readDoc[0].id).replace(update_payload)

        const result: any = {};
        for (const key in payload) {
            if (payload.hasOwnProperty(key)) {
                result[key] = payload[key];
            }
        }
        return result;
    }

    /**
     * read-item
     * - read whole data of item.
     *
     * @param id
     * @param sort
     */
    public async readItem(id: string, sort?: string | number) {
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
            .database(databaseName)
            .container(tableName)
            .items.query(querySpec)
            .fetchAll();

        if (readDoc.length > 0) {
            const { id: documentId, ...rest } = readDoc[0];
            return rest
        }
        if (readDoc.length === 0) {
            const notFoundMessage = `404 NOT FOUND - ${idName}:${id}`;
            throw new Error(notFoundMessage);
        }
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
            .database(databaseName)
            .container(tableName)
            .items.query(querySpec)
            .fetchAll()

        const { resource: deleteDoc } = await client
            .database(databaseName)
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
    ) {

        const { tableName, idName } = this.options;

        let updates_key_list: string[] = [];
        let increments_key_list: string[] = [];
        let updates_value_list: (string | number)[] = [];
        let increments_value_list: (string | number)[] = [];

        if (updates !== null && updates !== undefined) {
            for (const value of Object.values(updates)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    updates_value_list.push(value);
                }
            }
            updates_key_list = Object.keys(updates)
        }
        if (increments !== null && increments !== undefined) {
            for (const value of Object.values(increments)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    increments_value_list.push(value);
                }
            }
            increments_key_list = Object.keys(increments)
        }

        if (updates == null && increments == null) {
            const message = '.slot (null) should be number!'
            return message
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
            .database(databaseName)
            .container(tableName)
            .items.query(querySpec)
            .fetchAll()

        //Upsert
        if (readDoc.length === 0) {
            let payload: any = { [idName]: id };

            for (let i = 0; i < updates_key_list.length; i++) {
                const key = updates_key_list[i];
                let value = updates_value_list[i];
                if (value == undefined) {
                    value = null
                }
                payload[key] = value;
            }
            for (let i = 0; i < increments_key_list.length; i++) {
                const key = increments_key_list[i];
                const value = increments_value_list[i];
                payload[key] = value
            }
            const update_payload = {
                ...payload,
            }
            const { resource: updateDoc } = await client
                .database(databaseName)
                .container(tableName)
                .items.upsert(update_payload)
                
            const result: any = {};
            for (const key in payload) {
                if (payload.hasOwnProperty(key)) {
                    result[key] = payload[key];
                }
            }
            return result;
        }

        //Update
        let payload: any = { [idName]: id };

        for (let i = 0; i < updates_key_list.length; i++) {
            const key = updates_key_list[i];
            let value = updates_value_list[i];
            if (value == undefined) {
                value = null
            }
            payload[key] = value;
        }

        for (let i = 0; i < increments_key_list.length; i++) {
            const key = increments_key_list[i];
            const value = increments_value_list[i];
            const existValue = readDoc[0][key] || 0;
            payload[key] = value + existValue;
        }

        const { _rid, _self, _etag, _attachments, _ts, ..._rest } = readDoc[0];
        const update_payload = {
            ..._rest,
            ...payload,
            _rid,
            _self,
            _etag,
            _attachments,
            _ts
        }
        const { resource: updateDoc } = await client
            .database(databaseName)
            .container(tableName)
            .item(readDoc[0].id).replace(update_payload)

        const result: any = {};
        for (const key in payload) {
            if (payload.hasOwnProperty(key)) {
                result[key] = payload[key];
            }
        }
        return result;
    }
}

