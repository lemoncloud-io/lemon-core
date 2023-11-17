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

const NS = $U.NS('CMQR', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * ComparisonCondition - arithmetic comparison (EQ, NE, LE, LT, GE, GT)
 * NOTE: '!=' is shortcut to { not: { comparator: '=' } }
 */

type Condition = ComparisonCondition | BetweenCondition | ExistenceCondition | StringCondition;
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

export type CosmosQueryFilter = (Condition | { not: Condition }) | CosmosQueryFilter[] | { or: CosmosQueryFilter[] };

/**
 * class: CosmosQueryResult
 * - result information of scan.
 */
export interface CosmosQueryResult<T> {
    // list of data
    list: T[];
    // number of data
    total?: number;
    // Last result on previous page
    last?: any;
}

/**
 * feature: `CosmosScannable`
 * - simple scan capable class.
 */
export interface CosmosScannable<T extends GeneralItem> {
    /**
     * simple scan w/ limit.
     * @param limit     limit of page
     * @param last      last result on previous page using continuation token
     * @param conditions
     */
    scan(limit?: number, last?: any, conditions?: CosmosQueryFilter): Promise<CosmosQueryResult<T>>;
}


export class QueryBuilder {
    public async buildConditionExpression(condition: Condition): Promise<string> {
        if (isComparisonCondition(condition)) {
            const valueExpression =
                condition.value === null ? 'null' : typeof condition.value === 'number' ? condition.value : `'${condition.value}'`;
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

    public async buildQueryByConditions(conditions: CosmosQueryFilter): Promise<string> {
        if (conditions) {
            const queryParts = Object.values(conditions).map(async (condition) => {
                if (condition.hasOwnProperty('or')) {
                    const orConditions = condition.or.map(async (orCondition: Condition) => {
                        return await this.buildConditionExpression(orCondition);
                    });
                    return `(${(await Promise.all(orConditions)).join(' OR ')})`;
                }
                if (condition.hasOwnProperty('not')) {
                    const notCondition = condition.not;
                    const notExpression = await this.buildConditionExpression(notCondition);
                    return `NOT (${notExpression})`;
                }
                return await this.buildConditionExpression(condition);
            });

            const queryString = `SELECT * FROM c WHERE ${(await Promise.all(queryParts)).join(' AND ')}`;
            return queryString;
        }
        return 'SELECT * FROM c';
    }
}

export class QueryService {
    protected options: CosmosOption;
    // Add constructor that takes options as a parameter
    constructor(options: CosmosOption) {
        this.options = options;
    }

    public async queryItems(query: string, limit?: number, last?: any): Promise<{ queryResult: any[]; continuationToken?: any }> {
        const { databaseName, tableName } = this.options;
        const { client } = await CosmosService.instance();
        const querySpec = {
            query,
        };
        // cosmos DB needs continuation token for pagination
        const { resources: queryResult, continuationToken } = await client
            .database(databaseName)
            .container(tableName)
            .items.query(querySpec, { continuationToken: last, maxItemCount: limit })
            .fetchNext();
        return {
            queryResult,
            continuationToken: continuationToken || undefined
        };
    }
}

export class CosmosQueryService<T extends GeneralItem> implements CosmosScannable<T>{
    protected options: CosmosOption;
    private queryService: QueryService;
    private queryBuilder: QueryBuilder;

    public constructor(options: CosmosOption) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `CosmosQueryService(${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;

        // Initialize the queryService
        this.queryService = new QueryService(options);
        this.queryBuilder = new QueryBuilder();
    }
    /**
     * say hello of identity.
     */
    public hello = () => `cosmos-query-service:${this.options.tableName}`;

    /**
     * Read items by conditions using dynamic query
     */
    public async scan(limit?: number, last?: any, conditions?: CosmosQueryFilter): Promise<CosmosQueryResult<T>> {
        const queryString = await this.queryBuilder.buildQueryByConditions(conditions);
        const { queryResult, continuationToken } = await this.queryService.queryItems(queryString, limit, last);
        if (queryResult.length >= 0) {
            return {
                list: queryResult as T[],
                total: queryResult.length,
                last: continuationToken
            };
        } else {
            throw new Error('error');
        }
    }
}