// origin from: https://github.com/baseprime/dynamodb @20191106
// Copyright (c) 2016 Ryan Fitzgerald
/**
 * `expressions.ts`
 * - expressions
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 refactoring to ts via origin
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */

import _ from 'lodash';
import * as utils from './utils';
import serializer from './serializer';

const internals: any = {};

internals.actionWords = ['SET', 'ADD', 'REMOVE', 'DELETE'];

internals.regexMap = _.reduce(
    internals.actionWords,
    function(result: any, key: any) {
        result[key] = new RegExp(key + '\\s*(.+?)\\s*(SET|ADD|REMOVE|DELETE|$)');
        return result;
    },
    {},
);

// explanation http://stackoverflow.com/questions/3428618/regex-to-find-commas-that-arent-inside-and
internals.splitOperandsRegex = new RegExp(/\s*(?![^(]*\)),\s*/);

internals.match = function(actionWord: any, str: any) {
    var match = internals.regexMap[actionWord].exec(str);

    if (match && match.length >= 2) {
        return match[1].split(internals.splitOperandsRegex);
    } else {
        return null;
    }
};

export const parse = function(str: any) {
    return _.reduce(
        internals.actionWords,
        function(result: any, actionWord: any) {
            result[actionWord] = internals.match(actionWord, str);
            return result;
        },
        {},
    );
};

export const serializeUpdateExpression = function(schema: any, item: any) {
    var datatypes = schema._modelDatatypes;

    var data = utils.omitPrimaryKeys(schema, item);

    var memo = {
        expressions: {},
        attributeNames: {},
        values: {},
    };

    memo.expressions = _.reduce(
        internals.actionWords,
        function(result: any, key: any) {
            result[key] = [];

            return result;
        },
        {},
    );

    const result = _.reduce(
        data,
        function(result: any, value: any, key: any) {
            var valueKey = ':' + key;
            var nameKey = '#' + key;

            if (_.isNull(value) || (_.isString(value) && _.isEmpty(value))) {
                result.expressions.REMOVE.push(nameKey);
                result.attributeNames[nameKey] = key;
            } else if (_.isPlainObject(value) && value.$add) {
                result.expressions.ADD.push(nameKey + ' ' + valueKey);
                result.values[valueKey] = serializer.serializeAttribute(value.$add, datatypes[key]);
                result.attributeNames[nameKey] = key;
            } else if (_.isPlainObject(value) && value.$del) {
                result.expressions.DELETE.push(nameKey + ' ' + valueKey);
                result.values[valueKey] = serializer.serializeAttribute(value.$del, datatypes[key]);
                result.attributeNames[nameKey] = key;
            } else {
                result.expressions.SET.push(nameKey + ' = ' + valueKey);
                result.values[valueKey] = serializer.serializeAttribute(value, datatypes[key]);
                result.attributeNames[nameKey] = key;
            }

            return result;
        },
        memo,
    );

    return result;
};

export const stringify = function(expressions: any) {
    return _.reduce(
        expressions,
        function(result: any, value: any, key: any) {
            if (!_.isEmpty(value)) {
                if (_.isArray(value)) {
                    result.push(key + ' ' + value.join(', '));
                } else {
                    result.push(key + ' ' + value);
                }
            }

            return result;
        },
        [],
    ).join(' ');
};

internals.formatAttributeValue = function(val: any) {
    if (_.isDate(val)) {
        return val.toISOString();
    }

    return val;
};

internals.isFunctionOperator = function(operator: any) {
    return _.includes(
        [
            'attribute_exists',
            'attribute_not_exists',
            'attribute_type',
            'begins_with',
            'contains',
            'NOT contains',
            'size',
        ],
        operator,
    );
};

internals.uniqAttributeValueName = function(key: any, existingValueNames: any) {
    var potentialName = ':' + key;
    var idx = 1;

    while (_.includes(existingValueNames, potentialName)) {
        idx++;
        potentialName = ':' + key + '_' + idx;
    }

    return potentialName;
};

export const buildFilterExpression = function(key: any, operator: any, existingValueNames: any, val1: any, val2?: any) {
    // IN filter expression is unlike all the others where val1 is an array of values
    if (operator === 'IN') {
        return internals.buildInFilterExpression(key, existingValueNames, val1);
    }

    var v1 = internals.formatAttributeValue(val1);
    var v2 = internals.formatAttributeValue(val2);

    if (operator === 'attribute_exists' && v1 === false) {
        operator = 'attribute_not_exists';
        v1 = null;
    } else if (operator === 'attribute_exists' && v1 === true) {
        v1 = null;
    }

    var path = '#' + key;
    var v1ValueName = internals.uniqAttributeValueName(key, existingValueNames);
    var v2ValueName = internals.uniqAttributeValueName(key, [v1ValueName].concat(existingValueNames));

    var statement = '';

    if (internals.isFunctionOperator(operator)) {
        if (!_.isNull(v1) && !_.isUndefined(v1)) {
            statement = operator + '(' + path + ', ' + v1ValueName + ')';
        } else {
            statement = operator + '(' + path + ')';
        }
    } else if (operator === 'BETWEEN') {
        statement = path + ' BETWEEN ' + v1ValueName + ' AND ' + v2ValueName;
    } else {
        statement = [path, operator, v1ValueName].join(' ');
    }

    var attributeValues: any = {};

    if (!_.isNull(v1) && !_.isUndefined(v1)) {
        attributeValues[v1ValueName] = v1;
    }

    if (!_.isNull(v2) && !_.isUndefined(v2)) {
        attributeValues[v2ValueName] = v2;
    }

    var attributeNames: any = {};
    attributeNames[path] = key;

    return {
        attributeNames: attributeNames,
        statement: statement,
        attributeValues: attributeValues,
    };
};

internals.buildInFilterExpression = function(key: any, existingValueNames: any, values: any) {
    var path = '#' + key;

    var attributeNames: any = {};
    attributeNames[path] = key;

    var attributeValues = _.reduce(
        values,
        function(result: any, val: any) {
            var existing = _.keys(result).concat(existingValueNames);
            var p = internals.uniqAttributeValueName(key, existing);
            result[p] = internals.formatAttributeValue(val);
            return result;
        },
        {},
    );

    return {
        attributeNames: attributeNames,
        statement: path + ' IN (' + _.keys(attributeValues) + ')',
        attributeValues: attributeValues,
    };
};
