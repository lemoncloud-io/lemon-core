/**
 * `dynamo-scan-service.spec.js`
 * - unit test for `dynamo-scan-service` w/ dummy data
 *
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-01-20 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { expect2, _it } from '../../common/test-helper';
import { loadDataYml } from '../../tools';
import { GeneralItem } from 'lemon-model';
import { DynamoService, DynamoOption } from './dynamo-service';
import { DynamoScanFilter, DynamoScanService } from './dynamo-scan-service';

interface AccountItem extends GeneralItem {
    ID: string;
    type: 'account';
    name: string;
    contact: string;
    bank: string;
    balance: number;
}

export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'ID';
    const options: DynamoOption = { tableName, idName };
    const dynamo = new DynamoService<AccountItem>(options);
    const dynamoScan = new DynamoScanService<AccountItem>(options);
    return { dynamo, dynamoScan, options };
};

//! main test body.
describe('DynamoScanService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    const data: AccountItem[] = loadDataYml('dummy-dynamo-scan-data.yml').data;
    const dataMap = new Map<string, AccountItem>();
    jest.setTimeout(100000);

    // Setup test
    beforeAll(async () => {
        const { dynamo } = instance();
        if (!PROFILE) return;

        // Initialize data in table
        await Promise.all(
            data.map(async item => {
                const saved = await dynamo.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            }),
        );
    });

    // Teardown test
    afterAll(async () => {
        const { dynamo } = instance();
        // Cleanup table
        await Promise.all([...dataMap.keys()].map(id => dynamo.deleteItem(id)));
    });

    it('should pass basic scan operations', async () => {
        const { dynamoScan, options } = instance();
        expect2(dynamoScan.hello()).toEqual(`dynamo-scan-service:${options.tableName}`);
        if (!PROFILE) return;

        const res = await dynamoScan.scan();
        expect2(res.list).toBeDefined();
        expect2(res.count).toBeDefined();

        //* test of the limited scan operations
        if (PROFILE) {
            const filter: DynamoScanFilter = { key: 'type', comparator: '=', value: 'bank_account' };
            let remain = data.length;
            let res;

            do {
                res = await dynamoScan.scan(5, res ? res.last : null, filter);
                expect2(res.count).toBeDefined();
                expect2(res.count).toBeLessThanOrEqual(5);
                remain -= res.count;
                if (remain > 0) {
                    expect2(res.last).toBeDefined();
                    expect2(res.last[options.idName]).toBeDefined();
                }
            } while (remain > 0);
        }
    });

    it('should pass scan w/ simple filter', async () => {
        const { dynamoScan, options } = instance();
        const useScan = !!PROFILE;

        let filter: DynamoScanFilter;
        let expectedCount;

        // 은행이 KB국민(bank = KB국민)인 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'bank', comparator: '=', value: 'KB국민' },
        ];
        expectedCount = data.filter(item => item.bank === 'KB국민').length;
        expect2(() => dynamoScan.buildPayload(-1, null, filter)).toEqual({
            TableName: 'DynamoTest',
            FilterExpression: '(#type = :type0 AND #bank = :bank0)',
            ExpressionAttributeNames: { '#bank': 'bank', '#type': 'type' },
            ExpressionAttributeValues: { ':bank0': 'KB국민', ':type0': 'bank_account' },
        });
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 연락처가 없는(contact = null) 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '=', value: null },
        ];
        expectedCount = data.filter(item => item.contact === null).length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 연락처가 없는(contact = 'a']) 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '=', value: 'a' },
        ];
        expect2(() => dynamoScan.buildPayload(-1, null, filter)).toEqual({
            ExpressionAttributeNames: { '#contact': 'contact', '#type': 'type' },
            ExpressionAttributeValues: { ':contact0': 'a', ':type0': 'bank_account' },
            FilterExpression: '(#type = :type0 AND #contact = :contact0)',
            TableName: 'DynamoTest',
        });
        expectedCount = data.filter(item => item.contact === 'a').length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 연락처가 있는(contact != null) 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { not: { key: 'contact', comparator: '=', value: null } },
        ];
        expectedCount = data.filter(item => item.contact !== null).length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '!=', value: null }, // 위의 필터와 동일한 표현식
        ];
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 잔액이 100~300만원(balance BETWEEN 1000000 AND 3000000)인 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'balance', from: 1000000, to: 3000000 },
        ];
        expectedCount = data.filter(item => item.balance >= 1000000 && item.balance <= 3000000).length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // note 필드가 존재하는(attribute_exists(note)) 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'note', exists: true },
        ];
        expectedCount = data.filter(item => 'note' in item).length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 성이 이씨인(begins_with(name, '이') 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'name', operator: 'begins_with', value: '이' },
        ];
        expectedCount = data.filter(item => item.name.startsWith('이')).length;
        expect2(() => dynamoScan.buildPayload(-1, null, filter)).toEqual({
            TableName: 'DynamoTest',
            FilterExpression: '(#type = :type0 AND begins_with(#name, :name0))',
            ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
            ExpressionAttributeValues: { ':name0': '이', ':type0': 'bank_account' },
        });
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });
    });

    it('should pass scan w/ complex filter', async () => {
        const { dynamoScan, options } = instance();
        const useScan = !!PROFILE;

        let filter: DynamoScanFilter;
        let expectedCount;

        // 성이 신씨이거나 정씨인 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            {
                or: [
                    { key: 'name', operator: 'begins_with', value: '신' },
                    { key: 'name', operator: 'begins_with', value: '정' },
                ],
            },
        ];
        expectedCount = data.filter(item => item.name.startsWith('신') || item.name.startsWith('정')).length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 성이 김씨가 아니고 잔액이 100~300만원인(NOT begins_with(name, '김') AND balance BETWEEN 1000000 AND 3000000) 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { not: { key: 'name', operator: 'begins_with', value: '김' } },
            { key: 'balance', from: 1000000, to: 3000000 },
        ];
        expectedCount = data.filter(
            item => !item.name.startsWith('김') && item.balance >= 1000000 && item.balance <= 3000000,
        ).length;
        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

        // 은행이 NH농협인 사람 중 연락처가 없거나 잔액이 50만원 이하인 개수
        filter = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'bank', comparator: '=', value: 'NH농협' },
            {
                or: [
                    { key: 'contact', comparator: '!=', value: null },
                    { key: 'balance', comparator: '<=', value: 500000 },
                ],
            },
        ];
        expectedCount = data.filter(
            item => item.bank === 'NH농협' && (item.contact != null || item.balance <= 500000),
        ).length;

        expect2(() => dynamoScan.buildPayload(-1, null, filter)).toEqual({
            TableName: 'DynamoTest',
            FilterExpression:
                '(#type = :type0 AND #bank = :bank0 AND (NOT #contact = :contact0 OR #balance <= :balance0))',
            ExpressionAttributeNames: {
                '#balance': 'balance',
                '#bank': 'bank',
                '#contact': 'contact',
                '#type': 'type',
            },
            ExpressionAttributeValues: {
                ':balance0': 500000,
                ':bank0': 'NH농협',
                ':contact0': null,
                ':type0': 'bank_account',
            },
        });

        if (useScan) expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });
    });
});

//! Unit tests with mocking
describe('DynamoScanService - Unit Tests', () => {
    it('should pass constructor test', () => {
        expect2(() => new DynamoScanService({ idName: 'ID' } as any)).toEqual('.tableName is required');
        expect2(() => new DynamoScanService({ tableName: 'Test' } as any)).toEqual('.idName is required');
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        expect2(service.hello()).toEqual('dynamo-scan-service:TestTable');

        const result = service.buildPayload();
        expect2(result).toEqual({ TableName: 'TestTable' });

        const payload = service.buildPayload(10);
        expect2(payload.Limit).toEqual(10);
        expect2(payload.TableName).toEqual('TestTable');
    });

    //* Test buildPayload with last key
    it('should build payload with last evaluated key', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
        const result = service.buildPayload(undefined, { ID: 'pk1', Sort: 100 });

        expect2(result.ExclusiveStartKey).toEqual({ ID: 'pk1', Sort: 100 });
    });

    //* Test buildPayload with comparison filter
    it('should build payload with equals comparison filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'status', comparator: '=', value: 'active' };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#status = :status0');
        expect2(result.ExpressionAttributeNames).toEqual({ '#status': 'status' });
        expect2(result.ExpressionAttributeValues).toEqual({ ':status0': 'active' });
    });

    //* Test buildPayload with not equals filter
    it('should build payload with not equals filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'status', comparator: '!=', value: 'deleted' };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('NOT #status = :status0');
    });

    //* Test buildPayload with between filter
    it('should build payload with between filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'age', from: 20, to: 30 };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#age BETWEEN :age0 AND :age1');
        expect2(result.ExpressionAttributeNames).toEqual({ '#age': 'age' });
        expect2(result.ExpressionAttributeValues).toEqual({ ':age0': 20, ':age1': 30 });
    });

    //* Test buildPayload with existence filter
    it('should build payload with attribute_exists filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'email', exists: true };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('attribute_exists(#email)');
        expect2(result.ExpressionAttributeNames).toEqual({ '#email': 'email' });
    });

    //* Test buildPayload with attribute_not_exists filter
    it('should build payload with attribute_not_exists filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'deleted', exists: false };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('attribute_not_exists(#deleted)');
    });

    //* Test buildPayload with begins_with filter
    it('should build payload with begins_with filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'name', operator: 'begins_with', value: 'Test' };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('begins_with(#name, :name0)');
        expect2(result.ExpressionAttributeNames).toEqual({ '#name': 'name' });
        expect2(result.ExpressionAttributeValues).toEqual({ ':name0': 'Test' });
    });

    //* Test buildPayload with contains filter
    it('should build payload with contains filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'description', operator: 'contains', value: 'test' };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('contains(#description, :description0)');
    });

    //* Test buildPayload with AND filters
    it('should build payload with AND filters', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = [
            { key: 'status', comparator: '=', value: 'active' },
            { key: 'age', comparator: '>=', value: 18 },
        ];
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('(#status = :status0 AND #age >= :age0)');
        expect2(result.ExpressionAttributeNames).toEqual({ '#status': 'status', '#age': 'age' });
        expect2(result.ExpressionAttributeValues).toEqual({ ':status0': 'active', ':age0': 18 });
    });

    //* Test buildPayload with OR filters
    it('should build payload with OR filters', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = {
            or: [
                { key: 'status', comparator: '=', value: 'active' },
                { key: 'status', comparator: '=', value: 'pending' },
            ],
        };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('(#status = :status0 OR #status = :status1)');
        expect2(result.ExpressionAttributeValues).toEqual({ ':status0': 'active', ':status1': 'pending' });
    });

    //* Test buildPayload with NOT filter
    it('should build payload with NOT filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = {
            not: { key: 'status', comparator: '=', value: 'deleted' },
        };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('NOT #status = :status0');
    });

    //* Test buildPayload with complex nested filters
    it('should build payload with complex nested filters', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = [
            { key: 'type', comparator: '=', value: 'user' },
            {
                or: [
                    { key: 'role', comparator: '=', value: 'admin' },
                    { key: 'role', comparator: '=', value: 'moderator' },
                ],
            },
        ];
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('(#type = :type0 AND (#role = :role0 OR #role = :role1))');
    });

    //* Test buildPayload with comparison operators
    it('should build payload with less than or equal filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'score', comparator: '<=', value: 100 };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#score <= :score0');
    });

    it('should build payload with less than filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'score', comparator: '<', value: 100 };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#score < :score0');
    });

    it('should build payload with greater than filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'score', comparator: '>', value: 50 };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#score > :score0');
    });

    it('should build payload with greater than or equal filter', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'score', comparator: '>=', value: 50 };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#score >= :score0');
    });

    //* Test scan with mock
    it('should execute scan successfully', async () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [
                { ID: 'id1', name: 'test1' },
                { ID: 'id2', name: 'test2' },
            ],
            Count: 2,
            ScannedCount: 2,
            LastEvaluatedKey: { ID: 'id2' },
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.scan();

        expect2(result.list).toEqual([
            { ID: 'id1', name: 'test1' },
            { ID: 'id2', name: 'test2' },
        ]);
        expect2(result.count).toEqual(2);
        expect2(result.last).toEqual({ ID: 'id2' });
    });

    //* Test scan with limit and filter
    it('should execute scan with limit and filter', async () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [{ ID: 'id1', status: 'active' }],
            Count: 1,
            ScannedCount: 5,
            LastEvaluatedKey: { ID: 'id1' },
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const filter: DynamoScanFilter = { key: 'status', comparator: '=', value: 'active' };
        const result = await service.scan(10, undefined, filter);

        expect2(result.list).toEqual([{ ID: 'id1', status: 'active' }]);
        expect2(result.count).toEqual(1);
    });

    //* Test scan with pagination
    it('should execute scan with pagination', async () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [{ ID: 'id3', name: 'test3' }],
            Count: 1,
            ScannedCount: 1,
            ConsumedCapacity: { CapacityUnits: 1, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.scan(10, { ID: 'id2' });

        expect2(result.list).toEqual([{ ID: 'id3', name: 'test3' }]);
        expect2(result.count).toEqual(1);
    });

    //* Test scan with empty results
    it('should handle empty scan results', async () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({
            Items: [],
            Count: 0,
            ScannedCount: 0,
            ConsumedCapacity: { CapacityUnits: 0, TableName: 'TestTable' }
        });

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.scan();

        expect2(result.list).toEqual([]);
        expect2(result.count).toEqual(0);
        expect2(result.last).toEqual({});
    });

    it('should handle empty object response', async () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });

        const mockSend = jest.fn().mockResolvedValue({});

        jest.spyOn(DynamoService, 'instance').mockReturnValue({
            dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
        } as any);

        const result = await service.scan();

        expect2(result.list).toEqual([]);
        expect2(result.count).toEqual(undefined);
    });

    //* Test buildPayload with limit 0 or negative (should not set limit)
    it('should not set limit when limit is 0', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const result = service.buildPayload(0);

        expect2(result.Limit).toEqual(undefined);
    });

    it('should not set limit when limit is negative', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const result = service.buildPayload(-1);

        expect2(result.Limit).toEqual(undefined);
    });

    //* Test buildPayload with null value in comparison
    it('should build payload with null value comparison', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = { key: 'deletedAt', comparator: '=', value: null };
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('#deletedAt = :deletedAt0');
        expect2(result.ExpressionAttributeValues).toEqual({ ':deletedAt0': null });
    });

    //* Test buildPayload with multiple same key filters
    it('should build payload with multiple filters on same key', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID' });
        const filter: DynamoScanFilter = [
            { key: 'age', comparator: '>=', value: 18 },
            { key: 'age', comparator: '<=', value: 65 },
        ];
        const result = service.buildPayload(undefined, undefined, filter);

        expect2(result.FilterExpression).toEqual('(#age >= :age0 AND #age <= :age1)');
        expect2(result.ExpressionAttributeValues).toEqual({ ':age0': 18, ':age1': 65 });
    });

    //* Test buildPayload with sortName in last key
    it('should build payload with sortName in last key', () => {
        const service = new DynamoScanService({ tableName: 'TestTable', idName: 'ID', sortName: 'timestamp' });
        const result = service.buildPayload(undefined, { ID: 'id1', timestamp: 12345 });

        expect2(result.ExclusiveStartKey).toEqual({ ID: 'id1', timestamp: 12345 });
    });
});
