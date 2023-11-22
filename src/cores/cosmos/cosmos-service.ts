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
// import { KeyVaultService } from '../azure'

const NS = $U.NS('CSMS', 'green'); // NAMESPACE TO BE PRINTED.

export interface CosmosOption {
    databaseName: string;
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
interface Updatable {
    [key: string]: GeneralItem['key'] | { setIndex: [number, string | number][] } | { removeIndex: number[] };
}

const instance = () => {
    return CosmosService.instance();
};

/**
 * class: `CosmosService`
 * - basic CRUD service for AZURE CosmosDB.
 */
export class CosmosService<T extends GeneralItem>  {
    protected options: CosmosOption;
    // protected $kv: KeyVaultService;

    public constructor(options: CosmosOption) {
        _inf(NS, `CosmosService(${options.databaseName}/${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.databaseName) throw new Error('.databaseName is required');
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;
    }

    public hello = () => `cosmos-service:${this.options.tableName}`;

    // public static $kv: KeyVaultService = new KeyVaultService();
    public static async instance() {
        const { CosmosClient } = await require('@azure/cosmos');
        const endpoint = process.env.COSMOS_ENDPOINT
        const key = process.env.COSMOS_KEY
        // const endpoint = await CosmosService.$kv.decrypt(process.env.AZ_COSMOS_ENDPOINT);
        // const key =  await CosmosService.$kv.decrypt(process.env.AZ_COSMOS_KEY);
        const client = new CosmosClient({ endpoint: endpoint, key: key });
        return { client };
    }

    public async createTable() {
        const { databaseName, tableName, idName } = this.options;
        const { client } = await CosmosService.instance();
        const { database } = await client.databases.createIfNotExists({ id: databaseName });
        const { container } = await database.containers.createIfNotExists({
            id: tableName,
            partitionKey: { paths: [`/${idName}`] }
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
    public async saveItem(_id: string, item: T) {
        const { databaseName, tableName, idName } = this.options;
        const { client } = await CosmosService.instance();
        const querySpec = {
            query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
            parameters: [
                {
                    name: "@id",
                    value: _id
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

        let payload: any = { [idName]: _id };
        for (const [key, value] of Object.entries(item)) {
            payload[key] = value;
        }
        if (!payload.hasOwnProperty('id')) {
            payload['id'] = _id
        }

        if (readDoc.length === 0) {
            const { resources: saveDoc } = await client
                .database(databaseName)
                .container(tableName)
                .items.create(payload)
            return saveDoc
        }

        const { id, _rid, _self, _etag, _attachments, _ts, ..._rest } = readDoc[0];
        const update_payload = {
            ...payload,
            id,
            _rid,
            _self,
            _attachments,
        }
        const { resource: updateDoc } = await client
            .database(databaseName)
            .container(tableName)
            .item(readDoc[0].id)
            .replace(update_payload)

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
    public async readItem(_id: string, sort?: string | number) {
        const { databaseName, tableName, idName } = this.options;
        const { client } = await CosmosService.instance();
        const querySpec = {
            query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
            parameters: [
                {
                    name: "@id",
                    value: _id
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

        // ! Error occurs when try-catch is used
        if (readDoc.length > 0) {
            const { ...rest } = readDoc[0];
            return rest
        }
        if (readDoc.length === 0) {
            const notFoundMessage = `404 NOT FOUND - ${idName}:${_id}`;
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
    public async deleteItem(_id: string, sort?: string | number) {
        const { databaseName, tableName, idName } = this.options;
        const { client } = await CosmosService.instance();
        const querySpec = {
            query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
            parameters: [
                {
                    name: "@id",
                    value: _id
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
            .item(readDoc[0].id, readDoc[0][idName])                //! id, partition key
            .delete();

        const { id, ...rest } = readDoc[0];
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
        _id: string,
        sort: string | number,
        updates: Updatable,
        increments?: Incrementable,
    ) {
        const { databaseName, tableName, idName } = this.options;
        const { client } = await CosmosService.instance();

        if (updates == null && increments == null) {
            const message = '.slot (null) should be number!'
            return message
        }

        const querySpec = {
            query: `SELECT * FROM c WHERE c[@idName] = @id`,        //c : each document of Cosmos DB container
            parameters: [
                {
                    name: "@id",
                    value: _id
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

        /**
         * 
         * upsert
         * 
         */
        if (readDoc.length === 0) {
            let payload: any = { [idName]: _id };

            if (updates !== null && updates !== undefined) {
                for (const [key, value] of Object.entries(updates)) {
                    payload[key] = value;
                }
            }
            if (increments !== null && increments !== undefined) {
                for (const [key, value] of Object.entries(increments)) {
                    payload[key] = value;
                }
            }
            if (!payload.hasOwnProperty('id')) {
                payload['id'] = _id
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

        /**
         * 
         * update
         * 
         */
        let payload: any = { [idName]: _id };

        if (updates !== null && updates !== undefined) {
            for (const [key, value] of Object.entries(updates)) {
                payload[key] = value;
            }
        }
        if (increments !== null && increments !== undefined) {
            for (const [key, value] of Object.entries(increments)) {
                const existValue = readDoc[0][key] || 0;
                payload[key] = value + existValue;
            }
        }
        if (!payload.hasOwnProperty('id')) {
            payload['id'] = _id
        }
        const { _etag, _ts, ..._rest } = readDoc[0];
        const update_payload = {
            ..._rest,
            ...payload,
        }
        try {
            // Compare the ETag values ​​of the document and update only if they match for atomicity
            const { resource: updateDoc } = await client
                .database(databaseName)
                .container(tableName)
                .item(readDoc[0].id)
                .replace(update_payload, { accessCondition: { type: "IfMatch", condition: readDoc[0]._etag } });
        }
        catch (error) {
            // Handle concurrency conflict
            const message = "Increments do not satisfy atomicity";
            return message;
        }

        const result: any = {};
        for (const key in payload) {
            if (payload.hasOwnProperty(key)) {
                result[key] = payload[key];
            }
        }
        return result;
    }
}