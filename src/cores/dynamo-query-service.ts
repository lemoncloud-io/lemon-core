/**
 * `dynamo-query-service.ts`
 * - common service to query with pkey+sort via dynamo
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-6 initial version with `dynamodb` package.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine/';
import { GeneralItem } from './core-types';
import { DynamoOption, DynamoService } from './dynamo-service';
const NS = $U.NS('DYQR', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * class: QueryResult
 * - result information of query.
 */
export interface DynamoQueryResult<T> {
    // list of data
    list: T[];
    // number of data
    count?: number;
    // last evaluated-key for pagination.
    last?: number;
}

/**
 * feature: `DynamoSimpleQueriable`
 * - simple query capable class.
 */
export interface DynamoSimpleQueriable<T extends GeneralItem> {
    /**
     * simple range query by `partition-key` w/ limit.
     *
     * @param pkey  value of partition-key
     */
    queryAll(pkey: string, limit?: number, isDesc?: boolean): Promise<DynamoQueryResult<T>>;

    /**
     * simple range query by `partition-key` and `range: sort-key` w/ limit.
     *
     * @param pkey  value of partition-key
     * @param from  range start (included)
     * @param to    range end (included)
     * @param limit limit of page
     * @param last  the last evaluated key (as sort-key)
     */
    queryRange(pkey: string, from: number, to: number, limit?: number, last?: number): Promise<DynamoQueryResult<T>>;
}

/** ****************************************************************************************************************
 *  Service Main
 ** ****************************************************************************************************************/
import Query from '../lib/dynamo/query';
import Serializer from '../lib/dynamo/serializer';

/**
 * class: `DynamoQueryService`
 * - support simple query like range search.
 */
export class DynamoQueryService<T extends GeneralItem> implements DynamoSimpleQueriable<T> {
    protected options: DynamoOption;
    public constructor(options: DynamoOption) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `DynamoQueryService(${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;
    }

    /**
     * say hello of identity.
     */
    public hello = () => `dynamo-query-service:${this.options.tableName}`;

    public async queryAll(pkey: string, limit?: number, isDesc?: boolean): Promise<DynamoQueryResult<T>> {
        return this.queryRangeBy(pkey, -1, -1, limit, null, isDesc);
    }

    public async queryRange(
        pkey: string,
        from: number,
        to: number,
        limit?: number,
        last?: number,
    ): Promise<DynamoQueryResult<T>> {
        return this.queryRangeBy(pkey, from, to, limit, last, false);
    }

    /**
     * query by range of sort-key.
     * NOTE - `dynamodb`의 일부 코드를 이용하여, 간단버전으로 지원함.
     */
    public async queryRangeBy(
        pkey: string,
        from: number,
        to: number,
        limit?: number,
        last?: number,
        isDesc?: boolean,
    ): Promise<DynamoQueryResult<T>> {
        _log(NS, `queryRangeBy(${pkey}, ${from}, ${to})...`);

        //! load table information..
        const { tableName, idName, sortName, idType, sortType } = this.options;
        const query = new Query(
            pkey,
            { schema: { hashKey: idName, rangeKey: sortName }, tableName: () => tableName },
            Serializer,
        );
        // _log(NS, '> query =', query);

        //! build query with builder.
        if (sortName) {
            const keyCondition = query.where(sortName);
            from !== -1 && to !== -1 ? keyCondition.between(from, to) : keyCondition.gte(0);
        }
        isDesc ? query.descending() : query.ascending();
        if (limit !== undefined) query.limit(limit);
        query.addKeyCondition(query.buildKey());
        if (last) {
            query.startKey(pkey, last);
        }

        //TODO - replace '@' prefix of properties.
        const payload = query.buildRequest();
        const filter = (N: any) =>
            Object.keys(N).reduce((O: any, key: string) => {
                const val = N[key];
                key = key.startsWith('#@') ? '#_' + key.substring(2) : key;
                key = key.startsWith(':@') ? ':_' + key.substring(2) : key;
                O[key] = val;
                return O;
            }, {});
        payload.ExpressionAttributeNames = filter(payload.ExpressionAttributeNames);
        payload.ExpressionAttributeValues = filter(payload.ExpressionAttributeValues);
        payload.KeyConditionExpression = payload.KeyConditionExpression.replace(/([\#\:])@/g, '$1_');
        _log(NS, `> payload[${pkey}] =`, $U.json(payload));

        //! get instance of dynamodoc, and execute query().
        const { dynamodoc } = DynamoService.instance();
        const res = await dynamodoc.query(payload).promise();
        if (res) {
            // _log(NS, `> query[${pkey}].res =`, $U.json(res)); // `startKey`
            const items: unknown[] = res.Items || [];
            const count = res.Count;
            const scannedCount = res.ScannedCount;
            const $lek = res.LastEvaluatedKey || {};
            const last = $U.N($lek[sortName], 0);
            _log(NS, `> query[${pkey}].items.len =`, items.length);
            _log(NS, `> query[${pkey}].count =`, count);
            _log(NS, `> query[${pkey}].scannedCount =`, scannedCount);
            _log(NS, `> query[${pkey}].lastKey =`, last);
            //! prepare result-set
            const result: DynamoQueryResult<T> = {
                list: items as T[],
                count,
                last,
            };
            return result;
        }

        //! avoid null exception
        return { list: [] };
    }
}
