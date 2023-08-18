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

/**
 * Cosmos config.
 */
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
 * ComparisonCondition - arithmetic comparison (EQ, NE, LE, LT, GE, GT)
 * NOTE: '!=' is shortcut to { not: { comparator: '=' } }
 */

interface ComparisonCondition {
    key: string;
    comparator: '=' | '!=' | '<=' | '<' | '>=' | '>';
    value: number | string;
}
function isComparisonCondition(c: Condition): c is ComparisonCondition {
    return 'comparator' in c;
}
// BetweenCondition - {from} <= value <= {to}
interface BetweenCondition {
    key: string;
    from: number | string;
    to: number | string;
}
function isBetweenCondition(c: Condition): c is BetweenCondition {
    return 'from' in c && 'to' in c;
}
// ExistenceCondition - given field exists or not
interface ExistenceCondition {
    key: string;
    exists: boolean;
}
function isExistenceCondition(c: Condition): c is ExistenceCondition {
    return 'exists' in c;
}
// StringCondition - begins with {value}, contains {value}
interface StringCondition {
    key: string;
    operator: 'begins_with' | 'contains';
    value: string;
}
function isStringCondition(c: Condition): c is StringCondition {
    return 'operator' in c;
}

type Condition = ComparisonCondition | BetweenCondition | ExistenceCondition | StringCondition;

/**
 * convertToCondition - Use Record<string, any> to Condition
 */
function convertToCondition(record: Record<string, any>): Condition {
    if ('comparator' in record) {
        const condition: ComparisonCondition = {
            key: record.key,
            comparator: record.comparator,
            value: record.value,
        };
        return condition;
    }

    if ('from' in record && 'to' in record) {
        const condition: BetweenCondition = {
            key: record.key,
            from: record.from,
            to: record.to,
        };
        return condition;
    }

    if ('exists' in record) {
        const condition: ExistenceCondition = {
            key: record.key,
            exists: record.exists,
        };
        return condition;
    }

    if ('operator' in record) {
        const condition: StringCondition = {
            key: record.key,
            operator: record.operator,
            value: record.value,
        };
        return condition;
    }

    throw new Error(`Invalid condition: ${JSON.stringify(record)}`);
}


/**
 * class: CosmosQueryResult
 * - result information of scan.
 */
export interface CosmosQueryResult<T> {
    // list of data
    list: T[];
    // number of data
    count?: number;
}

/**
 * feature: `CosmosScannable`
 * - simple scan capable class.
 */
export interface CosmosScannable<T extends GeneralItem> {
    /**
     * simple scan w/ limit.
     *
     * @param conditions
     */
    readItemsByConditions(conditions: Record<string, any>):Promise<CosmosQueryResult<T>>;
}

/**
 * class: QueryResult
 * - result information of query.
 */

class QueryBuilder {
    static buildConditionExpression(condition: Condition): string {
        if (isComparisonCondition(condition)) {
            const valueExpression = condition.value === null ? 'null' : `'${condition.value}'`;
            return `c['${condition.key}'] ${condition.comparator} ${valueExpression}`;
        }
        if (isStringCondition(condition)) {
            if (condition.operator === 'begins_with')
                return `STARTSWITH(c['${condition.key}'], '${condition.value}')`;
            if (condition.operator === 'contains')
                return `CONTAINS(c['${condition.key}'], '${condition.value}')`;
        }
        if (isBetweenCondition(condition)) {
            return `c['${condition.key}'] >= ${condition.from} AND c['${condition.key}'] <= ${condition.to}`;
        }
        if (isExistenceCondition(condition)) {
            return condition.exists ? `IS_DEFINED(c['${condition.key}'])` : `NOT IS_DEFINED(c['${condition.key}'])`;
        }
    }
    
    static buildQueryByConditions(conditions: Record<string, any>) {
        const queryParts = Object.values(conditions).map((condition) => {
            if (condition.hasOwnProperty('or')) {
                const orConditions = condition.or.map((orConditionRecord: Record<string, any>) => {
                    const orCondition = convertToCondition(orConditionRecord);
                    return this.buildConditionExpression(orCondition);
                });
                return `(${orConditions.join(' OR ')})`;
            }
            if (condition.hasOwnProperty('not')) {
                const notCondition = condition.not;
                const notExpression = this.buildConditionExpression(notCondition);
                return `NOT (${notExpression})`;
            }
            return this.buildConditionExpression(condition);
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
        const { tableName } = this.options; 

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

export class CosmosQueryService<T extends GeneralItem> implements CosmosScannable<T>{
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
    public async readItemsByConditions(conditions: Record<string, any>): Promise<CosmosQueryResult<T>> {
        
        const queryString = QueryBuilder.buildQueryByConditions(conditions);
        const queryResult = await this.queryService.queryItems(queryString);
        
        if (queryResult.length > 0) {
            return {
                list : queryResult as T[],
                count: queryResult.length
            }
        } else {
            throw new Error('No items found.');
        }
    }
}

