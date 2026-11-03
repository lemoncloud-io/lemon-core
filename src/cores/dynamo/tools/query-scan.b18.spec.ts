/**
 * `query.b18.spec.ts`
 * - v5 B18-a: offline unit tests for the dynamo `tools/query` and `tools/scan` builders (no AWS).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import Query from './query';
import Scan from './scan';
import Serializer from './serializer';

//* v5 B18: a table stub as the builders use it (schema + name, and the run hooks that `exec()` calls).
const asTable = (run?: any) => ({
    schema: { hashKey: 'id', rangeKey: 's', globalIndexes: { G: { hashKey: 'gh' } } },
    tableName: () => 'T',
    runQuery: run,
    runScan: run,
});

//* v5 B18: drain the `setImmediate` callbacks queued by `paginatedRequest`.
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('dynamo/tools/query (B18)', () => {
    it('B18 sets the plain request fields', () => {
        const q: any = new Query('h', asTable(), Serializer);
        expect(() => q.limit(0)).toThrow('Limit must be greater than 0');
        q.limit(5)
            .filterExpression('#x = :x')
            .expressionAttributeValues({ ':x': 1 })
            .expressionAttributeNames({ '#x': 'x' })
            .projectionExpression('#x')
            .usingIndex('L')
            .consistentRead('yes')
            .select('COUNT')
            .returnConsumedCapacity()
            .loadAll();
        expect(q.request).toEqual({
            Limit: 5,
            FilterExpression: '#x = :x',
            ExpressionAttributeValues: { ':x': 1 },
            ExpressionAttributeNames: { '#x': 'x' },
            ProjectionExpression: '#x',
            IndexName: 'L',
            ConsistentRead: true,
            Select: 'COUNT',
            ReturnConsumedCapacity: 'TOTAL',
        });
        expect(q.options).toEqual({ loadAll: true });
        q.consistentRead(false).returnConsumedCapacity('NONE').ascending();
        expect(q.request.ConsistentRead).toBe(false);
        expect(q.request.ReturnConsumedCapacity).toBe('NONE');
        expect(q.request.ScanIndexForward).toBe(true);
        expect(q.descending().request.ScanIndexForward).toBe(false);
    });

    it('B18 where() builds key conditions, joined by AND', () => {
        const q: any = new Query('h', asTable(), Serializer);
        q.where('s').between(1, 9);
        q.where('s').gte(2);
        expect(q.request.KeyConditionExpression).toEqual('(#s BETWEEN :s AND :s_2) AND (#s >= :s_3)');
        expect(q.request.ExpressionAttributeValues).toEqual({ ':s': 1, ':s_2': 9, ':s_3': 2 });
        expect(q.request.ExpressionAttributeNames).toEqual({ '#s': 's' });
        const ops = ['equals', 'eq', 'lte', 'lt', 'gte', 'gt', 'beginsWith', 'between'];
        expect(Object.keys(q.where('s'))).toEqual(ops);
        const q2: any = new Query('h', asTable(), Serializer);
        q2.where('s').beginsWith('p');
        expect(q2.request.KeyConditionExpression).toEqual('(begins_with(#s, :s))');
    });

    it('B18 filter() builds filter conditions, joined by AND', () => {
        const q: any = new Query('h', asTable(), Serializer);
        q.filter('a').ne(1);
        q.filter('b').in([1, 2]);
        q.filter('c').exists();
        q.filter('d').null();
        q.filter('e').notContains('z');
        expect(q.request.FilterExpression).toEqual(
            '(#a <> :a) AND (#b IN (:b,:b_2)) AND (attribute_exists(#c)) AND (attribute_not_exists(#d)) AND (NOT contains(#e, :e))',
        );
        expect(q.request.ExpressionAttributeValues).toEqual({ ':a': 1, ':b': 1, ':b_2': 2, ':e': 'z' });
        expect(Object.keys(q.filter('a'))).toEqual([
            'equals',
            'eq',
            'ne',
            'lte',
            'lt',
            'gte',
            'gt',
            'null',
            'exists',
            'contains',
            'notContains',
            'in',
            'beginsWith',
            'between',
        ]);
    });

    it('B18 startKey() and attributes()', () => {
        const q: any = new Query('h', asTable(), Serializer);
        q.startKey('h', 3);
        expect(q.request.ExclusiveStartKey).toEqual({ id: 'h', s: 3 });
        q.expressionAttributeNames({ '#z': 'z' }).attributes('a');
        expect(q.request.ProjectionExpression).toEqual('#a');
        q.attributes(['a', 'b']);
        expect(q.request.ProjectionExpression).toEqual('#a,#b');
        expect(q.request.ExpressionAttributeNames).toEqual({ '#a': 'a', '#b': 'b', '#z': 'z' });
    });

    it('B18 buildKey() uses the global index hash key', () => {
        const q: any = new Query('h', asTable(), Serializer);
        expect(q.buildKey().statement).toEqual('#id = :id');
        q.usingIndex('G');
        expect(q.buildKey()).toEqual({
            attributeNames: { '#gh': 'gh' },
            statement: '#gh = :gh',
            attributeValues: { ':gh': 'h' },
        });
        q.usingIndex('L');
        expect(q.buildKey().statement).toEqual('#id = :id');
    });

    it('B18 buildRequest() is a deep copy with TableName', () => {
        const q: any = new Query('h', asTable(), Serializer);
        q.addKeyCondition(q.buildKey());
        const req = q.buildRequest();
        expect(req).toEqual({
            TableName: 'T',
            KeyConditionExpression: '(#id = :id)',
            ExpressionAttributeNames: { '#id': 'id' },
            ExpressionAttributeValues: { ':id': 'h' },
        });
        req.ExpressionAttributeValues[':id'] = 'changed';
        expect(q.request.ExpressionAttributeValues[':id']).toEqual('h');
    });

    it('B18 exec() adds the hash key condition and passes an error back', async () => {
        const err = new Error('boom');
        const run = vi.fn((_params: any, cb: any) => cb(err));
        const q: any = new Query('h', asTable(run), Serializer);
        const done = vi.fn();
        q.exec(done);
        await tick();
        await tick();
        expect(run.mock.calls[0][0]).toEqual({
            TableName: 'T',
            KeyConditionExpression: '(#id = :id)',
            ExpressionAttributeNames: { '#id': 'id' },
            ExpressionAttributeValues: { ':id': 'h' },
        });
        expect(done).toHaveBeenCalledWith(err);
        expect(() => new (Query as any)('h', asTable(run), Serializer).exec()).toThrow('@callback is required');
    });
});

describe('dynamo/tools/scan (B18)', () => {
    it('B18 sets the plain request fields', () => {
        const s: any = new Scan(asTable(), Serializer);
        expect(() => s.limit(-1)).toThrow('Limit must be greater than 0');
        s.limit(3)
            .select('ALL_ATTRIBUTES')
            .returnConsumedCapacity()
            .segments(1, 4)
            .filterExpression('#x = :x')
            .expressionAttributeValues({ ':x': 1 })
            .expressionAttributeNames({ '#x': 'x' })
            .projectionExpression('#x')
            .loadAll();
        expect(s.request).toEqual({
            Limit: 3,
            Select: 'ALL_ATTRIBUTES',
            ReturnConsumedCapacity: 'TOTAL',
            Segment: 1,
            TotalSegments: 4,
            FilterExpression: '#x = :x',
            ExpressionAttributeValues: { ':x': 1 },
            ExpressionAttributeNames: { '#x': 'x' },
            ProjectionExpression: '#x',
        });
        expect(s.options).toEqual({ loadAll: true });
        expect(s.returnConsumedCapacity('INDEXES').request.ReturnConsumedCapacity).toEqual('INDEXES');
    });

    it('B18 where() builds filter conditions, joined by AND', () => {
        const s: any = new Scan(asTable(), Serializer);
        s.where('a').eq(1);
        s.where('a').notNull();
        s.where('b').contains('x');
        s.where('c').between(1, 2);
        expect(s.request.FilterExpression).toEqual(
            '(#a = :a) AND (attribute_exists(#a)) AND (contains(#b, :b)) AND (#c BETWEEN :c AND :c_2)',
        );
        expect(s.request.ExpressionAttributeNames).toEqual({ '#a': 'a', '#b': 'b', '#c': 'c' });
        expect(s.request.ExpressionAttributeValues).toEqual({ ':a': 1, ':b': 'x', ':c': 1, ':c_2': 2 });
        expect(Object.keys(s.where('a'))).toEqual([
            'equals',
            'eq',
            'ne',
            'lte',
            'lt',
            'gte',
            'gt',
            'null',
            'notNull',
            'contains',
            'notContains',
            'in',
            'beginsWith',
            'between',
        ]);
        //* v5 B18: a condition without names or values leaves the maps unset.
        const s2: any = new Scan(asTable(), Serializer);
        s2.addFilterCondition({ statement: 'x' });
        expect(s2.request).toEqual({ FilterExpression: '(x)' });
    });

    it('B18 startKey(), attributes() and buildRequest()', () => {
        const s: any = new Scan(asTable(), Serializer);
        s.startKey({ id: 'a', s: 1 });
        s.attributes('a');
        s.attributes(['a', 'b']);
        const req = s.buildRequest();
        expect(req).toEqual({
            TableName: 'T',
            ExclusiveStartKey: { id: 'a', s: 1 },
            ProjectionExpression: '#a,#b',
            ExpressionAttributeNames: { '#a': 'a', '#b': 'b' },
        });
        req.ExclusiveStartKey.id = 'changed';
        expect(s.request.ExclusiveStartKey.id).toEqual('a');
    });

    it('B18 exec() passes an error back', async () => {
        const err = new Error('scan-fail');
        const run = vi.fn((_params: any, cb: any) => cb(err));
        const s: any = new Scan(asTable(run), Serializer);
        const done = vi.fn();
        s.limit(1).exec(done);
        await tick();
        await tick();
        expect(run.mock.calls[0][0]).toEqual({ TableName: 'T', Limit: 1 });
        expect(done).toHaveBeenCalledWith(err);
    });
});
