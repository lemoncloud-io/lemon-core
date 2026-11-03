/**
 * `dynamo-query-scan.b18.spec.ts`
 * - v5 B18-a: offline tests for `DynamoQueryService` and `DynamoScanService` (document client stubbed at `send()`).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneralItem } from 'lemon-model';
import { DynamoOption, DynamoService } from './dynamo-service';
import { DynamoQueryService } from './dynamo-query-service';
import { DynamoScanService } from './dynamo-scan-service';

interface MyModel extends GeneralItem {
    ID?: string;
}

//* v5 B18: fake document client; the services only call `DynamoService.instance().dynamodoc()` then `send()`.
const stubDoc = () => {
    const doc = { send: vi.fn() };
    vi.spyOn(DynamoService, 'instance').mockReturnValue({ dynamo: { send: vi.fn() }, dynamodoc: async () => doc });
    return doc;
};

//* v5 B18: the command class name and its input, from the n-th `send()` call.
const sent = (send: any, n = 0) => {
    const cmd = send.mock.calls[n][0];
    return { name: cmd.constructor.name, input: cmd.input };
};

const OPT: DynamoOption = { tableName: 'T', idName: 'ID', sortName: 'S' };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('DynamoQueryService offline (B18)', () => {
    it('B18 constructor needs tableName and idName', () => {
        expect(() => new DynamoQueryService({ tableName: '', idName: 'ID' })).toThrow('.tableName is required');
        expect(() => new DynamoQueryService({ tableName: 'T', idName: '' })).toThrow('.idName is required');
    });

    it('B18 buildQuery() with a sort key: range, limit, last, order', () => {
        const q = new DynamoQueryService<MyModel>(OPT);
        expect(q.buildQuery('p', 1, 9, 10, 5, true)).toEqual({
            TableName: 'T',
            KeyConditionExpression: '(#S BETWEEN :S AND :S_2) AND (#ID = :ID)',
            ExpressionAttributeNames: { '#S': 'S', '#ID': 'ID' },
            ExpressionAttributeValues: { ':S': 1, ':S_2': 9, ':ID': 'p' },
            ScanIndexForward: false,
            Limit: 10,
            ExclusiveStartKey: { ID: 'p', S: 5 },
        });
        expect(q.buildQuery('p', -1, -1).KeyConditionExpression).toEqual('(#S >= :S) AND (#ID = :ID)');
    });

    it('B18 buildQuery() renames `@` prefixed names to `_`', () => {
        const q = new DynamoQueryService<MyModel>({ tableName: 'T', idName: '@id', sortName: '@s' });
        expect(q.buildQuery('p', -1, -1)).toEqual({
            TableName: 'T',
            KeyConditionExpression: '(#_s >= :_s) AND (#_id = :_id)',
            ExpressionAttributeNames: { '#_s': '@s', '#_id': '@id' },
            ExpressionAttributeValues: { ':_s': 0, ':_id': 'p' },
            ScanIndexForward: true,
        });
    });

    it('B18 queryAll() / queryRange() send QueryCommand and map the result', async () => {
        const doc = stubDoc();
        const q = new DynamoQueryService<MyModel>(OPT);
        doc.send.mockResolvedValueOnce({
            Items: [{ ID: 'p', S: 1 }],
            Count: 1,
            ScannedCount: 2,
            LastEvaluatedKey: { S: 1 },
        });
        expect(await q.queryAll('p', 1, true)).toEqual({ list: [{ ID: 'p', S: 1 }], count: 1, last: 1 });
        expect(sent(doc.send)).toEqual({ name: 'QueryCommand', input: q.buildQuery('p', -1, -1, 1, null, true) });

        doc.send.mockResolvedValueOnce({ Count: 0 });
        expect(await q.queryRange('p', 2, 3, 5, 1)).toEqual({ list: [], count: 0, last: 0 });
        expect(sent(doc.send, 1).input).toEqual(q.buildQuery('p', 2, 3, 5, 1, false));

        doc.send.mockResolvedValueOnce(undefined);
        expect(await q.queryAll('p')).toEqual({ list: [] });
    });
});

describe('DynamoScanService offline (B18)', () => {
    it('B18 constructor needs tableName and idName', () => {
        expect(() => new DynamoScanService({ tableName: '', idName: 'ID' })).toThrow('.tableName is required');
        expect(() => new DynamoScanService({ tableName: 'T', idName: '' })).toThrow('.idName is required');
        expect(new DynamoScanService(OPT).hello()).toEqual('dynamo-scan-service:T');
    });

    it('B18 buildPayload() without a filter: limit and last key', () => {
        const s = new DynamoScanService<MyModel>(OPT);
        expect(s.buildPayload()).toEqual({ TableName: 'T' });
        expect(s.buildPayload(0, null)).toEqual({ TableName: 'T' });
        expect(s.buildPayload(3, { ID: 'a', S: 2, x: 1 })).toEqual({
            TableName: 'T',
            Limit: 3,
            ExclusiveStartKey: { ID: 'a', S: 2 },
        });
    });

    it('B18 buildPayload() turns each condition into an expression', () => {
        const s = new DynamoScanService<MyModel>(OPT);
        const filter: any = [
            { key: 'a', comparator: '=', value: 1 },
            { key: 'a', comparator: '!=', value: 2 },
            { key: 'b', from: 1, to: 5 },
            { key: 'c', exists: true },
            { key: 'd', exists: false },
            { key: 'e', operator: 'begins_with', value: 'x' },
            { or: [{ key: 'f', comparator: '<', value: 3 }, { not: { key: 'g', operator: 'contains', value: 'y' } }] },
        ];
        expect(s.buildPayload(undefined, undefined, filter)).toEqual({
            TableName: 'T',
            FilterExpression:
                '(#a = :a0 AND NOT #a = :a1 AND #b BETWEEN :b0 AND :b1 AND attribute_exists(#c) AND attribute_not_exists(#d)' +
                ' AND begins_with(#e, :e0) AND (#f < :f0 OR NOT contains(#g, :g0)))',
            ExpressionAttributeNames: { '#a': 'a', '#b': 'b', '#c': 'c', '#d': 'd', '#e': 'e', '#f': 'f', '#g': 'g' },
            ExpressionAttributeValues: { ':a0': 1, ':a1': 2, ':b0': 1, ':b1': 5, ':e0': 'x', ':f0': 3, ':g0': 'y' },
        });
    });

    it('B18 buildPayload() leaves the maps out when no name or value is used', () => {
        const s = new DynamoScanService<MyModel>(OPT);
        //* v5 B18: an empty AND list makes `()` with no names or values.
        expect(s.buildPayload(undefined, undefined, [])).toEqual({ TableName: 'T', FilterExpression: '()' });
        //* v5 B18: an unknown condition shape builds `undefined` as the expression (no branch matches).
        expect(s.buildPayload(undefined, undefined, { key: 'x' } as any)).toEqual({ TableName: 'T' });
    });

    it('B18 scan() sends ScanCommand and maps the result', async () => {
        const doc = stubDoc();
        const s = new DynamoScanService<MyModel>(OPT);
        doc.send.mockResolvedValueOnce({
            Items: [{ ID: 'a' }],
            Count: 1,
            ScannedCount: 4,
            LastEvaluatedKey: { ID: 'a', S: 1 },
        });
        const filter: any = { key: 'a', comparator: '>', value: 0 };
        expect(await s.scan(2, null, filter)).toEqual({ list: [{ ID: 'a' }], count: 1, last: { ID: 'a', S: 1 } });
        expect(sent(doc.send)).toEqual({ name: 'ScanCommand', input: s.buildPayload(2, null, filter) });

        doc.send.mockResolvedValueOnce({ Count: 0 });
        expect(await s.scan()).toEqual({ list: [], count: 0, last: {} });
    });
});
