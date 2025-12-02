/**
 * `dynamo-service.spec.js`
 * - unit test for `dynamo-service` w/ dummy data
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-25 initial version with dummy serivce
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { GETERR, expect2 } from '../../common/test-helper';
import { DynamoService, DynamoOption } from './dynamo-service';
import { GeneralItem } from 'lemon-model';
import { DynamoQueryService } from './dynamo-query-service';
import { loadDataYml } from '../../tools';

interface MyModel extends GeneralItem {
    ID: string;
}

export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'ID';
    const sortName = 0 ? 'ID' : undefined;
    const options: DynamoOption = { tableName, idName, sortName };
    const dynamo = new DynamoService<MyModel>(options);
    const dynamoQuery = new DynamoQueryService<MyModel>(options);
    return { dynamo, dynamoQuery, options };
};

//! main test body.
describe('DynamoQueryService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    const dataMap = new Map<string, MyModel>();

    beforeAll(async () => {
        const { dynamo } = instance();
        if (!PROFILE) return;

        // Initialize data in table
        const data: MyModel[] = loadDataYml('dummy-dynamo-query-data.yml').data;
        await Promise.all(
            data.map(async item => {
                const saved = await dynamo.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            }),
        );
    });

    //* dynamo query service.
    it('should pass basic query operations', async () => {
        const { dynamoQuery, options } = instance();
        const useReal = !!PROFILE;

        expect2(dynamoQuery.hello()).toEqual(`dynamo-query-service:${options.tableName}`);

        //* check query builder
        expect2(() => dynamoQuery.buildQuery('00', -1, -1, undefined, null, undefined)).toEqual({
            ExpressionAttributeNames: { '#ID': 'ID' },
            ExpressionAttributeValues: { ':ID': '00' },
            KeyConditionExpression: '(#ID = :ID)',
            ScanIndexForward: true,
            TableName: 'DynamoTest',
        });

        //* check of none
        if (useReal) {
            expect2(await dynamoQuery.queryAll('00').catch(GETERR), 'list,count').toEqual({ list: [], count: 0 });

            //* check by each item
            for (const [id, item] of dataMap.entries())
                expect2(await dynamoQuery.queryAll(id).catch(GETERR), 'list,count').toEqual({ list: [item], count: 1 });

            //* check by range
            for (const [id, item] of dataMap.entries())
                expect2(await dynamoQuery.queryRange(id, 0, 0, 1)).toEqual({ list: [item], count: 1, last: 0 });
        }

        // TODO: Need to add sort key query test cases
    });

    afterAll(async () => {
        if (!PROFILE) return;
        const { dynamo } = instance();
        // Cleanup table
        await Promise.all([...dataMap.keys()].map(id => dynamo.deleteItem(id)));
    });

    it('should pass constructor test', () => {
        expect2(() => new DynamoQueryService({ idName: 'ID' } as any)).toEqual('.tableName is required');
        expect2(() => new DynamoQueryService({ tableName: 'Test' } as any)).toEqual('.idName is required');
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });
        expect2(service.hello()).toEqual('dynamo-query-service:TestTable');
        const result = service.buildQuery('pk1', -1, -1, undefined, undefined, undefined);

        expect2(result).toEqual({
            TableName: 'TestTable',
            KeyConditionExpression: '(#ID = :ID)',
            ExpressionAttributeNames: { '#ID': 'ID' },
            ExpressionAttributeValues: { ':ID': 'pk1' },
            ScanIndexForward: true,
        });
    });

    //* Test buildQuery with sortName and between
    it('should build query with sortName and between range', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
        const result = service.buildQuery('pk1', 10, 20, undefined, undefined, undefined);

        expect2(result.TableName).toEqual('TestTable');
        expect2(result.KeyConditionExpression).toEqual('(#Sort BETWEEN :Sort AND :Sort_2) AND (#ID = :ID)');
        expect2(result.ExpressionAttributeNames).toEqual({ '#ID': 'ID', '#Sort': 'Sort' });
        expect2(result.ExpressionAttributeValues).toEqual({ ':ID': 'pk1', ':Sort': 10, ':Sort_2': 20 });
        expect2(result.ScanIndexForward).toEqual(true);
    });

    //* Test buildQuery with sortName and gte
    it('should build query with sortName and gte', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
        const result = service.buildQuery('pk1', -1, -1, undefined, undefined, undefined);

        expect2(result.TableName).toEqual('TestTable');
        expect2(result.KeyConditionExpression).toEqual('(#Sort >= :Sort) AND (#ID = :ID)');
        expect2(result.ExpressionAttributeNames).toEqual({ '#ID': 'ID', '#Sort': 'Sort' });
        expect2(result.ExpressionAttributeValues).toEqual({ ':ID': 'pk1', ':Sort': 0 });
        expect2(result.ScanIndexForward).toEqual(true);
    });

    //* Test buildQuery with isDesc
    it('should build query with descending order', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
        const result = service.buildQuery('pk1', -1, -1, undefined, undefined, true);

        expect2(result.ScanIndexForward).toEqual(false);
    });

    //* Test buildQuery with limit
    it('should build query with limit', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });
        const result = service.buildQuery('pk1', -1, -1, 10, undefined, undefined);

        expect2(result.Limit).toEqual(10);
    });

    //* Test buildQuery with last (startKey)
    it('should build query with last evaluated key', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
        const result = service.buildQuery('pk1', -1, -1, undefined, 100, undefined);

        expect2(result.ExclusiveStartKey).toEqual({ ID: 'pk1', Sort: 100 });
    });

    //* Test buildQuery with @ prefix replacement
    it('should replace @ prefix in attribute names', () => {
        const service = new DynamoQueryService({
            tableName: 'TestTable',
            idName: '@id',
            sortName: '@sort',
        });
        const result = service.buildQuery('pk1', 10, 20, undefined, undefined, undefined);

        expect2(result.ExpressionAttributeNames['#_id']).toEqual('@id');
        expect2(result.ExpressionAttributeNames['#_sort']).toEqual('@sort');
        expect2(result.KeyConditionExpression).toEqual('(#_sort BETWEEN :_sort AND :_sort_2) AND (#_id = :_id)');
    });

    //* Test queryAll with mock
    it('should execute queryAll successfully', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [{ ID: 'pk1', Sort: 1, data: 'test1' }],
            Count: 1,
            ScannedCount: 1,
            LastEvaluatedKey: { ID: 'pk1', Sort: 1 },
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryAll('pk1');

        expect2(result.list).toEqual([{ ID: 'pk1', Sort: 1, data: 'test1' }]);
        expect2(result.count).toEqual(1);
        expect2(result.last).toEqual(1);
    });

    //* Test queryAll with limit and isDesc
    it('should execute queryAll with limit and descending', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [
                { ID: 'pk1', Sort: 2 },
                { ID: 'pk1', Sort: 1 },
            ],
            Count: 2,
            ScannedCount: 2,
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryAll('pk1', 2, true);

        expect2(result.list).toEqual([
            { ID: 'pk1', Sort: 2 },
            { ID: 'pk1', Sort: 1 },
        ]);
        expect2(result.count).toEqual(2);
    });

    //* Test queryRange
    it('should execute queryRange successfully', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [
                { ID: 'pk1', Sort: 10 },
                { ID: 'pk1', Sort: 15 },
            ],
            Count: 2,
            ScannedCount: 2,
            LastEvaluatedKey: { ID: 'pk1', Sort: 15 },
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRange('pk1', 10, 20);

        expect2(result.list).toEqual([
            { ID: 'pk1', Sort: 10 },
            { ID: 'pk1', Sort: 15 },
        ]);
        expect2(result.count).toEqual(2);
        expect2(result.last).toEqual(15);
    });

    //* Test queryRange with limit and last
    it('should execute queryRange with limit and last', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [{ ID: 'pk1', Sort: 25 }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRange('pk1', 20, 30, 1, 24);

        expect2(result.list).toEqual([{ ID: 'pk1', Sort: 25 }]);
        expect2(result.count).toEqual(1);
    });

    //* Test queryRangeBy with all parameters
    it('should execute queryRangeBy with all parameters', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [
                { ID: 'pk1', Sort: 30 },
                { ID: 'pk1', Sort: 25 },
            ],
            Count: 2,
            ScannedCount: 2,
            LastEvaluatedKey: { ID: 'pk1', Sort: 25 },
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRangeBy('pk1', 20, 30, 2, 31, true);

        expect2(result.list).toEqual([
            { ID: 'pk1', Sort: 30 },
            { ID: 'pk1', Sort: 25 },
        ]);
        expect2(result.count).toEqual(2);
        expect2(result.last).toEqual(25);
    });

    //* Test queryRangeBy with empty response
    it('should handle empty response', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [],
            Count: 0,
            ScannedCount: 0,
            ConsumedCapacity: { CapacityUnits: 0, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRangeBy('pk1', -1, -1);

        expect2(result.list).toEqual([]);
        expect2(result.count).toEqual(0);
    });

    //* Test queryRangeBy with null response
    it('should handle null response', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue(null);

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRangeBy('pk1', -1, -1);

        expect2(result.list).toEqual([]);
    });

    it('should handle empty object response', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({});

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRangeBy('pk1', -1, -1);

        expect2(result.list).toEqual([]);
    });

    //* Test queryRangeBy with undefined response
    it('should handle undefined response', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue(undefined);

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRangeBy('pk1', -1, -1);

        expect2(result.list).toEqual([]);
    });

    //* Test queryRangeBy without LastEvaluatedKey
    it('should handle response without LastEvaluatedKey', async () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [{ ID: 'pk1', Sort: 1 }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.queryRangeBy('pk1', -1, -1);

        expect2(result.list).toEqual([{ ID: 'pk1', Sort: 1 }]);
        expect2(result.count).toEqual(1);
        expect2(result.last).toEqual(0);
    });

    //* Test buildQuery with all combinations
    it('should throw error when limit is 0', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID' });

        expect2(() => service.buildQuery('pk1', -1, -1, 0, undefined, undefined)).toEqual(
            'Limit must be greater than 0',
        );
    });

    it('should build query with from=0 and to=0', () => {
        const service = new DynamoQueryService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
        const result = service.buildQuery('pk1', 0, 0, undefined, undefined, undefined);

        expect2(result.KeyConditionExpression).toEqual('(#Sort BETWEEN :Sort AND :Sort_2) AND (#ID = :ID)');
        expect2(result.ExpressionAttributeValues[':Sort']).toEqual(0);
        expect2(result.ExpressionAttributeValues[':Sort_2']).toEqual(0);
    });
});
