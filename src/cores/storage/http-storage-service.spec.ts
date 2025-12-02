/**
 * `http-storage-service.spec.ts`
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2025-11-26 initial version
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR } from '../../common/test-helper';
import { HttpStorageService } from './http-storage-service';
import { StorageModel } from './storage-service';

interface TestModel extends StorageModel {
    name?: string;
    slot?: number;
    balance?: number;
}

//! main test body.
describe('HttpStorageService', () => {
    const ENDPOINT = 'http://localhost:8080/api';
    const TYPE = 'test';

    it('should pass hello method', () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        expect2(() => service.hello()).toEqual(`http-storage-service:${ENDPOINT}/id`);
    });

    it('should pass hello with custom idName', () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE, '_id');
        expect2(() => service.hello()).toEqual(`http-storage-service:${ENDPOINT}/_id`);
    });

    it('should throw error for missing endpoint', () => {
        expect2(() => new HttpStorageService<TestModel>('', TYPE)).toBe('@endpoint(string) is required!');
    });

    it('should pass read method with mocked API', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'TEST01', name: 'test', slot: 10 });
        (service as any).service.doGet = mockDoGet;

        expect2(await service.read('TEST01')).toEqual({ id: 'TEST01', name: 'test', slot: 10 });
    });

    it('should throw error for empty id in read', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        expect2(await service.read('').catch(GETERR)).toBe('@id (string) is required!');
        expect2(await service.read('  ').catch(GETERR)).toBe('@id (string) is required!');
    });

    it('should pass save method with mocked API', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoPost = jest.fn().mockResolvedValue({ id: 'SAVE01', name: 'saved', slot: 5 });
        (service as any).service.doPost = mockDoPost;

        expect2(await service.save('SAVE01', { name: 'saved', slot: 5 })).toEqual({
            id: 'SAVE01',
            name: 'saved',
            slot: 5,
        });
    });

    it('should pass readOrCreate when item exists', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'EXIST01', name: 'existing' });
        (service as any).service.doGet = mockDoGet;

        expect2(await service.readOrCreate('EXIST01', { name: 'new' })).toEqual({ id: 'EXIST01', name: 'existing' });
    });

    it('should pass readOrCreate when item does not exist (404)', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockRejectedValue(new Error('404 NOT FOUND - id:NEW01'));
        const mockDoPost = jest.fn().mockResolvedValue({ id: 'NEW01', name: 'created' });
        (service as any).service.doGet = mockDoGet;
        (service as any).service.doPost = mockDoPost;

        expect2(await service.readOrCreate('NEW01', { name: 'created' })).toEqual({ id: 'NEW01', name: 'created' });
    });

    it('should throw error for non-404 error in readOrCreate', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockRejectedValue(new Error('Network timeout'));
        (service as any).service.doGet = mockDoGet;

        expect2(await service.readOrCreate('ERR01', { name: 'test' }).catch(GETERR)).toEqual('Network timeout');
    });

    it('should pass update method with mocked API', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'UPD01', name: 'old', slot: 10 });
        const mockDoPut = jest.fn().mockResolvedValue({ id: 'UPD01', name: 'updated', slot: 10 });
        (service as any).service.doGet = mockDoGet;
        (service as any).service.doPut = mockDoPut;

        expect2(await service.update('UPD01', { name: 'updated' })).toEqual({ id: 'UPD01', name: 'updated', slot: 10 });
    });

    it('should pass update with increment', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'UPD02', slot: 10, balance: 100 });
        const mockDoPut = jest.fn().mockResolvedValue({ id: 'UPD02', name: 'test', slot: 15, balance: 100 });
        (service as any).service.doGet = mockDoGet;
        (service as any).service.doPut = mockDoPut;

        expect2(await service.update('UPD02', { name: 'test' }, { slot: 5 })).toEqual({
            id: 'UPD02',
            name: 'test',
            slot: 15,
            balance: 100,
        });
    });

    it('should pass increment method with mocked API', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'INC01', slot: 10, balance: 100 });
        const mockDoPut = jest.fn().mockResolvedValue({ id: 'INC01', slot: 15, balance: 100 });
        (service as any).service.doGet = mockDoGet;
        (service as any).service.doPut = mockDoPut;

        expect2(await service.increment('INC01', { slot: 5 })).toEqual({ id: 'INC01', slot: 15, balance: 100 });
    });

    it('should throw error for empty id in increment', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const error1 = await service.increment('', { slot: 5 }).catch(GETERR);
        expect2(() => `${error1}`.startsWith('@id is required')).toBeTruthy();

        const error2 = await service.increment('  ', { slot: 5 }).catch(GETERR);
        expect2(() => `${error2}`.startsWith('@id (string) is required')).toBeTruthy();
    });

    it('should throw error for missing item in increment', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        expect2(await service.increment('INC02', null, null).catch(GETERR)).toEqual('@item is required!');
    });

    it('should pass increment with update parameter', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'INC03', slot: 10 });
        const mockDoPut = jest.fn().mockResolvedValue({ id: 'INC03', name: 'updated', slot: 15 });
        (service as any).service.doGet = mockDoGet;
        (service as any).service.doPut = mockDoPut;

        expect2(await service.increment('INC03', { slot: 5 }, { name: 'updated' })).toEqual({
            id: 'INC03',
            name: 'updated',
            slot: 15,
        });
    });

    it('should pass delete method with mocked API', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoDelete = jest.fn().mockResolvedValue({ id: 'DEL01', name: 'deleted' });
        (service as any).service.doDelete = mockDoDelete;

        expect2(await service.delete('DEL01')).toEqual({ id: 'DEL01', name: 'deleted' });
    });

    it('should pass validateIncrement when item exists', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'VAL01', slot: 10, balance: 100 });
        (service as any).service.doGet = mockDoGet;

        expect2(await service.validateIncrement('VAL01', { slot: 5, balance: 50 })).toEqual({ slot: 15, balance: 150 });
    });

    it('should pass validateIncrement when item does not exist (404)', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockRejectedValue(new Error('404 NOT FOUND - id:VAL02'));
        (service as any).service.doGet = mockDoGet;

        expect2(await service.validateIncrement('VAL02', { slot: 5 })).toEqual({ slot: 5 });
    });

    it('should throw error for non-404 error in validateIncrement', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockRejectedValue(new Error('Connection failed'));
        (service as any).service.doGet = mockDoGet;

        expect2(await service.validateIncrement('VAL03', { slot: 5 }).catch(GETERR)).toEqual('Connection failed');
    });

    it('should return null when $inc is null in validateIncrement', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'VAL04', slot: 10 });
        (service as any).service.doGet = mockDoGet;

        expect2(await service.validateIncrement('VAL04', null)).toEqual(null);
    });

    it('should pass validateIncrement with new field (org === undefined)', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'VAL05', slot: 10 });
        (service as any).service.doGet = mockDoGet;

        //* New field balance should be added
        expect2(await service.validateIncrement('VAL05', { balance: 100 })).toEqual({ balance: 100 });
    });

    it('should pass validateIncrement with non-number value', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'VAL06', name: 'old', slot: 10 });
        (service as any).service.doGet = mockDoGet;

        //* Non-number value should replace
        expect2(await service.validateIncrement('VAL06', { name: 'new' } as any)).toEqual({ name: 'new' });
    });

    it('should throw error for type mismatch in validateIncrement', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'VAL07', slot: 10 });
        (service as any).service.doGet = mockDoGet;

        //* Trying to increment a number field with string should throw error
        expect2(await service.validateIncrement('VAL07', { slot: 'invalid' } as any).catch(GETERR)).toEqual(
            '.slot (invalid) should be number!',
        );
    });

    it('should pass validateIncrement with undefined values', async () => {
        const service = new HttpStorageService<TestModel>(ENDPOINT, TYPE);
        const mockDoGet = jest.fn().mockResolvedValue({ id: 'VAL08', slot: 10 });
        (service as any).service.doGet = mockDoGet;

        //* Undefined values should be skipped
        expect2(await service.validateIncrement('VAL08', { balance: undefined })).toEqual({});
    });
});
