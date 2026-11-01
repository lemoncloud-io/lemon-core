/**
 * `utils.b18.spec.ts`
 * - v5 B18-a: offline unit tests for the dynamo `tools/utils` helpers (no AWS).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { mergeResults, omitNulls, omitPrimaryKeys, paginatedRequest, strToBin } from './utils';
import { isEmpty } from './lang';

//* v5 B18: drain the `setImmediate` callbacks queued by `paginatedRequest` (no timers, no clock).
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('dynamo/tools/utils (B18)', () => {
    it('B18 omitNulls() drops null, undefined, empty array and empty string', () => {
        const data = { a: null as any, b: undefined as any, c: [] as any[], d: '', e: 0, f: 'x', g: [1], h: false };
        expect(omitNulls(data)).toEqual({ e: 0, f: 'x', g: [1], h: false });
        expect(omitNulls(undefined)).toEqual({});
    });

    it('B18 lang.isEmpty() is true for other primitives', () => {
        expect([0, 1, true, Symbol('s')].map(isEmpty)).toEqual([true, true, true, true]);
    });

    it('B18 omitPrimaryKeys() drops the hash and range keys only', () => {
        expect(omitPrimaryKeys({ hashKey: 'id', rangeKey: 's' }, { id: 1, s: 2, a: 3 })).toEqual({ a: 3 });
        expect(omitPrimaryKeys({ hashKey: 'id' }, { id: 1, s: 2 })).toEqual({ s: 2 });
    });

    it('B18 strToBin() converts a string, and rejects others', () => {
        expect(strToBin('ab')).toEqual(Buffer.from('ab'));
        expect(() => strToBin(1)).toThrow('Need to pass in string primitive to be converted to binary.');
    });

    it('B18 mergeResults() on nothing drops the empty capacity and scanned count', () => {
        expect(mergeResults(undefined, 'T')).toEqual({ Items: [], Count: 0 });
        expect(mergeResults([], 'T')).toEqual({ Items: [], Count: 0 });
    });

    it('B18 mergeResults() sums counts and capacity, concats items, keeps the last key', () => {
        const responses = [
            null,
            {
                Count: 2,
                ScannedCount: 3,
                ConsumedCapacity: { CapacityUnits: 1.5 },
                Items: [{ id: 1 }, { id: 2 }],
                LastEvaluatedKey: { id: 2 },
            },
            { Count: 1, ConsumedCapacity: {}, Items: [{ id: 3 }] },
            {},
        ];
        expect(mergeResults(responses, 'T')).toEqual({
            Items: [{ id: 1 }, { id: 2 }, { id: 3 }],
            ConsumedCapacity: { CapacityUnits: 1.5, TableName: 'T' },
            Count: 3,
            ScannedCount: 3,
            LastEvaluatedKey: { id: 2 },
        });
    });

    it('B18 paginatedRequest() requires a callback', () => {
        expect(() => paginatedRequest({}, vi.fn(), undefined)).toThrow('@callback is required');
    });

    it('B18 paginatedRequest() passes a non-retryable error to the callback', async () => {
        const self = { options: {}, buildRequest: () => ({ TableName: 'T' }), startKey: vi.fn(), table: {} };
        const err = new Error('boom');
        const run = vi.fn((_req: any, cb: any) => cb(err));
        const done = vi.fn();
        paginatedRequest(self, run, done);
        await tick();
        await tick();
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0]).toEqual({ TableName: 'T' });
        expect(done).toHaveBeenCalledWith(err);
        expect(self.startKey).not.toHaveBeenCalled();
    });

    //* v5 B22: the `doWhilst` test now calls back, so a success ends with the merged results.
    it('B22 paginatedRequest() calls back with the merged results after a success', async () => {
        const self = {
            options: {},
            buildRequest: () => ({ TableName: 'T' }),
            startKey: vi.fn(),
            table: { tableName: () => 'T' },
        };
        const run = vi.fn((_req: any, cb: any) =>
            cb(null, { Count: 1, Items: [{ id: 1 }], LastEvaluatedKey: { id: 1 } }),
        );
        const done = vi.fn();
        paginatedRequest(self, run, done);
        await tick();
        await tick();
        expect(run).toHaveBeenCalledTimes(1);
        expect(self.startKey).not.toHaveBeenCalled();
        expect(done).toHaveBeenCalledWith(null, { Items: [{ id: 1 }], Count: 1, LastEvaluatedKey: { id: 1 } });
    });

    //* v5 B22: `loadAll` follows `LastEvaluatedKey` to the next page and merges both pages.
    it('B22 paginatedRequest() loads all pages with loadAll', async () => {
        const self = {
            options: { loadAll: true },
            buildRequest: () => ({ TableName: 'T' }),
            startKey: vi.fn(),
            table: { tableName: () => 'T' },
        };
        const pages = [
            { Count: 1, ScannedCount: 1, Items: [{ id: 1 }], LastEvaluatedKey: { id: 1 } },
            { Count: 1, ScannedCount: 2, Items: [{ id: 2 }] },
        ];
        const run = vi.fn((_req: any, cb: any) => cb(null, pages[run.mock.calls.length - 1]));
        const done = vi.fn();
        paginatedRequest(self, run, done);
        for (let i = 0; i < 6; i++) await tick();
        expect(run).toHaveBeenCalledTimes(2);
        expect(self.startKey).toHaveBeenCalledTimes(1);
        expect(self.startKey).toHaveBeenCalledWith({ id: 1 });
        expect(done).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith(null, {
            Items: [{ id: 1 }, { id: 2 }],
            Count: 2,
            ScannedCount: 3,
            LastEvaluatedKey: { id: 1 },
        });
    });

    //* v5 B22: a retryable error runs the request once more, then calls back with the results.
    it('B22 paginatedRequest() retries a retryable error once, then calls back', async () => {
        const self = {
            options: {},
            buildRequest: () => ({ TableName: 'T' }),
            startKey: vi.fn(),
            table: { tableName: () => 'T' },
        };
        const run = vi.fn((_req: any, cb: any) =>
            run.mock.calls.length === 1 ? cb({ retryable: true }) : cb(null, { Count: 1, Items: [{ id: 9 }] }),
        );
        const done = vi.fn();
        paginatedRequest(self, run, done);
        for (let i = 0; i < 6; i++) await tick();
        expect(run).toHaveBeenCalledTimes(2);
        expect(self.startKey).not.toHaveBeenCalled();
        expect(done).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith(null, { Items: [{ id: 9 }], Count: 1 });
    });
});
