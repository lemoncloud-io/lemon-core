/**
 * `dynamo.spec.ts`
 * - unit test for `dynamo/tools` modules
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 initial version
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '../../../common/test-helper';
import { strToBin, omitNulls, mergeResults, omitPrimaryKeys } from './utils';
import Serializer from './serializer';
import * as expressions from './expressions';
import Query from './query';
import Scan from './scan';

//! main test body.
describe('Dynamo/lib', () => {
    it('should pass AWSUtil', async () => {
        expect2(() => 'hi').toEqual('hi');
        expect2(() => strToBin('hi')).toEqual(Buffer.from('hi'));
        expect2(() => strToBin('hi').toString('utf8')).toEqual('hi');

        expect2(() => strToBin(null)).toEqual('Need to pass in string primitive to be converted to binary.');
        expect2(() => strToBin([])).toEqual('Need to pass in string primitive to be converted to binary.');
    });

    it('should pass serializer', async () => {
        expect2(() => 'hi').toEqual('hi');

        expect2(() => ['a']).toEqual(['a']);
        expect2(() => Serializer.serializeAttribute('a', 'S')).toEqual('a');

        expect2(() => Serializer.serializeAttribute('a')).toEqual('a');
        expect2(() => Serializer.serializeAttribute('')).toEqual('');
        expect2(() => Serializer.serializeAttribute(null)).toEqual(null);
        expect2(() => Serializer.serializeAttribute(undefined)).toEqual(undefined);

        //! WARN - `Received: serializes to the same string` => need to check compartibility.
        expect2(() => Serializer.serializeAttribute('a', 'SS')).toEqual(['a']);

        expect2(() => JSON.stringify(Serializer.serializeAttribute('a', 'SS'))).toEqual('["a"]');

        // expect2(() => AWSUtil.isBrowser()).toEqual();
        // expect2(() => AWSUtil.Buffer('')).toEqual();

        //TODO - check `scan.buildRequest()`
    });
});

describe('Dynamo/tools', () => {
    it('should pass tools/dynamo', async () => {
        //* strToBin test
        expect2(() => strToBin('hello')).toEqual(Buffer.from('hello'));
        expect2(() => strToBin('test').toString('utf8')).toEqual('test');
        expect2(() => strToBin(null as any)).toEqual('Need to pass in string primitive to be converted to binary.');
        expect2(() => strToBin([] as any)).toEqual('Need to pass in string primitive to be converted to binary.');
        expect2(() => strToBin(123 as any)).toEqual('Need to pass in string primitive to be converted to binary.');

        //* omitNulls test
        expect2(() => omitNulls({ a: 1, b: null })).toEqual({ a: 1 });
        expect2(() => omitNulls({ a: 1, b: undefined })).toEqual({ a: 1 });
        expect2(() => omitNulls({ a: 1, b: [] })).toEqual({ a: 1 });
        expect2(() => omitNulls({ a: 1, b: '' })).toEqual({ a: 1 });
        expect2(() => omitNulls({ a: 'hello', b: [1, 2], c: { d: 3 } })).toEqual({
            a: 'hello',
            b: [1, 2],
            c: { d: 3 },
        });
        expect2(() => omitNulls({})).toEqual({});

        //* mergeResults test
        const responses = [
            { Items: [{ id: 1 }], Count: 1, ScannedCount: 1, ConsumedCapacity: { CapacityUnits: 1 } },
            {
                Items: [{ id: 2 }],
                Count: 1,
                ScannedCount: 2,
                ConsumedCapacity: { CapacityUnits: 2 },
                LastEvaluatedKey: { id: 2 },
            },
        ];
        const merged = mergeResults(responses, 'test-table');
        expect2(() => merged.Items).toEqual([{ id: 1 }, { id: 2 }]);
        expect2(() => merged.Count).toEqual(2);
        expect2(() => merged.ScannedCount).toEqual(3);
        expect2(() => merged.ConsumedCapacity.CapacityUnits).toEqual(3);
        expect2(() => merged.LastEvaluatedKey).toEqual({ id: 2 });

        //* mergeResults with null response test
        const merged2 = mergeResults([{ Items: [{ id: 1 }], Count: 1, ScannedCount: 1 }, null], 'test-table');
        expect2(() => merged2.Items).toEqual([{ id: 1 }]);
        expect2(() => merged2.Count).toEqual(1);

        //* mergeResults with zero capacity test
        const merged3 = mergeResults([{ Items: [] as any[], Count: 0, ScannedCount: 0 }], 'test-table');
        expect2(() => merged3.ConsumedCapacity).toEqual(undefined);
        expect2(() => merged3.ScannedCount).toEqual(undefined);

        //* omitPrimaryKeys test
        const schema = { hashKey: 'id', rangeKey: 'sort' };
        const params = { id: 1, sort: 'a', data: 'test', name: 'item' };
        expect2(() => omitPrimaryKeys(schema, params)).toEqual({ data: 'test', name: 'item' });

        //* serializeAttribute test
        expect2(() => Serializer.serializeAttribute('test', 'S')).toEqual('test');
        expect2(() => Serializer.serializeAttribute('test')).toEqual('test');
        expect2(() => Serializer.serializeAttribute('')).toEqual('');
        expect2(() => Serializer.serializeAttribute(null)).toEqual(null);
        expect2(() => Serializer.serializeAttribute(undefined)).toEqual(undefined);
        expect2(() => Serializer.serializeAttribute(123, 'N')).toEqual(123);

        //* serializeAttribute DATE test
        const date = new Date('2025-01-01T00:00:00.000Z');
        expect2(() => Serializer.serializeAttribute(date, 'DATE')).toEqual('2025-01-01T00:00:00.000Z');
        expect2(() => Serializer.serializeAttribute('2025-01-01T00:00:00.000Z', 'DATE')).toEqual(
            '2025-01-01T00:00:00.000Z',
        );

        //* serializeAttribute BOOL test
        expect2(() => Serializer.serializeAttribute(true, 'BOOL')).toEqual(true);
        expect2(() => Serializer.serializeAttribute('true', 'BOOL')).toEqual(true);
        expect2(() => Serializer.serializeAttribute(false, 'BOOL')).toEqual(false);
        expect2(() => Serializer.serializeAttribute('false', 'BOOL')).toEqual(false);
        expect2(() => Serializer.serializeAttribute('', 'BOOL')).toEqual(false);

        //* serializeAttribute B (binary) test
        expect2(() => Serializer.serializeAttribute('hello', 'B')).toEqual(Buffer.from('hello'));
        expect2(() => Serializer.serializeAttribute(Buffer.from('test'), 'B')).toEqual(Buffer.from('test'));

        //* serializeAttribute NS test
        expect2(() => Serializer.serializeAttribute([1, 2, 3], 'NS')).toEqual([1, 2, 3]);
        expect2(() => Serializer.serializeAttribute(5, 'NS')).toEqual([5]);

        //* serializeAttribute SS test
        expect2(() => JSON.stringify(Serializer.serializeAttribute('a', 'SS'))).toEqual('["a"]');
        expect2(() => JSON.stringify(Serializer.serializeAttribute(['a', 'b'], 'SS'))).toEqual('["a","b"]');

        //* serializeAttribute BS test
        const result = Serializer.serializeAttribute(['a', 'b'], 'BS');
        expect2(() => result.length).toEqual(2);
        const singleResult = Serializer.serializeAttribute('single', 'BS');
        expect2(() => singleResult.length).toEqual(1);

        //* buildKey test
        const schema2 = {
            hashKey: 'id',
            rangeKey: 'sort',
            globalIndexes: { 'gsi-index': { hashKey: 'gsi1', rangeKey: 'gsi2' } },
            secondaryIndexes: { 'lsi-index': { rangeKey: 'lsi1' } },
            _modelDatatypes: {},
        };
        const key = { id: '123', sort: 'abc', gsi1: 'g1', gsi2: 'g2', lsi1: 'l1' };
        const result2 = Serializer.buildKey(key, null, schema2);
        expect2(() => result2, 'id,sort,gsi1,gsi2,lsi1').toEqual({
            id: '123',
            sort: 'abc',
            gsi1: 'g1',
            gsi2: 'g2',
            lsi1: 'l1',
        });

        //* buildKey with values test
        const schema3 = {
            hashKey: 'id',
            rangeKey: 'sort',
            globalIndexes: {},
            secondaryIndexes: {},
            _modelDatatypes: {},
        };
        const result3 = Serializer.buildKey('123', 'abc', schema3);
        expect2(() => result3).toEqual({ id: '123', sort: 'abc' });

        //* buildKey without rangeKey test
        const schema4 = { hashKey: 'id', globalIndexes: {}, secondaryIndexes: {}, _modelDatatypes: {} };
        const result4 = Serializer.buildKey('123', null, schema4);
        expect2(() => result4.id).toEqual('123');

        //* serializeItem test
        const schema5 = { _modelDatatypes: { name: 'S', age: 'N' } };
        const item5 = { name: 'John', age: 30 };
        const result5 = Serializer.serializeItem(schema5, item5, {});
        expect2(() => result5).toEqual({ name: 'John', age: 30 });

        //* serializeItem with null test
        const schema6 = { _modelDatatypes: {} };
        expect2(() => Serializer.serializeItem(schema6, null, {})).toEqual(null);

        //* serializeItem with expected test
        const schema7 = { _modelDatatypes: {} };
        const item7 = { name: { Exists: true } };
        const result7 = Serializer.serializeItem(schema7, item7, { expected: true });
        expect2(() => result7.name.Exists).toEqual(true);

        //* serializeItem with nested objects test
        const schema8 = { _modelDatatypes: { profile: { name: 'S' } } };
        const item8 = { profile: { name: 'John' } };
        const result8 = Serializer.serializeItem(schema8, item8, {});
        expect2(() => result8.profile.name).toEqual('John');

        //* serializeItem with arrays test
        const schema9 = { _modelDatatypes: { tags: [{ name: 'S' }] } };
        const item9 = { tags: [{ name: 'tag1' }, { name: 'tag2' }] };
        const result9 = Serializer.serializeItem(schema9, item9, {});
        expect2(() => result9.tags.length).toEqual(2);
        expect2(() => result9.tags[0].name).toEqual('tag1');

        //* serializeItem with returnNuls test
        const schema10 = { _modelDatatypes: { name: 'S' } };
        const item10 = { name: null as any };
        const result10 = Serializer.serializeItem(schema10, item10, { returnNulls: true });
        expect2(() => result10.name).toEqual(null);

        //* serializeItem with expected Value test
        const schema11 = { _modelDatatypes: { name: 'S' } };
        const item11 = { name: 'John' };
        const result11 = Serializer.serializeItem(schema11, item11, { expected: true });
        expect2(() => result11.name.Value).toEqual('John');

        //* serializeItemForUpdate DELETE test
        const schema12 = { hashKey: 'id', _modelDatatypes: { name: 'S' } };
        const item12 = { id: '123', name: null as any };
        const result12 = Serializer.serializeItemForUpdate(schema12, 'PUT', item12);
        expect2(() => result12.name.Action).toEqual('DELETE');

        //* serializeItemForUpdate ADD test
        const schema13 = { hashKey: 'id', _modelDatatypes: { count: 'N' } };
        const item13 = { id: '123', count: { $add: 5 } };
        const result13 = Serializer.serializeItemForUpdate(schema13, 'PUT', item13);
        expect2(() => result13.count.Action).toEqual('ADD');
        expect2(() => result13.count.Value).toEqual(5);

        //* serializeItemForUpdate $del test
        const schema14 = { hashKey: 'id', _modelDatatypes: { tags: 'SS' } };
        const item14 = { id: '123', tags: { $del: 'tag1' } };
        const result14 = Serializer.serializeItemForUpdate(schema14, 'PUT', item14);
        expect2(() => result14.tags.Action).toEqual('DELETE');

        //* serializeItemForUpdate PUT test
        const schema15 = { hashKey: 'id', _modelDatatypes: { name: 'S' } };
        const item15 = { id: '123', name: 'John' };
        const result15 = Serializer.serializeItemForUpdate(schema15, 'PUT', item15);
        expect2(() => result15.name.Action).toEqual('PUT');
        expect2(() => result15.name.Value).toEqual('John');

        //* deserializeItem null test
        expect2(() => Serializer.deserializeItem(null)).toEqual(null);
        const item16 = { name: 'John', age: 30 };
        const result16 = Serializer.deserializeItem(item16);
        expect2(() => result16).toEqual({ name: 'John', age: 30 });

        //* deserializeItem nested test
        const item17 = { profile: { name: 'John', age: 30 } };
        const result17 = Serializer.deserializeItem(item17);
        expect2(() => result17.profile.name).toEqual('John');
        expect2(() => result17.profile.age).toEqual(30);

        //* deserializeItem arrays test
        const item18 = { tags: ['tag1', 'tag2'], nums: [1, 2, 3] };
        const result18 = Serializer.deserializeItem(item18);
        expect2(() => result18.tags).toEqual(['tag1', 'tag2']);
        expect2(() => result18.nums).toEqual([1, 2, 3]);

        //* deserializeItem with Set test
        // Create a Set-like object with detectType function and values array
        function DynamoDBSet(this: any, values: any[]) {
            this.values = values;
        }
        DynamoDBSet.prototype.detectType = function () {
            return 'String';
        };
        const mockSet = new (DynamoDBSet as any)(['a', 'b', 'c']);
        const item19 = { tags: mockSet };
        const result19 = Serializer.deserializeItem(item19);
        expect2(() => result19.tags).toEqual(['a', 'b', 'c']);
    });

    //! expressions.ts tests
    it('should pass expressions test', async () => {
        //* parse test
        const result = expressions.parse('SET a = :a ADD b :b REMOVE c DELETE d :d');
        expect2(() => result.SET).toEqual(['a = :a']);
        expect2(() => result.ADD).toEqual(['b :b']);
        expect2(() => result.REMOVE).toEqual(['c']);
        expect2(() => result.DELETE).toEqual(['d :d']);

        //* parse no match test
        const result2 = expressions.parse('INVALID');
        expect2(() => result2.SET).toEqual(null);
        expect2(() => result2.ADD).toEqual(null);

        //* serializeUpdateExpression REMOVE test
        const schema3 = { hashKey: 'id', _modelDatatypes: {} };
        const item3 = { id: '123', name: null as any };
        const result3 = expressions.serializeUpdateExpression(schema3, item3);
        expect2(() => result3.expressions.REMOVE).toEqual(['#name']);
        expect2(() => result3.attributeNames['#name']).toEqual('name');

        //* should pass serializeUpdateExpression empty string
        const schema4 = { hashKey: 'id', _modelDatatypes: {} };
        const item4 = { id: '123', name: '' };
        const result4 = expressions.serializeUpdateExpression(schema4, item4);
        expect2(() => result4.expressions.REMOVE).toEqual(['#name']);

        //* serializeUpdateExpression ADD test
        const schema5 = { hashKey: 'id', _modelDatatypes: { count: 'N' } };
        const item5 = { id: '123', count: { $add: 5 } };
        const result5 = expressions.serializeUpdateExpression(schema5, item5);
        expect2(() => result5.expressions.ADD).toEqual(['#count :count']);
        expect2(() => result5.values[':count']).toEqual(5);

        //* serializeUpdateExpression DELETE test
        const schema6 = { hashKey: 'id', _modelDatatypes: { tags: 'SS' } };
        const item6 = { id: '123', tags: { $del: 'tag1' } };
        const result6 = expressions.serializeUpdateExpression(schema6, item6);
        expect2(() => result6.expressions.DELETE).toEqual(['#tags :tags']);

        //* serializeUpdateExpression SET test
        const schema7 = { hashKey: 'id', _modelDatatypes: { name: 'S' } };
        const item7 = { id: '123', name: 'John' };
        const result7 = expressions.serializeUpdateExpression(schema7, item7);
        expect2(() => result7.expressions.SET).toEqual(['#name = :name']);
        expect2(() => result7.values[':name']).toEqual('John');

        //* stringify test
        const exprs8 = {
            SET: ['#a = :a', '#b = :b'],
            ADD: ['#c :c'],
            REMOVE: ['#d'],
            DELETE: [] as any[],
        };
        const result8 = expressions.stringify(exprs8);
        expect2(() => result8).toEqual('SET #a = :a, #b = :b ADD #c :c REMOVE #d');

        //* stringify non-array test
        const exprs9 = { SET: '#a = :a' };
        const result9 = expressions.stringify(exprs9);
        expect2(() => result9).toEqual('SET #a = :a');

        //* buildFilterExpression equals test
        const result10 = expressions.buildFilterExpression('id', '=', [], '123');
        expect2(() => result10.statement).toEqual('#id = :id');
        expect2(() => result10.attributeNames['#id']).toEqual('id');
        expect2(() => result10.attributeValues[':id']).toEqual('123');

        //* buildFilterExpression IN test
        const result11 = expressions.buildFilterExpression('id', 'IN', [], ['1', '2', '3']);
        expect2(() => result11.statement.includes('IN')).toEqual(true);
        expect2(() => Object.keys(result11.attributeValues).length).toEqual(3);

        //* buildFilterExpression attribute_exists true test
        const result12 = expressions.buildFilterExpression('name', 'attribute_exists', [], true);
        expect2(() => result12.statement).toEqual('attribute_exists(#name)');

        //* buildFilterExpression attribute_exists false test
        const result13 = expressions.buildFilterExpression('name', 'attribute_exists', [], false);
        expect2(() => result13.statement).toEqual('attribute_not_exists(#name)');
        //* buildFilterExpression begins_with test
        const result14 = expressions.buildFilterExpression('name', 'begins_with', [], 'John');
        expect2(() => result14.statement).toEqual('begins_with(#name, :name)');

        //* buildFilterExpression BETWEEN test
        const result15 = expressions.buildFilterExpression('age', 'BETWEEN', [], 18, 65);
        expect2(() => result15.statement).toEqual('#age BETWEEN :age AND :age_2');
        expect2(() => result15.attributeValues[':age']).toEqual(18);
        expect2(() => result15.attributeValues[':age_2']).toEqual(65);

        //* buildFilterExpression with date test
        const date = new Date('2025-01-01T00:00:00.000Z');
        const result16 = expressions.buildFilterExpression('created', '=', [], date);
        expect2(() => result16.attributeValues[':created']).toEqual('2025-01-01T00:00:00.000Z');

        //* buildFilterExpression existing names test
        const result17 = expressions.buildFilterExpression('name', '=', [':name'], 'John');
        expect2(() => result17.statement).toEqual('#name = :name_2');

        const mockTable = {
            tableName: () => 'test-table',
            schema: {
                hashKey: 'id',
                rangeKey: 'sort',
                globalIndexes: { 'gsi-index': { hashKey: 'gsiHash', rangeKey: 'gsiRange' } },
            },
        };
        const mockSerializer = { buildKey: (h: any, r: any, s: any) => ({ id: h, sort: r }) };

        //* Query construction test
        const query1 = new Query('123', mockTable, mockSerializer);
        expect2(() => (query1 as any).hashKey).toEqual('123');
        expect2(() => (query1 as any).options.loadAll).toEqual(false);

        //* Query limit test
        const query2 = new Query('123', mockTable, mockSerializer);
        query2.limit(10);
        expect2(() => (query2 as any).request.Limit).toEqual(10);

        //* Query limit error test
        const query3 = new Query('123', mockTable, mockSerializer);
        expect2(() => query3.limit(0)).toEqual('Limit must be greater than 0');

        //* Query buildRequest test
        const query4 = new Query('123', mockTable, mockSerializer);
        const request4 = query4.buildRequest();
        expect2(() => request4.TableName).toEqual('test-table');

        //* Query buildKey test
        const query5 = new Query('123', mockTable, mockSerializer);
        const key5 = query5.buildKey();
        expect2(() => key5.statement).toEqual('#id = :id');

        //* Query buildKey with index test
        const query6 = new Query('123', mockTable, mockSerializer);
        query6.usingIndex('gsi-index');
        const key6 = query6.buildKey();
        expect2(() => key6.statement).toEqual('#gsiHash = :gsiHash');

        //* Query where test
        const query7 = new Query('123', mockTable, mockSerializer);
        const where7 = query7.where('sort');
        expect2(() => where7.equals).toBeDefined();
        expect2(() => where7.eq).toBeDefined();
        expect2(() => where7.lte).toBeDefined();
        expect2(() => where7.lt).toBeDefined();
        expect2(() => where7.gte).toBeDefined();
        expect2(() => where7.gt).toBeDefined();

        //* Query filter test
        const query8 = new Query('123', mockTable, mockSerializer);
        const filter8 = query8.filter('name');
        expect2(() => filter8.equals).toBeDefined();
        expect2(() => filter8.ne).toBeDefined();

        //* Query attributes test
        const query9 = new Query('123', mockTable, mockSerializer);
        query9.attributes(['id', 'name']);
        expect2(() => (query9 as any).request.ProjectionExpression).toEqual('#id,#name');

        //* Query attributes string test
        const query10 = new Query('123', mockTable, mockSerializer);
        query10.attributes('id');
        expect2(() => (query10 as any).request.ProjectionExpression).toEqual('#id');

        //* Query ascending test
        const query11 = new Query('123', mockTable, mockSerializer);
        query11.ascending();
        expect2(() => (query11 as any).request.ScanIndexForward).toEqual(true);

        //* Query descending test
        const query12 = new Query('123', mockTable, mockSerializer);
        query12.descending();
        expect2(() => (query12 as any).request.ScanIndexForward).toEqual(false);

        //* Query select test
        const query13 = new Query('123', mockTable, mockSerializer);
        query13.select('ALL_ATTRIBUTES');
        expect2(() => (query13 as any).request.Select).toEqual('ALL_ATTRIBUTES');

        //* Query returnConsumedCapacity test
        const query14 = new Query('123', mockTable, mockSerializer);
        query14.returnConsumedCapacity('TOTAL');
        expect2(() => (query14 as any).request.ReturnConsumedCapacity).toEqual('TOTAL');

        //* Query returnConsumedCapacity default test
        const query15 = new Query('123', mockTable, mockSerializer);
        query15.returnConsumedCapacity(undefined);
        expect2(() => (query15 as any).request.ReturnConsumedCapacity).toEqual('TOTAL');

        //* Query loadAll test
        const query16 = new Query('123', mockTable, mockSerializer);
        query16.loadAll();
        expect2(() => (query16 as any).options.loadAll).toEqual(true);

        //* Query consistentRead test
        const query17 = new Query('123', mockTable, mockSerializer);
        query17.consistentRead(true);
        expect2(() => (query17 as any).request.ConsistentRead).toEqual(true);

        //* Query consistentRead non-boolean test
        const query18 = new Query('123', mockTable, mockSerializer);
        query18.consistentRead('yes' as any);
        expect2(() => (query18 as any).request.ConsistentRead).toEqual(true);

        //* Query startKey test
        const query19 = new Query('123', mockTable, mockSerializer);
        query19.startKey('123', 'abc');
        expect2(() => (query19 as any).request.ExclusiveStartKey).toEqual({ id: '123', sort: 'abc' });

        //* Query where equals test
        const query20 = new Query('123', mockTable, mockSerializer);
        const result20 = query20.where('sort').equals('abc');
        expect2(() => (result20 as any).request.KeyConditionExpression).toContain('=');

        //* Query where lt test
        const query21 = new Query('123', mockTable, mockSerializer);
        const result21 = query21.where('sort').lt('abc');
        expect2(() => (result21 as any).request.KeyConditionExpression).toContain('<');

        //* Query where lte test
        const query22 = new Query('123', mockTable, mockSerializer);
        const result22 = query22.where('sort').lte('abc');
        expect2(() => (result22 as any).request.KeyConditionExpression).toContain('<=');

        //* Query where gt test
        const query23 = new Query('123', mockTable, mockSerializer);
        const result23 = query23.where('sort').gt('abc');
        expect2(() => (result23 as any).request.KeyConditionExpression).toContain('>');

        //* Query where gte test
        const query24 = new Query('123', mockTable, mockSerializer);
        const result24 = query24.where('sort').gte('abc');
        expect2(() => (result24 as any).request.KeyConditionExpression).toContain('>=');

        //* Query where beginsWith test
        const query25 = new Query('123', mockTable, mockSerializer);
        const result25 = query25.where('sort').beginsWith('ab');
        expect2(() => (result25 as any).request.KeyConditionExpression).toContain('begins_with');

        //* Query where between test
        const query26 = new Query('123', mockTable, mockSerializer);
        const result26 = query26.where('sort').between('a', 'z');
        expect2(() => (result26 as any).request.KeyConditionExpression).toContain('BETWEEN');

        //* Query filter ne test
        const query27 = new Query('123', mockTable, mockSerializer);
        const result27 = query27.filter('name').ne('test');
        expect2(() => (result27 as any).request.FilterExpression).toContain('<>');

        //* Query filter null test
        const query28 = new Query('123', mockTable, mockSerializer);
        const result28 = query28.filter('name').null();
        expect2(() => (result28 as any).request.FilterExpression).toContain('attribute_not_exists');

        //* Query filter exists test
        const query29 = new Query('123', mockTable, mockSerializer);
        const result29 = query29.filter('name').exists();
        expect2(() => (result29 as any).request.FilterExpression).toContain('attribute_exists');

        //* Query filter contains test
        const query30 = new Query('123', mockTable, mockSerializer);
        const result30 = query30.filter('name').contains('test');
        expect2(() => (result30 as any).request.FilterExpression).toContain('contains');

        //* Query filter notContains test
        const query31 = new Query('123', mockTable, mockSerializer);
        const result31 = query31.filter('name').notContains('test');
        expect2(() => (result31 as any).request.FilterExpression).toContain('NOT contains');

        //* Query filter in test
        const query32 = new Query('123', mockTable, mockSerializer);
        const result32 = query32.filter('status').in(['active', 'pending']);
        expect2(() => (result32 as any).request.FilterExpression).toContain('IN');

        //* Query multiple where conditions test
        const query33 = new Query('123', mockTable, mockSerializer);
        const result33 = query33.where('sort').gte('a').where('sort').lte('z');
        expect2(() => (result33 as any).request.KeyConditionExpression).toContain('AND');

        //* Query multiple filter conditions test
        const query34 = new Query('123', mockTable, mockSerializer);
        const result34 = query34.filter('name').ne('test').filter('status').eq('active');
        expect2(() => (result34 as any).request.FilterExpression).toContain('AND');

        //* Query filterExpression test
        const query35 = new Query('123', mockTable, mockSerializer);
        query35.filterExpression('#name = :name');
        expect2(() => (query35 as any).request.FilterExpression).toEqual('#name = :name');

        //* Query expressionAttributeValues test
        const query36 = new Query('123', mockTable, mockSerializer);
        query36.expressionAttributeValues({ ':name': 'test' });
        expect2(() => (query36 as any).request.ExpressionAttributeValues).toEqual({ ':name': 'test' });

        //* Query expressionAttributeNames test
        const query37 = new Query('123', mockTable, mockSerializer);
        query37.expressionAttributeNames({ '#n': 'name' });
        expect2(() => (query37 as any).request.ExpressionAttributeNames).toEqual({ '#n': 'name' });

        //* Query projectionExpression test
        const query38 = new Query('123', mockTable, mockSerializer);
        query38.projectionExpression('#id, #name');
        expect2(() => (query38 as any).request.ProjectionExpression).toEqual('#id, #name');
    });

    //! scan.ts tests
    describe('Scan', () => {
        it('should pass Scan test', async () => {
            const mockTable = { tableName: () => 'test-table', schema: { hashKey: 'id', rangeKey: 'sort' } };
            const mockSerializer = { buildKey: (h: any, r: any, s: any) => ({ id: h, sort: r }) };

            //* Scan test
            const scan1 = new Scan(mockTable, mockSerializer);
            expect2(() => (scan1 as any).table).toEqual(mockTable);
            expect2(() => (scan1 as any).options.loadAll).toEqual(false);

            //* Scan limit test
            const scan2 = new Scan(mockTable, mockSerializer);
            scan2.limit(10);
            expect2(() => (scan2 as any).request.Limit).toEqual(10);

            //* Scan limit error test
            const scan3 = new Scan(mockTable, mockSerializer);
            expect2(() => scan3.limit(0)).toEqual('Limit must be greater than 0');

            //* Scan buildRequest test
            const scan4 = new Scan(mockTable, mockSerializer);
            const request4 = scan4.buildRequest();
            expect2(() => request4.TableName).toEqual('test-table');

            //* Scan where test
            const scan5 = new Scan(mockTable, mockSerializer);
            const where5 = scan5.where('name');
            expect2(() => where5.equals).toBeDefined();
            expect2(() => where5.ne).toBeDefined();
            expect2(() => where5.null).toBeDefined();
            expect2(() => where5.notNull).toBeDefined();
            expect2(() => where5.contains).toBeDefined();
            expect2(() => where5.notContains).toBeDefined();

            //* Scan attributes test
            const scan6 = new Scan(mockTable, mockSerializer);
            scan6.attributes(['id', 'name']);
            expect2(() => (scan6 as any).request.ProjectionExpression).toEqual('#id,#name');

            //* Scan attributes string test
            const scan7 = new Scan(mockTable, mockSerializer);
            scan7.attributes('id');
            expect2(() => (scan7 as any).request.ProjectionExpression).toEqual('#id');

            //* Scan select test
            const scan8 = new Scan(mockTable, mockSerializer);
            scan8.select('ALL_ATTRIBUTES');
            expect2(() => (scan8 as any).request.Select).toEqual('ALL_ATTRIBUTES');

            //* Scan returnConsumedCapacity test
            const scan9 = new Scan(mockTable, mockSerializer);
            scan9.returnConsumedCapacity('TOTAL');
            expect2(() => (scan9 as any).request.ReturnConsumedCapacity).toEqual('TOTAL');

            //* Scan returnConsumedCapacity default test
            const scan10 = new Scan(mockTable, mockSerializer);
            scan10.returnConsumedCapacity(undefined);
            expect2(() => (scan10 as any).request.ReturnConsumedCapacity).toEqual('TOTAL');

            //* Scan segments test
            const scan11 = new Scan(mockTable, mockSerializer);
            scan11.segments(0, 4);
            expect2(() => (scan11 as any).request.Segment).toEqual(0);
            expect2(() => (scan11 as any).request.TotalSegments).toEqual(4);

            //* Scan startKey test
            const scan12 = new Scan(mockTable, mockSerializer);
            scan12.startKey('123', 'abc');
            expect2(() => (scan12 as any).request.ExclusiveStartKey).toEqual({ id: '123', sort: 'abc' });

            //* Scan loadAll test
            const scan13 = new Scan(mockTable, mockSerializer);
            scan13.loadAll();
            expect2(() => (scan13 as any).options.loadAll).toEqual(true);

            //* Scan where equals test
            const scan14 = new Scan(mockTable, mockSerializer);
            const result14 = scan14.where('name').equals('test');
            expect2(() => (result14 as any).request.FilterExpression).toContain('=');

            //* Scan where ne test
            const scan15 = new Scan(mockTable, mockSerializer);
            const result15 = scan15.where('status').ne('deleted');
            expect2(() => (result15 as any).request.FilterExpression).toContain('<>');

            //* Scan where lt test
            const scan16 = new Scan(mockTable, mockSerializer);
            const result16 = scan16.where('age').lt(18);
            expect2(() => (result16 as any).request.FilterExpression).toContain('<');

            //* Scan where lte test
            const scan17 = new Scan(mockTable, mockSerializer);
            const result17 = scan17.where('age').lte(65);
            expect2(() => (result17 as any).request.FilterExpression).toContain('<=');

            //* Scan where gt test
            const scan18 = new Scan(mockTable, mockSerializer);
            const result18 = scan18.where('count').gt(0);
            expect2(() => (result18 as any).request.FilterExpression).toContain('>');

            //* Scan where gte test
            const scan19 = new Scan(mockTable, mockSerializer);
            const result19 = scan19.where('score').gte(50);
            expect2(() => (result19 as any).request.FilterExpression).toContain('>=');

            //* Scan where null test
            const scan20 = new Scan(mockTable, mockSerializer);
            const result20 = scan20.where('deletedAt').null();
            expect2(() => (result20 as any).request.FilterExpression).toContain('attribute_not_exists');

            //* Scan where notNull test
            const scan21 = new Scan(mockTable, mockSerializer);
            const result21 = scan21.where('name').notNull();
            expect2(() => (result21 as any).request.FilterExpression).toContain('attribute_exists');

            //* Scan where contains test
            const scan22 = new Scan(mockTable, mockSerializer);
            const result22 = scan22.where('tags').contains('important');
            expect2(() => (result22 as any).request.FilterExpression).toContain('contains');

            //* Scan where notContains test
            const scan23 = new Scan(mockTable, mockSerializer);
            const result23 = scan23.where('tags').notContains('spam');
            expect2(() => (result23 as any).request.FilterExpression).toContain('NOT contains');

            //* Scan where in test
            const scan24 = new Scan(mockTable, mockSerializer);
            const result24 = scan24.where('status').in(['active', 'pending', 'approved']);
            expect2(() => (result24 as any).request.FilterExpression).toContain('IN');

            //* Scan where beginsWith test
            const scan25 = new Scan(mockTable, mockSerializer);
            const result25 = scan25.where('email').beginsWith('admin@');
            expect2(() => (result25 as any).request.FilterExpression).toContain('begins_with');

            //* Scan where between test
            const scan26 = new Scan(mockTable, mockSerializer);
            const result26 = scan26.where('age').between(18, 65);
            expect2(() => (result26 as any).request.FilterExpression).toContain('BETWEEN');

            //* Scan filterExpression test
            const scan27 = new Scan(mockTable, mockSerializer);
            scan27.filterExpression('#status = :status');
            expect2(() => (scan27 as any).request.FilterExpression).toEqual('#status = :status');

            //* Scan expressionAttributeValues test
            const scan28 = new Scan(mockTable, mockSerializer);
            scan28.expressionAttributeValues({ ':status': 'active' });
            expect2(() => (scan28 as any).request.ExpressionAttributeValues).toEqual({ ':status': 'active' });

            //* Scan expressionAttributeNames test
            const scan29 = new Scan(mockTable, mockSerializer);
            scan29.expressionAttributeNames({ '#s': 'status' });
            expect2(() => (scan29 as any).request.ExpressionAttributeNames).toEqual({ '#s': 'status' });

            //* Scan projectionExpression test
            const scan30 = new Scan(mockTable, mockSerializer);
            scan30.projectionExpression('#id, #name, #status');
            expect2(() => (scan30 as any).request.ProjectionExpression).toEqual('#id, #name, #status');

            //* Scan addFilterCondition test
            const scan31 = new Scan(mockTable, mockSerializer);
            const condition31 = {
                statement: '#name = :name',
                attributeNames: { '#name': 'name' },
                attributeValues: { ':name': 'test' },
            };
            scan31.addFilterCondition(condition31);
            expect2(() => (scan31 as any).request.FilterExpression).toEqual('(#name = :name)');
            expect2(() => (scan31 as any).request.ExpressionAttributeNames['#name']).toEqual('name');
            expect2(() => (scan31 as any).request.ExpressionAttributeValues[':name']).toEqual('test');

            //* Scan addFilterCondition multiple test
            const scan32 = new Scan(mockTable, mockSerializer);
            const condition321 = {
                statement: '#name = :name',
                attributeNames: { '#name': 'name' },
                attributeValues: { ':name': 'test' },
            };
            const condition322 = {
                statement: '#status = :status',
                attributeNames: { '#status': 'status' },
                attributeValues: { ':status': 'active' },
            };
            scan32.addFilterCondition(condition321);
            scan32.addFilterCondition(condition322);
            expect2(() => (scan32 as any).request.FilterExpression).toContain('AND');
        });
    });
});
