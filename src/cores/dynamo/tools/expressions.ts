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
import { isEmpty, isPlainObject } from './lang';
import * as utils from './utils';
import serializer from './serializer';

const internals: any = {};

internals.actionWords = ['SET', 'ADD', 'REMOVE', 'DELETE'];

//* build one regex per action word.
internals.regexMap = internals.actionWords.reduce(function (result: any, key: any) {
    result[key] = new RegExp(key + '\\s*(.+?)\\s*(SET|ADD|REMOVE|DELETE|$)');
    return result;
}, {});

// explanation http://stackoverflow.com/questions/3428618/regex-to-find-commas-that-arent-inside-and
internals.splitOperandsRegex = new RegExp(/\s*(?![^(]*\)),\s*/);

internals.match = function (actionWord: any, str: any) {
    const match = internals.regexMap[actionWord].exec(str);

    if (match && match.length >= 2) {
        return match[1].split(internals.splitOperandsRegex);
    } else {
        return null;
    }
};

export const parse = function (str: any) {
    //* split the update expression by action word.
    return internals.actionWords.reduce(function (result: any, actionWord: any) {
        result[actionWord] = internals.match(actionWord, str);
        return result;
    }, {});
};

export const serializeUpdateExpression = function (schema: any, item: any) {
    const datatypes = schema._modelDatatypes;

    const data = utils.omitPrimaryKeys(schema, item);

    const memo = {
        expressions: {},
        attributeNames: {},
        values: {},
    };

    //* empty list per action word.
    memo.expressions = internals.actionWords.reduce(function (result: any, key: any) {
        result[key] = [];

        return result;
    }, {});

    //* walk the item attributes into REMOVE/ADD/DELETE/SET.
    const result = Object.entries(data ?? {}).reduce(function (result: any, [key, value]: [string, any]) {
        const valueKey = ':' + key;
        const nameKey = '#' + key;

        if (value === null || (typeof value === 'string' && isEmpty(value))) {
            result.expressions.REMOVE.push(nameKey);
            result.attributeNames[nameKey] = key;
        } else if (isPlainObject(value) && value.$add) {
            result.expressions.ADD.push(nameKey + ' ' + valueKey);
            result.values[valueKey] = serializer.serializeAttribute(value.$add, datatypes[key]);
            result.attributeNames[nameKey] = key;
        } else if (isPlainObject(value) && value.$del) {
            result.expressions.DELETE.push(nameKey + ' ' + valueKey);
            result.values[valueKey] = serializer.serializeAttribute(value.$del, datatypes[key]);
            result.attributeNames[nameKey] = key;
        } else {
            result.expressions.SET.push(nameKey + ' = ' + valueKey);
            result.values[valueKey] = serializer.serializeAttribute(value, datatypes[key]);
            result.attributeNames[nameKey] = key;
        }

        return result;
    }, memo);

    return result;
};

export const stringify = function (expressions: any) {
    //* join the non-empty expressions as `<ACTION> a, b`.
    return Object.entries(expressions ?? {})
        .reduce(function (result: any, [key, value]: [string, any]) {
            if (!isEmpty(value)) {
                if (Array.isArray(value)) {
                    result.push(key + ' ' + value.join(', '));
                } else {
                    result.push(key + ' ' + value);
                }
            }

            return result;
        }, [])
        .join(' ');
};

internals.formatAttributeValue = function (val: any) {
    if (val instanceof Date) {
        return val.toISOString();
    }

    return val;
};

//* whether the operator is written as a function, ex: `begins_with(#a, :a)`.
internals.isFunctionOperator = function (operator: any) {
    return [
        'attribute_exists',
        'attribute_not_exists',
        'attribute_type',
        'begins_with',
        'contains',
        'NOT contains',
        'size',
    ].includes(operator);
};

//* pick a value name `:key`, `:key_2`, ... not in the existing names.
internals.uniqAttributeValueName = function (key: any, existingValueNames: any) {
    let potentialName = ':' + key;
    let idx = 1;

    while ((existingValueNames ?? []).includes(potentialName)) {
        idx++;
        potentialName = ':' + key + '_' + idx;
    }

    return potentialName;
};

export const buildFilterExpression = function (
    key: any,
    operator: any,
    existingValueNames: any,
    val1: any,
    val2?: any,
) {
    // IN filter expression is unlike all the others where val1 is an array of values
    if (operator === 'IN') {
        return internals.buildInFilterExpression(key, existingValueNames, val1);
    }

    let v1 = internals.formatAttributeValue(val1);
    const v2 = internals.formatAttributeValue(val2);

    if (operator === 'attribute_exists' && v1 === false) {
        operator = 'attribute_not_exists';
        v1 = null;
    } else if (operator === 'attribute_exists' && v1 === true) {
        v1 = null;
    }

    const path = '#' + key;
    const v1ValueName = internals.uniqAttributeValueName(key, existingValueNames);
    const v2ValueName = internals.uniqAttributeValueName(key, [v1ValueName].concat(existingValueNames));

    let statement = '';

    if (internals.isFunctionOperator(operator)) {
        if (v1 !== null && v1 !== undefined) {
            statement = operator + '(' + path + ', ' + v1ValueName + ')';
        } else {
            statement = operator + '(' + path + ')';
        }
    } else if (operator === 'BETWEEN') {
        statement = path + ' BETWEEN ' + v1ValueName + ' AND ' + v2ValueName;
    } else {
        statement = [path, operator, v1ValueName].join(' ');
    }

    const attributeValues: any = {};

    if (v1 !== null && v1 !== undefined) {
        attributeValues[v1ValueName] = v1;
    }

    if (v2 !== null && v2 !== undefined) {
        attributeValues[v2ValueName] = v2;
    }

    const attributeNames: any = {};
    attributeNames[path] = key;

    return {
        attributeNames: attributeNames,
        statement: statement,
        attributeValues: attributeValues,
    };
};

internals.buildInFilterExpression = function (key: any, existingValueNames: any, values: any) {
    const path = '#' + key;

    const attributeNames: any = {};
    attributeNames[path] = key;

    //* one unique value name per IN value (an array; an object iterates its values).
    const attributeValues = Object.values(values ?? {}).reduce(function (result: any, val: any) {
        const existing = Object.keys(result).concat(existingValueNames);
        const p = internals.uniqAttributeValueName(key, existing);
        result[p] = internals.formatAttributeValue(val);
        return result;
    }, {});

    return {
        attributeNames: attributeNames,
        statement: path + ' IN (' + Object.keys(attributeValues) + ')',
        attributeValues: attributeValues,
    };
};
