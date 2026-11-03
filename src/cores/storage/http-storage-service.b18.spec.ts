/**
 * `http-storage-service.b18.spec.ts`
 * - v5 B18: offline unit test of `HttpStorageService` over a fake API client (no HTTP call).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpStorageService } from './http-storage-service';
import { GETERR } from '../../common/test-helper';

// a fake `APIServiceClient`: every call is a `vi.fn()`.
const fakeApi = () => ({
    hello: 'fake-api',
    doGet: vi.fn(),
    doPost: vi.fn(),
    doPut: vi.fn(),
    doDelete: vi.fn(),
});

// a storage with the fake client in place.
const storageOf = () => {
    //* v5 B18: dummy local endpoint; the real client is built offline, then replaced (no request is sent).
    const svc = new HttpStorageService<any>('http://localhost:8080/items', 'items', 'no');
    const api = fakeApi();
    (svc as any).service = api;
    return { svc, api };
};

describe('HttpStorageService (B18 offline)', () => {
    it('B18 constructor needs endpoint', () => {
        expect(() => new HttpStorageService<any>('', 'items')).toThrow('@endpoint(string) is required!');
        expect(new HttpStorageService<any>('http://localhost:8080/items', 'items').hello()).toBe(
            'http-storage-service:http://localhost:8080/items/id',
        );
        expect(storageOf().svc.hello()).toBe('http-storage-service:http://localhost:8080/items/no');
    });

    it('B18 read(), save(), delete() call the client', async () => {
        const { svc, api } = storageOf();
        expect(await svc.read(' ').catch(GETERR)).toBe('@id (string) is required!');
        api.doGet.mockResolvedValueOnce({ id: 'A1' });
        expect(await svc.read('A1')).toEqual({ id: 'A1' });
        expect(api.doGet).toHaveBeenCalledWith('A1');

        api.doPost.mockResolvedValueOnce({ id: 'A1', name: 'a' });
        expect(await svc.save('A1', { name: 'a' })).toEqual({ id: 'A1', name: 'a' });
        expect(api.doPost).toHaveBeenCalledWith('A1', undefined, null, { name: 'a' });

        api.doDelete.mockResolvedValueOnce({ id: 'A1' });
        expect(await svc.delete('A1')).toEqual({ id: 'A1' });
        expect(api.doDelete).toHaveBeenCalledWith('A1');
    });

    it('B18 readOrCreate() saves on 404 only', async () => {
        const { svc, api } = storageOf();
        api.doGet.mockRejectedValueOnce(new Error('404 NOT FOUND - id:A1'));
        api.doPost.mockResolvedValueOnce({ id: 'A1', name: 'new' });
        expect(await svc.readOrCreate('A1', { name: 'new' })).toEqual({ id: 'A1', name: 'new' });
        api.doGet.mockResolvedValueOnce({ id: 'A1', name: 'old' });
        expect(await svc.readOrCreate('A1', { name: 'new' })).toEqual({ id: 'A1', name: 'old' });
        api.doGet.mockRejectedValueOnce(new Error('500 INTERNAL'));
        expect(await svc.readOrCreate('A1', {}).catch(GETERR)).toBe('500 INTERNAL');
    });

    it('B18 update() and increment() merge the increments over the current item', async () => {
        const { svc, api } = storageOf();
        api.doGet.mockResolvedValue({ id: 'A1', count: 2, name: 'a' });
        api.doPut.mockImplementation(async (id: string, _c: any, _p: any, body: any) => ({ id, ...body }));

        //* number adds; non-number sets; new key sets; undefined skipped.
        expect(await svc.update('A1', { name: 'b' }, { count: 3, extra: 1, tag: 'x', skip: undefined })).toEqual({
            id: 'A1',
            name: 'b',
            count: 5,
            extra: 1,
            tag: 'x',
        });
        expect(api.doPut).toHaveBeenLastCalledWith('A1', undefined, null, { name: 'b', count: 5, extra: 1, tag: 'x' });

        //* a non-number delta over a non-number value sets it.
        expect(await svc.update('A1', {}, { name: 'z' })).toEqual({ id: 'A1', name: 'z' });

        //* no increments.
        expect(await svc.update('A1', { name: 'c' })).toEqual({ id: 'A1', name: 'c' });

        expect(await svc.increment('A1', { count: 1 }, { name: 'd' })).toEqual({ id: 'A1', name: 'd', count: 3 });
        //* number field with a non-number delta.
        expect(await svc.increment('A1', { count: 'x' }).catch(GETERR)).toBe('.count (x) should be number!');
    });

    it('B18 increment() validates id and item, and the read error', async () => {
        const { svc, api } = storageOf();
        expect(await svc.increment('', { a: 1 }).catch(GETERR)).toBe('@id is required - http.increment(fake-api)');
        expect(await svc.increment(' ', { a: 1 }).catch(GETERR)).toBe(
            '@id (string) is required - http.increment(fake-api)',
        );
        expect(await svc.increment('A1', null).catch(GETERR)).toBe('@item is required!');

        //* not found: base `{ id }`.
        api.doGet.mockRejectedValueOnce(new Error('404 NOT FOUND - id:A2'));
        api.doPut.mockResolvedValueOnce({ id: 'A2', n: 1 });
        expect(await svc.increment('A2', { n: 1 })).toEqual({ id: 'A2', n: 1 });
        expect(api.doPut).toHaveBeenLastCalledWith('A2', undefined, null, { n: 1 });

        //* other read errors are thrown.
        api.doGet.mockRejectedValueOnce('500 INTERNAL');
        expect(await svc.increment('A1', { n: 1 }).catch(GETERR)).toBe('500 INTERNAL');
    });
});
