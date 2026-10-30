/**
 * `abstract-rest-apis.b18.spec.ts`
 * - v5 B18-c: `RestAPI` over a stubbed protocol service (no send).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import $cores from '../../cores/';
import { $createApi, RestAPI } from './abstract-rest-apis';

describe('abstract-rest-apis B18', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    //* v5 B18: protocol sends are stubbed; `fromURL()` builds the real param.
    const stub = () => {
        const service = $cores.protocol.service;
        const execute = vi.spyOn(service, 'execute').mockImplementation(async (p: any) => {
            if (p?.id === 'fail') throw new Error('404 NOT FOUND - b18');
            return { id: p?.id ?? '', mode: p?.mode, body: p?.body, name: 'n' } as any;
        });
        const enqueue = vi.spyOn(service, 'enqueue').mockResolvedValue('qid');
        const notify = vi.spyOn(service, 'notify').mockResolvedValue('nid');
        return { execute, enqueue, notify };
    };

    it('B18 RestAPI CRUD through the protocol', async () => {
        const { execute } = stub();
        const $api = $createApi<any>({}, '//b18-api/items', { isProd: true });
        expect($api).toBeInstanceOf(RestAPI);
        expect($api.hello()).toEqual('rest-api://b18-api/items');
        expect($api.asProtocol().asTargetUrl()).toEqual('api://b18-api/items');
        expect($api.asProtocol('1').asTargetUrl()).toEqual('api://b18-api/items/1');
        expect($api.asProtocol('1', 'go').asTargetUrl()).toEqual('api://b18-api/items/1/go');

        await $api.list({ limit: 1 });
        expect(execute.mock.calls[0][0]).toMatchObject({ mode: 'GET', stage: 'prod', param: { limit: 1 } });
        expect((await $api.read('1')).mode).toEqual('GET');
        expect((await $api.insert({ a: 1 })).mode).toEqual('POST');
        expect((await $api.update('1', { a: 1 })).mode).toEqual('PUT');
        expect((await $api.delete('1')).mode).toEqual('DELETE');
        expect((await $api.execute({ id: '1', cmd: 'go', body: { b: 1 } })).mode).toEqual('POST');
        expect((await $api.execute({ mode: 'PATCH' })).mode).toEqual('PATCH');

        //* default reverser: the view as model.
        expect(await $api.set('1', { a: 1, x: undefined })).toMatchObject({ id: '1', mode: 'PUT', body: { a: 1 } });
        expect(await $api.get('1')).toMatchObject({ id: '1', mode: 'GET' });
        expect(await $api.get('fail')).toEqual({});
        await expect($api.get('fail', true)).rejects.toThrow('404 NOT FOUND - b18');
        expect(await $api.new({ a: 1 })).toMatchObject({ id: '0', mode: 'POST' });
        expect(await $api.del('1')).toMatchObject({ id: '1', mode: 'DELETE' });
    });

    it('B18 RestAPI enqueue/notify and a custom reverser', async () => {
        const { enqueue, notify } = stub();
        const reversor = {
            asModel: (V: any) => (V ? { ID: V.id } : null),
            asBody: (M: any) => ({ name: M.NAME }),
        };
        const $api = $createApi<any>({}, '//b18-api/items', { reversor });
        expect(await $api.enqueue({ id: '1', cmd: 'go', param: { p: 1 }, callback: 'items/1' }, 5)).toEqual('qid');
        expect(enqueue.mock.calls[0][0]).toMatchObject({ mode: 'POST', param: { p: 1 } });
        expect(enqueue.mock.calls[0][1]).toEqual({ type: 'items', id: '1', cmd: undefined, param: {} });
        expect(enqueue.mock.calls[0][2]).toEqual(5);
        expect(await $api.enqueue(null)).toEqual('qid');
        expect(await $api.notify({ mode: 'PUT', body: { b: 1 } })).toEqual('nid');
        expect(notify.mock.calls[0][0]).toMatchObject({ mode: 'PUT', body: { b: 1 } });
        expect(await $api.notify(null)).toEqual('nid');
        expect($api.reverser).toBe(reversor);
        expect(await $api.set('1', { NAME: 'n' })).toEqual({ ID: '1' });
        //* the reverser gives `null` for a missing view.
        expect(await $api.get('fail')).toEqual(null);
        //* dummy factory keeps its own counter.
        const $dummy = $createApi<any>({}, '//self/b18', { isDummy: true, initialNo: 10 });
        expect((await $dummy.insert({})).id).toEqual('11');
    });
});
