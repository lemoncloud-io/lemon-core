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
import { isObject, isPlainObject, mapValues } from './lang';
import * as utils from './utils';
// eslint-disable-next-line @typescript-eslint/no-var-requires
// const DocClient = require('aws-sdk/lib/dynamodb/document_client');
//* for local testing. (use `npm install --save-dev aws-sdk@2.1354`)
// import AWS from 'aws-sdk';
// const DocClient = AWS.DynamoDB.DocumentClient;

const serializer = {} as any;

const internals = {
    // docClient: new DocClient(),
    createSet: function (value: any, opt?: string) {
        //INFO - opt out `aws-sdk` dependency.
        // if (_.isArray(value)) {
        //     return internals.docClient.createSet(value);
        // } else {
        //     return internals.docClient.createSet([value]);
        // }
        if (Array.isArray(value)) {
            return JSON.parse(JSON.stringify(value));
        } else {
            return JSON.parse(JSON.stringify([value]));
        }
    },
    serialize: {
        binary: function (value: any) {
            if (typeof value === 'string') {
                return utils.strToBin(value);
            }

            return value;
        },

        date: function (value: any) {
            if (value instanceof Date) {
                return value.toISOString();
            } else {
                return new Date(value).toISOString();
            }
        },

        boolean: function (value: any) {
            if (value && value !== 'false') {
                return true;
            } else {
                return false;
            }
        },

        stringSet: function (value: any) {
            return internals.createSet(value, 'S');
        },

        numberSet: function (value: any) {
            return internals.createSet(value, 'N');
        },

        binarySet: function (value: any) {
            let bins = value;
            if (!Array.isArray(value)) {
                bins = [value];
            }

            const vals = bins.map((bin: any) => serialize.binary(bin));
            return internals.createSet(vals, 'B');
        },
    },

    deserializeAttribute: (value: any) => {
        if (
            isObject(value) &&
            typeof (value as any).detectType === 'function' &&
            Array.isArray((value as any).values)
        ) {
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

        if (value === null) {
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
//* build the key item from a key object (with index keys) or from hash and range values.
serializer.buildKey = (hashKey: any, rangeKey: any, schema: any) => {
    const obj: any = {};

    if (isPlainObject(hashKey)) {
        obj[schema.hashKey] = hashKey[schema.hashKey];

        if (schema.rangeKey && hashKey[schema.rangeKey] !== null && hashKey[schema.rangeKey] !== undefined) {
            obj[schema.rangeKey] = hashKey[schema.rangeKey];
        }
        //* copy the global index keys present in the key object.
        Object.values(schema.globalIndexes ?? {}).forEach(function (keys: any) {
            if (Object.hasOwn(hashKey, keys.hashKey)) {
                obj[keys.hashKey] = hashKey[keys.hashKey];
            }

            if (Object.hasOwn(hashKey, keys.rangeKey)) {
                obj[keys.rangeKey] = hashKey[keys.rangeKey];
            }
        });

        //* copy the local index range keys present in the key object.
        Object.values(schema.secondaryIndexes ?? {}).forEach(function (keys: any) {
            if (Object.hasOwn(hashKey, keys.rangeKey)) {
                obj[keys.rangeKey] = hashKey[keys.rangeKey];
            }
        });
    } else {
        obj[schema.hashKey] = hashKey;

        if (schema.rangeKey && rangeKey !== null && rangeKey !== undefined) {
            obj[schema.rangeKey] = rangeKey;
        }
    }

    return serializer.serializeItem(schema, obj);
};

serializer.serializeItem = (schema: any, item: any, options: any) => {
    options = options || {};

    const serialize = function (item: any, datatypes: any) {
        datatypes = datatypes || {};

        if (!item) {
            return null;
        }

        //* serialize each attribute by its datatype (nested objects and typed lists recurse).
        return Object.entries(item).reduce(function (result: any, [key, val]: [string, any]) {
            if (options.expected && isObject(val) && typeof (val as any).Exists === 'boolean') {
                result[key] = val;
                return result;
            }

            if (isPlainObject(val)) {
                result[key] = serialize(val, datatypes[key]);
                return result;
            }

            if (Array.isArray(val) && Array.isArray(datatypes[key])) {
                result[key] = val.map(function (item: any) {
                    return serialize(item, datatypes[key][0]);
                });

                return result;
            }

            const attr = internals.serializeAttribute(val, datatypes[key], options);

            if (attr !== null || options.returnNulls) {
                if (options.expected) {
                    result[key] = { Value: attr };
                } else {
                    result[key] = attr;
                }
            }

            return result;
        }, {});
    };

    return serialize(item, schema._modelDatatypes);
};

serializer.serializeItemForUpdate = function (schema: any, action: any, item: any) {
    const datatypes = schema._modelDatatypes;

    const data = utils.omitPrimaryKeys(schema, item);
    //* one update action per attribute (null → DELETE, `$add` → ADD, `$del` → DELETE, else the given action).
    return Object.entries(data ?? {}).reduce(function (result: any, [key, value]: [string, any]) {
        if (value === null) {
            result[key] = { Action: 'DELETE' };
        } else if (isPlainObject(value) && value.$add) {
            result[key] = { Action: 'ADD', Value: internals.serializeAttribute(value.$add, datatypes[key]) };
        } else if (isPlainObject(value) && value.$del) {
            result[key] = { Action: 'DELETE', Value: internals.serializeAttribute(value.$del, datatypes[key]) };
        } else {
            result[key] = { Action: action, Value: internals.serializeAttribute(value, datatypes[key]) };
        }

        return result;
    }, {});
};

serializer.deserializeItem = function (item: any) {
    if (item === null) {
        return null;
    }

    //* walk objects and arrays, turning document-client sets back into arrays.
    const formatter = (data: any): any => {
        const each = function (value: any) {
            let result;

            if (isPlainObject(value)) {
                result = formatter(value);
            } else if (Array.isArray(value)) {
                result = formatter(value);
            } else {
                result = internals.deserializeAttribute(value);
            }

            return result;
        };
        return Array.isArray(data) ? data.map(value => each(value)) : mapValues(data, value => each(value));
    };

    return formatter(item);
};

//* export default
export default serializer;
