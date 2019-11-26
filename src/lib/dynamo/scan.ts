// origin from: https://github.com/baseprime/dynamodb @20191106
// Copyright (c) 2016 Ryan Fitzgerald
/**
 * `scan.ts`
 * - scan
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

internals.keyCondition = function(keyName: any, schema: any, scan: any) {
    var f = function(operator: any) {
        return function(/*values*/) {
            var copy = [].slice.call(arguments);
            var existingValueKeys = _.keys(scan.request.ExpressionAttributeValues);
            var args = [keyName, operator, existingValueKeys].concat(copy);
            var cond = expressions.buildFilterExpression.apply(null, args);
            return scan.addFilterCondition(cond);
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
        notNull: f('attribute_exists'),
        contains: f('contains'),
        notContains: f('NOT contains'),
        in: f('IN'),
        beginsWith: f('begins_with'),
        between: f('BETWEEN'),
    };
};

class Scan {
    protected table: any;
    protected serializer: any;
    protected options: any;
    protected request: any;
    public constructor(table: any, serializer: any) {
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

    public addFilterCondition = function(condition: any) {
        var expressionAttributeNames = _.merge({}, condition.attributeNames, this.request.ExpressionAttributeNames);
        var expressionAttributeValues = _.merge({}, condition.attributeValues, this.request.ExpressionAttributeValues);

        if (!_.isEmpty(expressionAttributeNames)) {
            this.request.ExpressionAttributeNames = expressionAttributeNames;
        }

        if (!_.isEmpty(expressionAttributeValues)) {
            this.request.ExpressionAttributeValues = expressionAttributeValues;
        }

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

    public segments = function(segment: any, totalSegments: any) {
        this.request.Segment = segment;
        this.request.TotalSegments = totalSegments;

        return this;
    };

    public where = function(keyName: any) {
        return internals.keyCondition(keyName, this.table.schema, this);
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

    public exec = function(callback: any) {
        var self = this;

        var runScan = function(params: any, callback: any) {
            self.table.runScan(params, callback);
        };

        return utils.paginatedRequest(self, runScan, callback);
    };

    public loadAll = function() {
        this.options.loadAll = true;

        return this;
    };

    public buildRequest = function() {
        return _.merge({}, this.request, { TableName: this.table.tableName() });
    };
}

//! export default.
export default Scan;
