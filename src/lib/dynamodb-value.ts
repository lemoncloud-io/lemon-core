/**
 * file: `dynamodb-value.ts`
 * - originally inspired via https://github.com/ironSource/node-dynamodb-value
 * - refactoring for typescript error.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import _ from 'lodash';

/**
 * converts a ddb object into a js object
 *
 */
export function toJavascript(data: any, mergeInto: any = null) {
    const result = mergeInto || {};
    const keys = Object.keys(data);

    for (let i = 0; i < keys.length; i++) {
        const p = keys[i];
        result[p] = toJsValue(data[p]);
    }

    return result;
}

/**
 * converts a js object into a ddb object
 *
 */
export function toDDB(data: any, mergeInto: any = null) {
    const result = mergeInto || {};
    const keys = Object.keys(data);

    for (let i = 0; i < keys.length; i++) {
        const p = keys[i];
        result[p] = toDDBValue(data[p]);
    }

    return result;
}

function toJsValue(entry: any) {
    const types = Object.keys(entry);

    // TODO maybe it would be better to create a property with undefined value for this ?
    if (types.length === 0) throw new Error('missing type for ' + entry);

    const type = types[0];
    const val = entry[type];

    if (type === 'NULL' && val === true) {
        return null;
    }

    if (type === 'N') {
        return Number(val);
    }

    if (type === 'M') {
        return toJavascript(val);
    }

    if (type === 'L') {
        return toJsArray(val);
    }

    return val;
}

function toJsArray(arr: any) {
    const val = new Array(arr.length);

    for (var x = 0; x < arr.length; x++) {
        val[x] = toJsValue(arr[x]);
    }

    return val;
}

function toDDBValue(val: any) {
    if (typeof val === 'string') {
        return { S: val };
    }

    if (typeof val === 'number') {
        return { N: val.toString() };
    }

    if (typeof val === 'boolean') {
        return { BOOL: val };
    }

    if (_.isArray(val)) {
        var result = new Array(val.length);

        for (var i = 0; i < result.length; i++) {
            result[i] = toDDBValue(val[i]);
        }

        return { L: result };
    }

    // TODO add checks for regexp, date and others
    // then throw if needed

    if (typeof val === 'object') {
        return { M: toDDB(val) };
    }
}
