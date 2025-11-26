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
import { GETERR, expect2, _it } from '../../common/test-helper';
import { loadDataYml } from '../../tools/';
import * as tools from '../../tools/';
import { GeneralItem } from 'lemon-model';
import { DynamoService, DummyDynamoService, DynamoOption } from './dynamo-service';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

jest.mock('@aws-sdk/client-dynamodb', () => {
    const actual = jest.requireActual('@aws-sdk/client-dynamodb');
    return {
        ...actual,
        DynamoDBClient: jest.fn().mockImplementation(config => ({ __type: 'DynamoDBClient', config })),
    };
});

jest.mock('@aws-sdk/client-dynamodb-streams', () => {
    const actual = jest.requireActual('@aws-sdk/client-dynamodb-streams');
    return {
        ...actual,
        DynamoDBStreamsClient: jest.fn().mockImplementation(config => ({ __type: 'DynamoDBStreamsClient', config })),
    };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
    const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
    return {
        ...actual,
        DynamoDBDocumentClient: {
            from: jest.fn().mockImplementation(client => ({ __type: 'DynamoDBDocumentClient', client })),
        },
    };
});

jest.mock('../../tools/', () => {
    const actual = jest.requireActual('../../tools/');
    return {
        ...actual,
        awsConfig: jest.fn(actual.awsConfig),
    };
});

interface MyModel extends GeneralItem {
    ID?: string;
}
export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'ID';
    const options: DynamoOption = { tableName, idName };
    const service: DynamoService<MyModel> = new DynamoService<MyModel>(options);
    const dummy: DummyDynamoService<MyModel> = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', options);
    return { service, dummy, tableName };
};

//! main test body.
describe('DynamoService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* test prepareUpdateItem
    describe('UpdateExpression', () => {
        const { dummy } = instance();
        const id = '00';
        const sort: string | number = null;
        let payload: any;

        //* nomalizer.
        it('should pass normalize()', () => {
            const normalize = DynamoService.normalize;
            expect2(() => normalize('')).toEqual(null);
            expect2(() => normalize('a')).toEqual('a');

            expect2(() => normalize({ a: '' })).toEqual({ a: null });
            expect2(() => normalize({ a: 'a' })).toEqual({ a: 'a' });
        });

        it('update', () => {
            payload = dummy.prepareUpdateItem(id, sort, {});
            expect2(() => payload.UpdateExpression).toBe('');
            expect2(() => payload.ExpressionAttributeNames).toEqual({});
            expect2(() => payload.ExpressionAttributeValues).toEqual({});

            payload = dummy.prepareUpdateItem(id, sort, { myField: '' }); //* check '' empty string value.
            expect2(() => payload.UpdateExpression).toBe('SET #myField = :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': null });

            payload = dummy.prepareUpdateItem(id, sort, { myField: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField = :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { myField_: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField_ = :myField_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField_': 'myField_' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField_': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { myField$: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField_ = :myField_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField_': 'myField$' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField_': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 'str', fieldB: null });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldB = :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 'str', ':fieldB': null });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 1, fieldB: ['l', 'i', 's', 't'] });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldB = :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 1, ':fieldB': ['l', 'i', 's', 't'] });
        });

        it('increment number', () => {
            payload = dummy.prepareUpdateItem(id, sort, {}, { myField: 1 });
            expect2(() => payload.UpdateExpression).toBe('ADD #myField :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': 1 });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 'str' }, { fieldB: -1 });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA ADD #fieldB :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 'str', ':fieldB': -1 });
        });

        it('list append/replace/remove', () => {
            payload = dummy.prepareUpdateItem(id, sort, {}, { myField: [3, 1] } as any);
            expect2(() => payload.UpdateExpression).toBe(
                'SET #myField = list_append(if_not_exists(#myField, :myField_0), :myField)',
            );
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': [3, 1], ':myField_0': [] });

            payload = dummy.prepareUpdateItem(id, sort, {
                fieldA: {
                    setIndex: [
                        [1, 'a'],
                        [3, 3],
                    ],
                },
            });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA[1] = :fieldA_0_, #fieldA[3] = :fieldA_1_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA_0_': 'a', ':fieldA_1_': 3 });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: { removeIndex: [2, 3] } });
            expect2(() => payload.UpdateExpression).toBe('REMOVE #fieldA[2], #fieldA[3]');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({});

            // all together
            payload = dummy.prepareUpdateItem(
                id,
                sort,
                { fieldA: [1, null], fieldC: { removeIndex: [1] }, fieldD: { setIndex: [[3, 3]] } },
                { fieldB: [2, 4] },
            );
            expect2(() => payload.UpdateExpression).toBe(
                'SET #fieldA = :fieldA, #fieldD[3] = :fieldD_0_, #fieldB = list_append(if_not_exists(#fieldB, :fieldB_0), :fieldB) REMOVE #fieldC[1]',
            );
            expect2(() => payload.ExpressionAttributeNames).toEqual({
                '#fieldA': 'fieldA',
                '#fieldB': 'fieldB',
                '#fieldC': 'fieldC',
                '#fieldD': 'fieldD',
            });
            expect2(() => payload.ExpressionAttributeValues).toEqual({
                ':fieldA': [1, null],
                ':fieldB': [2, 4],
                ':fieldB_0': [],
                ':fieldD_0_': 3,
            });
        });
    });

    //* dummy storage service.
    describe('DummyDynamoService', () => {
        //* load dummy storage service.
        const { dummy, tableName } = instance();

        it('should pass basic CRUD', async () => {
            //* check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);

            expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - ID:00');
            expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ ID: 'A0', type: 'account', name: 'lemon' });
            expect2(await dummy.readItem('A1'), 'ID,type,name').toEqual({ ID: 'A1', type: 'account', name: 'Hong' });

            //* basic simple CRUD test.
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await dummy.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID').toEqual('404 NOT FOUND - ID:A0');
            // empty string will be saved as null
            expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), 'ID,type').toEqual({
                ID: 'A0',
                type: null,
            });
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null });
            expect2(await dummy.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: 'account' });
        });

        it('should pass simple list w/ dummy', async () => {
            //* check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);
            expect2(await dummy.listItems(), '!list').toEqual({ page: 1, limit: 2, total: 3 });
            expect2(await dummy.listItems(1, 1), '!list').toEqual({ page: 1, limit: 1, total: 3 });
            expect2(await dummy.listItems(2, 2), '!list').toEqual({ page: 2, limit: 2, total: 3 });
        });
    });

    //* real DynamoDB storage service.
    describe('DynamoService (real)', () => {
        const { service, tableName } = instance();
        const dataMap = new Map<string, MyModel>();

        beforeAll(async () => {
            if (!PROFILE) return;

            // Initialize data in the table
            const data: MyModel[] = loadDataYml('dummy-dynamo-data.yml').data;
            await data.map(async item => {
                const saved = await service.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            });
        });

        it('should pass basic CRUD', async () => {
            if (!PROFILE) return;

            //* check dummy data.
            expect2(service.hello()).toEqual(`dynamo-service:${tableName}`);
            expect2(await service.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - ID:00');
            expect2(await service.readItem('A0').catch(GETERR)).toEqual({ ID: 'A0', type: 'account', name: 'lemon' });
            expect2(await service.readItem('A1').catch(GETERR), 'ID,type,name').toEqual({
                ID: 'A1',
                type: 'account',
                name: 'Hong',
            });

            //* basic simple CRUD test.
            expect2(await service.readItem('A0').catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await service.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await service.readItem('A0').catch(GETERR), 'ID').toEqual('404 NOT FOUND - ID:A0');
            // empty string will be saved as null
            expect2(await service.saveItem('A0', { type: '' }).catch(GETERR), 'ID,type').toEqual({
                ID: 'A0',
                type: null,
            });
            expect2(await service.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null });
            expect2(await service.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await service.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: 'account' });
        });

        afterAll(async () => {
            if (!PROFILE) return;

            // Cleanup the table
            await Promise.all([...dataMap.keys()].map(id => service.deleteItem(id)));
        });
    });

    describe('DynamoService.instance', () => {
        const awsConfigMock = tools.awsConfig as jest.Mock;
        const DynamoDBClientMock = DynamoDBClient as unknown as jest.Mock;
        const DynamoDBStreamsClientMock = DynamoDBStreamsClient as unknown as jest.Mock;
        const DocumentClientFromMock = DynamoDBDocumentClient.from as jest.Mock;

        beforeEach(() => {
            awsConfigMock.mockReset();
            DynamoDBClientMock.mockClear();
            DynamoDBStreamsClientMock.mockClear();
            DocumentClientFromMock.mockClear();
        });

        const createAwsConfig = (region: string, credentials: any = { accessKeyId: 'AK', secretAccessKey: 'SK' }) => ({
            region,
            credentials: Promise.resolve(credentials),
        });

        it('should build clients with default region', async () => {
            awsConfigMock.mockReturnValue(createAwsConfig('ap-northeast-2') as any);

            const { dynamo, dynamostr, dynamodoc } = DynamoService.instance();

            expect2(awsConfigMock.mock.calls.length).toEqual(1);
            expect2(awsConfigMock.mock.calls[0][1]).toEqual('ap-northeast-2');
            expect2(DynamoDBClientMock.mock.calls[0][0].region).toEqual('ap-northeast-2');
            expect2(DynamoDBStreamsClientMock.mock.calls[0][0].region).toEqual('ap-northeast-2');
            expect2((dynamo as any).__type).toEqual('DynamoDBClient');
            expect2((dynamostr as any).__type).toEqual('DynamoDBStreamsClient');

            const docClient = await dynamodoc();
            expect2(DocumentClientFromMock.mock.calls.length).toEqual(1);
            expect2((docClient as any).__type).toEqual('DynamoDBDocumentClient');
        });

        it('should reuse resolved credentials when creating document client', async () => {
            const credentials = { accessKeyId: 'CRED', secretAccessKey: 'SECRET' };
            awsConfigMock.mockReturnValue(createAwsConfig('us-west-1', credentials) as any);

            const { dynamodoc } = DynamoService.instance('us-west-1');
            await dynamodoc();

            expect2(DynamoDBClientMock.mock.calls.length).toEqual(2);
            expect2(DynamoDBClientMock.mock.calls[0][0].region).toEqual('us-west-1');
            expect2(DynamoDBClientMock.mock.calls[1][0].credentials).toEqual(credentials);
        });
    });

    //! Unit tests with mocking
    describe('DynamoService - Unit Tests', () => {
        //* Test constructor errors
        it('should throw error when tableName is missing', () => {
            expect2(() => new DynamoService({ idName: 'ID' } as any)).toEqual('.tableName is required');
        });

        it('should throw error when idName is missing', () => {
            expect2(() => new DynamoService({ tableName: 'Test' } as any)).toEqual('.idName is required');
        });

        //* Test hello()
        it('should return correct hello string', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });
            expect2(service.hello()).toEqual('dynamo-service:TestTable');
        });

        //* Test prepareCreateTable
        it('should prepare create table payload without sort key', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });
            const result = service.prepareCreateTable(5, 10, true);

            expect2(result.TableName).toEqual('TestTable');
            expect2(result.KeySchema).toEqual([{ AttributeName: 'ID', KeyType: 'HASH' }]);
            expect2(result.AttributeDefinitions).toEqual([{ AttributeName: 'ID', AttributeType: 'S' }]);
            expect2(result.ProvisionedThroughput).toEqual({ ReadCapacityUnits: 5, WriteCapacityUnits: 10 });
            expect2(result.StreamSpecification.StreamEnabled).toEqual(true);
        });

        it('should prepare create table payload with sort key', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
            const result = service.prepareCreateTable(1, 1, false);

            expect2(result.KeySchema.length).toEqual(2);
            expect2(result.KeySchema[1]).toEqual({ AttributeName: 'Sort', KeyType: 'RANGE' });
            expect2(result.AttributeDefinitions.length).toEqual(2);
            expect2(result.StreamSpecification.StreamEnabled).toEqual(false);
        });

        it('should prepare create table with number type keys', () => {
            const service = new DynamoService({
                tableName: 'TestTable',
                idName: 'ID',
                idType: 'number',
                sortName: 'Sort',
                sortType: 'number',
            });
            const result = service.prepareCreateTable();

            expect2(result.AttributeDefinitions[0].AttributeType).toEqual('N');
            expect2(result.AttributeDefinitions[1].AttributeType).toEqual('N');
        });

        it('should throw error for invalid key type', () => {
            const service = new DynamoService({
                tableName: 'TestTable',
                idName: 'ID',
                idType: 'invalid' as any,
            });

            expect2(() => service.prepareCreateTable()).toEqual('invalid key-type:invalid');
        });

        //* Test prepareDeleteTable
        it('should prepare delete table payload', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });
            const result = service.prepareDeleteTable();

            expect2(result).toEqual({ TableName: 'TestTable' });
        });

        //* Test prepareSaveItem
        it('should prepare save item payload', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });
            const result = service.prepareSaveItem('test-id', { name: 'test', value: 123 } as any);

            expect2(result.TableName).toEqual('TestTable');
            expect2(result.Item).toEqual({ ID: 'test-id', name: 'test', value: 123 });
        });

        it('should prepare save item with empty string normalization', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });
            const result = service.prepareSaveItem('test-id', { name: '', value: 'test' } as any);

            expect2(result.Item).toEqual({ ID: 'test-id', name: null, value: 'test' });
        });

        it('should throw error when sortName is required but missing', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

            expect2(() => service.prepareSaveItem('test-id', { name: 'test' } as any)).toEqual(
                '.Sort is required. ID:test-id',
            );
        });

        it('should prepare save item with sort key', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
            const result = service.prepareSaveItem('test-id', { Sort: 100, name: 'test' } as any);

            expect2(result.Item).toEqual({ ID: 'test-id', Sort: 100, name: 'test' });
        });

        //* Test prepareItemKey
        it('should prepare item key without sort', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });
            const result = service.prepareItemKey('test-id', null);

            expect2(result).toEqual({
                TableName: 'TestTable',
                Key: { ID: 'test-id' },
            });
        });

        it('should prepare item key with sort', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });
            const result = service.prepareItemKey('test-id', 100);

            expect2(result).toEqual({
                TableName: 'TestTable',
                Key: { ID: 'test-id', Sort: 100 },
            });
        });

        it('should throw error when id is missing', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            expect2(() => service.prepareItemKey('', null)).toEqual('@id is required - prepareItemKey(TestTable/ID)');
        });

        it('should throw error when sort is required but undefined', () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID', sortName: 'Sort' });

            expect2(() => service.prepareItemKey('test-id', undefined)).toEqual('@sort is required. ID:test-id');
        });

        //* Test readItem with mock
        it('should read item successfully', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({
                Item: { ID: 'test-id', name: 'test' },
            });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            const result = await service.readItem('test-id');

            expect2(result).toEqual({ ID: 'test-id', name: 'test' });
        });

        it('should throw 404 when item not found', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({});

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.readItem('test-id').catch(GETERR)).toEqual('404 NOT FOUND - ID:test-id');
        });

        it('should handle resource not found error', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue({
                name: 'ResourceNotFoundException',
                message: 'Requested resource not found'
            });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.readItem('test-id').catch(GETERR)).toEqual('404 NOT FOUND - ID:test-id');
        });

        //* Test saveItem with mock
        it('should save item successfully', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({});

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            const result = await service.saveItem('test-id', { name: 'test' } as any);

            expect2(result).toEqual({ ID: 'test-id', name: 'test' });
        });

        it('should handle save item resource not found error', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue({
                name: 'ResourceNotFoundException',
                message: 'Requested resource not found'
            });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.saveItem('test-id', { name: 'test' } as any).catch(GETERR)).toEqual(
                '404 NOT FOUND - ID:test-id',
            );
        });

        //* Test deleteItem with mock
        it('should delete item successfully', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({});

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            const result = await service.deleteItem('test-id');

            expect2(result).toEqual(null);
        });

        it('should handle delete item resource not found error', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue(new Error('Requested resource not found'));

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            const result = await service.deleteItem('test-id');

            expect2(result).toEqual({});
        });

        //* Test updateItem with mock
        it('should update item successfully', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({
                Attributes: { name: 'updated' },
                ConsumedCapacity: { CapacityUnits: 1 }
            });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            const result = await service.updateItem('test-id', null, { name: 'updated' });

            expect2(result.name).toEqual('updated');
            expect2(result.ID).toEqual('test-id');
        });

        it('should handle update item resource not found error', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue({
                name: 'ResourceNotFoundException',
                message: 'Requested resource not found'
            });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.updateItem('test-id', null, { name: 'test' }).catch(GETERR)).toEqual(
                '404 NOT FOUND - ID:test-id',
            );
        });

        //* Test createTable and deleteTable with mock
        it('should create table successfully', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({ TableDescription: { TableName: 'TestTable' } });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamo: { send: mockSend },
            } as any);

            const result = await service.createTable(1, 1);

            expect2(result.TableDescription.TableName).toEqual('TestTable');
        });

        it('should delete table successfully', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockResolvedValue({ TableDescription: { TableName: 'TestTable' } });

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamo: { send: mockSend },
            } as any);

            const result = await service.deleteTable();

            expect2(result.TableDescription.TableName).toEqual('TestTable');
        });

        //* Test static normalize function edge cases
        it('should normalize nested objects with empty strings', () => {
            const result = DynamoService.normalize({ a: { b: '' } });
            expect2(result).toEqual({ a: { b: null } });
        });

        it('should normalize arrays', () => {
            const result = DynamoService.normalize(['', 'a', { b: '' }]);
            expect2(result).toEqual([null, 'a', { b: null }]);
        });

        it('should normalize null and undefined', () => {
            expect2(DynamoService.normalize(null)).toEqual(null);
            expect2(DynamoService.normalize(undefined)).toEqual(undefined);
        });

        it('should normalize numbers and booleans', () => {
            expect2(DynamoService.normalize(123)).toEqual(123);
            expect2(DynamoService.normalize(true)).toEqual(true);
            expect2(DynamoService.normalize(false)).toEqual(false);
        });

        //* Test error handling paths that throw errors (not just catch)
        it('should throw other errors in saveItem', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue(new Error('Some other error'));

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.saveItem('test-id', { name: 'test' } as any).catch(GETERR)).toEqual(
                'Some other error',
            );
        });

        it('should throw other errors in deleteItem', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue(new Error('Some other error'));

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.deleteItem('test-id').catch(GETERR)).toEqual('Some other error');
        });

        it('should throw other errors in updateItem', async () => {
            const service = new DynamoService({ tableName: 'TestTable', idName: 'ID' });

            const mockSend = jest.fn().mockRejectedValue(new Error('Some other error'));

            jest.spyOn(DynamoService, 'instance').mockReturnValue({
                dynamodoc: jest.fn().mockResolvedValue({ send: mockSend }),
            } as any);

            expect2(await service.updateItem('test-id', null, { name: 'test' }).catch(GETERR)).toEqual(
                'Some other error',
            );
        });
    });

    //! DummyDynamoService - Unit Tests
    describe('DummyDynamoService - Unit Tests', () => {
        //* Test constructor error
        it('should throw error when dataFile is missing', () => {
            expect2(() => new DummyDynamoService('', { tableName: 'Test', idName: 'ID' })).toEqual(
                '@dataFile(string) is required!',
            );
        });

        //* Test load() errors
        it('should throw error when data is not array', () => {
            const dummy = new DummyDynamoService('dummy-dynamo-data.yml', { tableName: 'Test', idName: 'ID' });

            expect2(() => dummy.load(null as any)).toEqual('@data should be array!');
        });

        it('should throw error when data is undefined', () => {
            const dummy = new DummyDynamoService('dummy-dynamo-data.yml', { tableName: 'Test', idName: 'ID' });

            expect2(() => dummy.load(undefined as any)).toEqual('@data should be array!');
        });

        //* Test listItems edge cases
        it('should handle listItems with default page and limit', async () => {
            const { dummy } = instance();
            const result = await dummy.listItems();

            expect2(result.page).toEqual(1);
            expect2(result.limit).toEqual(2);
        });

        it('should handle listItems with custom page and limit', async () => {
            const { dummy } = instance();
            const result = await dummy.listItems(2, 1);

            expect2(result.page).toEqual(2);
            expect2(result.limit).toEqual(1);
        });

        //* Test readItem edge cases
        it('should throw 404 for non-existent item in dummy', async () => {
            const { dummy } = instance();

            expect2(await dummy.readItem('NONEXISTENT').catch(GETERR)).toEqual('404 NOT FOUND - ID:NONEXISTENT');
        });

        //* Test updateItem on non-existent item
        it('should throw 404 when updating non-existent item in dummy', async () => {
            const { dummy } = instance();

            expect2(await dummy.updateItem('NONEXISTENT', null, { name: 'test' } as any).catch(GETERR)).toEqual(
                '404 NOT FOUND - ID:NONEXISTENT',
            );
        });
    });
});
