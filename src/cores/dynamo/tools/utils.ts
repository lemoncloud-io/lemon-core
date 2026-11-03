// origin from: https://github.com/baseprime/dynamodb @20191106
// Copyright (c) 2016 Ryan Fitzgerald
/**
 * `utils.ts`
 * - utils
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 refactoring to ts via origin
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { isEmpty, omitBy } from './lang';
import $async from 'async';
// eslint-disable-next-line @typescript-eslint/no-var-requires
// const AWSUtil = require('aws-sdk/lib/util');

//* drop null, undefined, empty array and empty string attributes.
export const omitNulls = (data: any) => {
    return omitBy(data, function (value: any) {
        return (
            value === null ||
            value === undefined ||
            (Array.isArray(value) && isEmpty(value)) ||
            (typeof value === 'string' && isEmpty(value))
        );
    });
};

//* merge paged responses into one result (items, counts, capacity, last key).
export const mergeResults = (responses: any, tableName: string) => {
    const result = {
        Items: [] as any[],
        ConsumedCapacity: {
            CapacityUnits: 0,
            TableName: tableName,
        },
        Count: 0,
        ScannedCount: 0,
    };

    const merged = (responses ?? []).reduce((memo: any, resp: any) => {
        if (!resp) {
            return memo;
        }

        memo.Count += resp.Count || 0;
        memo.ScannedCount += resp.ScannedCount || 0;

        if (resp.ConsumedCapacity) {
            memo.ConsumedCapacity.CapacityUnits += resp.ConsumedCapacity.CapacityUnits || 0;
        }

        if (resp.Items) {
            memo.Items = memo.Items.concat(resp.Items);
        }

        if (resp.LastEvaluatedKey) {
            memo.LastEvaluatedKey = resp.LastEvaluatedKey;
        }

        return memo;
    }, result);

    if (merged.ConsumedCapacity.CapacityUnits === 0) {
        delete merged.ConsumedCapacity;
    }

    if (merged.ScannedCount === 0) {
        delete merged.ScannedCount;
    }

    return merged;
};

export const paginatedRequest = (self: any, runRequestFunc: any, callback: any) => {
    // if callback isn't passed switch to stream
    if (!callback) {
        throw new Error('@callback is required');
    }

    let lastEvaluatedKey = null as any;
    const responses = [] as any[];
    let retry = false;

    const doFunc = function (callback: any) {
        if (lastEvaluatedKey) {
            self.startKey(lastEvaluatedKey);
        }

        runRequestFunc(self.buildRequest(), function (err: any, resp: any) {
            if (err && err.retryable) {
                retry = true;
                return setImmediate(callback);
            } else if (err) {
                retry = false;
                return setImmediate(callback, err);
            }

            retry = false;
            lastEvaluatedKey = resp.LastEvaluatedKey;

            responses.push(resp);

            return setImmediate(callback);
        });
    };

    //* v5 B22: `async@3` calls the test as `test(...args, cb)` and waits for `cb` (a returned boolean is ignored).
    const testFunc = function (...args: any[]) {
        const check = args[args.length - 1];
        const again = !!((self.options.loadAll && lastEvaluatedKey) || retry);
        return check(null, again);
    };

    const resulsFunc = function (err: any) {
        if (err) {
            return callback(err);
        }

        return callback(null, mergeResults(responses, self.table.tableName()));
    };

    $async.doWhilst(doFunc, testFunc, resulsFunc);
};

//* copy the params without the hash and range key attributes.
export const omitPrimaryKeys = function (schema: any, params: any) {
    return omitBy(params, (_value: any, key: string) => key === schema.hashKey || key === schema.rangeKey);
};

export const strToBin = function (value: any): Buffer {
    if (typeof value !== 'string') {
        const StrConversionError = 'Need to pass in string primitive to be converted to binary.';
        throw new Error(StrConversionError);
    }

    // if (AWSUtil.isBrowser()) {
    //     const len = value.length;
    //     const bin = new Uint8Array(new ArrayBuffer(len));
    //     for (let i = 0; i < len; i++) {
    //         bin[i] = value.charCodeAt(i);
    //     }
    //     return bin;
    // } else {
    //     return AWSUtil.Buffer(value);
    // }
    return Buffer.from(value);
};
