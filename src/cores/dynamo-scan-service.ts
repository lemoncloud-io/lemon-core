/**
 * `dynamo-scan-service.ts`
 * - common service to scan with filters+sort via dynamo
 *
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-01-20 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { _log, _inf, $U } from '../engine/';
import { GeneralItem } from './core-types';
import { DynamoOption, DynamoService } from './dynamo-service';
const NS = $U.NS('DSCN', 'green'); // NAMESPACE TO BE PRINTED.

// ComparisonCondition - arithmetic comparison (EQ, NE, LE, LT, GE, GT)
// - NOTE: '!=' is shortcut to { not: { comparator: '=' } }
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

/**
 * interface: DynamoScanFilter
 * - for joining multiple conditions with logical AND -> Array
 * - for joining multiple conditions with logical OR -> { or: Array }
 */
type Condition = ComparisonCondition | BetweenCondition | ExistenceCondition | StringCondition;
export type DynamoScanFilter = (Condition | { not: Condition }) | DynamoScanFilter[] | { or: DynamoScanFilter[] };

/**
 * class: DynamoScanResult
 * - result information of scan.
 */
export interface DynamoScanResult<T> {
    // list of data
    list: T[];
    // number of data
    count?: number;
    // last evaluated key for pagination
    last?: any;
}

/**
 * feature: `DynamoSimpleScannable`
 * - simple scan capable class.
 */
export interface DynamoSimpleScannable<T extends GeneralItem> {
    /**
     * simple filtered scan w/ limit.
     *
     * @param limit     limit of page
     * @param last      the last evaluated key
     * @param filter    scan filter
     */
    scan(limit?: number, last?: any, filter?: DynamoScanFilter): Promise<DynamoScanResult<T>>;
}

/** ****************************************************************************************************************
 *  Service Main
 ** ****************************************************************************************************************/
import Scan from '../lib/dynamo/scan';
import Serializer from '../lib/dynamo/serializer';

/**
 * class: `DynamoScanService`
 * - support simple scan like range scan.
 */
export class DynamoScanService<T extends GeneralItem> implements DynamoSimpleScannable<T> {
    protected options: DynamoOption;

    public constructor(options: DynamoOption) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `DynamoScanService(${options.tableName}/${options.idName}${options.sortName ? '/' : ''}${options.sortName || ''})...`);
        if (!options.tableName) throw new Error('.tableName is required');
        if (!options.idName) throw new Error('.idName is required');
        this.options = options;
    }

    /**
     * say hello of identity.
     */
    public hello = () => `dynamo-scan-service:${this.options.tableName}`;

    public async scan(limit?: number, last?: any, filter?: DynamoScanFilter): Promise<DynamoScanResult<T>> {
        _log(NS, `scan()...`);

        //! build scan input payload
        const payload = this.buildPayload(limit, last, filter);
        _log(NS, `> payload =`, $U.json(payload));

        //! get instance of dynamodoc, and execute query().
        const { dynamodoc } = DynamoService.instance();
        const res = await dynamodoc.scan(payload).promise();
        _log(NS, `> scan.res =`, $U.json(res));

        const items: unknown[] = res.Items || [];
        const count = res.Count;
        const scannedCount = res.ScannedCount;
        const $lek = res.LastEvaluatedKey || {};
        _log(NS, `> scan.items.len =`, items.length);
        _log(NS, `> scan.count =`, count);
        _log(NS, `> scan.scannedCount =`, scannedCount);
        _log(NS, `> scan.last =`, $lek);

        //! return result-set
        return {
            list: items as T[],
            count,
            last: $lek,
        };
    }

    private buildPayload(limit?: number, last?: any, filter?: DynamoScanFilter) {
        const { tableName, idName, sortName } = this.options;
        const scan = new Scan(
            { schema: { hashKey: idName, rangeKey: sortName }, tableName: () => tableName },
            Serializer,
        );

        // Limit & Last
        if (limit > 0) scan.limit(limit);
        if (last) scan.startKey(last[this.options.idName], last[this.options.sortName]);

        // Filter
        if (filter) {
            const expAttrNames: Record<string, string> = {};
            const expAttrValues: Record<string, string> = {};
            const asFilterExpression = (filter: DynamoScanFilter): string => {
                const asAttrName = (key: string): string => {
                    const attrNameVar = `#${key}`;
                    expAttrNames[attrNameVar] = key;
                    return attrNameVar;
                };
                const asAttrValue = (key: string, value: any): string => {
                    const attrValueVar = (function() {
                        for (let i = 0; ; i++) {
                            const valueVar = `:${key}${i}`;
                            if (!(valueVar in expAttrValues)) return valueVar;
                        }
                    })();
                    expAttrValues[attrValueVar] = value;
                    return attrValueVar;
                };

                if (Array.isArray(filter)) {
                    return `(${filter.map(asFilterExpression).join(' AND ')})`;
                } else if ('or' in filter && Array.isArray(filter.or)) {
                    return `(${filter.or.map(asFilterExpression).join(' OR ')})`;
                } else if ('not' in filter) {
                    return `NOT ${asFilterExpression(filter.not)}`;
                } else {
                    const cond = filter as Condition;

                    if (isComparisonCondition(cond)) {
                        const [name, value] = [asAttrName(cond.key), asAttrValue(cond.key, cond.value)];
                        return cond.comparator === '!='
                            ? `NOT ${name} = ${value}`
                            : `${name} ${cond.comparator} ${value}`;
                    } else if (isBetweenCondition(cond)) {
                        const [name, from, to] = [
                            asAttrName(cond.key),
                            asAttrValue(cond.key, cond.from),
                            asAttrValue(cond.key, cond.to),
                        ];
                        return `${name} BETWEEN ${from} AND ${to}`;
                    } else if (isExistenceCondition(cond)) {
                        const name = asAttrName(cond.key);
                        return cond.exists ? `attribute_exists(${name})` : `attribute_not_exists(${name})`;
                    } else if (isStringCondition(cond)) {
                        const [name, value] = [asAttrName(cond.key), asAttrValue(cond.key, cond.value)];
                        return `${cond.operator}(${name}, ${value})`;
                    }
                }
            };

            scan.filterExpression(asFilterExpression(filter));
            if (Object.keys(expAttrNames).length) scan.expressionAttributeNames(expAttrNames);
            if (Object.keys(expAttrValues).length) scan.expressionAttributeValues(expAttrValues);
        }

        return scan.buildRequest();
    }
}
