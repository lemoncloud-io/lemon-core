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

import _ from 'lodash';
import $async from 'async';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AWSUtil = require('aws-sdk/lib/util');

export const omitNulls = (data: any) => {
    return _.omitBy(data, function(value) {
        return (
            _.isNull(value) ||
            _.isUndefined(value) ||
            (_.isArray(value) && _.isEmpty(value)) ||
            (_.isString(value) && _.isEmpty(value))
        );
    });
};

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

    const merged = _.reduce(
        responses,
        (memo: any, resp: any) => {
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
        },
        result,
    );

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
    let responses = [] as any[];
    let retry = false;

    var doFunc = function(callback: any) {
        if (lastEvaluatedKey) {
            self.startKey(lastEvaluatedKey);
        }

        runRequestFunc(self.buildRequest(), function(err: any, resp: any) {
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

    var testFunc = function() {
        return (self.options.loadAll && lastEvaluatedKey) || retry;
    };

    var resulsFunc = function(err: any) {
        if (err) {
            return callback(err);
        }

        return callback(null, mergeResults(responses, self.table.tableName()));
    };

    $async.doWhilst(doFunc, testFunc, resulsFunc);
};

export const omitPrimaryKeys = function(schema: any, params: any) {
    return _.omit(params, schema.hashKey, schema.rangeKey);
};

export const strToBin = function(value: any) {
    if (typeof value !== 'string') {
        var StrConversionError = 'Need to pass in string primitive to be converted to binary.';
        throw new Error(StrConversionError);
    }

    if (AWSUtil.isBrowser()) {
        var len = value.length;
        var bin = new Uint8Array(new ArrayBuffer(len));
        for (var i = 0; i < len; i++) {
            bin[i] = value.charCodeAt(i);
        }
        return bin;
    } else {
        return AWSUtil.Buffer(value);
    }
};
