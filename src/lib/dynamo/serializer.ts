// origin from: https://github.com/baseprime/dynamodb @20191106
// Copyright (c) 2016 Ryan Fitzgerald
/**
 * `serialize.ts`
 * - serialize
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 refactoring to ts via origin
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */

import _ from 'lodash';
import * as utils from './utils';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DocClient = require('aws-sdk/lib/dynamodb/document_client');

const serializer = {} as any;

const internals = {
    docClient: new DocClient(),
    createSet: function(value: any, opt?: string) {
        if (_.isArray(value)) {
            return internals.docClient.createSet(value);
        } else {
            return internals.docClient.createSet([value]);
        }
    },
    serialize: {
        binary: function(value: any) {
            if (_.isString(value)) {
                return utils.strToBin(value);
            }

            return value;
        },

        date: function(value: any) {
            if (_.isDate(value)) {
                return value.toISOString();
            } else {
                return new Date(value).toISOString();
            }
        },

        boolean: function(value: any) {
            if (value && value !== 'false') {
                return true;
            } else {
                return false;
            }
        },

        stringSet: function(value: any) {
            return internals.createSet(value, 'S');
        },

        numberSet: function(value: any) {
            return internals.createSet(value, 'N');
        },

        binarySet: function(value: any) {
            var bins = value;
            if (!_.isArray(value)) {
                bins = [value];
            }

            var vals = _.map(bins, serialize.binary);
            return internals.createSet(vals, 'B');
        },
    },

    deserializeAttribute: (value: any) => {
        if (_.isObject(value) && _.isFunction((value as any).detectType) && _.isArray((value as any).values)) {
            // value is a Set object from document client
            return (value as any).values;
        } else {
            return value;
        }
    },

    serializeAttribute: (value: any, type: any, options?: any) => {
        if (!type) {
            // if type is unknown, possibly because its an dynamic key return given value
            return value;
        }

        if (_.isNull(value)) {
            return null;
        }

        options = options || {};

        switch (type) {
            case 'DATE':
                return serialize.date(value);
            case 'BOOL':
                return serialize.boolean(value);
            case 'B':
                return serialize.binary(value);
            case 'NS':
                return serialize.numberSet(value);
            case 'SS':
                return serialize.stringSet(value);
            case 'BS':
                return serialize.binarySet(value);
            default:
                return value;
        }
    },
};

const serialize = internals.serialize;
serializer.serializeAttribute = internals.serializeAttribute;
serializer.buildKey = (hashKey: any, rangeKey: any, schema: any) => {
    const obj: any = {};

    if (_.isPlainObject(hashKey)) {
        obj[schema.hashKey] = hashKey[schema.hashKey];

        if (schema.rangeKey && !_.isNull(hashKey[schema.rangeKey]) && !_.isUndefined(hashKey[schema.rangeKey])) {
            obj[schema.rangeKey] = hashKey[schema.rangeKey];
        }
        _.each(schema.globalIndexes, function(keys) {
            if (_.has(hashKey, keys.hashKey)) {
                obj[keys.hashKey] = hashKey[keys.hashKey];
            }

            if (_.has(hashKey, keys.rangeKey)) {
                obj[keys.rangeKey] = hashKey[keys.rangeKey];
            }
        });

        _.each(schema.secondaryIndexes, function(keys) {
            if (_.has(hashKey, keys.rangeKey)) {
                obj[keys.rangeKey] = hashKey[keys.rangeKey];
            }
        });
    } else {
        obj[schema.hashKey] = hashKey;

        if (schema.rangeKey && !_.isNull(rangeKey) && !_.isUndefined(rangeKey)) {
            obj[schema.rangeKey] = rangeKey;
        }
    }

    return serializer.serializeItem(schema, obj);
};

serializer.serializeItem = (schema: any, item: any, options: any) => {
    options = options || {};

    var serialize = function(item: any, datatypes: any) {
        datatypes = datatypes || {};

        if (!item) {
            return null;
        }

        return _.reduce(
            item,
            function(result: any, val: any, key: any) {
                if (options.expected && _.isObject(val) && _.isBoolean((val as any).Exists)) {
                    result[key] = val;
                    return result;
                }

                if (_.isPlainObject(val)) {
                    result[key] = serialize(val, datatypes[key]);
                    return result;
                }

                if (_.isArray(val) && _.isArray(datatypes[key])) {
                    result[key] = _.map(val, function(item) {
                        return serialize(item, datatypes[key][0]);
                    });

                    return result;
                }

                var attr = internals.serializeAttribute(val, datatypes[key], options);

                if (!_.isNull(attr) || options.returnNulls) {
                    if (options.expected) {
                        result[key] = { Value: attr };
                    } else {
                        result[key] = attr;
                    }
                }

                return result;
            },
            {},
        );
    };

    return serialize(item, schema._modelDatatypes);
};

serializer.serializeItemForUpdate = function(schema: any, action: any, item: any) {
    const datatypes = schema._modelDatatypes;

    const data = utils.omitPrimaryKeys(schema, item);
    return _.reduce(
        data,
        function(result: any, value: any, key: any) {
            if (_.isNull(value)) {
                result[key] = { Action: 'DELETE' };
            } else if (_.isPlainObject(value) && value.$add) {
                result[key] = { Action: 'ADD', Value: internals.serializeAttribute(value.$add, datatypes[key]) };
            } else if (_.isPlainObject(value) && value.$del) {
                result[key] = { Action: 'DELETE', Value: internals.serializeAttribute(value.$del, datatypes[key]) };
            } else {
                result[key] = { Action: action, Value: internals.serializeAttribute(value, datatypes[key]) };
            }

            return result;
        },
        {},
    );
};

serializer.deserializeItem = function(item: any) {
    if (_.isNull(item)) {
        return null;
    }

    const formatter = (data: any): any => {
        let map: any = _.mapValues;

        if (_.isArray(data)) {
            map = _.map;
        }

        return map(data, function(value: any) {
            var result;

            if (_.isPlainObject(value)) {
                result = formatter(value);
            } else if (_.isArray(value)) {
                result = formatter(value);
            } else {
                result = internals.deserializeAttribute(value);
            }

            return result;
        });
    };

    return formatter(item);
};

//! export default
export default serializer;
