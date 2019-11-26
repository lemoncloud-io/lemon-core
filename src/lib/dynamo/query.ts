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

import _ from 'lodash';
import * as expressions from './expressions';
import * as utils from './utils';

const internals: any = {};

internals.keyCondition = function(keyName: any, schema: any, query: any) {
    var f = function(operator: any) {
        return function(/*values*/) {
            var copy = [].slice.call(arguments);
            var existingValueKeys = _.keys(query.request.ExpressionAttributeValues);
            var args = [keyName, operator, existingValueKeys].concat(copy);
            var cond = expressions.buildFilterExpression.apply(null, args);
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

internals.queryFilter = function(keyName: any, schema: any, query: any) {
    var f = function(operator: any) {
        return function(/*values*/) {
            var copy = [].slice.call(arguments);
            var existingValueKeys = _.keys(query.request.ExpressionAttributeValues);
            var args = [keyName, operator, existingValueKeys].concat(copy);
            var cond = expressions.buildFilterExpression.apply(null, args);
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

internals.isUsingGlobalIndex = function(query: any) {
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

    public limit = function(num: any) {
        if (num <= 0) {
            throw new Error('Limit must be greater than 0');
        }

        this.request.Limit = num;

        return this;
    };

    public filterExpression = function(expression: any) {
        this.request.FilterExpression = expression;

        return this;
    };

    public expressionAttributeValues = function(data: any) {
        this.request.ExpressionAttributeValues = data;

        return this;
    };

    public expressionAttributeNames = function(data: any) {
        this.request.ExpressionAttributeNames = data;

        return this;
    };

    public projectionExpression = function(data: any) {
        this.request.ProjectionExpression = data;

        return this;
    };

    public usingIndex = function(name: any) {
        this.request.IndexName = name;

        return this;
    };

    public consistentRead = function(read: any) {
        if (!_.isBoolean(read)) {
            read = true;
        }

        this.request.ConsistentRead = read;

        return this;
    };

    public addKeyCondition = function(condition: any) {
        internals.addExpressionAttributes(this.request, condition);

        if (_.isString(this.request.KeyConditionExpression)) {
            this.request.KeyConditionExpression =
                this.request.KeyConditionExpression + ' AND (' + condition.statement + ')';
        } else {
            this.request.KeyConditionExpression = '(' + condition.statement + ')';
        }

        return this;
    };

    public addFilterCondition = function(condition: any) {
        internals.addExpressionAttributes(this.request, condition);

        if (_.isString(this.request.FilterExpression)) {
            this.request.FilterExpression = this.request.FilterExpression + ' AND (' + condition.statement + ')';
        } else {
            this.request.FilterExpression = '(' + condition.statement + ')';
        }

        return this;
    };

    public startKey = function(hashKey: any, rangeKey: any) {
        this.request.ExclusiveStartKey = this.serializer.buildKey(hashKey, rangeKey, this.table.schema);

        return this;
    };

    public attributes = function(attrs: any) {
        if (!_.isArray(attrs)) {
            attrs = [attrs];
        }

        var expressionAttributeNames = _.reduce(
            attrs,
            function(result: any, attr: any) {
                var path = '#' + attr;
                result[path] = attr;

                return result;
            },
            {},
        );

        this.request.ProjectionExpression = _.keys(expressionAttributeNames).join(',');
        this.request.ExpressionAttributeNames = _.merge(
            {},
            expressionAttributeNames,
            this.request.ExpressionAttributeNames,
        );

        return this;
    };

    public ascending = function() {
        this.request.ScanIndexForward = true;

        return this;
    };

    public descending = function() {
        this.request.ScanIndexForward = false;

        return this;
    };

    public select = function(value: any) {
        this.request.Select = value;

        return this;
    };

    public returnConsumedCapacity = function(value: any) {
        if (_.isUndefined(value)) {
            value = 'TOTAL';
        }

        this.request.ReturnConsumedCapacity = value;

        return this;
    };

    public loadAll = function() {
        this.options.loadAll = true;

        return this;
    };

    public where = function(keyName: any) {
        return internals.keyCondition(keyName, this.table.schema, this);
    };

    public filter = function(keyName: any) {
        return internals.queryFilter(keyName, this.table.schema, this);
    };

    public exec = function(callback: any) {
        var self = this;

        this.addKeyCondition(this.buildKey());

        var runQuery = function(params: any, callback: any) {
            self.table.runQuery(params, callback);
        };

        return utils.paginatedRequest(self, runQuery, callback);
    };

    public buildKey = function() {
        var key: any = this.table.schema.hashKey;

        if (internals.isUsingGlobalIndex(this)) {
            key = this.table.schema.globalIndexes[this.request.IndexName].hashKey;
        }

        var existingValueKeys = _.keys(this.request.ExpressionAttributeValues);
        return expressions.buildFilterExpression(key, '=', existingValueKeys, this.hashKey);
    };

    public buildRequest = function() {
        return _.merge({}, this.request, { TableName: this.table.tableName() });
    };
}

internals.addExpressionAttributes = function(request: any, condition: any) {
    var expressionAttributeNames = _.merge({}, condition.attributeNames, request.ExpressionAttributeNames);
    var expressionAttributeValues = _.merge({}, condition.attributeValues, request.ExpressionAttributeValues);

    if (!_.isEmpty(expressionAttributeNames)) {
        request.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (!_.isEmpty(expressionAttributeValues)) {
        request.ExpressionAttributeValues = expressionAttributeValues;
    }
};

internals.formatAttributeValue = function(val: any) {
    if (_.isDate(val)) {
        return val.toISOString();
    }

    return val;
};

//! export default.
export default Query;
