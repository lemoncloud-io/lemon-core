/**
 * `cosmos-query-service.ts`
 * - common service to query with pkey+sort via cosmos
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-08-16 initial version with `cosmosDB` package.
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../../engine/';
import { GeneralItem } from 'lemon-model';
import { CosmosOption, CosmosService } from './cosmos-service';
const NS = $U.NS('DYQR', 'green'); // NAMESPACE TO BE PRINTED.

const CosmosClient = require('@azure/cosmos').CosmosClient
const config = require('./config')

const endpoint = process.env.AZURE_ENDPOINT;
const key = process.env.AZURE_KEY;
const databaseName = config.database.id

const options = {
    endpoint: endpoint,
    key: key,
    userAgentSuffix: 'CosmosDBJavascriptQuickstart'
};

const client = new CosmosClient(options)
/**
 * class: QueryResult
 * - result information of query.
 */

class QueryBuilder {
    static buildQueryByConditions(conditions: Record<string, any>) {
        
        const queryParts = Object.entries(conditions).map(([index, elements]) => {
            let { key, comparator, value, from, to, exists, operator, not, or } = elements;
            if (or) {
                // Map over each condition in the 'or' array
                const orConditions = or.map((orCondition: Record<string, any>) => {
                    let { key: orKey, comparator: orComparator, value: orValue, operator: orOperator } = orCondition;
            
                    if (orOperator === 'begins_with' && orValue) {
                        return `STARTSWITH(c['${orKey}'], '${orValue}')`;
                    }
                    if (orKey && orComparator && (orValue || orValue === null)) {
                        orValue === null ? 'null' : `'${orValue}'`;
                        return `c['${orKey}'] ${orComparator} ${orValue}`;
                    }
                });
                // Combine 'or' conditions using 'OR'
                return `(${orConditions.join(' OR ')})`;
            }
            if (not) {
                if(not.key && not.comparator && (not.value || not.value===null)){
                    value = elements.not.value === null ? 'null' : `'${elements.not.value}'`;
                    return `c['${elements.not.key}'] !${elements.not.comparator} ${value}`;
                }
                if (not.key && not.operator === 'begins_with' && not.value) {
                    return `NOT STARTSWITH(c['${not.key}'], '${not.value}')`;
                }
            }
            if(key && comparator && (value || value===null)){
                value = elements.value === null ? 'null' : `'${elements.value}'`;
                return `c['${elements.key}'] ${elements.comparator} ${value}`;
            }
            if(key && from && to){
                return `c['${key}'] >= ${from} AND c['${key}'] <= ${to}`;
            }
            if(key && exists){
                return `IS_DEFINED(c['${key}'])`;
            }
            if (key && operator === 'begins_with' && value) {
                return `STARTSWITH(c['${key}'], '${value}')`;
            }
        });
        
        const queryString = `SELECT * FROM c WHERE ${queryParts.join(' AND ')}`;
        return queryString;
    }
}

class QueryService {
    protected options: CosmosOption;

    // Add constructor that takes options as a parameter
    constructor(options: CosmosOption) {
        this.options = options;
    }
    async queryItems(query: string) {
        const { tableName } = this.options; // Ensure that options is accessible here

        const querySpec = {
            query,        
        };
        
        const { resources: queryResult } = await client
            .database(databaseName)
            .container(tableName)
            .items.query(querySpec)
            .fetchAll();
        
        return queryResult;
    }
}

export class CosmosQueryService{
    protected options: CosmosOption;
    private queryService: QueryService;
    
    public constructor(options: CosmosOption) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `CosmosQueryService(${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;
        
        // Initialize the queryService
        this.queryService = new QueryService(options);
    }
    /**
     * say hello of identity.
     */
    public hello = () => `cosmos-query-service:${this.options.tableName}`;
    
    /**
     * Read items by conditions using dynamic query
     */
    public async readItemsByConditions(conditions: Record<string, any>) {
        
        const queryString = QueryBuilder.buildQueryByConditions(conditions);
        const queryResult = await this.queryService.queryItems(queryString);

        if (queryResult.length > 0) {
            let count = 0
            for(let i=0; i<queryResult.length; i++){
                count += 1
            }
            return {"count":count}
            
            /*
            // when return queryResult data

            return queryResult.map((item:any, index: any) => {
                return queryResult.length
            });
            */
            
        } else {
            throw new Error('No items found.');
        }
    }
}

