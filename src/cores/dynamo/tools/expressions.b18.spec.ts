/**
 * `expressions.b18.spec.ts`
 * - v5 B18-a: offline unit tests for the dynamo `tools/expressions` builders (no AWS).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import { buildFilterExpression, parse, serializeUpdateExpression, stringify } from './expressions';

describe('dynamo/tools/expressions (B18)', () => {
    it('B18 parse() splits by action word', () => {
        expect(parse('SET #a = :a, #b = list_append(#b, :b) REMOVE #c ADD #d :d')).toEqual({
            SET: ['#a = :a', '#b = list_append(#b, :b)'],
            ADD: ['#d :d'],
            REMOVE: ['#c'],
            DELETE: null,
        });
        expect(parse('')).toEqual({ SET: null, ADD: null, REMOVE: null, DELETE: null });
    });

    it('B18 serializeUpdateExpression() groups attributes by action', () => {
        const schema = { hashKey: 'id', rangeKey: 's', _modelDatatypes: { e: 'NS' } };
        const item = { id: 1, s: 2, a: null as any, b: '', c: { $add: 2 }, d: { $del: 'x' }, e: 3, f: 'v' };
        expect(serializeUpdateExpression(schema, item)).toEqual({
            expressions: { SET: ['#e = :e', '#f = :f'], ADD: ['#c :c'], REMOVE: ['#a', '#b'], DELETE: ['#d :d'] },
            attributeNames: { '#a': 'a', '#b': 'b', '#c': 'c', '#d': 'd', '#e': 'e', '#f': 'f' },
            values: { ':c': 2, ':d': 'x', ':e': [3], ':f': 'v' },
        });
    });

    it('B18 stringify() joins the non-empty expressions', () => {
        expect(stringify({ SET: ['#a = :a', '#b = :b'], REMOVE: [], ADD: '#c :c', DELETE: null })).toEqual(
            'SET #a = :a, #b = :b ADD #c :c',
        );
        expect(stringify(undefined)).toEqual('');
    });

    it('B18 buildFilterExpression() for comparison operators', () => {
        expect(buildFilterExpression('a', '=', [], 1)).toEqual({
            attributeNames: { '#a': 'a' },
            statement: '#a = :a',
            attributeValues: { ':a': 1 },
        });
        //* v5 B18: an existing `:a` gives the next free name `:a_2`.
        expect(buildFilterExpression('a', '<>', [':a'], 'x')).toEqual({
            attributeNames: { '#a': 'a' },
            statement: '#a <> :a_2',
            attributeValues: { ':a_2': 'x' },
        });
        expect(buildFilterExpression('a', '<', undefined, 2).statement).toEqual('#a < :a');
        const at = new Date(Date.UTC(2026, 9, 30));
        expect(buildFilterExpression('t', '>=', [], at).attributeValues).toEqual({ ':t': at.toISOString() });
    });

    it('B18 buildFilterExpression() for BETWEEN', () => {
        expect(buildFilterExpression('a', 'BETWEEN', [], 1, 5)).toEqual({
            attributeNames: { '#a': 'a' },
            statement: '#a BETWEEN :a AND :a_2',
            attributeValues: { ':a': 1, ':a_2': 5 },
        });
    });

    it('B18 buildFilterExpression() for function operators', () => {
        expect(buildFilterExpression('a', 'begins_with', [], 'x')).toEqual({
            attributeNames: { '#a': 'a' },
            statement: 'begins_with(#a, :a)',
            attributeValues: { ':a': 'x' },
        });
        expect(buildFilterExpression('a', 'NOT contains', [], 'y').statement).toEqual('NOT contains(#a, :a)');
        expect(buildFilterExpression('a', 'attribute_not_exists', []).statement).toEqual('attribute_not_exists(#a)');
        expect(buildFilterExpression('a', 'attribute_exists', [], true)).toEqual({
            attributeNames: { '#a': 'a' },
            statement: 'attribute_exists(#a)',
            attributeValues: {},
        });
        expect(buildFilterExpression('a', 'attribute_exists', [], false)).toEqual({
            attributeNames: { '#a': 'a' },
            statement: 'attribute_not_exists(#a)',
            attributeValues: {},
        });
    });

    it('B18 buildFilterExpression() for IN', () => {
        expect(buildFilterExpression('a', 'IN', [':a'], [1, 2])).toEqual({
            attributeNames: { '#a': 'a' },
            statement: '#a IN (:a_2,:a_3)',
            attributeValues: { ':a_2': 1, ':a_3': 2 },
        });
        expect(buildFilterExpression('a', 'IN', [], undefined).statement).toEqual('#a IN ()');
    });
});
