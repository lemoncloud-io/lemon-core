/**
 * `utils.spec.ts`
 * - unit test for `utils`
 *
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2025-11-24 initial version.
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import { expect2 } from '../../../common/test-helper';
import { loadProfile } from '../../../environ';
import { omitNulls, mergeResults, omitPrimaryKeys, strToBin, paginatedRequest } from './utils';
import $async from 'async';
const runWithSyncDoWhilst = async (fn: () => Promise<void>) => {
    const doWhilstSpy = jest
        .spyOn($async as any, 'doWhilst')
        .mockImplementation(
            (doFunc: (cb: (err?: any) => void) => void, testFunc: () => boolean, resFunc: (err?: any) => void) => {
                const iterate = () => {
                    doFunc((err?: any) => {
                        if (err) return resFunc(err);
                        if (testFunc()) return iterate();
                        return resFunc();
                    });
                };
                iterate();
            },
        );

    try {
        await fn();
    } finally {
        doWhilstSpy.mockRestore();
    }
};

//! main test body.
describe('utils', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* test omitNulls function
    it('should pass omitNulls', async () => {
        //* omitNulls test
        // 1. validate data parameter test
        expect2(() => omitNulls(null)).toEqual({});
        expect2(() => omitNulls(undefined)).toEqual({});
        expect2(() => omitNulls({})).toEqual({});

        // 2. test filtering null, undefined, empty array, empty string
        const dataWithNulls = {
            validString: 'hello',
            validNumber: 123,
            validBoolean: true,
            validZero: 0,
            validFalse: false,
            nullValue: null as any,
            undefinedValue: undefined as any,
            emptyArray: [] as any[],
            emptyString: '',
            nonEmptyArray: [1, 2, 3],
            nonEmptyString: 'test',
        };

        const result = omitNulls(dataWithNulls);
        expect2(() => result).toEqual({
            validString: 'hello',
            validNumber: 123,
            validBoolean: true,
            validZero: 0,
            validFalse: false,
            nonEmptyArray: [1, 2, 3],
            nonEmptyString: 'test',
        });

        // 3. test edge cases
        expect2(() => omitNulls({ onlyNull: null })).toEqual({});
        expect2(() => omitNulls({ nested: { value: 'test' } })).toEqual({ nested: { value: 'test' } });
        expect2(() => omitNulls({ arr: [null, undefined, ''] })).toEqual({ arr: [null, undefined, ''] });
    });

    //* test mergeResults function
    it('should pass mergeResults', async () => {
        //* mergeResults test
        // 1. validate parameters test
        const tableName = 'TestTable';

        // empty responses
        expect2(() => mergeResults([], tableName)).toEqual({
            Items: [],
            Count: 0,
        });

        // 2. test single response merge
        const response1 = {
            Items: [{ id: '1', name: 'test1' }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: {
                CapacityUnits: 5,
            },
        };

        const merged1 = mergeResults([response1], tableName);
        expect2(() => merged1).toEqual({
            Items: [{ id: '1', name: 'test1' }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: {
                CapacityUnits: 5,
                TableName: tableName,
            },
        });

        // 3. test multiple responses merge
        const response2 = {
            Items: [{ id: '2', name: 'test2' }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: {
                CapacityUnits: 3,
            },
        };

        const merged2 = mergeResults([response1, response2], tableName);
        expect2(() => merged2).toEqual({
            Items: [
                { id: '1', name: 'test1' },
                { id: '2', name: 'test2' },
            ],
            Count: 2,
            ScannedCount: 2,
            ConsumedCapacity: {
                CapacityUnits: 8,
                TableName: tableName,
            },
        });

        // 4. test with LastEvaluatedKey
        const response3 = {
            Items: [{ id: '3', name: 'test3' }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: {
                CapacityUnits: 2,
            },
            LastEvaluatedKey: { id: '3' },
        };

        const merged3 = mergeResults([response1, response3], tableName);
        expect2(() => merged3).toEqual({
            Items: [
                { id: '1', name: 'test1' },
                { id: '3', name: 'test3' },
            ],
            Count: 2,
            ScannedCount: 2,
            ConsumedCapacity: {
                CapacityUnits: 7,
                TableName: tableName,
            },
            LastEvaluatedKey: { id: '3' },
        });

        // 5. test with null response (should be skipped)
        const merged4 = mergeResults([response1, null, response2], tableName);
        expect2(() => merged4).toEqual({
            Items: [
                { id: '1', name: 'test1' },
                { id: '2', name: 'test2' },
            ],
            Count: 2,
            ScannedCount: 2,
            ConsumedCapacity: {
                CapacityUnits: 8,
                TableName: tableName,
            },
        });

        // 6. test with zero ConsumedCapacity (should be removed)
        const response5 = {
            Items: [] as any[],
            Count: 0,
            ScannedCount: 0,
        };

        const merged5 = mergeResults([response5], tableName);
        expect2(() => merged5).toEqual({
            Items: [],
            Count: 0,
        });

        // 7. test with zero ScannedCount (should be removed)
        const response6 = {
            Items: [{ id: '6', name: 'test6' }],
            Count: 1,
            ScannedCount: 0,
            ConsumedCapacity: {
                CapacityUnits: 1,
            },
        };

        const merged6 = mergeResults([response6], tableName);
        expect2(() => merged6).toEqual({
            Items: [{ id: '6', name: 'test6' }],
            Count: 1,
            ConsumedCapacity: {
                CapacityUnits: 1,
                TableName: tableName,
            },
        });
    });

    //* test paginatedRequest function - callback validation
    it('should pass paginatedRequest callback validation', () => {
        const mockSelf = {
            options: { loadAll: false },
            startKey: jest.fn(),
            buildRequest: jest.fn(),
            table: {
                tableName: jest.fn(() => 'TestTable'),
            },
        };

        const mockRunRequestFunc = jest.fn();

        // callback is required
        try {
            paginatedRequest(mockSelf, mockRunRequestFunc, null as any);
            expect2(() => 'should have thrown').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('@callback is required');
        }
    });

    //* test paginatedRequest function - single page
    it('should pass paginatedRequest single page', async () => {
        jest.useRealTimers();

        const mockSelf = {
            options: { loadAll: false },
            startKey: jest.fn(),
            buildRequest: jest.fn(() => ({ table: 'TestTable' })),
            table: {
                tableName: jest.fn(() => 'TestTable'),
            },
        };

        const mockResponse = {
            Items: [{ id: '1', name: 'test1' }],
            Count: 1,
            ScannedCount: 1,
        };

        const mockRunRequestFunc = jest.fn((req: any, cb: any) => {
            cb(null, mockResponse);
        });

        await runWithSyncDoWhilst(
            () =>
                new Promise<void>((resolve, reject) => {
                    paginatedRequest(mockSelf, mockRunRequestFunc, (err: any, result: any) => {
                        try {
                            expect2(() => err).toEqual(null);
                            expect2(() => result.Items.length).toEqual(1);
                            expect2(() => result.Count).toEqual(1);
                            expect2(() => result.ScannedCount).toEqual(1);
                            expect2(() => mockRunRequestFunc).toHaveBeenCalledTimes(1);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });
                }),
        );
    }, 15000);

    //* test paginatedRequest function - error handling
    it('should pass paginatedRequest error handling', async () => {
        jest.useRealTimers();

        const mockSelf = {
            options: { loadAll: false },
            startKey: jest.fn(),
            buildRequest: jest.fn(() => ({ table: 'TestTable' })),
            table: {
                tableName: jest.fn(() => 'TestTable'),
            },
        };

        const mockRunRequestFunc = jest.fn((req: any, cb: any) => {
            cb(new Error('Request failed'), null);
        });

        await runWithSyncDoWhilst(
            () =>
                new Promise<void>((resolve, reject) => {
                    paginatedRequest(mockSelf, mockRunRequestFunc, (err: any) => {
                        try {
                            expect2(() => err.message).toEqual('Request failed');
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });
                }),
        );
    }, 15000);

    //* test omitPrimaryKeys function
    it('should pass omitPrimaryKeys', async () => {
        //* omitPrimaryKeys test
        // 1. validate parameters test
        const schema = {
            hashKey: 'id',
            rangeKey: 'sortKey',
        };

        // 2. test omitting both hash and range keys
        const params1 = {
            id: '123',
            sortKey: 'abc',
            name: 'test',
            value: 100,
        };

        const result1 = omitPrimaryKeys(schema, params1);
        expect2(() => result1).toEqual({
            name: 'test',
            value: 100,
        });

        // 3. test omitting only hash key (no range key)
        const schema2 = {
            hashKey: 'id',
            rangeKey: undefined as any,
        };

        const params2 = {
            id: '456',
            name: 'test2',
            value: 200,
        };

        const result2 = omitPrimaryKeys(schema2, params2);
        expect2(() => result2).toEqual({
            name: 'test2',
            value: 200,
        });

        // 4. test with empty params
        const result3 = omitPrimaryKeys(schema, {});
        expect2(() => result3).toEqual({});

        // 5. test with params not containing keys
        const params3 = {
            name: 'test3',
            value: 300,
        };

        const result4 = omitPrimaryKeys(schema, params3);
        expect2(() => result4).toEqual({
            name: 'test3',
            value: 300,
        });
    });

    //* test strToBin function
    it('should pass strToBin', async () => {
        //* strToBin test
        // 1. validate value parameter test
        try {
            strToBin(null);
            expect2(() => 'should have thrown').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('Need to pass in string primitive to be converted to binary.');
        }

        try {
            strToBin(undefined);
            expect2(() => 'should have thrown').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('Need to pass in string primitive to be converted to binary.');
        }

        try {
            strToBin(123);
            expect2(() => 'should have thrown').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('Need to pass in string primitive to be converted to binary.');
        }

        try {
            strToBin({} as any);
            expect2(() => 'should have thrown').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('Need to pass in string primitive to be converted to binary.');
        }

        // 2. test successful conversion
        const str1 = 'hello';
        const buffer1 = strToBin(str1);
        expect2(() => Buffer.isBuffer(buffer1)).toEqual(true);
        expect2(() => buffer1.toString()).toEqual(str1);

        // 3. test with empty string
        const str2 = '';
        const buffer2 = strToBin(str2);
        expect2(() => Buffer.isBuffer(buffer2)).toEqual(true);
        expect2(() => buffer2.toString()).toEqual(str2);
        expect2(() => buffer2.length).toEqual(0);

        // 4. test with unicode characters
        const str3 = '한글테스트';
        const buffer3 = strToBin(str3);
        expect2(() => Buffer.isBuffer(buffer3)).toEqual(true);
        expect2(() => buffer3.toString()).toEqual(str3);

        // 5. test with special characters
        const str4 = '!@#$%^&*()_+';
        const buffer4 = strToBin(str4);
        expect2(() => Buffer.isBuffer(buffer4)).toEqual(true);
        expect2(() => buffer4.toString()).toEqual(str4);

        // 6. test with long string
        const str5 = 'a'.repeat(10000);
        const buffer5 = strToBin(str5);
        expect2(() => Buffer.isBuffer(buffer5)).toEqual(true);
        expect2(() => buffer5.length).toEqual(10000);
        expect2(() => buffer5.toString()).toEqual(str5);
    });
});
