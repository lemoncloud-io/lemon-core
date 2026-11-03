// origin from: https://github.com/baseprime/dynamodb @20191106
// Copyright (c) 2016 Ryan Fitzgerald
/**
 * `query.ts`
 * - query
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 refactoring to ts via origin
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { isEmpty, merge } from './lang';
import * as expressions from './expressions';
import * as utils from './utils';

const internals: any = {};

internals.keyCondition = function (keyName: any, schema: any, query: any) {
    const f = function (operator: any) {
        return function (/*values*/) {
            const copy = [].slice.call(arguments);
            const existingValueKeys = Object.keys(query.request.ExpressionAttributeValues ?? {});
            const args = [keyName, operator, existingValueKeys].concat(copy);
            const cond = expressions.buildFilterExpression.apply(null, args);
            return query.addKeyCondition(cond);
        };
    };

    return {
        equals: f('='),
        eq: f('='),
        lte: f('<='),
        lt: f('<'),
        gte: f('>='),
        gt: f('>'),
        beginsWith: f('begins_with'),
        between: f('BETWEEN'),
    };
};

internals.queryFilter = function (keyName: any, schema: any, query: any) {
    const f = function (operator: any) {
        return function (/*values*/) {
            const copy = [].slice.call(arguments);
            const existingValueKeys = Object.keys(query.request.ExpressionAttributeValues ?? {});
            const args = [keyName, operator, existingValueKeys].concat(copy);
            const cond = expressions.buildFilterExpression.apply(null, args);
            return query.addFilterCondition(cond);
        };
    };

    return {
        equals: f('='),
        eq: f('='),
        ne: f('<>'),
        lte: f('<='),
        lt: f('<'),
        gte: f('>='),
        gt: f('>'),
        null: f('attribute_not_exists'),
        exists: f('attribute_exists'),
        contains: f('contains'),
        notContains: f('NOT contains'),
        in: f('IN'),
        beginsWith: f('begins_with'),
        between: f('BETWEEN'),
    };
};

internals.isUsingGlobalIndex = function (query: any) {
    return query.request.IndexName && query.table.schema.globalIndexes[query.request.IndexName];
};

/**
 * class: `Query`
 */
class Query {
    protected hashKey: any;
    protected table: any;
    protected serializer: any;
    protected options: any;
    protected request: any;
    public constructor(hashKey: any, table: any, serializer: any) {
        this.hashKey = hashKey;
        this.table = table;
        this.serializer = serializer;
        this.options = { loadAll: false };
        this.request = {};
    }

    public limit = function (num: any) {
        if (num <= 0) {
            throw new Error('Limit must be greater than 0');
        }

        this.request.Limit = num;

        return this;
    };

    public filterExpression = function (expression: any) {
        this.request.FilterExpression = expression;

        return this;
    };

    public expressionAttributeValues = function (data: any) {
        this.request.ExpressionAttributeValues = data;

        return this;
    };

    public expressionAttributeNames = function (data: any) {
        this.request.ExpressionAttributeNames = data;

        return this;
    };

    public projectionExpression = function (data: any) {
        this.request.ProjectionExpression = data;

        return this;
    };

    public usingIndex = function (name: any) {
        this.request.IndexName = name;

        return this;
    };

    public consistentRead = function (read: any) {
        if (typeof read !== 'boolean') {
            read = true;
        }

        this.request.ConsistentRead = read;

        return this;
    };

    public addKeyCondition = function (condition: any) {
        internals.addExpressionAttributes(this.request, condition);

        if (typeof this.request.KeyConditionExpression === 'string') {
            this.request.KeyConditionExpression =
                this.request.KeyConditionExpression + ' AND (' + condition.statement + ')';
        } else {
            this.request.KeyConditionExpression = '(' + condition.statement + ')';
        }

        return this;
    };

    public addFilterCondition = function (condition: any) {
        internals.addExpressionAttributes(this.request, condition);

        if (typeof this.request.FilterExpression === 'string') {
            this.request.FilterExpression = this.request.FilterExpression + ' AND (' + condition.statement + ')';
        } else {
            this.request.FilterExpression = '(' + condition.statement + ')';
        }

        return this;
    };

    public startKey = function (hashKey: any, rangeKey: any) {
        this.request.ExclusiveStartKey = this.serializer.buildKey(hashKey, rangeKey, this.table.schema);

        return this;
    };

    public attributes = function (attrs: any) {
        if (!Array.isArray(attrs)) {
            attrs = [attrs];
        }

        //* `#attr` → `attr` name map for the projection.
        const expressionAttributeNames = attrs.reduce(function (result: any, attr: any) {
            const path = '#' + attr;
            result[path] = attr;

            return result;
        }, {});

        this.request.ProjectionExpression = Object.keys(expressionAttributeNames).join(',');
        this.request.ExpressionAttributeNames = merge(
            {},
            expressionAttributeNames,
            this.request.ExpressionAttributeNames,
        );

        return this;
    };

    public ascending = function () {
        this.request.ScanIndexForward = true;

        return this;
    };

    public descending = function () {
        this.request.ScanIndexForward = false;

        return this;
    };

    public select = function (value: any) {
        this.request.Select = value;

        return this;
    };

    public returnConsumedCapacity = function (value: any) {
        if (value === undefined) {
            value = 'TOTAL';
        }

        this.request.ReturnConsumedCapacity = value;

        return this;
    };

    public loadAll = function () {
        this.options.loadAll = true;

        return this;
    };

    public where = function (keyName: any) {
        return internals.keyCondition(keyName, this.table.schema, this);
    };

    public filter = function (keyName: any) {
        return internals.queryFilter(keyName, this.table.schema, this);
    };

    public exec = function (callback: any) {
        const self = this;

        this.addKeyCondition(this.buildKey());

        const runQuery = function (params: any, callback: any) {
            self.table.runQuery(params, callback);
        };

        return utils.paginatedRequest(self, runQuery, callback);
    };

    public buildKey = function () {
        let key: any = this.table.schema.hashKey;

        if (internals.isUsingGlobalIndex(this)) {
            key = this.table.schema.globalIndexes[this.request.IndexName].hashKey;
        }

        const existingValueKeys = Object.keys(this.request.ExpressionAttributeValues ?? {});
        return expressions.buildFilterExpression(key, '=', existingValueKeys, this.hashKey);
    };

    //* the request with `TableName`, as a deep copy (nested key and value maps are not shared).
    public buildRequest = function () {
        return merge({}, this.request, { TableName: this.table.tableName() });
    };
}

internals.addExpressionAttributes = function (request: any, condition: any) {
    const expressionAttributeNames = merge({}, condition.attributeNames, request.ExpressionAttributeNames);
    const expressionAttributeValues = merge({}, condition.attributeValues, request.ExpressionAttributeValues);

    if (!isEmpty(expressionAttributeNames)) {
        request.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (!isEmpty(expressionAttributeValues)) {
        request.ExpressionAttributeValues = expressionAttributeValues;
    }
};

internals.formatAttributeValue = function (val: any) {
    if (val instanceof Date) {
        return val.toISOString();
    }

    return val;
};

//* export default.
export default Query;
